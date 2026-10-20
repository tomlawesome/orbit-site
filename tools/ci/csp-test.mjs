/*
 * Live test for the site's Content-Security-Policy (audit #12), written from the specification alone and judged
 * through what a visitor's browser reports: its `securitypolicyviolation` events and its console.
 *
 * GitHub Pages cannot send headers, so each page (index.html, 404.html, install.html) carries the policy in a
 * <meta http-equiv="Content-Security-Policy">. The site loads Mermaid from cdn.jsdelivr.net (assets/js/pads.js) and
 * its fonts from Google Fonts. Every page of the walk below must run without one violation.
 *
 *   W1  the landing (/), the maintenance door a visitor meets
 *   W2  the landing past the maintenance door (/?preview)
 *   W3  the install section (/?preview#install): #installpad becomes visible
 *   W4  a docs page with a Mermaid diagram (/?preview#docs/architecture/system-context): its figure[data-mermaid]
 *       is there; where jsDelivr can be reached from this host, the diagram is drawn (an svg inside the figure)
 *   W5  the home / galaxy (/?preview#home): #galaxy has drawn something
 *   W6  an unknown path (served 404.html with status 404)
 *   W7  install.html (it redirects to /#install; violations on either document count)
 *   W8  every docs page (one per source in tools/docs-sources.json, #docs/<slug>; issue #72): every picture in the
 *       page's docs body has loaded (complete, naturalWidth > 0) with no policy violation, and at least one picture
 *       was seen across all pages (the readme carries assets/img/mark.svg), so the check cannot pass on pages with
 *       none. Each picture that failed is reported by page and src. (The docs import once wrote pictures as
 *       raw.githubusercontent.com addresses, which img-src 'self' data: blob: blocks.)
 *       Pass: no `securitypolicyviolation` event and no console message about a content security policy.
 *   P0  control: with the policy in force, an inline <script> that page.evaluate appends to the document must NOT run
 *       (its global stays unset) and a violation must be recorded. This proves the policy is active; with no policy
 *       the script runs and nothing is recorded.
 *   F1  with assets/js/main.js answered 404, the message the page's <noscript> gives ("Orbit's site needs JavaScript
 *       to draw its sky. The install steps are on GitHub: github.com/tomlawesome/orbit") is visible, outside any
 *       <noscript>, within 5 s of the page loading, instead of a blank dark page.
 *   F0  control: a normal load does not show that message (checked 5 s after load; the door has loaded)
 *
 * Every page is opened fresh in its own context. Violations are reported from the page to this process (a binding), so
 * ones on a document the page then leaves (install.html redirecting) are still counted.
 *
 *   PLAYWRIGHT_ROOT=<playwright package dir> BROWSER=firefox HEADED=1 LIBGL_ALWAYS_SOFTWARE=1 \
 *     xvfb-run -a -s "-screen 0 1280x800x24" node tools/ci/csp-test.mjs [W P0 F ...]
 *
 * Firefox headed under Xvfb with software GL, as live:journey runs it. A case that cannot be judged says so and fails,
 * rather than passing for nothing. The run has its own deadline (DEADLINE_MS, default 8 minutes).
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";

const playwright = createRequire(import.meta.url)(process.env.PLAYWRIGHT_ROOT || "playwright");
const BROWSER = process.env.BROWSER || "firefox";
const DEADLINE_MS = Number(process.env.DEADLINE_MS || 8 * 60e3);
const ONLY = process.argv.slice(2);
const PORT = await new Promise((ok, no) => {
  const probe = createServer();
  probe.on("error", no);
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => ok(port)); });
});
const SITE = `http://127.0.0.1:${PORT}/`;
const here = dirname(fileURLToPath(import.meta.url));
const MERMAID_SRC = "https://cdn.jsdelivr.net/npm/mermaid@12.1.0/dist/mermaid.min.js";
const MESSAGE = "needs JavaScript to draw its sky";
const MESSAGE_TAIL = "install steps are on GitHub";
const SHOWN_BY_MS = 5000;

const server = spawn(process.execPath, [join(here, "serve.mjs"), String(PORT)], { stdio: ["ignore", "ignore", "inherit"] });
const results = [];
let browser = null;
const t0 = Date.now();
const progress = (msg) => console.log(`  .. ${((Date.now() - t0) / 1000).toFixed(0)}s ${msg}`);

const deadline = setTimeout(() => {
  console.log(`FAIL csp-test: the run's deadline (${DEADLINE_MS / 1000} s) passed`);
  browser?.close().catch(() => {});
  server.kill();
  process.exit(1);
}, DEADLINE_MS);

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const until = async (read, ok, ms, every = 100) => {
  const start = Date.now();
  let v = await read();
  while (!ok(v) && Date.now() - start < ms) { await sleep(every); v = await read(); }
  return v;
};

const judge = (id, name, fn) => {
  const problems = [], notes = [];
  const want = (ok, msg) => { if (!ok) problems.push(msg); };
  want.note = (msg) => notes.push(msg);
  return Promise.resolve().then(() => fn(want)).catch((e) => { problems.push(`could not be judged: ${String(e.message || e).split("\n")[0]}`); }).then(() => {
    console.log(`${problems.length ? "FAIL" : "ok  "} ${id} ${name}`);
    for (const n of notes) console.log(`       ${id}: (${n})`);
    for (const p of problems) console.log(`       ${id}: ${p}`);
    results.push({ id, problems });
  });
};
const wanted = (id) => !ONLY.length || ONLY.some((o) => id.startsWith(o));

/* In every page before its own scripts: every securitypolicyviolation event (capturing, on the document) goes to the
   process through the binding, and is kept in window.__csp as well. */
const INIT = () => {
  window.__csp = [];
  document.addEventListener("securitypolicyviolation", (e) => {
    const v = { doc: location.href, directive: e.effectiveDirective || e.violatedDirective, blocked: e.blockedURI, sample: (e.sample || "").slice(0, 60) };
    window.__csp.push(v);
    try { window.__cspReport(v); } catch { /* the array is the fallback */ }
  }, true);
};

/* a fresh context and page; returns what a step needs */
const open = async (extra = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...extra });
  const violations = [], consoleCsp = [], errors = [];
  await ctx.exposeBinding("__cspReport", (_src, v) => { violations.push(v); });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (/content[- ]security[- ]policy|refused to (load|execute|apply|connect|frame)/i.test(m.text())) consoleCsp.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errors.push(e.message));
  return { ctx, page, violations, consoleCsp, errors };
};

const say = (o) => [
  ...o.violations.map((v) => `violation: ${v.directive} blocked ${v.blocked} on ${v.doc}${v.sample ? ` (${v.sample})` : ""}`),
  ...o.consoleCsp.map((m) => `console: ${m}`),
];

/* one step of the walk: open, run, wait, and the pass is zero violations */
const walk = async (id, name, url, settle) => {
  if (!wanted(id)) return;
  progress(`${id}: ${url}`);
  const o = await open();
  try {
    await judge(id, name, async (want) => {
      await o.page.goto(SITE + url, { waitUntil: "load" });
      await settle(o.page, want);
      await sleep(2500);
      const lines = say(o);
      want(!lines.length, `${lines.length} policy complaint(s), first: ${lines[0]}; others: ${lines.slice(1, 4).join(" | ") || "none"}`);
    });
  } finally { await o.ctx.close(); }
};

const reachable = async (url) => {
  try { const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8000) }); return r.ok; } catch { return false; }
};

const walkAll = async () => {
  await walk("W1", "the landing: no policy violation", "", async () => {});
  await walk("W2", "the landing past maintenance (?preview): no policy violation", "?preview", async () => {});
  await walk("W3", "the install section: no policy violation", "?preview#install", async (page) => {
    await page.locator("#installpad").waitFor({ state: "visible", timeout: 60000 });
  });
  const net = await reachable(MERMAID_SRC);
  await walk("W4", "a docs page with a Mermaid diagram: no policy violation", "?preview#docs/architecture/system-context", async (page, want) => {
    await page.locator("#docspad").waitFor({ state: "visible", timeout: 60000 });
    const fig = await page.locator("#docspad figure[data-mermaid]").first().waitFor({ state: "attached", timeout: 30000 }).then(() => true, () => false);
    want(fig, "control: the docs page has no figure[data-mermaid] within 30 s, so there is no diagram to judge");
    if (net) {
      const drawn = await until(() => page.evaluate(() => !!document.querySelector("#docspad figure[data-mermaid] svg")), (v) => v, 30000, 250);
      want(drawn, "the diagram was not drawn (no svg in figure[data-mermaid]) within 30 s, although jsDelivr is reachable from this host");
    } else {
      want.note("jsDelivr is not reachable from this host, so whether the diagram drew is not judged");
    }
  });
  await walk("W5", "the home / galaxy: no policy violation", "?preview#home", async (page) => {
    await until(() => page.evaluate(() => (document.querySelector("#galaxy")?.childElementCount || 0) > 0), (v) => v, 30000, 250);
  });
  await walk("W6", "an unknown path (404.html): no policy violation", "no-such-page-csp-test", async () => {});
  await walk("W7", "install.html: no policy violation", "install.html", async (page) => { await sleep(3000); });
  await docsPictures();
};

/* W8: each docs page on its own fresh context; a picture is judged by what the browser did with it. Lazy pictures
   are scrolled into view so they are asked for. */
const docsPictures = async () => {
  if (!wanted("W8")) return;
  const slugs = JSON.parse(readFileSync(join(here, "..", "docs-sources.json"), "utf8")).map((d) => d.slug);
  await judge("W8", `every picture on the ${slugs.length} docs pages loads, with no policy violation`, async (want) => {
    want(slugs.length > 0, "control: tools/docs-sources.json names no docs page");
    let seen = 0;
    for (const slug of slugs) {
      progress(`W8: docs/${slug}`);
      const o = await open();
      try {
        await o.page.goto(`${SITE}?preview#docs/${slug}`, { waitUntil: "load" });
        const there = await o.page.locator("#docspad .body .sec").first().waitFor({ state: "attached", timeout: 60000 }).then(() => true, () => false);
        want(there, `docs/${slug}: no docs body appeared within 60 s, so its pictures cannot be judged`);
        if (!there) continue;
        const urls = await o.page.evaluate(() => [...document.querySelectorAll("#docspad .body img")].map((im) => im.getAttribute("src")));
        seen += urls.length;
        for (let i = 0; i < urls.length; i++) await o.page.evaluate((k) => document.querySelectorAll("#docspad .body img")[k]?.scrollIntoView({ block: "center" }), i);
        const state = () => o.page.evaluate(() => [...document.querySelectorAll("#docspad .body img")].map((im) => ({ src: im.getAttribute("src"), ok: im.complete && im.naturalWidth > 0 })));
        const got = await until(state, (l) => l.every((x) => x.ok), 20000, 250);
        await sleep(1000);
        for (const x of got) want(x.ok, `docs/${slug}: picture did not load: ${x.src}`);
        const lines = say(o);
        want(!lines.length, `docs/${slug}: ${lines.length} policy complaint(s), first: ${lines[0]}; others: ${lines.slice(1, 4).join(" | ") || "none"}`);
      } finally { await o.ctx.close(); }
    }
    want(seen > 0, "control: no picture was found on any docs page, so the check cannot show a picture loads");
    want.note(`${seen} picture(s) seen on ${slugs.length} pages`);
  });
};

const p0 = async () => {
  if (!wanted("P0")) return;
  const o = await open();
  try {
    await judge("P0", "control: an inline script appended by the test does not run, and a violation is recorded (the policy is active)", async (want) => {
      await o.page.goto(`${SITE}?preview`, { waitUntil: "load" });
      await sleep(1500);
      const before = o.violations.length;
      await o.page.evaluate(() => {
        const s = document.createElement("script");
        s.textContent = "window.__cspProbe = 'ran'";
        document.head.appendChild(s);
      });
      await until(() => o.violations.length, (n) => n > before, 4000, 100);
      const ran = await o.page.evaluate(() => window.__cspProbe);
      want(ran !== "ran", "the appended inline script ran (window.__cspProbe was set): no policy stops an inline script");
      const mine = o.violations.slice(before).filter((v) => /script/.test(v.directive || ""));
      want(mine.length > 0, `no securitypolicyviolation event for the appended script (events since: ${JSON.stringify(o.violations.slice(before))})`);
    });
  } finally { await o.ctx.close(); }
};

const visibleMessage = (page) => page.evaluate(([msg, tail]) => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    if (!n.nodeValue.includes(msg)) continue;
    let el = n.parentElement;
    if (!el || el.closest("noscript")) continue;
    let shown = true;
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) { shown = false; break; }
    }
    const r = el.getBoundingClientRect();
    if (!shown || r.width <= 0 || r.height <= 0) continue;
    /* innerText follows the look (the note is set in capitals, text-transform), so the words are compared in any case */
    const has = (e) => (e.innerText || "").toLowerCase().includes(tail.toLowerCase());
    let whole = el;
    while (whole && whole !== document.body && !has(whole)) whole = whole.parentElement;
    if (whole && has(whole)) return true;
  }
  return false;
}, [MESSAGE, MESSAGE_TAIL]);

const fallback = async () => {
  if (wanted("F1")) {
    const o = await open();
    try {
      await judge("F1", `main.js answered 404: the <noscript> message is visible within ${SHOWN_BY_MS / 1000} s`, async (want) => {
        let served = 0;
        await o.page.route(/\/assets\/js\/main\.js(\?.*)?$/, (route) => { served++; route.fulfill({ status: 404, contentType: "text/plain", body: "not found" }); });
        await o.page.goto(`${SITE}?preview`, { waitUntil: "load" });
        const shown = await until(() => visibleMessage(o.page), (v) => v, SHOWN_BY_MS, 100);
        want(served > 0, "control: main.js was never requested, so the failure was not staged");
        want(shown, `the message ("...${MESSAGE}. The ${MESSAGE_TAIL}...") was not visible outside <noscript> ${SHOWN_BY_MS / 1000} s after the page loaded (main.js refused ${served} time(s))`);
      });
    } finally { await o.ctx.close(); }
  }
  if (wanted("F0")) {
    const o = await open();
    try {
      await judge("F0", "control: a normal load does not show the message", async (want) => {
        await o.page.goto(`${SITE}?preview`, { waitUntil: "load" });
        const loaded = await until(() => o.page.evaluate(() => !!document.querySelector("#door .planet")), (v) => v, 30000, 200);
        want(loaded, "control: the door never drew its planets in 30 s, so main.js did not run and the page cannot be judged");
        await sleep(SHOWN_BY_MS);
        want(!(await visibleMessage(o.page)), "the no-JavaScript message is visible on a page whose main.js loaded");
      });
    } finally { await o.ctx.close(); }
  }
};

try {
  await new Promise((ok, no) => {
    const start = Date.now();
    (async function poll() {
      try { await fetch(SITE); ok(); } catch { Date.now() - start > 10000 ? no(new Error("server did not start")) : setTimeout(poll, 100); }
    })();
  });
  browser = await playwright[BROWSER].launch(process.env.HEADED === "1" ? { headless: false } : {});
  await walkAll();
  await p0();
  await fallback();
} catch (e) {
  console.log(`FAIL csp-test: ${String(e.message || e).split("\n")[0]}`);
  results.push({ id: "setup", problems: [String(e.message || e)] });
} finally {
  clearTimeout(deadline);
  await browser?.close().catch(() => {});
  server.kill();
}

const bad = results.filter((r) => r.problems.length);
console.log(bad.length ? `\ncsp-test: failed (${bad.map((r) => r.id).join(", ")})` : "\ncsp-test: ok");
process.exit(bad.length ? 1 : 0);
