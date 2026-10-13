/*
 * Tests for two stalls in the door (#12), written from the specification alone (batch fix/m2-door, D1 and D2).
 *
 *   D1  capability.js probe(): if the WebGL context is lost while the probe waits for a shader compile
 *       (KHR_parallel_shader_compile, COMPLETION_STATUS polled), the probe settles with { ok: false } instead of
 *       polling for ever. Control: context not lost and the status turning true -> the probe goes on past the compile
 *       wait (it draws and reads pixels back) and settles. (Whether that probe then says ok depends on pixel values
 *       the fake context cannot know without the implementation: the control stops at "went on and settled".)
 *   D2  chores.js chore(fn, ms, tag): the queue runs one job at a time; a job whose promise never settles must not
 *       block every later chore: after a cap (15 s) the queue moves on. Control: two ordinary chores both run, in order.
 *
 *   node tools/ci/door-probe-chores-test.mjs
 *
 * No dependencies and no browser; each case runs in a fresh Node process (this file again, as `--child`) against the
 * stub page in door-stub.mjs. D2 runs on a virtual clock (setTimeout and performance.now), so the 15 s cap costs none.
 * The live door's own compile wait (door3d.js) is not reached: it needs the host-level live door mounted in the stub,
 * whose interface the specification does not give (see the report).
 */
import { INDEX, installPage, installClock, sleep, childMain, runCase, check, finish, errOf } from "./door-stub.mjs";

const CASES = {
  /* D1: the probe's compile wait, with the context lost (or not) */
  async "probe-lost"() { return probeCase({ lose: true }); },
  async "probe-control"() { return probeCase({ lose: false }); },

  /* D2: a stuck job, then an ordinary one */
  async "chores-stuck"() { return choresCase({ stuck: true }); },
  async "chores-control"() { return choresCase({ stuck: false }); },
};

async function probeCase({ lose }) {
  const page = installPage();
  /* the compile never reports complete; in the control it does, after 200 ms */
  let complete = false;
  const COMPLETION = 0x91b1;
  const status = (pname) => (pname === COMPLETION ? complete : true);
  page.glBase.getProgramParameter = (p, pname) => status(pname);
  page.glBase.getShaderParameter = (s, pname) => status(pname);
  page.glBase.getExtension = (name) => {
    if (name === "WEBGL_lose_context") return { loseContext() { page.lost = true; } };
    if (name === "WEBGL_debug_renderer_info") return null;
    return { COMPLETION_STATUS_KHR: COMPLETION };
  };
  const door = await import(INDEX);
  door.createDoor({ typingWait: 0, flags: { door3d: "1" } });
  door.gpu();                                   /* the gate's one context, which the probe runs on */
  door.openChores();
  const t0 = Date.now();
  let result = "pending";
  door.probe().then((r) => { result = r; }, (e) => { result = { rejected: String(e) }; });
  await sleep(150);
  if (lose) page.lost = true; else complete = true;
  /* give it a few seconds (real time) to settle */
  for (let i = 0; i < 40 && result === "pending"; i++) await sleep(100);
  return { settled: result !== "pending", result, ms: Date.now() - t0, contexts: page.contexts, drew: page.readPixels };
}

async function choresCase({ stuck }) {
  const page = installPage();
  const clock = installClock();
  const door = await import(INDEX);
  door.createDoor({ typingWait: 0, flags: {} });
  const ran = [];
  door.chore(() => { ran.push("a"); return stuck ? new Promise(() => {}) : Promise.resolve(); }, 0, "a");
  door.chore(() => { ran.push("b"); return Promise.resolve(); }, 0, "b");
  door.chore(() => { ran.push("c"); }, 0, "c");
  door.openChores();
  /* 40 s of virtual time: well past a 15 s cap */
  const started = clock.now();
  let allAt = null;
  await clock.advance(40000, () => { if (allAt === null && ran.length >= 3) allAt = clock.now() - started; return false; });
  return { ran, allAt, lines: page.lines.length };
}

if (process.argv[2] === "--child") await childMain(CASES);

{
  const r = runCase(import.meta.url, "probe-control");
  check("control (D1): context not lost and the compile completing -> the probe goes on past the wait (reads pixels back) and settles",
    !r.error && r.settled && r.drew >= 1, `settled ${r.settled}, readPixels calls ${r.drew}, result ${JSON.stringify(r.result)} after ${r.ms} ms${errOf(r)}`);
}
{
  const r = runCase(import.meta.url, "probe-lost");
  check("D1: a context lost while the probe waits for a compile -> the probe settles",
    !r.error && r.settled === true, `settled ${r.settled} (waited ${r.ms} ms of real time; want it to settle within 4000 ms)${errOf(r)}`);
  check("D1: ... and resolves { ok: false }", !r.error && r.result?.ok === false, `result ${JSON.stringify(r.result)}${errOf(r)}`);
}
{
  const r = runCase(import.meta.url, "chores-control");
  check("control (D2): ordinary chores all run, in order", !r.error && JSON.stringify(r.ran) === '["a","b","c"]', `ran ${JSON.stringify(r.ran)}${errOf(r)}`);
}
{
  const r = runCase(import.meta.url, "chores-stuck");
  check("D2: a job whose promise never settles does not block the later chores (all run within 30 s of the first)",
    !r.error && JSON.stringify(r.ran) === '["a","b","c"]' && r.allAt !== null && r.allAt <= 30000, `ran ${JSON.stringify(r.ran)}; the third ran at ${r.allAt} ms of virtual time (want at most 30000)${errOf(r)}`);
}
finish();
