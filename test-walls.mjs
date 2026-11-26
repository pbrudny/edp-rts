// Rule checks for walls, gates, breaching, ages and the market (pure sim, no server). usage: node test-walls.mjs
import { createGame, step, command, passCost, canPlace, KINDS } from "./shared/sim.js";
let ok = true; const check = (name, cond) => { console.log((cond ? "PASS " : "FAIL ") + name); ok &&= !!cond; };
const run = (s, n) => { for (let i = 0; i < n; i++) step(s); };
const unit = (s, kind, owner, x, y) => { const e = { id: s.nextId++, kind, owner, x, y, hp: KINDS[kind].hp, order: null, path: null, cool: 0, carry: null, scan: 0, idle: 0 }; s.ents.set(e.id, e); return e; };
const all = (s, kind, owner) => [...s.ents.values()].filter((e) => e.kind === kind && (owner === undefined || e.owner === owner));

// --- walls ring + gate + breach
const s = createGame({ seed: 5, players: [{ name: "A" }, { name: "B" }] });
Object.assign(s.players[1].res, { food: 5000, wood: 5000, gold: 5000 });
const tc = all(s, "tc", 1)[0], cx = tc.x + 1, cy = tc.y + 1, r = 6, vills = () => all(s, "villager", 1).map((e) => e.id);
const corners = [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]];
for (let i = 0; i < 4; i++) { const [a, b] = [corners[i], corners[(i + 1) % 4]]; command(s, 1, { t: "wall", ids: vills(), x: a[0], y: a[1], x2: b[0], y2: b[1] }); run(s, 1200); }
check(`wall ring built (${all(s, "wall").length} pieces)`, all(s, "wall").length >= 44 && all(s, "wall").every((w) => w.built >= 1));
command(s, 1, { t: "build", ids: vills(), kind: "gate", x: cx, y: cy - r }); run(s, 400);
const gate = all(s, "gate")[0];
check("gate replaces a wall piece", gate?.built >= 1 && gate.x === cx && gate.y === cy - r);
check("gate: open for owner, closed for enemy, breachable by enemy soldiers", passCost(s, cx, cy - r, 1) === 0 && passCost(s, cx, cy - r, 0) === Infinity && passCost(s, cx, cy - r, 0, true) > 0);
const v = s.ents.get(vills()[0]); command(s, 1, { t: "move", ids: [v.id], x: cx + 0.5, y: cy - r - 4 }); run(s, 300);
check("own villager walks out through the gate", v.y < cy - r);
const sw = []; for (let i = 0; i < 6; i++) sw.push(unit(s, "swordsman", 0, cx - r - 4 + (i % 2) + 0.5, cy + (i >> 1) + 0.5));
command(s, 0, { t: "target", ids: sw.map((e) => e.id), id: tc.id });
const w0 = all(s, "wall").length; let hit = false;
for (let n = 0; n < 1500 && !hit; n++) { step(s); hit = tc.hp < KINDS.tc.hp; }
check(`enemy swordsmen break through the wall (${w0 - all(s, "wall").length} broken) and reach the town centre`, hit && all(s, "wall").length < w0);
// --- ages and market
const g = createGame({ seed: 7, players: [{ name: "A" }, { name: "B", team: 0 }, { name: "C" }] });
const p = g.players[0]; Object.assign(p.res, { food: 3000, wood: 3000, gold: 3000 });
const spot = (kind, cx, cy) => { for (let r = 3; r < 15; r++) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (canPlace(g, kind, cx + i, cy + j) && canPlace(g, "house", cx + i - 1, cy + j - 1)) return { x: cx + i, y: cy + j }; };
const build = (kind) => { const at = spot(kind, gtc.x + 1, gtc.y + 1); command(g, 0, { t: "build", ids: gv(), kind, ...at }); };
const gv = () => all(g, "villager", 0).map((e) => e.id), gtc = all(g, "tc", 0)[0];
build("market");
check("market locked in Village Age", !all(g, "market").length);
command(g, 0, { t: "train", id: gtc.id, kind: "castle" }); run(g, 5);
check("Castle Age needs barracks + storehouse", !gtc.queue.includes("castle"));
build("barracks"); run(g, 700);
build("storehouse"); run(g, 500);
command(g, 0, { t: "train", id: gtc.id, kind: "castle" }); run(g, 520);
check("advanced to Castle Age", !!p.techs.castle);
build("market"); run(g, 900);
const mk = all(g, "market", 0)[0];
check("market built in Castle Age", mk?.built >= 1);
const gold0 = p.res.gold; command(g, 0, { t: "trade", id: mk.id, res: "wood", buy: true });
check("buy 100 wood for 100 gold, price rises", p.res.gold === gold0 - 100 && p.market.wood > 100);
const food0 = g.players[1].res.food; command(g, 0, { t: "tribute", id: mk.id, to: 1, res: "food" });
check("tribute to ally arrives minus 20%", g.players[1].res.food === food0 + 80);
const enemyFood = g.players[2].res.food; command(g, 0, { t: "tribute", id: mk.id, to: 2, res: "food" });
check("no tribute to enemies", g.players[2].res.food === enemyFood);
const bk = all(g, "barracks", 0)[0]; command(g, 0, { t: "train", id: bk.id, kind: "knight" }); run(g, 240);
check("knight trained in Castle Age", all(g, "knight", 0).length === 1);
process.exit(ok ? 0 : 1);
