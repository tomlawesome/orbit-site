/* shared by the tests: a context, a program, a way to wait for the GPU, and the report's shape (lines of "key: value") */
export const VERT = `#version 300 es
void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); gl_Position=vec4(p*2.0-1.0,0.0,1.0); }`;

export function context(w = 64, h = 64) {
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "high-performance" });
  if (gl) gl.getExtension("EXT_color_buffer_float");
  return { canvas, gl };
}
export const release = (gl) => { try { gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* fine */ } };

/* the GPU made to finish what it has: a one-pixel read */
export const sync = (gl) => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));

/* a program, compiled and linked, timed to the moment its link status is known (which waits for the compile, in
   the background or on this thread alike); a salt in the source keeps the browser's shader cache out of it */
export function program(gl, fsrc, { salt = true } = {}) {
  /* the salt is code, not a comment: Safari hashes the source without its comments, and answered the second probe
     from its cache in 3 ms */
  const src = salt ? fsrc.replace(/out vec4 o;/, `out vec4 o; const float SALT=${Math.random().toFixed(6)};`).replace(/o=vec4\(([^;]*)\);\s*}\s*$/, (m, inner) => `o=vec4(${inner})+vec4(SALT*1e-6); }`) : fsrc;
  const t0 = performance.now();
  const vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, VERT); gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs, src); gl.compileShader(fs);
  const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
  const ok = gl.getProgramParameter(p, gl.LINK_STATUS);
  const ms = performance.now() - t0;
  if (!ok) throw new Error((gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(p) || "link failed").slice(0, 300));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, a.name); }
  return { p, u, ms, chars: src.length };
}

/* a render target of the given size */
export function target(gl, w, h) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  return { t, f, w, h };
}
/* a small texture of noise, for shaders that read maps */
export function noiseTexture(gl, w = 256, h = 128, seed = 1) {
  const d = new Uint8Array(w * h * 4); let s = seed;
  for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = s & 255; }
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, d); gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
/* draw a full-screen triangle n times with the program, waiting for each; the mean of all but the first (ms) */
export function timeDraws(gl, prog, fbo, w, h, set, n = 4) {
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h); gl.useProgram(prog.p);
  set(prog.u);
  const times = [];
  for (let i = 0; i < n; i++) { const t0 = performance.now(); gl.drawArrays(gl.TRIANGLES, 0, 3); sync(gl); times.push(performance.now() - t0); }
  const rest = times.slice(1);
  return { mean: rest.reduce((a, b) => a + b, 0) / rest.length, first: times[0], all: times.map((x) => +x.toFixed(1)) };
}

/* the probe shader (about two thousand characters, an Earth-like march), the one the site probes with at its start */
export { PROBE } from "../assets/js/capability.js";

export const line = (k, v) => `${k}: ${v}`;
export const round = (x, d = 1) => (Number.isFinite(x) ? +x.toFixed(d) : x);
