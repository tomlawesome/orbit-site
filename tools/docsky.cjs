#!/usr/bin/env node
/*
 * The docs' sky: the Milky Way behind the chart, as the docs' flight comes to rest in it.
 *
 * The flight (voyage.js, engine.js: milkyWay) ends inside the galaxy's disc looking at its core, the band
 * across the sky; this draws that last frame once, with no constellations on it, so the page the flight
 * fades into wears the very sky the flight arrived in.
 *
 *   NODE_PATH=$(npm root -g) node tools/docsky.cjs [--tall] [--out <path>]     (needs playwright)
 *   → assets/img/docs/milkyway-sky.webp, or with --tall milkyway-sky-tall.webp (the portrait screens' sky: the flight
 *     rests further out there, the whole spiral filling the height, engine.js: PATH_TALL), or <path>
 */
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const { localServer } = require("./local-server.cjs");
const root = path.resolve(__dirname, "..");
const types = { ".html": "text/html", ".js": "text/javascript", ".webp": "image/webp", ".png": "image/png" };
const page = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}canvas{position:fixed;inset:0;width:100vw;height:100vh}</style>
<canvas id="c"></canvas><script type="module">
import { createDoor, openChores } from "./assets/door/index.js";
import { docsFlight } from "./assets/js/journeys.js";
createDoor({ image: (p) => "assets/door/img/" + p, flags: { gpu: "force", fit: "skip" } });
openChores();
const { createFlight } = await import("./assets/door/index.js");
const e = createFlight(document.getElementById("c"));
/* the docs' galaxy is warmed on its own, after the flight (voyage.js: warmDocs); warm() alone leaves it undrawn and
   the picture black (#7) */
await e.warmDocs();
const P = docsFlight({ rect: { x: 0, y: 0, w: innerWidth, h: innerHeight }, geometry: { W: 1600, H: 900, field: { dots: [], arcs: [] }, cons: [] } });
window.draw = () => { e.start(P, { at: 4790 }); return true; };
window.ready = true;
</script>`;
/* (served on this machine only, nothing outside the repository: local-server.cjs, #37) */
localServer({ root, page, types }).then(async ({ server: srv, url: home }) => {
  const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  /* the flight's galaxy is scaled to the screen's height (its width shows more or less of the sky), so the picture is
     made wide (3:1), and the page sets it to the screen's height: the same sky at any shape of window. The tall one is
     drawn at the widest portrait shape (10:11, the site's threshold, where the flight takes its portrait rest), so every
     portrait screen sees its middle at the screen's height */
  const tall = process.argv.includes("--tall");
  const pg = await b.newPage({ viewport: tall ? { width: 980, height: 1080 } : { width: 3240, height: 1080 } });
  await pg.goto(home);
  await pg.waitForFunction(() => window.ready, null, { timeout: 120000 });
  await pg.evaluate(() => window.draw());
  await pg.waitForTimeout(500);
  const shot = await pg.screenshot({ type: "png", timeout: 0 });
  /* to webp through the browser itself */
  const url = await pg.evaluate(async (b64) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; c.getContext("2d").drawImage(img, 0, 0);
    return c.toDataURL("image/webp", 0.86);
  }, shot.toString("base64"));
  const at = process.argv.indexOf("--out"), out = at > 0 ? path.resolve(process.argv[at + 1]) : path.join(root, tall ? "assets/img/docs/milkyway-sky-tall.webp" : "assets/img/docs/milkyway-sky.webp");
  fs.writeFileSync(out, Buffer.from(url.split(",")[1], "base64"));
  console.log("wrote", path.relative(root, out), Math.round(fs.statSync(out).size / 1024) + " KB");
  await b.close(); srv.close();
});
