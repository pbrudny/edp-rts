// Ember Realms: deterministic-ish RTS simulation shared by server (authoritative) and client (constants, placement checks).
// Coordinates are in tiles. Units: float centre (x, y). Buildings/resources: integer top-left (x, y) + size (w, h).

export const TICK = 0.1;
export const MAP = 80;
export const CARRY = 10;
export const MAX_POP = 60;
export const COLORS = ["#3b82f6", "#ef4444", "#eab308", "#a855f7"];
export const RES = ["food", "wood", "gold"];

// armor = against melee, pierce = against arrows (archers, town centres). bonus = extra damage against a kind (or "building").
export const KINDS = {
  villager:  { type: "unit", hp: 25, atk: 3, range: 0.9, cd: 1.5, speed: 2.3, armor: 0, pierce: 0, cost: { food: 50 }, time: 10, sight: 6 },
  swordsman: { type: "unit", hp: 65, atk: 8, range: 0.9, cd: 1.2, speed: 2.0, armor: 1, pierce: 1, cost: { food: 60, gold: 20 }, time: 14, sight: 6, bonus: { spearman: 4, building: 3 } },
  spearman:  { type: "unit", hp: 45, atk: 4, range: 0.9, cd: 1.3, speed: 2.1, armor: 0, pierce: 0, cost: { food: 35, wood: 25 }, time: 10, sight: 6, bonus: { cavalry: 11, knight: 12, ram: 4 } },
  archer:    { type: "unit", hp: 35, atk: 5, range: 5, cd: 1.6, speed: 2.2, armor: 0, pierce: 0, cost: { wood: 30, gold: 40 }, time: 14, sight: 7, bonus: { spearman: 3 } },
  cavalry:   { type: "unit", hp: 110, atk: 7, range: 0.9, cd: 1.3, speed: 3.3, armor: 1, pierce: 2, cost: { food: 80, gold: 60 }, time: 18, sight: 8, bonus: { archer: 6, crossbowman: 5, ram: 10 } },
  knight:    { type: "unit", hp: 150, atk: 10, range: 0.9, cd: 1.3, speed: 3.1, armor: 2, pierce: 2, cost: { food: 80, gold: 85 }, time: 22, sight: 8, bonus: { archer: 6, crossbowman: 5, ram: 12 }, age: 2 },
  crossbowman: { type: "unit", hp: 40, atk: 6, range: 5.5, cd: 1.8, speed: 2.1, armor: 0, pierce: 1, cost: { wood: 35, gold: 45 }, time: 16, sight: 7, bonus: { spearman: 3 }, age: 2 },
  ram:       { type: "unit", hp: 200, atk: 60, range: 0.9, cd: 3, speed: 1.2, armor: 0, pierce: 8, cost: { wood: 160, gold: 70 }, time: 24, sight: 5, siege: true },
  tc:         { type: "building", w: 3, h: 3, hp: 1400, pop: 5, drop: ["food", "wood", "gold"], atk: 5, range: 7, cd: 2, trains: ["villager"], researches: ["wheelbarrow", "castle"], time: 60, cost: { wood: 400, gold: 150 } },
  house:      { type: "building", w: 2, h: 2, hp: 350, pop: 5, cost: { wood: 30 }, time: 12 },
  barracks:   { type: "building", w: 3, h: 3, hp: 700, cost: { wood: 150 }, time: 30, trains: ["swordsman", "spearman", "archer", "cavalry", "knight", "crossbowman"] },
  storehouse: { type: "building", w: 2, h: 2, hp: 450, drop: ["wood", "gold"], cost: { wood: 100 }, time: 18, researches: ["axes", "mining"] },
  farm:       { type: "building", w: 2, h: 2, hp: 120, cost: { wood: 60 }, time: 10, food: 300 },
  workshop:   { type: "building", w: 3, h: 3, hp: 650, cost: { wood: 175, gold: 50 }, time: 35, trains: ["ram"], researches: ["forging", "fletching", "chainmail"], age: 2 },
  market:     { type: "building", w: 3, h: 3, hp: 600, cost: { wood: 175 }, time: 35, age: 2 },
  // walls and gates are "minor": they don't keep a player alive. Arrows barely scratch them; rams and swordsmen break them
  wall:       { type: "building", w: 1, h: 1, hp: 300, armor: 3, pierce: 10, cost: { wood: 8 }, time: 4, minor: true },
  gate:       { type: "building", w: 1, h: 1, hp: 450, armor: 3, pierce: 10, cost: { wood: 30 }, time: 10, minor: true },
  tower:      { type: "building", w: 2, h: 2, hp: 700, armor: 2, pierce: 6, atk: 6, range: 7, cd: 1.5, cost: { wood: 100, gold: 100 }, time: 40, age: 2 },
  gold:    { type: "resource", w: 2, h: 2, amount: 800, res: "gold" },
  berries: { type: "resource", w: 1, h: 1, amount: 150, res: "food" },
};
export const BUILDABLE = ["house", "farm", "storehouse", "barracks", "wall", "gate", "workshop", "tower", "market"];
export const AGES = ["", "Village Age", "Castle Age"];

// upgrades: researched once per player in a building's queue, like training a unit (no population needed)
export const TECHS = {
  forging:     { name: "Forging", desc: "+2 attack for swordsmen, spearmen and cavalry", cost: { food: 150, gold: 100 }, time: 30 },
  fletching:   { name: "Fletching", desc: "+1 attack and +1 range for archers, crossbowmen, towers and town centres", cost: { food: 100, wood: 50, gold: 75 }, time: 30 },
  chainmail:   { name: "Chain mail", desc: "+1 armour and +1 arrow armour for soldiers", cost: { food: 150, gold: 150 }, time: 40 },
  wheelbarrow: { name: "Wheelbarrow", desc: "Villagers carry 15 instead of 10 and walk 10% faster", cost: { food: 150, wood: 75 }, time: 30 },
  axes:        { name: "Double-bit axe", desc: "+20% wood gathering", cost: { food: 100, wood: 50 }, time: 20 },
  mining:      { name: "Gold mining", desc: "+20% gold gathering", cost: { food: 100, wood: 75 }, time: 20 },
  castle:      { name: "Castle Age", desc: "Advance to the Castle Age: Workshop, Tower, Market, Knight and Crossbowman. Needs a Barracks and a Storehouse.", cost: { food: 400, gold: 200 }, time: 50, needs: ["barracks", "storehouse"] },
};
// ages: 1 = Village Age, 2 = Castle Age (researched at the town centre)
export const ageOf = (techs) => (techs?.castle ? 2 : 1);
const needAge = (item) => (KINDS[item] ?? TECHS[item])?.age ?? 1;
// can player p start this unit / building / upgrade now? (age and required buildings)
export function unlocked(s, pid, item) {
  const p = s.players[pid]; if (!p) return false;
  if (needAge(item) > ageOf(p.techs)) return false;
  for (const need of TECHS[item]?.needs ?? []) if (![...s.ents.values()].some((e) => e.owner === pid && e.kind === need && e.built >= 1)) return false;
  return true;
}
// market: gold price of 100 food / wood. Buying raises it, selling lowers it; selling pays 75%
export const MARKET = { start: 100, step: 6, min: 30, max: 300, sellCut: 0.75, tributeCut: 0.2 };
const MELEE = ["swordsman", "spearman", "cavalry", "knight"], SOLDIERS = ["swordsman", "spearman", "archer", "cavalry", "knight", "crossbowman"], ARROWS = ["archer", "crossbowman", "tc", "tower"];
export const costOf = (item) => (KINDS[item] ?? TECHS[item]).cost;
export const timeOf = (item) => (KINDS[item] ?? TECHS[item]).time;
// a unit/building stat after the owner's upgrades (`techs` = { techId: 1 })
export function stat(techs, kind, key) {
  let v = KINDS[kind][key] ?? 0;
  const has = (t) => !!techs?.[t];
  if (key === "atk") { if (has("forging") && MELEE.includes(kind)) v += 2; if (has("fletching") && ARROWS.includes(kind)) v += 1; }
  if (key === "range" && has("fletching") && ARROWS.includes(kind)) v += 1;
  if ((key === "armor" || key === "pierce") && has("chainmail") && SOLDIERS.includes(kind)) v += 1;
  if (key === "speed" && has("wheelbarrow") && kind === "villager") v *= 1.1;
  return v;
}
const carryOf = (p) => (p.techs.wheelbarrow ? 15 : CARRY);
const RATE = { berries: 0.9, farm: 0.6, wood: 0.75, gold: 0.65 };
const FARM_CAP = 2; // AI: villagers per farm
const REBALANCE = { every: 10, rich: 1000, poor: 150, move: 3 }; // AI: every 10 s, > 1000 of one resource and < 150 of another moves up to 3 gatherers
const DIFF = { easy: { gather: 0.75, wave: 10, think: 2.0 }, normal: { gather: 1.0, wave: 7, think: 1.0 }, hard: { gather: 1.3, wave: 6, think: 0.6 } };

// ------------------------------------------------------------------ helpers

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const idx = (s, x, y) => y * s.w + x;
const inside = (s, x, y) => x >= 0 && y >= 0 && x < s.w && y < s.h;
export const isUnit = (e) => KINDS[e.kind].type === "unit";
export const isBuilding = (e) => KINDS[e.kind].type === "building";
export const isResource = (e) => KINDS[e.kind].type === "resource";
const centre = (e) => (isUnit(e) ? { x: e.x, y: e.y } : { x: e.x + e.w / 2, y: e.y + e.h / 2 });

export function distToRect(px, py, r) {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
  const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
  return Math.hypot(dx, dy);
}
function distTo(u, e) {
  return isUnit(e) ? Math.hypot(u.x - e.x, u.y - e.y) : distToRect(u.x, u.y, e);
}
export function blocked(s, x, y) {
  if (!inside(s, x, y)) return true;
  const i = idx(s, x, y);
  return s.tile[i] === 1 || s.wood[i] > 0 || s.occ[i] !== 0;
}
export function canPlace(s, kind, x, y) {
  const k = KINDS[kind];
  for (let j = 0; j < k.h; j++) for (let i = 0; i < k.w; i++) if (blocked(s, x + i, y + j)) return false;
  return true;
}
function setOcc(s, e, v) {
  for (let j = 0; j < e.h; j++) for (let i = 0; i < e.w; i++) s.occ[idx(s, e.x + i, e.y + j)] = v;
}
function nearestFree(s, x, y) {
  const fx = Math.floor(x), fy = Math.floor(y);
  for (let r = 0; r < 12; r++)
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
      if (!blocked(s, fx + i, fy + j)) return { x: fx + i + 0.5, y: fy + j + 0.5 };
    }
  return { x, y };
}

// ------------------------------------------------------------------ path finding (A*, 8 directions, no corner cutting)

const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
// cost of stepping on a tile for `owner`: 0 free, Infinity blocked, BREACH = enemy wall/gate a soldier would have to break
const BREACH = 14;
export function passCost(s, x, y, owner = -1, breach = false) {
  if (!inside(s, x, y)) return Infinity;
  const i = idx(s, x, y);
  if (s.tile[i] === 1 || s.wood[i] > 0) return Infinity;
  const o = s.occ[i]; if (!o) return 0;
  const e = s.ents.get(o);
  if (e?.kind === "gate" && owner >= 0 && allies(s, owner, e.owner)) return 0;
  if (breach && (e?.kind === "wall" || e?.kind === "gate") && enemies(s, owner, e.owner)) return BREACH;
  return Infinity;
}
function astar(s, sx, sy, isGoal, hx, hy, maxNodes = 5000, owner = -1, breach = false) {
  const N = s.w * s.h;
  if (!s._g) { s._g = new Float32Array(N); s._came = new Int32Array(N); s._seen = new Int32Array(N); s._closed = new Int32Array(N); s._stamp = 0; }
  const g = s._g, came = s._came, seen = s._seen, closed = s._closed, stamp = ++s._stamp;
  const h = (x, y) => { const dx = Math.abs(x - hx), dy = Math.abs(y - hy); return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy); };
  const heap = []; // [f, i]
  const push = (f, i) => { heap.push([f, i]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  const start = idx(s, sx, sy);
  g[start] = 0; seen[start] = stamp; came[start] = -1; push(h(sx, sy), start);
  let best = start, bestH = h(sx, sy), n = 0;
  while (heap.length && n++ < maxNodes) {
    const [, cur] = pop();
    if (closed[cur] === stamp) continue;
    closed[cur] = stamp;
    const cx = cur % s.w, cy = (cur / s.w) | 0;
    if (isGoal(cx, cy)) return build(cur);
    const hc = h(cx, cy); if (hc < bestH) { bestH = hc; best = cur; }
    for (const [dx, dy, c] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      const pc = passCost(s, nx, ny, owner, breach);
      if (pc === Infinity) continue;
      if (dx && dy && (passCost(s, cx + dx, cy, owner) > 0 || passCost(s, cx, cy + dy, owner) > 0)) continue;
      const ni = idx(s, nx, ny), ng = g[cur] + c + pc;
      if (seen[ni] === stamp && ng >= g[ni]) continue;
      seen[ni] = stamp; g[ni] = ng; came[ni] = cur; push(ng + h(nx, ny), ni);
    }
  }
  return best !== start ? build(best) : null; // partial path towards the goal
  function build(i) {
    const path = [];
    while (i !== start && i !== -1) { path.push({ x: (i % s.w) + 0.5, y: ((i / s.w) | 0) + 0.5 }); i = came[i]; }
    return path.reverse();
  }
}

// ------------------------------------------------------------------ world creation

// teams: players on the same team are allies (no attacks, shared vision, they win together).
// peaceful = everyone is allied: nobody can attack anyone, the game ends when the human players leave
export const allies = (s, a, b) => a === b || s.peaceful || (a >= 0 && b >= 0 && s.players[a]?.team === s.players[b]?.team);
export const enemies = (s, a, b) => a >= 0 && b >= 0 && !allies(s, a, b);

// map types: same starts and resources, different terrain
export const MAPS = { lakes: "Lakes", plains: "Open plains", forest: "Black forest", river: "River crossing" };
export function createGame({ seed = Date.now() % 1e9, players, peaceful = false, map = "lakes" }) {
  if (!MAPS[map]) map = "lakes";
  const R = rng(seed);
  const s = {
    seed, map, peaceful: !!peaceful, rand: rng(seed ^ 0x5bd1e995), w: MAP, h: MAP, tick: 0, time: 0, nextId: 1, over: false, winner: null, timeline: [],
    tile: new Uint8Array(MAP * MAP), wood: new Float32Array(MAP * MAP), occ: new Int32Array(MAP * MAP),
    ents: new Map(), events: [], fx: [], treeChanges: [],
    players: players.map((p, i) => ({ id: i, name: p.name, color: COLORS[i], team: Number.isInteger(p.team) ? p.team : i, ai: p.ai ? { diff: p.ai, think: 0, wave: 0 } : null,
      res: { food: 200, wood: 200, gold: 100 }, alive: true, techs: {},
      stats: { trained: 0, villagers: 0, military: 0, killed: 0, lost: 0, gathered: 0, food: 0, wood: 0, gold: 0, built: 0, techs: 0 } })),
  };
  // free for all: opposite corners first. With teams, teammates get neighbouring corners
  const teams = s.players.map((p) => p.team);
  let starts = [[12, 12], [67, 67], [67, 12], [12, 67]].slice(0, players.length);
  if (new Set(teams).size < teams.length) {
    const ring = [[12, 12], [67, 12], [67, 67], [12, 67]], order = s.players.map((p) => p.id).sort((a, b) => teams[a] - teams[b] || a - b);
    starts = []; order.forEach((pid, n) => (starts[pid] = ring[n]));
  }
  const nearStart = (x, y, r) => starts.some(([sx, sy]) => Math.hypot(x - sx, y - sy) < r);
  const blob = (cx, cy, r, fn) => { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (inside(s, x, y) && Math.hypot(x - cx, y - cy) <= r * (0.75 + R() * 0.35)) fn(idx(s, x, y), x, y); };
  const forest = (n, r0, r1, keep) => { for (let i = 0; i < n; i++) { const cx = (R() * MAP) | 0, cy = (R() * MAP) | 0; if (!nearStart(cx, cy, keep)) blob(cx, cy, r0 + ((R() * (r1 - r0 + 1)) | 0), (i) => { if (!s.tile[i]) s.wood[i] = 100; }); } };
  const homeWood = (n) => { for (const [sx, sy] of starts) for (let m = 0; m < n; m++) { const a = R() * Math.PI * 2; blob(Math.round(sx + Math.cos(a) * 10), Math.round(sy + Math.sin(a) * 10), 3, (i) => { if (!s.tile[i]) s.wood[i] = 100; }); } };
  const clearLine = (x0, y0, x1, y1, r) => { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0)); for (let t = 0; t <= n; t++) { const x = x0 + ((x1 - x0) * t) / n, y = y0 + ((y1 - y0) * t) / n; for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (inside(s, Math.round(x + i), Math.round(y + j))) s.wood[idx(s, Math.round(x + i), Math.round(y + j))] = 0; } };
  if (map === "lakes") {
    for (let n = 0; n < 4; n++) { const cx = 15 + ((R() * 50) | 0), cy = 15 + ((R() * 50) | 0); if (!nearStart(cx, cy, 16)) blob(cx, cy, 3 + ((R() * 3) | 0), (i) => (s.tile[i] = 1)); }
    forest(26, 2, 5, 9); homeWood(1);
  } else if (map === "plains") { // wide open: few small woods, nowhere to hide
    forest(12, 2, 3, 10); homeWood(2);
  } else if (map === "forest") { // thick woods with a few cut paths between the towns and the centre
    forest(70, 3, 6, 11); homeWood(1);
    const mid = MAP / 2; for (const [sx, sy] of starts) { const bend = (R() - 0.5) * 16; clearLine(sx, sy, (sx + mid) / 2 + bend, (sy + mid) / 2 - bend, 2); clearLine((sx + mid) / 2 + bend, (sy + mid) / 2 - bend, mid, mid, 2); }
    blob(mid, mid, 6, (i) => (s.wood[i] = 0));
  } else if (map === "river") { // a river splits north from south; three fords cross it
    const ph = R() * 6.28, fords = [10 + ((R() * 6) | 0), 37 + ((R() * 6) | 0), 63 + ((R() * 6) | 0)];
    const ry = (x) => MAP / 2 + 3.5 * Math.sin(x * 0.11 + ph);
    for (let x = 0; x < MAP; x++) { if (fords.some((f) => Math.abs(x - f) <= 2)) continue; for (let y = 0; y < MAP; y++) if (Math.abs(y + 0.5 - ry(x)) < 2.4) s.tile[idx(s, x, y)] = 1; }
    forest(24, 2, 4, 9); homeWood(1);
    for (const f of fords) for (let x = f - 4; x <= f + 4; x++) for (let y = Math.floor(ry(f)) - 6; y <= Math.ceil(ry(f)) + 6; y++) if (inside(s, x, y)) s.wood[idx(s, x, y)] = 0;
  }
  // map border trees
  for (let i = 0; i < MAP; i++) for (const [x, y] of [[i, 0], [i, MAP - 1], [0, i], [MAP - 1, i]]) s.wood[idx(s, x, y)] = 100;
  // clear starts
  for (const [sx, sy] of starts) blob(sx, sy, 7, (i) => { s.tile[i] = 0; s.wood[i] = 0; });

  const place = (kind, x, y, owner = -1) => {
    const k = KINDS[kind];
    if (!canPlace(s, kind, x, y)) return null;
    const e = { id: s.nextId++, kind, owner, x, y, w: k.w, h: k.h, hp: k.hp ?? 1 };
    if (k.type === "resource") e.amount = k.amount;
    if (k.type === "building") { e.built = 1; e.queue = []; e.prog = 0; e.cool = 0; if (k.food) e.food = k.food; }
    s.ents.set(e.id, e); setOcc(s, e, e.id); return e;
  };
  const placeNear = (kind, cx, cy, minR, maxR) => {
    for (let t = 0; t < 60; t++) { const a = R() * Math.PI * 2, r = minR + R() * (maxR - minR); const e = place(kind, Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r)); if (e) return e; }
    return null;
  };
  starts.forEach(([sx, sy], pid) => {
    place("tc", sx - 1, sy - 1, pid);
    for (let n = 0; n < 3; n++) spawnUnit(s, "villager", pid, sx + (n - 1) * 1.2, sy + 2.5);
    const bx = sx + (sx < 40 ? 5 : -5), by = sy + (sy < 40 ? -3 : 3);
    for (let n = 0; n < 6; n++) place("berries", bx + (n % 3), by + ((n / 3) | 0));
    placeNear("gold", sx, sy, 6, 8); placeNear("gold", sx, sy, 10, 13);
  });
  for (let n = 0; n < 8; n++) placeNear("gold", MAP / 2, MAP / 2, 4, 30);
  for (let n = 0; n < 6; n++) { const c = placeNear("berries", MAP / 2, MAP / 2, 6, 30); if (c) for (let m = 0; m < 3; m++) place("berries", c.x + 1 + m % 2, c.y + (m >> 1)); }
  s.events.push({ type: "game_started", players: s.players.map((p) => ({ name: p.name, ai: p.ai?.diff ?? null })), seed });
  return s;
}

function spawnUnit(s, kind, owner, x, y) {
  const k = KINDS[kind];
  const p = nearestFree(s, x, y);
  const e = { id: s.nextId++, kind, owner, x: p.x, y: p.y, hp: k.hp, order: null, path: null, cool: 0, carry: null, scan: 0, idle: 0 };
  s.ents.set(e.id, e);
  return e;
}

// ------------------------------------------------------------------ commands (validated: players can only command their own entities)

export function command(s, pid, c) {
  if (s.over || !s.players[pid]?.alive) return;
  const mine = (id) => { const e = s.ents.get(id); return e && e.owner === pid ? e : null; };
  const units = (c.ids ?? []).map(mine).filter((e) => e && isUnit(e));
  const p = s.players[pid];
  switch (c.t) {
    case "move": case "attackMove": { // formation: melee in front, ranged behind, siege and villagers at the back, facing the march
      const n = units.length;
      if (n === 1) { setOrder(units[0], { type: c.t, x: c.x, y: c.y }); break; }
      const cx = units.reduce((a, u) => a + u.x, 0) / n, cy = units.reduce((a, u) => a + u.y, 0) / n;
      let dx = c.x - cx, dy = c.y - cy; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len; if (len < 0.5) { dx = 1; dy = 0; }
      const rank = (u) => { const k = KINDS[u.kind]; return u.kind === "villager" || k.siege ? 2 : k.range > 2 ? 1 : 0; };
      const order = [...units].sort((a, b) => rank(a) - rank(b) || a.id - b.id);
      const cols = Math.max(2, Math.ceil(Math.sqrt(n * 2))), gap = 1.1, slot = []; // each kind of troop starts its own row
      let row = 0; for (let i = 0; i < n; ) { const r = rank(order[i]); let j = i; while (j < n && rank(order[j]) === r && j - i < cols) j++; for (let m = i; m < j; m++) slot[m] = [row, m - i, j - i]; row++; i = j; }
      const rows = row;
      // together: a group that starts close marches at the pace of its slowest member
      const close = units.every((u) => Math.hypot(u.x - cx, u.y - cy) < 8);
      const gs = close ? Math.min(...units.map((u) => stat(p.techs, u.kind, "speed"))) : undefined;
      order.forEach((u, i) => {
        const [r, c0, inRow] = slot[i], col = c0 - (inRow - 1) / 2;
        const back = (r - (rows - 1) / 2) * gap;
        const x = Math.max(0.5, Math.min(s.w - 0.5, c.x - dx * back - dy * col * gap)), y = Math.max(0.5, Math.min(s.h - 0.5, c.y - dy * back + dx * col * gap));
        setOrder(u, { type: c.t, x, y, gs });
      });
      break;
    }
    case "stance": { // aggressive (default): chase anything in sight; defensive: chase a little, then go back; stand: never move to fight
      const st = ["aggressive", "defensive", "stand"].includes(c.kind) ? c.kind : null; if (!st) return;
      for (const u of units) if (u.kind !== "villager") { u.stance = st === "aggressive" ? undefined : st; if (u.order?.auto) setOrder(u, u.prev ?? null); }
      break;
    }
    case "target": {
      const t = s.ents.get(c.id); if (!t) return;
      for (const u of units) {
        if (enemies(s, pid, t.owner) && !(KINDS[u.kind].siege && isUnit(t))) setOrder(u, { type: "attack", id: t.id });
        else if (u.kind === "villager" && isBuilding(t) && t.owner === pid && t.built < 1) setOrder(u, { type: "build", id: t.id });
        else if (u.kind === "villager" && (isResource(t) || (t.kind === "farm" && t.owner === pid))) setOrder(u, { type: "gather", id: t.id });
        else if (u.kind === "villager" && isBuilding(t) && t.owner === pid && u.carry) setOrder(u, { type: "return", drop: t.id });
        else setOrder(u, { type: "move", x: t.x + (t.w ?? 0) / 2, y: t.y + (t.h ?? 0) / 2 });
      }
      break;
    }
    case "tree": {
      if (!inside(s, c.x, c.y) || s.wood[idx(s, c.x, c.y)] <= 0) return;
      // a tree deep inside a forest can't be reached: use the nearest tree on the forest edge instead
      const v = units.find((u) => u.kind === "villager");
      const target = exposedTree(s, c.x, c.y) ? { x: c.x, y: c.y } : v ? nearestResource(s, v, "wood", c.x + 0.5, c.y + 0.5, 6) : null;
      if (!target) return;
      for (const u of units) if (u.kind === "villager") setOrder(u, { type: "tree", x: target.x, y: target.y });
      break;
    }
    case "build": {
      const k = KINDS[c.kind];
      if (!BUILDABLE.includes(c.kind) || !units.some((u) => u.kind === "villager") || !unlocked(s, pid, c.kind)) return;
      if (c.kind === "gate" && inside(s, c.x, c.y)) { // a gate can replace one of your own wall pieces
        const w = s.ents.get(s.occ[idx(s, c.x, c.y)]);
        if (w?.kind === "wall" && w.owner === pid && afford(p, k.cost)) { s.ents.delete(w.id); setOcc(s, w, 0); }
      }
      if (!afford(p, k.cost) || !canPlace(s, c.kind, c.x, c.y)) return;
      pay(p, k.cost);
      const b = { id: s.nextId++, kind: c.kind, owner: pid, x: c.x, y: c.y, w: k.w, h: k.h, hp: Math.ceil(k.hp * 0.1), built: 0, queue: [], prog: 0, cool: 0 };
      if (k.food) b.food = k.food;
      s.ents.set(b.id, b); setOcc(s, b, b.id);
      for (const e of s.ents.values()) if (isUnit(e) && distToRect(e.x, e.y, b) === 0) { const f = nearestFree(s, e.x, e.y); e.x = f.x; e.y = f.y; e.path = null; }
      for (const u of units) if (u.kind === "villager") { setOrder(u, { type: "build", id: b.id }); u.buildQueue = null; }
      s.events.push({ type: "building_placed", player: p.name, building: c.kind });
      break;
    }
    case "wall": { // a line of wall pieces from (x, y) to (x2, y2), max 24 long, built one after another
      const vills = units.filter((u) => u.kind === "villager");
      if (!vills.length || !inside(s, c.x, c.y) || !inside(s, c.x2, c.y2)) return;
      const ids = [];
      for (const [x, y] of line(c.x, c.y, c.x2, c.y2).slice(0, 24)) {
        if (!afford(p, KINDS.wall.cost)) break;
        if (!canPlace(s, "wall", x, y)) continue;
        pay(p, KINDS.wall.cost);
        const b = { id: s.nextId++, kind: "wall", owner: pid, x, y, w: 1, h: 1, hp: Math.ceil(KINDS.wall.hp * 0.1), built: 0, queue: [], prog: 0, cool: 0 };
        s.ents.set(b.id, b); setOcc(s, b, b.id); ids.push(b.id);
      }
      if (!ids.length) return;
      for (const e of s.ents.values()) if (isUnit(e) && s.occ[idx(s, Math.floor(e.x), Math.floor(e.y))] && ids.includes(s.occ[idx(s, Math.floor(e.x), Math.floor(e.y))])) { const f = nearestFree(s, e.x, e.y); e.x = f.x; e.y = f.y; e.path = null; }
      vills.forEach((u, n) => { const mine = ids.slice(n % ids.length).concat(ids.slice(0, n % ids.length)); setOrder(u, { type: "build", id: mine[0] }); u.buildQueue = mine.slice(1); });
      s.events.push({ type: "building_placed", player: p.name, building: "wall", pieces: ids.length });
      break;
    }
    case "trade": { // market: buy or sell 100 food/wood for gold
      const m = mine(c.id), res = c.res;
      if (!m || m.kind !== "market" || m.built < 1 || (res !== "food" && res !== "wood")) return;
      p.market ??= { food: MARKET.start, wood: MARKET.start };
      const price = p.market[res];
      if (c.buy) { if (p.res.gold < price) return; p.res.gold -= price; p.res[res] += 100; p.market[res] = Math.min(MARKET.max, price + MARKET.step); }
      else { if (p.res[res] < 100) return; p.res[res] -= 100; p.res.gold += Math.floor(price * MARKET.sellCut); p.market[res] = Math.max(MARKET.min, price - MARKET.step); }
      s.events.push({ type: "market_trade", player: p.name, res, buy: !!c.buy, price });
      break;
    }
    case "tribute": { // send 100 of a resource to an ally (20% lost on the way); needs a market
      const m = mine(c.id), to = s.players[c.to], res = c.res;
      if (!m || m.kind !== "market" || m.built < 1 || !to?.alive || c.to === pid || !allies(s, pid, c.to) || !RES.includes(res) || p.res[res] < 100) return;
      p.res[res] -= 100; to.res[res] += 100 * (1 - MARKET.tributeCut);
      p.stats.sent = (p.stats.sent ?? 0) + 100;
      s.events.push({ type: "tribute", player: p.name, to: to.name, res, amount: 100 });
      break;
    }
    case "train": { // a unit, or an upgrade (research)
      const b = mine(c.id);
      if (!b || !isBuilding(b) || b.built < 1 || b.queue.length >= 5) return;
      const kb = KINDS[b.kind];
      if (TECHS[c.kind]) { if (!(kb.researches ?? []).includes(c.kind) || p.techs[c.kind] || researching(s, pid, c.kind)) return; }
      else if (!(kb.trains ?? []).includes(c.kind)) return;
      if (!unlocked(s, pid, c.kind)) return;
      if (!afford(p, costOf(c.kind))) return;
      pay(p, costOf(c.kind)); b.queue.push(c.kind);
      break;
    }
    case "cancel": {
      const b = mine(c.id);
      if (!b || !b.queue?.length) return;
      const kind = b.queue.pop(); if (b.queue.length === 0) b.prog = 0;
      refund(p, costOf(kind));
      break;
    }
    case "rally": { const b = mine(c.id); if (b && isBuilding(b)) b.rally = { x: c.x, y: c.y }; break; }
    case "stop": for (const u of units) setOrder(u, null); break;
    case "resign": defeat(s, pid, "resigned"); break;
  }
}
// tiles on the line from a to b (8-connected: diagonal walls still block, units can't cut corners)
export function line(x0, y0, x1, y1) {
  const out = [], dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  for (;;) { out.push([x, y]); if (x === x1 && y === y1) break; const e2 = 2 * err; if (e2 > -dy) { err -= dy; x += sx; } if (e2 < dx) { err += dx; y += sy; } }
  return out;
}
export const researching = (s, pid, tech) => [...s.ents.values()].some((e) => e.owner === pid && e.queue?.includes(tech));
const afford = (p, cost) => Object.entries(cost).every(([r, v]) => p.res[r] >= v);
const pay = (p, cost) => { for (const [r, v] of Object.entries(cost)) p.res[r] -= v; };
const refund = (p, cost) => { for (const [r, v] of Object.entries(cost)) p.res[r] += v; };
function setOrder(u, o) { if (o?.type !== "build") u.buildQueue = null; u.order = o; u.stuck = 0; u.path = null; u.pathKey = null; if (o?.type !== "return" && o?.type !== "gather" && o?.type !== "tree") u.resume = null; }

// ------------------------------------------------------------------ simulation step

export function popOf(s, pid) {
  let pop = 0, cap = 0;
  for (const e of s.ents.values()) {
    if (e.owner !== pid) continue;
    if (isUnit(e)) pop++;
    else if (isBuilding(e) && e.built >= 1) cap += KINDS[e.kind].pop ?? 0;
  }
  return { pop, cap: Math.min(cap, MAX_POP) };
}

export function step(s) {
  if (s.over) return;
  s.tick++; s.time += TICK; s.fx = []; s.treeChanges = [];
  for (const p of s.players) if (p.ai && p.alive) runAI(s, p);
  const pops = s.players.map((p) => popOf(s, p.id));
  for (const e of [...s.ents.values()]) {
    if (e.hp <= 0) continue;
    if (isUnit(e)) updateUnit(s, e);
    else if (isBuilding(e)) updateBuilding(s, e, pops);
  }
  separate(s);
  if (s.tick % 100 === 0) sample(s);
  // deaths
  for (const e of [...s.ents.values()]) {
    if (e.hp > 0 && !(isResource(e) && e.amount <= 0) && !(e.kind === "farm" && e.food <= 0)) continue;
    s.ents.delete(e.id);
    if (!isUnit(e)) setOcc(s, e, 0);
    if (e.hp <= 0 && e.owner >= 0) {
      const killer = s.players[e.lastHitBy];
      if (killer) killer.stats.killed++;
      s.players[e.owner].stats.lost++;
      s.events.push({ type: isUnit(e) ? "unit_killed" : "building_destroyed", player: s.players[e.owner].name, kind: e.kind, by: killer?.name ?? null });
    }
  }
  for (const p of s.players) if (p.alive && ![...s.ents.values()].some((e) => e.owner === p.id && isBuilding(e) && !KINDS[e.kind].minor)) defeat(s, p.id, "no buildings left");
  const alive = s.players.filter((p) => p.alive), aliveTeams = new Set(alive.map((p) => p.team));
  if (s.peaceful) { // no winner: over once every human has left or ended the game
    if (!s.players.some((p) => p.alive && !p.ai)) { s.over = true; s.winner = null; sample(s); s.events.push({ type: "game_over", winner: null, minutes: +(s.time / 60).toFixed(1) }); }
  } else if (aliveTeams.size <= 1 && s.players.length > 1) { // one team left standing (its defeated members win too)
    s.over = true; s.winner = alive[0]?.id ?? null; s.winTeam = alive[0]?.team ?? null; sample(s);
    s.events.push({ type: "game_over", winner: alive.map((p) => p.name).join(" & ") || null, minutes: +(s.time / 60).toFixed(1) });
  }
}

// one point per player every 10 s for the end-of-game charts: [villagers, army, food, wood, gold gathered so far]
function sample(s) {
  const n = s.players.map(() => [0, 0]);
  for (const e of s.ents.values()) if (e.owner >= 0 && isUnit(e)) n[e.owner][e.kind === "villager" ? 0 : 1]++;
  s.timeline.push({ t: Math.round(s.time), p: s.players.map((p, i) => [n[i][0], n[i][1], p.stats.food, p.stats.wood, p.stats.gold]) });
}
export function gameStats(s) {
  return { time: Math.round(s.time), winner: s.winner, winTeam: s.winTeam ?? null, peaceful: s.peaceful, players: s.players.map((p) => ({ name: p.name, color: p.color, team: p.team, ai: p.ai?.diff ?? null, alive: p.alive, ...p.stats, techs: Object.keys(p.techs) })), timeline: s.timeline };
}

function defeat(s, pid, reason) {
  const p = s.players[pid]; if (!p.alive) return;
  p.alive = false;
  for (const e of [...s.ents.values()]) if (e.owner === pid && isUnit(e)) { s.ents.delete(e.id); }
  s.events.push({ type: "player_defeated", player: p.name, reason });
}

function updateBuilding(s, b, pops) {
  const k = KINDS[b.kind];
  if (b.built < 1) return;
  const p = s.players[b.owner];
  if (b.queue.length) {
    const { pop, cap } = pops[b.owner], item = b.queue[0], tech = TECHS[item];
    if (tech || b.prog > 0 || pop < cap) {
      b.prog += TICK;
      if (b.prog >= timeOf(item)) {
        b.queue.shift(); b.prog = 0;
        if (tech) {
          p.techs[item] = 1; p.stats.techs++;
          s.events.push({ type: "tech_researched", player: p.name, tech: item });
        } else {
          pops[b.owner].pop++;
          const u = spawnUnit(s, item, b.owner, b.x + b.w / 2, b.y + b.h + 0.5);
          p.stats.trained++; p.stats[item === "villager" ? "villagers" : "military"]++;
          if (b.rally) setOrder(u, { type: item === "villager" ? "move" : "attackMove", x: b.rally.x, y: b.rally.y });
          s.events.push({ type: "unit_trained", player: p.name, unit: item });
        }
      }
    }
  }
  if (k.atk) {
    b.cool -= TICK;
    if (b.cool <= 0) {
      const t = nearestEnemy(s, b.owner, b.x + b.w / 2, b.y + b.h / 2, stat(p.techs, b.kind, "range"), true);
      if (t) { hit(s, b, t, stat(p.techs, b.kind, "atk")); b.cool = k.cd; s.fx.push([b.x + b.w / 2, b.y + b.h / 2, t.x, t.y]); }
    }
  }
}

function nearestEnemy(s, owner, x, y, range, unitsOnly = false, buildingsOnly = false) {
  let best = null, bd = range;
  for (const e of s.ents.values()) {
    if (!enemies(s, owner, e.owner) || e.hp <= 0 || !s.players[e.owner]?.alive) continue;
    if ((unitsOnly && !isUnit(e)) || (buildingsOnly && isUnit(e))) continue;
    let d = isUnit(e) ? Math.hypot(e.x - x, e.y - y) : distToRect(x, y, e) + 1.5; // prefer units over buildings
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function hit(s, a, t, atk) {
  const ka = KINDS[a.kind];
  const ranged = isBuilding(a) || ka.range > 2;
  const bonus = (ka.bonus?.[t.kind] ?? 0) + (isBuilding(t) ? ka.bonus?.building ?? 0 : 0);
  const def = stat(s.players[t.owner]?.techs, t.kind, ranged ? "pierce" : "armor");
  t.hp -= Math.max(1, atk + bonus - def);
  t.lastHitBy = a.owner;
  if (isUnit(t) && t.kind !== "villager" && !KINDS[t.kind].siege && !t.order) setOrder(t, { type: "attack", id: a.id });
}

function dropsite(s, u, res) {
  let best = null, bd = Infinity;
  for (const e of s.ents.values()) {
    if (e.owner !== u.owner || !isBuilding(e) || e.built < 1 || !(KINDS[e.kind].drop ?? []).includes(res)) continue;
    const d = distToRect(u.x, u.y, e); if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function exposedTree(s, x, y) { // has at least one walkable neighbour
  for (const [dx, dy] of DIRS) if (!blocked(s, x + dx, y + dy)) return true;
  return false;
}
function nearestResource(s, u, res, x, y, r = 12) {
  if (res === "wood") {
    let best = null, bd = r;
    const cx = Math.floor(x), cy = Math.floor(y);
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      const tx = cx + i, ty = cy + j;
      if (!inside(s, tx, ty) || s.wood[idx(s, tx, ty)] <= 0 || tx === 0 || ty === 0 || tx === s.w - 1 || ty === s.h - 1 || !exposedTree(s, tx, ty)) continue;
      const d = Math.hypot(i, j); if (d < bd) { bd = d; best = { x: tx, y: ty }; }
    }
    return best ? { type: "tree", ...best } : null;
  }
  let best = null, bd = r;
  for (const e of s.ents.values()) {
    const ok = res === "food" ? e.kind === "berries" || (e.kind === "farm" && e.owner === u.owner && e.built >= 1) : e.kind === res;
    if (!ok) continue;
    const d = distToRect(x, y, e); if (d < bd) { bd = d; best = e; }
  }
  return best ? { type: "gather", id: best.id } : null;
}

// Walks towards a goal; returns true when within `range`.
function approach(s, u, goal, range) {
  const d = goal.rect ? distToRect(u.x, u.y, goal.rect) : Math.hypot(u.x - goal.x, u.y - goal.y);
  if (d <= range) { u.path = null; return true; }
  const key = goal.rect ? `r${goal.rect.x},${goal.rect.y}` : `p${Math.floor(goal.x)},${Math.floor(goal.y)}`;
  if (!u.path || u.pathKey !== key || (u.repath -= TICK) <= 0) {
    const gx = goal.rect ? goal.rect.x + goal.rect.w / 2 : goal.x, gy = goal.rect ? goal.rect.y + goal.rect.h / 2 : goal.y;
    const isGoal = goal.rect
      ? (x, y) => distToRect(x + 0.5, y + 0.5, goal.rect) <= Math.max(range - 0.1, 0.75)
      : (x, y) => Math.hypot(x + 0.5 - goal.x, y + 0.5 - goal.y) <= Math.max(range, 0.75);
    u.path = astar(s, Math.floor(u.x), Math.floor(u.y), isGoal, Math.floor(gx), Math.floor(gy), 5000, u.owner, u.kind !== "villager") ?? [];
    u.pathKey = key; u.repath = goal.moving ? 1 : 4;
    const tx = Math.floor(u.x), ty = Math.floor(u.y);
    if (!u.path.length && goal.rect && isGoal(tx, ty)) u.path = [{ x: tx + 0.5, y: ty + 0.5 }]; // on the goal tile but out of range: step to its centre
    if (!u.path.length) { u.stuck = (u.stuck ?? 0) + 1; return false; }
  }
  if (!u.path.length) return false;
  let budget = Math.min(stat(s.players[u.owner].techs, u.kind, "speed"), u.order?.gs ?? Infinity) * TICK;
  while (budget > 0 && u.path.length) {
    const n = u.path[0];
    const pc = passCost(s, Math.floor(n.x), Math.floor(n.y), u.owner, u.kind !== "villager");
    if (pc === BREACH) { // an enemy wall or gate is in the way: break it, then carry on
      const w = s.ents.get(s.occ[idx(s, Math.floor(n.x), Math.floor(n.y))]);
      if (!KINDS[u.kind].atk) { u.path = null; break; }
      const cur = u.order; u.prev = cur?.type === "attack" && cur.auto ? u.prev : cur; u.order = { type: "attack", id: w.id, auto: true, breach: true }; u.path = null;
      break;
    }
    if (pc === Infinity) { u.path = null; break; }
    const dx = n.x - u.x, dy = n.y - u.y, dist = Math.hypot(dx, dy);
    if (dist <= budget) { u.x = n.x; u.y = n.y; u.path.shift(); budget -= dist; }
    else { u.x += (dx / dist) * budget; u.y += (dy / dist) * budget; budget = 0; }
    u.face = Math.atan2(dy, dx);
  }
  u.moving = true;
  return false;
}

function updateUnit(s, u) {
  const k = KINDS[u.kind];
  const o = u.order;
  u.cool -= TICK; u.moving = false; u.anim = null;
  if (passCost(s, Math.floor(u.x), Math.floor(u.y), u.owner) === Infinity) { const f = nearestFree(s, u.x, u.y); u.x = f.x; u.y = f.y; u.path = null; } // pushed into a building: step out
  const p = s.players[u.owner];
  const mult = p.ai ? DIFF[p.ai.diff].gather : 1;
  const carry = carryOf(p), range = stat(p.techs, u.kind, "range");

  // military: auto-acquire targets (rams only look for buildings)
  if (u.kind !== "villager" && (!o || o.type === "attackMove") && (u.scan -= TICK) <= 0) {
    u.scan = 0.5;
    const hold = u.stance === "stand" && (!o || o.type !== "attackMove");
    const t = nearestEnemy(s, u.owner, u.x, u.y, hold ? range : k.sight, false, !!k.siege);
    if (t) {
      u.prev = o ?? (u.stance === "defensive" ? { type: "move", x: u.x, y: u.y } : null);
      u.order = { type: "attack", id: t.id, auto: true }; u.path = null;
      if (hold) u.order.hold = true;
      if (u.stance === "defensive") { u.order.ax = u.x; u.order.ay = u.y; }
    }
  }
  if (!u.order) { u.idle += TICK; return; }
  u.idle = 0;
  const ord = u.order;

  switch (ord.type) {
    case "move":
      if (approach(s, u, { x: ord.x, y: ord.y }, 0.3) || u.stuck > 3) { u.order = null; u.stuck = 0; }
      break;
    case "attackMove":
      if (approach(s, u, { x: ord.x, y: ord.y }, 0.8) || u.stuck > 3) { u.order = null; u.stuck = 0; }
      break;
    case "attack": {
      const t = s.ents.get(ord.id);
      const leash = t && (ord.hold ? distTo(u, t) > range + 0.3 : ord.ax !== undefined && distTo({ x: ord.ax, y: ord.ay }, t) > 7);
      if (!t || t.hp <= 0 || (k.siege && isUnit(t)) || !enemies(s, u.owner, t.owner) || (u.kind !== "villager" && ord.auto && distTo(u, t) > k.sight + 3) || (ord.auto && leash)) { u.order = u.prev ?? null; u.prev = null; u.path = null; break; }
      const goal = isUnit(t) ? { x: t.x, y: t.y, moving: true } : { rect: t };
      if (ord.hold ? distTo(u, t) <= range : approach(s, u, goal, range)) {
        u.anim = "attack"; u.face = Math.atan2(centre(t).y - u.y, centre(t).x - u.x);
        if (u.cool <= 0) { hit(s, u, t, stat(p.techs, u.kind, "atk")); u.cool = k.cd; if (range > 2) s.fx.push([u.x, u.y, centre(t).x, centre(t).y]); }
      }
      break;
    }
    case "build": {
      const b = s.ents.get(ord.id);
      if (b && b.built < 1 && u.stuck > 8) { u.order = null; u.stuck = 0; break; } // can't reach it
      if (!b || b.built >= 1) u.order = b?.kind === "farm" && !u.buildQueue?.length ? { type: "gather", id: b.id } : null;
      else if (approach(s, u, { rect: b }, 1.0)) {
        u.anim = "build";
        const kb = KINDS[b.kind];
        b.built = Math.min(1, b.built + TICK / kb.time);
        b.hp = Math.min(kb.hp, b.hp + (kb.hp * 0.9 * TICK) / kb.time);
        if (b.built >= 1) {
          s.events.push({ type: "building_completed", player: p.name, building: b.kind }); p.stats.built++;
          u.order = b.kind === "farm" ? { type: "gather", id: b.id } : null;
        }
      }
      if (u.order?.type !== "build" || s.ents.get(u.order.id)?.built >= 1) { // next piece of a wall line
        while (u.buildQueue?.length) { const n = s.ents.get(u.buildQueue.shift()); if (n && n.owner === u.owner && n.built < 1) { u.order = { type: "build", id: n.id }; u.path = null; break; } }
      }
      break;
    }
    case "gather": case "tree": {
      const res = ord.type === "tree" ? "wood" : s.ents.get(ord.id) ? (KINDS[s.ents.get(ord.id).kind].res ?? "food") : null;
      if (u.carry && (u.carry.type !== res || u.carry.amt >= carry)) { u.resume = ord; u.order = { type: "return" }; break; }
      if (ord.type === "tree") {
        const i = idx(s, ord.x, ord.y);
        if (s.wood[i] <= 0 || (u.stuck > 2 && !exposedTree(s, ord.x, ord.y))) { const n = nearestResource(s, u, "wood", ord.x, ord.y, 8); u.order = n; u.path = null; u.stuck = 0; break; }
        if (approach(s, u, { rect: { x: ord.x, y: ord.y, w: 1, h: 1 } }, 1.0)) {
          u.anim = "gather"; u.face = Math.atan2(ord.y + 0.5 - u.y, ord.x + 0.5 - u.x);
          const amt = RATE.wood * mult * (p.techs.axes ? 1.2 : 1) * TICK;
          u.carry = { type: "wood", amt: (u.carry?.amt ?? 0) + amt };
          s.wood[i] -= amt;
          if (s.wood[i] <= 0) { s.wood[i] = 0; s.treeChanges.push(i); }
        }
      } else {
        const t = s.ents.get(ord.id);
        if (!t || (t.amount ?? t.food) <= 0 || (t.kind === "farm" && t.built < 1)) {
          const n = nearestResource(s, u, res ?? "food", u.x, u.y, 10); u.order = n; u.path = null; break;
        }
        if (approach(s, u, { rect: t }, 1.0)) {
          u.anim = "gather"; u.face = Math.atan2(t.y + t.h / 2 - u.y, t.x + t.w / 2 - u.x);
          const amt = RATE[t.kind === "farm" ? "farm" : t.kind === "berries" ? "berries" : "gold"] * mult * (t.kind === "gold" && p.techs.mining ? 1.2 : 1) * TICK;
          u.carry = { type: res, amt: (u.carry?.amt ?? 0) + amt };
          if (t.kind === "farm") t.food -= amt; else t.amount -= amt;
        }
      }
      if (u.carry?.amt >= carry) { u.resume = u.order; u.order = { type: "return" }; }
      break;
    }
    case "return": {
      if (!u.carry) { u.order = u.resume; u.resume = null; break; }
      const d = ord.drop ? s.ents.get(ord.drop) : dropsite(s, u, u.carry.type);
      if (!d || !(KINDS[d.kind].drop ?? []).includes(u.carry.type)) { if (ord.drop) { u.order = { type: "return" }; break; } u.order = null; break; }
      if (approach(s, u, { rect: d }, 1.0)) {
        const amt = Math.floor(u.carry.amt);
        p.res[u.carry.type] += amt; p.stats.gathered += amt; p.stats[u.carry.type] += amt;
        u.carry = null; u.order = u.resume ?? null; u.resume = null; u.path = null;
      }
      break;
    }
  }
}

// keep units from stacking on one spot
function separate(s) {
  const us = [...s.ents.values()].filter(isUnit);
  const cell = new Map();
  for (const u of us) { const k = (Math.floor(u.x) << 8) | Math.floor(u.y); (cell.get(k) ?? cell.set(k, []).get(k)).push(u); }
  for (const u of us) {
    if (u.anim === "attack" && KINDS[u.kind].range > 2) continue;
    let px = 0, py = 0;
    const cx = Math.floor(u.x), cy = Math.floor(u.y);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) for (const v of cell.get(((cx + i) << 8) | (cy + j)) ?? []) {
      if (v === u) continue;
      const dx = u.x - v.x, dy = u.y - v.y, d = Math.hypot(dx, dy);
      if (d < 0.55) { const f = (0.55 - d) * 0.5; px += d > 0.001 ? (dx / d) * f : (u.id % 2 ? f : -f); py += d > 0.001 ? (dy / d) * f : (u.id % 3 ? f : -f); }
    }
    const nx = u.x + px * (u.moving ? 0.3 : 1), ny = u.y + py * (u.moving ? 0.3 : 1);
    if (passCost(s, Math.floor(nx), Math.floor(ny), u.owner) === 0) { u.x = nx; u.y = ny; }
  }
}

// ------------------------------------------------------------------ AI

function findSpot(s, kind, cx, cy, margin = 1, minR = 3) {
  const k = KINDS[kind];
  for (let r = minR; r < 18; r++)
    for (let t = 0; t < 24; t++) {
      const a = (t / 24) * Math.PI * 2 + r, x = Math.round(cx + Math.cos(a) * r - k.w / 2), y = Math.round(cy + Math.sin(a) * r - k.h / 2);
      let ok = true;
      for (let j = -margin; j < k.h + margin && ok; j++) for (let i = -margin; i < k.w + margin && ok; i++) {
        const inner = i >= 0 && j >= 0 && i < k.w && j < k.h;
        if (inner ? blocked(s, x + i, y + j) : inside(s, x + i, y + j) && s.occ[idx(s, x + i, y + j)] !== 0) ok = false;
      }
      if (ok) return { x, y };
    }
  return null;
}

function runAI(s, p) {
  const ai = p.ai, D = DIFF[ai.diff];
  ai.think -= TICK;
  if (ai.think > 0) return;
  ai.think = D.think;
  const mine = [...s.ents.values()].filter((e) => e.owner === p.id);
  const tc = mine.find((e) => e.kind === "tc");
  const base = tc ?? mine.find(isBuilding);
  if (!base) return;
  const bx = base.x + base.w / 2, by = base.y + base.h / 2;
  const vills = mine.filter((e) => e.kind === "villager");
  const army = mine.filter((e) => isUnit(e) && e.kind !== "villager");
  const has = (kind, any = false) => mine.filter((e) => e.kind === kind && (any || e.built >= 1));
  const { pop, cap } = popOf(s, p.id);
  const build = (kind, at) => {
    if (!afford(p, KINDS[kind].cost)) return false;
    const spot = at ? findSpot(s, kind, at.x, at.y, 1, 6) : kind === "farm" ? findSpot(s, kind, bx, by, 0, 3) : findSpot(s, kind, bx, by, 1, kind === "house" ? 5 : 6);
    const builder = vills.find((v) => v.order?.type !== "build") ?? vills[0];
    if (!spot || !builder) return false;
    command(s, p.id, { t: "build", ids: [builder.id], kind, x: spot.x, y: spot.y });
    return true;
  };

  // upgrades (economy and military), keeping a reserve so units still get trained
  const reserve = ai.diff === "easy" ? 150 : ai.diff === "normal" ? 60 : 0;
  for (const b of mine.filter((e) => isBuilding(e) && e.built >= 1 && KINDS[e.kind].researches)) {
    if (b.queue.length || (b.kind === "tc" && vills.length < 12)) continue;
    const tech = KINDS[b.kind].researches.find((t) => !p.techs[t] && !researching(s, p.id, t) && unlocked(s, p.id, t) && (t !== "castle" || vills.length >= (ai.diff === "easy" ? 12 : 14)));
    if (tech && Object.entries(TECHS[tech].cost).every(([r, v]) => p.res[r] >= v + (tech === "castle" ? 0 : reserve))) command(s, p.id, { t: "train", id: b.id, kind: tech });
  }
  // economy
  if (tc && tc.queue.length === 0 && vills.length < (s.peaceful ? 25 : ai.diff === "easy" ? 12 : 18) && pop < cap) command(s, p.id, { t: "train", id: tc.id, kind: "villager" });
  const building = (kind) => has(kind, true).some((e) => e.built < 1);
  const age = ageOf(p.techs);
  if (cap - pop <= 2 && cap < MAX_POP && !building("house")) build("house");
  else if (vills.length >= 7 && !has("barracks", true).length) build("barracks");
  else if (vills.length >= 10 && !has("storehouse", true).length) build("storehouse");
  else if (age >= 2 && has("barracks").length && !has("workshop", true).length) build("workshop");
  else if (age >= 2 && vills.length >= 16 && !has("market", true).length) build("market");
  else if (age >= 2 && ai.diff !== "easy" && has("tower", true).length < (ai.diff === "hard" ? 3 : 2) && p.res.gold > 160 && !building("tower")) build("tower");
  else if (has("barracks").length && has("barracks", true).length < 2 && vills.length >= 15 && p.res.wood > 250) build("barracks");
  // farms when berries near base run out
  const berriesNear = [...s.ents.values()].some((e) => e.kind === "berries" && distToRect(bx, by, e) < 12);
  if (!berriesNear && has("farm", true).length < Math.min(6, Math.ceil(vills.length / 3)) && p.res.wood >= 60 && !building("farm")) build("farm");

  // what each villager gathers (a walk to drop off counts for the resource it goes back to)
  const task = (v) => { const o = v.order?.type === "return" ? v.resume : v.order; return o?.type === "tree" ? o : o?.type === "gather" ? s.ents.get(o.id) && o : null; };
  const resOf = (v) => { const o = task(v); return !o ? null : o.type === "tree" ? "wood" : KINDS[s.ents.get(o.id).kind].res ?? "food"; };
  // at most FARM_CAP villagers per farm: the rest go to another farm or another resource
  const farmLoad = new Map();
  for (const v of vills) {
    const o = task(v), f = o?.type === "gather" ? s.ents.get(o.id) : null;
    if (f?.kind !== "farm") continue;
    const n = (farmLoad.get(f.id) ?? 0) + 1; farmLoad.set(f.id, n);
    if (n > FARM_CAP) { setOrder(v, null); farmLoad.set(f.id, n - 1); }
  }
  // food for an AI villager: berries near the base, else the nearest own farm with room
  const findFood = (v) => {
    let best = null, bd = 18;
    for (const e of s.ents.values()) {
      if (!(e.kind === "berries" || (e.kind === "farm" && e.owner === p.id && e.built >= 1 && e.food > 0 && (farmLoad.get(e.id) ?? 0) < FARM_CAP))) continue;
      const d = distToRect(bx, by, e); if (d < bd) { bd = d; best = e; }
    }
    if (best?.kind === "farm") farmLoad.set(best.id, (farmLoad.get(best.id) ?? 0) + 1);
    return best ? { type: "gather", id: best.id } : null;
  };
  const findRes = (v, res) => res === "food" ? findFood(v) : nearestResource(s, v, res, bx, by, 18) ?? (res === "gold" ? nearestResource(s, v, "gold", bx, by, 45) : nearestResource(s, v, "wood", v.x, v.y, 25) ?? nearestResource(s, v, "wood", bx, by, 45));

  // shares of the villagers per resource, shifted by the stockpiles: less on what piles up, more on what is short
  const want = { food: 0.45, wood: 0.3, gold: 0.25 };
  for (const r of RES) want[r] *= p.res[r] > 1500 ? 0.3 : p.res[r] > 800 ? 0.6 : p.res[r] < 150 ? 1.6 : 1;
  const count = { food: 0, wood: 0, gold: 0 };
  for (const v of vills) { const r = resOf(v); if (r) count[r]++; }
  // periodic rebalance: a big surplus of one resource while another runs short moves a few gatherers over
  if (s.time - (ai.rebalanced ?? 0) >= REBALANCE.every) {
    ai.rebalanced = s.time;
    const rich = RES.reduce((a, r) => (p.res[r] > p.res[a] ? r : a)), poor = RES.reduce((a, r) => (p.res[r] < p.res[a] ? r : a));
    if (p.res[rich] > REBALANCE.rich && p.res[poor] < REBALANCE.poor && count[rich] > 1)
      for (const v of vills.filter((v) => resOf(v) === rich).slice(0, Math.min(REBALANCE.move, count[rich] - 1))) {
        const o = findRes(v, poor); if (!o) break;
        setOrder(v, o); count[rich]--; count[poor]++;
      }
  }
  // assign idle villagers by need
  for (const v of vills.filter((v) => !v.order)) {
    const res = RES.reduce((a, r) => (count[r] / Math.max(1, vills.length) - want[r] < count[a] / Math.max(1, vills.length) - want[a] ? r : a), "food");
    // near the base first; once that runs dry, further out (a storehouse follows the workers, see below)
    let o = findRes(v, res) ?? nearestResource(s, v, "wood", v.x, v.y, 25) ?? nearestResource(s, v, "wood", bx, by, 45) ?? nearestResource(s, v, "gold", bx, by, 45);
    if (o) { setOrder(v, o); count[resOf(v) ?? res]++; }
  }

  // a building left half-done (builder killed, stuck or called away): send someone to finish it
  for (const b of mine.filter((e) => isBuilding(e) && e.built < 1 && e.kind !== "wall"))
    if (!vills.some((v) => v.order?.type === "build" && v.order.id === b.id)) {
      const v = vills.filter((v) => v.order?.type !== "build").sort((a, c) => distToRect(a.x, a.y, b) - distToRect(c.x, c.y, b))[0];
      if (v) setOrder(v, { type: "build", id: b.id });
    }
  // workers walking far to drop off: put a storehouse next to them
  if (!building("storehouse") && p.res.wood >= KINDS.storehouse.cost.wood + 40) {
    const far = vills.find((v) => { const o = v.order?.type === "return" ? v.resume : v.order; if (!o || (o.type !== "tree" && s.ents.get(o.id)?.kind !== "gold")) return false;
      const at = o.type === "tree" ? { x: o.x, y: o.y, w: 1, h: 1 } : s.ents.get(o.id), d = dropsite(s, { owner: p.id, x: at.x, y: at.y }, o.type === "tree" ? "wood" : "gold");
      return !d || distToRect(at.x + 0.5, at.y + 0.5, d) > 12; });
    if (far) { const o = far.order?.type === "return" ? far.resume : far.order, at = o.type === "tree" ? o : s.ents.get(o.id); build("storehouse", { x: Math.round(at.x), y: Math.round(at.y) }); }
  }
  // market: turn a big surplus into gold, or gold into what is missing
  const market = has("market")[0];
  if (market) {
    p.market ??= { food: MARKET.start, wood: MARKET.start };
    for (const r of ["food", "wood"]) {
      if (p.res[r] > 900 && p.res.gold < 300) command(s, p.id, { t: "trade", id: market.id, res: r, buy: false });
      else if (r === "wood" && p.res.wood > 600 && p.res.food < 100 && p.res.gold < p.market.food) command(s, p.id, { t: "trade", id: market.id, res: "wood", buy: false }); // wood -> gold -> food
      else if (p.res[r] < 100 && p.res.gold > (r === "food" ? p.market.food : 450) && p.market[r] < 180) command(s, p.id, { t: "trade", id: market.id, res: r, buy: true });
    }
  }
  // military production: counter what the enemies field (s.rand keeps the game replayable)
  const foe = { swordsman: 0, spearman: 0, archer: 0, cavalry: 0 }; let foeN = 0;
  const FOE_AS = { knight: "cavalry", crossbowman: "archer" };
  for (const e of s.ents.values()) { const kind = FOE_AS[e.kind] ?? e.kind; if (enemies(s, p.id, e.owner) && foe[kind] !== undefined) { foe[kind]++; foeN++; } }
  const better = (u) => (age >= 2 && u === "cavalry" && s.rand() < 0.7 ? "knight" : age >= 2 && u === "archer" && s.rand() < 0.6 ? "crossbowman" : u); // Castle Age units
  const pickUnit = () => {
    if (foeN >= 4 && foe.cavalry / foeN > 0.3) return "spearman";
    if (foeN >= 4 && foe.archer / foeN > 0.4) return better("cavalry");
    if (foeN >= 4 && foe.spearman / foeN > 0.4) return s.rand() < 0.5 ? better("archer") : "swordsman";
    const r = s.rand(); return r < 0.3 ? "swordsman" : r < 0.55 ? better("archer") : r < 0.8 ? better("cavalry") : "spearman";
  };
  // saving for the Castle Age: no new soldiers once there is a small guard (unless the base is attacked)
  const savingAge = !p.techs.castle && !researching(s, p.id, "castle") && unlocked(s, p.id, "castle") && vills.length >= (ai.diff === "easy" ? 12 : 14) && army.length >= 4 && !nearestEnemy(s, p.id, bx, by, 14);
  for (const b of has("barracks")) { // save up for the chosen unit instead of falling back to the cheapest one
    if (savingAge) break;
    if (b.queue.length >= 2 || pop >= cap || (s.peaceful && army.length >= 6)) continue; // peaceful allies keep a small guard
    ai.want ??= pickUnit();
    if (afford(p, KINDS[ai.want].cost)) { command(s, p.id, { t: "train", id: b.id, kind: ai.want }); ai.want = null; }
  }
  const rams = army.filter((e) => e.kind === "ram").length;
  for (const b of has("workshop"))
    if (!s.peaceful && !b.queue.length && pop < cap && army.length >= 6 && rams < 1 + Math.min(2, ai.wave) && afford(p, KINDS.ram.cost)) command(s, p.id, { t: "train", id: b.id, kind: "ram" });

  // defend base
  const threat = nearestEnemy(s, p.id, bx, by, 14);
  if (threat) {
    for (const a of army) if (!KINDS[a.kind].siege && (!a.order || a.order.type !== "attack")) setOrder(a, { type: "attack", id: threat.id });
    return;
  }
  // attack waves
  const need = Math.min(D.wave + ai.wave * 2, 18, s.time >= 15 * 60 ? D.wave + 4 : Infinity); // waves grow, but not forever; smaller late in the game
  const soldiers = army.filter((a) => !KINDS[a.kind].siege);
  const waiting = soldiers.filter((a) => !a.order || a.order.type === "move").length;
  if (soldiers.length > (ai.most ?? 0)) { ai.most = soldiers.length; ai.grew = s.time; } // late game: an army that stopped growing goes anyway
  const stalled = s.time >= 15 * 60 && s.time - (ai.grew ?? 0) >= 60;
  // a new wave once enough soldiers wait at home, or (at most every 30 s) when the army is big enough, the pop cap is reached or the army stalled
  const ready = s.time - (ai.lastWave ?? -Infinity) >= 30 && soldiers.length >= D.wave && (soldiers.length >= need || pop >= cap || stalled);
  if (waiting >= need || ready) {
    const foes = [...s.ents.values()].filter((e) => enemies(s, p.id, e.owner) && s.players[e.owner].alive && isBuilding(e));
    if (foes.length) {
      foes.sort((a, b) => Math.hypot(a.x - bx, a.y - by) - Math.hypot(b.x - bx, b.y - by));
      const t = foes[0];
      command(s, p.id, { t: "attackMove", ids: army.map((a) => a.id), x: t.x + t.w / 2, y: t.y + t.h / 2 }); // every soldier and the rams
      // ai.most = 0: the stalled check measures growth of the next wave from scratch; without the reset the remembered pre-wave
      // peak (soldiers that just left and died) would mark the rebuilding army as stalled and launch it again after 60 s
      ai.wave++; ai.lastWave = s.time; ai.most = 0;
      s.events.push({ type: "attack_launched", player: p.name, units: army.length });
    }
  } else {
    // gather idle army near base, out of the way
    for (const a of army) if (!a.order && Math.hypot(a.x - bx, a.y - by) > 8) setOrder(a, { type: "move", x: bx + (40 - bx) * 0.15, y: by + (40 - by) * 0.15 });
  }
}

// ------------------------------------------------------------------ network snapshot

const KIND_LIST = Object.keys(KINDS);
// Fog of war: what player `pid` can see now (vis) and has ever seen (explored).
const BUILD_SIGHT = { tc: 8, barracks: 5, house: 4, storehouse: 5, farm: 3, workshop: 5, market: 5, tower: 9, wall: 2, gate: 2 };
export function visibility(s, pid) {
  const vis = new Uint8Array(s.w * s.h);
  if (pid < 0 || pid >= s.players.length) { vis.fill(1); return { vis, ex: vis }; } // spectator
  if (!s.explored) s.explored = s.players.map(() => new Uint8Array(s.w * s.h));
  const ex = s.explored[pid];
  const reveal = (cx, cy, r) => {
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(s.h - 1, Math.ceil(cy + r)); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(s.w - 1, Math.ceil(cx + r)); x++)
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) { vis[y * s.w + x] = 1; ex[y * s.w + x] = 1; }
  };
  const p = s.players[pid];
  const teamUp = p && s.players.some((q) => q.alive && allies(s, pid, q.id));
  if (!p || !teamUp || s.over) { vis.fill(1); ex.fill(1); return { vis, ex }; } // finished games, and defeated players with no team left, see everything
  for (const e of s.ents.values()) {
    if (e.owner < 0 || !allies(s, pid, e.owner)) continue; // allies share vision
    if (isUnit(e)) reveal(e.x, e.y, KINDS[e.kind].sight);
    else if (isBuilding(e)) reveal(e.x + e.w / 2, e.y + e.h / 2, (BUILD_SIGHT[e.kind] ?? 4) + Math.max(e.w, e.h) / 2);
  }
  return { vis, ex };
}
function bits(arr) { // Uint8Array of 0/1 -> base64 bitset
  const b = new Uint8Array(Math.ceil(arr.length / 8));
  for (let i = 0; i < arr.length; i++) if (arr[i]) b[i >> 3] |= 1 << (i & 7);
  return typeof Buffer !== "undefined" ? Buffer.from(b).toString("base64") : btoa(String.fromCharCode(...b));
}

export function snapshot(s, pid) {
  const ents = [];
  const { vis, ex } = visibility(s, pid);
  const seen = (x, y) => vis[Math.floor(y) * s.w + Math.floor(x)] === 1;
  for (const e of s.ents.values()) {
    const k = KIND_LIST.indexOf(e.kind);
    if (isUnit(e)) {
      if (e.owner !== pid && !seen(e.x, e.y)) continue;
      ents.push([e.id, k, e.owner, Math.round(e.x * 100), Math.round(e.y * 100), Math.ceil(e.hp), e.carry ? RES.indexOf(e.carry.type) : -1, e.anim === "attack" ? 1 : e.anim === "gather" ? 2 : e.anim === "build" ? 3 : e.moving ? 4 : 0, Math.round((e.face ?? 0) * 100) / 100, e.owner === pid && e.stance ? (e.stance === "defensive" ? 1 : 2) : 0]);
    } else {
      if (e.owner !== pid) { // other buildings and resources: shown once explored
        let known = false;
        for (let j = 0; j < e.h && !known; j++) for (let i = 0; i < e.w && !known; i++) if (ex[(e.y + j) * s.w + e.x + i]) known = true;
        if (!known) continue;
      }
      ents.push([e.id, k, e.owner, e.x, e.y, Math.ceil(e.hp), Math.round((e.built ?? 1) * 100), Math.round(e.amount ?? e.food ?? 0), e.owner === pid && e.queue?.length ? [e.queue, Math.round((e.prog / timeOf(e.queue[0])) * 100)] : 0]);
    }
  }
  const me = s.players[pid];
  return {
    t: "s", tick: s.tick, time: Math.round(s.time), peaceful: s.peaceful,
    me: pid, techs: me ? Object.keys(me.techs) : [], market: me ? (me.market ?? { food: MARKET.start, wood: MARKET.start }) : null, res: me ? { food: Math.floor(me.res.food), wood: Math.floor(me.res.wood), gold: Math.floor(me.res.gold), ...popOf(s, pid) } : null,
    players: s.players.map((p) => ({ name: p.name, color: p.color, team: p.team, alive: p.alive, ai: p.ai?.diff ?? null })),
    ents, fx: s.fx.filter((f) => seen(f[0], f[1]) || seen(f[2], f[3])), trees: s.treeChanges, over: s.over, winner: s.winner, winTeam: s.winTeam ?? null,
    vis: bits(vis), ex: s.tick % 10 === 1 ? bits(ex) : undefined,
  };
}
export function mapInfo(s) {
  return { t: "map", map: s.map, w: s.w, h: s.h, tile: Array.from(s.tile), wood: Array.from(s.wood, (v) => (v > 0 ? 1 : 0)), kinds: KIND_LIST };
}
