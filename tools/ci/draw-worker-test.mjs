/*
 * Test for #85 batch 2, the worker (ADR-0004 6a.2, 6a.3, 6a.5 and 6a.7, test D5), written from the specification
 * alone: the worker side. assets/door/draw-worker.js is imported in a child process into the global scope of a
 * worker (door-stub.mjs: installWorkerSelf): a stub `self` (postMessage, onmessage, close, fonts) and no page at all
 * (no document, window, Image, innerWidth, devicePixelRatio, matchMedia, localStorage: a touch of one throws), fake
 * OffscreenCanvases for the two canvases whose contexts are the stub's recording gl and 2D, and a virtual clock.
 * Messages are delivered as the page posts them, and everything the worker posts is read back.
 *
 *   node tools/ci/draw-worker-test.mjs
 *
 *   up        `hello` alone posts no `up`; `canvases` after it posts one `up { ok: true }`, and no `dead`
 *   compile   the world's shaders (the flight's four, then the docs' galaxy's) are compiled with no frame asked for
 *             before, and no "compile" chore queued at any moment; a `note` says so (orbit · flight: shaders compiled)
 *   warm      `warm` is answered by `warmed` with its id (kind "warm" and "warmDocs"), and by nothing before it
 *   pictures  the pictures are fetched from the absolute URLs `hello` gave, all of them, and from no other address
 *   fonts     `hello`'s fonts make a FontFace of that family and url, added to self.fonts and load()ed; until load()
 *             settles there is no `up`, no `frame` and nothing drawn, even for a `start`; once it has, `up`
 *   size      a `size` mid-flight sets both canvases' bitmap sizes (new, and the shape of the new window)
 *   visible   `visible { hidden: true }` runs no fitness frame; `{ hidden: false }` runs it (control)
 *   pinned    `start` with `at` posts one `frame` with that `seq` and no more, and paints
 *   live      control: a live `start` posts one `frame` with its `seq`
 *   stop      a live `start` superseded by `stop` posts no `frame` for the old `seq`
 *   destroy   `destroy` calls close()
 *
 * And #113 (ADR-0004 6e, tests W1-W4; `hello.decode` is the page's verdict, "page" or "here"), written from the
 * specification alone. The worker's fetch gives each picture its own blob object (recorded), createImageBitmap logs
 * the calls made with one of them, and the recording GL logs what is uploaded:
 *
 *   w1  `decode: "page"`: for every picture fetched one `decode { id, blob, options }` is posted (the blob the very
 *       object fetched) and the worker's own createImageBitmap is not called with a blob while no answer has come;
 *       `decoded { id, bitmap }` lets that picture's upload proceed (texImage2D with that bitmap); one with an
 *       unknown id changes nothing. Control: "here", and no `decode` field: no `decode` posted, each blob decoded here
 *   w2  `decoded { id, error }`: the worker decodes that blob itself, once, with the ask's options, and uploads the
 *       result; no `dead`. Control: a good answer: no blob call for that id
 *   w3  no answer: nothing decoded by the worker before PICTURE_WAIT (chores.js) has passed, one blob call after, and
 *       the upload proceeds. Control: an answer just before the bound: no blob call, and none later
 *   w4  the Earth's picture (dawn/dawn.webp) is fetched once and asked for like the maps, and drawn once answered
 *       (a drawImage with the bitmap). Control: "here"
 *
 * One fresh Node process a case; virtual clock only, nothing waits on the runner. The page's side of the wire is what
 * ADR-0004 6a.3 says: a missing module or an unreadable message is reported as such, not as a stack.
 */
import { installPage, installClock, installWorkerSelf, WORKER, FONTS_ABS, IMAGES_ABS, BASE, DRAW_OPS, childMain, runCase, chk, finish } from "./door-stub.mjs";

/* a failure that is reported as itself, in a line, never as a stack */
const plainError = (message) => Object.assign(new Error(message), { plain: true });
const guarded = (cases) => Object.fromEntries(Object.entries(cases).map(([k, f]) => [k, async () => { try { return await f(); } catch (e) { if (e && e.plain) return { none: e.message }; throw e; } }]));

async function boot() {
  const page = installPage();
  const clock = installClock();
  const w = installWorkerSelf(page);
  w.page = page; w.clock = clock;
  try { await import(WORKER); }
  catch (e) { throw plainError(e && e.code === "ERR_MODULE_NOT_FOUND" && /draw-worker/.test(String(e.message)) ? "assets/door/draw-worker.js does not exist yet" : `assets/door/draw-worker.js did not load: ${String(e && e.stack || e).split("\n").slice(0, 3).join(" | ")}`); }
  if (typeof w.self.onmessage !== "function" && !(w.listeners.message || []).length) throw plainError("assets/door/draw-worker.js listens for no messages (self.onmessage is not set)");
  w.chores = (await import("../../assets/door/chores.js")).choresNow;
  const engine = await import("../../assets/door/engine.js");
  w.wired = engine.wireProfile(engine.UP);
  /* the chore queue is looked at after every message and every timer: a "compile" chore must never be seen in it */
  w.sawCompileChore = false;
  w.sample = () => { if (w.chores().queued.some((t) => t.split("+").includes("compile"))) w.sawCompileChore = true; return false; };
  const send = w.send;
  w.send = (m) => { send(m); w.sample(); };
  w.hello = (extra = {}) => ({ type: "hello", flags: {}, images: IMAGES_ABS, fonts: FONTS_ABS, baseURI: BASE, settle: 700, size: { W: 1280, H: 800, dpr: 1 }, hidden: false, ...extra });
  w.canvases = (size) => ({ type: "canvases", warp: w.warp, warpgl: w.warpgl, size: size ?? { W: 1280, H: 800, dpr: 1 } });
  w.bring = async (extra) => { w.send(w.hello(extra)); w.send(w.canvases()); await clock.advance(0, w.sample); };
  w.run = (ms, until) => clock.advance(ms, () => { w.sample(); return until ? until() : false; });
  w.drawn2d = () => w.warp.ops.filter((o) => DRAW_OPS.has(o.op)).length;
  return w;
}
const common = (w) => ({ cloneErrors: w.cloneErrors, deads: w.of("dead").map((m) => m.why) });

async function up() {
  const w = await boot();
  w.send(w.hello());
  await w.run(500);
  const afterHello = w.of("up").length;
  w.send(w.canvases());
  await w.run(2000);
  return { afterHello, ups: w.of("up").map((m) => ({ ok: m.ok, why: m.why })), ...common(w) };
}

async function compile() {
  const w = await boot();
  await w.bring();
  await w.run(5000);
  const srcs = w.compiles.map((c) => c.src);
  return {
    compiles: w.compiles.length, rafsAtCompile: w.compiles.map((c) => c.rafs), srcLens: srcs.map((s) => s.length),
    compileQueued: w.compiles.some((c) => c.queued.some((t) => t.split("+").includes("compile"))), sawCompileChore: w.sawCompileChore,
    notes: w.of("note").map((m) => ({ line: m.line, kind: m.kind })), ups: w.of("up").length, ...common(w),
  };
}

async function warm() {
  const w = await boot();
  await w.bring();
  await w.run(3000);
  const before = w.of("warmed").length;
  w.send({ type: "warm", id: 7, kind: "warm", prove: false });
  await w.run(20000, () => w.of("warmed").some((m) => m.id === 7));
  const first = w.of("warmed").map((m) => ({ id: m.id, ok: m.ok }));
  w.send({ type: "warm", id: 8, kind: "warmDocs", prove: false });
  await w.run(20000, () => w.of("warmed").some((m) => m.id === 8));
  return { before, first, all: w.of("warmed").map((m) => ({ id: m.id, ok: m.ok })), ...common(w) };
}

async function pictures() {
  const w = await boot();
  await w.bring();
  w.send({ type: "warm", id: 1, kind: "warm", prove: false });
  await w.run(20000, () => w.of("warmed").length >= 1);
  await w.run(1000);
  const given = Object.values(IMAGES_ABS);
  return { fetched: w.fetched, extra: w.fetched.filter((u) => !given.includes(u)), missing: given.filter((u) => !w.fetched.includes(u)), warmed: w.of("warmed").length, ...common(w) };
}

async function fonts() {
  const w = await boot();
  const release = w.holdFonts();
  w.send(w.hello());
  w.send(w.canvases());
  w.send({ type: "start", seq: 1, profile: w.wired, at: 1500 });
  await w.run(3000);
  const f = w.faces[0];
  const held = {
    faces: w.faces.length, family: f && f.family, hasUrl: !!f && String(f.source).includes(FONTS_ABS[0].url), weight: f && f.descriptors && String(f.descriptors.weight),
    added: !!f && w.fontsAdded.includes(f), loads: w.loads, ups: w.of("up").length, frames: w.of("frame").length, drawn2d: w.drawn2d(),
  };
  release();
  await w.run(3000);
  return { held, afterUps: w.of("up").map((m) => m.ok), afterLoaded: f ? f.status : null, ...common(w) };
}

async function size() {
  const w = await boot();
  await w.bring({ flags: { fit: "skip" } });
  w.send({ type: "warm", id: 1, kind: "warm", prove: true });
  await w.run(60000, () => w.of("warmed").some((m) => m.id === 1));
  const proved = w.of("warmed").some((m) => m.id === 1 && m.ok);
  w.send({ type: "start", seq: 1, profile: w.wired });
  await w.run(300);
  const a = { warp: [w.warp.width, w.warp.height], gl: [w.warpgl.width, w.warpgl.height] };
  w.send({ type: "size", W: 640, H: 480, dpr: 2 });
  await w.run(300);
  return { proved, before: a, after: { warp: [w.warp.width, w.warp.height], gl: [w.warpgl.width, w.warpgl.height] }, ...common(w) };
}

async function visible() {
  const w = await boot();
  await w.bring();
  w.send({ type: "visible", hidden: true });
  w.send({ type: "warm", id: 1, kind: "warm", prove: true });
  await w.run(40000);
  const hiddenReads = w.page.readPixels, hiddenWarmed = w.of("warmed").length;
  w.send({ type: "visible", hidden: false });
  await w.run(40000, () => w.of("warmed").some((m) => m.id === 1));
  return { hiddenReads, hiddenWarmed, shownReads: w.page.readPixels, shownWarmed: w.of("warmed").some((m) => m.id === 1), ...common(w) };
}

async function pinned() {
  const w = await boot();
  await w.bring();
  w.send({ type: "start", seq: 3, profile: w.wired, at: 1500 });
  await w.run(0);
  const early = w.of("frame").map((m) => ({ seq: m.seq, world: m.world }));
  await w.run(3000);
  return { early, late: w.of("frame").map((m) => ({ seq: m.seq, world: m.world })), drawn2d: w.drawn2d(), ...common(w) };
}

async function live() {
  const w = await boot();
  await w.bring();
  w.send({ type: "start", seq: 4, profile: w.wired });
  await w.run(3000);
  return { frames: w.of("frame").map((m) => ({ seq: m.seq })), drawn2d: w.drawn2d(), ...common(w) };
}

async function stop() {
  const w = await boot();
  await w.bring();
  w.send({ type: "start", seq: 5, profile: w.wired });
  w.send({ type: "stop", seq: 6 });
  await w.run(3000);
  return { frames: w.of("frame").map((m) => ({ seq: m.seq })), ...common(w) };
}

async function destroy() {
  const w = await boot();
  await w.bring();
  w.send({ type: "destroy" });
  await w.run(500);
  return { closed: w.closed, ...common(w) };
}


/* #113: what the worker fetches, decodes itself and uploads, with the 2D draws that carry a picture */
function spy(w) {
  const s = { blobs: [], blobCalls: [], tex: [], draws: [] };
  const prev = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const r = await prev(url);
    const blob = { size: 1, type: "image/webp", url: String(url) };
    s.blobs.push(blob);
    return { ...r, blob: async () => blob };
  };
  const orig = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async (src, ...r) => {
    const out = await orig(src, ...r);
    if (s.blobs.includes(src)) { out.fromBlob = true; s.blobCalls.push({ blob: src, opts: r[0], result: out }); }
    return out;
  };
  const tex = w.page.glBase.texImage2D;
  w.page.glBase.texImage2D = (...a) => { s.tex.push(a[a.length - 1]); return tex(...a); };
  const track = (ctx) => new Proxy(ctx, { get: (t, k) => (k === "drawImage" ? (...a) => { s.draws.push(a); return t.drawImage(...a); } : Reflect.get(t, k)) });
  const gc = w.warp.getContext;
  w.warp.getContext = (kind) => { const c = gc.call(w.warp, kind); return kind === "webgl2" ? c : track(c); };
  const c2d = w.page.ctx2d;
  w.page.ctx2d = (c) => track(c2d(c));
  s.asks = () => w.of("decode");
  s.uploaded = (bmp) => s.tex.includes(bmp);
  s.callsFor = (blob) => s.blobCalls.filter((c) => c.blob === blob);
  return s;
}
const BM = (name) => ({ width: 64, height: 64, name, close() {} });
const isDawn = (b) => /dawn\/dawn\.webp$/.test(b.url);
const waitFor = async (w, f, ms = 4000) => { await w.run(ms, f); return f(); };

async function decodeBoot(decode) {
  const w = await boot();
  const s = spy(w);
  const { PICTURE_WAIT } = await import("../../assets/door/chores.js");
  if (typeof PICTURE_WAIT !== "number") throw plainError("assets/door/chores.js exports no PICTURE_WAIT");
  w.send(w.hello(decode === undefined ? {} : { decode }));
  w.send(w.canvases());
  await w.run(0);
  w.send({ type: "warm", id: 1, kind: "warm", prove: false });
  return { w, s, PICTURE_WAIT };
}
const seen = (w, s) => ({
  asks: s.asks().map((m) => ({ id: m.id, hasBlob: s.blobs.includes(m.blob), url: m.blob && m.blob.url, options: m.options ?? null })),
  fetched: s.blobs.length, blobCalls: s.blobCalls.length, cloneErrors: w.cloneErrors, deads: w.of("dead").map((m) => m.why),
});

async function w1() {
  const { w, s } = await decodeBoot("page");
  await waitFor(w, () => s.asks().length > 0);
  await w.run(1000);
  const before = { ...seen(w, s), distinctIds: new Set(s.asks().map((m) => m.id)).size, uploads: s.tex.filter((x) => x && !x.probe).length, optionsSeen: s.asks().some((m) => m.options && m.options.premultiplyAlpha === "none") };
  /* an answer for an id nobody asked: nothing happens */
  const stray = BM("stray");
  let threw = null;
  try { w.send({ type: "decoded", id: 987654, bitmap: stray }); } catch (e) { threw = String(e && e.message); }
  await w.run(500);
  const afterStray = { uploaded: s.uploaded(stray), uploads: s.tex.filter((x) => x && !x.probe).length, blobCalls: s.blobCalls.length, deads: w.of("dead").length, threw };
  const ask = s.asks().find((m) => !isDawn(m.blob));
  const good = BM("good");
  if (ask) w.send({ type: "decoded", id: ask.id, bitmap: good });
  await w.run(1500);
  return { before, afterStray, answered: !!ask, uploadedGood: s.uploaded(good), blobCallForAsk: ask ? s.callsFor(ask.blob).length : null, after: seen(w, s) };
}
async function w1control(decode) {
  const { w, s } = await decodeBoot(decode);
  await w.run(20000, () => w.of("warmed").length >= 1);
  await w.run(1000);
  const decoded = s.blobs.filter((b) => s.callsFor(b).length >= 1).length;
  return { asks: s.asks().length, fetched: s.blobs.length, decodedHere: decoded, ...common(w) };
}
async function w2(answer) {
  const { w, s } = await decodeBoot("page");
  await waitFor(w, () => s.asks().some((m) => !isDawn(m.blob)));
  await w.run(500);
  const ask = s.asks().find((m) => !isDawn(m.blob));
  if (!ask) return { none: "the worker posted no `decode` for a map" };
  const good = BM("good");
  w.send(answer === "error" ? { type: "decoded", id: ask.id, error: "no" } : { type: "decoded", id: ask.id, bitmap: good });
  await w.run(1500);
  const calls = s.callsFor(ask.blob);
  return { calls: calls.length, optsEqual: calls.length === 1 && JSON.stringify(calls[0].opts ?? null) === JSON.stringify(ask.options ?? null), uploadedResult: calls.length > 0 && s.uploaded(calls[0].result), uploadedGood: s.uploaded(good), ...common(w) };
}
async function w3(how) {
  const { w, s, PICTURE_WAIT } = await decodeBoot("page");
  await waitFor(w, () => s.asks().some((m) => !isDawn(m.blob)));
  const t0 = performance.now();
  const ask = s.asks().find((m) => !isDawn(m.blob));
  if (!ask) return { none: "the worker posted no `decode` for a map" };
  const good = BM("good");
  await w.run(PICTURE_WAIT - 2000 - (performance.now() - t0));
  const early = { calls: s.callsFor(ask.blob).length, anyCalls: s.blobCalls.length };
  if (how === "late-answer") w.send({ type: "decoded", id: ask.id, bitmap: good });
  await w.run(1000);
  await w.run(PICTURE_WAIT + 4000 - (performance.now() - t0));
  const calls = s.callsFor(ask.blob);
  return { early, calls: calls.length, uploadedResult: calls.length > 0 && s.uploaded(calls[0].result), uploadedGood: s.uploaded(good), ...common(w) };
}
async function w4(decode) {
  const { w, s } = await decodeBoot(decode);
  const dawnAsked = () => s.asks().find((m) => isDawn(m.blob));
  await waitFor(w, () => (decode === "page" ? !!dawnAsked() : s.blobs.some(isDawn) && s.blobCalls.some((c) => isDawn(c.blob))), 6000);
  const good = BM("dawn");
  const ask = dawnAsked();
  if (decode === "page" && ask) w.send({ type: "decoded", id: ask.id, bitmap: good });
  await w.run(500);
  w.send({ type: "start", seq: 1, profile: w.wired, at: 1500 });
  await w.run(3000);
  const dawnBlob = s.blobs.find(isDawn);
  const result = dawnBlob && s.callsFor(dawnBlob)[0] ? s.callsFor(dawnBlob)[0].result : null;
  return {
    fetchedDawn: w.fetched.filter((u) => /dawn\/dawn\.webp$/.test(u)).length, asked: s.asks().filter((m) => isDawn(m.blob)).length, askedAny: s.asks().length,
    drawnWith: decode === "page" ? s.draws.some((a) => a.includes(good)) : !!result && s.draws.some((a) => a.includes(result)), blobCalls: dawnBlob ? s.callsFor(dawnBlob).length : 0, ...common(w),
  };
}

const CASES = guarded({ up, compile, warm, pictures, fonts, size, visible, pinned, live, stop, destroy,
  w1, w1here: () => w1control("here"), w1none: () => w1control(undefined), w2, w2good: () => w2("good"), w3: () => w3("silence"), w3late: () => w3("late-answer"),
  w4: () => w4("page"), w4here: () => w4("here") });

if (process.argv[2] === "--child") await childMain(CASES);

const show = (x) => JSON.stringify(x);
const run = (n) => runCase(import.meta.url, n);
const clean = (r) => r.cloneErrors.length === 0 && r.deads.length === 0;
const aspect = ([a, b]) => a / b;
const near = (x, y) => Math.abs(x - y) / y < 0.01;

{
  const r = run("up");
  chk("D5 `hello` alone posts no `up`", r, (r) => [r.afterHello === 0, `ups after hello: ${r.afterHello}`]);
  chk("D5 `hello` then `canvases` posts one `up { ok: true }`", r, (r) => [r.ups.length === 1 && r.ups[0].ok === true, `ups ${show(r.ups)}`]);
  chk("D5 ... and nothing it posts is beyond structured clone, and no `dead`", r, (r) => [clean(r), `clone errors ${show(r.cloneErrors)}, dead ${show(r.deads)}`]);
}
{
  const r = run("compile");
  chk("D5 the world's shaders are compiled once up (the flight's four, and the docs' galaxy's three)", r, (r) => [r.ups === 1 && r.compiles >= 7, `compileShader calls ${r.compiles}, ups ${r.ups}`]);
  chk("D5 ... the flight's four before any frame is requested", r, (r) => [r.compiles >= 4 && r.rafsAtCompile.slice(0, 4).every((n) => n === 0), `frames asked at each compile ${show(r.rafsAtCompile)}`]);
  chk("D5 ... and the galaxy's too (back to back, no frame between)", r, (r) => [r.compiles >= 7 && r.rafsAtCompile.every((n) => n === 0), `frames asked at each compile ${show(r.rafsAtCompile)}`]);
  chk("D5 ... with no \"compile\" chore queued, at any moment", r, (r) => [!r.compileQueued && !r.sawCompileChore, `queued when compiling: ${r.compileQueued}; seen in the queue: ${r.sawCompileChore}`]);
  chk("D5 ... and a `note` says the shaders were compiled (orbit · flight: shaders compiled in N ms)", r, (r) => [r.notes.some((n) => /^orbit · flight: shaders compiled in \d+ ms/.test(n.line)), `notes ${show(r.notes)}`]);
}
{
  const r = run("warm");
  chk("D5 no `warmed` before any `warm`", r, (r) => [r.before === 0, `warmed posted: ${r.before}`]);
  chk("D5 `warm` is answered by `warmed` with its id", r, (r) => [r.first.length === 1 && r.first[0].id === 7, `warmed ${show(r.first)}`]);
  chk("D5 `warm` of kind warmDocs is answered by `warmed` with its id, and no other is posted", r, (r) => [r.all.length === 2 && r.all[1].id === 8 && r.all.every((m) => m.ok === true), `warmed ${show(r.all)}`]);
}
{
  const r = run("pictures");
  chk("D5 (precondition) the warm was answered", r, (r) => [r.warmed >= 1, `warmed posted: ${r.warmed}`]);
  chk("D5 the pictures are fetched from the absolute URLs given, and from no other", r, (r) => [r.extra.length === 0 && r.fetched.length > 0, `fetched ${show(r.fetched)}; not given ${show(r.extra)}`]);
  chk("D5 ... every picture the flight draws with (eight maps and the Earth's dawn picture) was fetched", r, (r) => [r.missing.length === 0, `never fetched ${show(r.missing)}`]);
}
{
  const r = run("fonts");
  chk("D5 `fonts` makes a FontFace of that family and url, added to self.fonts and load()ed", r, (r) => [r.held.faces === 1 && r.held.family === FONTS_ABS[0].family && r.held.hasUrl && r.held.weight === "500" && r.held.added && r.held.loads >= 1, show(r.held)]);
  chk("D5 ... until load() settles: no `up`, no `frame`, nothing drawn (even for a `start` at 1500)", r, (r) => [r.held.ups === 0 && r.held.frames === 0 && r.held.drawn2d === 0, show(r.held)]);
  chk("D5 ... once it has settled: `up { ok: true }`", r, (r) => [r.afterUps.length === 1 && r.afterUps[0] === true, `ups ${show(r.afterUps)}, face ${r.afterLoaded}`]);
}
{
  const r = run("size");
  chk("D5 (precondition) the world was proved before the flight", r, (r) => [r.proved === true, `proved ${r.proved}`]);
  chk("D5 a flight under way is sized to the page: both canvases' bitmaps are the shape of 1280x800", r, (r) => [near(aspect(r.before.warp), 1.6) && near(aspect(r.before.gl), 1.6), `before ${show(r.before)}`]);
  chk("D5 `size` mid-flight sets both canvases' bitmap sizes: new, and the shape of 640x480", r, (r) => {
    const { before: b, after: a } = r;
    return [show(a.warp) !== show(b.warp) && show(a.gl) !== show(b.gl) && near(aspect(a.warp), 4 / 3) && near(aspect(a.gl), 4 / 3), `before ${show(b)}, after ${show(a)}`];
  });
}
{
  const r = run("visible");
  chk("D5 `visible { hidden: true }` runs no fitness frame (no frame is read back) and the warm waits", r, (r) => [r.hiddenReads === 0 && r.hiddenWarmed === 0, `pixel reads while hidden ${r.hiddenReads}, warmed ${r.hiddenWarmed}`]);
  chk("D5 ... `visible { hidden: false }` runs it, and the warm is answered (control)", r, (r) => [r.shownReads > 0 && r.shownWarmed === true, `pixel reads once shown ${r.shownReads}, warmed ${r.shownWarmed}`]);
}
{
  const r = run("pinned");
  chk("D5 `start` with `at` posts one `frame` with that `seq`", r, (r) => [r.late.length === 1 && r.late[0].seq === 3 && typeof r.late[0].world === "boolean", `frames ${show(r.late)}`]);
  chk("D5 ... and it paints", r, (r) => [r.drawn2d > 0, `2D draw calls ${r.drawn2d}`]);
  chk("D5 ... the one frame is posted by the time the message is handled (no waiting on a frame of its own)", r, (r) => [r.early.length === 1, `frames posted before any timer ran ${show(r.early)}`]);
}
{
  const r = run("live");
  chk("D5 (control) a live `start` posts one `frame` with its `seq`, and paints", r, (r) => [r.frames.length === 1 && r.frames[0].seq === 4 && r.drawn2d > 0, `frames ${show(r.frames)}, 2D draw calls ${r.drawn2d}`]);
  const s = run("stop");
  chk("D5 a `start` superseded by `stop` posts no `frame` for the old `seq`", s, (r) => [r.frames.every((m) => m.seq !== 5), `frames ${show(r.frames)}`]);
}

{
  const r = run("w1");
  const clean1 = (x) => x.cloneErrors.length === 0 && x.deads.length === 0;
  chk("W1 `decode: \"page\"`: a `decode` is posted (with an id, the fetched blob and the options) for every picture fetched", r, (r) => [r.before.asks.length > 0 && r.before.asks.length === r.before.fetched && r.before.asks.every((a) => a.id !== undefined && a.hasBlob) && r.before.distinctIds === r.before.asks.length, `fetched ${r.before.fetched}, asked ${show(r.before.asks.map((a) => ({ id: a.id, hasBlob: a.hasBlob })))}`]);
  chk("W1 ... the caller's options go with the ask (the maps' premultiplyAlpha \"none\")", r, (r) => [r.before.optionsSeen, `options of the asks ${show(r.before.asks.map((a) => a.options))}`]);
  chk("W1 ... the worker's own createImageBitmap is not called with a blob while no answer has come", r, (r) => [r.before.blobCalls === 0 && r.before.uploads === 0, `blob calls ${r.before.blobCalls}, picture uploads ${r.before.uploads}`]);
  chk("W1 ... a `decoded` with an unknown id changes nothing (no upload, no error, no `dead`)", r, (r) => [!r.afterStray.uploaded && r.afterStray.uploads === r.before.uploads && r.afterStray.blobCalls === 0 && r.afterStray.deads === 0 && r.afterStray.threw === null, show(r.afterStray)]);
  chk("W1 ... `decoded { id, bitmap }` lets that picture's upload proceed (texImage2D with that bitmap), with no blob call for it", r, (r) => [r.answered && r.uploadedGood && r.blobCallForAsk === 0 && clean1(r.after), `answered ${r.answered}, uploaded ${r.uploadedGood}, blob calls for it ${r.blobCallForAsk}, ${show({ c: r.after.cloneErrors, d: r.after.deads })}`]);
  for (const [name, label] of [["w1here", "\"here\""], ["w1none", "no `decode` field"]]) {
    const c = run(name);
    chk(`W1 control: ${label}: no \`decode\` is ever posted`, c, (c) => [c.asks === 0 && c.fetched > 0 && c.cloneErrors.length === 0 && c.deads.length === 0, `asks ${c.asks}, fetched ${c.fetched}`]);
    chk(`W1 control: ${label}: createImageBitmap is called with each blob`, c, (c) => [c.fetched > 0 && c.decodedHere === c.fetched, `${c.decodedHere} of ${c.fetched} blobs decoded here`]);
  }
}
{
  const r = run("w2"), g = run("w2good");
  chk("W2 `decoded { id, error }`: the worker calls createImageBitmap with that blob, once, with the ask's options", r, (r) => [r.calls === 1 && r.optsEqual, `blob calls for it ${r.calls}, options equal ${r.optsEqual}`]);
  chk("W2 ... the upload proceeds with the result, and no `dead`", r, (r) => [r.uploadedResult && r.deads.length === 0 && r.cloneErrors.length === 0, `uploaded the result ${r.uploadedResult}, dead ${show(r.deads)}`]);
  chk("W2 control: a good answer: no blob call for that id, the page's bitmap uploaded", g, (g) => [g.calls === 0 && g.uploadedGood, `blob calls ${g.calls}, uploaded the page's bitmap ${g.uploadedGood}`]);
}
{
  const r = run("w3"), l = run("w3late");
  chk("W3 no answer: before PICTURE_WAIT has passed the worker has not decoded the picture itself", r, (r) => [r.early.calls === 0 && r.early.anyCalls === 0, show(r.early)]);
  chk("W3 ... once it has passed it has (one blob call) and the upload proceeds", r, (r) => [r.calls === 1 && r.uploadedResult && r.deads.length === 0, `blob calls ${r.calls}, uploaded ${r.uploadedResult}, dead ${show(r.deads)}`]);
  chk("W3 control: an answer just before the bound: no blob call, the page's bitmap uploaded", l, (l) => [l.early.calls === 0 && l.calls === 0 && l.uploadedGood, `blob calls after the bound ${l.calls}, uploaded the page's bitmap ${l.uploadedGood}`]);
}
{
  const r = run("w4"), c = run("w4here");
  chk("W4 `decode: \"page\"`: dawn/dawn.webp is fetched once and asked for like the maps", r, (r) => [r.fetchedDawn === 1 && r.asked === 1, `fetched ${r.fetchedDawn} time(s), asked ${r.asked} time(s)`]);
  chk("W4 ... and drawn (a drawImage with the bitmap) once answered", r, (r) => [r.drawnWith && r.blobCalls === 0 && r.deads.length === 0, `drawn with the page's bitmap ${r.drawnWith}, blob calls for it ${r.blobCalls}, dead ${show(r.deads)}`]);
  chk("W4 control: \"here\": no `decode` posted, the picture decoded here and drawn", c, (c) => [c.fetchedDawn === 1 && c.askedAny === 0 && c.blobCalls === 1 && c.drawnWith, `fetched ${c.fetchedDawn}, decodes asked ${c.askedAny}, blob calls ${c.blobCalls}, drawn ${c.drawnWith}`]);
}
chk("D5 `destroy` calls close()", run("destroy"), (r) => [r.closed === 1, `close() calls ${r.closed}`]);
finish();
