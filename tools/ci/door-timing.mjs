/*
 * How long the door takes, measured in a real browser, so a change to the door
 * can be shown to cost the site nothing. Not part of the gate: run it by hand
 * before and after a change, on the same machine, and compare.
 *
 *   node tools/ci/door-timing.mjs                 Firefox, site on :8787 (served by this script)
 *   RUNS=5 BROWSER=chromium node tools/ci/door-timing.mjs
 *   HEADED=1 (headed, for Xvfb + software GL), SITE=http://127.0.0.1:8787/
 *
 * Each run is a fresh browser context (a first visit: nothing kept, the probe
 * run afresh) at 1280x800 with motion on. Reported per run and as the median:
 *
 *   lit        ms from the page's start to body.lit (first light: the reveal begins)
 *   earthy     ms to the Earth's first picture shown (#door .world.earthy)
 *   flight     ms to the flight ready (body.ready-flight: the gate takes a click)
 *   gap        the reveal's longest gap between two frames (ms; the site's own note)
 *   climb      ms from the gate's click to the instrument (the whole climb, wall clock)
 *   js         script files fetched, and their bytes
 *   long       long tasks (over 50 ms) on the page's thread before `flight`, and their total (Chromium only)
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const playwright = createRequire(import.meta.url)(process.env.PLAYWRIGHT_ROOT || "playwright");
const SITE = process.env.SITE || "http://127.0.0.1:8787/";
const BROWSER = process.env.BROWSER || "firefox";
const RUNS = Number(process.env.RUNS || 3);
const here = dirname(fileURLToPath(import.meta.url));

let server = null;
if (!process.env.SITE) {
  server = spawn(process.execPath, [join(here, "serve.mjs"), "8787"], { stdio: ["ignore", "ignore", "inherit"] });
  await new Promise((ok, no) => {
    const t0 = Date.now();
    (async function poll() {
      try { await fetch(SITE); ok(); } catch { Date.now() - t0 > 10000 ? no(new Error("server did not start")) : setTimeout(poll, 100); }
    })();
  });
}

/* what the page records of itself: when each class lands, and the long tasks */
const RECORD = `
  window.__door = { lit: 0, earthy: 0, flight: 0, long: 0, longMs: 0, instrument: 0 };
  const body = () => document.body;
  const mark = (k) => { if (!window.__door[k]) window.__door[k] = performance.now(); };
  const look = () => {
    if (body()?.classList.contains("lit")) mark("lit");
    if (body()?.classList.contains("ready-flight")) mark("flight");
    if (body()?.classList.contains("instrument")) mark("instrument");
    if (document.querySelector("#door .world.earthy")) mark("earthy");
  };
  new MutationObserver(look).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ["class"] });
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (!window.__door.flight) { window.__door.long++; window.__door.longMs += e.duration; } } }).observe({ type: "longtask", buffered: true }); } catch {}
`;

const browser = await playwright[BROWSER].launch(process.env.HEADED === "1" ? { headless: false } : {});
const runs = [];
try {
  for (let i = 0; i < RUNS; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.addInitScript(RECORD);
    let gap = null, js = 0, jsBytes = 0;
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { const g = m.text().match(/longest frame gap ([\d.]+) ms/); if (g) gap = Number(g[1]); });
    page.on("response", async (r) => {
      if (!r.url().startsWith(SITE) || !/\.m?js(\?|$)/.test(r.url())) return;
      js++;
      try { jsBytes += (await r.body()).length; } catch { /* gone */ }
    });
    await page.goto(SITE + "?preview", { waitUntil: "load" });
    await page.waitForFunction(() => window.__door.flight > 0, null, { timeout: 120000 });
    /* the climb, once the gate takes a click: from the click to the instrument's arrival */
    await page.waitForTimeout(500);
    const clicked = await page.evaluate(() => { const t = performance.now(); document.querySelector("#gate").click(); return t; });
    await page.waitForFunction(() => window.__door.instrument > 0, null, { timeout: 60000 });
    const got = await page.evaluate(() => window.__door);
    const run = { lit: got.lit, earthy: got.earthy, flight: got.flight, gap, climb: got.instrument - clicked, js, jsBytes, long: got.long, longMs: got.longMs };
    runs.push(run);
    console.log(`run ${i + 1}: ${Object.entries(run).map(([k, v]) => `${k} ${v === null ? "-" : Math.round(v)}`).join(", ")}${errors.length ? `  (errors: ${errors.join("; ")})` : ""}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server?.kill();
}
const median = (xs) => { const s = xs.filter((x) => x !== null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const out = {};
for (const k of Object.keys(runs[0])) out[k] = median(runs.map((r) => r[k]));
console.log(`median (${BROWSER}, ${RUNS} runs): ${Object.entries(out).map(([k, v]) => `${k} ${v === null ? "-" : Math.round(v)}`).join(", ")}`);
