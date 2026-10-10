#!/usr/bin/env node
/*
 * The docs' sky: the Milky Way behind the chart, as the docs' flight comes to rest in it.
 *
 * The flight (voyage.js, engine.js: milkyWay) ends inside the galaxy's disc looking at its core, the band
 * across the sky; this draws that last frame once, with no constellations on it, so the page the flight
 * fades into wears the very sky the flight arrived in.
 *
 *   NODE_PATH=$(npm root -g) node tools/docsky.cjs [--out <path>]     (needs playwright)
 *   → assets/img/docs/milkyway-sky.webp, or <path>
 */
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "..");
const types = { ".html": "text/html", ".js": "text/javascript", ".webp": "image/webp", ".png": "image/png" };
const page = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}canvas{position:fixed;inset:0;width:100vw;height:100vh}</style>
<canvas id="c"></canvas><script type="module">
import { createDoor, openChores } from "./assets/door/index.js";
import { docsFlight } from "./assets/js/flight.js";
createDoor({ image: (p) => "assets/door/img/" + p });
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
const srv = http.createServer((req, res) => {
  if (req.url === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end(page); return; }
  const p = path.join(root, decodeURIComponent(req.url.split("?")[0]));
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" }); res.end(d); });
}).listen(0, async () => {
  const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  /* the flight's galaxy is scaled to the screen's height (its width shows more or less of the sky), so the picture is
     made wide (3:1), and the page sets it to the screen's height: the same sky at any shape of window */
  const pg = await b.newPage({ viewport: { width: 3240, height: 1080 } });
  await pg.goto(`http://localhost:${srv.address().port}/`);
  await pg.waitForFunction(() => window.ready, null, { timeout: 120000 });
  await pg.evaluate(() => window.draw());
  await pg.waitForTimeout(500);
  const shot = await pg.screenshot({ type: "png", timeout: 0 });
  const tmp = path.join(require("os").tmpdir(), "docsky.png");
  fs.writeFileSync(tmp, shot);
  /* to webp through the browser itself */
  const url = await pg.evaluate(async (b64) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; c.getContext("2d").drawImage(img, 0, 0);
    return c.toDataURL("image/webp", 0.86);
  }, shot.toString("base64"));
  const at = process.argv.indexOf("--out"), out = at > 0 ? path.resolve(process.argv[at + 1]) : path.join(root, "assets/img/docs/milkyway-sky.webp");
  fs.writeFileSync(out, Buffer.from(url.split(",")[1], "base64"));
  console.log("wrote", path.relative(root, out), Math.round(fs.statSync(out).size / 1024) + " KB");
  await b.close(); srv.close();
});
