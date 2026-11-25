/*
 * Tests for the descent's stall cap (#163, owner decision 10a), written from the specification alone.
 *
 *   S1  journey.js: after descend() starts, one frame runs and the clock then jumps 6 s (a main-thread stall). The
 *       descent's beats (warp, dusk, farewell) must each be seen, each on its own frame, in order: not all on the
 *       frame after the stall. (A stall counts as at most 64 ms of the descent's clock, as the climb's does.)
 *   S2  timeline.js's plain-timer form (runTimeline with no options, over descentBeats()): the same stall, the same
 *       demand. (Fails until the build gives the plain-timer form the cap too.)
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
  finish();
}
