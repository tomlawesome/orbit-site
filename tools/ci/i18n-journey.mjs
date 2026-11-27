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
 *   M1-M2 (#176) the inbox drawer and the account drawer's THEME label come from the catalogue: on de/ each shows the words of
 *       the catalogue's key for it (found by its English words), whatever de.json says; the root shows the English
 *   M3-M7 (#176 remainder) on the home page of en, de and ja: the inbox button's aria-label is the catalogue's "Inbox — {n} waiting" and
 *       follows the number when a receipt is dismissed; the suggestion row's line is the catalogue's "Found in 1 forwarded document
 *       · renews {date} · {cost}" with a date and a cost; the receipt's "renews" and "burns up" values are Intl.RelativeTimeFormat's
 *       (long for 51 days, narrow for 43) in the page's language; cost, provider and the title are the same on en and de
 *   N1-N4 (#177) the demo's page words follow the page's language: N1 the English page reads exactly as before (exact strings,
 *       all twelve months); N2 every page word comes from the catalogue (en.js served marked) and kept data does not; N3 a
 *       translation cannot break the page (en.js served as markup and quotes, shown as text); N4 de, ja and ar write dates,
 *       relative times, month counts and money in the page's language, leave no English phrase or Latin letter but kept data
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
      const edge = (e) => { const cs = getComputedStyle(e), rg = document.createRange(); rg.selectNodeContents(e); const rects = [...rg.getClientRects()].filter((q) => q.width > 0), first = rects[0], box = e.getBoundingClientRect();
        /* the first line's inline-end edge: on a mixed Arabic/Latin line the first rect need not be the line's end, so take the furthest right of every fragment on that line */
        const line = first ? Math.max(...rects.filter((q) => Math.abs(q.top - first.top) < first.height / 2).map((q) => q.right)) : null; return { dir: cs.direction, line, box: box.right - parseFloat(cs.paddingRight) }; };
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
  /* ---- #176: the inbox drawer's and the account drawer's words are the catalogue's ---- */
  const EN176 = JSON.parse(readFileSync(join(ROOT, "assets/i18n/en.json"), "utf8"));
  const cat176 = (lang) => { try { return JSON.parse(readFileSync(join(ROOT, `assets/i18n/${lang}.json`), "utf8")); } catch { return {}; } };
  /* what a language's page may say for English words: the words of any key whose English is those words (a key the language lacks is pending: its English) */
  const said176 = (lang, words) => { const c = cat176(lang); return Object.keys(EN176).filter((k) => EN176[k].trim().toLowerCase() === words.trim().toLowerCase()).map((k) => (Object.hasOwn(c, k) ? c[k] : EN176[k])); };
  const drawers176 = async (page, path) => {
    await enterHome(page, path);
    await page.locator("#account-orb").click({ force: true });
    await page.waitForFunction(() => document.querySelector("#account.open"), null, { timeout: 8000 });
    const theme = await page.evaluate(() => { const e = document.querySelector("#account .swatches > span"); return e ? e.textContent.trim() : null; });
    await page.keyboard.press("Escape");
    await page.evaluate(() => document.querySelector("#account").classList.remove("open"));
    await page.locator("#inbox-orb").click({ force: true });
    await page.waitForFunction(() => { const d = document.getElementById("inboxdrawer"); return d.classList.contains("open") && d.querySelectorAll(".lane").length >= 4; }, null, { timeout: 8000 });
    const inbox = await page.evaluate(() => {
      const t = (q) => [...document.querySelectorAll(q)].map((e) => e.textContent.trim());
      const aria = document.querySelector("#inboxdrawer .actions");
      return {
        lanes: Object.fromEntries(["filed", "review", "reading", "failed"].map((c) => [c, t(`#inboxdrawer .lane.${c} > h4`)[0] ?? null])),
        labels: t("#inboxdrawer .lane.review .receipt.suggest > .kv > span"),
        sure: t("#inboxdrawer .lane.review .receipt.suggest i.sure"),
        yes: t("#inboxdrawer .lane.review button.yes")[0] ?? null, no: t("#inboxdrawer .lane.review button.no")[0] ?? null,
        decide: aria ? aria.getAttribute("aria-label") : null,
      };
    });
    return { theme, inbox };
  };
  for (const path of ["de/", ""]) {
    const who = path || "root", lang = path ? "de" : "en";
    await run(`M1 ${who} drawers`, { context: { locale: "en-US", viewport: { width: 1280, height: 800 } }, stored: path ? "de" : "en" }, async (page) => {
      const { theme, inbox } = await drawers176(page, path);
      const says = (words) => (lang === "en" ? [words] : said176(lang, words));
      const is = (got, words) => { const ok = says(words).map((x) => x.trim().toLowerCase()); return got !== null && ok.length > 0 && ok.includes(got.toLowerCase()); };
      const miss = (rows) => rows.filter(([got, words]) => !is(got, words)).map(([got, words]) => `${JSON.stringify(got)} is not the catalogue's words for ${JSON.stringify(words)}${says(words).length ? ` (${JSON.stringify(says(words))})` : " (no key in en.json has those words)"}`);
      const L = inbox.lanes;
      const heads = miss([[L.filed, "Filed"], [L.review, "For your review"], [L.reading, "Still reading"], [L.failed, "Failed to process"]]);
      check(`M1a ${who}: the four lane headings are the catalogue's words`, !heads.length, heads.join("; ") || JSON.stringify(L));
      const rows = miss(["renews", "cost", "provider", "burns up"].map((w, i) => [inbox.labels[i] ?? null, w]));
      check(`M1b ${who}: the review row's labels (renews, cost, provider, burns up) are the catalogue's words`, !rows.length, rows.join("; ") || JSON.stringify(inbox.labels));
      const sure = miss(["sure", "unsure", "sure"].map((w, i) => [inbox.sure[i] ?? null, w]));
      check(`M1c ${who}: sure and unsure are the catalogue's words`, !sure.length, sure.join("; ") || JSON.stringify(inbox.sure));
      const btn = miss([[inbox.yes, "Add to orbit"], [inbox.no, "Dismiss"]]);
      check(`M1d ${who}: Add to orbit and Dismiss are the catalogue's words`, !btn.length, btn.join("; ") || JSON.stringify([inbox.yes, inbox.no]));
      const th = miss([[theme, "THEME"]]);
      check(`M2 ${who}: the account drawer's THEME label is the catalogue's words`, !th.length, th.join("; ") || JSON.stringify(theme));
    });
  }
  /* ---- #176 remainder: the inbox button's label, the suggestion row's line and the two relative times ---- */
  const INBOX176 = "Inbox \u2014 {n} waiting", FOUND176 = "Found in 1 forwarded document \u00b7 renews {date} \u00b7 {cost}";
  const says176 = (lang, words) => { const s = said176(lang, words); return s.length ? s : [words]; };
  const esc176 = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  /* a click inside a just-opened drawer waits for its 0.35s slide-in: its box is inside the viewport (never a fixed sleep; a busy host runs the slide late) */
  const slid176 = (page, id) => page.waitForFunction((i) => { const r = document.getElementById(i).getBoundingClientRect(); return r.width > 0 && r.left >= -0.5 && r.right <= innerWidth + 0.5; }, id, { timeout: 8000 });
  const orbLabel176 = (page) => page.locator("#inbox-orb").getAttribute("aria-label");
  const R176 = {};
  for (const lang of ["en", "de", "ja"]) {
    const path = lang === "en" ? "" : `${lang}/`;
    await run(`M3 ${lang} inbox and receipt`, { context: { locale: "en-US", viewport: { width: 1280, height: 800 } }, stored: lang }, async (page) => {
      await enterHome(page, path);
      await page.locator("#corridor .item.suggest .body span").first().waitFor({ state: "attached", timeout: 8000 });
      const line = await page.evaluate(() => document.querySelector("#corridor .item.suggest .body span").textContent.trim());
      await page.locator("#inbox-orb").click({ force: true });
      await page.waitForFunction(() => { const d = document.getElementById("inboxdrawer"); return d.classList.contains("open") && d.querySelectorAll(".lane").length >= 4; }, null, { timeout: 8000 });
      await slid176(page, "inboxdrawer");
      const got = await page.evaluate((line) => {
        const rec = document.querySelector("#inboxdrawer .lane.review .receipt.suggest");
        const lang = document.documentElement.lang;
        /* a value without the sure/unsure tag that follows it */
        const vals = rec ? [...rec.querySelectorAll(":scope > .kv > b")].map((b) => { const c = b.cloneNode(true); c.querySelectorAll("i").forEach((i) => i.remove()); return c.textContent.trim(); }) : [];
        return {
          lang, line, vals,
          n: document.querySelectorAll("#inboxdrawer .lane.review .receipt.suggest").length,
          title: rec ? rec.querySelector(":scope > b").textContent.trim() : null,
          label: document.getElementById("inbox-orb").getAttribute("aria-label"),
          renews: new Intl.RelativeTimeFormat(lang).format(51, "day"),
          burns: new Intl.RelativeTimeFormat(lang, { style: "narrow" }).format(43, "day"),
        };
      }, line);
      R176[lang] = got;
      /* M3: the inbox button's spoken label, the catalogue's words filled with the number of receipts in the review lane */
      const wantLabel = says176(lang, INBOX176).map((t) => t.replace("{n}", String(got.n)));
      check(`M3a ${lang}: the inbox button's aria-label is the catalogue's "Inbox \u2014 {n} waiting" with n = the receipts in the review lane (${got.n})`, got.n >= 1 && wantLabel.includes(got.label), `${JSON.stringify(got.label)}, want one of ${JSON.stringify(wantLabel)}`);
      /* M4: the suggestion row's line matches the catalogue's template, with a date and a cost filled and nothing left in braces */
      const tpls = says176(lang, FOUND176);
      const hit = tpls.map((t) => new RegExp(`^${esc176(t).replace("\\{date\\}", "(.+?)").replace("\\{cost\\}", "(.+)")}$`).exec(got.line)).find(Boolean);
      check(`M4 ${lang}: the suggestion row's line is the catalogue's "Found in 1 forwarded document \u00b7 renews {date} \u00b7 {cost}" with a date and a cost`, !!hit && !!hit[1].trim() && !!hit[2].trim() && !got.line.includes("{"), `${JSON.stringify(got.line)}, template ${JSON.stringify(tpls)}`);
      /* M5: the two relative times are the browser's, in the page's language */
      check(`M5a ${lang}: the "renews" value is Intl.RelativeTimeFormat("${got.lang}").format(51, "day")`, got.vals[0] === got.renews, `${JSON.stringify(got.vals[0])}, want ${JSON.stringify(got.renews)}`);
      check(`M5b ${lang}: the "burns up" value is the narrow style's for 43 days`, got.vals[3] === got.burns, `${JSON.stringify(got.vals[3])}, want ${JSON.stringify(got.burns)}`);
      if (lang === "ja") check("M5c ja: neither relative time has a Latin letter", got.vals[0] !== undefined && got.vals[3] !== undefined && !/[A-Za-z]/.test(got.vals[0] + got.vals[3]), JSON.stringify([got.vals[0], got.vals[3]]));
      /* M6: the label follows the number: dismiss the receipt (the first tap arms, the second fires) */
      if (lang === "en") {
        const no = page.locator("#inboxdrawer .lane.review .receipt.suggest button.no").first();
        await slid176(page, "inboxdrawer");
        await no.click({ force: true });
        await no.click({ force: true });
        await page.waitForFunction((n) => document.querySelectorAll("#inboxdrawer .lane.review .receipt.suggest").length === n, got.n - 1, { timeout: 8000 });
        const wantAfter = says176(lang, INBOX176).map((t) => t.replace("{n}", String(got.n - 1)));
        await page.waitForFunction((w) => w.includes(document.getElementById("inbox-orb").getAttribute("aria-label")), wantAfter, { timeout: 5000 }).catch(() => {});
        const after = await orbLabel176(page);
        check(`M6 en: after one receipt is dismissed the aria-label shows ${got.n - 1}`, wantAfter.includes(after), `${JSON.stringify(after)}, want one of ${JSON.stringify(wantAfter)}`);
      }
    });
  }
  /* M7: the neighbours that must not change, and the German relative time is not the English */
  {
    const a = R176.en, b = R176.de;
    if (!a || !b) check("M7 en and de", false, "a page did not load, see above");
    else {
      check("M7a de: the \"renews\" value reads differently from the English one", !!b.vals[0] && b.vals[0] !== a.vals[0], `de ${JSON.stringify(b.vals[0])}, en ${JSON.stringify(a.vals[0])}`);
      check("M7b the cost and provider readings and the receipt's title are the same on en and de", !!a.vals[1] && !!a.vals[2] && !!a.title && a.vals[1] === b.vals[1] && a.vals[2] === b.vals[2] && a.title === b.title, JSON.stringify({ en: [a.vals[1], a.vals[2], a.title], de: [b.vals[1], b.vals[2], b.title] }));
    }
  }
  /* ---- N (#177): the demo's page words follow the page's language ----
     The home page's demo (dial, list, item drawer, search box, inbox) is read from the DOM after the page has drawn it, with
     class and id selectors only. The sample's dates are the real day's, so every English string expected below is written out
     from explicit English tables, never from Intl.
       N1  the English page reads exactly as it did before #177 (the guard: it passes before and after)
       N2  the words come from the catalogue: assets/i18n/en.js is served marked, each value wrapped in U+27E6 ... U+27E7, so a
           word the code writes itself shows no mark; page words carry one and kept data (titles, providers, file names, T-16d) none
       N3  a translation cannot break the page (point 8): every value in en.js is served as <b>x</b> "q" &amp; and the page shows
           those characters as text, in labels, buttons, notes and spoken labels (aria-label), the inbox's #176 keys included
       N4  de, ja and ar (marked, so a sentence still English before the translation run shows its marks): dates, months, the
           weekday, relative times, month counts and money are the browser's in the page's language, no Latin letter is left
           on ja and ar but kept data, no English page phrase stands unmarked, and the kept data is as written */
  const EN_JS177 = readFileSync(join(ROOT, "assets/i18n/en.js"), "utf8");
  const CAT177 = JSON.parse(EN_JS177.slice(EN_JS177.indexOf("export default ") + "export default ".length).replace(/;\s*$/, ""));
  const OPEN177 = "⟦", CLOSE177 = "⟧";
  const JUNK177 = "<b>x</b> \"q\" &amp;";
  const marked177 = (v) => `${OPEN177}${v}${CLOSE177}`;
  const junked177 = (v) => [JUNK177, ...(String(v).match(/\{\w+\}/g) || [])].join(" ");
  const serve177 = (page, wrap) => page.route("**/assets/i18n/en.js", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: `export default ${JSON.stringify(Object.fromEntries(Object.entries(CAT177).map(([k, v]) => [k, wrap(v)])))};` }));
  /* a text without the marked stretches (they nest: a sentence holding a phrase) */
  const strip177 = (s) => { let d = 0, o = ""; for (const c of String(s)) { if (c === OPEN177) d++; else if (c === CLOSE177) d = Math.max(0, d - 1); else if (!d) o += c; } return o; };
  const isMarked177 = (s) => typeof s === "string" && s.includes(OPEN177) && s.includes(CLOSE177);

  /* what the page is read with (functions run in the page: no outside names) */
  const dialOf177 = () => {
    const q = (s) => [...document.querySelectorAll(s)], aria = (e) => e.getAttribute("aria-label");
    return { name: document.querySelector("#dial-name").textContent, sun: aria(document.querySelector("#dial .sun-link")), months: q("#dial .months text").map((t) => t.textContent),
      bodies: q("#dial .body-link").map((a) => [a.dataset.id, aria(a)]), hits: q("#galaxy .hit").map(aria), chips: q("#chips button").map((b) => b.textContent) };
  };
  const listOf177 = () => {
    const t = (e) => (e ? e.textContent : null), kids = (e) => (e ? e.children.length : 0);
    const groups = []; let cur = null;
    for (const e of document.querySelectorAll("#corridor > *")) {
      if (e.classList.contains("month")) { cur = { label: t(e.querySelector("span")), small: t(e.querySelector("small")), smallKids: kids(e.querySelector("small")), rows: 0 }; groups.push(cur); } else if (cur && e.classList.contains("item")) cur.rows++;
    }
    const today = document.querySelectorAll("#today > span")[1], horizon = document.querySelector("#horizon");
    const rows = [...document.querySelectorAll("#corridor .item:not(.suggest)")].map((r) => ({ id: r.dataset.id, title: t(r.querySelector(".body b")), body: t(r.querySelector(".body span")), bodyKids: kids(r.querySelector(".body span")), t: r.querySelector(".t").firstChild.textContent, date: t(r.querySelector(".t small")) }));
    const sugg = [...document.querySelectorAll("#corridor .item.suggest")].map((r) => ({ title: t(r.querySelector(".body b")), line: t(r.querySelector(".body span")), lineKids: kids(r.querySelector(".body span")), yes: t(r.querySelector("button.yes")), no: t(r.querySelector("button.no")) }));
    return { today: t(today), todayKids: kids(today), groups, rows, sugg, horizon: t(horizon), horizonKids: kids(horizon) };
  };
  const calloutOf177 = (id) => {
    const link = document.querySelector(`#dial .body-link[data-id="${id}"]`);
    link.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
    const c = document.querySelector("#body-callout"), s = c.querySelector("small");
    const out = { title: c.querySelector("b").textContent, line: s.textContent, kids: s.children.length };
    link.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
    return out;
  };
  const drawerOf177 = ({ id, act }) => {
    const row = document.querySelector(`.item[data-id="${id}"]`);
    if (!row) return null;
    if (act) { const b = document.getElementById(`${id}-view`)?.querySelector(`[data-act="${act}"]`); if (!b) return null; b.click(); } else { if (row.classList.contains("open")) row.click(); row.click(); }
    const v = document.getElementById(`${id}-view`);
    if (!v) return null;
    const kids = (e) => (e ? e.children.length : 0);
    return {
      kv: [...v.querySelectorAll(".kv")].map((k) => [k.querySelector("span").textContent, k.querySelector("b").textContent, kids(k.querySelector("span")), kids(k.querySelector("b"))]),
      h4: [...v.querySelectorAll("h4")].map((h) => [h.textContent, kids(h)]),
      docs: [...v.querySelectorAll(".doc")].map((d) => ({ name: d.querySelector("span").firstChild.textContent, meta: d.querySelector("small").textContent, kids: kids(d.querySelector("small")) })),
      acts: v.querySelector(".acts").getAttribute("aria-label"),
      btns: [...v.querySelectorAll(".acts button")].map((b) => [b.textContent, b.disabled, kids(b)]),
      note: v.querySelector(".ivnote").textContent, noteKids: kids(v.querySelector(".ivnote")),
    };
  };
  const inboxOf177 = () => {
    const kids = (e) => (e ? e.children.length : 0);
    return {
      orb: document.querySelector("#inbox-orb").getAttribute("aria-label"),
      lanes: [...document.querySelectorAll("#inboxdrawer .lane")].map((l) => ({
        cls: l.className.replace("lane ", ""), h4: l.querySelector("h4").textContent, h4Kids: kids(l.querySelector("h4")),
        receipts: [...l.querySelectorAll(".receipt")].map((r) => {
          const small = r.querySelector(":scope > small"), title = r.querySelector(":scope > b");
          return {
            title: title ? title.textContent : null, titleKids: kids(title), small: small ? small.textContent : null, smallKids: kids(small),
            kv: [...r.querySelectorAll(":scope > .kv")].map((k) => { const b = k.querySelector("b"), c = b.cloneNode(true); c.querySelectorAll("i").forEach((i) => i.remove()); return [k.querySelector("span").textContent, c.textContent, kids(k.querySelector("span")), [...b.querySelectorAll("i")].map((i) => [i.textContent, kids(i)])]; }),
            btns: [...r.querySelectorAll("button")].map((b) => [b.textContent, kids(b)]), decide: r.querySelector(".actions") ? r.querySelector(".actions").getAttribute("aria-label") : null,
          };
        }),
      })),
    };
  };
  const searchOf177 = (q) => {
    const input = document.querySelector("#explore");
    input.value = q; input.dispatchEvent(new Event("focus")); input.dispatchEvent(new Event("input"));
    return [...document.querySelectorAll("#palette > *")].map((e) => ({ cls: e.className, text: e.textContent, kids: e.children.length }));
  };
  const pressOf177 = () => { const b = document.querySelector("#inboxdrawer .lane.review .receipt.suggest button.yes"); b.click(); return { text: b.textContent, kids: b.children.length }; };
  const idOf177 = (title) => { const r = [...document.querySelectorAll("#corridor .item:not(.suggest)")].find((x) => x.querySelector(".body b").textContent === title); return r ? r.dataset.id : null; };
  const addOf177 = async ({ name, date, cost, recur }) => {
    const set = (sel, v) => { document.querySelector(sel).value = v; };
    set("#f-name", name); set("#f-section", "home"); set("#f-date", date); set("#f-cost", cost); set("#f-recur", String(recur));
    document.querySelector("#createform").requestSubmit();
    await new Promise((r) => setTimeout(r, 5)); /* an item's id is the clock in milliseconds: never two in one */
    return document.querySelector("#horizon").textContent;
  };

  /* the demo's data, as written in assets/js/data.js (the dates are lead times from the day the page opens) */
  const SAMPLE177 = [
    { id: "i-gutter", title: "Gutter clearing", section: "Home", days: -16, cost: 150, rec: 12, kind: "service", prov: null, rem: [14, 3], docs: [] },
    { id: "i-mot", title: "Car MOT — Volvo V60", section: "Vehicles", days: 16, cost: 54.85, est: false, rec: 12, kind: "inspection", prov: null, rem: [21, 7], docs: [["MOT certificate 2025", "added 12 Jun · 240 KB"], ["Service history", "added 12 Jun · 88 KB"]] },
    { id: "i-boiler", title: "Boiler service", section: "Home", days: 22, cost: 120, rec: 12, kind: "service", prov: "Warm & Co.", rem: [14], docs: [] },
    { id: "i-chimney", title: "Chimney sweep", section: "Home", days: 61, cost: 90, rec: 12, kind: "service", prov: null, rem: [14], docs: [] },
    { id: "i-smoke", title: "Smoke alarm batteries", section: "Devices", days: 122, cost: 12, rec: 6, kind: "service", prov: null, rem: [7], docs: [] },
    { id: "i-svc", title: "Car full service", section: "Vehicles", days: 161, cost: 300, rec: 12, kind: "service", prov: null, rem: [21], docs: [["service-invoice-2026.pdf", "added 12 Jun · 240 KB"], ["service-checklist.pdf", "added 12 Jun · 88 KB"]] },
  ];
  const KEPT177 = ["Warm & Co.", "Harbour Mutual", "KB", "free mot-reminder.pdf", "policy-schedule.pdf", "MOT certificate 2025", "Service history", "service-invoice-2026.pdf", "service-checklist.pdf", "Car MOT — Volvo V60",
    "Home insurance renewal", "Gutter clearing", "Boiler service", "Chimney sweep", "Smoke alarm batteries", "Car full service", "Willow House", "Seaside cottage", "The narrowboat", "Gran's flat", "Mum & Dad's", "Probe "];
  /* explicit English tables: what the page wrote before #177 (the browser's en-GB says "Sept" for September; the page says "Sep") */
  const MON177 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const LONG177 = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const WD177 = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const pad177 = (n) => String(n).padStart(2, "0");
  const at177 = (now, days) => new Date(now.y, now.m, now.d + days);
  const daysTo177 = (now, dt) => Math.round((Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()) - Date.UTC(now.y, now.m, now.d)) / 864e5);
  const tmin177 = (n) => (n < 0 ? `T+${-n}d` : `T−${n}d`);
  const short177 = (dt) => `${pad177(dt.getDate())} ${MON177[dt.getMonth()]}`;
  const long177 = (dt) => `${dt.getDate()} ${LONG177[dt.getMonth()]} ${dt.getFullYear()}`;
  const per177 = (m) => (!m ? "one-off" : m === 12 ? "every year" : m % 12 === 0 ? `every ${m / 12} years` : m === 1 ? "every month" : `every ${m} months`);
  const money177 = (pounds, est = true) => { if (pounds === null) return "—"; const [i, f] = pounds.toFixed(2).split("."); return `${est ? "~" : ""}£${i.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${f}`; };
  /* the groups the list shows from a set of lead times (the month's header and its count), as renderManifest draws them */
  const groups177 = (now, days) => {
    const out = []; let last = `${now.y}-${now.m}`;
    for (const n of [...days].sort((a, b) => a - b)) { const d = at177(now, n), k = `${d.getFullYear()}-${d.getMonth()}`; if (k !== last) { last = k; out.push({ label: MON177[d.getMonth()].toUpperCase(), n: 0 }); } if (out.length) out[out.length - 1].n++; }
    return out.map((g) => ({ label: g.label, small: `${g.n} approaching` }));
  };
  /* the twelve months of the probes: the 28th of each month from this month next year (after every sample date, the completed item's next one included), a different period and cost each */
  const PROBES177 = Array.from({ length: 12 }, (_, i) => ({ i, name: `Probe ${pad177(i + 1)}`, recur: [12, 6, 24, 0][i % 4], cost: ["1234567.5", "", "99.5", "12"][i % 4], pounds: [1234567.5, null, 99.5, 12][i % 4] }));
  const PDAY177 = 28;
  const probeDate177 = (now, i) => new Date(now.y + 1, now.m + i, PDAY177);
  const ymd177 = (dt) => `${dt.getFullYear()}-${pad177(dt.getMonth() + 1)}-${pad177(dt.getDate())}`;

  /* one visit to the home page: everything the demo writes, read once, then the buttons pressed and the twelve probes added */
  const snap177 = async (page) => {
    const S = {};
    S.now = await page.evaluate(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate(), wd: d.getDay(), lang: document.documentElement.lang }; });
    S.dial = await page.evaluate(dialOf177);
    S.list0 = await page.evaluate(listOf177);
    S.inbox0 = await page.evaluate(inboxOf177);
    S.callouts = {}; for (const id of ["i-mot", "i-boiler", "r-insurance"]) S.callouts[id] = await page.evaluate(calloutOf177, id);
    S.search = { none: await page.evaluate(searchOf177, "zzzzqq"), boiler: await page.evaluate(searchOf177, "boiler") };
    S.drawers = {}; for (const s of SAMPLE177) S.drawers[s.id] = await page.evaluate(drawerOf177, { id: s.id });
    S.completed = (await page.evaluate(drawerOf177, { id: "i-gutter" })) && (await page.evaluate(drawerOf177, { id: "i-gutter", act: "complete" }));
    S.snoozed = (await page.evaluate(drawerOf177, { id: "i-svc" })) && (await page.evaluate(drawerOf177, { id: "i-svc", act: "snooze" }));
    S.armed = await page.evaluate(pressOf177);
    await page.evaluate(pressOf177);
    const acceptedId = await page.evaluate(idOf177, "Home insurance renewal");
    S.accepted = acceptedId && (await page.evaluate(drawerOf177, { id: acceptedId }));
    S.inbox1 = await page.evaluate(inboxOf177);
    S.probes = [];
    for (const p of PROBES177) { const dt = probeDate177(S.now, p.i); S.probes.push({ ...p, y: dt.getFullYear(), m: dt.getMonth(), d: PDAY177, horizon: await page.evaluate(addOf177, { name: p.name, date: ymd177(dt), cost: p.cost, recur: p.recur }) }); }
    /* each add opens its row 450 ms later; the last one open means every timer has run */
    await page.waitForFunction(() => document.querySelector(".item.open .body b")?.textContent === "Probe 12", null, { timeout: 10000 });
    S.list1 = await page.evaluate(listOf177);
    for (const p of S.probes) p.drawer = await page.evaluate(drawerOf177, { id: S.list1.rows.find((r) => r.title === p.name)?.id });
    return S;
  };
  const open177 = async (page, lang, wrap) => {
    if (wrap) await serve177(page, wrap);
    await enterHome(page, lang === "en" ? "" : `${lang}/`);
    await page.locator("#corridor .item").first().waitFor({ state: "attached", timeout: 15000 });
  };
  const N_CTX = { locale: "en-US", viewport: { width: 1280, height: 800 }, serviceWorkers: "block" };
  const cmp177 = (bad, label, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${label}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
  const verdict177 = (name, bad, ok) => check(name, !bad.length, bad.length ? bad.slice(0, 3).join("; ") + (bad.length > 3 ? ` (+${bad.length - 3} more)` : "") : ok);

  /* N1: the English page, unchanged */
  await run("N1 en unchanged", { context: N_CTX, stored: "en" }, async (page) => {
    await open177(page, "en");
    const S = await snap177(page), now = S.now;
    let bad = [];
    cmp177(bad, "the TODAY line", S.list0.today, `TODAY · ${WD177[now.wd]} ${pad177(now.d)} ${MON177[now.m].toUpperCase()}`);
    cmp177(bad, "the dial's twelve month labels, from this month", S.dial.months, Array.from({ length: 12 }, (_, i) => MON177[(now.m + i) % 12].toUpperCase()));
    verdict177("N1a en: the TODAY line and the dial's month labels (all twelve months, \"Sep\" not \"Sept\") read as before", bad, S.list0.today);

    const days0 = [...SAMPLE177.filter((s) => s.days >= 0).map((s) => s.days), 51];
    bad = [];
    cmp177(bad, "the month headers and their counts", S.list0.groups.map((g) => ({ label: g.label, small: g.small })), groups177(now, days0));
    cmp177(bad, "the horizon line", S.list0.horizon, `— beyond the horizon: nothing scheduled past ${LONG177[at177(now, 161).getMonth()]} —`);
    verdict177("N1b en: the month headers, \"N approaching\" and the horizon line read as before", bad, `${S.list0.groups.length} headers; ${S.list0.horizon}`);

    bad = [];
    for (const s of SAMPLE177) {
      const r = S.list0.rows.find((x) => x.id === s.id) || {}, dt = at177(now, s.days);
      cmp177(bad, `${s.id} line`, r.body, `${s.section} · orbital period ${per177(s.rec).replace("every ", "")}${s.prov ? ` · ${s.prov}` : ""} · ${money177(s.cost, s.est !== false)}`);
      cmp177(bad, `${s.id} countdown and date`, [r.t, r.date], [tmin177(s.days), short177(dt)]);
    }
    verdict177("N1c en: each row's line (section, orbital period, provider, money), countdown and short date read as before", bad, `${SAMPLE177.length} rows`);

    bad = [];
    cmp177(bad, "the dial's spoken labels", [S.dial.sun, S.dial.hits], ["Willow House, this household", ["Fly to Seaside cottage", "Fly to The narrowboat", "Fly to Gran's flat", "Fly to Mum & Dad's"]]);
    cmp177(bad, "a body's spoken label", Object.fromEntries(S.dial.bodies), { "i-gutter": "Gutter clearing, T+16d", "i-mot": `Car MOT — Volvo V60, T−16d`, "i-boiler": "Boiler service, T−22d", "i-chimney": "Chimney sweep, T−61d", "i-smoke": "Smoke alarm batteries, T−122d", "i-svc": "Car full service, T−161d", "r-insurance": "Home insurance renewal, T−51d" });
    cmp177(bad, "the callouts of a plain and a document item", [S.callouts["i-mot"].line, S.callouts["i-boiler"].line], ["T−16d · £54.85 · 2 documents", "T−22d · ~£120.00"]);
    /* #176 made the 'burns up' value "in 43 days"; the dial callout's "renews in 51d" is the one string whose English the issue's
       point 3 (Intl.RelativeTimeFormat) and its "reads as today" line say differently, so both readings pass */
    check("N1d en: the dial's spoken labels and callouts read as before (the suggestion's relative time as 'in 51d' or 'in 51 days')", !bad.length && /^suggested · renews in 51(d| days) · ~£400\.00$/.test(S.callouts["r-insurance"].line), bad.length ? bad.join("; ") : S.callouts["r-insurance"].line);

    bad = [];
    for (const s of SAMPLE177) {
      const d = S.drawers[s.id], dt = at177(now, s.days);
      const want = [["due", `${tmin177(s.days)} · ${long177(dt)}`], ["section", s.section], ["type", s.kind], ["orbital period", per177(s.rec)], ["cost", money177(s.cost, s.est !== false)]];
      if (s.prov) want.push(["provider", s.prov]);
      want.push(["reminders", s.rem.map((x) => `${x}d before`).join(" · ")]);
      cmp177(bad, `${s.id} rows`, d && d.kv.map(([a, b]) => [a, b]), want);
      cmp177(bad, `${s.id} documents`, d && [d.h4.map((h) => h[0]), d.docs.map((x) => [x.name, x.meta])], [s.docs.length ? ["documents"] : [], s.docs]);
      cmp177(bad, `${s.id} actions, buttons and note`, d && [d.acts, d.btns.map((b) => [b[0], b[1]]), d.note], ["Item actions", [["complete", false], ["snooze a week", false]], "a repeat is never finished; it comes round"]);
    }
    verdict177("N1e en: every item drawer's labels, values, documents heading and meta, spoken label, buttons and note read as before", bad, `${SAMPLE177.length} drawers`);

    bad = [];
    const nd = new Date(now.y, now.m, now.d - 16); nd.setMonth(nd.getMonth() + 12); /* the overdue gutter item, completed: its next date is a year on */
    cmp177(bad, "after complete", S.completed && [S.completed.kv.map((k) => [k[0], k[1]]).slice(0, 2), S.completed.btns.map((b) => [b[0], b[1]])], [[["due", `${tmin177(daysTo177(now, nd))} · ${long177(nd)}`], ["last completed", "today"]], [["completed today", true], ["snooze a week", false]]]);
    cmp177(bad, "after snooze", S.snoozed && [S.snoozed.kv.slice(0, 2).map((k) => [k[0], k[1]]), S.snoozed.btns.map((b) => [b[0], b[1]])], [[["due", `${tmin177(161)} · ${long177(at177(now, 161))}`], ["snoozed", "a week, from the last reminder"]], [["complete", false], ["snoozed a week", true]]]);
    verdict177("N1f en: the buttons after pressing \"complete\" and \"snooze a week\" and the text they leave read as before", bad, "completed today / snoozed a week");

    bad = [];
    const lane = (S0, c) => S0.lanes.find((l) => l.cls === c);
    cmp177(bad, "filed", lane(S.inbox0, "filed").receipts.map((r) => [r.title, r.small]), [["Car MOT — Volvo V60", "12 Jun · free mot-reminder.pdf · filed against the item"]]);
    cmp177(bad, "review source", lane(S.inbox0, "review").receipts.map((r) => [r.title, r.small]), [["Home insurance renewal", "policy-schedule.pdf · 312 KB · scanned clean"]]);
    cmp177(bad, "reading", lane(S.inbox0, "reading").receipts.map((r) => [r.title, r.small]), [["A message arrived 4 minutes ago", "Orbit is reading its document — it will appear for review when it's done"]]);
    cmp177(bad, "failed", lane(S.inbox0, "failed").receipts.map((r) => [r.title, r.small]), [["A message from 09 Aug", "too large · Its attachment was larger than Orbit can store. You can add the item yourself and attach the file from Documents."], ["A message from 06 Aug", "no readable document · It carried no document Orbit can read (PDFs work best). Nothing was kept."]]);
    cmp177(bad, "review values", lane(S.inbox0, "review").receipts[0].kv.map((k) => k[1]), ["in 51 days", "~£400.00", "Harbour Mutual", "in 43 days"]);
    verdict177("N1g en: the inbox's sample sentences (filed note, source line, \"arrived 4 minutes ago\", \"from 09 Aug\", the failed notes) read as before", bad, "four lanes");

    bad = [];
    cmp177(bad, "the suggestion row", S.list0.sugg.map((x) => [x.title, x.line, x.yes, x.no]), [["Home insurance renewal", `Found in 1 forwarded document · renews ${short177(at177(now, 51))} · ~£400.00`, "Add to orbit", "Dismiss"]]);
    cmp177(bad, "armed", S.armed.text, "tap again to add");
    cmp177(bad, "accepted item", S.accepted && [S.accepted.kv.map((k) => [k[0], k[1]]), S.accepted.docs.map((x) => [x.name, x.meta])], [[["due", `${tmin177(51)} · ${long177(at177(now, 51))}`], ["section", "Home"], ["type", "renewal"], ["orbital period", "every year"], ["cost", "~£400.00"], ["provider", "Harbour Mutual"], ["reminders", "14d before"]], [["policy-schedule.pdf", "attached on acceptance"]]]);
    cmp177(bad, "the review lane once it is empty", [lane(S.inbox1, "review").receipts.map((r) => r.small), S.inbox1.orb], [["nothing here"], "Inbox — 0 waiting"]);
    verdict177("N1h en: the suggestion row, \"tap again to add\", the accepted item's document (\"attached on acceptance\") and the emptied lane read as before", bad, "suggest, arm, accept");

    bad = [];
    cmp177(bad, "an empty search", S.search.none.map((e) => e.text), ["nothing in this orbit matches", "→ add an item"]);
    cmp177(bad, "a search that matches", S.search.boiler.map((e) => e.text), ["Boiler service · T−22d", "→ add an item"]);
    verdict177("N1i en: the search box's empty state, a hit and \"→ add an item\" read as before", bad, "palette");

    bad = [];
    S.probes.forEach((p) => {
      const dt = new Date(p.y, p.m, PDAY177), row = S.list1.rows.find((r) => r.title === p.name) || {}, days = daysTo177(now, dt);
      cmp177(bad, `${p.name} (${MON177[p.m]}) row`, [row.t, row.date, row.body], [tmin177(days), short177(dt), `Home · orbital period ${per177(p.recur).replace("every ", "")} · ${money177(p.pounds)}`]);
      cmp177(bad, `${p.name} drawer date`, p.drawer && p.drawer.kv[0].slice(0, 2), ["due", `${tmin177(days)} · ${long177(dt)}`]);
      const furthest = Math.max(16, 22, 61, 122, 161, 51, daysTo177(now, nd), ...S.probes.slice(0, p.i + 1).map((q) => daysTo177(now, new Date(q.y, q.m, PDAY177))));
      cmp177(bad, `${p.name} horizon`, p.horizon, `— beyond the horizon: nothing scheduled past ${LONG177[at177(now, furthest).getMonth()]} —`);
    });
    const finalDays = [16, 22, 61, daysTo177(now, nd), 122, 161, 51, ...S.probes.map((p) => daysTo177(now, new Date(p.y, p.m, PDAY177)))];
    cmp177(bad, "the month headers once all twelve months are in", S.list1.groups.map((g) => [g.label, g.small]), groups177(now, finalDays).map((g) => [g.label, g.small]));
    verdict177("N1j en: all twelve months, in the short date, the long date, the month header and the horizon line (\"Sep\", \"September\"), read as before", bad, `${S.probes.length} probes`);

    bad = [];
    S.probes.forEach((p) => {
      const kv = Object.fromEntries((p.drawer || { kv: [] }).kv.map((k) => [k[0], k[1]]));
      cmp177(bad, `${p.name} period and cost`, [kv["orbital period"], kv.cost], [per177(p.recur), money177(p.pounds)]);
      if (!p.recur) cmp177(bad, `${p.name} note`, p.drawer && p.drawer.note, "one-off — does not come round");
    });
    verdict177("N1k en: repeat periods (every year, every 6 months, every 2 years, one-off), money with grouping (~£1,234,567.50), no cost (—) and the one-off note read as before", bad, "twelve probes");
  });

  /* N2: the words come from the catalogue (en.js served marked) */
  await run("N2 en marked", { context: N_CTX, stored: "en" }, async (page) => {
    await open177(page, "en", marked177);
    const S = await snap177(page);
    const lacks = (list) => list.filter(([, v]) => !isMarked177(v)).map(([l, v]) => `${l} ${JSON.stringify(v)}`);
    const verdict = (name, list, ok) => check(name, !lacks(list).length, lacks(list).length ? `not from the catalogue: ${lacks(list).slice(0, 4).join("; ")}${lacks(list).length > 4 ? ` (+${lacks(list).length - 4})` : ""}` : ok);
    const boiler = S.drawers["i-boiler"], mot = S.drawers["i-mot"], one = S.probes[3].drawer;
    verdict("N2a en: the dial's spoken labels (this household, Fly to, a body's label) and callouts (2 documents, suggested · renews) carry the catalogue's mark", [
      ["the sun's label", S.dial.sun], ["a mini system's label", S.dial.hits[0]], ["a body's label", S.dial.bodies[0][1]], ["the documents callout", S.callouts["i-mot"].line], ["the suggestion callout", S.callouts["r-insurance"].line]], "5 of 5");
    verdict("N2b en: the list's TODAY line, \"N approaching\", the horizon line and each row's line carry the catalogue's mark, the sections' names as values of their own", [
      ["the TODAY line", S.list0.today], ["a month's count", S.list0.groups[0].small], ["the horizon", S.list0.horizon], ...S.list0.rows.map((r) => [`${r.id} line`, r.body]),
      ...[["i-boiler", "Home"], ["i-mot", "Vehicles"], ["i-smoke", "Devices"]].map(([id, name]) => [`the section ${name}`, S.list0.rows.find((r) => r.id === id).body.includes(marked177(name)) ? marked177(name) : S.list0.rows.find((r) => r.id === id).body])], "all");
    check("N2b2 en: a row's line marks two things apart (the section name and the orbital period), not one string", S.list0.rows.every((r) => (r.body.match(/⟦/g) || []).length >= 2), JSON.stringify(S.list0.rows.map((r) => (r.body.match(/⟦/g) || []).length)));
    verdict("N2c en: an item drawer's seven labels, its section, type, period and reminders values, heading, buttons, spoken label and note carry the mark", [
      ...boiler.kv.map(([a], i) => [`label ${i}`, a]), ...[1, 2, 3, 6].map((i) => [`value ${i}`, boiler.kv[i][1]]),
      ["documents heading", (mot.h4[0] || [""])[0]], ["acts label", boiler.acts], ...boiler.btns.map((b, i) => [`button ${i}`, b[0]]), ["the note", boiler.note]], "all");
    verdict("N2d en: a document's meta (\"added 12 Jun · 240 KB\"), the one-off period and note, and the buttons after pressing carry the mark", [
      ["a document's meta", mot.docs[0].meta], ["one-off period", one.kv[3][1]], ["one-off note", one.note], ["completed today", S.completed.btns[0][0]], ["last completed", S.completed.kv[1][0]], ["its value", S.completed.kv[1][1]],
      ["snoozed a week", S.snoozed.btns[1][0]], ["snoozed (label)", S.snoozed.kv[1][0]], ["snoozed (value)", S.snoozed.kv[1][1]], ["attached on acceptance", S.accepted.docs[0].meta]], "all");
    verdict("N2e en: the inbox's sample sentences (filed note, source line, arrived, from a date, the failed notes) and the search box's words carry the mark", [
      ["filed note", S.inbox0.lanes[0].receipts[0].small], ["source line", S.inbox0.lanes[1].receipts[0].small], ["arrived", S.inbox0.lanes[2].receipts[0].title], ["reading note", S.inbox0.lanes[2].receipts[0].small],
      ["failed title", S.inbox0.lanes[3].receipts[0].title], ["failed note", S.inbox0.lanes[3].receipts[0].small], ["failed note 2", S.inbox0.lanes[3].receipts[1].small], ["no match", S.search.none[0].text], ["add an item", S.search.none[1].text]], "all");
    const marksOn = [["a row's title", S.list0.rows[0].title], ["a row's countdown", S.list0.rows[0].t], ["a provider (drawer)", boiler.kv[5][1]], ["a document's name", mot.docs[0].name], ["the household's name", S.dial.name], ["a chip", S.dial.chips[0]],
      ["the receipt's title", S.inbox0.lanes[1].receipts[0].title], ["the filed receipt's title", S.inbox0.lanes[0].receipts[0].title]];
    const kept = marksOn.filter(([, v]) => typeof v !== "string" || v.includes(OPEN177) || v.includes(CLOSE177)).map(([l, v]) => `${l} ${JSON.stringify(v)}`);
    check("N2f en: kept data (titles, providers, file names, the T− countdown, household names) carries no mark", !kept.length, kept.length ? `marked: ${kept.join("; ")}` : `${marksOn.length} read`);
  });

  /* N3: a translation cannot break the page (point 8) */
  await run("N3 en junk", { context: N_CTX, stored: "en" }, async (page) => {
    await open177(page, "en", junked177);
    const S = await snap177(page);
    const boiler = S.drawers["i-boiler"], mot = S.drawers["i-mot"], one = S.probes[3].drawer;
    /* [what, text, element children]: the text holds the characters as written and the element made no markup of them (kids 0; null = an attribute, which only has to hold the whole text) */
    const rows = [
      ["the sun's spoken label", S.dial.sun, null], ["a mini system's spoken label", S.dial.hits[0], null], ["a body's spoken label", S.dial.bodies[0][1], null], ["the documents callout", S.callouts["i-mot"].line, S.callouts["i-mot"].kids],
      ["the TODAY line", S.list0.today, S.list0.todayKids], ["a month's count", S.list0.groups[0].small, S.list0.groups[0].smallKids], ["the horizon line", S.list0.horizon, S.list0.horizonKids], ["a row's line", S.list0.rows[1].body, S.list0.rows[1].bodyKids],
      ...boiler.kv.map(([a, , ak], i) => [`drawer label ${i}`, a, ak]), ...[1, 2, 3, 6].map((i) => [`drawer value ${i}`, boiler.kv[i][1], boiler.kv[i][3]]), ["a drawer's spoken label (Item actions)", boiler.acts, null], ...boiler.btns.map((b, i) => [`drawer button ${i + 1}`, b[0], b[2]]), ["the drawer's note", boiler.note, boiler.noteKids],
      ["the documents heading", (mot.h4[0] || ["", 0])[0], (mot.h4[0] || ["", 0])[1]], ["a document's meta", mot.docs[0].meta, mot.docs[0].kids], ["the one-off note", one.note, one.noteKids], ["a search's empty state", S.search.none[0].text, S.search.none[0].kids], ["→ add an item", S.search.none[1].text, S.search.none[1].kids],
      ...S.inbox0.lanes.map((l) => [`inbox lane ${l.cls} heading (#176)`, l.h4, l.h4Kids]), ["the filed note", S.inbox0.lanes[0].receipts[0].small, S.inbox0.lanes[0].receipts[0].smallKids], ["the source line", S.inbox0.lanes[1].receipts[0].small, S.inbox0.lanes[1].receipts[0].smallKids],
      ["the reading receipt's title", S.inbox0.lanes[2].receipts[0].title, S.inbox0.lanes[2].receipts[0].titleKids], ["the failed note", S.inbox0.lanes[3].receipts[0].small, S.inbox0.lanes[3].receipts[0].smallKids],
      ["the inbox's Decide spoken label (#176)", S.inbox0.lanes[1].receipts[0].decide, null], ...S.inbox0.lanes[1].receipts[0].btns.map((b, i) => [`the receipt's button ${i + 1} (#176)`, b[0], b[1]]),
      ...S.inbox0.lanes[1].receipts[0].kv.map((k, i) => [`the receipt's label ${i + 1} (#176)`, k[0], k[2]]), ["the inbox button's spoken label (#176)", S.inbox0.orb, null],
    ];
    const broke = rows.filter(([, text, kids]) => typeof text !== "string" || !text.includes(JUNK177) || (kids !== null && kids !== 0)).map(([what, text, kids]) => `${what}: ${JSON.stringify(text && text.slice(0, 40))}${kids ? `, ${kids} element(s) made` : ""}`);
    check("N3a en: every demo word and spoken label shows <b>x</b> \"q\" &amp; as written, makes no element and cuts no attribute short", !broke.length, broke.length ? `${broke.length} of ${rows.length}: ${broke.slice(0, 4).join("; ")}` : `${rows.length} read`);
    const inboxBroke = rows.filter(([what]) => /#176/.test(what)).filter(([, text, kids]) => typeof text !== "string" || !text.includes(JUNK177) || (kids !== null && kids !== 0)).map(([what]) => what);
    check("N3b en: the inbox's own #176 words (lane headings, Decide, the receipt's buttons and labels, the button's label) are text too", !inboxBroke.length, inboxBroke.length ? `${inboxBroke.join("; ")}` : "all");
  });

  /* N4: de, ja and ar */
  const intl177 = (page, specs) => page.evaluate((specs) => {
    const lang = document.documentElement.lang, F = (o) => new Intl.DateTimeFormat(lang, o);
    return specs.map(([kind, y, m, d]) => {
      const dt = new Date(y, m, d), part = (o, type) => F(o).formatToParts(dt).filter((p) => p.type === type).map((p) => p.value);
      let a = [];
      if (kind === "short") a = [F({ day: "2-digit", month: "short" }).format(dt), F({ day: "numeric", month: "short" }).format(dt)];
      else if (kind === "long") a = [F({ day: "numeric", month: "long", year: "numeric" }).format(dt)];
      else if (kind === "month") a = [F({ month: "short" }).format(dt), ...part({ day: "numeric", month: "short" }, "month")];
      else if (kind === "monthany") a = [F({ month: "short" }).format(dt), F({ month: "long" }).format(dt), ...part({ day: "numeric", month: "short" }, "month"), ...part({ day: "numeric", month: "long" }, "month")];
      else if (kind === "weekday") a = [F({ weekday: "short" }).format(dt), F({ weekday: "long" }).format(dt), ...part({ weekday: "short", day: "numeric", month: "short" }, "weekday")];
      return [...new Set(a.flatMap((x) => [x.toLowerCase(), x.toLowerCase().replace(/\.$/, "")]))];
    });
  }, specs);
  const rel177 = (page, specs) => page.evaluate((specs) => { const lang = document.documentElement.lang; return specs.map(([n, unit]) => ["long", "short", "narrow"].map((style) => new Intl.RelativeTimeFormat(lang, { style }).format(n, unit))); }, specs);
  const num177 = (page, n) => page.evaluate((n) => { const lang = document.documentElement.lang; return [new Intl.NumberFormat(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n), new Intl.NumberFormat(lang, { style: "unit", unit: "month", unitDisplay: "long" }).format(6)]; }, n);
  const latin177 = (text) => { let s = strip177(text); for (const k of KEPT177) s = s.split(k).join(" "); return s.replace(/T[−+]\d+d/g, " ").replace(/\b\d+d\b/g, " "); };
  const ENGLISH177 = ["this household", "Fly to", "approaching", "beyond the horizon", "nothing in orbit yet", "orbital period", "last completed", "snooze a week", "snoozed a week", "completed today", "Item actions", "attached on acceptance",
    "nothing in this orbit matches", "add an item", "every year", "one-off", "scanned clean", "filed against the item", "A message arrived", "A message from", "suggested ·", "renews in", "d before", "a repeat is never finished", "does not come round", "ago"];
  for (const lang of ["de", "ja", "ar"]) {
    await run(`N4 ${lang}`, { context: N_CTX, stored: lang }, async (page) => {
      await open177(page, lang, marked177);
      const S = await snap177(page), now = S.now, low = (s) => String(s).toLowerCase();
      const texts = [S.list0.today, S.list0.horizon, ...S.list0.groups.flatMap((g) => [g.label, g.small]), ...S.list0.rows.flatMap((r) => [r.body, r.t, r.date]), S.dial.sun, ...S.dial.hits, ...S.dial.bodies.map((b) => b[1]), ...S.dial.months, ...Object.values(S.callouts).map((c) => c.line),
        ...Object.values(S.drawers).flatMap((d) => [...d.kv.flatMap((k) => [k[0], k[1]]), ...d.h4.map((h) => h[0]), ...d.docs.map((x) => x.meta), d.acts, ...d.btns.map((b) => b[0]), d.note]), ...S.inbox0.lanes.flatMap((l) => [l.h4, ...l.receipts.flatMap((r) => [r.title, r.small])]),
        ...S.search.none.map((e) => e.text), ...S.probes.flatMap((p) => [p.horizon, ...p.drawer.kv.map((k) => k[1]), p.drawer.note]), ...S.list1.groups.map((g) => g.label)];
      const sd = (kind, y, m, d) => [kind, y, m, d];
      /* the TODAY line: this day's weekday and month in the page's language, the day, and not the English weekday */
      const [wk, mo] = await intl177(page, [sd("weekday", now.y, now.m, now.d), sd("monthany", now.y, now.m, now.d)]);
      const line = low(S.list0.today);
      let bad = [];
      if (!wk.some((x) => line.includes(x))) bad.push(`no weekday of the page's language (${JSON.stringify(wk)})`);
      if (!mo.some((x) => line.includes(x))) bad.push(`no month of the page's language (${JSON.stringify(mo)})`);
      if (!line.includes(String(now.d)) && !/[٠-٩۰-۹]/.test(line)) bad.push("no day number");
      if (lang === "de" && /\b(mon|tue|wed|thu|fri|sat|sun)\b/.test(line)) bad.push("an English weekday");
      if (lang !== "de" && /[A-Za-z]/.test(latin177(S.list0.today))) bad.push(`a Latin letter outside the marks: ${JSON.stringify(latin177(S.list0.today))}`);
      verdict177(`N4a ${lang}: the TODAY line's weekday and date are the browser's in the page's language`, bad, S.list0.today);

      /* the dial's twelve months, the list's month headers, short dates and the horizon */
      const monthAcc = await intl177(page, Array.from({ length: 12 }, (_, i) => sd("month", now.y, (now.m + i) % 12, PDAY177)));
      bad = [];
      S.dial.months.forEach((t, i) => { if (!monthAcc[i].includes(low(t))) bad.push(`dial label ${i} ${JSON.stringify(t)} is not one of ${JSON.stringify(monthAcc[i])}`); });
      if (S.dial.months.join() === Array.from({ length: 12 }, (_, i) => MON177[(now.m + i) % 12].toUpperCase()).join()) bad.push("the twelve labels are the English ones");
      verdict177(`N4b ${lang}: the dial's twelve month labels are the browser's, in order from this month`, bad, S.dial.months.join(" "));

      bad = [];
      const probeShort = await intl177(page, S.probes.map((p) => sd("short", p.y, p.m, PDAY177))), probeLong = await intl177(page, S.probes.map((p) => sd("long", p.y, p.m, PDAY177))), probeMonth = await intl177(page, S.probes.map((p) => sd("month", p.y, p.m, PDAY177))), probeMonthLong = await intl177(page, S.probes.map((p) => sd("monthany", p.y, p.m, PDAY177)));
      S.probes.forEach((p, i) => {
        const row = S.list1.rows.find((r) => r.title === p.name) || {};
        if (!probeShort[i].includes(low(row.date))) bad.push(`${p.name} short date ${JSON.stringify(row.date)} is not one of ${JSON.stringify(probeShort[i])}`);
        if (!probeLong[i].some((x) => low(p.drawer.kv[0][1]).includes(x))) bad.push(`${p.name} long date in ${JSON.stringify(p.drawer.kv[0][1])} is not one of ${JSON.stringify(probeLong[i])}`);
        if (!probeMonthLong[i].some((x) => low(p.horizon).includes(x))) bad.push(`${p.name} month in the horizon ${JSON.stringify(p.horizon)} is not one of ${JSON.stringify(probeMonthLong[i])}`);
        if (!S.list1.groups.some((g) => probeMonth[i].includes(low(g.label)))) bad.push(`no month header for ${p.name} among ${JSON.stringify(S.list1.groups.map((g) => g.label))}`);
      });
      verdict177(`N4c ${lang}: all twelve months' short dates, long dates, month headers and the horizon's month are the browser's in the page's language`, bad, `${S.probes.length} months`);

      /* relative times */
      const [r51, r4] = await rel177(page, [[51, "day"], [-4, "minute"]]);
      bad = [];
      const callout = S.callouts["r-insurance"].line, arrived = S.inbox0.lanes[2].receipts[0].title;
      if (!r51.some((x) => callout.includes(x))) bad.push(`the dial callout ${JSON.stringify(callout)} has none of ${JSON.stringify(r51)}`);
      if (!r4.some((x) => arrived.includes(x))) bad.push(`"arrived" ${JSON.stringify(arrived)} has none of ${JSON.stringify(r4)}`);
      if (/\bin 51 days\b|\b51d\b|\bago\b/.test(strip177(callout) + " " + arrived.replace(/⟦[^⟧]*⟧/g, ""))) bad.push("an English 'in 51 days', '51d' or 'ago' stands around the number");
      verdict177(`N4d ${lang}: the dial callout's "renews in …" and the inbox's "arrived 4 minutes ago" write their time in the page's language`, bad, `${callout} | ${arrived}`);

      /* months count and money */
      const [grouped, sixMonths] = await num177(page, 1234567.5);
      const p0 = S.probes[0], p1 = S.probes[1], row0 = S.list1.rows.find((r) => r.title === p0.name), row1 = S.list1.rows.find((r) => r.title === p1.name);
      bad = [];
      for (const [what, text] of [["the row's line", row0.body], ["the drawer's cost", p0.drawer.kv[4][1]]]) {
        if (!text.includes(grouped)) bad.push(`${what} ${JSON.stringify(text)} lacks the digits ${JSON.stringify(grouped)}`);
        if (!text.includes("£") || !text.includes("~")) bad.push(`${what} lost its £ or ~`);
      }
      if (!row1.body.includes("—") || p1.drawer.kv[4][1] !== "—") bad.push("the no-cost — is gone");
      if (lang === "de" && !row0.body.includes("1.234.567,50")) bad.push("de does not group with . and ,");
      verdict177(`N4e ${lang}: money keeps £, ~ and — and groups its digits as the page's language does (de: 1.234.567,50)`, bad, row0.body);

      bad = [];
      const every6 = p1.drawer.kv[3][1];
      if (!every6.includes(sixMonths)) bad.push(`the period ${JSON.stringify(every6)} lacks Intl's "6 months" ${JSON.stringify(sixMonths)}`);
      if (lang === "de" && /\bmonths?\b/.test(strip177(every6))) bad.push("an English 'months' stands unmarked");
      verdict177(`N4f ${lang}: "every 6 months" holds the month count as Intl.NumberFormat writes it (unit month, long) in the page's language`, bad, every6);

      /* the doc meta and inbox dates are short dates of the page's language */
      const [j12, a9, a6] = await intl177(page, [sd("short", now.y, 5, 12), sd("short", now.y, 7, 9), sd("short", now.y, 7, 6)]);
      bad = [];
      const metas = S.drawers["i-mot"].docs.map((d) => d.meta), filed = S.inbox0.lanes[0].receipts[0].small, failed = S.inbox0.lanes[3].receipts.map((r) => r.title);
      if (!metas.every((m) => j12.some((x) => low(m).includes(x)))) bad.push(`a document's meta ${JSON.stringify(metas)} has no '12 Jun' of the page's language ${JSON.stringify(j12)}`);
      if (!j12.some((x) => low(filed).includes(x))) bad.push(`the filed note ${JSON.stringify(filed)} has no '12 Jun' of the page's language`);
      if (!a9.some((x) => low(failed[0]).includes(x)) || !a6.some((x) => low(failed[1]).includes(x))) bad.push(`the failed titles ${JSON.stringify(failed)} have no '09 Aug' / '06 Aug' of the page's language ${JSON.stringify([a9, a6])}`);
      verdict177(`N4g ${lang}: the sample's own dates (12 Jun, 09 Aug, 06 Aug) are short dates in the page's language`, bad, `${metas[0]} | ${failed[0]}`);

      /* no English page word left unmarked; on ja and ar no Latin letter but kept data */
      const flat = texts.filter((x) => typeof x === "string"), leaks = [];
      for (const t of flat) for (const w of ENGLISH177) if (low(strip177(t)).includes(low(w))) leaks.push(`${JSON.stringify(w)} in ${JSON.stringify(t.slice(0, 50))}`);
      verdict177(`N4h ${lang}: no English page phrase of the demo stands outside the catalogue's marks`, leaks, `${flat.length} texts read`);
      if (lang !== "de") {
        const latin = flat.map((t) => [t, latin177(t)]).filter(([, l]) => /[A-Za-z]/.test(l)).map(([t, l]) => `${JSON.stringify(l.trim().slice(0, 30))} in ${JSON.stringify(t.slice(0, 50))}`);
        verdict177(`N4i ${lang}: apart from kept data and the catalogue's own words, the demo writes no Latin letter`, latin, `${flat.length} texts read`);
      }

      /* kept as written */
      bad = [];
      const mot = S.list0.rows.find((r) => r.id === "i-mot"), boiler = S.list0.rows.find((r) => r.id === "i-boiler");
      cmp177(bad, "the countdowns", [mot.t, S.list0.rows.find((r) => r.id === "i-gutter").t, boiler.t], ["T−16d", "T+16d", "T−22d"]);
      cmp177(bad, "the titles", S.list0.rows.map((r) => r.title), ["Gutter clearing", "Car MOT — Volvo V60", "Boiler service", "Chimney sweep", "Smoke alarm batteries", "Car full service"]);
      if (!boiler.body.includes("Warm & Co.")) bad.push(`the provider is not in ${JSON.stringify(boiler.body)}`);
      cmp177(bad, "the document names and sizes", S.drawers["i-mot"].docs.map((d) => [d.name, /240 KB|88 KB/.exec(d.meta)?.[0]]), [["MOT certificate 2025", "240 KB"], ["Service history", "88 KB"]]);
      cmp177(bad, "the household's name and the other households' hits", [S.dial.name, S.dial.chips], ["Willow House", ["Seaside cottage", "The narrowboat", "Gran's flat", "Mum & Dad's"]]);
      if (!S.inbox0.lanes[1].receipts[0].small.includes("policy-schedule.pdf · 312 KB") || !S.inbox0.lanes[0].receipts[0].small.includes("free mot-reminder.pdf")) bad.push("a file name or size in the inbox is not as written");
      verdict177(`N4j ${lang}: the T− countdowns, titles, providers, file names, sizes and household names are kept as written`, bad, "kept");
    });
  }
} catch (e) {
  check("harness", false, String(e && e.stack || e));
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
process.exit(failed ? 1 : 0);
