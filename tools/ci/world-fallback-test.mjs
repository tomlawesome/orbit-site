/*
 * Test for #93 batch 2, the worker (ADR-0004 6b.7 test W4, with 6b.4), written from the specification alone: the fallback to
 * the page path, one mechanism for every failure. install.js runs on the stub page (door-stub.mjs) with `draw: "worker"`, the
 * page's `Worker` a fake class (installWorldWorker) that records what it is posted and says what a case tells it to, the
 * clock virtual (so the 5000 ms and the 20 s are waited for in no real time). After a fallback: the pad's `.orbitgl` is a
 * fresh element with the same class and attributes (a handed-over canvas can never give the page a context again), the old
 * one out of the page, the `slot` still before it, terminate() has been called, a bake() that was pending resolves only
 * after the page world's own bake (its galaxy painted), and a later draw is on the fresh canvas's context while the
 * worker is told nothing.
 *
 *   node tools/ci/world-fallback-test.mjs
 *
 *   error     the worker fires `error` before `up`: the fallback, and the console says `install: drawn on the page: the
 *             worker failed to load`
 *   upFalse   `up { ok: false, why }`: the same, and the line carries `why`
 *   dead      `dead` 1 s into a dive: the page world draws the next frame and the shot's `settled` still resolves
 *             (control: a worker that does not die: no fallback, the same shot settles)
 *   late      under the automatic rule, no `up` within 5000 ms: the fallback at 5000 (not before)
 *   forced    under draw=worker there is no cap: still waiting at 20 s; a late `up` is then taken
 *   lost      `lost` after `up`: `webglcontextlost` dispatched on the placeholder, the pad `flat`, no fallback
 *   remote    createRemoteWorld alone: aside() resolves false once it has fallen back; destroy() posts `destroy`
 *
 * One fresh Node process a case.
 */
import { bootInstallPage, settled, namedUniforms, fakeWorldWorkers, installWorldWorker, sceneAt, childMain, runCase, chk, finish } from "./door-stub.mjs";

const INSTALL = "../../assets/js/install.js", REMOTE = "../../assets/js/remote-world.js";
const plainError = (message) => Object.assign(new Error(message), { plain: true });
const guarded = (cases) => Object.fromEntries(Object.entries(cases).map(([k, f]) => [k, async () => { try { return await f(); } catch (e) { if (e && e.plain) return { none: e.message }; throw e; } }]));
const noWorker = "no worker was made (install.js never made one with `new Worker`)";

async function boot(o = {}) {
  const b = await bootInstallPage({ draw: "worker", ...o });
  b.paints = namedUniforms(b.page);
  /* the galaxy's strips painted on the page's gl: a page world's bake paints four, one a frame, before it can resolve */
  b.strips = 0;
  b.page.glBase.scissor = () => { b.strips++; };
  b.ww = installWorldWorker(b, fakeWorldWorkers(o.auto));
  const { createInstall } = await import(INSTALL);
  const pad = b.pad("installpad");
  const ring = createInstall(pad);
  const mark = { done: false, value: undefined, strips: -1 };
  Object.assign(b, { padEl: pad, ring, mark });
  b.draws = () => b.paints.filter((u) => u[0] === "uniform3fv" && u[1] === "uCam").length;
  b.start = () => {
    const p = ring.prepare();
    p.catch(() => {});
    /* the pending bake(): when it resolves, how much of the page world's own bake has reached the GPU */
    ring.baked.then((v) => { mark.done = true; mark.value = v; mark.strips = b.strips; });
    return p;
  };
  return b;
}
/* what the page is like after a fallback (or before one) */
function state(b, w) {
  const pad = b.padEl, kids = pad.children;
  const live = kids.filter((c) => c instanceof b.dom.Canvas && /\borbitgl\b/.test(c.className));
  const cur = live[0] ?? null;
  const at = cur ? kids.indexOf(cur) : -1;
  return {
    orbitgl: live.length, fresh: !!cur && cur !== pad.canvas, notHandedOver: !!cur && cur.transferred === false,
    sameClass: !!cur && cur.className === pad.canvas.className, sameAttrs: !!cur && cur.getAttribute("aria-hidden") === "true",
    oldGone: pad.canvas.parentNode === null, slotBefore: at > 0 && !(kids[at - 1] instanceof b.dom.Canvas),
    terminated: w.terminated, lines: b.page.lines.filter((l) => /install: drawn (in a worker|on the page)/.test(l)), ctx: cur ? cur.gotContext : null,
    handedOverInPage: kids.filter((c) => c instanceof b.dom.Canvas && c.transferred).length,
  };
}

async function failure(how) {
  const b = await boot({ auto: { up: null } });
  b.start();
  await b.clock.advance(100);
  const w = b.ww.first();
  if (!w) return { none: noWorker };
  const out = { before: { pending: !b.mark.done, ...state(b, w) } };
  if (how === "error") w.fail("the worker script failed to run");
  else w.say({ type: "up", ok: false, why: "no float colour buffers" });
  await b.clock.advance(30000, () => b.mark.done);
  await b.clock.advance(200);
  out.after = state(b, w);
  out.bake = { done: b.mark.done, value: b.mark.value, strips: b.mark.strips };
  const posted0 = w.posted.length, paints0 = b.draws();
  const still = await settled(b.ring.still(0.5, 7, null, false), b.clock);
  out.later = { still: still.state === "resolved" ? still.value : still.state, painted: b.draws() - paints0, posted: w.posted.length - posted0, late: w.late.length, ctx: state(b, w).ctx };
  return out;
}

async function dive(dies) {
  const b = await boot();
  await settled(b.start(), b.clock);
  await b.clock.advance(2000);
  const w = b.ww.first();
  if (!w) return { none: noWorker };
  const shot = { done: false };
  b.ring.form(sceneAt()).then(() => { shot.done = true; });
  await b.clock.advance(1000, () => w.of("view").length >= 10);
  await b.clock.advance(1000);
  const viewsBefore = w.of("view").length, paints0 = b.draws();
  if (dies) w.say({ type: "dead", why: "the world threw outside a frame" });
  await b.clock.advance(30000, () => shot.done);
  await b.clock.advance(200);
  const s = state(b, w);
  return {
    viewsBefore, settled: shot.done, painted: b.draws() - paints0, viewsAfter: w.of("view").length - viewsBefore, late: w.late.length,
    terminated: s.terminated, fresh: s.fresh, lines: s.lines, ctx: s.ctx,
  };
}

async function late(forced) {
  const b = await boot(forced ? { draw: "worker", auto: { up: null } } : { draw: undefined, auto: { up: null } });
  b.start();
  const out = { snaps: {} };
  const t0 = performance.now();
  await b.clock.advance(0);
  const w = b.ww.first();
  if (!w) return { none: noWorker };
  const snap = async (ms, name) => { await b.clock.advance(ms - (performance.now() - t0)); out.snaps[name] = { ...state(b, w), baked: b.mark.done }; };
  await snap(4500, "4500");
  await snap(5600, "5600");
  if (forced) {
    await snap(20000, "20000");
    w.say({ type: "up", ok: true });
    await b.clock.advance(5000, () => b.mark.done);
    out.afterUp = { ...state(b, w), baked: b.mark.done, value: b.mark.value };
  }
  return out;
}

async function lost() {
  const b = await boot();
  await settled(b.start(), b.clock);
  await b.clock.advance(2000);
  const w = b.ww.first();
  if (!w) return { none: noWorker };
  let heard = 0;
  b.padEl.canvas.addEventListener("webglcontextlost", () => { heard++; });
  const before = { flat: b.padEl.classes.has("flat") };
  w.say({ type: "lost" });
  await b.clock.advance(500);
  const s = state(b, w);
  return { before, flat: b.padEl.classes.has("flat"), heard, terminated: s.terminated, sameCanvas: s.orbitgl === 1 && !s.fresh, handedOver: b.padEl.canvas.transferred, lines: s.lines };
}

async function remote(how) {
  const b = await bootInstallPage({ draw: "worker" });
  b.ww = installWorldWorker(b, fakeWorldWorkers(how === "fell" ? { up: null } : {}));
  let mod;
  try { mod = await import(REMOTE); } catch (e) { throw (e && e.code === "ERR_MODULE_NOT_FOUND" && String(e.message).includes("remote-world.js") ? plainError("assets/js/remote-world.js does not exist yet") : e); }
  if (typeof mod.createRemoteWorld !== "function") throw plainError("assets/js/remote-world.js exports no createRemoteWorld");
  const canvas = b.pad().canvas;
  const world = mod.createRemoteWorld(canvas, { tag: "install", small: true }, { worker: () => b.ww.make() });
  await b.clock.advance(100);
  const w = b.ww.first();
  if (!w) return { none: "createRemoteWorld made no worker" };
  if (how === "fell") w.fail("the worker script failed to run");
  else if (how === "destroy") { world.destroy(); await b.clock.advance(50); return { destroys: w.of("destroy").length }; }
  const a = await settled(world.aside(), b.clock, 10000);
  return { state: a.state, value: a.state === "resolved" ? a.value : null };
}

const CASES = guarded({
  error: () => failure("error"), upFalse: () => failure("up"), dead: () => dive(true), alive: () => dive(false),
  late: () => late(false), forced: () => late(true), lost, fell: () => remote("fell"), destroy: () => remote("destroy"),
});

if (process.argv[2] === "--child") await childMain(CASES);

const show = (x) => JSON.stringify(x);
const run = (n) => runCase(import.meta.url, n);
/* (a line said through the door's note() ends with how long after opening: that is not part of the reason) */
const reason = (lines) => { for (const l of lines) { const m = /install: drawn on the page: (.+)$/.exec(l); if (m) return m[1].replace(/:\s*\d+ ms( after opening)?$/, "").trim(); } return null; };

for (const [name, what, why] of [["error", "the worker fires `error` before `up`", "the worker failed to load"], ["upFalse", "`up { ok: false, why }`", "no float colour buffers"]]) {
  const r = run(name);
  chk(`W4 ${what}: (precondition) before the failure the bake is waiting, the .orbitgl is the original and nothing is terminated`, r, (r) => [r.before.pending && r.before.terminated === 0 && r.before.fresh === false && r.before.orbitgl === 1, show(r.before)]);
  chk(`W4 ${what}: .orbitgl is a fresh element with the same class and attributes, not handed over, the old one out of the page`, r, (r) => [r.after.orbitgl === 1 && r.after.fresh && r.after.notHandedOver && r.after.sameClass && r.after.sameAttrs && r.after.oldGone && r.after.handedOverInPage === 0, show(r.after)]);
  chk(`W4 ${what}: the slot is still before it`, r, (r) => [r.after.slotBefore, `slot before the new canvas: ${r.after.slotBefore}`]);
  chk(`W4 ${what}: terminate() is called`, r, (r) => [r.after.terminated === 1, `terminate() calls ${r.after.terminated}`]);
  chk(`W4 ${what}: the pending bake() resolves, true, only after the page world's own bake (its galaxy's four strips painted)`, r, (r) => [r.bake.done && r.bake.value === true && r.bake.strips >= 4, `resolved ${r.bake.done} with ${show(r.bake.value)}, galaxy strips painted on the page by then ${r.bake.strips}`]);
  chk(`W4 ${what}: the console says \`install: drawn on the page: ${why}\``, r, (r) => { const rs = reason(r.after.lines); return [!!rs && rs.includes(why) && (name === "error" ? rs.trim() === why : true), `lines ${show(r.after.lines)}`]; });
  chk(`W4 ${what}: a later draw is on the fresh canvas's webgl2 context, and the worker is told nothing`, r, (r) => [r.later.still === true && r.later.painted === 1 && r.later.posted === 0 && r.later.late === 0 && r.later.ctx === "webgl2", `still ${show(r.later.still)}, drawn on the page ${r.later.painted} time(s), posted to the worker ${r.later.posted}, after terminate ${r.later.late}, context ${show(r.later.ctx)}`]);
}
{
  const r = run("dead"), c = run("alive");
  chk("W4 (control) a worker that does not die: the dive settles, nothing is drawn on the page, no fallback", c, (c) => [c.settled && c.painted === 0 && c.terminated === 0 && !c.fresh && c.viewsAfter > 0, `settled ${c.settled}, page draws ${c.painted}, terminate() calls ${c.terminated}, fresh canvas ${c.fresh}, views posted since ${c.viewsAfter}`]);
  chk("W4 `dead` mid-dive: the worker is terminated, the canvas replaced, and the console says `install: drawn on the page: <why>`", r, (r) => [r.terminated === 1 && r.fresh && !!reason(r.lines), `terminate() calls ${r.terminated}, fresh canvas ${r.fresh}, lines ${show(r.lines)}`]);
  chk("W4 ... the page world draws the next frames (on the fresh canvas's context) and the worker is posted nothing more", r, (r) => [r.viewsBefore >= 10 && r.painted >= 1 && r.ctx === "webgl2" && r.late === 0, `views before ${r.viewsBefore}, page draws since ${r.painted}, context ${show(r.ctx)}, posted after terminate ${r.late}`]);
  chk("W4 ... and the shot's `settled` still resolves", r, (r) => [r.settled === true, `the dive settled: ${r.settled}`]);
}
{
  const r = run("late");
  chk("W4 under the automatic rule, no `up` in 4500 ms is not yet a fallback", r, (r) => [r.snaps["4500"].terminated === 0 && !r.snaps["4500"].fresh && !r.snaps["4500"].baked && !reason(r.snaps["4500"].lines), show(r.snaps["4500"])]);
  chk("W4 ... by 5600 ms it is: terminated, the canvas fresh, the old one out", r, (r) => { const s = r.snaps["5600"]; return [s.terminated === 1 && s.fresh && s.oldGone && s.notHandedOver && s.handedOverInPage === 0, show(s)]; });
  chk("W4 ... the line says `no answer in 5000 ms`", r, (r) => [/no answer in 5000 ms/.test(reason(r.snaps["5600"].lines) || ""), `lines ${show(r.snaps["5600"].lines)}`]);
}
{
  const r = run("forced");
  chk("W4 under draw=worker there is no cap: at 20 s the worker is still waited for", r, (r) => { const s = r.snaps["20000"]; return [s.terminated === 0 && !s.fresh && !s.baked && !reason(s.lines) && s.handedOverInPage === 1, show(s)]; });
  chk("W4 ... and a late `up` is taken: the bake resolves with the worker still the drawing", r, (r) => [r.afterUp.baked === true && r.afterUp.value === true && r.afterUp.terminated === 0 && !r.afterUp.fresh, show(r.afterUp)]);
}
{
  const r = run("lost");
  chk("W4 (precondition) the pad is not flat before the context is lost", r, (r) => [r.before.flat === false, show(r.before)]);
  chk("W4 `lost` after `up`: `webglcontextlost` is dispatched on the placeholder (the listener hears it), the pad goes flat", r, (r) => [r.heard === 1 && r.flat === true, `heard ${r.heard}, flat ${r.flat}`]);
  chk("W4 ... and it is no fallback: the worker is not terminated, the placeholder stays, nothing is said of the page", r, (r) => [r.terminated === 0 && r.sameCanvas && r.handedOver === true && !reason(r.lines), `terminate() calls ${r.terminated}, same canvas ${r.sameCanvas}, handed over ${r.handedOver}, lines ${show(r.lines)}`]);
}
{
  const r = run("fell");
  chk("W4 createRemoteWorld: aside() resolves false once it has fallen back before `up`", r, (r) => [r.state === "resolved" && r.value === false, `aside() is ${r.state}${r.state === "resolved" ? " with " + show(r.value) : ""}`]);
  const d = run("destroy");
  chk("W4 createRemoteWorld: destroy() posts `destroy` to the worker", d, (d) => [d.destroys === 1, `destroy messages ${d.destroys}`]);
}
finish();
