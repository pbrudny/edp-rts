// Ember Realms client: PixiJS (WebGL) isometric renderer + HUD + input. Server is authoritative.
import { KINDS, COLORS, TECHS, BUILDABLE, AGES, MARKET, MAPS, ageOf, line, stat, costOf, timeOf } from "/shared/sim.js";
import * as Art from "/art.js";
import * as Sfx from "/sfx.js";

const PIXI = window.PIXI;
const $ = (id) => document.getElementById(id);
const HW = 32, HH = 16; // half tile width/height in screen px (64 x 32 diamond)
const iso = (x, y) => ({ x: (x - y) * HW, y: (x + y) * HH });
const NAMES = { villager: "Villager", swordsman: "Swordsman", spearman: "Spearman", archer: "Archer", cavalry: "Cavalry", knight: "Knight", crossbowman: "Crossbowman", ram: "Battering ram", market: "Market", wall: "Wall", gate: "Gate", tower: "Tower", tc: "Town Centre", house: "House", barracks: "Barracks", storehouse: "Storehouse", farm: "Farm", workshop: "Workshop", gold: "Gold mine", berries: "Berry bush" };
for (const [id, t] of Object.entries(TECHS)) NAMES[id] = t.name;
const TIPS = { swordsman: "All-rounder. Strong against spearmen and buildings.", spearman: "Cheap. Strong against cavalry.", archer: "Ranged. Strong against spearmen.", cavalry: "Fast and tough. Strong against archers and rams.", ram: "Only attacks buildings, but hits them very hard. Arrows barely hurt it; kill it in melee.", villager: "Gathers resources and builds.", knight: "Heavy cavalry. Strong against archers, crossbowmen and rams; weak against spearmen.", crossbowman: "Ranged, tougher than archers. Strong against spearmen.",
  wall: "Drag to draw a line of wall. Arrows barely scratch it; rams and swordsmen break it.", gate: "Your units and allies walk through, enemies can't. Place it on one of your wall pieces to swap it in.",
  tower: "Shoots arrows at enemy units in range.", market: "Buy and sell food and wood for gold, and send resources to allies." };
const HOTKEYS = ["q", "w", "e", "r", "t", "y", "u", "i", "o"];
const STANCES = [["aggressive", "Aggressive", "chase enemies in sight", "z"], ["defensive", "Defensive", "chase a bit, then return", "x"], ["stand", "Stand ground", "fight only in range", "c"]];
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
let ws, live = false, map = null, kinds = [], me = -1, snap = null, prev = null, snapAt = 0, playing = false;
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
    if (m.t === "error") { if (m.rejoin === false) return rejoinFailed(); $("err").textContent = m.msg; toast(m.msg); if (m.started) $("spectate").classList.add("hint"); }
    else if (m.t === "session") saveSession(m);
    else if (m.t === "notice") toast(m.msg);
    else if (m.t === "lobby") showLobby(m);
    else if (m.t === "map") { if (!map) setMap(m); } // a reconnect resends the map of the game we already have
    else if (m.t === "start") { reconnectUntil = 0; live = !!m.live; startGame(m.me); }
    else if (m.t === "s") { if (ready) onSnap(m); else pendingSnap = m; }
    else if (m.t === "stats") showStats(m);
    else if (m.t === "chat") addChat(m);
    else if (m.t === "mark") onMark(m);
  };
  const beat = setInterval(() => ws.readyState === 1 && ws.send('{"t":"ping"}'), 25000); // keep idle lobby alive behind the proxy
  ws.onclose = (ev) => {
    clearInterval(beat);
    if (ev.code === 4000) { playing = false; return toast("This game is now open in another tab."); }
    if (playing && !snap?.over && me >= 0 && session()) { // try to take our slot back for up to 60 s
      if (!reconnectUntil) { reconnectUntil = Date.now() + 60000; toast("Connection lost. Reconnecting…"); }
      if (Date.now() < reconnectUntil) setTimeout(() => connect({ t: "rejoin", ...session() }), 2000); else toast("Couldn't reconnect to the game.");
    } else if (playing && !snap?.over) toast("Connection lost.");
    else if (rejoining && !playing) rejoinFailed();
    else if (!playing) { $("err").textContent = "Connection lost, create the game again."; if (!$("lobby").hidden) { $("lobby").hidden = true; $("menu").hidden = false; } }
  };
}
// ------------------------------------------------------------------ session (rejoin after reload / network drop)
let reconnectUntil = 0, rejoining = false;
const session = () => { try { const v = JSON.parse(localStorage.getItem("er-session")); return v && Date.now() - v.at < 3 * 3600e3 ? { code: v.code, token: v.token } : null; } catch { return null; } };
const saveSession = (m) => { try { localStorage.setItem("er-session", JSON.stringify({ code: m.code, token: m.token, at: Date.now() })); } catch {} };
const clearSession = () => { try { localStorage.removeItem("er-session"); } catch {} };
function rejoinFailed() {
  clearSession(); rejoining = false; reconnectUntil = 0;
  $("loading").hidden = true;
  if (playing) { toast("The game has ended."); return; }
  $("menu").hidden = false; $("err").textContent = "Your previous game has ended.";
}
let ready = false;
const send = (m) => ws?.readyState === 1 && ws.send(JSON.stringify(m));
const cmd = (c) => send({ t: "cmd", c });

// ------------------------------------------------------------------ menu / lobby
const nameVal = () => $("name").value.trim() || "Commander";
try { $("name").value = localStorage.getItem("er-name") ?? ""; } catch {}
const saveName = () => { try { localStorage.setItem("er-name", $("name").value.trim()); } catch {} };
// map choice: the select in the menu is used for single player, AI battles and new lobbies
$("mapSel").innerHTML = $("lobbyMap").innerHTML = Object.entries(MAPS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
try { $("mapSel").value = localStorage.getItem("er-map") || "lakes"; } catch {}
$("mapSel").onchange = () => { try { localStorage.setItem("er-map", $("mapSel").value); } catch {} };
$("lobbyMap").onchange = () => send({ t: "map", map: $("lobbyMap").value });
$("watch").onclick = () => connect({ t: "watch", diff: $("diff").value, ais: $("ais").value, speed: 2, map: $("mapSel").value });
$("spectate").onclick = () => { saveName(); const c = $("joinCode").value.trim().toUpperCase(); if (c.length === 4) connect({ t: "spectate", code: c, name: nameVal() }); else $("err").textContent = "Enter the 4-letter code."; };
$("speed").onchange = () => send({ t: "speed", speed: +$("speed").value });
$("playSingle").onclick = () => { saveName(); connect({ t: "single", name: nameVal(), diff: $("diff").value, ais: $("ais").value, peaceful: $("mode").value === "peaceful", map: $("mapSel").value, teams: $("teamsRow").hidden ? "ffa" : $("teams").value }); };
$("mode").onchange = $("ais").onchange = () => { // peaceful: the other players are allies, and difficulty doesn't matter
  const p = $("mode").value === "peaceful";
  for (const o of $("ais").options) o.textContent = `${o.value} ${p ? (o.value === "1" ? "ally" : "allies") : o.value === "1" ? "opponent" : "opponents"}`;
  $("diff").hidden = p; $("modeHint").hidden = !p;
  $("teamsRow").hidden = p || +$("ais").value < 2; // teams need at least two computer players
};
$("create").onclick = () => { saveName(); connect({ t: "create", name: nameVal(), public: $("pub").checked, map: $("mapSel").value }); };
$("lobbyPub").onchange = () => send({ t: "public", on: $("lobbyPub").checked });
$("lobbySend").onclick = () => { const v = $("lobbyMsg").value.trim(); if (v) send({ t: "chat", text: v }); $("lobbyMsg").value = ""; };
$("lobbyMsg").onkeydown = (e) => e.key === "Enter" && $("lobbySend").click();
$("join").onclick = () => { saveName(); const c = $("joinCode").value.trim().toUpperCase(); if (c.length === 4) connect({ t: "join", code: c, name: nameVal() }); else $("err").textContent = "Enter the 4-letter code."; };
$("joinCode").onkeydown = (e) => e.key === "Enter" && $("join").click();
$("addAI").onclick = () => send({ t: "addAI", diff: $("aiDiff").value });
$("start").onclick = () => send({ t: "start" });
$("leave").onclick = () => { clearSession(); location.href = "/"; };
$("again").onclick = () => { clearSession(); location.href = "/"; };
$("copyInvite").onclick = () => { $("inviteLink").select(); navigator.clipboard?.writeText($("inviteLink").value).then(() => toast("Invite link copied."), () => toast("Select the link and copy it.")); };
let resignArm = 0, peacefulStart = false;
$("resign").onclick = () => { if (Date.now() - resignArm < 3000) cmd({ t: "resign" }); else { resignArm = Date.now(); toast(snap?.peaceful ? "Click End game again to finish and see your stats." : "Click Resign again to confirm."); } };
$("mute").onclick = () => { $("mute").textContent = Sfx.toggleMute() ? "Sound off" : "Sound on"; };
$("mute").textContent = Sfx.isMuted() ? "Sound off" : "Sound on";

let wasHost = false;
function showLobby(m) {
  $("menu").hidden = true; $("lobby").hidden = false;
  $("lobbyCode").textContent = m.code;
  $("inviteLink").value = `${location.origin}/?join=${m.code}`;
  if (location.search) history.replaceState(null, "", "/");
  const amHost = m.you === m.host;
  if (amHost && !wasHost && lobbySeen) toast("The host left. You are the host now.");
  wasHost = amHost; lobbySeen = true;
  const teamSel = (s, i) => `<select data-team="${i}" aria-label="Team of ${esc(s.name)}" style="margin-left:auto" ${amHost || i === m.you ? "" : "disabled"}>${[0, 1, 2, 3].map((t) => `<option value="${t}" ${s.team === t ? "selected" : ""}>Team ${t + 1}</option>`).join("")}</select>`;
  $("slots").innerHTML = m.slots.map((s, i) => `<div class="slot"><b style="background:${COLORS[i]}"></b>${esc(s.name)}${s.ai ? ` <small>(${s.ai})</small>` : ""}${i === m.host ? " <small>host</small>" : ""}${i === m.you ? " <small>(you)</small>" : ""}${teamSel(s, i)}${amHost && s.ai ? ` <button data-kick="${i}">Remove</button>` : ""}</div>`).join("");
  $("slots").querySelectorAll("[data-kick]").forEach((b) => (b.onclick = () => send({ t: "kick", slot: +b.dataset.kick })));
  $("slots").querySelectorAll("[data-team]").forEach((el) => (el.onchange = () => send({ t: "team", slot: +el.dataset.team, team: +el.value })));
  $("pubCtl").hidden = !amHost; $("lobbyPub").checked = !!m.public;
  $("lobbyMap").value = m.map ?? "lakes"; $("lobbyMap").disabled = !amHost;
  const teams = new Set(m.slots.map((s) => s.team));
  $("hostCtl").hidden = !amHost; $("waitHost").hidden = amHost;
  $("start").disabled = m.slots.length < 2 || teams.size < 2;
  $("start").title = teams.size < 2 && m.slots.length >= 2 ? "Everyone is on the same team" : "";
}

let lobbySeen = false;

// ------------------------------------------------------------------ chat
const chatLines = [];
function addChat(m) {
  const line = { at: Date.now(), html: `${m.team ? `<span class="to">TEAM</span>` : ""}<b class="dot" style="background:${m.color >= 0 ? COLORS[m.color] : "#888"}"></b><b>${esc(m.from)}:</b> ${esc(m.text)}` };
  chatLines.push(line); if (chatLines.length > 40) chatLines.shift();
  const div = document.createElement("div"); div.innerHTML = line.html;
  $("lobbyChat").append(div); $("lobbyChat").scrollTop = 1e9;
  renderChat(); if (playing) Sfx.play("chat", 0.7, 100);
}
function renderChat() { // in game: the last 6 lines, fading out after 15 s unless the chat box is open
  $("chatLog").innerHTML = chatLines.slice(-6).map((l) => `<div class="${Date.now() - l.at > 15000 ? "old" : ""}">${l.html}</div>`).join("");
}
setInterval(() => playing && renderChat(), 2000);
function openChat(team) {
  if (me < 0 && !live) return;
  $("chat").classList.add("open"); $("chatBox").hidden = false;
  $("chatTo").hidden = !teamGame() || snap?.peaceful; $("chatTo").value = team && teamGame() ? "team" : "all";
  renderChat(); $("chatMsg").focus();
}
function closeChat() { $("chat").classList.remove("open"); $("chatBox").hidden = true; $("chatMsg").value = ""; $("chatMsg").blur(); renderChat(); }
$("chatMsg").addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Escape") closeChat();
  else if (e.key === "Tab" && !$("chatTo").hidden) { e.preventDefault(); $("chatTo").value = $("chatTo").value === "all" ? "team" : "all"; }
  else if (e.key === "Enter") { const v = $("chatMsg").value.trim(); if (v) send({ t: "chat", text: v, team: $("chatTo").value === "team" && !$("chatTo").hidden }); closeChat(); }
});

// ------------------------------------------------------------------ map pings (allies only)
const pings = [];
function ping(wx, wy) { if (me >= 0 && map) send({ t: "mark", x: wx, y: wy }); }
function onMark(m) {
  pings.push({ x: m.x, y: m.y, c: TINT[m.color] ?? 0xffffff, css: COLORS[m.color] ?? "#fff", t: performance.now() });
  alertAt = iso(m.x, m.y); Sfx.play("ping", 0.9, 150);
  if (m.color !== me) toast(`${m.from} pinged the map (Space to jump there).`);
}

// ------------------------------------------------------------------ control groups: Ctrl/Alt+N set, Shift+N add, N select, N twice jump
const groups = Array.from({ length: 10 }, () => []);
let lastGroup = -1, lastGroupAt = 0, groupsKey = "";
function groupKey(e, n) {
  const live = (g) => g.filter((id) => ent(id)?.[2] === me);
  if (e.ctrlKey || e.altKey) { e.preventDefault(); groups[n] = [...sel].filter((id) => ent(id)?.[2] === me); toast(groups[n].length ? `Group ${n} set (${groups[n].length}).` : `Group ${n} cleared.`); }
  else if (e.shiftKey) { groups[n] = [...new Set([...live(groups[n]), ...[...sel].filter((id) => ent(id)?.[2] === me)])]; toast(`Group ${n}: ${groups[n].length}.`); }
  else {
    groups[n] = live(groups[n]); if (!groups[n].length) return;
    sel = new Set(groups[n]);
    if (lastGroup === n && performance.now() - lastGroupAt < 450) { const ps = groups[n].map((id) => pos(ent(id))); lookAt(iso(ps.reduce((a, p) => a + p.x, 0) / ps.length, ps.reduce((a, p) => a + p.y, 0) / ps.length)); }
    lastGroup = n; lastGroupAt = performance.now();
  }
  renderCmds(); renderGroups();
}
function renderGroups() {
  const counts = groups.map((g) => g.filter((id) => ent(id)?.[2] === me).length), key = counts.join();
  if (key === groupsKey) return; groupsKey = key;
  $("groups").hidden = !counts.some(Boolean);
  $("groups").innerHTML = counts.map((c, n) => (c ? `<button data-g="${n}" title="Group ${n}: press ${n} to select, twice to jump">${n} · ${c}</button>` : "")).join("");
  $("groups").querySelectorAll("[data-g]").forEach((b) => (b.onclick = (ev) => groupKey({ ctrlKey: false, altKey: false, shiftKey: ev.shiftKey, preventDefault() {} }, +b.dataset.g)));
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
  me = pid; playing = true; sel.clear(); peacefulStart = true;
  for (const id of ["menu", "lobby"]) $(id).hidden = true;
  for (const id of ["top", "bottom", "mini", "help", "chat"]) $(id).hidden = false;
  if (me < 0) { for (const id of ["resign", "resbar", "chat"]) $(id).hidden = true; $("speedCtl").hidden = live; $("help").hidden = true; $("chat").hidden = !live; }
  if (map?.map) toast(`Map: ${MAPS[map.map] ?? map.map}${live ? " · you are watching, the whole map is shown" : ""}`);
  setTimeout(() => ($("help").hidden = true), 20000);
}
const ent = (id) => snap?.map.get(id);
// allies: same team (or a peaceful game). Teams only matter when somebody shares one
const ally = (a, b) => a === b || !!snap?.peaceful || (a >= 0 && b >= 0 && snap?.players[a]?.team === snap?.players[b]?.team);
const teamGame = () => !!snap && new Set(snap.players.map((p) => p.team)).size < snap.players.length;
const winners = (st) => st.winTeam != null ? st.players.filter((p) => p.team === st.winTeam).map((p) => p.name).join(" & ") : null;
const kindOf = (e) => kinds[e[1]];
const isUnitE = (e) => KINDS[kindOf(e)].type === "unit";
const visibleAt = (x, y) => vis && vis[Math.floor(y) * map.w + Math.floor(x)] === 1;

function onSnap(s) {
  prev = snap; snap = s; snapAt = performance.now();
  if (peacefulStart) { peacefulStart = false; $("resign").textContent = s.peaceful ? "End game" : "Resign"; if (s.peaceful && me >= 0) toast("Peaceful game: everyone is your ally. Build as long as you like."); }
  s.map = new Map(s.ents.map((e) => [e[0], e]));
  if (prev && me >= 0 && s.techs.includes("castle") && !prev.techs.includes("castle")) { Sfx.play("victory", 0.6); toast("Castle Age! Workshop, Tower, Market, Knight and Crossbowman are unlocked."); }
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
  if (s.over) clearSession();
  if (s.over && !$("end").dataset.shown) {
    $("end").dataset.shown = 1;
    const won = s.winTeam != null && s.players[me]?.team === s.winTeam;
    if (s.peaceful) { $("end").hidden = false; $("endTitle").textContent = replayId ? "Replay over" : "Well built!"; $("endText").textContent = `A peaceful realm, ${fmtClock(s.time)} of building.`; return; }
    if (me < 0) { $("end").hidden = false; $("endTitle").textContent = replayId ? "Replay over" : "Battle over"; $("endText").textContent = `${winners(s) ? winners(s) + " won" : "No winner"} after ${fmtClock(s.time)}.`; return; }
    Sfx.play(won ? "victory" : "defeat");
    setTimeout(() => { $("end").hidden = false; $("endTitle").textContent = won ? "Victory" : "Defeat"; $("endText").textContent = won ? (teamGame() ? `Your team wins after ${fmtClock(s.time)}.` : `Your realm stands alone after ${fmtClock(s.time)}.`) : `${winners(s) ? winners(s) + " won" : "The game ended"} after ${fmtClock(s.time)}.`; }, 1500);
  } else if (!s.over && s.players[me] && !s.players[me].alive && !$("end").dataset.shown) {
    const mates = s.players.some((p, i) => i !== me && p.alive && ally(i, me));
    if (mates) { if (!toldOut) { toldOut = true; Sfx.play("defeat"); toast("Your buildings are gone, but your team fights on. You can still chat and ping."); } }
    else { $("end").dataset.shown = 1; Sfx.play("defeat"); $("end").hidden = false; $("endTitle").textContent = "Defeat"; $("endText").textContent = "All your buildings were destroyed."; }
  }
}
let toldOut = false;
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
    const ownWall = kind === "gate" && occ[n] && ent(occ[n])?.[2] === me && kindOf(ent(occ[n])) === "wall";
    if (map.tile[n] === 1 || map.wood[n] || (occ[n] && !ownWall) || !explored[n]) return false;
  }
  return true;
}
const selected = () => [...sel].map(ent).filter(Boolean);
const myAge = () => ageOf(Object.fromEntries((snap?.techs ?? []).map((t) => [t, 1])));
function lockReason(item) { // why this can't be started yet (age or required buildings), or "" if it can
  const need = (KINDS[item] ?? TECHS[item]).age ?? 1;
  if (need > myAge()) return `needs ${AGES[need]}`;
  const missing = (TECHS[item]?.needs ?? []).filter((k) => !snap.ents.some((e) => e[2] === me && kindOf(e) === k && e[6] >= 100));
  return missing.length ? `needs ${missing.map((k) => NAMES[k]).join(" and ")}` : "";
}
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
  if (e.button === 0 && e.altKey) { ping(w.x, w.y); return; } // Alt+click = ping for allies
  if (e.button === 1) { e.preventDefault(); drag = { pan: true, x1: e.clientX, y1: e.clientY, cx: cam.x, cy: cam.y }; return; }
  if (e.button !== 0) return;
  if (mode?.build === "wall") { mode.from = { x: Math.floor(w.x), y: Math.floor(w.y) }; return; } // drag to the end of the wall
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
const wallLine = () => { const w = screenToWorld(mouse.x, mouse.y), a = mode.from ?? { x: Math.floor(w.x), y: Math.floor(w.y) }; return line(a.x, a.y, Math.floor(w.x), Math.floor(w.y)).slice(0, 24); };
addEventListener("mouseup", (e) => {
  if (mode?.build === "wall" && mode.from && e.button === 0) {
    const pts = wallLine(), [x2, y2] = pts.at(-1), free = pts.filter(([x, y]) => canPlaceClient("wall", x, y)).length;
    if (!free) toast("Can't build a wall there.");
    else if (!canAfford(KINDS.wall.cost)) toast(`Not enough wood (${KINDS.wall.cost.wood} per piece).`);
    else { cmd({ t: "wall", ids: myUnits().filter((u) => kindOf(u) === "villager").map((u) => u[0]), x: mode.from.x, y: mode.from.y, x2, y2 }); Sfx.play("hammer", 0.7); }
    mode = e.shiftKey ? { build: "wall" } : null;
    return;
  }
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
  if (t && t[0] !== ids[0]) { cmd({ t: "target", ids, id: t[0] }); marks.push({ x: wx, y: wy, t: performance.now(), c: t[2] >= 0 && !ally(t[2], me) ? 0xe0674f : 0xe8b64c }); return; }
  const tree = treeAt(sx, sy, wx, wy);
  if (tree && units.some((u) => kindOf(u) === "villager")) { cmd({ t: "tree", ids, x: tree.x, y: tree.y }); marks.push({ x: tree.x + 0.5, y: tree.y + 0.5, t: performance.now(), c: 0xe8b64c }); return; }
  cmd({ t: "move", ids, x: wx, y: wy }); marks.push({ x: wx, y: wy, t: performance.now(), c: 0x6fbf73 });
}
addEventListener("keydown", (e) => {
  if (!playing || e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  const digit = /^Digit(\d)$/.exec(e.code);
  if (digit && me >= 0) return groupKey(e, +digit[1]);
  if (e.key === "Enter" && (me >= 0 || live) && !snap?.over) { e.preventDefault(); return openChat(e.shiftKey && me >= 0); }
  keys.add(e.key);
  const k = e.key.toLowerCase();
  if (k === "g" && mouse.in && !e.ctrlKey && !e.metaKey) { const w = screenToWorld(mouse.x, mouse.y); return ping(w.x, w.y); }
  if (k === "escape") { if (mode) mode = null; else { sel.clear(); renderCmds(); } }
  else if (HOTKEYS.includes(k) || ((k === "z" || k === "x" || k === "c") && !e.ctrlKey && !e.metaKey)) { const b = $("cmds").querySelector(`[data-key="${k}"]`); if (b && !b.disabled) b.click(); }
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
  $("clock").textContent = fmtClock(snap.time);
  $("age").textContent = me >= 0 ? AGES[myAge()] : "";
  const r = snap.res; if (!r) { renderInfo(selected()); return; }
  $("rFood").textContent = r.food; $("rWood").textContent = r.wood; $("rGold").textContent = r.gold;
  $("rPop").textContent = `${r.pop}/${r.cap}`; $("rPop").style.color = r.pop >= r.cap ? "var(--bad)" : "";
  $("clock").textContent = fmtClock(snap.time);
  $("players").innerHTML = snap.players.map((p, i) => `<span class="${p.alive ? "" : "dead"}"><b style="background:${p.color}"></b>${esc(p.name)}${i === me ? " (you)" : me >= 0 && ally(i, me) ? " (ally)" : ""}${teamGame() && !snap.peaceful ? ` <small style="color:var(--muted)">T${p.team + 1}</small>` : ""}</span>`).join("");
  renderGroups();
  const s = selected();
  const key = s.map((e) => e[0] + ":" + (isUnitE(e) ? e[9] ?? 0 : JSON.stringify(e[8]) + e[6])).join() + "|" + r.food + r.wood + r.gold + "|" + snap.techs + JSON.stringify(snap.market);
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
    const techs = e[2] === me ? Object.fromEntries(snap.techs.map((t) => [t, 1])) : {}, st = (key) => stat(techs, kind, key);
    html += `<div class="hpbar"><div style="width:${Math.max(0, Math.min(100, (e[5] / k.hp) * 100))}%"></div></div><div class="sub">HP ${e[5]}/${k.hp}${k.atk ? ` · attack ${st("atk")}` : ""}${k.type === "unit" ? ` · armour ${st("armor")}/${st("pierce")}` : ""}${k.range > 2 ? ` · range ${st("range")}` : ""}</div>`;
    if (TIPS[kind]) html += `<div class="sub">${TIPS[kind]}</div>`;
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
    if (units.some((u) => kindOf(u) === "villager")) BUILDABLE.forEach((kind, i) => {
      const lock = lockReason(kind);
      add(`Build ${NAMES[kind]}`, lock || costText(KINDS[kind].cost) + (kind === "wall" ? " each" : ""), HOTKEYS[i], () => { mode = { build: kind }; if (kind === "wall") toast("Press and drag to draw the wall."); }, !lock && canAfford(KINDS[kind].cost));
      box.lastChild.title = TIPS[kind] ?? "";
    });
    const army = units.filter((u) => kindOf(u) !== "villager");
    if (army.length) {
      add("Attack-move", "attack anything on the way", "a", () => { mode = { attackMove: true }; });
      const cur = new Set(army.map((u) => u[9] ?? 0)), ids = army.map((u) => u[0]);
      STANCES.forEach(([st, label, sub, hk], i) => { add(label, cur.size === 1 && cur.has(i) ? "● current" : sub, hk, () => { cmd({ t: "stance", ids, kind: st }); toast(`${label}.`); }); });
    }
    add("Stop", "cancel orders", "s", () => cmd({ t: "stop", ids: units.map((u) => u[0]) }));
    return;
  }
  const b = s[0], kind = kindOf(b);
  if (b[6] < 100) return;
  const kb = KINDS[kind];
  const queued = new Set(snap.ents.filter((e) => e[2] === me && e[8]).flatMap((e) => e[8][0]));
  const items = [...(kb.trains ?? []), ...(kb.researches ?? []).filter((t) => !snap.techs.includes(t))];
  items.forEach((u, i) => {
    const tech = !!TECHS[u], busy = tech && queued.has(u);
    const lock = lockReason(u);
    add(u === "castle" ? "Advance to Castle Age" : `${tech ? "Research" : "Train"} ${NAMES[u]}`, busy ? "researching…" : lock ? `${costText(costOf(u))} · ${lock}` : `${costText(costOf(u))} · ${timeOf(u)}s`, HOTKEYS[i], () => {
      if (!canAfford(costOf(u))) return toast(`Not enough resources (${costText(costOf(u))}).`);
      cmd({ t: "train", id: b[0], kind: u });
    }, canAfford(costOf(u)) && !busy && !lock);
    box.lastChild.title = tech ? TECHS[u].desc : TIPS[u] ?? "";
  });
  const done = (kb.researches ?? []).filter((t) => snap.techs.includes(t));
  if (done.length) { const n = document.createElement("small"); n.style.cssText = "color:var(--muted);width:100%"; n.textContent = "Researched: " + done.map((t) => NAMES[t]).join(", "); box.append(n); }
  if (kind === "market") { // trade buttons + sending resources to allies
    const mk = snap.market ?? { food: MARKET.start, wood: MARKET.start };
    ["food", "wood"].forEach((r, i) => {
      add(`Buy 100 ${r}`, `${mk[r]} gold`, HOTKEYS[i * 2], () => cmd({ t: "trade", id: b[0], res: r, buy: true }), snap.res.gold >= mk[r]);
      add(`Sell 100 ${r}`, `+${Math.floor(mk[r] * MARKET.sellCut)} gold`, HOTKEYS[i * 2 + 1], () => cmd({ t: "trade", id: b[0], res: r, buy: false }), snap.res[r] >= 100);
    });
    const mates = snap.players.map((p, i) => ({ p, i })).filter(({ p, i }) => i !== me && p.alive && ally(i, me));
    for (const { p, i } of mates) {
      const row = document.createElement("div"); row.className = "queue"; row.innerHTML = `<small style="color:var(--muted)">Send 100 to <b class="dot" style="background:${p.color}"></b>${esc(p.name)} (${Math.round(MARKET.tributeCut * 100)}% lost):</small>`;
      for (const r of ["food", "wood", "gold"]) { const bt = document.createElement("button"); bt.textContent = r; bt.disabled = snap.res[r] < 100; bt.onclick = () => { cmd({ t: "tribute", id: b[0], to: i, res: r }); toast(`Sent 100 ${r} to ${p.name}.`); }; row.append(bt); }
      box.append(row);
    }
  }
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
      else if (act === 1) { anim = "attack"; n = 6; fps = kind === "archer" || kind === "crossbowman" || kind === "ram" ? 4 : 6; }
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
        if (act === 1 && fi === 3 && (kind === "swordsman" || kind === "spearman" || kind === "cavalry" || kind === "knight")) Sfx.play("clash", hearing(s) * 0.6, 260);
        if (act === 1 && kind === "ram" && fi === 4) { if (!sp.hitFrame) { sp.hitFrame = true; Sfx.play("hammer", hearing(s), 300); burst(s.x + Math.cos(e[8]) * 20, s.y - 10, 6, 0x8a7a66, 1.2, 0.7); } } else if (act === 1 && kind === "ram") sp.hitFrame = false;
      }
      if (sel.has(e[0])) ring(s.x, s.y, 13, 6.5, e[2] === me ? 0xf3ead7 : ally(e[2], me) ? 0x6fbf73 : 0xe0674f);
      if (sel.has(e[0]) || e[5] < k.hp) bar(s.x - 11, s.y - 46, 22, e[5] / k.hp);
    } else {
      const c = iso(e[3] + k.w / 2, e[4] + k.h / 2);
      if (k.type === "resource") setFrame(sp, `${kind}${e[0] % 3}`);
      else {
        const built = e[6] / 100;
        if (built < 1 && kind !== "farm") { if (built > 0.5) { setFrame(sp, kind, tint); sp.alpha = 0.45 + built * 0.4; } else { setFrame(sp, k.w === 3 ? "found3" : k.w === 1 ? "found1" : "found2", tint); sp.alpha = 1; } }
        else { setFrame(sp, kind, tint); sp.alpha = built < 1 ? 0.6 : 1; }
        if (built >= 1 && e[5] < k.hp * 0.5 && onScreenPx(c)) { // burning
          const fire = 1 - e[5] / (k.hp * 0.5);
          if (Math.random() < 0.25 + fire * 0.5) spawn(c.x + (Math.random() - 0.5) * k.w * 26, c.y - 30 - Math.random() * 20, { vx: (Math.random() - 0.5) * 6, vy: -28, color: Math.random() < 0.5 ? 0xff8a2a : 0xffc14a, size: 0.8 + fire * 0.6, life: 0.5, grow: -0.4, alpha: 0.9 });
          if (Math.random() < 0.3) spawn(c.x + (Math.random() - 0.5) * k.w * 20, c.y - 50, { vx: 8 + Math.random() * 6, vy: -22, color: 0x4a4440, size: 1.4, life: 2.2, grow: 1.8, alpha: 0.45 });
        }
        if (kind === "house" && built >= 1 && Math.random() < 0.03 && onScreenPx(c)) spawn(c.x - 4, c.y - 62, { vx: 5, vy: -10, color: 0xcfc8c0, size: 0.7, life: 2.5, grow: 2, alpha: 0.28 }); // chimney smoke
      }
      if (sel.has(e[0])) { const pts = [iso(e[3], e[4]), iso(e[3] + k.w, e[4]), iso(e[3] + k.w, e[4] + k.h), iso(e[3], e[4] + k.h)]; ringG.lineStyle(2, e[2] === me ? 0xf3ead7 : e[2] < 0 ? 0xe8b64c : ally(e[2], me) ? 0x6fbf73 : 0xe0674f, 0.9); ringG.drawPolygon(pts.flatMap((q) => [q.x, q.y])); }
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
  for (let i = pings.length - 1; i >= 0; i--) { // three pulses over 3 s, drawn above everything
    const pg = pings[i], age = (now - pg.t) / 1000; if (age > 3) { pings.splice(i, 1); continue; }
    const p = iso(pg.x, pg.y), f = (age % 1);
    barG.lineStyle(3, pg.c, 1 - f); barG.drawEllipse(p.x, p.y, 10 + f * 36, 5 + f * 18);
    barG.lineStyle(2, 0xffffff, 0.9 * (1 - age / 3)); barG.moveTo(p.x, p.y); barG.lineTo(p.x, p.y - 40);
    barG.beginFill(pg.c, 1 - age / 3); barG.drawPolygon([p.x, p.y - 40, p.x + 14, p.y - 34, p.x, p.y - 28]); barG.endFill();
  }
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
  if (mode.build === "wall") { // the whole line, green where a piece fits
    if (ghostSprite) ghostSprite.visible = false;
    const pts = wallLine(); let n = 0;
    for (const [x, y] of pts) { const ok = canPlaceClient("wall", x, y), col = ok ? 0x6fbf73 : 0xe0674f; n += ok; const q = [iso(x, y), iso(x + 1, y), iso(x + 1, y + 1), iso(x, y + 1)]; ghostG.lineStyle(1, col, 0.8); ghostG.beginFill(col, 0.3); ghostG.drawPolygon(q.flatMap((p) => [p.x, p.y])); ghostG.endFill(); }
    $("toast").textContent = `Wall: ${n} pieces, ${n * KINDS.wall.cost.wood} wood${mode.from ? "" : " · press and drag"}`; $("toast").classList.add("on"); clearTimeout(toast.h); toast.h = setTimeout(() => $("toast").classList.remove("on"), 300);
    return;
  }
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
  for (const pg of pings) { const [x, y] = mmProj(pg.x, pg.y), f = ((performance.now() - pg.t) / 1000) % 1; mctx.strokeStyle = pg.css; mctx.lineWidth = 2; mctx.beginPath(); mctx.arc(x, y, 3 + f * 9, 0, Math.PI * 2); mctx.stroke(); }
  const corners = [[0, 0], [app.screen.width, 0], [app.screen.width, app.screen.height], [0, app.screen.height]].map(([x, y]) => { const w = screenToWorld(x, y); return mmProj(w.x, w.y); });
  mctx.strokeStyle = "#fff"; mctx.lineWidth = 1; mctx.beginPath(); corners.forEach(([x, y], i) => (i ? mctx.lineTo(x, y) : mctx.moveTo(x, y))); mctx.closePath(); mctx.stroke();
}
mm.addEventListener("contextmenu", (e) => { e.preventDefault(); mmClick(e, true); });
mm.addEventListener("mousedown", (e) => { if (e.button === 0 && e.altKey) mmClick(e, false, true); else if (e.button === 0 && !e.ctrlKey) mmClick(e, false); else if (e.button === 0) mmClick(e, true); });
function mmClick(e, secondaryClick, pingIt) {
  if (!map) return;
  const r = mm.getBoundingClientRect(), u = ((e.clientX - r.left) / r.width) * mm.width - map.h * mmA, v = ((e.clientY - r.top) / r.height) * mm.height;
  const wx = (u / mmA + (2 * v) / mmA) / 2, wy = ((2 * v) / mmA - u / mmA) / 2;
  if (pingIt) return ping(wx, wy);
  if (secondaryClick) { const ids = myUnits().map((x) => x[0]); if (ids.length) cmd({ t: "move", ids, x: wx, y: wy }); return; }
  lookAt(iso(wx, wy));
}

// ------------------------------------------------------------------ title backdrop
for (let i = 0; i < 50; i++) { const s = new PIXI.Sprite(dotTex); s.anchor.set(0.5); s.tint = 0xe8a040; s.alpha = 0.3 + Math.random() * 0.5; s.scale.set(0.15 + Math.random() * 0.25); s.v = 15 + Math.random() * 40; s.position.set(Math.random() * app.screen.width, Math.random() * app.screen.height); embers.addChild(s); }
function embersStep(dt) {
  embers.visible = !snap; if (snap) return;
  for (const s of embers.children) { s.y -= s.v * dt; s.x += Math.sin(s.y / 40) * 0.3; if (s.y < -10) { s.y = app.screen.height + 10; s.x = Math.random() * app.screen.width; } }
}

// ------------------------------------------------------------------ replays
let replayId = null;
function watchReplay(id) { replayId = id; history.replaceState(null, "", `/?replay=${id}`); connect({ t: "replay", id, speed: 2 }); }
async function loadLobbies() { // open public games, refreshed while the menu is showing
  if ($("menu").hidden) return;
  let list = [];
  try { list = await (await fetch("/api/lobbies")).json(); } catch {}
  $("lobbies").hidden = !list.length;
  const mapName = (l) => esc(MAPS[l.map] ?? "Lakes");
  $("lobbyList").innerHTML = list.map((l) => l.live
    ? `<div class="slot"><span style="flex:1">${l.players.map(esc).join(" vs ")} <small style="color:var(--muted)">· live, ${l.minutes} min · ${mapName(l)}${l.watching ? ` · ${l.watching} watching` : ""}</small></span><button data-watch="${esc(l.code)}">Watch</button></div>`
    : `<div class="slot"><span style="flex:1">${esc(l.host)}'s game <small style="color:var(--muted)">· ${l.players.length}/4 · ${mapName(l)} · ${l.players.map(esc).join(", ")}</small></span><button data-join="${esc(l.code)}">Join</button></div>`).join("");
  $("lobbyList").querySelectorAll("[data-join]").forEach((b) => (b.onclick = () => { $("joinCode").value = b.dataset.join; $("join").click(); }));
  $("lobbyList").querySelectorAll("[data-watch]").forEach((b) => (b.onclick = () => { $("joinCode").value = b.dataset.watch; $("spectate").click(); }));
}
async function loadReplays() {
  let list = [];
  try { list = await (await fetch("/api/replays")).json(); } catch {}
  $("replays").hidden = !list.length;
  const when = (d) => new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  $("replayList").innerHTML = list.slice(0, 8).map((r) => `<div class="slot"><span style="flex:1">${r.players.map((p) => `<b style="background:${p.color};display:inline-block;width:9px;height:9px;border-radius:50%"></b> ${esc(p.name)}${(r.winners ?? []).includes(p.name) ? " 👑" : ""}`).join(" &nbsp;")}</span><small style="color:var(--muted)">${r.peaceful ? "peaceful · " : ""}${r.map && r.map !== "lakes" ? esc(MAPS[r.map] ?? "") + " · " : ""}${when(r.date)} · ${r.minutes} min</small><button data-replay="${esc(r.id)}" ${r.playable ? "" : `disabled title="Recorded with an older version of the game"`}>Watch</button></div>`).join("");
  $("replayList").querySelectorAll("[data-replay]").forEach((b) => (b.onclick = () => watchReplay(b.dataset.replay)));
}
const qs = new URLSearchParams(location.search), qsReplay = qs.get("replay"), qsJoin = (qs.get("join") ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
if (qsReplay) setTimeout(() => watchReplay(qsReplay), 300);
else {
  loadReplays(); loadLobbies(); setInterval(loadLobbies, 4000);
  if (qsJoin.length === 4) { // invite link: code filled in, the player only adds a name and presses Join
    $("joinCode").value = qsJoin; $("inviteCode").textContent = qsJoin; $("invite").hidden = false;
    setTimeout(() => ($("name").value ? $("join") : $("name")).focus(), 100);
  } else if (session() && !location.hash) { // reloaded during a game: take the slot back
    rejoining = true; $("menu").hidden = true; $("loading").hidden = false;
    setTimeout(() => connect({ t: "rejoin", ...session() }), 200);
  }
}

// ------------------------------------------------------------------ end-of-game stats (table + two line charts)
function showStats(m) {
  const P = m.players, fmt = (n) => Math.round(n).toLocaleString();
  const rows = P.map((p, i) => `<tr><th scope="row"><b class="dot" style="background:${p.color}"></b>${esc(p.name)}${i === me ? " (you)" : ""}</th><td>${m.peaceful ? (p.ai ? "Ally" : "Builder") : m.winTeam != null && p.team === m.winTeam ? "Winner" : p.alive ? "—" : "Defeated"}</td><td>${p.villagers}</td><td>${p.military}</td><td>${p.killed}</td><td>${p.lost}</td><td>${fmt(p.food)}</td><td>${fmt(p.wood)}</td><td>${fmt(p.gold)}</td><td>${p.techs.length}</td></tr>`).join("");
  const T = m.timeline;
  const legend = `<div class="legend">${P.map((p) => `<span><b class="dot" style="background:${p.color}"></b>${esc(p.name)}</span>`).join("")}</div>`;
  $("stats").innerHTML = `
    <table class="stats"><thead><tr><th scope="col">Player</th><th scope="col">Result</th><th scope="col">Villagers</th><th scope="col">Soldiers</th><th scope="col">Kills</th><th scope="col">Losses</th><th scope="col">Food</th><th scope="col">Wood</th><th scope="col">Gold</th><th scope="col">Upgrades</th></tr></thead><tbody>${rows}</tbody></table>
    <small style="color:var(--muted)">Villagers and soldiers trained; food, wood and gold gathered over the whole game.</small>
    ${T.length > 1 ? legend + `<div class="charts">${chart("Army size", T, (pt, i) => pt.p[i][1], P)}${chart("Resources gathered", T, (pt, i) => pt.p[i][2] + pt.p[i][3] + pt.p[i][4], P)}</div>` : ""}
    ${m.replay && !replayId ? `<div class="row" style="justify-content:center"><button id="watchRep">Watch the replay</button><button id="copyRep">Copy replay link</button></div>` : ""}`;
  $("stats").querySelectorAll("figure").forEach(hoverChart);
  if ($("watchRep")) { $("watchRep").onclick = () => (location.href = `/?replay=${m.replay}`); $("copyRep").onclick = () => { navigator.clipboard?.writeText(`${location.origin}/?replay=${m.replay}`); toast("Replay link copied."); }; }
  if ($("end").hidden) { // replay reached its end without a winner, or a spectator joined late
    $("end").hidden = false; $("end").dataset.shown = 1;
    $("endTitle").textContent = replayId ? "Replay over" : "Game over";
    $("endText").textContent = m.peaceful ? `A peaceful realm, ${fmtClock(m.time)} of building.` : `${winners(m) ? winners(m) + " won" : "No winner"} after ${fmtClock(m.time)}.`;
  }
}
const SVG_W = 360, SVG_H = 170, PAD = { l: 38, r: 70, t: 10, b: 24 };
function chart(title, T, val, P) {
  const tMax = T.at(-1).t || 1, yMax = Math.max(1, ...T.flatMap((pt) => P.map((_, i) => val(pt, i))));
  const step = niceStep(yMax / 3), top = Math.ceil(yMax / step) * step;
  const X = (t) => PAD.l + (t / tMax) * (SVG_W - PAD.l - PAD.r), Y = (v) => SVG_H - PAD.b - (v / top) * (SVG_H - PAD.t - PAD.b);
  let g = "";
  for (let v = 0; v <= top + 1e-9; v += step) g += `<line x1="${PAD.l}" x2="${SVG_W - PAD.r}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${PAD.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v >= 1000 ? v / 1000 + "k" : v}</text>`;
  const mins = Math.max(1, Math.round(tMax / 60 / 4));
  for (let mm = 0; mm * 60 <= tMax; mm += mins) g += `<text x="${X(mm * 60)}" y="${SVG_H - 6}" text-anchor="middle">${mm}m</text>`;
  // end labels, nudged apart so names never overlap
  const ends = P.map((p, i) => ({ i, y: Y(val(T.at(-1), i)) })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) ends[k].y = Math.max(ends[k].y, ends[k - 1].y + 13);
  const lines = P.map((p, i) => `<polyline fill="none" stroke="${p.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${T.map((pt) => `${X(pt.t).toFixed(1)},${Y(val(pt, i)).toFixed(1)}`).join(" ")}"/>`).join("");
  const labels = ends.map(({ i, y }) => `<text x="${SVG_W - PAD.r + 6}" y="${y + 4}" class="lbl">${esc(P[i].name.slice(0, 10))}</text>`).join("");
  const data = JSON.stringify(T.map((pt) => [pt.t, ...P.map((_, i) => val(pt, i))]));
  return `<figure data-series='${data}' data-names='${esc(JSON.stringify(P.map((p) => [p.name, p.color])))}'><figcaption>${title}</figcaption><svg viewBox="0 0 ${SVG_W} ${SVG_H}" role="img" aria-label="${title} over time per player">${g}${lines}${labels}<line class="cross" y1="${PAD.t}" y2="${SVG_H - PAD.b}" visibility="hidden"/><rect x="${PAD.l}" y="${PAD.t}" width="${SVG_W - PAD.l - PAD.r}" height="${SVG_H - PAD.t - PAD.b}" fill="transparent"/></svg><div class="tip" hidden></div></figure>`;
}
function niceStep(raw) { const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9))), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
function hoverChart(fig) { // crosshair + tooltip with every player's value at the hovered time
  const data = JSON.parse(fig.dataset.series), names = JSON.parse(fig.dataset.names), svg = fig.querySelector("svg"), cross = fig.querySelector(".cross"), tip = fig.querySelector(".tip");
  const tMax = data.at(-1)[0] || 1;
  svg.addEventListener("mousemove", (e) => {
    const r = svg.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * SVG_W;
    const t = ((x - PAD.l) / (SVG_W - PAD.l - PAD.r)) * tMax;
    const row = data.reduce((a, b) => (Math.abs(b[0] - t) < Math.abs(a[0] - t) ? b : a));
    const cx = PAD.l + (row[0] / tMax) * (SVG_W - PAD.l - PAD.r);
    cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
    tip.hidden = false; tip.innerHTML = `<strong>${fmtClock(row[0])}</strong>` + names.map(([n, c], i) => `<div><b class="dot" style="background:${c}"></b>${esc(n)} <span>${Math.round(row[i + 1]).toLocaleString()}</span></div>`).join("");
    const left = (cx / SVG_W) * r.width; tip.style.left = `${left > r.width / 2 ? left - tip.offsetWidth - 10 : left + 10}px`;
  });
  svg.addEventListener("mouseleave", () => { cross.setAttribute("visibility", "hidden"); tip.hidden = true; });
}

// test hook: /#autoplay starts a single-player game immediately (used for headless screenshots)
if (location.hash.startsWith("#autoplay")) setTimeout(() => $("playSingle").click(), 300);
if (location.hash.startsWith("#autowatch")) setTimeout(() => connect({ t: "watch", diff: "hard", ais: 1, speed: 8 }), 300);
// test hooks for headless screenshots
window.__er = { cmd: (c) => cmd(c), look: (x, y) => lookAt(iso(x, y)), toScreen: (x, y) => worldToScreen(x, y), wood: (i) => map.wood[i], w: () => map.w, snap: () => snap, kinds: () => kinds, zoom: (z) => (cam.z = z) };
