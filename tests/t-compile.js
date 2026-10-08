/* how long shaders take to compile here: a probe of known size, then the site's real Earth shaders (the door's lean
   and rich, the flight's lean head), each salted so the browser's cache cannot answer for the compiler */
import { context, release, program, PROBE, PROBE_ROLLED, TRIVIAL, line, round } from "./common.js";
import { sceneHead } from "../assets/js/voyage.js";
export const name = "compile";
const DOOR_MAIN = `void main(){ vec2 css=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uPx; float cov; vec3 e=earthAA(css,cov); o=vec4(1.0-exp(-e*0.35),cov); }`;
const FLIGHT_MAIN = `void main(){ vec2 css=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uPx; vec3 c=sky(css); float cov; vec3 e=earthAA(css,cov); o=vec4(c*(1.0-cov)+e,1.0); }`;
export async function run() {
  const out = [];
  const { gl } = context();
  if (!gl) return [line("webgl2", "none")];
  out.push(line("compiles in background", gl.getExtension("KHR_parallel_shader_compile") ? "yes (the times below are how long it took, not how long the page stood still)" : "no (each time below is a stall of the page)"));
  const each = [
    ["trivial (the fixed cost of a program)", TRIVIAL],
    ["trivial again", TRIVIAL],
    ["probe (2k chars)", PROBE],
    ["probe again (cache, if any)", PROBE],
    ["probe, loops not unrolled", PROBE_ROLLED],
    ["door lean (real)", sceneHead({ slab: false, door: true }) + DOOR_MAIN],
    ["door rich (real)", sceneHead({ slab: true, door: true }) + DOOR_MAIN],
    ["flight lean head (real)", sceneHead({ slab: false }) + FLIGHT_MAIN],
    ["flight rich head (real)", sceneHead({ slab: true }) + FLIGHT_MAIN],
  ];
  for (const [label, src] of each) {
    try { const pr = program(gl, src); out.push(line(label, `${round(pr.ms)} ms (${pr.chars} chars)`)); gl.deleteProgram(pr.p); }
    catch (e) { out.push(line(label, `failed: ${e.message}`)); }
    await new Promise((r) => setTimeout(r, 50));
  }
  release(gl);
  return out;
}
