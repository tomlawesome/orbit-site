/*
 * THE INSTALL: into orbit.
 *
 * The purple planet on the door is a world, and clicking it goes there. The
 * dot is where the shot starts: the camera turns to it, the dawn falls away
 * behind, and the dot opens into a ringed planet — oceans and continents
 * under turning weather, a gold moon beyond the rings — until the camera is
 * in orbit over its day side, the terminator running down into a night lit
 * by the homes on it, and the sun breaking over its shoulder. The one line
 * waits in the dark above it.
 *
 * Drawn by world.js; this is the camera, the clock and the line.
 */
import { reduced } from "./sky.js";
import { createWorld } from "./world.js";

const $ = (s, r = document) => r.querySelector(s);
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
/* cubic-bezier easing, as CSS has it */
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t, Y = (t) => ((ay * t + by) * t + cy) * t, dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    x = clamp(x); let t = x;
    for (let i = 0; i < 6; i++) { const d = dX(t); if (Math.abs(d) < 1e-6) break; t -= (X(t) - x) / d; }
    return Y(clamp(t));
  };
}
/* the shot is slow on purpose: a long ease into the move, a long glide, a long settle */
const easeDolly = bezier(0.5, 0, 0.2, 1), easeTurn = bezier(0.5, 0, 0.3, 1), easeAim = bezier(0.6, 0, 0.3, 1);

/* vectors and 3×3 rotations (row-major; uploaded transposed) */
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => mul(a, 1 / Math.hypot(...a));
const rx = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const ry = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const rz = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const mm = (A, B) => { const r = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r.push(A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]); return r; };
const tr = (A) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
const mv = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];

/* the world, fixed: where the sun is, how the planet leans, where the galaxy
   runs; and the shot: the camera's place at rest (azimuth and elevation round
   the planet, its distance in planet radii), where it starts from, and where
   the planet sits at rest on the screen (its centre from the screen's centre,
   y up, and its radius, in screen heights; the moon's place likewise) */
export const TUNE = {
  sun: [-0.72, 0.32, 0.55], tiltZ: 0.38, tiltX: -0.12, sky: [1.2, 0.6],
  rest: { az: 0.0, el: 0.3, roll: 0.18, d: 5.2 }, from: { az: -0.8, el: 0.55, roll: 0.4 },
  land: { R: 0.47, cx: 0.22, cy: -0.12, moon: [-0.3, 0.27], moonR: 8.0 },
  port: { R: 0.26, cx: 0.1, cy: -0.2, moon: [-0.3, 0.04], moonR: 8.0 },
};
let SUN, TILT, TO_TILT, SKY, REST, FROM;
function world0() {
  SUN = norm(TUNE.sun);
  TILT = mm(rz(TUNE.tiltZ), rx(TUNE.tiltX));      /* planet frame → world */
  TO_TILT = tr(TILT);                              /* world → ring frame */
  SKY = tr(mm(rz(TUNE.sky[0]), rx(TUNE.sky[1])));  /* world → galaxy frame */
  REST = TUNE.rest; FROM = TUNE.from;
}
const APPROACH = 12, SETTLE = 9.6, RETURN = 5;

function layoutFor(W, H) {
  const t = H > W * 1.1 ? TUNE.port : TUNE.land;
  const R = t.R * H, focal = R * Math.sqrt(REST.d * REST.d - 1);
  return { focal, R, cx: t.cx * W, cy: t.cy * H, moon: [t.moon[0] * W, t.moon[1] * H], moonR: t.moonR };
}

export function createInstall(pad, opts = {}) {
  const canvas = $(".orbitgl", pad);
  let world = null, failed = false;
  let W = 0, H = 0, scale = 1, maxScale = 1, lay = null, moonPos = [0, 0, 0, 0];
  let running = false, raf = 0, last = 0, clock = 0;
  /* the approach: u runs 0 → 1 going in, back to 0 going home */
  let u = 1, motion = null;
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  let frames = [], lastAdjust = 0, tick = 0;

  function ensure() {
    if (world || failed) return world;
    try { world = createWorld(canvas, opts.world); } catch (e) { console.warn(e); world = null; }
    if (!world) { failed = true; pad.classList.add("flat"); return null; }
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); world = null; failed = true; pad.classList.add("flat"); });
    return world;
  }
  function size() {
    world0();
    W = pad.clientWidth || innerWidth; H = pad.clientHeight || innerHeight;
    const dpr = devicePixelRatio || 1;
    /* drawn at the screen's own density, as sharp as the screen is; the governor gives way if frames come slow */
    maxScale = Math.min(dpr, 2);
    if (!frames.length) scale = maxScale;
    lay = layoutFor(W, H);
    /* the moon: on the line through its place on the screen, out beyond the rings */
    const v = view(1, 0, true);
    const q = [(lay.moon[0] - lay.cx) / lay.focal, (lay.moon[1] - lay.cy) / lay.focal];
    const rd = norm(add(v.fwd, add(mul(v.right, q[0]), mul(v.up, q[1]))));
    const b = dot(v.cam, rd), c = dot(v.cam, v.cam) - lay.moonR * lay.moonR, h = Math.sqrt(Math.max(0, b * b - c));
    moonPos = [...add(v.cam, mul(rd, -b + h > 0 ? -b + h : 12)), 0.075];
    world?.resize(W, H, scale);
  }
  /* the camera at a point in the shot: k is how far in (0 at the dot, 1 at rest) */
  function view(k, idle, bare = false, dot0 = null) {
    const L = lay;
    const eD = easeDolly(clamp((k - 0.06) / 0.94)), eT = easeTurn(clamp(k)), eA = easeAim(clamp(k / 0.62));
    const d1 = Math.sqrt((L.focal / L.R) ** 2 + 1);
    const d0 = dot0 ? Math.sqrt((L.focal / Math.max(1.5, dot0.r)) ** 2 + 1) : d1 * 60;
    const dist = Math.exp(lerp(Math.log(d0), Math.log(d1), eD));
    const drift = reduced ? 0 : idle * 0.0018;
    const az = lerp(FROM.az, REST.az, eT) + drift + (bare ? 0 : pointer.sx * 0.05 * k);
    const el = lerp(FROM.el, REST.el, eT) + (bare ? 0 : -pointer.sy * 0.03 * k);
    const roll = lerp(FROM.roll, REST.roll, eT);
    const c = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
    const cam = mul(c, dist), fwd = mul(c, -1);
    let right = norm(cross(fwd, [0, 1, 0])), up = cross(right, fwd);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    [right, up] = [add(mul(right, cr), mul(up, sr)), add(mul(up, cr), mul(right, -sr))];
    const from = dot0 ? [dot0.x - W / 2, H / 2 - dot0.y] : [L.cx, L.cy];
    const shift = [lerp(from[0], L.cx, eA), lerp(from[1], L.cy, eA)];
    return { cam, fwd, right, up, shift, dist };
  }
  function draw(now) {
    const w = world; if (!w || !lay) return;
    const idle = clock;
    const k = u;
    const dot0 = motion?.dot || null;
    const v = view(k, idle, false, dot0);
    const s = scale;
    /* the sun on the lens: where it would be, and how much of it the planet leaves */
    const sf = dot(SUN, v.fwd);
    const sp = sf > 0.02
      ? [(dot(SUN, v.right) / sf) * lay.focal + v.shift[0] + W / 2, (dot(SUN, v.up) / sf) * lay.focal + v.shift[1] + H / 2]
      : [W / 2 + dot(SUN, v.right) * W * 4, H / 2 + dot(SUN, v.up) * W * 4];
    const tb = dot(v.cam, SUN), pd = Math.hypot(...add(v.cam, mul(SUN, -tb)));
    const sunVis = tb > 0 ? 1 : smooth(0.995, 1.06, pd);
    const spin = mm(ry(-(0.9 + idle * 0.004)), TO_TILT);
    w.draw({
      cam: v.cam, fwd: v.fwd, right: v.right, up: v.up,
      focal: lay.focal * s, shift: [v.shift[0] * s, v.shift[1] * s], sunPx: [sp[0] * s, sp[1] * s],
      sun: SUN, spin: tr(spin), tilt: tr(TO_TILT), sky: tr(SKY), moon: moonPos,
      time: now / 1000, bg: smooth(0.02, 0.26, k), sunVis, expo: lerp(0.72, 1.0, smooth(0.35, 0.95, k)),
    });
  }
  /* keeping the frame rate: the drawing gets smaller when the frames come slow, and back when they don't */
  function govern(dt) {
    frames.push(dt); if (frames.length < 24) return;
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length; frames = [];
    const now = performance.now(); if (now - lastAdjust < 900) return;
    let next = scale;
    if (avg > 24) next = Math.max(0.45, scale * 0.82);
    else if (avg < 13 && !motion) next = Math.min(maxScale, scale * 1.1);
    if (Math.abs(next - scale) > 0.01) { scale = next; lastAdjust = now; world?.resize(W, H, scale); }
  }
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(100, now - last) : 16; last = now;
    if (pad.hidden || document.hidden || !world || !world.baked) return;
    clock += dt / 1000;
    pointer.sx += (pointer.x - pointer.sx) * Math.min(1, dt / 900);
    pointer.sy += (pointer.y - pointer.sy) * Math.min(1, dt / 900);
    if (motion) {
      const t = (now - motion.t0) / 1000;
      if (motion.reverse) {
        u = clamp(motion.from * (1 - t / RETURN));
        if (u <= 0) { const m = motion; motion = null; draw(now); m.resolve(); return; }
      } else {
        u = clamp(t / APPROACH);
        if (!motion.settled && t >= SETTLE) { motion.settled = true; motion.resolve(); }
        if (u >= 1) motion = null;
      }
    }
    if (reduced && !motion && frames.length > 2) return;
    /* at rest the orbit is slow: every other frame is enough */
    if (!motion && (tick++ & 1)) return;
    draw(now);
    govern(dt);
  }
  const onPointer = (e) => { pointer.x = (e.clientX / innerWidth) * 2 - 1; pointer.y = (e.clientY / innerHeight) * 2 - 1; };
  const onResize = () => { frames = []; size(); };

  return {
    /* the textures are baked before they are wanted, while the door is quiet */
    prepare() { const w = ensure(); if (w) { size(); w.bake(); } },
    start() {
      const w = ensure();
      if (running) return;
      running = true; last = 0;
      size();
      addEventListener("resize", onResize); addEventListener("pointermove", onPointer);
      if (w) w.bake().then((ok) => pad.classList.add(ok ? "lit" : "flat"));
      cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    },
    /* the shot in from the door's planet: resolves when the camera has all but settled */
    form(scene) {
      return new Promise(async (resolve) => {
        this.start();
        const ok = world && (await world.bake());
        if (!ok || reduced) { u = 1; motion = null; resolve(); return; }
        pad.classList.add("lit");
        const b = scene.body.getBoundingClientRect();
        const dot0 = { x: b.left + b.width / 2, y: b.top + b.height / 2, r: Math.max(1.5, b.width / 2) };
        u = 0; clock = 0; frames = [];
        motion = { t0: performance.now(), dot: dot0, reverse: false, resolve, settled: false };
      });
    },
    /* the shot back out to where the planet is on the door now */
    unform(scene) {
      return new Promise((resolve) => {
        if (!world || reduced || !running) { resolve(); return; }
        const b = scene.body.getBoundingClientRect();
        const dot0 = { x: b.left + b.width / 2, y: b.top + b.height / 2, r: Math.max(1.5, b.width / 2) };
        motion = { t0: performance.now(), dot: dot0, reverse: true, from: u, resolve };
      });
    },
    stop() {
      running = false; motion = null; u = 1; cancelAnimationFrame(raf);
      removeEventListener("resize", onResize); removeEventListener("pointermove", onPointer);
    },
    /* one frame at a point in the shot, for the posters (assets/img/install) and for review */
    async still(k, idle = 0, dotAt = null) {
      ensure(); if (!world) return false;
      size(); if (!(await world.bake())) return false;
      motion = dotAt ? { dot: dotAt } : null; u = k; clock = idle;
      draw(performance.now()); motion = null;
      return true;
    },
  };
}
