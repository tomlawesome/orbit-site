/*
 * Records which of the site's JavaScript ran in a Chromium test, with no change to the test (#14).
 *
 *   COVERAGE_DIR=out node --import ./tools/ci/coverage-hook.mjs tools/ci/journey.mjs
 *
 * Loaded before the test, it wraps the Chromium launch of the Playwright the test uses (PLAYWRIGHT_ROOT, as the
 * tests find it): every page of every context then runs with V8's precise coverage (Playwright's page.coverage),
 * read when the page navigates or closes, and at exit the ranges that ran are written to
 * $COVERAGE_DIR/browser-<test>-<pid>.json. Firefox has no such thing, so only Chromium is recorded. Only the site's
 * own files are kept (sw.js, assets/js/*.js, assets/door/*.js, from the page's own origin); tools/ci/coverage.mjs
 * reads the files and reports. Without COVERAGE_DIR the hook does nothing.
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { coveredRanges, rangesOf } from "./coverage-lib.mjs";

const dir = process.env.COVERAGE_DIR;
if (dir) {
  const playwright = createRequire(import.meta.url)(process.env.PLAYWRIGHT_ROOT || "playwright");
  const SITE_FILE = /^\/(sw\.js|assets\/(?:js|door)\/[^/]+\.js)$/;
  const seen = new Map(); /* site path -> { length, ran: Uint8Array } */

  const keep = (page, entries) => {
    let origin = "";
    try { origin = new URL(page.url()).origin; } catch { return; }
    for (const e of entries) {
      let u;
      try { u = new URL(e.url); } catch { continue; }
      if (u.origin !== origin || !SITE_FILE.test(u.pathname)) continue;
      const path = u.pathname.slice(1);
      /* V8's offsets are UTF-16 units, as a string's length is */
      const length = typeof e.source === "string" ? e.source.length : Math.max(0, ...e.functions.flatMap((f) => f.ranges.map((r) => r.endOffset)));
      const into = seen.get(path) || { length, ran: new Uint8Array(length) };
      if (length > into.ran.length) { const grown = new Uint8Array(length); grown.set(into.ran); into.ran = grown; into.length = length; }
      for (const [s, en] of coveredRanges(e.functions, length)) into.ran.fill(1, s, en);
      seen.set(path, into);
    }
  };

  /* each page: coverage on from its first moment, taken and restarted before a navigation (its scripts go with
     the document) and taken for the last time before the page or its context closes */
  const watch = (page) => {
    const state = { on: false };
    const start = async () => { try { await page.coverage.startJSCoverage({ resetOnNavigation: false }); state.on = true; } catch { state.on = false; } };
    const take = async (again) => {
      if (!state.on) return;
      state.on = false;
      try { keep(page, await page.coverage.stopJSCoverage()); } catch { /* the page is gone */ }
      if (again) await start();
    };
    state.ready = start();
    for (const m of ["goto", "reload"]) {
      const orig = page[m].bind(page);
      page[m] = async (...a) => { await state.ready; await take(true); return orig(...a); };
    }
    const close = page.close.bind(page);
    page.close = async (...a) => { await state.ready; await take(false); return close(...a); };
    state.take = take;
    return state;
  };

  const track = (browser) => {
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (...a) => {
      const ctx = await newContext(...a);
      const pages = new Set();
      ctx.on("page", (p) => pages.add(watch(p)));
      const close = ctx.close.bind(ctx);
      ctx.close = async (...b) => { for (const s of pages) { await s.ready; await s.take(false); } return close(...b); };
      return ctx;
    };
    const close = browser.close.bind(browser);
    browser.close = async (...a) => { for (const c of browser.contexts()) await c.close().catch(() => {}); return close(...a); };
    return browser;
  };

  const launch = playwright.chromium.launch.bind(playwright.chromium);
  playwright.chromium.launch = async (...a) => track(await launch(...a));

  process.on("exit", () => {
    if (!seen.size) return;
    const scripts = {};
    for (const [path, { length, ran }] of seen) scripts[path] = { length, ran: rangesOf(ran) };
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `browser-${basename(process.argv[1] || "test", ".mjs")}-${process.pid}.json`), JSON.stringify({ scripts }));
  });
}
