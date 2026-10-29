/*
 * Test for #93 batch 2, the worker (ADR-0004 6b.7 test W3, with 6b.4 and 6b.5), written from the specification alone: when
 * the install's and the information's world is drawn in a worker. The rule is the flight's: drawnAside() (draw-rule-test.mjs,
 * D3). On the stub page (door-stub.mjs) install.js is given a pad; the page's `Worker` is a fake class (installWorldWorker)
 * that only counts what is made. With no `flags.draw`, a worker is made when every condition of D3's bed holds (the host
 * gave `drawWorker` and `fonts`, parallel false, no userAgentData, the gate not forced, not under save-data); `draw:
 * "page"`, and each condition failed on its own, make none and the console says `install: drawn on the page: <why>` (where
 * the host gave a worker); `draw: "worker"` takes it whatever the rest says. The page path then runs: the world is made on
 * the pad's own canvas.
 *
 *   node tools/ci/world-rule-test.mjs
 *
 *   worker     every condition holds: one worker is made, the line says `install: drawn in a worker`, the pad's canvas is
 *              handed over (no context taken on the page); make is not a "compile" chore: no "compile" chore is queued when
 *              prepare() returns, and hello is posted by the time the page has settled for an instant
 *   page cases one condition fails at a time (draw=page; parallel; userAgentData; gpu=force; save-data; no fonts; and no
 *              drawWorker): no worker, the line names the reason (the reasons differ), the page path runs (the pad's
 *              canvas gets its webgl2 context, nothing handed over); with draw=page the "compile" chore is queued
 *              as it is on the page path today (control)
 *   forced     draw=worker beats the rule (parallel, userAgentData and gpu force all against it): a worker
 *   door       doorPlanets() returns null with a remote world, and makes nothing (no canvas, no observer, no
 *              html[data-worldplanets]); control: on the page path, on a bed where the live door is on, it goes ahead
 *   planets    (#101, ADR-0004 6c.6 S10d) the door's planets loop marks moving for the chore queue (choresNow().moving) on
 *              the page path: 0 until `ready` has resolved, 1 once the loop has asked a frame, 0 after the tab is hidden
 *              and a frame has passed, 1 again once shown and a frame has passed, 0 while the body carries `departing`,
 *              1 when it is removed; control: the remote world (startDoor gives null), where it stays 0 throughout
 *
 * One fresh Node process a case, on the virtual clock.
 */
import { bootInstallPage, settled, fakeWorldWorkers, installWorldWorker, installObservers, INDEX, childMain, runCase, chk, check, finish } from "./door-stub.mjs";

const INSTALL = "../../assets/js/install.js", CHORES = "../../assets/door/chores.js";

async function boot(o = {}) {
  const b = await bootInstallPage(o);
  b.ww = installWorldWorker(b, fakeWorldWorkers(o.auto));
  const { createInstall } = await import(INSTALL);
  const pad = b.pad("installpad");
  return Object.assign(b, { padEl: pad, ring: createInstall(pad) });
}
const installLines = (b) => b.page.lines.filter((l) => /install: drawn (in a worker|on the page)/.test(l));
const compileIn = (choresNow) => choresNow().queued.some((t) => String(t).split("+").includes("compile"));

async function scenario(o) {
  const b = await boot(o);
  const { choresNow } = await import(CHORES);
  b.ring.prepare().catch(() => {});
  /* (looked at the moment prepare() returns, and once more when the page has settled for an instant) */
  const queuedAtOnce = compileIn(choresNow);
  await b.clock.advance(0);
  const instant = { hello: b.ww.list.length ? b.ww.list[0].of("hello").length : 0, compileQueued: queuedAtOnce || compileIn(choresNow) };
  await b.clock.advance(1500);
  return {
    made: b.ww.made, instant, lines: installLines(b), terminated: b.ww.list.reduce((n, w) => n + w.terminated, 0),
    transferred: b.padEl.canvas.transferred, context: b.padEl.canvas.gotContext,
  };
}

/* the bed doorPlanets() needs: the live door on, the probe stored as having worked, a rich root, a planet and a lockup */
async function doorBed(draw) {
  const b = await boot({ draw, flags: { door3d: "1", level: "1" } });
  const t = Date.now() - 1000;
  globalThis.localStorage = { getItem: () => JSON.stringify({ t, r: { ok: true, background: false, compileMs: 50, msPerMpx: 1 } }), setItem() {}, removeItem() {}, key: () => null, length: 0 };
  const door = await import(INDEX);
  await door.probe();
  const prepared = await settled(b.ring.prepare(), b.clock);
  const ob = installObservers();
  const root = b.page.document.documentElement;
  root.classList.contains = (c) => c === "rich";
  globalThis.location = { search: "?door3d" };
  const spin = {};
  const body = { getBoundingClientRect: () => ({ left: 352, top: 222, width: 56, height: 56 }), closest: () => spin, offsetWidth: 56 };
  const planet = { querySelector: (s) => (s === ".spin" ? spin : s === ".body" ? body : null), classList: { contains: () => false } };
  const lockup = { append() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const doorEl = { hidden: false, querySelector: (s) => (/\.lockup/.test(s) ? lockup : /\.planets/.test(s) ? {} : /\.planet\[/.test(s) ? planet : null), classList: { contains: () => false } };
  return { b, door, prepared, ob, root, doorEl };
}

async function doorCase(draw) {
  const { b, door, prepared, ob, root, doorEl } = await doorBed(draw);
  const before = b.dom.canvases.length;
  const got = b.ring.doorPlanets(doorEl, Promise.resolve());
  await b.clock.advance(50);
  return {
    prepared: prepared.state === "resolved" ? prepared.value : prepared.state, live: door.liveDoor(),
    returned: got === null ? "null" : got === undefined ? "undefined" : typeof got.then === "function" ? "promise" : typeof got,
    canvasesMade: b.dom.canvases.length - before, observers: ob.mutation.length, planets: root.dataset.worldplanets ?? null,
  };
}

/* S10d: the planets loop's mark, read at each change with a few frames of virtual time after it. The watchers' callbacks
   are run after a change that shows the door again, as the browser would run them. */
async function planetsCase(draw) {
  const { b, ob, doorEl } = await doorBed(draw);
  const { choresNow, openChores } = await import(CHORES);
  const m = () => choresNow().moving;
  let asked = 0;
  const raf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (f) => { asked++; return raf(f); };
  let release;
  const ready = new Promise((r) => { release = r; });
  const got = b.ring.doorPlanets(doorEl, ready);
  const out = { returned: got === null ? "null" : got === undefined ? "undefined" : typeof got.then === "function" ? "promise" : typeof got };
  const step = async (name, f, ms = 100) => {
    f();
    await b.clock.advance(ms);
    out[name] = m();
    out.frames = asked;
  };
  const watchers = () => { for (const o of [...ob.mutation, ...ob.resize]) if (o.on && typeof o.cb === "function") { try { o.cb([], o); } catch { /* the page's own error */ } } };
  await step("waiting", () => {});
  /* the door is shown, so the page has opened the queue: the loop's fit runs as a chore before its first frame */
  /* a measure's 200 ms rest (6c.2) can stand between ready and the fit chore: half a second covers it */
  await step("ready", () => { openChores(); release(); }, 500);
  await step("hidden", () => b.page.setHidden(true));
  await step("shown", () => { b.page.setHidden(false); watchers(); });
  await step("departing", () => b.page.document.body.classList.add("departing"));
  await step("back", () => { b.page.document.body.classList.remove("departing"); watchers(); });
  return out;
}

const CASES = {
  worker: () => scenario({}),
  drawPage: () => scenario({ draw: "page" }),
  parallel: () => scenario({ parallel: true }),
  ua: () => scenario({ userAgentData: true }),
  force: () => scenario({ flags: { gpu: "force" } }),
  saveData: () => scenario({ saveData: true }),
  noFonts: () => scenario({ fonts: false }),
  noWorker: () => scenario({ worker: false }),
  forced: () => scenario({ draw: "worker", parallel: true, userAgentData: true, flags: { gpu: "force" } }),
  /* doorPlanets on a bed where the live door is on: ?door3d at level 1, the probe stored as having worked */
  async door() { return doorCase("worker"); },
  async doorPage() { return doorCase("page"); },
  planets: () => planetsCase("page"),
  planetsRemote: () => planetsCase("worker"),
};

if (process.argv[2] === "--child") await childMain(CASES);

const show = (x) => JSON.stringify(x);
const run = (n) => runCase(import.meta.url, n);
/* (a line said through the door's note() ends with how long after opening: that is not part of the reason) */
const reasonOf = (r) => { for (const l of r.lines) { const m = /install: drawn on the page: (.+)$/.exec(l); if (m) return m[1].replace(/:\s*\d+ ms( after opening)?$/, "").trim(); } return null; };
const inWorker = (r) => r.lines.some((l) => /install: drawn in a worker/.test(l));
const REASONS = {
  parallel: /parallel|background|compil|aside|off the (page|main)/i,
  ua: /userAgentData|user.?agent|chrom|family|browser/i,
  force: /force|gpu|gate/i,
  saveData: /save-?data/i,
  noFonts: /font/i,
};

{
  const r = run("worker");
  chk("W3 the rule holds (parallel false, no userAgentData, worker, fonts): one worker is made", r, (r) => [r.made === 1 && r.terminated === 0, `workers made ${r.made}, terminated ${r.terminated}`]);
  chk("W3 ... the console says `install: drawn in a worker`, once, and not the other", r, (r) => [r.lines.filter((l) => /drawn in a worker/.test(l)).length === 1 && !r.lines.some((l) => /drawn on the page/.test(l)), `lines ${show(r.lines)}`]);
  chk("W3 ... the pad's canvas is handed over and the page took no context of it", r, (r) => [r.transferred === true && r.context === null, `handed over ${r.transferred}, context ${show(r.context)}`]);
  chk("W3 ... the world is made at once at prepare(): hello is posted by then, and no \"compile\" chore is queued", r, (r) => [r.instant.hello === 1 && r.instant.compileQueued === false, `hello posted ${r.instant.hello}, \"compile\" chore queued ${r.instant.compileQueued}`]);
}
const reasons = {};
for (const [name, what] of [["drawPage", "draw is \"page\""], ["parallel", "the gate compiles in the background (parallel true)"], ["ua", "navigator.userAgentData is defined"], ["force", "gpu is forced"],
  ["saveData", "save-data is on"], ["noFonts", "no fonts are given"]]) {
  const r = run(name);
  chk(`W3 ${what}: no worker is made and none is announced`, r, (r) => [r.made === 0 && !inWorker(r), `workers made ${r.made}, lines ${show(r.lines)}`]);
  chk(`W3 ${what}: the console says \`install: drawn on the page: <why>\``, r, (r) => {
    const why = reasonOf(r);
    reasons[name] = why;
    return [!!why && (!REASONS[name] || REASONS[name].test(why)), `lines ${show(r.lines)}`];
  });
  chk(`W3 ${what}: the page path runs (the pad's canvas gives its webgl2 context, nothing is handed over)`, r, (r) => [r.context === "webgl2" && r.transferred === false, `handed over ${r.transferred}, context ${show(r.context)}`]);
  if (name === "drawPage") chk("W3 (control) on the page path the world is made as a \"compile\" chore, queued at prepare(), as today", r, (r) => [r.instant.compileQueued === true && r.instant.hello === 0, `\"compile\" chore queued ${r.instant.compileQueued}, hello posted ${r.instant.hello}`]);
}
{
  const six = ["drawPage", "parallel", "ua", "force", "saveData", "noFonts"].map((k) => reasons[k]);
  check("W3 the reasons named for the six conditions differ from one another", six.every(Boolean) && new Set(six.map((s) => s.toLowerCase())).size === 6, show(six));
}
{
  const r = run("noWorker");
  chk("W3 no drawWorker given: no worker, none announced, the page path runs", r, (r) => [r.made === 0 && !inWorker(r) && r.context === "webgl2" && r.transferred === false, `workers made ${r.made}, lines ${show(r.lines)}, handed over ${r.transferred}, context ${show(r.context)}`]);
  const f = run("forced");
  chk("W3 draw=worker beats the rule (parallel, userAgentData and gpu force all against it): a worker", f, (f) => [f.made === 1 && inWorker(f), `workers made ${f.made}, lines ${show(f.lines)}`]);
}
{
  const c = run("doorPage"), r = run("door");
  chk("W3 (control) on the page path, with the live door on, doorPlanets() goes ahead (a promise; its canvases and observers made)", c, (c) => [c.live === true && c.returned === "promise" && c.canvasesMade >= 1 && c.observers >= 1, `live door ${c.live}, doorPlanets gave ${c.returned}, canvases made ${c.canvasesMade}, observers ${c.observers}`]);
  chk("W3 startDoor returns null with a remote world", r, (r) => [r.live === true && r.prepared === true && r.returned === "null", `live door ${r.live}, prepared ${show(r.prepared)}, doorPlanets gave ${r.returned}`]);
  chk("W3 ... and made nothing: no canvas, no observer, html[data-worldplanets] never set", r, (r) => [r.canvasesMade === 0 && r.observers === 0 && r.planets === null, `canvases made ${r.canvasesMade}, observers ${r.observers}, worldplanets ${show(r.planets)}`]);
}
{
  const r = run("planets"), c = run("planetsRemote");
  const seen = (r) => `doorPlanets gave ${r.returned}; moving: waiting for ready ${JSON.stringify(r.waiting)}, ready ${JSON.stringify(r.ready)}, tab hidden ${JSON.stringify(r.hidden)}, shown ${JSON.stringify(r.shown)}, body departing ${JSON.stringify(r.departing)}, departing removed ${JSON.stringify(r.back)}; ${r.frames} frames asked in all`;
  chk("S10d the door's planets loop on the page path: moving is 0 until `ready` has resolved, 1 once the loop has asked a frame", r, (r) => [r.returned === "promise" && r.waiting === 0 && r.ready === 1 && r.frames > 0, seen(r)]);
  chk("S10d ... 0 after the tab is hidden and a frame has passed, 1 again once it is shown and a frame has passed", r, (r) => [r.hidden === 0 && r.shown === 1, seen(r)]);
  chk("S10d ... 0 while the body carries `departing`, and 1 when it is removed", r, (r) => [r.departing === 0 && r.back === 1, seen(r)]);
  chk("S10d W3 control: with the remote world startDoor returns null and moving stays 0 throughout", c, (c) => [c.returned === "null" && [c.waiting, c.ready, c.hidden, c.shown, c.departing, c.back].every((x) => x === 0), seen(c)]);
}
finish();
