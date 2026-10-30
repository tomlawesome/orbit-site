/*
 * The page, as the flight's modules see it (ADR-0004 6a.2): every touch of the page by engine.js, voyage.js,
 * chores.js and fitness.js goes through here, so the same modules can one day draw in a worker, where there is no
 * page and this answers from what the page last said (draw-worker.js: setPage, from the page's `hello`). On the page it
 * reads the real thing, exactly as those modules did themselves. Read at call time (`page.size()`), never kept, so what
 * answers can be changed once per thread before anything is drawn.
 */
import { decodeAside } from "./fitness.js";

/**
 * A picture asked for (picture): settled once it has loaded or failed.
 * @typedef {object} Picture
 * @property {Promise<void>} settled
 * @property {() => boolean} done  it has loaded or failed (an image's `complete`)
 * @property {() => CanvasImageSource | null} drawable  the picture once it has come with pixels, else null
 */
/**
 * The GPU gate's canvas (fitness.js: gpu()) and whether the gate checks it (the caveat flag and the renderer's name).
 * @typedef {{ canvas: HTMLCanvasElement, check: boolean }} Gate
 */

/** @type {(() => void)[]} */
const hops = [];
/** @type {MessagePort | null} */
let hopSend = null;
/** @type {MessagePort | null} */
let hopGet = null;
/** @param {() => void} fn */
function yielded(fn) {
  if (typeof MessageChannel === "undefined") { setTimeout(fn, 0); return; }
  if (!hopSend) {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => { try { hops.shift()?.(); } finally { if (!hops.length) /** @type {any} */ (port1).unref?.(); } };
    hopGet = port1; hopSend = port2;
  }
  /* (under Node the receiving port keeps the process alive only while a hop is pending) */
  if (!hops.length) /** @type {any} */ (hopGet)?.ref?.();
  hops.push(fn);
  hopSend.postMessage(0);
}

/** a blob decoded by the browser, on whichever thread it chooses: the one route that is correct everywhere
    @param {Blob} blob @param {ImageBitmapOptions} [options] @returns {Promise<ImageBitmap>} */
export const decodeHere = (blob, options) => createImageBitmap(blob, options);
/** the options a wrap from an <img> may carry: the resizing alone @param {ImageBitmapOptions} [options] @returns {ImageBitmapOptions} */
function resizeOnly({ resizeWidth, resizeHeight, resizeQuality } = {}) {
  return {
    ...(resizeWidth === undefined ? {} : { resizeWidth }), ...(resizeHeight === undefined ? {} : { resizeHeight }),
    ...(resizeQuality === undefined ? {} : { resizeQuality }),
  };
}

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
  /** fn as the next task, with no clamp (#101: a browser stretches a 0 ms timer to ~8 ms and more, and the chore queue
      hopped on one per chore): a message on a channel where there is one, as a scheduler does (React's), else a 0 ms
      timer. Callbacks run in the order asked, one a task. An addition to the interface: a host's own adapter (setPage)
      without it is answered by chores.js with the timer
      @param {() => void} fn */
  yield: (fn) => yielded(fn),
  /** @param {number} id */
  cancelFrame: (id) => cancelAnimationFrame(id),
  /** a picture for drawImage, asked for now; `loaded(img, w, h)` once it has come and been decoded (not if it fails to
      load; one whose decode fails is offered as it is), so the first drawImage never decodes it on this thread; null
      where there are no pictures
      @param {string} url @param {(img: CanvasImageSource, w: number, h: number) => void} loaded @returns {Picture | null} */
  picture(url, loaded) {
    if (typeof Image === "undefined") return null;
    const img = new Image();
    /** @type {Promise<void>} */
    const settled = new Promise((r) => {
      img.addEventListener("load", () => {
        img.decode().catch(() => {}).then(() => { try { loaded(img, img.naturalWidth, img.naturalHeight); } finally { r(); } });
      }, { once: true });
      img.addEventListener("error", () => r(), { once: true });
    });
    img.src = url;
    return { settled, done: () => img.complete, drawable: () => (img.complete && img.naturalWidth ? img : null) };
  },
  /** a fetched picture as an ImageBitmap (chores.js: fetchBitmap). Under the image-loader route (fitness.js: decodeAside)
      the browser's own background decode: an <img> on a blob: URL, decode() awaited, the bitmap wrapped from it, so the
      page's thread is not held; only the resize options go to the wrap, as any other makes Firefox decode again. A decode or
      a wrap that fails is made the other way. Elsewhere createImageBitmap(blob, options) as it always was. A worker's adapter
      (draw-worker.js) asks the page instead; with no <img> here the blob is decoded here
      @param {Blob} blob @param {ImageBitmapOptions} [options] @returns {Promise<ImageBitmap>} */
  async decode(blob, options) {
    if (typeof Image === "undefined" || !decodeAside()) return decodeHere(blob, options);
    let url = "";
    try {
      url = URL.createObjectURL(blob);
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      return await createImageBitmap(img, resizeOnly(options));
    } catch { return await decodeHere(blob, options); } finally { if (url) URL.revokeObjectURL(url); }
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
  /** whether a page shares this thread, so a compile here freezes it (chores.js: compilesAside; in the worker, no) */
  shared: () => true,
};

/** what answers for the page on this thread, given once before anything is drawn (the worker's, draw-worker.js)
    @param {Partial<typeof page>} over */
export function setPage(over) { Object.assign(page, over); }
