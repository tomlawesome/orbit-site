/*
 * Test for the background compile wait not counting a hidden tab (#89, D), written from the specification alone.
 * chores.js compiledWithin(gl, par, list, every, stop), exported from assets/door/index.js, waits for programs to finish
 * compiling (KHR_parallel_shader_compile's COMPLETION_STATUS) for at most COMPILE_WAIT (5000 ms) and resolves true if they
 * did, false if not. Time while document.hidden is true does not count toward that limit.
 *
 * Assumed call (the README names the function, not its arguments): par is the extension object, list the programs,
 * every the poll gap in ms, stop a function that answers whether to give up (here never). If the real arguments differ
 * these cases fail on that, not on the limit.
 *
 *   H1 hidden-then-visible  20 s hidden, then 3 s visible, then the compile completes -> true
 *   H2 hidden-then-slow     20 s hidden, then 6 s visible with the compile still incomplete -> false (control)
 *   H0 visible              no hidden time: 3 s, then complete -> true (control)
 *
 * #123 (ALL-R1): a frozen hidden tab (no timer runs while hidden, as iOS Safari suspends a background tab) is time the
 * page was not seen; the first poll after it must not credit the gap.
 *   R1 frozen-then-complete  visible poll, hidden at 100 ms, frozen 60 s, shown, compile completes 3 s later -> true
 *   R2 frozen-never          same, never completes -> false, not before 5 s of visible time (100 ms before + 4.9 s after)
 *   R3 visible-slow          6 s visible, never completes -> false at about 5 s (control)
 *   R4 stop / lost           stop() or a lost context -> false at the next poll (control)
 *   R5 listeners             any listener added is removed once the promise settles (control)
 *   R6 finished-while-frozen the compile finished while hidden -> true once shown (control)
 *   R7 timers-running       poll every 1000 ms; hidden at +10 ms, 4.5 s jump, shown, page then stays visible, never completes
 *                           -> still pending 4 s after the show (the long hide-then-show span inside a poll gap counts 0)
 *   R8 worker-path          no `document`; the page is setPage({ hidden, onVisible }) as draw-worker.js does; as R1 -> true,
 *                           and the onVisible stop function is called once the promise settles
 *
 *   node tools/ci/door-lows-compile-hidden-test.mjs
 *
 * No dependencies and no browser; each case runs in a fresh Node process (this file again, as `--child`) against the
 * stub page in door-stub.mjs, on a virtual clock.
 */
import { INDEX, installPage, installClock, childMain, runCase, check, finish, errOf } from "./door-stub.mjs";

const CASES = {
  async "visible"() { return waitCase({ hiddenMs: 0, visibleMs: 3000, complete: true }); },
  async "hidden-then-visible"() { return waitCase({ hiddenMs: 20000, visibleMs: 3000, complete: true }); },
  async "hidden-then-slow"() { return waitCase({ hiddenMs: 20000, visibleMs: 6000, complete: false }); },
  "frozen-then-complete": () => frozenCase({ completeAfter: 3000 }),
  "frozen-never-early": () => frozenCase({ completeAfter: null, probeAt: 4700 }),
  "frozen-never-late": () => frozenCase({ completeAfter: null, probeAt: 5300 }),
  "frozen-done-while-hidden": () => frozenCase({ completeWhileHidden: true, completeAfter: 0 }),
  "visible-slow-early": () => frozenCase({ noHide: true, completeAfter: null, probeAt: 4500 }),
  "visible-slow-late": () => frozenCase({ noHide: true, completeAfter: null, probeAt: 5300 }),
  "stop": () => frozenCase({ noHide: true, completeAfter: null, probeAt: 300, stopAt: 100 }),
  "lost": () => frozenCase({ noHide: true, completeAfter: null, probeAt: 300, loseAt: 100 }),
  "timers-running": () => timersRunningCase(),
  "worker-path": () => workerPathCase(),
  "listeners": () => frozenCase({ completeAfter: 3000, listeners: true }),
};

/* a compile that is pending; visible poll(s) up to 100 ms; hidden at 100 ms; frozen 60 s (no timer runs); shown at
   60.1 s with visibilitychange fired. Then completeAfter ms later the compile completes (null: never); probeAt ms after
   the show (or after the start if noHide) the result is read. */
async function frozenCase({ completeAfter, probeAt = 6000, noHide = false, completeWhileHidden = false, stopAt = null, loseAt = null }) {
  const page = installPage();
  const clock = installClock();
  const COMPLETION = 0x91b1;
  let done = false, stopped = false;
  page.glBase.getProgramParameter = (p, pname) => (pname === COMPLETION ? done : true);
  page.glBase.getShaderParameter = page.glBase.getProgramParameter;
  const door = await import(INDEX);
  door.createDoor({ typingWait: 0, flags: {} });
  const count = () => Object.values(page.docListeners).reduce((n, l) => n + l.length, 0) + Object.values(page.winListeners).reduce((n, l) => n + l.length, 0);
  const before = count();
  let result = "pending";
  door.compiledWithin(page.gl, { COMPLETION_STATUS_KHR: COMPLETION }, [{ shaders: [] }], 50, () => stopped).then((v) => { result = v; }, (e) => { result = { rejected: String(e) }; });
  if (!noHide) {
    await clock.advance(100);                    /* visible polls up to 100 ms */
    page.setHidden(true);
    clock.jump(60000);                           /* frozen: no timer runs */
    if (completeWhileHidden) done = true;
    page.setHidden(false);                       /* shown at 60.1 s */
  }
  if (stopAt !== null) { await clock.advance(stopAt); stopped = true; }
  if (loseAt !== null) { await clock.advance(loseAt); page.lost = true; }
  if (completeAfter !== null && !completeWhileHidden) { await clock.advance(completeAfter); done = true; }
  const spent = (completeAfter !== null && !completeWhileHidden ? completeAfter : 0) + (stopAt ?? 0) + (loseAt ?? 0);
  await clock.advance(Math.max(0, probeAt - spent));
  const at = result;
  await clock.advance(1000);
  return { result, at, listenersLeft: count() - before };
}

/* R7: timers keep running; hide at +10 ms, 4.5 s pass, shown inside one poll gap (every = 1000), then visible and never
   complete. Read 4 s after the show. */
async function timersRunningCase() {
  const page = installPage();
  const clock = installClock();
  const COMPLETION = 0x91b1;
  page.glBase.getProgramParameter = (p, pname) => (pname === COMPLETION ? false : true);
  page.glBase.getShaderParameter = page.glBase.getProgramParameter;
  const door = await import(INDEX);
  door.createDoor({ typingWait: 0, flags: {} });
  let result = "pending";
  door.compiledWithin(page.gl, { COMPLETION_STATUS_KHR: COMPLETION }, [{ shaders: [] }], 1000, () => false).then((v) => { result = v; }, (e) => { result = { rejected: String(e) }; });
  await clock.advance(10);
  page.setHidden(true);
  clock.jump(4500);
  page.setHidden(false);
  await clock.advance(4000);
  const at = result;
  return { at };
}

/* R8: the worker's route: no document; the page answers through setPage({ hidden, onVisible }). */
async function workerPathCase() {
  const page = installPage();
  const clock = installClock();
  const COMPLETION = 0x91b1;
  let done = false;
  page.glBase.getProgramParameter = (p, pname) => (pname === COMPLETION ? done : true);
  page.glBase.getShaderParameter = page.glBase.getProgramParameter;
  const door = await import(INDEX);
  door.createDoor({ typingWait: 0, flags: {} });
  const { page: pg, setPage } = await import("../../assets/door/page.js");
  const orig = { hidden: pg.hidden, onVisible: pg.onVisible };
  const savedDoc = globalThis.document;
  let h = false, stops = 0;
  const shown = new Set();
  setPage({ hidden: () => h, onVisible: (fn) => { shown.add(fn); return () => { stops++; shown.delete(fn); }; } });
  delete globalThis.document;
  let result = "pending", stopsAtSettle = null;
  try {
    door.compiledWithin(page.gl, { COMPLETION_STATUS_KHR: COMPLETION }, [{ shaders: [] }], 50, () => false)
      .then((v) => { result = v; stopsAtSettle = stops; }, (e) => { result = { rejected: String(e) }; });
    await clock.advance(100);
    h = true;
    clock.jump(60000);                           /* frozen: no timer runs */
    h = false;
    for (const fn of [...shown]) fn();
    await clock.advance(3000);
    done = true;
    await clock.advance(1500);
  } finally {
    setPage(orig);
    if (savedDoc !== undefined) globalThis.document = savedDoc;
  }
  return { result, stops };
}

async function waitCase({ hiddenMs, visibleMs, complete }) {
  const page = installPage({ hidden: hiddenMs > 0 });
  const clock = installClock();
  const COMPLETION = 0x91b1;
  let done = false;
  const status = (pname) => (pname === COMPLETION ? done : true);
  page.glBase.getProgramParameter = (p, pname) => status(pname);
  page.glBase.getShaderParameter = (s, pname) => status(pname);
  const door = await import(INDEX);
  door.createDoor({ typingWait: 0, flags: {} });
  let result = "pending";
  const program = { shaders: [] };
  door.compiledWithin(page.gl, { COMPLETION_STATUS_KHR: COMPLETION }, [program], 50, () => false).then((v) => { result = v; }, (e) => { result = { rejected: String(e) }; });
  if (hiddenMs > 0) {
    await clock.advance(hiddenMs);
    out_hiddenResult = result;
    page.setHidden(false);
  }
  await clock.advance(visibleMs);
  if (complete) done = true;
  await clock.advance(1500);
  return { result, whileHidden: hiddenMs > 0 ? out_hiddenResult : null, wait: door.COMPILE_WAIT };
}
let out_hiddenResult = null;

if (process.argv[2] === "--child") await childMain(CASES);

{
  const c = runCase(import.meta.url, "visible");
  check("H0 control: a visible page, the compile completes after 3 s -> true", !c.error && c.result === true, `resolved ${JSON.stringify(c.result)}; COMPILE_WAIT ${c.wait}${errOf(c)}`);
  const s = runCase(import.meta.url, "hidden-then-slow");
  check("H2 control: 20 s hidden, then 6 s visible and still incomplete -> false", !s.error && s.result === false, `resolved ${JSON.stringify(s.result)}${errOf(s)}`);
  const h = runCase(import.meta.url, "hidden-then-visible");
  check("H1: 20 s hidden, then 3 s visible and the compile completes -> true (hidden time does not count)", !h.error && h.result === true, `resolved ${JSON.stringify(h.result)} (still pending while hidden: ${h.whileHidden === "pending"})${errOf(h)}`);
}
{
  const r1 = runCase(import.meta.url, "frozen-then-complete");
  check("R1: visible, hidden at 100 ms, frozen 60 s, shown, compile completes 3 s later -> true (the frozen gap does not count)", !r1.error && r1.result === true, `resolved ${JSON.stringify(r1.result)}${errOf(r1)}`);
  const r2a = runCase(import.meta.url, "frozen-never-early");
  check("R2a: same, never completes: still pending 4.7 s after the tab is shown (under 5 s of visible time)", !r2a.error && r2a.at === "pending", `at 4.7 s: ${JSON.stringify(r2a.at)}${errOf(r2a)}`);
  const r2b = runCase(import.meta.url, "frozen-never-late");
  check("R2b: same, never completes: false once 5.3 s of visible time has passed", !r2b.error && r2b.at === false, `at 5.3 s: ${JSON.stringify(r2b.at)}${errOf(r2b)}`);
  const r3a = runCase(import.meta.url, "visible-slow-early");
  check("R3a control: visible throughout, never completes: still pending at 4.5 s", !r3a.error && r3a.at === "pending", `at 4.5 s: ${JSON.stringify(r3a.at)}${errOf(r3a)}`);
  const r3b = runCase(import.meta.url, "visible-slow-late");
  check("R3b control: visible throughout, never completes: false by 5.3 s", !r3b.error && r3b.at === false, `at 5.3 s: ${JSON.stringify(r3b.at)}${errOf(r3b)}`);
  const r4a = runCase(import.meta.url, "stop");
  check("R4a control: stop() -> false at the next poll", !r4a.error && r4a.at === false, `at 300 ms: ${JSON.stringify(r4a.at)}${errOf(r4a)}`);
  const r4b = runCase(import.meta.url, "lost");
  check("R4b control: a lost context -> false at the next poll", !r4b.error && r4b.at === false, `at 300 ms: ${JSON.stringify(r4b.at)}${errOf(r4b)}`);
  const r5 = runCase(import.meta.url, "listeners");
  check("R5 control: no listener left behind once the promise settles", !r5.error && r5.listenersLeft === 0, `${r5.listenersLeft} left${errOf(r5)}`);
  const r7 = runCase(import.meta.url, "timers-running");
  check("R7: timers running, hide at +10 ms, 4.5 s, shown inside a 1000 ms poll gap: still pending 4 s after the show", !r7.error && r7.at === "pending", `at 4 s after the show: ${JSON.stringify(r7.at)}${errOf(r7)}`);
  const r8 = runCase(import.meta.url, "worker-path");
  check("R8: worker path (no document; setPage hidden/onVisible), as R1 -> true, and the onVisible stop called once", !r8.error && r8.result === true && r8.stops === 1, `resolved ${JSON.stringify(r8.result)}; stop called ${r8.stops} time(s)${errOf(r8)}`);
  const r6 = runCase(import.meta.url, "frozen-done-while-hidden");
  check("R6 control: the compile finished while hidden -> true once shown", !r6.error && r6.result === true, `resolved ${JSON.stringify(r6.result)}${errOf(r6)}`);
}
finish();
