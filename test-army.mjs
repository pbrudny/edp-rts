// Rule checks for maps, formations and stances (pure sim, no server). usage: node test-army.mjs
import { createGame, step, command, KINDS, MAPS } from "./shared/sim.js";
let ok = true; const check = (name, cond) => { console.log((cond ? "PASS " : "FAIL ") + name); ok &&= !!cond; };
const run = (s, n) => { for (let i = 0; i < n; i++) step(s); };
const unit = (s, kind, owner, x, y) => { const e = { id: s.nextId++, kind, owner, x, y, hp: KINDS[kind].hp, order: null, path: null, cool: 0, carry: null, scan: 0, idle: 0 }; s.ents.set(e.id, e); return e; };
const avg = (us, f) => us.reduce((a, u) => a + f(u), 0) / us.length;
const P = [{ name: "A" }, { name: "B", ai: "normal" }, { name: "C", ai: "normal" }, { name: "D", ai: "normal" }];

// --- maps: every town can walk to every other town
for (const map of Object.keys(MAPS)) {
  let cut = 0, water = 0, trees = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const g = createGame({ seed, map, players: P }), W = g.w;
    const free = (x, y) => x >= 0 && y >= 0 && x < W && y < W && !g.tile[y * W + x] && !(g.wood[y * W + x] > 0) && (!g.occ[y * W + x] || g.ents.get(g.occ[y * W + x])?.kind === "tc");
    const seen = new Uint8Array(W * W), q = [[13, 14]]; seen[14 * W + 13] = 1;
    while (q.length) { const [x, y] = q.pop(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (free(nx, ny) && !seen[ny * W + nx]) { seen[ny * W + nx] = 1; q.push([nx, ny]); } } }
    for (const [sx, sy] of [[67, 67], [67, 12], [12, 67]]) if (!seen[(sy + 2) * W + sx]) cut++;
    for (let i = 0; i < W * W; i++) { water += g.tile[i]; trees += g.wood[i] > 0; }
  }
  check(`${MAPS[map]}: all towns connected on 30 seeds (water ${Math.round(water / 30)}, trees ${Math.round(trees / 30)})`, cut === 0);
}

// a clear field in the middle of an open map
function field() {
  const s = createGame({ seed: 3, map: "plains", players: [{ name: "A" }, { name: "B" }] });
  for (let y = 25; y < 55; y++) for (let x = 25; x < 55; x++) { s.tile[y * s.w + x] = 0; s.wood[y * s.w + x] = 0; }
  for (const e of [...s.ents.values()]) if (e.owner < 0 && e.x > 22 && e.x < 56 && e.y > 22 && e.y < 56) { s.ents.delete(e.id); for (let j = 0; j < e.h; j++) for (let i = 0; i < e.w; i++) s.occ[(e.y + j) * s.w + e.x + i] = 0; }
  return s;
}

// --- formation: melee in front, ranged behind, siege at the back; the group keeps pace with its slowest unit
{
  const s = field(), army = [];
  for (let i = 0; i < 4; i++) army.push(unit(s, "archer", 0, 30.5 + i * 0.6, 30.5), unit(s, "swordsman", 0, 30.5 + i * 0.6, 31.5));
  const ram = unit(s, "ram", 0, 31.5, 32.5); army.push(ram);
  command(s, 0, { t: "move", ids: army.map((u) => u.id), x: 48, y: 40 });
  const dir = [48 - 31, 40 - 31], n = Math.hypot(...dir), ahead = (u) => ((u.order?.x ?? u.x) * dir[0] + (u.order?.y ?? u.y) * dir[1]) / n;
  const sw = army.filter((u) => u.kind === "swordsman"), ar = army.filter((u) => u.kind === "archer");
  check(`formation: swordsmen in front, archers behind, ram at the back (${avg(sw, ahead).toFixed(1)} > ${avg(ar, ahead).toFixed(1)} > ${ahead(ram).toFixed(1)})`, Math.min(...sw.map(ahead)) > Math.max(...ar.map(ahead)) && Math.min(...ar.map(ahead)) > ahead(ram));
  run(s, 30);
  const spread = Math.max(...army.map((u) => Math.hypot(u.x - ram.x, u.y - ram.y)));
  check(`group marches together at ram pace (spread ${spread.toFixed(1)} tiles after 3 s)`, spread < 5);
  run(s, 400);
  check("everyone arrived", army.every((u) => !u.order && Math.hypot(u.x - 48, u.y - 40) < 4));
  const solo = unit(s, "cavalry", 0, 30.5, 30.5); command(s, 0, { t: "move", ids: [solo.id], x: 45, y: 30.5 }); run(s, 20);
  check("single unit moves at its own speed", solo.x - 30.5 > 5);
}

// --- stances
{
  const s = field();
  const a = unit(s, "archer", 0, 30.5, 40.5), d = unit(s, "swordsman", 0, 30.5, 44.5), g = unit(s, "swordsman", 0, 30.5, 36.5);
  command(s, 0, { t: "stance", ids: [a.id], kind: "stand" });
  command(s, 0, { t: "stance", ids: [d.id], kind: "defensive" });
  check("stance set on soldiers only", a.stance === "stand" && d.stance === "defensive" && !g.stance);
  const foe = unit(s, "villager", 1, 36.8, 40.5); foe.hp = 9999; // in sight (7) but out of range (5) of the archer
  run(s, 20);
  check(`stand ground: archer stays put when the enemy is out of range (moved ${Math.hypot(a.x - 30.5, a.y - 40.5).toFixed(2)})`, Math.hypot(a.x - 30.5, a.y - 40.5) < 0.3);
  foe.x = 34; run(s, 30);
  check("stand ground: archer shoots once the enemy is in range", a.order?.type === "attack" && a.cool > 0 && Math.hypot(a.x - 30.5, a.y - 40.5) < 0.3);
  check("aggressive (default): swordsman chases the enemy in sight", Math.hypot(g.x - 30.5, g.y - 36.5) > 1);
  // defensive: chase, then come back when the enemy runs off
  const s2 = field(), dd = unit(s2, "swordsman", 0, 30.5, 40.5), runner = unit(s2, "villager", 1, 35.5, 40.5); runner.hp = 9999;
  command(s2, 0, { t: "stance", ids: [dd.id], kind: "defensive" });
  run(s2, 15);
  check("defensive: soldier goes after an enemy nearby", Math.hypot(dd.x - 30.5, dd.y - 40.5) > 1);
  runner.order = { type: "move", x: 52, y: 40.5 }; run(s2, 150);
  check(`defensive: gives up and walks back (${Math.hypot(dd.x - 30.5, dd.y - 40.5).toFixed(1)} tiles from start)`, Math.hypot(dd.x - 30.5, dd.y - 40.5) < 1.5);
  const s3 = field(), ag = unit(s3, "swordsman", 0, 30.5, 40.5), r3 = unit(s3, "villager", 1, 35.5, 40.5); r3.hp = 9999;
  run(s3, 15); r3.order = { type: "move", x: 52, y: 40.5 }; run(s3, 150);
  check("aggressive: keeps chasing", ag.x > 40);
  command(s, 1, { t: "stance", ids: [a.id], kind: "aggressive" });
  check("can't set the stance of someone else's units", a.stance === "stand");
}
process.exit(ok ? 0 : 1);
