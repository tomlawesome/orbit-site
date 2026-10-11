#!/usr/bin/env node
/*
 * The dawn's and the dusk's glows, rendered once, here, into pictures, without banding.
 *
 * Each glow is an SVG filter graph (assets/door/glows.js: DAWN, DUSK) — blurs and a turbulence — drawn by the same
 * browser engine, so the pictures are those pixels, and the page only shows them. The glows are faint (the dusk's
 * peaks at 14/255 opacity): drawn into 8 bits, a picture holds a dozen opacity steps across the sky and each shows as
 * a stripe. So, as Orbit does (scripts/flight-glows.mjs, ai/orbit#1314), the standard pattern, dither from a
 * high-precision source before quantising to 8 bits:
 *
 *   1. the browser only draws filters at 8 bits, so the high-precision opacity is merged from exposure brackets, as an
 *      HDR photograph is: every opacity in the graph is multiplied by 1, 2, 4 … 32, and each pixel takes the
 *      brightest exposure that is neither saturated nor inconsistent with the one below it, divided back down;
 *   2. the merged opacity is error-diffused (Floyd–Steinberg, serpentine) to 8 bits, nothing below a quarter of a
 *      step kept;
 *   3. the picture is saved lossless: lossy WebP would smooth the dither straight back into stripes.
 *
 * Sizes, against the 1600×1000 frame: the dawn's soft glows (zod, sway1, sway2) at half size, which a blur that wide
 * cannot tell apart; the dusk's soft glows (glow, belt, afterglow) at full size, since a dither drawn at half size and
 * stretched to the frame is averaged back into steps; the thin ones (the sun's point, the dusk's rim) at 1.5×.
 *
 *   NODE_PATH=$(npm root -g) node tools/glows.cjs     (needs playwright, and sharp: npm ci --prefix tools --ignore-scripts)
 *   → assets/door/img/dawn/glow-*.webp, assets/door/img/dusk/glow-*.webp   (lossless)
 */
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "..");
const sharp = require(path.join(__dirname, "node_modules", "sharp"));
const types = { ".html": "text/html", ".js": "text/javascript" };

/* [set, name] → size against the frame */
const SIZE = { "dawn/zod": 0.5, "dawn/sway1": 0.5, "dawn/sway2": 0.5, "dusk/glow": 1, "dusk/belt": 1, "dusk/afterglow": 1 };
const THIN = 1.5;
const GAINS = [1, 2, 4, 8, 16, 32];
/* below a quarter of a step a glow is invisible; dithering it only scatters dots over the whole file */
const FLOOR = 0.25;

/**
 * The stop, stroke and fill opacities in an SVG fragment multiplied by `gain` (the browser clamps each at 1). A bare
 * `opacity` (the dawn fans' group and path opacity) is left alone: it multiplies the whole layer linearly, so scaling
 * it too would make it clamp at 1 from gain 2 while the others kept scaling, and the exposures would stop being
 * multiples of each other (sway1's gain 2 came out 3.57x gain 1 instead of 2x).
 */
function brighten(svg, gain) {
  return svg.replace(/((?:stop|stroke|fill)-opacity)="([0-9.]+)"/g, (_, attr, value) => `${attr}="${Number(value) * gain}"`);
}

/**
 * One high-precision RGBA picture (0–255 floats, unpremultiplied) from 8-bit exposures of the same picture, one per
 * entry of `gains` (ascending, the first 1). Each pixel climbs to the next exposure only while that exposure is
 * unsaturated there and its opacity agrees with the current estimate to within one of its steps: the source is
 * rounded too before it is blurred, so exposures differ by a little more than their own rounding, while a saturated
 * one differs by far more. Opacity alone decides: filters blur in linearRGB, so a faint pixel's colour is rounded in
 * linear light and disagrees between exposures by more than that. The colour is the brightest accepted exposure's.
 */
function mergeExposures(exposures, gains) {
  const size = exposures[0].length;
  const out = new Float64Array(size);
  for (let i = 0; i < size; i += 4) {
    let chosen = 0;
    let alpha = exposures[0][i + 3] / gains[0];
    for (let e = 1; e < gains.length; e++) {
      const a = exposures[e][i + 3];
      if (a >= 255) break;
      const next = a / gains[e];
      if (Math.abs(next - alpha) > 1 / gains[chosen] + 1e-9) break;
      alpha = next;
      chosen = e;
    }
    for (let c = 0; c < 3; c++) out[i + c] = exposures[chosen][i + c];
    out[i + 3] = alpha;
  }
  return out;
}

/**
 * Floyd–Steinberg (serpentine) on the opacity, from floats to 8 bits. The colour stays as it is: the browser
 * premultiplies it by the dithered opacity on decode, so the composited colour carries the same dither, and a smooth
 * colour channel keeps the lossless file small.
 */
function ditherToRgba(merged, width, height) {
  const alpha = new Float64Array(width * height);
  for (let p = 0; p < alpha.length; p++) alpha[p] = merged[p * 4 + 3] < FLOOR ? 0 : merged[p * 4 + 3];
  const rgba = new Uint8ClampedArray(merged.length);
  for (let y = 0; y < height; y++) {
    const leftToRight = y % 2 === 0, step = leftToRight ? 1 : -1;
    for (let n = 0; n < width; n++) {
      const x = leftToRight ? n : width - 1 - n, p = y * width + x;
      const value = Math.min(255, Math.max(0, Math.round(alpha[p])));
      const error = alpha[p] - value;
      if (x + step >= 0 && x + step < width) alpha[p + step] += (error * 7) / 16;
      if (y + 1 < height) {
        if (x - step >= 0 && x - step < width) alpha[p + width - step] += (error * 3) / 16;
        alpha[p + width] += (error * 5) / 16;
        if (x + step >= 0 && x + step < width) alpha[p + width + step] += error / 16;
      }
      rgba[p * 4 + 3] = value;
      for (let c = 0; c < 3; c++) rgba[p * 4 + c] = value === 0 ? 0 : merged[p * 4 + c];
    }
  }
  return rgba;
}

const page = `<!doctype html><meta charset="utf-8"><script type="module">
import { DAWN, DUSK } from "./assets/door/index.js";
${brighten}
${mergeExposures}
${ditherToRgba}
const GAINS = ${JSON.stringify(GAINS)}, FLOOR = ${FLOOR}, SIZE = ${JSON.stringify(SIZE)}, THIN = ${THIN};
async function drawGlow({ defs, body }, w, h) {
  /* a graph with no opacity to raise (the sun's opaque point) has one exposure */
  const gains = brighten(defs + body, 2) === defs + body ? [1] : GAINS;
  const exposures = [];
  for (const gain of gains) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 1600 1000"><defs>' + brighten(defs, gain) + '</defs>' + brighten(body, gain) + '</svg>';
    const img = new Image(); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); await img.decode();
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const context = c.getContext("2d"); context.drawImage(img, 0, 0, w, h);
    exposures.push(context.getImageData(0, 0, w, h).data);
  }
  const rgba = ditherToRgba(mergeExposures(exposures, gains), w, h);
  let binary = "";
  for (let i = 0; i < rgba.length; i += 0x8000) binary += String.fromCharCode(...rgba.subarray(i, i + 0x8000));
  return btoa(binary);
}
window.render = async (set, name) => {
  const groups = set === "dawn" ? DAWN : DUSK, k = SIZE[set + "/" + name] ?? THIN;
  const w = Math.round(1600 * k), h = Math.round(1000 * k);
  return { w, h, rgba: await drawGlow(groups[name], w, h) };
};
window.names = () => ({ dawn: Object.keys(DAWN), dusk: Object.keys(DUSK) });
window.ready = true;
</script>`;
const srv = http.createServer((req, res) => {
  if (req.url === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end(page); return; }
  const p = path.join(root, decodeURIComponent(req.url.split("?")[0]));
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" }); res.end(d); });
}).listen(0, async () => {
  const b = await chromium.launch();
  try {
    const pg = await b.newPage();
    pg.on("pageerror", (e) => { console.error("page error:", e.message); process.exitCode = 1; });
    await pg.goto(`http://localhost:${srv.address().port}/`);
    await pg.waitForFunction(() => window.ready);
    const names = await pg.evaluate(() => window.names());
    let total = 0;
    for (const set of ["dawn", "dusk"]) for (const name of names[set]) {
      const { w, h, rgba } = await pg.evaluate(([s, n]) => window.render(s, n), [set, name]);
      const file = path.join(root, "assets/door/img", set, "glow-" + name + ".webp");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      /* lossless, at libwebp's slowest and smallest setting; the raw RGBA is unpremultiplied, as getImageData gives it */
      await sharp(Buffer.from(rgba, "base64"), { raw: { width: w, height: h, channels: 4 } }).webp({ lossless: true, quality: 100, effort: 6 }).toFile(file);
      const size = fs.statSync(file).size; total += size;
      console.log("wrote", path.relative(root, file), `${w}x${h}`, Math.round(size / 1024) + " KB");
    }
    console.log("total", total, "bytes");
  } finally { await b.close(); srv.close(); }
});
