/*
 * Live test for the site's Content-Security-Policy (audit #12), written from the specification alone and judged
 * through what a visitor's browser reports: its `securitypolicyviolation` events and its console.
 *
 * GitHub Pages cannot send headers, so each page (index.html, 404.html, install.html) carries the policy in a
 * <meta http-equiv="Content-Security-Policy">. Nothing on the site loads from a third party (issue #92, owner
 * 2026-10-27): every font, script, style and picture is served by the site itself, and the policy names no outside
 * host for scripts, styles or fonts. Every page of the walk below must run without one violation.
 *
 *   W1  the landing (/), the maintenance door a visitor meets
 *   W2  the landing past the maintenance door (/?preview)
 *   W3  the install section (/?preview#install): #installpad becomes visible
 *   W4  a docs page with a Mermaid diagram (/?preview#docs/architecture/system-context): its figure[data-mermaid]
 *       is there and the diagram is drawn (an svg inside the figure), on every host, network or none: the library is
 *       the site's own copy, so the page asks the site for it (a request for a mermaid file, answered by the site) and
 *       nobody else (#92)
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
 *   S1  (#92) each page's policy lists 'self' and nothing else as a source for scripts (plus the hashes of its own
 *       inline scripts), styles ('unsafe-inline' may stay for styles) and fonts: no outside host, no scheme-only
 *       source such as https:, no wildcard
 *   S2  (#92) nothing a page, a stylesheet (every .css under assets/) or an inline style names as a load is an outside address:
 *       <link> (stylesheet, preload, preconnect, icon ...), <script src>, <img>, <source>, <iframe>, url() and
 *       @import. Control: index.html still carries <a href> links to other sites, which stay allowed (a link passes,
 *       a load fails). Scripts that build addresses at run time are judged by N1
 *   N1  (#92) with the pages opened in a real browser, not one request leaves the site: the landing, install section,
 *       the docs page with the diagram (drawn), the home / galaxy, the 404 page and install.html. A request to any
 *       other host fails the case and is named, whether it would have been answered or not (this host may have no
 *       network, so a request is judged when it is made)
 *   N2  (#92) the fonts the pages use are the site's own: on index.html each of Space Grotesk 500 and 600, Inter 400,
 *       500 and 600, JetBrains Mono 400 and 500, and on 404.html Space Grotesk 600 and JetBrains Mono 400, can be
 *       loaded from an @font-face (document.fonts.load finds the face and it reaches "loaded"), and every font file
 *       the browser fetched came from the site
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
import { readFileSync, readdirSync } from "node:fs";
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
  const violations = [], consoleCsp = [], errors = [], outside = [], fontFiles = [], scripts = [];
  ctx.on("request", (r) => {
    let u; try { u = new URL(r.url()); } catch { return; }
    if (!/^https?:$/.test(u.protocol)) return;
    if (r.resourceType() === "font") fontFiles.push(u.href);
    if (r.resourceType() === "script") scripts.push(u.href);
    if (u.origin !== new URL(SITE).origin) outside.push(`${r.resourceType()} ${u.href.slice(0, 120)}`);
  });
  await ctx.exposeBinding("__cspReport", (_src, v) => { violations.push(v); });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (/content[- ]security[- ]policy|refused to (load|execute|apply|connect|frame)/i.test(m.text())) consoleCsp.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errors.push(e.message));
  return { ctx, page, violations, consoleCsp, errors, outside, fontFiles, scripts };
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
      await settle(o.page, want, o);
      await sleep(2500);
      const lines = say(o);
      want(!lines.length, `${lines.length} policy complaint(s), first: ${lines[0]}; others: ${lines.slice(1, 4).join(" | ") || "none"}`);
    });
  } finally { await o.ctx.close(); }
};

const walkAll = async () => {
  await walk("W1", "the landing: no policy violation", "", async () => {});
  await walk("W2", "the landing past maintenance (?preview): no policy violation", "?preview", async () => {});
  await walk("W3", "the install section: no policy violation", "?preview#install", async (page) => {
    await page.locator("#installpad").waitFor({ state: "visible", timeout: 60000 });
  });
  await walk("W4", "a docs page with a Mermaid diagram: no policy violation, drawn from the site's own copy", "?preview#docs/architecture/system-context", async (page, want, o) => {
    await page.locator("#docspad").waitFor({ state: "visible", timeout: 60000 });
    const fig = await page.locator("#docspad figure[data-mermaid]").first().waitFor({ state: "attached", timeout: 30000 }).then(() => true, () => false);
    want(fig, "control: the docs page has no figure[data-mermaid] within 30 s, so there is no diagram to judge");
    const drawn = await until(() => page.evaluate(() => !!document.querySelector("#docspad figure[data-mermaid] svg")), (v) => v, 30000, 250);
    want(drawn, "the diagram was not drawn (no svg in figure[data-mermaid]) within 30 s; the library is the site's own file, so no network is needed");
    const lib = o.scripts.filter((u) => /mermaid/i.test(u));
    want(lib.length > 0, "control: no script whose address names mermaid was requested, so where the library comes from cannot be judged");
    want(lib.every((u) => new URL(u).origin === new URL(SITE).origin), `the diagram library was asked for from outside the site: ${lib.filter((u) => new URL(u).origin !== new URL(SITE).origin).join(", ")}`);
  });
  await walk("W5", "the home / galaxy: no policy violation", "?preview#home", async (page) => {
    await until(() => page.evaluate(() => (document.querySelector("#galaxy")?.childElementCount || 0) > 0), (v) => v, 30000, 250);
  });
  await walk("W6", "an unknown path (404.html): no policy violation", "no-such-page-csp-test", async () => {});
  await walk("W7", "install.html: no policy violation", "install.html", async (page) => { await sleep(3000); });
  await docsPictures();
};

/* W8: each docs page on its own fresh context; a picture is judged by what the browser did with it. Lazy pictures
   are scrolled into view one at a time, each kept there until it has loaded (or 20 s): a browser asks for a lazy
   picture only once it has drawn a frame with it on screen, so scrolling straight past them all on a busy runner
   left every one but the last never asked for (pipeline 2851, docs/administration's five) */
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
        const state = () => o.page.evaluate(() => [...document.querySelectorAll("#docspad .body img")].map((im) => ({ src: im.getAttribute("src"), ok: im.complete && im.naturalWidth > 0 })));
        for (let i = 0; i < urls.length; i++) {
          await o.page.evaluate((k) => document.querySelectorAll("#docspad .body img")[k]?.scrollIntoView({ block: "center" }), i);
          await until(state, (l) => !!l[i]?.ok, 20000, 250);
        }
        const got = await state();
        await sleep(1000);
        for (const x of got) want(x.ok, `docs/${slug}: picture did not load: ${x.src}`);
        const lines = say(o);
        want(!lines.length, `docs/${slug}: ${lines.length} policy complaint(s), first: ${lines[0]}; others: ${lines.slice(1, 4).join(" | ") || "none"}`);
        want(!o.outside.length, `docs/${slug}: ${o.outside.length} request(s) left the site, first: ${o.outside[0]}`);
      } finally { await o.ctx.close(); }
    }
    want(seen > 0, "control: no picture was found on any docs page, so the check cannot show a picture loads");
    want.note(`${seen} picture(s) seen on ${slugs.length} pages`);
  });
};

/* ---- #92: nothing loads from a third party ---- */
const ROOT = join(here, "..", "..");
const PAGES = ["index.html", "404.html", "install.html"];
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const noComments = (t) => t.replace(/<!--[\s\S]*?-->/g, (c) => " ".repeat(c.length));
/* http://host, https://host or //host: an address on another site (a relative path, a fragment, data: and blob: are not) */
const OUTSIDE = /^\s*(?:https?:)?\/\//i;

const policyOf = (page) => {
  const meta = [...noComments(read(page)).matchAll(/<meta\b[^>]*\bhttp-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi)][0];
  if (!meta) return null;
  const content = (meta[0].match(/\bcontent\s*=\s*"([^"]*)"/i) || meta[0].match(/\bcontent\s*=\s*'([^']*)'/i) || [, ""])[1];
  const dir = {};
  for (const d of content.split(";").map((x) => x.trim()).filter(Boolean)) { const [n, ...v] = d.split(/\s+/); dir[n.toLowerCase()] = v; }
  return dir;
};

const policyCase = async () => {
  if (!wanted("S1")) return;
  await judge("S1", "each page's policy lets scripts, styles and fonts come from 'self' only (no outside host)", async (want) => {
    for (const page of PAGES) {
      const dir = policyOf(page);
      if (!dir) { want(false, `${page}: has no <meta http-equiv="Content-Security-Policy">`); continue; }
      for (const name of ["script-src", "style-src", "font-src"]) {
        const toks = dir[name];
        if (!toks) { want(false, `${page}: the policy has no ${name} (a missing one falls back to default-src; name it)`); continue; }
        want(toks.includes("'self'"), `${page}: ${name} does not list 'self'`);
        const extra = toks.filter((t) => {
          if (t === "'self'") return false;
          if (name !== "font-src" && /^'sha(256|384|512)-[A-Za-z0-9+/=]+'$/.test(t)) return false; /* an inline script's or style's own hash */
          if (name === "style-src" && t === "'unsafe-inline'") return false;
          return true;
        });
        want(!extra.length, `${page}: ${name} lists ${extra.join(" ")} besides 'self' (an outside host, a scheme such as https:, or a wildcard)`);
      }
    }
  });
};

/* what the page's markup and styles name as something to load */
const loadsOf = (file, text) => {
  const found = [];
  const t = noComments(text);
  const add = (what, addr) => { if (OUTSIDE.test(addr)) found.push(`${file}: ${what} ${addr.trim().slice(0, 90)}`); };
  if (/\.html$/.test(file)) {
    for (const m of t.matchAll(/<(link|script|img|source|iframe|embed|object|video|audio|track|input|form)\b([^>]*)>/gi)) {
      const tag = m[1].toLowerCase(), attrs = m[2];
      const attr = (n) => (attrs.match(new RegExp(`\\b${n}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")) || []).slice(1).find((x) => x !== undefined);
      if (tag === "link") {
        const rel = (attr("rel") || "").toLowerCase().split(/\s+/);
        if (!rel.some((r) => ["canonical", "alternate", "author", "me", "license", "help", "next", "prev"].includes(r))) add(`<link rel="${rel.join(" ")}"> href`, attr("href") || "");
      } else if (tag === "form") add("<form> action", attr("action") || "");
      else if (tag === "object") add("<object> data", attr("data") || "");
      else {
        add(`<${tag}> src`, attr("src") || "");
        for (const c of (attr("srcset") || "").split(",")) add(`<${tag}> srcset`, c.trim().split(/\s+/)[0] || "");
        add(`<${tag}> poster`, attr("poster") || "");
      }
    }
  }
  /* url() and @import, in a stylesheet, a <style> or a style attribute */
  const css = /\.css$/.test(file) ? t : [...t.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>|\bstyle\s*=\s*"([^"]*)"|\bstyle\s*=\s*'([^']*)'/gi)].map((m) => m[1] || m[2] || m[3] || "").join("\n");
  for (const m of css.matchAll(/url\(\s*(["']?)([^"')]*)\1\s*\)/gi)) add("url()", m[2]);
  for (const m of css.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi)) add("@import", m[1]);
  return found;
};

const cssFiles = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? cssFiles(join(dir, e.name)) : e.name.endsWith(".css") ? [join(dir, e.name)] : []);

const staticLoadsCase = async () => {
  if (!wanted("S2")) return;
  await judge("S2", "no page, stylesheet or inline style names an outside address to load (links to other sites are still allowed)", async (want) => {
    const files = [...PAGES, ...cssFiles("assets")];
    want(files.length > 3, "control: no stylesheet found under assets/, so the stylesheets cannot be judged");
    const found = files.flatMap((f) => loadsOf(f, read(f)));
    want(!found.length, `${found.length} load(s) from outside the site, first: ${found[0]}; others: ${found.slice(1, 4).join(" | ") || "none"}`);
    const links = [...noComments(read("index.html")).matchAll(/<a\b[^>]*\bhref\s*=\s*["']\s*(https?:\/\/[^"']+)/gi)].map((m) => m[1]);
    want(links.length > 0, "control: index.html carries no <a href> to another site, so 'a link passes' is not shown");
    want.note(`${links.length} outside link(s) on index.html stay allowed`);
  });
};

/* N1: nothing leaves the site, judged by what the browser asks for */
const noOutsideRequests = async () => {
  if (!wanted("N1")) return;
  const steps = [
    ["the landing", "", async () => {}],
    ["the landing past maintenance", "?preview", async () => {}],
    ["the install section", "?preview#install", async (page) => { await page.locator("#installpad").waitFor({ state: "visible", timeout: 60000 }); }],
    ["the docs diagram", "?preview#docs/architecture/system-context", async (page) => {
      await page.locator("#docspad figure[data-mermaid]").first().waitFor({ state: "attached", timeout: 30000 }).catch(() => {});
      await until(() => page.evaluate(() => !!document.querySelector("#docspad figure[data-mermaid] svg")), (v) => v, 30000, 250);
    }],
    ["the home / galaxy", "?preview#home", async (page) => {
      await until(() => page.evaluate(() => (document.querySelector("#galaxy")?.childElementCount || 0) > 0), (v) => v, 30000, 250);
    }],
    ["the 404 page", "no-such-page-csp-test", async () => {}],
    ["install.html", "install.html", async () => { await sleep(1500); }],
  ];
  await judge("N1", "not one request from any page leaves the site", async (want) => {
    for (const [name, url, settle] of steps) {
      progress(`N1: ${name}`);
      const o = await open();
      try {
        await o.page.goto(SITE + url, { waitUntil: "load" });
        await settle(o.page);
        await sleep(2500);
        want(!o.outside.length, `${name} (${url || "/"}): ${o.outside.length} request(s) left the site, first: ${o.outside[0]}; others: ${o.outside.slice(1, 4).join(" | ") || "none"}`);
      } finally { await o.ctx.close(); }
    }
  });
};

/* N2: the fonts are the site's own */
const FONTS = [
  ["index.html", "?preview", [["Space Grotesk", 500], ["Space Grotesk", 600], ["Inter", 400], ["Inter", 500], ["Inter", 600], ["JetBrains Mono", 400], ["JetBrains Mono", 500]]],
  ["404.html", "no-such-page-csp-test", [["Space Grotesk", 600], ["JetBrains Mono", 400]]],
];
const fontsAreOurs = async () => {
  if (!wanted("N2")) return;
  await judge("N2", "the fonts the pages use load from @font-face rules, from files the site serves", async (want) => {
    for (const [page, url, faces] of FONTS) {
      progress(`N2: ${page}`);
      const o = await open();
      try {
        await o.page.goto(SITE + url, { waitUntil: "load" });
        await sleep(1500);
        const got = await o.page.evaluate(async (list) => {
          const out = [];
          for (const [family, weight] of list) {
            let loaded = [];
            try { loaded = (await document.fonts.load(`${weight} 16px "${family}"`)).map((f) => f.status); } catch (e) { loaded = [`error: ${e.message}`]; }
            out.push({ family, weight, faces: loaded });
          }
          await document.fonts.ready;
          return out;
        }, faces);
        for (const g of got) {
          want(g.faces.length > 0, `${page}: no @font-face rule serves ${g.family} at weight ${g.weight} (the browser would use a system font)`);
          want(g.faces.every((f) => f === "loaded"), `${page}: ${g.family} ${g.weight}: face did not reach "loaded" (${g.faces.join(", ")})`);
        }
        const files = [...new Set(o.fontFiles)];
        want(files.length >= (page === "index.html" ? 3 : 2), `${page}: only ${files.length} font file(s) were fetched, expected one per family at least`);
        const foreign = files.filter((u) => new URL(u).origin !== new URL(SITE).origin);
        want(!foreign.length, `${page}: ${foreign.length} font file(s) came from outside the site, first: ${foreign[0]}`);
        want(!o.outside.length, `${page}: ${o.outside.length} request(s) left the site, first: ${o.outside[0]}`);
      } finally { await o.ctx.close(); }
    }
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
  await policyCase();
  await staticLoadsCase();
  await walkAll();
  await noOutsideRequests();
  await fontsAreOurs();
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
