/*
 * Live test for #93 batch 3, the proof (ADR-0004 6b.7, PW1 and PW3), written from the specification alone and judged
 * through what a visitor's browser reports: its console, the classes on the page's body and pads, and what the page
 * can do with the world's canvas. The site's own page (index.html, past maintenance with ?preview), the real
 * world-worker.js, in the gate's own browser: Firefox headed under Xvfb with software GL. The address carries
 * gpu=force&fit=skip (the debug switches the site's live checks use), and draw=worker|page to force the path.
 *
 *   PW1a  draw=worker: a click on the install's planet; the console says `install: drawn in a worker`, `install: shaders
 *         compiled in N ms`, `install: ready`, `first light: compiles aside` and `gpu: the page's context let go`;
 *         #installpad gains `lit` and the body `arrived`; the world's `.orbitgl` is a placeholder (its getContext("2d")
 *         throws on the page); back to the door and into the information's: #infopad gains `lit` and holds the same
 *         element
 *   PW1b  the same with draw=page: `install: drawn on the page: asked for (draw=page)`, `first light: the ring waits for
 *         the compiles`, the dive lands, and the canvas is not a placeholder (the page can ask it for a context)
 *   PW3   fallback, live: world-worker.js answered 404 (as csp-test's F1 answers main.js) under draw=worker: the console
 *         says `install: drawn on the page: the worker failed to load`, the dive still lands, and `gpu: the page's
 *         context let go` is not said (the flight's worker did come up, so this is the world's own fallback)
 *
 * Each case is a fresh context. A case that cannot be judged says so and fails, rather than passing for nothing. No
 * case is judged by how long anything takes: the waits end on what the page says or shows, and the bounds
 * (WAIT_MS, DEADLINE_MS) are only against a hang.
 *
 *   PLAYWRIGHT_ROOT=<playwright package dir> BROWSER=firefox HEADED=1 WEBGL=required LIBGL_ALWAYS_SOFTWARE=1 \
 *     xvfb-run -a -s "-screen 0 1280x800x24" node tools/ci/world-live-test.mjs [PW1a PW1b PW3 ...]
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
/* after the dive has landed every line the case waits for has been printed or is about to be: a bound against a hang */
const LINES_MS = Number(process.env.LINES_MS || 30e3);
const ONLY = process.argv.slice(2);
/* the gate's one server when SITE is given (tools/ci/live-run.mjs), else our own on a free port */
const SITE = process.env.SITE || `http://127.0.0.1:${await freePort()}/`;
const here = dirname(fileURLToPath(import.meta.url));
const WORKER = /\/assets\/js\/world-worker\.js(\?.*)?$/;

const server = process.env.SITE ? null : spawn(process.execPath, [join(here, "serve.mjs"), new URL(SITE).port], { stdio: ["ignore", "ignore", "inherit"] });
const results = [];
let browser = null;
const t0 = Date.now();
const progress = (msg) => console.log(`  .. ${((Date.now() - t0) / 1000).toFixed(0)}s ${msg}`);

const deadline = setTimeout(() => {
  console.log(`FAIL world-live-test: the run's deadline (${DEADLINE_MS / 1000} s) passed`);
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

/* a fresh context and page with the recorders on */
const open = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const errors = [], said = [];
  const page = await ctx.newPage();
  page.on("console", (m) => { said.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  return { ctx, page, errors, said };
};

const hasSaid = (o, re) => o.said.some((l) => re.test(l));
const waitSaid = (o, re, what, ms = LINES_MS) => until(() => hasSaid(o, re), (v) => v, ms, 100).then((ok) => { if (!ok) throw new Error(`${what}: the console never said ${re} within ${ms / 1000} s (it said ${JSON.stringify(o.said.filter((l) => /install|first light|gpu:|flight/.test(l)).slice(0, 8))})`); });

const URL_OF = (draw) => `${SITE}?preview&gpu=force&fit=skip&draw=${draw}`;

/* the door past its journeys' warm-up: the planet is ready to be dived into (the journey test's own wait) */
const planetReady = (o, section) => o.page.locator(`#door .planet[data-section=${section}].ready`).waitFor({ state: "attached", timeout: WAIT_MS });
/* the planets keep turning, so a pointer click never finds one stable. One journey is under way at a time and a press
   while another lands is dropped, so a press that was not taken (the door still shown, the pad still hidden) is made
   again, until the pad is open */
const dive = async (o, section, pad) => {
  const open = () => o.page.evaluate((id) => !document.getElementById(id).hidden, pad);
  const start = Date.now();
  do {
    await o.page.evaluate((s) => document.querySelector(`#door .planet[data-section=${s}]`).click(), section);
    if (await until(open, (v) => v, 3000, 100)) return;
  } while (Date.now() - start < WAIT_MS);
  throw new Error(`the click on the ${section} planet never opened #${pad} within ${WAIT_MS / 1000} s`);
};
/* a pad that has landed: its `lit` class and the body's `arrived` */
const landed = async (o, want, pad, what) => {
  const ok = await o.page.waitForFunction((id) => document.getElementById(id)?.classList.contains("lit") && document.body.classList.contains("arrived"), pad, { timeout: WAIT_MS }).then(() => true, () => false);
  if (!ok) {
    const seen = await o.page.evaluate((id) => ({ pad: document.getElementById(id)?.className, body: document.body.className }), pad);
    want(false, `${what}: #${pad} never had lit with the body arrived within ${WAIT_MS / 1000} s (pad classes: ${seen.pad}; body: ${seen.body})`);
  }
  return ok;
};
/* the pad's world canvas, asked what the page can do with it. A placeholder (a canvas handed to a worker) throws
   InvalidStateError when asked for a context (HTML Standard); a canvas the page draws on does not. The pad's other
   .orbitgl, if the shared world was made on another pad's canvas, is an ordinary one. `mark` tags every canvas the
   pad holds, so a later look can tell which of them has come on to another pad. */
const canvasesOf = (o, pad, mark = null) => o.page.evaluate(([id, tag]) => {
  const els = [...document.querySelectorAll(`#${id} .orbitgl`)];
  const throws = (e) => { try { e.getContext("2d"); return false; } catch (x) { return x.name === "InvalidStateError"; } };
  const list = els.map((e) => ({ placeholder: throws(e), was: e.__was || null }));
  if (tag) for (const e of els) e.__was = tag;
  return { count: els.length, placeholders: list.filter((c) => c.placeholder).length, moved: list.filter((c) => c.was).length, movedPlaceholders: list.filter((c) => c.was && c.placeholder).length };
}, [pad, mark]);

/* the door, then the install's planet dived into, back out, and the information's dived into: the shared world's one
   canvas is a placeholder (worker) or not (page) throughout, and the same element on both pads */
const journeyThrough = async (o, want, what, inWorker) => {
  await planetReady(o, "install");
  await dive(o, "install", "installpad");
  if (!(await landed(o, want, "installpad", what))) return;
  const first = await canvasesOf(o, "installpad", "install");
  want(first.count >= 1, `${what}: #installpad holds no .orbitgl`);
  want(first.placeholders === (inWorker ? 1 : 0), `${what}: #installpad holds ${first.placeholders} placeholder canvas(es) (a canvas whose getContext("2d") throws InvalidStateError), want ${inWorker ? "the one the world was handed to the worker in" : "none: the world is drawn on the page"}`);
  /* back to the door, and into the information's */
  await o.page.evaluate(() => document.querySelector("#installpad .back.dawn").click());
  await o.page.waitForFunction(() => document.body.classList.contains("at-door") && document.getElementById("installpad").hidden, null, { timeout: WAIT_MS });
  await planetReady(o, "info");
  await dive(o, "info", "infopad");
  if (!(await landed(o, want, "infopad", what))) return;
  const second = await canvasesOf(o, "infopad");
  want(second.moved >= 1, `${what}: no canvas the install held is in #infopad, want the shared one moved there (#infopad holds ${second.count} .orbitgl)`);
  want(second.placeholders === (inWorker ? 1 : 0), `${what}: #infopad holds ${second.placeholders} placeholder canvas(es), want ${inWorker ? "the one" : "none"}`);
  if (inWorker) want(second.movedPlaceholders === 1, `${what}: #infopad's placeholder is not the element the install held, want the one shared element`);
};

const pw1 = (id, draw) => judge(id, draw === "worker"
  ? "draw=worker: the install's world is drawn in a worker, the pad lights, the same canvas goes on to the information's"
  : "draw=page: the install's world is drawn on the page, the dive lands, the same canvas goes on to the information's", async (want) => {
  const o = await open();
  try {
    const inWorker = draw === "worker";
    progress(`${id}: draw=${draw}`);
    await o.page.goto(URL_OF(draw), { waitUntil: "load" });
    await journeyThrough(o, want, id, inWorker);
    if (inWorker) {
      await waitSaid(o, /install: drawn in a worker/, id);
      await waitSaid(o, /install: shaders compiled in \d+ ms/, id);
      await waitSaid(o, /install: ready/, id);
      await waitSaid(o, /first light: compiles aside/, id);
      await waitSaid(o, /gpu: the page's context let go/, id);
      want(!hasSaid(o, /install: drawn on the page/), `the console also said the install was drawn on the page: ${o.said.find((l) => /install: drawn on the page/.test(l))}`);
      want(!hasSaid(o, /first light: the ring waits for the compiles/), "the console said the ring waits for the compiles, the page path's line, under draw=worker");
    } else {
      await waitSaid(o, /install: drawn on the page: asked for \(draw=page\)/, id);
      await waitSaid(o, /first light: the ring waits for the compiles/, id);
      want(!hasSaid(o, /install: drawn in a worker/), "the console said the install was drawn in a worker under draw=page");
      want(!hasSaid(o, /first light: compiles aside/), "the console said the compiles are aside, the worker path's line, under draw=page");
      want(!hasSaid(o, /gpu: the page's context let go/), "the console said the page's context was let go under draw=page, where the page's world draws with it");
    }
    want(!o.errors.length, `page error: ${o.errors[0]}`);
  } finally { await o.ctx.close(); }
});

const pw3 = () => judge("PW3", "world-worker.js answered 404: the install is drawn on the page, the dive lands, the page's context is kept", async (want) => {
  const o = await open();
  try {
    progress("PW3: draw=worker with the world's worker 404");
    let served = 0;
    await o.page.route(WORKER, (route) => { served++; route.fulfill({ status: 404, contentType: "text/plain", body: "not found" }); });
    await o.page.goto(URL_OF("worker"), { waitUntil: "load" });
    await planetReady(o, "install");
    await dive(o, "install", "installpad");
    await landed(o, want, "installpad", "PW3");
    await waitSaid(o, /install: drawn on the page: the worker failed to load/, "PW3");
    want(served > 0, "control: world-worker.js was never requested, so the failure was not staged");
    /* (the flight's own worker is another file and came up: the failure here is the world's alone, so the page's
       context, which the page's world now draws with, must not be let go) */
    await waitSaid(o, /flight: drawn in a worker/, "PW3");
    want(!hasSaid(o, /gpu: the page's context let go/), "the console said the page's context was let go, though the world fell back to the page and draws with it");
    const c = await canvasesOf(o, "installpad");
    want(c.count >= 1 && c.placeholders === 0, `after the fallback #installpad should hold canvases the page can draw on (${c.count} .orbitgl, ${c.placeholders} of them placeholders)`);
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
  if (wanted("PW1a")) await pw1("PW1a", "worker");
  if (wanted("PW1b")) await pw1("PW1b", "page");
  if (wanted("PW3")) await pw3();
} catch (e) {
  console.log(`FAIL world-live-test: ${String(e.message || e).split("\n")[0]}`);
  results.push({ id: "setup", problems: [String(e.message || e)] });
} finally {
  clearTimeout(deadline);
  await browser?.close().catch(() => {});
  server?.kill();
}

const bad = results.filter((r) => r.problems.length);
console.log(bad.length ? `\nworld-live-test: failed (${bad.map((r) => r.id).join(", ")})` : "\nworld-live-test: ok");
process.exit(bad.length ? 1 : 0);
