/*
 * Test for #93 batch 2, the worker (ADR-0004 6b.7 test W2), written from the specification alone: the page side of the
 * worker path for the install's and the information's world. install.js runs on the stub page (door-stub.mjs) with
 * `draw: "worker"`, and the page's `Worker` is a fake class (installWorldWorker) that records what it is posted and
 * answers what the case says. Where a case looks at the page side of the world alone, it calls createRemoteWorld
 * (assets/js/remote-world.js) with the fake as `{ worker }`, as 6b.4 gives it.
 *
 *   node tools/ci/world-hello-test.mjs
 *
 *   hello       the first message is `hello`, once: the host's flags without door3d, `baseURI`, `world` { small, map, rings,
 *               moon } (absolute urls, the planet-2k map when small), `sky`, `tag`, and the look's options as given; the
 *               worker is assets/js/world-worker.js as a module; `install: drawn in a worker` is said, once
 *   canvas      the second is `canvas`, with one transferable (the token the placeholder gave) and no context taken on it
 *   bake        bake() posts `bake` with an id and resolves only on `baked` with that id; baked { ok: false } gives false
 *   run         start() posts `run { on: true }`, stop() `run { on: false }`, after it `resize` with the camera's size
 *   view        a page frame posts one `view` (a number `seq`, a view with no function in it); the view of a still equals
 *               the one the page path draws for the same still (the time apart), with look.HUE still a Float32Array
 *   touch       once the world is baked, `touch` posts two views then `finish`
 *   drew        drew { seq, dt, ms } sets the canvas's data-drawn to seq and calls the onDrew callbacks with (dt, ms)
 *   measure     calibrate posts `measure` with two sets (the parts 0.4 and 0.8) and sets the measured part from `measured`
 *   aside       the remote world's aside() resolves true once the worker said `up`
 *
 * One fresh Node process a case, on the virtual clock. A missing module is said in plain words.
 */
import { bootInstallPage, settled, infoWorld, fakeWorldWorkers, installWorldWorker, findFn, plainOf, runCaseSpied, DOT, BASE, childMain, runCase, chk, finish } from "./door-stub.mjs";

const INSTALL = "../../assets/js/install.js", REMOTE = "../../assets/js/remote-world.js";
const at = (p) => new URL(`../../assets/${p}`, import.meta.url).href;
const EXPECT = { map: at("img/install/planet.webp"), mapSmall: at("img/install/planet-2k.webp"), rings: at("img/install/rings.png"), moon: at("door/img/flight/moon.webp") };

const plainError = (message) => Object.assign(new Error(message), { plain: true });
const guarded = (cases) => Object.fromEntries(Object.entries(cases).map(([k, f]) => [k, async () => { try { return await f(); } catch (e) { if (e && e.plain) return { none: e.message }; throw e; } }]));
const missing = (e, what) => (e && e.code === "ERR_MODULE_NOT_FOUND" && String(e.message).includes(what) ? plainError(`${what} does not exist yet`) : e);
const plain = (m) => JSON.parse(JSON.stringify(m ?? null));
const types = (w) => w.posted.map((m) => m && m.type);
const noWorker = "no worker was made (install.js never made one with `new Worker`)";

async function boot(o = {}) {
  const b = await bootInstallPage({ draw: "worker", ...o });
  b.ww = installWorldWorker(b, fakeWorldWorkers(o.auto));
  const { createInstall } = await import(INSTALL);
  b.install = (id = "installpad", opts) => { const pad = b.pad(id); return { pad, ring: createInstall(pad, opts) }; };
  return b;
}
/* the install prepared (and the worker answering): resolves when prepared has settled */
async function prepared(b, ring) {
  const p = ring.prepare();
  const s = await settled(p, b.clock);
  await b.clock.advance(3000);
  return s;
}
const lines = (b, re) => b.page.lines.filter((l) => re.test(l));

async function helloCase({ info, small }) {
  const b = await boot({ flags: { door3d: "1", fit: "skip" } });
  if (small) globalThis.screen = { width: 390, height: 844 };
  let opts;
  if (info) { const i = await infoWorld(); opts = { ...i, world: { ...i.world, sky: 1024 } }; }
  const { pad, ring } = b.install(info ? "infopad" : "installpad", opts);
  ring.prepare().catch(() => {});
  await b.clock.advance(100);
  const w = b.ww.first();
  if (!w) return { none: noWorker };
  return {
    types: types(w), hello: plain(w.posted[0]), cloneErrors: w.cloneErrors, workerUrl: String(b.workers[0][0]), workerOpts: plain(b.workers[0][1]),
    said: lines(b, /install: drawn in a worker/).length, madeBy: b.ww.made, info: info ? plain(opts.world) : null,
  };
}

async function canvasCase() {
  const b = await boot();
  const { pad, ring } = b.install();
  ring.prepare().catch(() => {});
  await b.clock.advance(100);
  const w = b.ww.first();
  if (!w) return { none: noWorker };
  const m = w.posted[1];
  return {
    types: types(w), token: pad.canvas.token !== null, sameToken: !!m && m.canvas !== undefined && m.canvas === pad.canvas.token,
    transfers: (w.transfers[1] || []).length, transferHasIt: (w.transfers[1] || []).includes(pad.canvas.token),
    transferred: pad.canvas.transferred, context: pad.canvas.gotContext, cloneErrors: w.cloneErrors,
  };
}

async function bakeCase(ok) {
  const b = await boot({ auto: { baked: null } });
  const { ring } = b.install();
  ring.prepare().catch(() => {});
  await b.clock.advance(200);
  const w = b.ww.first();
  if (!w) return { none: noWorker };
  const asks = w.of("bake");
  if (!asks.length) return { none: "no `bake` was posted" };
  const id = asks[0].id;
  let out = "pending";
  ring.baked.then((v) => { out = v; });
  await b.clock.advance(500);
  const before = out;
  w.say({ type: "baked", id: typeof id === "number" ? id + 1000 : "other", ok: true });
  await b.clock.advance(200);
  const afterOther = out;
  w.say({ type: "baked", id, ok });
  await b.clock.advance(200);
  return { hasId: id !== undefined && id !== null, before, afterOther, afterOwn: out, cloneErrors: w.cloneErrors };
}

async function runCaseOn() {
  const b = await boot();
  const { ring } = b.install();
  const s = await prepared(b, ring);
  const w = b.ww.first();
  if (!w) return { none: noWorker };
  const n0 = w.posted.length;
  ring.start();
  await b.clock.advance(5);
  const onAt = w.posted.slice(n0).findIndex((m) => m.type === "run");
  const started = w.posted.slice(n0).filter((m) => m.type === "run").map((m) => m.on);
  ring.stop();
  await b.clock.advance(5);
  const all = w.posted.slice(n0).filter((m) => m.type === "run").map((m) => m.on);
  const stopAt = w.posted.slice(n0).map((m, i) => (m.type === "run" && m.on === false ? i : -1)).filter((i) => i >= 0)[0] ?? -1;
  return { prepared: s.state, started, all, onAt, stopAt, resizes: w.of("resize").map((m) => plain({ w: m.w, h: m.h, scale: m.scale })), cloneErrors: w.cloneErrors };
}

/* the view of a still, from the page's frames and from a still, on either path */
async function viewFrame() {
  const b = await boot();
  const { pad, ring } = b.install();
  await prepared(b, ring);
  const w = b.ww.first();
  if (!w) return { none: noWorker };
  const n0 = w.of("view").length;
  ring.start();
  await b.clock.advance(2000, () => w.of("view").length > n0);
  const posted = w.of("view").slice(n0);
  ring.stop();
  const seqs = w.of("view").map((m) => m.seq);
  return {
    posted: posted.length, seqKinds: [...new Set(w.of("view").map((m) => typeof m.seq))], seqsIncrease: seqs.every((s, i) => i === 0 || s > seqs[i - 1]),
    fn: posted[0] ? findFn(posted[0].view) : null, hasView: !!posted[0] && typeof posted[0].view === "object" && posted[0].view !== null,
    hue: posted[0] ? Object.prototype.toString.call(posted[0].view?.look?.HUE) : null, cloneErrors: w.cloneErrors,
  };
}
async function viewStill(path) {
  const b = await boot({ draw: path });
  const { ring } = b.install();
  await prepared(b, ring);
  const s = await settled(ring.still(0.5, 7, null, false), b.clock);
  let view;
  if (path === "worker") { const w = b.ww.first(); if (!w) return { none: noWorker }; view = w.of("view").at(-1)?.view; }
  else view = globalThis.__worldSpy?.views.at(-1);
  if (!view) return { none: `no view was drawn for the still (still() ${s.state === "resolved" ? "gave " + s.value : s.state})` };
  return { text: plainOf({ ...view, time: 0 }), hue: Object.prototype.toString.call(view.look?.HUE) };
}

async function touchCase() {
  const b = await boot();
  const { ring } = b.install();
  await prepared(b, ring);
  const w = b.ww.first();
  if (!w) return { none: noWorker };
  const t = types(w);
  const i = t.findIndex((x, j) => x === "view" && t[j + 1] === "view" && t[j + 2] === "finish");
  return { types: t, at: i, finishes: t.filter((x) => x === "finish").length };
}

async function remote(auto) {
  const b = await bootInstallPage({ draw: "worker" });
  b.ww = installWorldWorker(b, fakeWorldWorkers(auto));
  let mod;
  try { mod = await import(REMOTE); } catch (e) { throw missing(e, "remote-world.js"); }
  if (typeof mod.createRemoteWorld !== "function") throw plainError("assets/js/remote-world.js exports no createRemoteWorld");
  const canvas = b.pad().canvas;
  const world = mod.createRemoteWorld(canvas, { tag: "install", small: true }, { worker: () => b.ww.make() });
  b.canvas = canvas; b.world = world;
  return b;
}
async function drewCase() {
  const b = await remote({ drew: null });
  const seen = [];
  b.world.onDrew((...a) => seen.push(a));
  await b.clock.advance(100);
  const w = b.ww.first();
  if (!w) return { none: "createRemoteWorld made no worker" };
  const mark = () => b.canvas.dataset.drawn ?? b.canvas.getAttribute("data-drawn");
  const before = mark() ?? null;
  w.say({ type: "drew", seq: 7, dt: 33.3, ms: 4.5 });
  await b.clock.advance(10);
  const first = { drawn: String(mark()), seen: plain(seen) };
  w.say({ type: "drew", seq: 8, dt: 50, ms: 2 });
  await b.clock.advance(10);
  return { before, first, second: { drawn: String(mark()), seen: plain(seen) } };
}
async function asideCase() {
  const b = await remote({});
  const s = await settled(b.world.aside(), b.clock, 3000);
  return { state: s.state, value: s.state === "resolved" ? s.value : null, hasAside: typeof b.world.aside === "function" };
}

/* the measured part: calibrate's own arithmetic on the ms a worker gave for its two sets, read back as the part of a view drawn at the shot's start */
const partFor = (t1, t2) => { const d = Math.max(0.01, (t2 - t1) / (0.64 - 0.16)), c = Math.max(0, t1 - d * 0.16); return Math.min(1, Math.max(0.55, Math.sqrt(Math.max(0, (18 - c) / d)))); };
async function measureCase(ms) {
  const b = await boot({ auto: { measured: ms } });
  const { ring } = b.install();
  const s = await prepared(b, ring);
  const w = b.ww.first();
  if (!w) return { none: noWorker };
  const asks = w.of("measure");
  const out = {
    prepared: s.state, asks: asks.length, kinds: asks.map((m) => ({ id: m.id !== undefined, sets: Array.isArray(m.sets) ? m.sets.length : null })),
    parts: asks[0] ? asks[0].sets.map((set) => [...new Set(set.map((v) => v.part))]) : null, sizes: asks[0] ? asks[0].sets.map((set) => set.length) : null,
    fn: asks[0] ? findFn(asks[0]) : null, cloneErrors: w.cloneErrors,
  };
  await settled(ring.still(0.1, 0, { ...DOT }), b.clock);
  out.part = w.of("view").at(-1)?.view?.part ?? null;
  out.want = partFor(ms[0], ms[1]);
  return out;
}

const CASES = guarded({
  hello: () => helloCase({}), helloInfo: () => helloCase({ info: true, small: true }), canvas: canvasCase,
  bake: () => bakeCase(true), bakeFalse: () => bakeCase(false), run: runCaseOn, viewFrame, viewWorker: () => viewStill("worker"), viewPage: () => viewStill("page"),
  touch: touchCase, drew: drewCase, aside: asideCase, measureMid: () => measureCase([10, 20]), measureSlow: () => measureCase([40, 80]),
});

if (process.argv[2] === "--child") await childMain(CASES);

const show = (x) => JSON.stringify(x);
const run = (n) => runCase(import.meta.url, n);
const abs = (u) => { try { new URL(u); return true; } catch { return false; } };

{
  const r = run("hello");
  chk("W2 the first message posted is `hello`, once, then `canvas`", r, (r) => [r.types[0] === "hello" && r.types.filter((t) => t === "hello").length === 1 && r.types[1] === "canvas", `types ${show(r.types)}`]);
  chk("W2 ... the worker is assets/js/world-worker.js, a module worker, and one is made", r, (r) => [/\/assets\/js\/world-worker\.js$/.test(r.workerUrl) && r.workerOpts && r.workerOpts.type === "module" && r.madeBy === 1, `url ${r.workerUrl}, options ${show(r.workerOpts)}, workers ${r.madeBy}`]);
  chk("W2 ... hello carries the host's flags without door3d (draw and fit as given)", r, (r) => { const f = r.hello.flags || {}; return [!("door3d" in f) && f.fit === "skip" && f.draw === "worker", `flags ${show(f)}`]; });
  chk("W2 ... hello carries world.map, rings and moon as absolute urls, the full map on a large screen (small false)", r, (r) => { const w = r.hello.world || {}; return [w.small === false && w.map === EXPECT.map && w.rings === EXPECT.rings && w.moon === EXPECT.moon && [w.map, w.rings, w.moon].every(abs), `world ${show(w)}; want map ${EXPECT.map}`]; });
  chk("W2 ... hello carries the page's baseURI and the tag", r, (r) => [r.hello.baseURI === BASE && r.hello.tag === "install", `baseURI ${show(r.hello.baseURI)}, tag ${show(r.hello.tag)}`]);
  chk("W2 ... nothing posted is beyond structured clone", r, (r) => [r.cloneErrors.length === 0, show(r.cloneErrors)]);
  chk("W2 ... `install: drawn in a worker` is said, once", r, (r) => [r.said === 1, `said ${r.said} time(s)`]);
}
{
  const r = run("helloInfo");
  chk("W2 the information's hello: tag info, the planet-2k map when small, the other pictures absolute", r, (r) => { const w = r.hello.world || {}; return [r.hello.tag === "info" && w.small === true && w.map === EXPECT.mapSmall && w.rings === EXPECT.rings && w.moon === EXPECT.moon, `tag ${show(r.hello.tag)}, world ${show(w)}; want map ${EXPECT.mapSmall}`]; });
  chk("W2 ... hello carries sky as given, and the look's options (hue, sat, ringsOn, haze, grade) as given", r, (r) => {
    const h = r.hello, g = r.info;
    return [h.sky === 1024 && h.hue === g.hue && h.sat === g.sat && h.ringsOn === g.ringsOn && show(h.haze) === show(g.haze) && show(h.grade) === show(g.grade), `sky ${show(h.sky)}, hue ${show(h.hue)}, sat ${show(h.sat)}, ringsOn ${show(h.ringsOn)}, haze ${show(h.haze)}, grade ${show(h.grade)}; given ${show(g)}`];
  });
}
{
  const r = run("canvas");
  chk("W2 `canvas` is the second message, and carries the token transferControlToOffscreen gave", r, (r) => [r.types[1] === "canvas" && r.token && r.sameToken, `types ${show(r.types)}, token given ${r.token}, message carries it ${r.sameToken}`]);
  chk("W2 ... as its one transferable, and the placeholder took no context", r, (r) => [r.transfers === 1 && r.transferHasIt && r.transferred === true && r.context === null, `transfers ${r.transfers}, lists it ${r.transferHasIt}, handed over ${r.transferred}, context ${show(r.context)}`]);
}
{
  const r = run("bake");
  chk("W2 bake() posts `bake` with an id", r, (r) => [r.hasId, `id present ${r.hasId}`]);
  chk("W2 ... and resolves nothing before a `baked`, nor on a `baked` with another id", r, (r) => [r.before === "pending" && r.afterOther === "pending", `before ${show(r.before)}, after another id ${show(r.afterOther)}`]);
  chk("W2 ... and resolves true on `baked` with its own id", r, (r) => [r.afterOwn === true, `after its own ${show(r.afterOwn)}`]);
  const f = run("bakeFalse");
  chk("W2 ... and resolves false on `baked { ok: false }` with its own id", f, (f) => [f.afterOther === "pending" && f.afterOwn === false, `after another id ${show(f.afterOther)}, after its own ${show(f.afterOwn)}`]);
}
{
  const r = run("run");
  chk("W2 start() posts `run { on: true }` once", r, (r) => [r.prepared === "resolved" && r.started.length === 1 && r.started[0] === true, `prepared ${r.prepared}, run messages after start ${show(r.started)}`]);
  chk("W2 stop() then posts `run { on: false }`, after it", r, (r) => [show(r.all) === show([true, false]) && r.stopAt > r.onAt, `run messages ${show(r.all)}, at ${r.onAt} then ${r.stopAt}`]);
  chk("W2 `resize` carries the camera's size (1280 x 800 at a scale of 1.5)", r, (r) => [r.resizes.some((m) => m.w === 1280 && m.h === 800 && m.scale === 1.5), `resizes ${show(r.resizes)}`]);
}
{
  const r = run("viewFrame");
  chk("W2 one page frame posts one `view`", r, (r) => [r.posted === 1, `views posted by the first frame: ${r.posted}`]);
  chk("W2 ... with a numeric `seq` that only rises, and a view in it with no function and look.HUE a Float32Array", r, (r) => [show(r.seqKinds) === show(["number"]) && r.seqsIncrease && r.hasView && r.fn === null && r.hue === "[object Float32Array]", `seq kinds ${show(r.seqKinds)}, rising ${r.seqsIncrease}, function at ${show(r.fn)}, HUE ${r.hue}`]);
  chk("W2 ... and no message is beyond structured clone", r, (r) => [r.cloneErrors.length === 0, show(r.cloneErrors)]);
}
{
  const w = runCaseSpied(import.meta.url, "viewWorker"), p = runCaseSpied(import.meta.url, "viewPage");
  chk("W2 the view posted for a still is the view the page path draws for it (the time apart)", w, (w) => (p.error || p.none ? [false, `the page path gave no view to compare: ${p.error || p.none}`] : [w.text === p.text, w.text === p.text ? `${w.text.length} characters alike` : `worker: ${w.text.slice(0, 160)}... page: ${p.text.slice(0, 160)}...`]));
  chk("W2 ... look.HUE is a Float32Array in it, as on the page path", w, (w) => [w.hue === "[object Float32Array]", `HUE is ${w.hue}`]);
}
{
  const r = run("touch");
  chk("W2 once baked, `touch` posts two views then `finish`", r, (r) => [r.at >= 0 && r.finishes >= 1, `message types ${show(r.types)}`]);
}
{
  const r = run("drew");
  chk("W2 `drew { seq }` sets the canvas's data-drawn to seq (not set before)", r, (r) => [r.before === null && r.first.drawn === "7" && r.second.drawn === "8", `before ${show(r.before)}, after seq 7: ${r.first.drawn}, after seq 8: ${r.second.drawn}`]);
  chk("W2 ... and calls the onDrew callbacks with its dt and ms, in order", r, (r) => [show(r.first.seen) === show([[33.3, 4.5]]) && show(r.second.seen) === show([[33.3, 4.5], [50, 2]]), `heard ${show(r.second.seen)}`]);
}
{
  const r = run("aside");
  chk("W2 aside() resolves true once the worker said `up`", r, (r) => [r.hasAside && r.state === "resolved" && r.value === true, `aside() is ${r.state}${r.state === "resolved" ? " with " + show(r.value) : ""}`]);
}
for (const [how, ms] of [["measureMid", [10, 20]], ["measureSlow", [40, 80]]]) {
  const r = run(how);
  chk(`W2 calibrate (${ms[0]} and ${ms[1]} ms) posts one \`measure\` with an id and two sets, the parts 0.4 then 0.8, no function in it`, r, (r) => [r.asks === 1 && r.kinds[0].id && r.kinds[0].sets === 2 && show(r.parts) === show([[0.4], [0.8]]) && r.fn === null && r.sizes.every((n) => n >= 1), `asks ${r.asks}, ${show(r.kinds)}, parts ${show(r.parts)}, views a set ${show(r.sizes)}, function at ${show(r.fn)}`]);
  chk(`W2 ... and sets the measured part from \`measured\` (want ${partFor(ms[0], ms[1]).toFixed(3)}, not the page's own timing)`, r, (r) => [r.part !== null && Math.abs(r.part - r.want) < 1e-3, `part ${show(r.part)}, want ${r.want}`]);
}
finish();
