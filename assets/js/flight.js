/*
 * The dawn's and the dusk's glows, rasterised once (the app's #501/#502).
 *
 * Every blurred or turbulence-filtered shape on the two flight surfaces is
 * static: nothing under a filter ever changes shape frame to frame. What
 * moves is a CSS opacity (the cone, the scattering, the sun's breath) or a
 * rigid CSS rotation (the two fans of rays), and both composite over a
 * picture exactly as they would over a live filter. WebKit re-rasterises a
 * live SVG filter on the CPU on every repaint regardless, so each group is
 * drawn once, offscreen, with its own copy of the identical filter graph,
 * and set on a plain <image> in the same 1600×1000 frame it came from.
 */
const F_B6L = '<filter id="b6l" filterUnits="userSpaceOnUse" x="-40" y="-40" width="1680" height="1080"><feGaussianBlur stdDeviation="6"/></filter>';
const F_B20L = '<filter id="b20l" filterUnits="userSpaceOnUse" x="-100" y="-100" width="1800" height="1200"><feGaussianBlur stdDeviation="20"/></filter>';
const F_RAYROUGH = '<filter id="rayrough" x="-30%" y="-30%" width="160%" height="160%"><feTurbulence type="fractalNoise" baseFrequency="0.004 0.03" numOctaves="2" seed="9" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="22"/><feGaussianBlur stdDeviation="17"/></filter>';
const G_ZOD = '<radialGradient id="zod" cx="50%" cy="88%" r="75%"><stop offset="0%" stop-color="#f6d489" stop-opacity=".13"/><stop offset="55%" stop-color="#e8b25e" stop-opacity=".045"/><stop offset="100%" stop-opacity="0"/></radialGradient>';
const G_RAYG = '<linearGradient id="rayg" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="#ffe4a8" stop-opacity=".26"/><stop offset="55%" stop-color="#f4c05a" stop-opacity=".07"/><stop offset="100%" stop-opacity="0"/></linearGradient>';

export const DAWN = {
  zod: { defs: F_B20L + G_ZOD, body: '<ellipse cx="800" cy="640" rx="300" ry="480" fill="url(#zod)" filter="url(#b20l)"/>' },
  sway1: {
    defs: F_RAYROUGH + G_RAYG,
    body: '<g fill="url(#rayg)" filter="url(#rayrough)">' +
      '<path d="M 800 924 L 736 356 L 772 362 Z"/><path d="M 800 924 L 852 528 L 892 548 Z"/><path d="M 800 924 L 508 620 L 556 588 Z"/>' +
      '<path d="M 800 924 L 1096 448 L 1052 428 Z"/><path d="M 800 924 L 320 690 L 360 646 Z" opacity=".8"/><path d="M 800 924 L 1290 670 L 1244 630 Z" opacity=".8"/></g>',
  },
  sway2: {
    defs: F_RAYROUGH + G_RAYG,
    body: '<g fill="url(#rayg)" filter="url(#rayrough)" opacity=".7">' +
      '<path d="M 800 924 L 646 404 L 680 390 Z"/><path d="M 800 924 L 962 560 L 928 544 Z"/><path d="M 800 924 L 404 610 L 448 574 Z"/><path d="M 800 924 L 1200 596 L 1156 562 Z"/></g>',
  },
  sunpt: { defs: F_B6L, body: '<circle cx="800" cy="919" r="20" fill="#fffdf6" filter="url(#b6l)"/>' },
  /* the sun's three glows, which the door drew live: eight-bit radial
     gradients with nothing to break their steps, so they rang about the sun;
     drawn here, they are dithered with the rest */
};

const F_DB6 = '<filter id="d-b6" filterUnits="userSpaceOnUse" x="-40" y="-40" width="1680" height="1080"><feGaussianBlur stdDeviation="6"/></filter>';
const F_DB14 = '<filter id="d-b14" filterUnits="userSpaceOnUse" x="-80" y="-80" width="1760" height="1160"><feGaussianBlur stdDeviation="14"/></filter>';
const F_DB24 = '<filter id="d-b24" filterUnits="userSpaceOnUse" x="-120" y="-120" width="1840" height="1240"><feGaussianBlur stdDeviation="24"/></filter>';
const G_DRIM = '<linearGradient id="d-rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f0a35a"/><stop offset="100%" stop-color="#7a2c18"/></linearGradient>';
const G_DGLOW = '<radialGradient id="d-glow" cx="50%" cy="100%" r="60%"><stop offset="0%" stop-color="#e2772b" stop-opacity=".28"/><stop offset="60%" stop-color="#7a2c18" stop-opacity=".08"/><stop offset="100%" stop-opacity="0"/></radialGradient>';
const G_DBELT = '<linearGradient id="d-belt" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#5a3a7a" stop-opacity="0"/><stop offset="50%" stop-color="#a24d6a" stop-opacity=".18"/><stop offset="100%" stop-color="#e2772b" stop-opacity="0"/></linearGradient>';

/* the sun's own glows (the door's sunrise point, 800,920): three radial gradients, as the SVG had them, but drawn by
   hand (paintSun), because a browser draws a gradient this soft in eight bits and each level is a flat ring */
export const SUN = [
  { cx: 800, cy: 922, r: 520, stops: [[0, "#e2772b", 0.3], [0.55, "#c2571f", 0.12], [1, "#000000", 0]] },
  { cx: 800, cy: 922, r: 240, stops: [[0, "#f8c95e", 0.55], [0.3, "#f4c048", 0.3], [0.6, "#f0b429", 0.1], [0.82, "#f0b429", 0.025], [1, "#f0b429", 0]] },
  { cx: 800, cy: 920, r: 86, stops: [[0, "#ffffff", 1], [0.15, "#fff6e2", 0.9], [0.3, "#ffedc2", 0.6], [0.45, "#ffe9c4", 0.34], [0.6, "#ffe4b8", 0.16], [0.75, "#ffe0b0", 0.06], [0.9, "#ffe0b0", 0.015], [1, "#ffe0b0", 0]] },
];
export const DUSK = {
  glow: { defs: F_DB24 + G_DGLOW, body: '<ellipse cx="800" cy="960" rx="900" ry="380" fill="url(#d-glow)" filter="url(#d-b24)"/>' },
  belt: { defs: F_DB24 + G_DBELT, body: '<rect x="0" y="560" width="1600" height="360" fill="url(#d-belt)" filter="url(#d-b24)"/>' },
  afterglow: {
    defs: F_DB24 + F_DB14 + F_DB6,
    body: '<circle cx="800" cy="3920" r="3080" fill="none" stroke="#7a2c18" stroke-opacity=".14" stroke-width="120" filter="url(#d-b24)"/>' +
      '<circle cx="800" cy="3920" r="3030" fill="none" stroke="#c2571f" stroke-opacity=".18" stroke-width="44" filter="url(#d-b14)"/>' +
      '<circle cx="800" cy="3920" r="3008" fill="none" stroke="#f0a35a" stroke-opacity=".28" stroke-width="10" filter="url(#d-b6)"/>',
  },
  rim: { defs: F_DB6 + G_DRIM, body: '<circle cx="800" cy="3920" r="3000" fill="none" stroke="url(#d-rim)" stroke-width="5" stroke-opacity=".3" filter="url(#d-b6)"/>' },
};

/* The heavily blurred groups carry no edge a second device pixel could
   sharpen, so they are drawn at CSS resolution; only the thin ones (the sun's
   core, the dusk's rim) are drawn at device resolution. */
/* (the sun's glows too: their core is sharp-ish, but eighty-six units wide,
   not two) */
const SOFT = new Set(["zod", "sway1", "sway2", "glow", "belt", "afterglow", "sun"]);
/* and the softest of them — nothing in them narrower than a 12-unit blur —
   at half of that, which a blur that wide cannot tell apart */
const SOFTEST = new Set(["zod", "sway1", "sway2", "glow", "belt"]);
const cache = new Map();
function decodeSvg(svg) {
  const img = new Image();
  const done = new Promise((resolve, reject) => { img.onload = () => resolve(img); img.onerror = reject; });
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return done;
}
async function rasterise(key, svg, w, h) {
  const hit = cache.get(key);
  if (hit) return hit;
  const img = await decodeSvg(svg);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  return keep(key, canvas);
}
/* encoded off the main thread where the browser allows it, so the page keeps answering while the light lands */
async function keep(key, canvas) {
  const blob = await new Promise((r) => { try { canvas.toBlob(r, "image/png"); } catch { r(null); } });
  const url = blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/png");
  cache.set(key, url);
  return url;
}
/* A gradient as soft as the sun's spans a few levels over hundreds of pixels, and eight bits draw each level as a
   flat ring; noise added to rings already drawn leaves each ring where it was. So the sun's gradients are worked
   out here in floating point, laid over one another as the SVG laid its circles, and brought down to eight bits
   with triangular noise of a level either way (the sum of two uniforms, less one) on the colour and on the alpha
   alike: the rings become grain too fine to see, and nothing is added on average. The same in every browser.
   Seeded by place, so it dithers the same way on every draw. The colour is kept as the canvas keeps it, times its
   alpha, and written back straight so the browser's own premultiplying lands on the very level chosen. Done in
   bands with a breath between each, so the page keeps answering. */
const hash = (x, y, seed) => {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
};
const tpdf = (r) => (r & 0xffff) / 0x10000 + (r >>> 16) / 0x10000 - 1;
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
async function paintSun(key, w, h) {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d"), s = w / 1600;
  const discs = SUN.map((d) => ({ ...d, stops: d.stops.map(([t, c, a]) => [t, rgb(c), a]) }));
  const rows = Math.max(1, Math.floor(6e5 / w));
  for (let y0 = 0; y0 < h; y0 += rows) {
    const n = Math.min(rows, h - y0), im = ctx.createImageData(w, n), d = im.data;
    for (let y = 0, i = 0; y < n; y++) for (let x = 0; x < w; x++, i += 4) {
      const fx = (x + 0.5) / s, fy = (y0 + y + 0.5) / s;
      let R = 0, G = 0, B = 0, A = 0;
      for (const disc of discs) {
        const t = Math.hypot(fx - disc.cx, fy - disc.cy) / disc.r;
        if (t >= 1) continue;
        const st = disc.stops; let k = 1; while (k < st.length - 1 && st[k][0] < t) k++;
        const [t0, c0, a0] = st[k - 1], [t1, c1, a1] = st[k], u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
        const a = a0 + (a1 - a0) * u;
        /* over: the SVG's own compositing of its circles, in floating point */
        R = (c0[0] + (c1[0] - c0[0]) * u) * a + R * (1 - a); G = (c0[1] + (c1[1] - c0[1]) * u) * a + G * (1 - a);
        B = (c0[2] + (c1[2] - c0[2]) * u) * a + B * (1 - a); A = a + A * (1 - a);
      }
      if (A <= 0) continue;
      const r1 = hash(x, y0 + y, 0x9e3779b9), r2 = hash(y0 + y, x, 0x7f4a7c15);
      const a8 = Math.min(255, Math.max(0, Math.round(A * 255 + tpdf(r1))));
      if (!a8) continue;
      const ta = tpdf(r2), u = 255 / a8;
      d[i] = Math.min(a8, Math.max(0, Math.round(R * 255 + ta))) * u;
      d[i + 1] = Math.min(a8, Math.max(0, Math.round(G * 255 + ta))) * u;
      d[i + 2] = Math.min(a8, Math.max(0, Math.round(B * 255 + ta))) * u;
      d[i + 3] = a8;
    }
    ctx.putImageData(im, 0, y0);
    if (y0 + rows < h) await new Promise((r) => setTimeout(r, 0));
  }
  return keep(key, canvas);
}
const frame = (defs, body, w, h) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 1600 1000"><defs>${defs}</defs>${body}</svg>`;

/* Both surfaces fill the viewport, so the slice scale is the viewport's.
   The groups are drawn one at a time with a breath between each, so the
   first light's own fade (three seconds) covers their arrival and the page
   stays answerable while they land; the result is kept per size. */
export function mountRasters(world, groups, prefix) {
  let timer, run = 0;
  /* where the sunrise point (800, 920 in the slice) falls on screen, for the
     layers that turn about it */
  const origin = () => {
    const W = world.clientWidth || innerWidth, H = world.clientHeight || innerHeight, s = Math.max(W / 1600, H / 1000);
    world.style.setProperty("--ox", `${((W - 1600 * s) / 2 + 800 * s).toFixed(1)}px`);
    world.style.setProperty("--oy", `${(H - 1000 * s + 920 * s).toFixed(1)}px`);
  };
  async function build() {
    const id = ++run;
    origin();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const base = Math.max(innerWidth / 1600, innerHeight / 1000);
    world.dataset.rasterised = "pending";
    for (const [name, group] of Object.entries(groups)) {
      const scale = base * (SOFTEST.has(name) ? 0.5 : SOFT.has(name) ? 1 : dpr);
      const w = Math.max(1, Math.round(1600 * scale)), h = Math.max(1, Math.round(1000 * scale));
      const key = `${prefix}-${name}|${w}|${h}`;
      /* the sun is painted (paintSun); the rest are drawn from their SVG */
      const url = await (group === SUN ? paintSun(key, w, h) : rasterise(key, frame(group.defs, group.body, w, h), w, h));
      if (id !== run) return;
      world.querySelector(`image[data-raster="${name}"]`)?.setAttribute("href", url);
      await new Promise((r) => setTimeout(r, 0));
      if (id !== run) return;
    }
    world.dataset.rasterised = "ready";
  }
  const start = () => { build(); addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(build, 120); }); };
  origin(); addEventListener("resize", origin);
  return { start };
}

/* ══ THE JOURNEY (the app's Flight.svelte, without the framework) ═══════
   The canvas between the dawn and the sky, and the name written once on the
   void; the door's ring stays in the door and goes as it goes. The surfaces are the host's; this only says WHEN, in the body-class
   vocabulary the app uses, and the stylesheet answers. */
import { createFlight, UP, DOWN, PROPS_UP, UPDUR, DOWNDUR, REV, SWEEP, DEEP_SKIP } from "./engine.js";

/* The sideways flights: the climb's own speed, atmosphere and traffic, with
   the vanishing point moved to one edge and every bearing turned with it. */
const turned = (deg) => PROPS_UP.map((g) => ({ ...g, ang: g.ang + deg }));
/* the docs' and the information's flights: the climb's own beats, played a second shorter */
const QUICK = UPDUR / (UPDUR - 1000);
export const RIGHT = { ...UP, rate: QUICK, vpX: 0.94, vpY: 0.5, a0: UP.a0 + 90, a1: UP.a1 + 90, props: turned(90), ending: "sweep", tint: "#8fb8ff" };
export const LEFT = { ...UP, rate: QUICK, vpX: 0.06, vpY: 0.5, a0: UP.a0 - 90, a1: UP.a1 - 90, props: turned(-90), ending: "halo", tint: "#f87171" };
/* the install's climb: the quietest of the four — the sphere and the streaks
   only, nothing passing — ending on the ring rather than the sun */
export const UP_RING = { ...UP, props: [], ending: "ring", tint: "#a78bfa" };
/* the descent that sets down on the dawn again, rather than cooling into the dusk */
export const DOWN_DAWN = { ...DOWN, palTo: undefined, duskMix: undefined };
/* the descent from a landing: that landing's own climb run backwards — its
   vanishing point, its bearings, its traffic met the other way, and its own
   ending undone first, so a ring leaves as a ring and a sweep as a sweep */
const mirrored = (props) => props.map((g) => ({ ...g, spin: -(g.spin || 0), dur: g.dur * REV * SWEEP, t0: Math.max(0, (UPDUR - (g.t0 + g.dur)) * REV) }));
/* out of the docs' galaxy it starts past its still first part (engine.js: DEEP_SKIP) */
const DEEP_SKIP_T = (DOWNDUR * DEEP_SKIP) / UPDUR;
export const descentFrom = (P) => ({ ...DOWN_DAWN, rate: P.rate ? DOWNDUR / (DOWNDUR - 1000) : undefined, vpX: P.vpX, vpY: P.vpY, a0: P.a0, a1: P.a1, ending: P.ending, chart: P.chart, tint: P.tint, props: mirrored(P.props),
  ...(P.ending === "chart" ? { skip: DEEP_SKIP_T, skipTu: DEEP_SKIP } : {}) });
/* the demo's climb: the rest of the galaxy passes — the other households in
   the sample, each with its items as bodies where its dial has them — and
   the flight lands on your own. `homes` is [{ name, bodies:[[x,y,colour,r]] }] */
export function demoFlight(homes) {
  const BEAR = [44, 136, 74, 106, 58, 122], ZED = [0.5, 0.42, 0.62, 0.46, 0.56, 0.4];
  const props = homes.map((h, i) => ({ kind: "home", name: h.name, bodies: h.bodies, t0: 760 + i * 380, dur: 2000 + (i % 3) * 350, ang: BEAR[i % BEAR.length], z: ZED[i % ZED.length], spin: 0 }));
  return { ...UP, props };
}
/* the flight to the docs, carrying the chart: out of the dawn into the galaxy, from outside it down into an arm, to
   rest among its stars with the band across the sky (voyage.js, engine.js: milkyWay), where the chart's
   constellations light; nothing else passes on the way */
export function docsFlight(chart) {
  return { ...RIGHT, vpX: 0.5, vpY: 0.44, props: [], ending: "chart", chart };
}
export { UP, DOWN };
import { ascentBeats, ascentBeatsReduced, descentBeats, descentBeatsReduced, runTimeline, D } from "./timeline.js";

const CLASSES = ["arming", "showdawn", "showwarp", "launching", "bare", "instrument", "withdrawing", "dispersing", "showdusk", "farewell"];

/* a flight played faster keeps every beat in step: those inside it scale with it, those after it come sooner by what it saved */
const quicken = (beats, dur, rate) => (rate === 1 ? beats : beats.map((b) => ({ ...b, at: b.at <= dur ? b.at / rate : b.at - (dur - dur / rate) })));

/* the journey's clock: real time, except that a stall (the page busy for a moment: a picture decoded, a shader made
   ready) is counted as no more than a frame or so. The flight and its beats both keep this time, so a stall pauses
   the journey where it is rather than skipping it ahead to the landing */
function journeyClock() {
  let t = 0, last = performance.now(), raf = 0, hold = null;
  const pending = new Map(); let ids = 0;
  /* a hold: the clock stops at a point in the journey until something it needs has come (main.js gives it what the
     flight draws), so a journey can start the moment it is chosen and still never draw before it is ready */
  const now = () => {
    const p = performance.now(); t += Math.min(64, Math.max(0, p - last)); last = p;
    if (hold && !hold.done && t > hold.at) t = hold.at;
    return t;
  };
  const poll = () => {
    raf = 0; const at = now();
    for (const [id, b] of pending) if (b.at <= at) { pending.delete(id); b.fn(); }
    if (pending.size) raf = requestAnimationFrame(poll);
  };
  return {
    now,
    schedule(fn, ms) { const id = ++ids; pending.set(id, { at: now() + ms, fn }); if (!raf) raf = requestAnimationFrame(poll); return id; },
    holdAt(ms, until) { const h = { at: now() + ms, done: false }; hold = h; const free = () => { h.done = true; }; until.then(free, free); setTimeout(free, 8000); return h; },
    cancel(id) { pending.delete(id); },
  };
}

export function createJourney({ canvas, name, dawnGlyph, duskGlyph, on = {} }) {
  const clock = journeyClock();
  const engine = createFlight(canvas, { now: clock.now });
  addEventListener("resize", () => engine.resize());
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const body = document.body;
  let cancelTimeline = () => {};

  let flight = { profile: UP, on: {} };
  const ascentStep = (act) => {
    switch (act) {
      case "arming": body.classList.add("arming"); break;
      case "warp": body.classList.add("showwarp"); engine.start(flight.profile); break;
      /* the door's ring is not lifted out of it: it goes as the door goes, as on the install's and the information's shots */
      case "mark": body.classList.remove("arming"); break;
      case "release": body.classList.remove("showdawn"); (flight.on.release ?? on.release)?.(); break;
      case "nameOn": name.classList.add("on"); break;
      case "nameOff": name.classList.remove("on"); break;
      case "land": body.classList.remove("showwarp", "launching"); body.classList.add("bare"); (flight.on.land ?? on.land)?.(); break;
      case "instrument": body.classList.remove("bare"); body.classList.add("instrument"); (flight.on.settled ?? on.settled)?.(); break;
    }
  };
  let descent = { onto: "dusk", from: null, on: {} };
  const descentStep = (act) => {
    switch (act) {
      case "withdraw": body.classList.remove("instrument"); body.classList.add("withdrawing"); break;
      case "disperse": body.classList.add("dispersing"); break;
      case "warp": body.classList.add("showwarp"); engine.start(descent.from ? descentFrom(descent.from) : descent.onto === "dawn" ? DOWN_DAWN : DOWN); break;
      case "release": body.classList.remove("withdrawing"); (descent.on.released ?? on.released)?.(); break;
      case "nameOn": name.classList.add("on"); break;
      case "nameOff": name.classList.remove("on"); break;
      case "dusk": body.classList.add(descent.onto === "dawn" ? "showdawn" : "showdusk"); (descent.on.surface ?? on.dusk)?.(); break;
      case "warpOut": body.classList.remove("showwarp"); break;
      case "farewell": body.classList.add("farewell"); (descent.on.farewell ?? on.farewell)?.(); break;
    }
  };
  function reset() {
    cancelTimeline(); cancelTimeline = () => {};
    engine.clear();
    body.classList.remove(...CLASSES);
    name.classList.remove("on");
    for (const el of [dawnGlyph(), duskGlyph()]) if (el) el.style.visibility = "";
  }
  const write = (title, subtitle) => name.replaceChildren(document.createTextNode(title), Object.assign(document.createElement("i"), { textContent: subtitle }));
  /* fly: any profile, to whichever landing `on` describes */
  function fly(profile, { title = "", subtitle = "", on: hooks = {}, ready = null } = {}) {
    cancelTimeline();
    body.classList.remove(...CLASSES, "holding");
    flight = { profile, on: hooks };
    write(title, subtitle);
    body.classList.add("showdawn", "launching");
    let beats = reduced ? ascentBeatsReduced() : quicken(ascentBeats(), UPDUR, profile.rate || 1);
    /* not yet ready: the journey still starts at once, and the clock holds just before the flight's canvas comes up
       until what it draws is ready */
    if (ready && !reduced) {
      const warp = beats.find((b) => b.act === "warp")?.at ?? 0;
      body.classList.add("holding");
      clock.holdAt(Math.max(0, warp - 10), ready.finally(() => body.classList.remove("holding")));
    }
    cancelTimeline = runTimeline(beats, ascentStep, clock);
  }
  const ascend = (o = {}) => fly(UP, o);
  function descend({ title = "", subtitle = "signing out", onto = "dusk", from = null, on: hooks = {} } = {}) {
    cancelTimeline();
    body.classList.remove("showdawn", "showdusk", "farewell", "bare", "launching");
    descent = { onto, from, on: hooks, rate: from?.rate ? DOWNDUR / (DOWNDUR - 1000) : 1 };
    write(title, subtitle);
    let beats = descentBeats();
    /* out of the docs' galaxy: under way at once. The page lets go as the flight comes up beneath it (the same sky,
       so the one becomes the other), and the flight starts past its still first part, the camera already drawing
       back; everything after comes sooner by as much */
    if (from?.ending === "chart") {
      const warp = 300, shift = D.warp - warp + DEEP_SKIP_T;
      beats = beats.map((b) => (b.act === "withdraw" ? b : b.act === "disperse" ? { ...b, at: 240 } : b.act === "warp" ? { ...b, at: warp } : { ...b, at: Math.max(warp + 60, b.at - shift) }));
    }
    cancelTimeline = runTimeline(reduced ? descentBeatsReduced() : quicken(beats, DOWNDUR, descent.rate), descentStep, clock);
  }
  return { fly, ascend, descend, reset, reduced, warm: () => engine.warm(), warmDocs: () => engine.warmDocs(), compiled: () => engine.compiled() };
}
