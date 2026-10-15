/*
 * Live test for #51 (the docs' sky on a phone), option B (owner, 2026-10-14), written from the specification alone and
 * judged through what a browser shows. Nothing here depends on how fast the runner draws: the speed verdict is forced
 * (`?fit=skip`; the harness page below sets flags { gpu: "force", fit: "skip" } as tools/docsky.cjs does), and every
 * check reads a computed style or the pixels of a frame, never a time.
 *
 *   S1  CSS, the page: on `?preview&fit=skip#docs`, the computed background-image of `.milky` names
 *       milkyway-sky-tall.webp on portrait screens (width / height <= 10/11, the site's threshold: 390x844 and 900x1000)
 *       and milkyway-sky.webp on landscape ones (1280x800, and 1000x1000, a square), and the picture it names is served
 *       (HTTP 200). Set to the screen's height as the wide one is: the computed background-size is `auto 100%` (or the
 *       same height in pixels), on both.
 *   F1  control: the frame is drawn at all (a frame drawn at the flight's last beat at 390x844 has a block brighter
 *       than 40, of 255); without it the checks below prove nothing.
 *   F2  the last beat at 390x844: galaxy light in the top third and in the bottom third of the frame.
 *   F3  the same frame: the brightest core region spans under 40% of the frame's width.
 *
 * The frame (F1-F3) is the docs flight's last beat, drawn the way tools/docsky.cjs draws the page's picture: a canvas the
 * size of the screen (100vw x 100vh), the engine's createFlight on it, `e.start(docsFlight(...), { at: 4790 })` (engine.js:
 * `at` pins the flight at one beat and leaves its last frame on the canvas; 4790 ms is docsky.cjs's last beat), then a
 * screenshot. No new hook is needed, but the test takes it that the flight decides "portrait" from the screen's size as
 * it sees it (the canvas at 390x844, innerWidth x innerHeight, and the chart rect docsFlight is given), as the page does.
 *
 * What the pixels are. Luminance 0.2126 R + 0.7152 G + 0.0722 B (0-255). The frame is cut into blocks 1/12 of its width
 * across (32 px at 390), and a block's value is the MEDIAN luminance of its pixels, so stars (a few bright pixels) do not
 * count as light and the glow of the galaxy does. M is the brightest block's value.
 *   galaxy light in a third: at least 40% of that third's blocks are at least 0.30 x M (a block counts if it is lit at
 *     30% of the brightest, which a haze at the sky's edge is not).
 *   the core region: the blocks at least 0.85 x M; it spans from its leftmost block to its rightmost, as a share of the
 *     frame's width.
 * How the numbers were chosen (2026-10-14, 390x844, software GL): today's last frame lights the top third 0.19 and the
 * bottom third 0.30 (at 0.30 M), and its core region spans 59% of the width, so F2 and F3 fail today. A frame with the
 * camera simply moved back along the plane (resting at 1.3 from the core, a throwaway edit, not kept) lights the top 0.00
 * and the bottom 0.04 and its core spans 42%: farther out on its own is not enough; the spiral must fill the height.
 * The wide picture itself (milkyway-sky.webp) has the same fault, a thin band: its centre cut at 10:11 lights top and
 * bottom 0.3 to 0.4 at 0.25 M, which is why the bar is a share of the third, not the whole of it.
 *
 *   PLAYWRIGHT_ROOT=$(ls -d ~/projects/orbit/node_modules/.pnpm/playwright@*\/node_modules/playwright | sort -V | tail -1) \
 *     BROWSER=chromium HEADED=1 LIBGL_ALWAYS_SOFTWARE=1 xvfb-run -a -s "-screen 0 1280x800x24" node tools/ci/docs-sky-portrait-live-test.mjs
 *
 * Chromium, headed under Xvfb with software GL (headless draws no world on other engines). The run has its own deadline
 * (DEADLINE_MS, default 15 minutes).
 *
 * Review fixes (spec: the #51 review, items 1, 2, 4 and 5), written from that spec alone:
 *
 *   S1 (item 2) the threshold is pinned on the page too: 909x1000 and 500x550 (10:11 exactly) show the tall picture,
 *       910x1000 the wide one (the door's side is docs-sky-portrait-test.mjs P6).
 *   L1 (item 4) the tall picture is the flight's last frame: the F1 frame (390x844, last beat) and the page's sky (the
 *       tall picture set to the screen's height, centred) MATCH (below).
 *   L2 (item 4) control, in the test: the WIDE picture cropped the same way must NOT match the frame; if it does, the
 *       comparison cannot tell a landscape pose or roll from the right one and L1 proves nothing.
 *   F0 (item 5) no fixed sleep before a screenshot is judged: each frame is waited for (two of the page's own frames,
 *       then screenshots until one is drawn, bounded by DRAW_WAIT_MS only against a hang).
 *   R0-R5 (item 1) portrait is decided once per flight. The flight is driven by a clock the test holds: createFlight's
 *       own options `requestFrame`, `cancelFrame` and `now` (engine.js), stepped 1000/60 ms a frame, so every frame is
 *       the same frame on every machine and nothing waits on drawing speed. A docs flight starts at 390x844 (portrait)
 *       and is stepped to 3000 ms (frame X0); the viewport then turns landscape, 1000x844 (same height), and the flight
 *       steps on: X1, X2, then to 4750 ms, at rest just before its last beat, XEND (a live flight that has ended is
 *       not judged: the page takes over from it). The harness tells the engine of the new size as the page's host does,
 *       the engine's own `resize()` on the window's resize event, and waits until the canvas has the new width. A
 *       frame not yet drawn when looked at (a resize clears the canvas) is drawn again at the same moment, the clock
 *       not moved, before the next look. The frames of a flight are set by the screen's height (the page's tall
 *       picture, centred, is the 390x844 frame), so the centre 390 px of a 1000x844 frame are comparable with a 390x844
 *       one.
 *         R0 control: every frame below is drawn (else R1-R5 are not judged).
 *         R1 control: the landscape way at that moment (R1: a flight started at 1000x844, in a fresh page, stepped to
 *            X1's frame) does NOT match X0 in its centre, so R2 can tell the two ways apart.
 *         R2 X1's centre MATCHES X0: no switch of path or roll when the screen turns.
 *         R3 X2 MATCHES X1: it goes on smoothly.
 *         R4 XEND's centre MATCHES the portrait flight's own last frame (a flight flown at 390x844 first, to the same 4750 ms, QEND):
 *            the flight that started portrait comes to rest at the portrait rest.
 *         R5 the next flight, started after the turn, takes the landscape way: its frame at X1's moment MATCHES R1.
 *
 * MATCH (L1, L2, R1-R5): both pictures cut into blocks 12 across (rows in proportion), a block's value the MEDIAN
 * luminance of its pixels (so stars do not count), compared two ways: Pearson correlation of the blocks >= 0.90, and the
 * mean absolute difference of the blocks, each picture divided by its own brightest block, <= 0.08. How the numbers were
 * chosen (2026-10-15, 390x844, software GL): the frame against today's tall picture 0.995 / 0.023; against the wide
 * picture cropped the same way 0.474 / 0.174; two consecutive frames near the end 1.000 / 0.002.
 * SHOTS_DIR=<dir> keeps every judged frame as a PNG there, for a person to look at.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { mkdirSync, writeFileSync } from "node:fs";

const playwright = createRequire(import.meta.url)(process.env.PLAYWRIGHT_ROOT || "playwright");
const BROWSER = process.env.BROWSER || "chromium";
const DEADLINE_MS = Number(process.env.DEADLINE_MS || 15 * 60e3);
const PORT = await new Promise((ok, no) => {
  const probe = createServer();
  probe.on("error", no);
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => ok(port)); });
});
const SITE = `http://127.0.0.1:${PORT}/`;
const here = dirname(fileURLToPath(import.meta.url));
const server = spawn(process.execPath, [join(here, "serve.mjs"), String(PORT)], { stdio: ["ignore", "ignore", "inherit"] });
let browser = null, failed = false;
const deadline = setTimeout(() => {
  console.log(`FAIL docs-sky-portrait-live-test: the run's deadline (${DEADLINE_MS / 1000} s) passed`);
  browser?.close().catch(() => {});
  server.kill();
  process.exit(1);
}, DEADLINE_MS);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};

/* the thresholds, as the header says */
const BLOCKS_ACROSS = 12, LIT_AT = 0.30, THIRD_LIT = 0.40, CORE_AT = 0.85, CORE_MAX = 0.40, DRAWN_MIN = 40;

/* ── S1: the page's picture, by screen shape ── */
const SHAPES = [
  { name: "390x844 (a phone)", w: 390, h: 844, want: "milkyway-sky-tall.webp", not: "milkyway-sky.webp" },
  { name: "900x1000 (portrait, 0.9)", w: 900, h: 1000, want: "milkyway-sky-tall.webp", not: "milkyway-sky.webp" },
  { name: "1280x800 (a laptop)", w: 1280, h: 800, want: "milkyway-sky.webp", not: "milkyway-sky-tall.webp" },
  { name: "1000x1000 (a square)", w: 1000, h: 1000, want: "milkyway-sky.webp", not: "milkyway-sky-tall.webp" },
  /* item 2: the threshold pinned */
  { name: "909x1000 (just portrait)", w: 909, h: 1000, want: "milkyway-sky-tall.webp", not: "milkyway-sky.webp" },
  { name: "910x1000 (just landscape)", w: 910, h: 1000, want: "milkyway-sky.webp", not: "milkyway-sky-tall.webp" },
  { name: "500x550 (10:11 exactly)", w: 500, h: 550, want: "milkyway-sky-tall.webp", not: "milkyway-sky.webp" },
];
const pictureCase = async (shape, n) => {
  const ctx = await browser.newContext({ viewport: { width: shape.w, height: shape.h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const served = {};
  page.on("response", (r) => { const m = /\/(milkyway-sky(?:-tall)?\.webp)(?:\?|$)/.exec(r.url()); if (m) served[m[1]] = r.status(); });
  try {
    await page.goto(`${SITE}?preview&fit=skip#docs`, { waitUntil: "load" });
    await page.locator("#docspad").waitFor({ state: "visible", timeout: 60000 });
    await page.locator("#docspad .milky").waitFor({ state: "attached", timeout: 30000 });
    const read = () => page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector("#docspad .milky"));
      return { image: cs.backgroundImage, size: cs.backgroundSize };
    });
    /* the style may need a beat after the pad shows; read until it names a picture (no timing judged: only that it does) */
    let v = await read();
    for (let i = 0; i < 40 && !/milkyway-sky/.test(v.image); i++) { await sleep(250); v = await read(); }
    for (let i = 0; i < 40 && served[shape.want] == null; i++) await sleep(250);
    const names = (re) => new RegExp(`/${re.replace(/\./g, "\\.")}"?\\)`).test(v.image);
    check(`S1.${n} ${shape.name}: .milky shows ${shape.want}`, names(shape.want) && !names(shape.not),
      `background-image ${v.image.slice(0, 120)}`);
    check(`S1.${n} ${shape.name}: ${shape.want} is served`, served[shape.want] === 200, `status ${served[shape.want] ?? "never requested"}`);
    check(`S1.${n} ${shape.name}: the picture is set to the screen's height`, /^auto (100%|\d+(\.\d+)?px)$/.test(v.size) && (!/px/.test(v.size) || Math.abs(parseFloat(v.size.split(" ")[1]) - shape.h) <= 1),
      `background-size ${v.size} (want auto 100%, or auto ${shape.h}px)`);
  } catch (e) {
    check(`S1.${n} ${shape.name}`, false, `could not be judged: ${String(e.message || e).split("\n")[0]}`);
  } finally { await ctx.close(); }
};

/* ── shared: waiting for a frame (item 5), and comparing two pictures as coarse blocks (items 1 and 4) ── */
const DRAW_WAIT_MS = Number(process.env.DRAW_WAIT_MS || 90e3);
const MATCH_CORR = 0.90, MATCH_MAD = 0.08, MATCH_ACROSS = 12;
const SHOTS_DIR = process.env.SHOTS_DIR || "";
const keep = (name, png) => { if (SHOTS_DIR) { mkdirSync(SHOTS_DIR, { recursive: true }); writeFileSync(join(SHOTS_DIR, `${name}.png`), png); } };
const dataUrl = (png) => "data:image/png;base64," + png.toString("base64");

/* the page's own frames, twice: whatever was drawn before this is on screen after it (a frame count, never a time) */
const twoFrames = (page) => page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));

/* blocks of a picture: `mode` "frame" takes the centre W x H of a screenshot at 1:1; "height" sets the picture to the
   height H and centres it across W, as the page's .milky shows its sky (background-size auto 100%, centred) */
const blocksOf = (page, src, W, H, mode) => page.evaluate(async ([src, W, H, mode, across]) => {
  const img = new Image(); img.src = src; await img.decode();
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  if (mode === "height") { const w = img.naturalWidth * H / img.naturalHeight; g.drawImage(img, (W - w) / 2, 0, w, H); }
  else g.drawImage(img, -(img.naturalWidth - W) / 2, -(img.naturalHeight - H) / 2);
  const d = g.getImageData(0, 0, W, H).data, down = Math.round(across * H / W), out = [];
  for (let by = 0; by < down; by++) for (let bx = 0; bx < across; bx++) {
    const v = [];
    for (let y = Math.floor(by * H / down); y < Math.floor((by + 1) * H / down); y++)
      for (let x = Math.floor(bx * W / across); x < Math.floor((bx + 1) * W / across); x++) {
        const i = (y * W + x) * 4; v.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
      }
    v.sort((a, b) => a - b); out.push(v[(v.length - 1) >> 1]);
  }
  return out;
}, [src, W, H, mode, MATCH_ACROSS]);

const compare = (a, b) => {
  const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let sab = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; }
  const A = Math.max(...a) || 1, B = Math.max(...b) || 1;
  let mad = 0;
  for (let i = 0; i < n; i++) mad += Math.abs(a[i] / A - b[i] / B);
  const corr = sa && sb ? sab / Math.sqrt(sa * sb) : 0;
  mad /= n;
  return { corr, mad, match: corr >= MATCH_CORR && mad <= MATCH_MAD, say: `correlation ${corr.toFixed(3)}, difference ${mad.toFixed(3)}` };
};
const WANT_MATCH = `(match: correlation >= ${MATCH_CORR} and difference <= ${MATCH_MAD})`;

/* a screenshot once the frame is drawn: two of the page's frames, then screenshots until its brightest block is lit
   (>= DRAWN_MIN). DRAW_WAIT_MS bounds the wait only against a hang; how long it took is never judged */
const drawnShot = async (page, name, { redraw = false } = {}) => {
  await twoFrames(page);
  const until = Date.now() + DRAW_WAIT_MS;
  for (;;) {
    const png = await page.screenshot({ type: "png", timeout: 0 });
    const vp = page.viewportSize();
    const M = Math.max(...(await blocksOf(page, dataUrl(png), vp.width, vp.height, "frame")));
    if (M >= DRAWN_MIN || Date.now() > until) { keep(name, png); return { png, src: dataUrl(png), M }; }
    /* a stepped flight draws only when told: a late resize (the window settling on its viewport) clears its canvas, so
       it is asked to draw the same moment again, its clock not moved */
    if (redraw) await page.evaluate(() => window.redraw());
    await twoFrames(page);
  }
};

/* ── F1-F3, L1-L2: the flight's last beat at 390x844 ── */
const HARNESS = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}canvas{position:fixed;inset:0;width:100vw;height:100vh}</style>
<canvas id="c"></canvas><script type="module">
import { createDoor, openChores, createFlight } from "./assets/door/index.js";
import { docsFlight } from "./assets/js/journeys.js";
createDoor({ image: (p) => "assets/door/img/" + p, flags: { gpu: "force", fit: "skip" } });
openChores();
const e = createFlight(document.getElementById("c"));
await e.warmDocs();
const P = docsFlight({ rect: { x: 0, y: 0, w: innerWidth, h: innerHeight }, geometry: { W: 1600, H: 900, field: { dots: [], arcs: [] }, cons: [] } });
window.draw = () => { e.start(P, { at: 4790 }); return true; };
window.ready = true;
</script>`;

const frameCase = async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  /* the harness is answered here, on the site's own origin, so its imports are the site's files */
  await page.route(`${SITE}__last-beat.html`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: HARNESS }));
  try {
    await page.goto(`${SITE}__last-beat.html`);
    await page.waitForFunction(() => window.ready, null, { timeout: 120000 });
    await page.evaluate(() => window.draw());
    const frame = await drawnShot(page, "last-beat-390x844");
    const shot = frame.png;
    const m = await page.evaluate(async ([b64, across, litAt, coreAt]) => {
      const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
      const w = img.naturalWidth, h = img.naturalHeight;
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const g = c.getContext("2d"); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, w, h).data, B = Math.round(w / across), wb = Math.floor(w / B), hb = Math.floor(h / B);
      const med = new Array(wb * hb);
      for (let by = 0; by < hb; by++) for (let bx = 0; bx < wb; bx++) {
        const v = [];
        for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) { const i = ((by * B + y) * w + bx * B + x) * 4; v.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]); }
        v.sort((a, b) => a - b); med[by * wb + bx] = v[(v.length - 1) >> 1];
      }
      const M = Math.max(...med);
      const lit = [0, 1, 2].map((k) => { let n = 0, t = 0; for (let by = Math.floor(hb * k / 3); by < Math.floor(hb * (k + 1) / 3); by++) for (let bx = 0; bx < wb; bx++) { t++; if (med[by * wb + bx] >= litAt * M) n++; } return n / t; });
      let lo = wb, hi = -1;
      for (let by = 0; by < hb; by++) for (let bx = 0; bx < wb; bx++) if (med[by * wb + bx] >= coreAt * M) { lo = Math.min(lo, bx); hi = Math.max(hi, bx); }
      return { w, h, M, lit, core: hi < lo ? 0 : ((hi - lo + 1) * B) / w };
    }, [shot.toString("base64"), BLOCKS_ACROSS, LIT_AT, CORE_AT]);
    check("F1 control: the frame at the last beat is drawn (390x844)", m.w === 390 && m.h === 844 && m.M >= DRAWN_MIN && !errors.length,
      `${m.w}x${m.h}, brightest block ${m.M.toFixed(0)} (want >= ${DRAWN_MIN})${errors.length ? `; page error: ${errors[0]}` : ""}`);
    if (m.M < DRAWN_MIN) { check("F2/F3, L1/L2", false, "not judged: the frame was not drawn (F1)"); return; }
    check("F2 galaxy light in the top third and in the bottom third", m.lit[0] >= THIRD_LIT && m.lit[2] >= THIRD_LIT,
      `share of blocks lit at ${LIT_AT} x brightest: top ${m.lit[0].toFixed(2)}, middle ${m.lit[1].toFixed(2)}, bottom ${m.lit[2].toFixed(2)} (want top and bottom >= ${THIRD_LIT})`);
    check("F3 the brightest core region spans under 40% of the frame's width", m.core < CORE_MAX,
      `blocks at ${CORE_AT} x brightest span ${(m.core * 100).toFixed(0)}% of the width (want < ${CORE_MAX * 100}%)`);

    /* item 4: the page's sky, as the page shows it at 390x844, against the frame */
    const F = await blocksOf(page, frame.src, 390, 844, "frame");
    const tall = await blocksOf(page, `${SITE}assets/img/docs/milkyway-sky-tall.webp`, 390, 844, "height");
    const wide = await blocksOf(page, `${SITE}assets/img/docs/milkyway-sky.webp`, 390, 844, "height");
    const t = compare(F, tall), w = compare(F, wide);
    check("L2 control: the WIDE picture, set to the height and centred, does not match the last frame", !w.match,
      `${w.say} ${WANT_MATCH}; if it matched, the comparison could not tell a landscape pose or roll and L1 would prove nothing`);
    check("L1 the tall picture, as the page shows it at 390x844, matches the flight's last frame", t.match && !w.match,
      `${t.say} ${WANT_MATCH}${w.match ? "; not judged: the control L2 failed" : ""}`);
  } catch (e) {
    check("F1-F3, L1-L2", false, `could not be judged: ${String(e.message || e).split("\n")[0]}`);
  } finally { await ctx.close(); }
};

/* ── R0-R5 (item 1): a flight that starts portrait and is turned landscape mid-flight ── */
const STEPPED = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}canvas{position:fixed;inset:0;width:100vw;height:100vh}</style>
<canvas id="c"></canvas><script type="module">
import { createDoor, openChores, createFlight } from "./assets/door/index.js";
import { docsFlight } from "./assets/js/journeys.js";
createDoor({ image: (p) => "assets/door/img/" + p, flags: { gpu: "force", fit: "skip" } });
openChores();
/* the flight's clock is the test's: a frame runs only when frames(n) says, each 1000/60 ms after the last */
let T = 1000, queue = [], id = 0;
const e = createFlight(document.getElementById("c"), {
  requestFrame: (fn) => { queue.push([++id, fn]); return id; },
  cancelFrame: (k) => { queue = queue.filter(([j]) => j !== k); },
  now: () => T,
});
await e.warmDocs();
/* the host's part, as the journey does it (README: the journey's resize listener): the engine told of a new size */
addEventListener("resize", () => e.resize());
/* a docs flight as the page makes it: its chart the screen as it is when the flight starts */
/* each flight readied as a host readies each visit (README: warm "each visit"), then started. The verdict on the world
   is the door's to give and may come after warmDocs() resolves (a flight that comes first is drawn without it), so a
   flight started before it is stopped and started again until the engine says it draws the world (drawingWorld): a
   state waited for, at most 600 of the page's frames, never a time judged */
const chart = () => ({ rect: { x: 0, y: 0, w: innerWidth, h: innerHeight }, geometry: { W: 1600, H: 900, field: { dots: [], arcs: [] }, cons: [] } });
window.fly = async () => {
  await e.warmDocs();
  for (let i = 0; ; i++) {
    e.start(docsFlight(chart()));
    if (e.drawingWorld || i >= 600) return e.drawingWorld;
    e.stop();
    await new Promise((ok) => requestAnimationFrame(() => ok()));
  }
};
window.redraw = () => { const q = queue; queue = []; for (const [, fn] of q) fn(T); return true; };
window.frames = (n) => { for (let i = 0; i < n; i++) { T += 1000 / 60; const q = queue; queue = []; for (const [, fn] of q) fn(T); } return queue.length; };
window.ready = true;
</script>`;
const PORTRAIT = { width: 390, height: 844 }, LANDSCAPE = { width: 1000, height: 844 };
const MID = 180, END = 285; /* frames: 3000 ms in (mid-flight), and 4750 ms (at rest, just before the last beat, 4790) */

const steppedPage = async (viewport, errors) => {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(`${SITE}__stepped.html`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: STEPPED }));
  await page.goto(`${SITE}__stepped.html`);
  await page.waitForFunction(() => window.ready, null, { timeout: 120000 });
  return { ctx, page };
};
const flyTo = async (page, n) => {
  if (!(await page.evaluate(() => window.fly()))) throw new Error("the engine never drew the flight's world (drawingWorld stayed false)");
  await page.evaluate((n) => window.frames(n), n);
};

const resizeCase = async () => {
  const errors = [];
  let a = null, b = null;
  try {
    /* the landscape way, for reference: a flight started at 1000x844 in a fresh page, at X1's frame */
    b = await steppedPage(LANDSCAPE, errors);
    await flyTo(b.page, MID + 1);
    const R1 = await drawnShot(b.page, "R1-landscape-from-start", { redraw: true });
    await b.ctx.close(); b = null;

    a = await steppedPage(PORTRAIT, errors);
    /* the portrait flight flown whole, for its rest */
    await flyTo(a.page, END);
    const QEND = await drawnShot(a.page, "QEND-portrait-whole", { redraw: true });
    /* the flight under test: started portrait, turned landscape mid-flight */
    await flyTo(a.page, MID);
    const X0 = await drawnShot(a.page, "X0-portrait-mid", { redraw: true });
    await a.page.setViewportSize(LANDSCAPE);
    await a.page.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h && document.getElementById("c").clientWidth === w,
      [LANDSCAPE.width, LANDSCAPE.height], { timeout: 60000, polling: 100 }).catch(async (e) => { throw new Error(`the page did not take the new size: ${JSON.stringify(await a.page.evaluate(() => [innerWidth, innerHeight, document.getElementById("c").clientWidth]))} (${e.message.split("\n")[0]})`); });
    await twoFrames(a.page);
    await a.page.evaluate(() => window.frames(1));
    const X1 = await drawnShot(a.page, "X1-turned", { redraw: true });
    await a.page.evaluate(() => window.frames(1));
    const X2 = await drawnShot(a.page, "X2-turned", { redraw: true });
    await a.page.evaluate((n) => window.frames(n), END - MID - 2);
    const XEND = await drawnShot(a.page, "XEND-turned-rest", { redraw: true });
    /* the next flight, started after the turn */
    await flyTo(a.page, MID + 1);
    const Z1 = await drawnShot(a.page, "Z1-next-flight", { redraw: true });

    const shots = { X0, X1, X2, XEND, QEND, Z1, R1 }, dark = Object.entries(shots).filter(([, v]) => !(v.M >= DRAWN_MIN)).map(([k]) => k);
    check("R0 control: the frames are drawn (X0, X1, X2, XEND, QEND, Z1, R1)", !dark.length && !errors.length,
      `brightest blocks ${Object.entries(shots).map(([k, v]) => `${k} ${v.M.toFixed(0)}`).join(", ")} (want >= ${DRAWN_MIN})${errors.length ? `; page error: ${errors[0]}` : ""}`);
    if (dark.length) { check("R1-R5", false, `not judged: ${dark.join(", ")} not drawn (R0)`); return; }
    const p = a.page, cx = (s) => blocksOf(p, s.src, PORTRAIT.width, PORTRAIT.height, "frame");
    const whole = (s) => blocksOf(p, s.src, LANDSCAPE.width, LANDSCAPE.height, "frame");
    const bX0 = await cx(X0), bX1 = await cx(X1), bR1 = await cx(R1);
    const ctl = compare(bX0, bR1);
    check("R1 control: the landscape way at that moment does not match the portrait frame (centre 390 px)", !ctl.match,
      `${ctl.say} ${WANT_MATCH}; if it matched, R2 could not tell the two ways apart`);
    const r2 = compare(bX0, bX1);
    check("R2 turned landscape mid-flight, the camera does not jump: X1's centre matches X0", r2.match && !ctl.match,
      `${r2.say} ${WANT_MATCH}${ctl.match ? "; not judged: the control R1 failed" : ""}`);
    const r3 = compare(await whole(X1), await whole(X2));
    check("R3 and goes on smoothly: X2 matches X1", r3.match, `${r3.say} ${WANT_MATCH}`);
    const r4 = compare(await cx(QEND), await cx(XEND));
    check("R4 the flight that started portrait comes to rest at the portrait rest: XEND's centre matches the portrait flight's last frame",
      r4.match, `${r4.say} ${WANT_MATCH}`);
    const r5 = compare(await whole(R1), await whole(Z1));
    check("R5 the next flight, started after the turn, takes the landscape way: its frame matches R1", r5.match, `${r5.say} ${WANT_MATCH}`);
  } catch (e) {
    check("R0-R5", false, `could not be judged: ${String(e.message || e).split("\n")[0]}`);
  } finally {
    await a?.ctx.close().catch(() => {});
    await b?.ctx.close().catch(() => {});
  }
};

try {
  await new Promise((ok, no) => {
    const start = Date.now();
    (async function poll() {
      try { await fetch(SITE); ok(); } catch { Date.now() - start > 10000 ? no(new Error("server did not start")) : setTimeout(poll, 100); }
    })();
  });
  browser = await playwright[BROWSER].launch({
    ...(process.env.HEADED === "1" ? { headless: false } : {}),
    ...(BROWSER === "chromium" ? { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } : {}),
  });
  for (const [i, shape] of SHAPES.entries()) await pictureCase(shape, i + 1);
  await frameCase();
  await resizeCase();
} catch (e) {
  console.log(`FAIL docs-sky-portrait-live-test: ${String(e.message || e).split("\n")[0]}`);
  failed = true;
} finally {
  clearTimeout(deadline);
  await browser?.close().catch(() => {});
  server.kill();
}
console.log(failed ? "\ndocs-sky-portrait-live-test: failed" : "\ndocs-sky-portrait-live-test: ok");
process.exit(failed ? 1 : 0);
