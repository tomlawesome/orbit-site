#!/usr/bin/env node
/*
 * The dawn's and the dusk's glows, rendered once, here, into pictures.
 *
 * Each glow is an SVG filter graph (assets/door/glows.js: DAWN, DUSK) — blurs and a
 * turbulence — that the page used to draw into a canvas on load, on the main
 * thread, while the dawn was coming up. These are the same graphs drawn by the
 * same browser engine, so the pictures are those pixels, and the page only
 * shows them. Soft glows at half the 1600×1000 frame, which their blur cannot
 * tell apart; the thin ones (the sun's point, the dusk's rim) at 1.5×.
 *
 *   NODE_PATH=$(npm root -g) node tools/glows.cjs     (needs playwright)
 *   → assets/door/img/dawn/glow-*.webp, assets/door/img/dusk/glow-*.webp
 */
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "..");
const types = { ".html": "text/html", ".js": "text/javascript" };
const page = `<!doctype html><meta charset="utf-8"><script type="module">
import { DAWN, DUSK } from "./assets/door/index.js";
const SOFTEST = new Set(["zod", "sway1", "sway2", "glow", "belt"]), SOFT = new Set(["afterglow"]);
window.render = async () => {
  const out = {};
  for (const [set, groups] of [["dawn", DAWN], ["dusk", DUSK]]) for (const [name, { defs, body }] of Object.entries(groups)) {
    const k = SOFTEST.has(name) ? 0.5 : SOFT.has(name) ? 1 : 1.5, w = Math.round(1600 * k), h = Math.round(1000 * k);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 1600 1000"><defs>' + defs + '</defs>' + body + '</svg>';
    const img = new Image(); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); await img.decode();
    const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h);
    out[set + "/glow-" + name] = c.toDataURL("image/webp", 0.9);
  }
  return out;
};
window.ready = true;
</script>`;
const srv = http.createServer((req, res) => {
  if (req.url === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end(page); return; }
  const p = path.join(root, decodeURIComponent(req.url.split("?")[0]));
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" }); res.end(d); });
}).listen(0, async () => {
  const b = await chromium.launch();
  const pg = await b.newPage();
  await pg.goto(`http://localhost:${srv.address().port}/`);
  await pg.waitForFunction(() => window.ready);
  const out = await pg.evaluate(() => window.render());
  for (const [name, url] of Object.entries(out)) {
    const file = path.join(root, "assets/door/img", name + ".webp");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));
    console.log("wrote", path.relative(root, file), Math.round(fs.statSync(file).size / 1024) + " KB");
  }
  await b.close(); srv.close();
});
