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
};

const F_DB6 = '<filter id="d-b6" filterUnits="userSpaceOnUse" x="-40" y="-40" width="1680" height="1080"><feGaussianBlur stdDeviation="6"/></filter>';
const F_DB14 = '<filter id="d-b14" filterUnits="userSpaceOnUse" x="-80" y="-80" width="1760" height="1160"><feGaussianBlur stdDeviation="14"/></filter>';
const F_DB24 = '<filter id="d-b24" filterUnits="userSpaceOnUse" x="-120" y="-120" width="1840" height="1240"><feGaussianBlur stdDeviation="24"/></filter>';
const G_DRIM = '<linearGradient id="d-rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f0a35a"/><stop offset="100%" stop-color="#7a2c18"/></linearGradient>';
const G_DGLOW = '<radialGradient id="d-glow" cx="50%" cy="100%" r="60%"><stop offset="0%" stop-color="#e2772b" stop-opacity=".28"/><stop offset="60%" stop-color="#7a2c18" stop-opacity=".08"/><stop offset="100%" stop-opacity="0"/></radialGradient>';
const G_DBELT = '<linearGradient id="d-belt" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#5a3a7a" stop-opacity="0"/><stop offset="50%" stop-color="#a24d6a" stop-opacity=".18"/><stop offset="100%" stop-color="#e2772b" stop-opacity="0"/></linearGradient>';

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
const SOFT = new Set(["zod", "sway1", "sway2", "glow", "belt", "afterglow"]);
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
  /* encoded off the main thread where the browser allows it, so the page
     keeps answering while the light lands */
  const blob = await new Promise((r) => { try { canvas.toBlob(r, "image/png"); } catch { r(null); } });
  const url = blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/png");
  cache.set(key, url);
  return url;
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
    for (const [name, { defs, body }] of Object.entries(groups)) {
      const scale = base * (SOFTEST.has(name) ? 0.5 : SOFT.has(name) ? 1 : dpr);
      const w = Math.max(1, Math.round(1600 * scale)), h = Math.max(1, Math.round(1000 * scale));
      const url = await rasterise(`${prefix}-${name}|${w}|${h}`, frame(defs, body, w, h), w, h);
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
   The canvas between the dawn and the sky, the mark that leaves the lockup
   and rides to the centre of the screen, and the name written once on the
   void. The surfaces are the host's; this only says WHEN, in the body-class
   vocabulary the app uses, and the stylesheet answers. */
import { createFlight, UP, DOWN, PROPS_UP, UPDUR, DOWNDUR, REV, SWEEP, FAR_T0, FAR_T1, DEEP_SKIP, deepGrowth, deepTilt } from "./engine.js";

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
import { ascentBeats, ascentBeatsReduced, descentBeats, descentBeatsReduced, runTimeline, MARK_ARRIVE, MARK_RIDE_UP, MARK_RIDE_DOWN, T, D } from "./timeline.js";

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

export function createJourney({ canvas, mark, name, dawnGlyph, duskGlyph, on = {} }) {
  const clock = journeyClock();
  const engine = createFlight(canvas, { now: clock.now });
  addEventListener("resize", () => engine.resize());
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const body = document.body;
  let cancelTimeline = () => {};

  function flip(from, toLeft, toTop, toWidth, toHeight, ms) {
    const dx = (from.left + from.width / 2) - (toLeft + toWidth / 2);
    const dy = (from.top + from.height / 2) - (toTop + toHeight / 2);
    const sx = from.width / toWidth, sy = from.height / toHeight;
    mark.style.transition = "opacity .4s ease";
    mark.animate([{ transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` }, { transform: "none" }],
      { duration: ms, easing: "cubic-bezier(.35,0,.2,1)", fill: "none" });
  }
  function liftMark(srcSvg, toY, size, ms) {
    if (!srcSvg) return;
    const r = srcSvg.getBoundingClientRect();
    const left = innerWidth / 2 - size / 2, top = toY - size / 2;
    mark.style.transition = "none";
    mark.style.left = `${r.left}px`; mark.style.top = `${r.top}px`; mark.style.width = `${r.width}px`; mark.style.height = `${r.height}px`;
    mark.classList.remove("collapse", "dissolve"); mark.classList.add("on");
    srcSvg.style.visibility = "hidden";
    mark.style.left = `${left}px`; mark.style.top = `${top}px`; mark.style.width = `${size}px`; mark.style.height = `${size}px`;
    flip(r, left, top, size, size, ms);
  }
  /* the docs' flight: the mark is not gathered up, it becomes the galaxy. Face on, as the galaxy is first seen, its
     ring grows with the galaxy, exactly (engine.js: deepGrowth), and tilts with it as the camera swings down across
     the disc (deepTilt), its rim as the camera rushes in, and thins away as it goes past the frame; its gold planet
     glides to the centre and gives itself to the galaxy's core */
  const tiltAt = (tu) => `rotateX(${((deepTilt(tu) * 180) / Math.PI).toFixed(2)}deg)`;
  function dissolveMark() {
    for (const el of [dawnGlyph(), duskGlyph()]) if (el) el.style.visibility = "";
    const svg = mark.querySelector("svg"), [ring, , gold] = svg ? svg.querySelectorAll("circle") : [];
    const rate = flight.profile.rate || 1, H = innerHeight;
    const tu0 = Math.max(FAR_T0, (T.markOut / rate - T.warp / rate) * rate), span = Math.max(1, FAR_T1 - tu0), dur = span / rate;
    if (!ring || reduced) { mark.classList.remove("on"); mark.classList.add("dissolve"); return; }
    ring.style.vectorEffect = "non-scaling-stroke";
    const frames = [];
    for (let i = 0; i <= 12; i++) {
      const k = deepGrowth(tu0 + (span * i) / 12, H) / deepGrowth(tu0, H);
      frames.push({ offset: i / 12, transform: `scale(${k.toFixed(4)})`, opacity: Math.max(0, Math.min(1, 1 - (k - 1.15) / 1.6)) * 0.85 });
    }
    const box = { transformOrigin: "100px 100px", transformBox: "view-box" };
    Object.assign(ring.style, box); Object.assign(gold.style, { transformBox: "view-box", transformOrigin: "163px 63.5px" });
    const a1 = ring.animate(frames, { duration: dur, easing: "linear", fill: "forwards" });
    svg.animate(frames.map((fr, i) => ({ offset: fr.offset, transform: tiltAt(tu0 + (span * i) / 12) })), { duration: dur, easing: "linear", fill: "forwards" });
    gold.animate([
      { transform: "translate(0px, 0px) scale(1)", opacity: 1 },
      { transform: "translate(-63px, 36.5px) scale(.9)", opacity: 1, offset: 0.55 },
      { transform: "translate(-63px, 36.5px) scale(1.6)", opacity: 0 },
    ], { duration: Math.min(dur, 620), easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" });
    /* gone at its last frame (no fade back through its first look), and set straight only once it is out of sight */
    a1.finished.then(() => {
      mark.style.transition = "none"; mark.classList.remove("on");
      setTimeout(() => { for (const el of [ring, gold, svg]) { el.getAnimations().forEach((x) => x.cancel()); el.style.vectorEffect = ""; } mark.style.transition = ""; }, 120);
    }).catch(() => {});
  }
  /* coming back out of the docs' galaxy, the same thing backwards: as the galaxy shrinks to the size of the mark's ring
     its rim gathers into the ring, tilted as the galaxy lies, and the gold planet comes out of the core to its place;
     then the mark rides home to the door, levelling as it goes */
  function condenseMark(rate) {
    const svg = mark.querySelector("svg"), [ring, , gold] = svg ? svg.querySelectorAll("circle") : [];
    if (!ring || reduced) return;
    const size = MARK_ARRIVE, left = innerWidth / 2 - size / 2, top = innerHeight / 2 - size / 2, H = innerHeight;
    mark.style.transition = "none";
    Object.assign(mark.style, { left: `${left}px`, top: `${top}px`, width: `${size}px`, height: `${size}px` });
    mark.classList.remove("collapse", "dissolve"); mark.classList.add("on");
    ring.style.vectorEffect = "non-scaling-stroke";
    Object.assign(ring.style, { transformOrigin: "100px 100px", transformBox: "view-box" });
    Object.assign(gold.style, { transformBox: "view-box", transformOrigin: "163px 63.5px" });
    const tuA = FAR_T1, tuB = T.markOut - T.warp, span = tuA - tuB;
    const dur = span / (UPDUR / DOWNDUR) / rate;
    const frames = [];
    for (let i = 0; i <= 12; i++) {
      const k = deepGrowth(tuA - (span * i) / 12, H) / deepGrowth(tuB, H);
      frames.push({ offset: i / 12, transform: `scale(${k.toFixed(4)})`, opacity: Math.max(0, Math.min(1, 1 - (k - 1.15) / 1.6)) * 0.85 });
    }
    ring.animate(frames, { duration: dur, easing: "linear", fill: "forwards" });
    svg.animate(frames.map((fr, i) => ({ offset: fr.offset, transform: tiltAt(tuA - (span * i) / 12) })), { duration: dur, easing: "linear", fill: "forwards" });
    gold.animate([
      { transform: "translate(-63px, 36.5px) scale(1.6)", opacity: 0 },
      { transform: "translate(-63px, 36.5px) scale(.9)", opacity: 1, offset: 0.45 },
      { transform: "translate(0px, 0px) scale(1)", opacity: 1 },
    ], { duration: Math.max(dur, 420), easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" });
  }
  function settleMark() {
    const svg = mark.querySelector("svg"); if (!svg) return;
    for (const el of svg.querySelectorAll("circle")) { el.getAnimations().forEach((x) => x.cancel()); el.style.vectorEffect = ""; }
    svg.style.transform = "";
  }
  /* the other flights: the mark is flown through. As the climb comes up to speed the ring opens past the edges of the
     screen, a thin hoop the camera goes through, tipping a little as the climb steepens, and the gold planet sweeps
     by close and is gone; the dawn's mark is set back behind it, unseen */
  function flyThroughMark() {
    for (const el of [dawnGlyph(), duskGlyph()]) if (el) el.style.visibility = "";
    const svg = mark.querySelector("svg"), circles = svg ? [...svg.querySelectorAll("circle")] : [];
    if (!circles.length || reduced) { dropMark(); return; }
    const rate = flight.profile.rate || 1, dur = 760 / rate, timing = { duration: dur, easing: "cubic-bezier(.5,0,.9,.5)", fill: "forwards" };
    circles[0].style.vectorEffect = "non-scaling-stroke";
    const lean = flight.profile.vpX > 0.6 ? "rotateY(14deg)" : flight.profile.vpX < 0.4 ? "rotateY(-14deg)" : "rotateX(-16deg)";
    const anims = circles.map((c) => {
      Object.assign(c.style, { transformOrigin: "100px 100px", transformBox: "view-box" });
      return c.animate([{ transform: "scale(1)", opacity: 1 }, { transform: "scale(2.4)", opacity: 1, offset: 0.5 }, { transform: "scale(9)", opacity: 0 }], timing);
    });
    anims.push(svg.animate([{ transform: "none" }, { transform: lean }], timing));
    anims[0].finished.then(() => {
      mark.style.transition = "none"; mark.classList.remove("on");
      setTimeout(() => { anims.forEach((x) => x.cancel()); circles[0].style.vectorEffect = ""; mark.style.transition = ""; }, 120);
    }).catch(() => {});
  }
  function dropMark() {
    mark.classList.remove("on"); mark.classList.add("collapse");
    for (const el of [dawnGlyph(), duskGlyph()]) if (el) el.style.visibility = "";
  }
  function landMark(glyph) {
    /* from the docs' galaxy the mark is already at the centre, full size (condenseMark); otherwise it comes from a point */
    const condensed = descent.from?.ending === "chart" && mark.classList.contains("on") && !reduced;
    const from = condensed ? mark.getBoundingClientRect() : { left: innerWidth / 2 - 18, top: innerHeight / 2 - 18, width: 36, height: 36 };
    if (condensed) {
      const svg = mark.querySelector("svg");
      svg?.animate([{ transform: tiltAt(T.markOut - T.warp) }, { transform: "rotateX(0deg)" }], { duration: MARK_RIDE_DOWN / (descent.rate || 1), easing: "cubic-bezier(.35,0,.2,1)", fill: "forwards" })
        .finished.then(() => { svg.getAnimations().forEach((x) => x.cancel()); settleMark(); }).catch(() => {});
    } else {
      mark.style.transition = "none";
      mark.style.left = `${from.left}px`; mark.style.top = `${from.top}px`; mark.style.width = "36px"; mark.style.height = "36px";
      mark.classList.remove("collapse", "dissolve"); mark.classList.add("on");
    }
    if (!glyph) return;
    const g = glyph.getBoundingClientRect();
    glyph.style.visibility = "hidden";
    mark.style.left = `${g.left}px`; mark.style.top = `${g.top}px`; mark.style.width = `${g.width}px`; mark.style.height = `${g.height}px`;
    flip(from, g.left, g.top, g.width, g.height, MARK_RIDE_DOWN / (descent.rate || 1));
  }
  let flight = { profile: UP, glyph: dawnGlyph, on: {} };
  const ascentStep = (act) => {
    switch (act) {
      case "arming": body.classList.add("arming"); break;
      case "warp": body.classList.add("showwarp"); engine.start(flight.profile); break;
      case "mark": body.classList.remove("arming"); liftMark(flight.glyph(), innerHeight * 0.5, MARK_ARRIVE, MARK_RIDE_UP / (flight.profile.rate || 1)); break;
      case "release": body.classList.remove("showdawn"); (flight.on.release ?? on.release)?.(); break;
      /* on the docs' flight the mark is not gathered up: its ring becomes the galaxy, so it dissolves into it */
      case "markOut": if (flight.profile.ending === "chart") dissolveMark(); else flyThroughMark(); break;
      case "nameOn": name.classList.add("on"); break;
      case "nameOff": name.classList.remove("on"); break;
      case "land": body.classList.remove("showwarp", "launching"); body.classList.add("bare"); (flight.on.land ?? on.land)?.(); break;
      case "instrument": body.classList.remove("bare"); body.classList.add("instrument"); (flight.on.settled ?? on.settled)?.(); break;
    }
  };
  let descent = { onto: "dusk", from: null, on: {} };
  const landingGlyph = () => (descent.onto === "dawn" ? dawnGlyph() : duskGlyph());
  const descentStep = (act) => {
    switch (act) {
      case "withdraw": body.classList.remove("instrument"); body.classList.add("withdrawing"); break;
      case "disperse": body.classList.add("dispersing"); break;
      case "warp": body.classList.add("showwarp"); engine.start(descent.from ? descentFrom(descent.from) : descent.onto === "dawn" ? DOWN_DAWN : DOWN); break;
      case "release": body.classList.remove("withdrawing"); (descent.on.released ?? on.released)?.(); break;
      case "nameOn": name.classList.add("on"); break;
      case "nameOff": name.classList.remove("on"); break;
      case "dusk": body.classList.add(descent.onto === "dawn" ? "showdawn" : "showdusk"); (descent.on.surface ?? on.dusk)?.(); break;
      case "condense": condenseMark(descent.rate || 1); break;
      case "markIn": landMark(landingGlyph()); break;
      case "warpOut": body.classList.remove("showwarp"); break;
      case "markHome": { mark.classList.remove("on"); const g = landingGlyph(); if (g) g.style.visibility = ""; break; }
      case "farewell": body.classList.add("farewell"); (descent.on.farewell ?? on.farewell)?.(); break;
    }
  };
  function reset() {
    cancelTimeline(); cancelTimeline = () => {};
    engine.clear();
    body.classList.remove(...CLASSES);
    mark.classList.remove("on", "collapse", "dissolve"); name.classList.remove("on");
    for (const el of [dawnGlyph(), duskGlyph()]) if (el) el.style.visibility = "";
  }
  const write = (title, subtitle) => name.replaceChildren(document.createTextNode(title), Object.assign(document.createElement("i"), { textContent: subtitle }));
  /* fly: any profile, from any surface's glyph, to whichever landing `on` describes */
  function fly(profile, { title = "", subtitle = "", glyph = dawnGlyph, on: hooks = {}, ready = null } = {}) {
    cancelTimeline();
    body.classList.remove(...CLASSES, "holding");
    flight = { profile, glyph, on: hooks };
    /* which way the flight goes, for the mark's tilt into it */
    mark.dataset.way = profile.ending === "chart" ? "deep" : (profile.vpX ?? 0.5) > 0.6 ? "right" : (profile.vpX ?? 0.5) < 0.4 ? "left" : "up";
    write(title, subtitle);
    body.classList.add("showdawn", "launching");
    let beats = reduced ? ascentBeatsReduced() : quicken(ascentBeats(), UPDUR, profile.rate || 1);
    /* not yet ready: the journey still starts at once, but its opening is the mark lifting to the centre (which needs
       nothing drawn), and the clock holds just before the flight's canvas comes up until what it draws is ready */
    if (ready && !reduced) {
      const warp = beats.find((b) => b.act === "warp")?.at ?? 0;
      beats = beats.map((b) => (b.act === "mark" ? { ...b, at: Math.min(b.at, Math.max(0, warp - 80)) } : b));
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
       back; everything after comes sooner by as much. The ring gathers out of the galaxy's rim as it shrinks
       (condense), then rides home a little later */
    if (from?.ending === "chart") {
      const warp = 300, shift = D.warp - warp + DEEP_SKIP_T;
      const at = (tu) => warp + DOWNDUR * (1 - tu / UPDUR) - DEEP_SKIP_T;
      beats = beats.map((b) => (b.act === "withdraw" ? b : b.act === "disperse" ? { ...b, at: 240 } : b.act === "warp" ? { ...b, at: warp } : { ...b, at: Math.max(warp + 60, b.at - shift) }));
      beats = [...beats.map((b) => (b.act === "markIn" ? { ...b, at: Math.max(b.at, at(T.markOut - T.warp) + 60) } : b)), { at: at(FAR_T1), act: "condense" }];
    }
    cancelTimeline = runTimeline(reduced ? descentBeatsReduced() : quicken(beats, DOWNDUR, descent.rate), descentStep, clock);
  }
  return { fly, ascend, descend, reset, reduced, warm: () => engine.warm(), compiled: () => engine.compiled() };
}
