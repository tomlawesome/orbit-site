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
import { chore } from "./chores.js";
import { reduced } from "./sky.js";
import { createWorld, fetchWorld } from "./world.js";

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
const BASE = TUNE;
/* the hold while the camera finds the planet, the shot in, the moment the words come, the shot back out */
/* the page comes in while the camera is still settling, so the whole arrival is over by about three seconds */
const HOLD = 0.16, APPROACH = 2.7, SETTLE = 1.9, RETURN = 2.4;
/* the door's picture of the install's planet (tools/planets.py): how its pole leans in the picture, so the shot can
   start (and end) looking at the rings exactly as the picture shows them */
const SPRITE = { tiltZ: 0.38, tiltX: -0.32 };


export function createInstall(pad, opts = {}) {
  const canvas = $(".orbitgl", pad);
  /* what its chores are readying (chores.js) */
  const TAG = pad.id.replace(/pad$/, "");
  /* this world's own tuning: the install's, with whatever opts.tune changes (each part replaced or merged one level) */
  const TUNE = { ...opts.tune, ...Object.fromEntries(Object.entries(BASE).map(([k, v]) => [k, opts.tune?.[k] === undefined ? v
    : Array.isArray(v) || typeof v !== "object" ? opts.tune[k] : { ...v, ...opts.tune[k] }])) };
  let SUN, TILT, TO_TILT, SKY, REST, FROM;
  const sprite = opts.sprite === undefined ? SPRITE : opts.sprite;
  function world0() {
    SUN = norm(TUNE.sun);
    TILT = mm(rz(TUNE.tiltZ), rx(TUNE.tiltX));      /* planet frame → world */
    TO_TILT = tr(TILT);                              /* world → ring frame */
    SKY = tr(mm(rz(1.2), rx(0.6)));                   /* world → galaxy frame, until the screen is measured */
    REST = TUNE.rest; FROM = TUNE.from;
  }
  function layoutFor(W, H) {
    const t = H > W * 1.1 ? TUNE.port : TUNE.land;
    const R = t.R * H, focal = R * Math.sqrt(REST.d * REST.d - 1);
    return { focal, R, cx: t.cx * W, cy: t.cy * H, moon: [t.moon[0] * W, t.moon[1] * H], moonR: t.moonR };
  }
  let world = null, failed = false;
  let W = 0, H = 0, scale = 1, maxScale = 1, lay = null, moonPos = [0, 0, 0, 0], flyPos = [0, 0, 0, 0];
  let running = false, raf = 0, last = 0, clock = 0;
  /* the approach: u runs 0 → 1 going in, back to 0 going home */
  let u = 1, motion = null;
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  let frames = [], lastAdjust = 0, tick = 0, prev = null;
  /* how much of the canvas's resolution the scene is drawn at while the camera moves: measured before the first
     shot (calibrate), then kept to the frame rate; motion blur, the dolly's blur and the grain hide the difference */
  let mq = 0.6, mframes = [];

  function ensure() {
    if (world || failed) return world;
    try { world = createWorld(canvas, { ...opts.world, tag: TAG }); } catch (e) { console.warn(e); world = null; }
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
    maxScale = Math.max(0.5, Math.min(dpr, 2, Math.sqrt(4.6e6 / Math.max(1, W * H))));
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
  /* where the shot starts from, so the rings are seen as the door's picture shows them: its pole, leaning as it was
     drawn and turned as the picture is turned (rot, clockwise on the screen), is put where the camera sees the
     world's pole. That fixes all but the camera's turn about the pole, which is chosen to be as near the shot's own
     start as it can (and a ring looks the same from either face of its plane, so either pole will do) */
  function fromFor(rot) {
    if (!sprite || rot === null || !TILT) return null;
    const sz = Math.sin(sprite.tiltZ), cz = Math.cos(sprite.tiltZ), sx = Math.sin(sprite.tiltX), cx = Math.cos(sprite.tiltX);
    const A = [sz * cx, -cz * cx, -sx];                /* the picture's pole: x right, y down, z towards the eye */
    const c = Math.cos(rot), s = Math.sin(rot);
    const q0 = [A[0] * c - A[1] * s, -(A[0] * s + A[1] * c), A[2]];   /* turned, and y up: right, up, back */
    const P = mv(TILT, [0, 1, 0]);
    const U = norm(cross(P, Math.abs(P[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1])), V = cross(P, U);
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    let best = null;
    for (const sg of [1, -1]) {
      const q = mul(q0, sg), h = Math.sqrt(Math.max(0, 1 - q[2] * q[2])), beta = Math.atan2(q[1], q[0]);
      for (let i = 0; i < 360; i++) {
        const ps = (i / 360) * Math.PI * 2;
        const b = add(mul(P, q[2]), mul(add(mul(U, Math.cos(ps)), mul(V, Math.sin(ps))), h));
        if (Math.abs(b[1]) > 0.97) continue;
        const fwd = mul(b, -1), right = norm(cross(fwd, [0, 1, 0])), up = cross(right, fwd);
        const az = FROM.az + wrap(Math.atan2(b[0], b[2]) - FROM.az), el = Math.asin(b[1]);
        const roll = FROM.roll + wrap(Math.atan2(dot(P, up), dot(P, right)) - beta - FROM.roll);
        const cost = (az - FROM.az) ** 2 + (el - FROM.el) ** 2 + (roll - FROM.roll) ** 2;
        if (!best || cost < best.cost) best = { az, el, roll, cost };
      }
    }
    return best;
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
    /* the aim: from the dot to where the planet rests; a world may aim late (TUNE.aim: when it starts, how long it takes) */
    const AIM = TUNE.aim || [0, 0.62];
    const eD = easeDolly(clamp((k - 0.06) / 0.94)), eT = easeTurn(clamp(k)), eA = easeAim(clamp((k - AIM[0]) / AIM[1])), eE = easeTurn(clamp((k - 0.4) / 0.6));
    const d1 = Math.sqrt((L.focal / L.R) ** 2 + 1);
    const d0 = dot0 ? Math.sqrt((L.focal / Math.max(1.5, dot0.r)) ** 2 + 1) : d1 * 60;
    const dist = Math.exp(lerp(Math.log(d0), Math.log(d1), eD));
    const drift = reduced ? 0 : idle * 0.0018;
    /* the camera is held, not mounted: a slow, small wander, more of it while it is moving fast */
    const hand = reduced || bare ? 0 : 0.0007 + 0.0035 * Math.sin(Math.PI * clamp(k)) ** 2;
    const nz = (t, a, b, c) => Math.sin(t * 0.83 + a) * 0.6 + Math.sin(t * 2.17 + b) * 0.3 + Math.sin(t * 5.3 + c) * 0.1;
    const F = dot0?.from || FROM;
    const az = lerp(F.az, REST.az, eT) + drift + (bare ? 0 : pointer.sx * 0.05 * k) + hand * nz(idle, 0.3, 1.7, 2.9);
    const el = lerp(F.el, REST.el, eE) + (bare ? 0 : -pointer.sy * 0.03 * k) + hand * nz(idle, 2.1, 0.4, 5.2);
    const roll = lerp(F.roll, REST.roll, eT) + hand * 1.6 * nz(idle, 4.4, 3.3, 0.8);
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
    /* the light on the planet: at the door's planet, the door's light, turning to the world's own sun over the first
       half of the shot (and back again as the camera returns to the door) */
    let sunNow = SUN;
    if (dot0?.light) {
      const [lx, ly, lz] = dot0.light, door = norm(add(add(mul(v.right, lx), mul(v.up, -ly)), mul(v.fwd, -lz)));
      const b = smooth(0.0, 0.55, k);
      sunNow = norm(add(mul(door, 1 - b), mul(SUN, b)));
    }
    /* what the camera's motion does to the exposure: motes streak by its velocity over a 1/60 s shutter,
       and while it rushes in, the frame blurs out from where it is going */
    const dtS = prev ? Math.max(1 / 240, (now - prev.t) / 1000) : 1;
    let vel = prev ? mul(add(v.cam, mul(prev.cam, -1)), 1 / dtS / 60) : [0, 0, 0];
    const vl = Math.hypot(...vel); if (vl > 0.4) vel = mul(vel, 0.4 / vl);
    const zoom = prev ? Math.abs(Math.log(v.dist) - Math.log(prev.dist)) / dtS : 0;
    const blur = reduced ? 0 : Math.min(10, zoom * H * 0.006) * s;
    prev = { t: now, cam: v.cam, dist: v.dist };
    w.draw({
      cam: v.cam, fwd: v.fwd, right: v.right, up: v.up,
      focal: lay.focal * s, shift: [v.shift[0] * s, v.shift[1] * s], sunPx: [sp[0] * s, sp[1] * s],
      sun: sunNow, spin: tr(spin), tilt: tr(TO_TILT), sky: tr(SKY), moon: moonPos, moon2: k < 0.999 ? flyPos : [0, 0, 0, 0],
      part: force?.part ?? partAt(), dustN: force?.dustN ?? (motion ? 18 : 30),
      time: now / 1000, bg: smooth(0.02, 0.26, k), sunVis, expo: lerp(0.72, 1.0, smooth(0.35, 0.95, k)) * flare(),
      vel, focusD: v.dist, blur, galK: TUNE.look.galK, dust: TUNE.look.dust, fringe: TUNE.look.fringe, grain: TUNE.look.grain, blurC: [(W / 2 + v.shift[0]) * s, (H / 2 + v.shift[1]) * s],
    });
  }
  /* going in, the world starts as bright as the door's planet is as it flares, and settles as the camera moves:
     the flare is where the one becomes the other */
  function flare() {
    if (!motion || motion.reverse || reduced) return 1;
    return 1 + 0.55 * (1 - smooth(0.08, 0.8, motion.el || 0));
  }
  /* the scene's resolution: the measured part while the camera rushes, rising to all of it as it slows into orbit
     (the dive's second half is slow, and the eye has time there) */
  function partAt() {
    if (!motion) return 1;
    return mq + (1 - mq) * smooth(0.25, 0.7, u);
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
      mq = clamp(Math.sqrt(Math.max(0, (18 - c) / d)), 0.55, 1);
    } finally { u = keep; prev = null; }
  }
  /* keeping the frame rate: the drawing gets smaller when the frames come slow, and back when they don't */
  function govern(dt) {
    /* while moving, the scene's part answers within a few frames; the canvas is left as it is */
    if (motion) {
      mframes.push(dt); if (mframes.length < 10) return;
      const avg = mframes.reduce((a, b) => a + b, 0) / mframes.length; mframes = [];
      if (avg > 22) mq = Math.max(0.55, mq * 0.9); else if (avg < 13) mq = Math.min(1, mq * 1.05);
      return;
    }
    frames.push(dt); if (frames.length < 24) return;
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length; frames = [];
    const now = performance.now(); if (now - lastAdjust < 900) return;
    let next = scale;
    /* at rest the camera barely drifts: a slower frame shows far less than a softer picture, so it gives way late and not far */
    if (avg > 40) next = Math.max(Math.max(0.6, maxScale * 0.7), scale * 0.85);
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
      /* the shot's own clock: real time, but a stall (the page busy for a moment) counts as no more than a frame or
         so, so the shot pauses where it is rather than jumping ahead */
      motion.el = (motion.el || 0) + Math.min(dt, 50) / 1000;
      const t = motion.el;
      if (motion.reverse) {
        u = clamp(motion.from * (1 - t / RETURN));
        motion.near?.(u);
        /* the planet gives itself back to the dot in the last of the shot: the dot is already there beneath it
           (main.js brings it back just before), so the planet fades off it rather than off nothing */
        canvas.style.opacity = smooth(0.0, 0.12, u).toFixed(3);
        if (u <= 0) { const m = motion; motion = null; draw(now); m.resolve(); return; }
      } else {
        /* the hold: the door goes soft behind the dot, the dot swells and glows, and the planet comes up through it */
        /* the world comes up through the door's planet as it flares (site.css: departing), over a little longer than
           the hold, so the camera is already moving as the one gives way to the other */
        canvas.style.opacity = smooth(0.04, 0.42, t).toFixed(3);
        u = clamp((t - HOLD) / APPROACH);
        motion.near?.(u);
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
  /* going, the dot has swelled by half before the planet comes up through it; coming back, the planet ends at the
     dot's own size, so the one gives way to the other without a change. A dot set at a depth (the rich door's
     orbits) is scaled by its orbit: that is its size too */
  const SWELL = 1.5;
  const dotOf = (scene, swell = SWELL) => {
    const b = scene.body.getBoundingClientRect(), spin = scene.body.closest(".spin");
    const m = spin ? new DOMMatrixReadOnly(getComputedStyle(spin).transform === "none" ? undefined : getComputedStyle(spin).transform) : null;
    const k = m ? Math.hypot(m.a, m.b) || 1 : 1;
    /* the light the door's picture of the planet is lit by (the sunrise, below and a little behind it: its picture is
       baked lit straight down and turned towards the sun, tools/planets.py, pads.js), on the screen: x right, y down,
       z towards the eye. The dive starts in that light and turns to its own sun as the camera comes round */
    let light = null, rot = null;
    try {
      const rot = getComputedStyle(scene.body, "::before").rotate;
      if (rot && rot !== "none") {
        const v = parseFloat(rot), th = /rad/.test(rot) ? v : /turn/.test(rot) ? v * Math.PI * 2 : (v * Math.PI) / 180;
        light = norm([-Math.sin(th) * 0.94, Math.cos(th) * 0.94, -0.1]); rot = th;
      }
    } catch { /* lit by its own sun from the first */ }
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, r: Math.max(1.5, (scene.body.offsetWidth / 2) * k * swell), light, rot };
  };
  const onPointer = (e) => { pointer.x = (e.clientX / innerWidth) * 2 - 1; pointer.y = (e.clientY / innerHeight) * 2 - 1; };
  const onResize = () => { frames = []; size(); };

  return {
    /* the textures are baked before they are wanted, while the door is quiet */
    /* the textures are fetched and baked, and the frame rate measured, before the shot is wanted: resolves when done */
    prepare() {
      /* its pictures asked for now; made, baked and measured as chores (chores.js): a piece at a time, after the door
         has come up */
      if (!this.prepared) fetchWorld(opts.world);
      if (!this.prepared) this.prepared = chore(() => { const w = ensure(); if (w) size(); return w; }, 60, TAG)
        .then((w) => (w ? w.bake() : false))
        .then((ok) => (ok ? chore(() => { calibrate(); return true; }, 200, "measure") : false));
      return this.prepared;
    },
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
        const dot0 = dotOf(scene); dot0.from = fromFor(dot0.rot);
        const ok = world && (await world.bake());
        if (!ok || reduced) { u = 1; motion = null; resolve(); return; }
        pad.classList.add("lit");
        canvas.style.opacity = "0";
        u = 0; clock = 0; frames = [];
        placeFly(dot0);
        motion = { t0: performance.now(), dot: dot0, reverse: false, resolve, settled: false, near: scene.near };
      });
    },
    /* the shot back out to where the planet is on the door now */
    unform(scene) {
      return new Promise((resolve) => {
        if (!world || reduced || !running) { resolve(); return; }
        const dot0 = dotOf(scene, 1); dot0.from = fromFor(dot0.rot);
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
      motion = dotAt ? { dot: { ...dotAt, from: dotAt.from ?? fromFor(dotAt.rot ?? null) } } : null; u = k; clock = idle;
      /* a frame of the shot in motion: the one before it, a 60th of a second earlier */
      if (moving) { const pv = view(Math.max(0, k - 1 / 60 / APPROACH), idle, false, motion?.dot || null); prev = { t: performance.now() - 1000 / 60, cam: pv.cam, dist: pv.dist }; } else prev = null;
      draw(performance.now()); motion = null;
      return true;
    },
  };
}
