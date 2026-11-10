/*
 * Live test for #150, the flight's Earth (the sunrise and the clouds with depth, always drawn; nothing in the address
 * changes them), written from the issue's specification alone. A harness page (tests/draw.html) starts the climb pinned
 * at a moment of its own time (`at`), as tools/ci/draw-pixels-test.mjs does, one frame is drawn and read back, and the
 * picture is judged as a person would see it. The climb's pace is changed on its own (#151), so each look is required
 * at each of a few early moments (MOMENTS, ms into the climb) where the Earth still fills the lower screen, never at
 * one exact millisecond; each measure has a wide margin and none is a pixel-exact match.
 *
 *   E1  the sunrise: the sun sits low in the picture, near the middle, on the Earth's edge, and a thin level streak of
 *       light runs out from it to both sides: the row of the streak is brighter than the rows a few pixels above and
 *       below it (a thin line, not the Earth's own smooth glow), over the columns 200 to 450 px either side of the sun.
 *   E2  the clouds: on the lit Earth below the sun the light has light and shade, a patchwork of brighter and darker
 *       patches: the picture less its own blur, over a patch of the deck, spreads widely (its standard deviation) and
 *       has both a bright tail and a dark tail. A smooth haze has only the picture's grain there.
 *   E3  the address: nothing in the address changes the look or the clock. A source check, not a picture: no code the
 *       page loads from assets/js/main.js (followed through its imports and the draw worker) reads `look`, `slow` or
 *       `hold` from the address. (tests/draw.html passes only the flags it lists, so a picture of it could not tell
 *       `?look=0,0,0,0` from none, and the real page cannot be pinned at a moment.)
 *   E1 and E2 are each run under draw=page and under draw=worker. Controls, as in draw-pixels-test: the console says
 *   where the flight was drawn, the sun is found low and near the middle. On a failure the picture is kept in SHOTS_DIR
 *   (default ./shots).
 *
 *   PLAYWRIGHT_ROOT=<playwright package dir> node tools/ci/earth-look-test.mjs [E1 E2 E3 ...]
 *
 * SITE=<site root URL, ending in /> reads another site that is already being served, instead of serving this checkout
 * (the gate's own variable, tools/ci/live-run.mjs): a way to hold the measures up against another build. No default.
 * Chromium, headless, on SwiftShader (no display needed).
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
/* ms into the climb: the Earth fills the lower screen and the sun sits on its edge, as the climb is paced today and
   with room for it to move by a few hundred ms (the climb's first frame, at 0, is the door's still: no new look yet) */
const MOMENTS = [800, 1000, 1200];
/* the margins: the lowest value a good picture has at the lowest of the moments, over the highest a plain one has */
const STREAK_MIN = 8;      /* luma levels (0..255) the streak row stands above its neighbours, each side */
const CLOUD_SD_MIN = 3.5;  /* standard deviation of the picture less its blur over the deck */
const CLOUD_TAIL_MIN = 4;  /* the bright tail (95th percentile less the median) and the dark tail (median less the 5th) */

const server = process.env.SITE ? null : spawn(process.execPath, [join(here, "serve.mjs"), new URL(SITE).port], { stdio: ["ignore", "ignore", "inherit"] });
const results = [];
let browser = null;
const t0 = Date.now();
const progress = (msg) => console.log(`  .. ${((Date.now() - t0) / 1000).toFixed(0)}s ${msg}`);

const deadline = setTimeout(() => {
  console.log(`FAIL earth-look-test: the run's deadline (${DEADLINE_MS / 1000} s) passed`);
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

/* one climb on a fresh page, the picture of the canvases' box once a frame is marked drawn */
const shots = new Map();
const shoot = (mode, kind, at) => {
  const key = `${mode} ${kind} ${at}`;
  if (!shots.has(key)) shots.set(key, (async () => {
    progress(`${key}`);
    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
    const errors = [], said = [];
    try {
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => said.push(m.text()));
      await page.goto(`${SITE}tests/draw.html?${FLAGS}&draw=${mode}`, { waitUntil: "load" });
      await page.waitForFunction(() => window.drawReady === true, null, { timeout: 60000 });
      await page.evaluate(([k, a]) => window.show(k, a), [kind, at]);
      try { await page.waitForSelector("#warp[data-drawn]", { state: "attached", timeout: DRAWN_WAIT_MS }); }
      catch { throw new Error(`${key}: #warp[data-drawn] was not set within ${DRAWN_WAIT_MS / 1000} s of the flight being started, so no frame is known drawn${errors.length ? `; page error: ${errors[0]}` : ""}`); }
      /* the compositor has the frame: two of the page's own frames (a count, never a time) */
      await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
      const box = await page.evaluate(() => { const r = document.getElementById("warp").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
      const png = await page.screenshot({ type: "png", clip: box, timeout: 0 });
      return { png, errors, said, box };
    } finally { await ctx.close(); }
  })());
  return shots.get(key);
};

/* a picture measured, in a blank page of the same browser. Luma is 0.299 R + 0.587 G + 0.114 B. All the measures are
   means over small boxes (an integral image), so a star or a grain of noise does not decide one.
     sun     the brightest 15 x 15 box (the sun's glare is the brightest broad thing in the picture)
     streak  for the columns 200..450 px left of the sun and the same right: of the rows from 12 above to 6 below the
             sun's row, the one whose 3-row band, 9 px wide, stands highest over the mean of the bands 5-9 px above and
             6-10 px below it; the median of that over the columns (a smooth glow, even a curved one, gives about nothing)
     cloud   the deck is the patch 300 px either side of the sun, from 70 px below its row to the bottom: for every
             second pixel the 5 x 5 mean less the 33 x 33 mean (the picture less its own blur); its standard
             deviation, and the spread above and below its median */
const measure = async (png) => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    return await page.evaluate(async (b64) => {
      const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
      const w = img.naturalWidth, h = img.naturalHeight;
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, w, h).data;
      const S = new Float64Array((w + 1) * (h + 1));
      for (let y = 0; y < h; y++) {
        let row = 0;
        for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; row += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row; }
      }
      const box = (x0, y0, x1, y1) => {
        x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w, x1); y1 = Math.min(h, y1);
        return (S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] - S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
      };
      let best = -1, sx = 0, sy = 0;
      for (let y = 8; y < h - 8; y++) for (let x = 8; x < w - 8; x++) { const m = box(x - 7, y - 7, x + 8, y + 8); if (m > best) { best = m; sx = x; sy = y; } }
      const med = (a) => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };
      const flank = (x0, x1) => {
        const v = [];
        for (let x = x0; x < x1; x += 3) {
          let m = -1e9;
          for (let dy = -12; dy <= 6; dy++) m = Math.max(m, box(x - 4, sy + dy - 1, x + 5, sy + dy + 2) - (box(x - 4, sy + dy - 9, x + 5, sy + dy - 5) + box(x - 4, sy + dy + 6, x + 5, sy + dy + 10)) / 2);
          v.push(m);
        }
        return med(v);
      };
      const v = [];
      for (let y = sy + 70; y < h - 4; y += 2) for (let x = sx - 300; x < sx + 300; x += 2) v.push(box(x - 2, y - 2, x + 3, y + 3) - box(x - 16, y - 16, x + 17, y + 17));
      v.sort((p, q) => p - q);
      const q = (f) => v[Math.floor(f * (v.length - 1))];
      const mean = v.reduce((a, b) => a + b, 0) / (v.length || 1);
      return {
        w, h, sx, sy, glare: best,
        left: flank(sx - 450, sx - 200), right: flank(sx + 200, sx + 450),
        cloudN: v.length, cloudSd: Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length || 1)),
        cloudBright: q(0.95) - q(0.5), cloudDark: q(0.5) - q(0.05),
      };
    }, png.toString("base64"));
  } finally { await ctx.close(); }
};
const measured = new Map();
const look = (mode, at) => {
  const key = `${mode} ${at}`;
  if (!measured.has(key)) measured.set(key, shoot(mode, "up", at).then(async (s) => ({ ...s, m: await measure(s.png) })));
  return measured.get(key);
};

const keep = (name, png) => {
  mkdirSync(SHOTS_DIR, { recursive: true });
  writeFileSync(join(SHOTS_DIR, `earth-${name}.png`), png);
  return `${SHOTS_DIR}/earth-${name}.png`;
};
const f = (n) => (Number.isFinite(n) ? n.toFixed(1) : String(n));

/* the controls common to both looks, for one picture */
const controls = (want, mode, at, s) => {
  const [id, m] = [`${mode} at ${at}`, s.m];
  want(!s.errors.length, `${id}: page error: ${s.errors[0]}`);
  if (mode === "worker") {
    want(s.said.some((l) => /flight: drawn in a worker/.test(l)), `${id}: control: the console never said "flight: drawn in a worker" (it said ${JSON.stringify(s.said.filter((l) => /flight: drawn/.test(l)))}), so the worker may not have drawn this`);
    want(!s.said.some((l) => /flight: drawn on the page/.test(l)), `${id}: control: the flight was also drawn on the page, a fallback`);
  } else want(s.said.some((l) => /flight: drawn on the page/.test(l)), `${id}: control: the console never said "flight: drawn on the page"`);
  want(m.sy > m.h * 0.6 && Math.abs(m.sx - m.w / 2) < m.w * 0.15, `${id}: control: the brightest broad spot is at (${m.sx}, ${m.sy}) of ${m.w}x${m.h}, not low and near the middle where the sun is on the Earth's edge`);
};

const sunrise = (mode) => judge(`E1${mode[0]}`, `the sunrise under draw=${mode}: a thin level streak of light runs out from the sun on the Earth's edge`, async (want) => {
  for (const at of MOMENTS) {
    const s = await look(mode, at), m = s.m;
    controls(want, mode, at, s);
    const ok = m.left >= STREAK_MIN && m.right >= STREAK_MIN;
    want(ok, `at ${at}: no level streak through the sun at (${m.sx}, ${m.sy}): its row stands ${f(m.left)} (left) and ${f(m.right)} (right) levels over the rows beside it, ${STREAK_MIN} wanted each side${ok ? "" : ` (kept in ${keep(`${mode}-${at}`, s.png)})`}`);
    want.note(`${at}: sun (${m.sx}, ${m.sy}), streak left ${f(m.left)} right ${f(m.right)}`);
  }
});

const clouds = (mode) => judge(`E2${mode[0]}`, `the clouds under draw=${mode}: the sunlit deck has light and shade`, async (want) => {
  for (const at of MOMENTS) {
    const s = await look(mode, at), m = s.m;
    controls(want, mode, at, s);
    want(m.cloudN > 1000, `at ${at}: control: only ${m.cloudN} samples of the deck, below the sun at (${m.sx}, ${m.sy}), so it is not judged`);
    const ok = m.cloudSd >= CLOUD_SD_MIN && m.cloudBright >= CLOUD_TAIL_MIN && m.cloudDark >= CLOUD_TAIL_MIN;
    want(ok, `at ${at}: the deck below the sun is smooth haze: spread ${f(m.cloudSd)} (${CLOUD_SD_MIN} wanted), bright tail ${f(m.cloudBright)}, dark tail ${f(m.cloudDark)} (${CLOUD_TAIL_MIN} wanted each)${ok ? "" : ` (kept in ${keep(`${mode}-${at}`, s.png)})`}`);
    want.note(`${at}: spread ${f(m.cloudSd)}, bright tail ${f(m.cloudBright)}, dark tail ${f(m.cloudDark)}`);
  }
});

/* every file the page loads from its entry, by the paths its code names: import ... from "./x.js", import("./x.js"),
   new URL("./x.js", import.meta.url), new Worker(...) naming a ./x.js; read from the site being tested */
const SOURCE_ENTRY = "assets/js/main.js";
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const readsAddress = /\[\?&\]\s*(?:look|slow|hold)\b|[?&](?:look|slow|hold)=|(?:get|has)\(\s*["'](?:look|slow|hold)["']/;
const sources = async () => {
  const seen = new Map(), queue = [SOURCE_ENTRY];
  while (queue.length) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    const res = await fetch(new URL(path, SITE));
    if (!res.ok) { seen.set(path, null); continue; }
    const code = await res.text();
    seen.set(path, code);
    for (const m of stripComments(code).matchAll(/["'`](\.{1,2}\/[^"'`\s]+?\.js)["'`]/g)) {
      const next = new URL(m[1], new URL(path, SITE)).pathname.replace(/^\//, "");
      if (!seen.has(next)) queue.push(next);
    }
  }
  return seen;
};

const run = async () => {
  if (wanted("E1")) { await sunrise("page"); await sunrise("worker"); }
  if (wanted("E2")) { await clouds("page"); await clouds("worker"); }
  if (wanted("E3")) {
    await judge("E3", "the address changes nothing: no code the page loads reads look, slow or hold from it", async (want) => {
      const seen = await sources();
      want(seen.size >= 10, `control: only ${seen.size} files were reached from ${SOURCE_ENTRY} (${[...seen.keys()].join(", ")}), so the search cannot say nothing reads the address`);
      want(seen.get(SOURCE_ENTRY) !== null && !!seen.get(SOURCE_ENTRY), `control: ${SOURCE_ENTRY} was not served`);
      want([...seen.values()].some((c) => c && /location\.search/.test(c)), "control: no file reaches location.search, so the pattern is not looking at the address");
      for (const [path, code] of seen) {
        const hit = code && stripComments(code).match(readsAddress);
        want(!hit, `${path} reads ${JSON.stringify(hit?.[0])} from the address`);
      }
      want.note(`${seen.size} files read`);
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
  /* its own, headless, on SwiftShader (as draw-pixels-test): the job's shared browser is headed and plain */
  browser = await openBrowser(playwright, "chromium", { own: true, launch: { headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });
  await run();
} catch (e) {
  console.log(`FAIL earth-look-test: ${String(e.message || e).split("\n")[0]}`);
  results.push({ id: "setup", problems: [String(e.message || e)] });
} finally {
  clearTimeout(deadline);
  await browser?.close().catch(() => {});
  server?.kill();
}

const bad = results.filter((r) => r.problems.length);
console.log(bad.length ? `\nearth-look-test: failed (${bad.map((r) => r.id).join(", ")})` : "\nearth-look-test: ok");
process.exit(bad.length ? 1 : 0);
