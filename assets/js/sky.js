/*
 * The sky, the grain and the packs — carried from $lib/sky.js, Grain.svelte,
 * flight/starfields.js and theme-swatches.js on orbit dev.
 */
const NS = "http://www.w3.org/2000/svg";
export const PACKS = ["starchart", "afterdark", "clouds", "dawn", "retrograde"];
export const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

export function seededRng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 48271) % 2147483647) / 2147483647;
}

export function el(name, attrs, parent) {
  const e = document.createElementNS(NS, name);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

/* Home's exact layer recipe: one rng, far then near — the order is the contract. */
const TILED_LAYERS = [
  { count: 95, rMin: 0.4, rSpan: 0.5, oMin: 0.12, oSpan: 0.23 },
  { count: 46, rMin: 0.8, rSpan: 0.7, oMin: 0.3, oSpan: 0.4 },
];
/* the drift is a transform on the layer's own <svg> element, not on a group
   inside one: an element the compositor can move on its own, so the sky
   costs nothing per frame. The tile is 1600 units wide; `--tile` says how
   many pixels that is at this size, so the seam never shows */
export function measureTile(host) {
  const set = () => {
    const scale = Math.max(host.clientWidth / 1600, host.clientHeight / 1000);
    host.style.setProperty("--tile", `${(1600 * scale).toFixed(1)}px`);
  };
  set();
  let t; addEventListener("resize", () => { clearTimeout(t); t = setTimeout(set, 100); });
}
export function mountTiledSky(host, idPrefix = "sky") {
  const rng = seededRng(17170812);
  const cams = {};
  ["far", "near"].forEach((cls, index) => {
    const svg = el("svg", { class: cls, viewBox: "0 0 1600 1000", preserveAspectRatio: "xMidYMid slice" }, host);
    const cam = el("g", { class: "cam" }, svg);
    const layer = el("g", { fill: cls === "far" ? "var(--star-far)" : "var(--star-near)" }, cam);
    const tile = el("g", { id: `${cls}tile-${idPrefix}` }, layer);
    const { count, rMin, rSpan, oMin, oSpan } = TILED_LAYERS[index];
    for (let i = 0; i < count; i++) {
      el("circle", { cx: (rng() * 1600).toFixed(1), cy: (rng() * 1000).toFixed(1), r: (rMin + rng() * rSpan).toFixed(2), opacity: (oMin + rng() * oSpan).toFixed(2) }, tile);
    }
    el("use", { href: `#${tile.id}`, x: "1600" }, layer);
    cams[cls] = cam;
  });
  measureTile(host);
  return cams;
}

/* The dawn's and the dusk's tiled fields, drawn off ONE stream in the sheet's own order. */
const rnd = seededRng(17170812);
function tile(n, rMin, rSpan, oMin, oSpan, twinkle) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const star = { cx: (rnd() * 1600).toFixed(1), cy: (rnd() * 1000).toFixed(1), r: (rMin + rnd() * rSpan).toFixed(2), opacity: (oMin + rnd() * oSpan).toFixed(2), delay: null };
    if (twinkle && i % 6 === 0) star.delay = (rnd() * 5.6).toFixed(1);
    out.push(star);
  }
  return out;
}
export const DAWN_FAR = tile(100, 0.4, 0.5, 0.10, 0.25, true);
export const DAWN_NEAR = tile(44, 0.8, 0.8, 0.35, 0.35, false);
export const DUSK_FAR = tile(100, 0.4, 0.55, 0.14, 0.28, true);
export const DUSK_NEAR = tile(48, 0.8, 0.85, 0.40, 0.38, false);

export function mountFlightSky(host, far, near, idPrefix) {
  /* the far field, the few stars that twinkle, and the near field — each drifting on its own. The twinklers are
     three layers of their own, each fading as a whole, out of step with the others: a layer's fade is the
     compositor's, where a star's own would have the page repaint its layer every frame */
  const layer = (cls, fill, id, stars, tw = null) => {
    const svg = el("svg", { class: cls, viewBox: "0 0 1600 1000", preserveAspectRatio: "xMidYMid slice" }, host);
    if (tw !== null) svg.style.setProperty("--tw", `${tw}s`);
    const g = el("g", { fill }, svg);
    const tile = el("g", { id }, g);
    /* a twinkler is drawn at full strength, its layer fading it */
    for (const s of stars) el("circle", { cx: s.cx, cy: s.cy, r: s.r, opacity: tw === null ? s.opacity : 1 }, tile);
    el("use", { href: `#${id}`, x: "1600" }, g);
  };
  layer("far", "var(--star-far, #e9edf8)", `${idPrefix}-far`, far.filter((s) => !s.delay));
  const twinklers = far.filter((s) => s.delay);
  for (let k = 0; k < 3; k++) layer("far tws", "var(--star-far, #e9edf8)", `${idPrefix}-tw${k}`, twinklers.filter((_, i) => i % 3 === k), -k * 1.5);
  layer("near", "var(--star-near, #f4f0ff)", `${idPrefix}-near`, near);
  measureTile(host);
}

/* POL-13: film grain, one 256px tile, repeated */
let grainTimer;
export function mountGrain(host) {
  const canvas = host.querySelector("canvas");
  if (!canvas) return;
  const build = () => {
    const TILE = 256;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(TILE * dpr);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${w}" viewBox="0 0 ${TILE} ${TILE}">` +
      `<filter id="gr"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>` +
      `<feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0.08"/></feComponentTransfer>` +
      `<feComposite operator="in" in2="SourceGraphic"/></filter><rect width="${TILE}" height="${TILE}" filter="url(#gr)"/></svg>`;
    const img = new Image();
    img.onload = () => {
      const t = document.createElement("canvas");
      t.width = w; t.height = w;
      t.getContext("2d").drawImage(img, 0, 0, w, w);
      const rw = Math.max(1, Math.round(innerWidth * dpr)), rh = Math.max(1, Math.round(innerHeight * dpr));
      canvas.width = rw; canvas.height = rh;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = ctx.createPattern(t, "repeat");
      ctx.fillRect(0, 0, rw, rh);
      host.dataset.ready = "1";
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  };
  build();
  addEventListener("resize", () => { clearTimeout(grainTimer); grainTimer = setTimeout(build, 120); });
}

/* the packs, as the account menu offers them */
/* the pack chosen in the account menu is kept under this name. After dark has long been the default; a pack kept
   under the old name may be left over from when the star chart was, so it is let go, and only a choice made since
   is kept */
const THEME_KEY = "orbit-pack";
export function initTheme() {
  let t = null;
  try { localStorage.removeItem("orbit-theme"); t = localStorage.getItem(THEME_KEY); } catch { /* private mode */ }
  document.documentElement.dataset.theme = PACKS.includes(t) ? t : "afterdark";
  syncSwatches();
}
export function applyTheme(id, remember = true) {
  if (!PACKS.includes(id)) return;
  document.documentElement.dataset.theme = id;
  if (remember) { try { localStorage.setItem(THEME_KEY, id); } catch { /* this page only */ } }
  syncSwatches();
}
export function currentTheme() { return document.documentElement.dataset.theme; }
export function syncSwatches() {
  const id = currentTheme();
  document.querySelectorAll("[data-pack]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.pack === id)));
}
export function bindSwatches() {
  document.querySelectorAll("[data-pack]").forEach((b) => b.addEventListener("click", () => applyTheme(b.dataset.pack)));
  syncSwatches();
}
