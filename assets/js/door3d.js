/*
 * THE DOOR, LIVE (?door3d, while it is tried): the Earth under the door drawn as it is, not as a picture.
 *
 * The same Earth the flight draws (voyage.js), from the same camera, on the same limb, so its first frame is the
 * door's picture (tools/dawn.py) and the picture can go without being seen to. Then it lives: the ground turns
 * slowly under the camera, the other way to the stars' drift over it; the clouds drift over the ground; and the sun
 * hangs at the edge of rising, a little nearer and a little further, its first light shimmering on the limb.
 *
 * Only the Earth and its air are drawn, in the band at the foot of the door they fill, over the door's own sky and
 * its glows (which stay as they are): where the Earth is, it covers them; above the limb its air is added to them.
 * One pass, no targets, a slow clock (the motion is slow: twenty frames a second carries it), and nothing at all
 * while the door is not shown. Made as a chore (chores.js), after the door's reveal; the picture stays until then.
 */
import { chore, fetchOnce, note } from "./chores.js";
import { SCENE_HEAD, TEX, EURO, doorCamera, followDoor } from "./voyage.js";

const VERT = `#version 300 es
void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); gl_Position=vec4(p*2.0-1.0,0.0,1.0); }`;

const FRAG = SCENE_HEAD + `
/* where the sun comes up on the limb (css px), and how strongly its first light shows there */
uniform vec2 uSunPt; uniform float uFirst;
void main(){
  vec2 css=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uPx;
  float cov; vec3 e=earth(css,cov);
  /* the first light: a bead of the sun along the limb, shimmering as the air over it moves */
  float s=uCirc.z/3000.0;
  vec2 p=css-uSunPt;
  float along=exp(-pow(p.x/(150.0*s),2.0)), across=exp(-pow((p.y+1.5*s)/(2.2*s+0.7),2.0));
  float sh=0.75+0.5*vnoise(vec3(p.x/(9.0*s),uTime*0.7,1.3))*vnoise(vec3(p.x/(23.0*s)+4.0,uTime*0.31,7.1));
  e+=vec3(1.0,0.66,0.4)*along*across*sh*uFirst*0.7;
  /* the flight's film, without its bloom or grain (the door has its own grain) */
  vec3 c=1.0-exp(-max(e,0.0)*0.35);
  float l=dot(c,vec3(0.2126,0.7152,0.0722)); c=max(mix(vec3(l),c,1.08),0.0);
  c=pow(c,vec3(1.0/2.2))+(hash13(vec3(gl_FragCoord.xy,uTime*60.0))-0.5)/255.0;
  /* premultiplied: the disc covers what is behind it; the air over the limb adds to it */
  o=vec4(c,cov);
}`;

/* the ground turns once in this long (s), the clouds drift a degree a minute over it, the sun rises and sinks a
   little (degrees under the horizon) */
const TURN = 1500, CLOUD = 1 / 360 / 60, SUN = 0.15;
/* the air's own light, as a share of the flight's: the door's glows beneath already carry most of it */
const AIR = 0.28;

export function liveDoor(world) {
  const canvas = document.createElement("canvas");
  canvas.className = "wl live";
  canvas.setAttribute("aria-hidden", "true");
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
  if (!gl) return null;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const since = performance.now();
  /* the pictures down the wire at once; only putting them on the GPU waits its turn */
  const keys = ["lights", "euro", "clouds", "day"];
  for (const k of keys) fetchOnce(TEX[k]).catch(() => {});

  const shader = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); return sh; };
  let prog = null, u = {};
  const maps = {};
  const make = () => {
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, VERT)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    return p;
  };
  const finish = (p) => {
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "door3d: no program");
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, a.name); }
    prog = p;
  };
  const par = gl.getExtension("KHR_parallel_shader_compile");
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  const compiled = (p) => new Promise((resolve) => {
    if (!par) { resolve(); return; }
    const poll = () => (gl.getProgramParameter(p, par.COMPLETION_STATUS_KHR) ? resolve() : setTimeout(poll, 40));
    poll();
  });
  const load = (key) => fetchOnce(TEX[key])
    .then((b) => createImageBitmap(b, { colorSpaceConversion: "none", premultiplyAlpha: "none" }))
    .then((bm) => chore(() => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bm);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      /* the ground is seen almost edge on: without this the cities blur into the coarsest maps */
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, key === "euro" ? gl.CLAMP_TO_EDGE : gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      maps[key] = t;
    }, 60, "door"));
  const vao = gl.createVertexArray();

  /* the band the Earth fills: the frame's y 640..1000 (as the picture is laid), at the door's own scale */
  let W = 0, H = 0, s = 1, top = 0, px = 1;
  function resize() {
    const r = world.getBoundingClientRect();
    W = r.width || innerWidth; H = r.height || innerHeight; s = Math.max(W / 1600, H / 1000);
    top = Math.max(0, H - 360 * s);
    const bh = H - top, dpr = Math.min(devicePixelRatio || 1, 2);
    /* the night is soft; the cities are points: three quarters of the screen's density, and no more than 0.6 million pixels */
    px = Math.min(dpr * 0.75, Math.sqrt(6e5 / Math.max(1, W * bh)));
    canvas.width = Math.max(1, Math.round(W * px)); canvas.height = Math.max(1, Math.round(bh * px));
    Object.assign(canvas.style, { top: `${top}px`, height: `${bh}px`, bottom: "auto" });
    dirty = true;
  }
  let dirty = true;
  /* the frame's y (laid bottom-up, xMidYMax, as every door layer is) in the band's own css pixels */
  const ly = (y) => H - (1000 - y) * s - top;

  /* the door's turn, kept so the flight takes it up where it is (voyage.js: followDoor) */
  const state = { spinM: [1, 0, 0, 0, 1, 0, 0, 0, 1], cloudOff: 0, sun: null, air: AIR };
  /* the door's own clock (s): it runs only while the door is shown, so a journey away and back finds the Earth
     just as it was left, and the flight's last frame and the door's first are the same */
  let clock = 0;
  function draw() {
    if (!prog) return;
    const t = reduced ? 0 : clock;
    const cam = doorCamera(SUN + (reduced ? 0 : 0.03 * Math.sin((t / 47) * 6.2832) + 0.012 * Math.sin((t / 17) * 6.2832 + 1.3)));
    /* the ground turned about the camera's own vertical: the horizon slides to the right, the stars drift to the left */
    const Z = [-cam.B[6], -cam.B[7], -cam.B[8]], a = (t / TURN) * 6.2832, c = Math.cos(a), sn = Math.sin(a), k = 1 - c;
    const M = [
      c + Z[0] * Z[0] * k, Z[1] * Z[0] * k + Z[2] * sn, Z[2] * Z[0] * k - Z[1] * sn,
      Z[0] * Z[1] * k - Z[2] * sn, c + Z[1] * Z[1] * k, Z[2] * Z[1] * k + Z[0] * sn,
      Z[0] * Z[2] * k + Z[1] * sn, Z[1] * Z[2] * k - Z[0] * sn, c + Z[2] * Z[2] * k,
    ];
    state.spinM = M; state.cloudOff = t * CLOUD; state.sun = cam.S;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog); gl.bindVertexArray(vao);
    gl.uniform2f(u.uRes, canvas.width, canvas.height); gl.uniform1f(u.uPx, canvas.width / W);
    gl.uniform1f(u.uTime, t % 1000);
    gl.uniform3f(u.uCirc, W / 2, ly(3920), 3000 * s);
    gl.uniform1f(u.uD, cam.D0); gl.uniform1f(u.uAirK, AIR);
    gl.uniformMatrix3fv(u.uB, false, new Float32Array(cam.B)); gl.uniform3fv(u.uSun, cam.S);
    gl.uniformMatrix3fv(u.uSpinM, false, new Float32Array(M)); gl.uniform1f(u.uCloudOff, state.cloudOff);
    gl.uniform4f(u.uHas, maps.lights ? 1 : 0, maps.euro ? 1 : 0, maps.clouds && maps.day ? 1 : 0, 0);
    gl.uniform4f(u.uEuroBox, ...EURO);
    gl.uniform2f(u.uSunPt, W / 2, ly(920));
    gl.uniform1f(u.uFirst, reduced ? 0.5 : 0.5 + 0.25 * Math.sin((t / 47) * 6.2832 + 3.1416));
    const bind = (unit, tx, loc) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tx); gl.uniform1i(loc, unit); };
    bind(0, maps.lights, u.uLights); bind(1, maps.day, u.uDay); bind(2, maps.clouds, u.uClouds); bind(3, maps.euro, u.uEuro);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    dirty = false;
  }

  /* the clock: twenty frames a second while the door is shown and the page is seen; nothing otherwise */
  let raf = 0, last = 0, prev = 0;
  const door = world.closest("#door");
  const shown = () => !document.hidden && door && !door.hidden && getComputedStyle(door).opacity !== "0";
  function tick(now) {
    raf = 0;
    if (!shown()) { prev = 0; return; }
    clock += prev ? Math.min(now - prev, 100) / 1000 : 0; prev = now;
    if (dirty || (!reduced && now - last >= 48)) { last = now; draw(); }
    if (!reduced) raf = requestAnimationFrame(tick);
  }
  const wake = () => { if (!raf && prog) raf = requestAnimationFrame(tick); };

  /* made in turn, after the door's reveal: the program, then each map; shown once the first whole frame is drawn */
  const ready = chore(() => { const p = make(); return compiled(p).then(() => p); }, 60, "door")
    .then((p) => chore(() => finish(p), 60, "door"))
    .then(() => Promise.all(keys.map(load)))
    .then(() => chore(() => {
      world.querySelector(".wl.earth")?.after(canvas);
      resize(); draw();
      requestAnimationFrame(() => world.classList.add("live"));
      followDoor(state);
      note("door: live", since);
      wake();
    }, 60, "door"))
    .catch((e) => { console.warn("orbit: the door stays a picture", e); canvas.remove(); });
  addEventListener("resize", () => { if (prog) { resize(); wake(); } });
  document.addEventListener("visibilitychange", wake);
  /* the door coming back (its class or its hidden flag changing) starts the clock again */
  if (door) new MutationObserver(wake).observe(door, { attributes: true, attributeFilter: ["class", "hidden"] });
  new MutationObserver(wake).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  return { ready, state, wake };
}
