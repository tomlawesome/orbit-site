/*
 * Test for the phone's tilt (assets/js/tilt.js, #45). onTilt(fn) follows the phone's tilt as a pointer would move:
 * fn(x, y), each -1..1, a turn of about twenty degrees for the whole way, measured from where the phone rests (which
 * follows the held reading slowly, over a few seconds), whichever way up the screen is. It listens only where the
 * phone gives its tilt freely: a coarse pointer, no reduced motion, DeviceOrientationEvent present and no
 * requestPermission to call (iOS is not asked). It returns how to stop; the last to stop lets the sensor rest.
 *
 *   node tools/ci/site-tilt-test.mjs
 *
 * No dependencies and no browser. tilt.js reads the page's media queries once, when it loads, so each case runs in a
 * fresh Node process (this file again, as `--child`) against a stub page whose window records its listeners and
 * whose clock the case sets.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TILT = "../../assets/js/tilt.js";

if (process.argv[2] === "--child") {
  const spec = JSON.parse(process.argv[3]);
  const page = { added: [], removed: [], asked: 0, listeners: new Map() };
  let clock = 5000;
  globalThis.matchMedia = (q) => ({
    matches: q.includes("pointer: coarse") ? !!spec.coarse : q.includes("reduced-motion") ? !!spec.still : false,
    addEventListener() {},
  });
  if (spec.doe) {
    globalThis.DeviceOrientationEvent = class {};
    if (spec.ask) globalThis.DeviceOrientationEvent.requestPermission = async () => { page.asked++; return "granted"; };
  }
  globalThis.window = globalThis;
  globalThis.screen = spec.noScreenOrientation ? {} : { orientation: { angle: spec.angle ?? 0 } };
  if (spec.windowOrientation != null) globalThis.orientation = spec.windowOrientation;
  Object.defineProperty(globalThis, "performance", { value: { now: () => clock }, configurable: true });
  globalThis.addEventListener = (type, fn) => {
    page.added.push(type);
    if (!page.listeners.has(type)) page.listeners.set(type, new Set());
    page.listeners.get(type).add(fn);
  };
  globalThis.removeEventListener = (type, fn) => { page.removed.push(type); page.listeners.get(type)?.delete(fn); };
  /* the phone turns: every deviceorientation listener the page holds hears it */
  const tilt = (beta, gamma, at) => {
    if (at != null) clock = at;
    for (const fn of page.listeners.get("deviceorientation") ?? []) fn({ beta, gamma });
  };
  const listening = () => page.listeners.get("deviceorientation")?.size ?? 0;
  const r3 = (v) => Math.round(v * 1000) / 1000 + 0;   /* + 0: -0 reads as 0 */

  const out = {};
  const { onTilt } = await import(TILT);
  const heard = [];
  const stop = onTilt((x, y) => heard.push([r3(x), r3(y)]));
  out.stopIsFunction = typeof stop === "function";
  out.listening = listening();

  if (spec.run === "gated") {
    tilt(10, 30, 6000); tilt(-40, 50, 7000);
    out.heard = heard;
    out.asked = page.asked;
    let threw = null;
    try { stop(); stop(); } catch (e) { threw = e.message; }
    out.stopThrew = threw;
    out.removed = page.removed.length;
  } else if (spec.run === "orientation") {
    /* the first reading is where it rests; with the clock still, the rest does not move, so a reading is exactly
       its turn from there over 20 degrees */
    tilt(0, 0); tilt(4, 2);
    out.heard = heard;
  } else if (spec.run === "follow") {
    tilt(10, 5, 1000);                    /* rests here: the middle */
    tilt(10, 15, 1100);                   /* 100 ms later, turned 10 degrees across */
    tilt(10, 5 + 200, 1100);              /* far past twenty degrees: the edge */
    tilt(10 - 200, 5, 1100);              /* and the other way, down */
    tilt(null, 30, 1100); tilt(30, undefined, 1100);   /* no reading: nothing heard */
    out.heard = heard.slice();
    /* a new grip held still settles back to the middle over a few seconds */
    for (let t = 1200; t <= 40000; t += 100) tilt(30, 40, t);
    out.settled = heard[heard.length - 1];
    /* a long gap counts as 200 ms at most: the rest moves 5% of the way, not all of it */
    heard.length = 0;
    tilt(30, 40 + 20, 40000);             /* turned 20 degrees across: the edge, at once */
    tilt(30, 40 + 20, 40000 + 60000);     /* a minute later: still near the edge */
    out.afterGap = heard.slice();
  } else if (spec.run === "teardown") {
    const other = [];
    const stop2 = onTilt((x, y) => other.push([r3(x), r3(y)]));
    out.listeningTwo = listening();
    out.addedTwo = page.added.filter((t) => t === "deviceorientation").length;
    tilt(0, 0); tilt(4, 2);
    out.bothHeard = [heard.length, other.length];
    stop();
    out.listeningAfterFirstStop = listening();
    tilt(4, 2);
    out.afterFirstStop = [heard.length, other.length];
    stop2();
    out.listeningAfterLastStop = listening();
    out.removedAfterLastStop = page.removed.filter((t) => t === "deviceorientation").length;
    stop2();                              /* stopping again changes nothing */
    out.removedAfterAgain = page.removed.filter((t) => t === "deviceorientation").length;
    /* listening again starts from a fresh rest: the first reading is the middle, wherever the old rest was */
    const again = [];
    onTilt((x, y) => again.push([r3(x), r3(y)]));
    out.listeningAgain = listening();
    tilt(10, 10);
    out.again = again;
  }
  console.log(JSON.stringify(out));
  process.exit(0);
}

let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const show = JSON.stringify;
const me = fileURLToPath(import.meta.url);
const runCase = (spec) => {
  const r = spawnSync(process.execPath, [me, "--child", JSON.stringify(spec)], { encoding: "utf8", timeout: 30000 });
  const line = (r.stdout || "").trim().split("\n").pop();
  try { return JSON.parse(line); } catch { return { error: `child exit ${r.status}: ${(r.stderr || r.stdout || "").trim().split("\n").slice(-3).join(" | ")}` }; }
};

/* where the phone must not be followed: nothing listens, nothing is heard, the stop is harmless */
const android = { coarse: true, still: false, doe: true };
for (const [label, spec] of [
  ["a mouse (fine pointer)", { ...android, coarse: false }],
  ["reduced motion", { ...android, still: true }],
  ["no DeviceOrientationEvent", { ...android, doe: false }],
  ["iOS (requestPermission to call)", { ...android, ask: true }],
]) {
  const o = runCase({ ...spec, run: "gated" });
  if (o.error) { check(`${label}: case ran`, false, o.error); continue; }
  check(`${label}: the sensor is not listened to`, o.listening === 0, `${o.listening} deviceorientation listener(s) (want 0)`);
  check(`${label}: nothing is heard when the phone turns`, same(o.heard, []), `heard ${show(o.heard)} (want [])`);
  check(`${label}: a stop is still given, and stopping is harmless`, o.stopIsFunction && o.stopThrew === null && o.removed === 0, `function ${o.stopIsFunction}, threw ${o.stopThrew}, ${o.removed} removal(s)`);
  if (spec.ask) check(`${label}: the phone is never asked for permission`, o.asked === 0, `requestPermission called ${o.asked} time(s) (want 0)`);
}

/* the control: a phone that gives its tilt freely is listened to */
{
  const o = runCase({ ...android, run: "follow" });
  if (o.error) check("Android: case ran", false, o.error);
  else {
    check("Android: the sensor is listened to", o.listening === 1, `${o.listening} deviceorientation listener(s) (want 1)`);
    const [first, turned, edge, down, ...rest] = o.heard;
    check("the first reading is where it rests: the middle", same(first, [0, 0]), `got ${show(first)} (want [0,0])`);
    /* 100 ms of 4000: the rest moves 2.5% toward 15, to 5.25; (15 - 5.25) / 20 = 0.4875 */
    check("a turn across moves x by the turn over 20 degrees, less the slow follow", same(turned, [0.488, 0]), `got ${show(turned)} (want [0.488,0])`);
    check("past twenty degrees is the edge (x clamped to 1)", edge?.[0] === 1, `got ${show(edge)} (want x 1)`);
    check("the other way is the other edge (y clamped to -1)", down?.[1] === -1, `got ${show(down)} (want y -1)`);
    check("a reading without beta or gamma is not heard", rest.length === 0, `${rest.length} extra call(s) (want 0)`);
    check("a new grip held still settles back to the middle", Math.abs(o.settled?.[0]) < 0.01 && Math.abs(o.settled?.[1]) < 0.01, `after 39 s held still: ${show(o.settled)} (want within 0.01 of [0,0])`);
    /* 20 degrees from rest: x = 1 at once; a minute later the rest has moved 200/4000 = 5% of the way: (20 - 1) / 20 = 0.95 */
    check("a long gap moves the rest at most 200 ms' worth", same(o.afterGap, [[1, 0], [0.95, 0]]), `got ${show(o.afterGap)} (want [[1,0],[0.95,0]])`);
  }
}

/* whichever way up the screen is: beta 4 (toward you), gamma 2 (to the right) */
for (const [label, spec, want] of [
  ["upright (angle 0)", { angle: 0 }, [0.1, 0.2]],
  ["turned left (angle 90)", { angle: 90 }, [0.2, -0.1]],
  ["turned right (angle 270)", { angle: 270 }, [-0.2, 0.1]],
  ["turned right (angle -90)", { angle: -90 }, [-0.2, 0.1]],
  ["upside down (angle 180)", { angle: 180 }, [-0.1, -0.2]],
  ["a full turn more (angle 450 is 90)", { angle: 450 }, [0.2, -0.1]],
  ["no screen.orientation, window.orientation 90", { noScreenOrientation: true, windowOrientation: 90 }, [0.2, -0.1]],
  ["no orientation at all (upright)", { noScreenOrientation: true }, [0.1, 0.2]],
]) {
  const o = runCase({ ...android, ...spec, run: "orientation" });
  if (o.error) { check(`${label}: case ran`, false, o.error); continue; }
  check(`${label}: the turn is given across and down the screen`, same(o.heard, [[0, 0], want]), `got ${show(o.heard)} (want ${show([[0, 0], want])})`);
}

/* two followers share one sensor; the last to stop lets it rest; listening again starts afresh */
{
  const o = runCase({ ...android, run: "teardown" });
  if (o.error) check("teardown: case ran", false, o.error);
  else {
    check("two followers share one listener", o.listeningTwo === 1 && o.addedTwo === 1, `${o.listeningTwo} listening, ${o.addedTwo} added (want 1, 1)`);
    check("both followers hear the tilt", same(o.bothHeard, [2, 2]), `heard ${show(o.bothHeard)} times (want [2,2])`);
    check("the first to stop leaves the sensor to the other", o.listeningAfterFirstStop === 1 && same(o.afterFirstStop, [2, 3]), `${o.listeningAfterFirstStop} listening, heard ${show(o.afterFirstStop)} (want 1, [2,3])`);
    check("the last to stop lets the sensor rest", o.listeningAfterLastStop === 0 && o.removedAfterLastStop === 1, `${o.listeningAfterLastStop} listening, ${o.removedAfterLastStop} removed (want 0, 1)`);
    check("stopping again removes nothing more", o.removedAfterAgain === 1, `${o.removedAfterAgain} removal(s) (want 1)`);
    check("listening again listens", o.listeningAgain === 1, `${o.listeningAgain} listening (want 1)`);
    check("listening again starts from where the phone is now", same(o.again, [[0, 0]]), `first reading gave ${show(o.again)} (want [[0,0]]; the old rest would give [0.5,0.5])`);
  }
}

process.exit(failed ? 1 : 0);
