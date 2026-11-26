// Ember Realms art: procedural, pre-rendered sprites (no image assets).
// Light comes from the top-left; shadows fall to the bottom-right.

export const TS = 32;
const SCALE = 2; // sprites are drawn at 2x so they stay crisp when zoomed in

// ------------------------------------------------------------------ noise
export function hash(x, y, s = 0) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s, oct = 4) { let f = 0, amp = 0.5, fr = 1; for (let i = 0; i < oct; i++) { f += amp * vnoise(x * fr, y * fr, s + i); fr *= 2; amp *= 0.5; } return f / 0.9375; }
const mix = (a, b, t) => a + (b - a) * t;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
function shade(hex, f) { // f < 0 darker, f > 0 lighter
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; } else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// ------------------------------------------------------------------ terrain
// Per-pixel ground: grass with soft colour variation, dirt patches, darker soil under forests, sandy shores, deep/shallow water.
export function makeGround(map) {
  const R = 0.5; // noise is computed at half resolution, then scaled up (fast map load)
  const W = map.w * TS * R, H = map.h * TS * R, small = canvas(W, H), sg = small.getContext("2d"), img = sg.createImageData(W, H), d = img.data;
  const c = canvas(map.w * TS, map.h * TS), g = c.getContext("2d");
  const at = (arr, x, y) => (x < 0 || y < 0 || x >= map.w || y >= map.h ? 0 : arr[y * map.w + x]);
  // smooth fields per tile (blurred), sampled bilinearly per pixel
  const blur = (arr, r) => { const out = new Float32Array(map.w * map.h); for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) { let s = 0, n = 0; for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { s += at(arr, x + i, y + j); n++; } out[y * map.w + x] = s / n; } return out; };
  const water = blur(map.tile, 1), forest = blur(map.wood, 2);
  const sample = (f, px, py) => { const x = px / TS - 0.5, y = py / TS - 0.5, xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const v = (i, j) => (xi + i < 0 || yi + j < 0 || xi + i >= map.w || yi + j >= map.h ? 0 : f[(yi + j) * map.w + xi + i]);
    return mix(mix(v(0, 0), v(1, 0), xf), mix(v(0, 1), v(1, 1), xf), yf); };
  for (let qy = 0; qy < H; qy++) for (let qx = 0; qx < W; qx++) {
    const px = qx / R, py = qy / R;
    const wv = sample(water, px, py), fv = sample(forest, px, py);
    const n1 = fbm(px / 90, py / 90, 1), n2 = fbm(px / 14, py / 14, 7, 3), n3 = hash(px, py, 3);
    let r, gg, b;
    const shore = clamp((wv - 0.18) / 0.3) + (n2 - 0.5) * 0.25;
    if (shore > 0.62) { // water
      const depth = clamp((wv - 0.55) / 0.45);
      r = mix(52, 22, depth); gg = mix(118, 66, depth); b = mix(140, 110, depth);
      const ripple = Math.sin(px * 0.35 + fbm(px / 20, py / 20, 9) * 9) * 0.5 + 0.5;
      r += ripple * 6; gg += ripple * 8; b += ripple * 10;
    } else {
      // grass base: two greens mixed by large-scale noise
      r = mix(74, 104, n1); gg = mix(112, 134, n1); b = mix(44, 52, n1);
      const dirt = clamp((fbm(px / 60, py / 60, 4) - 0.62) * 4);
      r = mix(r, 128, dirt * 0.7); gg = mix(gg, 104, dirt * 0.7); b = mix(b, 66, dirt * 0.7);
      r = mix(r, 52, fv * 0.6); gg = mix(gg, 78, fv * 0.6); b = mix(b, 38, fv * 0.6); // forest floor
      const sand = clamp((shore - 0.25) / 0.37);
      r = mix(r, 196, sand); gg = mix(gg, 178, sand); b = mix(b, 128, sand);
      const k = (n2 - 0.5) * 22 + (n3 - 0.5) * 10;
      r += k; gg += k * 1.1; b += k * 0.6;
    }
    const i = (qy * W + qx) * 4;
    d[i] = clamp(r, 0, 255); d[i + 1] = clamp(gg, 0, 255); d[i + 2] = clamp(b, 0, 255); d[i + 3] = 255;
  }
  sg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true; g.drawImage(small, 0, 0, c.width, c.height);
  // fine grain at full resolution
  for (let k = 0; k < map.w * map.h * 6; k++) {
    const x = hash(k, 1, 61) * c.width, y = hash(k, 2, 62) * c.height;
    g.fillStyle = hash(k, 3, 63) > 0.5 ? "rgba(255,250,210,.06)" : "rgba(0,0,0,.07)"; g.fillRect(x, y, 2, 2);
  }
  // grass tufts and flowers
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    if (map.tile[y * map.w + x] === 1 || water[y * map.w + x] > 0.15) continue;
    for (let k = 0; k < 3; k++) {
      const h = hash(x, y, k + 11); if (h > 0.55) continue;
      const tx = x * TS + hash(x, y, k + 20) * TS, ty = y * TS + hash(x, y, k + 30) * TS;
      g.strokeStyle = `rgba(${40 + h * 40},${80 + h * 50},30,.55)`; g.lineWidth = 1;
      g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx - 1.5, ty - 4); g.moveTo(tx, ty); g.lineTo(tx + 1.5, ty - 4); g.moveTo(tx, ty); g.lineTo(tx, ty - 5); g.stroke();
    }
    if (hash(x, y, 50) > 0.97) { g.fillStyle = hash(x, y, 51) > 0.5 ? "#f1e6a6" : "#e7a9c4"; g.beginPath(); g.arc(x * TS + 10 + hash(x, y, 52) * 12, y * TS + 10 + hash(x, y, 53) * 12, 1.6, 0, 7); g.fill(); }
  }
  return c;
}

// ------------------------------------------------------------------ trees (several pre-rendered variants)
export const trees = [];
export function makeTrees() {
  for (let v = 0; v < 8; v++) {
    const w = 56, h = 72, c = canvas(w * SCALE, h * SCALE), g = c.getContext("2d");
    g.scale(SCALE, SCALE);
    const cx = w / 2, base = h - 12, pine = v >= 5, hue = 95 + hash(v, 1) * 40, light = 22 + hash(v, 2) * 8;
    // shadow
    g.fillStyle = "rgba(0,0,0,.28)"; g.beginPath(); g.ellipse(cx + 8, base + 2, 17, 7, -0.2, 0, 7); g.fill();
    // trunk
    const tg = g.createLinearGradient(cx - 3, 0, cx + 3, 0); tg.addColorStop(0, "#4a3220"); tg.addColorStop(1, "#2c1d12");
    g.fillStyle = tg; g.fillRect(cx - 2.5, base - 16, 5, 16);
    if (pine) {
      for (let i = 0; i < 4; i++) {
        const y = base - 12 - i * 11, r = 17 - i * 3.5;
        const pg = g.createLinearGradient(cx - r, y - 14, cx + r, y);
        pg.addColorStop(0, `hsl(${hue + 20}, 35%, ${light + 12}%)`); pg.addColorStop(1, `hsl(${hue + 25}, 40%, ${light - 6}%)`);
        g.fillStyle = pg; g.beginPath(); g.moveTo(cx - r, y); g.lineTo(cx, y - 18); g.lineTo(cx + r, y); g.quadraticCurveTo(cx, y + 4, cx - r, y); g.fill();
      }
    } else {
      const blobs = 7;
      for (let i = 0; i < blobs; i++) {
        const a = (i / blobs) * Math.PI * 2 + v, rr = 7 + hash(v, i) * 4;
        const bx = cx + Math.cos(a) * 9, by = base - 30 + Math.sin(a) * 8 - hash(i, v) * 3;
        const bg = g.createRadialGradient(bx - rr * 0.4, by - rr * 0.5, 1, bx, by, rr * 1.2);
        bg.addColorStop(0, `hsl(${hue}, 45%, ${light + 18}%)`); bg.addColorStop(1, `hsl(${hue + 10}, 50%, ${light - 6}%)`);
        g.fillStyle = bg; g.beginPath(); g.arc(bx, by, rr + 4, 0, 7); g.fill();
      }
      const top = g.createRadialGradient(cx - 6, base - 40, 2, cx, base - 32, 16);
      top.addColorStop(0, `hsl(${hue - 5}, 50%, ${light + 22}%)`); top.addColorStop(1, `hsla(${hue}, 45%, ${light + 4}%, 0)`);
      g.fillStyle = top; g.beginPath(); g.arc(cx, base - 32, 15, 0, 7); g.fill();
    }
    trees.push({ c, w, h, ax: cx, ay: base });
  }
}
export function drawTree(ctx, x, y) {
  const n = hash(x, y), t = trees[(n * trees.length) | 0];
  const ox = (hash(y, x) - 0.5) * 8, oy = (hash(x + 7, y) - 0.5) * 6;
  const px = (x + 0.5) * TS + ox - t.ax, py = (y + 0.8) * TS + oy - t.ay;
  ctx.drawImage(t.c, px, py, t.w, t.h);
}

// ------------------------------------------------------------------ buildings (3/4 view: wall face + roof; footprint = w x h tiles)
const cache = new Map();
export function buildingSprite(kind, color, w, h, foundation = false) {
  const key = `${kind}|${color}|${foundation}`;
  if (cache.has(key)) return cache.get(key);
  const pw = w * TS, ph = h * TS, extra = 46, c = canvas((pw + 16) * SCALE, (ph + extra + 10) * SCALE), g = c.getContext("2d");
  g.scale(SCALE, SCALE); g.translate(4, extra);
  const S = { c, ox: -4, oy: -extra, w: pw + 16, h: ph + extra + 10 };
  cache.set(key, S);
  if (foundation) { drawFoundation(g, pw, ph); return S; }
  const shadow = () => { g.fillStyle = "rgba(0,0,0,.3)"; g.beginPath(); g.moveTo(6, ph - 2); g.lineTo(pw + 6, ph - 2); g.lineTo(pw + 12, ph - 14); g.lineTo(pw + 12, 12); g.lineTo(pw, 4); g.closePath(); g.fill(); };
  switch (kind) {
    case "tc": shadow(); house(g, 4, 18, pw - 8, ph - 22, 34, "#b8ad96", "#8f8574", "#56606b", true); tower(g, 2, 0, 18, ph - 4, color); tower(g, pw - 20, 0, 18, ph - 4, color); flag(g, pw / 2, -40, color); banner(g, pw / 2, ph - 40, color); break;
    case "house": shadow(); house(g, 5, 16, pw - 10, ph - 20, 22, "#d8c29b", "#b49a72", "#a5563b", false, true); flag(g, pw - 12, -14, color); break;
    case "barracks": shadow(); house(g, 3, 20, pw - 6, ph - 24, 26, "#9c8e7a", "#7d705f", "#7a3326", true); banner(g, pw / 2, ph - 34, color); weapons(g, pw - 18, ph - 18); break;
    case "storehouse": shadow(); house(g, 4, 18, pw - 8, ph - 22, 20, "#a9875e", "#866845", "#6a5843", false, true); crates(g, 2, ph - 14, color); break;
    case "farm": field(g, pw, ph, color); break;
  }
  return S;
}
function stoneTexture(g, x, y, w, h, base) {
  g.fillStyle = base; g.fillRect(x, y, w, h);
  g.strokeStyle = "rgba(0,0,0,.18)"; g.lineWidth = 1;
  for (let r = 0, yy = y + 5; yy < y + h; yy += 6, r++) { g.beginPath(); g.moveTo(x, yy); g.lineTo(x + w, yy); g.stroke(); for (let xx = x + (r % 2 ? 4 : 9); xx < x + w; xx += 10) { g.beginPath(); g.moveTo(xx, yy - 6); g.lineTo(xx, yy); g.stroke(); } }
}
function house(g, x, y, w, h, roofH, wall, wallDark, roofCol, stone = false, timber = false) {
  const face = Math.min(h * 0.55, 26); // visible front wall height
  const top = y + h - face;
  // walls: front face
  if (stone) stoneTexture(g, x, top, w, face, wall); else { g.fillStyle = wall; g.fillRect(x, top, w, face); }
  if (timber) { g.strokeStyle = "#5a4128"; g.lineWidth = 2; g.strokeRect(x + 1, top + 1, w - 2, face - 2); for (let xx = x + w / 4; xx < x + w; xx += w / 4) { g.beginPath(); g.moveTo(xx, top); g.lineTo(xx, top + face); g.stroke(); } g.beginPath(); g.moveTo(x, top + face / 2); g.lineTo(x + w, top + face / 2); g.stroke(); }
  const wg = g.createLinearGradient(x, 0, x + w, 0); wg.addColorStop(0, "rgba(255,240,210,.12)"); wg.addColorStop(1, "rgba(0,0,0,.18)"); g.fillStyle = wg; g.fillRect(x, top, w, face);
  // door + windows
  g.fillStyle = "#3a2716"; const dw = Math.min(12, w / 4); g.beginPath(); g.moveTo(x + w / 2 - dw / 2, top + face); g.lineTo(x + w / 2 - dw / 2, top + face - 13); g.arc(x + w / 2, top + face - 13, dw / 2, Math.PI, 0); g.lineTo(x + w / 2 + dw / 2, top + face); g.fill();
  g.fillStyle = "#2a1f14"; if (w > 50) { g.fillRect(x + 8, top + 6, 6, 7); g.fillRect(x + w - 14, top + 6, 6, 7); g.fillStyle = "rgba(255,200,110,.5)"; g.fillRect(x + 9, top + 7, 4, 5); }
  // roof: two slopes seen from above at an angle, ridge along the width
  const ry = top, ridge = y - roofH * 0.55;
  const rg = g.createLinearGradient(0, ridge, 0, ry);
  rg.addColorStop(0, shade(toHex(roofCol), 0.18)); rg.addColorStop(1, shade(toHex(roofCol), -0.25));
  g.fillStyle = rg; g.beginPath(); g.moveTo(x - 4, ry + 2); g.lineTo(x + 4, ridge); g.lineTo(x + w - 4, ridge); g.lineTo(x + w + 4, ry + 2); g.closePath(); g.fill();
  // back slope (lighter, lit from top-left)
  g.fillStyle = shade(toHex(roofCol), 0.3); g.beginPath(); g.moveTo(x + 4, ridge); g.lineTo(x + 10, ridge - roofH * 0.3); g.lineTo(x + w - 10, ridge - roofH * 0.3); g.lineTo(x + w - 4, ridge); g.closePath(); g.fill();
  // tiles
  g.strokeStyle = "rgba(0,0,0,.18)"; g.lineWidth = 1;
  for (let t = 1; t < 5; t++) { const yy = mix(ridge, ry + 2, t / 5); g.beginPath(); g.moveTo(mix(x + 4, x - 4, t / 5), yy); g.lineTo(mix(x + w - 4, x + w + 4, t / 5), yy); g.stroke(); }
  g.strokeStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.moveTo(x + 4, ridge); g.lineTo(x + w - 4, ridge); g.stroke();
  // chimney
  g.fillStyle = "#6e6458"; g.fillRect(x + w * 0.7, ridge - 12, 6, 12); g.fillStyle = "#4e463d"; g.fillRect(x + w * 0.7 - 1, ridge - 13, 8, 2);
}
function tower(g, x, y, w, h, color) {
  const top = y + 8;
  stoneTexture(g, x, top, w, h - 8, "#a59a85");
  const sg = g.createLinearGradient(x, 0, x + w, 0); sg.addColorStop(0, "rgba(255,255,255,.12)"); sg.addColorStop(1, "rgba(0,0,0,.25)"); g.fillStyle = sg; g.fillRect(x, top, w, h - 8);
  for (let i = 0; i < 3; i++) { g.fillStyle = "#968b77"; g.fillRect(x + i * (w / 3) + 1, top - 6, w / 3 - 3, 7); }
  g.fillStyle = color; g.beginPath(); g.moveTo(x - 2, top - 5); g.lineTo(x + w / 2, top - 22); g.lineTo(x + w + 2, top - 5); g.closePath(); g.fill();
  g.fillStyle = "rgba(0,0,0,.25)"; g.beginPath(); g.moveTo(x + w / 2, top - 22); g.lineTo(x + w + 2, top - 5); g.lineTo(x + w / 2, top - 5); g.closePath(); g.fill();
  g.fillStyle = "#1e1710"; g.fillRect(x + w / 2 - 2, top + 8, 4, 8);
}
function flag(g, x, y, color) { g.fillStyle = "#5b4630"; g.fillRect(x - 1, y, 2, 30); g.fillStyle = color; g.beginPath(); g.moveTo(x + 1, y + 1); g.quadraticCurveTo(x + 9, y + 2, x + 16, y + 6); g.quadraticCurveTo(x + 9, y + 9, x + 1, y + 11); g.fill(); }
function banner(g, x, y, color) { g.fillStyle = color; g.fillRect(x - 6, y, 12, 16); g.beginPath(); g.moveTo(x - 6, y + 16); g.lineTo(x, y + 21); g.lineTo(x + 6, y + 16); g.fill(); g.strokeStyle = "#e8d39a"; g.lineWidth = 1; g.strokeRect(x - 5, y + 1, 10, 14); }
function weapons(g, x, y) { g.strokeStyle = "#cfd4da"; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 4, y - 16); g.moveTo(x + 6, y); g.lineTo(x + 8, y - 16); g.stroke(); g.fillStyle = "#6b4a2b"; g.fillRect(x - 2, y - 2, 13, 3); }
function crates(g, x, y, color) { for (let i = 0; i < 3; i++) { g.fillStyle = i === 1 ? "#8a6a3e" : "#7a5a33"; g.fillRect(x + i * 9, y - (i === 1 ? 6 : 0), 9, 9); g.strokeStyle = "rgba(0,0,0,.35)"; g.strokeRect(x + i * 9 + 0.5, y - (i === 1 ? 6 : 0) + 0.5, 8, 8); } g.fillStyle = color; g.fillRect(x + 1, y + 10, 26, 2); }
function field(g, w, h, color) {
  g.fillStyle = "#6e5232"; g.fillRect(1, 1, w - 2, h - 2);
  for (let r = 0; r < 7; r++) { const yy = 5 + r * ((h - 8) / 7); g.fillStyle = "#57402a"; g.fillRect(3, yy + 3, w - 6, 2); for (let x = 5; x < w - 5; x += 4) { g.fillStyle = `hsl(${70 + hash(x, r) * 20}, 55%, ${38 + hash(r, x) * 12}%)`; g.fillRect(x, yy - 1 + hash(x, r, 2) * 2, 2, 4); } }
  g.strokeStyle = "#5b4630"; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2);
  g.fillStyle = color; g.fillRect(w - 8, -6, 2, 10); g.fillRect(w - 6, -6, 6, 4);
}
function drawFoundation(g, w, h) {
  g.fillStyle = "rgba(110,85,55,.55)"; g.fillRect(0, 0, w, h);
  g.strokeStyle = "#c9a876"; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2);
  g.strokeStyle = "rgba(201,168,118,.55)"; g.lineWidth = 1;
  for (let i = -h; i < w; i += 9) { g.beginPath(); g.moveTo(Math.max(0, i), Math.max(0, -i)); g.lineTo(Math.min(w, i + h), Math.min(h, h - Math.max(0, i + h - w))); g.stroke(); }
  for (const [x, y] of [[3, 3], [w - 7, 3], [3, h - 7], [w - 7, h - 7]]) { g.fillStyle = "#7d5d38"; g.fillRect(x, y - 14, 4, 18); }
  g.strokeStyle = "#7d5d38"; g.lineWidth = 2; g.beginPath(); g.moveTo(5, -10); g.lineTo(w - 5, -10); g.stroke();
}
function toHex(col) {
  if (col.startsWith("#")) return col;
  const m = col.match(/\d+/g); return "#" + m.slice(0, 3).map((v) => (+v).toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------------ resources
export function goldSprite(seed) {
  const key = "gold" + (seed % 4);
  if (cache.has(key)) return cache.get(key);
  const w = 72, h = 76, c = canvas(w * SCALE, h * SCALE), g = c.getContext("2d"); g.scale(SCALE, SCALE);
  g.fillStyle = "rgba(0,0,0,.3)"; g.beginPath(); g.ellipse(40, 66, 32, 10, 0, 0, 7); g.fill();
  const rocks = [[22, 52, 16], [44, 48, 18], [34, 36, 15], [54, 60, 12], [16, 62, 10]];
  for (const [x, y, r] of rocks) {
    const rg = g.createRadialGradient(x - r * 0.4, y - r * 0.5, 2, x, y, r * 1.1);
    rg.addColorStop(0, "#a8a296"); rg.addColorStop(0.6, "#7a746a"); rg.addColorStop(1, "#4f4a43");
    g.fillStyle = rg; g.beginPath();
    for (let a = 0; a < 7; a++) { const ang = (a / 7) * Math.PI * 2, rr = r * (0.8 + hash(seed, a + x) * 0.35); a ? g.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr * 0.8) : g.moveTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr * 0.8); }
    g.closePath(); g.fill();
  }
  for (let i = 0; i < 14; i++) {
    const x = 14 + hash(seed, i) * 46, y = 34 + hash(i, seed) * 30, r = 1.8 + hash(i, i + seed) * 2.2;
    const gg = g.createRadialGradient(x - 0.7, y - 0.7, 0.2, x, y, r); gg.addColorStop(0, "#fff6c4"); gg.addColorStop(0.4, "#f4c84a"); gg.addColorStop(1, "#9a6d12");
    g.fillStyle = gg; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  const S = { c, w, h, ox: -4, oy: -12 }; cache.set(key, S); return S;
}
export function berrySprite(seed) {
  const key = "berry" + (seed % 4);
  if (cache.has(key)) return cache.get(key);
  const w = 40, h = 40, c = canvas(w * SCALE, h * SCALE), g = c.getContext("2d"); g.scale(SCALE, SCALE);
  g.fillStyle = "rgba(0,0,0,.28)"; g.beginPath(); g.ellipse(23, 31, 14, 6, 0, 0, 7); g.fill();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2, x = 20 + Math.cos(a) * 7, y = 21 + Math.sin(a) * 5, r = 6 + hash(seed, i) * 2;
    const lg = g.createRadialGradient(x - 2, y - 3, 1, x, y, r); lg.addColorStop(0, "#5f9a45"); lg.addColorStop(1, "#24461e");
    g.fillStyle = lg; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  for (let i = 0; i < 12; i++) { const x = 11 + hash(seed, i + 40) * 18, y = 13 + hash(i + 40, seed) * 15; g.fillStyle = "#7d1426"; g.beginPath(); g.arc(x, y, 2.1, 0, 7); g.fill(); g.fillStyle = "#e0485e"; g.beginPath(); g.arc(x - 0.5, y - 0.5, 1.4, 0, 7); g.fill(); }
  const S = { c, w, h, ox: -4, oy: -6 }; cache.set(key, S); return S;
}

// ------------------------------------------------------------------ units (drawn per frame; small figures in 3/4 view)
// act: 0 idle, 1 attack, 2 gather, 3 build, 4 walk. face: radians.
export function drawUnit(ctx, kind, x, y, color, face, act, t, id, carry) {
  const dir = Math.cos(face) >= 0 ? 1 : -1;
  const walk = act === 4 ? Math.sin(t * 13 + id) : 0;
  const work = act === 1 || act === 2 || act === 3 ? Math.sin(t * 10 + id) : 0;
  const big = kind !== "villager";
  const s = big ? 1.38 : 1.25;
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  // shadow
  ctx.fillStyle = "rgba(0,0,0,.32)"; ctx.beginPath(); ctx.ellipse(2, 3, 8, 3.5, 0, 0, 7); ctx.fill();
  // legs
  ctx.strokeStyle = "#3a2d22"; ctx.lineWidth = 2.6; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-2, -5); ctx.lineTo(-2 + walk * 2.5, 2); ctx.moveTo(2, -5); ctx.lineTo(2 - walk * 2.5, 2); ctx.stroke();
  // back arm / shield
  if (kind === "swordsman") {
    const sx = -dir * 5;
    const sg = ctx.createLinearGradient(sx - 4, -14, sx + 4, -4); sg.addColorStop(0, shade(toHex(color), 0.2)); sg.addColorStop(1, shade(toHex(color), -0.35));
    ctx.fillStyle = sg; ctx.beginPath(); ctx.moveTo(sx - 4, -15); ctx.lineTo(sx + 4, -15); ctx.lineTo(sx + 4, -8); ctx.quadraticCurveTo(sx, -2, sx - 4, -8); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#d8c08a"; ctx.lineWidth = 1; ctx.stroke();
  }
  // body (tunic in player colour, lit from top-left)
  const bg = ctx.createLinearGradient(-5, -15, 5, -3);
  bg.addColorStop(0, shade(toHex(color), 0.25)); bg.addColorStop(1, shade(toHex(color), -0.35));
  ctx.fillStyle = kind === "archer" ? "#4f5e2e" : bg;
  ctx.beginPath(); ctx.moveTo(-5, -4); ctx.lineTo(-4, -14); ctx.quadraticCurveTo(0, -16, 4, -14); ctx.lineTo(5, -4); ctx.closePath(); ctx.fill();
  if (kind === "archer") { ctx.fillStyle = bg; ctx.fillRect(-4.5, -9, 9, 3); }
  if (kind === "swordsman") { ctx.fillStyle = "#9aa3ad"; ctx.fillRect(-4, -14, 8, 4); }
  ctx.fillStyle = "#5a3f26"; ctx.fillRect(-5, -6, 10, 1.6); // belt
  // head
  ctx.fillStyle = "#e2b48c"; ctx.beginPath(); ctx.arc(dir * 0.5, -18, 3.4, 0, 7); ctx.fill();
  if (kind === "villager") { ctx.fillStyle = "#b7925a"; ctx.beginPath(); ctx.ellipse(dir * 0.5, -20.5, 5.5, 1.8, 0, 0, 7); ctx.fill(); ctx.fillRect(dir * 0.5 - 2.5, -23.5, 5, 3); }
  if (kind === "swordsman") { const hg = ctx.createLinearGradient(-3, -23, 3, -17); hg.addColorStop(0, "#e1e6ec"); hg.addColorStop(1, "#7d8692"); ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(dir * 0.5, -19, 3.8, Math.PI, 0); ctx.fill(); ctx.fillRect(dir * 0.5 - 4, -19.5, 8, 1.5); }
  if (kind === "archer") { ctx.fillStyle = "#3f4c24"; ctx.beginPath(); ctx.arc(dir * 0.5, -18.5, 4, Math.PI * 1.05, Math.PI * 1.95); ctx.lineTo(dir * 0.5 - dir * 5, -15); ctx.fill(); }
  // front arm + tool/weapon
  const ax = dir * 4, ay = -12;
  ctx.strokeStyle = "#e2b48c"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ax * 0.6, ay); ctx.lineTo(ax, ay + 4); ctx.stroke();
  ctx.save(); ctx.translate(ax, ay + 4);
  if (kind === "swordsman") {
    ctx.rotate(dir * (-0.9 + work * 1.1));
    const blade = ctx.createLinearGradient(0, -14, 2, 0); blade.addColorStop(0, "#ffffff"); blade.addColorStop(1, "#8e98a4");
    ctx.fillStyle = blade; ctx.fillRect(-1, -15, 2, 14); ctx.fillStyle = "#8a6a32"; ctx.fillRect(-3, -1.5, 6, 2);
  } else if (kind === "archer") {
    ctx.rotate(dir > 0 ? 0 : Math.PI);
    ctx.strokeStyle = "#6d4a24"; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(-2, -2, 8, -1.2, 1.2); ctx.stroke();
    ctx.strokeStyle = "rgba(240,235,220,.8)"; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(-2 + Math.cos(-1.2) * 8 - (act === 1 ? work * 2 : 0), -2 + Math.sin(-1.2) * 8); ctx.lineTo(-2 + Math.cos(1.2) * 8, -2 + Math.sin(1.2) * 8); ctx.stroke();
  } else {
    ctx.rotate(dir * (-0.6 + work * 0.9));
    ctx.strokeStyle = "#7a5634"; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(0, -10); ctx.stroke();
    ctx.fillStyle = act === 3 ? "#5d5f63" : "#8c939b"; ctx.beginPath(); ctx.moveTo(-1, -10); ctx.lineTo(dir * 5, -9); ctx.lineTo(-1, -6); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  // carried resource
  if (carry >= 0) {
    const col = ["#c9473b", "#8a5a30", "#f2c84b"][carry];
    ctx.fillStyle = col; ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = 0.8;
    if (carry === 1) { ctx.save(); ctx.translate(-dir * 4, -12); ctx.rotate(0.5 * dir); ctx.fillRect(-6, -1.5, 12, 3); ctx.strokeRect(-6, -1.5, 12, 3); ctx.restore(); }
    else { ctx.beginPath(); ctx.arc(-dir * 5, -10, 3, 0, 7); ctx.fill(); ctx.stroke(); }
  }
  ctx.restore();
}

// arrow projectile
export function drawArrow(ctx, x, y, dx, dy) {
  const a = Math.atan2(dy, dx);
  ctx.save(); ctx.translate(x, y - 10); ctx.rotate(a);
  ctx.strokeStyle = "#5a3d22"; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(5, 0); ctx.stroke();
  ctx.fillStyle = "#c9ced4"; ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(4, -2); ctx.lineTo(4, 2); ctx.fill();
  ctx.fillStyle = "#e8e2d0"; ctx.fillRect(-9, -1.5, 3, 3);
  ctx.restore();
}
