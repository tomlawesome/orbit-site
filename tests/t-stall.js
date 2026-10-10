/* does a shader compile stall the page here, and for how long: a spinner turns (a plain CSS rotation, the kind the
   compositor is meant to carry) while the door's rich shader compiles; frames are timed before, during and after.
   Watch the spinner: whether it freezes is the one thing this test cannot see for itself */
import { context, release, program, line, round } from "./common.js";
import { sceneHead } from "../assets/door/voyage.js";
export const name = "stall";
const DOOR_MAIN = `void main(){ vec2 css=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uPx; float cov; vec3 e=earthAA(css,cov); o=vec4(1.0-exp(-e*0.35),cov); }`;
const gaps = (ms) => new Promise((resolve) => { const g = []; let last = performance.now(), t0 = last; const f = (t) => { g.push(t - last); last = t; if (t - t0 < ms) requestAnimationFrame(f); else resolve(g); }; requestAnimationFrame(f); });
export async function run(host) {
  const out = [];
  const spin = document.createElement("div");
  spin.style.cssText = "width:28px;height:28px;border:3px solid #556;border-top-color:#f0c050;border-radius:50%;animation:tspin .8s linear infinite;margin:8px 0";
  if (!document.getElementById("tspin")) { const st = document.createElement("style"); st.id = "tspin"; st.textContent = "@keyframes tspin{to{transform:rotate(1turn)}}"; document.head.appendChild(st); }
  host?.appendChild(spin);
  const { gl } = context();
  if (!gl) { spin.remove(); return [line("webgl2", "none")]; }
  const bg = !!gl.getExtension("KHR_parallel_shader_compile");
  const before = await gaps(600);
  const t0 = performance.now();
  let pr = null; try { pr = program(gl, sceneHead({ slab: true, door: true }) + DOOR_MAIN); } catch (e) { out.push(line("compile", `failed: ${e.message}`)); }
  const took = performance.now() - t0;
  const after = await gaps(600);
  const worst = (g) => round(Math.max(...g));
  out.push(line("compiles in background", bg ? "yes" : "no"));
  out.push(line("rich door shader compile", `${round(took)} ms`));
  out.push(line("longest frame gap before", `${worst(before)} ms`), line("longest frame gap after", `${worst(after)} ms`));
  out.push(line("the page stood still for", `${round(took)} ms during the compile${bg ? " (in the background: the spinner should not have paused)" : " (on this thread: did the spinner pause? say)"}`));
  if (pr) gl.deleteProgram(pr.p);
  release(gl); spin.remove();
  return out;
}
