/*
 * The live journey: the site served as Pages serves it, visited in a real
 * browser (Firefox by default), each landing reached, and nothing thrown.
 * This is the gate's live check; it is never optional (new-project skill).
 *
 *   node tools/ci/journey.mjs                 Firefox, site on :8787
 *   BROWSER=chromium node tools/ci/journey.mjs
 *   HEADED=1 (headed, for Xvfb + software GL), WEBGL=required (no WebGL2 fails)
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
/* HEADED=1 runs the browser headed (the gate does so under Xvfb with software
   GL, so Firefox has a WebGL2 to draw the worlds with) */
const browser = await playwright[BROWSER].launch(process.env.HEADED === "1" ? { headless: false } : {});
/* Each step opens its own tab, as a visitor arriving from a link does: a
   hash change inside one tab is a different path (the site flies between
   landings on a click, not on the address alone). */
const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 800 } });
let page = null;
/* set only while the deliberate no-such-page visit runs: Chromium logs its
   404 as a console error, which is expected there and nowhere else */
let expectNotFound = false;
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
  page.on("console", (m) => { if (m.type() === "error" && !expectNotFound) problems.push(`console.error: ${m.text()}`); });
  page.on("requestfailed", (r) => { if (r.url().startsWith(SITE)) problems.push(`request failed: ${r.url()} ${r.failure()?.errorText}`); });
  page.on("response", (r) => { if (r.url().startsWith(SITE) && r.status() >= 400 && !r.url().endsWith("/no-such-page")) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  return page;
};

const step = async (name, fn) => {
  try { await fresh(); await fn(); console.log(`ok   ${name}`); }
  catch (e) { problems.push(`${name}: ${e.message.split("\n")[0]}`); console.log(`FAIL ${name}`); }
};

/* A step that needs its own browser context (a time zone, motion left on, a
   clock), with the harness's pageerror listener on its page. */
const inOwnContext = async (options, fn) => {
  const octx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...options });
  try {
    const opage = await octx.newPage();
    opage.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    await fn(opage, octx);
  } finally { await octx.close(); }
};

let maintenance = false;
await step("the door lights", async () => {
  await page.goto(SITE, { waitUntil: "load" });
  await page.locator("#door").waitFor({ state: "visible", timeout: 30000 });
  await page.locator("#door .planet[data-section=install]").waitFor({ state: "attached" });
  maintenance = (await page.locator("html[data-maintenance]").count()) > 0;
});

/* Reduced motion stops every endless animation (the door, the dusk film, the
   dial's warning glow); a name other than "none" means one still runs. */
await step("reduced motion stops the endless animations", async () => {
  await page.goto(SITE, { waitUntil: "load" });
  await page.locator("#door").waitFor({ state: "visible", timeout: 30000 });
  const names = await page.evaluate(() => {
    const name = (sel) => { const el = document.querySelector(sel); return [sel, el ? getComputedStyle(el).animationName : "missing"]; };
    const out = [
      name("#door .planets .trdot"),
      name("#dusk .shimmer"),
      name("#dusk .lockup .glyph .tr"),
    ];
    const dial = document.querySelector(".dial");
    dial?.classList.add("warn");
    out.push(name(".dial .danger"));
    dial?.classList.remove("warn");
    return out;
  });
  const running = names.filter(([, n]) => n !== "none");
  if (running.length) throw new Error(`still animating under reduced motion: ${running.map(([s, n]) => `${s} (${n})`).join(", ")}`);
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
}

/* The landings: each one reached, and a docs page opened. `prefix` is
   "" when the site is open, and "?preview" past the maintenance door
   (the query removes maintenance mode for that page load). */
const landings = async (prefix) => {
  for (const [hash, pad] of [["#install", "#installpad"], ["#docs", "#docspad"], ["#info", "#infopad"]]) {
    await step(`${prefix}${hash} arrives`, async () => {
      await page.goto(SITE + prefix + hash, { waitUntil: "load" });
      await page.locator(pad).waitFor({ state: "visible", timeout: 60000 });
    });
  }
  /* Saved dates keep their local calendar day: just after local midnight in
     Tokyo it is still the 25th in UTC, and "due" must not start on the 25th. */
  await step(`the due date starts tomorrow in Tokyo${prefix ? " (preview)" : ""}`, async () => {
    await inOwnContext({ timezoneId: "Asia/Tokyo", reducedMotion: "reduce" }, async (p) => {
      await p.clock.setFixedTime(Date.UTC(2026, 9, 25, 20, 0));
      await p.goto(SITE + prefix + "#home", { waitUntil: "load" });
      await p.locator("#f-date").waitFor({ state: "attached", timeout: 30000 });
      try { await p.waitForFunction(() => document.querySelector("#f-date").min === "2026-10-26", null, { timeout: 5000 }); }
      catch { throw new Error(`#f-date min is ${await p.locator("#f-date").getAttribute("min")}, want 2026-10-26`); }
    });
  });
  /* One click on the install line copies once, and the line keeps its text;
     only the button says "copied". */
  const clipboard = (copies) => ({ content: `Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: ${copies} } });` });
  await step(`one copy click makes one copy${prefix ? " (preview)" : ""}`, async () => {
    await page.addInitScript(clipboard("(t) => { (window.__copied ||= []).push(t); return Promise.resolve(); }"));
    await page.goto(SITE + prefix + "#install", { waitUntil: "load" });
    await page.locator("#installpad").waitFor({ state: "visible", timeout: 60000 });
    const code = page.locator("#installpad code[data-copy]");
    const button = page.locator("#installpad button.copy");
    await code.click();
    for (const wait of [200, 1800]) {
      await page.waitForTimeout(wait);
      const n = await page.evaluate(() => (window.__copied || []).length);
      if (n !== 1) throw new Error(`${n} copies after clicking the command line (${wait} ms), want 1`);
      const text = await code.textContent();
      if (!text.includes("curl -fsSL")) throw new Error(`the command line reads ${JSON.stringify(text)} (${wait} ms), want the command`);
    }
    await button.click();
    await page.waitForTimeout(200);
    if ((await button.textContent()) !== "copied") throw new Error(`the button reads ${JSON.stringify(await button.textContent())} just after the click, want "copied"`);
    await page.waitForTimeout(1800);
    if ((await button.textContent()) !== "copy") throw new Error(`the button reads ${JSON.stringify(await button.textContent())} later, want "copy"`);
    const refused = await ctx.newPage();
    try {
      refused.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
      await refused.addInitScript(clipboard("() => Promise.reject(new Error('refused'))"));
      await refused.goto(SITE + prefix + "#install", { waitUntil: "load" });
      await refused.locator("#installpad").waitFor({ state: "visible", timeout: 60000 });
      const rb = refused.locator("#installpad button.copy");
      await rb.click();
      await refused.waitForTimeout(200);
      if ((await rb.textContent()) !== "not copied") throw new Error(`a refused copy reads ${JSON.stringify(await rb.textContent())}, want "not copied"`);
      await refused.waitForTimeout(1800);
      if ((await rb.textContent()) !== "copy") throw new Error(`a refused copy reads ${JSON.stringify(await rb.textContent())} later, want "copy"`);
    } finally { await refused.close(); }
  });
  /* A failed docs index is retried: the panel's way back to the door, then a
     second visit, must find the docs. */
  await step(`a failed docs index is retried${prefix ? " (preview)" : ""}`, async () => {
    await inOwnContext({ reducedMotion: "reduce" }, async (p) => {
      let failedOnce = false;
      await p.route("**/assets/docs/index.json", (route) => {
        if (failedOnce) return route.continue();
        failedOnce = true;
        return route.abort();
      });
      await p.goto(SITE + prefix + "#docs", { waitUntil: "load" });
      await p.locator("#docspad .none", { hasText: "The docs have not been imported" }).waitFor({ state: "visible", timeout: 30000 });
      await p.locator("#docspad .back.dawn").click();
      await p.locator("#door").waitFor({ state: "visible", timeout: 30000 });
      const planet = p.locator("#door .planet[data-section=docs].ready");
      await planet.waitFor({ state: "attached", timeout: 30000 });
      /* the planets keep turning, so a pointer click never finds one stable */
      await planet.evaluate((el) => el.click());
      try {
        await p.waitForFunction(() => document.querySelector("#docspad .entry, #docspad .chart .star") && !document.querySelector("#docspad .none"), null, { timeout: 30000 });
      } catch { throw new Error("the docs index failed once and the docs never loaded on the second visit within 30s"); }
    });
  });
  /* The world itself: its own context without reducedMotion (which shows
     stills instead of the world). Where WebGL2 is missing this is skipped,
     unless WEBGL=required, when it is a problem. */
  await step("the install world draws", async () => {
    const wctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    try {
      const wpage = await wctx.newPage();
      const messages = [];
      let ready = () => {};
      const readyP = new Promise((ok) => { ready = ok; });
      wpage.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
      wpage.on("console", (m) => {
        const text = m.text();
        messages.push(text);
        if (m.type() === "error") problems.push(`console.error: ${text}`);
        if (text.includes("install: ready")) ready();
      });
      wpage.on("requestfailed", (r) => { if (r.url().startsWith(SITE)) problems.push(`request failed: ${r.url()} ${r.failure()?.errorText}`); });
      if (!(await wpage.evaluate(() => !!document.createElement("canvas").getContext("webgl2")))) {
        if (process.env.WEBGL === "required") throw new Error(`no WebGL2 in ${BROWSER}: the worlds are never drawn`);
        console.log("     (no WebGL2 here: the world is not drawn)");
        return;
      }
      await wpage.goto(SITE + prefix + "#install", { waitUntil: "load" });
      let timer;
      const timedOut = new Promise((_, no) => { timer = setTimeout(() => no(new Error("the install world never logged 'install: ready' within 90s")), 90000); });
      try { await Promise.race([readyP, timedOut]); } finally { clearTimeout(timer); }
      await wpage.waitForTimeout(5000);
      const fell = messages.filter((t) => t.includes("is drawn, not photographed") || t.includes("orbit: no map"));
      if (fell.length) throw new Error(`a world fell back to drawn textures: ${fell[0]}`);
    } finally { await wctx.close(); }
  });
  await step(`a docs page opens${prefix ? " (preview)" : ""}`, async () => {
    await page.goto(SITE + prefix + "#docs/readme", { waitUntil: "load" });
    await page.locator("#docspad").waitFor({ state: "visible", timeout: 60000 });
    await page.waitForFunction(() => document.querySelector("#docspad")?.textContent.includes("Quick start"), null, { timeout: 30000 });
  });
  await step(`a docs diagram draws${prefix ? " (preview)" : ""}`, async () => {
    await page.goto(SITE + prefix + "#docs/readme", { waitUntil: "load" });
    await page.locator("#docspad").waitFor({ state: "visible", timeout: 60000 });
    try { await page.locator("#docspad figure[data-mermaid] svg").first().waitFor({ state: "attached", timeout: 30000 }); }
    catch { throw new Error("the docs diagram (figure[data-mermaid]) never drew an svg within 30s"); }
  });
  /* Back pressed in mid-flight is honoured: the door's planet is clicked and
     Back follows on the next frame, before the flight can land. */
  await step(`Back mid-flight returns to the door${prefix ? " (preview)" : ""}`, async () => {
    await inOwnContext({}, async (p) => {
      await p.goto(SITE + prefix, { waitUntil: "load" });
      await p.locator("#door .planet[data-section=install].ready").waitFor({ state: "attached", timeout: 60000 });
      await p.evaluate(() => {
        document.querySelector("#door .planet[data-section=install]").click();
        requestAnimationFrame(() => history.back());
      });
      /* a flight that ignored Back lands within this wait, and the pad shows */
      try { await p.locator("#installpad").waitFor({ state: "visible", timeout: 25000 }); } catch { /* none: Back was honoured */ }
      if (await p.locator("#installpad").isVisible()) throw new Error(`#installpad is open after Back (hash ${JSON.stringify(await p.evaluate(() => location.hash))})`);
      if (!(await p.locator("#door").isVisible())) throw new Error("#door is not shown after Back");
      const hash = await p.evaluate(() => location.hash);
      if (hash !== "") throw new Error(`location.hash is ${JSON.stringify(hash)} after Back, want ""`);
    });
  });
};
if (maintenance) {
  console.log("     (and the landings, past the door with ?preview)");
  await landings("?preview");
} else {
  await landings("");
}

await step("404 is the site's own", async () => {
  expectNotFound = true;
  try {
    const res = await page.goto(SITE + "no-such-page", { waitUntil: "load" });
    if (res.status() !== 404) throw new Error(`status ${res.status()}`);
  } finally { await page.waitForTimeout(300); expectNotFound = false; }
});

await browser.close();
server?.kill();
const real = problems.filter((p) => !/favicon/.test(p));
if (real.length) { console.log("\njourney: failed"); for (const p of real) console.log(" - " + p); process.exit(1); }
console.log("\njourney: ok");
