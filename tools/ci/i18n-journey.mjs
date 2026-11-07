/*
 * Live test for orbit-site #125 stage 1 (German proves the pattern), written from the specification alone (issue
 * #125, note 52457 and the AI-notice addition), in a real browser:
 *
 *   J1  de/ renders German text (a sample key from the catalogues), and the #docs hash link opens the docs pad there
 *   J2  the AI notice is visible on the de/ door and on the docs pad, in German; its English link opens the English
 *       page with the same hash and stays there (the visitor's browser is German)
 *   J3  the switch goes en -> de -> en, keeps the hash and stores orbit-lang each time
 *   J4  the root with locale de-DE and no stored choice lands on de/ with the hash kept
 *   J5  the root with locale de-DE and stored "en" stays at the root
 *   J6  de/ with an English browser never redirects (one navigation only)
 *   J7  the root shows no AI notice
 *   J9  (#138, ALL-S1) a German browser that keeps nothing (site data blocked) and sends no referrer: the root sends it to
 *       de/; the notice's English link there opens the English page and it stays (it is not sent back to de/)
 *   J10 (#138, ALL-F6) the notice's English link, opened in a new tab with a modifier-click, a middle click or copied from
 *       the context menu, points at the address the visitor is at now (the site moves its hash without a hashchange), not
 *       the one the page loaded with
 *
 * Contract the page is held to (the builder's): <html lang>, data-i18n keys, localStorage "orbit-lang", the notice
 * an element with class .ai-notice holding an <a hreflang="en"> to the English page, and the switch links
 * [data-lang="en"] / [data-lang="de"]. Waits are on the page's own state (URL, hidden attribute, stored value), never
 * on time.
 *
 *   PLAYWRIGHT_ROOT=... BROWSER=chromium node tools/ci/i18n-journey.mjs
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { freePort, openBrowser } from "./live-lib.mjs";

const playwright = createRequire(import.meta.url)(process.env.PLAYWRIGHT_ROOT || "playwright");
const BROWSER = process.env.BROWSER || "chromium";
const SITE = process.env.SITE || `http://127.0.0.1:${await freePort()}/`;
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "../..");
const server = process.env.SITE ? null : spawn(process.execPath, [join(here, "serve.mjs"), new URL(SITE).port], { stdio: ["ignore", "ignore", "inherit"] });

let failed = false;
const check = (name, ok, detail) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`); if (!ok) failed = true; };
const inDe = (u) => new URL(u).pathname.endsWith("/de/") || new URL(u).pathname.endsWith("/de/index.html");
const stored = (page) => page.evaluate(() => { try { return localStorage.getItem("orbit-lang"); } catch { return "unreadable"; } });
let Q = ""; /* "" when the site is open, "?preview" past the maintenance door, as journey.mjs does; it must survive every move */
const keeps = (u) => new URL(u).search === Q;
/* the switch is a dropdown: a button (aria-expanded) showing the current code, a list of links, one per built language */
const MENU = ".langs";
const toggle = (page) => page.locator(`${MENU} button[aria-expanded]:visible`).first();
const expanded = (page) => toggle(page).getAttribute("aria-expanded");
const openMenu = async (page) => {
  const b = toggle(page);
  await b.waitFor({ state: "visible" });
  if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
  await page.waitForFunction(() => [...document.querySelectorAll(".langs button[aria-expanded]")].some((e) => e.offsetParent && e.getAttribute("aria-expanded") === "true"));
};
const docsOpen = (page) => page.waitForFunction(() => { const p = document.getElementById("docspad"); return !!p && !p.hidden; });

let browser = null;
const run = async (name, opts, fn) => {
  let ctx = null;
  try {
    ctx = await browser.newContext({ viewport: { width: 1000, height: 800 }, reducedMotion: "reduce", ...opts.context });
    if (opts.stored) await ctx.addInitScript((v) => { try { localStorage.setItem("orbit-lang", v); } catch {} }, opts.stored);
    const page = await ctx.newPage();
    await fn(page);
  } catch (e) {
    check(name, false, String(e && e.message || e).split("\n")[0]);
  } finally {
    if (ctx) await ctx.close();
  }
};

try {
  browser = await openBrowser(playwright, BROWSER);
  {
    const probe = await browser.newPage();
    await probe.goto(SITE, { waitUntil: "load" });
    if (await probe.evaluate(() => document.documentElement.hasAttribute("data-maintenance"))) Q = "?preview";
    await probe.close();
  }
  /* the catalogues are read at the start: a sample key whose German differs, with plain text, found on the page */
  const en = JSON.parse(readFileSync(join(ROOT, "assets/i18n/en.json"), "utf8"));
  const de = JSON.parse(readFileSync(join(ROOT, "assets/i18n/de.json"), "utf8"));
  await run("J1", { context: { locale: "en-US" } }, async (page) => {
    await page.goto(`${SITE}de/${Q}#docs`, { waitUntil: "load" });
    await docsOpen(page);
    const lang = await page.evaluate(() => document.documentElement.lang);
    const keys = await page.evaluate(() => [...document.querySelectorAll("[data-i18n]")].map((e) => [e.dataset.i18n, e.textContent.trim()]));
    const hit = keys.filter(([k, text]) => en[k] && de[k] && en[k] !== de[k] && text === de[k]);
    const english = keys.filter(([k, text]) => en[k] && de[k] && en[k] !== de[k] && text === en[k]);
    check("J1 de/ renders German and #docs opens the docs pad", lang === "de" && hit.length >= 3 && english.length === 0, `lang ${lang}, ${hit.length} German, ${english.length} still English`);
  });

  await run("J2", { context: { locale: "de-DE" }, stored: "de" }, async (page) => {
    await page.goto(`${SITE}de/${Q}`, { waitUntil: "load" });
    const door = page.locator("#door .ai-notice");
    await door.first().waitFor({ state: "visible" });
    const text = (await door.first().innerText()).trim();
    check("J2a the notice shows on the de/ door, in German", text.length > 0 && text !== en["ai-notice"], JSON.stringify(text.slice(0, 60)));
    await page.goto(`${SITE}de/${Q}#docs`, { waitUntil: "load" });
    await docsOpen(page);
    const pad = page.locator("#docspad .ai-notice");
    await pad.first().waitFor({ state: "visible" });
    check("J2b the notice shows on the docs pad", await pad.first().isVisible(), "visible");
    await pad.first().locator("a[hreflang='en']").click();
    await page.waitForURL((u) => !inDe(u.href) && u.hash === "#docs" && keeps(u.href));
    await docsOpen(page);
    check("J2c the notice's English link opens the English page, hash and query kept, and stays there", !inDe(page.url()) && keeps(page.url()) && page.url().endsWith(Q + "#docs") && (await page.evaluate(() => document.documentElement.lang)).startsWith("en"), page.url());
  });

  await run("J3", { context: { locale: "en-US" } }, async (page) => {
    await page.goto(`${SITE}${Q}#docs`, { waitUntil: "load" });
    await docsOpen(page);
    await openMenu(page);
    await page.locator(`${MENU} a[data-lang='de']:visible`).first().click();
    await page.waitForURL((u) => inDe(u.href) && u.hash === "#docs" && keeps(u.href));
    await page.waitForFunction(() => { try { return localStorage.getItem("orbit-lang") === "de"; } catch { return false; } });
    check("J3a switch to Deutsch: de/, hash and query kept, choice stored", inDe(page.url()) && keeps(page.url()) && (await stored(page)) === "de" && (await page.evaluate(() => document.documentElement.lang)) === "de", page.url());
    await docsOpen(page);
    await openMenu(page);
    await page.locator(`${MENU} a[data-lang='en']:visible`).first().click();
    await page.waitForURL((u) => !inDe(u.href) && u.hash === "#docs" && keeps(u.href));
    await page.waitForFunction(() => { try { return localStorage.getItem("orbit-lang") === "en"; } catch { return false; } });
    check("J3b switch back to English: root, hash and query kept, choice stored", !inDe(page.url()) && keeps(page.url()) && (await stored(page)) === "en", page.url());
  });

  await run("J8", { context: { locale: "en-US" } }, async (page) => {
    await page.goto(`${SITE}${Q}#docs`, { waitUntil: "load" });
    await docsOpen(page);
    const code = async () => ((await toggle(page).innerText()).trim().toUpperCase());
    check("J8a the button shows EN at the root, closed", (await code()) === "EN" && (await expanded(page)) === "false", `${await code()} / ${await expanded(page)}`);
    await openMenu(page);
    const links = await page.locator(`${MENU} a[data-lang]:visible`).evaluateAll((as) => as.map((a) => ({ d: a.dataset.lang, h: a.getAttribute("hreflang"), l: a.getAttribute("lang"), href: a.getAttribute("href"), t: a.textContent.trim() })));
    const ok = ["en", "de"].every((c) => links.some((x) => x.d === c && x.h === c && x.l === c && x.href)) && links.some((x) => /^DE\s*·\s*Deutsch$/.test(x.t)) && links.some((x) => /^EN\s*·\s*English$/.test(x.t));
    check("J8b opening shows one link per language, with hreflang, lang, href and text like \"DE · Deutsch\"", ok, JSON.stringify(links));
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => [...document.querySelectorAll(".langs button[aria-expanded]")].every((e) => e.getAttribute("aria-expanded") === "false"));
    check("J8c Escape closes the menu", (await expanded(page)) === "false", await expanded(page));
    await openMenu(page);
    await page.mouse.click(2, 790);
    await page.waitForFunction(() => [...document.querySelectorAll(".langs button[aria-expanded]")].every((e) => e.getAttribute("aria-expanded") === "false"));
    check("J8d an outside click closes the menu", (await expanded(page)) === "false", await expanded(page));
    await page.goto(`${SITE}de/${Q}#docs`, { waitUntil: "load" });
    await docsOpen(page);
    check("J8e the button shows DE on de/", (await code()) === "DE", await code());
  });

  await run("J4", { context: { locale: "de-DE" } }, async (page) => {
    await page.goto(`${SITE}${Q}#docs`, { waitUntil: "load" });
    await page.waitForURL((u) => inDe(u.href) && u.hash === "#docs" && keeps(u.href));
    await docsOpen(page);
    check("J4 root with de-DE and no stored choice lands on de/ with hash and query", inDe(page.url()) && keeps(page.url()) && page.url().endsWith(Q + "#docs"), page.url());
  });

  await run("J5", { context: { locale: "de-DE" }, stored: "en" }, async (page) => {
    await page.goto(`${SITE}${Q}#docs`, { waitUntil: "load" });
    await docsOpen(page);
    await page.evaluate(() => document.fonts.ready);
    check("J5 stored en keeps a German browser at the root", !inDe(page.url()) && page.url().endsWith(Q + "#docs"), page.url());
  });

  await run("J6", { context: { locale: "en-US" } }, async (page) => {
    const navs = [];
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) navs.push(f.url()); });
    await page.goto(`${SITE}de/${Q}#docs`, { waitUntil: "load" });
    await docsOpen(page);
    await page.evaluate(() => document.fonts.ready);
    check("J6 de/ with an English browser never redirects", inDe(page.url()) && navs.every(inDe), JSON.stringify(navs));
  });

  await run("J7", { context: { locale: "en-US" } }, async (page) => {
    await page.goto(`${SITE}${Q}`, { waitUntil: "load" });
    await page.locator("#door").waitFor({ state: "visible" });
    await page.goto(`${SITE}${Q}#docs`, { waitUntil: "load" });
    await docsOpen(page);
    const shown = await page.locator(".ai-notice:visible").count();
    check("J7 the root shows no AI notice", shown === 0, `${shown} visible`);
  });
  /* J9 (#138, ALL-S1): site data blocked and the referrer stripped, as a privacy setting does: nothing is left to remember
     the visitor's choice by but the address the English link opens */
  await run("J9", { context: { locale: "de-DE" } }, async (page) => {
    const navs = [];
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) navs.push(f.url()); });
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new DOMException("blocked", "SecurityError"); } });
      Object.defineProperty(Document.prototype, "referrer", { configurable: true, get() { return ""; } });
    });
    await page.goto(`${SITE}${Q}#docs`, { waitUntil: "load" });
    await page.waitForURL((u) => inDe(u.href) && u.hash === "#docs");
    await docsOpen(page);
    const pad = page.locator("#docspad .ai-notice a[hreflang='en']");
    await pad.first().waitFor({ state: "visible" });
    const mark = navs.length;
    await pad.first().click();
    await page.waitForURL((u) => !inDe(u.href));
    await page.waitForLoadState("load");
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    const after = navs.slice(mark);
    check("J9 a German browser that keeps nothing and sends no referrer reaches the English page from the notice's link, and stays", !inDe(page.url()) && after.every((u) => !inDe(u)) && (await page.evaluate(() => document.documentElement.lang).catch(() => "")).startsWith("en"), JSON.stringify(after));
  });

  /* J10 (#138, ALL-F6): the site moves its hash with history.pushState (no hashchange), so the notice's English link must be
     aimed at the address now, whichever way the visitor takes it: modifier-click or middle click (a new tab), or the context menu */
  await run("J10", { context: { locale: "de-DE" }, stored: "de" }, async (page) => {
    await page.goto(`${SITE}de/${Q}#docs`, { waitUntil: "load" });
    await docsOpen(page);
    await page.locator("#docspad .entry").first().waitFor({ state: "attached", timeout: 30000 });
    await page.evaluate(() => document.querySelector("#docspad .entry").click());
    await page.waitForFunction(() => location.hash.startsWith("#docs/") && !!document.querySelector("#docspad .reader") && !document.querySelector("#docspad").hidden);
    const here = await page.evaluate(() => location.hash);
    const link = page.locator("#docspad .ai-notice a[hreflang='en']");
    await link.first().waitFor({ state: "visible" });
    const opened = async (init) => {
      const [tab] = await Promise.all([page.context().waitForEvent("page"), link.first().click(init)]);
      await tab.waitForURL((u) => u.href !== "about:blank");
      const at = new URL(tab.url());
      await tab.close();
      return at;
    };
    const ctrl = await opened({ modifiers: ["Control"] });
    check("J10a a modifier-click on the notice's English link opens the English page at the address the visitor is at now", !inDe(ctrl.href) && ctrl.hash === here, `${ctrl.href} (want ${here})`);
    const middle = await opened({ button: "middle" });
    check("J10b a middle click opens it there too", !inDe(middle.href) && middle.hash === here, `${middle.href} (want ${here})`);
    await link.first().click({ button: "right" });
    const copied = new URL(await link.first().evaluate((a) => a.href));
    check("J10c the link the context menu copies is aimed there too", copied.hash === here, `${copied.href} (want ${here})`);
  });
} catch (e) {
  check("harness", false, String(e && e.stack || e));
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
process.exit(failed ? 1 : 0);
