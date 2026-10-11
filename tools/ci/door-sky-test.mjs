/*
 * Tests for the door's sky and dawn (#12, #21), written from the specification alone (batch fix/m2-door).
 *
 *   D5  stars.js measureTile(host): a host measured while hidden (0 px wide) is measured again when it first gets a
 *       size, not only on a window resize: measureTile observes the host with ResizeObserver when there is one. The
 *       tile width the drift uses is the CSS custom property --tile (door.css: translateX(calc(-1 * var(--tile)))),
 *       set on the host. Control: a host measured while visible gets its width at once.
 *   D7  dawn.js: if the door's first Earth picture fails BEFORE light() is called, light() must not hold the loading
 *       ring for its 13 s backstop: it goes on as for any failed picture. Control: the same failure arriving after
 *       light() already ends promptly.
 *   D3  glows.js, the sun painted per size (#12 flight sun repaint, #21 resize): a resize settle superseded by a newer
 *       size stops painting the old size; blob URLs made for sizes no longer current are revoked once the newer build
 *       ends. Control: one uninterrupted build makes its URL and revokes nothing current.
 *
 *   node tools/ci/door-sky-test.mjs
 *
 * No dependencies and no browser; each case runs in a fresh Node process (this file again, as `--child`) against the
 * stub page in door-stub.mjs.
 */
import { dawnHost, INDEX, any, installPage, installClock, sleep, realSetTimeout as realTimeout, childMain, runCase, check, finish, errOf } from "./door-stub.mjs";

/* a host element for measureTile: its width is whatever the test says, however the function reads it */
function widthHost(page, state) {
  const props = {
    style: { setProperty(k, v) { page.styleSets.push({ k, v: String(v) }); }, getPropertyValue: () => "", removeProperty() {} },
    dataset: {},
    get clientWidth() { return state.w; }, get offsetWidth() { return state.w; }, get scrollWidth() { return state.w; },
    get clientHeight() { return state.w * 0.625; }, get offsetHeight() { return state.w * 0.625; },
    getBoundingClientRect: () => ({ width: state.w, height: state.w * 0.625, top: 0, left: 0, right: state.w, bottom: state.w * 0.625, x: 0, y: 0 }),
  };
  return new Proxy(props, {
    get: (t, k) => (k in t ? t[k] : k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : any()),
    set: (t, k, v) => { if (k === "style" || k in t) return true; t[k] = v; return true; },
  });
}
const lastTile = (page) => {
  const sets = page.styleSets.filter((s) => s.k === "--tile");
  return sets.length ? sets[sets.length - 1].v : null;
};

const CASES = {
  async "tile-hidden"() { return tileCase({ w: 0 }); },
  async "tile-visible"() { return tileCase({ w: 800 }); },
  async "dawn-early"() { return dawnCase({ failBeforeLight: true }); },
  async "dawn-late"() { return dawnCase({ failBeforeLight: false }); },
  async "sun-resize"() { return sunCase({ resize: true }); },
  async "sun-control"() { return sunCase({ resize: false }); },
  async "sun-held"() { return sunHeldCase(); },
};

async function tileCase({ w }) {
  const page = installPage();
  page.styleSets = [];
  const observers = [];
  globalThis.ResizeObserver = class {
    constructor(cb) { this.cb = cb; this.targets = []; observers.push(this); }
    observe(t) { this.targets.push(t); }
    unobserve() {} disconnect() {}
  };
  const door = await import(INDEX);
  door.createDoor({ typingWait: 0, flags: {} });
  const state = { w };
  const host = widthHost(page, state);
  door.measureTile(host);
  const atOnce = lastTile(page);
  /* the host first gets a size: the observer fires (every observer made, for every target it watches) */
  state.w = 800;
  for (const o of observers) {
    const entries = o.targets.map((t) => ({ target: t, contentRect: { width: 800, height: 500 }, borderBoxSize: [{ inlineSize: 800, blockSize: 500 }], contentBoxSize: [{ inlineSize: 800, blockSize: 500 }] }));
    try { o.cb(entries, o); } catch (e) { page.styleSets.push({ k: "error", v: String(e) }); }
  }
  await sleep(50);
  /* a window resize too would do the old thing: it is not fired here, so only the observer can re-measure */
  return { observers: observers.length, watching: observers.reduce((n, o) => n + o.targets.length, 0), atOnce, last: lastTile(page), sets: page.styleSets.slice(-4) };
}

async function dawnCase({ failBeforeLight }) {
  const page = installPage();
  const clock = installClock();
  const asked = [];
  /* nothing loads by itself: the only event is the one this test dispatches on `.earth image.pre`, and the picture
     keeps no state of its own (an SVG <image> has no `complete`); the world is not `earthy` */
  page.imageHook = () => {};
  const { host, pics, world } = dawnHost((el) => { asked.push(el.name); });
  const door = await import(INDEX);
  const d = door.createDoor({ typingWait: 0, flags: {} });
  const dawn = d.dawn(host);
  dawn.start();
  await clock.advance(200);                                    /* the pictures are asked for */
  if (failBeforeLight) { pics[0].fire("error"); await clock.advance(200); }
  const t0 = clock.now();
  let litAt = null, openAt = null;
  dawn.light({ firstVisit: false, aside: true, onLit: () => { litAt ??= clock.now() - t0; }, onOpen: () => { openAt ??= clock.now() - t0; }, after: () => undefined });
  if (!failBeforeLight) { await clock.advance(100); pics[0].fire("error"); }
  await clock.advance(20000, () => litAt !== null);
  await clock.advance(100);
  const loadingOn = page.bodyLog.filter((e) => e.name === "loading" && e.op === "add").length;
  const loadingOff = page.bodyLog.filter((e) => e.name === "loading" && e.op === "remove").length;
  const offAt = (page.bodyLog.filter((e) => e.name === "loading" && e.op === "remove").pop() || {}).at;
  const loadingOffAfter = offAt === undefined ? null : offAt - t0;
  return { asked, litAt, openAt, loadingOffAfter, loadingOn, loadingOff, stillLoading: page.bodyClasses.has("loading"), earthy: world.classes.has("earthy"), lit: page.bodyClasses.has("lit") };
}

async function sunCase({ resize }) {
  const page = installPage();
  const clock = installClock();
  const door = await import(INDEX);
  const d = door.createDoor({ typingWait: 0, flags: {} });
  const dawn = d.dawn(any());
  door.openChores();
  dawn.start();
  /* the first build begins painting */
  await clock.advance(10000, () => page.paints.length > 0);
  const firstSize = page.paints.length ? page.paints[0].w : null;
  let cutAt = null;
  if (resize) {
    /* the window changes size: that settle starts painting; then it changes again while that is still painting */
    const n = page.paints.length;
    page.resize(1000, 700);
    await clock.advance(10000, () => page.paints.length > n && page.paints[page.paints.length - 1].w !== firstSize);
    cutAt = page.paints.length;
    page.resize(900, 600);
  }
  await clock.advance(20000);
  const idx = new Map(); page.paints.forEach((p, i) => { if (!idx.has(p.w)) idx.set(p.w, i); });
  const order = [...idx.entries()].sort((a, b) => a[1] - b[1]).map((e) => e[0]);
  const current = page.paints.length ? page.paints[page.paints.length - 1].w : null;
  /* paint calls at an older size after the newest size's first paint */
  let stale = 0;
  if (order.length > 1) { const newest = order[order.length - 1]; stale = page.paints.slice(idx.get(newest)).filter((p) => p.w !== newest).length; }
  const urls = page.blobURLs.map((u) => ({ ...u, revoked: page.revoked.includes(u.url) }));
  return { order, firstSize, cutAt, current, stale, urls, paints: page.paints.length, sizes: order };
}

/* a real supersede: the first size's build is held at its encode step (its bands are painted), the window changes size,
   the newer build runs to its end, then the old one is let go */
async function sunHeldCase() {
  const page = installPage();
  const clock = installClock();
  let release; const gate = new Promise((r) => { release = r; });
  let firstW = null, held = 0;
  page.blobGate = (c) => { if (firstW === null) firstW = c.width; if (c.width === firstW) { held++; return gate; } };
  const door = await import(INDEX);
  const d = door.createDoor({ typingWait: 0, flags: {} });
  const dawn = d.dawn(any());
  door.openChores();
  dawn.start();
  await clock.advance(10000, () => held > 0);
  const oldPaints = page.paints.length;
  page.resize(1000, 700);
  await clock.advance(10000, () => page.paints.length > oldPaints && page.paints[page.paints.length - 1].w !== firstW);
  const newerBegan = page.paints.length;
  await clock.advance(10000);                                 /* the newer build runs to its end (the old one still held) */
  const urlsBeforeRelease = page.blobURLs.length;
  release();
  await clock.advance(20000);                                 /* the old one is let go */
  const newest = page.paints.length ? page.paints[page.paints.length - 1].w : null;
  const urls = page.blobURLs.map((u) => ({ ...u, revoked: page.revoked.includes(u.url) }));
  return { held, firstW, newest, oldPaintsAfterNewerBegan: page.paints.slice(newerBegan - 1).filter((p) => p.w === firstW).length, urlsBeforeRelease, urls };
}

if (process.argv[2] === "--child") await childMain(CASES);

{
  const r = runCase(import.meta.url, "tile-visible");
  check("control (D5): a host measured while visible gets its tile width at once (--tile > 0)",
    !r.error && parseFloat(r.atOnce) > 0, `--tile set at once: ${JSON.stringify(r.atOnce)}${errOf(r)}`);
}
{
  const r = runCase(import.meta.url, "tile-hidden");
  check("D5: a host measured at 0 px is watched with a ResizeObserver", !r.error && r.watching >= 1, `${r.observers} observer(s) made, ${r.watching} target(s) watched${errOf(r)}`);
  check("D5: when the observer fires with a real width, --tile becomes non-zero",
    !r.error && parseFloat(r.last) > 0, `--tile after the observer fired: ${JSON.stringify(r.last)} (at once: ${JSON.stringify(r.atOnce)}; last sets ${JSON.stringify(r.sets)})${errOf(r)}`);
}
{
  const r = runCase(import.meta.url, "dawn-late");
  check("control (D7): the Earth's first picture failing after light() ends the ring promptly (onLit within 3 s of virtual time)",
    !r.error && r.litAt !== null && r.litAt < 3000, `onLit after ${r.litAt} ms; pictures asked for ${JSON.stringify(r.asked)}${errOf(r)}`);
}
{
  const r = runCase(import.meta.url, "dawn-early");
  check("D7: the Earth's first picture failing before light() does not hold the ring (onLit within 3 s of light())",
    !r.error && r.litAt !== null && r.litAt < 3000, `onLit after ${r.litAt} ms (the backstop is 13000); pictures asked for ${JSON.stringify(r.asked)}; loading on ${r.loadingOn}, off ${r.loadingOff}${errOf(r)}`);
  check("D7: ... and body.loading is taken off within 3 s of light()", !r.error && (r.loadingOn === 0 || (r.loadingOffAfter !== null && r.loadingOffAfter < 3000)), `loading added ${r.loadingOn}x, removed ${r.loadingOff}x, last removed ${r.loadingOffAfter} ms after light()${errOf(r)}`);
}
{
  const c = runCase(import.meta.url, "sun-control", 90000);
  check("control (D3): one uninterrupted build paints the sun and makes its URL, and revokes none that is current",
    !c.error && c.paints > 0 && c.urls.length >= 1 && c.urls.every((u) => !u.revoked), `${c.paints} paint calls at sizes ${JSON.stringify(c.sizes)}; urls ${JSON.stringify(c.urls)}${errOf(c)}`);
  const r = runCase(import.meta.url, "sun-resize", 90000);
  check("D3 (precondition): two sizes were painted", !r.error && r.order.length >= 2, `sizes painted, in order of first paint: ${JSON.stringify(r.order)}${errOf(r)}`);
  check("D3: once the newer size has begun painting, the superseded size paints no more",
    !r.error && r.stale === 0, `${r.stale} paint call(s) at an older size after the newest size began (want 0)${errOf(r)}`);
  const old = (r.urls || []).filter((u) => u.w !== r.current);
  check("D3: blob URLs made for sizes no longer current are revoked once the newer build ends",
    !r.error && (r.urls || []).length > 0 && old.every((u) => u.revoked), `${old.length} stale URL(s), ${old.filter((u) => !u.revoked).length} not revoked; all urls ${JSON.stringify(r.urls)}${errOf(r)}`);
  check("D3: the current size's URL is not revoked", !r.error && (r.urls || []).filter((u) => u.w === r.current).every((u) => !u.revoked), `urls ${JSON.stringify(r.urls)}${errOf(r)}`);
}
{
  const r = runCase(import.meta.url, "sun-held", 90000);
  check("D3 supersede (precondition): the first size was held at its encode step, and a newer size then painted", !r.error && r.held >= 1 && r.newest !== null && r.newest !== r.firstW, `held ${r.held}, first size ${r.firstW}, newest ${r.newest}${errOf(r)}`);
  check("D3 supersede: the held, superseded build paints no more once the newer one has begun", !r.error && r.oldPaintsAfterNewerBegan === 0, `${r.oldPaintsAfterNewerBegan} paint call(s) at the old size after the newer began (want 0)${errOf(r)}`);
  const stale = (r.urls || []).filter((u) => u.w === r.firstW);
  check("D3 supersede: a URL the superseded build makes is revoked (no URL left for a size no longer current)", !r.error && stale.every((u) => u.revoked), `${stale.length} URL(s) for the old size, ${stale.filter((u) => !u.revoked).length} not revoked; urls ${JSON.stringify(r.urls)}${errOf(r)}`);
  check("D3 supersede: the newer size's URL is not revoked", !r.error && (r.urls || []).filter((u) => u.w === r.newest).length >= 1 && (r.urls || []).filter((u) => u.w === r.newest).every((u) => !u.revoked), `urls ${JSON.stringify(r.urls)}${errOf(r)}`);
}
finish();
