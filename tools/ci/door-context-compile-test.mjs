/*
 * Test for a lost WebGL context being recovered whenever it is lost (#171), written from the issue alone. A context
 * lost while the world's shaders are compiling used to leave the world never made again for the rest of the visit
 * (engine.js: the world is replaced at the next warm only if it had been made, `madeOk`); a context lost after the
 * world is ready is restored and the world rebuilt (flight-waits-test.mjs W5). Both must rebuild: after the context
 * is lost and restored, a second warm() of the same journey makes a new world (its shaders asked for again) and
 * proves it.
 *
 *   node tools/ci/door-context-compile-test.mjs
 *
 * No dependencies and no browser; each case runs in a fresh Node process (this file again, as `--child`) against the
 * stub page in door-stub.mjs, on its virtual clock. The loss is page.loseContext() (what WEBGL_lose_context does:
 * isContextLost() true and webglcontextlost fired) and the restore is webglcontextrestored. The cases:
 *   after-ready      the world is proved, then the context is lost and restored (the existing behaviour, control)
 *   during-compile   the shaders are still compiling (COMPLETION_STATUS_KHR false) when the context is lost
 */
import { INDEX, isProbeSrc, installPage, installClock, childMain, runCase, check, finish, errOf } from "./door-stub.mjs";

const LIMIT_MS = 25000;
const FIT = /flight world: on/;
const COMPLETION = 0x91b1;                                     /* the stub's COMPLETION_STATUS_KHR */
const made = (page) => page.shaders.filter((s) => !isProbeSrc(s.src)).length;

const CASES = {
  async "after-ready"() { return lossCase({ compiling: false }); },
  async "during-compile"() { return lossCase({ compiling: true }); },
};

async function lossCase({ compiling }) {
  const page = installPage();
  const clock = installClock();
  let compiled = !compiling;                                   /* a compile still running answers false until it is done */
  page.glBase.getProgramParameter = (p, pname) => (pname === COMPLETION ? compiled : true);
  const door = await import(INDEX);
  const d = door.createDoor({ typingWait: 0, flags: {} });
  door.openChores();
  const journey = d.journey(page.journeyOptions());
  const out = {};
  let first = "pending";
  journey.warm().then(() => { first = "resolved"; }, () => { first = "rejected"; });
  if (compiling) await clock.advance(1000);                    /* shaders asked for, none done */
  else await clock.advance(LIMIT_MS, () => first !== "pending");
  await clock.advance(1000);
  out.firstMade = made(page);
  out.firstProved = page.lines.filter((l) => FIT.test(l)).length;
  page.loseContext();                                          /* lost: while compiling, or after the world is ready */
  await clock.advance(200);
  out.lostLines = page.lines.filter((l) => /flight world: off: the context was lost/.test(l)).length;
  compiled = true;
  await clock.advance(LIMIT_MS, () => first !== "pending");
  out.firstState = first;
  page.lost = false;                                           /* the browser restores the context */
  for (const fn of [...(page.canvasListeners.webglcontextrestored || [])]) fn({ type: "webglcontextrestored", preventDefault() {} });
  await clock.advance(200);
  const madeBefore = made(page), provedBefore = page.lines.filter((l) => FIT.test(l)).length;
  let again = "pending";
  journey.warm().then(() => { again = "resolved"; }, () => { again = "rejected"; });
  await clock.advance(LIMIT_MS, () => again !== "pending");
  await clock.advance(2000);
  out.again = again;
  out.newMade = made(page) - madeBefore;
  out.newProved = page.lines.filter((l) => FIT.test(l)).length - provedBefore;
  return out;
}

if (process.argv[2] === "--child") await childMain(CASES);

{
  const a = runCase(import.meta.url, "after-ready", 60000);
  check("control: the world is proved, then the context is lost and the world is let go", !a.error && a.firstProved >= 1 && a.lostLines >= 1, `proved ${a.firstProved}; 'context was lost' line(s) ${a.lostLines}${errOf(a)}`);
  check("control: after the restore, a second warm() makes a new world and proves it", !a.error && a.again !== "pending" && a.newMade >= 3 && a.newProved >= 1, `second warm() ${a.again}; ${a.newMade} shader(s) since; ${a.newProved} 'on' line(s) (want 3 and 1 or more)${a.error ? "; " + a.error : ""}`);
  const c = runCase(import.meta.url, "during-compile", 60000);
  check("#171 (precondition): the world's shaders were asked for and not done when the context was lost", !c.error && c.firstMade >= 3 && c.firstProved === 0 && c.lostLines >= 1, `${c.firstMade} shader(s); ${c.firstProved} 'on' line(s); 'context was lost' line(s) ${c.lostLines}${errOf(c)}`);
  check("#171: after the restore, a second warm() makes a new world", !c.error && c.again !== "pending" && c.newMade >= 3, `second warm() ${c.again}; ${c.newMade} shader(s) asked for since (want 3 or more)${errOf(c)}`);
  check("#171: ... and proves it", !c.error && c.newProved >= 1, `${c.newProved} 'flight world: on' line(s) since (want 1 or more)${errOf(c)}`);
}
finish();
