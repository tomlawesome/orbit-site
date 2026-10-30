/*
 * THE WORLD DRAWN IN A WORKER, AS THE PAGE SEES IT (ADR-0004 6b.3, 6b.4). The very surface createWorld returns
 * (world.js), so install.js holds one world whichever it is; behind it, the site's own worker (world-worker.js) owns the
 * world's canvas, handed over, and draws there. The camera stays on the page and posts a view a frame; the worker
 * draws the latest it holds (latest wins) and says `drew` with its own frame period, which the governor reads.
 *
 * The usual worker RPC, as remote-flight.js has it: asks carry an id and resolve on the reply with that id (any other is
 * dropped); the views carry a rising seq.
 *
 * ONE FALLBACK for every failure (the worker's error event, `up` not ok, `dead`, and under the automatic rule no `up`
 * within COMPILE_WAIT): the placeholder replaced by a fresh canvas with its attributes (a handed-over one never gives
 * the page a context again), the worker terminated, a page world made on the fresh canvas at the last size, the
 * pending asks asked of it, and baked afresh if the worker's had baked. From then on everything is the page world's,
 * and the worker is told nothing more.
 */
import { note, settings, gpu, decodeAside, decodeBlob, COMPILE_WAIT } from "../door/index.js";
import { createWorld, picturesOf } from "./world.js";

/* why the page draws the world: the same tells as the flight's rule (assets/door/fitness.js drawnWhy), in its order,
   read only where that rule has said the page, for the console line */
export function whyPage() {
  const f = settings.flags || {}, nav = globalThis.navigator ?? {};
  if (!settings.fonts?.length) return "the host gave the worker no fonts to write with";
  if (f.draw === "page") return "asked for (draw=page)";
  const g = gpu();
  if (!g) return "the GPU gate refused this page";
  if (g.parallel) return "this browser compiles shaders in the background (parallel)";
  if ("userAgentData" in nav) return "a Chromium browser (navigator.userAgentData), which keeps the page";
  if (f.gpu === "force") return "the GPU gate was forced (gpu=force)";
  if (typeof Worker === "undefined") return "no Worker here";
  if (typeof OffscreenCanvas === "undefined") return "no OffscreenCanvas here";
  if (typeof HTMLCanvasElement === "undefined" || !("transferControlToOffscreen" in HTMLCanvasElement.prototype)) return "a canvas cannot be handed to a worker here";
  if (nav.connection?.saveData) return "save-data is on";
  return "the flight's rule keeps the page";
}

const makeWorker = () => new Worker(new URL("./world-worker.js", import.meta.url), { type: "module" });

/*
 * createRemoteWorld(canvas, opts, { worker, cap }): canvas the pad's .orbitgl, handed over; opts createWorld's (the
 * look's and the pictures' options, tag); worker makes the Worker (the tests pass a fake); cap waits COMPILE_WAIT for
 * `up` (the automatic rule; under draw=worker there is none)
 */
export function createRemoteWorld(canvas, opts = {}, { worker: make = makeWorker, cap = settings.flags?.draw !== "worker" } = {}) {
  let el = canvas, worker = null, page = null, up = false, handed = false, gone = false, lost = false;
  let ids = 0, seq = 0, ms = 0, baked = false, baking = null, size = null, timer;
  /* the asks waiting for their answer: bakes, and measures (their sets kept, to be asked of a page world) */
  const pending = new Map();
  const drewFns = new Set();
  let madeIs = () => {}, asideIs = () => {};
  const made = new Promise((r) => { madeIs = r; });
  const aside = new Promise((r) => { asideIs = r; });
  const post = (m, transfer = []) => { if (worker && !page && !gone) worker.postMessage(m, transfer); };

  const hear = (e) => {
    const m = e.data;
    if (page || gone || !m || typeof m !== "object") return;
    switch (m.type) {
      case "up": if (m.ok) { up = true; clearTimeout(timer); asideIs(true); } else fallBack(String(m.why || "the worker cannot draw here")); break;
      case "compiled": ms = Number(m.ms) || 0; madeIs(!!m.ok); break;
      /* a picture's bytes from the worker, decoded here by the image loader and handed back, transferred (6e.2) */
      case "decode":
        if (!m.blob) { post({ type: "decoded", id: m.id, error: "no picture" }); break; }
        decodeBlob(m.blob, m.options).then((bitmap) => post({ type: "decoded", id: m.id, bitmap }, [bitmap]), (e) => post({ type: "decoded", id: m.id, error: String(e?.message || e) }));
        break;
      case "baked": case "measured": {
        const ask = pending.get(m.id);
        if (!ask || ask.kind !== m.type) break;
        pending.delete(m.id);
        if (m.type === "baked") { if (m.ok) baked = true; ask.resolve(!!m.ok); } else ask.resolve(m.ms);
        break;
      }
      case "drew": el.dataset.drawn = String(m.seq); for (const fn of [...drewFns]) fn(m.dt, m.ms); break;
      /* (the worker's console lines, printed as they come) */
      case "note": if (m.kind === "warn") console.warn(String(m.line)); else console.info(String(m.line)); break;
      /* lost: as the page's own context's loss, on the element install.js listens to; no fallback (flat, as today) */
      case "lost": if (!lost) { lost = true; el.dispatchEvent(new Event("webglcontextlost", { cancelable: true })); } break;
      case "dead": fallBack(`the worker stopped (${String(m.why || "no reason given")})`); break;
    }
  };
  const failed = () => fallBack(up ? "the worker failed" : "the worker failed to load");
  const unreadable = () => fallBack("a message from the worker could not be read");
  const unlisten = () => {
    clearTimeout(timer);
    worker?.removeEventListener("message", hear);
    worker?.removeEventListener("error", failed);
    worker?.removeEventListener("messageerror", unreadable);
  };

  function fallBack(why) {
    if (page || gone) return;
    unlisten();
    try { worker?.terminate(); } catch { /* gone already */ }
    if (handed) {
      const fresh = document.createElement("canvas");
      for (const n of el.getAttributeNames()) if (n !== "data-drawn") fresh.setAttribute(n, el.getAttribute(n));
      fresh.hidden = el.hidden;
      el.replaceWith(fresh);
      el = fresh;
    }
    /* (on the page as it always was: the gate has judged, and the page world compiles here, the fallback's cost) */
    let w = null;
    try { w = createWorld(el, opts); } catch (e) { console.warn(e); }
    page = w || { draw() {}, resize() {}, finish() {}, bake: () => Promise.resolve(false), measure: (s) => Promise.resolve(s.map(() => NaN)), made: Promise.resolve(false), baked: false, lost: true, compileMs: 0, onDrew() {}, destroy() {} };
    /* (no world on the page either: the pad goes flat, as a page world that could not be made does, inline review) */
    if (!w) el.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    asideIs(false);
    note(`install: drawn on the page: ${why}`);
    if (size) page.resize(...size);
    page.onDrew((dt, t) => { for (const fn of [...drewFns]) fn(dt, t); });
    madeIs(page.made);
    /* the asks waiting, asked of the page world; a world the worker had baked is baked afresh here, so the next bake()
       (a dive under way, or the next) finds it baked */
    const asks = [...pending.values()];
    pending.clear();
    for (const a of asks) (a.kind === "baked" ? page.bake() : page.measure(a.sets)).then(a.resolve, () => a.resolve(a.kind === "baked" ? false : []));
    baking = null;
    if (baked) page.bake();
  }

  try {
    worker = make();
    if (!worker) throw new Error("no worker");
    worker.addEventListener("message", hear);
    worker.addEventListener("error", failed);
    worker.addEventListener("messageerror", unreadable);
    /* (absolute, because a relative URL in a module worker resolves against the worker's own file, not the page) */
    const base = document.baseURI, abs = (u) => new URL(u, base).href;
    const p = picturesOf(opts);
    const flags = Object.fromEntries(Object.entries(settings.flags || {}).filter(([k]) => k !== "door3d"));
    post({
      type: "hello", decode: decodeAside() ? "page" : "here", flags, baseURI: base, world: { small: p.small, map: abs(p.MAP), rings: abs(p.RINGS), moon: abs(p.MOON) }, sky: opts.sky, tag: opts.tag,
      hue: opts.hue, sat: opts.sat, ringsOn: opts.ringsOn, haze: opts.haze, grade: opts.grade,
    });
    const off = el.transferControlToOffscreen();
    handed = true;
    post({ type: "canvas", canvas: off }, [off]);
    if (cap) timer = setTimeout(() => { if (!up) fallBack(`no answer in ${COMPILE_WAIT} ms`); }, COMPILE_WAIT);
  } catch (e) {
    fallBack(worker ? `the canvas could not be handed over (${e?.message})` : "no worker could be made");
  }

  const ask = (kind, m, extra = {}) => new Promise((resolve) => { const id = ++ids; pending.set(id, { kind, resolve, ...extra }); post({ ...m, id }); });
  return {
    remote: true,
    get canvas() { return el; },
    get made() { return page ? page.made : made; },
    get compileMs() { return page ? page.compileMs : ms; },
    get baked() { return page ? page.baked : baked; },
    get lost() { return page ? page.lost : lost; },
    aside() { return aside; },
    bake() {
      if (page) return page.bake();
      if (gone) return Promise.resolve(false);
      if (!baking) {
        const b = baking = ask("baked", { type: "bake" });
        /* (a failed bake is not kept: the next asks again, as world.js's does) */
        b.then((ok) => { if (!ok && baking === b) baking = null; });
      }
      return baking;
    },
    /* (dt is the page's period: never sent, the worker measures its own, drew.dt) */
    draw(view, dt) { if (page) { page.draw(view, dt); return; } post({ type: "view", seq: ++seq, view }); },
    onDrew(fn) { drewFns.add(fn); return () => drewFns.delete(fn); },
    resize(w, h, scale) { size = [w, h, scale]; if (page) page.resize(w, h, scale); else post({ type: "resize", w, h, scale }); },
    finish() { if (page) page.finish(); else post({ type: "finish" }); },
    measure(sets) {
      if (page) return page.measure(sets);
      if (gone) return Promise.resolve(sets.map(() => NaN));
      return ask("measured", { type: "measure", sets }, { sets });
    },
    /* the worker's frame loop runs while a pad is drawing */
    run(on) { post({ type: "run", on: !!on }); },
    destroy() {
      if (page) { page.destroy(); return; }
      if (gone) return;
      post({ type: "destroy" });
      gone = true;
      unlisten();
      try { worker?.terminate(); } catch { /* gone already */ }
      for (const a of pending.values()) a.resolve(a.kind === "baked" ? false : a.sets.map(() => NaN));
      pending.clear();
      madeIs(false); asideIs(false);
    },
  };
}
