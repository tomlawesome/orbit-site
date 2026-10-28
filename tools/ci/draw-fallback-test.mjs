/*
 * Test for #85 batch 2, the worker (ADR-0004 6a.4 and 6a.7, test D4), written from the specification alone: the
 * fallback to the page path, one mechanism for every failure. Through assets/door/index.js alone on the stub page
 * (door-stub.mjs), the worker a fake class given as `drawWorker`, the clock virtual (so the 5000 ms and the 20 s are
 * waited for in no real time at all). After a fallback: #warp is a fresh element with the same id, class and
 * attributes (the handed-over one can never give the page a context again) and the old one is out of the page, the
 * handed-over #warpgl is gone, terminate() has been called, the warm() that was waiting resolves after the page
 * engine's own warm (its world's shaders made on the page's gate), and a later fly() draws on the new canvas's 2D
 * context while the worker is told nothing.
 *
 *   node tools/ci/draw-fallback-test.mjs
 *
 *   error     the worker fires `error` before `up`: the fallback, and the console says `flight: drawn on the page: ...`
 *   upFalse   `up { ok: false, why }`: the same, and the line carries `why`
 *   dead      `dead` after `up`, 2 s into a live fly(UP): the page engine goes on from where the worker was (the last
 *             frame it paints is at the moment the flight would have ended, not 2 s after it) and begins within a few
 *             frames; the `land` hook fires at the same beat as in the control (a worker that does not die)
 *   late      under the automatic rule, no `up` within 5000 ms: the fallback at 5000 (not before), and the line says
 *             `no answer in 5000 ms`
 *   forced    under draw=worker there is no cap: still waiting, no fallback, at 20 s; the late `up` is then taken
 *
 * One fresh Node process a case.
 */
import { bootWorkerPage, drawnLines, DRAW_OPS, childMain, runCase, chk, finish } from "./door-stub.mjs";

const track = (promise) => { const t = { done: false, at: -1 }; promise.then(() => { t.done = true; t.at = performance.now(); }, () => { t.done = true; t.at = performance.now(); }); return t; };

/* what the page is like after a fallback (or before one) */
function state(b, warm) {
  const cur = b.dom.find("warp");
  const drawOps = cur ? cur.ops.filter((o) => DRAW_OPS.has(o.op)) : [];
  return {
    terminated: b.host.list.reduce((n, w) => n + w.terminated, 0),
    fresh: !!cur && cur !== b.dom.warp && cur.transferred === false,
    sameId: !!cur && cur.id === "warp",
    sameClass: !!cur && cur.className === b.dom.warp.className,
    sameAttrs: !!cur && cur.getAttribute("aria-hidden") === "true" && cur.getAttribute("data-role") === "flight",
    oldGone: b.dom.warp.parentNode === null,
    handedOverInPage: b.dom.inPage().filter((c) => c.transferred).length,
    warmDone: warm.done,
    lines: drawnLines(b.page),
    drawOps: drawOps.length,
    ctx: cur ? cur.gotContext : null,
  };
}

async function failure(how) {
  const b = await bootWorkerPage({ draw: "worker", auto: { up: null } });
  const warm = track(b.journey.warm({ prove: false }));
  await b.clock.advance(100);
  const w = b.host.first();
  if (!w) return { none: "no worker was made (drawWorker never called)" };
  const out = { before: { done: warm.done, terminated: w.terminated, fresh: b.dom.find("warp") !== b.dom.warp } };
  if (how === "error") w.fail("the worker script failed to run");
  else w.say({ type: "up", ok: false, why: "no float colour buffers" });
  await b.clock.advance(30000, () => warm.done);
  await b.clock.advance(100);
  out.after = state(b, warm);
  out.shadersAtWarm = b.page.shaders.length;
  const ops0 = out.after.drawOps, starts0 = w.of("start").length;
  b.journey.fly(b.door.UP, { at: 2600 });
  await b.clock.advance(200);
  const s = state(b, warm);
  out.later = { drawn: s.drawOps - ops0, starts: w.of("start").length - starts0, late: w.late.filter((m) => m && m.type === "start").length, fresh: s.fresh };
  return out;
}

async function flightScenario(dies) {
  const b = await bootWorkerPage({ draw: "worker" });
  const warm = track(b.journey.warm({ prove: false }));
  await b.clock.advance(30000, () => warm.done);
  const w = b.host.first();
  if (!w) return { none: "no worker was made (drawWorker never called)" };
  const lands = [];
  b.journey.fly(b.door.UP, { on: { land: () => lands.push(performance.now()) } });
  await b.clock.advance(20000, () => w.of("start").length >= 1);
  const startAt = w.postedAt[w.posted.indexOf(w.of("start")[0])];
  await b.clock.advance(2000);
  const deadAt = performance.now();
  if (dies) w.say({ type: "dead", why: "the world threw outside a frame" });
  await b.clock.advance(12000);
  const cur = b.dom.find("warp");
  const ops = cur ? cur.ops.filter((o) => DRAW_OPS.has(o.op) && o.at >= deadAt) : [];
  return {
    startAt, deadAt, lands, terminated: w.terminated, fresh: !!cur && cur !== b.dom.warp,
    firstOp: ops.length ? ops[0].at : null, lastOp: ops.length ? ops[ops.length - 1].at : null, nOps: ops.length,
    lines: drawnLines(b.page),
  };
}

async function late(forced) {
  const b = await bootWorkerPage(forced ? { draw: "worker", auto: { up: null } } : { auto: { up: null } });
  const warm = track(b.journey.warm({ prove: false }));
  const out = { snaps: {} };
  const at = async (ms, name) => { await b.clock.advance(ms - (performance.now() - t0)); out.snaps[name] = state(b, warm); };
  const t0 = performance.now();
  await b.clock.advance(0);
  const w = b.host.first();
  if (!w) return { none: "no worker was made (drawWorker never called)" };
  await at(4500, "4500");
  await at(5600, "5600");
  if (forced) {
    await at(20000, "20000");
    w.say({ type: "up", ok: true, renderer: "stub" });
    await b.clock.advance(5000, () => warm.done);
    out.afterUp = state(b, warm);
  }
  return out;
}

const CASES = { error: () => failure("error"), upFalse: () => failure("up"), dead: () => flightScenario(true), control: () => flightScenario(false), late: () => late(false), forced: () => late(true) };

if (process.argv[2] === "--child") await childMain(CASES);

const show = (x) => JSON.stringify(x);
const run = (n) => runCase(import.meta.url, n);
const reason = (lines) => { for (const l of lines) { const m = /flight: drawn on the page: (.+)$/.exec(l); if (m) return m[1]; } return null; };

for (const [name, what, why] of [["error", "the worker fires `error` before `up`", null], ["upFalse", "`up { ok: false, why }`", "no float colour buffers"]]) {
  const r = run(name);
  chk(`D4 ${what}: (precondition) before the failure warm() is waiting, #warp is the original and nothing is terminated`, r, (r) => [r.before.done === false && r.before.terminated === 0 && r.before.fresh === false, show(r.before)]);
  chk(`D4 ${what}: #warp is a fresh element with the same id, class and attributes, the old one out of the page`, r, (r) => [r.after.fresh && r.after.sameId && r.after.sameClass && r.after.sameAttrs && r.after.oldGone, show(r.after)]);
  chk(`D4 ${what}: no handed-over canvas (#warp or #warpgl) is left in the page`, r, (r) => [r.after.handedOverInPage === 0, `handed-over canvases still in the page: ${r.after.handedOverInPage}`]);
  chk(`D4 ${what}: terminate() is called`, r, (r) => [r.after.terminated === 1, `terminate() calls ${r.after.terminated}`]);
  chk(`D4 ${what}: the pending warm() resolves, after the page engine's own warm (its shaders made on the page's gate)`, r, (r) => [r.after.warmDone === true && r.shadersAtWarm > 0, `resolved ${r.after.warmDone}, shaders compiled on the page ${r.shadersAtWarm}`]);
  chk(`D4 ${what}: the console says \`flight: drawn on the page: <why>\`${why ? " with the why" : ""}`, r, (r) => { const rs = reason(r.after.lines); return [!!rs && (!why || rs.includes(why)), `lines ${show(r.after.lines)}`]; });
  chk(`D4 ${what}: a later fly() draws on the new canvas's 2D context, and the worker is told nothing`, r, (r) => [r.later.drawn > 0 && r.later.starts === 0 && r.later.late === 0 && r.after.ctx === "2d", `drew ${r.later.drawn} ops on the new canvas, started the worker ${r.later.starts}, posted after terminate ${r.later.late}, context ${show(r.after.ctx)}`]);
}
{
  const r = run("dead"), c = run("control");
  chk("D4 `dead` after `up`: the worker is terminated and #warp replaced", r, (r) => [r.terminated === 1 && r.fresh, `terminate() calls ${r.terminated}, fresh #warp ${r.fresh}`]);
  chk("D4 ... the console says `flight: drawn on the page: <why>`", r, (r) => [!!reason(r.lines), `lines ${show(r.lines)}`]);
  chk("D4 ... the page engine goes on from where the flight was: it paints from the next few frames", r, (r) => [r.firstOp !== null && r.firstOp - r.deadAt <= 200, `died at ${r.deadAt}, first paint at ${r.firstOp}`]);
  chk("D4 ... and its skip is the elapsed journey time: the last frame it paints is when the flight would have ended (start + 5200 ms), not 2 s later", r, (r) => {
    const end = r.startAt + 5200;
    return [r.lastOp !== null && r.lastOp >= end - 50 && r.lastOp <= end + 100, `flight started at ${r.startAt}, the page's last paint at ${r.lastOp} (want about ${end})`];
  });
  chk("D4 (control) a worker that does not die: the `land` hook fires once", c, (c) => [c.lands.length === 1, `land fired ${c.lands.length} times`]);
  chk("D4 ... the `land` hook still fires, once, at its beat (as in the control)", r, (r) => [r.lands.length === 1 && Math.abs(r.lands[0] - c.lands[0]) <= 40, `land at ${show(r.lands)}, control at ${show(c.lands)}`]);
}
{
  const r = run("late");
  chk("D4 under the automatic rule, no `up` in 4500 ms is not yet a fallback", r, (r) => [r.snaps["4500"].terminated === 0 && !r.snaps["4500"].fresh && !r.snaps["4500"].warmDone, show(r.snaps["4500"])]);
  chk("D4 ... by 5600 ms it is: terminated, #warp fresh, the pending warm() resolved", r, (r) => { const s = r.snaps["5600"]; return [s.terminated === 1 && s.fresh && s.sameId && s.oldGone && s.handedOverInPage === 0, show(s)]; });
  chk("D4 ... the line says `no answer in 5000 ms`", r, (r) => [r.snaps["5600"].lines.some((l) => /flight: drawn on the page: .*no answer in 5000 ms/.test(l)), `lines ${show(r.snaps["5600"].lines)}`]);
}
{
  const r = run("forced");
  chk("D4 under draw=worker there is no cap: at 20 s the worker is still waited for", r, (r) => { const s = r.snaps["20000"]; return [s.terminated === 0 && !s.fresh && !s.warmDone && s.handedOverInPage === 2 && !reason(s.lines), show(s)]; });
  chk("D4 ... and a late `up` is taken: the warm() resolves with the worker still the drawing", r, (r) => [r.afterUp.warmDone === true && r.afterUp.terminated === 0 && !r.afterUp.fresh, show(r.afterUp)]);
}
finish();
