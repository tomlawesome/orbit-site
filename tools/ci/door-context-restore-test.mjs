/*
 * Test for a lost GPU context coming back (#39 item 1, owner decision 2a), written from the specification alone
 * (batch fix/m2-door, D12). The page has ONE context (fitness.js gpu()), which keeps its canvas. On
 * `webglcontextlost` the door calls event.preventDefault() (so the browser may restore the context) and the page stays
 * 2D while it is lost. On `webglcontextrestored` the NEXT world made (a new journey's warm, or a remount) is built on
 * the restored context and the flight world is on again. If the context is never restored the page stays 2D. There is
 * no second GPU test and no second context: gpu() still returns the same { canvas, gl }.
 *
 *   node tools/ci/door-context-restore-test.mjs
 *
 * No dependencies and no browser; each case runs in a fresh Node process (this file again, as `--child`) against the
 * stub page in door-stub.mjs, whose fake context answers isContextLost() from page.lost. The journeys are reached
 * through assets/door/index.js (gpu() through fitness.js, the same module). A world is "built" when shaders (other
 * than the crop probe's) are asked for. The cases:
 *   restored  A warms (world on); lost fires; B warms while lost (no world); restored fires; C warms (world built).
 *   never     the same, restored never fires: C has no world (the control).
 */
import { INDEX, isProbeSrc, installPage, sleep, childMain, runCase, check, finish, errOf } from "./door-stub.mjs";

const FITNESS = "../../assets/door/fitness.js";
const LOST_LINE = /flight world: off: the context was lost/;

const CASES = {
  async "restored"() { return lifeCase(true); },
  async "never"() { return lifeCase(false); },
};

async function lifeCase(restores) {
  const page = installPage();
  const door = await import(INDEX);
  const fitness = await import(FITNESS);
  const d = door.createDoor({ typingWait: 0, flags: {} });
  door.openChores();
  const made = () => page.shaders.filter((s) => !isProbeSrc(s.src)).length;
  const warm = async (prove = false) => {
    const before = made();
    const journey = d.journey(page.journeyOptions());
    journey.warm({ prove }).catch(() => {});
    for (let i = 0; i < 20 && made() === before; i++) await sleep(25);
    await sleep(150);                                           /* let a world that is going to be made, be made */
    return { journey, made: made() - before };
  };
  const out = {};

  const gpuFirst = fitness.gpu();
  const A = await warm(true);                                   /* its world proved: the speed test runs */
  for (let i = 0; i < 60 && !page.lines.some((l) => /flight world: (on|off)/.test(l)); i++) await sleep(50);
  out.aMade = A.made;
  out.aOn = page.lines.some((l) => /flight world: on/.test(l)) && !page.lines.some((l) => /flight world: off/.test(l));
  out.contextsAfterA = page.contexts;

  /* the context is lost */
  const lost = { type: "webglcontextlost", cancelable: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  page.lost = true;
  const listenersLost = [...(page.canvasListeners.webglcontextlost || [])];
  for (const fn of listenersLost) fn(lost);
  await sleep(50);
  out.lostListeners = listenersLost.length;
  out.prevented = lost.defaultPrevented;
  out.aDead = page.lines.filter((l) => LOST_LINE.test(l)).length;

  const B = await warm();                                       /* a new journey while the context is lost */
  out.bMade = B.made;
  out.bOffLines = page.lines.filter((l) => /flight world: on/.test(l)).length;

  let linesAtRestore = page.lines.length;
  if (restores) {
    page.lost = false;
    const restored = { type: "webglcontextrestored", preventDefault() {} };
    linesAtRestore = page.lines.length;
    for (const fn of [...(page.canvasListeners.webglcontextrestored || [])]) fn(restored);
    out.restoredListeners = (page.canvasListeners.webglcontextrestored || []).length;
    await sleep(50);
  }
  const C = await warm(true);                                   /* the next journey, its world proved (the speed test runs) */
  for (let i = 0; i < 60 && !page.lines.slice(linesAtRestore).some((l) => /flight world: (on|off)/.test(l)); i++) await sleep(50);
  out.cMade = C.made;
  out.cOffLines = page.lines.slice(linesAtRestore).filter((l) => /flight world: off/.test(l)).length;
  out.cOnLines = page.lines.slice(linesAtRestore).filter((l) => /flight world: on/.test(l)).length;

  const gpuAgain = fitness.gpu();
  out.sameGpu = gpuAgain === gpuFirst || (!!gpuAgain && !!gpuFirst && gpuAgain.canvas === gpuFirst.canvas && gpuAgain.gl === gpuFirst.gl);
  out.gpuPresent = !!gpuFirst && !!gpuAgain;
  out.contextsAtEnd = page.contexts;
  out.lines = page.lines.filter((l) => /flight world/.test(l));
  return out;
}

if (process.argv[2] === "--child") await childMain(CASES);

{
  const n = runCase(import.meta.url, "never");
  check("control: journey A (the context is fine) builds a world", !n.error && n.aMade >= 1 && n.aOn === true, `${n.aMade} shader(s) asked for; 'flight world: on' printed: ${n.aOn}${errOf(n)}`);
  check("control: a lost context is told to the door and A's world is let go (the 'context was lost' line)", !n.error && n.lostListeners >= 1 && n.aDead >= 1, `${n.lostListeners} listener(s); ${n.aDead} line(s)${errOf(n)}`);
  check("control: while the context is lost, journey B builds no world", !n.error && n.bMade === 0, `${n.bMade} shader(s) asked for${errOf(n)}`);
  check("control: a context that is never restored leaves C without a world (the page stays 2D)", !n.error && n.cMade === 0, `${n.cMade} shader(s) asked for${errOf(n)}`);
  check("control: no second context was asked for", !n.error && n.contextsAtEnd === n.contextsAfterA, `${n.contextsAfterA} getContext call(s) after A, ${n.contextsAtEnd} at the end${errOf(n)}`);

  const r = runCase(import.meta.url, "restored");
  check("D12 (precondition): A built a world and the loss reached the door", !r.error && r.aMade >= 1 && r.lostListeners >= 1 && r.aDead >= 1, `A ${r.aMade} shader(s); ${r.lostListeners} listener(s); ${r.aDead} 'lost' line(s)${errOf(r)}`);
  check("D12: on webglcontextlost the door calls event.preventDefault() (the browser may restore the context)", !r.error && r.prevented === true, `defaultPrevented: ${r.prevented}${errOf(r)}`);
  check("D12: while the context is lost, a new journey B builds no world (no shader compiled)", !r.error && r.bMade === 0, `${r.bMade} shader(s) asked for${errOf(r)}`);
  check("D12 (precondition): the door listens for webglcontextrestored", !r.error && r.restoredListeners >= 1, `${r.restoredListeners} listener(s) on the shared canvas${errOf(r)}`);
  check("D12: after webglcontextrestored, the next journey C builds the world (shaders asked for)", !r.error && r.cMade >= 1, `${r.cMade} shader(s) asked for (want 1 or more)${errOf(r)}`);
  check("D12: ... and the flight world is on again (no 'off:' line since the restore)", !r.error && r.cMade >= 1 && r.cOffLines === 0 && r.cOnLines >= 1, `${r.cOnLines} 'on' and ${r.cOffLines} 'off:' line(s) since the restore; lines ${JSON.stringify(r.lines)}${errOf(r)}`);
  check("D12: gpu() answers the same { canvas, gl } after the restore", !r.error && r.gpuPresent === true && r.sameGpu === true, `same: ${r.sameGpu}${errOf(r)}`);
  check("D12: ... and no new context was asked for (no second getContext)", !r.error && r.contextsAtEnd === r.contextsAfterA, `${r.contextsAfterA} getContext call(s) after A, ${r.contextsAtEnd} at the end${errOf(r)}`);
}
finish();
