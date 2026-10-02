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
import { createFlight, UP, DOWN, PROPS_UP, UPDUR, DOWNDUR, REV, SWEEP } from "./engine.js";

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
export const descentFrom = (P) => ({ ...DOWN_DAWN, rate: P.rate ? DOWNDUR / (DOWNDUR - 1000) : undefined, vpX: P.vpX, vpY: P.vpY, a0: P.a0, a1: P.a1, ending: P.ending, chart: P.chart, tint: P.tint, props: mirrored(P.props) });
/* the demo's climb: the rest of the galaxy passes — the other households in
   the sample, each with its items as bodies where its dial has them — and
   the flight lands on your own. `homes` is [{ name, bodies:[[x,y,colour,r]] }] */
export function demoFlight(homes) {
  const BEAR = [44, 136, 74, 106, 58, 122], ZED = [0.5, 0.42, 0.62, 0.46, 0.56, 0.4];
  const props = homes.map((h, i) => ({ kind: "home", name: h.name, bodies: h.bodies, t0: 760 + i * 380, dur: 2000 + (i % 3) * 350, ang: BEAR[i % BEAR.length], z: ZED[i % ZED.length], spin: 0 }));
  return { ...UP, props };
}
/* the flight to the docs, carrying the chart: its constellations pass on the
   way — each set about its own centre in a ~300-unit box, in its colour, with
   its name — and on arrival the streaks settle into the chart itself */
export function docsFlight({ rect, geometry }) {
  const props = geometry.cons.map((con, i) => {
    const xs = con.pts.map((p) => p[0]), ys = con.pts.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const span = Math.max(40, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)), k = 300 / span;
    return { kind: "chart", name: con.name, c: con.c, pts: con.pts.map((p) => [(p[0] - cx) * k, (p[1] - cy) * k]),
      t0: 640 + i * 190, dur: 1500 + (i % 3) * 380, ang: 128 + ((i * 47) % 100), z: 0.42 + ((i * 3) % 5) * 0.09, spin: (i % 2 ? -1 : 1) * (0.06 + (i % 3) * 0.04) };
  });
  return { ...RIGHT, props, ending: "chart", chart: { rect, geometry } };
}
export { UP, DOWN };
import { ascentBeats, ascentBeatsReduced, descentBeats, descentBeatsReduced, runTimeline, MARK_ARRIVE, MARK_RIDE_UP, MARK_RIDE_DOWN } from "./timeline.js";

const CLASSES = ["arming", "showdawn", "showwarp", "launching", "bare", "instrument", "withdrawing", "dispersing", "showdusk", "farewell"];

/* a flight played faster keeps every beat in step: those inside it scale with it, those after it come sooner by what it saved */
const quicken = (beats, dur, rate) => (rate === 1 ? beats : beats.map((b) => ({ ...b, at: b.at <= dur ? b.at / rate : b.at - (dur - dur / rate) })));

export function createJourney({ canvas, mark, name, dawnGlyph, duskGlyph, on = {} }) {
  const engine = createFlight(canvas);
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
    mark.classList.remove("collapse"); mark.classList.add("on");
    srcSvg.style.visibility = "hidden";
    mark.style.left = `${left}px`; mark.style.top = `${top}px`; mark.style.width = `${size}px`; mark.style.height = `${size}px`;
    flip(r, left, top, size, size, ms);
  }
  function dropMark() {
    mark.classList.remove("on"); mark.classList.add("collapse");
    for (const el of [dawnGlyph(), duskGlyph()]) if (el) el.style.visibility = "";
  }
  function landMark(glyph) {
    const from = { left: innerWidth / 2 - 18, top: innerHeight / 2 - 18, width: 36, height: 36 };
    mark.style.transition = "none";
    mark.style.left = `${from.left}px`; mark.style.top = `${from.top}px`; mark.style.width = "36px"; mark.style.height = "36px";
    mark.classList.remove("collapse"); mark.classList.add("on");
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
      case "markOut": dropMark(); break;
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
    mark.classList.remove("on", "collapse"); name.classList.remove("on");
    for (const el of [dawnGlyph(), duskGlyph()]) if (el) el.style.visibility = "";
  }
  const write = (title, subtitle) => name.replaceChildren(document.createTextNode(title), Object.assign(document.createElement("i"), { textContent: subtitle }));
  /* fly: any profile, from any surface's glyph, to whichever landing `on` describes */
  function fly(profile, { title = "", subtitle = "", glyph = dawnGlyph, on: hooks = {} } = {}) {
    cancelTimeline();
    body.classList.remove(...CLASSES);
    flight = { profile, glyph, on: hooks };
    /* which way the flight goes, for the mark's tilt into it */
    mark.dataset.way = (profile.vpX ?? 0.5) > 0.6 ? "right" : (profile.vpX ?? 0.5) < 0.4 ? "left" : "up";
    write(title, subtitle);
    body.classList.add("showdawn", "launching");
    cancelTimeline = runTimeline(reduced ? ascentBeatsReduced() : quicken(ascentBeats(), UPDUR, profile.rate || 1), ascentStep);
  }
  const ascend = (o = {}) => fly(UP, o);
  function descend({ title = "", subtitle = "signing out", onto = "dusk", from = null, on: hooks = {} } = {}) {
    cancelTimeline();
    body.classList.remove("showdawn", "showdusk", "farewell", "bare", "launching");
    descent = { onto, from, on: hooks, rate: from?.rate ? DOWNDUR / (DOWNDUR - 1000) : 1 };
    write(title, subtitle);
    cancelTimeline = runTimeline(reduced ? descentBeatsReduced() : quicken(descentBeats(), DOWNDUR, descent.rate), descentStep);
  }
  return { fly, ascend, descend, reset, reduced, warm: () => engine.warm() };
}
