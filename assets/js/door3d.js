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
 *
 * Drawn at the screen's own density (to 2×), and in two weights, the lean first (voyage.js: sceneHead): the clouds a
 * flat cover on the ground. Measured once, after its first frame: with room to spare (10 ms a frame or less) the rich
 * one is made (dawn.py's cloud slab), measured the same way, and kept if it keeps to 40 ms (20 a second, with room),
 * the flight then asked to draw the same from the handoff on; otherwise the lean one stays, and if even that takes
 * more than 40 ms the density comes down by the square root of the excess (to half), and stays. To try them:
 * &rich (the rich one whatever the lean one took; still measured), &lean (never the rich one).
 */
import { chore, fetchOnce, note } from "./chores.js";
import { sceneHead, TEX, EURO, NEAR, BOXED, doorCamera, followDoor, sunTexture, theStrip, cloudField, cityGlow, wantRich } from "./voyage.js";

/* when this was loaded: how long the first compile then waited its turn is said (note) */
const LOADED = performance.now();
const RICH = /[?&]rich\b/.test(location.search), LEAN = /[?&]lean\b/.test(location.search);

const VERT = `#version 300 es
void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); gl_Position=vec4(p*2.0-1.0,0.0,1.0); }`;

const MAIN = `
/* where the sun comes up on the limb (css px), and how strongly its first light shows there; where the band's top
   fades in (css px: its start, its length) */
uniform vec2 uSunPt, uFade; uniform float uFirst;
void main(){
  vec2 css=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uPx;
  float cov; vec3 e=earthAA(css,cov);
  /* the first light: a bead of the sun along the limb, shimmering as the air over it moves */
  float s=uCirc.z/3000.0;
  vec2 p=css-uSunPt;
  float along=exp(-pow(p.x/(150.0*s),2.0)), across=exp(-pow((p.y+1.5*s)/(2.2*s+0.7),2.0));
  float sh=0.75+0.5*vnoise(vec3(p.x/(9.0*s),uTime*0.3,1.3))*vnoise(vec3(p.x/(23.0*s)+4.0,uTime*0.13,7.1));
  e+=vec3(1.0,0.66,0.4)*along*across*sh*uFirst*0.7;
  /* the picture's own film (dawn.py: tonemap, --expo 0.35), faded in over the band's top as the picture is */
  float f=clamp((css.y-uFade.x)/uFade.y,0.0,1.0);
  vec3 c=(1.0-exp(-max(e,0.0)*0.35))*f*f*(3.0-2.0*f);
  /* and laid over the door's sky as the picture is: where the Earth is it covers the sky; above the limb its air is
     a light over it, as opaque as it is bright (premultiplied) */
  float a=clamp(max(cov,max(c.r,max(c.g,c.b))*(1.0-cov)),0.0,1.0);
  c=a>1e-4?min(c/a,1.0):vec3(0.0);
  c=pow(c,vec3(1.0/2.2))+(hash13(vec3(gl_FragCoord.xy,uTime*60.0))-0.5)/255.0;
  o=vec4(c*a,a);
}`;
const FRAG = (slab) => sceneHead({ slab }) + MAIN;

/* the ground turns once in this long (s: three hours and twenty minutes, all but still), the clouds drift a quarter of a degree a minute
   over it, the sun rises and sinks a little (degrees under the horizon) */
const TURN = 12000, CLOUD = 1 / 360 / 240, SUN = 0.15;
/* the air's light over the limb, against the flight's: the door has shown its two pictures one over the other
   (dawn-pre under dawn), and their air adds up to this much more (fitted against them) */
const AIR = 1.4;

export function liveDoor(world) {
  const canvas = document.createElement("canvas");
  canvas.className = "wl live";
  canvas.setAttribute("aria-hidden", "true");
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
  if (!gl) return null;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const since = performance.now();
  /* the pictures down the wire at once; only putting them on the GPU waits its turn. The sharpest lights at the
     sharpness this screen shows (theStrip: the flight then draws the same) */
  const strip = theStrip();
  const keys = ["lights", "euro", "clouds", "day", "lightsN", "cloudsN", "dayN", "lightsS"];
  for (const k of keys) fetchOnce(TEX[k]).catch(() => {});

  const shader = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); return sh; };
  /* prog: the weight drawn ({ p, u }: the lean one, or the rich one once it is kept) */
  let prog = null, sunTex = null, glowT = null;
  const maps = {}, dims = {}, fields = {};
  const make = (slab) => {
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, VERT)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, FRAG(slab)));
    gl.linkProgram(p);
    return p;
  };
  const finish = (p) => {
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "door3d: no program");
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS), u = {};
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, a.name); }
    if (!sunTex) sunTex = sunTexture(gl);
    return { p, u };
  };
  const par = gl.getExtension("KHR_parallel_shader_compile");
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  const anisoK = aniso ? Math.min(16, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) : 1;
  /* a map not (yet) there is drawn without: black in its place, and its flag down (uHas, uHasN) */
  const blank = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, blank);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
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
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, anisoK);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, BOXED.includes(key) ? gl.CLAMP_TO_EDGE : gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      maps[key] = t; dims[key] = [bm.width, bm.height];
      /* a clouds map's slab field, made with it, for the rich weight (voyage.js: cloudField) */
      if (key === "clouds" || key === "cloudsN") {
        try { fields[key] = cloudField(gl, t, bm.width, bm.height, key === "cloudsN"); } catch (e) { console.warn("orbit: no cloud field", e); }
      }
    }, 60, "door"))
    .catch(() => { /* drawn without it */ });
  const vao = gl.createVertexArray();

  /* the band the Earth fills: the frame's y 640..1000 (as the picture is laid), at the door's own scale */
  /* scale: the share of the screen's density drawn; 1 until the one measure (measure, below) says otherwise */
  let W = 0, H = 0, s = 1, top = 0, px = 1, scale = 1;
  function resize() {
    const r = world.getBoundingClientRect();
    W = r.width || innerWidth; H = r.height || innerHeight; s = Math.max(W / 1600, H / 1000);
    top = Math.max(0, H - 360 * s);
    const bh = H - top;
    /* at the screen's own density (the cities are points, the limb a line), unless the machine cannot keep up */
    px = Math.min(devicePixelRatio || 1, 2) * scale;
    canvas.width = Math.max(1, Math.round(W * px)); canvas.height = Math.max(1, Math.round(bh * px));
    Object.assign(canvas.style, { top: `${top}px`, height: `${bh}px`, bottom: "auto" });
    dirty = true;
  }
  let dirty = true;
  /* the frame's y (laid bottom-up, xMidYMax, as every door layer is) in the band's own css pixels */
  const ly = (y) => H - (1000 - y) * s - top;

  /* the door's turn, kept so the flight takes it up where it is (voyage.js: followDoor) */
  /* (rich: the door has kept its rich weight, so the flight draws the same once it has made it: voyage.js, wantRich) */
  const state = { spinM: [1, 0, 0, 0, 1, 0, 0, 0, 1], cloudOff: 0, sun: null, air: AIR, rich: false };
  /* the door's own clock (s): it runs only while the door is shown, so a journey away and back finds the Earth
     just as it was left, and the flight's last frame and the door's first are the same */
  let clock = 0;
  function draw() {
    if (!prog) return;
    const u = prog.u;
    const t = reduced ? 0 : clock;
    const cam = doorCamera(SUN + (reduced ? 0 : 0.03 * Math.sin((t / 110) * 6.2832) + 0.012 * Math.sin((t / 41) * 6.2832 + 1.3)));
    /* the ground turned about the camera's own vertical: the horizon slides to the right, the stars drift to the left */
    const Z = [-cam.B[6], -cam.B[7], -cam.B[8]], a = (t / TURN) * 6.2832, c = Math.cos(a), sn = Math.sin(a), k = 1 - c;
    const M = [
      c + Z[0] * Z[0] * k, Z[1] * Z[0] * k + Z[2] * sn, Z[2] * Z[0] * k - Z[1] * sn,
      Z[0] * Z[1] * k - Z[2] * sn, c + Z[1] * Z[1] * k, Z[2] * Z[1] * k + Z[0] * sn,
      Z[0] * Z[2] * k + Z[1] * sn, Z[1] * Z[2] * k - Z[0] * sn, c + Z[2] * Z[2] * k,
    ];
    state.spinM = M; state.cloudOff = t * CLOUD; state.sun = cam.S;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog.p); gl.bindVertexArray(vao);
    gl.uniform2f(u.uRes, canvas.width, canvas.height); gl.uniform1f(u.uPx, canvas.width / W);
    gl.uniform1f(u.uTime, t % 1000);
    gl.uniform3f(u.uCirc, W / 2, ly(3920), 3000 * s);
    gl.uniform1f(u.uD, cam.D0); gl.uniform1f(u.uAirK, AIR);
    gl.uniformMatrix3fv(u.uB, false, new Float32Array(cam.B)); gl.uniform3fv(u.uSun, cam.S);
    gl.uniformMatrix3fv(u.uSpinM, false, new Float32Array(M)); gl.uniform1f(u.uCloudOff, state.cloudOff);
    gl.uniform4f(u.uHas, maps.lights ? 1 : 0, maps.euro ? 1 : 0, maps.clouds && maps.day ? 1 : 0, 0);
    gl.uniform4f(u.uEuroBox, ...EURO); gl.uniform4f(u.uNearBox, ...NEAR);
    gl.uniform4f(u.uHasN, maps.lightsN ? 1 : 0, maps.cloudsN ? 1 : 0, maps.dayN ? 1 : 0, 0);
    gl.uniform1f(u.uCloudK, maps.clouds ? 1 : 0);
    gl.uniform4f(u.uStripBox, ...strip.box); gl.uniform1f(u.uHasS, maps.lightsS ? 1 : 0);
    gl.uniform2f(u.uSunPt, W / 2, ly(920)); gl.uniform2f(u.uFade, ly(640), 60 * s);
    gl.uniform1f(u.uFirst, reduced ? 0.5 : 0.5 + 0.25 * Math.sin((t / 110) * 6.2832 + 3.1416));
    const bind = (unit, tx, loc) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tx); gl.uniform1i(loc, unit); };
    bind(0, maps.lights || blank, u.uLights); bind(1, maps.day || blank, u.uDay); bind(2, maps.clouds || blank, u.uClouds);
    bind(3, maps.euro || blank, u.uEuro); bind(4, maps.lightsN || blank, u.uLightsN); bind(5, maps.cloudsN || blank, u.uCloudsN);
    bind(6, maps.dayN || blank, u.uDayN); bind(7, sunTex, u.uSunT); bind(8, maps.lightsS || blank, u.uLightsS);
    bind(9, fields.clouds || blank, u.uCloudF); bind(10, fields.cloudsN || blank, u.uCloudFN); bind(11, glowT || blank, u.uGlow);
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

  /* a measure, after a weight's first frame: three frames, each waited for (a pixel read back, as voyage.js's
     calibrate does), the last two timed (the first may still be finishing the driver's work); their mean (ms) */
  const BUDGET = 40, ROOM = 10;
  function measure() {
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    const ms = [];
    for (let i = 0; i < 3; i++) { const t0 = performance.now(); dirty = true; draw(); sync(); ms.push(performance.now() - t0); }
    return (ms[1] + ms[2]) / 2;
  }
  /* over budget, drawn coarser, once */
  const coarser = (mean) => { if (mean > BUDGET) { scale = Math.max(0.5, Math.sqrt(BUDGET / mean)); resize(); wake(); } };
  const at = () => Math.round(px * 100) / 100;
  /* a weight made: its program asked for, waited for (in the background where the browser can), and finished. Said:
     how long it waited its turn (the first), and how long the making itself took */
  const compile = (slab) => {
    const name = slab ? "rich" : "lean";
    let took = 0;
    return chore(() => {
      const t0 = performance.now();
      if (!slab) note(`door: compile waited ${Math.round(t0 - LOADED)} ms`, since);
      const p = make(slab);
      return compiled(p).then(() => { took = performance.now() - t0; return p; });
    }, 60, "door")
      .then((p) => chore(() => {
        const t0 = performance.now(), pr = finish(p);
        note(`door: ${name} compiled ${Math.round(took + performance.now() - t0)} ms`, since);
        return pr;
      }, 60, "door"));
  };
  /* the ladder, after the lean weight's first frame: measured; with room (or &rich), the rich weight made, measured
     and kept if it keeps to the budget (&rich: kept whatever), the flight then asked for the same; else the lean one,
     coarser if it must be */
  function ladder() {
    let lean;
    try { lean = measure(); } catch { return; /* drawn as it is */ }
    const up = !LEAN && (RICH || lean <= ROOM);
    if (!up) coarser(lean);
    note(`door: lean ${Math.round(lean)} ms a frame, drawn at ${at()}×`, since);
    if (!up) return;
    /* (not waited for here: its chores come after this one) */
    chore(() => { if (!glowT && maps.lights) glowT = cityGlow(gl, maps.lights, ...dims.lights, maps.lightsN, blank); }, 60, "door")
      .then(() => compile(true))
      .then((rich) => chore(() => {
        const was = prog;
        prog = rich;
        let mean = Infinity;
        try { mean = measure(); } catch { /* not kept */ }
        if (RICH || mean <= BUDGET) {
          coarser(mean);
          state.rich = true; wantRich();
          note(`door: live (rich) ${Math.round(mean)} ms a frame${mean > BUDGET ? `, drawn at ${at()}×` : ""}`, since);
        } else {
          prog = was; dirty = true; wake();
          note(`door: rich ${Math.round(mean)} ms a frame, over ${BUDGET}: back to lean`, since);
        }
      }, 60, "door"))
      .catch((e) => { console.warn("orbit: the door stays lean", e); });
  }

  /* made in turn, after the door's reveal: the lean weight, then each map; shown once the first whole frame is drawn;
     then the ladder */
  const ready = compile(false)
    .then((p) => { prog = p; })
    .then(() => Promise.all(keys.map(load)))
    .then(() => chore(() => {
      world.querySelector(".wl.earth")?.after(canvas);
      resize(); draw();
      requestAnimationFrame(() => world.classList.add("live"));
      followDoor(state);
      note("door: live (lean)", since);
      wake();
    }, 60, "door"))
    .then(() => chore(ladder, 60, "door"))
    .catch((e) => { console.warn("orbit: the door stays a picture", e); canvas.remove(); });
  addEventListener("resize", () => { if (prog) { resize(); wake(); } });
  document.addEventListener("visibilitychange", wake);
  /* the door coming back (its class or its hidden flag changing) starts the clock again */
  if (door) new MutationObserver(wake).observe(door, { attributes: true, attributeFilter: ["class", "hidden"] });
  new MutationObserver(wake).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  return { ready, state, wake };
}
