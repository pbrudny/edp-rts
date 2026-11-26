// Ember Realms client: PixiJS (WebGL) isometric renderer + HUD + input. Server is authoritative.
import { KINDS, COLORS } from "/shared/sim.js";
import * as Art from "/art.js";
import * as Sfx from "/sfx.js";

const PIXI = window.PIXI;
const $ = (id) => document.getElementById(id);
const HW = 32, HH = 16; // half tile width/height in screen px (64 x 32 diamond)
const iso = (x, y) => ({ x: (x - y) * HW, y: (x + y) * HH });
const NAMES = { villager: "Villager", swordsman: "Swordsman", archer: "Archer", tc: "Town Centre", house: "House", barracks: "Barracks", storehouse: "Storehouse", farm: "Farm", gold: "Gold mine", berries: "Berry bush" };
const KEYS = { villager: ["house", "barracks", "storehouse", "farm"], tc: ["villager"], barracks: ["swordsman", "archer"] };
const HOTKEYS = ["q", "w", "e", "r"];
const TINT = COLORS.map((c) => parseInt(c.slice(1), 16));

// ------------------------------------------------------------------ PIXI setup
const app = new PIXI.Application({ resizeTo: window, background: 0x0b0906, antialias: true, resolution: Math.min(2, devicePixelRatio || 1), autoDensity: true });
$("stage").appendChild(app.view);
app.view.addEventListener("contextmenu", (e) => { e.preventDefault(); if (snap && !e.ctrlKey) secondary(e.clientX, e.clientY); });
const world = new PIXI.Container();
const groundLayer = new PIXI.Container(), decal = new PIXI.Container(), objLayer = new PIXI.Container(), fxLayer = new PIXI.Container(), fogLayer = new PIXI.Container(), uiLayer = new PIXI.Container();
objLayer.sortableChildren = true;
world.addChild(groundLayer, decal, objLayer, fxLayer, fogLayer, uiLayer);
const screenUi = new PIXI.Graphics();
const embers = new PIXI.Container();
app.stage.addChild(embers, world, screenUi);
const ringG = new PIXI.Graphics(); decal.addChild(ringG);
const barG = new PIXI.Graphics(), ghostG = new PIXI.Graphics(); uiLayer.addChild(ghostG, barG);

let sheets = null;
async function loadSheets() {
  const out = {};
  for (const name of ["units", "objects"]) {
    const meta = await (await fetch(`/assets/${name}.json?v=${window.ER_V}`)).json();
    for (const pg of meta.pages) {
      const base = (await PIXI.Assets.load(`/assets/${pg.image}?v=${window.ER_V}`)).baseTexture;
      const mask = (await PIXI.Assets.load(`/assets/${pg.mask}?v=${window.ER_V}`)).baseTexture;
      for (const [n, [x, y, w, h, ax, ay, hm]] of Object.entries(pg.frames)) {
        const r = new PIXI.Rectangle(x, y, w, h);
        out[n] = { tex: new PIXI.Texture(base, r), mask: hm ? new PIXI.Texture(mask, r) : null, ax: ax / w, ay: ay / h, scale: 1 / meta.scale };
      }
    }
  }
  return out;
}
const sheetsReady = loadSheets().then((s) => (sheets = s));

function makeSprite() {
  const c = new PIXI.Container(); c.base = new PIXI.Sprite(); c.mask2 = new PIXI.Sprite(); c.addChild(c.base, c.mask2); return c;
}
function setFrame(c, name, tint) {
  const f = sheets[name]; if (!f) return;
  if (c.frameName !== name) {
    c.frameName = name;
    c.base.texture = f.tex; c.base.anchor.set(f.ax, f.ay); c.base.scale.set(f.scale);
    if (f.mask) { c.mask2.texture = f.mask; c.mask2.anchor.set(f.ax, f.ay); c.mask2.scale.set(f.scale); c.mask2.visible = true; } else c.mask2.visible = false;
  }
  if (tint !== undefined) c.mask2.tint = tint;
}

// soft round particle + arrow textures
const dotTex = (() => { const g = new PIXI.Graphics(); for (let r = 8; r > 0; r--) { g.beginFill(0xffffff, 0.08 + (8 - r) * 0.05); g.drawCircle(8, 8, r); g.endFill(); } return app.renderer.generateTexture(g); })();
const arrowTex = (() => { const g = new PIXI.Graphics(); g.lineStyle(1.6, 0x5a3d22); g.moveTo(0, 3); g.lineTo(16, 3); g.lineStyle(0); g.beginFill(0xc9ced4); g.drawPolygon([20, 3, 15, 0.5, 15, 5.5]); g.endFill(); g.beginFill(0xe8e2d0); g.drawRect(0, 1.5, 3, 3); g.endFill(); return app.renderer.generateTexture(g); })();

// ------------------------------------------------------------------ state
let ws, map = null, kinds = [], me = -1, snap = null, prev = null, snapAt = 0, playing = false;
const cam = { x: 0, y: 0, z: 1 };
let sel = new Set(), mode = null, drag = null, mouse = { x: 0, y: 0, in: false }, keys = new Set(), marks = [];
const sprites = new Map();     // id -> container
const trees = new Map();       // tile index -> sprite
let fogTex = null, fogCtx = null, explored = null, vis = null, occ = null, pendingSnap = null;
const particles = [], arrows = [], corpses = [];

// ------------------------------------------------------------------ net
function connect(first) {
  Sfx.unlock();
  ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host);
  ws.onopen = () => first && ws.send(JSON.stringify(first));
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === "error") { $("err").textContent = m.msg; toast(m.msg); }
    else if (m.t === "lobby") showLobby(m);
    else if (m.t === "map") setMap(m);
    else if (m.t === "start") startGame(m.me);
    else if (m.t === "s") { if (ready) onSnap(m); else pendingSnap = m; }
  };
  const beat = setInterval(() => ws.readyState === 1 && ws.send('{"t":"ping"}'), 25000); // keep idle lobby alive behind the proxy
  ws.onclose = () => { clearInterval(beat); if (playing && !snap?.over) toast("Connection lost."); else if (!playing) { $("err").textContent = "Connection lost, create the game again."; if (!$("lobby").hidden) { $("lobby").hidden = true; $("menu").hidden = false; } } };
}
let ready = false;
const send = (m) => ws?.readyState === 1 && ws.send(JSON.stringify(m));
const cmd = (c) => send({ t: "cmd", c });

// ------------------------------------------------------------------ menu / lobby
const nameVal = () => $("name").value.trim() || "Commander";
try { $("name").value = localStorage.getItem("er-name") ?? ""; } catch {}
const saveName = () => { try { localStorage.setItem("er-name", $("name").value.trim()); } catch {} };
let createdHere = false;
$("watch").onclick = () => connect({ t: "watch", diff: $("diff").value, ais: $("ais").value, speed: 2 });
$("speed").onchange = () => send({ t: "speed", speed: +$("speed").value });
$("playSingle").onclick = () => { saveName(); connect({ t: "single", name: nameVal(), diff: $("diff").value, ais: $("ais").value }); };
$("create").onclick = () => { saveName(); createdHere = true; connect({ t: "create", name: nameVal() }); };
$("join").onclick = () => { saveName(); const c = $("joinCode").value.trim().toUpperCase(); if (c.length === 4) connect({ t: "join", code: c, name: nameVal() }); else $("err").textContent = "Enter the 4-letter code."; };
$("joinCode").onkeydown = (e) => e.key === "Enter" && $("join").click();
$("addAI").onclick = () => send({ t: "addAI", diff: $("aiDiff").value });
$("start").onclick = () => send({ t: "start" });
$("leave").onclick = () => location.reload();
$("again").onclick = () => location.reload();
let resignArm = 0;
$("resign").onclick = () => { if (Date.now() - resignArm < 3000) cmd({ t: "resign" }); else { resignArm = Date.now(); toast("Click Resign again to confirm."); } };
$("mute").onclick = () => { $("mute").textContent = Sfx.toggleMute() ? "Sound off" : "Sound on"; };
$("mute").textContent = Sfx.isMuted() ? "Sound off" : "Sound on";

function showLobby(m) {
  $("menu").hidden = true; $("lobby").hidden = false;
  $("lobbyCode").textContent = m.code;
  const amHost = createdHere;
  $("slots").innerHTML = m.slots.map((s, i) => `<div class="slot"><b style="background:${COLORS[i]}"></b>${esc(s.name)}${s.ai ? ` <small>(${s.ai})</small>` : ""}${i === 0 ? " <small>host</small>" : ""}${amHost && s.ai ? ` <button data-kick="${i}" style="margin-left:auto">Remove</button>` : ""}</div>`).join("");
  $("slots").querySelectorAll("[data-kick]").forEach((b) => (b.onclick = () => send({ t: "kick", slot: +b.dataset.kick })));
  $("hostCtl").hidden = !amHost; $("waitHost").hidden = amHost;
  $("start").disabled = m.slots.length < 2;
}

// ------------------------------------------------------------------ map + fog
async function setMap(m) {
  map = m; kinds = m.kinds;
  $("loading").hidden = false;
  await new Promise((r) => setTimeout(r, 30));
  await sheetsReady;
  const ground = new PIXI.Sprite(PIXI.Texture.from(Art.makeGround(m)));
  ground.transform.setFromMatrix(new PIXI.Matrix(1, 0.5, -1, 0.5, 0, 0)); // top-down texture -> isometric
  groundLayer.addChild(ground);
  const edge = new PIXI.Graphics(); edge.lineStyle(6, 0x1a140c, 1); edge.drawPolygon([iso(0, 0), iso(m.w, 0), iso(m.w, m.h), iso(0, m.h)].flatMap((p) => [p.x, p.y])); groundLayer.addChild(edge);
  for (let i = 0; i < m.w * m.h; i++) if (m.wood[i]) addTree(i);
  const fc = document.createElement("canvas"); fc.width = m.w; fc.height = m.h; fogCtx = fc.getContext("2d");
  fogCtx.fillStyle = "#000"; fogCtx.fillRect(0, 0, m.w, m.h);
  fogTex = PIXI.Texture.from(fc); fogTex.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
  const fog = new PIXI.Sprite(fogTex); fog.transform.setFromMatrix(new PIXI.Matrix(HW, HH, -HW, HH, 0, 0)); fogLayer.addChild(fog);
  explored = new Uint8Array(m.w * m.h); vis = new Uint8Array(m.w * m.h);
  drawMinimapBase();
  $("loading").hidden = true;
  ready = true;
  if (pendingSnap) { onSnap(pendingSnap); pendingSnap = null; }
}
function addTree(i) {
  const x = i % map.w, y = (i / map.w) | 0, v = (Art.hash(x, y) * 8) | 0;
  const s = makeSprite(); setFrame(s, `tree${v}`);
  const p = iso(x + 0.5 + (Art.hash(y, x) - 0.5) * 0.3, y + 0.5 + (Art.hash(x + 7, y) - 0.5) * 0.3); s.position.set(p.x, p.y); s.zIndex = x + y + 1;
  objLayer.addChild(s); trees.set(i, s);
}
function removeTree(i) {
  const s = trees.get(i); if (!s) return;
  trees.delete(i);
  setFrame(s, "stump"); s.zIndex -= 0.6;
  burst(s.x, s.y - 14, 10, 0x5f8a3a, 1.2, 0.8);
}
function decodeBits(b64, out) {
  const bin = atob(b64);
  for (let i = 0; i < out.length; i++) out[i] = (bin.charCodeAt(i >> 3) >> (i & 7)) & 1;
}
function updateFog() {
  const img = fogCtx.createImageData(map.w, map.h), d = img.data;
  for (let i = 0; i < vis.length; i++) { if (vis[i]) explored[i] = 1; d[i * 4 + 3] = vis[i] ? 0 : explored[i] ? 130 : 255; }
  fogCtx.putImageData(img, 0, 0); fogTex.update();
  for (const [i, s] of trees) s.visible = explored[i] === 1;
}

// ------------------------------------------------------------------ snapshots
function startGame(pid) {
  me = pid; playing = true; sel.clear();
  for (const id of ["menu", "lobby"]) $(id).hidden = true;
  for (const id of ["top", "bottom", "mini", "help"]) $(id).hidden = false;
  if (me < 0) { for (const id of ["resign", "resbar"]) $(id).hidden = true; $("speedCtl").hidden = false; $("help").hidden = true; }
  setTimeout(() => ($("help").hidden = true), 20000);
}
const ent = (id) => snap?.map.get(id);
const kindOf = (e) => kinds[e[1]];
const isUnitE = (e) => KINDS[kindOf(e)].type === "unit";
const visibleAt = (x, y) => vis && vis[Math.floor(y) * map.w + Math.floor(x)] === 1;

function onSnap(s) {
  prev = snap; snap = s; snapAt = performance.now();
  s.map = new Map(s.ents.map((e) => [e[0], e]));
  decodeBits(s.vis, vis);
  if (s.ex) { const ex = new Uint8Array(vis.length); decodeBits(s.ex, ex); for (let i = 0; i < ex.length; i++) if (ex[i]) explored[i] = 1; }
  updateFog();
  if (!prev) centreOnTC();
  for (const i of s.trees) { map.wood[i] = 0; removeTree(i); }
  if (s.trees.length) drawMinimapBase();
  for (const f of s.fx) { arrows.push({ f, t: performance.now() }); Sfx.play("bow", hearing(iso(f[0], f[1])), 90); }
  occ = new Int32Array(map.w * map.h);
  for (const e of s.ents) { const k = KINDS[kindOf(e)]; if (k.type !== "unit") for (let j = 0; j < k.h; j++) for (let i = 0; i < k.w; i++) occ[(e[4] + j) * map.w + e[3] + i] = e[0]; }
  for (const e of s.ents) if (!sprites.has(e[0])) createSprite(e);
  for (const [id, sp] of sprites) if (!s.map.has(id)) { removeSprite(id, sp); sprites.delete(id); }
  for (const id of sel) if (!s.map.has(id)) sel.delete(id);
  sounds(s);
  updateHud();
  if (s.over && !$("end").dataset.shown) {
    $("end").dataset.shown = 1;
    const won = s.winner === me;
    if (me < 0) { $("end").hidden = false; $("endTitle").textContent = "Battle over"; $("endText").textContent = `${s.winner != null ? s.players[s.winner].name + " won" : "No winner"} after ${fmtClock(s.time)}.`; return; }
    Sfx.play(won ? "victory" : "defeat");
    setTimeout(() => { $("end").hidden = false; $("endTitle").textContent = won ? "Victory" : "Defeat"; $("endText").textContent = won ? `Your realm stands alone after ${fmtClock(s.time)}.` : `${s.winner != null ? s.players[s.winner].name + " won" : "The game ended"} after ${fmtClock(s.time)}.`; }, 1500);
  } else if (!s.over && s.players[me] && !s.players[me].alive && !$("end").dataset.shown) {
    $("end").dataset.shown = 1; Sfx.play("defeat"); $("end").hidden = false; $("endTitle").textContent = "Defeat"; $("endText").textContent = "All your buildings were destroyed.";
  }
}
function createSprite(e) {
  const kind = kindOf(e), k = KINDS[kind], sp = makeSprite();
  sp.kind = kind; sp.owner = e[2];
  if (kind === "farm") decal.addChildAt(sp, 0); else objLayer.addChild(sp);
  if (k.type !== "unit") { const p = iso(e[3] + k.w / 2, e[4] + k.h / 2); sp.position.set(p.x, p.y); sp.zIndex = e[3] + e[4] + (k.w + k.h) / 2; }
  sprites.set(e[0], sp);
}
function removeSprite(id, sp) {
  const last = prev?.map.get(id);
  const k = KINDS[sp.kind];
  if (k.type === "unit" && last) {
    if (visibleAt(last[3] / 100, last[4] / 100)) { // died (not just out of sight): play the death animation
      corpses.push({ sp, t: performance.now(), dir: dirOf(last[8]) });
      Sfx.play("death", hearing(sp), 150);
      return;
    }
  } else if (k.type === "building" && last && sp.kind !== "farm") {
    const p = iso(last[3] + k.w / 2, last[4] + k.h / 2);
    for (let i = 0; i < 6; i++) setTimeout(() => burst(p.x + (Math.random() - 0.5) * k.w * 30, p.y - 10, 14, 0x6a625a, 2.4, 2.2), i * 120);
    Sfx.play("collapse", hearing(p), 300);
  } else if (k.type === "resource") burst(sp.x, sp.y - 10, 8, 0xc9b58a, 1.2, 1);
  sp.destroy({ children: true });
}

// unit position interpolated between the last two snapshots
function pos(e) {
  if (!isUnitE(e)) return { x: e[3], y: e[4] };
  const p = prev?.map.get(e[0]);
  const a = Math.min(1, (performance.now() - snapAt) / 100);
  const x = e[3] / 100, y = e[4] / 100;
  return p ? { x: p[3] / 100 + (x - p[3] / 100) * a, y: p[4] / 100 + (y - p[4] / 100) * a } : { x, y };
}
const dirOf = (face) => ((Math.round(face / (Math.PI / 4)) % 8) + 8) % 8;
function lookAt(p) { cam.x = p.x - app.screen.width / 2 / cam.z; cam.y = p.y - app.screen.height / 2 / cam.z; }
function centreOnTC() { const tc = snap.ents.find((e) => (e[2] === me || me < 0) && kindOf(e) === "tc"); if (tc) lookAt(iso(tc[3] + 1.5, tc[4] + 1.5)); }
function hearing(p) { // volume by distance from the screen centre
  const cx = cam.x + app.screen.width / 2 / cam.z, cy = cam.y + app.screen.height / 2 / cam.z;
  const d = Math.hypot(p.x - cx, (p.y - cy) * 2) / (app.screen.width / cam.z);
  return Math.max(0, 1 - d * 1.2);
}

// sounds and alerts from state changes
let lastAlert = 0, alertAt = null;
function sounds(s) {
  if (!prev) return;
  for (const e of s.ents) {
    const p0 = prev.map.get(e[0]);
    if (!p0) { if (e[2] === me && isUnitE(e)) Sfx.play("trained", 0.8, 200); continue; }
    if (e[2] === me && !isUnitE(e) && p0[6] < 100 && e[6] >= 100) Sfx.play("built", 0.9, 300);
    if (e[2] === me && e[5] < p0[5] && performance.now() - lastAlert > 12000) {
      const p = isUnitE(e) ? iso(e[3] / 100, e[4] / 100) : iso(e[3], e[4]);
      if (hearing(p) < 0.25) { lastAlert = performance.now(); alertAt = p; Sfx.play("alert"); toast("You are under attack! (Space to jump there)"); }
    }
  }
}

// ------------------------------------------------------------------ helpers
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtClock = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
function toast(t) { const el = $("toast"); el.textContent = t; el.classList.add("on"); clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove("on"), 2600); }
function screenToWorld(sx, sy) { // screen px -> tile coords
  const lx = sx / cam.z + cam.x, ly = sy / cam.z + cam.y;
  return { x: (lx / HW + ly / HH) / 2, y: (ly / HH - lx / HW) / 2 };
}
const worldToScreen = (x, y) => { const p = iso(x, y); return { x: (p.x - cam.x) * cam.z, y: (p.y - cam.y) * cam.z }; };
const costText = (c) => Object.entries(c).map(([r, v]) => `${v} ${r}`).join(" · ");
const canAfford = (c) => snap?.res && Object.entries(c).every(([r, v]) => snap.res[r] >= v);
function pick(sx, sy) {
  let best = null, bd = 18 * cam.z;
  for (const e of snap.ents) if (isUnitE(e)) { const p = pos(e), s = worldToScreen(p.x, p.y); const d = Math.hypot(s.x - sx, s.y - 16 * cam.z - sy); if (d < bd) { bd = d; best = e; } }
  if (best) return best;
  const w = screenToWorld(sx, sy);
  for (const e of snap.ents) { const k = KINDS[kindOf(e)]; if (k.type !== "unit" && w.x >= e[3] && w.x < e[3] + k.w && w.y >= e[4] && w.y < e[4] + k.h) return e; }
  for (const e of snap.ents) { const sp = sprites.get(e[0]); if (sp && !isUnitE(e) && sp.base.containsPoint(new PIXI.Point(sx, sy))) return e; }
  return null;
}
function canPlaceClient(kind, x, y) {
  const k = KINDS[kind];
  for (let j = 0; j < k.h; j++) for (let i = 0; i < k.w; i++) {
    const tx = x + i, ty = y + j;
    if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
    const n = ty * map.w + tx;
    if (map.tile[n] === 1 || map.wood[n] || occ[n] || !explored[n]) return false;
  }
  return true;
}
const selected = () => [...sel].map(ent).filter(Boolean);
const myUnits = () => selected().filter((e) => e[2] === me && isUnitE(e));

// ------------------------------------------------------------------ input
const view = app.view;
view.addEventListener("mousemove", (e) => { mouse = { x: e.clientX, y: e.clientY, in: true }; if (drag && !drag.pan) { drag.x2 = e.clientX; drag.y2 = e.clientY; } });
view.addEventListener("mouseleave", () => (mouse.in = false));
view.addEventListener("wheel", (e) => {
  e.preventDefault();
  const trackpad = !e.ctrlKey && (e.deltaX !== 0 || (e.deltaMode === 0 && Math.abs(e.deltaY) < 40 && !Number.isInteger(e.deltaY / 4)));
  if (trackpad) { cam.x += e.deltaX / cam.z; cam.y += e.deltaY / cam.z; return; }
  const bx = e.clientX / cam.z + cam.x, by = e.clientY / cam.z + cam.y;
  cam.z = Math.min(2, Math.max(0.5, cam.z * (e.ctrlKey ? Math.exp(-e.deltaY * 0.01) : e.deltaY < 0 ? 1.1 : 0.9)));
  cam.x = bx - e.clientX / cam.z; cam.y = by - e.clientY / cam.z;
}, { passive: false });
view.addEventListener("mousedown", (e) => {
  if (!snap) return;
  Sfx.unlock();
  const w = screenToWorld(e.clientX, e.clientY);
  if (e.button === 2) return; // handled by the contextmenu event (works for mouse and touchpad)
  if (e.button === 0 && e.ctrlKey) { secondary(e.clientX, e.clientY); return; } // Ctrl+click = right-click (Mac)
  if (e.button === 1) { e.preventDefault(); drag = { pan: true, x1: e.clientX, y1: e.clientY, cx: cam.x, cy: cam.y }; return; }
  if (e.button !== 0) return;
  if (mode?.build) {
    const k = KINDS[mode.build], x = Math.floor(w.x - k.w / 2 + 0.5), y = Math.floor(w.y - k.h / 2 + 0.5);
    if (!canPlaceClient(mode.build, x, y)) return toast("Can't build there.");
    if (!canAfford(k.cost)) return toast(`Not enough resources (${costText(k.cost)}).`);
    cmd({ t: "build", ids: myUnits().filter((u) => kindOf(u) === "villager").map((u) => u[0]), kind: mode.build, x, y });
    Sfx.play("hammer", 0.7);
    if (!e.shiftKey) mode = null;
    return;
  }
  if (mode?.attackMove) { cmd({ t: "attackMove", ids: myUnits().map((u) => u[0]), x: w.x, y: w.y }); marks.push({ x: w.x, y: w.y, t: performance.now(), c: 0xe0674f }); mode = null; return; }
  drag = { x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY, shift: e.shiftKey };
});
addEventListener("mousemove", (e) => { if (drag?.pan) { cam.x = drag.cx - (e.clientX - drag.x1) / cam.z; cam.y = drag.cy - (e.clientY - drag.y1) / cam.z; } });
addEventListener("mouseup", (e) => {
  if (!drag) return;
  if (drag.pan) { drag = null; return; }
  if (e.button !== 0) return;
  const d = drag; drag = null;
  if (!d.shift) sel.clear();
  if (Math.abs(d.x2 - d.x1) < 5 && Math.abs(d.y2 - d.y1) < 5) {
    const p = pick(d.x1, d.y1);
    if (p) {
      if (e.detail === 2 && p[2] === me && isUnitE(p)) { for (const u of snap.ents) if (u[2] === me && u[1] === p[1] && onScreen(pos(u))) sel.add(u[0]); }
      else if (d.shift && sel.has(p[0])) sel.delete(p[0]); else sel.add(p[0]);
      Sfx.play("click", 0.6);
    }
  } else {
    const x0 = Math.min(d.x1, d.x2), x1 = Math.max(d.x1, d.x2), y0 = Math.min(d.y1, d.y2), y1 = Math.max(d.y1, d.y2);
    const inBox = snap.ents.filter((u) => { if (u[2] !== me || !isUnitE(u)) return false; const p = pos(u), s = worldToScreen(p.x, p.y); return s.x >= x0 && s.x <= x1 && s.y - 14 * cam.z >= y0 - 14 * cam.z && s.y - 14 * cam.z <= y1; });
    const army = inBox.filter((u) => kindOf(u) !== "villager");
    for (const u of army.length ? army : inBox) sel.add(u[0]);
    if (inBox.length) Sfx.play("click", 0.6);
  }
  renderCmds();
});
// tree under the cursor: the clicked tile, or a tree whose crown covers the cursor (trees stand below/in front of it)
function treeAt(sx, sy, wx, wy) {
  const tx = Math.floor(wx), ty = Math.floor(wy), pt = new PIXI.Point(sx, sy);
  let best = null, bz = -Infinity;
  for (let j = -1; j <= 3; j++) for (let i = -1; i <= 3; i++) {
    const x = tx + i, y = ty + j; if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
    const n = y * map.w + x, sp = trees.get(n);
    if (!map.wood[n] || !sp?.visible) continue;
    const b = sp.base.getBounds(); // crown: upper 75% of the sprite, narrowed to the leaves
    const inCrown = pt.x > b.x + b.width * 0.18 && pt.x < b.x + b.width * 0.62 && pt.y > b.y && pt.y < b.y + b.height * 0.8;
    if ((inCrown || (x === tx && y === ty)) && sp.zIndex > bz) { bz = sp.zIndex; best = { x, y }; }
  }
  return best;
}
function secondary(sx, sy) {
  if (mode) { mode = null; return; }
  const w = screenToWorld(sx, sy);
  rightClick(sx, sy, w.x, w.y);
}
function onScreen(p) { const s = worldToScreen(p.x, p.y); return s.x > 0 && s.y > 0 && s.x < app.screen.width && s.y < app.screen.height; }
function rightClick(sx, sy, wx, wy) {
  const units = myUnits();
  if (!units.length) {
    const b = selected().find((e) => e[2] === me && !isUnitE(e));
    if (b && KINDS[kindOf(b)].trains) { cmd({ t: "rally", id: b[0], x: wx, y: wy }); marks.push({ x: wx, y: wy, t: performance.now(), c: 0xe8b64c }); toast("Rally point set."); }
    return;
  }
  const ids = units.map((u) => u[0]);
  const t = pick(sx, sy);
  const tx = Math.floor(wx), ty = Math.floor(wy);
  if (t && t[0] !== ids[0]) { cmd({ t: "target", ids, id: t[0] }); marks.push({ x: wx, y: wy, t: performance.now(), c: t[2] >= 0 && t[2] !== me ? 0xe0674f : 0xe8b64c }); return; }
  const tree = treeAt(sx, sy, wx, wy);
  if (tree && units.some((u) => kindOf(u) === "villager")) { cmd({ t: "tree", ids, x: tree.x, y: tree.y }); marks.push({ x: tree.x + 0.5, y: tree.y + 0.5, t: performance.now(), c: 0xe8b64c }); return; }
  cmd({ t: "move", ids, x: wx, y: wy }); marks.push({ x: wx, y: wy, t: performance.now(), c: 0x6fbf73 });
}
addEventListener("keydown", (e) => {
  if (!playing || e.target.tagName === "INPUT") return;
  keys.add(e.key);
  const k = e.key.toLowerCase();
  if (k === "escape") { if (mode) mode = null; else { sel.clear(); renderCmds(); } }
  else if (HOTKEYS.includes(k)) { const b = $("cmds").querySelector(`[data-key="${k}"]`); if (b && !b.disabled) b.click(); }
  else if (k === "a" && myUnits().some((u) => kindOf(u) !== "villager")) { mode = { attackMove: true }; toast("Attack-move: left-click a target point."); }
  else if (k === "s") { const ids = myUnits().map((u) => u[0]); if (ids.length) cmd({ t: "stop", ids }); }
  else if (k === "h") { const tc = snap?.ents.find((x) => x[2] === me && kindOf(x) === "tc"); if (tc) { sel = new Set([tc[0]]); centreOnTC(); renderCmds(); } }
  else if (k === ".") selectIdle();
  else if (k === "m") $("mute").click();
  else if (k === "+" || k === "=") cam.z = Math.min(2, cam.z * 1.15);
  else if (k === "-") cam.z = Math.max(0.5, cam.z / 1.15);
  else if (k === " " && alertAt) { e.preventDefault(); lookAt(alertAt); }
});
addEventListener("keyup", (e) => keys.delete(e.key));
let idleIdx = 0;
function selectIdle() {
  const idle = snap.ents.filter((e) => e[2] === me && kindOf(e) === "villager" && e[7] === 0 && e[6] < 0 && prev?.map.get(e[0])?.[7] === 0);
  if (!idle.length) return toast("No idle villagers.");
  const v = idle[idleIdx++ % idle.length]; sel = new Set([v[0]]);
  const p = pos(v); lookAt(iso(p.x, p.y)); renderCmds();
}

// ------------------------------------------------------------------ HUD
let lastCmdKey = "";
function updateHud() {
  $("players").innerHTML = snap.players.map((p, i) => `<span class="${p.alive ? "" : "dead"}"><b style="background:${p.color}"></b>${esc(p.name)}${i === me ? " (you)" : ""}</span>`).join("");
  $("clock").textContent = fmtClock(snap.time);
  const r = snap.res; if (!r) { renderInfo(selected()); return; }
  $("rFood").textContent = r.food; $("rWood").textContent = r.wood; $("rGold").textContent = r.gold;
  $("rPop").textContent = `${r.pop}/${r.cap}`; $("rPop").style.color = r.pop >= r.cap ? "var(--bad)" : "";
  $("clock").textContent = fmtClock(snap.time);
  $("players").innerHTML = snap.players.map((p, i) => `<span class="${p.alive ? "" : "dead"}"><b style="background:${p.color}"></b>${esc(p.name)}${i === me ? " (you)" : ""}</span>`).join("");
  const s = selected();
  const key = s.map((e) => e[0] + ":" + (isUnitE(e) ? "" : JSON.stringify(e[8]) + e[6])).join() + "|" + r.food + r.wood + r.gold;
  renderInfo(s);
  if (key !== lastCmdKey) { lastCmdKey = key; renderCmds(); }
}
function renderInfo(s) {
  if (!s.length) { $("info").innerHTML = `<h3>Nothing selected</h3><div class="sub">Drag over your units, or click a building.</div>`; return; }
  if (s.length > 1) {
    const counts = {}; for (const e of s) counts[kindOf(e)] = (counts[kindOf(e)] ?? 0) + 1;
    $("info").innerHTML = `<h3>${s.length} units</h3><div class="sub">${Object.entries(counts).map(([k, n]) => `${n} ${NAMES[k]}${n > 1 ? "s" : ""}`).join(", ")}</div>`;
    return;
  }
  const e = s[0], kind = kindOf(e), k = KINDS[kind];
  const owner = e[2] >= 0 ? snap.players[e[2]]?.name : "Nature";
  let html = `<h3>${NAMES[kind]}</h3><div class="sub">${esc(owner)}</div>`;
  if (k.type === "resource") html += `<div class="sub">${e[7]} ${k.res} left</div>`;
  else {
    html += `<div class="hpbar"><div style="width:${Math.max(0, Math.min(100, (e[5] / k.hp) * 100))}%"></div></div><div class="sub">HP ${e[5]}/${k.hp}${k.atk ? ` · attack ${k.atk}` : ""}${k.armor ? ` · armour ${k.armor}` : ""}</div>`;
    if (k.type === "unit" && e[6] >= 0) html += `<div class="sub">Carrying ${["food", "wood", "gold"][e[6]]}</div>`;
    if (k.type === "building" && e[6] < 100) html += `<div class="sub">Under construction: ${e[6]}%</div>`;
    if (kind === "farm" && e[6] >= 100) html += `<div class="sub">${e[7]} food left</div>`;
  }
  $("info").innerHTML = html;
}
function renderCmds() {
  const box = $("cmds"); box.innerHTML = "";
  if (!snap) return;
  const s = selected().filter((e) => e[2] === me);
  if (!s.length) return;
  const add = (label, sub, hk, onclick, enabled = true) => {
    const b = document.createElement("button"); b.className = "cmd"; b.dataset.key = hk ?? "";
    b.innerHTML = `<span>${label}${hk ? ` <kbd>${hk.toUpperCase()}</kbd>` : ""}</span><small>${sub}</small>`;
    b.disabled = !enabled; b.onclick = () => { Sfx.play("click", 0.5); onclick(); }; box.append(b);
  };
  const units = s.filter(isUnitE);
  if (units.length) {
    if (units.some((u) => kindOf(u) === "villager")) KEYS.villager.forEach((kind, i) => add(`Build ${NAMES[kind]}`, costText(KINDS[kind].cost), HOTKEYS[i], () => { mode = { build: kind }; }, canAfford(KINDS[kind].cost)));
    if (units.some((u) => kindOf(u) !== "villager")) add("Attack-move", "attack anything on the way", "a", () => { mode = { attackMove: true }; });
    add("Stop", "cancel orders", "s", () => cmd({ t: "stop", ids: units.map((u) => u[0]) }));
    return;
  }
  const b = s[0], kind = kindOf(b);
  if (b[6] < 100) return;
  (KEYS[kind] ?? []).forEach((u, i) => add(`Train ${NAMES[u]}`, `${costText(KINDS[u].cost)} · ${KINDS[u].time}s`, HOTKEYS[i], () => {
    if (!canAfford(KINDS[u].cost)) return toast(`Not enough resources (${costText(KINDS[u].cost)}).`);
    cmd({ t: "train", id: b[0], kind: u });
  }, canAfford(KINDS[u].cost)));
  if (b[8]) {
    const [q, p] = b[8];
    const row = document.createElement("div"); row.className = "queue";
    row.innerHTML = q.map((u, i) => `<span class="qi" title="Click to cancel">${NAMES[u]}${i === 0 ? `<span class="p" style="width:${p}%"></span>` : ""}</span>`).join("");
    row.querySelectorAll(".qi").forEach((el) => (el.onclick = () => cmd({ t: "cancel", id: b[0] })));
    box.append(row);
    if (snap.res.pop >= snap.res.cap) toast("Population limit reached: build a House.");
  }
  if (KINDS[kind].trains) { const n = document.createElement("small"); n.style.color = "var(--muted)"; n.textContent = "Right-click the map to set a rally point."; box.append(n); }
}

// ------------------------------------------------------------------ particles
function burst(x, y, n, color, size = 1, life = 1) {
  for (let i = 0; i < n; i++) spawn(x, y, { vx: (Math.random() - 0.5) * 40, vy: -10 - Math.random() * 30, color, size: size * (0.5 + Math.random() * 0.6), life: life * (0.6 + Math.random() * 0.6), grow: 0.6, gravity: 20 });
}
function spawn(x, y, o) {
  if (particles.length > 700) return;
  const sp = new PIXI.Sprite(dotTex); sp.anchor.set(0.5); sp.tint = o.color; sp.position.set(x, y); sp.scale.set(o.size * 0.5);
  fxLayer.addChild(sp); particles.push({ sp, age: 0, ...o });
}
function stepParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; p.age += dt;
    if (p.age >= p.life) { p.sp.destroy(); particles.splice(i, 1); continue; }
    p.vy += (p.gravity ?? 0) * dt; p.sp.x += p.vx * dt; p.sp.y += p.vy * dt;
    const f = p.age / p.life; p.sp.alpha = (1 - f) * (p.alpha ?? 0.8); p.sp.scale.set(Math.max(0.05, p.size * 0.5 * (1 + f * (p.grow ?? 0))));
  }
}

// ------------------------------------------------------------------ frame
let lastT = performance.now(), ghostSprite = null;
app.ticker.add(() => {
  const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  embersStep(dt);
  if (!snap || !ready) return;
  scroll();
  world.scale.set(cam.z); world.position.set(-cam.x * cam.z, -cam.y * cam.z);
  const t = now / 1000;
  ringG.clear(); barG.clear(); ghostG.clear(); screenUi.clear();

  for (const e of snap.ents) {
    const sp = sprites.get(e[0]); if (!sp) continue;
    const kind = kindOf(e), k = KINDS[kind], tint = TINT[e[2]] ?? 0xffffff;
    if (k.type === "unit") {
      const p = pos(e), s = iso(p.x, p.y);
      sp.position.set(s.x, s.y); sp.zIndex = p.x + p.y;
      const act = e[7], d = dirOf(e[8]);
      let anim = "idle", n = 1, fps = 1;
      if (act === 4) { anim = "walk"; n = 8; fps = 11; }
      else if (act === 1) { anim = "attack"; n = 6; fps = kind === "archer" ? 4 : 6; }
      else if (act === 2 || act === 3) { anim = kind === "villager" ? "work" : "attack"; n = 6; fps = 7; }
      const fi = Math.floor(t * fps + e[0] * 0.37) % n;
      setFrame(sp, `${kind}_${anim}_${d}_${fi}`, tint);
      if (onScreenPx(s)) {
        if (act === 4 && Math.random() < 0.04) spawn(s.x, s.y, { vx: (Math.random() - 0.5) * 8, vy: -6, color: 0xb59a6a, size: 0.7, life: 0.7, grow: 1.2, alpha: 0.35 });
        if ((act === 2 || act === 3) && fi === 4) {
          if (!sp.hitFrame) {
            sp.hitFrame = true;
            const hx = s.x + Math.cos(e[8]) * 8 - Math.sin(e[8]) * 8, hy = s.y - 8;
            if (act === 3) { burst(hx, hy, 3, 0xc9a774, 0.6, 0.5); Sfx.play("hammer", hearing(s) * 0.6, 220); }
            else if (e[6] === 2 || nearKind(p, "gold")) { burst(hx, hy, 4, 0xf2c84b, 0.4, 0.5); Sfx.play("mine", hearing(s) * 0.5, 220); }
            else if (nearTree(p)) { burst(hx, hy, 4, 0x8a5a30, 0.5, 0.6); Sfx.play("chop", hearing(s) * 0.6, 200); }
          }
        } else sp.hitFrame = false;
        if (act === 1 && kind === "swordsman" && fi === 3) Sfx.play("clash", hearing(s) * 0.6, 260);
      }
      if (sel.has(e[0])) ring(s.x, s.y, 13, 6.5, e[2] === me ? 0xf3ead7 : 0xe0674f);
      if (sel.has(e[0]) || e[5] < k.hp) bar(s.x - 11, s.y - 46, 22, e[5] / k.hp);
    } else {
      const c = iso(e[3] + k.w / 2, e[4] + k.h / 2);
      if (k.type === "resource") setFrame(sp, `${kind}${e[0] % 3}`);
      else {
        const built = e[6] / 100;
        if (built < 1 && kind !== "farm") { if (built > 0.5) { setFrame(sp, kind, tint); sp.alpha = 0.45 + built * 0.4; } else { setFrame(sp, k.w === 3 ? "found3" : "found2", tint); sp.alpha = 1; } }
        else { setFrame(sp, kind, tint); sp.alpha = built < 1 ? 0.6 : 1; }
        if (built >= 1 && e[5] < k.hp * 0.5 && onScreenPx(c)) { // burning
          const fire = 1 - e[5] / (k.hp * 0.5);
          if (Math.random() < 0.25 + fire * 0.5) spawn(c.x + (Math.random() - 0.5) * k.w * 26, c.y - 30 - Math.random() * 20, { vx: (Math.random() - 0.5) * 6, vy: -28, color: Math.random() < 0.5 ? 0xff8a2a : 0xffc14a, size: 0.8 + fire * 0.6, life: 0.5, grow: -0.4, alpha: 0.9 });
          if (Math.random() < 0.3) spawn(c.x + (Math.random() - 0.5) * k.w * 20, c.y - 50, { vx: 8 + Math.random() * 6, vy: -22, color: 0x4a4440, size: 1.4, life: 2.2, grow: 1.8, alpha: 0.45 });
        }
        if (kind === "house" && built >= 1 && Math.random() < 0.03 && onScreenPx(c)) spawn(c.x - 4, c.y - 62, { vx: 5, vy: -10, color: 0xcfc8c0, size: 0.7, life: 2.5, grow: 2, alpha: 0.28 }); // chimney smoke
      }
      if (sel.has(e[0])) { const pts = [iso(e[3], e[4]), iso(e[3] + k.w, e[4]), iso(e[3] + k.w, e[4] + k.h), iso(e[3], e[4] + k.h)]; ringG.lineStyle(2, e[2] === me ? 0xf3ead7 : e[2] < 0 ? 0xe8b64c : 0xe0674f, 0.9); ringG.drawPolygon(pts.flatMap((q) => [q.x, q.y])); }
      if (k.type === "building" && (sel.has(e[0]) || e[5] < k.hp * 0.999) && e[6] >= 100) bar(c.x - k.w * 14, c.y - k.h * 16 - 60, k.w * 28, e[5] / k.hp);
      if (k.type === "building" && e[6] < 100) bar(c.x - k.w * 14, c.y + 8, k.w * 28, e[6] / 100, 0xe8b64c);
      if (sel.has(e[0]) && e[2] === me && e[8] && e[8][0].length) bar(c.x - k.w * 14, c.y + 14, k.w * 28, e[8][1] / 100, 0x6fa8ff);
    }
  }
  // corpses
  for (let i = corpses.length - 1; i >= 0; i--) {
    const c = corpses[i], age = (now - c.t) / 1000;
    setFrame(c.sp, `${c.sp.kind}_death_${c.dir}_${Math.min(5, Math.floor(age * 9))}`);
    c.sp.alpha = age > 6 ? Math.max(0, 1 - (age - 6) / 4) : 1;
    if (age > 10) { c.sp.destroy({ children: true }); corpses.splice(i, 1); }
  }
  // arrows (arc in screen space)
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i], f = (now - a.t) / 420;
    if (f >= 1) { a.sp?.destroy(); arrows.splice(i, 1); continue; }
    if (!a.sp) { a.sp = new PIXI.Sprite(arrowTex); a.sp.anchor.set(0.5); fxLayer.addChild(a.sp); }
    const p0 = iso(a.f[0], a.f[1]), p1 = iso(a.f[2], a.f[3]), h = Math.hypot(p1.x - p0.x, p1.y - p0.y) * 0.25;
    const x = p0.x + (p1.x - p0.x) * f, y = p0.y + (p1.y - p0.y) * f - 22 - Math.sin(f * Math.PI) * h;
    const dy = (p1.y - p0.y) - Math.cos(f * Math.PI) * Math.PI * h;
    a.sp.position.set(x, y); a.sp.rotation = Math.atan2(dy, p1.x - p0.x);
  }
  stepParticles(dt);
  marks = marks.filter((m) => now - m.t < 700);
  for (const m of marks) { const f = (now - m.t) / 700, p = iso(m.x, m.y); ringG.lineStyle(2, m.c, 1 - f); ringG.drawEllipse(p.x, p.y, 6 + f * 14, 3 + f * 7); }
  if (mode?.build) drawGhost(); else if (ghostSprite) ghostSprite.visible = false;
  if (drag && !drag.pan && (Math.abs(drag.x2 - drag.x1) > 4 || Math.abs(drag.y2 - drag.y1) > 4)) {
    screenUi.lineStyle(1, 0xe8d9a8, 1); screenUi.beginFill(0xe8d9a8, 0.08);
    screenUi.drawRect(Math.min(drag.x1, drag.x2), Math.min(drag.y1, drag.y2), Math.abs(drag.x2 - drag.x1), Math.abs(drag.y2 - drag.y1)); screenUi.endFill();
  }
  view.style.cursor = mode?.attackMove ? "crosshair" : mode?.build ? "copy" : "default";
  if (frameCount++ % 3 === 0) drawMinimap();
});
let frameCount = 0;
function nearTree(p) { const x = Math.floor(p.x), y = Math.floor(p.y); for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const tx = x + i, ty = y + j; if (tx >= 0 && ty >= 0 && tx < map.w && ty < map.h && map.wood[ty * map.w + tx]) return true; } return false; }
function nearKind(p, kind) { const x = Math.floor(p.x), y = Math.floor(p.y); for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const id = occ[(y + j) * map.w + x + i]; if (id && kindOf(snap.map.get(id) ?? [0, -1]) === kind) return true; } return false; }
function onScreenPx(p) { return p.x > cam.x - 60 && p.y > cam.y - 60 && p.x < cam.x + app.screen.width / cam.z + 60 && p.y < cam.y + app.screen.height / cam.z + 100; }
function ring(x, y, rx, ry, c) { ringG.lineStyle(1.6, c, 0.95); ringG.drawEllipse(x, y, rx, ry); }
function bar(x, y, w, f, c) { barG.beginFill(0x000000, 0.6); barG.drawRect(x - 1, y - 1, w + 2, 5); barG.endFill(); barG.beginFill(c ?? (f > 0.5 ? 0x6fbf73 : f > 0.25 ? 0xe8b64c : 0xe0674f)); barG.drawRect(x, y, w * Math.max(0, Math.min(1, f)), 3); barG.endFill(); }
function scroll() {
  const sp = 16 / cam.z, W = app.screen.width, H = app.screen.height;
  if (keys.has("ArrowLeft") || (mouse.in && mouse.x < 8)) cam.x -= sp;
  if (keys.has("ArrowRight") || (mouse.in && mouse.x > W - 8)) cam.x += sp;
  if (keys.has("ArrowUp") || (mouse.in && mouse.y < 8)) cam.y -= sp;
  if (keys.has("ArrowDown") || (mouse.in && mouse.y > H - 8)) cam.y += sp;
  const minX = iso(0, map.h).x - 200, maxX = iso(map.w, 0).x - W / cam.z + 200, maxY = iso(map.w, map.h).y - H / cam.z + 260;
  cam.x = Math.max(minX, Math.min(maxX, cam.x)); cam.y = Math.max(-200, Math.min(maxY, cam.y));
}
function drawGhost() {
  const w = screenToWorld(mouse.x, mouse.y), k = KINDS[mode.build];
  const x = Math.floor(w.x - k.w / 2 + 0.5), y = Math.floor(w.y - k.h / 2 + 0.5);
  const ok = canPlaceClient(mode.build, x, y), col = ok ? 0x6fbf73 : 0xe0674f;
  for (let j = 0; j < k.h; j++) for (let i = 0; i < k.w; i++) { const pts = [iso(x + i, y + j), iso(x + i + 1, y + j), iso(x + i + 1, y + j + 1), iso(x + i, y + j + 1)]; ghostG.lineStyle(1, col, 0.8); ghostG.beginFill(col, 0.25); ghostG.drawPolygon(pts.flatMap((q) => [q.x, q.y])); ghostG.endFill(); }
  if (!ghostSprite) { ghostSprite = makeSprite(); uiLayer.addChildAt(ghostSprite, 0); }
  ghostSprite.visible = true; setFrame(ghostSprite, mode.build, TINT[me]); ghostSprite.alpha = 0.55; ghostSprite.base.tint = ok ? 0xffffff : 0xff9a8a;
  const c = iso(x + k.w / 2, y + k.h / 2); ghostSprite.position.set(c.x, c.y);
}

// ------------------------------------------------------------------ minimap (isometric diamond, 200 x 100)
const mm = $("minimap"), mctx = mm.getContext("2d");
let mmBase = null, mmA = 1.25;
function drawMinimapBase() {
  mmBase = document.createElement("canvas"); mmBase.width = map.w; mmBase.height = map.h;
  const g = mmBase.getContext("2d"), img = g.createImageData(map.w, map.h);
  for (let i = 0; i < map.w * map.h; i++) { const [r, gg, b] = map.tile[i] === 1 ? [40, 90, 140] : map.wood[i] ? [32, 72, 36] : [92, 128, 66]; img.data.set([r, gg, b, 255], i * 4); }
  g.putImageData(img, 0, 0);
}
const mmProj = (x, y) => [(x - y) * mmA + map.h * mmA, (x + y) * mmA / 2];
function drawMinimap() {
  if (!mmBase) return;
  mmA = 200 / (map.w + map.h);
  mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.clearRect(0, 0, mm.width, mm.height);
  mctx.setTransform(mmA, mmA / 2, -mmA, mmA / 2, map.h * mmA, 0);
  mctx.imageSmoothingEnabled = false; mctx.drawImage(mmBase, 0, 0);
  if (fogCtx) mctx.drawImage(fogCtx.canvas, 0, 0);
  for (const e of snap.ents) {
    const k = KINDS[kindOf(e)];
    mctx.fillStyle = e[2] >= 0 ? COLORS[e[2]] : kindOf(e) === "gold" ? "#f2c84b" : "#d6404f";
    if (k.type === "unit") mctx.fillRect(e[3] / 100 - 0.8, e[4] / 100 - 0.8, 1.6, 1.6); else mctx.fillRect(e[3], e[4], k.w, k.h);
  }
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  const corners = [[0, 0], [app.screen.width, 0], [app.screen.width, app.screen.height], [0, app.screen.height]].map(([x, y]) => { const w = screenToWorld(x, y); return mmProj(w.x, w.y); });
  mctx.strokeStyle = "#fff"; mctx.lineWidth = 1; mctx.beginPath(); corners.forEach(([x, y], i) => (i ? mctx.lineTo(x, y) : mctx.moveTo(x, y))); mctx.closePath(); mctx.stroke();
}
mm.addEventListener("contextmenu", (e) => { e.preventDefault(); mmClick(e, true); });
mm.addEventListener("mousedown", (e) => { if (e.button === 0 && !e.ctrlKey) mmClick(e, false); else if (e.button === 0) mmClick(e, true); });
function mmClick(e, secondaryClick) {
  if (!map) return;
  const r = mm.getBoundingClientRect(), u = ((e.clientX - r.left) / r.width) * mm.width - map.h * mmA, v = ((e.clientY - r.top) / r.height) * mm.height;
  const wx = (u / mmA + (2 * v) / mmA) / 2, wy = ((2 * v) / mmA - u / mmA) / 2;
  if (secondaryClick) { const ids = myUnits().map((x) => x[0]); if (ids.length) cmd({ t: "move", ids, x: wx, y: wy }); return; }
  lookAt(iso(wx, wy));
}

// ------------------------------------------------------------------ title backdrop
for (let i = 0; i < 50; i++) { const s = new PIXI.Sprite(dotTex); s.anchor.set(0.5); s.tint = 0xe8a040; s.alpha = 0.3 + Math.random() * 0.5; s.scale.set(0.15 + Math.random() * 0.25); s.v = 15 + Math.random() * 40; s.position.set(Math.random() * app.screen.width, Math.random() * app.screen.height); embers.addChild(s); }
function embersStep(dt) {
  embers.visible = !snap; if (snap) return;
  for (const s of embers.children) { s.y -= s.v * dt; s.x += Math.sin(s.y / 40) * 0.3; if (s.y < -10) { s.y = app.screen.height + 10; s.x = Math.random() * app.screen.width; } }
}

// test hook: /#autoplay starts a single-player game immediately (used for headless screenshots)
if (location.hash.startsWith("#autoplay")) setTimeout(() => $("playSingle").click(), 300);
if (location.hash.startsWith("#autowatch")) setTimeout(() => connect({ t: "watch", diff: "hard", ais: 1, speed: 8 }), 300);
// test hooks for headless screenshots
window.__er = { look: (x, y) => lookAt(iso(x, y)), toScreen: (x, y) => worldToScreen(x, y), wood: (i) => map.wood[i], w: () => map.w, snap: () => snap, kinds: () => kinds, zoom: (z) => (cam.z = z) };
