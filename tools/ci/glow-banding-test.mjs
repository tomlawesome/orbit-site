/*
 * Test for the door's glow pictures (#22, "dither the door's glow pictures, as Orbit does"), written from the issue's
 * specification and Orbit's own check (web/tests/fidelity/flight-glow-banding.spec.js, ai/orbit#1314).
 *
 * The glows are faint (the dusk's peaks at 14/255 opacity). Drawn into 8 bits without dither, a picture holds a
 * dozen or so opacity steps across the sky, and on the sign-out each step shows as a stripe. Orbit imports
 * assets/door/ unchanged, so the site's pictures must be dithered as Orbit's are (tools/glows.cjs).
 *
 * The metric is Orbit's: the share of 16-pixel horizontal runs (every second row), among those the glow reaches
 * (some opacity above 0), whose opacity is identical all along. A stripe is flat for its whole width; a dithered
 * gradient seldom is. The pixels are tested, not the file format: lossy WebP smooths a dither back into stripes,
 * so a picture may need a lossless encoding to pass.
 *
 * Each ceiling sits between the banded pictures' share and the dithered ones' (Orbit's ceilings; the site's names
 * map as Orbit's door/ = the site's dawn/). Measured 2026-10-10 by this script's metric:
 *
 *                      site, undithered (lossy)   Orbit, dithered (lossless)   ceiling
 *   dawn/glow-zod              0.202                     0.024                  0.1
 *   dusk/glow-glow             0.659                     0.169                  0.4
 *   dusk/glow-belt             0.931                     0.617                  0.8   (its source saturates past 4x)
 *   dusk/glow-afterglow        0.348                     0.131                  0.25
 *
 * The dawn's rays and sun point (sway1, sway2, sunpt) and the dusk's thin rim are not measured: their 8-bit
 * pictures were never flat. They must still be there.
 *
 *   node tools/ci/glow-banding-test.mjs
 *
 * Needs sharp: `npm ci --prefix tools --ignore-scripts` (the version is pinned in tools/package.json).
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const IMG = join(root, "assets/door/img");

let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};

let sharp;
try { sharp = createRequire(join(root, "tools/"))("sharp"); } catch (e) {
  console.log(`FAIL sharp is installed: ${e.message.split("\n")[0]} (run: npm ci --prefix tools --ignore-scripts)`);
  process.exit(1);
}

/* the ceilings, by picture (see the table above) */
const CEILINGS = {
  "dawn/glow-zod.webp": 0.1,
  "dusk/glow-glow.webp": 0.4,
  "dusk/glow-belt.webp": 0.8,
  "dusk/glow-afterglow.webp": 0.25,
};
/* every glow the door draws from: all must be there */
const ALL = [...Object.keys(CEILINGS), "dawn/glow-sunpt.webp", "dawn/glow-sway1.webp", "dawn/glow-sway2.webp", "dusk/glow-rim.webp"];

for (const picture of ALL) check(`${picture} exists`, existsSync(join(IMG, picture)), join("assets/door/img", picture));

/* the share of 16-pixel runs, among those the glow reaches, that are flat in opacity */
async function flatShare(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let runs = 0, flatRuns = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x + 16 <= width; x += 16) {
      let lo = 255, hi = 0;
      for (let i = 0; i < 16; i++) {
        const a = data[(y * width + x + i) * channels + 3];
        lo = Math.min(lo, a);
        hi = Math.max(hi, a);
      }
      if (hi === 0) continue;
      runs++;
      if (lo === hi) flatRuns++;
    }
  }
  return { share: runs ? flatRuns / runs : NaN, runs, width, height };
}

for (const [picture, ceiling] of Object.entries(CEILINGS)) {
  const file = join(IMG, picture);
  if (!existsSync(file)) continue;
  const { share, runs, width, height } = await flatShare(file);
  check(`${picture} is dithered, not striped`, runs > 0 && share < ceiling,
    `${share.toFixed(3)} of ${runs} runs are flat (${width}x${height}); want under ${ceiling}`);
}

process.exit(failed ? 1 : 0);
