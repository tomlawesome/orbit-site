/*
 * Live test for three small defects in the live 3D door (audit 4, lows), written from the specification alone and
 * judged through what a visitor's browser shows: computed opacity, the console, the network, and which pictures and
 * programs reach which WebGL context.
 *
 *   L1  a lost context gives the door its pictures back: with the live door drawing the Earth on its canvas, the
 *       canvas's context is lost (WEBGL_lose_context.loseContext()); the Earth's and the limb's pictures
 *       (#door .world svg.wl.earth, svg.wl.limb) must become visible again (computed opacity above 0) within 10 s.
 *       Controls: before the loss the door was live (canvas.wl.live, opacity above 0, the Earth drawn on it: over 5%
 *       of its box changes in a screenshot when the canvas is hidden) and the pictures hidden (opacity 0); the loss took
 *       (isContextLost()).
 *   L2  the door retries a map whose download dropped, as the flight does: the first request for
 *       img/dawn/clouds-near.webp (a map both the door and the flight put on their contexts) is held until the door has
 *       begun putting its maps on its own context (or 20 s), then fails (503); later requests go through. A second
 *       request must have been made by the time the door is live, and the map must reach the door's context (an upload
 *       of that picture to the context of #door canvas.wl) within 20 s of the door going live. Control: with no failure
 *       the map is requested once and reaches the door's context.
 *       Why held: unheld, the failure and the flight's own retry are over before the live door asks for its maps, and
 *       it is handed the retried copy. Held, the door has asked for it when it fails (a download that drops after a
 *       stall). The probe kept in localStorage (CAPABILITIES.md: 7 days, keyed by the user agent, the screen and the
 *       pixel ratio) is seeded to say compiles are in the background, so the live door starts at the reveal's end rather
 *       than late, after every journey is ready (Firefox's own probe says "page thread").
 *   L3  a second journey still gets the door's rich Earth: on a door whose weight is rich (the console's `door: weight
 *       rich` and `door: live (rich)`), the first flight up from the
 *       gate draws the rich Earth. The visitor comes back to the door (Back: the descent onto the dawn), the host
 *       remounts its journey (journey.destroy() and a new door.journey(), readied as main.js readies one: warm({ prove:
 *       false }), then warm() at leisure), and the visitor flies again: the second flight must draw the rich Earth too.
 *       Control: the first flight draws it.
 *       The sign of "the flight draws the rich Earth": a draw call on the flight's context (#warpgl) during the climb
 *       (from the click on #gate until body.bare) with a program whose shaders `#define HAS_PASSES` (PERFORMANCE.md:
 *       `sceneHead({ slab: true })` defines HAS_PASSES; the lean head does not), recorded by an init script wrapping
 *       WebGL2RenderingContext's shaderSource, attachShader, linkProgram, useProgram and draw calls. The console's
 *       `flight: rich Earth compiled` lines are printed beside it, not judged.
 *       No speed verdict is waited on (owner decision 2026-10-14: CI runners have no GPU and shared CPUs, so software-GL
 *       timings prove nothing; speed is judged on real browsers). The door's weight is forced by the address flag `&rich`
 *       (the rich door is kept whatever its frames cost: door3d.js, RICH()), and the flight world's speed test is not run by
 *       `&fit=skip` (the world is taken as fit: voyage.js). So the weight line is `door: weight rich` and the first world's
 *       is `flight world: on (fitness skipped)`, on any runner. The kept probe is still seeded (as in L2) so that the probe has
 *       worked (the level and the flags need it), not to get a weight. The window is small (480x300 by default, L3_WIDTH and
 *       L3_HEIGHT) only to keep software GL's draw cost down. Note: with `&rich` the weight is "rich", not "both" (lean first,
 *       then the rich tried): "both" can only be had by a probe seeded to predict the rich Earth in a band, and the rich is
 *       then kept only on a measured frame time, which is the runner's speed.
 *       The site keeps one journey for the page, so the remount is a seam: main.js is served with its journey made a
 *       `let` and a `__remountJourney()` added at its end, nothing else changed (a single-page host remounts its door's
 *       journey when its component unmounts: assets/door/README.md, journey.destroy()). Explored by hand on this host
 *       on 2026-10-13: a second flight on the same journey, unremounted, does draw the rich Earth.
 *
 *   PLAYWRIGHT_ROOT=<playwright package dir> BROWSER=firefox HEADED=1 WEBGL=required LIBGL_ALWAYS_SOFTWARE=1 \
 *     xvfb-run -a -s "-screen 0 1280x800x24" node tools/ci/door-lows-test.mjs [L1|L2|L3 ...]
 *
 * Firefox headed under Xvfb with software GL: headless draws no world. Every case forces the live door at level 2
 * (`?preview&door3d&gpu=force&level=2`, CAPABILITIES.md; L3 adds `&rich&fit=skip`). A case that cannot be judged says so and fails, rather than
 * passing for nothing. The whole run has its own deadline (DEADLINE_MS, default 15 minutes).
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:net";

const playwright = createRequire(import.meta.url)(process.env.PLAYWRIGHT_ROOT || "playwright");
const BROWSER = process.env.BROWSER || "firefox";
const DEADLINE_MS = Number(process.env.DEADLINE_MS || 15 * 60e3);
const ONLY = process.argv.slice(2);
/* a port nobody holds: other live tests and other checkouts share this host */
const PORT = await new Promise((ok, no) => {
  const probe = createServer();
  probe.on("error", no);
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => ok(port)); });
});
const SITE = `http://127.0.0.1:${PORT}/`;
const LIVE = "preview&door3d&gpu=force&level=2";
/* L3: the door's weight and the flight world's fitness are forced, so no runner timing decides the path taken */
const FORCED = `${LIVE}&rich&fit=skip`;
const here = dirname(fileURLToPath(import.meta.url));

const server = spawn(process.execPath, [join(here, "serve.mjs"), String(PORT)], { stdio: ["ignore", "ignore", "inherit"] });
const results = [];
let browser = null;
const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(0);
const progress = (msg) => console.log(`  .. ${secs()}s ${msg}`);

const deadline = setTimeout(() => {
  console.log(`FAIL door-lows-test: the run's deadline (${DEADLINE_MS / 1000} s) passed`);
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

const runCase = async (id, name, fn) => {
  if (ONLY.length && !ONLY.includes(id.replace(/[a-z]+$/, "")) && !ONLY.includes(id)) return;
  const start = Date.now();
  const problems = [], notes = [];
  const want = (ok, msg) => { if (!ok) problems.push(msg); };
  want.note = (msg) => notes.push(msg);
  console.log(`---- ${id} ${name}`);
  try { await fn(want); } catch (e) { problems.push(`could not be judged: ${String(e.message || e).split("\n")[0]}`); }
  console.log(`${problems.length ? "FAIL" : "ok  "} ${id} ${name} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
  for (const n of notes) console.log(`       ${id}: (${n})`);
  for (const p of problems) console.log(`       ${id}: ${p}`);
  results.push({ id, problems });
};

/* The recorder, in every page before its own scripts. It keeps:
   - __gls: every WebGL context made, with its canvas (so a test can lose the door's);
   - __uploads["door|flight|other <picture>"]: pictures put on a context (texImage2D / texSubImage2D), the picture named
     by its address under img/ (followed through fetch -> blob/arrayBuffer -> createImageBitmap, or an image's src);
   - __draws["door|flight|other <program>"]: draw calls by program, a program named "rich" when its shaders
     `#define HAS_PASSES`, else "p<n>"; and __programs, each program's name and source length.
   "door" is a context on a canvas.wl (the live door's, put in #door after its first uploads), "flight" one on #warpgl.
   It can also seed the kept probe (CAPABILITIES.md) before the page reads it. */
const RECORD = ([seed]) => {
  /* seeded once: a test that reseeds in the page and reloads keeps its own */
  try {
    if (seed && !Object.keys(localStorage).some((k) => k.startsWith("orbit-probe"))) {
      const v = JSON.stringify({ t: Date.now(), r: { background: seed.background, compileMs: 60, msPerMpx: seed.msPerMpx, ok: true } });
      for (const s of [`${screen.width}x${screen.height}`, `${innerWidth}x${innerHeight}`]) localStorage.setItem(`orbit-probe ${navigator.userAgent} ${s}@${devicePixelRatio}`, v);
    }
  } catch { /* no storage on this document */ }
  const tag = new WeakMap();
  const name = (u) => String(u).replace(/^.*\/img\//, "").replace(/[?#].*$/, "");
  const where = (canvas) => (canvas?.classList?.contains("wl") ? "door" : canvas?.id === "warpgl" ? "flight" : "other");
  window.__gls = [];
  window.__uploads = {};
  window.__draws = {};
  window.__programs = [];
  const fetch0 = window.fetch;
  window.fetch = async function (input, ...rest) {
    const res = await fetch0.call(this, input, ...rest);
    const url = name(typeof input === "string" ? input : input?.url);
    for (const m of ["blob", "arrayBuffer"]) {
      const orig = res[m].bind(res);
      res[m] = async () => { const v = await orig(); try { tag.set(v, url); } catch { /* not an object */ } return v; };
    }
    return res;
  };
  const cib = window.createImageBitmap;
  window.createImageBitmap = async function (src, ...rest) {
    const b = await cib.call(this, src, ...rest);
    const u = (src && tag.get(src)) || (src?.src && name(src.src));
    if (u) tag.set(b, u);
    return b;
  };
  const make = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const gl = make.call(this, type, ...rest);
    if (gl && /webgl/.test(String(type)) && !window.__gls.some((g) => g.gl === gl)) window.__gls.push({ canvas: this, gl });
    return gl;
  };
  const sources = new WeakMap(), attached = new WeakMap(), label = new WeakMap(), current = new WeakMap();
  let n = 0;
  for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!C) continue;
    const P = C.prototype;
    const wrap = (k, f) => { const orig = P[k]; if (typeof orig === "function") P[k] = function (...a) { return f.call(this, orig, a); }; };
    for (const k of ["texImage2D", "texSubImage2D"]) wrap(k, function (orig, a) {
      const src = a.find((x) => x && typeof x === "object" && !ArrayBuffer.isView(x));
      const u = src && (tag.get(src) || (src.currentSrc && name(src.currentSrc)) || (src.src && name(src.src)));
      if (u) { const key = `${where(this.canvas)} ${u}`; window.__uploads[key] = (window.__uploads[key] || 0) + 1; }
      return orig.apply(this, a);
    });
    wrap("shaderSource", function (orig, a) { sources.set(a[0], String(a[1])); return orig.apply(this, a); });
    wrap("attachShader", function (orig, a) { const l = attached.get(a[0]) || []; l.push(a[1]); attached.set(a[0], l); return orig.apply(this, a); });
    wrap("linkProgram", function (orig, a) {
      const src = (attached.get(a[0]) || []).map((s) => sources.get(s) || "").join("\n");
      const id = /#define\s+HAS_PASSES\b/.test(src) ? `rich#${++n}` : `p${++n}`;
      label.set(a[0], id);
      window.__programs.push(`${where(this.canvas)} ${id} (${src.length} chars)`);
      return orig.apply(this, a);
    });
    wrap("useProgram", function (orig, a) { current.set(this, a[0]); return orig.apply(this, a); });
    for (const k of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced", "drawRangeElements"]) wrap(k, function (orig, a) {
      const key = `${where(this.canvas)} ${label.get(current.get(this)) || "unnamed"}`;
      window.__draws[key] = (window.__draws[key] || 0) + 1;
      return orig.apply(this, a);
    });
  }
};

/* a context with the recorder (and the probe seeded, if asked), and a page on it with its console kept */
const open = async ({ viewport = { width: 1280, height: 800 }, seed = null } = {}) => {
  const ctx = await browser.newContext({ viewport, reducedMotion: "no-preference" });
  await ctx.addInitScript(RECORD, [seed]);
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
const webgl2 = (page) => page.evaluate(() => !!document.createElement("canvas").getContext("webgl2"));
const needWebgl = async (page) => {
  if (!(await webgl2(page))) throw new Error(`no WebGL2 in ${BROWSER} here (headed Firefox under Xvfb with software GL is needed): the live door is never drawn`);
};

/* ── L1: a lost context gives the door its pictures back ─────────────────────────────────────────────────────── */
const opacities = (page) => page.evaluate(() => {
  const op = (s) => { const e = document.querySelector(s); return e ? Number(getComputedStyle(e).opacity) : null; };
  const c = document.querySelector("#door canvas.wl");
  return { earth: op("#door .world svg.wl.earth"), limb: op("#door .world svg.wl.limb"), canvas: op("#door canvas.wl"), live: !!c?.classList.contains("live") };
});
/* what the door's canvas adds to what the visitor sees: the share of pixels in its box that differ (by more than 24 in
   a channel) between a screenshot as it is and one with the canvas hidden (visibility: hidden, put back at once) */
const canvasShare = async (page) => {
  const box = await page.locator("#door canvas.wl").boundingBox();
  if (!box || box.width < 4 || box.height < 4) return null;
  const shot = async () => (await page.screenshot({ clip: box })).toString("base64");
  const shown = await shot();
  await page.evaluate(() => { document.querySelector("#door canvas.wl").style.visibility = "hidden"; });
  let hidden;
  try { hidden = await shot(); } finally { await page.evaluate(() => { document.querySelector("#door canvas.wl").style.visibility = ""; }); }
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
    let differ = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 24) differ++;
    return differ / (a.length / 4);
  }, [shown, hidden]);
};

const lostCase = async () => {
  await runCase("L1", "a lost context gives the door its Earth and limb pictures back", async (want) => {
    const { ctx, page } = await open();
    try {
      await needWebgl(page);
      await page.goto(`${SITE}?${LIVE}&lean`, { waitUntil: "load" });
      await page.waitSaid(/door: live/, 150000, "the live door");
      await sleep(2000);
      const before = await opacities(page);
      const shareBefore = await canvasShare(page);
      want(before.live && before.canvas > 0, `control: the door's canvas is not live and shown before the loss (${JSON.stringify(before)})`);
      want(before.earth === 0 && before.limb === 0, `control: the pictures were not hidden while the door was live (earth ${before.earth}, limb ${before.limb})`);
      want(shareBefore !== null && shareBefore > 0.05, `control: the door's canvas adds nothing to the screen before the loss (${shareBefore} of its box differs with it hidden), so the live Earth is not drawn on it`);
      const lost = await page.evaluate(() => window.__gls.filter((g) => g.canvas.matches("#door canvas.wl") && !g.gl.isContextLost()).map(({ gl }) => {
        const ext = gl.getExtension("WEBGL_lose_context");
        if (!ext) return "no WEBGL_lose_context";
        ext.loseContext();
        return gl.isContextLost();
      }));
      want(lost.length > 0 && lost.every((x) => x === true), `control: the loss did not take on the door's canvas context (${JSON.stringify(lost)})`);
      if (!lost.length) return;
      progress("L1: the door's context lost; waiting for its pictures");
      const after = await until(() => opacities(page), (o) => o.earth > 0 && o.limb > 0, 10000, 200);
      const shareAfter = await canvasShare(page).catch(() => null);
      want.note(`before: ${JSON.stringify(before)}, canvas shows ${shareBefore?.toFixed(3)} of its box; 10 s after the loss: ${JSON.stringify(after)}, canvas shows ${shareAfter?.toFixed?.(3)} of its box`);
      want(after.earth > 0, `the Earth's pictures (#door .world svg.wl.earth) are still hidden 10 s after the context was lost: opacity ${after.earth}, want above 0`);
      want(after.limb > 0, `the limb's picture (#door .world svg.wl.limb) is still hidden 10 s after the context was lost: opacity ${after.limb}, want above 0`);
      want(!page.errors.length, `page error: ${page.errors[0]}`);
    } finally { await ctx.close(); }
  });
};

/* ── L2: the door retries a map whose download dropped ───────────────────────────────────────────────────────── */
const MAP = "dawn/clouds-near.webp";
const mapCase = async (fail) => {
  const id = fail ? "L2" : "L2c";
  const title = fail ? `the door retries ${MAP} after its download dropped, and puts it on its context` : `control: ${MAP} undisturbed is fetched once and put on the door's context`;
  await runCase(id, title, async (want) => {
    const { ctx, page } = await open({ seed: { background: true, msPerMpx: 300 } });
    try {
      await needWebgl(page);
      let hits = 0, failedAt = 0;
      await page.route(`**/assets/door/img/${MAP}`, async (route) => {
        hits++;
        if (!fail || hits > 1) return route.continue();
        /* held until the door has begun putting its maps on its own context, then dropped */
        await until(() => page.evaluate(() => Object.keys(window.__uploads).some((k) => /^door (dawn|flight)\//.test(k))).catch(() => true), (v) => v, 20000, 250);
        failedAt = Date.now();
        progress(`${id}: the first request for ${MAP} fails now`);
        return route.fulfill({ status: 503, body: "" });
      });
      await page.goto(`${SITE}?${LIVE}&lean`, { waitUntil: "load" });
      await page.waitSaid(/probe: .*\(stored\)/, 60000, `${id} the seeded probe`);
      await page.waitSaid(/door: live/, 150000, `${id} the live door`);
      const hitsAtLive = hits;
      const onDoor = () => page.evaluate((m) => window.__uploads[`door ${m}`] || 0, MAP);
      const ups = await until(onDoor, (n) => n > 0, 20000, 250);
      const all = await page.evaluate(() => window.__uploads);
      want.note(`requests for ${MAP}: ${hits} (${hitsAtLive} when the door went live); put on the door's context ${ups} time(s), on the flight's ${all[`flight ${MAP}`] || 0}; ${fail ? (failedAt ? "the first request failed" : "the first request never failed") : "undisturbed"}`);
      if (fail) {
        want(failedAt > 0, `control: the first request for ${MAP} was never failed (${hits} request(s))`);
        want(hitsAtLive >= 2, `no second request for ${MAP} by the time the door was live (${hitsAtLive} request(s))`);
        want(ups > 0, `the door never put ${MAP} on its own context within 20 s of going live (the flight put it on its own ${all[`flight ${MAP}`] || 0} time(s)): the door draws without it`);
      } else {
        want(hits === 1, `control: ${MAP} was requested ${hits} time(s) undisturbed, want 1`);
        want(ups > 0, `control: the door never put ${MAP} on its own context undisturbed, so the upload record cannot show it`);
      }
      want(!page.errors.length, `page error: ${page.errors[0]}`);
    } finally { await ctx.close(); }
  });
};

/* ── L3: a second journey still gets the door's rich Earth ───────────────────────────────────────────────────── */
const SEAM = "const journey = door.journey({";
const remountTry = async (want) => {
  const W = Number(process.env.L3_WIDTH || 480), H = Number(process.env.L3_HEIGHT || 300);
  /* (the probe is seeded to have worked, not to give a weight: &rich says the weight) */
  const { ctx, page } = await open({ viewport: { width: W, height: H }, seed: { background: false, msPerMpx: 1100 } });
  try {
    await needWebgl(page);
    await ctx.route("**/assets/js/main.js", async (route) => {
      const res = await route.fetch();
      const body = await res.text();
      if (!body.includes(SEAM)) return route.fulfill({ status: 500, body: "door-lows-test: the seam is not in main.js" });
      await route.fulfill({
        response: res,
        body: body.replace(SEAM, "let journey = door.journey(globalThis.__journeyOptions = {") +
          "\n/* door-lows-test's seam: the host remounts its journey */\nglobalThis.__remountJourney = () => { journey.destroy(); journey = door.journey(globalThis.__journeyOptions); journey.warm({ prove: false }); journey.later(() => journey.warm(), { after: 2000 }); };\n",
      });
    });
    await page.goto(`${SITE}?${FORCED}`, { waitUntil: "load" });
    await page.waitSaid(/door: weight/, 60000, "L3: the door's weight");
    const weight = page.said(/door: weight/)[0].text;
    if (!/door: weight rich/.test(weight)) throw new Error(`the door's weight is not rich although &rich was asked: ${weight.slice(0, 120)}`);
    await page.waitSaid(/door: live \((lean|rich)\)/, 180000, "L3: the live door");
    if (!page.said(/door: live \(rich\)/).length) throw new Error(`the door is not live rich although &rich was asked (${page.said(/door: (lean|rich) /).map((m) => m.text.slice(0, 60)).join(" | ")})`);
    await page.waitSaid(/flight world: (on|off)/, 120000, "L3: the first world's verdict");
    if (!page.said(/flight world: on/).length) throw new Error(`the flight's world is not taken as fit although fit=skip was asked (${page.said(/flight world:/)[0].text.slice(0, 80)})`);
    await until(async () => page.said(/flight: rich Earth compiled/).length, (k) => k > 0, 30000, 250);
    await page.waitForFunction(() => !!document.querySelector("#gate") && document.body.classList.contains("lit"), null, { timeout: 60000 });
    await sleep(3000);
    const draws = () => page.evaluate(() => ({ ...window.__draws }));
    const delta = (a, b) => Object.fromEntries(Object.entries(b).filter(([k, v]) => k.startsWith("flight ") && v !== (a[k] || 0)).map(([k, v]) => [k.slice(7), v - (a[k] || 0)]));
    const richOf = (d) => Object.entries(d).filter(([k]) => k.startsWith("rich")).reduce((s, [, v]) => s + v, 0);
    const climb = async (k) => {
      const a = await draws();
      await page.locator("#gate").click();
      const bare = await until(() => page.evaluate(() => document.body.className), (c) => /\bbare\b/.test(c), 45000, 100);
      if (!/\bbare\b/.test(bare)) throw new Error(`flight ${k} never reached the bare sky (body: ${bare})`);
      const d = delta(a, await draws());
      progress(`L3: flight ${k} climbed; the flight's draws by program: ${JSON.stringify(d)}`);
      await until(() => page.evaluate(() => document.body.className), (c) => /\binstrument\b/.test(c), 20000, 200);
      await sleep(2000);
      return d;
    };
    const first = await climb(1);
    const richCompiled1 = page.said(/flight: rich Earth compiled/).length;
    /* back to the door (the descent onto the dawn), then the host remounts its journey */
    await page.evaluate(() => history.back());
    const atDoor = await until(() => page.evaluate(() => ({ cls: document.body.className, shown: document.querySelector("#door").classList.contains("shown") })),
      (s) => s.shown && /\bat-door\b/.test(s.cls) && /\blit\b/.test(s.cls) && !/showdawn|dispersing|farewell|withdrawing|showwarp|launching/.test(s.cls), 60000, 200);
    if (!atDoor.shown) throw new Error(`the descent never landed back on the door (body: ${atDoor.cls})`);
    progress(`L3: back at the door; remounting the journey`);
    await sleep(2000);
    const linesAtRemount = page.log.length;
    await page.evaluate(() => globalThis.__remountJourney());
    const verdict = await until(async () => page.log.slice(linesAtRemount).find((m) => /flight world: (on|off)/.test(m.text))?.text, (v) => !!v, 90000, 250);
    if (!verdict) throw new Error("the remounted journey's world was never proved (no 'flight world:' line within 90 s of the remount)");
    if (!/flight world: on/.test(verdict)) throw new Error(`the remounted journey's world is not taken as fit although fit=skip was asked (${verdict.slice(0, 80)})`);
    progress(`L3: the remounted journey's world: ${verdict.slice(0, 60)}`);
    await sleep(10000);
    const second = await climb(2);
    const richCompiled2 = page.said(/flight: rich Earth compiled/).length - richCompiled1;
    const drawn2 = Object.values(second).reduce((s, v) => s + v, 0);
    want.note(`${W}x${H}; ${weight.slice(0, 100)}; first flight's draws ${JSON.stringify(first)}; second's ${JSON.stringify(second)}; 'flight: rich Earth compiled' lines: ${richCompiled1} before the first flight, ${richCompiled2} after the remount`);
    want(richOf(first) > 0, `control: the first flight drew no rich Earth on #warpgl (draws by program ${JSON.stringify(first)}), so the sign says nothing`);
    want(drawn2 > 0, "control: the second flight drew nothing on #warpgl, so its world was not drawn at all");
    want(richOf(second) > 0, `the second flight (after the journey was remounted) drew no rich Earth on #warpgl: draws by program ${JSON.stringify(second)}, the first flight's ${JSON.stringify(first)}; the clouds change at the hand-off`);
    want(!page.errors.length, `page error: ${page.errors[0]}`);
  } finally { await ctx.close(); }
};
const remountCase = async () => {
  await runCase("L3", "a second journey (the host's journey remounted) still draws the door's rich Earth", async (want) => {
    await remountTry(want);
  });
};

try {
  await new Promise((ok, no) => {
    const start = Date.now();
    (async function poll() {
      try { await fetch(SITE); ok(); } catch { Date.now() - start > 10000 ? no(new Error("server did not start")) : setTimeout(poll, 100); }
    })();
  });
  browser = await playwright[BROWSER].launch(process.env.HEADED === "1" ? { headless: false } : {});
  /* one at a time: each measures frames, and the host is shared */
  await lostCase();
  await mapCase(false);
  await mapCase(true);
  await remountCase();
} catch (e) {
  console.log(`FAIL door-lows-test: ${String(e.message || e).split("\n")[0]}`);
  results.push({ id: "setup", problems: [String(e.message || e)] });
} finally {
  clearTimeout(deadline);
  await browser?.close().catch(() => {});
  server.kill();
}

const bad = results.filter((r) => r.problems.length);
console.log(bad.length ? `\ndoor-lows-test: failed (${bad.map((r) => r.id).join(", ")})` : "\ndoor-lows-test: ok");
process.exit(bad.length ? 1 : 0);
