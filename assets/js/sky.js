/*
 * The sky, the grain and the packs — carried from $lib/sky.js, Grain.svelte
 * and theme-swatches.js on orbit dev. The door's own stars (the dawn's and
 * the dusk's fields) are the shared door's: assets/door/stars.js.
 */
import { seededRng, el, measureTile } from "../door/index.js";
export { seededRng, el };
export const PACKS = ["starchart", "afterdark", "clouds", "dawn", "retrograde"];
export const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Home's exact layer recipe: one rng, far then near — the order is the contract. */
const TILED_LAYERS = [
  { count: 95, rMin: 0.4, rSpan: 0.5, oMin: 0.12, oSpan: 0.23 },
  { count: 46, rMin: 0.8, rSpan: 0.7, oMin: 0.3, oSpan: 0.4 },
];
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
