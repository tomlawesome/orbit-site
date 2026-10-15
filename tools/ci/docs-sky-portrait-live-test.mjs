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
 * (DEADLINE_MS, default 8 minutes).
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:net";

const playwright = createRequire(import.meta.url)(process.env.PLAYWRIGHT_ROOT || "playwright");
const BROWSER = process.env.BROWSER || "chromium";
const DEADLINE_MS = Number(process.env.DEADLINE_MS || 8 * 60e3);
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

/* ── F1-F3: the flight's last beat at 390x844 ── */
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
    await sleep(500);
    const shot = await page.screenshot({ type: "png", timeout: 0 });
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
    if (m.M < DRAWN_MIN) { check("F2/F3", false, "not judged: the frame was not drawn (F1)"); return; }
    check("F2 galaxy light in the top third and in the bottom third", m.lit[0] >= THIRD_LIT && m.lit[2] >= THIRD_LIT,
      `share of blocks lit at ${LIT_AT} x brightest: top ${m.lit[0].toFixed(2)}, middle ${m.lit[1].toFixed(2)}, bottom ${m.lit[2].toFixed(2)} (want top and bottom >= ${THIRD_LIT})`);
    check("F3 the brightest core region spans under 40% of the frame's width", m.core < CORE_MAX,
      `blocks at ${CORE_AT} x brightest span ${(m.core * 100).toFixed(0)}% of the width (want < ${CORE_MAX * 100}%)`);
  } catch (e) {
    check("F1-F3", false, `could not be judged: ${String(e.message || e).split("\n")[0]}`);
  } finally { await ctx.close(); }
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
