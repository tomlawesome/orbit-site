/*
 * Test for #119 (the flight's shaders asked after the install's first draw), the flight's side: statements L1-L7, L9,
 * L17 and L18 of the specification, written from it alone, before the code. In a worker without KHR_parallel_shader_compile
 * (Firefox) the flight's three programs (scene, over, post) are built one at a time on the GPU queue, and the install's
 * unseen first draw waited behind them (1.9-3.0 s; 0.24 s when asked after). With the flag links "late" the flight's
 * world is made with its vertex shader only, and the three programs are asked for when the page gives the word
 * (`status`), or at the latest STATUS_LATE (9000 ms) after the worker's asking.
 *
 *   node tools/ci/flight-late-test.mjs
 *
 * A. assets/door/draw-worker.js imported into a stub worker scope (door-stub.mjs: installWorkerSelf), its gl a recorder
 *    with no extension, `hello` flags { links: "late" }, a virtual clock. "The flight's three programs" are the
 *    programs whose shaders are the scene's, the over's and the post's (the docs' galaxy's two are made as ever and are
 *    not counted). A program is `created` at createProgram, `linked` at linkProgram, and `finished` where the world says
 *    so (a console line "flight: shaders compiled in N ms").
 *
 *   l1  L1  after `up` no flight program is created or linked (5 s on); control: with `links` absent the three are
 *           made at once, created and linked
 *   l2  L2  then `status`: the three are created, linked and finished within the tick of the word, a `warm` asked before
 *           is answered, and `up` is the one it was
 *   l3  L3  no `status`: nothing at 8990 ms after `up`, the three asked for by 9100 ms (STATUS_LATE 9000), `warm` answered
 *   l4  L4  `status` before the world is made: no wait (made by 500 ms, with the word); a second `status` does nothing
 *           (still three programs, one "shaders compiled", no `dead`)
 *   l5  L5  a `start` with no `status` gives the word: the programs are asked and the flight draws (a `frame` for its seq)
 *   l6  L6  the context lost, or `destroy`, while waiting: no program created afterwards, `warm` answers with ok false,
 *           and no 9000 ms timer is left (a timer was waiting before, the precondition)
 *   l7  L7  control: the extension present on the stub gl: the three asked for at once even under links "late"
 *
 * B. assets/door/remote-flight.js through index.js on the stub page with a fake Worker (door-stub.mjs: bootWorkerPage),
 *    and `statusGo` exported from index.js (D1):
 *
 *   b1  L9  `statusGo()` after `hello` posts `{ type: "status" }` once, after the `hello` (and `hello` carries links "late")
 *   b2  L9  the word given before the worker is made: `status` is posted at once to the worker made after it, after `hello`
 *   b3  L9  after destroy: `statusGo()` posts nothing, even to the terminated worker
 *   b4  L9  after the fallback to the page (no `up` in WORKER_WAIT): `statusGo()` posts nothing to the worker
 *
 * C. The joined order, L17 (B + C + the main.js wiring of D7). The worker's real code cannot share a process with the
 *    page's (a worker scope has no document, and a page has one), so the flight's worker is the fake and its `up` and
 *    programs are L1-L5's; what is joined is the page: install.js (real) with a fake world worker, remote-flight.js (real)
 *    with a fake flight worker, and ring.js's `flightLate` and `giveWord` calling `statusGo`, as main.js does them:
 *
 *   j1  L17 world `baked` -> `finish` posted -> no `status` (3 s on) -> world `finished` -> `status` posted; the word is
 *           never before `finished`
 *
 * D. The page route (draw: "page", L18), the real engine on the stub page:
 *
 *   p1  L18 the three programs are created at once on the page, though the flag says "late", and no `status` is posted
 *
 * Needing a browser, not tested here: main.js's maintenance and save-data returns giving the word at once (D5), and the
 * `?links=now` off switch; main.js not being importable (D7) its wiring of the two decisions is covered by
 * flight-late-ring-test.mjs.
 *
 * One fresh Node process a case; virtual clock only, nothing waits on the runner. A missing module or export is said in
 * plain words.
 */
import {
  installPage, installClock, installWorkerSelf, bootWorkerPage, bootInstallPage, fakeWorldWorkers, installWorldWorker, WORKER, FONTS_ABS, IMAGES_ABS, BASE, DRAW_OPS,
  INDEX, childMain, runCase, chk, finish,
} from "./door-stub.mjs";
import { runFaked } from "./ready-ways-bed.mjs";

const here = import.meta.url;
const INSTALL = "../../assets/js/install.js", RING = "../../assets/js/ring.js";
const plainError = (message) => Object.assign(new Error(message), { plain: true });
const guarded = (cases) => Object.fromEntries(Object.entries(cases).map(([k, f]) => [k, async () => { try { return await f(); } catch (e) { if (e && e.plain) return { none: e.message }; throw e; } }]));
const LATE = 9000;

/* the timers waiting, by their delay (setTimeout / clearTimeout over the virtual clock), taken before the module under test is imported */
function trackTimers() {
  const live = new Map();
  const set = globalThis.setTimeout, clear = globalThis.clearTimeout;
  globalThis.setTimeout = (f, ms, ...a) => { const id = set((...x) => { live.delete(id); return f(...x); }, ms, ...a); live.set(id, Number(ms) || 0); return id; };
  globalThis.clearTimeout = (id) => { live.delete(id); clear(id); };
  return { cap: () => [...live.values()].filter((ms) => ms === LATE).length };
}

/* the flight's own programs: the scene's, the over's and the post's (the docs' galaxy's are made apart and are not these) */
const isFlight = (p) => p.shaders.some((s) => /shockBend|uMode/.test(String(s.src)));
function watchPrograms(page) {
  const list = [];
  const create = page.glBase.createProgram;
  page.glBase.createProgram = () => { const p = create(); p.at = performance.now(); list.push(p); return p; };
  page.glBase.linkProgram = (p) => { if (p) p.linkedAt ??= performance.now(); };
  return {
    created: () => list.filter(isFlight).length,
    linked: () => list.filter((p) => isFlight(p) && p.linkedAt !== undefined).length,
    firstAt: () => Math.min(...list.filter(isFlight).map((p) => p.at)),
    lastAt: () => Math.max(...list.filter(isFlight).map((p) => p.at)),
  };
}

/* ── A: the worker ─────────────────────────────────────────────────────────────────────────────────────────────── */
async function boot(o = {}) {
  const page = installPage();
  const clock = installClock();
  const timers = trackTimers();
  const w = installWorkerSelf(page);
  w.page = page; w.clock = clock; w.timers = timers;
  if (o.extension) {
    const get = page.glBase.getExtension;
    page.glBase.getExtension = (n) => (n === "KHR_parallel_shader_compile" ? { COMPLETION_STATUS_KHR: 0x91b1 } : get(n));
  }
  w.progs = watchPrograms(page);
  /* when each thing the worker posts was posted */
  w.at = [];
  const post = w.self.postMessage;
  w.self.postMessage = (m) => { w.at.push({ type: m && m.type, at: performance.now() }); post(m); };
  try { await import(WORKER); }
  catch (e) { throw plainError(e && e.code === "ERR_MODULE_NOT_FOUND" && /draw-worker/.test(String(e.message)) ? "assets/door/draw-worker.js does not exist yet" : `assets/door/draw-worker.js did not load: ${String(e && e.stack || e).split("\n").slice(0, 3).join(" | ")}`); }
  const engine = await import("../../assets/door/engine.js");
  w.wired = engine.wireProfile(engine.UP);
  w.hello = () => ({ type: "hello", flags: o.links === null ? {} : { links: "late" }, images: IMAGES_ABS, fonts: FONTS_ABS, baseURI: BASE, settle: 700, size: { W: 1280, H: 800, dpr: 1 }, hidden: false });
  w.canvases = () => ({ type: "canvases", warp: w.warp, warpgl: w.warpgl, size: { W: 1280, H: 800, dpr: 1 } });
  w.bring = async () => { w.send(w.hello()); w.send(w.canvases()); await clock.advance(0); };
  w.run = (ms, until) => clock.advance(ms, until);
  w.upAt = () => (w.at.find((x) => x.type === "up") || {}).at;
  w.warm = (id) => w.send({ type: "warm", id, kind: "warm", prove: false });
  w.lose = () => { for (const f of [...(w.warpgl.listeners.webglcontextlost || [])]) f({ type: "webglcontextlost", preventDefault() {} }); };
  return w;
}
const snap = (w) => ({
  created: w.progs.created(), linked: w.progs.linked(), finished: w.of("note").filter((m) => /flight: shaders compiled in/.test(m.line)).length,
  ups: w.of("up").map((m) => m.ok), warmed: w.of("warmed").map((m) => ({ id: m.id, ok: m.ok })), deads: w.of("dead").map((m) => m.why), cloneErrors: w.cloneErrors,
});

async function l1(links) {
  const w = await boot({ links });
  await w.bring();
  await w.run(5000);
  return snap(w);
}
async function l2() {
  const w = await boot();
  await w.bring();
  w.warm(7);
  await w.run(3000);
  const before = snap(w);
  const t = performance.now();
  w.send({ type: "status" });
  await w.run(30000, () => w.of("warmed").some((m) => m.id === 7));
  await w.run(200);
  return { before, after: snap(w), within: { first: w.progs.firstAt() - t, last: w.progs.lastAt() - t } };
}
async function l3() {
  const w = await boot();
  await w.bring();
  w.warm(7);
  await w.run(w.upAt() + LATE - 10 - performance.now());
  const early = snap(w);
  await w.run(110);
  await w.run(30000, () => w.of("warmed").some((m) => m.id === 7));
  return { early, after: snap(w), firstAfterUp: w.progs.created() ? w.progs.firstAt() - w.upAt() : null };
}
async function l4() {
  const w = await boot();
  w.send(w.hello());
  w.send(w.canvases());
  w.send({ type: "status" });
  await w.run(500);
  const first = { ...snap(w), lastAfterUp: w.progs.created() ? w.progs.lastAt() - w.upAt() : null };
  w.send({ type: "status" });
  await w.run(2000);
  return { first, second: snap(w) };
}
async function l5() {
  const w = await boot();
  await w.bring();
  await w.run(1000);
  const before = snap(w);
  const t = performance.now();
  w.send({ type: "start", seq: 4, profile: w.wired });
  await w.run(5000, () => w.of("frame").length > 0);
  await w.run(200);
  return { before, after: snap(w), frames: w.of("frame").map((m) => ({ seq: m.seq })), within: w.progs.created() ? { first: w.progs.firstAt() - t, last: w.progs.lastAt() - t } : null, drawn2d: w.warp.ops.filter((o) => DRAW_OPS.has(o.op)).length };
}
async function l6(how) {
  const w = await boot();
  await w.bring();
  w.warm(9);
  await w.run(3000);
  const before = { ...snap(w), waiting: w.timers.cap() };
  if (how === "lost") w.lose(); else w.send({ type: "destroy" });
  await w.run(LATE + 5000);
  return { before, after: { ...snap(w), waiting: w.timers.cap() }, closed: w.closed };
}
async function l7() {
  const w = await boot({ extension: true });
  await w.bring();
  await w.run(500);
  return { ...snap(w), lastAfterUp: w.progs.created() ? w.progs.lastAt() - w.upAt() : null };
}

/* ── B: the page's side of the wire ────────────────────────────────────────────────────────────────────────────── */
async function page(o = {}) {
  const b = await bootWorkerPage({ draw: "worker", flags: { links: "late" }, ...o });
  if (typeof b.door.statusGo !== "function") throw plainError("assets/door/index.js exports no statusGo");
  return b;
}
const statuses = (w) => [...w.posted, ...w.late].filter((m) => m && m.type === "status");
async function b1() {
  const b = await page();
  b.journey.warm({ prove: false });
  await b.clock.advance(100);
  const w = b.host.first();
  if (!w) return { none: "the door made no worker" };
  const before = statuses(w).length;
  b.door.statusGo();
  await b.clock.advance(20);
  const types = w.posted.map((m) => m.type);
  return { before, posted: w.of("status"), after: statuses(w).length, helloAt: types.indexOf("hello"), statusAt: types.indexOf("status"), links: w.of("hello")[0]?.flags?.links, cloneErrors: w.cloneErrors };
}
async function b2() {
  const b = await page();
  b.door.statusGo();
  await b.clock.advance(10);
  b.journey.warm({ prove: false });
  await b.clock.advance(20);
  const w = b.host.first();
  if (!w) return { none: "the door made no worker" };
  const types = w.posted.map((m) => m.type), i = types.indexOf("status");
  return { count: statuses(w).length, helloAt: types.indexOf("hello"), statusAt: i, lag: i < 0 ? null : w.postedAt[i] - w.postedAt[types.indexOf("hello")] };
}
async function b3() {
  const b = await page();
  b.journey.warm({ prove: false });
  await b.clock.advance(100);
  const w = b.host.first();
  if (!w) return { none: "the door made no worker" };
  b.journey.destroy();
  await b.clock.advance(20);
  b.door.statusGo();
  await b.clock.advance(20);
  return { statuses: statuses(w).length, terminated: w.terminated };
}
async function b4() {
  const b = await page({ draw: undefined, auto: { up: null } });
  b.journey.warm({ prove: false });
  await b.clock.advance(6000);
  const w = b.host.first();
  if (!w) return { none: "the door made no worker" };
  const fell = w.terminated;
  b.door.statusGo();
  await b.clock.advance(100);
  return { fell, statuses: statuses(w).length };
}

/* ── C: the joined order ───────────────────────────────────────────────────────────────────────────────────────── */
async function j1() {
  const b = await bootInstallPage({ draw: "worker", flags: { links: "late" } });
  if (typeof b.door.statusGo !== "function") throw plainError("assets/door/index.js exports no statusGo");
  const log = [];
  /* every message either worker is posted ("world>type", "flight>type") and every one it says ("world<type") */
  const watch = (name, host) => {
    const make = host.make;
    host.make = (...a) => {
      const w = make(...a), post = w.postMessage.bind(w), say = w.say.bind(w);
      w.postMessage = (m, t) => { log.push(`${name}>${m && m.type}`); return post(m, t); };
      w.say = (d) => { log.push(`${name}<${d && d.type}`); return say(d); };
      return w;
    };
  };
  b.ww = installWorldWorker(b, fakeWorldWorkers());
  watch("world", b.ww); watch("flight", b.host);
  let ring, rw;
  try { rw = await import(RING); } catch (e) { throw plainError(`assets/js/ring.js could not be imported: ${e && e.message}`); }
  for (const n of ["flightLate", "giveWord"]) if (typeof rw[n] !== "function") throw plainError(`assets/js/ring.js exports no ${n}`);
  const { createInstall } = await import(INSTALL);
  ring = createInstall(b.pad("installpad"));
  const prepared = ring.prepare();
  prepared.catch(() => {});
  b.journey.warm({ prove: false });
  /* main.js: the word given once the install's world is baked and has drawn its first frame (D7: the two decisions are ring.js's) */
  await b.clock.advance(0);
  if (!ring.firstDrawn) throw plainError("the install's ring has no firstDrawn (assets/js/install.js)");
  const late = rw.flightLate({ links: "late", drawnAside: true, aside: false, compilesAside: false });
  rw.giveWord({ late, baked: ring.baked, drawn: ring.firstDrawn, go: b.door.statusGo });
  await b.clock.advance(5000, () => log.includes("world>finish"));
  await b.clock.advance(3000);
  const held = log.slice();
  const w = b.ww.first();
  if (!w) return { none: "no world worker was made" };
  w.say({ type: "finished" });
  await b.clock.advance(500);
  return { late, held, log };
}

/* ── D: the page route ─────────────────────────────────────────────────────────────────────────────────────────── */
async function p1() {
  const o = { draw: "page", flags: { links: "late" } };
  const b = await bootWorkerPage(o);
  const progs = watchPrograms(b.page);
  b.journey.warm({ prove: false });
  await b.clock.advance(3000);
  return { created: progs.created(), linked: progs.linked(), workers: b.host.made, status: b.host.list.reduce((n, w) => n + statuses(w).length, 0), lastAt: progs.created() ? progs.lastAt() : null };
}

const CASES = guarded({
  l1: () => l1("late"), l1control: () => l1(null), l2, l3, l4, l5, l6lost: () => l6("lost"), l6destroy: () => l6("destroy"), l7,
  b1, b2, b3, b4, j1, p1,
});

if (process.argv[2] === "--child") await childMain(CASES);

const show = (x) => JSON.stringify(x);
const run = (n) => runCase(here, n);
const runF = (n) => runFaked(here, n);
const clean = (s) => s.deads.length === 0 && s.cloneErrors.length === 0;

{
  const r = run("l1"), c = run("l1control");
  chk("L1 links \"late\": after `up` (5 s on) no flight program is created or linked", r, (r) => [r.ups.length === 1 && r.ups[0] === true && r.created === 0 && r.linked === 0, `up ${show(r.ups)}, created ${r.created}, linked ${r.linked}`]);
  chk("L1 control: `links` absent: the three are created and linked, and finished", c, (c) => [c.ups.length === 1 && c.created === 3 && c.linked === 3 && c.finished === 1 && clean(c), `up ${show(c.ups)}, created ${c.created}, linked ${c.linked}, finished ${c.finished}`]);
}
{
  const r = run("l2");
  chk("L2 (precondition) before the word nothing is made and the `warm` asked is not answered", r, (r) => [r.before.created === 0 && r.before.linked === 0 && r.before.warmed.length === 0, show(r.before)]);
  chk("L2 `status`: the three are created and linked in the tick of the word", r, (r) => [r.after.created === 3 && r.after.linked === 3 && r.within.first >= 0 && r.within.last <= 100, `created ${r.after.created}, linked ${r.after.linked}, first created ${r.within.first} and last ${r.within.last} ms after the word`]);
  chk("L2 ... finished (the world says its shaders compiled), and the `warm` is answered with ok true", r, (r) => [r.after.finished === 1 && r.after.warmed.length === 1 && r.after.warmed[0].id === 7 && r.after.warmed[0].ok === true, `finished ${r.after.finished}, warmed ${show(r.after.warmed)}`]);
  chk("L2 ... `up` unchanged: the one `up { ok: true }`, no `dead`, nothing beyond structured clone", r, (r) => [r.after.ups.length === 1 && r.after.ups[0] === true && clean(r.after), `ups ${show(r.after.ups)}, dead ${show(r.after.deads)}, clone errors ${show(r.after.cloneErrors)}`]);
}
{
  const r = run("l3");
  chk("L3 no `status`: nothing is created at 8990 ms after `up`", r, (r) => [r.early.created === 0 && r.early.linked === 0, show(r.early)]);
  chk("L3 ... the three are asked for at STATUS_LATE (9000 ms from the asking; not before 8990, by 9100)", r, (r) => [r.after.created === 3 && r.after.linked === 3 && r.firstAfterUp >= LATE - 10 && r.firstAfterUp <= LATE + 100, `created ${r.after.created}, linked ${r.after.linked}, first ${r.firstAfterUp} ms after up`]);
  chk("L3 ... and `warm` answers (ok true), `up` unchanged", r, (r) => [r.after.warmed.length === 1 && r.after.warmed[0].ok === true && r.after.ups.length === 1 && clean(r.after), `warmed ${show(r.after.warmed)}, ups ${show(r.after.ups)}`]);
}
{
  const r = run("l4");
  chk("L4 `status` before the world is made: no wait, the three made at once (within 500 ms of `up`)", r, (r) => [r.first.created === 3 && r.first.linked === 3 && r.first.lastAfterUp <= 500, `created ${r.first.created}, linked ${r.first.linked}, last ${r.first.lastAfterUp} ms after up`]);
  chk("L4 ... a second `status` does nothing: still three programs, one \"shaders compiled\", no `dead`", r, (r) => [r.second.created === 3 && r.second.finished === 1 && clean(r.second), `created ${r.second.created}, finished ${r.second.finished}, dead ${show(r.second.deads)}`]);
}
{
  const r = run("l5");
  chk("L5 (precondition) before the `start` nothing is made", r, (r) => [r.before.created === 0, show(r.before)]);
  chk("L5 a `start` with no `status` gives the word: the three are asked for within a second of it", r, (r) => [r.after.created === 3 && r.after.linked === 3 && r.within && r.within.first >= 0 && r.within.last <= 1000, `created ${r.after.created}, linked ${r.after.linked}, within ${show(r.within)} ms of the start`]);
  chk("L5 ... and the flight draws: one `frame` for its seq, and it paints", r, (r) => [r.frames.length === 1 && r.frames[0].seq === 4 && r.drawn2d > 0 && clean(r.after), `frames ${show(r.frames)}, 2D draws ${r.drawn2d}`]);
}
for (const how of ["lost", "destroy"]) {
  const r = run(`l6${how}`);
  const what = how === "lost" ? "the context lost" : "`destroy`";
  chk(`L6 ${what} while waiting (precondition): nothing made, a 9000 ms timer waiting`, r, (r) => [r.before.created === 0 && r.before.waiting >= 1, `created ${r.before.created}, 9000 ms timers ${r.before.waiting}`]);
  chk(`L6 ${what} while waiting: no program is created afterwards (not at STATUS_LATE either)`, r, (r) => [r.after.created === 0 && r.after.linked === 0, `created ${r.after.created}, linked ${r.after.linked}`]);
  chk(`L6 ${what} while waiting: the \`warm\` is answered, with ok false`, r, (r) => [r.after.warmed.length === 1 && r.after.warmed[0].id === 9 && r.after.warmed[0].ok === false, `warmed ${show(r.after.warmed)}`]);
  chk(`L6 ${what} while waiting: no 9000 ms timer is left`, r, (r) => [r.after.waiting === 0, `9000 ms timers ${r.after.waiting}`]);
  if (how === "destroy") chk("L6 `destroy` closes the worker (control)", r, (r) => [r.closed === 1, `close() calls ${r.closed}`]);
}
{
  const r = run("l7");
  chk("L7 control: the extension on the gl: the three asked for at once, created and linked, under links \"late\"", r, (r) => [r.created === 3 && r.linked === 3 && r.lastAfterUp <= 500 && r.ups.length === 1 && clean(r), `created ${r.created}, linked ${r.linked}, last ${r.lastAfterUp} ms after up`]);
}
{
  const r = run("b1");
  chk("L9 (precondition) `hello` carries the flag links \"late\" and no `status` has been posted before the word", r, (r) => [r.links === "late" && r.before === 0, `links ${show(r.links)}, statuses before ${r.before}`]);
  chk("L9 `statusGo()` after `hello` posts `{ type: \"status\" }`, once, after the `hello`", r, (r) => [r.posted.length === 1 && r.after === 1 && r.helloAt >= 0 && r.statusAt > r.helloAt && r.cloneErrors.length === 0, `status posts ${r.posted.length} (all ${r.after}), hello at ${r.helloAt}, status at ${r.statusAt}`]);
}
{
  const r = run("b2");
  chk("L9 the word given before the worker is made: `status` goes at once to the worker made after it, once, after `hello`", r, (r) => [r.count === 1 && r.statusAt > r.helloAt && r.helloAt >= 0 && r.lag <= 5, `status posts ${r.count}, hello at ${r.helloAt}, status at ${r.statusAt}, ${r.lag} ms after hello`]);
  const d = run("b3");
  chk("L9 after destroy: `statusGo()` posts nothing, not even to the terminated worker", d, (d) => [d.terminated >= 1 && d.statuses === 0, `terminate() calls ${d.terminated}, statuses ${d.statuses}`]);
  const f = runF("b4");
  chk("L9 after the fallback to the page: `statusGo()` posts nothing to the worker", f, (f) => [f.fell >= 1 && f.statuses === 0, `terminate() calls ${f.fell}, statuses ${f.statuses}`]);
}
{
  const r = run("j1");
  chk("L17 (precondition) ring.js's flightLate says late for a worker, no extension, links \"late\"", r, (r) => [r.late === true, `flightLate ${show(r.late)}`]);
  chk("L17 order: world `baked` -> `finish` posted to the world's worker", r, (r) => {
    const i = r.log.indexOf("world<baked"), f = r.log.indexOf("world>finish");
    return [i >= 0 && f > i, `baked at ${i}, finish at ${f}`];
  });
  chk("L17 ... and no `status` to the flight while the install's first draw is not done (3 s on)", r, (r) => [r.held.includes("world>finish") && !r.held.includes("flight>status"), `log ${show(r.held.filter((x) => /finish|status|baked/.test(x)))}`]);
  chk("L17 ... world `finished` -> `status` posted to the flight; the word never before `finished`", r, (r) => {
    const fin = r.log.indexOf("world<finished"), s = r.log.indexOf("flight>status");
    return [fin >= 0 && s > fin && r.log.indexOf("world>finish") < fin, `log ${show(r.log.filter((x) => /finish|status|baked/.test(x)))}`];
  });
}
{
  const r = run("p1");
  chk("L18 page route (draw \"page\"): the three programs are created at once on the page, though the flag says \"late\"", r, (r) => [r.created === 3 && r.linked === 3 && r.lastAt <= 1000, `created ${r.created}, linked ${r.linked}, last at ${r.lastAt} ms`]);
  chk("L18 ... and no worker is made and no `status` is posted", r, (r) => [r.workers === 0 && r.status === 0, `workers ${r.workers}, statuses ${r.status}`]);
}
finish();
