/*
 * Live test for #85 batch 3, the proof (ADR-0004 6a.7, P2 and P3), written from the specification alone and judged
 * through what a visitor's browser reports: its console, its `securitypolicyviolation` events and the classes on the
 * page's body. The site's own page (index.html, past maintenance with ?preview), the real worker file, in the gate's
 * own browser: Firefox headed under Xvfb with software GL.
 *
 *   P2a  /?preview&gpu=force&fit=skip&draw=worker: the real assets/door/draw-worker.js is asked for and answered, and
 *        loads with no CSP violation (csp-test's harness: the event and the console message); the console says
 *        `flight: drawn in a worker`, `flight: shaders compiled` and `flight world: on (fitness skipped)`; a click on
 *        the gate lands (the body shows `showwarp`, and then `bare`); `#warpgl` is on the page and has no 2D context
 *        there (and, the proof it was handed to the worker, neither it nor `#warp` gives the page a context at all)
 *   P2b  the same address with draw=page: the console says `flight: drawn on the page` and the gate's flight lands
 *   P3   fallback, live: draw-worker.js answered 404 (as csp-test's F1 answers main.js) under draw=worker: the console
 *        says `flight: drawn on the page: the worker failed to load` and the gate's flight still lands
 *
 * Each case is a fresh context. A case that cannot be judged says so and fails, rather than passing for nothing. No
 * case is judged by how long anything takes: the waits end on what the page says or shows, and the bounds
 * (WAIT_MS, DEADLINE_MS) are only against a hang.
 *
 *   PLAYWRIGHT_ROOT=<playwright package dir> BROWSER=firefox HEADED=1 WEBGL=required LIBGL_ALWAYS_SOFTWARE=1 \
 *     xvfb-run -a -s "-screen 0 1280x800x24" node tools/ci/draw-live-test.mjs [P2a P2b P3 ...]
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { freePort, openBrowser } from "./live-lib.mjs";

const playwright = createRequire(import.meta.url)(process.env.PLAYWRIGHT_ROOT || "playwright");
const BROWSER = process.env.BROWSER || "firefox";
const DEADLINE_MS = Number(process.env.DEADLINE_MS || 10 * 60e3);
const WAIT_MS = Number(process.env.WAIT_MS || 150e3);
const ONLY = process.argv.slice(2);
/* the gate's one server when SITE is given (tools/ci/live-run.mjs), else our own on a free port */
const SITE = process.env.SITE || `http://127.0.0.1:${await freePort()}/`;
const here = dirname(fileURLToPath(import.meta.url));
const WORKER = /\/assets\/door\/draw-worker\.js(\?.*)?$/;

const server = process.env.SITE ? null : spawn(process.execPath, [join(here, "serve.mjs"), new URL(SITE).port], { stdio: ["ignore", "ignore", "inherit"] });
const results = [];
let browser = null;
const t0 = Date.now();
const progress = (msg) => console.log(`  .. ${((Date.now() - t0) / 1000).toFixed(0)}s ${msg}`);

const deadline = setTimeout(() => {
  console.log(`FAIL draw-live-test: the run's deadline (${DEADLINE_MS / 1000} s) passed`);
  browser?.close().catch(() => {});
  server?.kill();
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
   process through the binding, as csp-test.mjs's does; and the body's classes in the order they first appear, so a
   landing is read from what was shown and not from a poll. */
const INIT = () => {
  window.__csp = [];
  document.addEventListener("securitypolicyviolation", (e) => {
    const v = { doc: location.href, directive: e.effectiveDirective || e.violatedDirective, blocked: e.blockedURI, sample: (e.sample || "").slice(0, 60) };
    window.__csp.push(v);
    try { window.__cspReport(v); } catch { /* the array is the fallback */ }
  }, true);
  window.__classes = [];
  const note = () => {
    const b = document.body;
    if (!b) return;
    for (const c of b.classList) if (!window.__classes.includes(c)) window.__classes.push(c);
  };
  new MutationObserver(note).observe(document.documentElement, { attributes: true, attributeFilter: ["class"], subtree: true, childList: true });
  addEventListener("DOMContentLoaded", note);
};

/* a fresh context and page with the recorders on */
const open = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const violations = [], consoleCsp = [], errors = [], said = [], answered = [];
  await ctx.exposeBinding("__cspReport", (_src, v) => { violations.push(v); });
  await ctx.addInitScript(INIT);
  ctx.on("response", (r) => { if (WORKER.test(r.url())) answered.push(r.status()); });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    said.push(m.text());
    if (/content[- ]security[- ]policy|refused to (load|execute|apply|connect|frame)/i.test(m.text())) consoleCsp.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return { ctx, page, violations, consoleCsp, errors, said, answered };
};

const hasSaid = (o, re) => o.said.some((l) => re.test(l));
const waitSaid = (o, re, what) => until(() => hasSaid(o, re), (v) => v, WAIT_MS, 100).then((ok) => { if (!ok) throw new Error(`${what}: the console never said ${re} within ${WAIT_MS / 1000} s (it said ${JSON.stringify(o.said.filter((l) => /flight/.test(l)).slice(0, 6))})`); });
const policy = (o) => [
  ...o.violations.map((v) => `violation: ${v.directive} blocked ${v.blocked}${v.sample ? ` (${v.sample})` : ""}`),
  ...o.consoleCsp.map((m) => `console: ${m}`),
];

/* the gate open, clicked, and the flight landing: `showwarp` shown, and then `bare` */
const landing = async (o, want, what) => {
  await o.page.waitForFunction(() => { const g = document.querySelector("#gate"); return !!g && !g.disabled && document.body.classList.contains("lit"); }, null, { timeout: WAIT_MS });
  await o.page.locator("#gate").click();
  const seen = await until(() => o.page.evaluate(() => window.__classes), (c) => c.includes("bare"), WAIT_MS, 100);
  const warp = seen.indexOf("showwarp"), bare = seen.indexOf("bare");
  want(warp >= 0, `${what}: the body never showed showwarp (classes seen: ${seen.join(" ")})`);
  want(bare >= 0, `${what}: the flight never landed (no bare on the body within ${WAIT_MS / 1000} s; classes seen: ${seen.join(" ")})`);
  want(warp < 0 || bare < 0 || warp < bare, `${what}: bare showed before showwarp (classes seen in order: ${seen.join(" ")})`);
};

const URL_WORKER = (draw) => `${SITE}?preview&gpu=force&fit=skip&draw=${draw}`;

const p2a = () => judge("P2a", "draw=worker: the real worker loads with no CSP violation, the flight is drawn in it and lands", async (want) => {
  const o = await open();
  try {
    progress("P2a: draw=worker");
    await o.page.goto(URL_WORKER("worker"), { waitUntil: "load" });
    await waitSaid(o, /flight: drawn in a worker/, "P2a");
    await waitSaid(o, /flight: shaders compiled/, "P2a");
    await waitSaid(o, /flight world: on \(fitness skipped\)/, "P2a");
    want(o.answered.length > 0 && o.answered.every((s) => s === 200), `control: assets/door/draw-worker.js was answered ${JSON.stringify(o.answered)}; want it asked for and answered 200`);
    want(!hasSaid(o, /flight: drawn on the page/), `the console also said the flight was drawn on the page: ${o.said.find((l) => /drawn on the page/.test(l))}`);
    /* the canvas for the world is on the page, and gives the page no 2D context; both were handed to the worker, so neither gives the page any */
    const c = await o.page.evaluate(() => {
      const probe = (el, type) => { try { return el.getContext(type) ? "a context" : "null"; } catch (e) { return e.name; } };
      const gl = document.getElementById("warpgl"), warp = document.getElementById("warp");
      return { there: !!gl, gl2d: gl ? probe(gl, "2d") : null, glHanded: gl ? probe(gl, "webgl2") : null, warpHanded: warp ? probe(warp, "2d") : null };
    });
    want(c.there, "#warpgl is not on the page");
    want(c.gl2d !== "a context", "#warpgl gave the page a 2D context");
    want(c.glHanded === "InvalidStateError" && c.warpHanded === "InvalidStateError", `the canvases were not handed to the worker: asking #warpgl for webgl2 gave ${c.glHanded}, asking #warp for 2d gave ${c.warpHanded} (want InvalidStateError for both)`);
    await landing(o, want, "P2a");
    const lines = policy(o);
    want(!lines.length, `${lines.length} policy complaint(s), first: ${lines[0]}; others: ${lines.slice(1, 4).join(" | ") || "none"}`);
    want(!o.errors.length, `page error: ${o.errors[0]}`);
  } finally { await o.ctx.close(); }
});

const p2b = () => judge("P2b", "draw=page: the flight is drawn on the page and lands", async (want) => {
  const o = await open();
  try {
    progress("P2b: draw=page");
    await o.page.goto(URL_WORKER("page"), { waitUntil: "load" });
    await waitSaid(o, /flight: drawn on the page/, "P2b");
    want(!hasSaid(o, /flight: drawn in a worker/), "the console also said the flight was drawn in a worker");
    await waitSaid(o, /flight world: on \(fitness skipped\)/, "P2b");
    await landing(o, want, "P2b");
    want(!o.errors.length, `page error: ${o.errors[0]}`);
  } finally { await o.ctx.close(); }
});

const p3 = () => judge("P3", "draw-worker.js answered 404: the flight is drawn on the page, and lands", async (want) => {
  const o = await open();
  try {
    progress("P3: draw=worker with the worker 404");
    let served = 0;
    await o.page.route(WORKER, (route) => { served++; route.fulfill({ status: 404, contentType: "text/plain", body: "not found" }); });
    await o.page.goto(URL_WORKER("worker"), { waitUntil: "load" });
    await waitSaid(o, /flight: drawn on the page: the worker failed to load/, "P3");
    want(served > 0, "control: draw-worker.js was never requested, so the failure was not staged");
    /* (the rule chose the worker, which the console said first; the failure then said the page took over) */
    await landing(o, want, "P3");
  } finally { await o.ctx.close(); }
});

try {
  await new Promise((ok, no) => {
    const start = Date.now();
    (async function poll() {
      try { await fetch(SITE); ok(); } catch { Date.now() - start > 10000 ? no(new Error("server did not start")) : setTimeout(poll, 100); }
    })();
  });
  browser = await openBrowser(playwright, BROWSER);
  if (wanted("P2a")) await p2a();
  if (wanted("P2b")) await p2b();
  if (wanted("P3")) await p3();
} catch (e) {
  console.log(`FAIL draw-live-test: ${String(e.message || e).split("\n")[0]}`);
  results.push({ id: "setup", problems: [String(e.message || e)] });
} finally {
  clearTimeout(deadline);
  await browser?.close().catch(() => {});
  server?.kill();
}

const bad = results.filter((r) => r.problems.length);
console.log(bad.length ? `\ndraw-live-test: failed (${bad.map((r) => r.id).join(", ")})` : "\ndraw-live-test: ok");
process.exit(bad.length ? 1 : 0);
