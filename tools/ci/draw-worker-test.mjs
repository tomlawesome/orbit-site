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

const CASES = guarded({ up, compile, warm, pictures, fonts, size, visible, pinned, live, stop, destroy });

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
chk("D5 `destroy` calls close()", run("destroy"), (r) => [r.closed === 1, `close() calls ${r.closed}`]);
finish();
