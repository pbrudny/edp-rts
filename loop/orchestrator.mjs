#!/usr/bin/env node
// Multi-agent dev loop for Ember Realms. Plain Node, no deps; agents run through `claude -p --agent <name>`.
//
//   node loop/orchestrator.mjs status                     backlog overview
//   node loop/orchestrator.mjs triage [-n|--count 3] [--note ".."] playtest -> producer -> new tasks in backlog/tasks.jsonl
//   node loop/orchestrator.mjs run [--max-tasks 1] [--task T001] [--auto-merge] [--triage]
//   node loop/orchestrator.mjs approve T003 | reject T003 | retry T003
//   node loop/orchestrator.mjs merge T003                  merge a "ready" branch into the current branch (local only)
//   node loop/orchestrator.mjs clean T003                  remove a task's worktree (branch is kept)
//
// Per task: worktree .worktrees/<id> on branch loop/<id> -> builder|balancer -> gates (up to 3 rounds with feedback)
// -> reviewer (up to 2 review rounds) -> commit on the branch -> "ready" (or merged with --auto-merge).
// Never pushes or deploys. Deploying stays manual (see README "Run / test").
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, symlinkSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BACKLOG = join(ROOT, "backlog", "tasks.jsonl");
const RUNS = join(ROOT, "loop", "runs");
const WT = join(ROOT, ".worktrees");
const MAX_BUILD_ROUNDS = 3, MAX_REVIEW_ROUNDS = 2, MAX_ESCALATIONS_IN_A_ROW = 2;

const args = process.argv.slice(2), cmd = args[0] ?? "status";
const opt = (name, def, short) => { let i = args.indexOf("--" + name); if (i < 0 && short) i = args.indexOf("-" + short); return i < 0 ? def : args[i + 1]; };
const flag = (name) => args.includes("--" + name);
const runId = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(RUNS, { recursive: true });
const log = (event, data = {}) => {
  appendFileSync(join(RUNS, `${runId}.jsonl`), JSON.stringify({ at: new Date().toISOString(), event, ...data }) + "\n");
  console.log(`[${event}]`, Object.entries(data).filter(([, v]) => typeof v !== "object").map(([k, v]) => `${k}=${v}`).join(" "));
};

// ---------- backlog (one JSON object per line, committed to git) ----------
const load = () => existsSync(BACKLOG) ? readFileSync(BACKLOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const save = (tasks) => { mkdirSync(dirname(BACKLOG), { recursive: true }); writeFileSync(BACKLOG, tasks.map((t) => JSON.stringify(t)).join("\n") + (tasks.length ? "\n" : "")); };
const update = (id, patch) => { const ts = load(); const t = ts.find((x) => x.id === id); if (!t) throw new Error(`no task ${id}`); Object.assign(t, patch, { updatedAt: new Date().toISOString() }); save(ts); return t; };
const nextId = (ts) => "T" + String(Math.max(0, ...ts.map((t) => Number(t.id.slice(1)) || 0)) + 1).padStart(3, "0");

// ---------- shell helpers ----------
const sh = (command, a, cwd = ROOT, extra = {}) => {
  const p = spawnSync(command, a, { cwd, encoding: "utf8", maxBuffer: 64 << 20, ...extra });
  return { ok: p.status === 0, out: (p.stdout ?? "").trim(), err: (p.stderr ?? "").trim(), status: p.status };
};
const git = (a, cwd = ROOT) => { const r = sh("git", a, cwd); if (!r.ok) throw new Error(`git ${a.join(" ")}: ${r.err || r.out}`); return r.out; };

// ---------- agents ----------
const SCHEMAS = {
  producer: { type: "object", required: ["tasks"], properties: { tasks: { type: "array", items: { type: "object", required: ["title", "type", "spec", "acceptance", "priority", "needs_approval", "evidence"], properties: {
    title: { type: "string" }, type: { enum: ["balance", "ai", "bugfix", "perf", "feature", "test"] }, spec: { type: "string" },
    acceptance: { type: "array", items: { type: "string" } }, priority: { type: "integer", minimum: 1, maximum: 5 },
    needs_approval: { type: "boolean" }, evidence: { type: "string" }, files_hint: { type: "array", items: { type: "string" } } } } } } },
  builder: { type: "object", required: ["summary", "files_changed", "tests", "blocked"], properties: {
    summary: { type: "string" }, files_changed: { type: "array", items: { type: "string" } }, tests: { type: "string" },
    blocked: { type: ["string", "null"], description: "null if done; otherwise why the task can't be done as specified" } } },
  reviewer: { type: "object", required: ["approve", "blocking", "nits"], properties: {
    approve: { type: "boolean" }, blocking: { type: "array", items: { type: "string" } }, nits: { type: "array", items: { type: "string" } } } },
};
SCHEMAS.balancer = { ...SCHEMAS.builder, required: [...SCHEMAS.builder.required, "metrics"], properties: { ...SCHEMAS.builder.properties,
  metrics: { type: "array", items: { type: "object", required: ["name", "before", "after"], properties: { name: { type: "string" }, before: {}, after: {} } } } } };

const TOOLS = {
  producer: ["Read", "Grep", "Glob"],
  reviewer: ["Read", "Grep", "Glob", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(git status:*)", "Bash(node test-*)"],
  builder: ["Read", "Edit", "Write", "Grep", "Glob", "Bash(node:*)", "Bash(git diff:*)", "Bash(git status:*)", "Bash(ls:*)"],
  balancer: ["Read", "Edit", "Grep", "Glob", "Bash(node loop/playtest.mjs:*)", "Bash(node loop/gates.mjs:*)", "Bash(git diff:*)"],
};

let spentUsd = 0;
function agent(name, prompt, cwd) {
  const t0 = Date.now();
  const r = sh("claude", ["-p", prompt, "--agent", name, "--output-format", "json", "--strict-mcp-config", "--json-schema", JSON.stringify(SCHEMAS[name]),
    "--permission-mode", name === "builder" || name === "balancer" ? "acceptEdits" : "default", "--allowedTools", ...TOOLS[name]],
    cwd, { timeout: 60 * 60_000, env: { ...process.env, CLAUDE_LOOP_AGENT: name } });
  let res;
  try { res = JSON.parse(r.out); } catch { throw new Error(`${name}: claude returned non-JSON (exit ${r.status}): ${(r.err || r.out).slice(-800)}`); }
  if (Array.isArray(res)) res = res.findLast((m) => m.type === "result") ?? {}; // newer CLIs print the whole message list
  if (res.is_error) throw new Error(`${name}: claude error (${res.subtype}): ${String(res.result ?? "").slice(-800)}`);
  spentUsd += res.total_cost_usd ?? 0;
  let data = res.structured_output;
  if (!data) { const m = String(res.result ?? "").match(/\{[\s\S]*\}/); if (m) try { data = JSON.parse(m[0]); } catch {} }
  if (!data) throw new Error(`${name}: no structured output: ${String(res.result).slice(-800)}`);
  log("agent", { name, seconds: Math.round((Date.now() - t0) / 1000), costUsd: res.total_cost_usd, output: data });
  return data;
}

// ---------- playtest / gates ----------
function playtest(cwd = ROOT, games = 48) {
  const out = join(cwd, "reports", `playtest-${Date.now()}.json`);
  const r = sh("node", ["loop/playtest.mjs", "--games", String(games), "--quiet", "--out", out], cwd);
  if (!r.ok) throw new Error("playtest failed: " + (r.err || r.out).slice(-1500));
  return { path: out, report: JSON.parse(readFileSync(out, "utf8")) };
}
const latestReport = () => {
  const d = join(ROOT, "reports"); if (!existsSync(d)) return null;
  const f = readdirSync(d).filter((x) => x.startsWith("playtest-")).sort().at(-1);
  return f ? join(d, f) : null;
};
function gates(cwd) {
  const r = sh("node", ["loop/gates.mjs", "--json"], cwd);
  const last = r.out.split("\n").at(-1);
  try { return JSON.parse(last); } catch { return { ok: false, gates: [{ name: "gates crashed", ok: false, log: (r.err || r.out).slice(-2000) }] }; }
}
const gateFeedback = (g) => g.gates.filter((x) => !x.ok).map((x) => `### ${x.name}\n${x.log}`).join("\n\n");

// ---------- commands ----------
function triage() {
  const n = Number(opt("count", 3, "n"));
  console.log("Running playtest...");
  const { path, report } = playtest();
  log("playtest", { report: path, flags: report.flags.length });
  const backlog = load();
  const prompt = [
    `Newest playtest report: ${path}`,
    `Its flags: ${JSON.stringify(report.flags)}`,
    `Backlog (${backlog.length} tasks): ${backlog.length ? JSON.stringify(backlog.map(({ id, title, type, status }) => ({ id, title, type, status }))) : "empty"}`,
    `Propose at most ${n} new tasks.`,
    opt("note") ? `Notes from Piotr: ${opt("note")}` : "",
  ].join("\n\n");
  const { tasks } = agent("producer", prompt, ROOT);
  const all = load();
  for (const t of tasks.slice(0, n)) {
    const task = { id: nextId(all), ...t, status: t.needs_approval ? "awaiting-approval" : "todo", report: path, createdAt: new Date().toISOString() };
    all.push(task);
    console.log(`  + ${task.id} [${task.type}, p${task.priority}] ${task.title}${task.needs_approval ? "  (needs approval)" : ""}`);
  }
  save(all);
}

function worktree(t) {
  const dir = join(WT, t.id), branch = `loop/${t.id}`;
  if (!existsSync(dir)) {
    mkdirSync(WT, { recursive: true });
    const exists = sh("git", ["rev-parse", "--verify", branch]).ok;
    git(exists ? ["worktree", "add", dir, branch] : ["worktree", "add", "-b", branch, dir, "HEAD"]);
  }
  if (existsSync(join(ROOT, "node_modules")) && !existsSync(join(dir, "node_modules"))) symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"));
  return { dir, branch };
}

function work(t) {
  const { dir, branch } = worktree(t);
  update(t.id, { status: "in-progress", branch });
  log("task-start", { id: t.id, title: t.title, branch });
  const role = t.type === "balance" ? "balancer" : "builder";
  const taskText = `Task ${t.id}: ${t.title}\nType: ${t.type}\n\nSpec:\n${t.spec}\n\nAcceptance criteria:\n${t.acceptance.map((a) => "- " + a).join("\n")}\n\nEvidence: ${t.evidence}` +
    (t.report ? `\nPlaytest report it is based on: ${t.report}` : "") + (t.files_hint?.length ? `\nLikely files: ${t.files_hint.join(", ")}` : "");
  let feedback = t.reviewNotes ? `A previous attempt was rejected by review:\n${t.reviewNotes}` : "";

  for (let review = 1; review <= MAX_REVIEW_ROUNDS; review++) {
    let g = null, built = null;
    for (let round = 1; round <= MAX_BUILD_ROUNDS; round++) {
      built = agent(role, `${taskText}${feedback ? `\n\nFix this first:\n${feedback}` : ""}`, dir);
      if (built.blocked) { update(t.id, { status: "blocked", blocked: built.blocked }); log("task-blocked", { id: t.id, why: built.blocked }); return "escalated"; }
      g = gates(dir);
      log("gates", { id: t.id, round, ok: g.ok });
      if (g.ok) break;
      feedback = `The gates failed (node loop/gates.mjs):\n${gateFeedback(g)}`;
    }
    if (!g.ok) { update(t.id, { status: "failed", lastGateLog: gateFeedback(g).slice(-4000) }); return "escalated"; }

    const verdict = agent("reviewer", `${taskText}\n\nBuilder summary: ${built.summary}\nTests: ${built.tests}` +
      (built.metrics ? `\nBalance metrics before/after: ${JSON.stringify(built.metrics)}` : "") +
      `\n\nThe gates (syntax, rule tests, determinism replay, smoke matches + perf budget, server boot) are green. Review the diff in this worktree against main.`, dir);
    if (verdict.approve) {
      git(["add", "-A", "--", ".", ":!reports", ":!node_modules"], dir);
      git(["commit", "-m", `${t.id}: ${t.title}\n\n${built.summary}\n\nAutomated loop: ${role} + reviewer, gates green.`], dir);
      update(t.id, { status: "ready", summary: built.summary, nits: verdict.nits, metrics: built.metrics });
      log("task-ready", { id: t.id, branch });
      return "ready";
    }
    feedback = `Code review blocked the change:\n${verdict.blocking.map((b) => "- " + b).join("\n")}`;
    update(t.id, { reviewNotes: feedback });
    log("review-blocked", { id: t.id, review });
  }
  update(t.id, { status: "review-failed" });
  return "escalated";
}

function merge(id) {
  const t = load().find((x) => x.id === id);
  if (t?.status !== "ready") throw new Error(`${id} is not ready (status ${t?.status})`);
  if (sh("git", ["status", "--porcelain", "--untracked-files=no"]).out) throw new Error("main working tree has uncommitted changes; commit or stash them first");
  git(["merge", "--no-ff", t.branch, "-m", `Merge ${t.branch}: ${t.title}`]);
  update(id, { status: "merged" });
  const g = gates(ROOT);
  log("merged", { id, gatesOnMain: g.ok });
  if (!g.ok) console.log("WARNING: gates are red on the merged branch:\n" + gateFeedback(g));
}

function runLoop() {
  if (flag("triage")) triage();
  const max = Number(opt("max-tasks", 1));
  let done = 0, escalations = 0;
  while (done < max) {
    const ts = load();
    const t = opt("task") ? ts.find((x) => x.id === opt("task")) : ts.filter((x) => x.status === "todo").sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))[0];
    if (!t) { console.log("Nothing to do (no todo tasks). Run `triage` or approve tasks."); break; }
    if (!["todo", "in-progress"].includes(t.status)) throw new Error(`${t.id} has status ${t.status}`);
    let result;
    try { result = work(t); } catch (e) { update(t.id, { status: "failed", error: String(e.message).slice(0, 2000) }); log("task-error", { id: t.id, error: e.message }); result = "escalated"; }
    done++;
    if (result === "ready" && flag("auto-merge")) merge(t.id);
    escalations = result === "escalated" ? escalations + 1 : 0;
    if (escalations >= MAX_ESCALATIONS_IN_A_ROW) { console.log(`Stopping: ${escalations} tasks in a row needed a human.`); break; }
    if (opt("task")) break;
  }
  console.log(`Done: ${done} task(s), ~$${spentUsd.toFixed(2)} reported by claude. Log: loop/runs/${runId}.jsonl`);
  status();
}

function status() {
  const ts = load();
  if (!ts.length) return console.log("Backlog empty. Run: node loop/orchestrator.mjs triage");
  for (const t of ts) console.log(`${t.id}  ${t.status.padEnd(17)} p${t.priority} ${t.type.padEnd(8)} ${t.title}${t.blocked ? `  — blocked: ${t.blocked}` : ""}`);
  const ready = ts.filter((t) => t.status === "ready");
  if (ready.length) console.log(`\nReady to merge: ${ready.map((t) => `node loop/orchestrator.mjs merge ${t.id}`).join(" ; ")}`);
}

const id = args[1];
switch (cmd) {
  case "status": status(); break;
  case "triage": triage(); break;
  case "run": runLoop(); break;
  case "approve": update(id, { status: "todo" }); status(); break;
  case "reject": update(id, { status: "rejected" }); status(); break;
  case "retry": update(id, { status: "todo" }); status(); break;
  case "merge": merge(id); status(); break;
  case "clean": git(["worktree", "remove", "--force", join(WT, id)]); console.log(`removed .worktrees/${id} (branch loop/${id} kept)`); break;
  default: console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 11).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
}
