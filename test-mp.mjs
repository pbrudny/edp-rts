// Multiplayer session checks against a running server: host handover in the lobby, rejoin after a drop, pause when every human is gone.
// usage: node test-mp.mjs ws://127.0.0.1:3000
import WebSocket from "ws";
const URL = process.argv[2], sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client(first, label) {
  const c = { ws: new WebSocket(URL), msgs: [], last: null, label };
  c.ws.on("open", () => c.ws.send(JSON.stringify(first)));
  c.ws.on("message", (d) => { const m = JSON.parse(d); if (m.t === "s") c.last = m; else c.msgs.push(m); });
  c.ws.on("close", (code) => (c.closed = code));
  c.send = (m) => c.ws.send(JSON.stringify(m)); c.get = (t) => c.msgs.filter((m) => m.t === t).at(-1); return c;
}
let ok = true; const check = (name, cond) => { console.log((cond ? "PASS " : "FAIL ") + name); ok &&= !!cond; };
// --- 2. host handover
const h = client({ t: "create", name: "Host" }); await sleep(500);
const code = h.get("lobby").code;
const g = client({ t: "join", code, name: "Guest" }); await sleep(300);
const g2 = client({ t: "join", code, name: "Third" }); await sleep(300);
h.send({ t: "addAI", diff: "easy" }); await sleep(300);
check("guest is not host", g.get("lobby").host !== g.get("lobby").you);
g.send({ t: "start" }); await sleep(300);
check("guest can't start", !g.msgs.some((m) => m.t === "start"));
h.ws.close(); await sleep(400);
const L = g.get("lobby");
check(`host handed to Guest (slots: ${L.slots.map((s) => s.name).join(",")})`, L.host === L.you && L.slots[L.host].name === "Guest");
check("Third sees Guest as host", g2.get("lobby").host === 0 && g2.get("lobby").you === 1);
g.send({ t: "addAI", diff: "easy" }); await sleep(300);
check("new host can add AI with a free name", g.get("lobby").slots.filter((s) => s.ai).map((s) => s.name).join() === "Ashford AI,Brennmark AI");
g.send({ t: "start" }); await sleep(800);
check("new host starts the game", g.get("start")?.me === 0 && g2.get("start")?.me === 1);
// --- 1. rejoin
const tok = g2.get("session"); await sleep(1000);
g2.ws.close(); await sleep(400);
check("others told about the drop", g.msgs.some((m) => m.t === "notice" && /Third lost connection/.test(m.msg)));
await sleep(3000);
const back = client({ t: "rejoin", code: tok.code, token: tok.token }); await sleep(800);
check("rejoin gets map + same seat", back.msgs.some((m) => m.t === "map") && back.get("start")?.me === 1 && back.last?.me === 1);
check("still alive after rejoin", back.last?.players[1].alive);
check("others told player is back", g.msgs.some((m) => m.t === "notice" && /Third is back/.test(m.msg)));
const bad = client({ t: "rejoin", code: tok.code, token: "nope" }); await sleep(400);
check("wrong token refused", bad.msgs[0]?.rejoin === false);
const tab2 = client({ t: "rejoin", code: tok.code, token: tok.token }); await sleep(600);
check("second tab takes over, first closed with 4000", back.closed === 4000 && tab2.get("start")?.me === 1);
// --- pause when every human is gone (single player)
const sp = client({ t: "single", name: "Solo", ais: 1 }); await sleep(1500);
const st = sp.get("session"), t0 = sp.last.tick; sp.ws.close(); await sleep(3000);
const sp2 = client({ t: "rejoin", code: st.code, token: st.token }); await sleep(600);
check(`single player paused while away (tick ${t0} -> ${sp2.last?.tick})`, sp2.last && sp2.last.tick - t0 < 15);
process.exit(ok ? 0 : 1);
