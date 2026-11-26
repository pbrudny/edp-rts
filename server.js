// Ember Realms server: rooms, authoritative simulation (10 ticks/s), WebSocket to browsers,
// domain events published (batched) to the shared broker topic demo.rts.
//
//   browser --commands (WS)--> room.sim --snapshots (WS)--> browsers
//                                   \--events (REST, batched)--> broker demo.rts

import { createServer } from "node:http";
import { readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { readFileSync, mkdirSync } from "node:fs";
import { extname } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { WebSocketServer } from "ws";
import { createGame, step, command, snapshot, mapInfo, gameStats, TICK } from "./shared/sim.js";

const PORT = Number(process.env.PORT ?? 3000);
const BROKER = process.env.BROKER_URL;
const AUTH = process.env.BROKER_PASSWORD ? "Basic " + Buffer.from(`${process.env.BROKER_USER ?? "demo"}:${process.env.BROKER_PASSWORD}`).toString("base64") : null;
const TOPIC = process.env.TOPIC ?? "demo.rts";
const MAX_ROOMS = 30;
const VERSION = Date.now().toString(36); // changes on every deploy/restart
// replays = seed + every player command; they only play back on the exact same rules, so they carry a hash of sim.js
const SIM_HASH = createHash("sha256").update(readFileSync(new URL("./shared/sim.js", import.meta.url))).digest("hex").slice(0, 12);
const REPLAYS = (process.env.DATA_DIR ?? new URL("./data", import.meta.url).pathname) + "/replays";
const MAX_REPLAYS = 200;
mkdirSync(REPLAYS, { recursive: true });

// ------------------------------------------------------------------ broker publisher (queue + batch, one request in flight)
const queue = [];
let flushing = false;
function publish(game, ev) {
  if (!BROKER || !AUTH) return;
  queue.push({ key: game, value: { ...ev, game, ts: Date.now() } });
  flush();
}
async function flush() {
  if (flushing) return;
  flushing = true;
  while (queue.length) {
    const batch = queue.splice(0, 200);
    try {
      const r = await fetch(`${BROKER}/topics/${TOPIC}`, { method: "POST", signal: AbortSignal.timeout(10000),
        headers: { Authorization: AUTH, "Content-Type": "application/vnd.kafka.json.v2+json" }, body: JSON.stringify({ records: batch }) });
      const body = await r.json();
      const bad = body.offsets?.find((o) => o.error_code);
      if (!r.ok || bad) console.warn("broker publish problem", r.status, JSON.stringify(bad ?? body).slice(0, 200));
    } catch (e) { console.warn("broker publish failed", e.message); }
  }
  flushing = false;
}

// ------------------------------------------------------------------ replays
const replays = []; // summaries, newest first
async function loadReplays() {
  for (const f of await readdir(REPLAYS)) {
    if (!f.endsWith(".json")) continue;
    try { const r = JSON.parse(await readFile(`${REPLAYS}/${f}`, "utf8")); replays.push(summary(r)); } catch {}
  }
  replays.sort((a, b) => b.date - a.date);
}
const summary = (r) => ({ id: r.id, date: r.date, minutes: r.minutes, winner: r.winner, winners: r.winners ?? (r.winner ? [r.winner] : []), peaceful: !!r.peaceful, players: r.players, playable: r.sim === SIM_HASH });
async function saveReplay(room) {
  const s = room.sim;
  if (room.saved || room.replay || !room.slots.some((x) => !x.ai) || s.time < 60) return null; // only real games of 1+ minute
  room.saved = true;
  const r = { v: 1, id: room.id, sim: SIM_HASH, date: Date.now(), seed: s.seed, ticks: s.tick, minutes: +(s.time / 60).toFixed(1),
    winner: s.winner != null ? s.players[s.winner].name : null, winners: s.winTeam != null ? s.players.filter((p) => p.team === s.winTeam).map((p) => p.name) : [],
    peaceful: s.peaceful, players: s.players.map((p) => ({ name: p.name, color: p.color, team: p.team, ai: p.ai?.diff ?? null })),
    cmds: room.rec, stats: gameStats(s) };
  try {
    await writeFile(`${REPLAYS}/${r.id}.json`, JSON.stringify(r));
    replays.unshift(summary(r));
    for (const old of replays.splice(MAX_REPLAYS)) unlink(`${REPLAYS}/${old.id}.json`).catch(() => {});
    return r.id;
  } catch (e) { console.warn("replay save failed", e.message); return null; }
}
async function finish(room) { // game over (or replay end): stats + replay link to everyone still connected
  const id = await saveReplay(room);
  const m = { t: "stats", ...gameStats(room.sim), replay: room.replay ? room.replay.id : id };
  sendRoom(room, m); for (const w of room.watchers ?? []) if (w.readyState === 1) w.send(JSON.stringify(m));
}

// ------------------------------------------------------------------ rooms
const rooms = new Map();
const code = () => { const A = "ABCDEFGHJKLMNPQRSTUVWXYZ"; let c; do { c = Array.from({ length: 4 }, () => A[(Math.random() * A.length) | 0]).join(""); } while (rooms.has(c)); return c; };
const clean = (n) => String(n ?? "").replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 16) || "Player";

const GRACE = 60000; // a player who drops out of a running game keeps their slot this long
const AI_NAMES = ["Ashford", "Brennmark", "Cold Harbour", "Dunmere"];
// lobby: the host is a person (room.host = their socket); if they leave, the next human in the list takes over
function sendLobby(room) {
  if (!room.slots.some((x) => x.ws === room.host)) room.host = room.slots.find((x) => x.ws)?.ws ?? null;
  const host = room.slots.findIndex((x) => x.ws === room.host);
  room.slots.forEach((slot, i) => slot.ws?.readyState === 1 && slot.ws.send(JSON.stringify({ t: "lobby", code: room.code, host, you: i, public: !!room.public, slots: room.slots.map((x) => ({ name: x.name, ai: x.ai ?? null, team: x.team })) })));
}
const freeTeam = (room) => [0, 1, 2, 3].find((t) => !room.slots.some((x) => x.team === t)) ?? 0; // new players start on a team of their own
// open public lobbies for the menu list
const lobbies = () => [...rooms.values()].filter((r) => r.public && !r.sim && r.slots.length < 4 && r.slots.some((x) => x.ws))
  .map((r) => ({ code: r.code, host: r.slots.find((x) => x.ws === r.host)?.name ?? "?", players: r.slots.map((x) => x.name), since: r.created }));
const freeAiName = (room) => AI_NAMES.find((n) => !room.slots.some((x) => x.name === n + " AI")) + " AI";
// every human slot gets a secret token so a reloaded page / dropped connection can take the slot back
function seat(room, slot) { slot.token = randomUUID(); slot.ws.send(JSON.stringify({ t: "session", code: room.code, token: slot.token })); }
function sendRoom(room, msg) { const m = JSON.stringify(msg); for (const s of room.slots) if (s.ws?.readyState === 1) s.ws.send(m); }

function startRoom(room, seed) {
  room.sim = createGame({ seed, peaceful: !!room.peaceful, players: room.slots.map((s, i) => ({ name: s.name, ai: s.ai, team: s.team ?? i })) });
  room.id = randomUUID().replace(/-/g, "").slice(0, 10);
  room.rec = []; // [tick, player, command]
  const map = JSON.stringify(mapInfo(room.sim));
  room.slots.forEach((s, i) => { if (s.ws?.readyState === 1) { s.ws.send(map); s.ws.send(JSON.stringify({ t: "start", me: i })); } });
  room.map = map;
  for (const w of room.watchers ?? []) if (w.readyState === 1) { w.send(map); w.send(JSON.stringify({ t: "start", me: -1 })); }
  room.timer = setInterval(() => tickRoom(room), TICK * 1000);
}
function apply(s, pid, c) { try { command(s, pid, c); } catch (e) { console.warn("bad command", e.message); } }
function tickRoom(room) {
  const s = room.sim;
  room.slots.forEach((slot, i) => { // dropped out and didn't come back in time: resign for them
    if (slot.leftAt && !slot.gone && Date.now() - slot.leftAt > GRACE) { slot.gone = true; room.inbox.push([i, { t: "resign" }]); notice(room, `${slot.name} left the game.`); }
  });
  const humans = room.slots.filter((x) => !x.ai);
  if (!room.replay && humans.length && humans.every((x) => x.leftAt && !x.gone)) return; // every human dropped out: pause until one is back
  for (const [pid, c] of room.inbox.splice(0)) {
    if (c.ids !== undefined && (!Array.isArray(c.ids) || c.ids.length > 200 || !c.ids.every(Number.isInteger))) continue;
    for (const f of ["x", "y", "x2", "y2"]) if (c[f] !== undefined) c[f] = Number(c[f]) || 0;
    if (c.t === "build" || c.t === "tree" || c.t === "wall") for (const f of ["x", "y", "x2", "y2"]) if (c[f] !== undefined) c[f] = Math.floor(c[f]);
    const res = ["food", "wood", "gold"].includes(c.res) ? c.res : undefined, to = Number.isInteger(c.to) ? c.to : undefined;
    const clean = { t: String(c.t), ids: c.ids, id: c.id, kind: c.kind, slot: c.slot, x: c.x, y: c.y, x2: c.x2, y2: c.y2, res, buy: c.buy === undefined ? undefined : !!c.buy, to }; // only known fields go into the replay
    for (const k of Object.keys(clean)) if (clean[k] === undefined) delete clean[k];
    room.rec.push([s.tick, pid, clean]);
    apply(s, pid, clean);
  }
  for (let n = 0; n < (room.speed ?? 1); n++) {
    if (room.replay) { // feed the recorded commands at the tick they were applied
      const r = room.replay;
      while (r.i < r.cmds.length && r.cmds[r.i][0] <= s.tick) { const [, pid, c] = r.cmds[r.i++]; apply(s, pid, c); }
      if (s.tick >= r.ticks) { if (!room.endAt) { room.endAt = Date.now() + 60000; finish(room); } break; } // recording ends here
    }
    try { step(s); } catch (e) { console.error("sim error", e); closeRoom(room); sendRoom(room, { t: "error", msg: "The game crashed, sorry." }); return; }
    if (!room.replay) for (const ev of s.events) publish(room.id, ev);
    s.events = [];
    if (s.over) break;
  }
  room.slots.forEach((slot, i) => { if (slot.ws?.readyState === 1) slot.ws.send(JSON.stringify(snapshot(s, i))); });
  if (room.watchers?.length) { const m = JSON.stringify(snapshot(s, -1)); for (const w of room.watchers) if (w.readyState === 1) w.send(m); }
  if (s.over && !room.endAt) { room.endAt = Date.now() + (room.replay ? 60000 : 30000); finish(room); }
  const anyone = room.slots.some((x) => x.ws?.readyState === 1 || (x.leftAt && !x.gone)) || room.watchers?.some((w) => w.readyState === 1);
  if ((room.endAt && Date.now() > room.endAt) || !anyone) closeRoom(room);
}
function notice(room, msg) { sendRoom(room, { t: "notice", msg }); }
// chat and map pings: to everyone, or (team chat, pings) only to the sender's allies
function teamOf(room, i) { return room.sim ? (room.sim.peaceful ? 0 : room.sim.players[i]?.team) : room.slots[i]?.team; }
function sendTeam(room, from, msg) { const m = JSON.stringify(msg), t = teamOf(room, from); room.slots.forEach((s, i) => { if (s.ws?.readyState === 1 && teamOf(room, i) === t) s.ws.send(m); }); }
function closeRoom(room) { clearInterval(room.timer); rooms.delete(room.code); if (room.sim && !room.sim.over) saveReplay(room); }

// ------------------------------------------------------------------ http + ws
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/health") return res.end("ok");
  if (url.pathname === "/api/lobbies") return res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" }).end(JSON.stringify(lobbies()));
  if (url.pathname === "/api/replays") return res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" }).end(JSON.stringify(replays.slice(0, 50)));
  let path = url.pathname === "/" ? "/public/index.html" : url.pathname;
  if (path.startsWith("/shared/")) path = path; else if (!path.startsWith("/public/")) path = "/public" + path;
  if (path.includes("..")) return res.writeHead(400).end();
  try {
    let body = await readFile(new URL("." + path, import.meta.url));
    const ext = extname(path);
    if (ext === ".html" || ext === ".js") {
      // cache busting: every deploy gets a new version stamp on all local file references
      body = body.toString().replace(/(["'])(\/(?:shared|vendor|assets)?\/?[\w.\/-]+\.(?:js|json|png))\1/g, `$1$2?v=${VERSION}$1`).replace("__ER_VERSION__", VERSION);
    }
    const cache = url.searchParams.get("v") === VERSION ? "public, max-age=31536000, immutable" : "no-cache";
    res.writeHead(200, { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Cache-Control": cache }).end(body);
  } catch { res.writeHead(404).end("not found"); }
});

const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });
// heartbeat: proxies (Traefik/Cloudflare) close silent WebSockets after ~100 s, which killed idle lobbies
setInterval(() => { for (const c of wss.clients) { if (c.alive === false) { c.terminate(); continue; } c.alive = false; c.ping(); } }, 25000);
wss.on("connection", (ws) => {
  let room = null, pid = -1, last = 0, burst = 0, lastChat = 0, chatN = 0, lastMark = 0;
  ws.alive = true; ws.on("pong", () => (ws.alive = true));
  const reply = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
  ws.on("message", (raw) => {
    const now = Date.now(); if (now - last > 1000) { last = now; burst = 0; } if (++burst > 40) return; // flood guard
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === "ping") return;
    if (room) pid = room.slots.findIndex((s) => s.ws === ws); // slots can shift while in the lobby
    if (m.t === "cmd") { if (room?.sim && pid >= 0 && m.c && typeof m.c === "object") room.inbox.push([pid, m.c]); return; }
    if (m.t === "chat" && room && pid >= 0) { // flood guard: 5 messages per 5 s
      if (now - lastChat > 5000) { lastChat = now; chatN = 0; } if (++chatN > 5) return reply({ t: "notice", msg: "Slow down a little." });
      const text = String(m.text ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 140); if (!text) return;
      const slot = room.slots[pid], msg = { t: "chat", from: slot.name, color: pid, text, team: !!m.team };
      return m.team ? sendTeam(room, pid, msg) : sendRoom(room, msg);
    }
    if (m.t === "mark" && room?.sim && pid >= 0 && !room.sim.over) { // map ping, seen by allies
      if (now - lastMark < 800) return; lastMark = now;
      const x = Math.max(0, Math.min(room.sim.w, Number(m.x) || 0)), y = Math.max(0, Math.min(room.sim.h, Number(m.y) || 0));
      return sendTeam(room, pid, { t: "mark", x, y, from: room.slots[pid].name, color: pid });
    }
    if (room && !["addAI", "start", "kick", "speed", "team", "public"].includes(m.t)) return;
    switch (m.t) {
      case "rejoin": { // take a slot back in a running game (page reload, network drop)
        const r = rooms.get(String(m.code ?? "").toUpperCase());
        const i = r?.sim && !r.sim.over && typeof m.token === "string" ? r.slots.findIndex((x) => x.token === m.token && !x.gone) : -1;
        if (i < 0) return reply({ t: "error", msg: "That game has ended.", rejoin: false });
        const slot = r.slots[i], old = slot.ws;
        slot.ws = ws; slot.leftAt = null; room = r; pid = i;
        if (old && old !== ws && old.readyState === 1) old.close(4000, "replaced"); // the game was opened in another tab
        ws.send(r.map); ws.send(JSON.stringify({ t: "start", me: i }));
        notice(r, `${slot.name} is back.`);
        break;
      }
      case "replay": {
        if (rooms.size >= MAX_ROOMS) return reply({ t: "error", msg: "Server is full, try again later." });
        const id = String(m.id ?? "");
        if (!/^[a-f0-9]{8,12}$/.test(id) || !replays.some((r) => r.id === id)) return reply({ t: "error", msg: "Replay not found." });
        room = { code: code(), slots: [], inbox: [], watchers: [ws], speed: [1, 2, 4, 8].includes(+m.speed) ? +m.speed : 2 };
        rooms.set(room.code, room);
        readFile(`${REPLAYS}/${id}.json`, "utf8").then((txt) => {
          const r = JSON.parse(txt);
          if (r.sim !== SIM_HASH) { rooms.delete(room.code); room = null; return reply({ t: "error", msg: "This replay was recorded with an older version of the game and can't be played back." }); }
          room.slots = r.players.map((p, i) => ({ name: p.name, ai: p.ai, team: p.team ?? i }));
          room.replay = { id, cmds: r.cmds, ticks: r.ticks, i: 0 }; room.peaceful = !!r.peaceful;
          if (ws.readyState === 1) startRoom(room, r.seed); else rooms.delete(room.code);
        }).catch(() => { rooms.delete(room.code); room = null; reply({ t: "error", msg: "Replay not found." }); });
        break;
      }
      case "watch": {
        if (rooms.size >= MAX_ROOMS) return reply({ t: "error", msg: "Server is full, try again later." });
        const diff = ["easy", "normal", "hard"].includes(m.diff) ? m.diff : "normal";
        const n = Math.min(4, Math.max(2, (Number(m.ais) || 1) + 1));
        room = { code: code(), slots: [], inbox: [], watchers: [ws], speed: [1, 2, 4, 8].includes(+m.speed) ? +m.speed : 2 };
        for (let i = 0; i < n; i++) room.slots.push({ name: ["Ashford", "Brennmark", "Cold Harbour", "Dunmere"][i] + " AI", ai: diff });
        rooms.set(room.code, room); startRoom(room);
        break;
      }
      case "speed": if (room?.watchers?.includes(ws) && [1, 2, 4, 8].includes(+m.speed)) room.speed = +m.speed; break;
      case "single": {
        if (rooms.size >= MAX_ROOMS) return reply({ t: "error", msg: "Server is full, try again later." });
        const diff = ["easy", "normal", "hard"].includes(m.diff) ? m.diff : "normal";
        const n = Math.min(3, Math.max(1, Number(m.ais) || 1));
        room = { code: code(), slots: [{ name: clean(m.name), ws }], inbox: [], peaceful: !!m.peaceful };
        for (let i = 0; i < n; i++) room.slots.push({ name: AI_NAMES[i] + (room.peaceful ? "" : " AI"), ai: diff });
        // "ally": you and the first computer player against the rest
        room.slots.forEach((x, i) => (x.team = m.teams === "ally" && n >= 2 ? (i < 2 ? 0 : 1) : i));
        rooms.set(room.code, room); pid = 0; seat(room, room.slots[0]); startRoom(room);
        break;
      }
      case "create":
        if (rooms.size >= MAX_ROOMS) return reply({ t: "error", msg: "Server is full, try again later." });
        room = { code: code(), slots: [{ name: clean(m.name), ws, team: 0 }], inbox: [], host: ws, public: !!m.public, created: Date.now() }; rooms.set(room.code, room); pid = 0;
        seat(room, room.slots[0]); sendLobby(room);
        break;
      case "join": {
        const r = rooms.get(String(m.code ?? "").toUpperCase());
        if (!r) return reply({ t: "error", msg: "No game with that code." });
        if (r.sim) return reply({ t: "error", msg: "That game has already started." });
        if (r.slots.length >= 4) return reply({ t: "error", msg: "That game is full." });
        room = r; pid = r.slots.length; r.slots.push({ name: clean(m.name), ws, team: freeTeam(r) });
        seat(r, r.slots[pid]); sendLobby(r);
        break;
      }
      case "addAI":
        if (room && ws === room.host && !room.sim && room.slots.length < 4) {
          const diff = ["easy", "normal", "hard"].includes(m.diff) ? m.diff : "normal";
          room.slots.push({ name: freeAiName(room), ai: diff, team: freeTeam(room) });
          sendLobby(room);
        }
        break;
      case "kick":
        if (room && ws === room.host && !room.sim && room.slots[m.slot]?.ai) { room.slots.splice(m.slot, 1); sendLobby(room); }
        break;
      case "team": // host sets anyone's team, players their own
        if (room && !room.sim && room.slots[m.slot] && (ws === room.host || room.slots[m.slot].ws === ws) && [0, 1, 2, 3].includes(m.team)) { room.slots[m.slot].team = m.team; sendLobby(room); }
        break;
      case "public":
        if (room && ws === room.host && !room.sim) { room.public = !!m.on; sendLobby(room); }
        break;
      case "start":
        if (room && ws === room.host && !room.sim && room.slots.length >= 2) {
          if (new Set(room.slots.map((x) => x.team)).size < 2) return reply({ t: "error", msg: "Everyone is on the same team. Put someone on another team first." });
          startRoom(room);
        }
        break;
    }
  });
  ws.on("close", () => {
    if (!room) return;
    if (!room.sim) {
      const i = room.slots.findIndex((s) => s.ws === ws);
      if (i >= 0) room.slots.splice(i, 1);
      if (!room.slots.some((s) => s.ws)) rooms.delete(room.code); else sendLobby(room); // host gone: sendLobby hands it over
    } else {
      const i = room.slots.findIndex((s) => s.ws === ws);
      if (i >= 0 && !room.sim.over) { // keep the slot for GRACE; tickRoom resigns for them if they don't rejoin
        const slot = room.slots[i]; slot.ws = null; slot.leftAt = Date.now();
        if (room.sim.players[i]?.alive) notice(room, `${slot.name} lost connection. Waiting up to 60 s for them to come back…`);
      } else if (i >= 0) room.slots[i].ws = null;
    }
  });
});

await loadReplays();
server.listen(PORT, () => console.log(`Ember Realms on :${PORT}, events -> ${BROKER ? TOPIC : "(broker off)"}`));
