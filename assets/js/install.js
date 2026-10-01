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
  sun: [-0.95, 0.28, -0.08], tiltZ: 0.38, tiltX: -0.12,
  /* the Milky Way: where its core sits on the screen at rest, and a point its band runs through (fractions from the top left) */
  sky: { core: [-0.35, -0.25], along: [0.6, 0.25] },
  /* the film: how bright the Milky Way is, how much dust, the lens's colour fringing, the grain */
  look: { galK: 0.05, dust: 1, fringe: 0.012, grain: 0.028 },
  rest: { az: 0.0, el: 0.3, roll: 0.18, d: 5.2 }, from: { az: -0.8, el: -0.23, roll: 0.3 },
  /* the moon the camera passes on the way in: when (k), how far off the path (planet radii, right and up), how big */
  fly: { k: 0.89, side: [-1.2, -0.8], r: 0.2 },
  land: { R: 0.47, cx: 0.22, cy: -0.12, moon: [-0.3, 0.27], moonR: 8.0 },
  port: { R: 0.26, cx: 0.1, cy: -0.2, moon: [-0.3, 0.04], moonR: 8.0 },
};
let SUN, TILT, TO_TILT, SKY, REST, FROM;
function world0() {
  SUN = norm(TUNE.sun);
  TILT = mm(rz(TUNE.tiltZ), rx(TUNE.tiltX));      /* planet frame → world */
  TO_TILT = tr(TILT);                              /* world → ring frame */
  SKY = tr(mm(rz(1.2), rx(0.6)));                   /* world → galaxy frame, until the screen is measured */
  REST = TUNE.rest; FROM = TUNE.from;
}
/* the hold while the camera finds the planet, the shot in, the moment the words come, the shot back out */
const HOLD = 1.1, APPROACH = 12, SETTLE = 9.6, RETURN = 5;

function layoutFor(W, H) {
  const t = H > W * 1.1 ? TUNE.port : TUNE.land;
  const R = t.R * H, focal = R * Math.sqrt(REST.d * REST.d - 1);
  return { focal, R, cx: t.cx * W, cy: t.cy * H, moon: [t.moon[0] * W, t.moon[1] * H], moonR: t.moonR };
}

export function createInstall(pad, opts = {}) {
  const canvas = $(".orbitgl", pad);
  let world = null, failed = false;
  let W = 0, H = 0, scale = 1, maxScale = 1, lay = null, moonPos = [0, 0, 0, 0], flyPos = [0, 0, 0, 0];
  let running = false, raf = 0, last = 0, clock = 0;
  /* the approach: u runs 0 → 1 going in, back to 0 going home */
  let u = 1, motion = null;
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  let frames = [], lastAdjust = 0, tick = 0, prev = null;
  /* how much of the canvas's resolution the scene is drawn at while the camera moves: measured before the first
     shot (calibrate), then kept to the frame rate; motion blur, the dolly's blur and the grain hide the difference */
  let mq = 0.6, mframes = [], cap = 2;

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
    /* … and no more than about 2560×1800 pixels in all, however dense and large the screen */
    maxScale = Math.max(0.5, Math.min(dpr, cap, Math.sqrt(4.6e6 / Math.max(1, W * H))));
    if (!frames.length) scale = maxScale;
    lay = layoutFor(W, H);
    /* the moon: on the line through its place on the screen, out beyond the rings */
    const v = view(1, 0, true);
    const q = [(lay.moon[0] - lay.cx) / lay.focal, (lay.moon[1] - lay.cy) / lay.focal];
    const rd = norm(add(v.fwd, add(mul(v.right, q[0]), mul(v.up, q[1]))));
    const b = dot(v.cam, rd), c = dot(v.cam, v.cam) - lay.moonR * lay.moonR, h = Math.sqrt(Math.max(0, b * b - c));
    moonPos = [...add(v.cam, mul(rd, -b + h > 0 ? -b + h : 12)), 0.075];
    placeFly(null);
    /* the galaxy turned so its core and its band fall where they are wanted on this screen at rest */
    const at = (f) => { const px = f[0] * W - W / 2, py = H / 2 - f[1] * H; return norm(add(v.fwd, add(mul(v.right, (px - v.shift[0]) / lay.focal), mul(v.up, (py - v.shift[1]) / lay.focal)))); };
    const core = at(TUNE.sky.core), n = norm(cross(core, at(TUNE.sky.along))), x = cross(n, core);
    SKY = [...x, ...n, ...core];
    world?.resize(W, H, scale);
  }
  /* the moon passed on the way in: beside the path where the camera is at fly.k */
  function placeFly(dot0) {
    const f = TUNE.fly, v = view(f.k, 0, true, dot0);
    flyPos = [...add(v.cam, add(mul(v.right, f.side[0]), mul(v.up, f.side[1]))), f.r];
  }
  /* the camera at a point in the shot: k is how far in (0 at the dot, 1 at rest). It starts just
     under the plane of the rings, so they are a dark line through the dot, and rises through it
     late in the shot, when the rings turn to the sun and open */
  function view(k, idle, bare = false, dot0 = null) {
    const L = lay;
    const eD = easeDolly(clamp((k - 0.06) / 0.94)), eT = easeTurn(clamp(k)), eA = easeAim(clamp(k / 0.62)), eE = easeTurn(clamp((k - 0.4) / 0.6));
    const d1 = Math.sqrt((L.focal / L.R) ** 2 + 1);
    const d0 = dot0 ? Math.sqrt((L.focal / Math.max(1.5, dot0.r)) ** 2 + 1) : d1 * 60;
    const dist = Math.exp(lerp(Math.log(d0), Math.log(d1), eD));
    const drift = reduced ? 0 : idle * 0.0018;
    /* the camera is held, not mounted: a slow, small wander, more of it while it is moving fast */
    const hand = reduced || bare ? 0 : 0.0007 + 0.0035 * Math.sin(Math.PI * clamp(k)) ** 2;
    const nz = (t, a, b, c) => Math.sin(t * 0.83 + a) * 0.6 + Math.sin(t * 2.17 + b) * 0.3 + Math.sin(t * 5.3 + c) * 0.1;
    const az = lerp(FROM.az, REST.az, eT) + drift + (bare ? 0 : pointer.sx * 0.05 * k) + hand * nz(idle, 0.3, 1.7, 2.9);
    const el = lerp(FROM.el, REST.el, eE) + (bare ? 0 : -pointer.sy * 0.03 * k) + hand * nz(idle, 2.1, 0.4, 5.2);
    const roll = lerp(FROM.roll, REST.roll, eT) + hand * 1.6 * nz(idle, 4.4, 3.3, 0.8);
    const c = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
    const cam = mul(c, dist), fwd = mul(c, -1);
    let right = norm(cross(fwd, [0, 1, 0])), up = cross(right, fwd);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    [right, up] = [add(mul(right, cr), mul(up, sr)), add(mul(up, cr), mul(right, -sr))];
    const from = dot0 ? [dot0.x - W / 2, H / 2 - dot0.y] : [L.cx, L.cy];
    const shift = [lerp(from[0], L.cx, eA), lerp(from[1], L.cy, eA)];
    return { cam, fwd, right, up, shift, dist };
  }
  function draw(now, force = null) {
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
    /* what the camera's motion does to the exposure: motes streak by its velocity over a 1/60 s shutter,
       and while it rushes in, the frame blurs out from where it is going */
    const dtS = prev ? Math.max(1 / 240, (now - prev.t) / 1000) : 1;
    let vel = prev ? mul(add(v.cam, mul(prev.cam, -1)), 1 / dtS / 60) : [0, 0, 0];
    const vl = Math.hypot(...vel); if (vl > 0.4) vel = mul(vel, 0.4 / vl);
    const zoom = prev ? Math.abs(Math.log(v.dist) - Math.log(prev.dist)) / dtS : 0;
    const blur = reduced ? 0 : Math.min(12, zoom * H * 0.012) * s;
    prev = { t: now, cam: v.cam, dist: v.dist };
    w.draw({
      cam: v.cam, fwd: v.fwd, right: v.right, up: v.up,
      focal: lay.focal * s, shift: [v.shift[0] * s, v.shift[1] * s], sunPx: [sp[0] * s, sp[1] * s],
      sun: SUN, spin: tr(spin), tilt: tr(TO_TILT), sky: tr(SKY), moon: moonPos, moon2: k < 0.999 ? flyPos : [0, 0, 0, 0],
      part: force?.part ?? partAt(), dustN: force?.dustN ?? (motion ? 18 : 30),
      time: now / 1000, bg: smooth(0.02, 0.26, k), sunVis, expo: lerp(0.72, 1.0, smooth(0.35, 0.95, k)),
      vel, focusD: v.dist, blur, galK: TUNE.look.galK, dust: TUNE.look.dust, fringe: TUNE.look.fringe, grain: TUNE.look.grain, blurC: [(W / 2 + v.shift[0]) * s, (H / 2 + v.shift[1]) * s],
    });
  }
  /* the scene's resolution: the measured part while the camera rushes, rising to all of it as it slows into orbit
     (the dive's second half is slow, and the eye has time there) */
  function partAt() {
    if (!motion) return 1;
    return mq + (1 - mq) * smooth(0.45, 0.85, u);
  }
  /* before the first shot, a few frames timed at the heaviest point of the dive (the planet and the rings filling
     the frame, the dust in front): two sizes, so the fixed cost (the film, at the canvas's size) is told apart from
     the scene's, which goes with its area; the part chosen is the largest that keeps a frame inside 15 ms */
  function calibrate() {
    const w = world; if (!w || !w.baked || motion || reduced) return;
    const keep = u; u = 0.5;
    const time = (part) => { draw(performance.now(), { part, dustN: 18 }); w.finish(); const t0 = performance.now();
      for (let i = 0; i < 3; i++) draw(performance.now(), { part, dustN: 18 }); w.finish(); return (performance.now() - t0) / 3; };
    try {
      const t1 = time(0.4), t2 = time(0.8);
      const d = Math.max(0.01, (t2 - t1) / (0.64 - 0.16)), c = Math.max(0, t1 - d * 0.16);
      mq = clamp(Math.sqrt(Math.max(0, (15 - c) / d)), 0.3, 1);
      /* if even the canvas's own passes are too slow, the canvas comes down too */
      if (c > 11 && scale > 0.75) { cap = scale = Math.max(0.6, scale * Math.sqrt(11 / c)); maxScale = Math.min(maxScale, cap); w.resize(W, H, scale); }
    } finally { u = keep; prev = null; }
  }
  /* keeping the frame rate: the drawing gets smaller when the frames come slow, and back when they don't */
  function govern(dt) {
    /* while moving, the scene's part answers within a few frames; the canvas is left as it is */
    if (motion) {
      mframes.push(dt); if (mframes.length < 10) return;
      const avg = mframes.reduce((a, b) => a + b, 0) / mframes.length; mframes = [];
      if (avg > 20) mq = Math.max(0.3, mq * 0.85); else if (avg < 12) mq = Math.min(1, mq * 1.05);
      return;
    }
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
      const t = (performance.now() - motion.t0) / 1000;   /* the clock the shot was started on */
      if (motion.reverse) {
        u = clamp(motion.from * (1 - t / RETURN));
        motion.near?.(u);
        /* the planet gives itself back to the dot in the last of the shot */
        canvas.style.opacity = smooth(0.0, 0.05, u).toFixed(3);
        if (u <= 0) { const m = motion; motion = null; draw(now); m.resolve(); return; }
      } else {
        /* the hold: the door goes soft behind the dot, the dot swells and glows, and the planet comes up through it */
        canvas.style.opacity = smooth(0.55, HOLD, t).toFixed(3);
        u = clamp((t - HOLD) / APPROACH);
        if (!motion.settled && t >= HOLD + SETTLE) { motion.settled = true; motion.resolve(); }
        if (u >= 1) { motion = null; canvas.style.opacity = ""; }
      }
    }
    if (reduced && !motion && frames.length > 2) return;
    /* at rest the orbit is slow: every other frame is enough */
    if (!motion && (tick++ & 1)) return;
    draw(now);
    govern(dt);
  }
  /* where the dot is, and how big it is once it has swelled (its layout size, not its size mid-transition) */
  const SWELL = 1.5;
  const dotOf = (scene) => {
    const b = scene.body.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, r: Math.max(1.5, (scene.body.offsetWidth / 2) * SWELL) };
  };
  const onPointer = (e) => { pointer.x = (e.clientX / innerWidth) * 2 - 1; pointer.y = (e.clientY / innerHeight) * 2 - 1; };
  const onResize = () => { frames = []; size(); };

  return {
    /* the textures are baked before they are wanted, while the door is quiet */
    prepare() { const w = ensure(); if (w) { size(); w.bake().then((ok) => { if (ok) calibrate(); }); } },
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
        const dot0 = dotOf(scene);
        const ok = world && (await world.bake());
        if (!ok || reduced) { u = 1; motion = null; resolve(); return; }
        pad.classList.add("lit");
        canvas.style.opacity = "0";
        u = 0; clock = 0; frames = [];
        placeFly(dot0);
        motion = { t0: performance.now(), dot: dot0, reverse: false, resolve, settled: false };
      });
    },
    /* the shot back out to where the planet is on the door now */
    unform(scene) {
      return new Promise((resolve) => {
        if (!world || reduced || !running) { resolve(); return; }
        const dot0 = dotOf(scene);
        placeFly(dot0);
        motion = { t0: performance.now(), dot: dot0, reverse: true, from: u, resolve, near: scene.near };
      });
    },
    stop() {
      running = false; motion = null; u = 1; cancelAnimationFrame(raf); canvas.style.opacity = "";
      removeEventListener("resize", onResize); removeEventListener("pointermove", onPointer);
    },
    /* one frame at a point in the shot, for the posters (assets/img/install) and for review */
    async still(k, idle = 0, dotAt = null, moving = false) {
      ensure(); if (!world) return false;
      size(); if (!(await world.bake())) return false;
      motion = dotAt ? { dot: dotAt } : null; u = k; clock = idle;
      /* a frame of the shot in motion: the one before it, a 60th of a second earlier */
      if (moving) { const pv = view(Math.max(0, k - 1 / 60 / APPROACH), idle, false, motion?.dot || null); prev = { t: performance.now() - 1000 / 60, cam: pv.cam, dist: pv.dist }; } else prev = null;
      draw(performance.now()); motion = null;
      return true;
    },
  };
}
