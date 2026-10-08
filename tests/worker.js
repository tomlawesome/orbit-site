/* the worker of the worker test (t-worker.js): a WebGL2 context on an offscreen canvas, a shader compiled in it (the
   source sent from the page), timed to its link status; then drawn once, so the program is known to work here */
const VERT = `#version 300 es
void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); gl_Position=vec4(p*2.0-1.0,0.0,1.0); }`;
let gl = null;
onmessage = (e) => {
  const { id, src } = e.data;
  try {
    if (!gl) {
      const canvas = new OffscreenCanvas(64, 64);
      gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, stencil: false });
      if (!gl) { postMessage({ id, error: "no WebGL2 in a worker here" }); return; }
      postMessage({ id, hello: true, background: !!gl.getExtension("KHR_parallel_shader_compile") });
      return;
    }
    const t0 = performance.now();
    const sh = (type, text) => { const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); return s; };
    const p = gl.createProgram(), fs = sh(gl.FRAGMENT_SHADER, src);
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(p, fs); gl.linkProgram(p);
    const ok = gl.getProgramParameter(p, gl.LINK_STATUS);
    const ms = performance.now() - t0;
    if (!ok) { postMessage({ id, error: (gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(p) || "link failed").slice(0, 200) }); return; }
    /* drawn once (every uniform at its default), and a pixel read, so the GPU has run it */
    gl.useProgram(p); gl.bindVertexArray(gl.createVertexArray()); gl.viewport(0, 0, 64, 64);
    const d0 = performance.now(); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    postMessage({ id, ms, draw: performance.now() - d0, chars: src.length });
    gl.deleteProgram(p);
  } catch (err) { postMessage({ id, error: String(err.message || err) }); }
};
