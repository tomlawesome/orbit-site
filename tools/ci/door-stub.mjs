/*
 * The stub page the door-* tests share (tools/ci/door-*-test.mjs): no dependencies, no browser. Not a test itself.
 * Each test file runs every case in a fresh Node process (the file again, as `--child <case>`), because the door's
 * state lives for the life of a page. This module gives a child a stub page (a fake WebGL2 context that records its
 * calls, the globals the door reads), a virtual clock for the cases that would otherwise wait seconds, and the
 * parent's helpers (runCase, check).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const INDEX = "../../assets/door/index.js";

/* a stub for anything: any property is another stub, any call answers one, arithmetic on it is 0 */
export const any = () => new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : any()),
  set: () => true,
  apply: () => any(),
});

export const realSetTimeout = globalThis.setTimeout;
export const realSetImmediate = globalThis.setImmediate;
export const sleep = (ms) => new Promise((r) => realSetTimeout(r, ms));

/* the crop probe's source: texelFetch of one texel into a transform-feedback buffer (upload.js, capability.js) */
export const isProbeSrc = (s) => /texelFetch\(t, ivec2\(0, 0\), 0\)|precision mediump float; out vec4 o;/.test(String(s));

/*
 * installPage(opts) -> page. opts.fetch: the page's fetch (default: refuses). opts.hidden: document.hidden.
 * page.glBase is the fake context's own methods: a test may replace one before the door touches it. Everything the
 * context is asked is recorded on the page (shaders, tex, createdTextures, deletedTextures, bufCalls, readPixels).
 */
export function installPage(opts = {}) {
  const page = {
    lines: [], shaders: [], tex: [], bufCalls: [], createdTextures: [], deletedTextures: [], readPixels: 0,
    contexts: 0, removed: 0, glCalls: 0, draws: 0, glWhileLost: 0, mipped: [], docListeners: {}, winListeners: {}, canvasListeners: {}, bodyClasses: new Set(), bodyLog: [],
    images: [], blobURLs: [], revoked: [], paints: [], lost: false, boundTexture: null,
  };
  let sharedCanvas = null;
  const glBase = {
    RGBA: 1, UNSIGNED_BYTE: 2, RENDERER: 0x1f01, TEXTURE_2D: 0xde1,
    isContextLost: () => page.lost,
    getError: () => 0,
    getExtension(name) {
      if (name === "WEBGL_lose_context") return { loseContext() { page.lost = true; } };
      if (name === "WEBGL_debug_renderer_info") return null;
      return { COMPLETION_STATUS_KHR: 0x91b1 };
    },
    getParameter: () => "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)",
    getProgramParameter: () => true, getShaderParameter: () => true,
    getProgramInfoLog: () => "", getShaderInfoLog: () => "",
    getActiveUniform: (p, i) => ({ name: `u${i}` }),
    getUniformLocation: (p, n) => ({ n }),
    checkFramebufferStatus: () => 0x8cd5, FRAMEBUFFER_COMPLETE: 0x8cd5,
    readPixels() { page.readPixels++; },
    clientWaitSync: () => 1,                                      /* ALREADY_SIGNALED */
    getBufferSubData(t, o, out) { out[0] = 0; out[1] = 1; },      /* the crop is honoured: the pictures go in bands */
    createShader(type) { const s = { type, src: "" }; page.shaders.push(s); return s; },
    shaderSource(s, src) { if (s) s.src = src; },
    createProgram() { return { shaders: [] }; },
    attachShader(p, s) { p?.shaders?.push(s); },
    createTexture() { const t = { id: page.createdTextures.length }; page.createdTextures.push(t); return t; },
    deleteTexture(t) { page.deletedTextures.push(t); },
    bindTexture(target, t) { page.boundTexture = t; },
    texImage2D(...a) { const src = a.length === 6 ? a[5] : null; page.tex.push({ fn: "texImage2D", probe: !!src?.probe, texture: page.boundTexture }); },
    texSubImage2D(...a) { const src = a[a.length - 1]; page.tex.push({ fn: "texSubImage2D", probe: !!src?.probe, texture: page.boundTexture }); },
    texStorage2D() { page.tex.push({ fn: "texStorage2D", probe: false, texture: page.boundTexture }); },
    generateMipmap() { page.mipped.push(page.boundTexture); },
    bufferData(t, data) { page.bufCalls.push({ vertex: ArrayBuffer.isView(data) }); },
  };
  page.glBase = glBase;
  /* every call on the context is counted (page.glCalls: all; page.draws: draw calls; page.glWhileLost: any call made while the context is lost) */
  const quiet = new Set(["isContextLost", "getError"]);
  const counted = (k, f) => (...a) => {
    if (!quiet.has(k)) {
      page.glCalls++;
      if (/^draw/.test(k)) page.draws++;
      if (page.lost) page.glWhileLost++;
    }
    return f(...a);
  };
  page.gl = new Proxy(glBase, { get: (t, k) => (k in t ? (typeof t[k] === "function" && typeof k === "string" ? counted(k, t[k]) : t[k]) : typeof k === "string" && /^[A-Z0-9_]+$/.test(k) ? 1 : typeof k === "string" ? counted(k, () => any()) : () => any()) });

  const mkCanvas = () => {
    const c = {
      width: 300, height: 150, style: {}, id: "", setAttribute() {}, remove() { page.removed++; },
      addEventListener(type, fn) { if (c === sharedCanvas) (page.canvasListeners[type] ||= []).push(fn); },
      removeEventListener(type, fn) { if (c === sharedCanvas && page.canvasListeners[type]) page.canvasListeners[type] = page.canvasListeners[type].filter((f) => f !== fn); },
      getContext(kind) { if (kind === "webgl2") { sharedCanvas ||= c; page.contexts++; return page.gl; } return page.ctx2d(c); },
      toBlob(cb) { Promise.resolve(page.blobGate(c)).then(() => cb(page.blobOf(c))); },
      convertToBlob: async () => { await page.blobGate(c); return page.blobOf(c); },
    };
    return c;
  };
  /* a 2D context that records every call with the size of the canvas at that moment */
  page.ctx2d = (c) => new Proxy({}, {
    get: (t, k) => (k === "canvas" ? c : k in t ? t[k] : typeof k === "symbol" ? undefined : (...a) => { page.paints.push({ op: String(k), w: c.width, h: c.height }); return any(); }),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  page.blobGate = () => undefined;          /* tests hold a picture's encode step by returning a promise */
  page.blobOf = (c) => ({ size: 1, w: c.width, h: c.height, type: "image/png" });

  page.imageHook = (img) => { img.fire("load"); };     /* tests replace: what a picture does when its src is set */
  class StubImage {
    constructor() { this.complete = false; this.naturalWidth = 0; this.listeners = {}; this.style = {}; page.images.push(this); }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
    setAttribute(k, v) { if (k === "src") this.src = v; }
    set src(v) { this._src = v; realSetTimeout(() => { page.imageHook(this); }, 0); }
    get src() { return this._src; }
    fire(type) {
      if (type === "load") { this.complete = true; this.naturalWidth = 64; this.naturalHeight = 64; }
      if (type === "error") { this.complete = true; this.failed = true; }          /* as a browser: a failed picture is complete, 0 wide */
      const ev = { type, target: this };
      if (typeof this["on" + type] === "function") this["on" + type](ev);
      for (const f of [...(this.listeners[type] || [])]) f(ev);
    }
    decode() { return this.failed ? Promise.reject(new Error("decode failed")) : this.complete ? Promise.resolve() : new Promise((ok, no) => { (this.listeners.load ||= []).push(ok); (this.listeners.error ||= []).push(() => no(new Error("decode failed"))); }); }
    remove() {}
  }
  globalThis.Image = StubImage;
  page.StubImage = StubImage;

  const classList = {
    add(...n) { for (const x of n) { page.bodyClasses.add(x); page.bodyLog.push({ op: "add", name: x, at: performance.now() }); } },
    remove(...n) { for (const x of n) { page.bodyClasses.delete(x); page.bodyLog.push({ op: "remove", name: x, at: performance.now() }); } },
    contains: (x) => page.bodyClasses.has(x),
    toggle(x, force) { const on = force === undefined ? !page.bodyClasses.has(x) : !!force; (on ? classList.add : classList.remove)(x); return on; },
  };
  const doc = {
    hidden: !!opts.hidden, visibilityState: opts.hidden ? "hidden" : "visible",
    body: { classList, style: {}, dataset: {}, appendChild() {}, removeChild() {} },
    documentElement: { classList: { add() {}, remove() {}, contains: () => false }, style: {}, dataset: {} },
    fonts: { ready: Promise.resolve() },
    addEventListener(type, fn) { (page.docListeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { page.docListeners[type] = (page.docListeners[type] || []).filter((f) => f !== fn); },
    createElement: (tag) => (tag === "canvas" ? mkCanvas() : tag === "img" ? new StubImage() : any()),
    createElementNS: () => any(), createTextNode: () => any(),
    querySelector: (sel) => page.query(sel), querySelectorAll: () => [], getElementById: () => null,
  };
  page.query = () => any();                  /* tests answer document.querySelector */
  globalThis.document = doc;
  page.document = doc;
  page.setHidden = (h) => {
    doc.hidden = h; doc.visibilityState = h ? "hidden" : "visible";
    for (const fn of [...(page.docListeners.visibilitychange || [])]) fn({ type: "visibilitychange" });
    for (const fn of [...(page.winListeners.visibilitychange || [])]) fn({ type: "visibilitychange" });
  };
  page.resize = (w, h) => {
    globalThis.innerWidth = w; globalThis.innerHeight = h;
    for (const fn of [...(page.winListeners.resize || [])]) fn({ type: "resize" });
  };
  page.loseContext = () => {
    page.lost = true;
    for (const fn of [...(page.canvasListeners.webglcontextlost || [])]) fn({ type: "webglcontextlost", preventDefault() {} });
  };

  globalThis.window = globalThis;
  globalThis.innerWidth = 1280; globalThis.innerHeight = 800; globalThis.devicePixelRatio = 1;
  globalThis.addEventListener = (type, fn) => { (page.winListeners[type] ||= []).push(fn); };
  globalThis.removeEventListener = (type, fn) => { page.winListeners[type] = (page.winListeners[type] || []).filter((f) => f !== fn); };
  globalThis.requestAnimationFrame = (f) => globalThis.setTimeout(f, 2);
  globalThis.cancelAnimationFrame = (id) => globalThis.clearTimeout(id);
  globalThis.requestIdleCallback = (f) => globalThis.setTimeout(f, 5);
  globalThis.cancelIdleCallback = (id) => globalThis.clearTimeout(id);
  globalThis.getComputedStyle = () => ({ animationName: "none", getPropertyValue: () => "" });
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
  globalThis.Path2D = class { constructor() { return any(); } };
  globalThis.ImageData = class { constructor() { this.probe = true; } };
  globalThis.OffscreenCanvas = class {
    constructor(w, h) { this.width = w; this.height = h; }
    getContext() { return page.ctx2d(this); }
    convertToBlob() { return Promise.resolve(page.blobGate(this)).then(() => page.blobOf(this)); }
    transferToImageBitmap() { return { width: this.width, height: this.height, close() {} }; }
  };
  /* a bitmap: the crop probe's (and what is cut from it) is marked, so the probe is left out of the counts */
  globalThis.createImageBitmap = async (src, ...r) => {
    const cut = r.length >= 4;
    return { width: cut ? r[2] : (src?.probe ? 1 : 64), height: cut ? r[3] : (src?.probe ? 2 : 64), probe: !!src?.probe, close() {} };
  };
  globalThis.fetch = opts.fetch || (() => Promise.reject(new Error("no network here")));
  let n = 0;
  URL.createObjectURL = (blob) => { const u = `blob:stub/${++n}`; page.blobURLs.push({ url: u, w: blob?.w, h: blob?.h }); return u; };
  URL.revokeObjectURL = (u) => { page.revoked.push(u); };
  const say = (...a) => { page.lines.push(a.join(" ")); };
  console.info = say; console.log = say; console.warn = () => {}; console.error = () => {};

  /* a journey's host canvas: a 2D canvas in a parent, where the world's canvas goes under it */
  page.hostCanvas = () => {
    const parent = { insertBefore() {} };
    return { width: 300, height: 150, style: {}, parentNode: parent, getContext: () => any(), addEventListener() {}, removeEventListener() {}, setAttribute() {} };
  };
  page.journeyOptions = () => ({ canvas: page.hostCanvas(), name: any(), dawnGlyph: () => null, duskGlyph: () => null, on: {} });
  /* the textures a picture was put on (the crop probe's own are left out) */
  page.mapTextures = () => new Set(page.tex.filter((c) => !c.probe && c.texture).map((c) => c.texture));
  return page;
}

/*
 * installClock() -> { advance(ms, until?) }: setTimeout, performance.now, Date.now and the frame callbacks run on a
 * virtual clock, moved only by advance(); each step drains the promises first. A case that would wait seconds in real
 * life waits none.
 *
 * It also stands in for the unclamped next task a scheduler yields through (#101: `page.yield(fn)`, which uses
 * MessageChannel where there is one): a MessageChannel whose postMessage runs the port's handler as an immediate on
 * the virtual clock (due now, ahead of any frame or timer), without a setTimeout, so a test sees a yield apart from a
 * timer. Each postMessage is counted: clock.yields(). clock.yieldDelay(ms) makes each message posted after it arrive
 * ms of virtual time later, as on a phone that paints between a frame and the next task (0 = an immediate, the default).
 */
export function installClock() {
  let now = 0, seq = 0, yielded = 0, delay = 0;
  const timers = new Map();
  const realMC = globalThis.MessageChannel;
  const real = { now: performance.now.bind(performance), date: Date.now };
  const flush = () => new Promise((r) => realSetImmediate(r));
  globalThis.setTimeout = (f, ms = 0, ...a) => { const id = ++seq; timers.set(id, { t: now + Math.max(0, Number(ms) || 0), f, a, id, seq: id }); return id; };
  globalThis.clearTimeout = (id) => { timers.delete(id); };
  globalThis.setInterval = (f, ms = 0, ...a) => { const id = ++seq; const tick = () => { timers.set(id, { t: now + Math.max(1, Number(ms) || 1), f: () => { tick(); f(...a); }, a: [], id, seq: ++seq }); }; tick(); return id; };
  globalThis.clearInterval = globalThis.clearTimeout;
  globalThis.requestAnimationFrame = (f) => globalThis.setTimeout(() => f(now), 16);
  globalThis.cancelAnimationFrame = globalThis.clearTimeout;
  globalThis.requestIdleCallback = (f) => globalThis.setTimeout(() => f({ didTimeout: false, timeRemaining: () => 50 }), 5);
  globalThis.cancelIdleCallback = globalThis.clearTimeout;
  globalThis.MessageChannel = class {
    constructor() {
      const mk = () => ({ onmessage: null, listeners: [], addEventListener(t, f) { if (t === "message") this.listeners.push(f); }, removeEventListener(t, f) { this.listeners = this.listeners.filter((x) => x !== f); }, start() {}, close() { this.closed = true; } });
      const a = mk(), b = mk();
      const post = (to) => (data) => {
        yielded++;
        const id = ++seq;
        timers.set(id, { t: now + delay, f: () => { if (to.closed) return; const ev = { data }; if (typeof to.onmessage === "function") to.onmessage(ev); for (const f of [...to.listeners]) f(ev); }, a: [], id, seq: id });
      };
      a.postMessage = post(b); b.postMessage = post(a);
      this.port1 = a; this.port2 = b;
    }
  };
  Object.defineProperty(performance, "now", { value: () => now, configurable: true, writable: true });
  Date.now = () => 1.7e12 + now;
  return {
    now: () => now,
    yields: () => yielded,
    yieldDelay(ms) { delay = Math.max(0, Number(ms) || 0); },
    /* run virtual time forward by ms, or until until() is true (checked after every timer) */
    async advance(ms, until = () => false) {
      const end = now + ms;
      await flush();
      while (!until()) {
        let next = null;
        for (const t of timers.values()) if (t.t <= end && (!next || t.t < next.t || (t.t === next.t && t.seq < next.seq))) next = t;
        if (!next) { now = end; break; }
        timers.delete(next.id);
        now = Math.max(now, next.t);
        try { next.f(...next.a); } catch { /* the page's own error */ }
        await flush();
      }
      await flush();
      return now;
    },
    restore() { globalThis.setTimeout = realSetTimeout; globalThis.MessageChannel = realMC; Object.defineProperty(performance, "now", { value: real.now, configurable: true, writable: true }); Date.now = real.date; },
  };
}

/* the child's entry: run the named case, print its result, exit */
export async function childMain(cases) {
  const how = process.argv[3];
  const out = { error: null };
  try { Object.assign(out, (await cases[how]()) || {}); }
  catch (e) { out.error = String(e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e); }
  process.stdout.write("RESULT " + JSON.stringify(out) + "\n");
  process.exit(0);
}

/* the parent's: run a case in a fresh process */
export function runCase(fileUrl, how, timeout = 60000) {
  const r = spawnSync(process.execPath, [fileURLToPath(fileUrl), "--child", how], { encoding: "utf8", timeout });
  const line = (r.stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) return { error: `the child printed no result (exit ${r.status}): ${(r.stderr || "").split("\n").slice(0, 3).join(" | ")}` };
  return JSON.parse(line.slice(7));
}

let failed = false;
export const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};
export const finish = () => process.exit(failed ? 1 : 0);
export const errOf = (r) => (r.error ? `; ${r.error}` : "");

/*
 * The dawn's host for D7: querySelector(".world") -> a world whose ".earth image[data-href]" are the Earth's two
 * pictures (SVG <image> elements, the first the quick one: dawn-pre). A picture's href set = the picture asked for;
 * what it then does (load or error) is up to the test: onAsked(el, index).
 */
export function earthElement(name, onAsked) {
  const attrs = { "data-href": `img/dawn/${name}.webp` };
  const listeners = {};
  const base = {
    name, dataset: { href: attrs["data-href"] }, style: { setProperty() {}, removeProperty() {} }, listeners,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    hasAttribute: (k) => k in attrs,
    removeAttribute: (k) => { delete attrs[k]; },
    setAttribute(k, v) { attrs[k] = String(v); if (/href$/.test(k)) onAsked(el); },
    setAttributeNS(ns, k, v) { attrs[k] = String(v); if (/href$/.test(k)) onAsked(el); },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
    fire(type) { const ev = { type, target: el }; if (typeof el["on" + type] === "function") el["on" + type](ev); for (const f of [...(listeners[type] || [])]) f(ev); },
    complete: false, naturalWidth: 0,
  };
  const el = new Proxy(base, {
    get: (t, k) => (k in t ? t[k] : k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : any()),
    set: (t, k, v) => { t[k] = v; if (k === "href" || k === "src") { attrs.href = String(v); onAsked(el); } return true; },
  });
  return el;
}
export function dawnHost(onAsked) {
  const pics = [earthElement("dawn-pre", onAsked), earthElement("dawn", onAsked)];
  const classes = new Set();
  const world = new Proxy({
    dataset: {}, style: { setProperty() {}, removeProperty() {} }, clientWidth: 1280, clientHeight: 800, classes,
    classList: { add: (...n) => n.forEach((x) => classes.add(x)), remove: (...n) => n.forEach((x) => classes.delete(x)), contains: (x) => classes.has(x), toggle: (x, f) => { (f ?? !classes.has(x)) ? classes.add(x) : classes.delete(x); return classes.has(x); } },
    querySelectorAll: (sel) => (/\.earth image\[data-href\]/.test(sel) ? pics : /image\.pre/.test(sel) ? [pics[0]] : []),
    querySelector: (sel) => (/image\.pre|\.pre\b/.test(sel) ? pics[0] : any()),
    getBoundingClientRect: () => ({ width: 1280, height: 800 }),
  }, { get: (t, k) => (k in t ? t[k] : k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : any()), set: (t, k, v) => { t[k] = v; return true; } });
  const host = new Proxy({ querySelector: (sel) => (sel === ".world" ? world : any()), querySelectorAll: () => [], dataset: {}, style: { setProperty() {} } },
    { get: (t, k) => (k in t ? t[k] : k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : any()), set: (t, k, v) => { t[k] = v; return true; } });
  return { host, pics, world };
}

/* observers the page makes, recorded: ob.mutation / ob.resize hold every one, each with `.on` while it observes */
export function installObservers() {
  const ob = { mutation: [], resize: [] };
  const make = (list) => class {
    constructor(cb) { this.cb = cb; this.on = false; list.push(this); }
    observe() { this.on = true; } unobserve() {} disconnect() { this.on = false; } takeRecords() { return []; }
  };
  globalThis.MutationObserver = make(ob.mutation);
  globalThis.ResizeObserver = make(ob.resize);
  ob.active = () => ob.mutation.filter((o) => o.on).length + ob.resize.filter((o) => o.on).length;
  return ob;
}
/* what the page's listeners come to: resize on window, visibilitychange on window and document */
export const listenerCounts = (page) => ({
  resize: (page.winListeners.resize || []).length,
  visibility: (page.docListeners.visibilitychange || []).length + (page.winListeners.visibilitychange || []).length,
});
/*
 * Mount the dawn with the live door as a host does (flags door3d, the level asked for as high as the flag allows) on the
 * stub page: returns { door, dawn, ob, baseline } with the listener counts taken before the dawn was mounted.
 * The fake context cannot make the capability probe say ok (see the report), so the live door runs as its "lean" one.
 */
export async function mountLive(page, extraFlags = {}) {
  const ob = installObservers();
  const { host, world } = dawnHost(() => {});
  page.query = (sel) => (/#door .world/.test(sel) ? world : any());
  const door = await import(INDEX);
  const d = door.createDoor({ typingWait: 0, flags: { door3d: "1", level: "2", ...extraFlags } });
  door.gpu();
  door.openChores();
  const baseline = listenerCounts(page);
  const dawn = d.dawn(host);
  return { door, d, dawn, ob, baseline, host, world };
}

/*
 * trackGl(page) -> tr: records what the page's WebGL contexts and canvases are asked, for the live door's tests. Call it
 * right after installPage(), before anything asks for a context. The first canvas to ask for webgl2 is the gate's and
 * gets the page's own fake context; every later canvas gets a context of its own (a distinct object whose
 * isContextLost() and WEBGL_lose_context are its own), so "a fresh context" can be told from "the lost one".
 *   tr.objects   every texture, buffer, framebuffer and vertex array made: { kind, id, released, probe }; the crop
 *                probe's (a texture it puts a probe image on, a buffer it reads back) are marked probe
 *   tr.live()    the objects made and not released, the probe's left out: { texture, buffer, framebuffer, vertexArray }
 *   tr.faults    a delete of an object never made, or twice
 *   tr.canvases  every canvas the page made, each with a classList (and className) and its listeners in .listeners
 *   tr.contexts  the webgl2 contexts handed out, in order: { canvas, gl, gate }; gl.__state.lost says if it is lost
 *   tr.lose(i)   lose context i as a browser does (isContextLost() true, then webglcontextlost on its canvas)
 *   tr.everLive  the canvases that were ever given the class "live"
 */
export function trackGl(page) {
  const KINDS = ["texture", "buffer", "framebuffer", "vertexArray"];
  const tr = { objects: [], faults: [], canvases: [], contexts: [], everLive: new Set(), gate: null };
  const boundTex = {}, boundBuf = {};
  const g = page.glBase;
  for (const kind of KINDS) {
    const K = kind[0].toUpperCase() + kind.slice(1);
    const make = g["create" + K], drop = g["delete" + K];
    g["create" + K] = () => {
      const h = (make ? make() : {}) || {};
      Object.assign(h, { kind, released: false, probe: false, n: tr.objects.length });
      tr.objects.push(h);
      return h;
    };
    g["delete" + K] = (h) => {
      if (h == null) return;
      if (!tr.objects.includes(h)) tr.faults.push(`delete${K} of an object never made`);
      else if (h.released) tr.faults.push(`delete${K} of #${h.n} twice`);
      else { h.released = true; if (drop) drop(h); }
    };
  }
  const bindTexture = g.bindTexture, bindBuffer = g.bindBuffer, tex = g.texImage2D, sub = g.texSubImage2D, readBack = g.getBufferSubData;
  g.bindTexture = (t, h) => { boundTex[t] = h; return bindTexture(t, h); };
  g.bindBuffer = (t, h) => { boundBuf[t] = h; };
  g.texImage2D = (...a) => { if (a[a.length - 1]?.probe && boundTex[a[0]]) boundTex[a[0]].probe = true; return tex(...a); };
  g.texSubImage2D = (...a) => { if (a[a.length - 1]?.probe && boundTex[a[0]]) boundTex[a[0]].probe = true; return sub(...a); };
  g.getBufferSubData = (t, o, out) => { if (boundBuf[t]) boundBuf[t].probe = true; return readBack(t, o, out); };
  tr.live = () => Object.fromEntries(KINDS.map((k) => [k, tr.objects.filter((h) => h.kind === k && !h.probe && !h.released).length]));
  tr.liveTotal = () => Object.values(tr.live()).reduce((n, x) => n + x, 0);

  const ownGl = () => {
    const state = { lost: false };
    const lose = { loseContext() { state.lost = true; }, restoreContext() { state.lost = false; } };
    return new Proxy(page.gl, {
      get: (t, k) => (k === "isContextLost" ? () => state.lost : k === "__state" ? state : k === "getExtension" ? (n) => (n === "WEBGL_lose_context" ? lose : t.getExtension(n)) : t[k]),
    });
  };
  const create = page.document.createElement;
  page.document.createElement = (tag) => {
    const c = create(tag);
    if (tag !== "canvas") return c;
    const classes = new Set();
    const note = (n) => { classes.add(n); if (n === "live") tr.everLive.add(c); };
    c.classList = {
      add(...n) { n.forEach(note); }, remove(...n) { n.forEach((x) => classes.delete(x)); }, contains: (x) => classes.has(x),
      toggle(x, f) { const on = f === undefined ? !classes.has(x) : !!f; if (on) note(x); else classes.delete(x); return on; },
    };
    Object.defineProperty(c, "className", { get: () => [...classes].join(" "), set: (v) => { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(note); }, configurable: true });
    c.listeners = {};
    const add = c.addEventListener, rem = c.removeEventListener, get = c.getContext;
    c.addEventListener = (type, fn) => { (c.listeners[type] ||= []).push(fn); add(type, fn); };
    c.removeEventListener = (type, fn) => { c.listeners[type] = (c.listeners[type] || []).filter((f) => f !== fn); rem(type, fn); };
    c.getContext = (kind, ...r) => {
      if (kind !== "webgl2") return get(kind, ...r);
      if (!c.gl) {
        const gate = !tr.gate;
        if (gate) tr.gate = c;
        c.gl = gate ? get(kind, ...r) : ownGl();
        tr.contexts.push({ canvas: c, gl: c.gl, gate });
      }
      return c.gl;
    };
    tr.canvases.push(c);
    return c;
  };
  tr.lose = (i) => {
    const { canvas, gl } = tr.contexts[i];
    if (gl.__state) gl.__state.lost = true; else page.lost = true;
    for (const fn of [...(canvas.listeners.webglcontextlost || [])]) fn({ type: "webglcontextlost", preventDefault() {} });
  };
  return tr;
}

/*
 * ===== The flight drawn in a worker (ADR-0004 6a, tests D2-D5) =====
 * Everything below is new for the worker path and changes nothing above it. The page side (D2-D4): a small DOM whose
 * canvases have a parent, an id, a class and attributes and can be handed over (transferControlToOffscreen), and a
 * fake `Worker` that records what it is posted and says what a case tells it to. The worker side (D5): a stub `self`
 * and a global scope with no page in it, which draw-worker.js is imported into.
 */
export const WORKER = "../../assets/door/draw-worker.js";
export const BASE = "https://site.test/app/";
/* the paths the door asks the host's `image()` for when the flight is warmed (voyage.js pictures(); engine.js dawn.webp) */
export const PICTURE_PATHS = ["flight/earth-lights.webp", "flight/earth-day.webp", "flight/earth-clouds.webp", "flight/europe-lights.webp", "flight/moon.webp",
  "dawn/lights-near.webp", "dawn/clouds-near.webp", "dawn/land-near.webp", "dawn/dawn.webp"];
/* the host's font, as settings.fonts takes it (a relative url), and the same as the page posts it (absolute) */
export const FONTS = [{ family: "Test Mono", weight: 500, url: "assets/fonts/test-mono.woff2" }];
export const FONTS_ABS = [{ family: "Test Mono", weight: 500, url: new URL("assets/fonts/test-mono.woff2", BASE).href }];
/* the host's `image(path)`: a relative address under img/; the same resolved against BASE is what the page posts */
export const hostImage = (p) => "img/" + p;
export const absImage = (p) => new URL(hostImage(p), BASE).href;
export const IMAGES_ABS = Object.fromEntries(PICTURE_PATHS.map((p) => [p, absImage(p)]));

/* a 2D context that records every call on its canvas, with the (virtual) time of the call */
const recording2d = (page, c) => new Proxy({}, {
  get: (t, k) => (k === "canvas" ? c : k in t ? t[k] : typeof k === "symbol" ? undefined : (...a) => { c.ops.push({ op: String(k), at: performance.now() }); page.paints.push({ op: String(k), w: c.width, h: c.height }); return any(); }),
  set: (t, k, v) => { t[k] = v; return true; },
});
/* the calls that put something on a canvas (not the setting-up of gradients and paths) */
export const DRAW_OPS = new Set(["clearRect", "fillRect", "fill", "stroke", "drawImage", "fillText", "strokeText", "putImageData", "strokeRect"]);

/*
 * installDom(page, { baseURI }) -> dom. Call right after installPage(). Replaces document.createElement("canvas") with
 * canvases that live in a parent: dom.warp (#warp, in dom.parent) is the journey's canvas. A canvas handed over
 * (transferControlToOffscreen) returns a plain token (dom.tokenOf) and gives no context again, as in a browser (it
 * throws). dom.find(id) is the canvas with that id that is in the page. HTMLCanvasElement is the canvas class.
 */
export function installDom(page, { baseURI = BASE } = {}) {
  const dom = { canvases: [], tokens: new Map(), parent: null, warp: null };
  let tokenN = 0;
  class Parent {
    constructor() { this.children = []; }
    insertBefore(n, ref) {
      if (n.parentNode) n.parentNode.removeChild(n);
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i < 0) this.children.push(n); else this.children.splice(i, 0, n);
      n.parentNode = this; return n;
    }
    appendChild(n) { return this.insertBefore(n, null); }
    append(...ns) { for (const n of ns) this.insertBefore(n, null); }
    removeChild(n) { const i = this.children.indexOf(n); if (i >= 0) this.children.splice(i, 1); n.parentNode = null; return n; }
    replaceChild(n, old) {
      if (n === old) return old;
      if (n.parentNode) n.parentNode.removeChild(n);
      const i = this.children.indexOf(old);
      if (i < 0) throw new Error("replaceChild: the old child is not here");
      this.children[i] = n; n.parentNode = this; old.parentNode = null; return old;
    }
  }
  class Canvas {
    constructor() {
      this.attrs = new Map(); this.parentNode = null; this.style = {}; this.dataset = {};
      this.width = 300; this.height = 150; this.transferred = false; this.token = null; this.gotContext = null;
      this.ops = []; this.listeners = {}; this.c2d = null;
      dom.canvases.push(this);
    }
    get id() { return this.attrs.get("id") ?? ""; }
    set id(v) { this.attrs.set("id", String(v)); }
    get className() { return this.attrs.get("class") ?? ""; }
    set className(v) { this.attrs.set("class", String(v)); }
    get classList() {
      const self = this, list = () => self.className.split(/\s+/).filter(Boolean);
      return {
        add(...n) { self.className = [...new Set([...list(), ...n])].join(" "); },
        remove(...n) { self.className = list().filter((x) => !n.includes(x)).join(" "); },
        contains: (x) => list().includes(x),
        toggle(x, f) { const on = f === undefined ? !list().includes(x) : !!f; (on ? this.add : this.remove).call(this, x); return on; },
      };
    }
    setAttribute(k, v) { this.attrs.set(k, String(v)); }
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
    hasAttribute(k) { return this.attrs.has(k); }
    removeAttribute(k) { this.attrs.delete(k); }
    getAttributeNames() { return [...this.attrs.keys()]; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
    getContext(kind) {
      if (this.transferred) throw new Error("InvalidStateError: the canvas has been handed to an OffscreenCanvas");
      this.gotContext ||= kind;
      if (kind === "webgl2") { page.contexts++; return page.gl; }
      return (this.c2d ||= recording2d(page, this));
    }
    transferControlToOffscreen() {
      if (this.transferred || this.gotContext) throw new Error("InvalidStateError: the canvas cannot be handed over");
      this.transferred = true;
      this.token = { offscreen: ++tokenN };
      dom.tokens.set(this.token, this);
      return this.token;
    }
    dispatchEvent(ev) { for (const f of [...(this.listeners[ev.type] || [])]) f(ev); return !ev.defaultPrevented; }
    remove() { this.parentNode?.removeChild(this); }
    replaceWith(n) { this.parentNode?.replaceChild(n, this); }
    before(n) { this.parentNode?.insertBefore(n, this); }
    after(n) { const p = this.parentNode; if (p) p.insertBefore(n, p.children[p.children.indexOf(this) + 1] ?? null); }
    /* what a test reads: whether this one is in the page */
    get inPage() { return !!this.parentNode; }
  }
  dom.Canvas = Canvas;
  dom.parent = new Parent();
  dom.tokenOf = (c) => c.token;
  dom.find = (id) => dom.canvases.find((c) => c.parentNode && c.id === id) ?? null;
  dom.inPage = () => dom.canvases.filter((c) => c.parentNode);
  const doc = page.document, create = doc.createElement;
  doc.createElement = (tag) => (tag === "canvas" ? new Canvas() : create(tag));
  doc.baseURI = baseURI;
  doc.getElementById = (id) => dom.find(id);
  doc.querySelector = (sel) => { const m = /^#([\w-]+)$/.exec(sel); return m ? dom.find(m[1]) : page.query(sel); };
  globalThis.HTMLCanvasElement = Canvas;
  dom.warp = new Canvas();
  dom.warp.id = "warp"; dom.warp.className = "warp-canvas lit"; dom.warp.setAttribute("aria-hidden", "true"); dom.warp.setAttribute("data-role", "flight");
  dom.parent.appendChild(dom.warp);
  dom.journeyOptions = (on = {}) => ({ canvas: dom.warp, name: any(), dawnGlyph: () => null, duskGlyph: () => null, on });
  return dom;
}

/*
 * fakeWorkers(auto) -> host. host.make() is what a case's `drawWorker` returns; every worker made is in host.list.
 * A worker records what it is posted (posted, transfers, late: posted after terminate, cloneErrors: a message
 * structured clone could not carry), counts terminate(), and says what it is told with say(msg) (a message event) or
 * fail() (an error event), through onmessage / addEventListener alike. `auto` makes the common answers by itself, on
 * the clock: up (after `canvases`), warmed (after `warm`) and frame (after `start`), the last two only once it has
 * said `up` (a worker answers in order when it is ready); a case sets host.auto.x = null to say nothing.
 */
export function fakeWorkers(auto = {}) {
  const host = { made: 0, list: [], auto: { up: { ok: true, renderer: "stub renderer" }, warmed: true, frame: true, ...auto } };
  class FakeWorker {
    constructor() {
      host.made++; host.list.push(this);
      this.posted = []; this.postedAt = []; this.transfers = []; this.late = []; this.cloneErrors = []; this.terminated = 0; this.upSaid = false; this.waiting = [];
      this.on = { message: [], error: [], messageerror: [] };
      this.onmessage = null; this.onerror = null; this.onmessageerror = null;
    }
    postMessage(msg, transfer) {
      if (this.terminated) { this.late.push(msg); return; }
      try { structuredClone(msg); } catch (e) { this.cloneErrors.push(`${msg && msg.type}: ${e && e.message}`); }
      this.posted.push(msg); this.transfers.push(transfer ?? []); this.postedAt.push(performance.now());
      if (msg && msg.type === "canvases" && host.auto.up) setTimeout(() => this.say({ type: "up", ...host.auto.up }), 0);
      this.answer(msg);
    }
    /* a worker answers in order once it is up: a message that comes before is answered when `up` is said */
    answer(msg) {
      const a = host.auto;
      if (!msg || (msg.type !== "warm" && msg.type !== "start")) return;
      if (!this.upSaid) { this.waiting.push(msg); return; }
      if (msg.type === "warm" && a.warmed) setTimeout(() => this.say({ type: "warmed", id: msg.id, ok: true }), 0);
      if (msg.type === "start" && a.frame) setTimeout(() => this.say({ type: "frame", seq: msg.seq, world: true }), 0);
    }
    terminate() { this.terminated++; }
    addEventListener(type, fn) { (this.on[type] ||= []).push(fn); }
    removeEventListener(type, fn) { this.on[type] = (this.on[type] || []).filter((f) => f !== fn); }
    say(data) {
      if (this.terminated) return;
      if (data && data.type === "up" && data.ok) { this.upSaid = true; for (const m of this.waiting.splice(0)) this.answer(m); }
      const ev = { type: "message", data, target: this };
      if (typeof this.onmessage === "function") this.onmessage(ev);
      for (const f of [...this.on.message]) f(ev);
    }
    fail(message = "the worker failed") {
      if (this.terminated) return;
      const ev = { type: "error", message, error: new Error(message), target: this, preventDefault() {} };
      if (typeof this.onerror === "function") this.onerror(ev);
      for (const f of [...this.on.error]) f(ev);
    }
    of(type) { return this.posted.filter((m) => m && m.type === type); }
  }
  host.make = () => new FakeWorker();
  host.first = () => host.list[0] ?? null;
  return host;
}

/*
 * bootWorkerPage(o) -> { page, clock, dom, host, door, d, journey }: the stub page for D2-D4 with the worker path
 * possible: a Worker, OffscreenCanvas and HTMLCanvasElement.prototype.transferControlToOffscreen, a gate that reports no
 * background compile (parallel false, the Firefox tell) and no navigator.userAgentData, and the door made with a
 * drawWorker (the fake) and fonts. The virtual clock is installed; nothing is waited for in real time.
 *   o.draw          flags.draw ("worker" | "page"; absent: the automatic rule)
 *   o.flags         other flags
 *   o.worker=false  no drawWorker given;  o.fonts=false  no fonts given
 *   o.parallel      the gate's context has KHR_parallel_shader_compile (true)
 *   o.userAgentData navigator.userAgentData is defined;  o.saveData  navigator.connection.saveData
 *   o.noWorkerGlobal / o.noOffscreen / o.noTransfer   the browser lacks it
 *   o.hidden, o.settle, o.size [W, H, dpr], o.auto (fakeWorkers' answers)
 */
export async function bootWorkerPage(o = {}) {
  const page = installPage({ hidden: !!o.hidden });
  const clock = installClock();
  const dom = installDom(page, { baseURI: BASE });
  const [W, H, dpr] = o.size ?? [1280, 800, 1.5];
  globalThis.innerWidth = W; globalThis.innerHeight = H; globalThis.devicePixelRatio = dpr;
  globalThis.Worker = class Worker {};
  if (o.noWorkerGlobal) delete globalThis.Worker;
  if (o.noOffscreen) delete globalThis.OffscreenCanvas;
  if (o.noTransfer) delete dom.Canvas.prototype.transferControlToOffscreen;
  if (!o.parallel) {
    const get = page.glBase.getExtension;
    page.glBase.getExtension = (n) => (n === "KHR_parallel_shader_compile" ? null : get(n));
  }
  const nav = (k, v) => Object.defineProperty(globalThis.navigator, k, { value: v, configurable: true, writable: true });
  if (o.userAgentData) nav("userAgentData", { brands: [{ brand: "Chromium", version: "130" }], mobile: false });
  if (o.saveData) nav("connection", { saveData: true });
  const host = fakeWorkers(o.auto);
  const door = await import(INDEX);
  const given = { typingWait: 0, settle: o.settle ?? 700, image: hostImage, flags: { ...(o.draw ? { draw: o.draw } : {}), ...(o.flags || {}) } };
  if (o.worker !== false) given.drawWorker = () => host.make();
  if (o.fonts !== false) given.fonts = FONTS.map((f) => ({ ...f }));
  const d = door.createDoor(given);
  door.openChores();
  const journey = d.journey(dom.journeyOptions());
  return { page, clock, dom, host, door, d, journey, given };
}

/* what a case finds of the console: the lines about where the flight is drawn */
export const drawnLines = (page) => page.lines.filter((l) => /flight: drawn (in a worker|on the page)/.test(l));

/*
 * installWorkerSelf(page) -> w: the global scope of a dedicated worker, for D5, installed after installPage() and
 * installClock(): the page's own globals are taken away (a worker has no document, window, Image, innerWidth,
 * devicePixelRatio, matchMedia, getComputedStyle, localStorage or requestIdleCallback, so any touch of one throws),
 * `self` has postMessage / onmessage / close / fonts, and the transferred canvases (w.warp, w.warpgl) are
 * OffscreenCanvas fakes whose contexts are the stub's recording gl and 2D. It records: w.posted (what the worker
 * posted; w.cloneErrors: what structured clone could not carry), w.closed, w.rafs (animation frames asked, with
 * w.rafLog their times), w.fetched (urls fetched), w.faces / w.fontsAdded (FontFace made / added to self.fonts),
 * w.compiles (each compileShader: the frames asked by then and the chore queue then). w.holdFonts() makes FontFace
 * load() wait until the returned release() is called. w.send(msg) delivers a message to the worker.
 */
export function installWorkerSelf(page) {
  const w = {
    posted: [], cloneErrors: [], closed: 0, rafs: 0, rafLog: [], fetched: [], faces: [], fontsAdded: [], loads: 0,
    compiles: [], snaps: [], listeners: {}, chores: null, gate: null,
  };
  for (const k of ["document", "window", "Image", "innerWidth", "innerHeight", "devicePixelRatio", "matchMedia", "getComputedStyle", "localStorage", "requestIdleCallback", "cancelIdleCallback"]) delete globalThis[k];
  const raf = globalThis.requestAnimationFrame;
  const counted = (f) => { w.rafs++; w.rafLog.push(performance.now()); return raf(f); };
  globalThis.requestAnimationFrame = counted;
  const post = (m) => {
    try { structuredClone(m); } catch (e) { w.cloneErrors.push(`${m && m.type}: ${e && e.message}`); }
    w.posted.push(m);
  };
  const self_ = {
    postMessage: post, onmessage: null, close() { w.closed++; },
    fonts: { add(f) { w.fontsAdded.push(f); }, delete() {}, ready: Promise.resolve() },
    addEventListener(type, fn) { (w.listeners[type] ||= []).push(fn); }, removeEventListener() {},
    requestAnimationFrame: counted, cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  globalThis.self = self_;
  /* (the worker's global scope is `self`: its names are bare there too) */
  globalThis.postMessage = post; globalThis.close = self_.close;
  w.self = self_;
  w.send = (data) => {
    const ev = { type: "message", data };
    if (typeof self_.onmessage === "function") self_.onmessage(ev);
    for (const f of [...(w.listeners.message || [])]) f(ev);
  };
  w.of = (type) => w.posted.filter((m) => m && m.type === type);
  let fontGate = null;
  w.holdFonts = () => { let go; fontGate = new Promise((r) => { go = r; }); return () => go(); };
  globalThis.FontFace = class FontFace {
    constructor(family, source, descriptors) { this.family = family; this.source = source; this.descriptors = descriptors; this.status = "unloaded"; w.faces.push(this); }
    load() { w.loads++; this.status = "loading"; return (fontGate || Promise.resolve()).then(() => { this.status = "loaded"; return this; }); }
  };
  globalThis.fetch = async (url) => { w.fetched.push(String(url)); return { ok: true, status: 200, blob: async () => ({ size: 1, type: "image/webp" }) }; };
  /* the canvases a page hands over: sizes set on them are logged */
  const offscreen = (name) => {
    const c = {
      name, _w: 300, _h: 150, sizes: [], ops: [], listeners: {}, c2d: null,
      get width() { return c._w; }, set width(v) { c._w = v; c.sizes.push([c._w, c._h]); },
      get height() { return c._h; }, set height(v) { c._h = v; c.sizes.push([c._w, c._h]); },
      addEventListener(type, fn) { (c.listeners[type] ||= []).push(fn); }, removeEventListener() {},
      getContext(kind) { if (kind === "webgl2") { page.contexts++; return page.gl; } return (c.c2d ||= recording2d(page, c)); },
      transferToImageBitmap() { return { width: c._w, height: c._h, close() {} }; },
    };
    return c;
  };
  w.warp = offscreen("warp"); w.warpgl = offscreen("warpgl");
  /* the worker's gate context has no background compile, as on Firefox (so a compile would freeze whatever shares the thread) */
  const getExtension = page.glBase.getExtension;
  page.glBase.getExtension = (n) => (n === "KHR_parallel_shader_compile" ? null : getExtension(n));
  /* every shader compiled: how many frames had been asked by then, and what the chore queue held */
  page.glBase.compileShader = (s) => { w.compiles.push({ src: String(s?.src ?? ""), rafs: w.rafs, queued: w.chores ? w.chores().queued : [] }); };
  return w;
}

/*
 * chk(name, r, fn): a case's check, read safely. A case that errored, or found nothing to look at (r.none says why),
 * fails with that said plainly; fn(r) returns [ok, detail], and a result it cannot read fails with the result shown
 * (never a crash in the parent that hides the other cases).
 */
export function chk(name, r, fn) {
  if (r.error || r.none) { check(name, false, String(r.none || r.error)); return; }
  let ok = false, detail = "";
  try { [ok, detail] = fn(r); } catch (e) { detail = `the result could not be read (${e && e.message}): ${JSON.stringify(r).slice(0, 240)}`; }
  check(name, !!ok, detail);
}

/*
 * ===== The install and information worlds (ADR-0004 6b, tests W1 and W6; batch 2 builds on them) =====
 * Everything below is new for those tests and changes nothing above it. install.js and world.js run on the stub page
 * as they do on the site: a pad whose `.orbitgl` canvas can be handed over (transferControlToOffscreen returns a token,
 * and a handed-over canvas gives no context again) and whose contexts are the stub's recording gl, a `Worker` that is
 * only counted, and a gl whose uniforms are named and recorded.
 */

/* a node that can sit among a pad's children (the comment install.js leaves where the world's canvas was) */
class Marker {
  constructor() { this.parentNode = null; }
  before(n) { this.parentNode?.insertBefore(n, this); }
  after(n) { const p = this.parentNode; if (p) p.insertBefore(n, p.children[p.children.indexOf(this) + 1] ?? null); }
}

/*
 * bootInstallPage(o) -> b: bootWorkerPage(o) (the worker path possible: a gate that reports no background compile, no
 * userAgentData, Worker, OffscreenCanvas and a canvas that can be handed over; the door made with a drawWorker and fonts
 * unless o.worker / o.fonts are false), plus:
 *   b.workers       every `new Worker(...)` the page made after the boot (the arguments of each)
 *   b.fetched       every url fetched; o.failMap makes the planet's map (a url with "map") answer 503
 *   b.pad(id)       a pad element for createInstall: its `.orbitgl` canvas is pad.canvas
 *   o.renderer      the name the gl gives for RENDERER (default an ordinary GPU's)
 * The page's fetch answers every picture with a 1-byte blob; screen is 1280 x 800.
 */
export async function bootInstallPage(o = {}) {
  const b = await bootWorkerPage(o);
  const { page, dom } = b;
  b.workers = []; b.fetched = [];
  globalThis.Worker = class Worker {
    constructor(...a) { b.workers.push(a); this.terminated = 0; }
    postMessage() {} addEventListener() {} removeEventListener() {} terminate() { this.terminated++; }
  };
  globalThis.screen = { width: 1280, height: 800 };
  globalThis.fetch = async (url) => {
    const u = String(url);
    b.fetched.push(u);
    if (o.failMap && /map/.test(u)) return { ok: false, status: 503 };
    return { ok: true, status: 200, blob: async () => ({ size: 1, type: "image/webp" }) };
  };
  if (o.renderer) page.glBase.getParameter = () => o.renderer;
  page.document.createComment = () => new Marker();
  const Parent = dom.parent.constructor;
  b.pad = (id = "installpad") => {
    const pad = new Parent();
    const canvas = new dom.Canvas();
    canvas.className = "orbitgl"; canvas.setAttribute("aria-hidden", "true");
    pad.appendChild(canvas);
    const classes = new Set();
    Object.assign(pad, {
      id, hidden: false, clientWidth: 1280, clientHeight: 800, canvas, classes,
      classList: {
        add: (...n) => n.forEach((x) => classes.add(x)), remove: (...n) => n.forEach((x) => classes.delete(x)),
        contains: (x) => classes.has(x), toggle: (x, f) => { const on = f === undefined ? !classes.has(x) : !!f; (on ? classes.add(x) : classes.delete(x)); return on; },
      },
      querySelector: (sel) => (/\.orbitgl\b/.test(sel) ? (pad.children.find((c) => c.className === "orbitgl" || /\borbitgl\b/.test(c.className ?? "")) ?? null) : null),
    });
    return pad;
  };
  return b;
}

/* settled(promise, clock, ms) -> { state: "resolved" | "rejected" | "pending", value | error }: the promise's outcome after
   at most ms of virtual time (the clock runs on only until it is settled) */
export async function settled(p, clock, ms = 30000) {
  let out = { state: "pending" };
  Promise.resolve(p).then((value) => { out = { state: "resolved", value }; }, (error) => { out = { state: "rejected", error }; });
  await clock.advance(ms, () => out.state !== "pending");
  return out;
}

/*
 * namedUniforms(page) -> log: the stub gl gives each program the uniforms its shaders declare (in order, once each), so
 * a program's `u.uHue` is a location named "uHue", and every uniform call is appended to `log` as [function, name, ...values]
 * (typed arrays as plain arrays). Call before the world is made.
 */
export function namedUniforms(page) {
  const log = [];
  const names = (p) => {
    const out = [];
    for (const s of p?.shaders ?? []) {
      for (const m of String(s.src).matchAll(/\buniform\s+(?:(?:highp|mediump|lowp)\s+)?\w+\s+([^;]+);/g)) {
        for (const n of m[1].split(",")) { const name = /^\s*(\w+)/.exec(n)?.[1]; if (name && !out.includes(name)) out.push(name); }
      }
    }
    return out;
  };
  page.glBase.getProgramParameter = (p) => Math.max(1, names(p).length);
  page.glBase.getActiveUniform = (p, i) => ({ name: names(p)[i] ?? `u${i}` });
  const plain = (x) => (ArrayBuffer.isView(x) ? Array.from(x) : Array.isArray(x) ? x.slice() : x);
  for (const fn of ["uniform1f", "uniform1i", "uniform2f", "uniform2i", "uniform3f", "uniform4f", "uniform1fv", "uniform2fv", "uniform3fv", "uniform4fv", "uniform1iv", "uniformMatrix3fv", "uniformMatrix4fv"]) {
    page.glBase[fn] = (loc, ...a) => { log.push([fn, loc?.n ?? null, ...a.map(plain)]); };
  }
  return log;
}

/* the information's world as main.js writes it (INFO_WORLD), read from main.js itself so the test cannot drift from it:
   main.js starts the page when imported, so it is not imported. Returns the object, or throws saying why not. */
export async function infoWorld() {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../assets/js/main.js", import.meta.url), "utf8");
  const start = src.indexOf("const INFO_WORLD = {");
  const end = src.indexOf("\n};", start);
  if (start < 0 || end < 0) throw new Error("INFO_WORLD was not found in assets/js/main.js (this test reads it from there)");
  return new Function(`return ${src.slice(start + "const INFO_WORLD = ".length, end + 2)}`)();
}

/*
 * ===== The install and information worlds drawn in a worker (ADR-0004 6b, tests W2-W5 and W8) =====
 * Everything below is new for batch 2's tests and changes nothing above it (one method, dispatchEvent, was added to the
 * canvas class installDom makes: nothing called it before).
 */

/* a function found in a message, or null: a message must be plain data (structured clone carries no function) */
export const findFn = (x, path = "", seen = new Set()) => {
  if (typeof x === "function") return path || "(top)";
  if (!x || typeof x !== "object" || seen.has(x)) return null;
  seen.add(x);
  for (const k of Object.keys(x)) { const p = findFn(x[k], `${path}.${k}`, seen); if (p) return p; }
  return null;
};
/* a value as text, typed arrays tagged with their type, so a Float32Array and an Array of the same numbers differ */
export const plainOf = (v) => JSON.stringify(v, (k, x) => (ArrayBuffer.isView(x) ? { typed: x.constructor.name, v: Array.from(x) } : x));

/*
 * fakeWorldWorkers(auto) -> host: what `new Worker(...)` gives install.js (see installWorldWorker). Every worker made is in
 * host.list. A worker records what it is posted (posted, transfers, late: posted after terminate, cloneErrors: a message
 * structured clone could not carry), counts terminate(), and says what it is told with say(msg) (a message event) or
 * fail() (an error event), through onmessage / addEventListener alike. `auto` makes the common answers by itself on the
 * clock, a worker answering in order once it has said `up`:
 *   up        after `canvas`: { ok, why } (null: says nothing)         default { ok: true }
 *   compiled  after that `up` when ok: { ok, ms } (null: nothing)       default { ok: true, ms: 40 }
 *   baked     to each `bake`: true / { ok: false } (null: nothing)      default true
 *   measured  to each `measure`: the ms of each set, in order (the last for any more) (null: nothing)   default [10, 20]
 *   drew      to each `view`: { dt, ms } (dt a number, or a function of the view message); null: nothing   default { dt: 16.7, ms: 1 }
 * host.auto may be changed by a case at any time.
 */
export function fakeWorldWorkers(auto = {}) {
  const host = {
    made: 0, list: [], args: [],
    auto: { up: { ok: true }, compiled: { ok: true, ms: 40 }, baked: true, measured: [10, 20], drew: { dt: 16.7, ms: 1 }, ...auto },
  };
  class FakeWorld {
    constructor() {
      host.made++; host.list.push(this);
      this.posted = []; this.postedAt = []; this.transfers = []; this.late = []; this.cloneErrors = []; this.terminated = 0; this.upSaid = false; this.waiting = [];
      this.on = { message: [], error: [], messageerror: [] };
      this.onmessage = null; this.onerror = null; this.onmessageerror = null;
    }
    postMessage(msg, transfer) {
      if (this.terminated) { this.late.push(msg); return; }
      try { structuredClone(msg); } catch (e) { this.cloneErrors.push(`${msg && msg.type}: ${e && e.message}`); }
      this.posted.push(msg); this.transfers.push(transfer ?? []); this.postedAt.push(performance.now());
      if (msg && msg.type === "canvas" && host.auto.up) {
        setTimeout(() => {
          this.say({ type: "up", ...host.auto.up });
          if (host.auto.up.ok !== false && host.auto.compiled) setTimeout(() => this.say({ type: "compiled", ...host.auto.compiled }), 0);
        }, 0);
      }
      this.answer(msg);
    }
    answer(msg) {
      const a = host.auto;
      if (!msg || !["bake", "measure", "view"].includes(msg.type)) return;
      if (!this.upSaid) { this.waiting.push(msg); return; }
      if (msg.type === "bake" && a.baked) setTimeout(() => this.say({ type: "baked", id: msg.id, ok: a.baked === true || a.baked.ok !== false }), 0);
      if (msg.type === "measure" && a.measured) setTimeout(() => this.say({ type: "measured", id: msg.id, ms: (msg.sets || []).map((s, i) => a.measured[i] ?? a.measured[a.measured.length - 1]) }), 0);
      if (msg.type === "view" && a.drew) setTimeout(() => this.say({ type: "drew", seq: msg.seq, dt: typeof a.drew.dt === "function" ? a.drew.dt(msg) : a.drew.dt, ms: a.drew.ms ?? 1 }), 0);
    }
    terminate() { this.terminated++; }
    addEventListener(type, fn) { (this.on[type] ||= []).push(fn); }
    removeEventListener(type, fn) { this.on[type] = (this.on[type] || []).filter((f) => f !== fn); }
    say(data) {
      if (this.terminated) return;
      if (data && data.type === "up" && data.ok) { this.upSaid = true; for (const m of this.waiting.splice(0)) this.answer(m); }
      const ev = { type: "message", data, target: this };
      if (typeof this.onmessage === "function") this.onmessage(ev);
      for (const f of [...this.on.message]) f(ev);
    }
    fail(message = "the worker failed") {
      if (this.terminated) return;
      const ev = { type: "error", message, error: new Error(message), target: this, preventDefault() {} };
      if (typeof this.onerror === "function") this.onerror(ev);
      for (const f of [...this.on.error]) f(ev);
    }
    of(type) { return this.posted.filter((m) => m && m.type === type); }
  }
  host.make = (...a) => { host.args.push(a); return new FakeWorld(); };
  host.first = () => host.list[0] ?? null;
  return host;
}

/*
 * installWorldWorker(b, host): the page's `Worker` is the fake (b is bootInstallPage's result), so a site module that
 * makes its own worker (remote-world.js: `new Worker(new URL("./world-worker.js", import.meta.url), { type: "module" })`)
 * gets host's. Each `new Worker(...)` is in b.workers (its arguments) and host.args. The flight's own worker is the
 * door's `drawWorker` (the boot's), not this.
 */
export function installWorldWorker(b, host) {
  globalThis.Worker = class Worker { constructor(...a) { b.workers.push(a); return host.make(...a); } };
  return host;
}

/* a case that needs install.js's world.js import seen (world-spy.mjs): the child is run with the hook registered */
export function runCaseSpied(fileUrl, how, timeout = 120000) {
  const args = ["--import", fileURLToPath(new URL("./world-spy-register.mjs", import.meta.url)), fileURLToPath(fileUrl), "--child", how];
  const r = spawnSync(process.execPath, args, { encoding: "utf8", timeout });
  const line = (r.stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) return { error: `the child printed no result (exit ${r.status}): ${(r.stderr || "").split("\n").slice(0, 3).join(" | ")}` };
  return JSON.parse(line.slice(7));
}

/* a scene as install.js's form() and unform() take it: the door's planet, a body with a rectangle and a size */
export const sceneAt = (x = 380, y = 250, r = 28) => ({
  body: { getBoundingClientRect: () => ({ left: x - r, top: y - r, width: 2 * r, height: 2 * r }), closest: () => null, offsetWidth: 2 * r },
  near() {},
});
/* the door's planet as install.js's dotOf reads it, for still(k, idle, dot) */
export const DOT = { x: 380, y: 250, r: 28, g: 1.3, light: [-0.3, 0.9, -0.2], rot: 0.4, k: 1 };
