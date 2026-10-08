/* what the browser says about the machine, and what WebGL2 it has: read, not measured */
import { context, release, line } from "./common.js";
export const name = "machine";
export async function run() {
  const out = [];
  const n = navigator;
  out.push(line("browser", n.userAgentData?.brands?.map((b) => `${b.brand} ${b.version}`).join(", ") || n.userAgent));
  out.push(line("platform", n.userAgentData?.platform || n.platform || "?"));
  out.push(line("screen", `${screen.width}x${screen.height} at ${devicePixelRatio}x, window ${innerWidth}x${innerHeight}`));
  out.push(line("cores", n.hardwareConcurrency ?? "?"), line("memory GB (Chrome/Edge only)", n.deviceMemory ?? "?"), line("touch points", n.maxTouchPoints ?? "?"));
  out.push(line("reduced motion", matchMedia("(prefers-reduced-motion: reduce)").matches), line("save-data", n.connection?.saveData ?? "?"), line("connection", n.connection?.effectiveType ?? "?"));
  const { gl } = context();
  if (!gl) { out.push(line("webgl2", "none")); return out; }
  out.push(line("webgl2", "yes"));
  const has = (e) => (gl.getExtension(e) ? "yes" : "no");
  out.push(line("compiles in background (KHR_parallel_shader_compile)", has("KHR_parallel_shader_compile")));
  out.push(line("float render targets (EXT_color_buffer_float)", has("EXT_color_buffer_float")), line("float linear", has("OES_texture_float_linear")), line("anisotropic", has("EXT_texture_filter_anisotropic")));
  out.push(line("max texture size", gl.getParameter(gl.MAX_TEXTURE_SIZE)), line("max samplers", gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)));
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  out.push(line("gpu", dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)));
  out.push(line("gpu vendor", dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)));
  release(gl);
  return out;
}
