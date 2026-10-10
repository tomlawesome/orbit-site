/* how fast the GPU draws here: the probe at 512x512 (ms per million pixels), then the door's real lean and rich Earth
   shaders at this screen's own band size, with maps of noise so every path runs (the slab needs clouds to march) */
import { context, release, program, target, noiseTexture, timeDraws, PROBE, PROBE_ROLLED, line, round } from "./common.js";
import { sceneHead, PASS_SWITCH, doorCamera, sunTexture, cloudField, cityGlow, EURO, NEAR } from "../assets/door/voyage.js";
export const name = "draw";
/* (the rich one draws its own fields and glow first: PASS_SWITCH) */
const DOOR_MAIN = `void main(){
${PASS_SWITCH}  vec2 css=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uPx; float cov; vec3 e=earthAA(css,cov); o=vec4(1.0-exp(-e*0.35),cov); }`;
export async function run() {
  const out = [];
  const { gl } = context();
  if (!gl) return [line("webgl2", "none")];
  /* the probe */
  const A = noiseTexture(gl, 256, 128, 3), B = noiseTexture(gl, 256, 128, 7);
  try {
    const pr = program(gl, PROBE), tg = target(gl, 512, 512);
    const setP = (u) => { gl.uniform2f(u.uRes, 512, 512); gl.uniform1f(u.uT, 1); if (u.uZ) gl.uniform1i(u.uZ, 0); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, A); gl.uniform1i(u.uA, 0); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, B); gl.uniform1i(u.uB, 1); };
    const r = timeDraws(gl, pr, tg.f, 512, 512, setP);
    out.push(line("probe 512x512", `${round(r.mean, 2)} ms a frame = ${round(r.mean / 0.262144, 1)} ms per Mpx (frames ${r.all.join(", ")})`));
    /* and the same with its loops left as loops (not unrolled): what that costs the GPU, if anything */
    try { const pr2 = program(gl, PROBE_ROLLED); const r2 = timeDraws(gl, pr2, tg.f, 512, 512, setP); out.push(line("probe 512x512, loops not unrolled", `${round(r2.mean, 2)} ms a frame (frames ${r2.all.join(", ")})`)); gl.deleteProgram(pr2.p); } catch (e) { out.push(line("probe, loops not unrolled", `failed: ${e.message}`)); }
  } catch (e) { out.push(line("probe", `failed: ${e.message}`)); }
  /* the door's band, as door3d.js sizes it */
  const W = innerWidth, H = innerHeight, s = Math.max(W / 1600, H / 1000), bh = Math.min(H, 360 * s), px = Math.min(devicePixelRatio || 1, 2);
  const cw = Math.round(W * px), ch = Math.round(bh * px), ly = (y) => H - (1000 - y) * s - (H - bh);
  out.push(line("door band", `${cw}x${ch} device px (${round((cw * ch) / 1e6, 2)} Mpx) at ${px}x`));
  const cam = doorCamera(), sunT = sunTexture(gl);
  /* the rich program first: its own passes make the slab's fields and the cities' glow (voyage.js: cloudField, cityGlow) */
  let rich = null, richErr = null, fieldG = null, fieldN = null, glow = null;
  try { rich = program(gl, sceneHead({ slab: true, door: true }) + DOOR_MAIN); } catch (e) { richErr = e; }
  try { if (rich) { fieldG = cloudField(gl, rich, A, 256, 128, false); fieldN = cloudField(gl, rich, A, 256, 128, true); glow = cityGlow(gl, rich, B, 256, 128, B, A); } } catch (e) { out.push(line("cloud field/glow", `not made: ${e.message}`)); }
  const blank = noiseTexture(gl, 2, 2, 11);
  const set = (u) => {
    gl.uniform2f(u.uRes, cw, ch); gl.uniform1f(u.uPx, cw / W); gl.uniform1f(u.uTime, 1);
    gl.uniform3f(u.uCirc, W / 2, ly(3920), 3000 * s); gl.uniform1f(u.uD, cam.D0); if (u.uAirK) gl.uniform1f(u.uAirK, 1.4);
    gl.uniformMatrix3fv(u.uB, false, new Float32Array(cam.B)); gl.uniform3fv(u.uSun, cam.S);
    gl.uniformMatrix3fv(u.uSpinM, false, new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1])); gl.uniform1f(u.uCloudOff, 0);
    gl.uniform4f(u.uHas, 1, 1, 1, 0); gl.uniform4f(u.uEuroBox, ...EURO); gl.uniform4f(u.uNearBox, ...NEAR); gl.uniform4f(u.uHasN, 1, 1, 1, 0);
    if (u.uCloudK) gl.uniform1f(u.uCloudK, 1); if (u.uStripBox) gl.uniform4f(u.uStripBox, 0, 20, 40, 56); if (u.uHasS) gl.uniform1f(u.uHasS, 1); if (u.uStripMix) gl.uniform1f(u.uStripMix, 0);
    const bind = (unit, tx, loc) => { if (loc == null) return; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tx); gl.uniform1i(loc, unit); };
    bind(0, B, u.uLights); bind(1, A, u.uDay); bind(2, A, u.uClouds); bind(3, B, u.uEuro); bind(4, B, u.uLightsN); bind(5, A, u.uCloudsN); bind(6, A, u.uDayN);
    bind(7, sunT, u.uSunT); bind(8, B, u.uLightsS); bind(12, B, u.uLightsS2); bind(9, fieldG || blank, u.uCloudF); bind(10, fieldN || blank, u.uCloudFN); bind(11, glow || blank, u.uGlow);
  };
  for (const [label, slab, budget] of [["door lean (real, this band)", false, 16], ["door rich (real, this band)", true, 40]]) {
    try {
      if (slab && !rich) throw richErr;
      const pr = slab ? rich : program(gl, sceneHead({ slab, door: true }) + DOOR_MAIN), tg = target(gl, cw, ch);
      const r = timeDraws(gl, pr, tg.f, cw, ch, set);
      out.push(line(label, `${round(r.mean, 1)} ms a frame, first ${round(r.first, 1)} (budget ${budget}: ${r.mean <= budget ? "fits" : "too slow"}; frames ${r.all.join(", ")})`));
      gl.deleteProgram(pr.p);
    } catch (e) { out.push(line(label, `failed: ${e.message}`)); }
  }
  release(gl);
  return out;
}
