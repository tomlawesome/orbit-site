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
 *       starts drawing (early, its frame 30) and once later in the climb (late, its frame 90). Within 360 of the
 *       flight's frames (6 s of its own time) after the loss the 2D fallback must be drawing the sky: judged on the 2D canvas (#warp) alone, in a
 *       screenshot with only that canvas showing (everything else on the page hidden), by the share of the window's
 *       pixels that differ (by more than 24 in a channel) from the screenshot's most common colour ("drawn"; a blank
 *       sky is one colour). Samples are taken at fixed frames after the loss (SAMPLE_AT), counting only those taken
 *       while the flight is under way (body has showwarp, not instrument: the arrival scene is drawn too). A frame is
 *       judged only where #warp alone tells the two controls apart: their pictures of #warp at that frame of their
 *       flights differ in at least GAP_FLOOR of the window's pixels (by more than 24 in a channel; in a WebGL flight
 *       #warp holds only the background layer, and early in the climb the door's Earth), and at least MIN_JUDGED
 *       frames must be. At each judged frame the loss case's #warp must be drawn (the share above, at least half of
 *       the 2D control's at that frame), moving as the 2D control moved, and its picture must differ from the WebGL
 *       control's picture at that frame by at least half of the gap between the two controls' pictures: it is the 2D
 *       flight, not the blank sky or the WebGL one. Whether a frame is judged is not decided by a count of one
 *       colour's pixels, so how a browser shades a gradient sky does not matter. The console must show no uncaught
 *       error (a page error).
 *       Controls: before the loss the flight was drawing in WebGL (draw calls on #warpgl during the climb, counted by
 *       an init script wrapping the draw calls) and the flight was still under way (body not yet `bare`); the loss took
 *       (isContextLost()); and two flights on their own pages, stepped frame for frame as the loss case is: an
 *       undisturbed WebGL flight (F0w), and a flight that STARTS after a loss at the door, which today is already drawn
 *       by the 2D fallback (F0d). At the early loss's frame both must show a drawn, moving sky with both canvases showing
 *       (over 0.5% drawn, over 0.2% changing in the next 24 frames); if not, the measure is wrong, not the code.
 *
 *   PLAYWRIGHT_ROOT=<playwright package dir> BROWSER=firefox HEADED=1 WEBGL=required LIBGL_ALWAYS_SOFTWARE=1 \
 *     xvfb-run -a -s "-screen 0 1280x800x24" node tools/ci/flight-context-loss-test.mjs
 *
 * (or `sh tools/ci/journey-local.sh`'s environment: Firefox headed under Xvfb with software GL; headless draws no
 * world). The page is forced to the live door (`?preview&door3d&gpu=force&level=2`, CAPABILITIES.md) with the lean weight
 * (`&lean`) and the flight world's speed test not run (`&fit=skip`: the world is taken as fit, `flight world: on (fitness
 * skipped)`), so no runner timing decides which path the flight takes (owner decision 2026-10-14: CI runners have no GPU
 * and shared CPUs, so software-GL timings prove nothing; speed is judged on real browsers).
 *
 * Nothing judged depends on how fast the runner draws: from just before the click on #gate the page's clock is the
 * test's (the init script holds performance.now and requestAnimationFrame, the only clock the journey, its beats and
 * the flight keep: journey.js journeyClock, engine.js createFlight), and the test steps it 1000/60 ms a frame, a few
 * frames at a time with the page's own frames between, as docs-sky-portrait-live-test.mjs steps its flight. Every
 * moment judged (the loss, each sample, each control's measure) is a frame count from the flight's first frame (the first
 * after the click whose body shows showwarp: the journey's warp beat, which starts the flight), the same in every run,
 * and each screenshot waits for the canvases' CSS fades to finish. Waits for a state (the console, the loss's
 * event) have generous deadlines that only catch a hang. The window is small (400x250) only to keep software GL's draw
 * cost down. The kept probe is seeded as in door-lows-test.mjs. A run that cannot be judged (no WebGL2, the flight world
 * not on, the climb already over at the loss) says so and fails, rather than passing for nothing. The whole run has its
 * own deadline (DEADLINE_MS, default 8 minutes).
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
const MOVED = 0.002;          /* the share of the window that must change in MOVE_FRAMES for the sky to count as drawn live */
const DRAWN = 0.005;          /* the share of the window that must differ from the sky's plain colour to count as drawn */
const MOVE_FRAMES = 24;       /* 0.4 s of the flight's time */
/* the share of the window's pixels (differing by more than 24 in a channel) in which the two controls' #warp pictures
   must differ for a frame to be judged. Measured at frames 36-54: 0.20-0.32 in Chromium, 0.28-0.46 in Firefox; two
   pictures of the same sky differ in none. 0.15 is under every measured gap with room for another shading, and a gap
   that small still leaves half of it (0.075, some 15 times DRAWN) for the loss picture to show against the WebGL one */
const GAP_FLOOR = 0.15;
/* the moments judged, in the page's frames (1000/60 ms each) counted from the flight's first (the first frame after the
   click whose body shows the flight's canvas, showwarp: the journey's warp beat, which starts the flight; within
   WARP_BY frames of the click): the loss comes LOSS_AFTER frames into the flight; after it, the #warp samples */
const WARP_BY = 600;
const LOSS_AFTER = { early: 30, late: 90 };
const SAMPLE_AT = [6, 12, 18, 24, 36, 48, 60, 90, 120, 180, 240, 300, 360];
/* the fewest sample frames a loss case must be judged at, for drawn and for movement: a working fallback is judged at 7
   (early) and 8 (late) of them today, all for both; one that draws once and stops or ends the flight is judged at 1 */
const MIN_JUDGED = 6;
const STEP_CHUNK = 4;
/* each loss case's frames of the flight: the loss's own, then its samples */
const lossSamples = Object.values(LOSS_AFTER).map((l) => [l, ...SAMPLE_AT.map((k) => l + k)]);
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
   the flight's), the draw calls on the flight's context (#warpgl), the kept probe seeded (CAPABILITIES.md) before
   the page reads it, and the page's clock, real until __hold() and then the test's: performance.now() stands still and
   requestAnimationFrame only queues, until __frames(n) moves it n frames of 1000/60 ms, running the queue once a frame
   (an error thrown there is thrown again on its own, so the console still shows it as a page error). */
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
  const realNow = performance.now.bind(performance);
  const realFrame = window.requestAnimationFrame.bind(window), realCancel = window.cancelAnimationFrame.bind(window);
  let held = false, T = 0, queue = [], ids = 0;
  performance.now = () => (held ? T : realNow());
  window.requestAnimationFrame = (fn) => { if (!held) return realFrame(fn); queue.push([--ids, fn]); return ids; };
  window.cancelAnimationFrame = (id) => { if (id < 0) queue = queue.filter(([k]) => k !== id); else realCancel(id); };
  window.__frame = 0;
  window.__hold = () => { if (!held) { T = realNow(); held = true; } };
  window.__frames = (n) => {
    for (let i = 0; i < n; i++) {
      T += 1000 / 60; window.__frame++;
      const q = queue; queue = [];
      for (const [, fn] of q) try { fn(T); } catch (e) { setTimeout(() => { throw e; }); }
    }
    return window.__frame;
  };
  /* two of the page's real frames, and every CSS fade on the flight's canvases finished: what is drawn is on screen */
  window.__settle = async () => {
    await new Promise((ok) => realFrame(() => realFrame(ok)));
    const fades = ["warp", "warpgl"].flatMap((id) => document.getElementById(id)?.getAnimations() ?? []);
    await Promise.all(fades.map((a) => a.finished.catch(() => {})));
  };
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

/* the page's clock moved to frame `to` since the click, a few frames at a time with the page's own frames between (all
   at once, hundreds of frames of software-GL drawing would reach the GPU process as one task) */
const frameNow = (page) => page.evaluate(() => window.__frame);
const stepTo = async (page, to) => {
  for (let at = await frameNow(page); at < to;) {
    at = await page.evaluate((k) => window.__frames(k), Math.min(STEP_CHUNK, to - at));
    await page.evaluate(() => window.__settle());
  }
};
/* one frame at a time until `ok(state)` or frame `max`: the state after the frame that met it, or the last */
const stepUntil = async (page, read, ok, max) => {
  let v = await read();
  while (!ok(v) && (await frameNow(page)) < max) {
    await page.evaluate(() => window.__frames(1));
    v = await read();
  }
  return v;
};

/* a screenshot of the flight's canvases alone (`ids`): everything else on the page hidden (visibility: hidden on the
   body, put back at once), taken once the canvases' fades have finished, so the HTML text and pictures over the sky
   cannot make a blank sky look drawn */
const grab = async (page, ids) => {
  await page.evaluate(() => window.__settle());
  const set = (on) => page.evaluate(([hide, ids]) => {
    document.body.style.visibility = hide ? "hidden" : "";
    for (const id of ["warp", "warpgl"]) { const e = document.getElementById(id); if (e) e.style.visibility = hide ? (ids.includes(id) ? "visible" : "hidden") : ""; }
  }, [on, ids]);
  await set(true);
  try { return (await page.screenshot()).toString("base64"); } finally { await set(false); }
};
/* `share`: the share of the first screenshot's pixels that differ (by more than 24 in a channel) from its most common
   colour (a blank sky is one colour all over, 0; stars and a planet are not). `moved`: the share of pixels that differ
   (by more than 24) between the two (a canvas that went blank and kept its last picture is not blank, but it is still) */
const judge = (page, one, two = one) => page.evaluate(async ([x, y]) => {
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
const canvases = (page) => page.evaluate(() => ["warp", "warpgl"].map((id) => { const e = document.getElementById(id); return e ? `${id} ${getComputedStyle(e).display}/opacity ${getComputedStyle(e).opacity}` : `${id} absent`; }).join(", "));
const isDrawn = (look) => look.share > DRAWN && look.moved > MOVED;
const show = (look) => `drawn ${look.share.toFixed(3)}, moving ${look.moved.toFixed(3)}`;

/* a page at the door with the flight's world on, the gate open */
const atGate = async (page, what) => {
  const ok = await page.evaluate(() => !!document.createElement("canvas").getContext("webgl2"));
  if (!ok) throw new Error(`no WebGL2 in ${BROWSER} here (headed Firefox under Xvfb with software GL is needed): the flight is never drawn`);
  await page.goto(`${SITE}?${LIVE}&lean&fit=skip`, { waitUntil: "load" });
  await page.waitSaid(/flight world: (on|off)/, 150000, `${what}: the flight world's verdict`);
  if (!page.said(/flight world: on/).length) throw new Error(`${what}: the flight's world is not on although fit=skip was asked (${page.said(/flight world:/)[0].text.slice(0, 100)})`);
  await page.waitForFunction(() => !!document.querySelector("#gate") && document.body.classList.contains("lit"), null, { timeout: 90000 });
  await page.waitSaid(/flight: ready/, 150000, `${what}: the flight readied`);
  await sleep(2000);
};
/* the click on #gate, the page's clock held from just before it: frame 0 */
const clickGate = async (page) => {
  await page.evaluate(() => window.__hold());
  await page.locator("#gate").click();
};
/* frame 0 of the flight, in frames since the click */
const toWarp = async (page, what) => {
  const c = await stepUntil(page, () => bodyClass(page), (k) => /\bshowwarp\b/.test(k), WARP_BY);
  if (!/\bshowwarp\b/.test(c)) throw new Error(`${what}: the flight never started (no showwarp on the body within ${WARP_BY} frames of the click)`);
  return frameNow(page);
};
const draws = (page) => page.evaluate(() => window.__flightDraws);
const bodyClass = (page) => page.evaluate(() => document.body.className);
const isBare = (c) => /\bbare\b/.test(c);
/* the flight is under way while the body shows the flight's canvas (showwarp) and the instrument has not arrived */
const underWayNow = (c) => /\bshowwarp\b/.test(c) && !/\binstrument\b/.test(c);

const loseFlightContext = (page) => page.evaluate(() => window.__gls.filter((g) => g.canvas.id === "warpgl" && !g.gl.isContextLost()).map(({ gl }) => {
  const ext = gl.getExtension("WEBGL_lose_context");
  if (!ext) return "no WEBGL_lose_context";
  ext.loseContext();
  return gl.isContextLost();
}));
/* the loss's event has reached the page (the world says it is off) before the clock moves on, so the frame the flight
   first meets the loss is the same in every run */
const lossSaid = async (page, what) => {
  const n = await until(async () => page.said(/context was lost/).length, (k) => k > 0, 10000, 50);
  if (!n) throw new Error(`${what}: the page never said its flight context was lost (no "context was lost" within 10 s)`);
};

/* ── the WebGL control flight: when it starts drawing in WebGL fixes every frame judged below ───────────────────── */
const webglControl = async () => {
  const what = "WebGL control flight";
  const { ctx, page } = await open();
  try {
    await atGate(page, what);
    await clickGate(page);
    const start = await toWarp(page, what);
    const drawsAtWarp = await draws(page);
    progress(`${what}: the flight started at frame ${start} after the click`);
    const got = await controlSamples(page, what, start);
    return { start, ...got, draws: (await draws(page)) - drawsAtWarp, errors: page.errors.slice() };
  } finally { await ctx.close(); }
};
/* ── the 2D control flight: started after a loss at the door, stepped to the same frames ────────────────────────── */
const twoDControl = async () => {
  const what = "2D control flight";
  const { ctx, page } = await open();
  try {
    await atGate(page, what);
    const lost = await loseFlightContext(page);
    if (!lost.length || !lost.every((x) => x === true)) throw new Error(`${what}: the loss did not take on the flight's context at the door (${JSON.stringify(lost)})`);
    await lossSaid(page, what);
    await clickGate(page);
    const start = await toWarp(page, what);
    const drawsAtWarp = await draws(page);
    progress(`${what}: the flight started at frame ${start} after the click`);
    const got = await controlSamples(page, what, start);
    return { start, ...got, draws: (await draws(page)) - drawsAtWarp, lost, errors: page.errors.slice() };
  } finally { await ctx.close(); }
};
/* a control's measures: at the early loss's frame, both canvases (drawn, and moving over MOVE_FRAMES) and each alone;
   then #warp alone, and whether the flight is under way, at every frame a loss case is sampled at */
const controlSamples = async (page, what, start) => {
  const at = start + LOSS_AFTER.early;
  await stepTo(page, at);
  const cls = await bodyClass(page);
  if (!underWayNow(cls)) throw new Error(`${what}: not under way at frame ${LOSS_AFTER.early} of the flight, where the early loss comes (body: ${cls})`);
  const one = await grab(page, ["warp", "warpgl"]);
  const warp = await judge(page, await grab(page, ["warp"])), warpgl = await judge(page, await grab(page, ["warpgl"]));
  const parts = `warp alone: drawn ${warp.share.toFixed(3)}; warpgl alone: drawn ${warpgl.share.toFixed(3)}; ${await canvases(page)}`;
  /* keyed by the frame of the flight (since its frame 0) */
  const frames = [...new Set([LOSS_AFTER.early + MOVE_FRAMES, ...lossSamples.flat()])].sort((a, b) => a - b);
  const warpAt = new Map(), pics = new Map();
  let look = null;
  for (const f of frames) {
    await stepTo(page, start + f);
    if (f === LOSS_AFTER.early + MOVE_FRAMES) look = await judge(page, one, await grab(page, ["warp", "warpgl"]));
    const c = await bodyClass(page);
    const pic = await grab(page, ["warp"]);
    pics.set(f, pic);
    warpAt.set(f, { share: (await judge(page, pic)).share, live: underWayNow(c), pic });
    if (look && !underWayNow(c)) break;
  }
  /* #warp alone's movement between each loss case's samples, one to the next (the loss's own frame first) */
  const movedAt = new Map();
  for (const seq of lossSamples) {
    for (let i = 1; i < seq.length; i++) {
      if (pics.has(seq[i - 1]) && pics.has(seq[i])) movedAt.set(`${seq[i - 1]}>${seq[i]}`, (await judge(page, pics.get(seq[i - 1]), pics.get(seq[i]))).moved);
    }
  }
  return { ...look, warp, parts, warpAt, movedAt };
};

/* ── the flight whose context is lost part way up ────────────────────────────────────────────────────────────────── */
const lostMidFlight = async (notes, when, need, needMove, controlsLive) => {
  const { ctx, page } = await open();
  try {
    await atGate(page, `${when} loss flight`);
    await clickGate(page);
    const start = await toWarp(page, `${when} loss flight`);
    const drawsAtWarp = await draws(page);
    const loseAt = LOSS_AFTER[when];
    /* part way up: the flight has drawn on #warpgl since the click, and the sky is not yet bare */
    await stepTo(page, start + loseAt);
    const drew = await draws(page);
    const cls = await bodyClass(page);
    const result = { loseAt, drewInWebgl: drew > drawsAtWarp + 5, underWay: !isBare(cls) && underWayNow(cls) };
    if (!result.drewInWebgl || !result.underWay) { result.cls = cls; result.errors = page.errors.slice(); return result; }
    const lost = await loseFlightContext(page);
    Object.assign(result, { lost, bodyAtLoss: cls, drawsBefore: drew });
    if (!lost.length) return result;
    await lossSaid(page, `${when} loss`);
    progress(`${when} loss: the flight's context lost at its frame ${loseAt} (${start + loseAt} after the click; body: ${cls}); stepping the flight on`);
    /* #warp alone at the loss's frame and at each sample frame after it, against the controls at that same frame:
       drawn as the 2D control's is, differing from the WebGL control's picture, and moving since the sample before as
       the 2D control moved between the same two frames. Every frame the
       controls can judge must pass, not the best of them: with the clock stepped no first frame is late, and a fallback
       that draws once and stops, or only late, fails */
    const samples = [], judged = [];
    let prev = await grab(page, ["warp"]), prevF = loseAt;
    for (const k of SAMPLE_AT) {
      const f = loseAt + k;
      await stepTo(page, start + f);
      const c = await bodyClass(page);
      const pic = await grab(page, ["warp"]);
      const { share } = await judge(page, pic);
      const { moved } = await judge(page, prev, pic);
      const pair = `${prevF}>${f}`;
      prev = pic; prevF = f;
      const live = underWayNow(c);
      const n = await need(page, f), mwant = needMove(pair);
      if (!live) {
        /* the loss flight may end only where the controls' flights have ended too */
        const early = controlsLive(f);
        samples.push(`+${k}: flight over${early ? " WHILE BOTH CONTROLS ARE STILL UNDER WAY" : ", not counted"}`);
        if (early) result.endedEarly = { k, body: c };
        break;
      }
      if (n === null) { samples.push(`+${k}: drawn ${share.toFixed(3)}, moved ${moved.toFixed(3)} (the controls cannot tell 2D here)`); continue; }
      const want = n.drawn, differ = (await judge(page, pic, n.w)).moved;
      const ok = share >= want && differ >= n.differ && (mwant === null || moved >= mwant);
      judged.push({ k, share, want, differ, dwant: n.differ, moved, mwant, ok });
      samples.push(`+${k}: drawn ${share.toFixed(3)} / ${want.toFixed(3)} (${share >= want ? "+" : ""}${(share - want).toFixed(3)}), differs from F0w ${differ.toFixed(3)} / ${n.differ.toFixed(3)} (${differ >= n.differ ? "+" : ""}${(differ - n.differ).toFixed(3)}), moved ${moved.toFixed(3)} / ${mwant === null ? "not judged, the 2D control is still here" : `${mwant.toFixed(3)} (${moved >= mwant ? "+" : ""}${(moved - mwant).toFixed(3)})`}${ok ? "" : " FAILS"}`);
    }
    const counted = judged.length, firstFail = judged.find((j) => !j.ok) ?? null;
    result.margins = counted ? { drawn: Math.min(...judged.map((j) => j.share - j.want)), differ: Math.min(...judged.map((j) => j.differ - j.dwant)), moved: Math.min(...judged.filter((j) => j.mwant !== null).map((j) => j.moved - j.mwant)) } : null;
    Object.assign(result, { counted, movedCounted: judged.filter((j) => j.mwant !== null).length, firstFail });
    notes.push(`${when} loss at frame ${loseAt} of the flight, #warp alone at frames after it (got / needed, margin): ${samples.join(", ")}; body then: ${await bodyClass(page)}; ${await canvases(page)}`);
    result.drawsAfter = await draws(page);
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
  const control = await webglControl();
  notes.push(`F0w undisturbed WebGL flight, started at frame ${control.start} after the click, at its frame ${LOSS_AFTER.early}: ${show(control)}, ${control.draws} WebGL draw call(s) on #warpgl; ${control.parts}`);
  want(isDrawn(control), `control F0w: an undisturbed WebGL flight shows no drawn, moving sky mid-climb (${show(control)}; want drawn above ${DRAWN}, moving above ${MOVED}), so the measure is wrong`);
  const two = await twoDControl();
  notes.push(`F0d flight started after a loss (2D), started at frame ${two.start} after the click, at its frame ${LOSS_AFTER.early}: ${show(two)}, ${two.draws} WebGL draw call(s) on #warpgl, loss ${JSON.stringify(two.lost)}; ${two.parts}`);
  want(isDrawn(two), `control F0d: a flight started after a context loss (drawn in 2D today) shows no drawn, moving sky mid-climb (${show(two)}; want drawn above ${DRAWN}, moving above ${MOVED}), so the measure is wrong`);
  /* the 2D fallback is judged on #warp alone, against this run's own controls at the same frame. A frame counts only
     where both controls were under way and their #warp pictures differ in at least GAP_FLOOR of the window (early in
     the climb a WebGL flight still shows the door's Earth on #warp, which can make them alike). There the loss case
     must be drawn as at least half of the 2D control (F0d) is, and differ from the WebGL control's (F0w) picture by at
     least half the gap between the controls' pictures */
  const gaps = new Map();
  const need = async (page, f) => {
    const d = two.warpAt.get(f), w = control.warpAt.get(f);
    if (!d?.live || !w?.live) return null;
    if (!gaps.has(f)) gaps.set(f, (await judge(page, d.pic, w.pic)).moved);
    const gap = gaps.get(f);
    return gap >= GAP_FLOOR ? { gap, drawn: 0.5 * d.share, differ: 0.5 * gap, w: w.pic } : null;
  };
  /* the movement a loss case's #warp must show between two of its samples: half what the 2D control's showed between
     the same two frames, where that control moved at all (over MOVED) */
  const needMove = (pair) => {
    const m = two.movedAt.get(pair);
    return m !== undefined && m > MOVED ? 0.5 * m : null;
  };
  const controlsLive = (f) => !!(two.warpAt.get(f)?.live && control.warpAt.get(f)?.live);
  const table = (r) => [...r.warpAt].map(([f, v]) => `${f}: ${v.share.toFixed(3)}${v.live ? "" : " (over)"}`).join(", ");
  notes.push(`#warp alone by frame of the flight, F0w: ${table(control)}`);
  notes.push(`#warp alone by frame of the flight, F0d: ${table(two)}`);
  /* the loss part way up the climb: soon after the flight starts drawing (early), and later in the climb (late) */
  for (const when of ["early", "late"]) {
    const r = await lostMidFlight(notes, when, need, needMove, controlsLive);
    want(r.drewInWebgl, `control (${when} loss): the flight drew nothing in WebGL on #warpgl by its frame ${r.loseAt}, so there was no WebGL flight to lose`);
    want(r.underWay, `control (${when} loss): the flight was not under way at its frame ${r.loseAt}, where the loss comes (body: ${r.cls}), so the loss was not mid-flight`);
    if (r.drewInWebgl && r.underWay) {
      want(Array.isArray(r.lost) && r.lost.length > 0 && r.lost.every((x) => x === true), `control (${when} loss): the loss did not take on the flight's context (${JSON.stringify(r.lost)})`);
      if (r.lost?.length) {
        want(!r.endedEarly, `the flight whose context was lost mid-flight (${when} in the climb) was over ${r.endedEarly?.k} frames after the loss (body: ${r.endedEarly?.body}), while both control flights were still under way at that frame`);
        want(r.counted >= MIN_JUDGED, `control (${when} loss): the sky after the loss was judged at ${r.counted} sample frame(s), want at least ${MIN_JUDGED} (frames where the flight was under way and the controls' #warp pictures differ in at least ${GAP_FLOOR}), so the 2D takeover was not judged through the flight`);
        want(r.movedCounted >= MIN_JUDGED, `control (${when} loss): the sky's movement after the loss was judged at ${r.movedCounted} sample frame(s), want at least ${MIN_JUDGED} (frames where the 2D control moved over ${MOVED}), so a still picture could pass`);
        notes.push(`${when} loss, judged at ${r.counted} sample frame(s) for drawn and ${r.movedCounted} for movement (at least ${MIN_JUDGED} each)`);
        const b = r.firstFail;
        want(r.counted === 0 || !b, `the flight canvas area is not drawn and moving in every frame after the context was lost mid-flight (${when} in the climb): #warp alone ${b?.k} frames after the loss drawn ${b?.share.toFixed(3)} where it needs ${b?.want.toFixed(3)} (half the 2D control's at that frame) and differs from the WebGL control's picture in ${b?.differ.toFixed(3)} where it needs ${b?.dwant.toFixed(3)} (half the gap between the controls' pictures), moved ${b?.moved.toFixed(3)} since the sample before where it needs ${b?.mwant === null ? "(not judged)" : b?.mwant.toFixed(3)} (half the 2D control's between the same frames)`);
        if (r.margins) notes.push(`${when} loss, smallest margin over the judged frames: drawn ${r.margins.drawn.toFixed(3)}, differ from F0w ${r.margins.differ.toFixed(3)}, moved ${Number.isFinite(r.margins.moved) ? r.margins.moved.toFixed(3) : "not judged"}`);
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
