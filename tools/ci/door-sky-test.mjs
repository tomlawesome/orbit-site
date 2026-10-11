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
import { INDEX, any, installPage, installClock, sleep, realSetTimeout as realTimeout, childMain, runCase, check, finish, errOf } from "./door-stub.mjs";

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
/*
 * The dawn's host for D7: querySelector(".world") -> a world whose ".earth image[data-href]" are the Earth's two
 * pictures (SVG <image> elements, the first the quick one: dawn-pre). A picture's href set = the picture asked for;
 * what it then does (load or error) is up to the test: onAsked(el, index).
 */
function earthElement(name, onAsked) {
  const attrs = { "data-href": `img/dawn/${name}.webp` };
  const listeners = {};
  const base = {
    name, dataset: { href: attrs["data-href"] }, style: { setProperty() {}, removeProperty() {} }, listeners,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    hasAttribute: (k) => k in attrs,
    removeAttribute: (k) => { delete attrs[k]; },
    setAttribute(k, v) { attrs[k] = String(v); if (/href$/.test(k)) onAsked(el); },
    setAttributeNS(ns, k, v) { attrs[k] = String(v); if (/href$/.test(k)) onAsked(el); },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
    fire(type) { const ev = { type, target: el }; if (typeof el["on" + type] === "function") el["on" + type](ev); for (const f of [...(listeners[type] || [])]) f(ev); },
    complete: false, naturalWidth: 0,
  };
  const el = new Proxy(base, {
    get: (t, k) => (k in t ? t[k] : k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : any()),
    set: (t, k, v) => { t[k] = v; if (k === "href" || k === "src") { attrs.href = String(v); onAsked(el); } return true; },
  });
  return el;
}
function dawnHost(onAsked) {
  const pics = [earthElement("dawn-pre", onAsked), earthElement("dawn", onAsked)];
  const world = new Proxy({
    dataset: {}, style: { setProperty() {}, removeProperty() {} }, clientWidth: 1280, clientHeight: 800,
    querySelectorAll: (sel) => (/\.earth image\[data-href\]/.test(sel) ? pics : []),
    querySelector: () => any(),
    getBoundingClientRect: () => ({ width: 1280, height: 800 }),
  }, { get: (t, k) => (k in t ? t[k] : k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : any()), set: (t, k, v) => { t[k] = v; return true; } });
  const host = new Proxy({ querySelector: (sel) => (sel === ".world" ? world : any()), querySelectorAll: () => [], dataset: {}, style: { setProperty() {} } },
    { get: (t, k) => (k in t ? t[k] : k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : any()), set: (t, k, v) => { t[k] = v; return true; } });
  return { host, pics };
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
  const asked = [];
  const held = [];
  /* the first picture (dawn-pre) fails once asked for; the other loads. After light() in the control case. */
  page.imageHook = (img) => {
    const fail = /dawn-pre/.test(String(img.src));
    if (fail && !failBeforeLight) held.push(img); else img.fire(fail ? "error" : "load");
  };
  const { host, pics } = dawnHost((el) => {
    asked.push(el.name);
    realTimeout(() => {
      if (el.name === "dawn-pre") { if (failBeforeLight) el.fire("error"); else held.push(el); }
      else el.fire("load");
    }, 0);
  });
  const door = await import(INDEX);
  const d = door.createDoor({ typingWait: 0, flags: {} });
  const dawn = d.dawn(host);
  dawn.start();
  await sleep(150);                                           /* the failure (if early) has arrived */
  const t0 = Date.now();
  let litAt = null, openAt = null;
  dawn.light({ firstVisit: false, aside: true, onLit: () => { litAt ??= Date.now() - t0; }, onOpen: () => { openAt ??= Date.now() - t0; }, after: () => undefined });
  if (!failBeforeLight) { await sleep(50); for (const el of held) el.fire("error"); }
  for (let i = 0; i < 60 && litAt === null; i++) await sleep(100);
  await sleep(100);
  const loadingOn = page.bodyLog.filter((e) => e.name === "loading" && e.op === "add").length;
  const loadingOff = page.bodyLog.filter((e) => e.name === "loading" && e.op === "remove").length;
  return { asked, litAt, openAt, loadingOn, loadingOff, stillLoading: page.bodyClasses.has("loading") };
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
  check("control (D7): the Earth's first picture failing after light() ends the ring promptly (onLit within 3 s)",
    !r.error && r.litAt !== null && r.litAt < 3000, `onLit after ${r.litAt} ms; pictures asked for ${JSON.stringify(r.asked)}${errOf(r)}`);
}
{
  const r = runCase(import.meta.url, "dawn-early");
  check("D7: the Earth's first picture failing before light() does not hold the ring (onLit within 3 s of light())",
    !r.error && r.litAt !== null && r.litAt < 3000, `onLit after ${r.litAt} ms (the backstop is 13000); pictures asked for ${JSON.stringify(r.asked)}; loading on ${r.loadingOn}, off ${r.loadingOff}${errOf(r)}`);
  check("D7: ... and body.loading is taken off promptly", !r.error && (r.loadingOn === 0 || r.loadingOff >= 1) && !r.stillLoading, `loading added ${r.loadingOn}x, removed ${r.loadingOff}x, still on: ${r.stillLoading}${errOf(r)}`);
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
finish();
