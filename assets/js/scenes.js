/*
 * THE SIX SCENES — what each stage of the install looks like, drawn behind
 * the ring in the flight's own chart pen: the same hairline things you pass
 * on the climb (engine.js's graticule, constellation, craft, comet and
 * system), each one doing this stage's work, and the sun for the claim.
 */
const CONS = [[-150, -58, 3.2], [-52, -96, 2.2], [24, -24, 3.8], [104, -72, 2.4], [168, 26, 2.8], [96, 96, 2.6], [-40, 84, 2.2]];
const hexa = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
const ease = (u) => 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 3);

export function createScenes(canvas, ringEl, { text = true } = {}) {
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, dpr = 1, raf = 0, cur = -1, prev = -1, since = 0, started = 0;
  let PEN = {};
  function palette() {
    const cs = getComputedStyle(document.documentElement);
    const v = (k, d) => (cs.getPropertyValue(k).trim() || d);
    const accent = v("--accent", "#d8b45a");
    PEN = { hi: v("--ink-mid", "#8791b3"), pen: v("--ink-faint", "#737e9e"), lo: v("--line", "#243259"), accent, ok: v("--ok", "#4ade80"), up: v("--upcoming", "#8fb8ff"), star: v("--ink", "#e9edf8"), sun: v("--sun", "#ffe9c4"), core: v("--sun-core", "#fff6e6"), hull: v("--bg", "#060b1c") };
  }
  function size() {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
  }
  const frame = () => { const r = ringEl.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, S: r.width * 0.36 }; };

  /* 1 · the seal: the graticule, turning, with the check sweeping round it */
  function seal(t, a, f) {
    const { cx, cy, S } = f; const k = S / 72;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.4 + t * 0.00004);
    ctx.lineWidth = 1; ctx.strokeStyle = PEN.lo; ctx.globalAlpha = a * 0.9;
    for (const r of [96, 128, 160]) { ctx.beginPath(); ctx.arc(0, 0, r * k, -2.2, 2.2); ctx.stroke(); }
    for (let i = -6; i <= 6; i++) { const q = i * 0.34; ctx.beginPath(); ctx.moveTo(Math.cos(q) * 92 * k, Math.sin(q) * 92 * k); ctx.lineTo(Math.cos(q) * 166 * k, Math.sin(q) * 166 * k); ctx.stroke(); }
    ctx.restore();
    /* the check: one gold sweep, then it holds */
    const u = ease(((t % 4200) / 4200) * 1.25);
    ctx.save(); ctx.translate(cx, cy);
    ctx.lineWidth = 1.5; ctx.strokeStyle = PEN.accent; ctx.globalAlpha = a * 0.85; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(0, 0, 112 * k, -Math.PI / 2, -Math.PI / 2 + u * Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = a * 0.55; ctx.fillStyle = PEN.accent;
    const tip = -Math.PI / 2 + u * Math.PI * 2; ctx.beginPath(); ctx.arc(Math.cos(tip) * 112 * k, Math.sin(tip) * 112 * k, 2.4, 0, 6.284); ctx.fill();
    ctx.restore();
  }
  /* 2 · every file: a constellation, each point checked in turn and joined to the last */
  function files(t, a, f) {
    const { cx, cy, S } = f; const k = S / 72 * 0.95;
    const n = CONS.length, lit = Math.min(n, Math.floor(t / 520) + 1), u = ease((t % 520) / 520);
    ctx.save(); ctx.translate(cx, cy);
    ctx.lineWidth = 1; ctx.strokeStyle = PEN.pen; ctx.globalAlpha = a * 0.7;
    ctx.beginPath();
    for (let i = 0; i < lit; i++) { const p = CONS[i]; if (i === 0) ctx.moveTo(p[0] * k, p[1] * k); else if (i < lit - 1) ctx.lineTo(p[0] * k, p[1] * k); else { const q = CONS[i - 1]; ctx.lineTo((q[0] + (p[0] - q[0]) * u) * k, (q[1] + (p[1] - q[1]) * u) * k); } }
    ctx.stroke();
    ctx.setLineDash([2, 8]); ctx.strokeStyle = PEN.accent; ctx.globalAlpha = a * 0.5;
    ctx.beginPath(); ctx.moveTo(CONS[0][0] * k, CONS[0][1] * k); ctx.lineTo(CONS[n - 1][0] * k, CONS[n - 1][1] * k); ctx.stroke(); ctx.setLineDash([]);
    for (let i = 0; i < n; i++) {
      const p = CONS[i], on = i < lit;
      ctx.globalAlpha = a * (on ? 1 : 0.35); ctx.fillStyle = on ? PEN.star : PEN.pen;
      ctx.beginPath(); ctx.arc(p[0] * k, p[1] * k, p[2] * 0.9, 0, 6.284); ctx.fill();
      if (on && i < lit - 1) { ctx.strokeStyle = PEN.accent; ctx.globalAlpha = a * 0.8; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p[0] * k, p[1] * k, 8, 0, 6.284); ctx.stroke(); }
    }
    ctx.restore();
  }
  /* 3 · the launcher: the craft, crossing the sky above the ring */
  function craft(t, a, f) {
    const { cx, cy, S } = f; const sc = S / 150;
    const u = ((t / 9000) % 1);
    const x = -260 * sc + (W + 520 * sc) * u, y = cy - S * 2.05 + Math.sin(t / 1300) * 6 * sc;
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc); ctx.globalAlpha = a;
    const hair = 1.15 / sc;
    ctx.lineJoin = "round"; ctx.strokeStyle = PEN.lo; ctx.lineWidth = hair;
    for (const d of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(-4, 13 * d); ctx.lineTo(-4, 44 * d); ctx.stroke();
      const top = d < 0 ? -78 : 44;
      ctx.fillStyle = PEN.hull; ctx.fillRect(-40, top, 74, 34); ctx.strokeStyle = PEN.pen; ctx.strokeRect(-40, top, 74, 34);
      ctx.strokeStyle = PEN.lo; for (let i = 1; i < 5; i++) { const gx = -40 + i * 14.8; ctx.beginPath(); ctx.moveTo(gx, top); ctx.lineTo(gx, top + 34); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(-40, top + 17); ctx.lineTo(34, top + 17); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(-52, -13); ctx.lineTo(30, -13); ctx.lineTo(48, 0); ctx.lineTo(30, 13); ctx.lineTo(-52, 13); ctx.closePath();
    ctx.fillStyle = PEN.hull; ctx.fill(); ctx.strokeStyle = PEN.hi; ctx.lineWidth = hair * 1.35; ctx.stroke();
    ctx.strokeStyle = PEN.lo; ctx.lineWidth = hair;
    ctx.beginPath(); ctx.moveTo(-30, -13); ctx.lineTo(-30, 13); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-8, -13); ctx.lineTo(-8, 13); ctx.stroke();
    ctx.strokeStyle = PEN.hi; ctx.lineWidth = hair * 1.2; ctx.beginPath(); ctx.arc(58, 0, 30, -1.2, 1.2); ctx.stroke();
    ctx.lineWidth = hair; ctx.beginPath(); ctx.moveTo(48, 0); ctx.lineTo(74, 0); ctx.stroke(); ctx.beginPath(); ctx.arc(74, 0, 3, 0, 6.284); ctx.stroke();
    const wake = ctx.createLinearGradient(-52, 0, -108, 0); wake.addColorStop(0, hexa(PEN.accent, 0.55)); wake.addColorStop(1, hexa(PEN.accent, 0));
    ctx.fillStyle = wake; ctx.beginPath(); ctx.moveTo(-52, -7); ctx.lineTo(-108, 0); ctx.lineTo(-52, 7); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = a * (0.45 + 0.55 * Math.abs(Math.sin(t / 320))); ctx.fillStyle = PEN.accent; ctx.beginPath(); ctx.arc(20, 0, 3.6, 0, 6.284); ctx.fill();
    ctx.restore();
  }
  /* 4 · the image: the comet comes in and is pinned at the rim, its digest beside it */
  function comet(t, a, f) {
    const { cx, cy, S } = f; const sc = S / 110;
    const u = ease(t / 1700);
    const from = [W + 200, cy - S * 2.6], to = [cx + S * 1.55, cy - S * 1.15];
    const x = from[0] + (to[0] - from[0]) * u, y = from[1] + (to[1] - from[1]) * u;
    const ang = Math.atan2(to[1] - from[1], to[0] - from[0]);
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(sc, sc); ctx.globalAlpha = a * (0.55 + 0.45 * (1 - u));
    const tail = ctx.createLinearGradient(0, 0, -260, 0); tail.addColorStop(0, hexa(PEN.accent, 0.85)); tail.addColorStop(1, hexa(PEN.accent, 0));
    ctx.strokeStyle = tail; ctx.lineWidth = 7 / sc; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-300 * (0.3 + 0.7 * (1 - u)), 0); ctx.stroke();
    ctx.strokeStyle = hexa(PEN.up, 0.4); ctx.lineWidth = 2.4 / sc; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-220 * (0.3 + 0.7 * (1 - u)), -30); ctx.stroke();
    ctx.restore();
    ctx.save(); ctx.translate(x, y); ctx.globalAlpha = a;
    const head = ctx.createRadialGradient(0, 0, 0, 0, 0, 26 * sc); head.addColorStop(0, hexa(PEN.core, 0.95)); head.addColorStop(0.35, hexa(PEN.sun, 0.4)); head.addColorStop(1, hexa(PEN.sun, 0));
    ctx.fillStyle = head; ctx.beginPath(); ctx.arc(0, 0, 26 * sc, 0, 6.284); ctx.fill();
    ctx.fillStyle = PEN.core; ctx.beginPath(); ctx.arc(0, 0, 4 * sc, 0, 6.284); ctx.fill();
    /* pinned: the hairline bracket and the digest, once it has settled */
    const v = ease((t - 1500) / 700);
    if (v > 0 && text) {
      ctx.globalAlpha = a * v; ctx.strokeStyle = PEN.pen; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, 14 * sc, 0, 6.284); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(14 * sc, 0); ctx.lineTo(34 * sc, 0); ctx.stroke();
      ctx.fillStyle = PEN.hi; ctx.font = `${Math.max(9, 10 * Math.min(1, sc))}px "JetBrains Mono", monospace`; ctx.textBaseline = "middle";
      ctx.fillText("@sha256:…", 40 * sc, 0);
    }
    ctx.restore();
  }
  /* 5 · the stack: three orbits round the ring, each body lit healthy in turn */
  function stack(t, a, f) {
    const { cx, cy, S } = f;
    const rings = [[1.42, PEN.up, 0.0009, 0.2], [1.78, PEN.accent, 0.0006, 2.4], [2.14, PEN.ok, 0.00045, 4.2]];
    ctx.save(); ctx.translate(cx, cy); ctx.lineWidth = 1;
    rings.forEach(([rr, col, w, ph], i) => {
      const r = S * rr, on = t > 900 + i * 1100, u = ease((t - (900 + i * 1100)) / 700);
      ctx.strokeStyle = PEN.lo; ctx.globalAlpha = a * 0.9; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.284); ctx.stroke();
      if (i === 2) { ctx.setLineDash([3, 5]); ctx.strokeStyle = hexa(col, 0.35); ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.284); ctx.stroke(); ctx.setLineDash([]); }
      const q = ph + t * w, bx = Math.cos(q) * r, by = Math.sin(q) * r;
      if (on) { ctx.globalAlpha = a * 0.16 * (1 + 0.5 * Math.sin(t / 400)); ctx.fillStyle = PEN.ok; ctx.beginPath(); ctx.arc(bx, by, 11 + 6 * (1 - u), 0, 6.284); ctx.fill(); }
      ctx.globalAlpha = a; ctx.fillStyle = on ? PEN.ok : PEN.pen; ctx.beginPath(); ctx.arc(bx, by, on ? 4.2 : 3.2, 0, 6.284); ctx.fill();
      if (!text) return;
      ctx.globalAlpha = a * 0.8; ctx.fillStyle = PEN.hi; ctx.font = `9px "JetBrains Mono", monospace`; ctx.textBaseline = "middle"; ctx.textAlign = bx >= 0 ? "left" : "right";
      ctx.fillText(["postgres", "orbit", "clamav"][i], bx + (bx >= 0 ? 10 : -10), by);
    });
    ctx.restore();
  }
  /* 6 · the claim: the sun, lit once, and the link drawn from the log */
  function claim(t, a, f) {
    const { cx, cy, S } = f;
    const b = 0.55 + 0.45 * ease(t / 2600), br = 0.5 + 0.5 * Math.sin(t / 900);
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 2.6); halo.addColorStop(0, hexa(PEN.accent, 0.20 * b)); halo.addColorStop(0.5, hexa(PEN.accent, 0.07 * b)); halo.addColorStop(1, hexa(PEN.accent, 0));
    ctx.globalAlpha = a; ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 1.2;
    for (const [off, mul] of [[0, 0.42], [0.3, 0.2]]) { const q = ((t / 3800) + off) % 1; ctx.strokeStyle = hexa(PEN.sun, Math.pow(1 - q, 1.6) * mul * a); ctx.beginPath(); ctx.arc(cx, cy, S * (1.05 + q * 2.4), 0, 6.284); ctx.stroke(); }
    /* the last line of the log, and the one-time link reaching the ring */
    const u = ease((t - 600) / 1100);
    if (u > 0 && text) {
      const x0 = Math.max(16, cx - S * 2.7), y0 = cy - S * 1.55;
      ctx.save(); ctx.globalAlpha = a * u; ctx.strokeStyle = PEN.pen; ctx.lineWidth = 1;
      ctx.strokeRect(x0, y0 - 9, S * 1.5, 18);
      ctx.fillStyle = PEN.hi; ctx.font = `9.5px "JetBrains Mono", monospace`; ctx.textBaseline = "middle"; ctx.textAlign = "left";
      ctx.fillText("https://…/claim/", x0 + 8, y0);
      ctx.strokeStyle = PEN.accent; ctx.setLineDash([3, 6]); ctx.beginPath(); ctx.moveTo(x0 + S * 1.5, y0);
      const ex = cx - Math.SQRT1_2 * S * 1.02, ey = cy - Math.SQRT1_2 * S * 1.02;
      ctx.lineTo(x0 + S * 1.5 + (ex - x0 - S * 1.5) * u, y0 + (ey - y0) * u); ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = a * u * br; ctx.fillStyle = PEN.accent; ctx.beginPath(); ctx.arc(ex, ey, 3.2, 0, 6.284); ctx.fill();
      ctx.restore();
    }
  }
  const SCENES = [seal, files, craft, comet, stack, claim];

  function draw(now) {
    if (!started) started = now;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const f = frame(); const x = Math.min(1, (now - since) / 700);
    if (prev >= 0 && x < 1) SCENES[prev % SCENES.length](now - started, (1 - x) * 0.6, f);
    if (cur >= 0) SCENES[cur % SCENES.length](now - since, x * 0.6, f);
    raf = requestAnimationFrame(draw);
  }
  return {
    start() { palette(); size(); if (!raf) raf = requestAnimationFrame(draw); },
    stop() { cancelAnimationFrame(raf); raf = 0; cur = prev = -1; ctx.clearRect(0, 0, canvas.width, canvas.height); },
    show(i) { if (i === cur) return; prev = cur; cur = i; since = performance.now(); },
    resize: size,
  };
}
