// Replays depend on the simulation being deterministic: same seed + same commands at the same ticks => same game.
// Plays a game with a random "human" (random commands every few ticks) against AIs, records it, plays it back, compares.
import { createGame, step, command, gameStats, KINDS, TECHS, BUILDABLE } from "./shared/sim.js";

const players = [{ name: "Human" }, { name: "AI1", ai: "hard" }, { name: "AI2", ai: "normal" }];
const hash = (s) => JSON.stringify([...s.ents.values()].map((e) => [e.id, e.kind, e.owner, +e.x.toFixed(4), +e.y.toFixed(4), +e.hp.toFixed(3)])) + JSON.stringify(s.players.map((p) => [p.res, p.techs, p.alive]));

function live(seed, minutes, peaceful, map) {
  const s = createGame({ seed, players, peaceful, map }), rec = [];
  let r = seed; const rnd = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648); // the "human", independent of the sim
  while (!s.over && s.time < minutes * 60) {
    if (s.tick % 7 === 0) {
      const mine = [...s.ents.values()].filter((e) => e.owner === 0), units = mine.filter((e) => KINDS[e.kind].type === "unit"), bs = mine.filter((e) => KINDS[e.kind].type === "building");
      const any = [...s.ents.values()][Math.floor(rnd() * s.ents.size)];
      const pickIds = () => units.filter(() => rnd() < 0.5).map((u) => u.id);
      const opts = [
        () => ({ t: "move", ids: pickIds(), x: rnd() * 80, y: rnd() * 80 }),
        () => ({ t: "target", ids: pickIds(), id: any?.id }),
        () => ({ t: "build", ids: pickIds(), kind: BUILDABLE[Math.floor(rnd() * BUILDABLE.length)], x: Math.floor(rnd() * 80), y: Math.floor(rnd() * 80) }),
        () => { const b = bs[Math.floor(rnd() * bs.length)]; const k = b && [...(KINDS[b.kind].trains ?? []), ...(KINDS[b.kind].researches ?? [])]; return { t: "train", id: b?.id, kind: k?.[Math.floor(rnd() * k.length)] }; },
        () => ({ t: "attackMove", ids: pickIds(), x: rnd() * 80, y: rnd() * 80 }),
        () => ({ t: "stance", ids: pickIds(), kind: ["aggressive", "defensive", "stand"][Math.floor(rnd() * 3)] }),
      ];
      const c = JSON.parse(JSON.stringify(opts[Math.floor(rnd() * opts.length)]())); // through JSON, like the network
      rec.push([s.tick, 0, c]); command(s, 0, c);
    }
    step(s); s.events = [];
  }
  return { s, rec };
}
function replay(seed, rec, ticks, peaceful, map) {
  const s = createGame({ seed, players, peaceful, map }); let i = 0;
  while (s.tick < ticks && !s.over) { while (i < rec.length && rec[i][0] <= s.tick) { const [, pid, c] = rec[i++]; command(s, pid, c); } step(s); s.events = []; }
  return s;
}
let ok = true;
for (const [seed, peaceful, map] of [[11, false, "lakes"], [2024, false, "river"], [99991, false, "forest"], [5, false, "plains"], [7, true, "lakes"]]) {
  const { s, rec } = live(seed, 12, peaceful, map);
  const r = replay(seed, JSON.parse(JSON.stringify(rec)), s.tick, peaceful, map);
  const same = hash(s) === hash(r) && JSON.stringify(gameStats(s)) === JSON.stringify(gameStats(r));
  ok &&= same;
  console.log(`seed ${seed} ${map}${peaceful ? " (peaceful)" : ""}: ${rec.length} commands, ${(s.time / 60).toFixed(1)} min, techs ${Object.keys(s.players[0].techs).length}, ${same ? "replay identical" : "REPLAY DIFFERS"}`);
}
process.exit(ok ? 0 : 1);
