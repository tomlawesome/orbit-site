/*
 * Live test for a lost flight context during a flight (audit issue #21), written from the specification alone and
 * judged through what a visitor's browser shows: a screenshot of the flight's canvases, and the console.
 *
 * Specification: when the flight's WebGL context (the flight canvas, #warpgl) is lost WHILE a flight is under way
 * (after the click on #gate, before arrival), the rest of that flight must be drawn by the 2D fallback, not continue on
 * a blank sky. Later flights already go 2D after a loss and the context is restored later; only the flight in progress
 * was left blank.
 *
 *   F1  the visitor clicks #gate and the flight starts in WebGL; part way up (the flight has drawn on #warpgl, the body
 *       is not yet `bare`) the flight's context is lost (WEBGL_lose_context.loseContext()), once soon after the flight
 *       starts drawing (early) and once later in the climb (late). Within 6 s of the loss the 2D fallback must be drawing
 *       the sky: judged on the 2D canvas (#warp) alone, in a screenshot with only that canvas showing (everything else
 *       on the page hidden), by the share of the window's pixels that differ (by more than 24 in a channel) from the
 *       screenshot's most common colour ("drawn"; a blank sky is one colour). The best of the samples taken up to 6 s
 *       after the loss, counting only samples taken while the flight is under way (body has showwarp, not instrument:
 *       the arrival scene is drawn too), must reach at least half of what the 2D control (F0d) shows on #warp alone, and at least twice
 *       what the WebGL control (F0w) shows there (in a WebGL flight #warp holds only the background layer). The console
 *       must show no uncaught error (a page error).
 *       Controls: before the loss the flight was drawing in WebGL (draw calls on #warpgl during the climb, counted by
 *       an init script wrapping the draw calls) and the flight was still under way (body not yet `bare`); the loss took
 *       (isContextLost()); and two flights on their own pages, each measured mid-climb as the loss case is (about 0.5 s
 *       after the climb is drawing, body not yet `bare`): an undisturbed WebGL flight (F0w), and a flight that STARTS
 *       after a loss at the door, which today is already drawn by the 2D fallback (F0d). Both must show a drawn,
 *       moving sky with both canvases showing (over 0.5% drawn, over 0.2% changing in 0.4 s), and F0d's #warp alone
 *       must show over twice F0w's; if not, the measure is wrong, not the code.
 *
 *   PLAYWRIGHT_ROOT=<playwright package dir> BROWSER=firefox HEADED=1 WEBGL=required LIBGL_ALWAYS_SOFTWARE=1 \
 *     xvfb-run -a -s "-screen 0 1280x800x24" node tools/ci/flight-context-loss-test.mjs
 *
 * (or `sh tools/ci/journey-local.sh`'s environment: Firefox headed under Xvfb with software GL; headless draws no
 * world). The page is forced to the live door (`?preview&door3d&gpu=force&level=2`, CAPABILITIES.md) with the lean weight
 * (`&lean`) and the flight world's speed test not run (`&fit=skip`: the world is taken as fit, `flight world: on (fitness
 * skipped)`), so no runner timing decides which path the flight takes (owner decision 2026-10-14: CI runners have no GPU
 * and shared CPUs, so software-GL timings prove nothing; speed is judged on real browsers). The window is small (400x250)
 * only to keep software GL's draw cost down. The kept probe is seeded as in door-lows-test.mjs. A run that cannot be judged
 * (no WebGL2, the flight world not on, the climb already over when measured) says so and fails, rather than passing for
 * nothing. The whole run has its own deadline
 * (DEADLINE_MS, default 8 minutes).
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:net";

const playwright = createRequire(import.meta.url)(process.env.PLAYWRIGHT_ROOT || "playwright");
const BROWSER = process.env.BROWSER || "firefox";
const DEADLINE_MS = Number(process.env.DEADLINE_MS || 8 * 60e3);
const WIDTH = Number(process.env.FLIGHT_WIDTH || 400), HEIGHT = Number(process.env.FLIGHT_HEIGHT || 250);
const MOVED = 0.002;          /* the share of the window that must change in 0.4 s for the sky to count as drawn live */
const DRAWN = 0.005;          /* the share of the window that must differ from the sky's plain colour to count as drawn */
const SETTLE_MS = 6000;       /* "within a few seconds" of the loss */
/* a port nobody holds: other live tests and other checkouts share this host */
const PORT = await new Promise((ok, no) => {
  const probe = createServer();
  probe.on("error", no);
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => ok(port)); });
});
const SITE = `http://127.0.0.1:${PORT}/`;
const LIVE = "preview&door3d&gpu=force&level=2";
const here = dirname(fileURLToPath(import.meta.url));

const server = spawn(process.execPath, [join(here, "serve.mjs"), String(PORT)], { stdio: ["ignore", "ignore", "inherit"] });
let browser = null;
const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(0);
const progress = (msg) => console.log(`  .. ${secs()}s ${msg}`);

const deadline = setTimeout(() => {
  console.log(`FAIL flight-context-loss-test: the run's deadline (${DEADLINE_MS / 1000} s) passed`);
  browser?.close().catch(() => {});
  server.kill();
  process.exit(1);
}, DEADLINE_MS);

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const until = async (read, ok, ms, every = 100) => {
  const start = Date.now();
  let v = await read();
  while (!ok(v) && Date.now() - start < ms) { await sleep(every); v = await read(); }
  return v;
};

/* The recorder, in every page before its own scripts: every WebGL context made with its canvas (so the test can lose
   the flight's), the draw calls on the flight's context (#warpgl), and the kept probe seeded (CAPABILITIES.md) before
   the page reads it. */
const RECORD = ([seed]) => {
  try {
    if (seed && !Object.keys(localStorage).some((k) => k.startsWith("orbit-probe"))) {
      const v = JSON.stringify({ t: Date.now(), r: { background: seed.background, compileMs: 60, msPerMpx: seed.msPerMpx, ok: true } });
      for (const s of [`${screen.width}x${screen.height}`, `${innerWidth}x${innerHeight}`]) localStorage.setItem(`orbit-probe ${navigator.userAgent} ${s}@${devicePixelRatio}`, v);
    }
  } catch { /* no storage on this document */ }
  window.__gls = [];
  window.__flightDraws = 0;
  const make = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const gl = make.call(this, type, ...rest);
    if (gl && /webgl/.test(String(type)) && !window.__gls.some((g) => g.gl === gl)) window.__gls.push({ canvas: this, gl });
    return gl;
  };
  for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!C) continue;
    for (const k of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced", "drawRangeElements"]) {
      const orig = C.prototype[k];
      if (typeof orig !== "function") continue;
      C.prototype[k] = function (...a) {
        if (this.canvas?.id === "warpgl") window.__flightDraws++;
        return orig.apply(this, a);
      };
    }
  }
};

const open = async () => {
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, reducedMotion: "no-preference" });
  await ctx.addInitScript(RECORD, [{ background: true, msPerMpx: 300 }]);
  const page = await ctx.newPage();
  page.log = [];
  page.errors = [];
  page.on("console", (m) => page.log.push({ text: m.text(), at: Date.now() }));
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.said = (re) => page.log.filter((m) => re.test(m.text));
  page.waitSaid = async (re, ms, what) => {
    const got = await until(async () => page.said(re).length, (n) => n > 0, ms, 250);
    if (!got) throw new Error(`${what}: no console line ${re} within ${ms / 1000} s (orbit lines: ${page.log.filter((m) => /orbit/.test(m.text)).map((m) => m.text.slice(0, 80)).slice(-6).join(" | ")})`);
    progress(`${what}: ${page.said(re)[0].text.slice(0, 110)}`);
  };
  return { ctx, page };
};

/* how much of a sky is drawn on the flight's canvases, and whether it is moving. With everything else on the page hidden
   (visibility: hidden on the body, put back at once; #warp and #warpgl visible), two screenshots of the window MOVE_GAP_MS
   apart. `share`: the share of the first one's pixels that differ (by more than 24 in a channel) from its most common
   colour (a blank sky is one colour all over, 0; stars and a planet are not). `moved`: the share of pixels that differ
   (by more than 24) between the two (a canvas that went blank and kept its last picture is not blank, but it is still).
   The HTML text and pictures over the sky are hidden so they cannot make a blank or frozen sky look drawn. */
const MOVE_GAP_MS = 400;
const flightLook = async (page, ids = ["warp", "warpgl"]) => {
  const set = (on) => page.evaluate(([hide, ids]) => {
    document.body.style.visibility = hide ? "hidden" : "";
    for (const id of ["warp", "warpgl"]) { const e = document.getElementById(id); if (e) e.style.visibility = hide ? (ids.includes(id) ? "visible" : "hidden") : ""; }
  }, [on, ids]);
  await set(true);
  let one, two;
  try {
    one = (await page.screenshot()).toString("base64");
    await sleep(MOVE_GAP_MS);
    two = (await page.screenshot()).toString("base64");
  } finally { await set(false); }
  return page.evaluate(async ([x, y]) => {
    const px = async (b64) => {
      const bm = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "image/png" }));
      const c = document.createElement("canvas");
      c.width = bm.width; c.height = bm.height;
      const g = c.getContext("2d");
      g.drawImage(bm, 0, 0);
      return g.getImageData(0, 0, c.width, c.height).data;
    };
    const [a, b] = [await px(x), await px(y)];
    const count = new Map();
    for (let i = 0; i < a.length; i += 4) { const k = (a[i] << 16) | (a[i + 1] << 8) | a[i + 2]; count.set(k, (count.get(k) || 0) + 1); }
    let mode = 0, best = 0;
    for (const [k, n] of count) if (n > best) { best = n; mode = k; }
    const [mr, mg, mb] = [(mode >> 16) & 255, (mode >> 8) & 255, mode & 255];
    let differ = 0, moved = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (Math.max(Math.abs(a[i] - mr), Math.abs(a[i + 1] - mg), Math.abs(a[i + 2] - mb)) > 24) differ++;
      if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 24) moved++;
    }
    const n = a.length / 4;
    return { share: differ / n, moved: moved / n };
  }, [one, two]);
};
/* each canvas alone: the 2D canvas (#warp) shows the 2D fallback; in a WebGL flight it shows only the background layer */
const perCanvas = async (page) => {
  const looks = {};
  for (const id of ["warp", "warpgl"]) looks[id] = await flightLook(page, [id]).catch(() => ({ share: 0, moved: 0 }));
  const st = await page.evaluate(() => ["warp", "warpgl"].map((id) => { const e = document.getElementById(id); return e ? `${id} ${getComputedStyle(e).display}/opacity ${getComputedStyle(e).opacity}` : `${id} absent`; }).join(", "));
  return { warp: looks.warp, text: `warp alone: ${show(looks.warp)}; warpgl alone: ${show(looks.warpgl)}; ${st}` };
};
const isDrawn = (look) => look.share > DRAWN && look.moved > MOVED;
const show = (look) => `drawn ${look.share.toFixed(3)}, moving ${look.moved.toFixed(3)}`;

/* the climb is a race against the runner's pace, not a speed verdict: a page whose flight was already over when it was
   measured is tried again */
class TooLate extends Error {}
const TRIES = Number(process.env.FLIGHT_TRIES || 8);
const retrying = async (run) => {
  for (let n = 1; ; n++) {
    try { return await run(); } catch (e) {
      if (!(e instanceof TooLate) || n >= TRIES) throw e;
      progress(`try ${n} could not be judged (${e.message.slice(0, 90)}); trying again`);
    }
  }
};

/* a page at the door with the flight's world on, the gate open */
const atGate = async (page, what) => {
  const ok = await page.evaluate(() => !!document.createElement("canvas").getContext("webgl2"));
  if (!ok) throw new Error(`no WebGL2 in ${BROWSER} here (headed Firefox under Xvfb with software GL is needed): the flight is never drawn`);
  await page.goto(`${SITE}?${LIVE}&lean&fit=skip`, { waitUntil: "load" });
  await page.waitSaid(/flight world: (on|off)/, 150000, `${what}: the flight world's verdict`);
  if (!page.said(/flight world: on/).length) throw new Error(`${what}: the flight's world is not on although fit=skip was asked (${page.said(/flight world:/)[0].text.slice(0, 100)})`);
  await page.waitForFunction(() => !!document.querySelector("#gate") && document.body.classList.contains("lit"), null, { timeout: 90000 });
  await sleep(2000);
};
const bodyClass = (page) => page.evaluate(() => document.body.className);
const isBare = (c) => /\bbare\b/.test(c);
/* the flight is under way while the body shows the flight's canvas (showwarp) and the instrument has not arrived */
const underWayNow = (c) => /\bshowwarp\b/.test(c) && !/\binstrument\b/.test(c);

/* ── the control flights, each measured at the bare sky: undisturbed (WebGL), or started after a loss (2D) ────────── */
const loseFlightContext = (page) => page.evaluate(() => window.__gls.filter((g) => g.canvas.id === "warpgl" && !g.gl.isContextLost()).map(({ gl }) => {
  const ext = gl.getExtension("WEBGL_lose_context");
  if (!ext) return "no WEBGL_lose_context";
  ext.loseContext();
  return gl.isContextLost();
}));
const controlFlight = async (lostFirst) => {
  const what = lostFirst ? "2D control flight" : "WebGL control flight";
  const { ctx, page } = await open();
  try {
    await atGate(page, what);
    let lost = null;
    if (lostFirst) {
      lost = await loseFlightContext(page);
      if (!lost.length || !lost.every((x) => x === true)) throw new Error(`${what}: the loss did not take on the flight's context at the door (${JSON.stringify(lost)})`);
      await until(async () => page.said(/context was lost/).length, (n) => n > 0, 5000, 100);
      await sleep(500);
    }
    const drawsAtClick = await page.evaluate(() => window.__flightDraws);
    await page.locator("#gate").click();
    /* the same moment in the climb as the lost-mid-flight case is judged: the flight under way, not yet at the bare sky */
    await until(async () => (lostFirst ? 0 : await page.evaluate(() => window.__flightDraws)), (n) => lostFirst || n > drawsAtClick + 5, 20000, 40);
    await sleep(500);
    const cls = await bodyClass(page);
    const look = await flightLook(page);
    if (isBare(cls)) throw new TooLate(`${what}: already at the bare sky when measured`);
    const per = await perCanvas(page);
    return { ...look, parts: per.text, warp: per.warp, draws: (await page.evaluate(() => window.__flightDraws)) - drawsAtClick, lost, errors: page.errors.slice() };
  } finally { await ctx.close(); }
};

/* ── the flight whose context is lost part way up ────────────────────────────────────────────────────────────────── */
const lostMidFlight = async (notes, when, extraMs, need) => {
  const { ctx, page } = await open();
  try {
    await atGate(page, `${when} loss flight`);
    const drawsAtClick = await page.evaluate(() => window.__flightDraws);
    await page.locator("#gate").click();
    /* part way up: the flight has drawn on #warpgl since the click, and the sky is not yet bare */
    const drew = await until(() => page.evaluate(() => window.__flightDraws), (n) => n > drawsAtClick + 5, 20000, 40);
    const underWay = await bodyClass(page);
    await sleep(500 + extraMs);
    const cls = await bodyClass(page);
    if (extraMs && isBare(cls)) throw new TooLate(`${when} loss: already at the bare sky`);
    const result = { drewInWebgl: drew > drawsAtClick + 5, underWay: !isBare(underWay) && !isBare(cls) };
    if (!result.drewInWebgl || !result.underWay) { result.cls = cls; result.errors = page.errors.slice(); return result; }
    const drawsBefore = await page.evaluate(() => window.__flightDraws);
    const lost = await loseFlightContext(page);
    Object.assign(result, { lost, bodyAtLoss: cls, drawsBefore });
    if (!lost.length) return result;
    progress(`${when} loss: the flight's context lost (body: ${cls}); waiting for a drawn sky`);
    const start = Date.now();
    const samples = [];
    /* the 2D canvas alone, the best of the samples up to SETTLE_MS after the loss (a slow first 2D frame is allowed) */
    let best = { share: 0, moved: 0 }, counted = 0, ended = false;
    while (Date.now() - start < SETTLE_MS) {
      const before = await bodyClass(page);
      const look = await flightLook(page, ["warp"]).catch(() => ({ share: 0, moved: 0 }));
      const after = await bodyClass(page);
      /* only a sample taken wholly while the flight is under way counts: the arrival scene is drawn too */
      const live = underWayNow(before) && underWayNow(after);
      samples.push(`${((Date.now() - start) / 1000).toFixed(1)}s: ${show(look)}${live ? "" : " (flight over, not counted)"}`);
      if (!live) { ended = true; if (!underWayNow(before)) break; continue; }
      counted++;
      if (look.share > best.share) best = look;
      if (best.share >= need) break;
    }
    result.counted = counted;
    result.ended = ended;
    const per = await perCanvas(page);
    notes.push(`${when} loss, per canvas: ${per.text}`);
    notes.push(`${when} loss, #warp alone after it (needs drawn ${need.toFixed(3)}): ${samples.join(" ")}; body then: ${await bodyClass(page)}`);
    const look = best;
    result.look = look;
    result.drawsAfter = await page.evaluate(() => window.__flightDraws);
    result.errors = page.errors.slice();
    return result;
  } finally { await ctx.close(); }
};

const problems = [], notes = [];
const want = (ok, msg) => { if (!ok) problems.push(msg); };
try {
  await new Promise((ok, no) => {
    const start = Date.now();
    (async function poll() {
      try { await fetch(SITE); ok(); } catch { Date.now() - start > 10000 ? no(new Error("server did not start")) : setTimeout(poll, 100); }
    })();
  });
  browser = await playwright[BROWSER].launch(process.env.HEADED === "1" ? { headless: false } : {});
  console.log("---- F1 a flight whose WebGL context is lost part way up is finished in 2D");
  const control = await retrying(() => controlFlight(false));
  notes.push(`F0w undisturbed WebGL flight, mid-climb: ${show(control)}, ${control.draws} WebGL draw call(s) on #warpgl; ${control.parts}`);
  want(isDrawn(control), `control F0w: an undisturbed WebGL flight shows no drawn, moving sky mid-climb (${show(control)}; want drawn above ${DRAWN}, moving above ${MOVED}), so the measure is wrong`);
  const two = await retrying(() => controlFlight(true));
  notes.push(`F0d flight started after a loss (2D), mid-climb: ${show(two)}, ${two.draws} WebGL draw call(s) on #warpgl, loss ${JSON.stringify(two.lost)}; ${two.parts}`);
  want(isDrawn(two), `control F0d: a flight started after a context loss (drawn in 2D today) shows no drawn, moving sky mid-climb (${show(two)}; want drawn above ${DRAWN}, moving above ${MOVED}), so the measure is wrong`);
  /* the 2D fallback is judged on #warp alone, against this run's own controls: at least half of what the 2D control
     (F0d) shows there, and at least twice what the WebGL control (F0w) shows there (only its background layer) */
  const need = Math.max(0.5 * two.warp.share, 2 * control.warp.share);
  want(two.warp.share > 2 * control.warp.share, `control F0d: #warp alone shows no more in a 2D flight (${show(two.warp)}) than in a WebGL one (${show(control.warp)}), so #warp alone cannot tell the 2D fallback`);
  /* the loss part way up the climb: soon after the flight starts drawing (early), and later in the climb (late) */
  for (const [when, extraMs] of [["early", 0], ["late", 1000]]) {
    const r = await retrying(() => lostMidFlight(notes, when, extraMs, need));
    want(r.drewInWebgl, `control (${when} loss): the flight drew nothing in WebGL on #warpgl after the click, so there was no WebGL flight to lose`);
    want(r.underWay, `control (${when} loss): the flight was already at the bare sky before the loss (body: ${r.cls}), so the loss was not mid-flight`);
    if (r.drewInWebgl && r.underWay) {
      want(Array.isArray(r.lost) && r.lost.length > 0 && r.lost.every((x) => x === true), `control (${when} loss): the loss did not take on the flight's context (${JSON.stringify(r.lost)})`);
      if (r.lost?.length) {
        want(r.counted > 0, `control (${when} loss): the flight ended before any sample of the sky could be taken while it was under way (loss ${when} in the climb), so the 2D takeover could not be judged`);
        want(r.counted === 0 || r.look.share >= need, `the flight canvas area is still blank ${SETTLE_MS / 1000} s after the context was lost mid-flight (${when} in the climb): #warp alone, best sample ${show(r.look)}; want drawn at least ${need.toFixed(3)} (half the 2D control's ${two.warp.share.toFixed(3)}, and twice the WebGL control's ${control.warp.share.toFixed(3)})`);
        want(!r.errors.length, `page error (${when} loss): ${r.errors[0]}`);
      }
    }
  }
  want(!control.errors.length, `control flight page error: ${control.errors[0]}`);
  want(!two.errors.length, `2D control flight page error: ${two.errors[0]}`);
} catch (e) {
  problems.push(`could not be judged: ${String(e.message || e).split("\n")[0]}`);
} finally {
  clearTimeout(deadline);
  await browser?.close().catch(() => {});
  server.kill();
}
console.log(`${problems.length ? "FAIL" : "ok  "} F1`);
for (const n of notes) console.log(`       F1: (${n})`);
for (const p of problems) console.log(`       F1: ${p}`);
console.log(problems.length ? "\nflight-context-loss-test: failed (F1)" : "\nflight-context-loss-test: ok");
process.exit(problems.length ? 1 : 0);
