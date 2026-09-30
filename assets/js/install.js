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
  let corona = null, rim = null, coronaSize = 0;
  /* the forming: null when still; otherwise the sequence's clock and where the sun rises from */
  let forming = null;

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
    let c = corona.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const o = coronaSize / 2;
    /* the corona: a soft base, then streamers — many thin rays of uneven
       length, denser at the poles the way a real one is — then the
       chromosphere, a hair of rose at the limb, and a few prominences */
    const rnd = (() => { let x = 20260930; return () => (x = (x * 48271) % 2147483647) / 2147483647; })();
    /* the far haze, wide and dim, then the base glow, then the inner corona: a
       tight band of near-white, so the light has a near and a far */
    for (const [rad, col, al] of [[2.5, RIM, 0.07], [1.9, RIM, 0.13], [1.45, GOLD, 0.26], [1.18, SUN, 0.42]]) {
      const g = c.createRadialGradient(o, o, R * 0.98, o, o, R * rad);
      g.addColorStop(0, hexa(col, al)); g.addColorStop(0.5, hexa(col, al * 0.35)); g.addColorStop(1, hexa(col, 0));
      c.fillStyle = g; c.beginPath(); c.arc(o, o, R * rad, 0, 6.284); c.fill();
    }
    c.save(); c.translate(o, o); c.globalCompositeOperation = "lighter";
    for (let i = 0; i < 320; i++) {
      const a = rnd() * 6.283, polar = Math.pow(Math.abs(Math.sin(a * 2)), 0.6);
      const long = rnd() < 0.3;
      const len = R * (long ? 0.6 + rnd() * 1.5 * (0.5 + polar) : 0.12 + rnd() * rnd() * 0.5), w = long ? 0.8 + rnd() * 2.6 : 0.4 + rnd() * 1.2, al = long ? 0.05 + rnd() * 0.14 : 0.12 + rnd() * 0.3;
      const g = c.createLinearGradient(0, R, 0, R + len); g.addColorStop(0, hexa(long ? SUN : "#ffe1a0", al * (long ? 1 : 0.8))); g.addColorStop(0.35, hexa(GOLD, al * 0.5)); g.addColorStop(1, hexa(RIM, 0));
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
    /* the command, written round the rim, once, letter by letter — on a layer
       of its own, so it can arrive after the light */
    rim = document.createElement("canvas"); rim.width = rim.height = corona.width;
    const c2 = rim.getContext("2d"); c2.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c1 = c; c = c2;
    /* as large as the ring allows: the whole line on the rim once, with a breath at the end */
    let fs = Math.max(11.5, Math.min(16.5, R * 0.1));
    const rr = R * 1.16;
    const measure = () => { c.font = `600 ${fs}px 'JetBrains Mono', monospace`; const gap = fs * 0.62; return [...CMD].reduce((s, ch) => s + Math.max(c.measureText(ch).width, gap * 0.6) + gap * 0.42, 0); };
    let total = measure();
    if (total > 2 * Math.PI * rr * 0.9) { fs = Math.max(8, fs * (2 * Math.PI * rr * 0.9) / total); total = measure(); }
    const gap = fs * 0.62;
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillStyle = "#fff4dc"; c.strokeStyle = "rgba(6,11,28,.75)"; c.lineWidth = 3.5; c.lineJoin = "round";
    c.shadowColor = hexa(GOLD, 0.95); c.shadowBlur = 12;
    let a = -Math.PI / 2 - total / rr / 2;
    for (const ch of CMD) {
      const w = Math.max(c.measureText(ch).width, gap * 0.6) + gap * 0.42;
      a += w / rr / 2;
      c.save(); c.translate(o + Math.cos(a) * rr, o + Math.sin(a) * rr); c.rotate(a + Math.PI / 2);
      c.save(); c.shadowBlur = 0; c.strokeText(ch, 0, 0); c.restore(); c.fillText(ch, 0, 0); c.restore();
      a += w / rr / 2;
    }
    c.shadowBlur = 0;
  }
  const ease = (u) => { u = Math.max(0, Math.min(1, u)); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
  const out = (u) => 1 - Math.pow(1 - Math.max(0, Math.min(1, u)), 3);
  const drawDisc = (x, y, r) => {
    const body = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    body.addColorStop(0, "#0b1226"); body.addColorStop(0.7, "#070c1c"); body.addColorStop(1, "#04070f");
    ctx.fillStyle = body; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.284); ctx.fill();
  };
  /* the sun on its way up: a bright disc and a warm sky round it */
  const drawSun = (x, y, r, al) => {
    const halo = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 4.2);
    halo.addColorStop(0, hexa(SUN, 0.55 * al)); halo.addColorStop(0.3, hexa(GOLD, 0.22 * al)); halo.addColorStop(0.7, hexa(RIM, 0.06 * al)); halo.addColorStop(1, hexa(RIM, 0));
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(x, y, r * 4.2, 0, 6.284); ctx.fill();
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, CORE); g.addColorStop(0.6, SUN); g.addColorStop(0.93, GOLD); g.addColorStop(1, hexa(RIM, 0.9));
    ctx.globalAlpha = al; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.284); ctx.fill(); ctx.globalAlpha = 1;
  };
  const drawCorona = (al, rot, textAl) => {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
    ctx.globalAlpha = al; ctx.drawImage(corona, -coronaSize / 2, -coronaSize / 2, coronaSize, coronaSize);
    ctx.globalAlpha = textAl; ctx.drawImage(rim, -coronaSize / 2, -coronaSize / 2, coronaSize, coronaSize);
    ctx.restore(); ctx.globalAlpha = 1;
  };
  const drawDiamond = (x, y, k) => {
    if (k <= 0.01) return;
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(x, y, 0, x, y, R * 0.7 * k);
    g.addColorStop(0, hexa(CORE, 0.95 * k)); g.addColorStop(0.1, hexa(SUN, 0.55 * k)); g.addColorStop(1, hexa(SUN, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R * 0.7 * k, 0, 6.284); ctx.fill();
    ctx.strokeStyle = hexa(CORE, 0.6 * k); ctx.lineWidth = 1.2;
    for (const sa of [0, 1.05, 2.1]) { ctx.beginPath(); ctx.moveTo(x - Math.cos(sa) * R * 0.6 * k, y - Math.sin(sa) * R * 0.6 * k); ctx.lineTo(x + Math.cos(sa) * R * 0.6 * k, y + Math.sin(sa) * R * 0.6 * k); ctx.stroke(); }
    ctx.restore();
  };
  /* THE FORMING. The sun climbs from the door's own sunrise point to the
     centre, growing as it clears the horizon; the moon comes down from
     above to meet it, arriving a breath later, and slides across its face
     — the diamond ring at the last point of light — into totality. The
     sky goes dark, the corona blooms, the line arrives on the rim. */
  const F = { sunEnd: 3600, moonStart: 900, moonEnd: 3900, darkStart: 2200, darkEnd: 3900, coronaStart: 3800, coronaEnd: 5200, textStart: 4800, textEnd: 6000, done: 6200 };
  function formingFrame(now) {
    const f = forming, t = f.reverse ? Math.max(0, f.length - (now - f.t0)) : now - f.t0;
    const rot = reduced ? 0 : ((now - t0) / 1000) * 0.045;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    /* the sky darkens as the moon closes: a veil over the door beneath */
    const dark = out((t - F.darkStart) / (F.darkEnd - F.darkStart));
    if (dark > 0) { ctx.fillStyle = hexa("#060b1c", dark); ctx.fillRect(0, 0, W, H); }
    /* the sun, rising */
    const su = ease(t / F.sunEnd);
    const sx = f.ox + (cx - f.ox) * su, sy = f.oy + (cy - f.oy) * su, sr = R * (0.32 + 0.68 * su);
    const tot = out((t - F.coronaStart) / (F.coronaEnd - F.coronaStart));
    if (tot < 1) drawSun(sx, sy, sr, Math.min(1, 0.35 + su) * (1 - tot));
    /* the corona and the line, once the sun is covered */
    if (tot > 0) drawCorona(tot, rot, out((t - F.textStart) / (F.textEnd - F.textStart)));
    /* the moon, coming down to meet it: from above and a little to the side, so it crosses the face */
    const mu = ease((t - F.moonStart) / (F.moonEnd - F.moonStart));
    if (mu > 0) {
      const mx = cx + (1 - mu) * R * 1.1, my = cy - (1 - mu) * (cy + R * 1.4);
      const sep = Math.hypot(mx - sx, my - sy) / R;
      /* the last point of light: where the moon's edge leaves the sun's, just before it covers it */
      const k = Math.max(0, 1 - Math.abs(sep - 0.09) / 0.09) * (su > 0.9 ? 1 : 0);
      if (k > 0) { const ax = Math.atan2(sy - my, sx - mx); drawDiamond(sx + Math.cos(ax) * sr * 0.98, sy + Math.sin(ax) * sr * 0.98, k); }
      drawDisc(mx, my, R * 1.012);
    }
    const end = f.reverse ? now - f.t0 >= f.length : t >= F.done;
    if (end) { const done = f.resolve; forming = null; done(); }
  }
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (pad.hidden || document.hidden || !corona) return;
    if (forming) { formingFrame(now); return; }
    const rot = reduced ? 0 : ((now - t0) / 1000) * 0.045;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawCorona(1, rot, 1);
    drawDisc(cx, cy, R * 1.012);
  }
  return {
    start() {
      running = true; t0 = performance.now();
      size(); addEventListener("resize", size);
      cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    },
    /* form the eclipse from the door's sunrise point; resolves at totality with the line on the rim */
    form({ ox, oy }) {
      return new Promise((resolve) => {
        this.start();
        if (reduced) { resolve(); return; }
        forming = { t0: performance.now(), ox, oy, reverse: false, length: F.done, resolve };
      });
    },
    /* the eclipse coming apart again: the moon lifts, the sun sinks back to where it rose from */
    unform({ ox, oy }) {
      return new Promise((resolve) => {
        if (reduced || !running) { resolve(); return; }
        forming = { t0: performance.now(), ox, oy, reverse: true, length: 3400, resolve };
      });
    },
    stop() { running = false; forming = null; cancelAnimationFrame(raf); removeEventListener("resize", size); },
  };
}
