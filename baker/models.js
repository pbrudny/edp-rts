// Low-poly models for Ember Realms. Ground = XZ plane, 1 world unit = 1 map tile, Y up.
// Characters face +X; +Z is their right side. Meshes tagged `userData.team = true` get the player colour (mask pass).
import * as THREE from "./vendor/three.module.js";

const mats = new Map();
export function mat(hex, opts = {}) {
  const key = hex + JSON.stringify(opts);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85, metalness: 0, flatShading: true, ...opts }));
  return mats.get(key);
}
const TEAM = 0xd8d8d8; // neutral; replaced by the player colour at runtime

function rnd(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function mesh(geo, m, team = false) { const o = new THREE.Mesh(geo, m); o.castShadow = true; o.receiveShadow = true; if (team) o.userData.team = true; return o; }
const box = (w, h, d, c, team) => mesh(new THREE.BoxGeometry(w, h, d), mat(c), team);
const cyl = (rt, rb, h, c, seg = 8, team) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(c), team);
const sph = (r, c, team, w = 8, h = 6) => mesh(new THREE.SphereGeometry(r, w, h), mat(c), team);
function at(o, x, y, z) { o.position.set(x, y, z); return o; }
function jitter(geo, amt, seed) { const r = rnd(seed), p = geo.attributes.position; const seen = new Map(); for (let i = 0; i < p.count; i++) { const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`; if (!seen.has(k)) seen.set(k, [(r() - 0.5) * amt, (r() - 0.5) * amt, (r() - 0.5) * amt]); const d = seen.get(k); p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]); } geo.computeVertexNormals(); return geo; }

// ------------------------------------------------------------------ characters
// returns { root, parts } where parts are pivot groups the animator rotates
function humanoid({ tunic, legs = 0x4a3a2a, skin = 0xe0b089, boots = 0x2e2117 }) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const S = 0.85; // overall scale (character ~0.75 tiles tall)
  body.scale.setScalar(S);
  const P = {};
  const limb = (r, len, c, team) => { const g = new THREE.Group(); const m = cyl(r, r * 0.85, len, c, 7, team); m.position.y = -len / 2; g.add(m); return g; };
  P.legL = limb(0.05, 0.34, legs); at(P.legL, 0, 0.36, -0.065); body.add(P.legL);
  P.legR = limb(0.05, 0.34, legs); at(P.legR, 0, 0.36, 0.065); body.add(P.legR);
  for (const l of [P.legL, P.legR]) { const b = box(0.12, 0.05, 0.08, boots); b.position.set(0.025, -0.34, 0); l.add(b); }
  P.torso = new THREE.Group(); at(P.torso, 0, 0.36, 0); body.add(P.torso);
  const t = box(0.15, 0.3, 0.24, tunic, tunic === TEAM); t.position.y = 0.15; P.torso.add(t);
  const skirt = cyl(0.13, 0.16, 0.1, tunic, 8, tunic === TEAM); skirt.position.y = 0.0; P.torso.add(skirt);
  const belt = box(0.16, 0.035, 0.25, 0x4a2f1a); belt.position.y = 0.06; P.torso.add(belt);
  P.head = new THREE.Group(); at(P.head, 0, 0.36, 0); P.torso.add(P.head);
  P.head.add(at(sph(0.085, skin), 0, 0.06, 0));
  P.head.add(at(box(0.03, 0.03, 0.03, 0xc48a66), 0.08, 0.055, 0)); // nose
  P.armL = limb(0.035, 0.28, skin); at(P.armL, 0, 0.29, -0.155); P.torso.add(P.armL);
  P.armR = limb(0.035, 0.28, skin); at(P.armR, 0, 0.29, 0.155); P.torso.add(P.armR);
  for (const a of [P.armL, P.armR]) { const sleeve = cyl(0.045, 0.042, 0.12, tunic, 7, tunic === TEAM); sleeve.position.y = -0.05; a.add(sleeve); }
  P.handL = at(new THREE.Group(), 0, -0.28, 0); P.armL.add(P.handL);
  P.handR = at(new THREE.Group(), 0, -0.28, 0); P.armR.add(P.handR);
  return { root, body, P };
}

export function makeUnit(kind) {
  if (kind === "villager") {
    const h = humanoid({ tunic: TEAM, legs: 0x6b5236 });
    const hat = new THREE.Group(); hat.add(at(cyl(0.16, 0.17, 0.02, 0xc9a35a, 10), 0, 0.12, 0)); hat.add(at(cyl(0.07, 0.09, 0.08, 0xc9a35a, 10), 0, 0.16, 0)); h.P.head.add(hat);
    const tool = new THREE.Group(); tool.add(at(cyl(0.015, 0.015, 0.42, 0x7a5532, 6), 0, 0.12, 0)); tool.add(at(box(0.12, 0.05, 0.02, 0x8c939b), 0.05, 0.31, 0));
    tool.rotation.z = -Math.PI / 2; tool.position.set(0.02, 0, 0); h.P.handR.add(tool);
    h.P.tool = tool;
    return h;
  }
  if (kind === "swordsman") {
    const h = humanoid({ tunic: TEAM, legs: 0x575c63, boots: 0x3a3f45 });
    h.P.torso.add(at(box(0.16, 0.16, 0.25, 0x8e959e, false), 0, 0.24, 0)); // mail
    const helm = new THREE.Group(); helm.add(at(sph(0.095, 0xb7bec7, false, 10, 6), 0, 0.08, 0)); helm.add(at(cyl(0.11, 0.11, 0.025, 0x9aa1aa, 10), 0, 0.05, 0)); helm.add(at(box(0.015, 0.09, 0.02, 0x9aa1aa), 0.1, 0.04, 0)); h.P.head.add(helm);
    const shield = new THREE.Group(); const sm = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.03, 12), mat(TEAM), true); sm.rotation.x = Math.PI / 2; shield.add(sm);
    shield.add(at(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.035, 8), mat(0xc9a35a)), 0, 0, -0.01)); shield.children[1].rotation.x = Math.PI / 2;
    shield.position.set(0.06, 0.02, -0.05); shield.rotation.y = 0.25; h.P.handL.add(shield);
    const sword = new THREE.Group(); sword.add(at(box(0.025, 0.4, 0.06, 0xdfe5ec), 0, 0.26, 0)); sword.add(at(box(0.03, 0.03, 0.16, 0x8a6a32), 0, 0.05, 0)); sword.add(at(cyl(0.018, 0.018, 0.08, 0x5a3f22, 6), 0, 0.0, 0));
    sword.rotation.z = -Math.PI / 2; h.P.handR.add(sword); h.P.tool = sword;
    return h;
  }
  if (kind === "archer") {
    const h = humanoid({ tunic: TEAM, legs: 0x4c5530 });
    const hood = new THREE.Group(); hood.add(at(sph(0.1, 0x4f5f2c, false, 8, 6), -0.01, 0.08, 0)); hood.add(at(box(0.05, 0.16, 0.2, 0x4f5f2c), -0.06, -0.02, 0)); h.P.head.add(hood);
    h.P.torso.add(at(box(0.05, 0.3, 0.24, 0x4f5f2c), -0.1, 0.14, 0)); // cloak
    const quiver = at(cyl(0.04, 0.04, 0.24, 0x6b4a2a, 7), -0.1, 0.22, 0.06); quiver.rotation.x = 0.3; h.P.torso.add(quiver);
    const bow = new THREE.Group(); const arc = mesh(new THREE.TorusGeometry(0.24, 0.012, 4, 14, Math.PI * 0.9), mat(0x6d4a24)); arc.rotation.z = Math.PI / 2 - Math.PI * 0.45; bow.add(arc);
    bow.rotation.y = Math.PI / 2; bow.position.set(0.02, 0, 0); h.P.handL.add(bow); h.P.tool = bow;
    return h;
  }
}

// animation pose: anim in idle|walk|attack|work|death, t in [0,1)
export function pose(kind, h, anim, t) {
  const P = h.P, s = Math.sin(t * Math.PI * 2);
  for (const k of ["legL", "legR", "armL", "armR", "torso", "head"]) P[k].rotation.set(0, 0, 0);
  h.body.rotation.set(0, 0, 0); h.body.position.set(0, 0, 0);
  if (kind === "archer") { P.armL.rotation.z = 0.25; }
  if (kind === "swordsman") { P.armL.rotation.z = 0.5; P.armL.rotation.x = 0.2; }
  if (anim === "idle") { P.armR.rotation.z = 0.1; }
  if (anim === "walk") {
    P.legL.rotation.z = s * 0.55; P.legR.rotation.z = -s * 0.55;
    P.armR.rotation.z += s * 0.45; if (kind === "villager") P.armL.rotation.z = -s * 0.45;
    h.body.position.y = Math.abs(Math.cos(t * Math.PI * 2)) * 0.025;
  }
  if (anim === "attack" && kind === "archer") {
    const draw = t < 0.66 ? t / 0.66 : 1 - (t - 0.66) / 0.34;
    P.armL.rotation.z = 1.45; P.armR.rotation.z = 1.45 - draw * 0.3; P.armR.rotation.x = -draw * 0.5; P.torso.rotation.y = -0.25;
  } else if (anim === "attack" || anim === "work") {
    // raise then strike
    const a = t < 0.5 ? t / 0.5 : 1 - (t - 0.5) / 0.5 * 1.15;
    P.armR.rotation.z = -0.4 + a * 2.6 - 0.9; P.torso.rotation.z = -a * 0.15 + 0.08; P.torso.rotation.y = a * 0.2;
    if (kind === "villager" && anim === "work") { P.armL.rotation.z = P.armR.rotation.z * 0.9; }
    if (anim === "work") { h.body.rotation.z = -0.12; }
    P.legL.rotation.z = 0.25; P.legR.rotation.z = -0.15;
  }
  if (anim === "death") {
    const a = Math.min(1, t * 1.25);
    h.body.rotation.z = a * (Math.PI / 2 - 0.05); h.body.position.y = Math.sin(a * Math.PI) * 0.05; h.body.position.x = -a * 0.25;
    P.armR.rotation.z = a * 1.2; P.armL.rotation.z = a * 1.0; P.legL.rotation.z = a * 0.3;
  }
}

// ------------------------------------------------------------------ nature
export function makeTree(v) {
  const r = rnd(100 + v), g = new THREE.Group(), pine = v >= 5;
  const trunkH = pine ? 0.45 : 0.55 + r() * 0.2;
  g.add(at(cyl(0.05, 0.08, trunkH, 0x5a3b22, 6), 0, trunkH / 2, 0));
  if (pine) {
    const greens = [0x2d5a32, 0x2f6236, 0x284f2d];
    for (let i = 0; i < 4; i++) { const c = mesh(jitter(new THREE.ConeGeometry(0.42 - i * 0.08, 0.5, 8), 0.05, v * 10 + i), mat(greens[i % 3])); c.position.y = 0.45 + i * 0.28; g.add(c); }
  } else {
    const greens = [0x3f7a33, 0x4a8a3a, 0x35692b, 0x55913f];
    for (let i = 0; i < 6; i++) {
      const rr = 0.24 + r() * 0.14, a = r() * Math.PI * 2, d = i === 0 ? 0 : 0.18 + r() * 0.08;
      const b = mesh(jitter(new THREE.IcosahedronGeometry(rr, 1), 0.07, v * 20 + i), mat(greens[(v + i) % 4]));
      b.position.set(Math.cos(a) * d, trunkH + 0.12 + r() * 0.3 + (i === 0 ? 0.25 : 0), Math.sin(a) * d); g.add(b);
    }
  }
  const sc = 0.9 + r() * 0.35; g.scale.setScalar(sc); g.rotation.y = r() * 6.28;
  return g;
}
export function makeStump() { const g = new THREE.Group(); g.add(at(cyl(0.08, 0.1, 0.1, 0x6b4a2a, 7), 0, 0.05, 0)); g.add(at(cyl(0.075, 0.075, 0.01, 0xc9a774, 7), 0, 0.105, 0)); return g; }
export function makeGold(v) {
  const r = rnd(300 + v), g = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const rr = 0.25 + r() * 0.3, a = r() * 6.28, d = r() * 0.5;
    const m = mesh(jitter(new THREE.DodecahedronGeometry(rr, 0), 0.12, v * 7 + i), mat([0x9c968a, 0xaaa396, 0x8a8478][i % 3]));
    m.position.set(Math.cos(a) * d, rr * 0.55, Math.sin(a) * d); m.rotation.set(r(), r(), r()); g.add(m);
  }
  for (let i = 0; i < 16; i++) {
    const n = mesh(new THREE.IcosahedronGeometry(0.07 + r() * 0.06, 0), mat(0xf2c041, { metalness: 0.7, roughness: 0.3, emissive: 0x3a2800 }));
    const a = r() * 6.28, d = 0.15 + r() * 0.55; n.position.set(Math.cos(a) * d, 0.1 + r() * 0.45, Math.sin(a) * d); g.add(n);
  }
  return g;
}
export function makeBerries(v) {
  const r = rnd(500 + v), g = new THREE.Group();
  for (let i = 0; i < 6; i++) { const b = mesh(jitter(new THREE.IcosahedronGeometry(0.17 + r() * 0.06, 1), 0.04, v * 5 + i), mat([0x2f5a26, 0x3a6a2e][i % 2])); const a = r() * 6.28, d = i ? 0.14 : 0; b.position.set(Math.cos(a) * d, 0.17 + r() * 0.08, Math.sin(a) * d); g.add(b); }
  for (let i = 0; i < 18; i++) { const b = sph(0.03, 0xb3192f, false, 5, 4); const a = r() * 6.28, d = 0.12 + r() * 0.16; b.position.set(Math.cos(a) * d, 0.12 + r() * 0.26, Math.sin(a) * d); g.add(b); }
  return g;
}

// ------------------------------------------------------------------ buildings (footprint centred on the origin)
function gable(w, d, h, c) { // roof along X: w = length, d = depth, h = height
  const s = new THREE.Shape(); s.moveTo(-d / 2, 0); s.lineTo(0, h); s.lineTo(d / 2, 0); s.lineTo(-d / 2, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false }); geo.translate(0, 0, -w / 2); geo.rotateY(Math.PI / 2);
  return mesh(geo, mat(c));
}
function timberWall(g, w, d, h, y0, plaster = 0xe6d6b4, beam = 0x4a3220) {
  g.add(at(box(w, h, d, plaster), 0, y0 + h / 2, 0));
  const t = 0.035;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(at(box(t * 1.4, h, t * 1.4, beam), sx * (w / 2), y0 + h / 2, sz * (d / 2)));
  for (const sz of [-1, 1]) { g.add(at(box(w, t, t * 1.2, beam), 0, y0 + h - t / 2, sz * (d / 2))); g.add(at(box(w, t, t * 1.2, beam), 0, y0 + t / 2, sz * (d / 2))); g.add(at(box(w, t, t * 1.2, beam), 0, y0 + h * 0.5, sz * (d / 2))); for (let i = 1; i < 4; i++) g.add(at(box(t, h, t * 1.2, beam), -w / 2 + (w * i) / 4, y0 + h / 2, sz * (d / 2))); }
  for (const sx of [-1, 1]) { g.add(at(box(t * 1.2, t, d, beam), sx * (w / 2), y0 + h - t / 2, 0)); g.add(at(box(t * 1.2, h, t, beam), sx * (w / 2), y0 + h / 2, 0)); }
}
function door(g, x, y, z, rotY = 0, w = 0.22, h = 0.34) { const d = at(box(0.03, h, w, 0x3b2716), x, y + h / 2, z); d.rotation.y = rotY; g.add(d); }
function windowAt(g, x, y, z, rotY = 0) { const w = at(box(0.025, 0.12, 0.12, 0x2b2016), x, y, z); w.rotation.y = rotY; g.add(w); const l = at(box(0.028, 0.08, 0.08, 0xf2b860, false), x, y, z); l.material = mat(0xf2b860, { emissive: 0x6a3a10 }); l.rotation.y = rotY; g.add(l); }
function flagPole(g, x, z, h) { g.add(at(cyl(0.015, 0.02, h, 0x5a4630, 6), x, h / 2, z)); const f = box(0.02, 0.16, 0.26, TEAM, true); f.position.set(x, h - 0.1, z + 0.14); g.add(f); }
function banner(g, x, y, z, rotY = 0) { const b = box(0.02, 0.36, 0.18, TEAM, true); b.position.set(x, y, z); b.rotation.y = rotY; g.add(b); const r = box(0.03, 0.03, 0.22, 0x8a6a32); r.position.set(x, y + 0.19, z); r.rotation.y = rotY; g.add(r); }
function crate(g, x, z, s = 0.2, y = 0) { const c = box(s, s, s, 0x8a6a3e); c.position.set(x, y + s / 2, z); c.rotation.y = (x * 7 + z * 3) % 1; g.add(c); }
function barrel(g, x, z) { g.add(at(cyl(0.08, 0.08, 0.2, 0x6b4a2a, 10), x, 0.1, z)); g.add(at(cyl(0.085, 0.085, 0.02, 0x3a3a3a, 10), x, 0.16, z)); }
function stoneBase(g, w, d, h) { g.add(at(box(w, h, d, 0x8f877a), 0, h / 2, 0)); }

export function makeBuilding(kind) {
  const g = new THREE.Group();
  if (kind === "house") {
    stoneBase(g, 1.5, 1.3, 0.12); timberWall(g, 1.4, 1.2, 0.6, 0.12);
    g.add(at(gable(1.6, 1.45, 0.62, 0xa5523a), 0, 0.72, 0));
    g.add(at(box(0.16, 0.45, 0.16, 0x6e6458), 0.35, 1.15, -0.25));
    door(g, 0.71, 0.12, 0.15); windowAt(g, 0.71, 0.5, -0.3); windowAt(g, 0.2, 0.5, 0.61, Math.PI / 2);
    flagPole(g, -0.6, 0.55, 1.5); crate(g, 0.85, -0.45, 0.16); barrel(g, 0.82, 0.55);
  } else if (kind === "tc") {
    stoneBase(g, 2.5, 2.5, 0.15);
    g.add(at(box(2.0, 1.0, 2.0, 0xb8ad96), 0, 0.65, 0));
    g.add(at(gable(2.2, 2.15, 0.85, 0x56606b), 0, 1.15, 0));
    timberWall(g, 1.1, 1.0, 0.45, 1.15, 0xd9c8a4); g.add(at(gable(1.25, 1.15, 0.5, 0x4c555f), 0, 1.6, 0));
    for (const [x, z] of [[1.0, 1.0], [-1.0, 1.0], [1.0, -1.0], [-1.0, -1.0]]) { g.add(at(cyl(0.24, 0.27, 1.5, 0xa59a85, 10), x, 0.75, z)); const c = mesh(new THREE.ConeGeometry(0.32, 0.5, 10), mat(TEAM), true); c.position.set(x, 1.75, z); g.add(c); }
    door(g, 1.01, 0.15, 0, 0, 0.4, 0.5); for (const z of [-0.6, 0.6]) windowAt(g, 1.01, 0.85, z); for (const x of [-0.5, 0.5]) windowAt(g, x, 0.85, 1.01, Math.PI / 2);
    banner(g, 1.03, 0.75, -0.35); banner(g, 1.03, 0.75, 0.35); flagPole(g, 0, 0, 2.6);
    barrel(g, 1.25, 0.6); crate(g, 1.3, -0.7, 0.2);
  } else if (kind === "barracks") {
    stoneBase(g, 2.5, 1.9, 0.15);
    g.add(at(box(2.3, 0.45, 1.7, 0x9c8e7a), 0, 0.37, 0)); timberWall(g, 2.3, 1.7, 0.4, 0.6, 0xcdbb98);
    g.add(at(gable(2.5, 1.95, 0.7, 0x7a3326), 0, 1.0, 0));
    door(g, 1.16, 0.15, 0, 0, 0.36, 0.45); banner(g, 1.18, 0.8, -0.55); banner(g, 1.18, 0.8, 0.55);
    const rack = new THREE.Group(); rack.add(at(box(0.05, 0.05, 0.6, 0x6b4a2b), 0, 0.3, 0)); for (let i = 0; i < 4; i++) { const sp = at(box(0.02, 0.6, 0.02, 0xc9ced4), 0, 0.3, -0.24 + i * 0.16); sp.rotation.x = 0.1; rack.add(sp); } rack.position.set(1.0, 0, 1.15); g.add(rack);
    const dummy = new THREE.Group(); dummy.add(at(cyl(0.02, 0.02, 0.6, 0x6b4a2b, 6), 0, 0.3, 0)); dummy.add(at(cyl(0.09, 0.09, 0.25, 0xc9a35a, 8), 0, 0.5, 0)); dummy.add(at(box(0.04, 0.04, 0.35, 0x6b4a2b), 0, 0.5, 0)); dummy.position.set(1.15, 0, -1.1); g.add(dummy);
  } else if (kind === "storehouse") {
    stoneBase(g, 1.6, 1.4, 0.08);
    for (const [x, z] of [[-0.65, -0.55], [-0.65, 0.55], [0.65, -0.55], [0.65, 0.55]]) g.add(at(box(0.08, 0.8, 0.08, 0x5a3d22), x, 0.48, z));
    g.add(at(box(0.05, 0.7, 1.15, 0x8a6a3e), -0.65, 0.45, 0)); g.add(at(box(1.3, 0.7, 0.05, 0x8a6a3e), 0, 0.45, -0.57));
    g.add(at(gable(1.6, 1.45, 0.45, 0x6a5843), 0, 0.88, 0));
    crate(g, -0.3, -0.25); crate(g, -0.3, 0.05); crate(g, -0.3, -0.1, 0.18, 0.2); crate(g, 0.75, 0.6, 0.18); barrel(g, 0.0, -0.3); barrel(g, 0.2, -0.35);
    for (let i = 0; i < 4; i++) { const l = at(cyl(0.06, 0.06, 0.9, 0x7a5532, 7), 0.2, 0.15 + (i % 2) * 0.1, 0.35 + (i >> 1) * 0.12 - (i % 2) * 0.06); l.rotation.z = Math.PI / 2; g.add(l); }
    flagPole(g, 0.7, -0.6, 1.3);
  } else if (kind === "farm") {
    g.add(at(box(1.85, 0.04, 1.85, 0x6e5232), 0, 0.02, 0));
    for (let i = 0; i < 7; i++) { g.add(at(box(1.7, 0.05, 0.08, 0x57402a), 0, 0.05, -0.75 + i * 0.25)); for (let j = 0; j < 9; j++) { const c = mesh(new THREE.ConeGeometry(0.05, 0.18, 5), mat([0x8aa63a, 0x9cb648, 0x7a9a32][(i + j) % 3])); c.position.set(-0.78 + j * 0.195, 0.14, -0.75 + i * 0.25); g.add(c); } }
    for (const [x, z, rot] of [[0, -0.95, 0], [0, 0.95, 0], [-0.95, 0, 1], [0.95, 0, 1]]) { const f = box(1.9, 0.05, 0.03, 0x7a5a36); f.position.set(x, 0.15, z); if (rot) f.rotation.y = Math.PI / 2; g.add(f); }
    for (const x of [-0.95, 0.95]) for (const z of [-0.95, 0.95]) g.add(at(box(0.05, 0.25, 0.05, 0x5a3d22), x, 0.12, z));
    flagPole(g, 0.95, -0.95, 0.7);
  }
  return g;
}
export function makeFoundation(w, d) {
  const g = new THREE.Group();
  g.add(at(box(w * 0.92, 0.04, d * 0.92, 0x8a6e4a), 0, 0.02, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(at(box(0.07, 0.7, 0.07, 0x7d5d38), sx * w * 0.42, 0.35, sz * d * 0.42));
  for (const sz of [-1, 1]) g.add(at(box(w * 0.85, 0.05, 0.05, 0x7d5d38), 0, 0.68, sz * d * 0.42));
  for (const sx of [-1, 1]) g.add(at(box(0.05, 0.05, d * 0.85, 0x7d5d38), sx * w * 0.42, 0.68, 0));
  for (let i = 0; i < 3; i++) { const p = box(w * 0.7, 0.03, 0.12, 0xb08a5a); p.position.set(0, 0.06 + i * 0.03, -d * 0.2 + i * 0.13); p.rotation.y = 0.2 * i; g.add(p); }
  return g;
}
