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
};

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
finish();
