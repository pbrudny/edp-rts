// Synthesised sound effects (Web Audio, no files). Call unlock() from a user gesture first.
let ac = null, master = null, muted = false;
const last = {};
try { muted = localStorage.getItem("er-muted") === "1"; } catch {}

export function unlock() {
  if (ac) { if (ac.state === "suspended") ac.resume(); return; }
  try { ac = new AudioContext(); master = ac.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ac.destination); } catch { ac = null; }
}
export function toggleMute() {
  muted = !muted; try { localStorage.setItem("er-muted", muted ? "1" : "0"); } catch {}
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}
export const isMuted = () => muted;

function noise(dur) {
  const b = ac.createBuffer(1, Math.max(1, ac.sampleRate * dur), ac.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = ac.createBufferSource(); s.buffer = b; return s;
}
function env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
function tone(type, f0, f1, dur, vol, t = ac.currentTime) {
  const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(g, t, 0.005, vol, dur); o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
}
function burst(dur, filterType, freq, q, vol, t = ac.currentTime) {
  const n = noise(dur), f = ac.createBiquadFilter(), g = ac.createGain(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
  env(g, t, 0.003, vol, dur); n.connect(f).connect(g).connect(master); n.start(t); n.stop(t + dur + 0.05);
}

// volume 0..1 (e.g. by distance from the camera); throttled per sound
export function play(name, volume = 1, minGap = 0) {
  if (!ac || muted || volume <= 0.02) return;
  const now = performance.now(); if (minGap && now - (last[name] ?? 0) < minGap) return; last[name] = now;
  const v = Math.min(1, volume), t = ac.currentTime;
  switch (name) {
    case "click": tone("triangle", 660, 440, 0.06, 0.15 * v); break;
    case "chop": burst(0.08, "bandpass", 900 + Math.random() * 300, 3, 0.5 * v); tone("square", 140, 90, 0.05, 0.08 * v); break;
    case "mine": tone("triangle", 1800 + Math.random() * 400, 1200, 0.12, 0.12 * v); burst(0.05, "highpass", 3000, 1, 0.2 * v); break;
    case "hammer": tone("square", 220, 120, 0.05, 0.12 * v); burst(0.04, "bandpass", 1500, 2, 0.25 * v); break;
    case "clash": tone("sawtooth", 1200 + Math.random() * 500, 700, 0.15, 0.1 * v); burst(0.12, "highpass", 4000, 1, 0.25 * v); break;
    case "bow": burst(0.18, "bandpass", 1800, 1.5, 0.35 * v); tone("sine", 300, 120, 0.12, 0.08 * v); break;
    case "death": tone("sawtooth", 260, 90, 0.35, 0.12 * v); burst(0.2, "lowpass", 600, 1, 0.2 * v); break;
    case "trained": [523, 659, 784].forEach((f, i) => tone("triangle", f, 0, 0.18, 0.12 * v, t + i * 0.09)); break;
    case "built": [392, 523, 659, 784].forEach((f, i) => tone("triangle", f, 0, 0.3, 0.13 * v, t + i * 0.11)); break;
    case "alert": [0, 0.25].forEach((d) => tone("sawtooth", 196, 185, 0.22, 0.12 * v, t + d)); break;
    case "collapse": burst(0.9, "lowpass", 300, 0.7, 0.6 * v); tone("sine", 80, 40, 0.8, 0.25 * v); break;
    case "victory": [523, 659, 784, 1047].forEach((f, i) => tone("triangle", f, 0, 0.5, 0.15 * v, t + i * 0.18)); break;
    case "defeat": [392, 349, 311, 262].forEach((f, i) => tone("sine", f, 0, 0.6, 0.15 * v, t + i * 0.25)); break;
  }
}
