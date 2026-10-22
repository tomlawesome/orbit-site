/*
 * Live test for #49 (the docs planet on the 3D door is unlabelled and takes no tap on a phone), written from the
 * specification alone (owner decision 5a) and judged through what a visitor's browser shows: whether each planet's
 * label is shown (computed opacity of `#door .planet .tag`), whether a point on its hit area
 * (`document.elementFromPoint` over `.planet .hit`) lands on that planet, and whether a tap there opens its landing.
 *
 * Every page is a phone: 390x844, touch (`isMobile` and `hasTouch` in Chromium), pixel ratio 1 (DPR). A planet is
 * "tappable" at the first in-page sample (every 150 ms) where its label is shown and one of nine points spread over
 * its hit area (centre first) lands on it. Times are from the page's own clock (performance.now(), 0 = the page opens).
 * The tap is a real touch (page.touchscreen.tap) at the point just found; "opens" means #docspad becomes visible within
 * 45 s of it (the flight between).
 *
 * Safari's background shader compiling is faked by an init script: the `KHR_parallel_shader_compile` extension is
 * reported (getSupportedExtensions, getExtension) and every program's and shader's COMPLETION_STATUS_KHR (0x91B1) is
 * answered by the fake, never by the driver:
 *   fast   true 160 ms after the program was linked (the shader compiled), and 503 ms for the very first compile of
 *          a fresh context, as Safari measures them (CAPABILITIES.md: 130-170 ms each, the first 503 ms; a phone and
 *          the Safari laptop). FROM=poll counts from the first poll instead of the link, COMPILE_MS and
 *          FIRST_MS change the times;
 *   stuck  false for ever.
 * Pages with faking open `?preview&door3d&gpu=force&level=2&lean&fit=skip` (the live door forced, CAPABILITIES.md; the door's
 * weight and the flight world's speed test forced too, so neither the real probe nor the runner's frame times decide which
 * path the page takes: owner decision 2026-10-14, CI runners have no GPU and shared CPUs).
 *
 *   D1   fast, RUNS times (default 3; the docs planet's lateness depends on how the page's background queue falls,
 *        which varies run to run: explored 2026-10-13, 3 of 4 runs late with the first-compile model, 1 of 5 without):
 *        in every run the docs planet is labelled and tappable no later than 5 s after the later of install and information
 *        became tappable, and a tap on it opens the docs. Why 5 s: once the flight is ready the galaxy is a handful of
 *        programs at 160 ms each, under 2 s even behind the door's own jobs, so 5 s leaves room for a busy host on
 *        software GL and still fails today's ~17 s (#49's run: install 4.0 s, flight 8.5 s, docs 25.1 s).
 *   D1c  controls, fast, every run: install and information both become tappable (within 60 s), so the harness sees a working
 *        door; the faking took (the extension was asked for and handed out, statuses were polled, some turned true).
 *   D2   stuck: the docs planet is labelled and tappable no later than 20 s after the page opens, and a tap on it
 *        opens the docs (as a picture, a 2D chart, if the galaxy is not drawn). Why 20 s: well past the ~4-9 s the
 *        other planets and the flight take on this host, short of a visitor's giving up; today it never comes.
 *   D2c  control, stuck: the faking took (the extension was handed out, statuses were polled, none ever turned true).
 *   D2d  control, stuck (the spec's working door): install and information both become tappable (within 60 s). Today
 *        they never do either: with every status stuck nothing on the door becomes ready (explored 2026-10-13), so a
 *        fix that bounds only the galaxy's wait leaves D2d, and with it D2, failing.
 *   C    control, no faking (plain `?preview&door3d`, the page left to decide its own level): install, information and
 *        docs all become tappable within 20 s of the page opening, and a tap on docs opens the docs. (Software GL here,
 *        so the page refuses the GPU and draws its pictures: this is the door as most of this host's runs see it.)
 *
 *   VERBOSE=1 prints the page's own `orbit ·` console lines (uploads left out) with their times.
 *
 *   PLAYWRIGHT_ROOT=$(ls -d ~/projects/orbit/node_modules/.pnpm/playwright@*\/node_modules/playwright | sort -V | tail -1) \
 *     HEADED=1 LIBGL_ALWAYS_SOFTWARE=1 xvfb-run -a -s "-screen 0 1280x800x24" node tools/ci/docs-planet-test.mjs [fast|stuck|plain ...]
 *
 * Chromium by default (BROWSER=firefox for the other engine, without isMobile), headed under Xvfb with software GL:
 * headless draws no world. A case that cannot be judged says so and fails, rather than passing for nothing. The run
 * has its own deadline (DEADLINE_MS, default 10 minutes) and prints its progress.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:net";

const playwright = createRequire(import.meta.url)(process.env.PLAYWRIGHT_ROOT || "playwright");
const BROWSER = process.env.BROWSER || "chromium";
const DEADLINE_MS = Number(process.env.DEADLINE_MS || 10 * 60e3);
const DPR = Number(process.env.DPR || 1);
const ONLY = process.argv.slice(2);
const D1_AFTER_MS = 5000;      /* D1: docs no later than this after the later of install and information */
const D2_BY_MS = 20000;        /* D2: docs no later than this after the page opens */
const PLAIN_BY_MS = 20000;     /* C: every planet no later than this after the page opens */
const OTHERS_BY_MS = 60000;    /* controls: install and information within this */
const COMPILE_MS = 160;        /* fast: a program's status turns true this long after it was linked */
const FIRST_MS = Number(process.env.FIRST_MS || 503); /* fast: the first compile of a fresh context (Safari, CAPABILITIES.md) */
const FROM = process.env.FROM || "link"; /* fast: the 160 ms counted from the link ("link") or the first poll ("poll") */
const PORT = await new Promise((ok, no) => {
  const probe = createServer();
  probe.on("error", no);
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => ok(port)); });
});
const SITE = `http://127.0.0.1:${PORT}/`;
/* (&lean and &fit=skip: the weight and the flight world's fitness are forced, not left to the real probe and frame times) */
const LIVE = "preview&door3d&gpu=force&level=2&lean&fit=skip";
const PLAIN = "preview&door3d";
const here = dirname(fileURLToPath(import.meta.url));

const server = spawn(process.execPath, [join(here, "serve.mjs"), String(PORT)], { stdio: ["ignore", "ignore", "inherit"] });
const results = [];
let browser = null;
const t0 = Date.now();
const progress = (msg) => console.log(`  .. ${((Date.now() - t0) / 1000).toFixed(0)}s ${msg}`);

const deadline = setTimeout(() => {
  console.log(`FAIL docs-planet-test: the run's deadline (${DEADLINE_MS / 1000} s) passed`);
  browser?.close().catch(() => {});
  server.kill();
  process.exit(1);
}, DEADLINE_MS);

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const s = (ms) => (ms == null ? "never" : `${(ms / 1000).toFixed(1)} s`);

const judge = (id, name, fn) => {
  const problems = [], notes = [];
  const want = (ok, msg) => { if (!ok) problems.push(msg); };
  want.note = (msg) => notes.push(msg);
  try { fn(want); } catch (e) { problems.push(`could not be judged: ${String(e.message || e).split("\n")[0]}`); }
  console.log(`${problems.length ? "FAIL" : "ok  "} ${id} ${name}`);
  for (const n of notes) console.log(`       ${id}: (${n})`);
  for (const p of problems) console.log(`       ${id}: ${p}`);
  results.push({ id, problems });
};

/* In every page before its own scripts: the fake (if asked) and the sampler. */
const INIT = ([mode, compileMs, from, firstMs]) => {
  /* ── the fake: KHR_parallel_shader_compile reported, COMPLETION_STATUS_KHR answered here ── */
  const F = (window.__fake = { mode, extAsked: 0, extGiven: 0, listed: 0, polls: 0, trues: 0 });
  if (mode !== "none") {
    const COMPLETION = 0x91b1, NAME = "KHR_parallel_shader_compile";
    const linkedAt = new WeakMap(), ext = new WeakMap(), warmed = new WeakSet();
    /* Safari: each compile ~160 ms, the very first of a fresh context ~503 ms (CAPABILITIES.md) */
    const begin = (gl, obj) => { linkedAt.set(obj, { t: performance.now(), ms: warmed.has(gl) ? compileMs : firstMs }); warmed.add(gl); };
    const status = (gl, obj) => {
      F.polls++;
      if (mode === "stuck") return false;
      if (!linkedAt.has(obj)) begin(gl, obj);
      const { t, ms } = linkedAt.get(obj);
      const done = performance.now() - t >= ms;
      if (done) F.trues++;
      return done;
    };
    for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
      if (!C) continue;
      const P = C.prototype;
      const wrap = (k, f) => { const orig = P[k]; if (typeof orig === "function") P[k] = function (...a) { return f.call(this, orig, a); }; };
      wrap("getSupportedExtensions", function (orig, a) {
        const list = orig.apply(this, a);
        if (Array.isArray(list) && !list.includes(NAME)) { list.push(NAME); F.listed++; }
        return list;
      });
      wrap("getExtension", function (orig, a) {
        if (a[0] !== NAME) return orig.apply(this, a);
        F.extAsked++;
        if (!ext.has(this)) ext.set(this, { COMPLETION_STATUS_KHR: COMPLETION, maxShaderCompilerThreadsKHR() {} });
        F.extGiven++;
        return ext.get(this);
      });
      wrap("compileShader", function (orig, a) { if (from === "link") begin(this, a[0]); return orig.apply(this, a); });
      wrap("linkProgram", function (orig, a) { if (from === "link") begin(this, a[0]); return orig.apply(this, a); });
      wrap("getProgramParameter", function (orig, a) { return a[1] === COMPLETION ? status(this, a[0]) : orig.apply(this, a); });
      wrap("getShaderParameter", function (orig, a) { return a[1] === COMPLETION ? status(this, a[0]) : orig.apply(this, a); });
    }
  }
  /* ── the sampler: when each planet was first labelled, first tappable; where it can be tapped now ── */
  const S = (window.__seen = { label: {}, hit: {}, point: {}, before: {}, samples: 0 });
  const tick = () => {
    S.samples++;
    const t = performance.now();
    for (const p of document.querySelectorAll("#door .planet[data-section]")) {
      const sec = p.dataset.section;
      const tag = p.querySelector(".tag"), hit = p.querySelector(".hit");
      const ts = tag && getComputedStyle(tag);
      const labelled = !!ts && Number(ts.opacity) > 0 && ts.visibility !== "hidden" && ts.display !== "none" && tag.getBoundingClientRect().width > 0;
      if (labelled && S.label[sec] == null) S.label[sec] = t;
      let point = null, first = null;
      const r = hit?.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) {
        for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7], [0.5, 0.25], [0.5, 0.75], [0.25, 0.5], [0.75, 0.5]]) {
          const x = r.left + r.width * fx, y = r.top + r.height * fy;
          if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
          const e = document.elementFromPoint(x, y);
          if (first == null) first = e ? `${e.tagName.toLowerCase()}${e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).join(".") : ""}` : "nothing";
          if (e?.closest?.(".planet") === p) { point = [x, y]; break; }
        }
      }
      if (S.before[sec] == null && first != null && !point) S.before[sec] = first;
      S.point[sec] = labelled && point ? point : null;
      if (labelled && point && S.hit[sec] == null) S.hit[sec] = t;
    }
  };
  const go = () => setInterval(tick, 150);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go); else go();
};

const phone = () => ({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: DPR, hasTouch: true, reducedMotion: "no-preference",
  ...(BROWSER === "chromium" ? { isMobile: true } : {}),
});

/* One page in one setup, watched until install, information and docs are all tappable or `until` ms of the page's
   clock have passed; then a tap on docs if it is tappable. Returns what was seen. */
const observe = async (label, query, until, mode = label) => {
  const ctx = await browser.newContext(phone());
  await ctx.addInitScript(INIT, [mode, COMPILE_MS, FROM, FIRST_MS]);
  const page = await ctx.newPage();
  const log = [], errors = [];
  page.on("console", (m) => log.push({ text: m.text(), at: Date.now() }));
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    progress(`${label}: opening ?${query}`);
    await page.goto(`${SITE}?${query}`, { waitUntil: "load" });
    const origin = await page.evaluate(() => performance.timeOrigin);
    const gl2 = await page.evaluate(() => !!document.createElement("canvas").getContext("webgl2"));
    const read = () => page.evaluate(() => ({ seen: window.__seen, fake: window.__fake, now: performance.now() }));
    let v = await read(), shown = "";
    while (v.now < until && !["install", "info", "docs"].every((k) => v.seen.hit[k] != null)) {
      const line = ["install", "info", "docs"].map((k) => `${k} ${s(v.seen.hit[k])}`).join(", ");
      if (line !== shown) { progress(`${label}: tappable: ${line} (page at ${s(v.now)})`); shown = line; }
      await sleep(400);
      v = await read();
    }
    progress(`${label}: tappable: ${["install", "info", "docs"].map((k) => `${k} ${s(v.seen.hit[k])}`).join(", ")} (page at ${s(v.now)})`);
    const tap = { tried: 0, opened: false, at: null, openedIn: null };
    if (v.seen.hit.docs != null) {
      for (let n = 0; n < 3 && !tap.opened; n++) {
        const point = await page.evaluate(() => window.__seen.point.docs);
        if (!point) { await sleep(300); continue; }
        tap.tried++;
        const at = Date.now();
        if (tap.at == null) tap.at = at - origin;
        progress(`${label}: tapping docs at ${point.map((x) => x.toFixed(0)).join(",")}`);
        await page.touchscreen.tap(point[0], point[1]);
        /* something must have started within 3 s (the address, or the flight's body classes); then the landing */
        const started = await page.waitForFunction(() => location.hash === "#docs" || /\b(arming|launching|showwarp|bare)\b/.test(document.body.className) ||
          !!document.querySelector("#docspad") && getComputedStyle(document.querySelector("#docspad")).display !== "none" && document.querySelector("#docspad").getBoundingClientRect().height > 0,
        null, { timeout: 3000 }).then(() => true, () => false);
        if (!started) continue;
        tap.opened = await page.locator("#docspad").waitFor({ state: "visible", timeout: 45000 }).then(() => true, () => false);
        if (tap.opened) tap.openedIn = Date.now() - at;
        break;
      }
    }
    const end = await read();
    const rel = (re) => { const m = log.find((l) => re.test(l.text)); return m ? m.at - origin : null; };
    return {
      gl2, seen: end.seen, fake: end.fake, tap, errors,
      galaxyAt: rel(/docs galaxy: shaders compiled/), galaxyLine: log.find((l) => /docs galaxy/.test(l.text))?.text,
      orbit: log.filter((l) => /orbit/.test(l.text)).map((l) => `${s(l.at - origin)} ${l.text.slice(0, 90)}`),
    };
  } finally { await ctx.close(); }
};

const others = (want, o, what) => {
  for (const [k, name] of [["install", "install"], ["info", "information"]]) {
    want(o.seen.hit[k] != null && o.seen.hit[k] <= OTHERS_BY_MS,
      `control (${what}): the ${name} planet was not labelled and tappable within ${OTHERS_BY_MS / 1000} s (first labelled ${s(o.seen.label[k])}, tappable ${s(o.seen.hit[k])}; a point on its hit area gave ${o.seen.before[k] ?? "nothing"}), so the harness has no working door to judge`);
  }
};
const opened = (want, o, run = "") => {
  want(o.tap.opened, run + (o.tap.tried
    ? `a tap on the docs planet (${o.tap.tried} tried, the first at ${s(o.tap.at)}) did not open the docs: #docspad not visible within 45 s`
    : "the docs planet was never tapped: it was never labelled and tappable"));
};
const noteRun = (want, o, run = "") => {
  want.note(`${run}labelled: ${["install", "info", "docs"].map((k) => `${k} ${s(o.seen.label[k])}`).join(", ")}; tappable: ${["install", "info", "docs"].map((k) => `${k} ${s(o.seen.hit[k])}`).join(", ")}; before docs was tappable a point on it gave ${o.seen.before.docs ?? "-"}; ${o.seen.samples} samples`);
  want.note(`${run}fake: ${JSON.stringify(o.fake)}; galaxy line ${o.galaxyLine ? `at ${s(o.galaxyAt)}: ${o.galaxyLine.slice(0, 80)}` : "never"}; tap: ${JSON.stringify(o.tap)}`);
  if (process.env.VERBOSE) for (const l of o.orbit) if (!/upload:/.test(l)) want.note(`${run}${l}`);
};
const needGl = (o) => { if (!o.gl2) throw new Error(`no WebGL2 in ${BROWSER} here (headed under Xvfb with software GL is needed): the live door is never drawn`); };

/* the docs planet's lateness hangs on how the page's queue of background work falls, which varies run to run on a
   shared host: D1 opens the page RUNS times (default 3) and every run must be in time */
const RUNS = Number(process.env.RUNS || 3);
const fastSetup = async () => {
  const runs = [];
  for (let n = 1; n <= RUNS; n++) runs.push(await observe(`fast ${n}/${RUNS}`, LIVE, 60000, "fast"));
  judge("D1", `faked background compiles (${RUNS} runs): docs labelled and tappable within ${D1_AFTER_MS / 1000} s of the later of install and information, and a tap opens it`, (want) => {
    runs.forEach((o, i) => {
      const run = `run ${i + 1}: `;
      needGl(o);
      noteRun(want, o, run);
      const later = Math.max(o.seen.hit.install ?? Infinity, o.seen.hit.info ?? Infinity);
      want(Number.isFinite(later), `${run}could not be judged: install or information never became tappable (see D1c)`);
      if (Number.isFinite(later)) {
        want(o.seen.hit.docs != null && o.seen.hit.docs <= later + D1_AFTER_MS,
          `${run}the docs planet was labelled and tappable at ${s(o.seen.hit.docs)}, ${o.seen.hit.docs == null ? "never" : s(o.seen.hit.docs - later)} after the later of install and information (${s(later)}); want no later than ${D1_AFTER_MS / 1000} s after (by ${s(later + D1_AFTER_MS)})`);
      }
      opened(want, o, run);
      want(!o.errors.length, `${run}page error: ${o.errors[0]}`);
    });
  });
  judge("D1c", `controls, faked background compiles (${RUNS} runs): install and information tappable; the faking took`, (want) => {
    runs.forEach((o, i) => {
      const run = `run ${i + 1}: `;
      needGl(o);
      others(want, o, `${run}fast`);
      want(o.fake.extGiven > 0, `control: ${run}the fake KHR_parallel_shader_compile was never handed out (getExtension) (${JSON.stringify(o.fake)}), so the fake is not what the page sees`);
      want(o.fake.polls > 0, `control: ${run}COMPLETION_STATUS_KHR was never polled (${JSON.stringify(o.fake)})`);
      want(o.fake.trues > 0, `control: ${run}no status ever turned true in the fast fake (${JSON.stringify(o.fake)})`);
    });
  });
};

const stuckSetup = async () => {
  const o = await observe("stuck", LIVE, Math.max(D2_BY_MS + 5000, OTHERS_BY_MS));
  judge("D2", `completion status stuck false: docs labelled and tappable within ${D2_BY_MS / 1000} s of the page opening, and a tap opens it`, (want) => {
    needGl(o);
    noteRun(want, o);
    want(o.seen.hit.docs != null && o.seen.hit.docs <= D2_BY_MS,
      `the docs planet was labelled and tappable at ${s(o.seen.hit.docs)} after the page opened (labelled ${s(o.seen.label.docs)}; a point on it gave ${o.seen.before.docs ?? "-"}); want by ${D2_BY_MS / 1000} s`);
    opened(want, o);
    want(!o.errors.length, `page error: ${o.errors[0]}`);
  });
  judge("D2c", "control, completion status stuck false: the faking took", (want) => {
    needGl(o);
    want(o.fake.extGiven > 0, `control: the fake KHR_parallel_shader_compile was never handed out (getExtension) (${JSON.stringify(o.fake)})`);
    want(o.fake.polls > 0, `control: COMPLETION_STATUS_KHR was never polled (${JSON.stringify(o.fake)})`);
    want(o.fake.trues === 0, `control: a status turned true in the stuck fake (${JSON.stringify(o.fake)})`);
  });
  judge("D2d", "control, completion status stuck false: install and information tappable (the spec's working door)", (want) => {
    needGl(o);
    others(want, o, "stuck");
  });
};

const plainSetup = async () => {
  const o = await observe("none", PLAIN, PLAIN_BY_MS + 10000);
  judge("C", `control, no faking (?${PLAIN}): every planet labelled and tappable within ${PLAIN_BY_MS / 1000} s, and a tap on docs opens it`, (want) => {
    noteRun(want, o);
    for (const k of ["install", "info", "docs"]) {
      want(o.seen.hit[k] != null && o.seen.hit[k] <= PLAIN_BY_MS, `control: the ${k} planet was labelled and tappable at ${s(o.seen.hit[k])} (labelled ${s(o.seen.label[k])}); want by ${PLAIN_BY_MS / 1000} s`);
    }
    opened(want, o);
    want(o.fake.polls === 0 && o.fake.extGiven === 0, `control: the unfaked page went through the fake (${JSON.stringify(o.fake)})`);
    want(!o.errors.length, `page error: ${o.errors[0]}`);
  });
};

try {
  await new Promise((ok, no) => {
    const start = Date.now();
    (async function poll() {
      try { await fetch(SITE); ok(); } catch { Date.now() - start > 10000 ? no(new Error("server did not start")) : setTimeout(poll, 100); }
    })();
  });
  browser = await playwright[BROWSER].launch(process.env.HEADED === "1" ? { headless: false } : {});
  /* one at a time: each is timed, and the host is shared */
  if (!ONLY.length || ONLY.includes("fast")) await fastSetup();
  if (!ONLY.length || ONLY.includes("stuck")) await stuckSetup();
  if (!ONLY.length || ONLY.includes("plain")) await plainSetup();
} catch (e) {
  console.log(`FAIL docs-planet-test: ${String(e.message || e).split("\n")[0]}`);
  results.push({ id: "setup", problems: [String(e.message || e)] });
} finally {
  clearTimeout(deadline);
  await browser?.close().catch(() => {});
  server.kill();
}

const bad = results.filter((r) => r.problems.length);
console.log(bad.length ? `\ndocs-planet-test: failed (${bad.map((r) => r.id).join(", ")})` : "\ndocs-planet-test: ok");
process.exit(bad.length ? 1 : 0);
