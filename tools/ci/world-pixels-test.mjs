/*
 * Live test for #93 batch 3, the proof (ADR-0004 6b.7, PW2), written from the specification alone: the install's world
 * drawn in a worker is pixel for pixel the install's world drawn on the page. A harness page (tests/world.html) makes
 * the install's world as the host makes it (createInstall on a pad, with the flags the address gives) and draws one
 * frame of the shot, still(k, idle): the shot at k with the clock fixed at idle, so the grain and the motes (uTime's)
 * are the same every time. Each frame is drawn on a fresh page under `?draw=page` and again under `?draw=worker`, a
 * picture taken of the canvas's box once `.orbitgl[data-drawn]` is set (the mark that a frame has been drawn: the
 * page path sets it at once, and the worker path when the worker says `drew`) and the two pictures compared pixel for
 * pixel. Nothing here is judged by time: the waits end on the mark, and the bounds (DRAWN_WAIT_MS, DEADLINE_MS) are
 * only against a hang.
 *
 *   PW2a  still(0.3, 7): no pixel differs
 *   PW2b  still(1, 7): no pixel differs
 *   PW2c  control: draw=page at k 0.3 against 0.6 differ, so the comparison can fail
 *
 * Each pair also has its own controls, so a case cannot pass for nothing: under draw=worker the console says `install:
 * drawn in a worker` (not the page's fallback), under draw=page `install: drawn on the page`, and the picture is not
 * blank. On a failure the count of differing pixels is printed, and the page's picture, the worker's and a diff
 * picture (the differing pixels in red over the page's, dimmed) are written to SHOTS_DIR (default ./shots, which the
 * live:chromium job keeps as an artifact).
 *
 * The software GL draws the same commands the same way on either thread, so none of this depends on the runner's
 * speed. If the two ever differ between contexts without a fault, the test says so and the owner decides a tolerance;
 * it is never loosened here.
 *
 *   PLAYWRIGHT_ROOT=<playwright package dir> node tools/ci/world-pixels-test.mjs [PW2a PW2b ...]
 *
 * Chromium, headless, on SwiftShader (no display needed). Edge is looked at by hand on the owner's machine.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { freePort, openBrowser } from "./live-lib.mjs";

const playwright = createRequire(import.meta.url)(process.env.PLAYWRIGHT_ROOT || "playwright");
const DEADLINE_MS = Number(process.env.DEADLINE_MS || 15 * 60e3);
const DRAWN_WAIT_MS = Number(process.env.DRAWN_WAIT_MS || 45e3);
const SHOTS_DIR = process.env.SHOTS_DIR || "shots";
const ONLY = process.argv.slice(2);
/* the gate's one server when SITE is given (tools/ci/live-run.mjs), else our own on a free port */
const SITE = process.env.SITE || `http://127.0.0.1:${await freePort()}/`;
const here = dirname(fileURLToPath(import.meta.url));
const VIEW = { width: 1280, height: 800 };
const FLAGS = "gpu=force&fit=skip";
const server = process.env.SITE ? null : spawn(process.execPath, [join(here, "serve.mjs"), new URL(SITE).port], { stdio: ["ignore", "ignore", "inherit"] });
const results = [];
let browser = null;
const t0 = Date.now();
const progress = (msg) => console.log(`  .. ${((Date.now() - t0) / 1000).toFixed(0)}s ${msg}`);

const deadline = setTimeout(() => {
  console.log(`FAIL world-pixels-test: the run's deadline (${DEADLINE_MS / 1000} s) passed`);
  browser?.close().catch(() => {});
  server?.kill();
  process.exit(1);
}, DEADLINE_MS);

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

/* one frame of the shot on a fresh page, the picture of the canvas's box once the frame is marked drawn */
const shots = new Map();
const shoot = (mode, k, idle) => {
  const key = `${mode} k=${k} idle=${idle}`;
  if (!shots.has(key)) shots.set(key, (async () => {
    progress(`${key}`);
    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
    const errors = [], said = [];
    try {
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => said.push(m.text()));
      await page.goto(`${SITE}tests/world.html?${FLAGS}&draw=${mode}`, { waitUntil: "load" });
      await page.waitForFunction(() => window.worldReady === true, null, { timeout: 60000 });
      const made = await page.evaluate(([k0, i0]) => window.still(k0, i0), [k, idle]);
      if (made !== true) throw new Error(`${key}: still() answered ${JSON.stringify(made)}, so the world was not made${errors.length ? `; page error: ${errors[0]}` : ""}${said.length ? `; the console said ${JSON.stringify(said.filter((l) => /install/.test(l)).slice(0, 4))}` : ""}`);
      try { await page.waitForSelector(".orbitgl[data-drawn]", { state: "attached", timeout: DRAWN_WAIT_MS }); }
      catch { throw new Error(`${key}: .orbitgl[data-drawn] was not set within ${DRAWN_WAIT_MS / 1000} s of the frame being asked for, so no frame is known drawn${errors.length ? `; page error: ${errors[0]}` : ""}`); }
      /* the compositor has the frame: three of the page's own frames (a count, never a time) */
      await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(ok)))));
      const box = await page.evaluate(() => { const r = document.querySelector(".orbitgl").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
      const png = await page.screenshot({ type: "png", clip: box, timeout: 0 });
      return { png, errors, said, box };
    } finally { await ctx.close(); }
  })());
  return shots.get(key);
};

/* two pictures compared pixel for pixel, in a blank page of the same browser: how many differ, how many are lit, and a diff picture */
const compare = async (a, b) => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    return await page.evaluate(async ([pa, pb]) => {
      const load = async (b64) => { const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode(); return img; };
      const [ia, ib] = [await load(pa), await load(pb)];
      const w = Math.max(ia.naturalWidth, ib.naturalWidth), h = Math.max(ia.naturalHeight, ib.naturalHeight);
      const read = (img) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0); return g.getImageData(0, 0, w, h); };
      const [da, db] = [read(ia), read(ib)];
      const out = new ImageData(w, h);
      let differ = 0, lit = 0;
      for (let i = 0; i < w * h * 4; i += 4) {
        if (da.data[i] || da.data[i + 1] || da.data[i + 2]) lit++;
        const same = da.data[i] === db.data[i] && da.data[i + 1] === db.data[i + 1] && da.data[i + 2] === db.data[i + 2] && da.data[i + 3] === db.data[i + 3];
        if (same) { out.data[i] = da.data[i] >> 2; out.data[i + 1] = da.data[i + 1] >> 2; out.data[i + 2] = da.data[i + 2] >> 2; }
        else { differ++; out.data[i] = 255; }
        out.data[i + 3] = 255;
      }
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").putImageData(out, 0, 0);
      return { w, h, same: ia.naturalWidth === ib.naturalWidth && ia.naturalHeight === ib.naturalHeight, differ, lit, diff: c.toDataURL("image/png").split(",")[1] };
    }, [a.toString("base64"), b.toString("base64")]);
  } finally { await ctx.close(); }
};

const keep = (name, files) => {
  mkdirSync(SHOTS_DIR, { recursive: true });
  for (const [suffix, png] of Object.entries(files)) writeFileSync(join(SHOTS_DIR, `world-${name}-${suffix}.png`), png);
  return SHOTS_DIR;
};

/* a frame under both paths: the controls, then no pixel differs */
const pair = (id, name, k, idle) => judge(id, name, async (want) => {
  const [page, worker] = [await shoot("page", k, idle), await shoot("worker", k, idle)];
  want(worker.said.some((l) => /install: drawn in a worker/.test(l)), `control: under draw=worker the console never said "install: drawn in a worker" (it said ${JSON.stringify(worker.said.filter((l) => /install: drawn/.test(l)))}), so the worker may not have drawn this`);
  want(page.said.some((l) => /install: drawn on the page/.test(l)), `control: under draw=page the console never said "install: drawn on the page" (it said ${JSON.stringify(page.said.filter((l) => /install: drawn/.test(l)))})`);
  want(!worker.said.some((l) => /install: drawn on the page/.test(l)), `control: under draw=worker the console also said the world was drawn on the page (${worker.said.find((l) => /install: drawn on the page/.test(l))}), a fallback`);
  want(!page.errors.length && !worker.errors.length, `page error: ${page.errors[0] || worker.errors[0]}`);
  const r = await compare(page.png, worker.png);
  want(r.same, `the two pictures are different sizes (${r.w}x${r.h} is the larger): the canvas's box differs`);
  want(r.lit > 0, "control: the page path's picture is black, so nothing was drawn to compare");
  want(r.differ === 0, `${r.differ} of ${r.w * r.h} pixels differ between draw=page and draw=worker (kept in ${r.differ ? keep(id, { page: page.png, worker: worker.png, diff: Buffer.from(r.diff, "base64") }) : SHOTS_DIR}: world-${id}-page.png, -worker.png, -diff.png)`);
  want.note(`${r.w}x${r.h}, ${r.lit} lit pixels, ${r.differ} differ`);
});

const run = async () => {
  if (wanted("PW2a")) await pair("PW2a", "still(0.3, 7): the worker's picture is the page's, pixel for pixel", 0.3, 7);
  if (wanted("PW2b")) await pair("PW2b", "still(1, 7): the worker's picture is the page's, pixel for pixel", 1, 7);
  if (wanted("PW2c")) {
    await judge("PW2c", "control: draw=page at k 0.3 and at 0.6 differ, so the comparison can fail", async (want) => {
      const [a, b] = [await shoot("page", 0.3, 7), await shoot("page", 0.6, 7)];
      const r = await compare(a.png, b.png);
      want(r.differ > 0, "the page's world at k 0.3 and at 0.6 are the same picture, so a comparison of two pictures here could not fail");
      want.note(`${r.differ} of ${r.w * r.h} pixels differ`);
    });
  }
};

try {
  await new Promise((ok, no) => {
    const start = Date.now();
    (async function poll() {
      try { await fetch(SITE); ok(); } catch { Date.now() - start > 10000 ? no(new Error("server did not start")) : setTimeout(poll, 100); }
    })();
  });
  /* its own, headless, on SwiftShader (as the other Chromium tests with their own flags): the job's shared browser is headed and plain */
  browser = await openBrowser(playwright, "chromium", { own: true, launch: { headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });
  await run();
} catch (e) {
  console.log(`FAIL world-pixels-test: ${String(e.message || e).split("\n")[0]}`);
  results.push({ id: "setup", problems: [String(e.message || e)] });
} finally {
  clearTimeout(deadline);
  await browser?.close().catch(() => {});
  server?.kill();
}

const bad = results.filter((r) => r.problems.length);
console.log(bad.length ? `\nworld-pixels-test: failed (${bad.map((r) => r.id).join(", ")})` : "\nworld-pixels-test: ok");
process.exit(bad.length ? 1 : 0);
