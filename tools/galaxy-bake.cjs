#!/usr/bin/env node
/*
 * The install world's galaxy, as a picture (#119): the site's own galaxy shader (world.js: SKY) painted once, here,
 * so the world loads it instead of painting it on the visitor's GPU.
 *
 * The world painted its galaxy into a texture KW wide and KH = KW / 2 high (sRGB colour, the stars' density in alpha),
 * four strips a frame; on a real device that held the page about a quarter of a second four times. This paints the
 * same texture with the same shader, at the world's two sizes, reads it back, and writes it as one picture of two
 * halves, each KW x KH: the colour above, the density below as grey (sRGB-encoded, so the world's sRGB texture samples
 * it back as the painting's alpha: SKY's floor 0.2 is 125). Row for row as the texture holds it (its first row at the
 * top), which is how the world puts it back (world.js: GALAXY_IN).
 *
 *   NODE_PATH=<playwright's node_modules> node tools/galaxy-bake.cjs [--firefox] [--size 4096|2048] [--out <dir>]
 *   → assets/img/install/galaxy.webp (4096 x 4096) and galaxy-2k.webp (2048 x 2048), or only the size asked for, in <dir>
 *
 * Needs Playwright and WebGL2: Chromium headless on SwiftShader by default; --firefox runs Firefox headed, for a
 * machine whose headless browser has no WebGL (LIBGL_ALWAYS_SOFTWARE=1 xvfb-run -a -s "-screen 0 1280x800x24").
 * Encoded with sharp (tools/package.json): WebP quality 95, smart subsampling, effort 6, no alpha. The browser loads
 * nothing but this repository, from the small server on this machine (local-server.cjs); any other request is refused.
 */
const playwright = require("playwright");
const sharp = require("sharp");
const fs = require("fs"), path = require("path");
const { localServer } = require("./local-server.cjs");
const root = path.resolve(__dirname, "..");
const types = { ".html": "text/html", ".js": "text/javascript", ".webp": "image/webp", ".png": "image/png", ".json": "application/json" };
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };

/* the page: the shader as the world has it (world.js exports it), painted as the world paints it (a full-screen
   triangle into an SRGB8_ALPHA8 texture, uSize the texture's size), a strip at a time so a software GPU is never asked
   for the whole at once; then read back a band of rows at a time, as base64, for this side to put together */
const page = `<!doctype html><meta charset="utf-8"><canvas id="c" width="1" height="1"></canvas><script type="module">
import { SKY } from "./assets/js/world.js";
const gl = document.getElementById("c").getContext("webgl2");
let fb = null, W = 0, H = 0;
window.paint = (KW, strips) => {
  if (!gl) return "no WebGL2 here";
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, "#version 300 es\\nin vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }"));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, SKY));
  gl.bindAttribLocation(p, 0, "p"); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return gl.getProgramInfoLog(p);
  W = KW; H = KW / 2;
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.useProgram(p); gl.uniform2f(gl.getUniformLocation(p, "uSize"), W, H);
  gl.viewport(0, 0, W, H); gl.disable(gl.BLEND); gl.enable(gl.SCISSOR_TEST);
  for (let i = 0; i < strips; i++) { gl.scissor(0, (H / strips) * i, W, H / strips); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.finish(); }
  gl.disable(gl.SCISSOR_TEST);
  return gl.getError() === gl.NO_ERROR ? "" : "a GL error painting";
};
/* rows y .. y + n of the texture, RGBA bytes as stored (sRGB-encoded colour, linear alpha), as base64 */
window.rows = (y, n) => {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  const px = new Uint8Array(W * n * 4);
  gl.readPixels(0, y, W, n, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let s = "";
  for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode.apply(null, px.subarray(i, i + 0x8000));
  return btoa(s);
};
window.ready = true;
</script>`;

/* the density's byte, sRGB-encoded so the world's sRGB texture decodes it back to the painting's alpha */
const enc = (a) => (a <= 0.0031308 ? 12.92 * a : 1.055 * Math.pow(a, 1 / 2.4) - 0.055);
const DENSITY = Uint8Array.from({ length: 256 }, (_, i) => Math.round(255 * enc(i / 255)));

async function bake(pg, KW, out) {
  const KH = KW / 2, strips = KW / 64;
  const said = await pg.evaluate(([kw, n]) => window.paint(kw, n), [KW, strips]);
  if (said) throw new Error(`the galaxy could not be painted: ${said}`);
  const img = Buffer.alloc(KW * KW * 3);
  const BAND = 128;
  for (let y = 0; y < KH; y += BAND) {
    const px = Buffer.from(await pg.evaluate(([y0, n]) => window.rows(y0, n), [y, BAND]), "base64");
    for (let r = 0; r < BAND; r++) {
      for (let x = 0; x < KW; x++) {
        const i = (r * KW + x) * 4, top = ((y + r) * KW + x) * 3, bottom = ((y + r + KH) * KW + x) * 3;
        img[top] = px[i]; img[top + 1] = px[i + 1]; img[top + 2] = px[i + 2];
        img[bottom] = img[bottom + 1] = img[bottom + 2] = DENSITY[px[i + 3]];
      }
    }
  }
  await sharp(img, { raw: { width: KW, height: KW, channels: 3 } }).removeAlpha().webp({ quality: 95, smartSubsample: true, effort: 6 }).toFile(out);
  console.log("wrote", path.relative(root, out), `${KW}x${KW},`, Math.round(fs.statSync(out).size / 1024) + " KB");
}

/* (served on this machine only, nothing outside the repository: local-server.cjs, #37) */
localServer({ root, page, types }).then(async ({ server: srv, url: home }) => {
  const firefox = process.argv.includes("--firefox");
  const b = firefox
    ? await playwright.firefox.launch({ headless: false, firefoxUserPrefs: { "webgl.force-enabled": true } })
    : await playwright.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    const pg = await b.newPage();
    /* same origin only: nothing but this repository, from this machine */
    await pg.route("**/*", (r) => (r.request().url().startsWith(home) ? r.continue() : r.abort()));
    pg.setDefaultTimeout(0);
    await pg.goto(home);
    await pg.waitForFunction(() => window.ready, null, { timeout: 120000 });
    const dir = path.resolve(arg("--out") || path.join(root, "assets/img/install"));
    const only = arg("--size");
    for (const [KW, name] of [[4096, "galaxy.webp"], [2048, "galaxy-2k.webp"]]) {
      if (only && Number(only) !== KW) continue;
      await bake(pg, KW, path.join(dir, name));
    }
  } finally {
    await b.close(); srv.close();
  }
}).catch((e) => { console.error(e); process.exitCode = 1; });
