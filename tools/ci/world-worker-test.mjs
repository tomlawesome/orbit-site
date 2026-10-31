/*
 * Test for #93 batch 2, the worker (ADR-0004 6b.1, 6b.3, 6b.5 and 6b.7 test W5), written from the specification alone: the
 * worker side. assets/js/world-worker.js is imported in a child process into the global scope of a worker (door-stub.mjs:
 * installWorkerSelf): a stub `self` (postMessage, onmessage, close) and no page at all (no document, window, Image,
 * innerWidth, devicePixelRatio, matchMedia, localStorage: a touch of one throws), a fake OffscreenCanvas whose context is the
 * stub's recording gl, and a virtual clock. Messages are delivered as the page posts them, and everything the worker posts
 * is read back. (As #85's draw-worker-test.mjs, D5.)
 *
 *   node tools/ci/world-worker-test.mjs
 *
 *   up        `hello` alone posts no `up`; `canvas` after it posts one `up { ok: true }`, and no `dead`
 *   noGl      a canvas with no WebGL2 posts `up { ok: false, why: "no WebGL2 in a worker here" }`
 *   compile   the shaders are compiled with no "compile" chore queued at any moment, and `compiled { ok: true, ms }`
 *   pictures  the pictures are fetched from the absolute urls `hello` gave, all three, and from no other
 *   whole     the map goes on in one texImage2D of its full height (no bands, no texSubImage2D)
 *   bake      `bake { id }` is answered by `baked { id, ok: true }` after the galaxy's four strips, one a frame
 *   frames    three `view`s in one frame draw once, the last, and post one `drew` with its seq (and a dt, the worker's own
 *             period between its frame callbacks, and an ms)
 *   runOff    `run { on: false }` stops the frame callbacks (`run { on: true }` runs them: control)
 *   measure   `measure` with two sets posts `measured` with two numbers, each the ms a draw of that set took
 *   resize    `resize` sets the canvas's bitmap size (w x scale by h x scale)
 *   warn      a warning from world.js (the map cannot be had) is posted as `note { kind: "warn" }`, and `baked { ok: false }`
 *   lost      `webglcontextlost` on the OffscreenCanvas posts `lost`
 *   destroy   `destroy` calls close()
 *
 * And #113 (ADR-0004 6e.2), written from the specification alone:
 *
 *   decodePage  `hello { decode: "page" }`: for each picture fetched one `decode { id, blob, options }` is posted; each is
 *             answered by `decoded { id, bitmap }` and that bitmap is the source of a texImage2D; a `decoded` for an id never
 *             asked has its bitmap closed and posts no `dead`. Control: no `decode` in the hello posts no `decode`, and the
 *             pictures still go up
 *
 * One fresh Node process a case; virtual clock only, nothing waits on the runner. A missing module is said in plain words.
 */
import { installPage, installClock, installWorkerSelf, namedUniforms, BASE, childMain, runCase, chk, finish } from "./door-stub.mjs";

const WORKER = "../../assets/js/world-worker.js";
const plainError = (message) => Object.assign(new Error(message), { plain: true });
const guarded = (cases) => Object.fromEntries(Object.entries(cases).map(([k, f]) => [k, async () => { try { return await f(); } catch (e) { if (e && e.plain) return { none: e.message }; throw e; } }]));

/* the pictures hello gives (absolute) */
const URLS = {
  map: new URL("assets/img/install/planet-2k.webp", BASE).href,
  rings: new URL("assets/img/install/rings.png", BASE).href,
  moon: new URL("assets/door/img/flight/moon.webp", BASE).href,
};
const SKY = 1024;                                   /* the galaxy's width: strips 128 high, 1024 wide */
const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/* a view as install.js's draw builds it: numbers and arrays, look.HUE a Float32Array; cam tells one view from another */
const mkView = (n = 1, o = {}) => ({
  cam: [n, 0.5, 5], fwd: [0, -0.1, -1], right: [1, 0, 0], up: [0, 1, 0], focal: 900, sunPx: [100, 200], shift: [0, 0],
  look: { HUE: new Float32Array(ID), RING_K: 1, HAZE: [0.85, 0.82, 1.0], GRADE: null },
  sun: [-0.95, 0.28, -0.08], spin: ID, tilt: ID, sky: ID, moon: [1, 1, 1, 0.075], moon2: [0, 0, 0, 0],
  part: 1, dustN: 30, time: n, bg: 1, sunVis: 1, expo: 1, vel: [0, 0, 0], focusD: 5, blur: 0, dust: 1, fringe: 0.012, grain: 0.028, blurC: [640, 400], ...o,
});

async function boot() {
  const page = installPage();
  const clock = installClock();
  const w = installWorkerSelf(page);
  w.page = page; w.clock = clock;
  /* the worker's own frame callbacks, a period of w.frameMs apart (installWorkerSelf counts the ones asked for; these also count the ones that ran) */
  w.frameMs = 16; w.fires = 0;
  const frame = (f) => { w.rafs++; w.rafLog.push(performance.now()); return globalThis.setTimeout(() => { w.fires++; f(performance.now()); }, w.frameMs); };
  globalThis.requestAnimationFrame = frame; w.self.requestAnimationFrame = frame;
  w.uniforms = namedUniforms(page);
  w.draws = () => w.uniforms.filter((u) => u[0] === "uniform3fv" && u[1] === "uCam");
  try { await import(WORKER); }
  catch (e) { throw plainError(e && e.code === "ERR_MODULE_NOT_FOUND" && /world-worker/.test(String(e.message)) ? "assets/js/world-worker.js does not exist yet" : `assets/js/world-worker.js did not load: ${String(e && e.stack || e).split("\n").slice(0, 3).join(" | ")}`); }
  if (typeof w.self.onmessage !== "function" && !(w.listeners.message || []).length) throw plainError("assets/js/world-worker.js listens for no messages (self.onmessage is not set)");
  w.chores = (await import("../../assets/door/chores.js")).choresNow;
  /* the chore queue is looked at after every message and every timer: a "compile" chore must never be seen in it */
  w.sawCompileChore = false;
  w.sample = () => { if (w.chores().queued.some((t) => t.split("+").includes("compile"))) w.sawCompileChore = true; return false; };
  const send = w.send;
  w.send = (m) => { send(m); w.sample(); };
  w.hello = (extra = {}) => ({ type: "hello", flags: {}, baseURI: BASE, world: { small: true, ...URLS }, sky: SKY, tag: "install", ...extra });
  w.run = (ms, until) => clock.advance(ms, () => { w.sample(); return until ? until() : false; });
  w.bring = async (extra) => { w.send(w.hello(extra)); w.send({ type: "canvas", canvas: w.warp }); await w.run(0); };
  w.bake = async (id = 1) => { w.send({ type: "bake", id }); await w.run(20000, () => w.of("baked").some((m) => m.id === id)); };
  w.view = (seq, v) => w.send(structuredClone({ type: "view", seq, view: v ?? mkView(seq) }));
  w.sizeUp = async () => { w.send({ type: "resize", w: 1280, h: 800, scale: 1 }); await w.run(0); };
  return w;
}
const common = (w) => ({ cloneErrors: w.cloneErrors, deads: w.of("dead").map((m) => m.why) });

async function up() {
  const w = await boot();
  w.send(w.hello());
  await w.run(500);
  const afterHello = w.of("up").length;
  w.send({ type: "canvas", canvas: w.warp });
  await w.run(2000);
  return { afterHello, ups: w.of("up").map((m) => ({ ok: m.ok, why: m.why })), ...common(w) };
}
async function noGl() {
  const w = await boot();
  w.warp.getContext = () => null;
  await w.bring();
  await w.run(3000);
  return { ups: w.of("up").map((m) => ({ ok: m.ok, why: m.why })), compiled: w.of("compiled").length, ...common(w) };
}
async function compile() {
  const w = await boot();
  await w.bring();
  await w.run(5000);
  return {
    compiles: w.compiles.length, compileQueued: w.compiles.some((c) => c.queued.some((t) => t.split("+").includes("compile"))), sawCompileChore: w.sawCompileChore,
    ups: w.of("up").map((m) => m.ok), compiled: w.of("compiled").map((m) => ({ ok: m.ok, ms: m.ms, kind: typeof m.ms, finite: Number.isFinite(m.ms) && m.ms >= 0 })), ...common(w),
  };
}
async function pictures() {
  const w = await boot();
  await w.bring();
  await w.bake(1);
  const given = Object.values(URLS);
  return { fetched: w.fetched, extra: w.fetched.filter((u) => !given.includes(u)), missing: given.filter((u) => !w.fetched.includes(u)), baked: w.of("baked").length, ...common(w) };
}
async function whole() {
  const w = await boot();
  const SIZES = [[/planet/, 2048, 1024], [/rings/, 1024, 1], [/moon/, 512, 512]];
  globalThis.fetch = async (url) => { w.fetched.push(String(url)); return { ok: true, status: 200, blob: async () => ({ size: 1, type: "image/webp", url: String(url) }) }; };
  const bitmaps = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async (src, ...r) => {
    const s = src && src.url ? SIZES.find(([re]) => re.test(src.url)) : null;
    if (!s) return bitmaps(src, ...r);
    return r.length >= 4 ? { width: r[2], height: r[3], close() {} } : { width: s[1], height: s[2], close() {} };
  };
  const calls = [];
  const img = w.page.glBase.texImage2D, sub = w.page.glBase.texSubImage2D;
  w.page.glBase.texImage2D = (...a) => { const s = a.length === 6 ? a[5] : null; if (!s?.probe) calls.push({ fn: "texImage2D", args: a.length, w: s ? s.width : a[3], h: s ? s.height : a[4], empty: a.length > 6 && a[8] === null }); return img(...a); };
  w.page.glBase.texSubImage2D = (...a) => { if (!a[a.length - 1]?.probe) calls.push({ fn: "texSubImage2D", args: a.length, w: a[4], h: a[5] }); return sub(...a); };
  await w.bring();
  await w.bake(1);
  const map = calls.filter((c) => c.fn === "texImage2D" && c.args === 6 && c.w === 2048 && c.h === 1024);
  return {
    baked: w.of("baked").map((m) => m.ok), mapWhole: map.length, bands: calls.filter((c) => c.fn === "texSubImage2D").length,
    emptyFull: calls.filter((c) => c.fn === "texImage2D" && c.empty && c.w === 2048 && c.h === 1024).length, calls: calls.slice(0, 8), ...common(w),
  };
}
async function bake() {
  const w = await boot();
  const strips = [];
  w.page.glBase.scissor = (...a) => { strips.push({ a, rafs: w.rafs, baked: w.of("baked").length }); };
  await w.bring();
  await w.run(1000);
  const before = { strips: strips.length, baked: w.of("baked").length };
  w.send({ type: "bake", id: 9 });
  await w.run(20000, () => w.of("baked").some((m) => m.id === 9));
  await w.run(500);
  return { before, strips: strips.map((s) => ({ a: s.a, baked: s.baked })), rafsRise: strips.every((s, i) => i === 0 || s.rafs > strips[i - 1].rafs), baked: w.of("baked").map((m) => ({ id: m.id, ok: m.ok })), ...common(w) };
}
async function frames() {
  const w = await boot();
  w.frameMs = 40;
  await w.bring();
  await w.sizeUp();
  await w.bake(1);
  w.send({ type: "run", on: true });
  await w.run(100);
  const drews0 = w.of("drew").length, paints0 = w.draws().length;
  w.view(1); w.view(2); w.view(3);
  await w.run(200, () => w.of("drew").some((m) => m.seq === 3));
  await w.run(100);
  const burst = { drews: w.of("drew").slice(drews0).map((m) => ({ seq: m.seq, dt: m.dt, ms: m.ms })), paints: w.draws().slice(paints0).map((u) => u[2]) };
  /* a view a frame, each sent as the one before is drawn: the worker's own period is the gap between its callbacks */
  const dts = [];
  for (let seq = 4; seq <= 7; seq++) {
    const n = w.of("drew").length;
    w.view(seq);
    await w.run(200, () => w.of("drew").length > n);
    const d = w.of("drew").at(-1);
    dts.push({ seq: d.seq, dt: d.dt });
  }
  return { burst, dts, ...common(w) };
}
async function runOff() {
  const w = await boot();
  await w.bring();
  await w.bake(1);
  await w.run(500);
  const idle = w.fires;
  w.send({ type: "run", on: true });
  await w.run(500);
  const running = w.fires;
  w.send({ type: "run", on: false });
  await w.run(100);
  const stopped = w.fires;
  await w.run(1000);
  return { running: running - idle, afterStop: w.fires - stopped, ...common(w) };
}
async function measure() {
  const w = await boot();
  let skew = 0, part = 1;
  const base = performance.now.bind(performance);
  Object.defineProperty(performance, "now", { value: () => base() + skew, configurable: true, writable: true });
  const u1 = w.page.glBase.uniform1f, u3 = w.page.glBase.uniform3fv;
  w.page.glBase.uniform1f = (loc, v) => { if (loc?.n === "uPartK") part = v; return u1(loc, v); };
  w.page.glBase.uniform3fv = (loc, v) => { if (loc?.n === "uCam") skew += part < 0.6 ? 4 : 10; return u3(loc, v); };
  await w.bring();
  await w.sizeUp();
  await w.bake(1);
  const reads0 = w.page.readPixels, paints0 = w.draws().length;
  const set = (p) => [0, 1, 2, 3].map((i) => mkView(i + 1, { part: p, dustN: 18 }));
  w.send(structuredClone({ type: "measure", id: 5, sets: [set(0.4), set(0.8)] }));
  await w.run(20000, () => w.of("measured").length > 0);
  await w.run(100);
  return { measured: w.of("measured").map((m) => ({ id: m.id, ms: m.ms })), paints: w.draws().length - paints0, reads: w.page.readPixels - reads0, ...common(w) };
}
async function resize() {
  const w = await boot();
  await w.bring();
  const before = [w.warp.width, w.warp.height];
  w.send({ type: "resize", w: 1280, h: 800, scale: 1.5 });
  await w.run(100);
  const a = [w.warp.width, w.warp.height];
  w.send({ type: "resize", w: 640, h: 480, scale: 1 });
  await w.run(100);
  return { before, a, b: [w.warp.width, w.warp.height], ...common(w) };
}
async function warn() {
  const w = await boot();
  globalThis.fetch = async (url) => { w.fetched.push(String(url)); return String(url).includes("planet") ? { ok: false, status: 503 } : { ok: true, status: 200, blob: async () => ({ size: 1, type: "image/webp" }) }; };
  await w.bring();
  w.send({ type: "bake", id: 3 });
  await w.run(60000, () => w.of("baked").some((m) => m.id === 3));
  await w.run(200);
  return { baked: w.of("baked").map((m) => ({ id: m.id, ok: m.ok })), notes: w.of("note").map((m) => ({ line: String(m.line), kind: m.kind })), ...common(w) };
}
async function lost() {
  const w = await boot();
  await w.bring();
  await w.run(500);
  const before = w.of("lost").length, handlers = (w.warp.listeners.webglcontextlost || []).length;
  for (const f of [...(w.warp.listeners.webglcontextlost || [])]) f({ type: "webglcontextlost", preventDefault() {} });
  await w.run(100);
  return { before, handlers, lost: w.of("lost").length, ...common(w) };
}
async function destroy() {
  const w = await boot();
  await w.bring();
  w.send({ type: "destroy" });
  await w.run(500);
  return { closed: w.closed, ...common(w) };
}
/* #113: the page decodes (`decode: "page"`) or the worker does (no `decode`); a fake bitmap per picture, closes counted */
async function decodePage(decode) {
  const w = await boot();
  const SIZES = [[/planet/, 2048, 1024], [/rings/, 1024, 1], [/moon/, 512, 512]];
  const sizeOf = (url) => SIZES.find(([re]) => re.test(String(url))) || [null, 64, 64];
  const fake = (url) => { const s = sizeOf(url); const b = { width: s[1], height: s[2], closes: 0, close() { b.closes++; } }; return b; };
  const blobs = [];
  globalThis.fetch = async (url) => { w.fetched.push(String(url)); const blob = { size: 1, type: "image/webp", url: String(url) }; blobs.push(blob); return { ok: true, status: 200, blob: async () => blob }; };
  const here = [];
  globalThis.createImageBitmap = async (src, ...r) => { const b = fake(src && src.url); here.push(b); return b; };
  const sources = [];
  const img = w.page.glBase.texImage2D;
  w.page.glBase.texImage2D = (...a) => { if (a.length === 6) sources.push(a[5]); return img(...a); };
  w.send(w.hello(decode === undefined ? {} : { decode }));
  w.send({ type: "canvas", canvas: w.warp });
  await w.run(0);
  w.send({ type: "bake", id: 1 });
  /* the page's side: answer each ask once, as it comes, with a fake bitmap */
  const answered = [];
  for (let i = 0; i < 400 && !w.of("baked").some((m) => m.id === 1); i++) {
    await w.run(100);
    for (const m of w.of("decode")) {
      if (answered.some((a) => a.id === m.id)) continue;
      const bitmap = fake(m.blob && m.blob.url);
      answered.push({ id: m.id, bitmap });
      w.send({ type: "decoded", id: m.id, bitmap });
    }
  }
  await w.run(500);
  const asks = w.of("decode");
  const deadsBefore = w.of("dead").length, upsBefore = sources.length;
  const stray = fake(URLS.map);
  w.send({ type: "decoded", id: 987654, bitmap: stray });
  await w.run(500);
  return {
    asks: asks.map((m) => ({ id: m.id, idKind: typeof m.id, hasBlob: !!m.blob && typeof m.blob === "object", hasOptions: "options" in m })),
    distinctIds: new Set(asks.map((m) => m.id)).size, fetched: blobs.length, baked: w.of("baked").map((m) => m.ok),
    unuploaded: answered.filter((a) => !sources.includes(a.bitmap)).length, answered: answered.length,
    hereUploaded: here.filter((b) => sources.includes(b)).length, here: here.length, uploads: sources.length,
    stray: { closes: stray.closes, uploaded: sources.includes(stray), newUploads: sources.length - upsBefore, newDeads: w.of("dead").length - deadsBefore },
    ...common(w),
  };
}

const CASES = guarded({ up, noGl, compile, pictures, whole, bake, frames, runOff, measure, resize, warn, lost, destroy, decodePage: () => decodePage("page"), decodePageNone: () => decodePage(undefined) });

if (process.argv[2] === "--child") await childMain(CASES);

const show = (x) => JSON.stringify(x);
const run = (n) => runCase(import.meta.url, n);
const clean = (r) => r.cloneErrors.length === 0 && r.deads.length === 0;

{
  const r = run("up");
  chk("W5 `hello` alone posts no `up`", r, (r) => [r.afterHello === 0, `ups after hello: ${r.afterHello}`]);
  chk("W5 `hello` then `canvas` posts one `up { ok: true }`", r, (r) => [r.ups.length === 1 && r.ups[0].ok === true, `ups ${show(r.ups)}`]);
  chk("W5 ... and nothing it posts is beyond structured clone, and no `dead`", r, (r) => [clean(r), `clone errors ${show(r.cloneErrors)}, dead ${show(r.deads)}`]);
}
{
  const r = run("noGl");
  chk("W5 a canvas with no WebGL2 posts `up { ok: false, why: \"no WebGL2 in a worker here\" }`, and no `compiled`", r, (r) => [r.ups.length === 1 && r.ups[0].ok === false && r.ups[0].why === "no WebGL2 in a worker here" && r.compiled === 0 && clean(r), `ups ${show(r.ups)}, compiled posted ${r.compiled}, clone errors ${show(r.cloneErrors)}, dead ${show(r.deads)}`]);
}
{
  const r = run("compile");
  chk("W5 the world's shaders are compiled once up (the vertex shader, the render's and the post's)", r, (r) => [r.ups.length === 1 && r.ups[0] === true && r.compiles >= 3, `compileShader calls ${r.compiles}, ups ${show(r.ups)}`]);
  chk("W5 ... with no \"compile\" chore queued, at any moment", r, (r) => [!r.compileQueued && !r.sawCompileChore, `queued when compiling: ${r.compileQueued}; seen in the queue: ${r.sawCompileChore}`]);
  chk("W5 ... and `compiled { ok: true, ms }` is posted, ms a number", r, (r) => [r.compiled.length === 1 && r.compiled[0].ok === true && r.compiled[0].finite && clean(r), `compiled ${show(r.compiled)}, clone errors ${show(r.cloneErrors)}, dead ${show(r.deads)}`]);
}
{
  const r = run("pictures");
  chk("W5 (precondition) the bake was answered", r, (r) => [r.baked === 1, `baked posted: ${r.baked}`]);
  chk("W5 the pictures are fetched from the absolute urls given, and from no other", r, (r) => [r.extra.length === 0 && r.fetched.length > 0, `fetched ${show(r.fetched)}; not given ${show(r.extra)}`]);
  chk("W5 ... the map, the rings and the moon were all fetched", r, (r) => [r.missing.length === 0, `never fetched ${show(r.missing)}`]);
}
{
  const r = run("whole");
  chk("W5 (precondition) the bake was answered true", r, (r) => [show(r.baked) === show([true]), `baked ${show(r.baked)}`]);
  chk("W5 uploadBanded puts the map on in one texImage2D of its full height (2048 x 1024)", r, (r) => [r.mapWhole === 1, `texImage2D calls with the whole map: ${r.mapWhole}; calls ${show(r.calls)}`]);
  chk("W5 ... in no bands: no texSubImage2D, no empty texture made to fill", r, (r) => [r.bands === 0 && r.emptyFull === 0, `texSubImage2D calls ${r.bands}, empty full-size textures ${r.emptyFull}`]);
}
{
  const r = run("bake");
  chk("W5 (precondition) no strip is baked and nothing answered before `bake`", r, (r) => [r.before.baked === 0, show(r.before)]);
  chk("W5 `bake { id }` is answered by `baked { id, ok: true }`, once", r, (r) => [show(r.baked) === show([{ id: 9, ok: true }]), `baked ${show(r.baked)}`]);
  chk("W5 ... after the galaxy's four strips, each 128 rows of the 1024 x 512 sky, none after `baked`", r, (r) => [r.strips.length === 4 && r.strips.every((s, i) => show(s.a) === show([0, 128 * i, 1024, 128]) && s.baked === 0), `strips ${show(r.strips)}`]);
  chk("W5 ... one a frame: a frame was asked for between each", r, (r) => [r.rafsRise && r.strips.length === 4, `frames asked rise between strips: ${r.rafsRise}`]);
}
{
  const r = run("frames");
  chk("W5 three `view`s in one frame post one `drew`, with the last one's seq", r, (r) => [r.burst.drews.length === 1 && r.burst.drews[0].seq === 3 && typeof r.burst.drews[0].ms === "number", `drew ${show(r.burst.drews)}`]);
  chk("W5 ... and draw once, the last (its camera), not the first or the second", r, (r) => [r.burst.paints.length === 1 && show(r.burst.paints[0]) === show([3, 0.5, 5]), `drawn with cameras ${show(r.burst.paints)}`]);
  chk("W5 `drew.dt` is the worker's own period between its frame callbacks (its frames 40 ms apart here, a view sent as each is drawn)", r, (r) => [r.dts.length === 4 && typeof r.dts[0].dt === "number" && r.dts.slice(1).every((d) => d.dt === 40), `dt ${show(r.dts)}`]);
  chk("W5 ... nothing posted is beyond structured clone, and no `dead`", r, (r) => [clean(r), `clone errors ${show(r.cloneErrors)}, dead ${show(r.deads)}`]);
}
{
  const r = run("runOff");
  chk("W5 (control) `run { on: true }` runs the frame callbacks (a frame every 16 ms on the virtual clock)", r, (r) => [r.running >= 10, `callbacks in 500 ms of run on: ${r.running}`]);
  chk("W5 `run { on: false }` stops the frame callbacks", r, (r) => [r.afterStop === 0, `callbacks after it: ${r.afterStop}`]);
}
{
  const r = run("measure");
  chk("W5 `measure` with two sets posts `measured` with its id and two numbers", r, (r) => [r.measured.length === 1 && r.measured[0].id === 5 && Array.isArray(r.measured[0].ms) && r.measured[0].ms.length === 2 && r.measured[0].ms.every((x) => Number.isFinite(x)), `measured ${show(r.measured)}`]);
  chk("W5 ... each number the ms a draw of that set took (a draw of 4 ms for the first set, of 10 for the second)", r, (r) => [r.measured.length === 1 && Math.abs(r.measured[0].ms[0] - 4) < 0.5 && Math.abs(r.measured[0].ms[1] - 10) < 0.5, `measured ${show(r.measured)}`]);
  chk("W5 ... each set drawn in turn, and finished: 8 draws, a pixel read after the first draw and after the three timed ones of each set", r, (r) => [r.paints === 8 && r.reads >= 4, `draws ${r.paints}, pixel reads ${r.reads}`]);
}
{
  const r = run("resize");
  chk("W5 `resize` sets the canvas's bitmap size: 1280 x 800 at 1.5 is 1920 x 1200", r, (r) => [show(r.a) === show([1920, 1200]), `bitmap ${show(r.a)} (was ${show(r.before)})`]);
  chk("W5 ... and 640 x 480 at 1 is 640 x 480", r, (r) => [show(r.b) === show([640, 480]), `bitmap ${show(r.b)}`]);
}
{
  const r = run("warn");
  chk("W5 a map that cannot be had: `baked { id, ok: false }`", r, (r) => [show(r.baked) === show([{ id: 3, ok: false }]), `baked ${show(r.baked)}`]);
  chk("W5 ... and world.js's warning is posted as `note { kind: \"warn\" }`", r, (r) => [r.notes.some((n) => n.kind === "warn" && /no map/.test(n.line)), `notes ${show(r.notes)}`]);
}
{
  const r = run("lost");
  chk("W5 the worker listens for `webglcontextlost` on its canvas, and posts `lost` when it comes", r, (r) => [r.handlers >= 1 && r.before === 0 && r.lost === 1, `listeners ${r.handlers}, lost posted before ${r.before}, after ${r.lost}`]);
}
chk("W5 `destroy` calls close()", run("destroy"), (r) => [r.closed === 1, `close() calls ${r.closed}`]);
{
  const r = run("decodePage");
  chk("decodePage (precondition) the bake was answered true", r, (r) => [show(r.baked) === show([true]), `baked ${show(r.baked)}`]);
  chk("decodePage `decode: \"page\"`: a `decode { id, blob, options }` is posted for each picture fetched (numeric ids, each different)", r, (r) => [r.asks.length > 0 && r.asks.length === r.fetched && r.distinctIds === r.asks.length && r.asks.every((a) => a.idKind === "number" && a.hasBlob && a.hasOptions), `fetched ${r.fetched}, asked ${show(r.asks)}`]);
  chk("decodePage ... each answered bitmap is the source of a texImage2D (the page's answer is what goes up)", r, (r) => [r.answered > 0 && r.unuploaded === 0, `answered ${r.answered}, not uploaded ${r.unuploaded}`]);
  chk("decodePage ... a `decoded` for an id never asked has its bitmap closed, and posts no `dead`", r, (r) => [r.stray.closes === 1 && !r.stray.uploaded && r.stray.newDeads === 0 && clean(r), `stray closes ${r.stray.closes}, uploaded ${r.stray.uploaded}, new dead ${r.stray.newDeads}, clone errors ${show(r.cloneErrors)}, dead ${show(r.deads)}`]);
}
{
  const r = run("decodePageNone");
  chk("decodePage control: no `decode` in the hello posts no `decode`", r, (r) => [r.asks.length === 0 && r.fetched > 0 && clean(r), `asked ${r.asks.length}, fetched ${r.fetched}`]);
  chk("decodePage ... and the pictures still go up (each decoded here is a texImage2D source)", r, (r) => [r.here > 0 && r.hereUploaded === r.here && show(r.baked) === show([true]), `decoded here ${r.here}, uploaded ${r.hereUploaded}, baked ${show(r.baked)}`]);
}
finish();
