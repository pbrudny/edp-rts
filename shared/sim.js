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
  spearman:  { type: "unit", hp: 45, atk: 4, range: 0.9, cd: 1.3, speed: 2.1, armor: 0, pierce: 0, cost: { food: 35, wood: 25 }, time: 10, sight: 6, bonus: { cavalry: 11, ram: 4 } },
  archer:    { type: "unit", hp: 35, atk: 5, range: 5, cd: 1.6, speed: 2.2, armor: 0, pierce: 0, cost: { wood: 30, gold: 40 }, time: 14, sight: 7, bonus: { spearman: 3 } },
  cavalry:   { type: "unit", hp: 110, atk: 7, range: 0.9, cd: 1.3, speed: 3.3, armor: 1, pierce: 2, cost: { food: 80, gold: 60 }, time: 18, sight: 8, bonus: { archer: 6, ram: 10 } },
  ram:       { type: "unit", hp: 200, atk: 60, range: 0.9, cd: 3, speed: 1.2, armor: 0, pierce: 8, cost: { wood: 160, gold: 70 }, time: 24, sight: 5, siege: true },
  tc:         { type: "building", w: 3, h: 3, hp: 1400, pop: 5, drop: ["food", "wood", "gold"], atk: 5, range: 7, cd: 2, trains: ["villager"], researches: ["wheelbarrow"], time: 60, cost: { wood: 400, gold: 150 } },
  house:      { type: "building", w: 2, h: 2, hp: 350, pop: 5, cost: { wood: 30 }, time: 12 },
  barracks:   { type: "building", w: 3, h: 3, hp: 700, cost: { wood: 150 }, time: 30, trains: ["swordsman", "spearman", "archer", "cavalry"] },
  storehouse: { type: "building", w: 2, h: 2, hp: 450, drop: ["wood", "gold"], cost: { wood: 100 }, time: 18, researches: ["axes", "mining"] },
  farm:       { type: "building", w: 2, h: 2, hp: 120, cost: { wood: 60 }, time: 10, food: 300 },
  workshop:   { type: "building", w: 3, h: 3, hp: 650, cost: { wood: 175, gold: 50 }, time: 35, trains: ["ram"], researches: ["forging", "fletching", "chainmail"] },
  gold:    { type: "resource", w: 2, h: 2, amount: 800, res: "gold" },
  berries: { type: "resource", w: 1, h: 1, amount: 150, res: "food" },
};
export const BUILDABLE = ["house", "barracks", "storehouse", "farm", "workshop"];

// upgrades: researched once per player in a building's queue, like training a unit (no population needed)
export const TECHS = {
  forging:     { name: "Forging", desc: "+2 attack for swordsmen, spearmen and cavalry", cost: { food: 150, gold: 100 }, time: 30 },
  fletching:   { name: "Fletching", desc: "+1 attack and +1 range for archers and town centres", cost: { food: 100, wood: 50, gold: 75 }, time: 30 },
  chainmail:   { name: "Chain mail", desc: "+1 armour and +1 arrow armour for soldiers", cost: { food: 150, gold: 150 }, time: 40 },
  wheelbarrow: { name: "Wheelbarrow", desc: "Villagers carry 15 instead of 10 and walk 10% faster", cost: { food: 150, wood: 75 }, time: 30 },
  axes:        { name: "Double-bit axe", desc: "+20% wood gathering", cost: { food: 100, wood: 50 }, time: 20 },
  mining:      { name: "Gold mining", desc: "+20% gold gathering", cost: { food: 100, wood: 75 }, time: 20 },
};
const MELEE = ["swordsman", "spearman", "cavalry"], SOLDIERS = ["swordsman", "spearman", "archer", "cavalry"];
export const costOf = (item) => (KINDS[item] ?? TECHS[item]).cost;
export const timeOf = (item) => (KINDS[item] ?? TECHS[item]).time;
// a unit/building stat after the owner's upgrades (`techs` = { techId: 1 })
export function stat(techs, kind, key) {
  let v = KINDS[kind][key] ?? 0;
  const has = (t) => !!techs?.[t];
  if (key === "atk") { if (has("forging") && MELEE.includes(kind)) v += 2; if (has("fletching") && (kind === "archer" || kind === "tc")) v += 1; }
  if (key === "range" && has("fletching") && (kind === "archer" || kind === "tc")) v += 1;
  if ((key === "armor" || key === "pierce") && has("chainmail") && SOLDIERS.includes(kind)) v += 1;
  if (key === "speed" && has("wheelbarrow") && kind === "villager") v *= 1.1;
  return v;
}
const carryOf = (p) => (p.techs.wheelbarrow ? 15 : CARRY);
const RATE = { berries: 0.9, farm: 0.6, wood: 0.75, gold: 0.65 };
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
function astar(s, sx, sy, isGoal, hx, hy, maxNodes = 5000) {
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
      if (blocked(s, nx, ny)) continue;
      if (dx && dy && (blocked(s, cx + dx, cy) || blocked(s, cx, cy + dy))) continue;
      const ni = idx(s, nx, ny), ng = g[cur] + c;
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

export function createGame({ seed = Date.now() % 1e9, players, peaceful = false }) {
  const R = rng(seed);
  const s = {
    seed, peaceful: !!peaceful, rand: rng(seed ^ 0x5bd1e995), w: MAP, h: MAP, tick: 0, time: 0, nextId: 1, over: false, winner: null, timeline: [],
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
  // lakes
  for (let n = 0; n < 4; n++) { const cx = 15 + ((R() * 50) | 0), cy = 15 + ((R() * 50) | 0); if (!nearStart(cx, cy, 16)) blob(cx, cy, 3 + ((R() * 3) | 0), (i) => (s.tile[i] = 1)); }
  // forests
  for (let n = 0; n < 26; n++) { const cx = (R() * MAP) | 0, cy = (R() * MAP) | 0; if (!nearStart(cx, cy, 9)) blob(cx, cy, 2 + ((R() * 4) | 0), (i) => { if (!s.tile[i]) s.wood[i] = 100; }); }
  for (const [sx, sy] of starts) { const a = R() * Math.PI * 2; blob(Math.round(sx + Math.cos(a) * 10), Math.round(sy + Math.sin(a) * 10), 3, (i) => { if (!s.tile[i]) s.wood[i] = 100; }); }
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
    case "move": case "attackMove": {
      const n = units.length, cols = Math.ceil(Math.sqrt(n));
      units.forEach((u, i) => {
        const ox = n > 1 ? ((i % cols) - (cols - 1) / 2) * 1.1 : 0, oy = n > 1 ? (((i / cols) | 0) - (cols - 1) / 2) * 1.1 : 0;
        setOrder(u, { type: c.t, x: c.x + ox, y: c.y + oy });
      });
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
      if (!BUILDABLE.includes(c.kind) || !units.some((u) => u.kind === "villager")) return;
      if (!afford(p, k.cost) || !canPlace(s, c.kind, c.x, c.y)) return;
      pay(p, k.cost);
      const b = { id: s.nextId++, kind: c.kind, owner: pid, x: c.x, y: c.y, w: k.w, h: k.h, hp: Math.ceil(k.hp * 0.1), built: 0, queue: [], prog: 0, cool: 0 };
      if (k.food) b.food = k.food;
      s.ents.set(b.id, b); setOcc(s, b, b.id);
      for (const e of s.ents.values()) if (isUnit(e) && distToRect(e.x, e.y, b) === 0) { const f = nearestFree(s, e.x, e.y); e.x = f.x; e.y = f.y; e.path = null; }
      for (const u of units) if (u.kind === "villager") setOrder(u, { type: "build", id: b.id });
      s.events.push({ type: "building_placed", player: p.name, building: c.kind });
      break;
    }
    case "train": { // a unit, or an upgrade (research)
      const b = mine(c.id);
      if (!b || !isBuilding(b) || b.built < 1 || b.queue.length >= 5) return;
      const kb = KINDS[b.kind];
      if (TECHS[c.kind]) { if (!(kb.researches ?? []).includes(c.kind) || p.techs[c.kind] || researching(s, pid, c.kind)) return; }
      else if (!(kb.trains ?? []).includes(c.kind)) return;
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
export const researching = (s, pid, tech) => [...s.ents.values()].some((e) => e.owner === pid && e.queue?.includes(tech));
const afford = (p, cost) => Object.entries(cost).every(([r, v]) => p.res[r] >= v);
const pay = (p, cost) => { for (const [r, v] of Object.entries(cost)) p.res[r] -= v; };
const refund = (p, cost) => { for (const [r, v] of Object.entries(cost)) p.res[r] += v; };
function setOrder(u, o) { u.order = o; u.path = null; u.pathKey = null; if (o?.type !== "return" && o?.type !== "gather" && o?.type !== "tree") u.resume = null; }

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
  for (const p of s.players) if (p.alive && ![...s.ents.values()].some((e) => e.owner === p.id && isBuilding(e))) defeat(s, p.id, "no buildings left");
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
    u.path = astar(s, Math.floor(u.x), Math.floor(u.y), isGoal, Math.floor(gx), Math.floor(gy)) ?? [];
    u.pathKey = key; u.repath = goal.moving ? 1 : 4;
    if (!u.path.length) { u.stuck = (u.stuck ?? 0) + 1; return false; }
  }
  if (!u.path.length) return false;
  let budget = stat(s.players[u.owner].techs, u.kind, "speed") * TICK;
  while (budget > 0 && u.path.length) {
    const n = u.path[0];
    if (blocked(s, Math.floor(n.x), Math.floor(n.y))) { u.path = null; break; }
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
  const p = s.players[u.owner];
  const mult = p.ai ? DIFF[p.ai.diff].gather : 1;
  const carry = carryOf(p), range = stat(p.techs, u.kind, "range");

  // military: auto-acquire targets (rams only look for buildings)
  if (u.kind !== "villager" && (!o || o.type === "attackMove") && (u.scan -= TICK) <= 0) {
    u.scan = 0.5;
    const t = nearestEnemy(s, u.owner, u.x, u.y, k.sight, false, !!k.siege);
    if (t) { u.prev = o; u.order = { type: "attack", id: t.id, auto: true }; u.path = null; }
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
      if (!t || t.hp <= 0 || (k.siege && isUnit(t)) || !enemies(s, u.owner, t.owner) || (u.kind !== "villager" && ord.auto && distTo(u, t) > k.sight + 3)) { u.order = u.prev ?? null; u.prev = null; u.path = null; break; }
      const goal = isUnit(t) ? { x: t.x, y: t.y, moving: true } : { rect: t };
      if (approach(s, u, goal, range)) {
        u.anim = "attack"; u.face = Math.atan2(centre(t).y - u.y, centre(t).x - u.x);
        if (u.cool <= 0) { hit(s, u, t, stat(p.techs, u.kind, "atk")); u.cool = k.cd; if (range > 2) s.fx.push([u.x, u.y, centre(t).x, centre(t).y]); }
      }
      break;
    }
    case "build": {
      const b = s.ents.get(ord.id);
      if (!b || b.built >= 1) { u.order = b?.kind === "farm" ? { type: "gather", id: b.id } : null; break; }
      if (approach(s, u, { rect: b }, 1.0)) {
        u.anim = "build";
        const kb = KINDS[b.kind];
        b.built = Math.min(1, b.built + TICK / kb.time);
        b.hp = Math.min(kb.hp, b.hp + (kb.hp * 0.9 * TICK) / kb.time);
        if (b.built >= 1) {
          s.events.push({ type: "building_completed", player: p.name, building: b.kind }); p.stats.built++;
          u.order = b.kind === "farm" ? { type: "gather", id: b.id } : null;
        }
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
    if (!blocked(s, Math.floor(nx), Math.floor(ny))) { u.x = nx; u.y = ny; }
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
  const build = (kind) => {
    if (!afford(p, KINDS[kind].cost)) return false;
    const spot = kind === "farm" ? findSpot(s, kind, bx, by, 0, 3) : findSpot(s, kind, bx, by, 1, kind === "house" ? 5 : 6);
    const builder = vills.find((v) => v.order?.type !== "build") ?? vills[0];
    if (!spot || !builder) return false;
    command(s, p.id, { t: "build", ids: [builder.id], kind, x: spot.x, y: spot.y });
    return true;
  };

  // upgrades (economy and military), keeping a reserve so units still get trained
  const reserve = ai.diff === "easy" ? 150 : ai.diff === "normal" ? 60 : 0;
  for (const b of mine.filter((e) => isBuilding(e) && e.built >= 1 && KINDS[e.kind].researches)) {
    if (b.queue.length || (b.kind === "tc" && vills.length < 12)) continue;
    const tech = KINDS[b.kind].researches.find((t) => !p.techs[t] && !researching(s, p.id, t));
    if (tech && Object.entries(TECHS[tech].cost).every(([r, v]) => p.res[r] >= v + reserve)) command(s, p.id, { t: "train", id: b.id, kind: tech });
  }
  // economy
  if (tc && tc.queue.length === 0 && vills.length < (s.peaceful ? 25 : ai.diff === "easy" ? 12 : 18) && pop < cap) command(s, p.id, { t: "train", id: tc.id, kind: "villager" });
  const building = (kind) => has(kind, true).some((e) => e.built < 1);
  if (cap - pop <= 2 && cap < MAX_POP && !building("house")) build("house");
  else if (vills.length >= 7 && !has("barracks", true).length) build("barracks");
  else if (vills.length >= 10 && !has("storehouse", true).length) build("storehouse");
  else if (vills.length >= (ai.diff === "easy" ? 11 : 14) && has("barracks").length && !has("workshop", true).length) build("workshop");
  else if (has("barracks").length && has("barracks", true).length < 2 && vills.length >= 15 && p.res.wood > 250) build("barracks");
  // farms when berries near base run out
  const berriesNear = [...s.ents.values()].some((e) => e.kind === "berries" && distToRect(bx, by, e) < 12);
  const foodWorkers = vills.filter((v) => (v.order?.type === "gather" && ["berries", "farm"].includes(s.ents.get(v.order.id)?.kind)) || v.carry?.type === "food");
  if (!berriesNear && has("farm", true).length < Math.min(6, Math.ceil(vills.length / 3)) && p.res.wood >= 60 && !building("farm")) build("farm");

  // assign idle villagers by need
  const want = { food: 0.45, wood: 0.3, gold: 0.25 };
  const count = { food: foodWorkers.length, wood: 0, gold: 0 };
  for (const v of vills) { if (v.order?.type === "tree" || v.carry?.type === "wood") count.wood++; else if (v.order?.type === "gather" && s.ents.get(v.order.id)?.kind === "gold") count.gold++; }
  for (const v of vills.filter((v) => !v.order)) {
    const res = RES.reduce((a, r) => (count[r] / Math.max(1, vills.length) - want[r] < count[a] / Math.max(1, vills.length) - want[a] ? r : a), "food");
    let o = nearestResource(s, v, res, bx, by, 18) ?? nearestResource(s, v, "wood", v.x, v.y, 25);
    if (o) { setOrder(v, o); count[res]++; }
  }

  // military production: counter what the enemies field (s.rand keeps the game replayable)
  const foe = { swordsman: 0, spearman: 0, archer: 0, cavalry: 0 }; let foeN = 0;
  for (const e of s.ents.values()) if (enemies(s, p.id, e.owner) && foe[e.kind] !== undefined) { foe[e.kind]++; foeN++; }
  const pickUnit = () => {
    if (foeN >= 4 && foe.cavalry / foeN > 0.3) return "spearman";
    if (foeN >= 4 && foe.archer / foeN > 0.4) return "cavalry";
    if (foeN >= 4 && foe.spearman / foeN > 0.4) return s.rand() < 0.5 ? "archer" : "swordsman";
    const r = s.rand(); return r < 0.3 ? "swordsman" : r < 0.55 ? "archer" : r < 0.8 ? "cavalry" : "spearman";
  };
  for (const b of has("barracks")) { // save up for the chosen unit instead of falling back to the cheapest one
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
  const need = D.wave + ai.wave * 2;
  if (army.length >= need) {
    const foes = [...s.ents.values()].filter((e) => enemies(s, p.id, e.owner) && s.players[e.owner].alive && isBuilding(e));
    if (foes.length) {
      foes.sort((a, b) => Math.hypot(a.x - bx, a.y - by) - Math.hypot(b.x - bx, b.y - by));
      const t = foes[0];
      command(s, p.id, { t: "attackMove", ids: army.map((a) => a.id), x: t.x + t.w / 2, y: t.y + t.h / 2 });
      ai.wave++;
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
const BUILD_SIGHT = { tc: 8, barracks: 5, house: 4, storehouse: 5, farm: 3, workshop: 5 };
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
      ents.push([e.id, k, e.owner, Math.round(e.x * 100), Math.round(e.y * 100), Math.ceil(e.hp), e.carry ? RES.indexOf(e.carry.type) : -1, e.anim === "attack" ? 1 : e.anim === "gather" ? 2 : e.anim === "build" ? 3 : e.moving ? 4 : 0, Math.round((e.face ?? 0) * 100) / 100]);
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
    me: pid, techs: me ? Object.keys(me.techs) : [], res: me ? { food: Math.floor(me.res.food), wood: Math.floor(me.res.wood), gold: Math.floor(me.res.gold), ...popOf(s, pid) } : null,
    players: s.players.map((p) => ({ name: p.name, color: p.color, team: p.team, alive: p.alive, ai: p.ai?.diff ?? null })),
    ents, fx: s.fx.filter((f) => seen(f[0], f[1]) || seen(f[2], f[3])), trees: s.treeChanges, over: s.over, winner: s.winner, winTeam: s.winTeam ?? null,
    vis: bits(vis), ex: s.tick % 10 === 1 ? bits(ex) : undefined,
  };
}
export function mapInfo(s) {
  return { t: "map", w: s.w, h: s.h, tile: Array.from(s.tile), wood: Array.from(s.wood, (v) => (v > 0 ? 1 : 0)), kinds: KIND_LIST };
}
