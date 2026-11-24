/*
 * Live test for orbit-site #128 (docs screenshots sit against the left edge), written from the specification alone:
 *
 *   Every image in a docs page body (`.pad.docs .body img`) is centred horizontally in the text column when it sits on
 *   its own line. Images inside a `.centred` block keep sitting side by side in a centred row. Size, border, radius and
 *   vertical spacing stay (radius 12px, 1px border, max-width 100%, top margin 6px, bottom margin 18px).
 *
 * Judged in Chromium from layout: a static page links assets/site.css and holds the imported docs' markup inside
 * `<div class="pad docs"><div class="body">`; the images are inline SVG data URIs of known size.
 *
 *   I1  lone img after a <br>, narrower than the column: left and right gaps to the column equal within 1px.
 *   I2  lone img in a <p>, same.
 *   I3  two 45% images in `.centred`: same top (side by side) and the pair is centred (gaps equal within 1px).
 *   I4  border-radius 12px, border 1px, margin-top 6px and margin-bottom 18px are unchanged (lone and centred images).
 *
 *   PLAYWRIGHT_ROOT=$(ls -d ~/projects/orbit/node_modules/.pnpm/playwright@*\/node_modules/playwright | sort -V | tail -1) \
 *     BROWSER=chromium node tools/ci/docs-img-centre-test.mjs
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { freePort, openBrowser } from "./live-lib.mjs";

const playwright = createRequire(import.meta.url)(process.env.PLAYWRIGHT_ROOT || "playwright");
const BROWSER = process.env.BROWSER || "chromium";
const SITE = process.env.SITE || `http://127.0.0.1:${await freePort()}/`;
const here = dirname(fileURLToPath(import.meta.url));
const server = process.env.SITE ? null : spawn(process.execPath, [join(here, "serve.mjs"), new URL(SITE).port], { stdio: ["ignore", "ignore", "inherit"] });

const svg = (w, h) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#888"/></svg>`)}`;
const html = `<!doctype html><html data-theme="starchart"><meta charset="utf-8"><link rel="stylesheet" href="${SITE}assets/site.css">
<div class="pad docs"><div class="body" id="body" style="width:700px">
<div id="a">text<br><img id="i1" src="${svg(200, 100)}" alt="a"></div>
<p id="b"><img id="i2" src="${svg(240, 120)}" alt="b"></p>
<div class="centred" id="c"><img id="i3" src="${svg(400, 200)}" width="45%" alt="c"><img id="i4" src="${svg(400, 200)}" width="45%" alt="d"></div>
</div></div>`;

let failed = false;
const check = (name, ok, detail) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`); if (!ok) failed = true; };
let browser = null;
try {
  browser = await openBrowser(playwright, BROWSER);
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.setContent(html, { waitUntil: "load" });
  const m = await page.evaluate(() => {
    const r = (e) => e.getBoundingClientRect();
    const col = r(document.getElementById("body"));
    const box = (id) => { const e = document.getElementById(id), b = r(e), s = getComputedStyle(e); return { l: b.left - col.left, r: col.right - b.right, top: b.top, w: b.width, radius: s.borderTopLeftRadius, border: s.borderTopWidth, mt: s.marginTop, mb: s.marginBottom }; };
    return { i1: box("i1"), i2: box("i2"), i3: box("i3"), i4: box("i4"), col: col.width };
  });
  const eq = (a, b) => Math.abs(a - b) <= 1;
  const gaps = (b) => `left ${b.l.toFixed(1)} right ${b.r.toFixed(1)}`;
  check("I1 img after <br> centred", eq(m.i1.l, m.i1.r), gaps(m.i1));
  check("I2 img in <p> centred", eq(m.i2.l, m.i2.r), gaps(m.i2));
  const pairL = m.i3.l, pairR = m.i4.r;
  check("I3 centred pair side by side and centred", eq(m.i3.top, m.i4.top) && eq(pairL, pairR), `tops ${m.i3.top.toFixed(1)}/${m.i4.top.toFixed(1)}, ${pairL.toFixed(1)} left, ${pairR.toFixed(1)} right`);
  const same = [m.i1, m.i3].every((b) => b.radius === "12px" && b.border === "1px" && b.mt === "6px" && b.mb === "18px");
  check("I4 radius, border and margins unchanged", same, JSON.stringify([m.i1, m.i3].map(({ radius, border, mt, mb }) => ({ radius, border, mt, mb }))));
} catch (e) {
  check("harness", false, String(e && e.stack || e));
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
process.exit(failed ? 1 : 0);
