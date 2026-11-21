/*
 * Test for #154, the worlds' worker asks the canvas handed over from the page for a kind of context once, written from the
 * specification alone. On Firefox 159 a canvas handed to a worker (transferControlToOffscreen) throws InvalidStateError
 * ("Cannot update created context to different thread") on any second getContext call made in the worker, even for the
 * same kind. The harness is world-worker-test.mjs's (door-stub.mjs: installWorkerSelf, the page's own message handshake
 * `hello`, `canvas`, `bake`, `view`); the handed-over canvas is given the browser's rule: the second getContext of it, of
 * any kind, throws an InvalidStateError.
 *
 *   node tools/ci/world-context-once-test.mjs
 *
 *   once    the canvas handed over, the worker comes up: one `up { ok: true }`, no `dead`, and the world baked and drawn
 *           (a `bake`, a `view`) does not end in one either
 *   later   a later ask of the same canvas for the same kind, made by the test as a second module in the worker would, does
 *           not throw and is given the very same context, and the canvas's own getContext is still called once for the kind
 *   count   the canvas's getContext was called at most once for each kind, over the whole bring-up
 *   dead    when something throws while a message is handled, `dead` carries the error's message in `why` unchanged and,
 *           in `at`, a string with the first lines of the error's stack (where it stopped)
 *
 * One fresh Node process a case; virtual clock only, nothing waits on the runner. Behaviour only, never timings.
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
/* a view as install.js's draw builds it */
const mkView = (n = 1) => ({
  cam: [n, 0.5, 5], fwd: [0, -0.1, -1], right: [1, 0, 0], up: [0, 1, 0], focal: 900, sunPx: [100, 200], shift: [0, 0],
  look: { HUE: new Float32Array(ID), RING_K: 1, HAZE: [0.85, 0.82, 1.0], GRADE: null },
  sun: [-0.95, 0.28, -0.08], spin: ID, tilt: ID, sky: ID, moon: [1, 1, 1, 0.075], moon2: [0, 0, 0, 0],
  part: 1, dustN: 30, time: n, bg: 1, sunVis: 1, expo: 1, vel: [0, 0, 0], focusD: 5, blur: 0, dust: 1, fringe: 0.012, grain: 0.028, blurC: [640, 400],
});

/* a canvas as Firefox hands it to a worker: the first getContext is answered (by the stand-in's own), a second one, of any
   kind, throws InvalidStateError. `asked` is every kind asked of it, in order */
function strict(c) {
  const real = c.getContext.bind(c);
  c.asked = [];
  c.getContext = (kind, ...a) => {
    c.asked.push(kind);
    if (c.asked.length > 1) throw new DOMException("Cannot update created context to different thread", "InvalidStateError");
    return (c.made = real(kind, ...a));
  };
  return c;
}
/* the most times any one kind was asked of this canvas */
const most = (c) => Math.max(0, ...[...new Set(c.asked)].map((k) => c.asked.filter((x) => x === k).length));

async function boot() {
  const page = installPage();
  const clock = installClock();
  const w = installWorkerSelf(page);
  w.page = page; w.clock = clock;
  w.frameMs = 16;
  const frame = (f) => globalThis.setTimeout(() => f(performance.now()), w.frameMs);
  globalThis.requestAnimationFrame = frame; w.self.requestAnimationFrame = frame;
  w.uniforms = namedUniforms(page);
  try { await import(WORKER); }
  catch (e) { throw plainError(e && e.code === "ERR_MODULE_NOT_FOUND" && /world-worker/.test(String(e.message)) ? "assets/js/world-worker.js does not exist yet" : `assets/js/world-worker.js did not load: ${String(e && e.stack || e).split("\n").slice(0, 3).join(" | ")}`); }
  if (typeof w.self.onmessage !== "function" && !(w.listeners.message || []).length) throw plainError("assets/js/world-worker.js listens for no messages (self.onmessage is not set)");
  w.hello = (extra = {}) => ({ type: "hello", flags: {}, baseURI: BASE, world: { small: true, ...URLS }, sky: SKY, tag: "install", ...extra });
  w.run = (ms, until) => clock.advance(ms, () => (until ? until() : false));
  w.bring = async (extra) => { w.send(w.hello(extra)); w.send({ type: "canvas", canvas: w.warp }); await w.run(0); };
  return w;
}
const deadsOf = (w) => w.of("dead").map((m) => ({ why: m.why, at: m.at }));

/* the whole bring-up as the page drives it: hello, canvas, a bake, a size, a view drawn */
async function bringUp() {
  const w = await boot();
  strict(w.warp);
  await w.bring();
  await w.run(2000);
  w.send({ type: "bake", id: 1 });
  await w.run(20000, () => w.of("baked").some((m) => m.id === 1));
  w.send({ type: "resize", w: 1280, h: 800, scale: 1 });
  await w.run(0);
  w.send(structuredClone({ type: "view", seq: 1, view: mkView(1) }));
  await w.run(500, () => w.of("drew").length > 0);
  return {
    ups: w.of("up").map((m) => ({ ok: m.ok, why: m.why })), baked: w.of("baked").map((m) => m.ok), drew: w.of("drew").length, deads: deadsOf(w), cloneErrors: w.cloneErrors,
    warp: { asked: w.warp.asked, most: most(w.warp) },
  };
}

/* a second module in the worker asking the same canvas for the same kind, after the worker is up */
async function later() {
  const w = await boot();
  strict(w.warp);
  await w.bring();
  await w.run(2000);
  const upOk = w.of("up").some((m) => m.ok === true);
  const first = w.warp.made, before = w.warp.asked.length;
  let again = null, threw = null;
  try { again = w.warp.getContext("webgl2"); } catch (e) { threw = `${e && e.name}: ${e && e.message}`; }
  return { upOk, hadFirst: !!first, threw, same: again === first && again != null, realCalls: w.warp.asked.filter((k) => k === "webgl2").length, before, deads: deadsOf(w) };
}

/* a thing that throws while the canvas handed over is being taken up (in a named function, so its own frame is first in the stack) */
async function throws() {
  const w = await boot();
  const MESSAGE = "test: the canvas refused";
  const refuse = { refuseTheListener() { return new Error(MESSAGE); } };
  let made = null;
  w.warp.addEventListener = () => { made = refuse.refuseTheListener(); throw made; };
  await w.bring();
  await w.run(3000);
  return { message: MESSAGE, stack: String(made && made.stack), frame: "refuseTheListener", deads: w.of("dead").map((m) => ({ why: m.why, at: m.at, atKind: typeof m.at })), cloneErrors: w.cloneErrors };
}

const CASES = guarded({ bringUp, later, throws });

if (process.argv[2] === "--child") await childMain(CASES);

const show = (x) => JSON.stringify(x);
const run = (n) => runCase(import.meta.url, n);

{
  const r = run("bringUp");
  chk("C1 the canvas handed over (the second getContext of it throws InvalidStateError): one `up { ok: true }`", r, (r) => [r.ups.length === 1 && r.ups[0].ok === true, `ups ${show(r.ups)}, dead ${show(r.deads)}`]);
  chk("C1 ... and the worker never posts `dead`, not for the bring-up nor for the world baked and drawn", r, (r) => [r.deads.length === 0 && r.cloneErrors.length === 0 && show(r.baked) === show([true]) && r.drew > 0, `dead ${show(r.deads)}, baked ${show(r.baked)}, drew ${r.drew}, clone errors ${show(r.cloneErrors)}`]);
  chk("C2 the canvas was asked for each kind of context at most once, over the whole bring-up", r, (r) => [r.warp.asked.length > 0 && r.warp.most <= 1, `kinds asked of the canvas, in order: ${show(r.warp.asked)}`]);
}
{
  const r = run("later");
  chk("C4 (precondition) the worker is up on the strict canvas and made its context", r, (r) => [r.upOk && r.hadFirst && r.before === 1 && r.deads.length === 0, `up ${r.upOk}, context made ${r.hadFirst}, asks of the canvas so far ${r.before}, dead ${show(r.deads)}`]);
  chk("C4 a later ask of the same canvas for \"webgl2\" does not throw", r, (r) => [r.threw === null, `threw ${r.threw}`]);
  chk("C4 ... it is given the very same context object the first ask made", r, (r) => [r.same, `same object ${r.same}`]);
  chk("C4 ... and the canvas's own getContext was still called once for that kind", r, (r) => [r.realCalls === 1, `real getContext calls for webgl2: ${r.realCalls}`]);
}
{
  const r = run("throws");
  chk("C3 (precondition) something threw while the message was handled, and the worker said `dead` once", r, (r) => [r.deads.length === 1, `dead ${show(r.deads)}`]);
  chk("C3 `dead.why` is the error's message, unchanged", r, (r) => [r.deads.length === 1 && r.deads[0].why === r.message, `why ${show(r.deads[0] && r.deads[0].why)}, wanted ${show(r.message)}`]);
  chk("C3 `dead.at` is a string with the first lines of the error's stack (the frame it stopped at)", r, (r) => [r.deads.length === 1 && r.deads[0].atKind === "string" && r.deads[0].at.includes(r.frame), `at ${show(r.deads[0] && r.deads[0].at)}; the stack was ${show(r.stack.split("\n").slice(0, 3))}`]);
  chk("C3 ... and nothing it posts is beyond structured clone", r, (r) => [r.cloneErrors.length === 0, `clone errors ${show(r.cloneErrors)}`]);
}
finish();
