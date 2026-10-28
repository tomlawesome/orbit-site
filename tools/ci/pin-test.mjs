/*
 * Test for #23 ("a host can pin the journey at a moment"), as a Node test on a virtual clock (ADR-0005 section 5),
 * written from the issue's specification and the browser test it replaces.
 *
 * journey.fly(profile, { at }) and journey.descend({ at }) take `at`, milliseconds into the journey, and start there:
 * the beats before `at` count as already passed. Unpinned, the ascent lands (hook `land`, body class `bare`) 4800 ms
 * in and the descent's farewell (hook `farewell`, class `farewell`) comes 5350 ms in, the dusk (hook `surface`, class
 * `showdusk`) before it. Pinned past them, they arrive at once; pinned before them, they are not skipped. The controls
 * show the unpinned journey has not got there by 2.5 s, and does get there later.
 *
 *   node tools/ci/pin-test.mjs
 *
 * No dependencies and no browser. Each scenario runs in a fresh Node process (this file again, as `--child`) against
 * the stub page in door-stub.mjs; the door and the journey are made through assets/door/index.js alone, as a host
 * makes them. Every wait is on the virtual clock (installClock), so nothing depends on how fast the machine runs:
 * times below are the page's own milliseconds from the call.
 */
import { INDEX, installPage, installClock, childMain, runCase, check, finish, errOf } from "./door-stub.mjs";

/* how soon "at once" is, on the page's clock: far below the 1800 ms a pin at 3000 leaves before the landing */
const SOON = 1000;
const CONTROL = 2500;          /* an unpinned journey watched this long has not landed (4800) or said farewell (5350) */
const LONG = 7000;             /* ... and watched this long it has */

const SCENARIOS = {
  "fly-5000": ["fly", 5000, SOON],
  "fly-none": ["fly", undefined, LONG],
  "fly-3000": ["fly", 3000, SOON],
  "descend-5400": ["descend", 5400, SOON],
  "descend-none": ["descend", undefined, LONG],
  "descend-3700": ["descend", 3700, SOON],
};

/* the child: one journey, started; when each hook fired and each body class first showed, in ms from the call */
async function pin(mode, at, watch) {
  const page = installPage();
  const clock = installClock();
  const door = await import(INDEX);
  const d = door.createDoor({ flags: {} });
  door.openChores();
  const journey = d.journey({ ...page.journeyOptions(), on: { dusk() {}, farewell() {} } });
  const t0 = clock.now();
  const hooks = {};
  const names = mode === "fly" ? ["release", "land", "settled"] : ["released", "surface", "farewell"];
  const on = Object.fromEntries(names.map((n) => [n, () => { hooks[n] ??= clock.now() - t0; }]));
  const given = typeof at === "number" ? { at } : {};
  const logFrom = page.bodyLog.length;
  let error = null;
  try {
    if (mode === "fly") journey.fly(door.UP, { ...given, title: "Test", subtitle: "pin", on });
    else journey.descend({ ...given, title: "Test", subtitle: "pin", onto: "dusk", from: door.UP, on });
  } catch (e) { error = String(e && e.message || e); }
  /* the classes present at CONTROL, then at the end */
  await clock.advance(Math.min(watch, CONTROL));
  const atControl = [...page.bodyClasses];
  if (watch > CONTROL) await clock.advance(watch - CONTROL);
  const classes = {};
  for (const e of page.bodyLog.slice(logFrom)) if (e.op === "add") classes[e.name] ??= e.at - t0;
  const reduced = typeof journey.reduced === "function" ? journey.reduced() : journey.reduced;
  return { mode, at: at ?? null, hooks, classes, atControl, now: [...page.bodyClasses], reduced, error };
}

if (process.argv[2] === "--child") {
  await childMain(Object.fromEntries(Object.entries(SCENARIOS).map(([k, v]) => [k, () => pin(...v)])));
}

const before = (t, ms) => t !== undefined && t < ms;
const run = (name) => {
  const r = runCase(import.meta.url, name, 60000);
  const base = !r.error && !r.reduced;
  const seen = `hooks ${JSON.stringify(r.hooks)}; classes first seen ${JSON.stringify(r.classes)}; at the end ${JSON.stringify(r.now)}${r.reduced ? "; in reduced motion" : ""}${errOf(r)}`;
  return { r, base, seen };
};

{
  const { r, base, seen } = run("fly-5000");
  check("P1 fly pinned at 5000 (past the landing): the release hook has fired (a beat before the pin)", base && r.hooks.release !== undefined, seen);
  check("P1 ... the land hook fires at once", base && before(r.hooks.land, SOON), `${seen} (want land before ${SOON} ms)`);
  check("P1 ... the body has class bare at once, and keeps it", base && before(r.classes.bare, SOON) && r.now.includes("bare"), seen);
  check("P1 ... the flight's canvas is off again (no class showwarp)", base && !r.now.includes("showwarp"), seen);
}
{
  const { r, base, seen } = run("fly-none");
  check("P2 fly unpinned (control): by 2.5 s the land hook has not fired and the body is not bare", base && !before(r.hooks.land, CONTROL + 1) && !(r.atControl || []).includes("bare") && !before(r.classes.bare, CONTROL + 1), seen);
  check("P2 ... and it does land, later (4800 ms in)", base && r.hooks.land !== undefined && r.hooks.land > CONTROL && r.hooks.land < LONG && r.classes.bare > CONTROL, seen);
}
{
  const { r, base, seen } = run("fly-3000");
  check("P3 fly pinned at 3000 (before the landing): the release hook has fired", base && before(r.hooks.release, SOON), seen);
  check("P3 ... the landing is not skipped: no land hook at once", base && !before(r.hooks.land, SOON), seen);
}
{
  const { r, base, seen } = run("descend-5400");
  check("P4 descend pinned at 5400 (past the farewell): the released hook has fired (a beat before the pin)", base && r.hooks.released !== undefined, seen);
  check("P4 ... the surface hook has fired (the dusk came up)", base && before(r.hooks.surface, SOON), seen);
  check("P4 ... the farewell hook fires at once", base && before(r.hooks.farewell, SOON), `${seen} (want farewell before ${SOON} ms)`);
  check("P4 ... the body has class farewell at once, and showdusk", base && before(r.classes.farewell, SOON) && r.now.includes("farewell") && r.now.includes("showdusk"), seen);
}
{
  const { r, base, seen } = run("descend-none");
  check("P5 descend unpinned (control): by 2.5 s no farewell hook, no farewell class, no surface hook", base && !before(r.hooks.farewell, CONTROL + 1) && !before(r.hooks.surface, CONTROL + 1) && !(r.atControl || []).includes("farewell"), seen);
  check("P5 ... and the farewell does come, later (5350 ms in)", base && r.hooks.farewell !== undefined && r.hooks.farewell > CONTROL && r.hooks.farewell < LONG, seen);
}
{
  const { r, base, seen } = run("descend-3700");
  check("P6 descend pinned at 3700 (past the dusk, before the farewell): the surface hook has fired and the body has showdusk", base && before(r.hooks.surface, SOON) && before(r.classes.showdusk, SOON), seen);
  check("P6 ... the farewell is still to come: no farewell hook at once", base && !before(r.hooks.farewell, SOON), seen);
}
finish();
