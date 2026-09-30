/*
 * THE INSTALL: an eclipse.
 *
 * A thin gold ring in the dark — the corona of a sun whose disc is the same
 * black as the sky. The command is written round the ring and turns with it.
 * Copy is the one word on the disc. Move the pointer and the disc slides off
 * the sun; a sliver of true light opens on the far side and, on the sun's
 * face, the launcher is running — its real screens, lit from within. Let go
 * and the disc drifts back. Scroll and the disc moves off for good: the sun
 * comes out, the screens run in sequence across its face at your pace, and
 * at the end the page is the site's own sunrise.
 *
 * Drawn on a 2D canvas; the layers that never change are drawn once.
 */
import { reduced } from "./sky.js";
const $ = (s, r = document) => r.querySelector(s);
const CMD = "$ curl -fsSL https://raw.githubusercontent.com/tomlawesome/orbit/main/scripts/get-orbit.sh | bash";
const SHOTS = [
  ["01-splash", "splash"], ["02-install-profile", "install · profile"], ["03-install-ready", "install · ready"],
  ["04-install-console", "install · running"], ["05-install-success", "install · done"], ["06-splash-alive", "orbit · running"],
];
const GOLD = "#d8b45a", CORE = "#fff6e6", SUN = "#ffe9c4", RIM = "#e2772b";
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ease = (u) => 1 - Math.pow(1 - clamp01(u), 3);
const hexa = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };

export function createInstall(pad) {
  const canvas = $(".eclipse", pad), ctx = canvas.getContext("2d");
  const track = $(".track", pad), sceneN = $(".scene .n", pad), sceneName = $(".scene .name", pad), copy = $(".copy.core", pad), gate = $(".gate.rise", pad);
  gate.addEventListener("click", () => $("#gate").click());
  let W = 0, H = 0, dpr = 1, R = 0, cx = 0, cy = 0;
  let running = false, raf = 0, t0 = 0, progress = 0, shown = -1;
  /* where the pointer pushes the disc, and where the disc is */
  const aim = { x: 0, y: 0 }, disc = { x: 0, y: 0 };
  let pointerOn = false, pressed = false;
  const mode = () => (location.hash.split("/")[1] === "moon" ? "moon" : "still");
  const imgs = SHOTS.map(([n]) => { const i = new Image(); i.decoding = "async"; i.src = `assets/img/launcher/${n}.webp`; return i; });
  let corona = null, sun = null, coronaSize = 0;

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
    /* the sun's face: its glow, drawn once; the launcher's picture goes on top each frame */
    sun = document.createElement("canvas"); sun.width = sun.height = Math.round(R * 2 * dpr);
    const s = sun.getContext("2d"); s.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = s.createRadialGradient(R, R, 0, R, R, R);
    g.addColorStop(0, CORE); g.addColorStop(0.55, SUN); g.addColorStop(0.92, hexa(GOLD, 1)); g.addColorStop(1, hexa(RIM, 1));
    s.fillStyle = g; s.beginPath(); s.arc(R, R, R, 0, 6.284); s.fill();
  }
  function scene(i) {
    if (i === shown) return; shown = i;
    sceneN.textContent = String(i + 1).padStart(2, "0"); sceneName.textContent = SHOTS[i][1];
  }
  addEventListener("pointermove", (e) => { if (pad.hidden) return; pointerOn = true; aim.x = (e.clientX - cx) / R; aim.y = (e.clientY - cy) / R; }, { passive: true });
  addEventListener("pointerdown", () => { pressed = true; }); addEventListener("pointerup", () => { pressed = false; });
  document.addEventListener("pointerleave", () => { pointerOn = false; });
  track.addEventListener("scroll", () => { const max = track.scrollHeight - track.clientHeight; progress = max > 0 ? clamp01(track.scrollTop / max) : 0; pad.classList.toggle("open", progress > 0.04); pad.classList.toggle("risen", progress > 0.94); }, { passive: true });

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (pad.hidden || document.hidden || !corona) return;
    const t = (now - t0) / 1000, p = ease(progress);
    /* the disc: pushed by the pointer, drifting back when let go; and off for good as the page is scrolled */
    /* moon: the disc is a body with weight, nudged a little by the pointer and lagging behind it; still: only the scroll moves it */
    const moon = mode() === "moon";
    const push = moon && pointerOn ? Math.min(1, Math.hypot(aim.x, aim.y) / 2.6) : 0;
    const ang = Math.atan2(aim.y, aim.x);
    const tx = push ? Math.cos(ang) * push * R * (pressed ? 0.5 : 0.22) : 0, ty = push ? Math.sin(ang) * push * R * (pressed ? 0.5 : 0.22) : 0;
    disc.x = lerp(disc.x, tx, 0.022); disc.y = lerp(disc.y, ty, 0.022);
    const off = p * R * 3.8;
    const dx = cx + disc.x + off * 0.62, dy = cy + disc.y - off * 0.6;
    const rot = reduced ? 0 : t * 0.045;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    /* the sun: the corona (turning, with the command), then its face, then the launcher on its face */
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); ctx.globalAlpha = 1 - clamp01((progress - 0.5) / 0.4) * 0.85;
    ctx.drawImage(corona, -coronaSize / 2, -coronaSize / 2, coronaSize, coronaSize);
    ctx.restore();
    ctx.drawImage(sun, cx - R, cy - R, R * 2, R * 2);
    /* the launcher on the sun's face: the picture covers the disc, its dark
       the sun's dark heart, and the light comes in from the rim; at the end
       of the scroll the face fills with light and the page is the sunrise */
    const f = progress * (SHOTS.length - 1) / 0.82, i = Math.min(SHOTS.length - 2, Math.floor(f)), m = clamp01((f - i - 0.35) / 0.3);
    scene(Math.min(SHOTS.length - 1, f - i > 0.5 ? i + 1 : i));
    const rise = clamp01((progress - 0.84) / 0.16);
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R * 0.985, 0, 6.284); ctx.clip();
    const ph = R * 2, pw = ph * 16 / 9;
    const draw = (img, al) => { if (!img.complete || !img.naturalWidth) return; ctx.globalAlpha = al; ctx.drawImage(img, cx - pw / 2, cy - ph / 2, pw, ph); };
    draw(imgs[i], 1); if (m > 0) draw(imgs[Math.min(SHOTS.length - 1, i + 1)], m);
    ctx.globalAlpha = 1;
    /* the light at the rim, streaming in — wider as the sun comes out */
    const inner = R * (0.66 - rise * 0.5);
    const l = ctx.createRadialGradient(cx, cy, inner, cx, cy, R); l.addColorStop(0, hexa(SUN, 0)); l.addColorStop(0.55, hexa(SUN, 0.35 + rise * 0.4)); l.addColorStop(1, hexa(CORE, 1));
    ctx.fillStyle = l; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    if (rise > 0) { ctx.globalAlpha = rise; ctx.drawImage(sun, cx - R, cy - R, R * 2, R * 2); ctx.globalAlpha = 1; }
    ctx.restore();
    /* the diamond ring: as the disc first clears the limb, one point of true light flares where the sun shows */
    const sep = Math.hypot(dx - cx, dy - cy) / R, ring = Math.max(0, Math.min(1, (sep - 0.01) / 0.05)) * Math.max(0, 1 - (sep - 0.06) / 0.5);
    if (ring > 0.01) {
      const ax = Math.atan2(cy - dy, cx - dx), px = cx + Math.cos(ax) * R * 0.97, py = cy + Math.sin(ax) * R * 0.97;
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(px, py, 0, px, py, R * 0.55 * ring);
      g.addColorStop(0, hexa(CORE, 0.95 * ring)); g.addColorStop(0.12, hexa(SUN, 0.5 * ring)); g.addColorStop(1, hexa(SUN, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, R * 0.55 * ring, 0, 6.284); ctx.fill();
      ctx.strokeStyle = hexa(CORE, 0.55 * ring); ctx.lineWidth = 1.2;
      for (const sa of [0, 1.05, 2.1]) { ctx.beginPath(); ctx.moveTo(px - Math.cos(sa) * R * 0.5 * ring, py - Math.sin(sa) * R * 0.5 * ring); ctx.lineTo(px + Math.cos(sa) * R * 0.5 * ring, py + Math.sin(sa) * R * 0.5 * ring); ctx.stroke(); }
      ctx.restore();
    }
    /* the disc: the sky's own black, a hair larger than the sun, with the faintest lit edge on the side the light comes from */
    ctx.globalAlpha = 1;
    ctx.globalAlpha = 1 - clamp01((progress - 0.7) / 0.3);   /* the disc thins to nothing as it leaves */
    const body = ctx.createRadialGradient(dx - R * 0.3, dy - R * 0.3, R * 0.1, dx, dy, R * 1.012);
    body.addColorStop(0, "#0b1226"); body.addColorStop(0.7, "#070c1c"); body.addColorStop(1, "#04070f");
    ctx.fillStyle = body; ctx.beginPath(); ctx.arc(dx, dy, R * 1.012, 0, 6.284); ctx.fill();
    const lx = cx - dx, ly = cy - dy, ld = Math.hypot(lx, ly) || 1;
    if (ld > 2) {
      const e = ctx.createRadialGradient(dx + lx / ld * R * 0.9, dy + ly / ld * R * 0.9, R * 0.2, dx, dy, R * 1.012);
      e.addColorStop(0, hexa(SUN, 0.28 * Math.min(1, ld / R))); e.addColorStop(0.6, hexa(SUN, 0)); e.addColorStop(1, hexa(SUN, 0));
      ctx.fillStyle = e; ctx.beginPath(); ctx.arc(dx, dy, R * 1.012, 0, 6.284); ctx.fill();
    }
    ctx.globalAlpha = 1;
    copy.style.transform = `translate(calc(-50% + ${(dx - cx).toFixed(1)}px), calc(-50% + ${(dy - cy).toFixed(1)}px))`;
    copy.style.opacity = String(1 - p * 1.6);
    gate.style.opacity = String(clamp01((progress - 0.9) / 0.1)); gate.style.pointerEvents = progress > 0.92 ? "auto" : "none";
  }
  pad.querySelector(".modes").addEventListener("click", (e) => { const a = e.target.closest("a"); if (!a) return; e.preventDefault(); try { history.replaceState(null, "", a.getAttribute("href")); } catch { /* fine */ } mark(); });
  const mark = () => pad.querySelectorAll(".modes a").forEach((a) => a.classList.toggle("on", a.getAttribute("href").endsWith(mode())));
  return {
    start() {
      running = true; t0 = performance.now(); mark(); track.scrollTop = 0; progress = 0; shown = -1; disc.x = disc.y = 0;
      pad.classList.remove("open", "risen");
      size(); addEventListener("resize", size);
      cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    },
    stop() { running = false; cancelAnimationFrame(raf); removeEventListener("resize", size); },
  };
}
