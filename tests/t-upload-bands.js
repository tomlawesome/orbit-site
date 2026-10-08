/* a picture put on the GPU a band at a time (assets/js/upload.js), against the same picture put on whole: each drawn
   into a target and read back, byte for byte, at its first level and (once both have their mipmaps) at its third.
   Both should be 0 bytes apart. In RGBA8 (the flight's and the door's maps) and SRGB8_ALPHA8 (the worlds' and the
   planets') */
import { context, release, program, target, line, round } from "./common.js";
import { uploadBanded } from "../assets/js/upload.js";
import { openChores } from "../assets/js/chores.js";
export const name = "upload-bands";
const PICTURE = new URL("../assets/img/door/clouds-near.webp", import.meta.url).href;
const SHOW = `#version 300 es
precision highp float;
uniform sampler2D uT; uniform float uLod; uniform vec2 uSize;
out vec4 o;
void main(){ o=textureLod(uT, gl_FragCoord.xy/uSize, uLod); }`;
export async function run() {
  const out = [];
  const { gl } = context();
  if (!gl) return [line("webgl2", "none")];
  /* (the bands are chores: here nothing holds them) */
  openChores();
  const decode = () => fetch(PICTURE).then((r) => r.blob()).then((b) => createImageBitmap(b, { colorSpaceConversion: "none", premultiplyAlpha: "none" }));
  const pr = program(gl, SHOW, { salt: false }), vao = gl.createVertexArray();
  /* a texture's level drawn into a target of that level's size, and read back */
  const read = (t, lod, w, h) => {
    const tg = target(gl, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, tg.f); gl.viewport(0, 0, w, h); gl.useProgram(pr.p); gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(pr.u.uT, 0); gl.uniform1f(pr.u.uLod, lod); gl.uniform2f(pr.u.uSize, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(tg.f); gl.deleteTexture(tg.t);
    return px;
  };
  const apart = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
  const wrap = (g) => { g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE); };
  for (const [fmt, label] of [[gl.RGBA8, "RGBA8"], [gl.SRGB8_ALPHA8, "SRGB8_ALPHA8"]]) {
    try {
      const whole = await decode(), banded = await decode(), w = whole.width, h = whole.height;
      /* whole, as the site did before (and does with ?holdreveal) */
      const A = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, A);
      gl.texImage2D(gl.TEXTURE_2D, 0, fmt, gl.RGBA, gl.UNSIGNED_BYTE, whole); whole.close();
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); wrap(gl);
      /* in bands: the first level compared once the last band is in, before the helper's mipmaps */
      let first = -1;
      const t0 = performance.now();
      const B = await uploadBanded(gl, banded, { internal: fmt, tag: "test", name: "test", setup: wrap, drawable: (t) => { first = apart(read(A, 0, w, h), read(t, 0, w, h)); } });
      const ms = performance.now() - t0;
      gl.bindTexture(gl.TEXTURE_2D, A); gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      const w2 = Math.max(1, w >> 2), h2 = Math.max(1, h >> 2), third = apart(read(A, 2, w2, h2), read(B, 2, w2, h2));
      out.push(line(`${label} ${w}x${h}`, `level 0: ${first} bytes differ of ${w * h * 4}; level 2 (${w2}x${h2}): ${third} of ${w2 * h2 * 4}; banded in ${round(ms, 0)} ms (a band a frame)`));
      gl.deleteTexture(A); gl.deleteTexture(B);
    } catch (e) { out.push(line(label, `failed: ${e.message}`)); }
  }
  release(gl);
  return out;
}
