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
    contexts: 0, removed: 0, docListeners: {}, winListeners: {}, canvasListeners: {}, bodyClasses: new Set(), bodyLog: [],
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
    bufferData(t, data) { page.bufCalls.push({ vertex: ArrayBuffer.isView(data) }); },
  };
  page.glBase = glBase;
  page.gl = new Proxy(glBase, { get: (t, k) => (k in t ? t[k] : typeof k === "string" && /^[A-Z0-9_]+$/.test(k) ? 1 : () => any()) });

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
  };
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
 */
export function installClock() {
  let now = 0, seq = 0;
  const timers = new Map();
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
  Object.defineProperty(performance, "now", { value: () => now, configurable: true, writable: true });
  Date.now = () => 1.7e12 + now;
  return {
    now: () => now,
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
    restore() { globalThis.setTimeout = realSetTimeout; Object.defineProperty(performance, "now", { value: real.now, configurable: true, writable: true }); Date.now = real.date; },
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
