// Headless AI-vs-AI playtest: runs many games in worker threads and writes balance/health metrics as JSON.
// usage: node loop/playtest.mjs [--games 48] [--minutes 25] [--out reports/playtest-<ts>.json] [--quiet]
// Pure sim (shared/sim.js), no server. Every game is deterministic: same seed + same matchup = same result.
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { cpus } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const MAPS = ["lakes", "plains", "forest", "river"];

// Matchups. "mirror" games (same difficulty) measure seat/map fairness, "ladder" games check that harder AI wins.
const MATCHUPS = [
  { name: "mirror-normal-1v1", group: "mirror", players: ["normal", "normal"] },
  { name: "mirror-hard-1v1", group: "mirror", players: ["hard", "hard"] },
  { name: "mirror-normal-ffa4", group: "mirror", players: ["normal", "normal", "normal", "normal"], minutes: 40 },
  { name: "ladder-hard-vs-normal", group: "ladder", players: ["hard", "normal"], expect: 0 },
  { name: "ladder-normal-vs-easy", group: "ladder", players: ["normal", "easy"], expect: 0 },
];

// One game. Used by the workers (metrics) and by the main thread (solo re-runs for timing).
function runGame({ createGame, step, KINDS }, job) {
  {
    const players = job.players.map((d, i) => ({ name: `P${i}`, ai: d }));
    const s = createGame({ seed: job.seed, map: job.map, players });
    const trained = {}, lost = {}, firstAttack = {};
    let maxTick = 0, at15 = null;
    // per-player state: resources, villagers, army, real buildings (walls/gates don't count), techs
    const state = () => s.players.map((p) => {
      const mine = [...s.ents.values()].filter((e) => e.owner === p.id);
      const units = mine.filter((e) => KINDS[e.kind].type === "unit");
      return { seat: p.id, ai: p.ai?.diff, alive: p.alive, res: Object.fromEntries(Object.entries(p.res).map(([k, v]) => [k, Math.round(v)])),
        villagers: units.filter((e) => e.kind === "villager").length, army: units.filter((e) => e.kind !== "villager").length,
        buildings: mine.filter((e) => KINDS[e.kind].type === "building" && !KINDS[e.kind].minor).length, techs: Object.keys(p.techs).length };
    });
    const t0 = performance.now();
    while (!s.over && s.time < job.minutes * 60) {
      const a = performance.now();
      step(s);
      if (s.tick > 50) maxTick = Math.max(maxTick, performance.now() - a); // skip JIT warm-up
      for (const e of s.events) {
        if (e.type === "unit_trained") trained[e.unit] = (trained[e.unit] ?? 0) + 1;
        else if (e.type === "unit_killed") lost[e.kind] = (lost[e.kind] ?? 0) + 1;
        else if (e.type === "attack_launched" && firstAttack[e.player] === undefined) firstAttack[e.player] = Math.round(s.time);
      }
      s.events = [];
      if (!at15 && s.time >= 15 * 60) at15 = state();
    }
    const ms = performance.now() - t0;
    return ({
      ...job, over: s.over, winner: s.winner ?? null, time: Math.round(s.time), ticks: s.tick,
      simMs: Math.round(ms), avgTickMs: +(ms / Math.max(1, s.tick)).toFixed(3), maxTickMs: +maxTick.toFixed(2),
      trained, lost, firstAttack: Object.values(firstAttack).length ? Math.min(...Object.values(firstAttack)) : null,
      players: s.players.map((p) => ({ seat: p.id, ai: p.ai?.diff, alive: p.alive, ...p.stats })),
      end: state(), at15,
    });
  }
}

if (!isMainThread) {
  const sim = await import(join(here, "..", "shared", "sim.js"));
  for (const job of workerData.jobs) parentPort.postMessage(runGame(sim, job));
  process.exit(0);
}

// ---------- main thread ----------
const arg = (name, def) => { const i = process.argv.indexOf("--" + name); return i < 0 ? def : process.argv[i + 1] ?? true; };
const perMatchup = Math.max(1, Math.round(Number(arg("games", 48)) / MATCHUPS.length));
const minutes = Number(arg("minutes", 25));
const quiet = process.argv.includes("--quiet");
const out = arg("out", join(here, "..", "reports", `playtest-${new Date().toISOString().replace(/[:.]/g, "-")}.json`));

const jobs = [];
for (const m of MATCHUPS) for (let i = 0; i < perMatchup; i++)
  jobs.push({ matchup: m.name, group: m.group, expect: m.expect, players: m.players, map: MAPS[i % MAPS.length], seed: 1000 + i * 7919, minutes: m.minutes ?? minutes });

const nWorkers = Math.min(jobs.length, Math.max(1, cpus().length - 1));
const chunks = Array.from({ length: nWorkers }, (_, w) => jobs.filter((_, i) => i % nWorkers === w));
const t0 = Date.now();
const games = (await Promise.all(chunks.map((c) => new Promise((res, rej) => {
  const got = [], w = new Worker(fileURLToPath(import.meta.url), { workerData: { jobs: c } });
  w.on("message", (g) => got.push(g)); w.on("error", rej); w.on("exit", () => res(got));
})))).flat().sort((a, b) => a.matchup.localeCompare(b.matchup) || a.seed - b.seed);

// ---------- metrics ----------
const pct = (n, d) => (d ? +(100 * n / d).toFixed(1) : null);
const median = (xs) => { const v = [...xs].sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; };
const byMatchup = {};
for (const m of MATCHUPS) {
  const gs = games.filter((g) => g.matchup === m.name), done = gs.filter((g) => g.over && g.winner !== null);
  const seatWins = m.players.map((_, i) => done.filter((g) => g.winner === i).length);
  byMatchup[m.name] = {
    games: gs.length, finished: done.length, timeouts: gs.length - done.length,
    seatWinPct: seatWins.map((w) => pct(w, done.length)),
    medianMinutes: done.length ? +(median(done.map((g) => g.time)) / 60).toFixed(1) : null,
    medianFirstAttackMin: gs.some((g) => g.firstAttack !== null) ? +(median(gs.filter((g) => g.firstAttack !== null).map((g) => g.firstAttack)) / 60).toFixed(1) : null,
    ...(m.expect !== undefined ? { expectedWinnerSeat: m.expect, expectedWinPct: pct(seatWins[m.expect], done.length) } : {}),
  };
}
const byMap = Object.fromEntries(MAPS.map((map) => {
  const gs = games.filter((g) => g.map === map), done = gs.filter((g) => g.over && g.winner !== null);
  return [map, { games: gs.length, timeouts: gs.length - done.length, medianMinutes: done.length ? +(median(done.map((g) => g.time)) / 60).toFixed(1) : null }];
}));
const trained = {}, lost = {};
for (const g of games) { for (const [k, n] of Object.entries(g.trained)) trained[k] = (trained[k] ?? 0) + n; for (const [k, n] of Object.entries(g.lost)) lost[k] = (lost[k] ?? 0) + n; }
const military = Object.entries(trained).filter(([k]) => k !== "villager"), milTotal = military.reduce((a, [, n]) => a + n, 0);
const unitShare = Object.fromEntries(military.sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, pct(n, milTotal)]));
// Timing in parallel workers is wall clock and the OS pauses threads, so a busy machine shows fake 50-200 ms ticks.
// The perf numbers therefore come from re-running the slowest games alone in this thread (same seed = same game).
const sim = await import(join(here, "..", "shared", "sim.js"));
const suspects = [...new Set([...games].sort((a, b) => b.maxTickMs - a.maxTickMs).slice(0, 3)
  .concat([...games].sort((a, b) => b.avgTickMs - a.avgTickMs).slice(0, 1)))];
const solo = suspects.map((g) => { const r = runGame(sim, jobs.find((j) => j.matchup === g.matchup && j.seed === g.seed)); return { matchup: g.matchup, map: g.map, seed: g.seed, parallelMaxTickMs: g.maxTickMs, maxTickMs: r.maxTickMs, avgTickMs: r.avgTickMs }; });
const perf = {
  avgTickMs: +(games.reduce((a, g) => a + g.avgTickMs, 0) / games.length).toFixed(3), // parallel, indicative only
  worstTickMs: Math.max(...solo.map((g) => g.maxTickMs)),
  worstGameAvgTickMs: Math.max(...solo.map((g) => g.avgTickMs)),
  parallelWorstTickMs: Math.max(...games.map((g) => g.maxTickMs)),
  solo,
};

// ---------- anomaly flags (input for the producer / balancer agents) ----------
const T = { seatSpread: 20, ladderMin: 65, timeoutPct: 20, unitMinShare: 3, unitMaxShare: 45, tickBudgetMs: 10, tickSpikeMs: 50 };
// stalemate diagnosis: what the alive players look like when a game runs out of time
const stalls = games.filter((g) => !(g.over && g.winner !== null)).map((g) => {
  const alive = g.end.filter((p) => p.alive), armies = alive.map((p) => p.army);
  return { matchup: g.matchup, map: g.map, seed: g.seed, armyRatio: armies.length > 1 ? +(Math.max(...armies) / Math.max(1, Math.min(...armies))).toFixed(1) : null,
    players: alive.map(({ seat, ai, res, villagers, army, buildings, techs }) => ({ seat, ai, res, villagers, army, buildings, techs })) };
});
// economy stuck: at 15 min an alive player sits on > 3000 of one resource and < 100 of another
const lopsided = (p) => { const v = Object.values(p.res); return p.alive && Math.max(...v) > 3000 && Math.min(...v) < 100; };
const economyStuck = games.flatMap((g) => (g.at15 ?? []).filter(lopsided).map((p) => ({ matchup: g.matchup, map: g.map, seed: g.seed, seat: p.seat, ai: p.ai, res: p.res, villagers: p.villagers, army: p.army })));

const flags = [];
for (const m of MATCHUPS) {
  const r = byMatchup[m.name];
  if (pct(r.timeouts, r.games) > T.timeoutPct) flags.push({ kind: "stalemate", matchup: m.name, detail: `${r.timeouts}/${r.games} games had no winner after ${m.minutes ?? minutes} min` });
  if (m.group === "mirror" && r.finished >= 4) {
    const spread = Math.max(...r.seatWinPct) - Math.min(...r.seatWinPct), fair = 100 / m.players.length;
    if (spread > T.seatSpread + fair * (m.players.length > 2 ? 1 : 0)) flags.push({ kind: "seat-unfair", matchup: m.name, detail: `seat win % ${r.seatWinPct.join("/")}` });
  }
  if (m.group === "ladder" && r.finished >= 4 && r.expectedWinPct < T.ladderMin) flags.push({ kind: "difficulty-order", matchup: m.name, detail: `stronger AI won only ${r.expectedWinPct}%` });
}
for (const [k, share] of Object.entries(unitShare)) {
  if (share < T.unitMinShare) flags.push({ kind: "unit-unused", unit: k, detail: `${share}% of military trained` });
  if (share > T.unitMaxShare) flags.push({ kind: "unit-dominant", unit: k, detail: `${share}% of military trained` });
}
for (const k of Object.keys(sim.KINDS))
  if (["swordsman", "spearman", "archer", "cavalry", "knight", "crossbowman", "ram"].includes(k) && !(k in unitShare)) flags.push({ kind: "unit-unused", unit: k, detail: "never trained" });
if (economyStuck.length) flags.push({ kind: "economy-stuck", detail: `${economyStuck.length} player(s) in ${new Set(economyStuck.map((e) => e.matchup + e.seed)).size} game(s) had > 3000 of one resource and < 100 of another at 15 min (see economyStuck)` });
for (const m of MATCHUPS) {
  const st = stalls.filter((x) => x.matchup === m.name && x.armyRatio !== null);
  const big = st.filter((x) => x.armyRatio >= 2);
  if (st.length >= 2 && big.length / st.length >= 0.5) flags.push({ kind: "no-finish", matchup: m.name, detail: `${big.length}/${st.length} timed-out games had one army >= 2x the other: the stronger side doesn't finish (see stalls)` });
}
if (perf.worstTickMs > T.tickSpikeMs) flags.push({ kind: "perf-spike", detail: `worst single tick ${perf.worstTickMs} ms > ${T.tickSpikeMs} ms (server tick is 100 ms)` });
if (perf.worstGameAvgTickMs > T.tickBudgetMs) flags.push({ kind: "perf", detail: `worst game avg tick ${perf.worstGameAvgTickMs} ms > ${T.tickBudgetMs} ms` });

const report = {
  createdAt: new Date().toISOString(), wallSeconds: +((Date.now() - t0) / 1000).toFixed(1), workers: nWorkers,
  config: { gamesPerMatchup: perMatchup, minutes, maps: MAPS, thresholds: T },
  byMatchup, byMap, unitShare, unitsTrained: trained, unitsLost: lost, perf, flags,
  stalls, economyStuck,
  games: games.map(({ trained, lost, players, at15, ...g }) => ({ ...g, trained })),
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 1));

if (!quiet) {
  console.log(`${games.length} games in ${report.wallSeconds}s on ${nWorkers} workers -> ${out}`);
  for (const [n, r] of Object.entries(byMatchup)) console.log(`  ${n.padEnd(24)} seats ${r.seatWinPct.join("/").padEnd(18)} median ${r.medianMinutes} min, timeouts ${r.timeouts}${r.expectedWinPct !== undefined ? `, stronger wins ${r.expectedWinPct}%` : ""}`);
  console.log("  unit share %", JSON.stringify(unitShare));
  for (const x of stalls) console.log(`  stall ${x.matchup} ${x.map} ${x.seed}: army ratio ${x.armyRatio} | ${x.players.map((p) => `${p.ai} v${p.villagers} a${p.army} b${p.buildings} F${p.res.food} W${p.res.wood} G${p.res.gold}`).join(" vs ")}`);
  if (economyStuck.length) console.log(`  economy stuck at 15 min: ${economyStuck.map((e) => `${e.ai}@${e.matchup}/${e.seed} F${e.res.food} W${e.res.wood} G${e.res.gold}`).join(", ")}`);
  console.log("  perf (solo re-runs)", JSON.stringify({ avgTickMs: perf.avgTickMs, worstTickMs: perf.worstTickMs, worstGameAvgTickMs: perf.worstGameAvgTickMs, parallelWorstTickMs: perf.parallelWorstTickMs }));
  console.log(flags.length ? `  FLAGS:\n${flags.map((f) => `    - ${f.kind}: ${f.matchup ?? f.unit ?? ""} ${f.detail}`).join("\n")}` : "  no flags");
}
console.log(JSON.stringify({ report: out, flags: flags.length }));
