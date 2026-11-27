#!/usr/bin/env node
// Multi-agent dev loop for Ember Realms. Plain Node, no deps; agents run through `claude -p --agent <name>`.
//
//   node loop/orchestrator.mjs status                     backlog overview
//   node loop/orchestrator.mjs triage [-n|--count 3] [--note ".."] playtest -> producer -> new tasks in backlog/tasks.jsonl
//   node loop/orchestrator.mjs run [--max-tasks 1] [--task T001] [--auto-merge] [--triage]
//   node loop/orchestrator.mjs approve T003 | reject T003 | retry T003
//   node loop/orchestrator.mjs merge T003                  merge a "ready"/"partial-ready" branch into the current branch (local only)
//   node loop/orchestrator.mjs review T003                 gates + reviewer + commit for uncommitted work left in a task's worktree
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
  builder: { type: "object", required: ["status", "summary", "files_changed", "tests", "unmet", "follow_ups"], properties: {
    status: { enum: ["done", "partial", "blocked"], description: "done = all acceptance criteria met; partial = gates green and the change is a net improvement worth keeping, but some criteria are not met; blocked = nothing worth keeping (revert your edits)" },
    summary: { type: "string" }, files_changed: { type: "array", items: { type: "string" } }, tests: { type: "string" },
    unmet: { type: "array", items: { type: "string" }, description: "acceptance criteria not met, each with the measured value" },
    blocked: { type: ["string", "null"], description: "why the task can't be (fully) done as specified; null if done" },
    follow_ups: { type: "array", description: "new tasks you recommend, e.g. the real cause of an unmet criterion", items: { type: "object", required: ["title", "type", "spec", "acceptance", "evidence"], properties: {
      title: { type: "string" }, type: { enum: ["balance", "ai", "bugfix", "perf", "feature", "test"] }, spec: { type: "string" },
      acceptance: { type: "array", items: { type: "string" } }, evidence: { type: "string" } } } } } },
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
// Minimal schema check: required keys present, enum values valid, arrays are arrays (enough to catch an agent inventing its own format).
function schemaErrors(schema, v, path = "") {
  if (schema.enum) return schema.enum.includes(v) ? [] : [`${path || "value"} must be one of ${schema.enum.join("|")}`];
  if (schema.type === "array") return Array.isArray(v) ? (schema.items ? v.flatMap((x, i) => schemaErrors(schema.items, x, `${path}[${i}]`)) : []) : [`${path} must be an array`];
  if (schema.type === "object") {
    if (!v || typeof v !== "object" || Array.isArray(v)) return [`${path || "answer"} must be an object`];
    return [...(schema.required ?? []).filter((k) => !(k in v)).map((k) => `missing key ${path ? path + "." : ""}${k}`),
      ...Object.entries(schema.properties ?? {}).filter(([k]) => k in v && v[k] !== null).flatMap(([k, sub]) => schemaErrors(sub, v[k], path ? `${path}.${k}` : k))];
  }
  return [];
}
function callClaude(name, prompt, cwd) {
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
  return { data, res };
}
function agent(name, prompt, cwd) {
  const t0 = Date.now();
  const full = `${prompt}\n\n---\nEnd your answer with one JSON object (no code fence) matching this JSON Schema exactly, using these key names:\n${JSON.stringify(SCHEMAS[name])}`;
  let { data, res } = callClaude(name, full, cwd), errs = data ? schemaErrors(SCHEMAS[name], data) : ["no JSON found"];
  if (errs.length) { // one retry, resuming the same session so the agent doesn't redo the work
    log("agent-format-retry", { name, errors: errs.join("; ") });
    const retry = sh("claude", ["-p", `Your final JSON did not match the schema: ${errs.join("; ")}. Reply with only the corrected JSON object for the same work, matching:\n${JSON.stringify(SCHEMAS[name])}`,
      "--resume", res.session_id, "--output-format", "json", "--strict-mcp-config", "--allowedTools", "Read"], cwd, { timeout: 10 * 60_000 });
    try { let rr = JSON.parse(retry.out); if (Array.isArray(rr)) rr = rr.findLast((m) => m.type === "result") ?? {}; spentUsd += rr.total_cost_usd ?? 0;
      const m = String(rr.result ?? "").match(/\{[\s\S]*\}/); data = m ? JSON.parse(m[0]) : null; } catch { data = null; }
    errs = data ? schemaErrors(SCHEMAS[name], data) : ["no JSON found"];
    if (errs.length) throw new Error(`${name}: answer still does not match the schema: ${errs.join("; ")}`);
  }
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

const taskTextOf = (t) => `Task ${t.id}: ${t.title}\nType: ${t.type}\n\nSpec:\n${t.spec}\n\nAcceptance criteria:\n${t.acceptance.map((a) => "- " + a).join("\n")}\n\nEvidence: ${t.evidence}` +
  (t.report ? `\nPlaytest report it is based on: ${t.report}` : "") + (t.files_hint?.length ? `\nLikely files: ${t.files_hint.join(", ")}` : "");
const hasChanges = (dir) => !!sh("git", ["status", "--porcelain", "--", ".", ":!reports", ":!node_modules"], dir).out;

const words = (t) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3));
const overlap = (a, b) => { const A = words(a), B = words(b); return [...A].filter((w) => B.has(w)).length / Math.max(1, Math.min(A.size, B.size)); };
const openTasks = (ts = load()) => ts.filter((t) => !["merged", "rejected"].includes(t.status));
function addFollowUps(parent, items = []) {
  if (!items.length) return [];
  const all = load(), ids = [];
  for (const f of items) {
    const dup = openTasks(all).find((t) => t.id !== parent.id && overlap(t.title + " " + t.spec, f.title + " " + f.spec) >= 0.6);
    if (dup) { console.log(`  = follow-up "${f.title}" skipped: looks like ${dup.id}`); log("follow-up-duplicate", { parent: parent.id, title: f.title, dup: dup.id }); continue; }
    const task = { id: nextId(all), title: f.title, type: f.type, spec: f.spec, acceptance: f.acceptance, evidence: f.evidence,
      priority: parent.priority, needs_approval: f.type === "feature", status: f.type === "feature" ? "awaiting-approval" : "todo",
      parent: parent.id, createdAt: new Date().toISOString() };
    all.push(task); ids.push(task.id);
    console.log(`  + follow-up ${task.id} [${task.type}] ${task.title}`);
  }
  save(all);
  log("follow-ups", { parent: parent.id, ids: ids.join(",") });
  return ids;
}

// gates are green and there are changes: reviewer decides; approved -> commit on the task branch.
// Returns "ready" | "partial-ready" | { blocking } (review rejected).
function reviewAndCommit(t, built, dir, role) {
  const partial = built.status === "partial";
  const verdict = agent("reviewer", `${taskTextOf(t)}\n\nBuilder status: ${built.status}\nBuilder summary: ${built.summary}\nTests: ${built.tests}` +
    (built.metrics ? `\nBalance metrics before/after: ${JSON.stringify(built.metrics)}` : "") +
    (partial ? `\n\nThis is a PARTIAL result. Acceptance criteria not met:\n${(built.unmet ?? []).map((u) => "- " + u).join("\n")}\nWhy: ${built.blocked ?? ""}\n` +
      `Approve only if the change is correct, safe and a clear net improvement on its own, so it is worth merging while the rest becomes follow-up tasks. Unmet criteria alone are not a reason to block.` : "") +
    `\n\nThe gates (syntax, rule tests, determinism replay, smoke matches + perf budget, server boot) are green. Review the uncommitted diff in this worktree (git diff) against main.`, dir);
  if (!verdict.approve) return { blocking: verdict.blocking };
  git(["add", "-A"], dir); // reports/ and node_modules are gitignored
  git(["commit", "-m", `${t.id}: ${t.title}${partial ? " (partial)" : ""}\n\n${built.summary}` +
    (partial ? `\n\nNot met: ${(built.unmet ?? []).join("; ")}` : "") + `\n\nAutomated loop: ${role} + reviewer, gates green.`], dir);
  const followUps = addFollowUps(t, built.follow_ups);
  const st = partial ? "partial-ready" : "ready";
  update(t.id, { status: st, summary: built.summary, unmet: built.unmet, nits: verdict.nits, metrics: built.metrics, followUps });
  log("task-" + st, { id: t.id, branch: t.branch ?? `loop/${t.id}` });
  return st;
}

function work(t) {
  const { dir, branch } = worktree(t);
  update(t.id, { status: "in-progress", branch });
  log("task-start", { id: t.id, title: t.title, branch });
  const role = t.type === "balance" ? "balancer" : "builder";
  const others = openTasks().filter((x) => x.id !== t.id);
  const taskText = taskTextOf(t) + (others.length ? `\n\nOther open backlog tasks (don't propose follow-ups that duplicate these, and don't do their work here):\n${others.map((x) => `- ${x.id} [${x.type}] ${x.title}`).join("\n")}` : "");
  let feedback = t.reviewNotes ? `A previous attempt was rejected by review:\n${t.reviewNotes}` : "";

  for (let review = 1; review <= MAX_REVIEW_ROUNDS; review++) {
    let g = null, built = null;
    for (let round = 1; round <= MAX_BUILD_ROUNDS; round++) {
      built = agent(role, `${taskText}${feedback ? `\n\nFix this first:\n${feedback}` : ""}`, dir);
      update(t.id, { lastBuild: built });
      if (built.status === "blocked" || !hasChanges(dir)) {
        update(t.id, { status: "blocked", blocked: built.blocked ?? "no changes" });
        log("task-blocked", { id: t.id, why: built.blocked });
        addFollowUps(t, built.follow_ups);
        return "escalated";
      }
      g = gates(dir);
      log("gates", { id: t.id, round, ok: g.ok });
      if (g.ok) break;
      feedback = `The gates failed (node loop/gates.mjs):\n${gateFeedback(g)}`;
    }
    if (!g.ok) { update(t.id, { status: "failed", lastGateLog: gateFeedback(g).slice(-4000) }); return "escalated"; }

    const r = reviewAndCommit(t, built, dir, role);
    if (typeof r === "string") return r === "ready" ? "ready" : "escalated"; // partial needs a human look before merging
    feedback = `Code review blocked the change:\n${r.blocking.map((b) => "- " + b).join("\n")}`;
    update(t.id, { reviewNotes: feedback });
    log("review-blocked", { id: t.id, review });
  }
  update(t.id, { status: "review-failed" });
  return "escalated";
}

// Resume a task whose worktree has uncommitted builder work (e.g. blocked/failed after edits): gates -> reviewer -> commit.
function reviewOnly(id) {
  const t = load().find((x) => x.id === id);
  if (!t?.lastBuild) throw new Error(`${id} has no lastBuild (builder output) to review`);
  const { dir } = worktree(t);
  if (!hasChanges(dir)) throw new Error(`.worktrees/${id} has no uncommitted changes`);
  const built = { ...t.lastBuild, status: t.lastBuild.status === "done" ? "done" : "partial" };
  const g = gates(dir);
  log("gates", { id, ok: g.ok });
  if (!g.ok) { update(id, { status: "failed", lastGateLog: gateFeedback(g).slice(-4000) }); return console.log(gateFeedback(g)); }
  const r = reviewAndCommit(t, built, dir, t.type === "balance" ? "balancer" : "builder");
  if (typeof r !== "string") { update(id, { status: "review-failed", reviewNotes: (r.blocking ?? []).join("\n") }); console.log("Review blocked:\n" + r.blocking.map((b) => "- " + b).join("\n")); }
}

function merge(id) {
  const t = load().find((x) => x.id === id);
  if (!["ready", "partial-ready"].includes(t?.status)) throw new Error(`${id} is not ready (status ${t?.status})`);
  const dirty = sh("git", ["status", "--porcelain", "--untracked-files=no"]).out.split("\n").filter((l) => l && !l.endsWith("backlog/tasks.jsonl"));
  if (dirty.length) throw new Error("main working tree has uncommitted changes; commit or stash them first:\n" + dirty.join("\n"));
  git(["merge", "--no-ff", t.branch, "-m", `Merge ${t.branch}: ${t.title}`]);
  update(id, { status: "merged" });
  git(["add", "backlog/tasks.jsonl"]);
  if (sh("git", ["diff", "--cached", "--quiet"]).status === 1) git(["commit", "-m", `backlog: ${id} merged`]);
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
    const t = opt("task") ? ts.find((x) => x.id === opt("task")) : ts.filter((x) => x.status === "todo" && (x.dependsOn ?? []).every((d) => ts.find((y) => y.id === d)?.status === "merged")).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))[0];
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
  for (const t of ts) console.log(`${t.id}  ${t.status.padEnd(17)} p${t.priority} ${t.type.padEnd(8)} ${t.title}${t.unmet?.length && t.status === "partial-ready" ? `  — not met: ${t.unmet.join("; ").slice(0, 140)}` : ""}${t.blocked && t.status === "blocked" ? `  — blocked: ${t.blocked.replace(/\s+/g, " ").slice(0, 140)}…` : ""}`);
  const ready = ts.filter((t) => t.status === "ready" || t.status === "partial-ready");
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
  case "review": reviewOnly(id); console.log(`~$${spentUsd.toFixed(2)} reported by claude`); status(); break;
  case "clean": git(["worktree", "remove", "--force", join(WT, id)]); console.log(`removed .worktrees/${id} (branch loop/${id} kept)`); break;
  default: console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 12).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
}
