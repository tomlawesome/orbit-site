/* how long it takes to put a map on the GPU here, with its mipmaps: the sizes the site uses */
import { context, release, sync, line, round } from "./common.js";
export const name = "upload";
export async function run() {
  const out = [];
  const { gl } = context();
  if (!gl) return [line("webgl2", "none")];
  for (const [w, h, label] of [[2048, 1024, "2048x1024 (clouds, day, sky)"], [4096, 2048, "4096x2048 (lights)"], [4800, 3840, "4800x3840 (sharp lights strip, 4K screens)"]]) {
    if (w > gl.getParameter(gl.MAX_TEXTURE_SIZE)) { out.push(line(label, "larger than this GPU allows")); continue; }
    const d = new Uint8Array(w * h * 4); for (let i = 0; i < d.length; i += 4) { d[i] = i & 255; d[i + 1] = (i >> 8) & 255; d[i + 2] = 90; d[i + 3] = 255; }
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    const t0 = performance.now();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, d); sync(gl);
    const t1 = performance.now();
    gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); sync(gl);
    const t2 = performance.now();
    out.push(line(label, `upload ${round(t1 - t0)} ms, mipmaps ${round(t2 - t1)} ms`));
    gl.deleteTexture(t);
    await new Promise((r) => setTimeout(r, 30));
  }
  release(gl);
  return out;
}
