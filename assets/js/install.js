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
import { chore, note, noteChores, quiet, counted, COMPILES_ASIDE } from "./chores.js";
import { reduced } from "./sky.js";
import { createWorld, fetchWorld } from "./world.js";
import { onTilt } from "./tilt.js";

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
/* the door's own swell and flare (site.css: html.rich body.departing … .chosen .body, transform .24s cubic-bezier(.3,0,.2,1)
   and filter .18s ease), played inside the shot when it goes on from the world's own frame on the door (doorPlanets) */
const SWELL_T = 0.24, easeSwell = bezier(0.3, 0, 0.2, 1), FLARE_T = 0.18, easeFlare = bezier(0.25, 0.1, 0.25, 1);

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
const HOLD = 0.34, APPROACH = 2.7, SETTLE = 1.9, RETURN = 2.4, WAIT = 6000;
/* the door's picture of the install's planet (tools/planets.py): how its pole leans in the picture, so the shot can
   start (and end) looking at the rings exactly as the picture shows them */
const SPRITE = { tiltZ: 0.38, tiltX: -0.32 };


/* the install's world and the information's are one world, worn two ways (opts.world: its look): compiled, loaded
   and baked once, its canvas moved to whichever is showing */
let shared = null;
/* each world by the door's name for its planet (install, info), so the door's planets can be drawn by their own
   worlds (doorPlanets); and that loop, once started */
const worlds = new Map();
let doorLoop = null;

export function createInstall(pad, opts = {}) {
  const own = $(".orbitgl", pad), slot = document.createComment("the world's canvas");
  own.before(slot);
  let canvas = own, look = null;
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
    if (!shared) {
      let w = null;
      try { w = createWorld(own, { ...opts.world, tag: TAG }); } catch (e) { console.warn(e); }
      shared = { world: w, canvas: own, owner: null };
    }
    world = shared.world;
    if (!world) { failed = true; pad.classList.add("flat"); return null; }
    look = world.lookOf(opts.world || {});
    /* lost: whatever shot was under way is ended where it is, so the journey still arrives */
    shared.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault(); world = null; failed = true; pad.classList.add("flat");
      if (motion) { const m = motion; motion = null; canvas.style.opacity = ""; m.resolve(); }
    });
    return world;
  }
  /* the world's canvas brought here (from the other page, if it was there), and the other let go of it */
  function adopt() {
    if (!shared?.world) return;
    if (shared.owner && shared.owner !== api) shared.owner.stop();
    shared.owner = api;
    canvas = shared.canvas;
    if (canvas.previousSibling !== slot) slot.after(canvas);
    if (own !== canvas) own.hidden = true;
  }
  /* (resize false: measured only, the world's targets left at whatever the door's planets have them) */
  function size(resize = true) {
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
    /* resized mid-shot: where the door's planet is now (the door lays its orbits out again), so the shot still
       starts from it, or still comes back to it */
    if (motion?.scene) { const d = dotOf(motion.scene, motion.reverse || motion.cont ? 1 : SWELL); d.from = fromFor(d.rot); motion.dot = d; }
    placeFly(motion?.dot || null);
    /* the galaxy turned so its core and its band fall where they are wanted on this screen at rest */
    const at = (f) => { const px = f[0] * W - W / 2, py = H / 2 - f[1] * H; return norm(add(v.fwd, add(mul(v.right, (px - v.shift[0]) / lay.focal), mul(v.up, (py - v.shift[1]) / lay.focal)))); };
    const core = at(TUNE.sky.core), n = norm(cross(core, at(TUNE.sky.along))), x = cross(n, core);
    SKY = [...x, ...n, ...core];
    if (resize) world?.resize(W, H, scale);
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
    /* the dot's size, and its swell while the shot goes on from the door's own frame (g: 1 → SWELL, as the picture swelled) */
    const d0 = dot0 ? Math.sqrt((L.focal / Math.max(1.5, dot0.r * (dot0.g || 1))) ** 2 + 1) : d1 * 60;
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
  /* reg: the frame cut down to a square round the door's planet (doorPlanets): the shot at k = 0 from reg.dot, at
     density reg.d, the square S pixels a side starting at reg.o (pixels from the left and the foot of the screen's
     frame, T): everything given in the screen's pixels is moved by where the square starts, so each pixel of it is
     the pixel the screen's frame would have there */
  function draw(now, force = null, reg = null) {
    const w = world; if (!w || !lay) return;
    const idle = clock;
    const k = reg ? 0 : u;
    const dot0 = reg ? reg.dot : motion?.dot || null;
    const v = view(k, idle, false, dot0);
    const s = reg ? reg.d : scale;
    const at = reg ? (x, i) => x - reg.o[i] : (x) => x;
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
    /* the swell (the dot's g) stands for the door's picture swelling, not for the camera moving: it neither streaks
       the motes nor blurs the frame (the camera's distance goes as 1 / g while it swells) */
    const g = dot0?.g || 1, pg = prev?.g || 1;
    const dtS = prev ? Math.max(1 / 240, (now - prev.t) / 1000) : 1;
    let vel = prev ? mul(add(v.cam, mul(prev.cam, -pg / g)), 1 / dtS / 60) : [0, 0, 0];
    const vl = Math.hypot(...vel); if (vl > 0.4) vel = mul(vel, 0.4 / vl);
    const zoom = prev ? Math.abs(Math.log(v.dist * g) - Math.log(prev.dist * pg)) / dtS : 0;
    const blur = reduced ? 0 : Math.min(10, zoom * H * 0.006) * s;
    prev = { t: now, cam: v.cam, dist: v.dist, g };
    w.draw({
      cam: v.cam, fwd: v.fwd, right: v.right, up: v.up,
      focal: lay.focal * s, sunPx: [at(sp[0] * s, 0), at(sp[1] * s, 1)],
      shift: reg ? [reg.T[0] / 2 + v.shift[0] * s - reg.o[0] - reg.S / 2, reg.T[1] / 2 + v.shift[1] * s - reg.o[1] - reg.S / 2] : [v.shift[0] * s, v.shift[1] * s],
      look, sun: sunNow, spin: tr(spin), tilt: tr(TO_TILT), sky: tr(SKY), moon: moonPos, moon2: k < 0.999 ? flyPos : [0, 0, 0, 0],
      part: force?.part ?? partAt(), dustN: force?.dustN ?? (motion ? 18 : 30),
      time: now / 1000, bg: smooth(0.02, 0.26, k), sunVis, expo: lerp(0.72, 1.0, smooth(0.35, 0.95, k)) * flare(),
      vel, focusD: v.dist, blur, galK: TUNE.look.galK, dust: TUNE.look.dust, fringe: TUNE.look.fringe, grain: TUNE.look.grain, blurC: [at((W / 2 + v.shift[0]) * s, 0), at((H / 2 + v.shift[1]) * s, 1)],
    });
  }
  /* going in, the world starts as bright as the door's planet is as it flares, and settles as the camera moves:
     the flare is where the one becomes the other */
  function flare() {
    if (!motion || motion.reverse || reduced) return 1;
    /* going on from the world's own frame on the door, the flare rises from nothing as the picture's did */
    const rise = motion.cont ? easeFlare(clamp(((motion.el || 0) - (motion.el0 ?? 0)) / FLARE_T)) : 1;
    return 1 + 0.55 * rise * (1 - smooth(0.08, 0.8, motion.el || 0));
  }
  /* the scene's resolution: the measured part while the camera rushes, rising to all of it as it slows into orbit
     (the dive's second half is slow, and the eye has time there) */
  function partAt() {
    if (!motion) return 1;
    const p = mq + (1 - mq) * smooth(0.25, 0.7, u);
    /* going on from the door (or back to it), the frame at the planet is drawn as the door's planets are (doorPlanets:
       its scale), and gives way to the measured part as the camera moves */
    return motion.cont ? lerp(doorLoop?.rs ?? 1, p, smooth(0, 0.1, u)) : p;
  }
  /* before the first shot, a few frames timed at the heaviest point of the dive (the planet and the rings filling
     the frame, the dust in front): two sizes, so the fixed cost (the film, at the canvas's size) is told apart from
     the scene's, which goes with its area; the part chosen is the largest that keeps a frame inside 15 ms */
  function calibrate() {
    const w = world; if (!w || !w.baked || motion || reduced || shared?.owner?.busy) return;
    const keep = u; u = 0.5;
    const time = (part) => { draw(performance.now(), { part, dustN: 18 }); w.finish(); const t0 = performance.now();
      for (let i = 0; i < 3; i++) draw(performance.now(), { part, dustN: 18 }); w.finish(); return (performance.now() - t0) / 3; };
    try {
      const t1 = time(0.4), t2 = time(0.8);
      const d = Math.max(0.01, (t2 - t1) / (0.64 - 0.16)), c = Math.max(0, t1 - d * 0.16);
      mq = clamp(Math.sqrt(Math.max(0, (18 - c) / d)), 0.55, 1);
    } finally { u = keep; prev = null; }
  }
  /* the world drawn once, unseen, as soon as it is ready: a driver finishes a shader on its first draw, and that
     first draw would otherwise be the dive's first frame, stalling it just as the door's planet gives way to it */
  function touch() {
    const w = world; if (!w || !w.baked || motion || reduced || shared?.touched || shared?.owner?.busy) return;
    shared.touched = true;
    const keep = u; u = 0.4;
    try { draw(performance.now(), { part: mq, dustN: 18 }); draw(performance.now(), { part: 1, dustN: 30 }); w.finish(); } finally { u = keep; prev = null; }
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
  /* the first second of a dive, counted: how the hand-over from the door went (the console says) */
  /* and its click, timed: the world's resize to the screen (sized: start) and the shot's first draw, so a stall there
     can be told from one later on (each the page's own time to ask for it; the GPU's share is not waited for) */
  let stat = null, sized = 0;
  function frame(now) {
    if (!running) return;
    if (stat && !stat.done) { stat.n++; stat.worst = Math.max(stat.worst, last ? now - last : 0); if (now - stat.t0 >= 1000) { stat.done = true; note(`${TAG}: first second ${stat.n} frames, worst ${Math.round(stat.worst)} ms`); } }
    /* a world that could not be made or loaded draws nothing: no loop for it */
    if (failed || pad.classList.contains("flat")) { running = false; return; }
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(100, now - last) : 16; last = now;
    let handing = false;
    if (pad.hidden || document.hidden || !world || !world.baked) return;
    /* the shot's last frame, kept on screen while the door's loop takes the planet back (doorPlanets: back) */
    if (motion?.held) return;
    clock += dt / 1000;
    pointer.sx += (pointer.x - pointer.sx) * Math.min(1, dt / 900);
    pointer.sy += (pointer.y - pointer.sy) * Math.min(1, dt / 900);
    if (motion) {
      /* the shot's own clock: real time, but a stall (the page busy for a moment) counts as no more than a frame or
         so, so the shot pauses where it is rather than jumping ahead */
      motion.el = (motion.el || 0) + Math.min(dt, 50) / 1000;
      const t = motion.el;
      /* going on from the door, the planet swells inside the shot as the door's picture of it would have, timed from
         the shot's first frame (el0), so that frame is the door's own */
      if (motion.cont && !motion.reverse) { motion.el0 ??= t; motion.dot.g = lerp(1, SWELL, easeSwell(clamp((t - motion.el0) / SWELL_T))); }
      if (motion.reverse) {
        /* going back to the world's own frame on the door, the shot ends where the planet is when it ends, not where
           it was when it began (the orbit is stopped for it a frame late: pads.js) */
        if (motion.cont) { const d = dotOf(motion.scene, 1); d.from = fromFor(d.rot); motion.dot = d; placeFly(d); }
        u = clamp(motion.from * (1 - t / RETURN));
        motion.near?.(u);
        /* the planet gives itself back to the dot in the last of the shot: the dot is already there beneath it
           (main.js brings it back just before), so the planet fades off it rather than off nothing. Going back to
           the world's own frame on the door, nothing fades: the last frame is held until the door's loop has drawn
           the same frame in its place (doorPlanets: back), and the two change over between one paint and the next */
        if (!motion.cont) canvas.style.opacity = smooth(0.0, 0.12, u).toFixed(3);
        if (u <= 0) {
          const m = motion;
          if (m.cont && doorLoop) { draw(now); m.held = true; doorLoop.back(now, () => { if (motion === m) motion = null; m.resolve(); }); return; }
          motion = null; draw(now); m.resolve(); return;
        }
      } else {
        /* the hold: the door goes soft behind the dot, the dot swells and glows, and the planet comes up through it */
        /* the world comes up through the door's planet as it flares (site.css: departing), the two the same picture
           (the same rings, the same light, the same size), and the camera holds still until the door's has gone, so
           nothing differs while both are seen: then it moves */
        /* going on from the world's own frame on the door, the canvas is shown whole on its first frame (below) */
        if (!motion.cont) canvas.style.opacity = smooth(0.02, 0.26, t).toFixed(3);
        else if (!motion.shown) motion.shown = handing = true;
        u = clamp((t - HOLD) / APPROACH);
        motion.near?.(u);
        if (!motion.settled && t >= HOLD + SETTLE) { motion.settled = true; motion.resolve(); }
        if (u >= 1) { motion = null; canvas.style.opacity = ""; }
      }
    }
    if (reduced && !motion && frames.length > 2) return;
    /* at rest the orbit is slow (the planet turns a pixel or two a second): a frame in four is enough, unless the
       camera is following the pointer or the tilt; the GPU rests in between */
    const following = Math.abs(pointer.x - pointer.sx) + Math.abs(pointer.y - pointer.sy) > 0.002;
    if (!motion && !following && (tick++ & 3)) return;
    if (stat && stat.first == null && motion && !motion.reverse) {
      const t0 = performance.now(); draw(now); stat.first = performance.now() - t0;
      note(`${TAG}: dive began: resize ${sized.toFixed(1)} ms, first frame ${stat.first.toFixed(1)} ms`);
    } else draw(now);
    /* the shot's first frame is up, the same as the door's last: only now does the door's own canvas go */
    if (handing) { canvas.style.opacity = "1"; doorLoop?.release(TAG); }
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
      const css = getComputedStyle(scene.body, "::before").rotate;
      if (css && css !== "none") {
        const v = parseFloat(css), th = /rad/.test(css) ? v : /turn/.test(css) ? v * Math.PI * 2 : (v * Math.PI) / 180;
        light = norm([-Math.sin(th) * 0.94, Math.cos(th) * 0.94, -0.1]); rot = th;
      }
    } catch { /* lit by its own sun from the first */ }
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, r: Math.max(1.5, (scene.body.offsetWidth / 2) * k * swell), light, rot, k };
  };
  /* the camera leans with the pointer; on a phone, with the phone's tilt (tilt.js), which then has it alone */
  let tilting = false, untilt = () => {};
  const onPointer = (e) => { if (tilting && e.pointerType !== "mouse") return; pointer.x = (e.clientX / innerWidth) * 2 - 1; pointer.y = (e.clientY / innerHeight) * 2 - 1; };
  const onTilted = (x, y) => { tilting = true; pointer.x = x; pointer.y = y; };
  /* resized once a frame at most (a phone's address bar comes and goes in bursts of them; each one re-makes the
     world's targets) */
  let sizing = 0;
  const onResize = () => { if (!sizing) sizing = requestAnimationFrame(() => { sizing = 0; frames = []; size(); }); };

  const api = {
    /* drawing the world now (the other page must not draw into it meanwhile) */
    get busy() { return running; },
    /* the textures are baked before they are wanted, while the door is quiet */
    /* the textures are fetched and baked, and the frame rate measured, before the shot is wanted: resolves when done */
    prepare() {
      /* its pictures asked for, and its shaders set compiling, at once: both go on away from the page (the browser
         compiles in the background), so they have all of the first light and the door to be done in, and the
         compiling is what takes longest on a first visit. What then touches the GPU (the pictures put on it, the
         measure) waits its turn as chores (chores.js), once the door's painted reveal is over. Where the browser
         compiles on the page's own thread (COMPILES_ASIDE false), making the world is itself a chore ("compile",
         queued at once and run under the first light's ring, which main.js holds until it is done; hurried with
         this journey's own). The time the compiles took is said (world.js: compileMs) */
      if (!this.prepared) {
        fetchWorld(opts.world);
        const make = () => { const w = ensure(); if (w) size(); return w; };
        const made = (COMPILES_ASIDE ? Promise.resolve(make()) : chore(make, 20, ["compile", TAG])).catch(() => null);
        made.then((w) => w?.made.then((ok) => note(`${TAG}: shaders ${ok ? `compiled in ${Math.round(w.compileMs)} ms${counted("world")}` : "failed"}`)));
        this.compiled = made.then((w) => (w ? w.made : false));
        /* baked: the world can be dived into (the way in opens on this, main.js); prepared: and measured too */
        this.baked = made.then((w) => (w ? w.bake() : false));
        this.prepared = this.baked
          .then((ok) => {
            note(`${TAG}: ready`); noteChores(`${TAG} ready`);
            if (ok) chore(touch, 60, TAG);
            return ok ? chore(() => { calibrate(); return true; }, 200, "measure") : false;
          });
      }
      return this.prepared;
    },
    start() {
      const w = ensure();
      adopt();
      if (running) return;
      running = true; last = 0;
      const t0 = performance.now(); size(); sized = performance.now() - t0;
      addEventListener("resize", onResize); addEventListener("pointermove", onPointer); untilt = onTilt(onTilted);
      if (w) w.bake().then((ok) => pad.classList.add(ok ? "lit" : "flat"));
      cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    },
    /* the shot in from the door's planet: resolves when the camera has all but settled */
    form(scene) {
      stat = { t0: performance.now(), n: 0, worst: 0, done: false, first: null }; sized = 0;
      return new Promise(async (resolve) => {
        /* the planet on the door is this world's own frame (doorPlanets): the shot goes on from it, the same clock,
           the same pose at its orbital size, swelling inside the shot; otherwise from the door's picture, swelled */
        const cont = !!doorLoop?.has(TAG);
        this.start();
        const dot0 = dotOf(scene, cont ? 1 : SWELL); dot0.from = fromFor(dot0.rot);
        /* the world is waited for, but never long: past WAIT (a first visit on a slow line or a slow machine) the page
           comes as it is, over its poster, and the world fades in under the words when it is ready (start: lit) */
        const ok = world && (await Promise.race([world.bake(), new Promise((r) => setTimeout(() => r(false), WAIT))]));
        if (!ok || reduced) { u = 1; motion = null; if (cont) doorLoop.release(TAG); resolve(); return; }
        pad.classList.add("lit");
        canvas.style.opacity = "0";
        u = 0; frames = [];
        if (!cont) clock = 0;
        placeFly(dot0);
        motion = { t0: performance.now(), dot: dot0, reverse: false, resolve, settled: false, near: scene.near, scene, cont };
      });
    },
    /* the shot back out to where the planet is on the door now */
    unform(scene) {
      return new Promise((resolve) => {
        /* no shot without a world drawn and ready (still loading, or lost): the page simply goes */
        if (!world || !world.baked || reduced || !running) { resolve(); return; }
        const dot0 = dotOf(scene, 1); dot0.from = fromFor(dot0.rot);
        placeFly(dot0);
        /* back to the world's own frame on the door (doorPlanets), if it is drawing it */
        const cont = !!doorLoop?.has(TAG);
        motion = { t0: performance.now(), dot: dot0, reverse: true, from: u, resolve, near: scene.near, scene, cont };
      });
    },
    stop() {
      running = false; motion = null; u = 1; cancelAnimationFrame(raf); canvas.style.opacity = "";
      removeEventListener("resize", onResize); removeEventListener("pointermove", onPointer); untilt(); untilt = () => {};
      /* the world is free again: the door's planets may be drawn by it */
      doorLoop?.wake();
    },
    /* the door's planets drawn by their own worlds while the door is shown (?door3d): resolves once it is under way */
    doorPlanets(door) { return startDoor(door, mine); },
    /* one frame at a point in the shot, for the posters (assets/img/install) and for review */
    async still(k, idle = 0, dotAt = null, moving = false) {
      ensure(); if (!world) return false;
      adopt(); size(); if (!(await world.bake())) return false;
      motion = dotAt ? { dot: { ...dotAt, from: dotAt.from ?? fromFor(dotAt.rot ?? null) } } : null; u = k; clock = idle;
      /* a frame of the shot in motion: the one before it, a 60th of a second earlier */
      if (moving) { const pv = view(Math.max(0, k - 1 / 60 / APPROACH), idle, false, motion?.dot || null); prev = { t: performance.now() - 1000 / 60, cam: pv.cam, dist: pv.dist }; } else prev = null;
      draw(performance.now()); motion = null;
      return true;
    },
  };
  /* this world's planet on the door (doorPlanets): the shot's first frame, k = 0 from the planet's pose at its orbital
     size, drawn not to the screen but into a square round it (side css px at density d: the screen's frame, cut
     down), so the dive can go on from it */
  const mine = {
    api, tag: TAG,
    ok: () => !!world && !failed && world.baked,
    canvas: () => shared?.canvas,
    scale: () => scale,
    /* the world's targets made for the door's square (side css px at density d) before its loop first draws it, and
       for the screen again (full) if the square has had to change: the world keeps both (world.js: resize), so the
       loop's first frame and a dive's first both find theirs made */
    fit(side, d) { world?.resize(side, side, d); },
    full() { if (!running && world) size(); },
    /* the clock runs while the door is shown: the planet turns, its weather moves */
    advance(dt) { clock += dt / 1000; },
    dot(scene) {
      /* measured again if the window has changed while the door was shown (the world's targets are left alone) */
      if (!lay || (!running && (W !== (pad.clientWidth || innerWidth) || H !== (pad.clientHeight || innerHeight)))) size(false);
      const d = dotOf(scene, 1); d.from = fromFor(d.rot);
      return d;
    },
    draw(now, dot, side, d) {
      world.resize(side, side, d);
      /* the screen's frame at this density (T), where the planet falls in it (P: from the left and the foot), and the
         square round it, started on a whole pixel so the two frames' pixels are the same pixels */
      const S = Math.max(1, Math.round(side * d)), T = [Math.max(1, Math.round(W * d)), Math.max(1, Math.round(H * d))];
      const P = [T[0] / 2 + (dot.x - W / 2) * d, T[1] / 2 + (H / 2 - dot.y) * d];
      const o = [Math.round(P[0] - S / 2), Math.round(P[1] - S / 2)];
      placeFly(dot);
      draw(now, { part: 1, dustN: 18 }, { dot, d, o, S, T });
      /* where the square is on the screen, in css px */
      return { S, x: (o[0] * W) / T[0], y: ((T[1] - o[1] - S) * H) / T[1], w: (S * W) / T[0] };
    },
  };
  worlds.set(TAG, mine);
  return api;
}

/* THE DOOR'S PLANETS, BY THEIR OWN WORLDS (?door3d): the install's and the information's planets drawn on the door by
   the world each dives into, so a dive is the same renderer going on from what is already on screen, and the return
   ends on the very frame the door then goes on drawing. Every frame while the door is shown (and no journey is under
   way, and the world is not drawing a page): for each planet, the shot's first frame (k = 0, the planet's pose at its
   orbital size, its own world's look) drawn into a square five times its radius round it, and copied into a small
   canvas of its own at that place on the door, behind the ring or before it as its anchor goes. planets3d.js draws
   them until the first of these frames (html[data-worldplanets]), and the docs' moon all along */
function startDoor(door, lead) {
  if (doorLoop) return doorLoop.ready;
  const root = document.documentElement, body = document.body;
  const lockup = door?.querySelector(".lockup"), box = door?.querySelector(".planets");
  /* the plain door's planets are turned about the ring, not placed on it (planets3d.js likewise) */
  if (!lockup || !box || !root.classList.contains("rich")) return null;
  const since = performance.now();
  const list = [...worlds.values()].filter((w) => w.api.prepared).map((w) => {
    const a = door.querySelector(`.planet[data-section="${w.tag}"]`);
    if (!a) return null;
    const c = document.createElement("canvas");
    c.className = "worldplanet away"; c.setAttribute("aria-hidden", "true");
    return { w, a, spin: a.querySelector(".spin"), scene: { planet: a, body: a.querySelector(".body") }, c, ctx: c.getContext("2d") };
  }).filter((p) => p && p.ctx && p.scene.body && p.spin);
  if (!list.length) return null;

  let raf = 0, started = false, live = false, failed = false, last = 0, hook = null;
  /* the square's side, device px, shared by both (the larger), changed only when it is a tenth out; the scale the
     world draws it at, halved once if the two take more than 8 ms a frame (over 30 frames, timed only once the chores
     are at rest, quiet: a compile or an upload beside them is not their time, and halved them for nothing in Firefox;
     timed again if a chore ran meanwhile) */
  let side = 0, rs = 1, n = 0, spent = 0, calm = null, asked = false, timed = false;
  const time = () => { asked = true; n = 0; spent = 0; calm = null; quiet().then((c) => { calm = c; }); };
  const busy = () => [...worlds.values()].some((w) => w.api.busy);
  /* as planets3d.js: not while the door is not seen, and not once a journey begins */
  const shown = () => !document.hidden && !door.hidden && !/\b(launching|departing|showwarp)\b/.test(body.className) && getComputedStyle(door).opacity !== "0";
  /* stopped, each canvas is let go (site.css: worldplanet.away) so nothing stale is shown when the door comes back;
     the planet a dive goes to is held as it is until the shot's first frame is up over it (release) */
  const away = () => {
    const diving = /\bdeparting\b/.test(body.className);
    for (const p of list) {
      if (p.c.classList.contains("away")) continue;
      p.c.classList.add("away");
      if (diving && p.a.classList.contains("chosen")) p.c.classList.add("held");
    }
  };
  function paint(now, dt) {
    const dpr = devicePixelRatio || 1, at = [];
    for (const p of list) { if (!p.w.ok()) continue; p.w.advance(dt); at.push([p, p.w.dot(p.scene)]); }
    if (!at.length) throw new Error("no world to draw them");
    const want = clamp(Math.max(...at.map(([, d]) => 5 * d.r * dpr)), 48, 1024);
    if (!side || Math.abs(want - side) > side * 0.1) side = want;
    const d = lead.scale() * rs, L = lockup.getBoundingClientRect(), src = lead.canvas();
    const t0 = performance.now();
    for (const [p, dot] of at) {
      const r = p.w.draw(now, dot, side / dpr, d);
      if (p.c.width !== r.S || p.c.height !== r.S) { p.c.width = r.S; p.c.height = r.S; } else p.ctx.clearRect(0, 0, r.S, r.S);
      p.ctx.drawImage(src, 0, 0);
      const st = p.c.style;
      st.left = `${r.x - L.left}px`; st.top = `${r.y - L.top}px`; st.width = st.height = `${r.w}px`;
      /* on the side its anchor is (its .spin's z-index, pads.js: held while the world overlaps the ring's stroke), as
         planets3d.js draws */
      p.c.classList.toggle("near", getComputedStyle(p.spin).zIndex === "5");
    }
    const ms = performance.now() - t0;
    for (const p of list) p.c.classList.remove("away", "held");
    if (!live) {
      live = true;
      root.dataset.worldplanets = list.map((p) => p.w.tag).join(" ");
      note("install: door planets live", since);
    }
    if (!timed && !asked) time();
    else if (!timed && calm && dt) {
      spent += ms;
      /* the 30th: kept only if no chore ran in the window, else timed again from the next quiet */
      if (++n === 30 && !calm()) time();
      else if (n === 30) {
        timed = true;
        const avg = spent / 30;
        /* (the square at half scale is a new size, and the world lets the screen's targets go for it: they are made
           again now, between frames, not at the click) */
        if (avg > 8) { rs = 0.5; chore(() => lead.full(), 60, lead.tag); }
        note(`install: door planets ${avg.toFixed(1)} ms a frame${rs < 1 ? ", so drawn at half scale" : ""}`);
      }
    }
  }
  function tick(now) {
    raf = 0;
    if (failed || !started) return;
    if (!shown() || busy()) { away(); return; }
    raf = requestAnimationFrame(tick);
    /* the door's own reveal brings the planets all the way in first */
    if (!live && getComputedStyle(box).opacity !== "1") return;
    const dt = last ? Math.min(100, now - last) : 16; last = now;
    try { paint(now, dt); } catch (e) { fail(e); }
  }
  const wake = () => { if (!raf && started && !failed) { last = 0; raf = requestAnimationFrame(tick); } };
  function fail(e) {
    failed = true;
    console.warn("orbit: the door's planets stay planets3d's", e);
    for (const p of list) p.c.remove();
    delete root.dataset.worldplanets;
  }
  const watch = () => { if (started && !failed && (!shown() || busy())) away(); wake(); };
  new MutationObserver(watch).observe(body, { attributes: true, attributeFilter: ["class"] });
  new MutationObserver(watch).observe(door, { attributes: true, attributeFilter: ["class", "hidden"] });
  document.addEventListener("visibilitychange", watch);
  addEventListener("resize", wake);

  /* the worlds baked and measured first (prepare: the measure draws at the screen's size, so it is not to be met by a
     square); planets3d.js's spheres stand in until then */
  /* and the world's targets made for the square before the loop's first frame (fit), as a chore between frames, so the
     world holds both the square's and the screen's (made at prepare, drawn once by touch) from then on */
  const fit = () => {
    if (!shown()) return;
    const dpr = devicePixelRatio || 1, at = list.filter((p) => p.w.ok()).map((p) => p.w.dot(p.scene));
    if (!at.length) return;
    side = clamp(Math.max(...at.map((d) => 5 * d.r * dpr)), 48, 1024);
    lead.fit(side / dpr, lead.scale() * rs);
  };
  const ready = Promise.all(list.map((p) => p.w.api.prepared)).then((oks) => {
    if (!oks.every(Boolean)) throw new Error("a world could not be made");
    return chore(fit, 60, lead.tag).catch(() => { /* the loop's first frame makes them */ });
  }).then(() => {
    for (const p of list) lockup.append(p.c);
    started = true; wake();
  }).catch(fail);
  doorLoop = {
    ready,
    get rs() { return rs; },
    has: (tag) => live && !failed && list.some((p) => p.w.tag === tag && p.w.ok()),
    /* the shot's first frame is up: the planet's canvas goes as the rest did (site.css: departing) */
    release(tag) { list.find((p) => p.w.tag === tag)?.c.classList.remove("held"); },
    /* the shot back has drawn its last frame: the door draws the same one (same dot, clock and look, the same moment)
       and shows it, and only then is the shot let go (done), all before the next paint */
    back(now, done) {
      const go = () => { try { if (!failed) paint(now, 0); } catch (e) { fail(e); } done(); wake(); };
      const h = hook; hook = null;
      let wait = null;
      try { wait = h?.(); } catch { /* the test's own */ }
      if (wait?.then) wait.then(go, go); else go();
    },
    wake,
  };
  /* for the test only: called when a shot back has drawn its last frame, before the door draws its first; the door
     waits for what it returns */
  if (/[?&]door3d\b/.test(location.search)) window.__doorPlanets = { onReturn(cb) { hook = cb; } };
  return ready;
}
