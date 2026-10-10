/*
 * In the gate (live:journey, under Xvfb) and by hand: does the band upload do the right thing in each browser? Checks that cropHonoured(gl)
 * (assets/door/upload.js) agrees with a direct measurement of whether the browser's WebGL honours an ImageBitmap's
 * crop on upload, and that a picture put on in bands matches the same picture put on whole, byte for byte
 * (tests/crop.html runs both and writes JSON to document.title). Chromium headless; Firefox headed, since it has
 * no WebGL headless here.
 *
 *   PLAYWRIGHT_ROOT=<playwright package dir> LIBGL_ALWAYS_SOFTWARE=1 \
 *     xvfb-run -a -s "-screen 0 1280x720x24" node tools/ci/upload-test.mjs
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const playwright = createRequire(import.meta.url)(process.env.PLAYWRIGHT_ROOT || "playwright");
const PORT = 8793;
const SITE = `http://127.0.0.1:${PORT}/`;
const here = dirname(fileURLToPath(import.meta.url));

const server = spawn(process.execPath, [join(here, "serve.mjs"), String(PORT)], { stdio: ["ignore", "ignore", "inherit"] });
let failed = false;
try {
  await new Promise((ok, no) => {
    const t0 = Date.now();
    (async function poll() {
      try { await fetch(SITE); ok(); } catch { Date.now() - t0 > 10000 ? no(new Error("server did not start")) : setTimeout(poll, 100); }
    })();
  });

  for (const [name, headless] of [["chromium", true], ["firefox", false]]) {
    const problems = [];
    let result = null;
    let browser = null;
    try {
      browser = await playwright[name].launch({ headless });
      const page = await (await browser.newContext()).newPage();
      page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
      await page.goto(`${SITE}tests/crop.html`, { waitUntil: "load" });
      await page.waitForFunction(() => document.title.startsWith("{"), null, { timeout: 120000 });
      result = JSON.parse(await page.title());
    } catch (e) { problems.push(`${name}: ${e.message.split("\n")[0]}`); }
    await browser?.close().catch(() => {});

    if (result) {
      if (result.error) problems.push(`page error: ${result.error}`);
      if (result.probe !== result.direct) problems.push(`probe ${result.probe} but direct ${result.direct}`);
      const lines = result.bands || [];
      const rx = /level 0: 0 bytes differ of \d+; level 2 \([^)]*\): 0 of \d+/;
      for (const label of ["RGBA8", "SRGB8_ALPHA8"]) {
        const l = lines.find((x) => x.startsWith(`${label} `));
        if (!l) problems.push(`no ${label} line in upload-bands result: ${JSON.stringify(lines)}`);
        else if (!rx.test(l)) problems.push(`${label}: banded and whole differ: ${l}`);
      }
    }
    console.log(`${problems.length ? "FAIL" : "ok  "} ${name}: direct=${result?.direct} probe=${result?.probe} pixels=${JSON.stringify(result?.pixels)}`);
    for (const l of result?.bands || []) console.log(`       ${l}`);
    for (const p of problems) console.log(`       problem: ${p}`);
    if (problems.length) failed = true;
  }
} finally {
  server.kill();
}
process.exit(failed ? 1 : 0);
