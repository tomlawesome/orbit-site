/*
 * Live test for #27 ("a way to cancel dawn.light()") and #28 ("data-rasterised=ready is set before the Earth pictures
 * load"), written from the issues' specification alone. tests/dawn.html makes a dawn through assets/door/index.js alone.
 *
 * #27: dawn.light() has a 13 s backstop that lights the page (body.lit) even if what it waited for never comes. The
 * dawn's destroy() must also stop a first light under way: after it, body.lit is not added, onLit and onOpen are not
 * called, however long one waits (past the backstop), and nothing throws. The light is made with wait: true and an
 * after() that never settles, so only the backstop can light it. Control: without destroy() the same light does set
 * body.lit and call onLit by about 15 s.
 *
 * #28: the dawn's world element reads data-rasterised "pending", then "ready". "ready" must come only once the glows are
 * drawn and the Earth's pictures that start() asks for (found from a normal run's network log: img/dawn/dawn-pre.webp
 * and img/dawn/dawn.webp) have loaded. They are held for several seconds with page.route and let go: "ready" must not
 * show while they are held, must show after, and after every one of those pictures has finished (read in the page: its
 * resource timing against when it set "ready", not when the runner hears of the finish). Control: unheld, it
 * reaches "ready".
 *
 *   PLAYWRIGHT_ROOT=<playwright package dir> HEADED=1 LIBGL_ALWAYS_SOFTWARE=1 \
 *     xvfb-run -a -s "-screen 0 1280x800x24" node tools/ci/dawn-test.mjs
 *
 * Also (#27), a destroyed dawn stops all of it: destroy() straight after start() (same task), and start() after destroy(),
 * leave the world never "ready" and a resize does not rebuild it (no new glow pictures asked for); control: start()
 * alone does reach "ready" and a resize rebuilds it ("pending", then "ready" again). And with light() called twice,
 * destroy() soon after the second call leaves no body.loading, no body.lit, no onLit and no onOpen from either light.
 *
 * Also (#32), the dawn's pictures are decoded before the light: a browser decodes a picture only when first drawn, so the
 * glow pictures (the SVG <image> elements in #door .world) and the Earth's, invisible until body.lit fades them in, were
 * decoded right after the light, stalling the page. The door must ask each to be decoded ahead, with
 * HTMLImageElement.prototype.decode() on an image of the same address. Recorded from an init script: every decode() call
 * (the image's src, absolute, and performance.now()) and when body first has class lit. Read 3 s after the light: every
 * #door .world image's address (href, else xlink:href), absolute. At least 3 exist, and each had a decode() call on the
 * same address before body.lit (judged by whether body had class lit at the decode() call itself), and at least one is
 * the page's own painted glow (a blob: or data: address). The light is the 13 s backstop's (lightIt with an after() that never settles).
 *
 * Also (#32), the dawn holds each rasterised glow decoded: after start() and once data-rasterised reads "ready", every
 * #door .world image[data-raster] has its current href (absolute) as the src of at least one image in the flattened
 * dawn.held[*].held[*], and as the src of exactly one (one holding per layer). After a resize from 1280x800 to 900x600 and
 * "ready" again, the same holds for the new hrefs, and a layer whose href changed has let go of its old one (no held
 * image has the old src); a resize that changes no href fails, since it did not exercise the rule. After dawn.destroy(),
 * dawn.held is empty. Each held image of a current layer must also be decoded: its holding's ready comes (within 5 s) and
 * the image is complete with a naturalWidth above 0, before and after the resize.
 *
 * (sh tools/ci/journey-local.sh dawn does exactly that.) BROWSER=chromium for a second engine; HEADED=1 as the other
 * live tests: Firefox has no WebGL headless here. The whole run takes about a minute: the light cases wait out the
 * backstop in real time.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { freePort, openBrowser } from "./live-lib.mjs";

const playwright = createRequire(import.meta.url)(process.env.PLAYWRIGHT_ROOT || "playwright");
const BROWSER = process.env.BROWSER || "firefox";
/* the gate's one server when SITE is given (tools/ci/live-run.mjs), else our own on a free port */
const SITE = process.env.SITE || `http://127.0.0.1:${await freePort()}/`;
const here = dirname(fileURLToPath(import.meta.url));

/* the light: the backstop is 13 s; the control is watched to 15 s, the cancelled one to 16 s, destroy() at 1 s */
const CONTROL_WATCH = 15000;
const DESTROY_AT = 1000;
const CANCELLED_WATCH = 16000;
/* the Earth's pictures: held this long, then let go; "ready" is waited for this long after */
const HOLD = 4000;
const READY_WITHIN = 20000;
/* a destroyed dawn: watched this long, resized, then watched this long again */
const DEAD_WATCH = 3000;
const RESIZE_WATCH = 3000;
/* two lights, destroy() this long after the second; body.loading is looked for at these times (ms after the second
   light) and the callbacks are watched to the end */
const TWO_GAP = 100;
const TWO_CHECKS = [1000, 14000];
const TWO_WATCH = 16000;
/* and once with the ring surely up (body.loading comes on within about 300 ms): it must be taken off */
const RING_GAP = 600;
const GLOW = /\/assets\/door\/img\/dawn\/glow-/;
/* the pictures start() asks for, as a normal run's network log shows them */
const EARTH = /\/assets\/door\/img\/dawn\/dawn(-pre)?\.webp(\?|$)/;

const server = process.env.SITE ? null : spawn(process.execPath, [join(here, "serve.mjs"), new URL(SITE).port], { stdio: ["ignore", "ignore", "inherit"] });
let failed = false;
let browser = null;
try {
  await new Promise((ok, no) => {
    const t0 = Date.now();
    (async function poll() {
      try { await fetch(SITE); ok(); } catch { Date.now() - t0 > 10000 ? no(new Error("server did not start")) : setTimeout(poll, 100); }
    })();
  });
  browser = await openBrowser(playwright, BROWSER);
  /* motion left on: reduced motion may take other paths through the light */
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });

  /* each scenario on a fresh page, so no dawn inherits another's state */
  const open = async (init) => {
    const page = await ctx.newPage();
    if (init) await page.addInitScript(init);
    const problems = [];
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    await page.goto(`${SITE}tests/dawn.html`, { waitUntil: "load" });
    await page.waitForFunction(() => window.dawnReady, null, { timeout: 30000 });
    return { page, problems };
  };

  const light = async (destroyAt, watch) => {
    const { page, problems } = await open();
    try {
      const r = await page.evaluate(([d, w]) => window.lightIt(d, w), [destroyAt, watch]);
      return { r, problems };
    } finally { await page.close(); }
  };

  /* hold: false for the control. Answers what the page saw, plus the Earth requests as the runner saw them asked for, and the page's own record of when they ended. */
  const draw = async (hold) => {
    const { page, problems } = await open();
    try {
      const earth = [];   /* { url, asked } */
      let release = () => {};
      const released = new Promise((ok) => { release = ok; });
      await page.route(EARTH, async (route) => {
        const e = { url: route.request().url().replace(/^.*\/assets\//, "assets/"), asked: Date.now() };
        earth.push(e);
        if (hold) await released;
        await route.continue().catch(() => {});
      });
      const began = await page.evaluate(() => window.drawBegin());
      let atHold = null, releasedAt = null;
      if (hold) {
        await new Promise((ok) => setTimeout(ok, HOLD));
        atHold = await page.evaluate(() => window.drawNow());
        releasedAt = Date.now();
        release();
      }
      let waited = null;
      try {
        await page.waitForFunction(() => window.drawNow() === "ready", null, { timeout: READY_WITHIN, polling: 50 });
      } catch { waited = `data-rasterised never read "ready" within ${READY_WITHIN} ms of the start`; }
      const r = await page.evaluate(() => window.drawEnd());
      return { r: { ...r, earth, began, atHold, releasedAt, waited }, problems };
    } finally { await page.close(); }
  };

  /* kind: "start", "start-destroy" or "destroy-start" (tests/dawn.html); then a resize, and what it brings */
  const dead = async (kind) => {
    const { page, problems } = await open();
    try {
      const glowAsks = [];
      page.on("request", (req) => { if (GLOW.test(req.url())) glowAsks.push(Date.now()); });
      const began = await page.evaluate((k) => window.destroyRun(k), kind);
      await new Promise((ok) => setTimeout(ok, DEAD_WATCH));
      const before = await page.evaluate(() => window.drawLog());
      const resized = Date.now();
      await page.setViewportSize({ width: 1000, height: 700 });
      await new Promise((ok) => setTimeout(ok, RESIZE_WATCH));
      const after = await page.evaluate(() => window.drawLog());
      const values = (log) => log.map((x) => x.v);
      return { r: {
        thrown: began.thrown, errors: [], began: began.at,
        values: values(after), valuesBefore: values(before),
        /* what the world read when the resize came, and the values it took on after it */
        atResize: before[before.length - 1].v,
        afterResize: after.filter((x) => x.at >= resized).map((x) => x.v),
        glowAsksAfterResize: glowAsks.filter((t) => t >= resized).length,
      }, problems };
    } finally { await page.close(); }
  };

  const pendingAtOnce = async () => {
    const { page, problems } = await open();
    try {
      const value = await page.evaluate(() => window.pendingAtOnce());
      return { r: { value, thrown: null, errors: [] }, problems };
    } finally { await page.close(); }
  };

  const twoLights = async (gap, checks, watch) => {
    const { page, problems } = await open();
    try {
      const r = await page.evaluate(([g, c, w]) => window.twoLights(g, c, w), [gap, checks, watch]);
      return { r, problems };
    } finally { await page.close(); }
  };

  /* #32: recorded before the page loads: every decode() call (absolute src, performance.now()) and when body first has lit */
  const recordDecodes = () => {
    window.__decodes = [];
    window.__litAt = null;
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () {
      try { window.__decodes.push({ url: new URL(this.src || this.currentSrc || "", document.baseURI).href, at: performance.now(), lit: !!(document.body && document.body.classList.contains("lit")) }); } catch {}
      return decode.apply(this, arguments);
    };
    const check = () => { if (window.__litAt === null && document.body && document.body.classList.contains("lit")) window.__litAt = performance.now(); };
    new MutationObserver(check).observe(document, { attributes: true, subtree: true, attributeFilter: ["class"] });
    check();
  };
  const LIT_WITHIN = 25000;
  const AFTER_LIT = 3000;
  const decodedAhead = async () => {
    const { page, problems } = await open(recordDecodes);
    try {
      page.evaluate(() => window.lightIt(null, 0)).catch(() => {});
      let waited = null;
      try { await page.waitForFunction(() => window.__litAt !== null, null, { timeout: LIT_WITHIN, polling: 50 }); }
      catch { waited = `body never had class lit within ${LIT_WITHIN} ms`; }
      await new Promise((ok) => setTimeout(ok, AFTER_LIT));
      const seen = await page.evaluate(() => {
        const abs = (u) => new URL(u, document.baseURI).href;
        const pictures = [];
        for (const el of document.querySelectorAll("#door .world image")) {
          const u = el.getAttribute("href") || el.getAttribute("xlink:href");
          if (u) pictures.push(abs(u));
        }
        return { pictures, decodes: window.__decodes, litAt: window.__litAt };
      });
      /* early: body did not yet have class lit at the call itself (litAt is stamped a task later, from the observer) */
      const early = (url) => seen.decodes.some((d) => d.url === url && seen.litAt !== null && !d.lit && d.at < seen.litAt);
      const late = (url) => seen.decodes.filter((d) => d.url === url && (seen.litAt === null || d.lit || d.at >= seen.litAt)).map((d) => Math.round(d.at - seen.litAt));
      const missing = [...new Set(seen.pictures)].filter((u) => !early(u))
        .map((u) => ({ url: u.replace(/^.*\/assets\//, "assets/"), decodedAfterLight: late(u) }));
      const kinds = [...new Set(seen.pictures.map((u) => u.replace(/^([a-z]+):.*$/i, "$1")))];
      const painted = seen.pictures.filter((u) => /^(blob|data):/i.test(u));
      return { r: { ...seen, missing, kinds, painted, waited, thrown: null, errors: [] }, problems };
    } finally { await page.close(); }
  };

  /* #32: the rasterised layers' hrefs against what dawn.held holds, in the page */
  const heldLook = async () => {
    const abs = (u) => new URL(u, document.baseURI).href;
    const held = [];
    for (const h of window.dawn.held) for (const img of h.held) held.push(img.src);
    /* each holding's ready, bounded; then every held image that is a current layer's must be decoded and loaded */
    const bound = new Promise((ok) => setTimeout(() => ok("timeout"), 5000));
    const readied = await Promise.all(window.dawn.held.map((h) => Promise.race([Promise.resolve(h.ready).then(() => "ok", () => "rejected"), bound])));
    const notReady = readied.filter((x) => x !== "ok").length;
    const hrefs = [...document.querySelectorAll("#door .world image[data-raster]")]
      .map((el) => el.getAttribute("href") || el.getAttribute("xlink:href")).filter(Boolean).map(abs);
    const undecoded = [];
    for (const h of window.dawn.held) for (const img of h.held) {
      if (hrefs.includes(img.src) && !(img.complete && img.naturalWidth > 0)) undecoded.push(img.src);
    }
    return {
      hrefs, heldCount: held.length, notReady, undecoded,
      count: Object.fromEntries(hrefs.map((u) => [u, held.filter((s) => s === u).length])),
      heldSrcs: held,
    };
  };
  const short = (u) => (u.length > 48 ? `${u.slice(0, 48)}...` : u);
  const heldRasterised = async () => {
    const { page, problems } = await open();
    try {
      await page.evaluate(() => {
        window.__rs = [];
        new MutationObserver(() => window.__rs.push(window.dawn.world.dataset.rasterised ?? null))
          .observe(window.dawn.world, { attributes: true, attributeFilter: ["data-rasterised"] });
        window.dawn.start();
      });
      let waited = null;
      const ready = (since) => page.waitForFunction(
        (n) => window.__rs.slice(n).includes("ready") || (n === 0 && window.dawn.world.dataset.rasterised === "ready"),
        since, { timeout: READY_WITHIN, polling: 50 });
      try { await ready(0); } catch { waited = `data-rasterised never read "ready" within ${READY_WITHIN} ms of the start`; }
      /* a moment more, so a late rebuild would show */
      await new Promise((ok) => setTimeout(ok, 300));
      const first = await page.evaluate(heldLook);
      let second = null;
      if (!waited) {
        const since = await page.evaluate(() => window.__rs.length);
        await page.setViewportSize({ width: 900, height: 600 });
        try {
          await page.waitForFunction((n) => window.__rs.slice(n).includes("pending"), since, { timeout: 10000, polling: 50 });
        } catch { /* the rebuild may be over before we looked: the check below decides */ }
        try { await ready(since); } catch { waited = `data-rasterised never read "ready" within ${READY_WITHIN} ms of the resize`; }
        await new Promise((ok) => setTimeout(ok, 300));
        second = await page.evaluate(heldLook);
      }
      const afterDestroy = await page.evaluate(() => { window.dawn.destroy(); return window.dawn.held.length; });
      const layersOk = (x) => x !== null && x.hrefs.length > 0 && x.hrefs.every((u) => x.count[u] >= 1);
      const decodedOk = (x) => x !== null && x.notReady === 0 && x.undecoded.length === 0;
      const onceOk = (x) => x !== null && x.hrefs.length > 0 && x.hrefs.every((u) => x.count[u] === 1);
      const changed = second ? first.hrefs.filter((u) => !second.hrefs.includes(u)) : [];
      const letGo = second ? changed.every((u) => !second.heldSrcs.includes(u)) : false;
      return { r: { first, second, afterDestroy, waited, layersOk, decodedOk, onceOk, changed, letGo, thrown: null, errors: [] }, problems };
    } finally { await page.close(); }
  };

  const scenarios = [
    ["the dawn holds each rasterised glow decoded, one per layer (#32)", () => heldRasterised(), (r) => [
      ["there are rasterised layers (image[data-raster]) once ready", r.first.hrefs.length > 0],
      ["every rasterised href is the src of a held image", r.layersOk(r.first)],
      ["exactly one held image per rasterised href", r.onceOk(r.first)],
      ["each holding's ready came, and each held layer image is complete with a width", r.decodedOk(r.first)],
      ["the resize changed at least one href (it exercised the rule)", r.second !== null && r.changed.length > 0],
      ["after the resize, every new href is held", r.layersOk(r.second)],
      ["after the resize, exactly one held image per href", r.onceOk(r.second)],
      ["after the resize, each holding's ready came and each held layer image is complete with a width", r.decodedOk(r.second)],
      ["after the resize, the old hrefs are no longer held", r.letGo],
      ["after destroy(), dawn.held is empty", r.afterDestroy === 0],
    ], (r) => `before ${JSON.stringify(r.first.hrefs.map(short))}, held ${r.first.heldCount} (not ready ${r.first.notReady}, undecoded ${r.first.undecoded.length}); after the resize ${r.second ? `${JSON.stringify(r.second.hrefs.map(short))}, held ${r.second.heldCount} (not ready ${r.second.notReady}, undecoded ${r.second.undecoded.length})` : "never ready"}; changed ${r.changed.length ? JSON.stringify(r.changed.map(short)) : "none (the resize did not exercise the rule)"}; held after destroy() ${r.afterDestroy}`],

    ["the dawn's pictures are decoded before the light (#32)", () => decodedAhead(), (r) => [
      ["body.lit came", r.litAt !== null],
      ["at least 3 pictures are in #door .world", r.pictures.length >= 3],
      ["one of the pictures is the page's own painted glow (a blob: or data: address)", r.painted.length > 0],
      ["every picture had a decode() call before body.lit", r.missing.length === 0],
    ], (r) => r.missing.length
      ? `${r.pictures.length} pictures (address kinds ${JSON.stringify(r.kinds)}, ${r.painted.length} painted by the page), ${r.decodes.length} decode() calls, lit at ${r.litAt === null ? "never" : Math.round(r.litAt)} ms; no decode before the light: ${r.missing.map((m) => `${m.url} (${m.decodedAfterLight.length ? `decoded at ${m.decodedAfterLight.map((t) => `+${t}`).join(", ")} ms after the light` : "never decoded"})`).join("; ")}`
      : `${r.pictures.length} pictures (address kinds ${JSON.stringify(r.kinds)}, ${r.painted.length} painted by the page), all decoded before the light (${r.decodes.length} decode() calls; lit at ${Math.round(r.litAt)} ms)`],

    ["light, no destroy() (control): the backstop lights it by 15 s", () => light(null, CONTROL_WATCH), (r) => [
      ["body.lit is set by 15 s", r.lit && r.at.lit !== undefined],
      ["onLit was called", r.at.onLit !== undefined],
      ["no error was thrown", !r.thrown && r.errors.length === 0],
    ], (r) => `lit at ${r.at.lit} ms, onLit ${r.at.onLit}, onOpen ${r.at.onOpen} (ms from the call; end ${r.end})`],

    ["light, destroy() at 1 s: nothing of that light happens, to 16 s", () => light(DESTROY_AT, CANCELLED_WATCH), (r) => [
      ["destroy() was called, at about 1 s", r.at.destroyed !== undefined],
      ["body.lit is not set", !r.lit && r.at.lit === undefined],
      ["onLit was not called", r.at.onLit === undefined],
      ["onOpen was not called", r.at.onOpen === undefined],
      ["the watch ran past the 13 s backstop", r.end >= 15000],
      ["no error was thrown (by the call, or uncaught after it)", !r.thrown && r.errors.length === 0],
    ], (r) => `destroyed at ${r.at.destroyed} ms, lit at ${r.at.lit}, onLit ${r.at.onLit}, onOpen ${r.at.onOpen}; end ${r.end}`],

    ["data-rasterised, Earth pictures unheld (control): it reaches ready", () => draw(false), (r) => [
      ["start() asked for the Earth's pictures (the network log shows them)", r.earth.length > 0],
      ["data-rasterised read pending", r.seen.pending !== undefined],
      ["data-rasterised reached ready", r.seen.ready !== undefined && !r.waited],
      ["no error was thrown", !r.thrown && r.errors.length === 0],
    ], (r) => `Earth requests ${JSON.stringify(r.earth.map((e) => e.url))}; pending at +${r.seen.pending - r.began} ms, ready at +${r.seen.ready - r.began} ms`],

    [`data-rasterised, Earth pictures held ${HOLD} ms: ready only after they have loaded`, () => draw(true), (r) => [
      ["the Earth's pictures were asked for, and held (the network log shows them)", r.earth.length > 0],
      ["data-rasterised read pending", r.seen.pending !== undefined],
      ["data-rasterised was not ready while they were held", r.atHold !== "ready" && (r.seen.ready === undefined || r.seen.ready >= r.releasedAt)],
      ["data-rasterised became ready after they were released", r.seen.ready !== undefined && !r.waited],
      /* judged in the page (its resource timing against when it set ready), not by when the runner is told of the finish */
      ["every Earth picture had finished (in the page) before ready", r.earth.length > 0 && r.readyPerf !== null && r.earth.every((e) => r.earthEnds.some((x) => x.url === e.url && x.responseEnd > 0 && x.responseEnd <= r.readyPerf))],
      ["no error was thrown", !r.thrown && r.errors.length === 0],
    ], (r) => `held ${JSON.stringify(r.earth.map((e) => e.url))}; at the end of the hold ${JSON.stringify(r.atHold)}; ready at ${r.seen.ready === undefined ? "never" : `+${r.seen.ready - r.began} ms`}, released at +${r.releasedAt - r.began} ms, in the page, response ends ${JSON.stringify(r.earthEnds.map((x) => Math.round(x.responseEnd)))} ms, ready set at ${r.readyPerf === null ? "never" : Math.round(r.readyPerf)} ms`],

    ["data-rasterised is pending by the time start() returns (a host checking straight after sees it)", () => pendingAtOnce(), (r) => [
      ["data-rasterised reads \"pending\" straight after start()", r.value === "pending"],
    ], (r) => `straight after start() it read ${JSON.stringify(r.value)}`],

    ["dawn, start() alone (control): ready, and a resize rebuilds it", () => dead("start"), (r) => [
      ["data-rasterised reached ready", r.valuesBefore.includes("ready")],
      ["a resize took it back to pending", r.afterResize.includes("pending")],
      ["and then to ready again", r.afterResize.lastIndexOf("ready") > r.afterResize.indexOf("pending") && r.afterResize.includes("pending")],
      ["no error was thrown", !r.thrown],
    ], (r) => `values to the resize ${JSON.stringify(r.valuesBefore)}; after it ${JSON.stringify(r.afterResize)}; glow pictures asked for after the resize: ${r.glowAsksAfterResize}`],

    ["dawn, start() then destroy() in the same task: never ready, and a resize does not rebuild it", () => dead("start-destroy"), (r) => [
      ["data-rasterised never read ready", !r.values.includes("ready")],
      ["the resize left data-rasterised as it was", r.afterResize.every((v) => v === r.atResize)],
      ["the resize asked for no glow pictures", r.glowAsksAfterResize === 0],
      ["no error was thrown", !r.thrown],
    ], (r) => `values ${JSON.stringify(r.values)}; at the resize ${JSON.stringify(r.atResize)}, after it ${JSON.stringify(r.afterResize)}; glow pictures asked for after the resize: ${r.glowAsksAfterResize}`],

    ["dawn, start() after destroy(): never ready, and a resize does not rebuild it", () => dead("destroy-start"), (r) => [
      ["data-rasterised never read ready", !r.values.includes("ready")],
      ["the resize left data-rasterised as it was", r.afterResize.every((v) => v === r.atResize)],
      ["the resize asked for no glow pictures", r.glowAsksAfterResize === 0],
      ["no error was thrown", !r.thrown],
    ], (r) => `values ${JSON.stringify(r.values)}; at the resize ${JSON.stringify(r.atResize)}, after it ${JSON.stringify(r.afterResize)}; glow pictures asked for after the resize: ${r.glowAsksAfterResize}`],

    [`light() twice, destroy() ${TWO_GAP} ms after the second: no body.loading left, nothing lit or opened`, () => twoLights(TWO_GAP, TWO_CHECKS, TWO_WATCH), (r) => [
      ["destroy() was called", r.destroyedAt !== null],
      ...r.loading.map((l) => [`body.loading is off at ${l.at} ms`, !l.on]),
      ["body.lit is not set", !r.lit && r.litAt === null],
      ["neither light called onLit or onOpen", r.called.length === 0],
      ["the watch ran past the 13 s backstop", r.end >= 15000],
      ["no error was thrown (by the call, or uncaught after it)", !r.thrown && r.errors.length === 0],
    ], (r) => `destroyed at ${r.destroyedAt} ms (body.loading just before: ${r.loadingBefore}); body.loading ${JSON.stringify(r.loading)}; lit at ${r.litAt}; callbacks ${JSON.stringify(r.called)}; end ${r.end}`],

    [`light() twice, destroy() ${RING_GAP} ms after the second, the ring up: body.loading is taken off`, () => twoLights(RING_GAP, [1000], 2000), (r) => [
      ["the ring was up when destroy() came (body.loading was on)", r.loadingBefore === true],
      ["destroy() was called", r.destroyedAt !== null],
      ...r.loading.map((l) => [`body.loading is off at ${l.at} ms`, !l.on]),
      ["no error was thrown (by the call, or uncaught after it)", !r.thrown && r.errors.length === 0],
    ], (r) => `destroyed at ${r.destroyedAt} ms (body.loading just before: ${r.loadingBefore}); body.loading ${JSON.stringify(r.loading)}; callbacks ${JSON.stringify(r.called)}`],
  ];

  for (const [name, go, wants, show] of scenarios) {
    let got = null;
    const problems = [];
    try {
      got = await go();
      problems.push(...got.problems);
    } catch (e) { problems.push(`${e.message.split("\n")[0]}`); }
    const r = got?.r;
    if (r) {
      if (r.thrown) problems.push(`the call threw: ${r.thrown}`);
      for (const e of r.errors) problems.push(`uncaught: ${e}`);
      if (r.waited) problems.push(r.waited);
      for (const [what, ok] of wants(r)) if (!ok) problems.push(`want: ${what} -- it is not so`);
    }
    console.log(`${problems.length ? "FAIL" : "ok  "} ${name}`);
    if (r) console.log(`       ${show(r)}`);
    for (const p of problems) console.log(`       problem: ${p}`);
    if (problems.length) failed = true;
  }
} catch (e) {
  console.log(`FAIL dawn test: ${e.message.split("\n")[0]}`);
  failed = true;
} finally {
  await browser?.close().catch(() => {});
  server?.kill();
}
process.exit(failed ? 1 : 0);
