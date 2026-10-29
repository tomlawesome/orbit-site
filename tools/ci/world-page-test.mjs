/*
 * Test for #93 batch 1, the seam (ADR-0004 6b.7 test W1, with the seam items 6b.2 and 6b.6 name), written from the
 * specification alone. When no worker is chosen (`draw: "page"`, or the host gave no worker so drawnAside() is false), the
 * install's and the information's world is drawn on the page as it is today: createWorld on the page, the `.orbitgl`
 * canvas keeps its context, no worker is made, and the pure `lookOf(opts)` world.js exports equals the old world's own
 * `lookOf(opts)` for the install's options and the information's (main.js INFO_WORLD, read from main.js). Beside that,
 * the small changes the worker path stands on, on the page path: createWorld's `gated`, `warn`, `lost` and `canvas`,
 * the three exports of assets/door/index.js (setPage, pace, drawnAside) and `journey.aside()`.
 *
 *   node tools/ci/world-page-test.mjs
 *
 *   pageForced      draw=page on a bed where the worker would otherwise be taken: createWorld on the page, the canvas
 *                   keeps its webgl2 context and is not handed over, no Worker made, the world bakes   (control: passes today)
 *   pageNotGiven    the host gave no worker (drawnAside() false): the same                           (control: passes today)
 *   bedIsEligible   with no draw flag and a worker given, drawnAside() is true on this bed (so the two above prove something)
 *   lookOf          world.js exports lookOf(opts): equal to the world's own lookOf for both options, plain data, and it
 *                   makes no context and calls nothing on the gl
 *   canvasAndLost   the world has `canvas` (the one it was given) and `lost` (false, then true once the context is lost)
 *   gated           opts.gated: true makes the world although the gate refuses the page (a software renderer), and asks
 *                   for no second context; without it the gate still refuses (control: passes today)
 *   warn            opts.warn receives what would go to console.warn, and console.warn does not; by default console.warn does
 *   exports         assets/door/index.js exports setPage, pace and drawnAside as functions
 *   asidePage       journey.aside() resolves false once the flight is on the page
 *   moving          (#101, ADR-0004 6c.6 S10b) the install's dive loop on the page path marks itself moving for the chore
 *                   queue: choresNow().moving is 1 after start(), 0 after stop(), and 0 while the tab is hidden (away())
 *
 * One fresh Node process a case, on the virtual clock (door-stub.mjs). A missing export is said in plain words.
 */
import { bootInstallPage, settled, infoWorld, childMain, runCase, chk, check, finish, INDEX } from "./door-stub.mjs";

const INSTALL = "../../assets/js/install.js", WORLD = "../../assets/js/world.js", CHORES = "../../assets/door/chores.js";
const MOON = { map: "http://localhost/map.webp", rings: "http://localhost/rings.png", moon: "http://localhost/moon.webp", small: true };

/* the page path of the install: the shared world made, baked and measured on the page */
async function onPage(o) {
  const b = await bootInstallPage(o);
  const { createInstall } = await import(INSTALL);
  const pad = b.pad("installpad");
  const ring = createInstall(pad);
  const prepared = await settled(ring.prepare(), b.clock);
  const door = await import(INDEX);
  return {
    prepared: prepared.state === "resolved" ? prepared.value : prepared.state,
    context: pad.canvas.gotContext, transferred: pad.canvas.transferred, workers: b.workers.length,
    drawnInWorker: b.page.lines.some((l) => /install: drawn in a worker/.test(l)),
    flat: pad.classes.has("flat"),
    drawnAside: typeof door.drawnAside === "function" ? door.drawnAside() : "not exported",
    canvasInPad: pad.children.includes(pad.canvas),
  };
}

const world = async (b, canvas, opts = {}) => (await import(WORLD)).createWorld(canvas, { ...MOON, tag: "install", ...opts });
const fresh = (b) => { const c = new b.dom.Canvas(); c.className = "orbitgl"; return c; };

const CASES = {
  pageForced: () => onPage({ draw: "page" }),
  pageNotGiven: () => onPage({ worker: false, fonts: false }),
  async bedIsEligible() {
    const b = await bootInstallPage({});
    const door = await import(INDEX);
    if (typeof door.drawnAside !== "function") return { missing: "drawnAside" };
    return { eligible: door.drawnAside() };
  },
  async lookOf() {
    const b = await bootInstallPage({});
    const mod = await import(WORLD);
    if (typeof mod.lookOf !== "function") return { missing: "lookOf" };
    const info = (await infoWorld()).world;
    const out = { cases: {} };
    const w = await world(b, fresh(b));
    if (!w) return { error: "createWorld gave no world on the stub page" };
    const contexts = b.page.contexts, calls = b.page.glCalls;
    for (const [name, opts] of [["install", {}], ["info", info]]) {
      const got = mod.lookOf(opts), old = w.lookOf(opts);
      out.cases[name] = {
        same: JSON.stringify(got) === JSON.stringify(old) && got.HUE instanceof Float32Array && old.HUE instanceof Float32Array,
        hue: got.HUE instanceof Float32Array ? Array.from(got.HUE) : String(got.HUE), oldHue: Array.from(old.HUE),
        ringK: got.RING_K, haze: got.HAZE, grade: got.GRADE,
        sameEverywhere: got.HUE.length === old.HUE.length && Array.from(got.HUE).every((x, i) => x === old.HUE[i]),
      };
    }
    out.contextsMade = b.page.contexts - contexts; out.glCalls = b.page.glCalls - calls;
    out.infoGrade = info.grade; out.infoHaze = info.haze; out.infoRingsOn = info.ringsOn;
    return out;
  },
  async canvasAndLost() {
    const b = await bootInstallPage({});
    const canvas = fresh(b);
    const w = await world(b, canvas);
    if (!w) return { error: "createWorld gave no world on the stub page" };
    const before = w.lost;
    b.page.lost = true;
    return { canvasIsGiven: w.canvas === canvas, before, after: w.lost, hasProps: "canvas" in w && "lost" in w };
  },
  async gated() {
    const out = {};
    {
      const b = await bootInstallPage({ renderer: "Google SwiftShader" });
      const w = await world(b, fresh(b));
      out.ungated = w === null ? "null" : "world";
    }
    return out;
  },
  async gatedOn() {
    const b = await bootInstallPage({ renderer: "Google SwiftShader" });
    const before = b.page.contexts;
    const canvas = fresh(b);
    const w = await world(b, canvas, { gated: true });
    return { made: w ? "world" : "null", contexts: b.page.contexts - before, canvasContext: canvas.gotContext };
  },
  async warnGiven() {
    const b = await bootInstallPage({ failMap: true });
    const given = [], consoled = [];
    console.warn = (...a) => { consoled.push(a.map(String).join(" ")); };
    const w = await world(b, fresh(b), { warn: (...a) => { given.push(a.map(String).join(" ")); } });
    if (!w) return { error: "createWorld gave no world on the stub page" };
    const baked = await settled(w.bake(), b.clock);
    return { baked: baked.state === "resolved" ? baked.value : baked.state, given, consoled };
  },
  async warnDefault() {
    const b = await bootInstallPage({ failMap: true });
    const consoled = [];
    console.warn = (...a) => { consoled.push(a.map(String).join(" ")); };
    const w = await world(b, fresh(b));
    if (!w) return { error: "createWorld gave no world on the stub page" };
    const baked = await settled(w.bake(), b.clock);
    return { baked: baked.state === "resolved" ? baked.value : baked.state, consoled };
  },
  async exports() {
    const door = await import(INDEX);
    return { kinds: Object.fromEntries(["setPage", "pace", "drawnAside"].map((n) => [n, typeof door[n]])) };
  },
  async moving() {
    const b = await bootInstallPage({ draw: "page" });
    const { createInstall } = await import(INSTALL);
    const { choresNow } = await import(CHORES);
    const ring = createInstall(b.pad("installpad"));
    const prepared = await settled(ring.prepare(), b.clock);
    await b.clock.advance(3000);
    const out = { prepared: prepared.state, idle: choresNow().moving };
    ring.start();
    await b.clock.advance(300);
    out.running = choresNow().moving;
    ring.stop();
    await b.clock.advance(300);
    out.stopped = choresNow().moving;
    ring.start();
    await b.clock.advance(300);
    out.again = choresNow().moving;
    b.page.setHidden(true);
    await b.clock.advance(300);
    out.hidden = choresNow().moving;
    b.page.setHidden(false);
    ring.stop();
    await b.clock.advance(300);
    out.end = choresNow().moving;
    return out;
  },
  async asidePage() {
    const b = await bootInstallPage({ draw: "page" });
    if (typeof b.journey.aside !== "function") return { missing: "journey.aside" };
    b.journey.warm({ prove: false }).catch(() => {});
    const a = await settled(b.journey.aside(), b.clock, 20000);
    return { state: a.state, value: a.state === "resolved" ? a.value : null };
  },
};

if (process.argv[2] === "--child") await childMain(CASES);

const run = (n) => runCase(import.meta.url, n);
const said = (r, what) => (r.missing ? `${what}: ${r.missing} is not there yet (the seam adds it)` : null);
const show = (x) => JSON.stringify(x);

for (const [name, how, why] of [
  ["W1 draw=page", "pageForced", "draw=page"],
  ["W1 no worker given (drawnAside false)", "pageNotGiven", "no worker given"],
]) {
  const r = run(how);
  chk(`${name}: the world is made, baked and measured on the page`, r, (r) => [r.prepared === true && !r.flat, `prepare() gave ${show(r.prepared)} (want true), the pad is ${r.flat ? "flat" : "not flat"}`]);
  chk(`${name}: the .orbitgl keeps its webgl2 context and is not handed over`, r, (r) => [r.context === "webgl2" && r.transferred === false, `context ${show(r.context)}, handed over ${show(r.transferred)}`]);
  chk(`${name}: no worker is made and none is announced`, r, (r) => [r.workers === 0 && !r.drawnInWorker, `${r.workers} worker(s) made; "drawn in a worker" ${r.drawnInWorker ? "said" : "not said"}`]);
  chk(`${name}: the canvas is still in its pad`, r, (r) => [r.canvasInPad, `canvas in pad: ${show(r.canvasInPad)}`]);
  if (how === "pageNotGiven") chk(`${name}: drawnAside() is false`, r, (r) => [r.drawnAside === false || r.drawnAside === "not exported", `drawnAside() gave ${show(r.drawnAside)}`]);
}
{
  const r = run("bedIsEligible");
  chk("W1 the bed would take the worker by the automatic rule (so the cases above prove something)", r, (r) => r.missing ? [false, said(r, "assets/door/index.js")] : [r.eligible === true, `drawnAside() gave ${show(r.eligible)} (want true: no draw flag, a worker and fonts given, parallel false, no userAgentData)`]);
}
{
  const r = run("lookOf");
  const miss = r.missing ? said(r, "assets/js/world.js exports") : null;
  for (const name of ["install", "info"]) {
    chk(`W1 lookOf(${name} options) equals the world's own, with HUE a Float32Array`, r, (r) => miss ? [false, miss] : [r.cases[name].same && r.cases[name].sameEverywhere, `exported ${show(r.cases[name].hue)} against the world's ${show(r.cases[name].oldHue)}`]);
  }
  chk("W1 lookOf(install options): the plain look (identity hue, rings on, the default haze, no grade)", r, (r) => {
    if (miss) return [false, miss];
    const c = r.cases.install, id = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    return [c.hue.length === 9 && c.hue.every((x, i) => Math.abs(x - id[i]) < 1e-6) && c.ringK === 1 && c.grade === null && show(c.haze) === show([0.85, 0.82, 1.0]), `hue ${show(c.hue)}, rings ${c.ringK}, haze ${show(c.haze)}, grade ${show(c.grade)}`];
  });
  chk("W1 lookOf(info options): coral, no rings, its haze and grade carried through, hue turned", r, (r) => {
    if (miss) return [false, miss];
    const c = r.cases.info, id = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    return [c.ringK === 0 && show(c.haze) === show(r.infoHaze) && show(c.grade) === show(r.infoGrade) && c.hue.some((x, i) => Math.abs(x - id[i]) > 1e-3), `rings ${c.ringK}, haze ${show(c.haze)}, grade ${show(c.grade)}, hue ${show(c.hue)}`];
  });
  chk("W1 lookOf is pure: it makes no context and calls nothing on the gl", r, (r) => miss ? [false, miss] : [r.contextsMade === 0 && r.glCalls === 0, `${r.contextsMade} context(s) made, ${r.glCalls} gl call(s)`]);
}
{
  const r = run("canvasAndLost");
  chk("W1 the world's `canvas` is the canvas it was given", r, (r) => [r.canvasIsGiven, `world.canvas is the given canvas: ${show(r.canvasIsGiven)} (createWorld's surface gains \`canvas\`)`]);
  chk("W1 the world's `lost` is false, then true once the context is lost", r, (r) => [r.before === false && r.after === true, `lost was ${show(r.before)}, then ${show(r.after)} (want false, then true; createWorld's surface gains \`get lost()\`)`]);
}
{
  const r = run("gated"), g = run("gatedOn");
  chk("W1 gated control: without `gated` the gate still refuses a software renderer", r, (r) => [r.ungated === "null", `createWorld gave ${show(r.ungated)} (want null)`]);
  chk("W1 gated: true makes the world although the gate would refuse the page", g, (g) => [g.made === "world", `createWorld gave ${show(g.made)} (want a world: the page's gate has judged)`]);
  chk("W1 gated: true asks for no second context (only the world's own on its canvas)", g, (g) => [g.contexts === 1 && g.canvasContext === "webgl2", `${g.contexts} context(s) made (want 1), the canvas's is ${show(g.canvasContext)}`]);
}
{
  const g = run("warnGiven"), d = run("warnDefault");
  chk("W1 warn control: with a map that fails, the bake gives false", d, (d) => [d.baked === false, `bake gave ${show(d.baked)}`]);
  chk("W1 warn default: console.warn is told the map is missing", d, (d) => [d.consoled.some((l) => /no map/.test(l)), `console.warn heard ${show(d.consoled)}`]);
  chk("W1 warn given: opts.warn is told the map is missing", g, (g) => [g.given.some((l) => /no map/.test(l)), `opts.warn heard ${show(g.given)}`]);
  chk("W1 warn given: console.warn is not told as well", g, (g) => [!g.consoled.some((l) => /no map/.test(l)), `console.warn heard ${show(g.consoled)}`]);
}
{
  const r = run("exports");
  chk("W1 assets/door/index.js exports setPage, pace and drawnAside as functions", r, (r) => [Object.values(r.kinds).every((k) => k === "function"), `typeof: ${show(r.kinds)} (6b.6 adds the three)`]);
}
{
  const r = run("asidePage");
  chk("W1 journey.aside() resolves false once the flight is on the page", r, (r) => r.missing ? [false, said(r, "the journey's surface")] : [r.state === "resolved" && r.value === false, `aside() is ${r.state}${r.state === "resolved" ? ` with ${show(r.value)}` : ""} (want resolved with false)`]);
}
{
  const r = run("moving");
  const seen = (r) => `prepared ${r.prepared}; moving: idle ${show(r.idle)}, after start() ${show(r.running)}, after stop() ${show(r.stopped)}, started again ${show(r.again)}, tab hidden ${show(r.hidden)}, after stop() ${show(r.end)}`;
  chk("S10b the install's dive loop marks moving: choresNow().moving is 1 after start()", r, (r) => [r.prepared === "resolved" && r.idle === 0 && r.running === 1, seen(r)]);
  chk("S10b ... 0 after stop()", r, (r) => [r.stopped === 0 && r.end === 0, seen(r)]);
  chk("S10b ... and 0 while the tab is hidden (away()), the loop having been running", r, (r) => [r.again === 1 && r.hidden === 0, seen(r)]);
}
finish();
