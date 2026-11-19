/*
 * Test for the door's sun painted in a worker the host makes (#119), written from the specification alone.
 *
 * The sun (glows.js: the dawn's three radial glows, dithered, per size) is painted and PNG-encoded off the page thread,
 * in a worker made by the host (`settings.sunWorker`, as `drawWorker` is); the page path stays where there is no worker
 * or it fails. The pixels are the same either way: one band routine in a module that touches no DOM.
 *
 *   S1  no sunWorker: no worker made; the page canvas gets putImageData bands and one toBlob; a blob: URL results
 *   S2  a sunWorker answering { blob }: one worker, posted exactly { w, h }, terminated once; no page canvas; the blob's URL is the href
 *   S3  sunWorker returns null, or throws: the page path runs, a URL results, no error escapes
 *   S4  no Worker, or no OffscreenCanvas, with a sunWorker given: the factory is not asked, the page path runs
 *   S5  flags.sun = "page": the factory is never asked; the page path (control: the same without the flag asks it)
 *   S6  { error }, an error event, a reply with no blob, a messageerror: each ends on the page path's URL, the worker
 *       terminated once, a late reply ignored
 *   S7  a worker that never answers: nothing before the backstop (20 s, D1), after it the page path's URL
 *   S8  same pixels: sun-worker.js over a stand-in self and OffscreenCanvas writes the very bytes the page path puts
 *   S9  sun-worker.js and what it imports load with no document, window or location, and fetch or import() nothing
 *   S10 a build superseded while its worker is out makes no URL, returns null, ends the worker; two builds of one
 *       size: the first URL is kept and the second's blob is not turned into a URL
 *   S11 static: nothing in assets/door/ makes the sun's worker itself or imports from outside the folder;
 *       sunWorker is in settings.js, the README and the site's main.js
 *
 *   node tools/ci/sun-worker-test.mjs
 *
 * No dependencies and no browser; each case runs in a fresh Node process (this file again, as `--child`) against the
 * stub page in door-stub.mjs on a virtual clock, with the fake worker class (fakeWorkers) as the host's `sunWorker`.
 *
 * Names this test chose where the specification leaves them open (the build may rename: change the constants):
 *   SUN_MODULE   assets/door/sun.js: the module with no DOM that holds sunDiscs, sunRows and sunBand (and, the worker
 *                needing them without glows.js, SUN), imported by glows.js and by sun-worker.js
 *   the worker answers { blob } (a Blob, PNG) or { error }, to the one message { w, h }; it listens by `self.onmessage`
 *                or by addEventListener("message") (either is driven)
 *   S8 paints 1280x800, not the specification's 160x100: sunRows is 6e5 / w rows a band, so 160x100 is a single band
 *                (this size is two). The frames are compared whole, as the bytes put at each row, whatever the bands.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { installPage, installClock, fakeWorkers, childMain, runCase, check, finish, errOf, realSetTimeout } from "./door-stub.mjs";

const SUN_MODULE = "sun.js";
const BACKSTOP_MS = 20000;
const DOOR = new URL("../../assets/door/", import.meta.url);
const SITE = new URL("../../assets/js/main.js", import.meta.url);
const doorFile = (n) => fileURLToPath(new URL(n, DOOR));
const GLOWS = "../../assets/door/glows.js", SETTINGS = "../../assets/door/settings.js", WORKER_JS = "../../assets/door/sun-worker.js";

/* ---------------- the child's rig: a page with a sun to paint, the host's worker a fake ---------------- */

/* a world: its sun picture records every href it is given */
function mkWorld() {
  const img = { hrefs: [], setAttribute(k, v) { if (/href$/.test(k)) this.hrefs.push(String(v)); }, setAttributeNS(ns, k, v) { this.setAttribute(k, v); } };
  const w = { img, dataset: {}, style: { setProperty() {}, removeProperty() {} }, get clientWidth() { return globalThis.innerWidth; }, get clientHeight() { return globalThis.innerHeight; },
    querySelector: () => img, querySelectorAll: () => [img] };
  return w;
}
/* a message or an event told to a fake worker the way a browser would, even after terminate() (a late arrival) */
const deliver = (w, type, data) => {
  const ev = { type, data, target: w };
  if (typeof w["on" + type] === "function") w["on" + type](ev);
  for (const f of [...(w.on[type] || [])]) f(ev);
};
const blobOf = (id, w = 400, h = 250) => ({ size: 9, w, h, type: "image/png", from: "worker", id });

/*
 * rig(o) -> r: the stub page (400x250, so the sun is a 400x250 picture of one band), the virtual clock, URL minting
 * recorded with where the blob came from, and the door's settings configured with
 *   o.sunWorker   "fake" (the fake host's factory) | "null" | "throws" | absent;  o.flags
 *   o.noWorker / o.noOffscreen   the browser lacks it
 */
async function rig(o = {}) {
  const page = installPage();
  const clock = installClock();
  globalThis.innerWidth = 400; globalThis.innerHeight = 250;
  const stats = { canvases: 0, toBlobs: 0, realWorkers: 0, factoryCalls: 0, escaped: [], minted: [] };
  process.on("unhandledRejection", (e) => stats.escaped.push(String(e && e.stack ? e.stack.split("\n")[0] : e)));
  process.on("uncaughtException", (e) => stats.escaped.push(String(e)));
  const create = document.createElement;
  document.createElement = (tag) => {
    const c = create(tag);
    if (tag === "canvas") {
      stats.canvases++;
      const tb = c.toBlob;
      c.toBlob = (...a) => { stats.toBlobs++; return tb(...a); };
    }
    return c;
  };
  const mint = URL.createObjectURL;
  URL.createObjectURL = (b) => { const url = mint(b); stats.minted.push({ url, from: b && b.from, id: b && b.id }); return url; };
  globalThis.Worker = class { constructor() { stats.realWorkers++; } };
  if (o.noWorker) delete globalThis.Worker;
  if (o.noOffscreen) delete globalThis.OffscreenCanvas;

  const host = fakeWorkers();
  const factories = {
    fake: () => { stats.factoryCalls++; return host.make(); },
    null: () => { stats.factoryCalls++; return null; },
    throws: () => { stats.factoryCalls++; throw new Error("no worker here"); },
  };
  const { configure } = await import(SETTINGS);
  configure({ flags: o.flags ?? {}, ...(o.sunWorker ? { sunWorker: factories[o.sunWorker] } : {}) });
  const { mountRasters, SUN } = await import(GLOWS);
  const worlds = [], drawn = [];
  const mount = () => {
    const world = mkWorld();
    worlds.push(world);
    return { world, m: mountRasters(world, { sun: SUN }, "t", { drawn: (url, name) => drawn.push([url, name]) }) };
  };
  const snap = () => ({
    canvases: stats.canvases, toBlobs: stats.toBlobs, realWorkers: stats.realWorkers, factoryCalls: stats.factoryCalls, escaped: [...stats.escaped],
    puts: page.paints.filter((p) => p.op === "putImageData").length,
    minted: stats.minted.map((m) => ({ ...m })), urls: page.blobURLs.map((b) => b.url), revoked: [...page.revoked],
    hrefs: worlds.map((w) => [...w.img.hrefs]), drawn: drawn.map((d) => [...d]),
    made: host.made, term: host.list.map((w) => w.terminated), posted: host.list.map((w) => w.posted),
  });
  /* the host's i-th worker; where none was made, one that does nothing (the checks then say "0 made", not a crash) */
  const dead = { terminated: 0, on: {}, say() {}, fail() {} };
  const worker = (i = 0) => host.list[i] ?? dead;
  return { page, clock, host, mount, snap, stats, worker };
}
const fbCase = async (o, drive) => {
  const r = await rig(o);
  const { m } = r.mount();
  m.start();
  await r.clock.advance(100);
  return drive(r, m);
};

const CASES = {
  async s1() { return fbCase({}, async (r) => { await r.clock.advance(4000); return r.snap(); }); },
  async s2() {
    return fbCase({ sunWorker: "fake" }, async (r) => {
      const before = r.snap();
      r.worker().say({ blob: blobOf(1) });
      await r.clock.advance(4000);
      return { before, after: r.snap() };
    });
  },
  async "s3-null"() { return fbCase({ sunWorker: "null" }, async (r) => { await r.clock.advance(4000); return r.snap(); }); },
  async "s3-throws"() { return fbCase({ sunWorker: "throws" }, async (r) => { await r.clock.advance(4000); return r.snap(); }); },
  async "s4-noworker"() { return fbCase({ sunWorker: "fake", noWorker: true }, async (r) => { await r.clock.advance(4000); return r.snap(); }); },
  async "s4-nooffscreen"() { return fbCase({ sunWorker: "fake", noOffscreen: true }, async (r) => { await r.clock.advance(4000); return r.snap(); }); },
  async s5() { return fbCase({ sunWorker: "fake", flags: { sun: "page" } }, async (r) => { await r.clock.advance(4000); return r.snap(); }); },
  async "s6-error"() { return failing((w) => w.say({ error: "the sun could not be painted" })); },
  async "s6-fail"() { return failing((w) => w.fail()); },
  async "s6-noblob"() { return failing((w) => w.say({})); },
  async "s6-messageerror"() { return failing((w) => deliver(w, "messageerror", undefined)); },
  async s7() {
    return fbCase({ sunWorker: "fake" }, async (r) => {
      await r.clock.advance(BACKSTOP_MS - 1000 - 100);
      const early = r.snap();
      await r.clock.advance(2000);
      await r.clock.advance(3000);
      const late = r.snap();
      deliver(r.worker(), "message", { blob: blobOf(1) });
      await r.clock.advance(2000);
      return { early, late, afterLate: r.snap() };
    });
  },
  async "s10-live"() {
    const r = await rig({ sunWorker: "fake" });
    const { m } = r.mount();
    const drawnAt = [];
    m.start();
    await r.clock.advance(100);
    /* a resize: the build under way (400x250) is superseded by the next (480x300) while its worker is out */
    r.page.resize(480, 300);
    await r.clock.advance(400);
    const out = r.snap();
    const a = r.worker(0), b = r.worker(1);
    deliver(a, "message", { blob: blobOf("A", 400, 250) });
    await r.clock.advance(2000);
    const afterOld = r.snap();
    b.say({ blob: blobOf("B", 480, 300) });
    await r.clock.advance(3000);
    return { out, afterOld, afterNew: r.snap(), drawnAt };
  },
  async "s10-same"() {
    const r = await rig({ sunWorker: "fake" });
    const x = r.mount(), y = r.mount();
    x.m.start(); y.m.start();
    await r.clock.advance(300);
    const out = r.snap();
    const a = r.worker(0), b = r.worker(1);
    a.say({ blob: blobOf(1) });
    await r.clock.advance(2000);
    const afterFirst = r.snap();
    b.say({ blob: blobOf(2) });
    await r.clock.advance(3000);
    return { out, afterFirst, final: r.snap() };
  },
  async s8() { return pixels(); },
  async s9() { return noDom(); },
};

/* S6: the fake does the failing thing, then the page path's sun is waited for; then a late reply */
async function failing(doIt) {
  return fbCase({ sunWorker: "fake" }, async (r) => {
    const before = r.snap();
    doIt(r.worker());
    await r.clock.advance(4000);
    const settled = r.snap();
    deliver(r.worker(), "message", { blob: blobOf("late") });
    await r.clock.advance(2000);
    return { before, settled, afterLate: r.snap() };
  });
}

/* ---------------- S8: the same pixels ---------------- */

/* a frame buffer: what is put on it at each row is what a canvas would hold (clamped bytes, as a canvas stores them) */
function frameRec(w, h) {
  const bytes = new Uint8ClampedArray(w * h * 4);
  const ctx = {
    puts: 0, bands: [],
    createImageData: (cw, ch) => ({ width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) }),
    putImageData(im, dx, dy) {
      ctx.puts++; ctx.bands.push([dy, im.height]);
      for (let y = 0; y < im.height; y++) bytes.set(im.data.subarray(y * im.width * 4, (y + 1) * im.width * 4), ((dy + y) * w + dx) * 4);
    },
    drawImage() {},
  };
  return { bytes, ctx };
}
const sleepReal = (ms) => new Promise((r) => realSetTimeout(r, ms));
async function until(cond, ms = 40000) { for (let t = 0; t < ms && !cond(); t += 10) await sleepReal(10); }

async function pixels() {
  const W = 1280, H = 800;
  const out = { w: W, h: H };
  /* the page path: no sunWorker; real timers; the page canvas is a recording one */
  const page = installPage();
  globalThis.ImageData = class { constructor(a, b, c) { if (ArrayBuffer.isView(a)) { this.data = a; this.width = b; this.height = c ?? a.length / 4 / b; } else { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); } } };
  const pageFrame = frameRec(W, H);
  page.ctx2d = () => pageFrame.ctx;
  globalThis.innerWidth = W; globalThis.innerHeight = H;
  const { configure } = await import(SETTINGS);
  configure({ flags: {} });
  const { mountRasters, SUN } = await import(GLOWS);
  const world = mkWorld();
  mountRasters(world, { sun: SUN }, "px").start();
  await until(() => world.img.hrefs.length > 0);
  out.pageHref = world.img.hrefs.length;
  out.pageBands = pageFrame.ctx.bands.length;
  out.pageBytes = pageFrame.bytes.some((b) => b !== 0);

  /* the worker's side: the page's globals are taken away, `self` and an OffscreenCanvas are stand-ins */
  for (const k of ["document", "window", "innerWidth", "innerHeight", "devicePixelRatio", "location"]) delete globalThis[k];
  const workerFrame = frameRec(W, H);
  const posted = [], listeners = [], blobs = [], canvases = [];
  const self_ = { postMessage: (m) => { posted.push(m); }, onmessage: null, close() {}, addEventListener(t, f) { if (t === "message") listeners.push(f); }, removeEventListener() {} };
  globalThis.self = self_;
  globalThis.postMessage = self_.postMessage;
  globalThis.OffscreenCanvas = class {
    constructor(w, h) { this.width = w; this.height = h; canvases.push([w, h]); }
    getContext() { return workerFrame.ctx; }
    convertToBlob(opts) { const b = { size: 7, from: "offscreen", opts }; blobs.push(b); return Promise.resolve(b); }
  };
  await import(WORKER_JS);
  const handler = typeof self_.onmessage === "function" ? self_.onmessage : typeof globalThis.onmessage === "function" ? globalThis.onmessage : listeners[0];
  out.handled = typeof handler === "function";
  if (out.handled) {
    await handler({ data: { w: W, h: H } });
    await until(() => posted.length > 0);
  }
  out.posted = posted.length;
  out.reply = posted[0] ? { hasBlob: !!posted[0].blob, blobFrom: posted[0].blob && posted[0].blob.from, error: posted[0].error } : null;
  out.canvases = canvases;
  out.converted = blobs.length;
  out.workerBands = workerFrame.ctx.bands.length;
  out.workerBytes = workerFrame.bytes.some((b) => b !== 0);
  out.same = Buffer.compare(Buffer.from(pageFrame.bytes.buffer), Buffer.from(workerFrame.bytes.buffer)) === 0;
  let firstDiff = -1;
  for (let i = 0; i < pageFrame.bytes.length; i++) if (pageFrame.bytes[i] !== workerFrame.bytes[i]) { firstDiff = i; break; }
  out.firstDiff = firstDiff;
  return out;
}

/* ---------------- S9: no DOM, nothing fetched, nothing from outside the folder ---------------- */

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\w])\/\/.*$/gm, "$1");
async function noDom() {
  const out = { problems: [], graph: [] };
  for (const g of ["document", "window", "location"]) if (typeof globalThis[g] !== "undefined") out.problems.push(`${g} is defined in the test's own process`);
  const fetched = [];
  globalThis.fetch = (...a) => { fetched.push(String(a[0])); return Promise.reject(new Error("no network")); };
  const posted = [], listeners = [];
  const self_ = { postMessage: (m) => posted.push(m), onmessage: null, close() {}, addEventListener(t, f) { listeners.push([t, f]); }, removeEventListener() {} };
  globalThis.self = self_;
  globalThis.postMessage = self_.postMessage;
  const root = doorFile("sun-worker.js");
  const seen = new Set(), queue = [root];
  const specs = /\b(?:import|export)\s[^;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g;
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const name = f.slice(fileURLToPath(DOOR).length);
    out.graph.push(name);
    if (["settings.js", "page.js", "glows.js"].includes(name)) out.problems.push(`${name} is in the worker's import graph`);
    const text = strip(readFileSync(f, "utf8"));
    for (const [pat, why] of [[/\bfetch\s*\(/, "fetch("], [/\bimport\s*\(/, "import()"], [/importScripts/, "importScripts"], [/XMLHttpRequest/, "XMLHttpRequest"],
      [/\bdocument\b/, "document"], [/\bwindow\b/, "window"], [/\blocation\b/, "location"], [/new Worker\(/, "new Worker("]]) if (pat.test(text)) out.problems.push(`${name} has ${why}`);
    for (const m of text.matchAll(specs)) {
      const spec = m[1] ?? m[2];
      const abs = fileURLToPath(new URL(spec, new URL(f, "file://")));
      if (!spec.startsWith("./") || !abs.startsWith(fileURLToPath(DOOR))) out.problems.push(`${name} imports ${spec}, outside the folder`);
      else queue.push(abs);
    }
  }
  await import(WORKER_JS);
  out.listens = typeof self_.onmessage === "function" || listeners.some(([t]) => t === "message");
  out.fetched = fetched;
  out.posted = posted.length;
  return out;
}

if (process.argv[2] === "--child") await childMain(CASES);

/* ---------------- the checks ---------------- */

const run = (how, t = 60000) => runCase(import.meta.url, how, t);
const last = (a) => a[a.length - 1];
const one = (a) => a.flat();
/* the page path ran and made the sun: one canvas, bands put, one toBlob, one blob: URL (a page blob, not a worker's), set as the href */
const pageUrl = (s) => s.canvases === 1 && s.toBlobs === 1 && s.puts >= 1 && s.urls.length === 1 && /^blob:/.test(s.urls[0]) && s.minted.length === 1 && !s.minted[0].from && last(one(s.hrefs)) === s.urls[0] && s.escaped.length === 0;
const pageDetail = (s) => `${s.canvases} canvas(es), ${s.puts} putImageData, ${s.toBlobs} toBlob, urls ${JSON.stringify(s.urls)}, hrefs ${JSON.stringify(s.hrefs)}, escaped ${JSON.stringify(s.escaped)}`;
const J = JSON.stringify;

{
  const r = run("s1");
  check("S1 no sunWorker: no worker is made", !r.error && r.realWorkers === 0 && r.made === 0 && r.factoryCalls === 0, `${r.realWorkers} Worker(s) made${errOf(r)}`);
  check("S1 no sunWorker: the page canvas gets putImageData bands and one toBlob, and a blob: URL is the href", !r.error && pageUrl(r), `${r.error ? "" : pageDetail(r)}${errOf(r)}`);
}
{
  const r = run("s2"), a = r.after, b = r.before;
  const w = a && a.posted[0];
  check("S2 a sunWorker is asked exactly once and its one worker is posted exactly { w, h }", !r.error && a.factoryCalls === 1 && a.made === 1 && a.posted.length === 1 && w.length === 1 && J(Object.keys(w[0]).sort()) === '["h","w"]' && w[0].w === 400 && w[0].h === 250, `${a?.factoryCalls} factory call(s), ${a?.made} made, posted ${J(w)}${errOf(r)}`);
  check("S2 ... not terminated before it answers, terminated once after", !r.error && J(b.term) === "[0]" && J(a.term) === "[1]", `before ${J(b?.term)}, after ${J(a?.term)}${errOf(r)}`);
  check("S2 ... the page canvas is never made, nothing is put or encoded on the page", !r.error && a.canvases === 0 && a.puts === 0 && a.toBlobs === 0, `${a?.canvases} canvas(es), ${a?.puts} putImageData, ${a?.toBlobs} toBlob${errOf(r)}`);
  check("S2 ... the worker's blob is made into the one URL, and that is the picture's href", !r.error && a.urls.length === 1 && a.minted.length === 1 && a.minted[0].from === "worker" && last(one(a.hrefs)) === a.urls[0] && a.escaped.length === 0, `minted ${J(a?.minted)}, hrefs ${J(a?.hrefs)}${errOf(r)}`);
  check("S2 ... and it is the picture handed on (drawn) to the host", !r.error && a.drawn.length === 1 && a.drawn[0][0] === a.urls[0], `drawn ${J(a?.drawn)}${errOf(r)}`);
}
for (const [how, label] of [["s3-null", "returns null"], ["s3-throws", "throws"]]) {
  const r = run(how);
  check(`S3 the sunWorker ${label}: the factory was asked, and the page path ran to a URL with no error escaping`, !r.error && r.factoryCalls >= 1 && pageUrl(r), `${r.factoryCalls} factory call(s), ${r.error ? "" : pageDetail(r)}${errOf(r)}`);
}
for (const [how, label] of [["s4-noworker", "Worker"], ["s4-nooffscreen", "OffscreenCanvas"]]) {
  const r = run(how);
  const used = r.posted && r.posted.flat().length;
  check(`S4 no ${label} but a sunWorker given: the worker is not used (the factory not asked) and the page path ran`, !r.error && r.factoryCalls === 0 && used === 0 && pageUrl(r), `${r.factoryCalls} factory call(s), ${used} message(s) posted, ${r.error ? "" : pageDetail(r)}${errOf(r)}`);
}
{
  const r = run("s5");
  check("S5 flags.sun = \"page\": the factory is never asked and the page path ran", !r.error && r.factoryCalls === 0 && r.made === 0 && pageUrl(r), `${r.factoryCalls} factory call(s), ${r.error ? "" : pageDetail(r)}${errOf(r)}`);
  const c = run("s2");
  check("S5 control: the same host without the flag does ask the factory (so the flag is what stops it)", !c.error && c.after.factoryCalls === 1, `${c.after?.factoryCalls} factory call(s)${errOf(c)}`);
}
for (const [how, label] of [["s6-error", "replies { error }"], ["s6-fail", "fires an error event"], ["s6-noblob", "replies with no blob"], ["s6-messageerror", "fires a messageerror"]]) {
  const r = run(how), s = r.settled;
  check(`S6 the worker ${label}: the page path's URL is the result (never a missing sun), from one worker`, !r.error && s.made === 1 && pageUrl(s), `${s?.made} worker(s), ${r.error ? "" : pageDetail(s)}${errOf(r)}`);
  check(`S6 the worker ${label}: it is terminated once`, !r.error && J(s.term) === "[1]", `terminated ${J(s?.term)}${errOf(r)}`);
  check(`S6 the worker ${label}: a late reply is ignored (no second URL, the href unchanged, still one terminate)`, !r.error && J(r.afterLate.urls) === J(s.urls) && J(r.afterLate.hrefs) === J(s.hrefs) && r.afterLate.minted.length === 1 && J(r.afterLate.term) === "[1]" && r.afterLate.escaped.length === 0, `urls ${J(r.afterLate?.urls)}, hrefs ${J(r.afterLate?.hrefs)}, terminated ${J(r.afterLate?.term)}${errOf(r)}`);
}
{
  const r = run("s7"), e = r.early, l = r.late;
  check("S7 a worker that never answers: before the backstop nothing is set (no URL, no href, no page canvas)", !r.error && e.urls.length === 0 && e.hrefs.flat().length === 0 && e.canvases === 0, `at ${BACKSTOP_MS - 1000} ms: urls ${J(e?.urls)}, hrefs ${J(e?.hrefs)}, ${e?.canvases} canvas(es)${errOf(r)}`);
  check("S7 ... after the backstop (20 s) the page path's URL is the result, and the worker is terminated once", !r.error && pageUrl(l) && J(l.term) === "[1]", `${r.error ? "" : pageDetail(l)}, terminated ${J(l?.term)}${errOf(r)}`);
  check("S7 ... and a reply that comes later is ignored", !r.error && J(r.afterLate.urls) === J(l.urls) && J(r.afterLate.hrefs) === J(l.hrefs) && r.afterLate.minted.length === 1, `urls ${J(r.afterLate?.urls)}, hrefs ${J(r.afterLate?.hrefs)}${errOf(r)}`);
}
{
  const r = run("s8", 120000);
  check("S8 precondition: the page path put the whole frame in more than one band, and the worker answered { blob } to { w, h }", !r.error && r.pageHref > 0 && r.pageBands >= 2 && r.pageBytes && r.handled && r.posted === 1 && r.reply && r.reply.hasBlob && !r.reply.error, `page bands ${r.pageBands}, handler ${r.handled}, worker posted ${r.posted} ${J(r.reply)}${errOf(r)}`);
  check("S8 the worker paints on one OffscreenCanvas of w x h and encodes it once (convertToBlob), the blob posted", !r.error && J(r.canvases) === J([[r.w, r.h]]) && r.converted === 1 && r.reply && r.reply.blobFrom === "offscreen" && r.workerBytes, `canvases ${J(r.canvases)}, ${r.converted} convertToBlob, ${r.workerBands} band(s), blob from ${r.reply?.blobFrom}${errOf(r)}`);
  check("S8 the worker's frame is byte-identical to the page path's frame (same w, h)", !r.error && r.same === true, `first differing byte at ${r.firstDiff}${errOf(r)}`);
}
{
  const r = run("s9");
  check("S9 sun-worker.js and what it imports load with no document, window or location, take a message, and fetch nothing", !r.error && r.listens === true && r.fetched.length === 0 && r.posted === 0, `listens ${r.listens}, fetched ${J(r.fetched)}, posted at load ${r.posted}${errOf(r)}`);
  check("S9 ... its import graph (static) is inside the folder, without settings.js, page.js or glows.js, and has no fetch, import(), document, window, location, Worker", !r.error && r.problems.length === 0, `graph ${J(r.graph)}; ${J(r.problems)}${errOf(r)}`);
  let shared = "";
  try {
    const g = readFileSync(doorFile("glows.js"), "utf8"), w = readFileSync(doorFile("sun-worker.js"), "utf8"), s = readFileSync(doorFile(SUN_MODULE), "utf8");
    const imp = (t) => new RegExp(`from\\s*["']\\./${SUN_MODULE.replace(".", "\\.")}["']`).test(t);
    const exp = (n) => new RegExp(`export\\s+(?:async\\s+)?(?:function\\s*\\*?\\s*|const\\s+|let\\s+)${n}\\b|export\\s*\\{[^}]*\\b${n}\\b`).test(s);
    if (!imp(g)) shared += "glows.js does not import it; ";
    if (!imp(w)) shared += "sun-worker.js does not import it; ";
    for (const n of ["sunBand", "sunDiscs", "sunRows"]) if (!exp(n)) shared += `${SUN_MODULE} does not export ${n}; `;
    if (/Math\.hypot/.test(strip(g))) shared += "glows.js still has its own pixel loop (Math.hypot); ";
  } catch (e) { shared += String(e.message); }
  check(`S8 one shared band routine: glows.js and sun-worker.js both import ${SUN_MODULE}, which exports sunBand, sunDiscs and sunRows; glows.js keeps no copy of the loop`, shared === "", shared || "yes");
}
{
  const r = run("s10-live"), o = r.out, a = r.afterOld, b = r.afterNew;
  check("S10 precondition: a resize while the first worker is out makes a second worker for the new size", !r.error && o.made === 2 && J(o.posted[0]) === J([{ w: 400, h: 250 }]) && J(o.posted[1]) === J([{ w: 480, h: 300 }]), `${o?.made} worker(s), posted ${J(o?.posted)}${errOf(r)}`);
  check("S10 a superseded build's answer makes no URL and sets no href, and its worker is terminated once", !r.error && a.minted.length === 0 && a.urls.length === 0 && a.hrefs.flat().length === 0 && a.drawn.length === 0 && a.term[0] === 1 && a.escaped.length === 0, `minted ${J(a?.minted)}, hrefs ${J(a?.hrefs)}, drawn ${J(a?.drawn)}, terminated ${J(a?.term)}${errOf(r)}`);
  check("S10 ... the newer build is not disturbed: its worker is still out, and its answer makes its URL, the href, and ends it", !r.error && a.term[1] === 0 && b.minted.length === 1 && b.minted[0].id === "B" && last(one(b.hrefs)) === b.urls[0] && b.term[1] === 1, `before its answer ${J(a?.term)}, minted ${J(b?.minted)}, hrefs ${J(b?.hrefs)}, terminated ${J(b?.term)}${errOf(r)}`);
}
{
  const r = run("s10-same"), f = r.afterFirst, z = r.final;
  check("S10 precondition: two builds of one size under way each have their own worker", !r.error && r.out.made === 2 && J(r.out.posted[0]) === J(r.out.posted[1]), `${r.out?.made} worker(s), posted ${J(r.out?.posted)}${errOf(r)}`);
  check("S10 two builds of one size: the first to finish makes the URL, sets it, and its worker is ended", !r.error && f.minted.length === 1 && f.minted[0].id === 1 && f.hrefs[0].at(-1) === f.urls[0] && f.term[0] === 1, `minted ${J(f?.minted)}, hrefs ${J(f?.hrefs)}, terminated ${J(f?.term)}${errOf(r)}`);
  check("S10 ... the second's blob is not turned into a URL: the first URL is kept (and is the second picture's href too), nothing revoked", !r.error && z.minted.length === 1 && z.urls.length === 1 && z.hrefs[1].at(-1) === z.urls[0] && z.revoked.length === 0 && z.term[1] === 1 && z.escaped.length === 0, `minted ${J(z?.minted)}, hrefs ${J(z?.hrefs)}, revoked ${J(z?.revoked)}, terminated ${J(z?.term)}${errOf(r)}`);
}
{
  /* S11: static */
  const read = (p) => readFileSync(p, "utf8");
  const files = readdirSync(fileURLToPath(DOOR)).filter((n) => /\.js$/.test(n));
  const made = files.filter((n) => n !== "settings.js" && /new Worker\(/.test(strip(read(doorFile(n)))));
  check("S11 no file in assets/door/ (settings.js aside) makes a worker itself: `new Worker(` is the host's", made.length === 0, `found in ${J(made)}`);
  const outside = [];
  for (const n of files) for (const m of strip(read(doorFile(n))).matchAll(/\b(?:import|export)\s[^;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*\(?\s*["']([^"']+)["']/g)) {
    const spec = m[1] ?? m[2];
    if (!spec.startsWith("./") || !fileURLToPath(new URL(spec, new URL(n, DOOR))).startsWith(fileURLToPath(DOOR))) outside.push(`${n}: ${spec}`);
  }
  check("S11 nothing in assets/door/ imports from outside the folder", outside.length === 0, J(outside));
  const settings = read(doorFile("settings.js")), readme = read(doorFile("README.md")), main = read(fileURLToPath(SITE));
  check("S11 settings.js names sunWorker in its header and its typedef", (settings.match(/\bsunWorker\b/g) || []).length >= 2, `${(settings.match(/\bsunWorker\b/g) || []).length} mention(s)`);
  check("S11 the folder reads the host's sunWorker (settings.sunWorker) in a module other than settings.js", files.some((n) => n !== "settings.js" && /settings\.sunWorker|\bsunWorker\b/.test(strip(read(doorFile(n))))), "none does");
  const row = readme.split("\n").find((l) => l.startsWith("| `sunWorker")) || "";
  check("S11 the README's settings table has a sunWorker row: the site's factory for sun-worker.js, Orbit's column \"none yet\"", /sun-worker\.js/.test(row) && /none yet/.test(row), row.slice(0, 160) || "no row");
  const csp = readme.indexOf("worker-src 'self'");
  check("S11 the README's worker-src 'self' line covers sunWorker too", csp >= 0 && /sunWorker/.test(readme.slice(csp, csp + 400)), "sunWorker is not named by the worker-src line");
  check("S11 the README lists sun-worker.js among the folder's files", /^\| `sun-worker\.js`/m.test(readme), "not listed");
  check("S11 main.js gives the door sunWorker: a module Worker on site(\"assets/door/sun-worker.js\")", /sunWorker\s*:\s*\(\)\s*=>\s*new Worker\(\s*site\(\s*["']assets\/door\/sun-worker\.js["']\s*\)\s*,\s*\{\s*type:\s*["']module["']\s*\}\s*\)/.test(main), "factory not found");
  check("S11 the sun=page flag (D2) is read in main.js, listed in settings.js and in the README", /FLAGS\.sun\s*=[^;]*sun=\(?page/.test(main) && /\bsun\b[^\n]*"page"/.test(settings) && /`sun`/.test(readme), "one of the three is missing");
}
finish();
