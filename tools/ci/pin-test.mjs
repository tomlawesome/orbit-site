/*
 * Live test for #23 ("a host can pin the journey at a moment"), written from the issue's specification alone.
 *
 * journey.fly(profile, { at }) and journey.descend({ at }) take `at`, milliseconds into the journey, and start there:
 * the beats before `at` count as already passed. tests/pin.html makes a door and a journey through
 * assets/door/index.js alone, starts one and reports when each hook fired and each body class first showed
 * (assets/door/timeline.js has the beats). Unpinned, the ascent lands (hook `land`, class `bare`) 4800 ms in and the
 * descent's farewell comes 5350 ms in; pinned past them, they must arrive at once, with a control showing that,
 * without `at`, they have not arrived by 2.5 s. Timing margins are wide: a shared runner is slow, and the gap
 * between "at once" and "unpinned" is over a second on either side of the limits used here.
 *
 *   PLAYWRIGHT_ROOT=<playwright package dir> HEADED=1 LIBGL_ALWAYS_SOFTWARE=1 \
 *     xvfb-run -a -s "-screen 0 1280x800x24" node tools/ci/pin-test.mjs
 *
 * (sh tools/ci/journey-local.sh pin does exactly that.) BROWSER=chromium for a second engine; HEADED=1 as the other
 * live tests: Firefox has no WebGL headless here.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const playwright = createRequire(import.meta.url)(process.env.PLAYWRIGHT_ROOT || "playwright");
const BROWSER = process.env.BROWSER || "firefox";
const PORT = 8794;
const SITE = `http://127.0.0.1:${PORT}/`;
const here = dirname(fileURLToPath(import.meta.url));

/* how long a pinned journey may take to show what is already past, and how long an unpinned one is watched for what
   must not be there yet (a control); the unpinned effects come at 4.8 s and 5.35 s */
const SOON = 3500;
const CONTROL = 2500;

const server = spawn(process.execPath, [join(here, "serve.mjs"), String(PORT)], { stdio: ["ignore", "ignore", "inherit"] });
let failed = false;
let browser = null;
try {
  await new Promise((ok, no) => {
    const t0 = Date.now();
    (async function poll() {
      try { await fetch(SITE); ok(); } catch { Date.now() - t0 > 10000 ? no(new Error("server did not start")) : setTimeout(poll, 100); }
    })();
  });
  browser = await playwright[BROWSER].launch(process.env.HEADED === "1" ? { headless: false } : {});
  /* motion left on: reduced motion plays another, shorter set of beats */
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });

  /* each scenario on a fresh page, so no journey inherits another's state */
  const run = async (mode, at, watch) => {
    const page = await ctx.newPage();
    const problems = [];
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    try {
      await page.goto(`${SITE}tests/pin.html`, { waitUntil: "load" });
      await page.waitForFunction(() => window.pinReady, null, { timeout: 30000 });
      const r = await page.evaluate(([m, a, w]) => window.pin(m, a ?? undefined, w), [mode, at ?? null, watch]);
      return { r, problems };
    } finally { await page.close(); }
  };

  const scenarios = [
    /* name, mode, at, watch, what must be so: [what, test(result)] pairs */
    ["fly pinned at 5000 (past the landing)", "fly", 5000, SOON, [
      ["the release hook has fired (a beat before the pin)", (r) => r.hooks.release !== undefined],
      ["the land hook has fired", (r) => r.hooks.land !== undefined && r.hooks.land < SOON],
      ["the body has class bare", (r) => r.classes.bare !== undefined && r.classes.bare < SOON && r.now.includes("bare")],
      /* the land beat takes the flight's canvas off as it bares the page, so a pin past it shows no showwarp */
      ["the flight's canvas is off again (no class showwarp)", (r) => !r.now.includes("showwarp")],
    ]],
    ["fly unpinned (control)", "fly", undefined, CONTROL, [
      ["the land hook has not fired", (r) => r.hooks.land === undefined],
      ["the body has not got class bare", (r) => r.classes.bare === undefined && !r.now.includes("bare")],
    ]],
    ["fly pinned at 3000 (before the landing)", "fly", 3000, 1000, [
      ["the release hook has fired", (r) => r.hooks.release !== undefined],
      ["the land hook has not fired: the landing is not skipped", (r) => r.hooks.land === undefined],
      ["the body has not got class bare", (r) => !r.now.includes("bare")],
    ]],
    ["descend pinned at 5400 (past the farewell)", "descend", 5400, SOON, [
      ["the released hook has fired (a beat before the pin)", (r) => r.hooks.released !== undefined],
      ["the surface hook has fired (the dusk came up)", (r) => r.hooks.surface !== undefined],
      ["the farewell hook has fired", (r) => r.hooks.farewell !== undefined && r.hooks.farewell < SOON],
      ["the body has class farewell", (r) => r.classes.farewell !== undefined && r.classes.farewell < SOON && r.now.includes("farewell")],
      ["the body has class showdusk", (r) => r.now.includes("showdusk")],
    ]],
    ["descend unpinned (control)", "descend", undefined, CONTROL, [
      ["the farewell hook has not fired", (r) => r.hooks.farewell === undefined],
      ["the body has not got class farewell", (r) => r.classes.farewell === undefined && !r.now.includes("farewell")],
      ["the surface hook has not fired", (r) => r.hooks.surface === undefined],
    ]],
    ["descend pinned at 3700 (past the dusk, before the farewell)", "descend", 3700, 1000, [
      ["the surface hook has fired", (r) => r.hooks.surface !== undefined],
      ["the body has class showdusk", (r) => r.now.includes("showdusk")],
      ["the farewell hook has not fired: it is still to come", (r) => r.hooks.farewell === undefined],
    ]],
  ];

  for (const [name, mode, at, watch, wants] of scenarios) {
    let got = null;
    const problems = [];
    try {
      got = await run(mode, at, watch);
      problems.push(...got.problems);
    } catch (e) { problems.push(`${e.message.split("\n")[0]}`); }
    const r = got?.r;
    if (r) {
      if (r.error) problems.push(`the call threw: ${r.error}`);
      if (r.reduced) problems.push("the journey is in reduced motion, so these beats are not the ones under test");
      for (const [what, test] of wants) if (!test(r)) problems.push(`want: ${what} -- it is not so`);
    }
    console.log(`${problems.length ? "FAIL" : "ok  "} ${name}`);
    if (r) console.log(`       hooks ${JSON.stringify(r.hooks)}; classes first seen ${JSON.stringify(r.classes)}; at the end ${JSON.stringify(r.now)} (ms from the call)`);
    for (const p of problems) console.log(`       problem: ${p}`);
    if (problems.length) failed = true;
  }
} catch (e) {
  console.log(`FAIL pin test: ${e.message.split("\n")[0]}`);
  failed = true;
} finally {
  await browser?.close().catch(() => {});
  server.kill();
}
process.exit(failed ? 1 : 0);
