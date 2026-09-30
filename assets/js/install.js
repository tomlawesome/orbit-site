/*
 * THE INSTALL: an eclipse.
 *
 * A thin gold ring in the dark — the corona of a sun whose disc is the
 * sky's own black — turning slowly, the command written once round it.
 * Copy is the one word on the disc. Nothing else moves.
 *
 * Drawn on a 2D canvas; the corona is drawn once and turned each frame.
 */
import { reduced } from "./sky.js";
const $ = (s, r = document) => r.querySelector(s);
const CMD = "$ curl -fsSL https://raw.githubusercontent.com/tomlawesome/orbit/main/scripts/get-orbit.sh | bash";
const GOLD = "#d8b45a", CORE = "#fff6e6", SUN = "#ffe9c4", RIM = "#e2772b";
const hexa = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };

export function createInstall(pad) {
  const canvas = $(".eclipse", pad), ctx = canvas.getContext("2d");
  const copy = $(".copy.core", pad);
  let W = 0, H = 0, dpr = 1, R = 0, cx = 0, cy = 0;
  let running = false, raf = 0, t0 = 0;
  let corona = null, coronaSize = 0;

  function size() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = pad.clientWidth; H = pad.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    R = Math.min(W, H) * (W < 700 ? 0.3 : 0.24);
    cx = W / 2; cy = H * (W < 700 ? 0.44 : 0.47);
    copy.style.left = `${cx}px`; copy.style.top = `${cy}px`;
    bake();
  }
  /* the layers drawn once: the corona (with the command written round it) and the sun's glow */
  function bake() {
    coronaSize = Math.ceil(R * 5.4);
    corona = document.createElement("canvas"); corona.width = corona.height = Math.round(coronaSize * dpr);
    const c = corona.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const o = coronaSize / 2;
    /* the corona: a soft base, then streamers — many thin rays of uneven
       length, denser at the poles the way a real one is — then the
       chromosphere, a hair of rose at the limb, and a few prominences */
    const rnd = (() => { let x = 20260930; return () => (x = (x * 48271) % 2147483647) / 2147483647; })();
    for (let k = 0; k < 3; k++) {
      const g = c.createRadialGradient(o, o, R * 0.98, o, o, R * (1.3 + k * 0.45));
      g.addColorStop(0, hexa(k ? RIM : SUN, k ? 0.13 / k : 0.34)); g.addColorStop(1, hexa(RIM, 0));
      c.fillStyle = g; c.beginPath(); c.arc(o, o, R * (1.3 + k * 0.45), 0, 6.284); c.fill();
    }
    c.save(); c.translate(o, o); c.globalCompositeOperation = "lighter";
    for (let i = 0; i < 260; i++) {
      const a = rnd() * 6.283, polar = Math.pow(Math.abs(Math.sin(a * 2)), 0.6);
      const len = R * (0.25 + rnd() * rnd() * 1.1 * (0.5 + polar)), w = 0.6 + rnd() * 2.2, al = 0.05 + rnd() * 0.16;
      const g = c.createLinearGradient(0, R, 0, R + len); g.addColorStop(0, hexa(SUN, al)); g.addColorStop(0.35, hexa(SUN, al * 0.5)); g.addColorStop(1, hexa(RIM, 0));
      c.save(); c.rotate(a); c.fillStyle = g; c.beginPath(); c.moveTo(-w, R * 0.99); c.lineTo(w, R * 0.99); c.lineTo(w * 0.3, R + len); c.lineTo(-w * 0.3, R + len); c.closePath(); c.fill(); c.restore();
    }
    c.restore();
    /* the chromosphere and the prominences */
    c.lineWidth = 2.2; c.strokeStyle = hexa("#ff8a6a", 0.55); c.beginPath(); c.arc(o, o, R * 1.002, 0, 6.284); c.stroke();
    for (const [pa, pl, pw] of [[0.7, 0.14, 0.09], [2.3, 0.1, 0.06], [3.9, 0.17, 0.11], [5.2, 0.08, 0.05]]) {
      const g = c.createRadialGradient(o + Math.cos(pa) * R, o + Math.sin(pa) * R, 0, o + Math.cos(pa) * R, o + Math.sin(pa) * R, R * pl);
      g.addColorStop(0, hexa("#ff9a7a", 0.55)); g.addColorStop(0.5, hexa("#ff6a4a", 0.18)); g.addColorStop(1, hexa("#ff6a4a", 0));
      c.fillStyle = g; c.beginPath(); c.ellipse(o + Math.cos(pa) * R, o + Math.sin(pa) * R, R * pl, R * pw, pa, 0, 6.284); c.fill();
    }
    /* the command, written round the rim, once, letter by letter */
    /* as large as the ring allows: the whole line on the rim once, with a breath at the end */
    let fs = Math.max(11.5, Math.min(16.5, R * 0.1));
    const rr = R * 1.15;
    const measure = () => { c.font = `600 ${fs}px 'JetBrains Mono', monospace`; const gap = fs * 0.62; return [...CMD].reduce((s, ch) => s + Math.max(c.measureText(ch).width, gap * 0.6) + gap * 0.42, 0); };
    let total = measure();
    if (total > 2 * Math.PI * rr * 0.9) { fs = Math.max(8, fs * (2 * Math.PI * rr * 0.9) / total); total = measure(); }
    const gap = fs * 0.62;
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillStyle = "#ffd989"; c.shadowColor = hexa(GOLD, 0.9); c.shadowBlur = 10;
    let a = -Math.PI / 2 - total / rr / 2;
    for (const ch of CMD) {
      const w = Math.max(c.measureText(ch).width, gap * 0.6) + gap * 0.42;
      a += w / rr / 2;
      c.save(); c.translate(o + Math.cos(a) * rr, o + Math.sin(a) * rr); c.rotate(a + Math.PI / 2); c.fillText(ch, 0, 0); c.restore();
      a += w / rr / 2;
    }
    c.shadowBlur = 0;
  }
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (pad.hidden || document.hidden || !corona) return;
    const rot = reduced ? 0 : ((now - t0) / 1000) * 0.045;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
    ctx.drawImage(corona, -coronaSize / 2, -coronaSize / 2, coronaSize, coronaSize);
    ctx.restore();
    /* the disc: the sky's own black, a hair larger than the sun, a body */
    const body = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R * 1.012);
    body.addColorStop(0, "#0b1226"); body.addColorStop(0.7, "#070c1c"); body.addColorStop(1, "#04070f");
    ctx.fillStyle = body; ctx.beginPath(); ctx.arc(cx, cy, R * 1.012, 0, 6.284); ctx.fill();
  }
  return {
    start() {
      running = true; t0 = performance.now();
      size(); addEventListener("resize", size);
      cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    },
    stop() { running = false; cancelAnimationFrame(raf); removeEventListener("resize", size); },
  };
}
