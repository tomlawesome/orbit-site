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
 * show while they are held, must show after, and after every one of those requests has finished. Control: unheld, it
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
 * (sh tools/ci/journey-local.sh dawn does exactly that.) BROWSER=chromium for a second engine; HEADED=1 as the other
 * live tests: Firefox has no WebGL headless here. The whole run takes about a minute: the light cases wait out the
 * backstop in real time.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const playwright = createRequire(import.meta.url)(process.env.PLAYWRIGHT_ROOT || "playwright");
const BROWSER = process.env.BROWSER || "firefox";
const PORT = 8795;
const SITE = `http://127.0.0.1:${PORT}/`;
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

const server = spawn(process.execPath, [join(here, "serve.mjs"), String(PORT)], { stdio: ["ignore", "ignore", "inherit"] });
let failed = false;
let browser = null;
try {
  await new Promise((ok, no) => {
    const t0 = Date.now();
    (async function poll() {
      try { await fetch(SITE); ok(); } catch { Date.now() - t0 > 10000 ? no(new Error("server did not start")) : setTimeout(poll, 100); }
    })();
  });
  browser = await playwright[BROWSER].launch(process.env.HEADED === "1" ? { headless: false } : {});
  /* motion left on: reduced motion may take other paths through the light */
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });

  /* each scenario on a fresh page, so no dawn inherits another's state */
  const open = async () => {
    const page = await ctx.newPage();
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

  /* hold: false for the control. Answers what the page saw, plus the Earth requests' times in the runner's clock. */
  const draw = async (hold) => {
    const { page, problems } = await open();
    try {
      const earth = [];   /* { url, asked, finished } */
      let release = () => {};
      const released = new Promise((ok) => { release = ok; });
      await page.route(EARTH, async (route) => {
        const e = { url: route.request().url().replace(/^.*\/assets\//, "assets/"), asked: Date.now(), finished: null };
        earth.push(e);
        if (hold) await released;
        await route.continue().catch(() => {});
      });
      page.on("requestfinished", (req) => {
        const e = earth.find((x) => x.url === req.url().replace(/^.*\/assets\//, "assets/") && x.finished === null);
        if (e) e.finished = Date.now();
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
      /* a moment more, so the last of the requests' finish events have arrived */
      await new Promise((ok) => setTimeout(ok, 300));
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

  const scenarios = [
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
      ["every Earth request had finished before ready", r.earth.length > 0 && r.seen.ready !== undefined && r.earth.every((e) => e.finished !== null && e.finished <= r.seen.ready)],
      ["no error was thrown", !r.thrown && r.errors.length === 0],
    ], (r) => `held ${JSON.stringify(r.earth.map((e) => e.url))}; at the end of the hold ${JSON.stringify(r.atHold)}; ready at ${r.seen.ready === undefined ? "never" : `+${r.seen.ready - r.began} ms`}, released at +${r.releasedAt - r.began} ms, requests finished at ${JSON.stringify(r.earth.map((e) => e.finished === null ? null : e.finished - r.began))}`],

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
  server.kill();
}
process.exit(failed ? 1 : 0);
