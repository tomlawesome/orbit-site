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
 *   J10 the de/ reader reads assets/docs-i18n/de/; a translated page shows no untranslated line, a page with no German file is read in
 *       English with that line shown (decision 11a: page-level, never per section); the root never asks for it
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

  /* J9, J10 (#125 stage 2): fake German docs served by route, so no built translation is needed in the tree. The
     page "readme" is translated (its second section kept in English, its hash not the English's: the stale banner says
     so, J9); every other page has no German file (404: the whole English page is read, and the untranslated line shown). With fresh, every
     section's hash matches the English and none is kept: spec 3 shows the stale banner when "any [hash] differs from
     source.sections, or source.kept is non-empty", so only such a page can show none (J9b). The German page is known
     to be shown by its title in the reader's heading: the reader sets a page's title and its sections' html, never the
     first ("top") section's title, so the fake's "Orbit auf Deutsch" is in no element. */
  const h16 = (x) => createHash("sha256").update(x, "utf8").digest("hex").slice(0, 16);
  const eIndex = JSON.parse(readFileSync(join(ROOT, "assets/docs/index.json"), "utf8"));
  const eReadme = JSON.parse(readFileSync(join(ROOT, "assets/docs/readme.json"), "utf8"));
  const fakeDocs = async (page, generated, fresh = false, keptOnly = false) => {
    const asked = [];
    const first = eReadme.sections[0], second = eReadme.sections[1];
    const dPage = { ...eReadme, title: "Orbit (de)", sections: eReadme.sections.map((x, i) => ({ ...x, title: i === 0 ? "Orbit auf Deutsch" : x.title })),
      source: { generated, sections: Object.fromEntries(eReadme.sections.map((x, i) => [x.id, i === 1 && !fresh ? "0000000000000000" : h16(JSON.stringify([x.title, x.html, x.subs]))])), kept: second && (!fresh || keptOnly) ? [second.id] : [] } };
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
} catch (e) {
  check("harness", false, String(e && e.stack || e));
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
process.exit(failed ? 1 : 0);
