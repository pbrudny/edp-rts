import WebSocket from "ws";
const URL = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client(first) {
  const c = { ws: new WebSocket(URL), snaps: 0, last: null, map: null, msgs: [] };
  c.ws.on("open", () => first && c.ws.send(JSON.stringify(first)));
  c.ws.on("message", (d) => { const m = JSON.parse(d); if (m.t === "s") { c.snaps++; c.last = m; } else { c.msgs.push(m); if (m.t === "map") c.map = m; } });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  return c;
}
// single player
const a = client({ t: "single", name: "Bot", diff: "hard", ais: 1 });
await sleep(1500);
const kinds = a.map.kinds, K = (e) => kinds[e[1]];
const mine = () => a.last.ents.filter((e) => e[2] === a.last.me);
const vills = mine().filter((e) => K(e) === "villager").map((e) => e[0]);
const tc = mine().find((e) => K(e) === "tc");
const berries = a.last.ents.find((e) => K(e) === "berries");
console.log("SP start: me", a.last.me, "ents", a.last.ents.length, "villagers", vills.length, "res", JSON.stringify(a.last.res));
a.send({ t: "cmd", c: { t: "target", ids: vills.slice(0, 2), id: berries[0] } });
a.send({ t: "cmd", c: { t: "train", id: tc[0], kind: "villager" } });
a.send({ t: "cmd", c: { t: "build", ids: [vills[2]], kind: "house", x: tc[3] + 4, y: tc[4] } });
await sleep(25000);
const m2 = mine();
console.log("SP after 25s: snaps", a.snaps, "res", JSON.stringify(a.last.res), "my", m2.map((e) => K(e) + (KIND => "")()).join(","));
console.log("  house built%", m2.find((e) => K(e) === "house")?.[6], "carry", m2.filter((e) => K(e) === "villager").map((e) => e[6]).join(","));
a.send({ t: "cmd", c: { t: "resign" } });
await sleep(500);
console.log("  after resign alive:", a.last.players.map((p) => p.name + ":" + p.alive).join(" "), "over", a.last.over);
a.ws.close();
// multiplayer
const h = client({ t: "create", name: "Host" });
await sleep(800);
const code = h.msgs.find((m) => m.t === "lobby").code;
const g = client({ t: "join", code, name: "Guest" });
await sleep(800);
h.send({ t: "addAI", diff: "easy" });
await sleep(500);
console.log("MP lobby:", JSON.stringify(h.msgs.filter((m) => m.t === "lobby").at(-1).slots));
h.send({ t: "start" });
await sleep(2000);
console.log("MP: host me", h.last?.me, "guest me", g.last?.me, "snaps", h.snaps, g.snaps, "players", h.last?.players.map((p) => p.name).join(","));
const gv = g.last.ents.filter((e) => e[2] === g.last.me && kinds[e[1]] === "villager").map((e) => e[0]);
const hv = h.last.ents.filter((e) => e[2] === h.last.me && kinds[e[1]] === "villager").map((e) => e[0]);
g.send({ t: "cmd", c: { t: "move", ids: hv, x: 40, y: 40 } }); // guest tries to move host's villagers: must be ignored
await sleep(1500);
const moved = h.last.ents.filter((e) => hv.includes(e[0]) && e[7] === 4).length;
console.log("MP: host villagers moved by guest (should be 0):", moved);
h.ws.close(); g.ws.close();
await sleep(300);
process.exit(0);
