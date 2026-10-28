/*
 * The page, as the flight's modules see it (ADR-0004 6a.2): every touch of the page by engine.js, voyage.js,
 * chores.js and fitness.js goes through here, so the same modules can one day draw in a worker, where there is no
 * page and this answers from what the page last said. On the page (the only place it runs for now) it reads the real
 * thing, exactly as those modules did themselves. Read at call time (`page.size()`), never kept, so what answers can
 * be changed once per thread before anything is drawn.
 */
/**
 * A picture asked for (picture): settled once it has loaded or failed.
 * @typedef {object} Picture
 * @property {Promise<void>} settled
 * @property {() => boolean} done  it has loaded or failed (an image's `complete`)
 * @property {() => HTMLImageElement | null} drawable  the picture once it has come with pixels, else null
 */
/**
 * The GPU gate's canvas (fitness.js: gpu()) and whether the gate checks it (the caveat flag and the renderer's name).
 * @typedef {{ canvas: HTMLCanvasElement, check: boolean }} Gate
 */

export const page = {
  /** the window's size in CSS px, and its pixel ratio as the browser gives it (the callers cap it)
      @returns {{ W: number, H: number, dpr: number }} */
  size: () => ({ W: innerWidth, H: innerHeight, dpr: globalThis.devicePixelRatio }),
  /** a canvas's size on the page, in CSS px @param {HTMLCanvasElement} canvas @param {number} W @param {number} H */
  css(canvas, W, H) { canvas.style.width = W + "px"; canvas.style.height = H + "px"; },
  /** whether the tab is hidden (off a page: never) */
  hidden: () => typeof document !== "undefined" && !!document.hidden,
  /** fn each time the tab is shown again; returns the stop @param {() => void} fn @returns {() => void} */
  onVisible(fn) {
    const on = () => { if (!document.hidden) fn(); };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  },
  /** @param {FrameRequestCallback} fn @returns {number} */
  frame: (fn) => requestAnimationFrame(fn),
  /** @param {number} id */
  cancelFrame: (id) => cancelAnimationFrame(id),
  /** a picture for drawImage, asked for now; `loaded(img, w, h)` once it has come (not if it fails); null where
      there are no pictures
      @param {string} url @param {(img: HTMLImageElement, w: number, h: number) => void} loaded @returns {Picture | null} */
  picture(url, loaded) {
    if (typeof Image === "undefined") return null;
    const img = new Image();
    /** @type {Promise<void>} */
    const settled = new Promise((r) => { img.addEventListener("load", () => r(), { once: true }); img.addEventListener("error", () => r(), { once: true }); });
    img.addEventListener("load", () => loaded(img, img.naturalWidth, img.naturalHeight), { once: true });
    img.src = url;
    return { settled, done: () => img.complete, drawable: () => (img.complete && img.naturalWidth ? img : null) };
  },
  /** a scratch canvas @param {number} w @param {number} h @returns {HTMLCanvasElement} */
  canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; },
  /** the canvas the page's one WebGL2 context is made on, checked by the gate; null off a page @returns {Gate | null} */
  gate: () => (typeof document === "undefined" ? null : { canvas: document.createElement("canvas"), check: true }),
  /** whether the world's canvas can be put beneath this one @param {HTMLElement | null | undefined} under */
  canPlace: (under) => typeof document !== "undefined" && !!under?.parentNode,
  /** the world's canvas (#warpgl) put beneath the flight's @param {HTMLCanvasElement} canvas @param {HTMLElement} under */
  mount(canvas, under) {
    canvas.id = "warpgl"; canvas.setAttribute("aria-hidden", "true");
    /** @type {ParentNode & Node} */ (under.parentNode).insertBefore(canvas, under);
  },
  /** and taken out again @param {HTMLCanvasElement} canvas */
  unmount(canvas) { canvas.remove(); },
  /** what a relative address is resolved against (throws off a page: the caller keeps the address as given) */
  baseURI: () => document.baseURI,
  /** a line in the console @param {string} line */
  note(line) { console.info(line); },
  /** the line that says whether the flight's world is drawn @param {string} line */
  verdict(line) { console.info(line); },
};
