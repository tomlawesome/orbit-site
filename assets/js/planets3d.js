/*
 * THE PLANETS, LIVE (?door3d, while it is tried): the three worlds on the door's orbits drawn as spheres, not pictures.
 *
 * Each is lit as it goes round: the sunrise under the door lights it from below, the sky keeps its far side from
 * black, a thin warm rim catches the limb, and it turns on its own axis once a lap. The install's giant wears its own
 * world's map (world.js) and a ring of its own; the docs' moon is the gold moon's map, greyed; the information's red
 * world is banded, as its picture is.
 *
 * Where each one is is not worked out here. The orbits are pads.js's (wirePlanets: tilted ellipses in perspective, at
 * Kepler's pace, played on the compositor), and each frame reads where the compositor has put each planet (its .spin's
 * transform: the place, and the perspective's scale, from which its depth), so a planet is drawn exactly on its dotted
 * path and exactly under its anchor, its halo and its name, and stops when they stop (a pointer over one stops all).
 *
 * Two canvases, one either side of the ring: the far half of each orbit under the ring and the name, the near half
 * over them, as the anchors are. Each is its own WebGL2 context with the same small program (a quad round each disc,
 * the sphere traced in it). Made as chores (chores.js), after the door's reveal; the pictures stay until the first
 * frame, and stay for good if anything fails. Nothing is drawn while the door is not shown.
 *
 * The install's giant and the information's red world are never drawn here under ?door3d, not even before their own
 * world draws them (install.js: doorPlanets, which says so with html[data-worldplanets]): this sphere's rings, bright
 * and shadowless, visibly dimmed and took a shadow when the world took over, whereas their pictures, baked from that
 * world, stay until its canvases are live and then give way to them (site.css). The docs' moon is drawn here all
 * along, and html.planets3d still says it is live (the docs' picture goes on that).
 */
import { chore, fetchOnce, note, COMPILES_ASIDE } from "./chores.js";

/* the quad round a disc: four corners about its centre (device px, from the canvas's foot) */
const VERT = `#version 300 es
uniform vec2 uC, uRes; uniform float uHalf;
void main(){ vec2 p=vec2(gl_VertexID&1,gl_VertexID>>1)*2.0-1.0; gl_Position=vec4((uC+p*uHalf)/uRes*2.0-1.0,0.0,1.0); }`;

/* the planet, traced: seen straight on (the perspective is already in its size), in its own radii, y up, z towards
   the viewer. Lit in linear light; out as premultiplied sRGB */
const FRAG = `#version 300 es
precision highp float;
uniform vec2 uC; uniform float uR, uSpin, uBright, uLod, uRings; uniform int uKind;
uniform vec3 uPole, uE1, uL; uniform sampler2D uMap;
out vec4 o;
const float PI=3.14159265;
float h3(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
vec3 lin(vec3 c){ return pow(c,vec3(2.2)); }
/* the ground at a point of the sphere: latitude from the pole, longitude turned by the planet's own spin */
vec3 albedo(vec3 n){
  vec3 e2=cross(uPole,uE1);
  float lat=asin(clamp(dot(n,uPole),-1.0,1.0)), lon=atan(dot(n,e2),dot(n,uE1))-uSpin;
  /* the level of detail set from the disc's size (uLod), not from derivatives: the map's seam would show as a line */
  vec2 uv=vec2(fract(lon/(2.0*PI)+0.5),0.5-lat/PI);
  if(uKind==0){ vec3 m=textureLod(uMap,uv,uLod).rgb; return vec3(dot(m,vec3(0.2126,0.7152,0.0722))); }
  if(uKind==1) return textureLod(uMap,uv,uLod).rgb;
  /* the red world: seven bands, a twelfth brighter or darker, their edges wandering (three octaves of noise, on the
     sphere so nothing seams), on #f87171 going darker towards the poles */
  vec3 b=vec3(cos(lat)*cos(lon),cos(lat)*sin(lon),sin(lat));
  float w=vnoise(b*2.5)*0.57+vnoise(b*5.0+7.1)*0.29+vnoise(b*10.0+3.3)*0.14;
  float band=sin((lat/PI+0.5)*7.0*PI+(w-0.5)*2.6);
  return lin(vec3(0.973,0.443,0.443))*mix(1.0,0.4,smoothstep(0.35,1.0,abs(sin(lat))))*(1.0+0.12*band);
}
void main(){
  vec2 q=(gl_FragCoord.xy-uC)/uR; float r=length(q);
  vec3 sky=lin(vec3(0.561,0.722,1.0))*0.10;
  /* the disc, its edge covered over one pixel */
  float cov=clamp((1.0-r)*uR+0.5,0.0,1.0);
  vec2 qq=q/max(r,1.0); float zs=sqrt(max(0.0,1.0-dot(qq,qq)));
  vec4 P=vec4(0.0);
  if(cov>0.0){
    vec3 n=normalize(vec3(qq,zs));
    float ndl=dot(n,uL), d=max(0.0,(ndl+0.12)/1.12);   /* Lambert, wrapped a little: a soft terminator */
    vec3 c=albedo(n)*(d+sky)+vec3(1.0,0.72,0.45)*0.15*pow(1.0-zs,3.0)*smoothstep(-0.4,0.4,ndl);
    P=vec4(c*uBright,1.0)*cov;
  }
  /* the ring: a flat annulus in the equator (1.35 to 2.2 radii), banded, lit on whichever face the sun is, and dark
     where the planet stands between it and the sun; over the planet where it is nearer, under it where further */
  vec4 G=vec4(0.0); float zr=-1e3;
  if(uRings>0.0){
    zr=-(q.x*uPole.x+q.y*uPole.y)/uPole.z;
    vec3 p=vec3(q,zr); float rho=length(p), fw=max(fwidth(rho),1e-4);
    float edge=smoothstep(1.35-fw*0.5,1.35+fw*0.5,rho)*(1.0-smoothstep(2.2-fw*0.5,2.2+fw*0.5,rho));
    if(edge>0.0){
      float x=(rho-1.35)/0.85, s=0.5+0.5*(0.5*sin(x*21.0+1.0)+0.3*sin(x*53.0+2.0)+0.2*sin(x*8.0));
      float a=mix(0.35,0.8,s)*edge, b=dot(p,uL);
      float sh=b<0.0?smoothstep(0.92,1.04,sqrt(max(0.0,dot(p,p)-b*b))):1.0;
      vec3 rc=lin(vec3(0.84,0.78,0.71))*((0.3+0.7*abs(dot(uPole,uL)))*sh+sky);
      G=vec4(rc*uBright*a,a);
    }
  }
  vec4 c=zr>zs?G+P*(1.0-G.a):P+G*(1.0-P.a);
  if(c.a<=0.0) discard;
  o=vec4(pow(min(c.rgb/c.a,1.0),vec3(1.0/2.2))*c.a,c.a);
}`;

/* pads.js's perspective: a planet z ring units towards the viewer is drawn k = DEPTH / (DEPTH − z) times its size */
const DEPTH = 430;
const KINDS = { docs: 0, install: 1, info: 2 };
/* the install's ring, tilted this far from its orbit's plane (degrees) */
const RING_TILT = 24;

/* the planets their own world draws on the door (install.js: doorPlanets): not drawn here. Under ?door3d the install's
   and the information's are theirs from the first frame, before their worlds are live (their pictures stand in until
   then); html[data-worldplanets] stays what says so from then on */
const DOOR3D = /[?&]door3d\b/.test(location.search);
const OWN = DOOR3D ? ["install", "info"] : [];
const taken = (id) => OWN.includes(id) || (document.documentElement.dataset.worldplanets || "").split(" ").includes(id);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };

export function mountPlanets(door) {
  const lockup = door?.querySelector(".lockup"), glyph = door?.querySelector("#login-glyph"), box = door?.querySelector(".planets");
  /* the plain door's planets are turned about the ring, not placed on it: nothing here to read */
  if (!lockup || !glyph || !box || !document.documentElement.classList.contains("rich")) return null;
  const since = performance.now();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  /* the very pictures the worlds use (world.js: picturesOf), so each comes down the wire once; brought down to a size
     a planet thirty pixels across can use as they are decoded, off the page's thread */
  const small = matchMedia("(pointer: coarse)").matches || Math.min(screen.width, screen.height) < 800;
  const MAPS = {
    install: new URL(small ? "../img/install/planet-2k.webp" : "../img/install/planet.webp", import.meta.url).href,
    docs: new URL("../img/install/moon.webp", import.meta.url).href,
  };
  const MAP_W = 1024;
  const bitmaps = Object.keys(MAPS).map((key) => fetchOnce(MAPS[key])
    .then((b) => createImageBitmap(b, { resizeWidth: MAP_W, resizeHeight: MAP_W / 2, resizeQuality: "high", colorSpaceConversion: "none", premultiplyAlpha: "none" }))
    .then((bm) => ({ key, bm })));
  bitmaps.forEach((p) => p.catch(() => {}));

  const planets = [...door.querySelectorAll(".planet")].map((a) => ({
    a, id: a.dataset.section, kind: KINDS[a.dataset.section] ?? 2, spin: a.querySelector(".spin"), body: a.querySelector(".body"),
    dur: parseFloat(getComputedStyle(a).getPropertyValue("--dur")) || 60, bs: 0, pole: null, e1: null, chosen: a.classList.contains("chosen"),
  }));

  /* the two layers: the same program in each, nothing shared */
  const layer = (side) => {
    const canvas = document.createElement("canvas");
    canvas.className = `planets3d ${side}`;
    canvas.setAttribute("aria-hidden", "true");
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
    return gl && { canvas, gl, prog: null, sh: [], u: {}, maps: {}, vao: gl.createVertexArray(), par: gl.getExtension("KHR_parallel_shader_compile") };
  };
  const far = layer("far"), near = layer("near");
  if (!far || !near) { console.warn("orbit: the planets stay pictures (no WebGL2)"); return null; }
  const layers = [far, near];

  const make = (L) => {
    const { gl } = L, p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); gl.attachShader(p, s); L.sh.push(s);
    }
    gl.linkProgram(p);
    L.p = p;
  };
  const compiled = (L) => new Promise((resolve) => {
    if (!L.par) { resolve(); return; }
    const poll = () => (L.gl.getProgramParameter(L.p, L.par.COMPLETION_STATUS_KHR) ? resolve() : setTimeout(poll, 40));
    poll();
  });
  const finish = (L) => {
    const { gl, p } = L;
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(L.sh.map((s) => gl.getShaderInfoLog(s)).join("") || gl.getProgramInfoLog(p) || "planets3d: no program");
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); L.u[a.name] = gl.getUniformLocation(p, a.name); }
    L.prog = p;
  };
  /* one map to both layers */
  const upload = (key, bm) => {
    for (const { gl, maps } of layers) {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, bm);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      maps[key] = t;
    }
    bm.close?.();
  };

  /* the ring's measure and the layers' place: each canvas a square round the ring's centre, wide enough for the
     outermost orbit, a ring about the giant, and the nearest planets' growth (170 of the ring's 200 units each way) */
  let size = 0, cx = 0, cy = 0, half = 0, px = 1, at = "";
  function measure() {
    const r = box.getBoundingClientRect(), l = lockup.getBoundingClientRect();
    size = box.clientWidth || 0; cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    const h = Math.ceil(size * 0.85), d = Math.min(devicePixelRatio || 1, 2), left = cx - l.left - h, top = cy - l.top - h;
    const key = `${h} ${d} ${left.toFixed(1)} ${top.toFixed(1)}`;
    if (key === at || !size) return;
    at = key; half = h; px = d;
    for (const { canvas } of layers) {
      canvas.width = Math.max(1, Math.round(2 * h * d)); canvas.height = canvas.width;
      Object.assign(canvas.style, { left: `${left}px`, top: `${top}px`, width: `${2 * h}px`, height: `${2 * h}px` });
    }
  }
  /* where the compositor has a planet now: its .spin is translate(x, y) scale(k) from the ring's centre */
  function where(p) {
    const t = getComputedStyle(p.spin).transform;
    if (!t || t === "none" || !size) return null;
    const cs = getComputedStyle(p.spin), m = new DOMMatrixReadOnly(t), k = m.a, u = size / 200;
    if (!(k > 0)) return null;
    if (!p.bs) p.bs = parseFloat(getComputedStyle(p.body).getPropertyValue("--bs")) || 15;
    /* near: on the side over the ring, as the orbit has put its anchor (its z-index, pads.js) */
    return { dx: m.e, dy: m.f, x: cx + m.e, y: cy + m.f, k, z: DEPTH * (1 - 1 / k), r: (p.bs / 2) * k * u, near: cs.zIndex === "5" };
  }
  /* each orbit's plane, once, from its own lap (the keyframes pads.js made): two places a quarter apart, unprojected,
     span it (the focus is the ring's centre). The worlds turn about its normal; the giant's ring is tipped from it,
     about the orbit's widest line, so it opens as the orbit does but leans */
  function poleOf(p) {
    const anim = p.spin.getAnimations().find((x) => x.effect?.getKeyframes?.().some((f) => f.transform));
    if (!anim || !size) return false;
    const kf = anim.effect.getKeyframes(), u = size / 200;
    const pt = (f) => { const m = new DOMMatrixReadOnly(f.transform), k = m.a; return [m.e / k / u, -m.f / k / u, DEPTH * (1 - 1 / k)]; };
    let n = unit(cross(pt(kf[0]), pt(kf[Math.floor(kf.length / 4)])));
    if (n[2] < 0) n = n.map((v) => -v);
    if (p.kind === 1) {
      const node = unit(cross(n, [0, 0, 1])), a = (RING_TILT * Math.PI) / 180;
      n = unit(n.map((v, i) => v * Math.cos(a) + node[i] * Math.sin(a)));
    }
    p.pole = n;
    p.e1 = unit(Math.abs(n[2]) > 0.999 ? cross(n, [0, 1, 0]) : cross(n, [0, 0, 1]));
    return true;
  }

  let failed = false, live = false;
  function draw(now) {
    measure();
    if (!size) return;
    /* the CSS planets stay until the door's own reveal has brought them all the way in */
    if (!live && getComputedStyle(box).opacity !== "1") return;
    const s = Math.max(innerWidth / 1600, innerHeight / 1000), sunX = innerWidth / 2, sunY = innerHeight - (1000 - 920) * s;
    const u = size / 200, list = [];
    for (const p of planets) {
      if (p.chosen || taken(p.id) || (!p.pole && !poleOf(p))) continue;
      const w = where(p);
      if (w) list.push([p, w]);
    }
    if (!list.length) return;
    list.sort((a, b) => a[1].z - b[1].z);
    for (const { gl, canvas } of layers) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    }
    for (const [p, w] of list) {
      /* on the side the orbit has put its anchor (pads.js holds the change while the world overlaps the ring's stroke) */
      const { gl, canvas, u: U, maps, prog, vao } = w.near ? near : far;
      gl.useProgram(prog); gl.bindVertexArray(vao);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const R = w.r * px;
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform2f(U.uC, (half + w.dx) * px, (half - w.dy) * px);
      gl.uniform1f(U.uR, R);
      gl.uniform1f(U.uHalf, R * (p.kind === 1 ? 2.2 : 1) + 2);
      gl.uniform1i(U.uKind, p.kind);
      gl.uniform1f(U.uRings, p.kind === 1 ? 1 : 0);
      gl.uniform1f(U.uSpin, reduced ? 0 : ((now / 1000 / p.dur) % 1) * Math.PI * 2);
      gl.uniform1f(U.uBright, 1 - 0.2 * Math.max(0, -w.z / 200));
      gl.uniform1f(U.uLod, Math.max(0, Math.log2(MAP_W / (Math.PI * 2 * Math.max(R, 1)))));
      gl.uniform3fv(U.uPole, p.pole); gl.uniform3fv(U.uE1, p.e1);
      /* the sunrise: from the planet to the sun's point on the limb (the door's frame, y 920), in css px */
      gl.uniform3fv(U.uL, unit([sunX - w.x, -(sunY - w.y), -w.z * u]));
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, maps[p.kind === 0 ? "docs" : "install"]); gl.uniform1i(U.uMap, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    if (!live) {
      live = true;
      document.documentElement.classList.add("planets3d");
      note("planets: live", since);
    }
  }

  /* the clock: every frame while the door is shown and the page is seen; nothing otherwise */
  let raf = 0, started = false;
  /* and not once a journey begins (launching, departing): the worlds hold still under the flight or the dive's blur */
  const shown = () => !document.hidden && !door.hidden && !/\b(launching|departing|showwarp)\b/.test(document.body.className) && getComputedStyle(door).opacity !== "0";
  function tick(now) {
    raf = 0;
    if (failed || !shown()) return;
    try { draw(now); } catch (e) { fail(e); return; }
    raf = requestAnimationFrame(tick);
  }
  const wake = () => { if (!raf && started && !failed) raf = requestAnimationFrame(tick); };
  function fail(e) {
    failed = true;
    console.warn("orbit: the planets stay pictures", e);
    for (const { canvas } of layers) canvas.remove();
    document.documentElement.classList.remove("planets3d");
  }

  /* a dive takes its planet: the picture comes back for the swell and this one is not drawn, until it is set down
     (not the two the world draws itself: their own canvases go on into the dive, site.css) */
  for (const p of planets) new MutationObserver(() => { p.chosen = p.a.classList.contains("chosen"); wake(); }).observe(p.a, { attributes: true, attributeFilter: ["class"] });
  new MutationObserver(wake).observe(door, { attributes: true, attributeFilter: ["class", "hidden"] });
  new MutationObserver(wake).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  document.addEventListener("visibilitychange", wake);
  addEventListener("resize", () => { at = ""; wake(); });

  /* made in turn, after the door's reveal: both programs, then each map into both, then the layers laid either side
     of the ring and the clock started; the pictures go once the first frame is drawn (draw). Where the browser compiles
     on the page's own thread (chores.js: COMPILES_ASIDE false), the programs are "compile" chores, done first of all */
  const [crest, ctag] = COMPILES_ASIDE ? [60, "door"] : [20, "compile"];
  const ready = chore(() => { layers.forEach(make); return Promise.all(layers.map(compiled)); }, crest, ctag)
    .then(() => chore(() => { layers.forEach(finish); note("planets: shaders compiled", since); }, crest, ctag))
    .then(() => Promise.all(bitmaps.map((b) => b.then(({ key, bm }) => chore(() => upload(key, bm), 60, "door")))))
    .then(() => chore(() => {
      glyph.before(far.canvas); glyph.after(near.canvas);
      started = true; measure(); wake();
    }, 60, "door"))
    .catch(fail);

  /* for the test only: where each planet is drawn (css px, the viewport's), worked out now as a frame would */
  if (DOOR3D) {
    window.__planets3d = {
      positions: () => {
        measure();
        return planets.map((p) => { const w = where(p); return w && { section: p.id, x: w.x, y: w.y, r: w.r, z: w.z, side: w.near ? "near" : "far", drawn: live && !p.chosen && !taken(p.id) }; });
      },
    };
  }
  return { ready, wake };
}
