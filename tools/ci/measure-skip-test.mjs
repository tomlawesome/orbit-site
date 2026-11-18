/*
 * Test for #155 (the install's dive: its sharpness measured during the load), written from the specification alone: the
 * measure is gone. Nothing times the dive's scene on load, for the install's world (tag install) and the information's
 * (tag info) alike, on the worker path and on the page path; the dive starts at the default part, 0.6, whatever a worker
 * might answer; and the code nothing reaches any more is deleted. install.js runs on the stub page (door-stub.mjs) with
 * the page's `Worker` a fake class (installWorldWorker) that records what it is posted and answers what the case says.
 *
 *   node tools/ci/measure-skip-test.mjs
 *
 *   M1   worker path, default flags: after prepare() has settled and 3 s more, the worker was posted no `measure`
 *   M2   page path, same: the world's measure is never called, no chore tagged "measure" is queued, and the only drawing
 *        is the touch's two views, then one `finish`
 *   M3   `prepared` resolves true although the worker never answers a `measure` (measured: null), and with measured
 *        [40, 80] and [1, 2] alike: the same value, and no hang
 *   M4   with `bake` false, `prepared` resolves false, and a second prepare() starts afresh (unchanged)
 *   M5   the view drawn at the dive's start (still(0.1, 0, DOT), its `part`) is exactly 0.6, whatever measured says
 *   M6   once baked, `touch` posts two views, the parts 0.6 then 1, then `finish`
 *   M7   the governor, in the dive: it starts from 0.6; drew.dt 50 ends at 0.55 or above and below 0.6, 16.7 holds,
 *        10 rises above 0.6 and to at most 1
 *   M8   `settings.flags = { measure: true }` changes nothing: M1 and M5 hold, for the information's world too
 *   M10  the source: install.js has no calibrate; world.js, remote-world.js and world-worker.js have no measure;
 *        main.js has no measure flag; voyage.js still has calibrate and door3d.js measure (comments are not read)
 *
 * One fresh Node process a case, on the virtual clock; nothing depends on how fast the runner is.
 */
import { readFileSync } from "node:fs";
import { bootInstallPage, settled, infoWorld, fakeWorldWorkers, installWorldWorker, sceneAt, DOT, runCase, runCaseSpied, childMain, chk, check, finish } from "./door-stub.mjs";

const INSTALL = "../../assets/js/install.js", CHORES = "../../assets/door/chores.js";
const noWorker = "no worker was made (install.js never made one with `new Worker`)";
const types = (w) => w.posted.map((m) => m && m.type);
const near = (a, b) => typeof a === "number" && Math.abs(a - b) < 1e-9;

async function boot(o = {}) {
  const b = await bootInstallPage({ draw: "worker", ...o });
  b.ww = installWorldWorker(b, fakeWorldWorkers(o.auto));
  const { createInstall } = await import(INSTALL);
  b.install = async (id = "installpad", info = false) => {
    const pad = b.pad(id);
    let opts;
    if (info) { globalThis.screen = { width: 390, height: 844 }; const i = await infoWorld(); opts = { ...i, world: { ...i.world, sky: 1024 } }; }
    return { pad, ring: createInstall(pad, opts) };
  };
  return b;
}
/* the part of the view drawn at the dive's start, as the worker was posted it */
async function startPart(b, w, ring) {
  await settled(ring.still(0.1, 0, { ...DOT }), b.clock);
  return w.of("view").at(-1)?.view?.part ?? null;
}

/* the worker path: prepare(), 3 s more, then the dive's start (M1, M3, M5, M8) */
async function dive({ auto, flags, info } = {}) {
  const b = await boot({ auto, flags });
  const { ring } = await b.install(info ? "infopad" : "installpad", info);
  const s = await settled(ring.prepare(), b.clock);
  await b.clock.advance(3000);
  const w = b.ww.first();
  if (!w) return { none: noWorker };
  const out = { prepared: s.state === "resolved" ? s.value : s.state, measures: w.of("measure").length, types: types(w), cloneErrors: w.cloneErrors };
  out.tag = w.of("hello")[0]?.tag ?? null;
  out.part = await startPart(b, w, ring);
  out.measuresAfter = w.of("measure").length;
  return out;
}

/* M4: a bake that fails */
async function bakeFalse() {
  const b = await boot({ auto: { baked: { ok: false } } });
  const { ring } = await b.install();
  const p1 = ring.prepare();
  const s = await settled(p1, b.clock);
  await b.clock.advance(100);
  const w = b.ww.first();
  if (!w) return { none: noWorker };
  const bakes1 = w.of("bake").length;
  const p2 = ring.prepare();
  const s2 = await settled(p2, b.clock);
  return { first: s.state === "resolved" ? s.value : s.state, bakes1, fresh: p2 !== p1, second: s2.state === "resolved" ? s2.value : s2.state, bakes2: w.of("bake").length, measures: w.of("measure").length };
}

/* M6: the touch, once baked */
async function touchCase() {
  const b = await boot();
  const { ring } = await b.install();
  await settled(ring.prepare(), b.clock);
  await b.clock.advance(3000);
  const w = b.ww.first();
  if (!w) return { none: noWorker };
  const t = types(w);
  const i = t.findIndex((x, j) => x === "view" && t[j + 1] === "view" && t[j + 2] === "finish");
  return { types: t, at: i, parts: i >= 0 ? [w.posted[i].view?.part, w.posted[i + 1].view?.part] : null, finishes: t.filter((x) => x === "finish").length };
}

/* M7: the dive, the worker answering every `view` with drew { dt } */
async function govern(D) {
  const b = await boot({ auto: { drew: { dt: () => { counts.drews++; return D; }, ms: 1 } } });
  const counts = { drews: 0 };
  const { ring } = await b.install();
  await settled(ring.prepare(), b.clock);
  await b.clock.advance(3000);
  const w = b.ww.first();
  if (!w) return { none: noWorker };
  globalThis.requestAnimationFrame = (f) => globalThis.setTimeout(() => f(performance.now()), 16.7);
  const out = { counts, before: await startPart(b, w, ring) };
  const shot = { done: false };
  ring.form(sceneAt()).then(() => { shot.done = true; });
  await b.clock.advance(30000, () => shot.done);
  await b.clock.advance(3000);
  ring.stop();
  out.settled = shot.done;
  out.after = await startPart(b, w, ring);
  out.measures = w.of("measure").length;
  return out;
}

/* the page path: the real world is seen (world-spy.mjs) and its measure and finish counted, from the moment it is made */
async function pagePath({ flags } = {}) {
  const spy = (globalThis.__worldSpy = { views: [], world: null });
  const seen = { measure: 0, finish: [], hadMeasure: null };
  let real = null;
  Object.defineProperty(spy, "real", {
    configurable: true, get: () => real,
    set(v) {
      real = v;
      seen.hadMeasure = typeof v.measure === "function";
      if (seen.hadMeasure) { const m = v.measure; v.measure = (...a) => { seen.measure++; return m.apply(v, a); }; }
      const f = v.finish; v.finish = (...a) => { seen.finish.push(spy.views.length); return f.apply(v, a); };
    },
  });
  const b = await bootInstallPage({ draw: "page", flags });
  const { createInstall } = await import(INSTALL);
  const { choresNow } = await import(CHORES);
  const ring = createInstall(b.pad("installpad"));
  const p = ring.prepare();
  let state = "pending", value;
  p.then((v) => { state = "resolved"; value = v; }, () => { state = "rejected"; });
  let measureChore = false;
  const look = () => { if (choresNow().queued.some((t) => String(t).split("+").includes("measure"))) measureChore = true; };
  look();
  for (let i = 0; i < 700; i++) { await b.clock.advance(5); look(); }
  return {
    prepared: state === "resolved" ? value : state, hadWorld: real !== null, hadMeasure: seen.hadMeasure, measureCalls: seen.measure, measureChore,
    views: spy.views.map((v) => v.part), finishAt: seen.finish, workers: b.workers.length,
    part: await (async () => { await settled(ring.still(0.1, 0, { ...DOT }), b.clock); return spy.views.at(-1)?.part ?? null; })(),
  };
}

const CASES = {
  default: () => dive(), mid: () => dive({ auto: { measured: [10, 20] } }), silent: () => dive({ auto: { measured: null } }),
  slow: () => dive({ auto: { measured: [40, 80] } }), fast: () => dive({ auto: { measured: [1, 2] } }),
  flag: () => dive({ flags: { measure: true } }), flagSlow: () => dive({ flags: { measure: true }, auto: { measured: [40, 80] } }),
  info: () => dive({ info: true }), infoFlag: () => dive({ info: true, flags: { measure: true }, auto: { measured: [40, 80] } }),
  bakeFalse, touch: touchCase, slowDrew: () => govern(50), steadyDrew: () => govern(16.7), fastDrew: () => govern(10),
  page: () => pagePath(), pageFlag: () => pagePath({ flags: { measure: true } }),
};

if (process.argv[2] === "--child") await childMain(CASES);

const show = (x) => JSON.stringify(x);
const run = (n) => runCase(import.meta.url, n);
const runPage = (n) => runCaseSpied(import.meta.url, n);

/* the code of a source file: block comments and whole-line or trailing // comments dropped (a // after a colon is a url) */
const codeOf = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

/* M1 */
{
  const r = run("default");
  chk("M1 worker path: the worker is posted no `measure` (prepare() settled, then 3 s)", r, (r) => [r.measures === 0 && r.measuresAfter === 0 && !r.types.includes("measure"), `measure posted ${r.measures} time(s); message types ${show(r.types)}`]);
  chk("M1 ... and the install still bakes, then touches (`bake`, two views, `finish`)", r, (r) => [r.prepared === true && r.types.includes("bake") && r.types.filter((t) => t === "finish").length === 1, `prepared ${show(r.prepared)}; types ${show(r.types)}`]);
}
/* M2 */
{
  const r = runPage("page");
  chk("M2 page path: the world's measure is never called, and no chore tagged \"measure\" is queued", r, (r) => [r.hadWorld && r.measureCalls === 0 && r.measureChore === false, `world made ${r.hadWorld}, measure present ${r.hadMeasure}, calls ${r.measureCalls}, \"measure\" chore queued ${r.measureChore}`]);
  chk("M2 ... the only draws are the touch's two views (parts 0.6 then 1), then one `finish` (before the dive's own still)", r, (r) => [r.prepared === true && show(r.views.slice(0, 2)) === show([0.6, 1]) && r.finishAt.length === 1 && r.finishAt[0] === 2 && r.workers === 0, `prepared ${show(r.prepared)}, view parts ${show(r.views)}, finish after ${show(r.finishAt)} view(s), workers ${r.workers}`]);
}
/* M3 */
{
  const rs = { silent: run("silent"), slow: run("slow"), fast: run("fast") };
  for (const [k, what] of [["silent", "never answers a `measure`"], ["slow", "answers measured [40, 80]"], ["fast", "answers measured [1, 2]"]]) {
    chk(`M3 \`prepared\` resolves true when the worker ${what}: no hang`, rs[k], (r) => [r.prepared === true, `prepared ${show(r.prepared)}`]);
  }
}
/* M4 */
{
  const r = run("bakeFalse");
  chk("M4 with a bake that fails, `prepared` resolves false (nothing waits on a measure)", r, (r) => [r.first === false && r.measures === 0, `prepared ${show(r.first)}, measure posted ${r.measures}`]);
  chk("M4 ... and a second prepare() starts afresh: a new promise, a second `bake`", r, (r) => [r.fresh && r.bakes1 === 1 && r.bakes2 === 2 && r.second === false, `fresh ${r.fresh}, bakes ${r.bakes1} then ${r.bakes2}, second prepared ${show(r.second)}`]);
}
/* M5 */
{
  const rs = { mid: run("mid"), slow: run("slow"), fast: run("fast"), silent: run("silent") };
  for (const [k, ms] of [["mid", "[10, 20]"], ["slow", "[40, 80]"], ["fast", "[1, 2]"], ["silent", "no answer"]]) {
    chk(`M5 the view drawn at the dive's start has part exactly 0.6 (a worker's measured ${ms})`, rs[k], (r) => [near(r.part, 0.6), `part ${show(r.part)}`]);
  }
  const p = runPage("page");
  chk("M5 ... and on the page path", p, (p) => [near(p.part, 0.6), `part ${show(p.part)}`]);
}
/* M6 */
{
  const r = run("touch");
  chk("M6 once baked, `touch` posts two views, the parts 0.6 then 1, then `finish`", r, (r) => [r.at >= 0 && r.finishes === 1 && near(r.parts?.[0], 0.6) && near(r.parts?.[1], 1), `types ${show(r.types)}, parts ${show(r.parts)}`]);
}
/* M7 */
{
  const A = run("slowDrew"), B = run("steadyDrew"), C = run("fastDrew");
  chk("M7 the dive starts from 0.6 (not a measured figure), the dive settles, and the worker answered enough `drew`s (dt 50)", A, (r) => [near(r.before, 0.6) && r.settled === true && r.counts.drews >= 10, `before ${show(r.before)}, settled ${r.settled}, drew ${r.counts.drews} time(s)`]);
  chk("M7 drew.dt 50: the part ends at 0.55 or above, and below 0.6", A, (r) => [r.after !== null && r.after >= 0.55 - 1e-9 && r.after < 0.6 - 1e-9, `part ${show(r.before)} -> ${show(r.after)}`]);
  chk("M7 drew.dt 16.7: the part holds at 0.6, from 0.6", B, (r) => [near(r.before, 0.6) && near(r.after, 0.6) && r.counts.drews >= 10, `part ${show(r.before)} -> ${show(r.after)}, drew ${r.counts.drews} time(s)`]);
  chk("M7 drew.dt 10: from 0.6 the part rises above 0.6, to at most 1", C, (r) => [near(r.before, 0.6) && r.after > 0.6 + 1e-9 && r.after <= 1 + 1e-9 && r.counts.drews >= 10, `part ${show(r.before)} -> ${show(r.after)}, drew ${r.counts.drews} time(s)`]);
  chk("M7 ... and no `measure` is posted in any of the three", A, (r) => [r.measures === 0 && B.measures === 0 && C.measures === 0, `measure posted ${r.measures}, ${B.measures}, ${C.measures}`]);
}
/* M8 */
{
  const r = run("flag"), s = run("flagSlow"), pf = runPage("pageFlag");
  chk("M8 `settings.flags = { measure: true }`: M1 holds, the worker is posted no `measure`", r, (r) => [r.measures === 0 && r.measuresAfter === 0, `measure posted ${r.measures}`]);
  chk("M8 ... and M5 holds: the dive starts at exactly 0.6 (a worker's measured [40, 80] too)", s, (s) => [near(s.part, 0.6) && s.measures === 0 && near(r.part, 0.6), `part ${show(r.part)} and ${show(s.part)}; measure posted ${s.measures}`]);
  chk("M8 ... and on the page path the world's measure is never called", pf, (p) => [p.hadWorld && p.measureCalls === 0 && p.measureChore === false && near(p.part, 0.6), `calls ${p.measureCalls}, chore ${p.measureChore}, part ${show(p.part)}`]);
  const i = run("info"), f = run("infoFlag");
  chk("M8 the information's world (tag info): the worker is posted no `measure`, and the dive starts at 0.6", i, (i) => [i.tag === "info" && i.measures === 0 && i.measuresAfter === 0 && near(i.part, 0.6) && i.prepared === true, `tag ${show(i.tag)}, measure posted ${i.measures}, part ${show(i.part)}, prepared ${show(i.prepared)}`]);
  chk("M8 ... with the flag too (and measured [40, 80])", f, (f) => [f.tag === "info" && f.measures === 0 && f.measuresAfter === 0 && near(f.part, 0.6), `tag ${show(f.tag)}, measure posted ${f.measures}, part ${show(f.part)}`]);
}
/* M10 */
{
  const has = (file, re) => re.test(codeOf(file));
  check("M10 install.js has no `calibrate`, no `.measure(`, no chore tagged \"measure\"", !has("assets/js/install.js", /\bcalibrate\b/) && !has("assets/js/install.js", /\.measure\s*\(/) && !has("assets/js/install.js", /["']measure["']/), "read from the code, comments left out");
  check("M10 install.js reads no `flags.measure`", !has("assets/js/install.js", /\bflags\.measure\b|\bmeasure\s*:\s*(true|false)/), "read from the code");
  for (const f of ["assets/js/world.js", "assets/js/remote-world.js", "assets/js/world-worker.js"]) {
    const code = codeOf(f);
    check(`M10 ${f} has no \`measure\` (nor its \`measured\` reply)`, !/\bmeasure\b|["']measured["']/.test(code), `${(code.match(/\bmeasure\b|["']measured["']/g) || []).length} left`);
  }
  check("M10 main.js has no measure flag", !has("assets/js/main.js", /FLAGS\.measure|flags\.measure|["']measure["']|[?&]measure\b/), "read from the code");
  check("M10 voyage.js still has its own `calibrate`", has("assets/door/voyage.js", /\bcalibrate\b/), "not ours: the galaxy's");
  check("M10 door3d.js still has its own `measure`", has("assets/door/door3d.js", /\bmeasure\b/), "not ours: the door's");
}
finish();
