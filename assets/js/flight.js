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
const F_B2L = '<filter id="b2l" filterUnits="userSpaceOnUse" x="-20" y="-20" width="1640" height="1040"><feGaussianBlur stdDeviation="2"/></filter>';
const F_B6L = '<filter id="b6l" filterUnits="userSpaceOnUse" x="-40" y="-40" width="1680" height="1080"><feGaussianBlur stdDeviation="6"/></filter>';
const F_B12L = '<filter id="b12l" filterUnits="userSpaceOnUse" x="-60" y="-60" width="1720" height="1120"><feGaussianBlur stdDeviation="12"/></filter>';
const F_B20L = '<filter id="b20l" filterUnits="userSpaceOnUse" x="-100" y="-100" width="1800" height="1200"><feGaussianBlur stdDeviation="20"/></filter>';
const F_RAYROUGH = '<filter id="rayrough" x="-30%" y="-30%" width="160%" height="160%"><feTurbulence type="fractalNoise" baseFrequency="0.004 0.03" numOctaves="2" seed="9" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="22"/><feGaussianBlur stdDeviation="17"/></filter>';
const G_ZOD = '<radialGradient id="zod" cx="50%" cy="88%" r="75%"><stop offset="0%" stop-color="#f6d489" stop-opacity=".13"/><stop offset="55%" stop-color="#e8b25e" stop-opacity=".045"/><stop offset="100%" stop-opacity="0"/></radialGradient>';
const G_RAYG = '<linearGradient id="rayg" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="#ffe4a8" stop-opacity=".26"/><stop offset="55%" stop-color="#f4c05a" stop-opacity=".07"/><stop offset="100%" stop-opacity="0"/></linearGradient>';
const G_RIMG = '<linearGradient id="rimg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ffd989"/><stop offset="100%" stop-color="#e2772b"/></linearGradient>';

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
  scatter: {
    defs: F_B2L + F_B6L + F_B12L + F_B20L,
    body: '<circle cx="800" cy="3920" r="3122" fill="none" stroke="#7a2c18" stroke-opacity=".1" stroke-width="150" filter="url(#b20l)"/>' +
      '<circle cx="800" cy="3920" r="3060" fill="none" stroke="#e2772b" stroke-opacity=".16" stroke-width="84" filter="url(#b20l)"/>' +
      '<circle cx="800" cy="3920" r="3026" fill="none" stroke="#f0b429" stroke-opacity=".28" stroke-width="34" filter="url(#b12l)"/>' +
      '<circle cx="800" cy="3920" r="3010" fill="none" stroke="#ffd989" stroke-opacity=".4" stroke-width="12" filter="url(#b6l)"/>' +
      '<circle cx="800" cy="3920" r="3003" fill="none" stroke="#fff3d6" stroke-opacity=".65" stroke-width="4" filter="url(#b2l)"/>',
  },
  sunpt: { defs: F_B6L, body: '<circle cx="800" cy="919" r="20" fill="#fffdf6" filter="url(#b6l)"/>' },
  sunarc: { defs: F_B2L, body: '<path d="M 560 934 A 3000 3000 0 0 1 1040 934" fill="none" stroke="#ffedc2" stroke-width="3" stroke-linecap="round" opacity=".7" filter="url(#b2l)"/>' },
  rim: { defs: F_B6L + G_RIMG, body: '<circle cx="800" cy="3920" r="3000" fill="none" stroke="url(#rimg)" stroke-width="6" stroke-opacity=".35" filter="url(#b6l)"/>' },
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
   core, the arc over the limb, the rim) are drawn at device resolution. */
const SOFT = new Set(["zod", "sway1", "sway2", "scatter", "glow", "belt", "afterglow"]);
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
  const url = canvas.toDataURL("image/png");
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
  async function build() {
    const id = ++run;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const base = Math.max(innerWidth / 1600, innerHeight / 1000);
    world.dataset.rasterised = "pending";
    for (const [name, { defs, body }] of Object.entries(groups)) {
      const scale = base * (SOFT.has(name) ? 1 : dpr);
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
  return { start };
}

/* ══ THE JOURNEY (the app's Flight.svelte, without the framework) ═══════
   The canvas between the dawn and the sky, the mark that leaves the lockup
   and rides to the centre of the screen, and the name written once on the
   void. The surfaces are the host's; this only says WHEN, in the body-class
   vocabulary the app uses, and the stylesheet answers. */
import { createFlight, UP, DOWN } from "./engine.js";
import { ascentBeats, ascentBeatsReduced, descentBeats, descentBeatsReduced, runTimeline, MARK_ARRIVE, MARK_RIDE_UP, MARK_RIDE_DOWN } from "./timeline.js";

const CLASSES = ["arming", "showdawn", "showwarp", "launching", "bare", "instrument", "withdrawing", "dispersing", "showdusk", "farewell"];

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
  function landMark() {
    const from = { left: innerWidth / 2 - 18, top: innerHeight / 2 - 18, width: 36, height: 36 };
    mark.style.transition = "none";
    mark.style.left = `${from.left}px`; mark.style.top = `${from.top}px`; mark.style.width = "36px"; mark.style.height = "36px";
    mark.classList.remove("collapse"); mark.classList.add("on");
    const glyph = duskGlyph(); if (!glyph) return;
    const g = glyph.getBoundingClientRect();
    glyph.style.visibility = "hidden";
    mark.style.left = `${g.left}px`; mark.style.top = `${g.top}px`; mark.style.width = `${g.width}px`; mark.style.height = `${g.height}px`;
    flip(from, g.left, g.top, g.width, g.height, MARK_RIDE_DOWN);
  }
  const ascentStep = (act) => {
    switch (act) {
      case "arming": body.classList.add("arming"); break;
      case "warp": body.classList.add("showwarp"); engine.start(UP); break;
      case "mark": body.classList.remove("arming"); liftMark(dawnGlyph(), innerHeight * 0.5, MARK_ARRIVE, MARK_RIDE_UP); break;
      case "release": body.classList.remove("showdawn"); on.release?.(); break;
      case "markOut": dropMark(); break;
      case "nameOn": name.classList.add("on"); break;
      case "nameOff": name.classList.remove("on"); break;
      case "land": body.classList.remove("showwarp", "launching"); body.classList.add("bare"); on.land?.(); break;
      case "instrument": body.classList.remove("bare"); body.classList.add("instrument"); on.settled?.(); break;
    }
  };
  const descentStep = (act) => {
    switch (act) {
      case "withdraw": body.classList.remove("instrument"); body.classList.add("withdrawing"); break;
      case "disperse": body.classList.add("dispersing"); break;
      case "warp": body.classList.add("showwarp"); engine.start(DOWN); break;
      case "release": body.classList.remove("withdrawing"); on.released?.(); break;
      case "nameOn": name.classList.add("on"); break;
      case "nameOff": name.classList.remove("on"); break;
      case "dusk": body.classList.add("showdusk"); on.dusk?.(); break;
      case "markIn": landMark(); break;
      case "warpOut": body.classList.remove("showwarp"); break;
      case "markHome": { mark.classList.remove("on"); const g = duskGlyph(); if (g) g.style.visibility = ""; break; }
      case "farewell": body.classList.add("farewell"); on.farewell?.(); break;
    }
  };
  function reset() {
    cancelTimeline(); cancelTimeline = () => {};
    engine.clear();
    body.classList.remove(...CLASSES);
    mark.classList.remove("on", "collapse"); name.classList.remove("on");
    for (const el of [dawnGlyph(), duskGlyph()]) if (el) el.style.visibility = "";
  }
  function ascend({ title = "", subtitle = "" } = {}) {
    cancelTimeline();
    name.replaceChildren(document.createTextNode(title), Object.assign(document.createElement("i"), { textContent: subtitle }));
    body.classList.add("showdawn", "launching");
    cancelTimeline = runTimeline(reduced ? ascentBeatsReduced() : ascentBeats(), ascentStep);
  }
  function descend({ title = "", subtitle = "signing out" } = {}) {
    cancelTimeline();
    name.replaceChildren(document.createTextNode(title), Object.assign(document.createElement("i"), { textContent: subtitle }));
    cancelTimeline = runTimeline(reduced ? descentBeatsReduced() : descentBeats(), descentStep);
  }
  return { ascend, descend, reset, reduced };
}
