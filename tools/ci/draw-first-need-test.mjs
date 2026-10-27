/*
 * Test for #85 batch 1, the seam (ADR-0004 6a.4 and 6a.6, test D1), written from the specification alone: the journey
 * makes its engine at the first need, not at mount. A canvas that already has a context can never be handed to a
 * worker, so `journey()` takes no context of `#warp`; the first `warm`, `warmDocs`, `fly` or `descend` takes its 2D
 * context; `destroy()` before any of them takes none. This is the page path every later case (D2-D5, batch 2) is the
 * control against, so no `drawWorker` is given here.
 *
 *   node tools/ci/draw-first-need-test.mjs
 *
 *   mount      journey() and 10 s of virtual time: #warp asked for no context
 *   warm       then warm(): #warp's 2D context taken
 *   warmDocs   then warmDocs(): taken
 *   fly        then a pinned fly(UP, { at: 2600 }): taken, and the flight painted on it
 *   descend    then a pinned descend({ onto: "dusk", at: 1800 }): taken, and painted on
 *   destroy    journey() then destroy() before any need, and 10 s more: no context, no error
 *
 * The journey is reached through assets/door/index.js alone, as a host does, on the stub page (door-stub.mjs). Its
 * `#warp` is a canvas that records every getContext asked of it and every call on the 2D context it hands out. Each
 * case runs in a fresh Node process; virtual clock only (installClock), so nothing waits on the runner.
 */
import { INDEX, installPage, installClock, any, childMain, runCase, check, finish, errOf } from "./door-stub.mjs";

/* #warp: records the kinds of context asked of it, and every call made on its 2D context */
function warpCanvas() {
  const rec = { asked: [], ops: 0 };
  const c = {
    width: 300, height: 150, style: {}, dataset: {}, id: "warp", className: "",
    parentNode: { insertBefore() {}, replaceChild() {}, appendChild() {} },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute: () => null,
    getContext(kind) { rec.asked.push(String(kind)); return kind === "2d" ? ctx : any(); },
  };
  const ctx = new Proxy({}, {
    get: (t, k) => (k === "canvas" ? c : k in t ? t[k] : typeof k === "symbol" ? undefined : () => { rec.ops++; return any(); }),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return { canvas: c, rec };
}

async function scenario(need) {
  const page = installPage();
  const clock = installClock();
  const door = await import(INDEX);
  const d = door.createDoor({ typingWait: 0, flags: {} });
  door.openChores();
  const warp = warpCanvas();
  const journey = d.journey({ ...page.journeyOptions(), canvas: warp.canvas });
  await clock.advance(0);
  const out = { atMount: [...warp.rec.asked] };
  await clock.advance(10000);
  out.afterWait = [...warp.rec.asked];
  const swallow = (p) => { if (p && typeof p.catch === "function") p.catch(() => {}); };
  if (need === "warm") swallow(journey.warm());
  else if (need === "warmDocs") swallow(journey.warmDocs());
  else if (need === "fly") swallow(journey.fly(door.UP, { at: 2600 }));
  else if (need === "descend") swallow(journey.descend({ onto: "dusk", at: 1800 }));
  else if (need === "destroy") journey.destroy();
  await clock.advance(0);
  out.afterNeed = [...warp.rec.asked];
  out.opsAfterNeed = warp.rec.ops;
  await clock.advance(10000);
  out.afterAll = [...warp.rec.asked];
  out.ops = warp.rec.ops;
  return out;
}

const CASES = Object.fromEntries(["mount", "warm", "warmDocs", "fly", "descend", "destroy"].map((n) => [n, () => scenario(n)]));

if (process.argv[2] === "--child") await childMain(CASES);

const took2d = (list) => (list || []).includes("2d");
const show = (r) => `at journey() ${JSON.stringify(r.atMount)}, 10 s later ${JSON.stringify(r.afterWait)}, after the need ${JSON.stringify(r.afterNeed)}, at the end ${JSON.stringify(r.afterAll)}; 2D calls ${r.ops}${errOf(r)}`;

{
  const r = runCase(import.meta.url, "mount");
  check("D1 journey() takes no context of #warp at mount", !r.error && r.atMount.length === 0, show(r));
  check("D1 ... nor in the 10 s after it, with no need asked", !r.error && r.afterAll.length === 0, show(r));
}
for (const need of ["warm", "warmDocs"]) {
  const r = runCase(import.meta.url, need);
  check(`D1 ${need}(): (precondition) no context before it`, !r.error && r.afterWait.length === 0, show(r));
  check(`D1 the first ${need}() takes #warp's 2D context`, !r.error && took2d(r.afterNeed), show(r));
}
for (const need of ["fly", "descend"]) {
  const r = runCase(import.meta.url, need);
  check(`D1 pinned ${need}: (precondition) no context before it`, !r.error && r.afterWait.length === 0, show(r));
  check(`D1 a pinned ${need} takes #warp's 2D context`, !r.error && took2d(r.afterNeed), show(r));
  check(`D1 ... and the pinned ${need} is painted on it`, !r.error && r.ops > 0, show(r));
}
{
  const w = runCase(import.meta.url, "warm");
  const r = runCase(import.meta.url, "destroy");
  check("D1 control for destroy: the same mount with warm() does take the 2D context", !w.error && took2d(w.afterAll), show(w));
  check("D1 destroy() before any need takes no context and throws nothing", !r.error && r.afterAll.length === 0, show(r));
}
finish();
