/*
 * Test for #154, the flight's worker asks a canvas handed over from the page for a kind of context once, written from the
 * specification alone. On Firefox 159 a canvas handed to a worker (transferControlToOffscreen) throws InvalidStateError
 * ("Cannot update created context to different thread") on any second getContext call made in the worker, even for the
 * same kind, so a worker that asks its `warp` canvas for the 2D context twice (draw-worker.js's bringUp, engine.js's
 * createFlight) stops and posts `dead`. The harness is draw-worker-test.mjs's (door-stub.mjs: installWorkerSelf, the
 * page's own message handshake `hello`, `canvases`, `start`); the two handed-over canvases are given the browser's rule:
 * the second getContext of a canvas, of any kind, throws an InvalidStateError.
 *
 *   node tools/ci/draw-context-once-test.mjs
 *
 *   once    both canvases handed over, the worker comes up: one `up { ok: true }`, no `dead`, and the flight started
 *           and drawn (a pinned `start`) does not end in one either
 *   count   each handed-over canvas's getContext was called at most once for each kind, over the whole bring-up
 *   dead    when something throws while a message is handled, `dead` carries the error's message in `why` unchanged and,
 *           in `at`, a string with the first lines of the error's stack (where it stopped)
 *
 * One fresh Node process a case; virtual clock only, nothing waits on the runner. Behaviour only, never timings.
 */
import { installPage, installClock, installWorkerSelf, WORKER, FONTS_ABS, IMAGES_ABS, BASE, childMain, runCase, chk, finish } from "./door-stub.mjs";

/* a failure that is reported as itself, in a line, never as a stack */
const plainError = (message) => Object.assign(new Error(message), { plain: true });
const guarded = (cases) => Object.fromEntries(Object.entries(cases).map(([k, f]) => [k, async () => { try { return await f(); } catch (e) { if (e && e.plain) return { none: e.message }; throw e; } }]));

/* a canvas as Firefox hands it to a worker: the first getContext is answered (by the stand-in's own), a second one, of any
   kind, throws InvalidStateError. `asked` is every kind asked of it, in order, and what came of it */
function strict(c) {
  const real = c.getContext.bind(c);
  c.asked = [];
  c.getContext = (kind, ...a) => {
    c.asked.push(kind);
    if (c.asked.length > 1) throw new DOMException("Cannot update created context to different thread", "InvalidStateError");
    return real(kind, ...a);
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
  try { await import(WORKER); }
  catch (e) { throw plainError(e && e.code === "ERR_MODULE_NOT_FOUND" && /draw-worker/.test(String(e.message)) ? "assets/door/draw-worker.js does not exist yet" : `assets/door/draw-worker.js did not load: ${String(e && e.stack || e).split("\n").slice(0, 3).join(" | ")}`); }
  if (typeof w.self.onmessage !== "function" && !(w.listeners.message || []).length) throw plainError("assets/door/draw-worker.js listens for no messages (self.onmessage is not set)");
  w.chores = (await import("../../assets/door/chores.js")).choresNow;
  const engine = await import("../../assets/door/engine.js");
  w.wired = engine.wireProfile(engine.UP);
  w.hello = (extra = {}) => ({ type: "hello", flags: {}, images: IMAGES_ABS, fonts: FONTS_ABS, baseURI: BASE, settle: 700, size: { W: 1280, H: 800, dpr: 1 }, hidden: false, ...extra });
  w.canvases = (size) => ({ type: "canvases", warp: w.warp, warpgl: w.warpgl, size: size ?? { W: 1280, H: 800, dpr: 1 } });
  w.bring = async (extra) => { w.send(w.hello(extra)); w.send(w.canvases()); await clock.advance(0); };
  w.run = (ms, until) => clock.advance(ms, () => (until ? until() : false));
  return w;
}
const deadsOf = (w) => w.of("dead").map((m) => ({ why: m.why, at: m.at }));

/* the whole bring-up as the page drives it: hello, canvases, a pinned start (the engine draws one frame), a warm */
async function bringUp() {
  const w = await boot();
  strict(w.warp); strict(w.warpgl);
  await w.bring();
  await w.run(3000);
  w.send({ type: "start", seq: 1, profile: w.wired, at: 1500 });
  await w.run(3000);
  w.send({ type: "warm", id: 1, kind: "warm", prove: false });
  await w.run(20000, () => w.of("warmed").some((m) => m.id === 1));
  return {
    ups: w.of("up").map((m) => ({ ok: m.ok, why: m.why })), frames: w.of("frame").length, deads: deadsOf(w), cloneErrors: w.cloneErrors,
    warp: { asked: w.warp.asked, most: most(w.warp) }, warpgl: { asked: w.warpgl.asked, most: most(w.warpgl) },
  };
}

/* a thing that throws while the 2D context is asked for (in a named function, so its own frame is first in the stack) */
async function throws() {
  const w = await boot();
  const MESSAGE = "test: the canvas refused";
  const refuse = { refuseTheContext() { return new Error(MESSAGE); } };
  let made = null;
  const real = w.warp.getContext.bind(w.warp);
  w.warp.getContext = (kind, ...a) => { if (kind === "2d") { made = refuse.refuseTheContext(); throw made; } return real(kind, ...a); };
  await w.bring();
  await w.run(3000);
  return { message: MESSAGE, stack: String(made && made.stack), frame: "refuseTheContext", deads: w.of("dead").map((m) => ({ why: m.why, at: m.at, atKind: typeof m.at })), ups: w.of("up").map((m) => m.ok), cloneErrors: w.cloneErrors };
}

const CASES = guarded({ bringUp, throws });

if (process.argv[2] === "--child") await childMain(CASES);

const show = (x) => JSON.stringify(x);
const run = (n) => runCase(import.meta.url, n);

{
  const r = run("bringUp");
  chk("C1 both canvases handed over (the second getContext of a canvas throws InvalidStateError): one `up { ok: true }`", r, (r) => [r.ups.length === 1 && r.ups[0].ok === true, `ups ${show(r.ups)}, dead ${show(r.deads)}`]);
  chk("C1 ... and the worker never posts `dead`, not for the bring-up nor for the flight started and warmed", r, (r) => [r.deads.length === 0 && r.cloneErrors.length === 0 && r.frames === 1, `dead ${show(r.deads)}, frames ${r.frames}, clone errors ${show(r.cloneErrors)}`]);
  chk("C2 the `warp` canvas was asked for each kind of context at most once, over the whole bring-up", r, (r) => [r.warp.most <= 1, `kinds asked of warp, in order: ${show(r.warp.asked)}`]);
  chk("C2 the `warpgl` canvas was asked for each kind of context at most once, over the whole bring-up", r, (r) => [r.warpgl.most <= 1, `kinds asked of warpgl, in order: ${show(r.warpgl.asked)}`]);
}
{
  const r = run("throws");
  chk("C3 (precondition) something threw while the message was handled, and the worker said `dead` once", r, (r) => [r.deads.length === 1 && r.ups.length === 0, `dead ${show(r.deads)}, ups ${show(r.ups)}`]);
  chk("C3 `dead.why` is the error's message, unchanged", r, (r) => [r.deads.length === 1 && r.deads[0].why === r.message, `why ${show(r.deads[0] && r.deads[0].why)}, wanted ${show(r.message)}`]);
  chk("C3 `dead.at` is a string with the first lines of the error's stack (the frame it stopped at)", r, (r) => [r.deads.length === 1 && r.deads[0].atKind === "string" && r.deads[0].at.includes(r.frame), `at ${show(r.deads[0] && r.deads[0].at)}; the stack was ${show(r.stack.split("\n").slice(0, 3))}`]);
  chk("C3 ... and nothing it posts is beyond structured clone", r, (r) => [r.cloneErrors.length === 0, `clone errors ${show(r.cloneErrors)}`]);
}
finish();
