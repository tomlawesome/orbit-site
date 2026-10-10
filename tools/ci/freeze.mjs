/*
 * Live test for #2 ("the door freezes on software-GL machines"), written from ADR-0002's specification alone
 * (docs/adr/0002-the-door-tests-the-gpu-once-per-visit.md, section 3): the door tests the GPU once, before any WebGL,
 * refuses a software renderer, and then does nothing on the page that freezes it.
 *
 * Chromium, always (long tasks are Chromium's), headed under Xvfb with software GL and the blocklist ignored, so the
 * browser offers a software WebGL2 context instead of none: the machine the bug is on. The site is the real page, `/`,
 * served by tools/ci/serve.mjs (`/`; with `?preview` added while index.html carries data-maintenance, as journey.mjs
 * does, because the notice's door takes no click). Motion is left on. Everything is seen from outside: an init script wraps
 * HTMLCanvasElement.prototype.getContext to record each WebGL call's type and attributes, with the door's and the
 * body's classes at that moment; a PerformanceObserver records long tasks; the console, the requests and
 * localStorage are read as a visitor's browser has them.
 *
 *   PLAYWRIGHT_ROOT=<playwright package dir> HEADED=1 LIBGL_ALWAYS_SOFTWARE=1 \
 *     xvfb-run -a -s "-screen 0 1280x800x24" node tools/ci/freeze.mjs
 *
 * (sh tools/ci/journey-local.sh freeze does exactly that. BROWSER is ignored: this check is Chromium's.)
 *
 * The run fails loudly, and does not pass vacuously, if the browser's WebGL2 is not a software renderer: its
 * renderer is read first and logged.
 *
 * What it checks (the ADR's numbers):
 *   1-4  software GL, `/`: one webgl2 call, with the caveat, after #door.shown and before body.lit; no long task
 *        over 50 ms in the 10 s after lit and at most one, under 1 s, before; the refusal in one console line, no
 *        console.error, no flight pictures, no #warpgl, nothing kept in localStorage; then a click on the gate flies
 *        on the 2D canvas (showwarp, then bare, within 20 s) with no further webgl2 context
 *   5    ?gpu=force: a webgl2 context without the caveat, #warpgl, and the install world logs `install: ready`
 *   6    ?door3d without force: no probe runs, and the `level 0` line is there
 *   7    save-data: no webgl2 context until the gate is clicked, then one
 *   11   journey.later: not called before `after`; a descent or a flight started first drops it (tests/gate.html)
 *   12   the speculative warm makes no readPixels; the proved one does (tests/gate.html)
 * Behaviours 8 (the real-GPU control) and 9 (frameCost) are in tools/ci/gpu-gate-test.mjs and by hand.
 *
 * Timing margins are wide: a shared runner is slow. Software GL is slow here by design, so a wait is spent in full
 * only when something is wrong.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:net";

const playwright = createRequire(import.meta.url)(process.env.PLAYWRIGHT_ROOT || "playwright");
/* a port nobody holds: the other live tests and other checkouts on a shared host have their own */
const PORT = await new Promise((ok, no) => {
  const probe = createServer();
  probe.on("error", no);
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => ok(port)); });
});
const SITE = `http://127.0.0.1:${PORT}/`;
const here = dirname(fileURLToPath(import.meta.url));
let maintenance = false;
/* the page with its query: while index.html carries data-maintenance the door stands alone and the gate does nothing,
   so (as tools/ci/journey.mjs does) ?preview past it is the site a visitor flies; "/" otherwise */
const at = (params = [], hash = "") => {
  const all = maintenance ? ["preview", ...params] : params;
  return SITE + (all.length ? "?" + all.join("&") : "") + hash;
};
const SOFTWARE = /llvmpipe|softpipe|swiftshader|microsoft basic render/i;

const server = spawn(process.execPath, [join(here, "serve.mjs"), String(PORT)], { stdio: ["ignore", "ignore", "inherit"] });
let failed = false;
let browser = null;

/* The recorder, in every page before any of its own script runs. */
const RECORD = () => {
  const rec = (window.__freeze = { gl: [], long: [], seen: {}, startedAt: performance.now() });
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (/webgl/.test(String(type))) {
      rec.gl.push({
        at: performance.now(), type: String(type), attrs: attrs ? JSON.parse(JSON.stringify(attrs)) : null,
        doorShown: !!document.getElementById("door")?.classList.contains("shown"),
        lit: !!document.body?.classList.contains("lit"),
      });
    }
    return getContext.call(this, type, attrs);
  };
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) rec.long.push({ start: e.startTime, dur: e.duration }); })
      .observe({ type: "longtask", buffered: true });
  } catch { rec.noLongTasks = true; }
  /* the first moment each class we care about was on */
  const look = () => {
    const now = performance.now();
    const door = document.getElementById("door");
    if (door?.classList.contains("shown")) rec.seen.shown ??= now;
    if (document.getElementById("warpgl")) rec.seen.warpgl ??= now;
    for (const c of ["lit", "showwarp", "bare"]) if (document.body?.classList.contains(c)) rec.seen[c] ??= now;
  };
  new MutationObserver(look).observe(document, { subtree: true, attributes: true, attributeFilter: ["class"], childList: true });
  addEventListener("DOMContentLoaded", look);
};

/* One page in its own context, with the console, errors and requests logged. */
const open = async ({ init = [], viewport = { width: 1280, height: 800 } } = {}) => {
  const ctx = await browser.newContext({ viewport, reducedMotion: "no-preference" });
  const page = await ctx.newPage();
  const log = { console: [], errors: [], requests: [] };
  page.on("console", (m) => { log.console.push({ type: m.type(), text: m.text() }); if (m.type() === "error") log.errors.push(`console.error: ${m.text()}`); });
  page.on("pageerror", (e) => log.errors.push(`pageerror: ${e.message}`));
  page.on("request", (r) => log.requests.push(r.url()));
  await page.addInitScript(RECORD);
  for (const s of init) await page.addInitScript(s);
  return { ctx, page, log };
};
const state = (page) => page.evaluate(() => ({ ...window.__freeze, now: performance.now() }));
const waitBody = (page, cls, timeout) => page.waitForFunction((c) => document.body.classList.contains(c), cls, { timeout });
const gateOpen = (page, timeout) => page.waitForFunction(() => { const g = document.querySelector("#gate"); return g && !g.disabled; }, null, { timeout });
const clickGate = (page) => page.evaluate(() => { const t = performance.now(); document.querySelector("#gate").click(); return t; });
const webgl2 = (s) => s.gl.filter((c) => c.type === "webgl2");
const said = (log, re) => log.console.filter((c) => re.test(c.text));

/* A scenario: a name, and a function that states what must be so with want(); a throw is a problem too. */
const only = process.env.FREEZE_ONLY ? new RegExp(process.env.FREEZE_ONLY) : null;   /* FREEZE_ONLY='^12' runs one */
const scenario = async (name, fn) => {
  if (only && !only.test(name)) return;
  const problems = [];
  const info = [];
  const want = (ok, what) => { if (!ok) problems.push(`want: ${what}`); };
  try { await fn(want, (line) => info.push(line)); } catch (e) { problems.push(`${String(e.message).split("\n")[0]}`); }
  console.log(`${problems.length ? "FAIL" : "ok  "} ${name}`);
  for (const line of info) console.log(`       ${line}`);
  for (const p of problems) console.log(`       problem: ${p}`);
  if (problems.length) failed = true;
};
const short = (s) => JSON.stringify(s).slice(0, 400);

try {
  await new Promise((ok, no) => {
    const t0 = Date.now();
    (async function poll() {
      try { await fetch(SITE); ok(); } catch { Date.now() - t0 > 10000 ? no(new Error("server did not start")) : setTimeout(poll, 100); }
    })();
  });
  maintenance = /<html[^>]*\sdata-maintenance/.test(await (await fetch(SITE)).text());
  if (maintenance) console.log("     (maintenance mode: the pages below are visited with ?preview, past the notice)");
  /* software GL, the blocklist ignored: Chromium then offers a software WebGL2 context rather than none */
  browser = await playwright.chromium.launch({ headless: false, args: ["--ignore-gpu-blocklist", "--enable-gpu"] });

  /* ---- is this machine the one the bug is on? Read it, say it, and refuse to run if not ---- */
  {
    const { ctx, page } = await open();
    const r = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) return { none: true };
      const e = gl.getExtension("WEBGL_debug_renderer_info");
      return { renderer: String(e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) };
    });
    await ctx.close();
    console.log(`     chromium ${browser.version()}; WebGL2 renderer: ${r.none ? "none" : r.renderer}`);
    if (r.none) throw new Error("freeze: this Chromium has no WebGL2 at all (use headed under Xvfb, LIBGL_ALWAYS_SOFTWARE=1): the checks would pass vacuously");
    if (!SOFTWARE.test(r.renderer)) throw new Error(`freeze: the renderer ${JSON.stringify(r.renderer)} is not a software one: the checks would pass vacuously; run on a machine without a GPU (or under Xvfb with LIBGL_ALWAYS_SOFTWARE=1)`);
  }

  /* ---- 1 to 4: software GL, the real page ---- */
  {
    const { ctx, page, log } = await open();
    await scenario("1-3 software GL: one gated context, no long tasks after the light, the refusal said once and nothing else touches WebGL", async (want, info) => {
      await page.goto(at(), { waitUntil: "load" });
      await waitBody(page, "lit", 90000);
      /* 10 s after the light */
      await page.waitForTimeout(10500);
      const s = await state(page);
      const gl2 = webgl2(s);
      info(`webgl2 getContext calls: ${short(gl2)}; seen at ${short(s.seen)}`);

      /* 1: exactly one webgl2 call, with the caveat, after #door.shown and before body.lit */
      want(gl2.length === 1, `exactly one webgl2 getContext call on the page -- there were ${gl2.length}`);
      const c = gl2[0];
      if (c) {
        want(c.attrs?.failIfMajorPerformanceCaveat === true, `that call has failIfMajorPerformanceCaveat: true -- its attributes are ${short(c.attrs)}`);
        want(c.doorShown && !c.lit, `it comes after #door.shown and before body.lit -- door shown ${c.doorShown}, lit ${c.lit}`);
      }
      want(s.gl.length === gl2.length, `no other kind of WebGL context (webgl, experimental-webgl) -- ${short(s.gl.filter((g) => g.type !== "webgl2"))}`);

      /* 2: long tasks */
      if (s.noLongTasks) throw new Error("this Chromium has no longtask observer");
      const lit = s.seen.lit;
      const after = s.long.filter((t) => t.start >= lit && t.start <= lit + 10000);
      const before = s.long.filter((t) => t.start < lit);
      info(`long tasks after the light (10 s): ${short(after.map((t) => Math.round(t.dur)))} ms; before it: ${short(before.map((t) => Math.round(t.dur)))} ms`);
      want(after.length === 0, `no long task over 50 ms in the 10 s after body.lit -- ${after.length} (${short(after.map((t) => Math.round(t.dur)))} ms)`);
      want(before.length <= 1 && before.every((t) => t.dur < 1000), `before body.lit at most one long task, under 1000 ms -- ${before.length} (${short(before.map((t) => Math.round(t.dur)))} ms)`);

      /* 3: the console, the requests, the page, the storage */
      const refusal = said(log, /orbit · flight world: off: software renderer \(/);
      want(refusal.length === 1, `one console line matching "orbit · flight world: off: software renderer (" -- ${refusal.length}`);
      want(log.errors.length === 0, `no console.error or page error -- ${short(log.errors)}`);
      const flight = log.requests.filter((u) => /assets\/door\/img\/flight\//.test(u));
      want(flight.length === 0, `no request for assets/door/img/flight/* -- ${short(flight)}`);
      want(s.seen.warpgl === undefined && (await page.locator("#warpgl").count()) === 0, "no #warpgl canvas, ever");
      const keys = await page.evaluate(() => Object.keys(localStorage));
      info(`localStorage keys: ${short(keys)}`);
      want(!keys.includes("orbit-flight-fitness"), "no orbit-flight-fitness key in localStorage");
      want(!keys.some((k) => k.startsWith("orbit-probe")), `no "orbit-probe ..." key in localStorage -- ${short(keys.filter((k) => k.startsWith("orbit-probe")))}`);
    });

    await scenario("4 software GL: the gate flies on the 2D canvas, with no further WebGL context", async (want, info) => {
      await gateOpen(page, 60000);
      const clickedAt = await clickGate(page);
      try { await waitBody(page, "bare", 20000); } catch { /* reported below */ }
      const s = await state(page);
      info(`seen at ${short(s.seen)}; clicked at ${Math.round(clickedAt)}; webgl2 calls ${webgl2(s).length}`);
      want(s.seen.showwarp !== undefined, "body gets showwarp after the click");
      want(s.seen.bare !== undefined && s.seen.bare - clickedAt < 20000, `body gets bare within 20 s of the click -- ${s.seen.bare === undefined ? "never" : Math.round(s.seen.bare - clickedAt) + " ms"}`);
      want(s.seen.showwarp === undefined || s.seen.bare === undefined || s.seen.showwarp <= s.seen.bare, "showwarp first, then bare");
      want(webgl2(s).length === 1, `still one webgl2 context -- ${webgl2(s).length}`);
      want(log.errors.length === 0, `no console.error or page error through the flight -- ${short(log.errors)}`);
    });
    await ctx.close();
  }

  /* ---- 5: ?gpu=force on the same machine ---- */
  {
    const { ctx, page, log } = await open();
    await scenario("5 ?gpu=force: a webgl2 context without the caveat, and #warpgl", async (want, info) => {
      await page.goto(at(["gpu=force"]), { waitUntil: "load" });
      await waitBody(page, "lit", 90000);
      const s = await state(page);
      const gl2 = webgl2(s);
      info(`webgl2 getContext calls: ${short(gl2.map((g) => g.attrs))}`);
      want(gl2.length >= 1, "a webgl2 context is made");
      want(gl2.some((g) => g.attrs?.failIfMajorPerformanceCaveat !== true), `a webgl2 context without the caveat attribute -- ${short(gl2.map((g) => g.attrs))}`);
      want(!gl2.some((g) => g.attrs?.failIfMajorPerformanceCaveat === true), "none asked with the caveat: force skips the check");
      /* #warpgl: the flight's world drawing surface; the warm-up makes it at leisure, else the click does */
      const warpgl = (timeout) => page.waitForFunction(() => window.__freeze.seen.warpgl !== undefined, null, { timeout });
      let how = "at leisure";
      try { await warpgl(60000); }
      catch {
        how = "after the click";
        try { await gateOpen(page, 60000); await clickGate(page); await warpgl(60000); }
        catch { want(false, "#warpgl exists, at leisure or once the gate is clicked, within 60 s of each"); how = "never"; }
      }
      info(`#warpgl: ${how}`);
      want(log.errors.length === 0, `no console.error or page error -- ${short(log.errors)}`);
    });
    await ctx.close();
  }
  {
    const { ctx, page, log } = await open();
    await scenario("5 ?gpu=force#install: the install world logs install: ready", async (want, info) => {
      await page.goto(at(["gpu=force"], "#install"), { waitUntil: "load" });
      const t0 = Date.now();
      while (!said(log, /install: ready/).length && Date.now() - t0 < 120000) await page.waitForTimeout(250);
      want(said(log, /install: ready/).length >= 1, "the install world logs 'install: ready' within 120 s");
      info(`console: ${short(log.console.filter((c) => /orbit|install/.test(c.text)).map((c) => c.text).slice(0, 8))}`);
      want(log.errors.length === 0, `no console.error or page error -- ${short(log.errors)}`);
    });
    await ctx.close();
  }

  /* ---- 6: ?door3d without force: no probe ---- */
  {
    const { ctx, page, log } = await open();
    await scenario("6 ?door3d without force on software GL: no probe runs, the level 0 line is there", async (want, info) => {
      await page.goto(at(["door3d"]), { waitUntil: "load" });
      await waitBody(page, "lit", 90000);
      const t0 = Date.now();
      while (!said(log, /orbit · level 0/).length && Date.now() - t0 < 45000) await page.waitForTimeout(250);
      await page.waitForTimeout(3000);
      info(`orbit lines: ${short(log.console.filter((c) => /^orbit/.test(c.text)).map((c) => c.text.slice(0, 90)))}`);
      want(said(log, /orbit · level 0/).length >= 1, "a console line 'orbit · level 0' is there");
      want(said(log, /orbit · probe:/).length === 0, `no 'orbit · probe:' line -- ${short(said(log, /orbit · probe:/).map((c) => c.text.slice(0, 90)))}`);
      const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("orbit-probe")));
      want(keys.length === 0, `no probe result kept -- ${short(keys)}`);
    });
    await ctx.close();
  }

  /* ---- 7: save-data ---- */
  {
    const saveData = () => Object.defineProperty(navigator, "connection", { configurable: true, get: () => ({ saveData: true, effectiveType: "4g", addEventListener() {}, removeEventListener() {} }) });
    const { ctx, page, log } = await open({ init: [saveData] });
    await scenario("7 save-data: no webgl2 context until the gate is clicked, then one", async (want, info) => {
      await page.goto(at(), { waitUntil: "load" });
      want(await page.evaluate(() => navigator.connection?.saveData === true), "the stub reports saveData (otherwise this proves nothing)");
      await waitBody(page, "lit", 90000);
      await page.waitForTimeout(10000);
      const before = webgl2(await state(page));
      info(`webgl2 calls before the click: ${short(before)}`);
      want(before.length === 0, `no webgl2 context before the gate is clicked -- ${before.length}`);
      await gateOpen(page, 60000);
      await clickGate(page);
      const t0 = Date.now();
      while (!webgl2(await state(page)).length && Date.now() - t0 < 45000) await page.waitForTimeout(250);
      await page.waitForTimeout(3000);
      const after = webgl2(await state(page));
      info(`webgl2 calls after the click: ${short(after)}`);
      want(after.length === 1, `exactly one webgl2 context after the click -- ${after.length}`);
      want(log.errors.length === 0, `no console.error or page error -- ${short(log.errors)}`);
    });
    await ctx.close();
  }

  /* ---- 11: journey.later (tests/gate.html) ---- */
  {
    const { ctx, page, log } = await open();
    await page.goto(`${SITE}tests/gate.html`, { waitUntil: "load" });
    await page.waitForFunction(() => window.gateReady, null, { timeout: 30000 });
    const later = (mode, after, watch) => page.evaluate(([m, a, w]) => window.later(m, a, w), [mode, after, watch]);
    await scenario("11 journey.later: not called before `after`, then called once", async (want, info) => {
      const r = await later("plain", 1500, 40000);
      info(`result ${short(r)}`);
      want(!r.error, `later() works -- ${r.error}`);
      want(r.returned === "function", `later() returns a stop function -- typeof ${r.returned}`);
      want(r.ran.length === 1, `fn is called once -- ${r.ran.length} times`);
      want(r.ran.length === 0 || r.ran[0] >= 1480, `fn is not called before 1500 ms -- first at ${r.ran[0]} ms`);
    });
    await scenario("11 journey.later: the returned stop() cancels it", async (want, info) => {
      const r = await later("stop", 1500, 8000);
      info(`result ${short(r)}`);
      want(!r.error, `later() works -- ${r.error}`);
      want(r.ran.length === 0, `fn is never called after stop() -- ${short(r.ran)}`);
    });
    await scenario("11 journey.later: descend() before then drops it", async (want, info) => {
      const r = await later("descend", 1500, 16000);
      info(`result ${short(r)}`);
      want(!r.error, `later() and descend() work -- ${r.error}`);
      want(r.hooks.farewell !== undefined, "the descent ran to its farewell inside the watch (else the test shows nothing)");
      want(r.ran.length === 0, `fn is never called -- ${short(r.ran)}`);
    });
    await scenario("11 journey.later: fly() before then drops it", async (want, info) => {
      const r = await later("fly", 1500, 16000);
      info(`result ${short(r)}`);
      want(!r.error, `later() and fly() work -- ${r.error}`);
      want(r.hooks.land !== undefined, "the flight ran to its landing inside the watch (else the test shows nothing)");
      want(r.ran.length === 0, `fn is never called -- ${short(r.ran)}`);
    });
    await ctx.close();
  }

  /* ---- 12: the speculative warm (tests/gate.html, ?gpu=force so the software GL is taken and the world is built) ---- */
  {
    const { ctx, page } = await open();
    await page.goto(`${SITE}tests/gate.html?gpu=force`, { waitUntil: "load" });
    await page.waitForFunction(() => window.gateReady, null, { timeout: 30000 });
    await scenario("12 warm({ prove: false }) makes no readPixels; warm() then makes them", async (want, info) => {
      const r = await page.evaluate(() => window.warmSequence());
      info(`result ${short(r)}`);
      want(!r.error, `the sequence runs -- ${r.error}`);
      want((r.afterSpeculative?.contexts ?? []).some((c) => c.type === "webgl2"), "the speculative warm took the gate's webgl2 context (else it did nothing)");
      want(r.afterSpeculative?.pixels === 0, `no readPixels after warm({ prove: false }) -- ${r.afterSpeculative?.pixels}`);
      want((r.afterProve?.pixels ?? 0) > (r.afterSpeculative?.pixels ?? 0), `warm() afterwards makes its test frames (more readPixels than before) -- ${r.afterSpeculative?.pixels} then ${r.afterProve?.pixels}`);
    });
    await ctx.close();
  }
} catch (e) {
  console.log(`FAIL freeze: ${String(e.message).split("\n")[0]}`);
  failed = true;
} finally {
  await browser?.close().catch(() => {});
  server.kill();
}
console.log(failed ? "\nfreeze: failed" : "\nfreeze: ok");
process.exit(failed ? 1 : 0);
