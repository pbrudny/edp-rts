// Hard gates every change must pass before review/merge. Plain scripts, no LLM.
// usage: node loop/gates.mjs [--json]   (run from the repo root or a worktree root)
// Exit 0 = all gates green. With --json the last stdout line is {"ok":bool,"gates":[...]}.
import { spawnSync } from "node:child_process";
import { readdirSync, statSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const results = [];
const gate = (name, fn) => {
  const t0 = Date.now();
  let r;
  try { r = fn(); } catch (e) { r = { ok: false, log: String(e?.message ?? e) }; }
  results.push({ name, ok: r.ok, seconds: +((Date.now() - t0) / 1000).toFixed(1), log: r.ok ? undefined : tail(r.log) });
  console.log(`${r.ok ? "PASS" : "FAIL"} ${name} (${results.at(-1).seconds}s)`);
  if (!r.ok) console.log(indent(tail(r.log)));
};
const tail = (s = "", n = 40) => s.trim().split("\n").slice(-n).join("\n");
const indent = (s) => s.split("\n").map((l) => "    " + l).join("\n");
const run = (cmd, args, opts = {}) => {
  const p = spawnSync(cmd, args, { cwd: root, encoding: "utf8", timeout: 10 * 60_000, ...opts });
  return { ok: p.status === 0, log: (p.stdout ?? "") + (p.stderr ?? "") + (p.error ? String(p.error) : "") };
};

// 1. every JS file parses
gate("syntax", () => {
  const skip = new Set(["node_modules", "vendor", ".git", "out", "reports", "data"]);
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (skip.has(f)) continue; if (statSync(p).isDirectory()) walk(p); else if (/\.(m?js)$/.test(f)) files.push(p); } };
  walk(root);
  const bad = files.map((f) => ({ f, r: run("node", ["--check", f]) })).filter((x) => !x.r.ok);
  return { ok: !bad.length, log: bad.map((x) => x.f + "\n" + x.r.log).join("\n") };
});

// 2. existing rule tests (pure sim)
for (const t of ["test-walls.mjs", "test-army.mjs"]) gate(t, () => run("node", [t]));

// 3. determinism: recorded games must replay identically (lockstep + replays depend on it)
gate("determinism (test-replay.mjs)", () => run("node", ["test-replay.mjs"]));

// 4. headless bot matches: no crashes, tick time within budget
gate("smoke matches + perf budget", () => {
  const out = join(mkdtempSync(join(tmpdir(), "rts-gate-")), "gate.json");
  const r = run("node", ["loop/playtest.mjs", "--games", "10", "--minutes", "15", "--quiet", "--out", out]);
  if (!r.ok) return r;
  const rep = JSON.parse(readFileSync(out, "utf8"));
  const budget = 10; // ms average per tick (server ticks every 100 ms, up to many rooms per process)
  return { ok: rep.perf.worstGameAvgTickMs <= budget, log: `worst game avg tick ${rep.perf.worstGameAvgTickMs} ms (budget ${budget} ms)\n${JSON.stringify(rep.perf)}` };
});

// 5. server boots and answers HTTP
gate("server boot", () => {
  const port = 39000 + Math.floor(Math.random() * 900);
  const data = mkdtempSync(join(tmpdir(), "rts-data-"));
  const script = `
    const { spawn } = require("node:child_process");
    const p = spawn("node", ["server.js"], { cwd: ${JSON.stringify(root)}, env: { PATH: process.env.PATH, PORT: "${port}", DATA_DIR: ${JSON.stringify(data)} }, stdio: "pipe" });
    let log = ""; p.stdout.on("data", d => log += d); p.stderr.on("data", d => log += d);
    const done = (code) => { p.kill(); console.log(log); process.exit(code); };
    const t = Date.now();
    (async function poll() {
      try { const r = await fetch("http://127.0.0.1:${port}/api/lobbies"); if (r.ok) { await r.json(); return done(0); } } catch {}
      if (Date.now() - t > 8000 || p.exitCode !== null) return done(1);
      setTimeout(poll, 200);
    })();`;
  return run("node", ["-e", script], { timeout: 15_000 });
});

const ok = results.every((r) => r.ok);
console.log(ok ? "ALL GATES GREEN" : `GATES FAILED: ${results.filter((r) => !r.ok).map((r) => r.name).join(", ")}`);
if (process.argv.includes("--json")) console.log(JSON.stringify({ ok, gates: results }));
process.exit(ok ? 0 : 1);
