import { createGame, step, snapshot, popOf } from "./shared/sim.js";
const diffs = process.argv.slice(2);
const s = createGame({ seed: 12345, players: diffs.map((d, i) => ({ name: "AI" + i, ai: d })) });
const t0 = Date.now(); let evc = {};
for (let i = 0; i < 10 * 60 * 25 && !s.over; i++) {
  step(s);
  for (const e of s.events) evc[e.type] = (evc[e.type] ?? 0) + 1;
  s.events = [];
  if (i % 3000 === 0) console.log(`t=${(s.time/60).toFixed(1)}m`, s.players.map(p => { const pp = popOf(s, p.id); const vil=[...s.ents.values()].filter(e=>e.owner===p.id&&e.kind==='villager').length; const arm=pp.pop-vil; return `${p.name}:${p.alive?'':'X'} pop${pp.pop}/${pp.cap} v${vil} a${arm} F${p.res.food|0} W${p.res.wood|0} G${p.res.gold|0}`; }).join(" | "));
}
console.log("over", s.over, "winner", s.players[s.winner]?.name, "at", (s.time/60).toFixed(1), "min; sim ms", Date.now()-t0);
console.log(evc);
console.log("snapshot bytes", JSON.stringify(snapshot(s, 0)).length);
