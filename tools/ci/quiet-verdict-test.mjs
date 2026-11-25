/*
 * Tests for #104: the flight world's verdict times only quiet frames, written from the specification alone (Q1-Q19),
 * before the code. A machine that is busy with something else (a shader compiling, a picture going up, a worker doing
 * the same) must not be called slow for it. The standard pattern is a measurement taken in a quiet window: a sample
 * taken while something else was running is discarded, and the verdict is the median of the clean ones. The change is
 * additive to assets/door/ (copied unchanged by Orbit): no new flag, nothing from a third party.
 *
 *   node tools/ci/quiet-verdict-test.mjs
 *
 * No browser, no dependencies. The page's state lives for the life of the page, so each case runs in a fresh Node
 * process (this file again, as `--child <case>`) against the stub page of door-stub.mjs, on its virtual clock. Seams:
 *
 *   A  assets/door/busy.js imported after installPage: the ledger of GPU work under way (a plain fake context stands for
 *      the real one, so what watch(gl) passes through can be told). Names the spec gives it: watch, quiet, mark, own,
 *      busyHeard, busyGone, busyExcept (busyExcept(name) answers { n, gen }: the work under way on this thread and in
 *      every source but `name`; a bare number is read as n).
 *   B  createDoor, the journey's warm(): the verdict is read from the "orbit · flight world:" line; every timed frame
 *      is seen by the stub context. A frame is a run of draw calls ended by the 1x1 readPixels the fitness test uses to
 *      make the GPU finish, made while the world's canvas is at the fitness test's size (at most half the window's
 *      width). The first two at a size are the warm-up (WARM_FRAMES), the rest are timed. The stub gives each frame the
 *      draw time a case says, on the virtual clock, and may make something else pulse a few milliseconds after the
 *      frame ends (inside the "heard 20 ms after" window), which is how a frame is made contaminated: on one thread
 *      nothing can run during a frame, and the frame's own calls are not counted (own()). One case (Q18) uses
 *      createVoyage of voyage.js directly, as the journey's size cannot be changed mid-proof without a flight.
 *   C  draw-worker.js imported into a stub worker scope (installWorkerSelf): what the worker posts and hears.
 *   D  remote-flight.js through the journey with a fake worker (bootWorkerPage), remote-world.js with a fake worker.
 *
 *   Q1  watch(null/undefined) returns it and throws nothing; watch(gl) returns the same object; twice wraps once
 *   Q2  a compile is under way until its COMPILE_STATUS is read; quiet() is false then and for 100 ms after
 *   Q3  linkProgram opens a span for the program and closes its shaders'; LINK_STATUS closes it; COMPLETION_STATUS_KHR
 *       false does not, true does
 *   Q4  deleteProgram / deleteShader end the span; a span never asked about stops counting at 5000 ms
 *   Q5  each upload call and generateMipmap is a pulse (mark() changes, quiet() false 100 ms), is not "under way",
 *       and the real results pass through unchanged
 *   Q6  calls inside own(fn) are not counted; counting resumes after fn, even if it throws
 *   Q7  busyHeard / busyGone / busyExcept: another thread's ledger; the same message twice changes nothing; bad numbers 0
 *   Q8  a worker posts { type: "busy", n, gen } as its ledger changes and hears the page's; page.busy() does nothing
 *   Q9  remote-flight and remote-world forward the page's ledger (not the receiver's own) to their worker, hear the
 *       worker's, drop it on teardown and stop forwarding; two worlds do not overwrite each other
 *   Q10 nothing under way: 3 clean frames at 10 ms, "on", none thrown away, the first no sooner than 100 ms after the
 *       last upload or compile ended
 *   Q11 a compile begun and unread: no timed frame starts until it is read plus 100 ms
 *   Q12 a frame during which something pulsed is discarded; an extra frame is timed
 *   Q13 the median is of the clean frames only
 *   Q14 after 8 s with no quiet moment, or 10 frames thrown away, the frames are timed whatever runs ("not quiet in time"),
 *       and a slow machine still gets "off"
 *   Q15 the tab hidden: no frame timed while hidden; the 8 s start again on show
 *   Q16 fit: "skip" still skips: no frame timed, no waiting; FIT_MS is still 30
 *   Q17 the world retired or destroyed while waiting: the wait ends, no frame timed afterwards
 *   Q18 a size change between frames warms again at the new size; after the test the size is as before it
 *   Q19 index.js exports watch, busyHeard, busyGone, busyPeer; assets/door/README.md lists them
 *   Q20 a timed frame that throws (the context's readPixels fails): the world stays off ("flight world: off:" line, no "on"), warm() settles, nothing escapes
 *
 * Statements about the machine that cannot be tested without a browser (listed, not tested here): that a real browser's
 * COMPLETION_STATUS_KHR and LINK_STATUS reads track the real compile; that a real upload's cost shows in the
 * frame time that follows it (the reason for the whole change); that a real worker's pulses are heard within the 20 ms
 * window; that the median of clean frames on a busy first visit gives the machine's own verdict, and that the way in
 * opening up to about 8 s later is acceptable (the owner's call, on the issue); that watch(gl) wraps a real
 * WebGL2RenderingContext (a prototype's methods, not a plain object's).
 *
 * D1 (the one console line saying frames timed / thrown away / "not quiet in time") is the spec's own decision to drop
 * if the owner calls it a log tool: the statements that read it are labelled "D1" and are the only ones that go with it.
 */
import {
  INDEX, installPage, installClock, installWorkerSelf, bootWorkerPage, bootInstallPage, fakeWorldWorkers, WORKER,
  childMain, runCase, check, finish,
} from "./door-stub.mjs";

const BUSY = "../../assets/door/busy.js";
const VOYAGE = "../../assets/door/voyage.js";
const REMOTE_WORLD = "../../assets/js/remote-world.js";

const plainError = (message) => Object.assign(new Error(message), { plain: true });
const guarded = (cases) => Object.fromEntries(Object.entries(cases).map(([k, f]) => [k, async () => { try { return await f(); } catch (e) { if (e && e.plain) return { none: e.message }; throw e; } }]));
const chk = (name, r, fn) => {
  if (r.error || r.none) { check(name, false, String(r.none || r.error)); return; }
  let ok = false, detail = "";
  try { [ok, detail] = fn(r); } catch (e) { detail = `the result could not be read (${e && e.message}): ${JSON.stringify(r).slice(0, 240)}`; }
  check(name, !!ok, detail);
};
const show = (v) => JSON.stringify(v);

/* ===================================================================== A: the ledger (busy.js) */

async function loadBusy() {
  try { return await import(BUSY); }
  catch (e) { throw plainError(e && e.code === "ERR_MODULE_NOT_FOUND" && /busy\.js/.test(String(e.message)) ? "assets/door/busy.js does not exist yet" : `assets/door/busy.js did not load: ${String(e && e.stack || e).split("\n").slice(0, 3).join(" | ")}`); }
}
function exportsOf(busy, names) {
  const missing = names.filter((n) => typeof busy[n] !== "function");
  if (missing.length) throw plainError(`assets/door/busy.js does not export ${missing.join(", ")}`);
}
/* the work under way on this thread and in every source but "nobody" */
const countOf = (busy) => { const x = busy.busyExcept("nobody"); return x && typeof x === "object" ? x.n : x; };

/* a context of plain methods (every upload returns its own name, so a result passed through can be told) */
const UPLOADS = ["texImage2D", "texSubImage2D", "texImage3D", "texSubImage3D", "compressedTexImage2D", "compressedTexSubImage2D", "compressedTexImage3D", "compressedTexSubImage3D", "generateMipmap"];
function plainGl() {
  const gl = {
    COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82, COMPLETION_STATUS_KHR: 0x91b1, completion: false, calls: [], attached: new Map(),
    createShader: () => ({ kind: "shader" }), shaderSource() {}, createProgram: () => ({ kind: "program" }),
    attachShader(p, s) { gl.calls.push("attachShader"); },
    compileShader() { gl.calls.push("compileShader"); return "compiled"; },
    linkProgram() { gl.calls.push("linkProgram"); return "linked"; },
    getShaderParameter() { return "shader-status"; },
    getProgramParameter(p, name) { return name === 0x91b1 ? gl.completion : "program-status"; },
    deleteShader() { gl.calls.push("deleteShader"); return "deleted-shader"; },
    deleteProgram() { gl.calls.push("deleteProgram"); return "deleted-program"; },
    getExtension: () => ({ COMPLETION_STATUS_KHR: 0x91b1 }),
  };
  for (const u of UPLOADS) gl[u] = () => { gl.calls.push(u); return `result:${u}`; };
  return gl;
}

async function ledgerBoot() {
  const page = installPage();
  const clock = installClock();
  const busy = await loadBusy();
  exportsOf(busy, ["watch", "quiet", "mark", "own", "busyHeard", "busyGone", "busyExcept"]);
  return { page, clock, busy };
}

const A = {
  async q1() {
    const { busy } = await ledgerBoot();
    const out = { threw: null };
    try { out.nullOut = busy.watch(null); out.undefOut = busy.watch(undefined); } catch (e) { out.threw = String(e && e.message || e); }
    const gl = plainGl();
    out.same = busy.watch(gl) === gl;
    out.sameAgain = busy.watch(gl) === gl;
    const s = gl.createShader(1), s2 = gl.createShader(1);
    gl.compileShader(s);
    out.n = countOf(busy);
    out.result = gl.compileShader(s2);
    out.two = countOf(busy);
    gl.getShaderParameter(s, gl.COMPILE_STATUS); gl.getShaderParameter(s2, gl.COMPILE_STATUS);
    out.after = countOf(busy);
    out.baseCalls = gl.calls.filter((c) => c === "compileShader").length;
    return out;
  },
  async q2() {
    const { busy, clock } = await ledgerBoot();
    const gl = busy.watch(plainGl());
    await clock.advance(500);
    const out = { quietBefore: busy.quiet() };
    const s = gl.createShader(1);
    gl.compileShader(s);
    out.during = [busy.quiet(), countOf(busy)];
    await clock.advance(3000);
    out.longAfter = [busy.quiet(), countOf(busy)];
    out.read = gl.getShaderParameter(s, gl.COMPILE_STATUS);
    out.justRead = [busy.quiet(), countOf(busy)];
    await clock.advance(50);
    out.at50 = busy.quiet();
    await clock.advance(100);
    out.at150 = busy.quiet();
    return out;
  },
  async q3() {
    const { busy, clock } = await ledgerBoot();
    const gl = busy.watch(plainGl());
    await clock.advance(500);
    const out = {};
    const s1 = gl.createShader(1), s2 = gl.createShader(2), p = gl.createProgram();
    gl.compileShader(s1); gl.compileShader(s2);
    out.compiled = countOf(busy);
    gl.attachShader(p, s1); gl.attachShader(p, s2);
    out.link = gl.linkProgram(p);
    out.linked = countOf(busy);
    out.linkRead = gl.getProgramParameter(p, gl.LINK_STATUS);
    out.afterLinkRead = countOf(busy);
    /* the background compile: COMPLETION_STATUS_KHR asked, false then true */
    const q = gl.createProgram();
    gl.linkProgram(q);
    gl.completion = false;
    out.completionFalse = gl.getProgramParameter(q, gl.COMPLETION_STATUS_KHR);
    out.stillUnder = countOf(busy);
    gl.completion = true;
    out.completionTrue = gl.getProgramParameter(q, gl.COMPLETION_STATUS_KHR);
    out.closed = countOf(busy);
    return out;
  },
  async q4() {
    const { busy, clock } = await ledgerBoot();
    const gl = busy.watch(plainGl());
    await clock.advance(500);
    const out = {};
    const p = gl.createProgram();
    gl.linkProgram(p);
    out.linked = countOf(busy);
    out.deletedProgram = gl.deleteProgram(p);
    out.afterDeleteProgram = countOf(busy);
    const s = gl.createShader(1);
    gl.compileShader(s);
    out.compiled = countOf(busy);
    out.deletedShader = gl.deleteShader(s);
    out.afterDeleteShader = countOf(busy);
    await clock.advance(500);
    /* a program never asked about */
    const lost = gl.createProgram();
    gl.linkProgram(lost);
    await clock.advance(4800);
    out.at4800 = [countOf(busy), busy.quiet()];
    await clock.advance(300);
    out.at5100 = countOf(busy);
    await clock.advance(300);
    out.at5400 = busy.quiet();
    /* and a shader never asked about */
    const lostShader = gl.createShader(1);
    gl.compileShader(lostShader);
    await clock.advance(4800);
    out.shaderAt4800 = countOf(busy);
    await clock.advance(300);
    out.shaderAt5100 = countOf(busy);
    return out;
  },
  async q5() {
    const { busy, clock } = await ledgerBoot();
    const gl = busy.watch(plainGl());
    const out = { each: [] };
    for (const fn of UPLOADS) {
      await clock.advance(300);
      const before = busy.mark(), quietBefore = busy.quiet();
      const result = gl[fn](1, 2, 3);
      const row = { fn, quietBefore, result, marked: busy.mark() !== before, quietNow: busy.quiet(), n: countOf(busy) };
      await clock.advance(50);
      row.at50 = busy.quiet();
      await clock.advance(100);
      row.at150 = busy.quiet();
      row.nAfter = countOf(busy);
      out.each.push(row);
    }
    return out;
  },
  async q6() {
    const { busy, clock } = await ledgerBoot();
    const gl = busy.watch(plainGl());
    await clock.advance(500);
    const out = {};
    const m0 = busy.mark();
    let inside;
    busy.own(() => { const s = gl.createShader(1); gl.compileShader(s); inside = gl.texImage2D(1); });
    out.inside = { n: countOf(busy), marked: busy.mark() !== m0, quiet: busy.quiet(), result: inside };
    let threw = false;
    try { busy.own(() => { throw new Error("boom"); }); } catch { threw = true; }
    out.threwOut = threw;
    const m1 = busy.mark();
    const s = gl.createShader(1);
    gl.compileShader(s);
    out.after = { n: countOf(busy), marked: busy.mark() !== m1 };
    return out;
  },
  async q7() {
    const { busy, clock } = await ledgerBoot();
    await clock.advance(500);
    const out = { threw: null };
    try {
      const m0 = busy.mark();
      busy.busyHeard("flight", { n: 1, gen: 1 });
      out.first = { marked: busy.mark() !== m0, quiet: busy.quiet(), all: countOf(busy) };
      const x = busy.busyExcept("x"), self = busy.busyExcept("flight");
      out.exceptX = x && typeof x === "object" ? x.n : x;
      out.exceptFlight = self && typeof self === "object" ? self.n : self;
      const m1 = busy.mark();
      busy.busyHeard("flight", { n: 1, gen: 1 });
      out.twice = busy.mark() === m1;
      await clock.advance(1000);
      out.stillBusy = busy.quiet();
      busy.busyGone("flight");
      out.gone = countOf(busy);
      await clock.advance(150);
      out.quietAfterGone = busy.quiet();
      /* another source alongside it */
      busy.busyHeard("a", { n: 2, gen: 1 }); busy.busyHeard("b", { n: 3, gen: 1 });
      out.sum = countOf(busy);
      const a = busy.busyExcept("a");
      out.exceptA = a && typeof a === "object" ? a.n : a;
      busy.busyGone("a"); busy.busyGone("b");
      /* bad numbers become 0 */
      busy.busyHeard("bad", { n: NaN, gen: "x" });
      busy.busyHeard("bad2", {});
      busy.busyHeard("bad3", { n: "abc", gen: undefined });
      out.bad = countOf(busy);
      busy.busyGone("nobody-here");
    } catch (e) { out.threw = String(e && e.message || e); }
    return out;
  },
};

/* ===================================================================== Q8, C: the worker */

async function workerBoot() {
  const page = installPage();
  const clock = installClock();
  const w = installWorkerSelf(page);
  w.page = page; w.clock = clock;
  const busy = await loadBusy();
  exportsOf(busy, ["quiet", "busyExcept"]);
  try { await import(WORKER); } catch (e) { throw plainError(`assets/door/draw-worker.js did not load: ${String(e && e.stack || e).split("\n").slice(0, 3).join(" | ")}`); }
  w.busy = busy;
  w.hello = (extra = {}) => ({ type: "hello", flags: {}, images: {}, fonts: [], baseURI: "https://site.test/app/", settle: 700, size: { W: 1280, H: 800, dpr: 1 }, hidden: false, ...extra });
  w.canvases = () => ({ type: "canvases", warp: w.warp, warpgl: w.warpgl, size: { W: 1280, H: 800, dpr: 1 } });
  return w;
}
const C = {
  async q8post() {
    const w = await workerBoot();
    w.send(w.hello()); w.send(w.canvases());
    await w.clock.advance(3000, () => w.of("up").length > 0);
    await w.clock.advance(500);
    const before = w.of("busy").length;
    const gl = w.page.gl;
    const s = gl.createShader(35633);
    gl.compileShader(s);
    await w.clock.advance(200);
    const during = w.of("busy").slice(before);
    gl.getShaderParameter(s, 35713);
    await w.clock.advance(200);
    const all = w.of("busy");
    return {
      ups: w.of("up").length, during: during.map((m) => ({ n: m.n, gen: m.gen })), last: all.length ? { n: all[all.length - 1].n, gen: all[all.length - 1].gen } : null,
      genRose: during.length > 0 && all.length > 0 && all[all.length - 1].gen > during[0].gen, cloneErrors: w.cloneErrors,
    };
  },
  async q8hear() {
    const w = await workerBoot();
    w.send(w.hello()); w.send(w.canvases());
    await w.clock.advance(3000, () => w.of("up").length > 0);
    await w.clock.advance(1000);
    const base = countOf(w.busy);
    const posted0 = w.of("busy").length;
    w.send({ type: "busy", n: 2, gen: 7 });
    await w.clock.advance(300);
    const heard = { n: countOf(w.busy), quiet: w.busy.quiet() };
    const echoed = w.of("busy").slice(posted0).filter((m) => m.n === 2);
    w.send({ type: "busy", n: 0, gen: 8 });
    await w.clock.advance(300);
    return { base, heard, echoed: echoed.length, cleared: countOf(w.busy), deads: w.of("dead").map((m) => m.why) };
  },
  async q8adapter() {
    installPage(); installClock();
    const { page } = await import("../../assets/door/page.js");
    const out = { type: typeof page.busy, threw: null };
    try { page.busy(); page.busy({ n: 1, gen: 1 }); page.busy(1, 2); } catch (e) { out.threw = String(e && e.message || e); }
    return out;
  },
};

/* ===================================================================== Q9, D: the page forwards and hears */

const lastOf = (list) => (list.length ? list[list.length - 1] : null);
const D = {
  async flight() {
    const b = await bootWorkerPage({ draw: "worker" });
    const busy = await loadBusy();
    exportsOf(busy, ["busyExcept"]);
    b.door.gpu();
    b.journey.warm({ prove: false }).catch(() => {});
    await b.clock.advance(300);
    const w = b.host.first();
    if (!w) return { none: "the journey made no worker" };
    const gl = b.page.gl;
    const out = {};
    const mark = w.of("busy").length;
    const s = gl.createShader(35633);
    gl.compileShader(s);
    await b.clock.advance(300);
    out.page = w.of("busy").slice(mark).map((m) => ({ n: m.n, gen: m.gen }));
    gl.getShaderParameter(s, 35713);
    await b.clock.advance(300);
    out.pageLast = lastOf(w.of("busy")) ? lastOf(w.of("busy")).n : null;
    /* the worker's own ledger is heard, and not sent back to it */
    const before = w.of("busy").length;
    w.say({ type: "busy", n: 1, gen: 1 });
    await b.clock.advance(300);
    out.heard = countOf(busy);
    out.echo = w.of("busy").slice(before).filter((m) => m.n === 1).length;
    /* gone with the world: a fallback drops it, and nothing more is forwarded */
    w.fail("the worker failed");
    await b.clock.advance(300);
    out.afterFallBack = countOf(busy);
    const posted = w.of("busy").length + w.late.filter((m) => m && m.type === "busy").length;
    const s2 = gl.createShader(35633);
    gl.compileShader(s2);
    await b.clock.advance(300);
    out.forwardedAfter = w.of("busy").length + w.late.filter((m) => m && m.type === "busy").length - posted;
    out.cloneErrors = w.cloneErrors;
    return out;
  },
  async flightDestroy() {
    const b = await bootWorkerPage({ draw: "worker" });
    const busy = await loadBusy();
    exportsOf(busy, ["busyExcept"]);
    b.door.gpu();
    b.journey.warm({ prove: false }).catch(() => {});
    await b.clock.advance(300);
    const w = b.host.first();
    if (!w) return { none: "the journey made no worker" };
    w.say({ type: "busy", n: 2, gen: 1 });
    await b.clock.advance(100);
    const heard = countOf(busy);
    b.journey.destroy();
    await b.clock.advance(300);
    const gone = countOf(busy);
    const posted = w.of("busy").length + w.late.filter((m) => m && m.type === "busy").length;
    const gl = b.page.gl;
    gl.compileShader(gl.createShader(35633));
    await b.clock.advance(300);
    return { heard, gone, forwardedAfter: w.of("busy").length + w.late.filter((m) => m && m.type === "busy").length - posted };
  },
  async world() {
    const b = await bootInstallPage({ draw: "worker" });
    const busy = await loadBusy();
    exportsOf(busy, ["busyExcept"]);
    b.door.gpu();
    let mod;
    try { mod = await import(REMOTE_WORLD); } catch (e) { throw plainError(`assets/js/remote-world.js did not load: ${String(e && e.message || e).slice(0, 120)}`); }
    const host = fakeWorldWorkers();
    const w1 = mod.createRemoteWorld(b.pad("one").canvas, { tag: "install", small: true }, { worker: () => host.make(), cap: false });
    const w2 = mod.createRemoteWorld(b.pad("two").canvas, { tag: "install", small: true }, { worker: () => host.make(), cap: false });
    await b.clock.advance(300);
    const [k1, k2] = host.list;
    if (!k1 || !k2) return { none: `createRemoteWorld made ${host.list.length} worker(s), wanted 2` };
    const out = {};
    k1.say({ type: "busy", n: 1, gen: 1 });
    k2.say({ type: "busy", n: 2, gen: 1 });
    await b.clock.advance(300);
    out.both = countOf(busy);
    out.toFirst = lastOf(k1.of("busy")) ? lastOf(k1.of("busy")).n : null;
    out.toSecond = lastOf(k2.of("busy")) ? lastOf(k2.of("busy")).n : null;
    /* the page's own work goes to both */
    const gl = b.page.gl;
    const s = gl.createShader(35633);
    gl.compileShader(s);
    await b.clock.advance(300);
    out.toFirstWithPage = lastOf(k1.of("busy")) ? lastOf(k1.of("busy")).n : null;
    out.toSecondWithPage = lastOf(k2.of("busy")) ? lastOf(k2.of("busy")).n : null;
    gl.getShaderParameter(s, 35713);
    k1.say({ type: "busy", n: 0, gen: 2 });
    await b.clock.advance(300);
    out.firstCleared = countOf(busy);
    w2.destroy();
    await b.clock.advance(300);
    out.secondDestroyed = countOf(busy);
    const posted = k2.of("busy").length + k2.late.filter((m) => m && m.type === "busy").length;
    /* a page compile after the destroy, read at once (an unread one stays under way, Q2/Q4, and would be counted below) */
    const s3 = gl.createShader(35633);
    gl.compileShader(s3);
    await b.clock.advance(300);
    gl.getShaderParameter(s3, 35713);
    await b.clock.advance(300);
    out.forwardedAfter = k2.of("busy").length + k2.late.filter((m) => m && m.type === "busy").length - posted;
    k1.say({ type: "busy", n: 4, gen: 3 });
    await b.clock.advance(100);
    out.firstAgain = countOf(busy);
    w1.destroy();
    await b.clock.advance(300);
    out.firstDestroyed = countOf(busy);
    return out;
  },
};

/* ===================================================================== B: the verdict, on the journey */

const VERDICT = /flight world: (on|off)/;

/*
 * bootB(o): the journey on the stub page, every frame of the fitness test seen. o.cost(frame) the draw time a frame
 * takes (ms of the virtual clock; frame: { idx, warm, timedN, t, key }), o.after(frame, b) runs once a frame has been
 * charged (to make something pulse). o.hidden, o.flags.
 */
async function bootB(o = {}) {
  const page = installPage({ hidden: !!o.hidden });
  const clock = installClock();
  const rec = { frames: [], epochs: [], events: [], lines: [], world: null, sizes: [], timed: 0, epochKey: "", epochIdx: 0 };
  const say = (...a) => { const l = a.join(" "); page.lines.push(l); rec.lines.push({ t: clock.now(), l, size: rec.world ? [rec.world.width, rec.world.height] : null }); };
  console.info = say; console.log = say;
  /* the world's canvas: the first to be given a WebGL2 context; its size is logged */
  const create = page.document.createElement;
  page.document.createElement = (tag) => {
    const c = create(tag);
    if (tag !== "canvas") return c;
    let w = 300, h = 150;
    Object.defineProperty(c, "width", { get: () => w, set: (v) => { w = v; rec.sizes.push({ t: clock.now(), w, h }); }, configurable: true });
    Object.defineProperty(c, "height", { get: () => h, set: (v) => { h = v; rec.sizes.push({ t: clock.now(), w, h }); }, configurable: true });
    const get = c.getContext;
    c.getContext = (kind, ...r) => { if (kind === "webgl2") rec.world ||= c; return get(kind, ...r); };
    return c;
  };
  /* the context's own calls, with the time they were made */
  const g = page.glBase;
  for (const k of ["compileShader", "linkProgram", "getShaderParameter", "getProgramParameter", "texImage2D", "texSubImage2D", "generateMipmap"]) {
    const f = g[k];
    g[k] = (...a) => { rec.events.push({ k, t: clock.now() }); return f ? f(...a) : undefined; };
  }
  const read = g.readPixels;
  g.readPixels = (x, y, w, h, ...r) => {
    read(x, y, w, h, ...r);
    const c = rec.world;
    if (!(w === 1 && h === 1 && c && c.width <= 0.5 * globalThis.innerWidth)) return;
    const key = `${c.width}x${c.height}`;
    if (key !== rec.epochKey) { rec.epochKey = key; rec.epochIdx = 0; rec.epochs.push({ key, t: clock.now() }); }
    const idx = rec.epochIdx++;
    const f = { t: clock.now(), idx, key, epoch: rec.epochs.length - 1, warm: idx < 2, timedN: -1, cost: 0 };
    if (!f.warm) f.timedN = rec.timed++;
    f.cost = o.cost ? o.cost(f) : 10;
    rec.frames.push(f);
    clock.jump(f.cost);
    o.after?.(f, b);
  };
  /* the door's own timers still pending: every setTimeout but the ones a case makes through b.later */
  const live = new Map(), rawSet = globalThis.setTimeout, rawClear = globalThis.clearTimeout;
  globalThis.setTimeout = (f, ms, ...a) => { const id = rawSet((...x) => { live.delete(id); return f(...x); }, ms, ...a); live.set(id, { ms: Number(ms) || 0, at: clock.now() }); return id; };
  globalThis.clearTimeout = (id) => { live.delete(id); rawClear(id); };
  const b = { page, clock, rec, o, live, later: (f, ms) => rawSet(f, ms) };
  b.door = await import(INDEX);
  const d = b.door.createDoor({ typingWait: 0, flags: o.flags || {} });
  b.door.openChores();
  b.door.gpu();
  b.journey = d.journey(page.journeyOptions());
  b.verdict = () => rec.lines.find((x) => VERDICT.test(x.l)) || null;
  b.timedFrames = () => rec.frames.filter((f) => !f.warm);
  /* something else pulsing a few ms after the frame, inside the 20 ms window in which a frame is judged */
  b.pulse = (delay = 5) => b.later(() => page.gl.texSubImage2D(3553, 0, 0, 0, 1, 1, 6408, 5121, null), delay);
  /* constant work: a compile begun every 50 ms, each read 30 ms later (never quiet) */
  b.busyWork = () => {
    const gl = page.gl;
    let on = true;
    const id = setInterval(() => {
      if (!on) return;
      const s = gl.createShader(35633);
      gl.compileShader(s);
      b.later(() => gl.getShaderParameter(s, 35713), 30);
    }, 50);
    return { stop() { on = false; clearInterval(id); } };
  };
  b.warm = () => { b.state = "pending"; b.journey.warm().then(() => { b.state = "resolved"; }, () => { b.state = "rejected"; }); };
  b.untilVerdict = async (limit = 40000) => { await clock.advance(limit, () => !!b.verdict()); await clock.advance(500); };
  return b;
}
const facts = (b) => {
  const v = b.verdict();
  const frames = b.rec.frames.map((f) => [f.t, f.idx, f.cost]);
  return { verdict: v && v.l, verdictAt: v && v.t, timed: b.timedFrames().length, frames: frames.length, firstTimed: b.timedFrames()[0]?.t ?? null, timedAt: b.timedFrames().map((f) => f.t), epochs: b.rec.epochs.length };
};
/* the one D1 line: how many frames were timed and thrown away, and whether the wait ran out */
const lineOf = (b) => { const l = b.rec.lines.find((x) => /thrown away|not quiet in time|frames? timed|frame\(s\) timed/.test(x.l)); return l ? l.l : null; };
const thrownOf = (line) => { const m = line && /(\d+)\D{0,24}thrown away/.exec(line); return m ? Number(m[1]) : null; };
const lastEnded = (b, before) => Math.max(-Infinity, ...b.rec.events.filter((e) => e.t < before && !b.rec.frames.some((f) => f.t === e.t)).map((e) => e.t));

const B = {
  /* Q10: nothing under way, every frame 10 ms */
  async q10() {
    const b = await bootB({ cost: () => 10 });
    b.warm();
    await b.untilVerdict();
    const f = facts(b);
    f.lastEnded = f.firstTimed === null ? null : lastEnded(b, f.firstTimed);
    f.line = lineOf(b);
    f.thrown = thrownOf(f.line);
    return f;
  },
  /* Q11: a compile begun just after the warm-up, read 1500 ms later */
  async q11() {
    let begun = -1, readAt = -1;
    const b = await bootB({
      cost: () => 10,
      after: (f, b) => {
        if (f.warm && f.idx === 1 && begun === -1) {
          begun = -2;
          b.later(() => {
            const gl = b.page.gl, s = gl.createShader(35633);
            gl.compileShader(s);
            begun = b.clock.now();
            b.later(() => { gl.getShaderParameter(s, 35713); readAt = b.clock.now(); }, 1500);
          }, 1);
        }
      },
    });
    b.warm();
    await b.untilVerdict();
    const f = facts(b);
    return { ...f, begun, readAt, inside: b.timedFrames().filter((x) => x.t >= begun && x.t < readAt + 99).map((x) => x.t) };
  },
  /* Q12: the first timed frame has something pulse just after it */
  async q12() {
    const b = await bootB({ cost: () => 10, after: (f, b) => { if (!f.warm && f.timedN === 0) b.pulse(5); } });
    b.warm();
    await b.untilVerdict();
    const f = facts(b);
    f.line = lineOf(b);
    f.thrown = thrownOf(f.line);
    return f;
  },
  /* Q13: the first three timed frames are contaminated and slow, then clean and fast */
  async q13() {
    const b = await bootB({ cost: (f) => (!f.warm && f.timedN < 3 ? 300 : 10), after: (f, b) => { if (!f.warm && f.timedN < 3) b.pulse(5); } });
    b.warm();
    await b.untilVerdict();
    const f = facts(b);
    f.line = lineOf(b);
    f.thrown = thrownOf(f.line);
    return f;
  },
  /* Q14: constant work for more than 8 s */
  async q14busy(cost) {
    const b = await bootB({ cost: () => cost });
    b.door.gpu();
    const work = b.busyWork();
    b.warm();
    await b.untilVerdict(40000);
    work.stop();
    const f = facts(b);
    f.line = lineOf(b);
    f.late = /not quiet in time/.test(b.rec.lines.map((x) => x.l).join("\n"));
    return f;
  },
  /* Q14: every timed frame contaminated */
  async q14ten(cost) {
    const b = await bootB({ cost: () => cost, after: (f, b) => { if (!f.warm) b.pulse(5); } });
    b.warm();
    await b.untilVerdict(60000);
    const f = facts(b);
    f.line = lineOf(b);
    f.late = /not quiet in time/.test(b.rec.lines.map((x) => x.l).join("\n"));
    return f;
  },
  /* Q15: hidden at the start, with constant work; shown at 5 s */
  async q15() {
    const b = await bootB({ hidden: true, cost: () => 10 });
    const work = b.busyWork();
    b.warm();
    await b.clock.advance(5000);
    const whileHidden = b.rec.frames.length;
    const verdictWhileHidden = !!b.verdict();
    b.page.setHidden(false);
    const shownAt = b.clock.now();
    await b.untilVerdict(40000);
    work.stop();
    return { ...facts(b), whileHidden, verdictWhileHidden, shownAt };
  },
  /* Q20: the first timed frame throws (the context failing mid-test), the warm-up frames do not */
  async q20() {
    let thrown = 0;
    const b = await bootB({ cost: (f) => { if (!f.warm) { thrown++; throw new Error("the frame failed"); } return 10; } });
    const escaped = [];
    const onErr = (e) => escaped.push(String(e && e.message || e));
    process.on("unhandledRejection", onErr); process.on("uncaughtException", onErr);
    b.warm();
    await b.untilVerdict();
    process.off("unhandledRejection", onErr); process.off("uncaughtException", onErr);
    const f = facts(b);
    return { ...f, thrown, state: b.state, escaped, onLines: b.rec.lines.filter((x) => /flight world: on/.test(x.l)).length, timedLine: lineOf(b) };
  },
  /* Q16: skip, with constant work */
  async q16() {
    const b = await bootB({ flags: { fit: "skip" }, cost: () => 50 });
    const work = b.busyWork();
    b.warm();
    await b.untilVerdict(12000);
    work.stop();
    return { ...facts(b), state: b.state };
  },
  async q16fit() {
    const door = await (async () => { installPage(); installClock(); return import(INDEX); })();
    return { fit: door.FIT_MS };
  },
  /* Q17: destroyed while waiting (constant work), and retired (the context lost) */
  async q17(how) {
    const b = await bootB({ cost: () => 10 });
    const work = b.busyWork();
    b.warm();
    await b.clock.advance(2000);
    const pre = { timed: b.timedFrames().length, verdict: !!b.verdict() };
    const at = b.clock.now();
    if (how === "destroy") b.journey.destroy(); else b.page.loseContext();
    work.stop();
    await b.clock.advance(100);
    const soon = [...b.live.values()].map((x) => ({ ms: x.ms, due: x.at + x.ms - b.clock.now() }));
    await b.clock.advance(30000);
    const left = [...b.live.values()];
    return { left, soon,
      ...facts(b), pre, at, state: b.state, timedAfter: b.timedFrames().filter((f) => f.t > at).length, framesAfter: b.rec.frames.filter((f) => f.t > at).length,
      on: b.rec.lines.some((x) => /flight world: on/.test(x.l)),
    };
  },
};

/* Q18, on the world itself: createVoyage, its size changed once the first timed frame has been drawn */
async function q18(resize) {
  let at = null;
  const b = await bootB({
    /* the old size's first timed frame 25 ms; at the new size the warm-up 200 ms (a driver's last work), the timed frames 20 ms */
    cost: (f) => (f.epoch === 0 ? (f.warm ? 10 : 25) : f.warm ? 200 : 20),
    after: (f) => { if (resize && !f.warm && f.timedN === 0 && at === null) { at = f.t; v.resize(1000, 700); } },
  });
  const { createVoyage } = await import(VOYAGE);
  const v = createVoyage(b.page.hostCanvas(), { restFor: () => [0, 0, 0, 0] });
  if (!v) return { none: "createVoyage made no world on the stub page" };
  v.resize(resize === "before" ? 1000 : 1280, resize === "before" ? 700 : 800);
  await b.clock.advance(5000, () => false);
  const sizeBefore = [b.rec.world.width, b.rec.world.height];
  let state = "pending";
  v.warm().then(() => { state = "resolved"; }, () => { state = "rejected"; });
  await b.clock.advance(40000, () => !!b.verdict());
  await b.clock.advance(2000);
  return { ...facts(b), state, resized: at, sizeBefore, sizeAtVerdict: b.verdict()?.size ?? null, lines: b.rec.lines.map((x) => x.l).filter((l) => /flight world/.test(l)) };
}

/* Q19 */
async function q19() {
  installPage(); installClock();
  const door = await import(INDEX);
  const { readFileSync } = await import("node:fs");
  const readme = readFileSync(new URL("../../assets/door/README.md", import.meta.url), "utf8");
  return { exported: ["watch", "busyHeard", "busyGone", "busyPeer"].map((n) => typeof door[n]), listed: ["watch", "busyHeard", "busyGone", "busyPeer"].map((n) => new RegExp(`\\b${n}\\b`).test(readme)) };
}

const CASES = guarded({
  ...Object.fromEntries(Object.entries(A).map(([k, f]) => [`A_${k}`, f])),
  ...Object.fromEntries(Object.entries(C).map(([k, f]) => [`C_${k}`, f])),
  ...Object.fromEntries(Object.entries(D).map(([k, f]) => [`D_${k}`, f])),
  B_q10: B.q10, B_q11: B.q11, B_q12: B.q12, B_q13: B.q13,
  B_q14fast: () => B.q14busy(10), B_q14slow: () => B.q14busy(50), B_q14tenfast: () => B.q14ten(10), B_q14tenslow: () => B.q14ten(50),
  B_q15: B.q15, B_q16: B.q16, B_q16fit: B.q16fit, B_q17destroy: () => B.q17("destroy"), B_q17lost: () => B.q17("lost"),
  B_q18: () => q18("during"), B_q18ref: () => q18("before"), B_q18plain: () => q18(null),
  Q19: q19,
  B_q20: B.q20,
});

if (process.argv[2] === "--child") await childMain(CASES);

/* ===================================================================== the statements */

const run = (name, timeout = 120000) => runCase(import.meta.url, name, timeout);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

{
  const r = run("A_q1");
  chk("Q1 watch(null) and watch(undefined) return what they were given and throw nothing", r, (r) => [r.threw === null && r.nullOut === null && r.undefOut === undefined, `threw ${r.threw}, null -> ${show(r.nullOut)}, undefined -> ${show(r.undefOut)}`]);
  chk("Q1 watch(gl) returns the same object, twice over", r, (r) => [r.same === true && r.sameAgain === true, `same ${r.same}, again ${r.sameAgain}`]);
  chk("Q1 watched twice, a compile counts once and the real compileShader runs once a call", r, (r) => [r.n === 1 && r.two === 2 && r.after === 0 && r.baseCalls === 2 && r.result === "compiled", `under way ${r.n}, ${r.two} after a second shader, ${r.after} once both are read; real calls ${r.baseCalls} (two compiles asked), result ${show(r.result)}`]);
}
{
  const r = run("A_q2");
  chk("Q2 (precondition) with nothing begun, quiet() is true", r, (r) => [r.quietBefore === true, `quiet ${r.quietBefore}`]);
  chk("Q2 after compileShader(s), quiet() is false, the shader is under way, and stays so while it is not read", r, (r) => [eq(r.during, [false, 1]) && eq(r.longAfter, [false, 1]), `at once ${show(r.during)}, 3 s later ${show(r.longAfter)} ([quiet, under way])`]);
  chk("Q2 getShaderParameter(s, COMPILE_STATUS) ends it (the real answer passes through); quiet() is true once 100 ms have passed, not before", r, (r) => [r.read === "shader-status" && r.justRead[1] === 0 && r.justRead[0] === false && r.at50 === false && r.at150 === true, `read ${show(r.read)}, just after ${show(r.justRead)}, +50 ms ${r.at50}, +150 ms ${r.at150}`]);
}
{
  const r = run("A_q3");
  chk("Q3 linkProgram(p) opens a span for the program and closes those of its attached shaders (2 shaders: 2, then 1), the result passes through", r, (r) => [r.compiled === 2 && r.linked === 1 && r.link === "linked", `after two compiles ${r.compiled}, after the link ${r.linked}, result ${show(r.link)}`]);
  chk("Q3 getProgramParameter(p, LINK_STATUS) closes it", r, (r) => [r.linkRead === "program-status" && r.afterLinkRead === 0, `read ${show(r.linkRead)}, under way ${r.afterLinkRead}`]);
  chk("Q3 COMPLETION_STATUS_KHR answering false does not close it; answering true does", r, (r) => [r.completionFalse === false && r.stillUnder === 1 && r.completionTrue === true && r.closed === 0, `false: ${r.completionFalse} under way ${r.stillUnder}; true: ${r.completionTrue} under way ${r.closed}`]);
}
{
  const r = run("A_q4");
  chk("Q4 deleteProgram and deleteShader end their spans (and pass through)", r, (r) => [r.linked === 1 && r.afterDeleteProgram === 0 && r.compiled === 1 && r.afterDeleteShader === 0 && r.deletedProgram === "deleted-program" && r.deletedShader === "deleted-shader", `program ${r.linked} -> ${r.afterDeleteProgram}, shader ${r.compiled} -> ${r.afterDeleteShader}`]);
  chk("Q4 a program never asked about is under way at 4800 ms and no longer at 5100 ms, and the page is quiet after", r, (r) => [eq(r.at4800, [1, false]) && r.at5100 === 0 && r.at5400 === true, `at 4800 ms ${show(r.at4800)}, at 5100 ms ${r.at5100}, quiet at 5400 ms ${r.at5400}`]);
  chk("Q4 so is a shader never asked about", r, (r) => [r.shaderAt4800 === 1 && r.shaderAt5100 === 0, `at 4800 ms ${r.shaderAt4800}, at 5100 ms ${r.shaderAt5100}`]);
}
{
  const r = run("A_q5");
  for (const fn of ["texImage2D", "texSubImage2D", "texImage3D", "texSubImage3D", "compressedTexImage2D", "compressedTexSubImage2D", "compressedTexImage3D", "compressedTexSubImage3D", "generateMipmap"]) {
    chk(`Q5 ${fn}: a pulse (mark() changes, quiet() false for 100 ms), never under way, the real result passes through`, r, (r) => {
      const x = r.each.find((e) => e.fn === fn);
      return [!!x && x.quietBefore === true && x.marked === true && x.quietNow === false && x.at50 === false && x.at150 === true && x.n === 0 && x.nAfter === 0 && x.result === `result:${fn}`, show(x)];
    });
  }
}
{
  const r = run("A_q6");
  chk("Q6 calls inside own(fn) are not counted: nothing under way, mark() unchanged, quiet() stays true, results pass through", r, (r) => [r.inside.n === 0 && r.inside.marked === false && r.inside.quiet === true && r.inside.result === "result:texImage2D", show(r.inside)]);
  chk("Q6 counting resumes after fn, even if it threw", r, (r) => [r.after.n === 1 && r.after.marked === true, `after an own(throw) (it threw out ${r.threwOut}): ${show(r.after)}`]);
}
{
  const r = run("A_q7");
  chk("Q7 busyHeard(\"flight\", { n: 1, gen: 1 }) makes quiet() false and changes mark(); busyExcept(\"x\") includes it, busyExcept(\"flight\") does not", r, (r) => [r.threw === null && r.first.marked && r.first.quiet === false && r.exceptX === 1 && r.exceptFlight === 0, `threw ${r.threw}, ${show(r.first)}, except x ${r.exceptX}, except flight ${r.exceptFlight}`]);
  chk("Q7 the same message twice does not bump mark(); it stays busy while it is not gone", r, (r) => [r.twice === true && r.stillBusy === false, `mark unchanged ${r.twice}, quiet after 1 s ${r.stillBusy}`]);
  chk("Q7 busyGone(\"flight\") clears it: nothing under way, quiet 100 ms on", r, (r) => [r.gone === 0 && r.quietAfterGone === true, `under way ${r.gone}, quiet ${r.quietAfterGone}`]);
  chk("Q7 several sources add up, and busyExcept leaves out the one named", r, (r) => [r.sum === 5 && r.exceptA === 3, `sum ${r.sum} (want 5), except a ${r.exceptA} (want 3)`]);
  chk("Q7 a bad number (NaN, a string, a missing field) counts as 0, and nothing throws", r, (r) => [r.bad === 0 && r.threw === null, `under way ${r.bad}, threw ${r.threw}`]);
}
{
  const r = run("C_q8post");
  chk("Q8 a worker's compile posts { type: \"busy\", n, gen } with the work under way, and again when it is read (n 0, gen higher)", r, (r) => [r.ups > 0 && r.during.length > 0 && r.during.every((m) => typeof m.gen === "number") && r.during[r.during.length - 1].n === 1 && r.last.n === 0 && r.genRose && r.cloneErrors.length === 0, `up ${r.ups}, posted during ${show(r.during)}, last ${show(r.last)}, gen rose ${r.genRose}, clone errors ${show(r.cloneErrors)}`]);
  const h = run("C_q8hear");
  chk("Q8 a page message { type: \"busy\" } reaches busyHeard(\"page\", ...): the worker counts it and is not quiet; n 0 clears it", h, (h) => [h.base === 0 && h.heard.n === 2 && h.heard.quiet === false && h.cleared === 0 && h.deads.length === 0, `before ${h.base}, heard ${show(h.heard)}, cleared ${h.cleared}, dead ${show(h.deads)}`]);
  chk("Q8 ... and is not echoed back to the page as the worker's own", h, (h) => [h.echoed === 0, `${h.echoed} busy message(s) with the page's n posted back`]);
  const a = run("C_q8adapter");
  chk("Q8 the page adapter has busy(); its default does nothing and does not throw (page.js)", a, (a) => [a.type === "function" && a.threw === null, `typeof page.busy ${a.type}, threw ${a.threw}`]);
}
{
  const r = run("D_flight");
  chk("Q9 remote-flight posts { type: \"busy\" } to its worker when the page's ledger changes (compile begun: n 1, read: n 0)", r, (r) => [r.page.length > 0 && r.page[r.page.length - 1].n === 1 && r.pageLast === 0 && r.cloneErrors.length === 0, `posted on a compile ${show(r.page)}, after the read ${r.pageLast}`]);
  chk("Q9 ... it hears the worker's { type: \"busy\" } (counted on the page) and does not send the worker's own back", r, (r) => [r.heard === 1 && r.echo === 0, `page counts ${r.heard} (want 1), echoed ${r.echo} (want 0)`]);
  chk("Q9 ... a fallback drops what it heard, and the page's work is forwarded no more", r, (r) => [r.afterFallBack === 0 && r.forwardedAfter === 0, `counted after the fallback ${r.afterFallBack}, forwarded after ${r.forwardedAfter}`]);
  const d = run("D_flightDestroy");
  chk("Q9 destroy() drops the worker's ledger (busyGone) and stops forwarding", d, (d) => [d.heard === 2 && d.gone === 0 && d.forwardedAfter === 0, `heard ${d.heard}, after destroy ${d.gone}, forwarded after ${d.forwardedAfter}`]);
  const w = run("D_world");
  chk("Q9 remote-world: each world's worker is its own source: two worlds' ledgers add up (1 and 2: 3), neither overwrites the other", w, (w) => [w.both === 3 && w.firstAgain === 4, `both ${w.both} (want 3), first again ${w.firstAgain} (want 4)`]);
  chk("Q9 remote-world: each worker is sent the others' work and the page's, never its own (1 and 2: first gets 2, second 1; with the page's compile 3 and 2)", w, (w) => [w.toFirst === 2 && w.toSecond === 1 && w.toFirstWithPage === 3 && w.toSecondWithPage === 2, `first ${w.toFirst}, second ${w.toSecond}; with the page's work first ${w.toFirstWithPage}, second ${w.toSecondWithPage}`]);
  chk("Q9 remote-world: a world's worker finishing (n 0) and a world's destroy() each drop only their own, and forwarding stops after destroy", w, (w) => [w.firstCleared === 2 && w.secondDestroyed === 0 && w.firstDestroyed === 0 && w.forwardedAfter === 0, `after the first said 0: ${w.firstCleared} (want 2), second destroyed ${w.secondDestroyed} (want 0), first destroyed ${w.firstDestroyed} (want 0), forwarded to the destroyed ${w.forwardedAfter}`]);
}
{
  const r = run("B_q10");
  chk("Q10 nothing under way, 3 frames at 10 ms: the verdict is \"on\" and exactly 3 frames were timed", r, (r) => [!!r.verdict && /flight world: on/.test(r.verdict) && r.timed === 3, `line ${show(r.verdict)}, timed ${r.timed}, frames seen ${r.frames}`]);
  chk("Q10 the first timed frame begins no sooner than 100 ms after the last upload or compile ended", r, (r) => [r.firstTimed !== null && r.lastEnded !== null && r.firstTimed >= r.lastEnded + 99, `first timed at ${r.firstTimed} ms, last upload or compile ended at ${r.lastEnded} ms (outside the frames)`]);
  chk("Q10 D1: the line says 3 frames timed and none thrown away", r, (r) => [!!r.line && /frames? timed|frame\(s\) timed/.test(r.line) && r.thrown === 0, `line ${show(r.line)}, thrown ${r.thrown}`]);
}
{
  const r = run("B_q11");
  chk("Q11 a compile begun and not read before the first timed frame: no timed frame starts until it is read plus 100 ms", r, (r) => [r.begun > 0 && r.readAt > r.begun && r.timed >= 3 && r.inside.length === 0 && r.firstTimed >= r.readAt + 99, `begun ${r.begun}, read ${r.readAt}, timed frames at ${show(r.timedAt)}, inside the wait ${show(r.inside)}`]);
}
{
  const r = run("B_q12");
  chk("Q12 a frame during which something pulsed is discarded and an extra frame is timed (4 timed, not 3), the verdict still \"on\"", r, (r) => [r.timed === 4 && /flight world: on/.test(r.verdict || ""), `timed ${r.timed} (want 4), line ${show(r.verdict)}`]);
  chk("Q12 D1: the line says 1 frame thrown away", r, (r) => [r.thrown === 1, `line ${show(r.line)}, thrown ${r.thrown}`]);
}
{
  const r = run("B_q13");
  chk("Q13 three contaminated frames at 300 ms, then clean ones at 10 ms: the median is of the clean ones, \"on (frame 10 ms)\"", r, (r) => [/flight world: on \(frame 10 ms\)/.test(r.verdict || "") && r.timed === 6, `line ${show(r.verdict)}, timed ${r.timed} (want 6)`]);
  chk("Q13 D1: the line says 3 frames thrown away", r, (r) => [r.thrown === 3, `line ${show(r.line)}, thrown ${r.thrown}`]);
}
{
  const fast = run("B_q14fast"), slow = run("B_q14slow");
  chk("Q14 constant work, never quiet: the frames are timed after 8 s of the tab shown (not before 7.5 s, not after 11 s)", fast, (r) => [r.firstTimed >= 7500 && r.firstTimed <= 11000, `first timed frame at ${r.firstTimed} ms`]);
  chk("Q14 ... a fast machine (10 ms frames) is still \"on\"", fast, (r) => [/flight world: on/.test(r.verdict || ""), `line ${show(r.verdict)}`]);
  chk("Q14 ... a slow machine (50 ms frames) still gets \"off\", after the wait", slow, (r) => [/flight world: off/.test(r.verdict || "") && r.firstTimed >= 7500, `line ${show(r.verdict)}, first timed at ${r.firstTimed} ms`]);
  chk("Q14 D1: the console says \"not quiet in time\"", fast, (r) => [r.late === true, `lines ${show(r.line)}`]);
  const tf = run("B_q14tenfast"), ts = run("B_q14tenslow");
  chk("Q14 ten frames in a row contaminated: after the tenth thrown away the rest are timed whatever runs (11 to 20 timed frames), \"on\" for 10 ms frames", tf, (r) => [r.timed >= 11 && r.timed <= 20 && /flight world: on/.test(r.verdict || ""), `timed ${r.timed}, line ${show(r.verdict)}`]);
  chk("Q14 ... and a slow machine (50 ms) still gets \"off\"", ts, (r) => [r.timed >= 11 && r.timed <= 20 && /flight world: off/.test(r.verdict || ""), `timed ${r.timed}, line ${show(r.verdict)}`]);
  chk("Q14 D1: the console says \"not quiet in time\"", tf, (r) => [r.late === true, `lines ${show(r.line)}`]);
}
{
  const r = run("B_q15");
  chk("Q15 hidden at the start: no frame timed, and no verdict, while hidden", r, (r) => [r.whileHidden === 0 && r.verdictWhileHidden === false, `frames while hidden ${r.whileHidden}, verdict ${r.verdictWhileHidden}`]);
  chk("Q15 on show (at 5 s) the 8 s start again: the first timed frame is at 12.5 s or after, and within 16 s", r, (r) => [r.firstTimed !== null && r.firstTimed >= r.shownAt + 7500 && r.firstTimed <= r.shownAt + 11000, `shown at ${r.shownAt} ms, first timed frame at ${r.firstTimed} ms`]);
}
{
  const r = run("B_q16");
  chk("Q16 fit \"skip\" with constant work: \"on (fitness skipped)\" at once, no frame timed, no waiting for quiet", r, (r) => [/flight world: on \(fitness skipped\)/.test(r.verdict || "") && r.frames === 0 && r.verdictAt < 3000, `line ${show(r.verdict)} at ${r.verdictAt} ms, frames drawn ${r.frames}`]);
  const f = run("B_q16fit");
  chk("Q16 FIT_MS is still 30", f, (f) => [f.fit === 30, `FIT_MS ${f.fit}`]);
}
{
  const d = run("B_q17destroy"), l = run("B_q17lost");
  chk("Q17 (precondition) the world is still waiting for quiet at 2 s: no timed frame, no verdict", d, (d) => [d.pre.timed === 0 && d.pre.verdict === false, show(d.pre)]);
  chk("Q17 destroyed while waiting: no frame is timed afterwards and the world is never called on", d, (d) => [d.framesAfter === 0 && d.on === false, `frames after ${d.framesAfter}, \"on\" said ${d.on}`]);
  chk("Q17 destroyed while waiting: the warm() asked settles", d, (d) => [d.state !== "pending", `warm() ${d.state}`]);
  chk("Q17 destroyed while waiting: no timer of the door's is left pending 100 ms later (no wait bound, no poll)", d, (d) => [d.soon.length === 0, `pending timers ${show(d.soon)} (ms asked, ms still to run)`]);
  chk("Q17 retired (the context lost) while waiting: no timed frame afterwards, the world is never called on, warm() settles", l, (l) => [l.framesAfter === 0 && l.on === false && l.state !== "pending", `frames after ${l.framesAfter}, on ${l.on}, warm() ${l.state}`]);
}
{
  const r = run("B_q18"), ref = run("B_q18ref"), plain = run("B_q18plain");
  chk("Q18 (precondition) the size was changed after the first timed frame, so a second size was drawn at", r, (r) => [r.resized !== null && r.epochs >= 2, `resized at ${r.resized}, sizes drawn at ${r.epochs}`]);
  chk("Q18 a size change between frames warms again at the new size (the 2 frames there cost 200 ms and are not timed, the timed ones 20 ms): \"on (frame 20 ms)\"", r, (r) => [/flight world: on \(frame 20 ms\)/.test(r.verdict || ""), `lines ${show(r.lines)}`]);
  chk("Q18 after the test (when the verdict is said) the world is drawn at the size it had before it", plain, (p) => [p.sizeAtVerdict !== null && eq(p.sizeBefore, p.sizeAtVerdict), `before ${show(p.sizeBefore)}, at the verdict ${show(p.sizeAtVerdict)}`]);
  chk("Q18 ... and after a resize in the test, at the size a world made at the new window size has", r, (r) => [ref.sizeBefore !== undefined && r.sizeAtVerdict !== null && eq(r.sizeAtVerdict, ref.sizeBefore), `at the verdict ${show(r.sizeAtVerdict)}, a world made at that size ${show(ref.sizeBefore)}`]);
}
{
  const r = run("B_q20");
  chk("Q20 (precondition) a timed frame was drawn, and threw: the warm-up frames went through", r, (r) => [r.frames === 2 && r.thrown >= 1, `${r.frames} warm-up frame(s) went through, ${r.thrown} timed frame(s) threw`]);
  chk("Q20 a timed frame that throws leaves the world off: the 'flight world: off:' line, never 'on', and no timing line", r, (r) => [/flight world: off:/.test(r.verdict || "") && r.onLines === 0 && r.timedLine === null, `line ${show(r.verdict)}, ${r.onLines} 'on' line(s), timing line ${show(r.timedLine)}`]);
  chk("Q20 ... warm() settles and no error escapes", r, (r) => [r.state !== "pending" && r.escaped.length === 0, `warm() ${r.state}, escaped ${show(r.escaped)}`]);
}
{
  const r = run("Q19");
  chk("Q19 index.js exports watch, busyHeard, busyGone and busyPeer", r, (r) => [eq(r.exported, ["function", "function", "function", "function"]), `typeof ${show(r.exported)}`]);
  chk("Q19 assets/door/README.md lists them", r, (r) => [eq(r.listed, [true, true, true, true]), `watch, busyHeard, busyGone, busyPeer listed: ${show(r.listed)}`]);
}
finish();
