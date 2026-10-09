/*
 * Test for tools/docsky.cjs (issue #7): the docs' sky picture shows the
 * galaxy, not black. Renders to a scratch file, then measures it.
 *
 *   PLAYWRIGHT_ROOT=<playwright package dir> node tools/ci/docsky-test.mjs
 *
 * Checks: 3240x1080; mean luminance > 12 (0-255); at least 1% of pixels
 * brighter than 60. A hand-run tool's test, so not part of CI.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pwRoot = process.env.PLAYWRIGHT_ROOT;
const playwright = createRequire(import.meta.url)(pwRoot || "playwright");

const tmp = mkdtempSync(join(tmpdir(), "docsky-"));
const out = join(tmp, "sky.webp");
let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};

try {
  try {
    execFileSync(process.execPath, [join(root, "tools", "docsky.cjs"), "--out", out], {
      cwd: root,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, ...(pwRoot ? { NODE_PATH: dirname(pwRoot) } : {}) },
    });
  } catch (e) {
    check("docsky.cjs runs", false, e.message.split("\n")[0]);
  }

  let bytes = null;
  try { bytes = readFileSync(out); } catch { check("output written", false, `${out} missing`); }

  if (bytes) {
    const browser = await playwright.chromium.launch();
    try {
      const page = await browser.newPage();
      const m = await page.evaluate(async (b64) => {
        const img = new Image();
        await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error("image did not decode")); img.src = "data:image/webp;base64," + b64; });
        const c = document.createElement("canvas");
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const g = c.getContext("2d");
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let sum = 0, bright = 0;
        const n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) {
          const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          sum += l;
          if (l > 60) bright++;
        }
        return { w: img.naturalWidth, h: img.naturalHeight, mean: sum / n, brightPct: (100 * bright) / n };
      }, bytes.toString("base64"));
      check("size", m.w === 3240 && m.h === 1080, `${m.w}x${m.h} (want 3240x1080)`);
      check("mean luminance", m.mean > 12, `${m.mean.toFixed(2)} (want > 12)`);
      check("bright pixels", m.brightPct >= 1, `${m.brightPct.toFixed(2)}% brighter than 60 (want >= 1%)`);
    } finally {
      await browser.close();
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
