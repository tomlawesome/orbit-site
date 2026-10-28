/*
 * Test for #85 batch 2, the worker (ADR-0004 6a.7, test D2), written from the specification alone: the page side of
 * the worker path, through assets/door/index.js alone on the stub page (door-stub.mjs), the worker a fake class passed
 * as `drawWorker` that records what it is posted and answers what the case says. `drawWorker` and `fonts` are given
 * and `flags.draw` is "worker", so the worker path is taken whatever the speed rule says.
 *
 *   node tools/ci/draw-hello-test.mjs
 *
 *   hello     the first message posted is `hello`, once: the host's flags without door3d, `images` (an absolute URL for
 *             every picture the flight asks the host for, and for dawn/dawn.webp, resolved against the page), `fonts`
 *             (absolute), `baseURI`, `settle`, `size`, `hidden`
 *   hidden    `hidden` follows the page's tab
 *   canvases  the second is `canvases`: two transferables (the tokens transferControlToOffscreen gave, and listed as
 *             the transfer), `#warpgl` in the page beneath `#warp` with aria-hidden, both styled to the size
 *   warm      warm({ prove: false }) posts `warm` with an id, kind "warm", prove false; it resolves only on `warmed`
 *             with that id (one with another id resolves nothing); warmDocs posts kind "warmDocs"; warm() proves
 *   fly       fly(UP) at its warp posts `start` (seq, a profile holding no function, base "UP", no `at`); `frame` with
 *             its seq sets #warp's data-drawn, one with an old seq does not; reset() posts `clear`; descend() posts
 *             base "DOWN" with a later seq
 *   pinned    a pinned fly(UP, { at }) posts `start` with `at` the flight's own time (the journey's, less the warp beat)
 *   note      a `note` from the worker prints as it was sent, "orbit · ..." (kind "note" and "verdict" alike)
 *   resize    a window resize posts `size` and restyles both canvases; visibilitychange posts `visible`
 *   destroy   destroy() calls terminate(); destroy() before any need makes no worker
 *
 * Each case runs in a fresh Node process, on the virtual clock: nothing waits on the runner. A message that is not
 * structured-cloneable (a function in the profile) is counted by the fake worker as a clone error.
 */
import { bootWorkerPage, FONTS_ABS, IMAGES_ABS, PICTURE_PATHS, BASE, childMain, runCase, chk, finish } from "./door-stub.mjs";

const findFn = (x, path = "", seen = new Set()) => {
  if (typeof x === "function") return path || "(top)";
  if (!x || typeof x !== "object" || seen.has(x)) return null;
  seen.add(x);
  for (const k of Object.keys(x)) { const p = findFn(x[k], `${path}.${k}`, seen); if (p) return p; }
  return null;
};
const plain = (m) => JSON.parse(JSON.stringify(m ?? null));
const types = (w) => (w ? w.posted.map((m) => m.type) : []);
const noWorker = (host) => (host.made === 0 ? "no worker was made (drawWorker never called)" : null);

async function boot(extra = {}) {
  const b = await bootWorkerPage({ draw: "worker", ...extra });
  return { ...b, w: () => b.host.first() };
}

async function helloCase(hidden) {
  const b = await boot({ flags: { door3d: "1", rich: "1" }, settle: 700, hidden });
  b.journey.warm({ prove: false }).catch(() => {});
  await b.clock.advance(50);
  const w = b.w();
  if (!w) return { none: noWorker(b.host) };
  return { types: types(w), hello: plain(w.posted[0]), later: types(w).slice(1).filter((t) => t === "hello").length, cloneErrors: w.cloneErrors };
}

async function canvasesCase() {
  const b = await boot();
  b.journey.warm({ prove: false }).catch(() => {});
  await b.clock.advance(50);
  const w = b.w();
  if (!w) return { none: noWorker(b.host) };
  const m = w.posted[1];
  const gl = b.dom.find("warpgl");
  const kids = b.dom.parent.children;
  const warpNow = b.dom.find("warp");
  return {
    types: types(w), second: m && m.type,
    warpToken: !!m && m.warp !== undefined && m.warp === b.dom.warp.token && b.dom.warp.token !== null,
    warpglToken: !!m && !!gl && m.warpgl !== undefined && m.warpgl === gl.token && gl.token !== null,
    transfers: (w.transfers[1] || []).length, transferHasBoth: !!m && (w.transfers[1] || []).includes(m.warp) && (w.transfers[1] || []).includes(m.warpgl),
    size: plain(m && m.size),
    glInPage: !!gl, glBeforeWarp: !!gl && !!warpNow && kids.indexOf(gl) >= 0 && kids.indexOf(gl) < kids.indexOf(warpNow),
    glAria: gl ? gl.getAttribute("aria-hidden") : null,
    warpStyle: warpNow ? [warpNow.style.width, warpNow.style.height] : null, glStyle: gl ? [gl.style.width, gl.style.height] : null,
    warpStillThere: warpNow === b.dom.warp,
  };
}

async function warmCase(kind) {
  const b = await boot({ auto: { warmed: false } });
  let resolved = false;
  const call = kind === "warmDocs" ? () => b.journey.warmDocs({ prove: false }) : kind === "prove" ? () => b.journey.warm() : () => b.journey.warm({ prove: false });
  call().then(() => { resolved = true; }, () => { resolved = true; });
  await b.clock.advance(100);
  const w = b.w();
  if (!w) return { none: noWorker(b.host) };
  const asks = w.of("warm");
  const ask = asks[0];
  const out = { asks: asks.length, ask: plain(ask), resolvedBefore: resolved };
  if (ask) {
    const other = typeof ask.id === "number" ? ask.id + 1000 : `${ask.id}-other`;
    w.say({ type: "warmed", id: other, ok: true });
    await b.clock.advance(200);
    out.resolvedOther = resolved;
    w.say({ type: "warmed", id: ask.id, ok: true });
    await b.clock.advance(200);
    out.resolvedOwn = resolved;
  }
  return out;
}

async function flyCase() {
  const b = await boot();
  const w0 = () => b.w();
  const out = { starts: [], clears: [], drawn: [] };
  const drawnNow = () => b.dom.warp.dataset.drawn ?? b.dom.warp.getAttribute("data-drawn");
  const seen = () => (w0() ? w0().of("start").length : 0);
  b.journey.fly(b.door.UP, { on: {} });
  await b.clock.advance(15000, () => seen() >= 1);
  await b.clock.advance(100);
  if (!w0()) return { none: noWorker(b.host) };
  const rec = (m) => ({ seq: m.seq, base: m.profile && m.profile.base, fn: findFn(m.profile), at: m.at, hasProfile: !!m.profile });
  out.starts.push(...w0().of("start").map(rec));
  out.drawn.push(drawnNow());
  b.journey.reset();
  await b.clock.advance(50);
  out.clears = w0().of("clear").map((m) => m.seq);
  const before = seen();
  b.journey.descend();
  await b.clock.advance(15000, () => seen() > before);
  await b.clock.advance(100);
  out.starts = w0().of("start").map(rec);
  out.drawn.push(drawnNow());
  if (out.starts.length >= 2) {
    w0().say({ type: "frame", seq: out.starts[0].seq, world: true });      /* a late reply for the first flight */
    await b.clock.advance(50);
    out.drawn.push(drawnNow());
  }
  out.cloneErrors = w0().cloneErrors;
  return out;
}

async function pinnedCase() {
  const b = await boot();
  const tl = await import("../../assets/door/timeline.js");
  const warpAt = tl.ascentBeats().find((x) => x.act === "warp").at;
  b.journey.fly(b.door.UP, { at: 2600 });
  await b.clock.advance(200);
  const w = b.w();
  if (!w) return { none: noWorker(b.host) };
  const s = w.of("start")[0];
  return { start: s ? { at: s.at, base: s.profile && s.profile.base, fn: findFn(s.profile) } : null, want: 2600 - warpAt };
}

async function noteCase() {
  const b = await boot();
  b.journey.warm({ prove: false }).catch(() => {});
  await b.clock.advance(50);
  const w = b.w();
  if (!w) return { none: noWorker(b.host) };
  w.say({ type: "note", line: "orbit · flight: shaders compiled in 12 ms", kind: "note" });
  w.say({ type: "note", line: "orbit · flight world: on (frame 4 ms)", kind: "verdict" });
  await b.clock.advance(50);
  return { lines: b.page.lines.slice() };
}

async function resizeCase() {
  const b = await boot();
  b.journey.warm({ prove: false }).catch(() => {});
  await b.clock.advance(50);
  const w = b.w();
  if (!w) return { none: noWorker(b.host) };
  const gl = b.dom.find("warpgl");
  const n0 = w.of("size").length;
  globalThis.devicePixelRatio = 2;
  b.page.resize(800, 600);
  await b.clock.advance(50);
  const sizes = w.of("size");
  b.page.setHidden(true);
  await b.clock.advance(50);
  b.page.setHidden(false);
  await b.clock.advance(50);
  return {
    sizeAfter: plain(sizes.length > n0 ? sizes[sizes.length - 1] : null),
    warpStyle: [b.dom.warp.style.width, b.dom.warp.style.height], glStyle: gl ? [gl.style.width, gl.style.height] : null,
    visible: w.of("visible").map((m) => m.hidden),
  };
}

async function destroyCase(need) {
  const b = await boot();
  if (need) {
    b.journey.warm({ prove: false }).catch(() => {});
    await b.clock.advance(50);
  }
  b.journey.destroy();
  await b.clock.advance(50);
  const w = b.w();
  return { made: b.host.made, terminated: w ? w.terminated : 0 };
}

const CASES = {
  hello: () => helloCase(false), hidden: () => helloCase(true), canvases: canvasesCase,
  warm: () => warmCase("warm"), warmDocs: () => warmCase("warmDocs"), warmProve: () => warmCase("prove"),
  fly: flyCase, pinned: pinnedCase, note: noteCase, resize: resizeCase,
  destroy: () => destroyCase(true), destroyNone: () => destroyCase(false),
};

if (process.argv[2] === "--child") await childMain(CASES);

const show = (x) => JSON.stringify(x);
const run = (n) => runCase(import.meta.url, n);

{
  const r = run("hello");
  chk("D2 the first message posted is `hello`, and it is posted once", r, (r) => [r.types[0] === "hello" && r.later === 0, `posted ${show(r.types)}`]);
  chk("D2 hello: the host's flags, without door3d", r, (r) => [r.hello.flags.draw === "worker" && r.hello.flags.rich === "1" && !("door3d" in r.hello.flags), `flags ${show(r.hello.flags)}`]);
  chk("D2 hello: `images` gives the absolute URL of every picture the flight asks for, and dawn/dawn.webp, keyed by path", r, (r) => {
    const bad = PICTURE_PATHS.filter((p) => r.hello.images[p] !== IMAGES_ABS[p]);
    return [bad.length === 0, `missing or wrong for ${show(bad)}; images ${show(r.hello.images)}`];
  });
  chk("D2 hello: `fonts` is the host's list with absolute urls", r, (r) => [show(r.hello.fonts) === show(FONTS_ABS), `fonts ${show(r.hello.fonts)} (want ${show(FONTS_ABS)})`]);
  chk("D2 hello: baseURI, settle and size are the page's", r, (r) => { const h = r.hello; return [h.baseURI === BASE && h.settle === 700 && h.size.W === 1280 && h.size.H === 800 && h.size.dpr === 1.5, `baseURI ${h.baseURI}, settle ${h.settle}, size ${show(h.size)}`]; });
  chk("D2 hello: hidden is false on a shown tab", r, (r) => [r.hello.hidden === false, `hidden ${show(r.hello.hidden)}`]);
  chk("D2 hello: nothing the worker cannot clone was posted", r, (r) => [r.cloneErrors.length === 0, `clone errors ${show(r.cloneErrors)}`]);
  chk("D2 hello: hidden is true when the tab is hidden", run("hidden"), (r) => [r.hello.hidden === true, `hidden ${show(r.hello.hidden)}`]);
}
{
  const r = run("canvases");
  chk("D2 `canvases` is the second message", r, (r) => [r.second === "canvases", `posted ${show(r.types)}`]);
  chk("D2 canvases: #warp and #warpgl are handed over (the tokens transferControlToOffscreen gave)", r, (r) => [r.warpToken && r.warpglToken, `warp ${r.warpToken}, warpgl ${r.warpglToken}`]);
  chk("D2 canvases: both are in the transfer list (two transferables)", r, (r) => [r.transfers === 2 && r.transferHasBoth, `transfer list length ${r.transfers}, holds both ${r.transferHasBoth}`]);
  chk("D2 canvases: carries the size again", r, (r) => [r.size.W === 1280 && r.size.H === 800 && r.size.dpr === 1.5, `size ${show(r.size)}`]);
  chk("D2 #warpgl is in the page, beneath #warp (before it), aria-hidden", r, (r) => [r.glInPage && r.glBeforeWarp && r.glAria === "true", `in page ${r.glInPage}, before #warp ${r.glBeforeWarp}, aria-hidden ${r.glAria}`]);
  chk("D2 both canvases are styled to the size", r, (r) => [show(r.warpStyle) === '["1280px","800px"]' && show(r.glStyle) === '["1280px","800px"]', `#warp ${show(r.warpStyle)}, #warpgl ${show(r.glStyle)}`]);
}
for (const [name, kind, prove, what] of [["warm", "warm", false, "warm({ prove: false })"], ["warmDocs", "warmDocs", false, "warmDocs({ prove: false })"], ["warmProve", "warm", true, "warm()"]]) {
  const r = run(name);
  chk(`D2 ${what} posts \`warm\` with an id, kind "${kind}", prove ${prove}`, r, (r) => [r.asks === 1 && r.ask.id !== undefined && r.ask.id !== null && r.ask.kind === kind && r.ask.prove === prove, `asks ${r.asks}: ${show(r.ask)}`]);
  chk(`D2 ${what} does not resolve before \`warmed\``, r, (r) => [r.resolvedBefore === false, `resolved ${r.resolvedBefore}`]);
  chk(`D2 ${what}: a \`warmed\` with another id resolves nothing`, r, (r) => [r.resolvedOther === false, `resolved ${r.resolvedOther}`]);
  chk(`D2 ${what}: \`warmed\` with its id resolves it`, r, (r) => [r.resolvedOwn === true, `resolved ${r.resolvedOwn}`]);
}
{
  const r = run("fly");
  chk("D2 fly(UP) at its warp posts `start` with a seq, a profile, base \"UP\" and no `at`", r, (r) => { const s = r.starts[0]; return [s.hasProfile && typeof s.seq === "number" && s.base === "UP" && s.at === undefined, `starts ${show(r.starts)}`]; });
  chk("D2 ... the profile holds no function", r, (r) => [r.starts[0].fn === null, `first function at ${show(r.starts[0].fn)}`]);
  chk("D2 ... nothing posted was beyond structured clone", r, (r) => [r.cloneErrors.length === 0, `clone errors ${show(r.cloneErrors)}`]);
  chk("D2 ... the worker's `frame` with that seq sets #warp's data-drawn to it", r, (r) => [String(r.drawn[0]) === String(r.starts[0].seq), `data-drawn ${show(r.drawn[0])}, seq ${r.starts[0].seq}`]);
  chk("D2 reset() posts `clear` with a later seq", r, (r) => [r.clears.length >= 1 && r.clears[r.clears.length - 1] > r.starts[0].seq, `clear seqs ${show(r.clears)}, start seq ${r.starts[0].seq}`]);
  chk("D2 descend() posts `start` with base \"DOWN\", no function, a later seq", r, (r) => [r.starts.length >= 2 && r.starts[1].base === "DOWN" && r.starts[1].fn === null && r.starts[1].seq > r.clears[r.clears.length - 1], `starts ${show(r.starts)}`]);
  chk("D2 ... its `frame` sets data-drawn to the new seq", r, (r) => [String(r.drawn[1]) === String(r.starts[1].seq), `data-drawn ${show(r.drawn[1])}, seq ${r.starts[1].seq}`]);
  chk("D2 ... a late `frame` for the old seq is dropped", r, (r) => [String(r.drawn[2]) === String(r.starts[1].seq), `data-drawn ${show(r.drawn[2])}, current seq ${r.starts[1].seq}`]);
}
chk("D2 a pinned fly(UP, { at: 2600 }) posts `start` with `at` the flight's own time (2600 less the warp beat)", run("pinned"), (r) => [r.start.at === r.want && r.start.base === "UP" && r.start.fn === null, `start ${show(r.start)}, want at ${r.want}`]);
{
  const r = run("note");
  chk("D2 a `note` from the worker prints as it was sent (orbit · ...)", r, (r) => [r.lines.includes("orbit · flight: shaders compiled in 12 ms"), `console ${show(r.lines)}`]);
  chk("D2 a `verdict` note prints the same way", r, (r) => [r.lines.includes("orbit · flight world: on (frame 4 ms)"), `console ${show(r.lines)}`]);
}
{
  const r = run("resize");
  chk("D2 a window resize posts `size` (W, H, dpr)", r, (r) => [r.sizeAfter.W === 800 && r.sizeAfter.H === 600 && r.sizeAfter.dpr === 2, `last size ${show(r.sizeAfter)}`]);
  chk("D2 ... and restyles both canvases", r, (r) => [show(r.warpStyle) === '["800px","600px"]' && show(r.glStyle) === '["800px","600px"]', `#warp ${show(r.warpStyle)}, #warpgl ${show(r.glStyle)}`]);
  chk("D2 visibilitychange posts `visible` each time", r, (r) => [show(r.visible) === "[true,false]", `visible messages ${show(r.visible)}`]);
}
chk("D2 destroy() calls terminate() on the worker", run("destroy"), (r) => [r.made === 1 && r.terminated === 1, `workers made ${r.made}, terminate() calls ${r.terminated}`]);
chk("D2 destroy() before any need makes no worker", run("destroyNone"), (r) => [r.made === 0, `workers made ${r.made}`]);
finish();
