/*
 * Test for #93 batch 1, the seam (ADR-0004 6b.7 test W7), written from the specification alone: main.js's rule for how
 * long the first light's ring waits for the shaders, lifted out as a pure function so it can be tested (main.js starts
 * the page when it is imported, so it cannot be imported here):
 *
 *   ringWaits({ maintenance, saveData, aside, drawnAside, door3d, firstVisit }) -> { wait, ms }
 *
 * `aside` is the door's compilesAside() (the browser compiles shaders off the page's thread); `drawnAside` is the door's
 * drawnAside() (the flight is drawn in a worker); `wait` is whether the ring runs on until the compiles are done, `ms`
 * the cap on that wait (read only when `wait` is true). It is exported from assets/js/ring.js (a site module: the lint
 * keeps the door's entry the only thing it imports from the folder).
 *
 *   drawnAside, aside false, door3d false      not a first visit: no wait. A first visit: wait, 8000 ms
 *   drawnAside, door3d true                    wait, 9000 ms, on every visit: the live door compiles on the page
 *   drawnAside false                           as today in every case (the table below is main.js's rule as it stands:
 *                                              asideHere = maintenance || saveData || aside;
 *                                              wait = !maintenance && (firstVisit || !asideHere);
 *                                              ms = asideHere ? 9000 : 8000)
 *   maintenance, save-data                     as today whatever the worker says (maintenance: never a wait)
 *
 *   node tools/ci/world-ring-test.mjs
 *
 * Pure: no page, no process per case. A missing module or export is said in plain words.
 */
const MODULE = "../../assets/js/ring.js";
let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};

let ringWaits = null, why = null;
try {
  const mod = await import(MODULE);
  if (typeof mod.ringWaits !== "function") why = `assets/js/ring.js exports no ringWaits function (it exports ${JSON.stringify(Object.keys(mod))})`;
  else ringWaits = mod.ringWaits;
} catch (e) {
  why = /Cannot find module|ERR_MODULE_NOT_FOUND/.test(String(e && (e.code || e.message))) ? "assets/js/ring.js does not exist yet (the seam lifts ringWaits out of main.js into it)" : `assets/js/ring.js could not be imported: ${e && e.message}`;
}

const base = { maintenance: false, saveData: false, aside: false, drawnAside: false, door3d: false, firstVisit: false };
const ask = (o) => {
  const input = { ...base, ...o }, copy = JSON.stringify(input);
  const out = ringWaits(input);
  if (JSON.stringify(input) !== copy) throw new Error("ringWaits changed the object it was given");
  return out;
};
const show = (o) => JSON.stringify(o);
/* a case: its name, the inputs, and what is wanted: wait always, ms when it waits (and when it is given) */
function expect(name, o, wait, ms) {
  if (!ringWaits) { check(name, false, why); return; }
  let got;
  try { got = ask(o); } catch (e) { check(name, false, `ringWaits threw: ${e && e.message}`); return; }
  const okWait = !!got && got.wait === wait;
  const okMs = !wait || ms === undefined || (got && got.ms === ms);
  check(name, okWait && okMs, `${show(o)} gave ${show(got)} (want wait ${wait}${wait && ms !== undefined ? `, ms ${ms}` : ""})`);
}

/* the flight is drawn in a worker, nothing compiles on the page */
expect("W7 worker, not a first visit: no wait", { drawnAside: true, firstVisit: false }, false);
expect("W7 worker, a first visit: wait, 8 s", { drawnAside: true, firstVisit: true }, true, 8000);
/* the live door compiles on the page, so today's shape stands */
expect("W7 worker with the live door, not a first visit: wait, 9 s", { drawnAside: true, door3d: true, firstVisit: false }, true, 9000);
expect("W7 worker with the live door, a first visit: wait, 9 s", { drawnAside: true, door3d: true, firstVisit: true }, true, 9000);
/* the page path: as today in every case (maintenance, save-data, aside, door3d, first visit: all 32) */
for (let i = 0; i < 32; i++) {
  const o = { maintenance: !!(i & 1), saveData: !!(i & 2), aside: !!(i & 4), door3d: !!(i & 8), firstVisit: !!(i & 16), drawnAside: false };
  const asideHere = o.maintenance || o.saveData || o.aside;
  expect(`W7 page path as today: ${Object.entries(o).filter(([k, v]) => v && k !== "drawnAside").map(([k]) => k).join(" + ") || "nothing set"}`,
    o, !o.maintenance && (o.firstVisit || !asideHere), asideHere ? 9000 : 8000);
}
/* the worker with the rest: maintenance never waits, save-data and the compiles-aside tell wait only on a first visit */
expect("W7 worker, maintenance: no wait even on a first visit", { drawnAside: true, maintenance: true, firstVisit: true }, false);
expect("W7 worker, maintenance with the live door: no wait", { drawnAside: true, maintenance: true, door3d: true, firstVisit: true }, false);
expect("W7 worker, save-data, not a first visit: no wait", { drawnAside: true, saveData: true, firstVisit: false }, false);
expect("W7 worker, save-data, a first visit: wait", { drawnAside: true, saveData: true, firstVisit: true }, true);
expect("W7 worker where the browser also compiles aside, not a first visit: no wait", { drawnAside: true, aside: true, firstVisit: false }, false);
expect("W7 worker where the browser also compiles aside, a first visit: wait", { drawnAside: true, aside: true, firstVisit: true }, true);
/* the answer is the same asked twice */
if (!ringWaits) check("W7 the answer does not depend on being asked before", false, why);
else {
  const o = { drawnAside: true, firstVisit: true };
  check("W7 the answer does not depend on being asked before", show(ask(o)) === show(ask(o)), `${show(ask(o))} then ${show(ask(o))}`);
}
process.exit(failed ? 1 : 0);
