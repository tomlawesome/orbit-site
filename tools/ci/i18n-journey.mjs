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
 *   J9  a translated docs page older than the English shows the stale banner, with a link to the English
 *   J9c a page with sections left in English (source.kept) and nothing else wrong shows a banner that does not say the English has changed
 *   J9d (#145) a page whose section carries an `en` that is not the English section's hash16 shows the banner that says the English has changed
 *   J9e (#145) a page whose sections are not the English page's sections (one missing) shows the banner that says the English has changed
 *   J10 the de/ reader reads assets/docs-i18n/de/; a translated page shows no untranslated line, a page with no German file is read in
 *       English with that line shown (decision 11a: page-level, never per section); the root never asks for it
 *   J11 (#138, ALL-S1) a German browser that keeps nothing (site data blocked) and sends no referrer: the root sends it to
 *       de/; the notice's English link there opens the English page and it stays (it is not sent back to de/)
 *   J12 (#138, ALL-F6) the notice's English link, opened in a new tab with a modifier-click, a middle click or copied from
 *       the context menu, points at the address the visitor is at now (the site moves its hash without a hashchange), not
 *       the one the page loaded with
 *   J14-J16 (#125 languages live) per built language: the door's notice at its foot, the English link, the hide button
 *   K1-K9 (#173 Arabic, right to left): corners, the docs reader, the drawers, the dial and transport, letter-spacing and
 *       small print, <bdi> around inserted values, the stale line's English link; each against the root as the control
 *   J13 (#164) the docs pad: a query that matches shows the filtered heading with a count; a query that matches nothing
 *       shows the empty state
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
import { createHash } from "node:crypto";
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
/* the pad un-hidden is not the docs loaded: render() returns early until the index arrives (#164), so also wait, bounded,
   for the results list it draws from it */
const docsOpen = async (page) => {
  await page.waitForFunction(() => { const p = document.getElementById("docspad"); return !!p && !p.hidden; });
  await page.waitForFunction(() => !!document.querySelector("#docspad .entry"), null, { timeout: 20000 });
};

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

  /* J13 (#164): the docs pad's filtered heading and its empty state, which no other step reaches (pads.js render()). Class and
     attribute selectors only; the query is a word read from the first entry, so no localised text is typed or matched. No group
     is chosen: a click on a chart name timed out in every browser (pipeline 5074), and a query alone reaches both branches. */
  await run("J13", { context: { locale: "en-US" } }, async (page) => {
    await page.goto(`${SITE}${Q}#docs`, { waitUntil: "load" });
    await docsOpen(page);
    const pad = page.locator("#docspad");
    const word = await pad.locator(".results .entry b").first().evaluate((b) => (b.textContent.match(/\p{L}{3,}/u) || [""])[0]);
    check("J13 a word could be read from the first entry", word.length >= 3, `word ${JSON.stringify(word)}`);
    await pad.locator(".search input").fill(word);
    const head = pad.locator(".results section > h4").first();
    await page.waitForFunction(() => /\d/.test(document.querySelector("#docspad .results section > h4")?.textContent || ""), null, { timeout: 20000 }).catch(() => {});
    const text = (await head.textContent().catch(() => "")) || "";
    check("J13a a query that matches shows the filtered heading with a count", /\d/.test(text) && (await pad.locator(".results .entry").count()) >= 1, `heading ${JSON.stringify(text)}`);
    await pad.locator(".search input").fill("qzxqzxqzx");
    await page.waitForSelector("#docspad .results .none", { timeout: 20000 }).catch(() => {});
    check("J13b a query that matches nothing shows the empty state (.none) and no entries", (await pad.locator(".results .none").count()) === 1 && (await pad.locator(".results .entry").count()) === 0, `${await pad.locator(".results .none").count()} empty state(s), ${await pad.locator(".results .entry").count()} entries`);
  });

  /* J9, J10 (#125 stage 2): fake German docs served by route, so no built translation is needed in the tree. The
     page "readme" is translated (its second section kept in English, its hash not the English's: the stale banner says
     so, J9); every other page has no German file (404: the whole English page is read, and the untranslated line shown). With fresh, every
     section's hash matches the English and none is kept: spec 3 shows the stale banner when "any [hash] differs from
     source.sections, or source.kept is non-empty", so only such a page can show none (J9b). Since #145 the hash is each section's own first field, en (source is {generated, kept}). The German page is known
     to be shown by its title in the reader's heading: the reader sets a page's title and its sections' html, never the
     first ("top") section's title, so the fake's "Orbit auf Deutsch" is in no element. */
  const h16 = (x) => createHash("sha256").update(x, "utf8").digest("hex").slice(0, 16);
  const eIndex = JSON.parse(readFileSync(join(ROOT, "assets/docs/index.json"), "utf8"));
  const eReadme = JSON.parse(readFileSync(join(ROOT, "assets/docs/readme.json"), "utf8"));
  const fakeDocs = async (page, generated, fresh = false, keptOnly = false, tweak = null) => {
    const asked = [];
    const first = eReadme.sections[0], second = eReadme.sections[1];
    const dPage = { ...eReadme, title: "Orbit (de)", sections: eReadme.sections.map((x, i) => ({ en: i === 1 && !fresh ? "0000000000000000" : h16(JSON.stringify([x.title, x.html, x.subs])), ...x, title: i === 0 ? "Orbit auf Deutsch" : x.title })),
      source: { generated, kept: second && (!fresh || keptOnly) ? [second.id] : [] } };
    if (tweak) tweak(dPage);
    const dIndex = { generated, sources: eIndex.sources.filter((x) => x.slug === "readme").map((x) => ({ ...x, title: "Orbit (de)" })) };
    await page.route("**/assets/docs-i18n/**", (route) => {
      const u = new URL(route.request().url()); asked.push(u.pathname);
      const f = u.pathname.split("/").pop();
      if (f === "index.json") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dIndex) });
      if (f === "readme.json") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dPage) });
      return route.fulfill({ status: 404, body: "" });
    });
    return { asked, first };
  };
  await run("J9", { context: { locale: "de-DE" }, stored: "de" }, async (page) => {
    const fake = await fakeDocs(page, "2000-01-01T00:00:00Z");
    await page.goto(`${SITE}de/${Q}#docs/readme`, { waitUntil: "load" });
    await docsOpen(page);
    const banner = page.locator("#docspad .docs-stale");
    await banner.first().waitFor({ state: "visible", timeout: 8000 });
    const link = await banner.first().locator("a[hreflang='en']").count();
    check("J9a an older translation shows the stale banner (.docs-stale) with a link to the English (hreflang en)", link >= 1, `${link} link(s), asked ${JSON.stringify(fake.asked)}`);
  });
  await run("J9b", { context: { locale: "de-DE" }, stored: "de" }, async (page) => {
    await fakeDocs(page, eIndex.generated, true);
    await page.goto(`${SITE}de/${Q}#docs/readme`, { waitUntil: "load" });
    await docsOpen(page);
    await page.waitForFunction(() => document.querySelector("#docspad .readhead h1")?.textContent === "Orbit (de)", null, { timeout: 8000 });
    const n = await page.locator("#docspad .docs-stale:visible").count();
    check("J9b a translation as new as the English shows no stale banner", n === 0, `${n} visible`);
  });
  /* fix review 4: a banner that shows only because a section was left in English (source.kept: two failed tries, a RETRY_HASH)
     while every hash matches the English and the stamp is the English's must not say the English has changed since. */
  await run("J9c", { context: { locale: "de-DE" }, stored: "de" }, async (page) => {
    await fakeDocs(page, eIndex.generated, true, true);
    await page.goto(`${SITE}de/${Q}#docs/readme`, { waitUntil: "load" });
    await docsOpen(page);
    const banner = page.locator("#docspad .docs-stale");
    await banner.first().waitFor({ state: "visible", timeout: 8000 });
    const text = (await banner.first().textContent()) || "";
    const de = JSON.parse(readFileSync(join(ROOT, "assets/i18n/de.json"), "utf8"));
    const changed = String(de["docs-stale"]).split("{date}").pop().replace(/^[\s;,.]+/, "").replace(/[\s.]+$/, ""); /* "das Englische hat sich seitdem geändert" */
    const link = await banner.first().locator("a[hreflang='en']").count();
    check("J9c a page with sections left in English and nothing else wrong shows a banner with a link to the English", link >= 1 && text.trim().length > 0, `${link} link(s), "${text.trim()}"`);
    check("J9c and that banner does not say the English has changed since", changed.length > 5 && !text.includes(changed), `banner "${text.trim()}", the changed-since line ends "${changed}"`);
  });
  /* #145: a section's own en is what the reader compares. Every other en is the English's hash, none is the retry hash and
     source.kept is empty, so the only thing that can make the banner is the change under test, and it must say the English changed. */
  const changedLine = () => { const de = JSON.parse(readFileSync(join(ROOT, "assets/i18n/de.json"), "utf8")); return String(de["docs-stale"]).split("{date}").pop().replace(/^[\s;,.]+/, "").replace(/[\s.]+$/, ""); };
  await run("J9d", { context: { locale: "de-DE" }, stored: "de" }, async (page) => {
    await fakeDocs(page, eIndex.generated, true, false, (d) => { d.sections[0].en = "0123456789abcdef"; });
    await page.goto(`${SITE}de/${Q}#docs/readme`, { waitUntil: "load" });
    await docsOpen(page);
    const banner = page.locator("#docspad .docs-stale");
    await banner.first().waitFor({ state: "visible", timeout: 8000 });
    const text = (await banner.first().textContent()) || "", changed = changedLine();
    check("J9d a section whose en is not the English's hash16 shows the banner that says the English has changed", changed.length > 5 && text.includes(changed), `banner "${text.trim()}", the changed-since line ends "${changed}"`);
  });
  await run("J9e", { context: { locale: "de-DE" }, stored: "de" }, async (page) => {
    await fakeDocs(page, eIndex.generated, true, false, (d) => { d.sections = d.sections.slice(0, -1); });
    await page.goto(`${SITE}de/${Q}#docs/readme`, { waitUntil: "load" });
    await docsOpen(page);
    const banner = page.locator("#docspad .docs-stale");
    await banner.first().waitFor({ state: "visible", timeout: 8000 });
    const text = (await banner.first().textContent()) || "", changed = changedLine();
    check("J9e a page with a section fewer than the English shows the banner that says the English has changed", changed.length > 5 && text.includes(changed), `banner "${text.trim()}", the changed-since line ends "${changed}"`);
  });
  await run("J10", { context: { locale: "de-DE" }, stored: "de" }, async (page) => {
    const fake = await fakeDocs(page, eIndex.generated);
    await page.goto(`${SITE}de/${Q}#docs/readme`, { waitUntil: "load" });
    await docsOpen(page);
    await page.waitForFunction(() => document.querySelector("#docspad .readhead h1")?.textContent === "Orbit (de)", null, { timeout: 8000 });
    check("J10a the de/ reader asks for assets/docs-i18n/de/", fake.asked.some((u) => u.endsWith("/assets/docs-i18n/de/readme.json") || u.endsWith("/assets/docs-i18n/de/index.json")), JSON.stringify(fake.asked));
    /* the line is in the page's markup (de/index.html) without a hidden attribute, so a count of the elements proves nothing:
       what matters is whether the visitor sees it (decision 11a: it stands over an English page, never a translated one) */
    const un = await page.locator("#docspad .reader .untranslated:visible").count();
    check("J10b a translated page shows no untranslated line (#docspad .reader .untranslated is not visible)", un === 0, `${un} visible`);
    const gone = eIndex.sources.find((x) => x.slug !== "readme");
    await page.goto(`${SITE}de/${Q}#docs/${gone.slug}`, { waitUntil: "load" });
    await page.waitForFunction((t) => document.getElementById("docspad").textContent.includes(t), gone.sections[0].title, { timeout: 8000 });
    const shownGone = await page.locator("#docspad .reader .untranslated:visible").count();
    const h1 = (await page.locator("#docspad .readhead h1").textContent()) || "";
    const asked404 = fake.asked.some((u) => u.endsWith(`/assets/docs-i18n/de/${gone.slug}.json`));
    check("J10c a page with no German file is read in English, with the untranslated line shown", asked404 && shownGone === 1 && h1 !== "Orbit (de)" && h1.length > 0,
      `asked the German file: ${asked404}; ${shownGone} visible line(s); heading "${h1}"`);
  });
  await run("J10d", { context: { locale: "en-US" } }, async (page) => {
    const fake = await fakeDocs(page, eIndex.generated);
    await page.goto(`${SITE}${Q}#docs/readme`, { waitUntil: "load" });
    await docsOpen(page);
    await page.waitForFunction((t) => document.getElementById("docspad").textContent.includes(t), eReadme.sections[0].title, { timeout: 8000 });
    check("J10d the root (English) never asks for assets/docs-i18n/", fake.asked.length === 0, JSON.stringify(fake.asked));
  });

  /* J11 (#138, ALL-S1): site data blocked and the referrer stripped, as a privacy setting does: nothing is left to remember
     the visitor's choice by but the address the English link opens */
  await run("J11", { context: { locale: "de-DE" } }, async (page) => {
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
    check("J11 a German browser that keeps nothing and sends no referrer reaches the English page from the notice's link, and stays", !inDe(page.url()) && after.every((u) => !inDe(u)) && (await page.evaluate(() => document.documentElement.lang).catch(() => "")).startsWith("en"), JSON.stringify(after));
  });

  /* J12 (#138, ALL-F6): the site moves its hash with history.pushState (no hashchange), so the notice's English link must be
     aimed at the address now, whichever way the visitor takes it: modifier-click or middle click (a new tab), or the context menu */
  await run("J12", { context: { locale: "de-DE" }, stored: "de" }, async (page) => {
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
    check("J12a a modifier-click on the notice's English link opens the English page at the address the visitor is at now", !inDe(ctrl.href) && ctrl.hash === here, `${ctrl.href} (want ${here})`);
    const middle = await opened({ button: "middle" });
    check("J12b a middle click opens it there too", !inDe(middle.href) && middle.hash === here, `${middle.href} (want ${here})`);
    await link.first().click({ button: "right" });
    const copied = new URL(await link.first().evaluate((a) => a.href));
    check("J12c the link the context menu copies is aimed there too", copied.hash === here, `${copied.href} (want ${here})`);
  });

  /* J14-J16 (#125 languages live, spec section 5): every language languages.json builds, the notice at the door's foot, the
     English link kept, the hide button. The languages are read from the file, so the six going live are tested the moment
     they are built (and J14a fails until they are). */
  const LANGS = JSON.parse(readFileSync(join(ROOT, "tools/i18n/languages.json"), "utf8"));
  const builtNow = Object.keys(LANGS).filter((k) => LANGS[k].built);
  const SIX = ["fr", "es", "pt", "id", "zh-Hans", "ja"];
  const visible = (page, sel) => page.evaluate((q) => { const e = document.querySelector(q); if (!e) return false; const c = getComputedStyle(e), r = e.getBoundingClientRect(); return c.visibility !== "hidden" && c.display !== "none" && +c.opacity > 0.01 && r.width > 0 && r.height > 0; }, sel);
  const hiddenNow = (page, sel) => page.waitForFunction((q) => { const e = document.querySelector(q); if (!e) return true; const c = getComputedStyle(e); return c.visibility === "hidden" || c.display === "none" || +c.opacity === 0; }, sel, { timeout: 8000 }).then(() => true, () => false);
  check("J14a fr, es, pt, id, zh-Hans, ja and ar are built (languages.json)", SIX.every((k) => LANGS[k]?.built === true) && LANGS.ar?.built === true, `built: ${JSON.stringify(builtNow)}`);
  for (const lang of builtNow) {
    for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      const tag = `${lang} ${size.width}x${size.height}`;
      await run(`J14 ${tag}`, { context: { locale: "en-US", viewport: size }, stored: lang }, async (page) => {
        await page.goto(`${SITE}${lang}/${Q}`, { waitUntil: "load" });
        await page.waitForFunction(() => document.body.classList.contains("lit"), null, { timeout: 20000 });
        await page.locator("#door .ai-notice").first().waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
        const box = await page.locator("#door .ai-notice").first().boundingBox().catch(() => null);
        const lit = await visible(page, "#door .ai-notice");
        check(`J14b ${tag}: the door's notice is visible once the door is lit`, lit, `visible ${lit}`);
        check(`J14c ${tag}: its top edge is below the viewport's vertical midpoint (the foot, not the top)`, !!box && box.y > size.height / 2, `top ${box ? Math.round(box.y) : "none"}, midpoint ${size.height / 2}`);
        const gone = {};
        for (const cls of ["launching", "departing", "showdusk"]) {
          await page.evaluate((c) => document.body.classList.add(c), cls);
          gone[cls] = await hiddenNow(page, "#door .ai-notice");
          await page.evaluate((c) => document.body.classList.remove(c), cls);
        }
        check(`J14d ${tag}: the notice is invisible while body carries launching, departing or showdusk`, Object.values(gone).every(Boolean), JSON.stringify(gone));
        await page.evaluate(() => document.body.classList.remove("lit"));
        const unlit = await hiddenNow(page, "#door .ai-notice");
        check(`J14e ${tag}: and while the door is not lit`, unlit, `hidden ${unlit}`);
      });
    }
  }

  for (const lang of builtNow) {
    await run(`J15 ${lang}`, { context: { locale: lang === "zh-Hans" ? "zh-CN" : lang } }, async (page) => {
      await page.goto(`${SITE}${lang}/?preview#docs/installing`, { waitUntil: "load" });
      await docsOpen(page);
      const link = page.locator("#docspad .ai-notice a[hreflang='en']").first();
      await link.waitFor({ state: "visible" });
      const href = new URL(await link.evaluate((a) => a.href));
      check(`J15a ${lang}: the English link is the root with ?preview&lang=en#docs/installing`, href.pathname === new URL(SITE).pathname && href.search === "?preview&lang=en" && href.hash === "#docs/installing", href.href);
      await link.click();
      await page.waitForURL((u) => !u.pathname.startsWith(new URL(`${SITE}${lang}/`).pathname) && u.hash === "#docs/installing");
      await page.waitForLoadState("load");
      const st = await page.evaluate(() => [document.documentElement.lang, (() => { try { return localStorage.getItem("orbit-lang"); } catch { return "unreadable"; } })()]);
      check(`J15b ${lang}: a click lands on the English page, <html lang> en, orbit-lang stored en`, st[0].startsWith("en") && st[1] === "en", JSON.stringify(st));
      await page.goto(`${SITE}?preview`, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready).catch(() => {});
      check(`J15c ${lang}: reloading the root stays English`, new URL(page.url()).pathname === new URL(SITE).pathname && (await page.evaluate(() => document.documentElement.lang)).startsWith("en"), page.url());
    });
    await run(`J15d ${lang}`, { context: { locale: lang === "zh-Hans" ? "zh-CN" : lang } }, async (page) => {
      await page.addInitScript(() => {
        Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new DOMException("blocked", "SecurityError"); } });
        Object.defineProperty(Document.prototype, "referrer", { configurable: true, get() { return ""; } });
      });
      await page.goto(`${SITE}${lang}/?preview#docs/installing`, { waitUntil: "load" });
      await docsOpen(page);
      const link = page.locator("#docspad .ai-notice a[hreflang='en']").first();
      await link.waitFor({ state: "visible" });
      await link.click();
      await page.waitForURL((u) => new URL(u).pathname === new URL(SITE).pathname);
      await page.waitForLoadState("load");
      await page.evaluate(() => document.fonts.ready).catch(() => {});
      check(`J15d ${lang}: site data blocked, no referrer: the same link stays English`, new URL(page.url()).pathname === new URL(SITE).pathname && (await page.evaluate(() => document.documentElement.lang).catch(() => "")).startsWith("en"), page.url());
    });
  }

  for (const lang of builtNow) {
    await run(`J16 ${lang}`, { context: { locale: "en-US" }, stored: lang }, async (page) => {
      await page.goto(`${SITE}${lang}/${Q}`, { waitUntil: "load" });
      const n = await page.locator(".ai-notice").count();
      const before = await page.evaluate(() => [...document.querySelectorAll(".ai-notice")].map((e) => e.hidden || getComputedStyle(e).display === "none"));
      await page.locator("#door .ai-notice .hide").first().waitFor({ state: "attached" });
      await page.evaluate(() => document.querySelector("#door .ai-notice .hide").click());
      const all = () => page.evaluate(() => [...document.querySelectorAll(".ai-notice")].map((e) => e.hidden || getComputedStyle(e).display === "none"));
      const after = await all();
      check(`J16a ${lang}: x hides all four notices`, n === 4 && after.length === 4 && after.every(Boolean) && !before.every(Boolean), `${n} notices; hidden before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`);
      await page.reload({ waitUntil: "load" });
      check(`J16b ${lang}: a reload in the same tab keeps them hidden`, (await all()).every(Boolean), JSON.stringify(await all()));
      const ctx2 = await browser.newContext({ viewport: { width: 1000, height: 800 }, locale: "en-US" });
      try {
        await ctx2.addInitScript((v) => { try { localStorage.setItem("orbit-lang", v); } catch {} }, lang);
        const p2 = await ctx2.newPage();
        await p2.goto(`${SITE}${lang}/${Q}`, { waitUntil: "load" });
        const fresh = await p2.evaluate(() => [...document.querySelectorAll(".ai-notice")].map((e) => e.hidden || getComputedStyle(e).display === "none"));
        check(`J16c ${lang}: a fresh session shows them`, fresh.length === 4 && !fresh.some(Boolean), JSON.stringify(fresh));
      } finally { await ctx2.close(); }
      await fakeDocs(page, "2000-01-01T00:00:00Z");
      await page.goto(`${SITE}${lang}/${Q}#docs/readme`, { waitUntil: "load" });
      await docsOpen(page);
      await page.locator("#docspad .docs-stale").first().waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
      const stale = await page.locator("#docspad .docs-stale .hide, #docspad .docs-stale button").count();
      check(`J16d ${lang}: .docs-stale has no hide control`, stale === 0, `${stale} control(s)`);
    });
  }

  /* ---- K (#173 Arabic, right to left): measured in the browser on ar/, with the root (and de/) as the control ----
     Class and attribute selectors only. The positions the root and de/ had before the change are the BEFORE table below
     (measured on the tree before #173, 1280x800 and 390x844, ?preview, the docs pad open), so "other languages unchanged"
     is a number, not a comparison with itself. RTL_MEASURE=1 prints them instead of checking. */
  const SIZES = [{ width: 1280, height: 800 }, { width: 390, height: 844 }];
  const rectOf = (sel) => (page) => page.evaluate((q) => { const e = [...document.querySelectorAll(q)].find((x) => x.offsetParent || getComputedStyle(x).position === "fixed"); if (!e) return null; const r = e.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) }; }, sel);
  const CORNERS = { langs: ".langs", back: "#docspad .back", home: "#docspad .mark-row.home" };
  const corners = async (page) => Object.fromEntries(await Promise.all(Object.entries(CORNERS).map(async ([k, q]) => [k, await rectOf(q)(page)])));
  const BEFORE = {
    "1280x800": {
      "de/": { langs: { l: 24, r: 52, t: 52, b: 74 }, back: { l: 24, r: 182, t: 22, b: 36 }, home: { l: 1187, r: 1256, t: 16, b: 38 } },
      root: { langs: { l: 24, r: 52, t: 52, b: 74 }, back: { l: 24, r: 107, t: 22, b: 36 }, home: { l: 1187, r: 1256, t: 16, b: 38 } },
    },
    "390x844": {
      "de/": { langs: { l: 16, r: 44, t: 52, b: 74 }, back: { l: 24, r: 182, t: 22, b: 36 }, home: { l: 297, r: 366, t: 16, b: 38 } },
      root: { langs: { l: 16, r: 44, t: 52, b: 74 }, back: { l: 24, r: 107, t: 22, b: 36 }, home: { l: 297, r: 366, t: 16, b: 38 } },
    },
  };
  const measuring = !!process.env.RTL_MEASURE;
  const enterHome = async (page, path) => {
    await page.goto(`${SITE}${path}?preview#home`, { waitUntil: "load" });
    await page.locator("#gate").waitFor({ state: "visible", timeout: 60000 });
    await page.locator("#gate").click();
    await page.locator("#transport.on").waitFor({ state: "attached", timeout: 60000 });
    await page.waitForFunction(() => !document.querySelector("#home").hidden && !/launching|showwarp/.test(document.body.className), null, { timeout: 60000 });
  };

  for (const size of SIZES) {
    const tag = `${size.width}x${size.height}`;
    const seen = {};
    for (const path of ["ar/", "de/", ""]) {
      await run(`K1 ${path || "root"} ${tag}`, { context: { locale: "en-US", viewport: size } }, async (page) => {
        await page.goto(`${SITE}${path}?preview#docs`, { waitUntil: "load" });
        await docsOpen(page);
        await page.evaluate(() => document.fonts.ready).catch(() => {});
        const c = await corners(page);
        seen[path] = c;
        if (measuring) { console.log(`MEASURE ${JSON.stringify([path || "root", tag, c])}`); return; }
        const W = size.width, mid = (r) => (r ? (r.l + r.r) / 2 : NaN);
        if (path === "ar/") {
          check(`K1a ar/ ${tag}: .langs and the pad's .back sit in the right-hand quarter, .mark-row.home in the left`, mid(c.langs) >= W * 0.75 && mid(c.back) >= W * 0.75 && mid(c.home) <= W * 0.25, JSON.stringify(c));
        } else {
          check(`K1b ${path || "root"} ${tag}: the other way round (.langs and .back left-hand, .mark-row.home right-hand), as before`, mid(c.langs) <= W * 0.5 && mid(c.back) <= W * 0.5 && mid(c.home) >= W * 0.5, JSON.stringify(c));
          const was = BEFORE[tag] && BEFORE[tag][path || "root"];
          const same = !!was && Object.keys(CORNERS).every((k) => c[k] && ["l", "r", "t", "b"].every((e) => Math.abs(c[k][e] - was[k][e]) <= 1));
          check(`K1c ${path || "root"} ${tag}: positions equal those measured before the change (within 1px)`, same, `now ${JSON.stringify(c)}, before ${JSON.stringify(was)}`);
        }
      });
    }
  }

  await run("K2 ar docs reader", { context: { locale: "en-US" } }, async (page) => {
    await page.goto(`${SITE}ar/?preview#docs/installing`, { waitUntil: "load" });
    await docsOpen(page);
    await page.waitForFunction(() => (document.querySelector("#docspad .reader .readhead h1")?.textContent || "").length > 0 && document.querySelectorAll("#docspad .reader p").length > 5, null, { timeout: 20000 });
    const r = await page.evaluate(() => {
      const reader = document.querySelector("#docspad .reader");
      /* the right edge of the first line of an element's text, and the right edge of its own content box */
      const edge = (e) => { const cs = getComputedStyle(e), rg = document.createRange(); rg.selectNodeContents(e); const line = rg.getClientRects()[0], box = e.getBoundingClientRect(); return { dir: cs.direction, line: line ? line.right : null, box: box.right - parseFloat(cs.paddingRight) }; };
      const ps = [...reader.querySelectorAll(".sections p, .body p, article p, p")].filter((p) => !p.closest("pre,.docs-stale,.untranslated,.ai-notice,.source") && p.textContent.trim().length > 40).slice(0, 3);
      const grid = reader.querySelector(".readgrid"), on = reader.querySelector(".onpage");
      const gr = grid.getBoundingClientRect(), orr = on.getBoundingClientRect();
      const nav = reader.querySelector(".readnav"), prev = nav.querySelector("a.prev, a:first-child"), next = nav.querySelector("a.next");
      const pr = prev && prev.getBoundingClientRect(), nr = next && next.getBoundingClientRect();
      const codes = [...reader.querySelectorAll("pre, code, kbd")].map((e) => { const cs = getComputedStyle(e); return [cs.direction, cs.textAlign]; });
      return { h1: edge(reader.querySelector(".readhead h1")), ps: ps.map(edge), onpageMid: (orr.left + orr.right) / 2, gridMid: (gr.left + gr.right) / 2, prevRight: pr && pr.right, nextLeft: nr && nr.left, codes };
    });
    const startsRight = (e) => e.dir === "rtl" && e.line !== null && e.line >= e.box - 3;
    check("K2a the reader's h1 has direction rtl and its text starts at the right edge", startsRight(r.h1), JSON.stringify(r.h1));
    check("K2b body paragraphs have direction rtl and start at the right edge", r.ps.length >= 1 && r.ps.every(startsRight), JSON.stringify(r.ps));
    check("K2c every pre, code and kbd has direction ltr and text-align start", r.codes.length >= 1 && r.codes.every(([d, a]) => d === "ltr" && a === "start"), JSON.stringify(r.codes.slice(0, 6)));
    check("K2d .onpage sits at the inline end (left half of the readgrid)", r.onpageMid < r.gridMid, `onpage ${r.onpageMid}, grid ${r.gridMid}`);
    check("K2e the .readnav previous link's right edge lies to the right of the next link's left edge", r.prevRight !== null && r.nextLeft !== null && r.prevRight > r.nextLeft, `prev right ${r.prevRight}, next left ${r.nextLeft}`);
  });

  /* the docs reader through a stale translation: the banner's inserted date and the English link (spec section 5) */
  await run("K3 ar stale line", { context: { locale: "en-US" }, stored: "ar" }, async (page) => {
    await fakeDocs(page, "2000-01-01T00:00:00Z");
    await page.goto(`${SITE}ar/?preview#docs/readme`, { waitUntil: "load" });
    await docsOpen(page);
    const banner = page.locator("#docspad .docs-stale");
    await banner.first().waitFor({ state: "visible", timeout: 8000 });
    const inner = await banner.first().evaluate((p) => ({ bdi: [...p.querySelectorAll("bdi")].map((b) => b.textContent.trim()), dir: getComputedStyle(p).direction }));
    check("K3a .docs-stale is rtl and wraps its inserted date in <bdi>", inner.dir === "rtl" && inner.bdi.some((t) => t.length > 0), JSON.stringify(inner));
    const src = await page.evaluate(() => { const s = document.querySelector("#docspad .readhead .source"); return s ? s.innerHTML : ""; });
    check("K3b the reader's .source line wraps its inserted value (repo, path) in <bdi>", /<bdi\b/.test(src), src.slice(0, 160));
    const href = new URL(await banner.first().locator("a[hreflang='en']").first().evaluate((a) => a.href));
    check("K3c the stale line's English link points at the root with #docs/readme", href.pathname === new URL(SITE).pathname && href.hash === "#docs/readme", href.href);
    await banner.first().locator("a[hreflang='en']").first().click();
    await page.waitForURL((u) => u.pathname === new URL(SITE).pathname);
    await page.waitForLoadState("load");
    check("K3d and opens the English page (<html lang> en)", (await page.evaluate(() => document.documentElement.lang)).startsWith("en"), page.url());
  });

  /* the home screen: drawers, dial, transport. Each is measured on ar/ and on the root as the control */
  for (const path of ["ar/", ""]) {
    const who = path || "root";
    await run(`K4 ${who} home`, { context: { locale: "en-US", viewport: { width: 1280, height: 800 } }, stored: path ? "ar" : "en" }, async (page) => {
      await enterHome(page, path);
      await page.evaluate(() => document.fonts.ready).catch(() => {});
      const rtl = path === "ar/";
      const W = 1280;
      /* a drawer, opened by the control the visitor would use, measured with its .close */
      const drawer = async (id, open) => {
        await open();
        await page.waitForFunction((i) => { const d = document.getElementById(i); const r = d.getBoundingClientRect(); return d.classList.contains("open") && r.width > 0 && r.right > 0 && r.left < innerWidth; }, id, { timeout: 8000 });
        await page.waitForTimeout(400);
        return page.evaluate((i) => { const d = document.getElementById(i), r = d.getBoundingClientRect(); const c = d.querySelector(".close, .handle"), cr = c && c.getBoundingClientRect(); return { mid: (r.left + r.right) / 2, closeMid: cr ? (cr.left + cr.right) / 2 : null, handleMid: (() => { const h = d.querySelector(".handle"), hr = h && h.getBoundingClientRect(); return hr ? (hr.left + hr.right) / 2 : null; })() }; }, id);
      };
      const shut = () => page.keyboard.press("Escape").then(() => page.waitForTimeout(300));
      const install = await drawer("installdrawer", async () => { await page.locator("#account-orb").click({ force: true }); await page.locator('[data-open-drawer="installdrawer"]').click({ force: true }); });
      await shut();
      const inbox = await drawer("inboxdrawer", () => page.locator("#inbox-orb").click({ force: true }));
      await shut();
      const key = await drawer("keydrawer", () => page.evaluate(() => document.querySelector("#keydrawer .handle").click()));
      /* the install drawer is the start drawer (right on ar/, left on the root); inbox and key are the end drawers */
      check(`K4a ${who}: the install drawer opens from the ${rtl ? "right" : "left"}`, rtl ? install.mid > W / 2 : install.mid < W / 2, JSON.stringify(install));
      check(`K4b ${who}: the inbox and key drawers open from the ${rtl ? "left" : "right"}`, rtl ? inbox.mid < W / 2 && key.mid < W / 2 : inbox.mid > W / 2 && key.mid > W / 2, JSON.stringify({ inbox, key }));
      /* each .close on the inner edge: the side of the drawer that faces the middle of the screen */
      const inner = (d, onRight) => d.closeMid !== null && (onRight ? d.closeMid < d.mid : d.closeMid > d.mid);
      check(`K4c ${who}: each .close sits on its drawer's inner edge`, inner(install, rtl) && inner(inbox, !rtl), JSON.stringify({ install, inbox }));
      check(`K4d ${who}: the key .handle goes with its drawer, on the inner edge`, key.handleMid !== null && (rtl ? key.handleMid > key.mid : key.handleMid < key.mid), JSON.stringify(key));
      await shut();
      /* the dial: today at 12 o'clock, the next month clockwise of it, the same on both */
      const dial = await page.evaluate(() => { const m = [...document.querySelectorAll("#dial .months text")].map((t) => { const r = t.getBoundingClientRect(); return [(r.left + r.right) / 2, (r.top + r.bottom) / 2]; }); const c = document.querySelector("#dial").getBoundingClientRect(); return { m, cx: (c.left + c.right) / 2 }; });
      const now = dial.m[0], nextMonth = dial.m[1];
      check(`K4e ${who}: the dial's today month is at 12 o'clock (topmost, centred) and the next lies clockwise of it (to its right, lower)`, dial.m.length === 12 && Math.abs(now[0] - dial.cx) < 6 && dial.m.every((p) => p[1] >= now[1] - 1) && nextMonth[0] > now[0] && nextMonth[1] > now[1], JSON.stringify({ now, nextMonth, cx: dial.cx }));
      /* the transport's played segment grows from the left on both: a physical bar, as time runs left to right */
      const bar = await page.evaluate(() => { const rail = document.querySelector("#transport .rail").getBoundingClientRect(), p = document.querySelector("#transport .played"); p.style.setProperty("--p", "50%"); p.style.transition = "none"; const r = p.getBoundingClientRect(); return { railL: rail.left, railR: rail.right, l: r.left, r: r.right }; });
      check(`K4f ${who}: the transport's played segment starts at the rail's left edge and grows right`, Math.abs(bar.l - bar.railL) <= 1 && bar.r > bar.l + 10 && bar.r < bar.railR - 1, JSON.stringify(bar));
    });
  }

  for (const path of ["ar/", ""]) {
    const who = path || "root";
    await run(`K5 ${who} letter-spacing`, { context: { locale: "en-US", viewport: { width: 1280, height: 800 } }, stored: path ? "ar" : "en" }, async (page) => {
      await page.goto(`${SITE}${path}?preview#docs`, { waitUntil: "load" });
      await docsOpen(page);
      await page.waitForSelector("#docspad .results h4", { timeout: 20000 });
      const m = await page.evaluate(() => {
        const get = (q) => { const e = [...document.querySelectorAll(q)].find((x) => x.offsetParent); if (!e) return null; const cs = getComputedStyle(e); return { ls: cs.letterSpacing, fs: parseFloat(cs.fontSize) }; };
        return { corner: get("#docspad .corner"), langs: get(".langs button"), h4: get("#docspad.docs .results h4, .pad.docs .results h4") };
      });
      const zero = (o) => o && (o.ls === "0px" || o.ls === "normal");
      const spaced = (o) => o && o.ls !== "normal" && parseFloat(o.ls) > 0;
      if (path) check("K5a ar/: letter-spacing is 0 on .corner, .langs button and .pad.docs .results h4, and each is at least 12px", zero(m.corner) && zero(m.langs) && zero(m.h4) && [m.corner, m.langs, m.h4].every((o) => o && o.fs >= 12), JSON.stringify(m));
      else check("K5b root: the same three are letter-spaced (non-zero)", spaced(m.corner) && spaced(m.langs) && spaced(m.h4), JSON.stringify(m));
    });
  }
} catch (e) {
  check("harness", false, String(e && e.stack || e));
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
process.exit(failed ? 1 : 0);
