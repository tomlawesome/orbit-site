/*
 * Tests for the descent's stall cap (#163, owner decision 10a), written from the specification alone.
 *
 *   S1  journey.js: after descend() starts, one frame runs and the clock then jumps 6 s (a main-thread stall). The
 *       descent's beats (warp, dusk, farewell) must each be seen, each on its own frame, in order: not all on the
 *       frame after the stall. (A stall counts as at most 64 ms of the descent's clock, as the climb's does.)
 *   S2  timeline.js's plain-timer form (runTimeline with no options, over descentBeats()): the same stall, the same
 *       demand. (Fails until the build gives the plain-timer form the cap too.)
 *   S3  a sign-in climb after a sign-out starts in real time (no stall cap) up to its warp, as before #163: a 6 s
 *       stall before the warp is counted whole, so the warp comes on the frame after it. Control: a climb with no
 *       sign-out before it does the same.
 *   S4  timeline.js plain-timer form: two beats at the same `at` fire on the same frame (as journey.js's clock does).
 *   C1  control: the climb already caps stalls: once its warp has come up, a 6 s jump does not fire the rest of the
 *       climb's beats on one frame.
 *
 * "A frame" is one tick of the fake clock's frame callbacks (16 ms apart); two beats are on the same frame when they
 * ran at the same virtual time.
 *
 *   node tools/ci/descent-stall-test.mjs
 *
 * No dependencies and no browser; each case runs in a fresh Node process (this file again, as `--child`) against the
 * stub page in door-stub.mjs, on its virtual clock.
 */
import { INDEX, installPage, installClock, childMain, runCase, check, finish, errOf } from "./door-stub.mjs";
import { bootWays, runFaked } from "./ready-ways-bed.mjs";

const STALL = 6000, FRAME = 16;
const first = (log, op, name) => log.find((e) => e.op === op && e.name === name)?.at ?? null;

async function journeyCase(go) {
  const page = installPage();
  const clock = installClock();
  const door = await import(INDEX);
  const d = door.createDoor({ typingWait: 0, flags: {} });
  const journey = d.journey(page.journeyOptions());
  return go({ page, clock, door, journey });
}

async function climbStall(afterDescent) {
  return journeyCase(async ({ page, clock, door, journey }) => {
    if (afterDescent) { journey.descend({ title: "Orbit", subtitle: "signing out" }); await clock.advance(9000); }
    const from = page.bodyLog.length;
    journey.fly(door.UP, { title: "Orbit", subtitle: "to somewhere" });
    await clock.advance(FRAME);                         /* one frame, before the warp */
    const t0 = clock.now();
    clock.jump(STALL);
    await clock.advance(10000);
    const warp = page.bodyLog.slice(from).find((e) => e.op === "add" && e.name === "showwarp")?.at ?? null;
    return { warpAfterStall: warp === null ? null : warp - (t0 + STALL) };
  });
}

const CASES = {
  async "journey-descent"() {
    return journeyCase(async ({ page, clock, journey }) => {
      journey.descend({ title: "Orbit", subtitle: "signing out" });
      await clock.advance(FRAME);                       /* one frame */
      clock.jump(STALL);                                /* the page stalls */
      await clock.advance(10000);
      const log = page.bodyLog;
      return {
        warp: first(log, "add", "showwarp"), dusk: first(log, "add", "showdusk"), farewell: first(log, "add", "farewell")
      };
    });
  },

  /* the plain-timer form: runTimeline with no schedule/cancel, as a host that has no clock of its own runs it */
  async "timeline-descent"() {
    const clock = installClock();
    const { runTimeline, descentBeats } = await import(new URL("../../assets/door/timeline.js", import.meta.url));
    const at = {};
    runTimeline(descentBeats(), (act) => { at[act] ??= performance.now(); });
    await clock.advance(FRAME);
    clock.jump(STALL);
    await clock.advance(10000);
    return { warp: at.warp ?? null, dusk: at.dusk ?? null, farewell: at.farewell ?? null };
  },

  /* S3: a climb (after a descent that ran to its end, or none) with a stall before its warp (200 ms in) */
  async "climb-after-descent"() { return climbStall(true); },
  async "climb-alone"() { return climbStall(false); },

  /* S4 */
  async "timeline-same-at"() {
    const clock = installClock();
    const { runTimeline } = await import(new URL("../../assets/door/timeline.js", import.meta.url));
    const at = {};
    runTimeline([{ at: 100, act: "a" }, { at: 100, act: "b" }, { at: 100, act: "c" }], (act) => { at[act] = performance.now(); });
    await clock.advance(2000);
    return { a: at.a ?? null, b: at.b ?? null, c: at.c ?? null };
  },

  /* the climb caps a stall only while its WebGL world is drawing (journey.js: stalls(drawingWorld)), so this one
     draws, so it is the fake world the ready-ways tests use (a fit one, its verdict in before the climb) */
  async "journey-climb"() {
    const { page, clock, door, journey, world } = await bootWays();
    journey.warm({ prove: false }).catch(() => {});
    await clock.advance(200);
    world(0)?.settle({ fit: true, ms: 12 });
    await clock.advance(200);
    journey.fly(door.UP, { title: "Orbit", subtitle: "to somewhere" });
    await clock.advance(20000, () => page.bodyClasses.has("showwarp"));
    if (!page.bodyClasses.has("showwarp")) return { warped: false };
    await clock.advance(FRAME);
    clock.jump(STALL);
    await clock.advance(20000);
    const log = page.bodyLog;
    return { warped: true, land: first(log, "add", "bare"), instrument: first(log, "add", "instrument"), release: first(log, "remove", "showdawn") };
  },
};

const seen = (r, keys) => !r.error && keys.every((k) => typeof r[k] === "number");
const apart = (r) => seen(r, ["warp", "dusk", "farewell"]) && r.warp < r.dusk && r.dusk < r.farewell;
const detail = (r) => `warp ${r.warp}, dusk ${r.dusk}, farewell ${r.farewell} (virtual ms; null = never seen)${errOf(r)}`;

if (process.argv[2] === "--child") await childMain(CASES);
else {
  const run = (how) => (how === "journey-climb" ? runFaked : runCase)(import.meta.url, how);
  /* C1 */
  {
    const c = run("journey-climb");
    check("control (C1, precondition): the climb's warp came up", !c.error && c.warped === true, `warped ${c.warped}${errOf(c)}`);
    check("control (C1): after a 6 s stall the climb's landing and instrument are not on the same frame (the climb caps stalls)",
      seen(c, ["land", "instrument"]) && c.land < c.instrument, `land ${c.land}, instrument ${c.instrument}${errOf(c)}`);
  }
  /* S1 */
  {
    const r = runCase(import.meta.url, "journey-descent");
    check("S1: journey.js: a 6 s stall after descend() starts: warp, dusk and farewell are each seen", seen(r, ["warp", "dusk", "farewell"]), detail(r));
    check("S1: ... each on its own frame, in order (not all on the frame after the stall)", apart(r), detail(r));
  }
  /* S2 */
  {
    const r = runCase(import.meta.url, "timeline-descent");
    check("S2: timeline.js plain-timer form: a 6 s stall: warp, dusk and farewell are each seen", seen(r, ["warp", "dusk", "farewell"]), detail(r));
    check("S2: ... each on its own frame, in order (not all on the frame after the stall)", apart(r), detail(r));
  }
  /* S3 */
  {
    const c = runCase(import.meta.url, "climb-alone");
    check("control (S3): a climb with no sign-out before it counts a 6 s stall before its warp whole (the warp is on the next frame)",
      !c.error && c.warpAfterStall !== null && c.warpAfterStall <= FRAME, `the warp came ${c.warpAfterStall} ms after the stall (want ${FRAME} or less)${errOf(c)}`);
    const r = runCase(import.meta.url, "climb-after-descent");
    check("S3: a climb after a sign-out starts in real time: the stall before its warp is counted whole (descend() leaves no cap on)",
      !r.error && r.warpAfterStall !== null && r.warpAfterStall <= FRAME, `the warp came ${r.warpAfterStall} ms after the stall (want ${FRAME} or less)${errOf(r)}`);
  }
  /* S4 */
  {
    const r = runCase(import.meta.url, "timeline-same-at");
    check("S4: timeline.js plain-timer form: three beats at the same `at` fire on the same frame",
      !r.error && typeof r.a === "number" && r.a === r.b && r.b === r.c, `a ${r.a}, b ${r.b}, c ${r.c} (virtual ms)${errOf(r)}`);
  }
  finish();
}
