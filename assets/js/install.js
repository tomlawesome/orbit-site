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
  let corona = null, rim = null, coronaSize = 0, textA0 = 0, textSpan = 0, textR = 0;
  /* the forming: null when still; otherwise the shot's clock and the door's scene */
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
    textA0 = -Math.PI / 2 - total / rr / 2; textSpan = total / rr; textR = rr;
    let a = textA0;
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
  const drawCorona = (al, rot, w = 1) => {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
    ctx.globalAlpha = al; ctx.drawImage(corona, -coronaSize / 2, -coronaSize / 2, coronaSize, coronaSize);
    if (w >= 1) ctx.drawImage(rim, -coronaSize / 2, -coronaSize / 2, coronaSize, coronaSize);
    else if (w > 0) {
      const a = textA0 + textSpan * w;
      ctx.save(); ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, coronaSize, textA0 - 0.01, a); ctx.closePath(); ctx.clip();
      ctx.drawImage(rim, -coronaSize / 2, -coronaSize / 2, coronaSize, coronaSize); ctx.restore();
      /* the pen: a point of light at the line's end */
      const x = Math.cos(a) * textR, y = Math.sin(a) * textR;
      const g = ctx.createRadialGradient(x, y, 0, x, y, R * 0.12);
      g.addColorStop(0, hexa(CORE, 0.95)); g.addColorStop(0.25, hexa(SUN, 0.5)); g.addColorStop(1, hexa(SUN, 0));
      ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R * 0.12, 0, 6.284); ctx.fill();
    }
    ctx.restore(); ctx.globalAlpha = 1;
  };
  /* THE FORMING: one shot, nothing new in it. The door's own sunrise — its
     glow, its rays, its horizon — is what climbs: the horizon sinks out of
     the frame as the sun clears it and grows into a disc at the centre of
     the sky. The planet that was clicked leaves its orbit and comes across
     the sun, turning from a lit purple world to a silhouette as it passes
     in front of the light. The day fails the way an eclipse fails it:
     slowly, then all at once — the diamond ring at the last point of
     light, then totality, the corona, and the line written round the rim. */
  const F = { riseStart: 300, riseEnd: 4300, planetStart: 1300, planetEnd: 4900, textStart: 5400, textEnd: 6800, done: 6900, reverseSpeed: 1.8 };
  const quad = (u) => { u = Math.max(0, Math.min(1, u)); return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; };
  const smooth = (u) => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
  const TAU = Math.PI * 2;
  /* the share of the sun's face a disc of radius b at distance d hides */
  const coverage = (d, a, b) => {
    if (d >= a + b) return 0;
    if (d <= Math.abs(a - b)) return b >= a ? 1 : (b * b) / (a * a);
    const x = (d * d + a * a - b * b) / (2 * d), y = Math.sqrt(Math.max(0, a * a - x * x));
    const area = a * a * Math.acos(Math.max(-1, Math.min(1, x / a))) + b * b * Math.acos(Math.max(-1, Math.min(1, (d - x) / b))) - d * y;
    return Math.max(0, Math.min(1, area / (Math.PI * a * a)));
  };
  /* the planet: the same body the door draws, lit from the sun's side, its
     night side sliding across as it passes in front of the light */
  const drawPlanet = (x, y, r, lit, tx, ty) => {
    drawDisc(x, y, r);
    if (lit <= 0.005) return;
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip();
    const g = ctx.createRadialGradient(x + tx * r * 0.45, y + ty * r * 0.45, r * 0.05, x, y, r * 1.05);
    g.addColorStop(0, "#b993ff"); g.addColorStop(0.5, "#7c3aed"); g.addColorStop(1, "#2a1852");
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    /* the terminator: the dark of its own night, soft at the edge */
    const d = 2 * r * lit, nx = x - tx * d, ny = y - ty * d;
    const n = ctx.createRadialGradient(nx, ny, r * 0.9, nx, ny, r * 1.04);
    n.addColorStop(0, "rgba(5,8,18,.97)"); n.addColorStop(1, "rgba(5,8,18,0)");
    ctx.fillStyle = n; ctx.beginPath(); ctx.arc(nx, ny, r * 1.04, 0, TAU); ctx.fill();
    ctx.restore();
  };
  /* the diamond ring: the last point of the sun, flaring */
  const drawFlare = (x, y, k) => {
    if (k <= 0.01) return;
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(x, y, 0, x, y, R * 0.9 * k);
    g.addColorStop(0, hexa(CORE, 0.95)); g.addColorStop(0.08, hexa(SUN, 0.6 * k)); g.addColorStop(0.35, hexa(GOLD, 0.12 * k)); g.addColorStop(1, hexa(SUN, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R * 0.9 * k, 0, TAU); ctx.fill();
    /* the streak across the frame, and two short spikes */
    const len = W * 0.55 * k;
    const s = ctx.createLinearGradient(x - len, y, x + len, y);
    s.addColorStop(0, hexa(SUN, 0)); s.addColorStop(0.5, hexa(CORE, 0.7 * k)); s.addColorStop(1, hexa(SUN, 0));
    ctx.fillStyle = s; ctx.fillRect(x - len, y - 1.2, len * 2, 2.4);
    ctx.strokeStyle = hexa(CORE, 0.35 * k); ctx.lineWidth = 1;
    for (const sa of [0.62, 2.52]) { ctx.beginPath(); ctx.moveTo(x - Math.cos(sa) * R * 0.5 * k, y - Math.sin(sa) * R * 0.5 * k); ctx.lineTo(x + Math.cos(sa) * R * 0.5 * k, y + Math.sin(sa) * R * 0.5 * k); ctx.stroke(); }
    ctx.restore();
  };
  /* the door's layers, moved as one scene: the light travels with the sun,
     the ground and the stars fall away as the eye follows it up, and the
     day dims with the light left */
  function setScene(sc, sx, sy, su, light, tot) {
    const sink = H * 0.34 * su;
    for (const el of sc.ground) el.style.transform = `translateY(${sink.toFixed(1)}px)`;
    sc.stars.style.transform = `translateY(${(H * 0.07 * su).toFixed(1)}px)`;
    const day = Math.pow(light, 1.6) * (1 - tot);
    sc.dawn.style.opacity = day.toFixed(3);
    /* the haze the sun rose out of stays on the horizon and thins as it climbs clear */
    sc.glow.style.opacity = Math.pow(1 - su, 0.8).toFixed(3);
    sc.rays.style.opacity = Math.pow(1 - su, 1.5).toFixed(3);
    for (const el of sc.rims) el.style.opacity = (day * (1 - 0.7 * su)).toFixed(3);
  }
  function prepareScene(sc) {
    sc.k = Math.max(W / 1600, H / 1000); sc.r0 = 34 * sc.k;
    for (const el of [...sc.ground, sc.stars]) { el.style.transition = "none"; el.style.willChange = "transform"; }
    for (const el of [sc.dawn, sc.glow, sc.rays, ...sc.rims]) el.style.transition = "none";
  }
  function releaseScene(sc) {
    for (const el of [...sc.ground, sc.stars, sc.dawn, sc.glow, sc.rays, ...sc.rims]) { el.style.transition = ""; el.style.transform = ""; el.style.opacity = ""; el.style.willChange = ""; }
    if (sc.planet) sc.planet.style.opacity = "";
  }
  const planetNow = (sc) => { const b = sc.body.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, r: Math.max(2, b.width / 2) }; };
  function formingFrame(now) {
    const f = forming, sc = f.scene;
    const t = f.reverse ? Math.max(0, F.done - (now - f.t0) * F.reverseSpeed) : now - f.t0;
    const rot = reduced ? 0 : ((now - t0) / 1000) * 0.045;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    /* the sun clears the horizon and climbs, bowing a little to the right as a sun does */
    const su = ease((t - F.riseStart) / (F.riseEnd - F.riseStart));
    const sx = sc.ox + (cx - sc.ox) * su + Math.sin(Math.PI * su) * Math.abs(cy - sc.oy) * 0.09;
    const sy = sc.oy + (cy - sc.oy) * su;
    const sr = sc.r0 + (R - sc.r0) * su;
    /* the planet leaves its orbit: the door's own body, taken over where it is */
    const pu = quad((t - F.planetStart) / (F.planetEnd - F.planetStart));
    let p0 = f.p0;
    if (pu > 0) {
      if (f.reverse || !p0) { p0 = planetNow(sc); if (!f.reverse) f.p0 = p0; }
      sc.planet.style.opacity = "0";
    } else if (f.reverse) sc.planet.style.opacity = "";
    const px = p0 ? p0.x + (cx - p0.x) * pu : cx, py = p0 ? p0.y + (cy - p0.y) * pu : cy;
    const pr = p0 ? p0.r + (R * 1.012 - p0.r) * smooth(pu / 0.8) : R * 1.012;
    const d = Math.hypot(px - sx, py - sy);
    const cov = pu > 0 ? coverage(d, sr, pr) : 0, light = 1 - cov;
    /* the last sliver of the sun on the far side of the planet; past nothing, totality */
    const sliver = pu > 0 ? d + sr - pr : sr * 2;
    const tot = Math.max(0, Math.min(1, -sliver / (R * 0.012)));
    const flare = sliver > 0 && su > 0.85 ? Math.max(0, 1 - Math.abs(sliver - R * 0.012) / (R * 0.07)) : 0;
    setScene(sc, sx, sy, su, light, tot);
    /* the sun: born inside the door's glow, a disc by the time it is high */
    const born = Math.min(1, 0.25 + su / 0.15);
    if (tot < 1) {
      ctx.save();
      if (su < 0.7) {
        /* behind the horizon: the door's ground, sunk as far as the eye has followed the sun */
        const hr = 3000 * sc.k, hy = sc.oy + hr + H * 0.34 * su;
        ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(sc.ox, hy, hr, 0, TAU, true); ctx.clip("evenodd");
      }
      ctx.globalAlpha = born;
      const hal = light * (0.25 + 0.75 * su);
      const halo = ctx.createRadialGradient(sx, sy, sr * 0.7, sx, sy, sr * 4.4);
      halo.addColorStop(0, hexa(SUN, 0.42 * hal)); halo.addColorStop(0.3, hexa(GOLD, 0.16 * hal)); halo.addColorStop(0.7, hexa(RIM, 0.05 * hal)); halo.addColorStop(1, hexa(RIM, 0));
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(sx, sy, sr * 4.4, 0, TAU); ctx.fill();
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
      g.addColorStop(0, CORE); g.addColorStop(0.55, SUN); g.addColorStop(0.9, GOLD); g.addColorStop(1, hexa(RIM, 0.9));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, sr, 0, TAU); ctx.fill();
      ctx.restore(); ctx.globalAlpha = 1;
    }
    /* totality: the corona, and the line written round it by a point of light */
    if (tot > 0) {
      const w = Math.max(0, Math.min(1, (t - F.textStart) / (F.textEnd - F.textStart)));
      drawCorona(tot, rot, w);
      if (flare > 0 || tot < 1) { ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = (1 - tot) * 0.5; ctx.translate(cx, cy); ctx.rotate(rot); ctx.drawImage(corona, -coronaSize / 2, -coronaSize / 2, coronaSize, coronaSize); ctx.restore(); ctx.globalAlpha = 1; }
    }
    if (p0 && pu > 0) {
      const tx = d > 0.5 ? (sx - px) / d : 0, ty = d > 0.5 ? (sy - py) / d : -1;
      drawPlanet(px, py, pr, 1 - smooth((pu - 0.08) / 0.84), tx, ty);
    }
    if (flare > 0) {
      const ax = Math.atan2(sy - py, sx - px);
      drawFlare(sx + Math.cos(ax) * sr * 0.985, sy + Math.sin(ax) * sr * 0.985, flare);
      ctx.fillStyle = hexa(SUN, 0.09 * flare * flare); ctx.fillRect(0, 0, W, H);
    }
    const end = f.reverse ? t <= 0 : t >= F.done;
    if (end) { const done = f.resolve; forming = null; if (f.reverse) releaseScene(sc); done(); }
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
    /* form the eclipse over the door: its sunrise climbs, its planet crosses; resolves at totality with the line on the rim */
    form(scene) {
      return new Promise((resolve) => {
        this.start();
        if (reduced) { resolve(); return; }
        prepareScene(scene);
        forming = { t0: performance.now(), scene, reverse: false, resolve };
      });
    },
    /* the eclipse coming apart again: the planet moves off, the light returns, the sun sinks back to the horizon */
    unform(scene) {
      return new Promise((resolve) => {
        if (reduced || !running) { resolve(); return; }
        prepareScene(scene);
        forming = { t0: performance.now(), scene, reverse: true, resolve };
        formingFrame(performance.now());
      });
    },
    /* the door's layers handed back once the door is gone */
    release(scene) { releaseScene(scene); },
    stop() { running = false; forming = null; cancelAnimationFrame(raf); removeEventListener("resize", size); },
  };
}
