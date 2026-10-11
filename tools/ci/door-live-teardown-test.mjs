/*
 * Tests for the live door's teardown (R4 of review round 1, batch fix/m2-door), written from the specification alone:
 * the live door (door3d.js, `?door3d`), taken down by dawn.destroy(), stops acting:
 *   - its frame loop stops (no further draw calls on the context);
 *   - its resize and visibilitychange listeners and its MutationObservers (and ResizeObservers) are removed;
 *   - a door destroyed before it was shown never calls followDoor (voyage.js doorIsLive() stays false);
 *   - after a lost context it makes no GL call, and stays down.
 * Controls: shown and not destroyed, the live door has registered listeners and observers and has drawn.
 *
 *   node tools/ci/door-live-teardown-test.mjs
 *
 * No dependencies and no browser; each case runs in a fresh Node process (this file again, as `--child`) against the
 * stub page in door-stub.mjs, the live door mounted through the dawn (flags door3d) as a host does, on a virtual clock.
 * LIMIT: the fake context cannot make the capability probe say ok, so level() stays 0 and the live door runs as its
 * "lean" one, which draws one frame and then idles: a frame LOOP is not reachable here. The loop checks (no draw call
 * and no GL call after destroy or after a lost context, when the page is nudged by resize and visibilitychange) hold
 * for the lean door, and would catch a loop that is left running only if one runs.
 */
import { installPage, installClock, mountLive, listenerCounts, childMain, runCase, check, finish, errOf } from "./door-stub.mjs";

const CASES = {
  async "shown-control"() { return shown({ destroy: false }); },
  async "shown-destroyed"() { return shown({ destroy: true }); },
  async "start-then-destroy"() { return early("start-then-destroy"); },
  async "destroy-then-start"() { return early("destroy-then-start"); },
  async "lost"() { return lostCase(); },
};

async function show(page, clock) {
  const m = await mountLive(page);
  m.dawn.start();
  m.dawn.light({ firstVisit: false, aside: true, onLit() {}, onOpen() {}, after() {} });
  m.dawn.live.compile();
  await clock.advance(3000);
  m.dawn.live.start();
  await clock.advance(3000);
  return m;
}
/* the page nudged: it is resized, hidden and shown again, then time passes */
async function nudge(page, clock) {
  page.resize(1000, 700);
  page.setHidden(true); await clock.advance(500); page.setHidden(false);
  await clock.advance(3000);
}

async function shown({ destroy }) {
  const page = installPage();
  const clock = installClock();
  const m = await show(page, clock);
  const out = { drewWhileShown: page.draws, registered: listenerCounts(page), baseline: m.baseline, observing: m.ob.active() };
  if (destroy) {
    m.dawn.destroy();
    await clock.advance(100);
    out.afterDestroy = listenerCounts(page);
    out.observingAfterDestroy = m.ob.active();
    const draws = page.draws, calls = page.glCalls;
    await nudge(page, clock);
    out.drawsAfter = page.draws - draws;
    out.glCallsAfter = page.glCalls - calls;
  }
  return out;
}

async function early(how) {
  const page = installPage();
  const clock = installClock();
  const m = await mountLive(page);
  const voyage = await import("../../assets/door/voyage.js");
  m.dawn.live.compile();
  await clock.advance(1000);
  if (how === "start-then-destroy") { m.dawn.live.start(); m.dawn.destroy(); }
  else { m.dawn.destroy(); try { m.dawn.live.start(); } catch { /* a destroyed door may refuse */ } }
  await clock.advance(5000);
  const draws = page.draws;
  await nudge(page, clock);
  return { doorIsLive: voyage.doorIsLive(), after: listenerCounts(page), baseline: m.baseline, observing: m.ob.active(), drawsAfter: page.draws - draws };
}

async function lostCase() {
  const page = installPage();
  const clock = installClock();
  const m = await show(page, clock);
  const before = { draws: page.draws };
  page.loseContext();
  await clock.advance(100);
  const calls = page.glCalls;
  await nudge(page, clock);
  const whileLost = { glCalls: page.glCalls - calls, glWhileLost: page.glWhileLost };
  page.lost = false;                                          /* the context is back, but the live door is not remounted */
  const draws = page.draws;
  await nudge(page, clock);
  return { before, whileLost, drawsAfterRestore: page.draws - draws };
}

if (process.argv[2] === "--child") await childMain(CASES);

{
  const c = runCase(import.meta.url, "shown-control");
  check("control: a shown live door has drawn, and has registered resize/visibility listeners or observers",
    !c.error && c.drewWhileShown > 0 && (c.registered.resize > c.baseline.resize || c.registered.visibility > c.baseline.visibility) && c.observing >= 1,
    `draws ${c.drewWhileShown}; listeners ${JSON.stringify(c.registered)} (before mounting ${JSON.stringify(c.baseline)}); observers on ${c.observing}${errOf(c)}`);
  const r = runCase(import.meta.url, "shown-destroyed");
  check("R4: after dawn.destroy() the resize and visibilitychange listeners are back to what they were before mounting",
    !r.error && r.afterDestroy.resize <= r.baseline.resize && r.afterDestroy.visibility <= r.baseline.visibility, `after destroy ${JSON.stringify(r.afterDestroy)}, before mounting ${JSON.stringify(r.baseline)}${errOf(r)}`);
  check("R4: after dawn.destroy() no MutationObserver or ResizeObserver is still observing", !r.error && r.observingAfterDestroy === 0, `${r.observingAfterDestroy} still observing (were ${r.observing})${errOf(r)}`);
  check("R4: after dawn.destroy() the live door draws no more, whatever happens to the page (no draw call)", !r.error && r.drawsAfter === 0, `${r.drawsAfter} draw call(s) after destroy, resize and a hide/show${errOf(r)}`);
  check("R4: ... and makes no GL call at all", !r.error && r.glCallsAfter === 0, `${r.glCallsAfter} GL call(s) after destroy${errOf(r)}`);
}
for (const how of ["start-then-destroy", "destroy-then-start"]) {
  const r = runCase(import.meta.url, how);
  check(`R4 (${how}): a live door destroyed before it was shown never becomes the world's door (doorIsLive() false)`, !r.error && r.doorIsLive === false, `doorIsLive() ${r.doorIsLive}${errOf(r)}`);
  check(`R4 (${how}): and leaves no listener or observer behind`, !r.error && r.after.resize <= r.baseline.resize && r.after.visibility <= r.baseline.visibility && r.observing === 0, `listeners ${JSON.stringify(r.after)} (before mounting ${JSON.stringify(r.baseline)}), observers on ${r.observing}${errOf(r)}`);
  check(`R4 (${how}): and draws nothing when the page is nudged`, !r.error && r.drawsAfter === 0, `${r.drawsAfter} draw call(s)${errOf(r)}`);
}
{
  const r = runCase(import.meta.url, "lost");
  check("R4: after a lost context the live door makes no GL call while lost", !r.error && r.whileLost.glWhileLost === 0, `${r.whileLost?.glWhileLost} GL call(s) made while lost (${r.whileLost?.glCalls} in all after the loss)${errOf(r)}`);
  check("R4: ... and stays down: no draw when the context is back and the page is nudged, until a remount", !r.error && r.drawsAfterRestore === 0, `${r.drawsAfterRestore} draw call(s) after the context came back${errOf(r)}`);
}
finish();
