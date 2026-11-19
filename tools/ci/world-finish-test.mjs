/*
 * Test for #119 (the flight's shaders asked after the install's first draw), the world's side: statements L10-L14 of
 * the specification, written from it alone, before the code. The flight is asked for its shaders once the install's
 * world has drawn its first frame for real, so "first drawn" must mean the GPU has done it: the world's worker answers
 * `finish` with `finished` after its own world.finish() ran, remote-world.js's finish() returns a promise that settles
 * on it, and install.js's `firstDrawn` settles on that. (The word itself is flight-late-test.mjs'.)
 *
 *   node tools/ci/world-finish-test.mjs
 *
 * C. assets/js/remote-world.js alone (as world-fallback-test.mjs's `remote`): createRemoteWorld on a pad's canvas with
 *    the fake world worker (door-stub.mjs: installWorldWorker), the clock virtual. The fake never says `finished` by
 *    itself: a case says it.
 *
 *   c1  L10  finish() posts `finish` and is a promise, pending until `finished`, then settled
 *   c2  L10  two calls settle on one `finished`
 *   c3  L10  destroy settles a pending one at once; and one asked after destroy is settled at once
 *   c4  L10  `lost` settles a pending one at once
 *   c5  L10  `dead` (the fallback to the page) settles a pending one at once; the worker's `error` likewise; and a finish()
 *            asked on the page world after the fallback settles at once
 *
 * G. assets/js/world-worker.js imported into a stub worker scope (door-stub.mjs: installWorkerSelf, as
 *    world-worker-test.mjs), the recording gl, a virtual clock:
 *
 *   g1  L11  `finish` is answered by one `finished`, posted after world.finish() ran (the gl read it does), with no view held
 *   g2  L11  the same with a view held (control: it is drawn, then finished)
 *
 * D. assets/js/install.js on the stub page with the fake world worker (as world-fallback-test.mjs): `firstDrawn`, a promise
 *    on the install's ring (ring.firstDrawn, read after ring.prepare(): the specification does not say where it is kept;
 *    the ring's own `baked` and `prepared` are, so it is read there):
 *
 *   d1  L12  first touch: after the two draws (`view`s) and the `finish` post, firstDrawn is pending; it settles on `finished`
 *   d2  L13  the second pad (information, the one shared world) runs touch while the first is under way: its firstDrawn
 *            stays pending until `finished`, and settles then (the first's too)
 *   d3  L14  touch skipped: the world did not bake, reduced motion, the owner busy (the pad running), a dive (motion): firstDrawn
 *            settles at once and no `finish` is posted
 *   d4  L14  a draw that throws: firstDrawn settles at once (the throw is the chore's, not waited on)
 *
 * One fresh Node process a case; virtual clock only. A missing module, export or property is said in plain words.
 */
import {
  installPage, installClock, installWorkerSelf, bootInstallPage, fakeWorldWorkers, installWorldWorker, namedUniforms, sceneAt, BASE,
  childMain, runCase, chk, finish,
} from "./door-stub.mjs";

const here = import.meta.url;
const INSTALL = "../../assets/js/install.js", REMOTE = "../../assets/js/remote-world.js", WORKER = "../../assets/js/world-worker.js";
const plainError = (message) => Object.assign(new Error(message), { plain: true });
const guarded = (cases) => Object.fromEntries(Object.entries(cases).map(([k, f]) => [k, async () => { try { return await f(); } catch (e) { if (e && e.plain) return { none: e.message }; throw e; } }]));
/* a promise's state now, and its value */
const watch = (p) => { const o = { state: "pending", value: undefined, thenable: !!p && typeof p.then === "function" }; Promise.resolve(p).then((v) => { o.state = "resolved"; o.value = v; }, (e) => { o.state = "rejected"; o.value = e; }); return o; };

/* ── C: remote-world.js ───────────────────────────────────────────────────────────────────────────────────────── */
async function remote() {
  const b = await bootInstallPage({ draw: "worker" });
  b.ww = installWorldWorker(b, fakeWorldWorkers());
  let mod;
  try { mod = await import(REMOTE); } catch (e) { throw plainError(`assets/js/remote-world.js could not be imported: ${e && e.message}`); }
  const world = mod.createRemoteWorld(b.pad().canvas, { tag: "install", small: true }, { worker: () => b.ww.make() });
  await b.clock.advance(100);
  const w = b.ww.first();
  if (!w) throw plainError("createRemoteWorld made no worker");
  return { b, world, w };
}
async function c1() {
  const { b, world, w } = await remote();
  const p = world.finish();
  const t = watch(p);
  await b.clock.advance(3000);
  const held = { state: t.state, posts: w.of("finish").length, thenable: t.thenable };
  w.say({ type: "finished" });
  await b.clock.advance(10);
  return { held, after: { state: t.state }, cloneErrors: w.cloneErrors };
}
async function c2() {
  const { b, world, w } = await remote();
  const a = watch(world.finish()), c = watch(world.finish());
  await b.clock.advance(3000);
  const held = { a: a.state, c: c.state };
  w.say({ type: "finished" });
  await b.clock.advance(10);
  return { held, after: { a: a.state, c: c.state } };
}
async function c3() {
  const { b, world, w } = await remote();
  const t = watch(world.finish());
  await b.clock.advance(1000);
  const held = t.state;
  world.destroy();
  await b.clock.advance(10);
  const after = watch(world.finish());
  await b.clock.advance(10);
  return { held, pending: t.state, later: after.state, late: w.late.filter((m) => m && m.type === "finish").length };
}
async function c4() {
  const { b, world, w } = await remote();
  const t = watch(world.finish());
  await b.clock.advance(1000);
  const held = t.state;
  w.say({ type: "lost" });
  await b.clock.advance(10);
  return { held, after: t.state };
}
async function c5(how) {
  const { b, world, w } = await remote();
  const t = watch(world.finish());
  await b.clock.advance(1000);
  const held = t.state;
  if (how === "dead") w.say({ type: "dead", why: "the world threw outside a frame" }); else w.fail("the worker script failed to run");
  await b.clock.advance(200);
  const pending = t.state;
  const later = watch(world.finish());
  await b.clock.advance(200);
  return { held, after: pending, later: later.state, laterPosts: w.late.filter((m) => m && m.type === "finish").length };
}

/* ── G: world-worker.js ───────────────────────────────────────────────────────────────────────────────────────── */
const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const mkView = (n = 1) => ({
  cam: [n, 0.5, 5], fwd: [0, -0.1, -1], right: [1, 0, 0], up: [0, 1, 0], focal: 900, sunPx: [100, 200], shift: [0, 0],
  look: { HUE: new Float32Array(ID), RING_K: 1, HAZE: [0.85, 0.82, 1.0], GRADE: null },
  sun: [-0.95, 0.28, -0.08], spin: ID, tilt: ID, sky: ID, moon: [1, 1, 1, 0.075], moon2: [0, 0, 0, 0],
  part: 1, dustN: 30, time: n, bg: 1, sunVis: 1, expo: 1, vel: [0, 0, 0], focusD: 5, blur: 0, dust: 1, fringe: 0.012, grain: 0.028, blurC: [640, 400], ...{},
});
const URLS = {
  map: new URL("assets/img/install/planet-2k.webp", BASE).href,
  rings: new URL("assets/img/install/rings.png", BASE).href,
  moon: new URL("assets/door/img/flight/moon.webp", BASE).href,
};
async function worker() {
  const page = installPage();
  const clock = installClock();
  const w = installWorkerSelf(page);
  w.page = page;
  w.uniforms = namedUniforms(page);
  /* what happened, in order: the gl reads the world's finish() does, and what the worker posts */
  w.order = [];
  const read = page.glBase.readPixels;
  page.glBase.readPixels = (...a) => { w.order.push("read"); return read(...a); };
  const post = w.self.postMessage;
  w.self.postMessage = (m) => { w.order.push(`post:${m && m.type}`); post(m); };
  try { await import(WORKER); }
  catch (e) { throw plainError(e && e.code === "ERR_MODULE_NOT_FOUND" && /world-worker/.test(String(e.message)) ? "assets/js/world-worker.js does not exist yet" : `assets/js/world-worker.js did not load: ${String(e && e.stack || e).split("\n").slice(0, 3).join(" | ")}`); }
  w.run = (ms, until) => clock.advance(ms, until);
  w.bring = async () => {
    w.send({ type: "hello", flags: {}, baseURI: BASE, world: { small: true, ...URLS }, sky: 1024, tag: "install" });
    w.send({ type: "canvas", canvas: w.warp });
    await w.run(0);
    w.send({ type: "resize", w: 1280, h: 800, scale: 1 });
    await w.run(0);
    w.send({ type: "bake", id: 1 });
    await w.run(20000, () => w.of("baked").some((m) => m.id === 1));
    await w.run(200);
  };
  return w;
}
async function g(held) {
  const w = await worker();
  await w.bring();
  if (!w.of("baked").some((m) => m.ok)) return { none: "the world did not bake in the stub worker" };
  w.order.length = 0;
  if (held) w.send(structuredClone({ type: "view", seq: 5, view: mkView(5) }));
  w.send({ type: "finish" });
  await w.run(500);
  const finished = w.of("finished");
  const at = w.order.indexOf("post:finished");
  return { finished: finished.length, reads: w.order.slice(0, Math.max(at, 0)).filter((x) => x === "read").length, order: w.order.filter((x) => x === "read" || /finished|drew|dead/.test(x)).slice(0, 8), deads: w.of("dead").length, cloneErrors: w.cloneErrors };
}

/* ── D: install.js ────────────────────────────────────────────────────────────────────────────────────────────── */
async function install(o = {}) {
  process.on("unhandledRejection", () => {});
  const b = await bootInstallPage({ draw: "worker" });
  if (o.reduced) globalThis.matchMedia = (q) => ({ matches: /prefers-reduced-motion/.test(String(q)), addEventListener() {}, removeEventListener() {} });
  b.ww = installWorldWorker(b, fakeWorldWorkers(o.auto));
  if (o.throwViews) {
    const make = b.ww.make;
    b.ww.make = (...a) => {
      const w = make(...a), post = w.postMessage.bind(w);
      w.postMessage = (m, t) => { if (m && m.type === "view") throw new Error("the draw threw"); return post(m, t); };
      return w;
    };
  }
  const { createInstall } = await import(INSTALL);
  const ring = createInstall(b.pad("installpad"));
  ring.prepare().catch(() => {});
  await b.clock.advance(0);
  if (!("firstDrawn" in ring)) throw plainError("the install's ring has no firstDrawn (assets/js/install.js)");
  b.ring = ring;
  return b;
}
const drawn = (b) => watch(b.ring.firstDrawn);
async function d1() {
  const b = await install();
  const t = drawn(b), w = b.ww.first();
  if (!w) return { none: "no world worker was made" };
  await b.clock.advance(8000, () => w.of("finish").length >= 1);
  const at = { views: w.of("view").length, finishes: w.of("finish").length, state: t.state, thenable: t.thenable };
  const order = w.posted.map((m) => m.type);
  await b.clock.advance(3000);
  const held = t.state;
  w.say({ type: "finished" });
  await b.clock.advance(100);
  return { at, held, after: t.state, lastViewBeforeFinish: order.lastIndexOf("view") < order.indexOf("finish") };
}
async function d2() {
  const b = await install();
  const { createInstall } = await import(INSTALL);
  const second = createInstall(b.pad("infopad"));
  second.prepare().catch(() => {});
  const t1 = drawn(b), t2 = watch(second.firstDrawn), w = b.ww.first();
  if (!w) return { none: "no world worker was made" };
  await b.clock.advance(8000, () => w.of("finish").length >= 1);
  await b.clock.advance(5000);
  const held = { first: t1.state, second: t2.state, finishes: w.of("finish").length, worlds: b.ww.made };
  w.say({ type: "finished" });
  await b.clock.advance(100);
  return { held, after: { first: t1.state, second: t2.state } };
}
async function d3(how) {
  const b = await install(how === "reduced" ? { reduced: true } : how === "nobake" ? { auto: { baked: { ok: false } } } : {});
  const w = b.ww.first();
  if (!w) return { none: "no world worker was made" };
  const t = drawn(b);
  if (how === "busy") b.ring.start();
  if (how === "dive") b.ring.form(sceneAt()).catch(() => {});
  await b.clock.advance(8000);
  return { state: t.state, finishes: w.of("finish").length };
}
async function d4() {
  const b = await install({ throwViews: true });
  const w = b.ww.first();
  if (!w) return { none: "no world worker was made" };
  const t = drawn(b);
  await b.clock.advance(8000);
  return { state: t.state, finishes: w.of("finish").length };
}

const CASES = guarded({
  c1, c2, c3, c4, c5dead: () => c5("dead"), c5error: () => c5("error"), g1: () => g(false), g2: () => g(true),
  d1, d2, d3reduced: () => d3("reduced"), d3nobake: () => d3("nobake"), d3busy: () => d3("busy"), d3dive: () => d3("dive"), d4,
});

if (process.argv[2] === "--child") await childMain(CASES);

const show = (x) => JSON.stringify(x);
const run = (n) => runCase(here, n);

{
  const r = run("c1");
  chk("L10 worker-world finish() posts `finish` and returns a promise", r, (r) => [r.held.thenable && r.held.posts === 1 && r.cloneErrors.length === 0, `thenable ${r.held.thenable}, finish posts ${r.held.posts}`]);
  chk("L10 ... which stays pending until `finished` (3 s on), and settles on it", r, (r) => [r.held.state === "pending" && r.after.state === "resolved", `held ${r.held.state}, after ${r.after.state}`]);
}
{
  const r = run("c2");
  chk("L10 two finish() calls both stay pending, and settle on one `finished`", r, (r) => [r.held.a === "pending" && r.held.c === "pending" && r.after.a === "resolved" && r.after.c === "resolved", show(r)]);
}
{
  const r = run("c3");
  chk("L10 destroy settles a pending finish() at once", r, (r) => [r.held === "pending" && r.pending === "resolved", `before ${r.held}, after destroy ${r.pending}`]);
  chk("L10 ... and one asked after destroy is settled at once, and not posted", r, (r) => [r.later === "resolved" && r.late === 0, `later ${r.later}, finish posts to the terminated worker ${r.late}`]);
}
{
  const r = run("c4");
  chk("L10 `lost` settles a pending finish() at once", r, (r) => [r.held === "pending" && r.after === "resolved", `before ${r.held}, after lost ${r.after}`]);
}
for (const how of ["dead", "error"]) {
  const r = run(`c5${how}`);
  const what = how === "dead" ? "`dead` (the fallback to the page)" : "the worker's `error` (the fallback to the page)";
  chk(`L10 ${what} settles a pending finish() at once`, r, (r) => [r.held === "pending" && r.after === "resolved", `before ${r.held}, after ${r.after}`]);
  chk(`L10 ... and a finish() asked on the page world afterwards settles at once, nothing posted to the worker`, r, (r) => [r.later === "resolved" && r.laterPosts === 0, `later ${r.later}, posts ${r.laterPosts}`]);
}
for (const [name, label] of [["g1", "no view held"], ["g2", "a view held (control)"]]) {
  const r = run(name);
  chk(`L11 \`finish\` with ${label}: answered by one \`finished\`, no \`dead\``, r, (r) => [r.finished === 1 && r.deads === 0 && r.cloneErrors.length === 0, `finished ${r.finished}, dead ${r.deads}`]);
  chk(`L11 ... posted after world.finish() ran (a gl read before it)`, r, (r) => [r.finished === 1 && r.reads >= 1, `reads before the post ${r.reads}, order ${show(r.order)}`]);
}
{
  const r = run("d1");
  chk("L12 first touch: the two draws (`view`s) and the `finish` post come, in that order", r, (r) => [r.at.views >= 2 && r.at.finishes === 1 && r.lastViewBeforeFinish, `views ${r.at.views}, finish posts ${r.at.finishes}, views before finish ${r.lastViewBeforeFinish}`]);
  chk("L12 ... firstDrawn is a promise, pending after the draws and the post (3 s on)", r, (r) => [r.at.thenable && r.at.state === "pending" && r.held === "pending", `at the post ${r.at.state}, 3 s on ${r.held}`]);
  chk("L12 ... and settles on `finished`", r, (r) => [r.after === "resolved", `after finished ${r.after}`]);
}
{
  const r = run("d2");
  chk("L13 the second pad runs touch while the first is under way: both firstDrawn stay pending (5 s on); the world is the one", r, (r) => [r.held.first === "pending" && r.held.second === "pending" && r.held.worlds === 1, show(r.held)]);
  chk("L13 ... and both settle on the one `finished`", r, (r) => [r.after.first === "resolved" && r.after.second === "resolved", show(r.after)]);
}
for (const [how, label] of [["nobake", "the world does not bake"], ["reduced", "reduced motion"], ["busy", "the owner busy (the pad running)"], ["dive", "a dive under way (motion)"]]) {
  const r = run(`d3${how}`);
  chk(`L14 touch skipped, ${label}: firstDrawn settles at once, no \`finish\` posted`, r, (r) => [r.state === "resolved" && r.finishes === 0, `firstDrawn ${r.state}, finish posts ${r.finishes}`]);
}
{
  const r = run("d4");
  chk("L14 a draw that throws: firstDrawn settles at once, no `finish` posted", r, (r) => [r.state === "resolved" && r.finishes === 0, `firstDrawn ${r.state}, finish posts ${r.finishes}`]);
}
finish();
