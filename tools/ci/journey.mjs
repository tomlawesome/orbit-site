/*
 * The live journey: the site served as Pages serves it, visited in a real
 * browser (Firefox by default), each landing reached, and nothing thrown.
 * This is the gate's live check; it is never optional (new-project skill).
 *
 *   node tools/ci/journey.mjs                 Firefox, site on :8787
 *   BROWSER=chromium node tools/ci/journey.mjs
 *   SITE=http://127.0.0.1:8787/ node tools/ci/journey.mjs
 *
 * Needs playwright (the Playwright image in CI; locally PLAYWRIGHT_ROOT
 * naming the package directory, e.g. ../orbit/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright). Reduced motion is asked for so a landing is
 * reached without the film, and WebGL2 is not assumed: without it the
 * site draws its stills, which is also what it must do for visitors.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

/* playwright: from the image's global install in CI, or from the checkout
   PLAYWRIGHT_ROOT names (a sibling project's node_modules) locally */
const playwright = createRequire(import.meta.url)(process.env.PLAYWRIGHT_ROOT || "playwright");

const SITE = process.env.SITE || "http://127.0.0.1:8787/";
const BROWSER = process.env.BROWSER || "firefox";
const here = dirname(fileURLToPath(import.meta.url));

let server = null;
if (!process.env.SITE) {
  server = spawn(process.execPath, [join(here, "serve.mjs"), "8787"], { stdio: ["ignore", "inherit", "inherit"] });
  await new Promise((ok, no) => {
    const t0 = Date.now();
    (async function poll() {
      try { await fetch(SITE); ok(); } catch { Date.now() - t0 > 10000 ? no(new Error("server did not start")) : setTimeout(poll, 100); }
    })();
  });
}

const problems = [];
const browser = await playwright[BROWSER].launch();
/* Each step opens its own tab, as a visitor arriving from a link does: a
   hash change inside one tab is a different path (the site flies between
   landings on a click, not on the address alone). */
const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 800 } });
let page = null;
const fresh = async () => {
  await page?.close();
  page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  /* No Gaia picture: the page must not request any galaxy*.webp, and must not
     print the old "is drawn, not Gaia's" credit note. */
  page.on("request", (r) => {
    let name = "";
    try { name = new URL(r.url()).pathname.split("/").pop(); } catch { name = r.url(); }
    if (/^galaxy.*\.webp$/.test(name)) problems.push(`requested a galaxy picture: ${r.url()}`);
  });
  page.on("console", (m) => { if (m.text().includes("is drawn, not Gaia's")) problems.push(`console message mentions Gaia: ${m.text()}`); });
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console.error: ${m.text()}`); });
  page.on("requestfailed", (r) => { if (r.url().startsWith(SITE)) problems.push(`request failed: ${r.url()} ${r.failure()?.errorText}`); });
  page.on("response", (r) => { if (r.url().startsWith(SITE) && r.status() >= 400 && !r.url().endsWith("/no-such-page")) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  return page;
};

const step = async (name, fn) => {
  try { await fresh(); await fn(); console.log(`ok   ${name}`); }
  catch (e) { problems.push(`${name}: ${e.message.split("\n")[0]}`); console.log(`FAIL ${name}`); }
};

let maintenance = false;
await step("the door lights", async () => {
  await page.goto(SITE, { waitUntil: "load" });
  await page.locator("#door").waitFor({ state: "visible", timeout: 30000 });
  await page.locator("#door .planet[data-section=install]").waitFor({ state: "attached" });
  maintenance = (await page.locator("html[data-maintenance]").count()) > 0;
});

if (maintenance) {
  /* index.html carries data-maintenance: the door stands alone with its
     message, and a deep link lands on the door with nothing readied.
     That is what the site ships, so that is what is checked. */
  console.log("     (maintenance mode: the door alone, no landings)");
  await step("the notice is shown", async () => {
    await page.goto(SITE, { waitUntil: "load" });
    const words = (await page.getAttribute("html", "data-maintenance"))?.trim() || "Back shortly";
    await page.locator("#door .notice .t", { hasText: words }).waitFor({ state: "visible", timeout: 10000 });
  });
  await step("a deep link lands on the door", async () => {
    await page.goto(SITE + "#install", { waitUntil: "load" });
    await page.locator("#door").waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(3000);
    for (const pad of ["#installpad", "#docspad", "#infopad"]) if (await page.locator(pad).isVisible()) throw new Error(`${pad} opened`);
  });
} else {
  for (const [hash, pad] of [["#install", "#installpad"], ["#docs", "#docspad"], ["#info", "#infopad"]]) {
    await step(`${hash} arrives`, async () => {
      await page.goto(SITE + hash, { waitUntil: "load" });
      await page.locator(pad).waitFor({ state: "visible", timeout: 60000 });
    });
  }
  await step("a docs page opens", async () => {
    await page.goto(SITE + "#docs/readme", { waitUntil: "load" });
    await page.locator("#docspad").waitFor({ state: "visible", timeout: 60000 });
    await page.waitForFunction(() => document.querySelector("#docspad")?.textContent.includes("Quick start"), null, { timeout: 30000 });
  });
}

await step("404 is the site's own", async () => {
  const res = await page.goto(SITE + "no-such-page", { waitUntil: "load" });
  if (res.status() !== 404) throw new Error(`status ${res.status()}`);
});

await browser.close();
server?.kill();
const real = problems.filter((p) => !/favicon/.test(p));
if (real.length) { console.log("\njourney: failed"); for (const p of real) console.log(" - " + p); process.exit(1); }
console.log("\njourney: ok");
