/* can a shader be compiled off the page's thread here, in a worker, without the page standing still? The question
   for a browser that compiles on the page's thread (Firefox): is the stall the page waiting, or the GPU's process
   itself? Three things turn while the worker compiles the door's rich shader and the flight's: a CSS spinner (the
   compositor's: watch it), a dot drawn by the page every frame (the page's thread: its gaps are measured), and a
   triangle the page draws with its own WebGL every frame (the page's own drawing: its gaps are measured apart) */
import { context, release, program, PROBE, line, round } from "./common.js";
import { sceneHead, PASS_SWITCH } from "../assets/js/voyage.js";
export const name = "worker";
const DOOR_MAIN = `void main(){
${PASS_SWITCH}  vec2 css=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uPx; float cov; vec3 e=earthAA(css,cov); o=vec4(1.0-exp(-e*0.35),cov); }`;
const FLIGHT_MAIN = `void main(){ vec2 css=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uPx; vec3 c=sky(css); float cov; vec3 e=earthAA(css,cov); o=vec4(c*(1.0-cov)+e,1.0); }`;
const TRI = `#version 300 es
precision highp float; uniform float uT; out vec4 o; void main(){ o=vec4(fract(gl_FragCoord.x/64.0+uT),0.5,0.2,1.0); }`;
const salted = (src) => src.replace(/out vec4 o;/, `out vec4 o; const float SALT=${Math.random().toFixed(6)};`).replace(/o=vec4\(([^;]*)\);\s*}\s*$/, (m, inner) => `o=vec4(${inner})+vec4(SALT*1e-6); }`);
export async function run(host) {
  const out = [];
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return [line("worker + OffscreenCanvas", "not here")];
  /* the three things that turn */
  const row = document.createElement("div"); row.style.cssText = "display:flex;gap:12px;align-items:center;margin:8px 0";
  const spin = document.createElement("div");
  spin.style.cssText = "width:28px;height:28px;border:3px solid #556;border-top-color:#f0c050;border-radius:50%;animation:tspin .8s linear infinite";
  if (!document.getElementById("tspin")) { const st = document.createElement("style"); st.id = "tspin"; st.textContent = "@keyframes tspin{to{transform:rotate(1turn)}}"; document.head.appendChild(st); }
  const dot = document.createElement("canvas"); dot.width = dot.height = 34; dot.style.cssText = "width:34px;height:34px";
  const tri = document.createElement("canvas"); tri.width = tri.height = 34; tri.style.cssText = "width:34px;height:34px";
  row.append(spin, dot, tri); host?.appendChild(row);
  const d2 = dot.getContext("2d");
  const gl = tri.getContext("webgl2", { antialias: false });
  let triP = null; try { if (gl) triP = program(gl, TRI, { salt: false }); } catch { /* without */ }
  /* the page's loop: the dot turned by the page, the triangle drawn by the page's WebGL; every gap between frames
     kept, and the WebGL draw's own time */
  /* webgl: whether the page draws its triangle too (no pixel read back: as the live site draws), so the page's own
     frames can be timed with and without its WebGL in them */
  let on = true, webgl = false, gaps = [], draws = [], last = 0, a = 0;
  const loop = (t) => {
    if (!on) return;
    if (last) gaps.push(t - last); last = t;
    a += 0.15; d2.clearRect(0, 0, 34, 34); d2.fillStyle = "#f0c050"; d2.beginPath(); d2.arc(17 + 11 * Math.cos(a), 17 + 11 * Math.sin(a), 4, 0, 6.2832); d2.fill();
    if (webgl && gl && triP) { const t0 = performance.now(); gl.useProgram(triP.p); gl.uniform1f(triP.u.uT, a); gl.viewport(0, 0, 34, 34); gl.drawArrays(gl.TRIANGLES, 0, 3); draws.push(performance.now() - t0); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const window_ = (ms) => new Promise((r) => setTimeout(r, ms));
  const worst = (g) => (g.length ? round(Math.max(...g)) : "-");
  /* the worker */
  const w = new Worker(new URL("./worker.js", import.meta.url));
  const ask = (msg) => new Promise((resolve) => { const id = Math.random(); const on = (e) => { if (e.data.id === id) { w.removeEventListener("message", on); resolve(e.data); } }; w.addEventListener("message", on); w.postMessage({ id, ...msg }); });
  try {
    const hello = await ask({});
    if (hello.error) { out.push(line("worker WebGL2", hello.error)); throw new Error("stop"); }
    out.push(line("worker WebGL2", `yes; compiles in background there: ${hello.background ? "yes" : "no"}`));
    await window_(500);
    out.push(line("page's longest frame gap, worker idle, no WebGL on the page", `${worst(gaps)} ms`));
    webgl = true; gaps = []; draws = []; await window_(500);
    out.push(line("page's longest frame gap, worker idle, the page drawing WebGL too", `${worst(gaps)} ms (its draw ${worst(draws)} ms)`));
    /* a context of the page's own, for the cache question below */
    const page = context();
    for (const [label, src] of [["probe (2k chars)", PROBE], ["door rich (real)", sceneHead({ slab: true, door: true }) + DOOR_MAIN], ["flight rich head (real)", sceneHead({ slab: true }) + FLIGHT_MAIN]]) {
      /* twice: the page drawing only its dot (2D), then its WebGL triangle too */
      let same = null;
      for (const withGl of [false, true]) {
        webgl = withGl; gaps = []; draws = [];
        await window_(120);
        gaps = []; draws = [];
        same = salted(src);
        const t0 = performance.now();
        const r = await ask({ src: same });
        const wall = performance.now() - t0;
        await window_(100);
        if (r.error) { out.push(line(label, `failed in the worker: ${r.error}`)); same = null; break; }
        out.push(line(`${label}, page ${withGl ? "drawing WebGL too" : "drawing 2D only"}`, `compiled in the worker in ${round(r.ms)} ms; meanwhile the page's longest frame gap ${worst(gaps)} ms${withGl ? `, its WebGL draw at most ${worst(draws)} ms` : ""}, over ${round(wall)} ms`));
      }
      /* the cache question: the very source the worker just compiled, compiled again on the page: does the GPU
         process remember it (a few ms), or compile it all over again (hundreds)? */
      if (same && page.gl) {
        webgl = false;
        try { const pr = program(page.gl, same, { salt: false }); out.push(line(`${label}, the same source compiled on the page after the worker`, `${round(pr.ms)} ms${pr.ms < 60 ? " (remembered: a worker can warm the page's compiles)" : " (compiled again: no shared cache)"}`)); page.gl.deleteProgram(pr.p); }
        catch (e) { out.push(line(`${label}, on the page after the worker`, `failed: ${e.message}`)); }
      }
    }
    if (page.gl) release(page.gl);
    out.push(line("the eye's verdict", "did the CSS spinner (left) pause during the compiles? did the dot (middle)? say which, and in which phase"));
  } catch (e) { if (e.message !== "stop") out.push(line("error", e.message)); }
  on = false; w.terminate();
  if (gl) { if (triP) gl.deleteProgram(triP.p); release(gl); }
  row.remove();
  return out;
}
