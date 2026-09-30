/*
 * THE INSTALL. One real object — the launcher — lit and moving with weight,
 * and the scroll as its clock. The command sits above it in the display
 * type; nothing else is on the page.
 *
 * The launcher is a slab of dark glass rendered in WebGL (three.js, vendored
 * in assets/vendor), its screen the launcher's own captures at one to one.
 * It leans toward the pointer with inertia, breathes when left alone, and
 * as the page is scrolled it turns and recedes while the install runs across
 * its screen — splash to console to done — scrubbed by the hand, not a timer.
 * Without WebGL the same captures play flat.
 */
import { reduced } from "./sky.js";
const $ = (s, r = document) => r.querySelector(s);
const SHOTS = [
  ["01-splash", "splash"], ["02-install-profile", "install · profile"], ["03-install-ready", "install · ready"],
  ["04-install-console", "install · running"], ["05-install-success", "install · done"], ["06-splash-alive", "splash · running"],
  ["07-update-confirm", "update · confirm"], ["08-update-console", "update · running"], ["09-repair-proposed", "repair · proposed"],
  ["10-repair-applied", "repair · applied"], ["11-remove-confirm", "remove · confirm"], ["12-remove-done", "remove · done"],
];
const src = (i) => `assets/img/launcher/${SHOTS[i][0]}.webp`;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ease = (u) => 1 - Math.pow(1 - u, 3);

export function createInstall(pad) {
  const canvas = $(".stage", pad), track = $(".track", pad), sticky = $(".sticky", pad), flat = $(".flat", pad), flatImg = $(".flat img", pad);
  const sceneN = $(".scene .n", pad), sceneName = $(".scene .name", pad), copy = $(".copy.magnet", pad), cmd = $(".cmd", pad);
  let three = null, gl = null, running = false, raf = 0, progress = 0, shown = -1;
  /* the pointer, and where the object is leaning */
  const aim = { x: 0, y: 0 }, lean = { x: 0, y: 0 };
  let pointerOn = false;
  addEventListener("pointermove", (e) => { pointerOn = true; aim.x = (e.clientX / innerWidth - 0.5) * 2; aim.y = (e.clientY / innerHeight - 0.5) * 2; }, { passive: true });
  addEventListener("pointerleave", () => { pointerOn = false; });

  /* the copy button leans toward the pointer, and the command copies on a click too */
  copy.addEventListener("pointermove", (e) => { const r = copy.getBoundingClientRect(); copy.style.transform = `translate(${((e.clientX - r.left - r.width / 2) * 0.28).toFixed(1)}px, ${((e.clientY - r.top - r.height / 2) * 0.28).toFixed(1)}px)`; });
  copy.addEventListener("pointerleave", () => { copy.style.transform = ""; });

  function scene(i) {
    if (i === shown) return; shown = i;
    sceneN.textContent = String(i + 1).padStart(2, "0"); sceneName.textContent = SHOTS[i][1];
    if (!gl) flatImg.src = src(i);
  }
  const onScroll = () => {
    const max = track.scrollHeight - track.clientHeight;
    progress = max > 0 ? clamp01(track.scrollTop / max) : 0;
    pad.classList.toggle("scrolled", progress > 0.02);
    if (!gl) scene(Math.min(SHOTS.length - 1, Math.floor(progress * SHOTS.length)));
  };
  track.addEventListener("scroll", onScroll, { passive: true });

  /* ── the object ── */
  async function build() {
    if (gl || gl === false) return gl;
    try {
      three = await import("../vendor/three.module.min.js");
      const T = three;
      const renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
      const scn = new T.Scene();
      const cam = new T.PerspectiveCamera(30, 1, 0.1, 40); cam.position.set(0, 0, 7.2);
      /* the slab: a rounded rectangle of dark metal, glass over its face */
      const W = 3.6, H = 2.025, R = 0.09;
      const shape = new T.Shape();
      shape.moveTo(-W / 2 + R, -H / 2); shape.lineTo(W / 2 - R, -H / 2); shape.quadraticCurveTo(W / 2, -H / 2, W / 2, -H / 2 + R);
      shape.lineTo(W / 2, H / 2 - R); shape.quadraticCurveTo(W / 2, H / 2, W / 2 - R, H / 2); shape.lineTo(-W / 2 + R, H / 2);
      shape.quadraticCurveTo(-W / 2, H / 2, -W / 2, H / 2 - R); shape.lineTo(-W / 2, -H / 2 + R); shape.quadraticCurveTo(-W / 2, -H / 2, -W / 2 + R, -H / 2);
      const body = new T.Mesh(new T.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3 }),
        new T.MeshStandardMaterial({ color: 0x141a2c, metalness: 0.6, roughness: 0.38 }));
      body.position.z = -0.14;
      const group = new T.Group(); group.add(body);
      /* the screen: two captures, mixed, with the faintest vignette */
      const loader = new T.TextureLoader();
      const tex = SHOTS.map(([n]) => { const t = loader.load(src(SHOTS.findIndex(([m]) => m === n))); t.colorSpace = T.SRGBColorSpace; t.minFilter = T.LinearMipmapLinearFilter; t.anisotropy = 4; return t; });
      const screenMat = new T.ShaderMaterial({
        uniforms: { a: { value: tex[0] }, b: { value: tex[1] }, blend: { value: 0 }, glow: { value: 1 } }, toneMapped: false,
        vertexShader: `varying vec2 v; void main(){ v = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform sampler2D a; uniform sampler2D b; uniform float blend; uniform float glow; varying vec2 v;
          void main(){ vec3 c = mix(texture2D(a, v).rgb, texture2D(b, v).rgb, blend);
            float d = distance(v, vec2(0.5)); c *= 1.0 - smoothstep(0.35, 0.95, d) * 0.45; c *= glow;
            gl_FragColor = vec4(c, 1.0); }`,
      });
      const screen = new T.Mesh(new T.PlaneGeometry(W - 0.12, H - 0.12), screenMat); screen.position.z = 0.032; group.add(screen);
      /* the glass: a physical sheet that takes the lights as they cross it */
      const glass = new T.Mesh(new T.PlaneGeometry(W - 0.02, H - 0.02), new T.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, reflectivity: 1, depthWrite: false }));
      glass.position.z = 0.05; group.add(glass);
      /* the hairline edge, in the chart pen */
      const edge = new T.LineSegments(new T.EdgesGeometry(new T.PlaneGeometry(W, H)), new T.LineBasicMaterial({ color: 0x8791b3, transparent: true, opacity: 0.35 }));
      edge.position.z = 0.046; group.add(edge);
      scn.add(group);
      /* a studio to reflect: a dark room with three soft boxes, baked once,
         so the glass and the metal have something to catch */
      const room = new T.Scene(); room.background = new T.Color(0x05070d);
      const soft = (w, h, x, y, z, c, i) => { const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: c })); m.material.color.multiplyScalar(i); m.position.set(x, y, z); m.lookAt(0, 0, 0); room.add(m); };
      soft(6, 3, 5, 6, 4, 0xffe9c4, 3.2); soft(4, 8, -8, -2, 3, 0x8fb8ff, 2.2); soft(10, 1.2, 0, -7, 5, 0xd8b45a, 1.4);
      const pm = new T.PMREMGenerator(renderer); scn.environment = pm.fromScene(room, 0.04).texture; pm.dispose();
      /* the light: a warm key from the upper right, a cool rim from the lower left, and a glint that follows the pointer */
      scn.add(new T.AmbientLight(0x8fb8ff, 0.18));
      const key = new T.DirectionalLight(0xffe9c4, 1.6); key.position.set(3, 4, 5); scn.add(key);
      const rim = new T.PointLight(0x8fb8ff, 22, 0, 2); rim.position.set(-4, -2.5, 2.5); scn.add(rim);
      const glint = new T.PointLight(0xfff6e6, 30, 0, 2); glint.position.set(0, 0, 3.5); scn.add(glint);
      const fit = () => {
        const w = pad.clientWidth, h = pad.clientHeight;
        renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
        /* the slab fills about 62% of the width on a wide screen, and nearly all of it on a phone */
        const want = w < 700 ? 0.92 : Math.min(0.7, 1040 / w);
        const vis = 2 * Math.tan((cam.fov * Math.PI) / 360) * cam.position.z * cam.aspect;
        group.scale.setScalar((vis * want) / W);
      };
      fit(); addEventListener("resize", fit);
      gl = { renderer, scn, cam, group, screenMat, tex, glint, t0: performance.now() };
      canvas.hidden = false; flat.hidden = true;
      return gl;
    } catch (err) {
      gl = false; canvas.hidden = true; flat.hidden = false; flatImg.src = src(0);
      return gl;
    }
  }
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (!gl || pad.hidden || document.hidden) return;
    const { renderer, scn, cam, group, screenMat, tex, glint, t0 } = gl;
    const t = (now - t0) / 1000, p = ease(progress);
    /* the lean: toward the pointer, with inertia; and a breath when left alone */
    const tx = pointerOn ? aim.x : 0, ty = pointerOn ? aim.y : 0;
    lean.x = lerp(lean.x, tx, 0.045); lean.y = lerp(lean.y, ty, 0.045);
    const breathe = reduced ? 0 : Math.sin(t * 0.7) * 0.012;
    /* on the scroll the slab leans away and settles back a little, no more — the screen stays readable throughout */
    group.rotation.y = lean.x * 0.2 + p * 0.3 - 0.03;
    group.rotation.x = -lean.y * 0.12 + p * 0.1 + breathe + 0.02;
    group.position.z = -p * 0.9;
    group.position.y = -0.34 + Math.sin(t * 0.9) * 0.02 * (reduced ? 0 : 1) + p * 0.3;
    group.position.x = p * -0.15;
    glint.position.set(lean.x * 3, -lean.y * 2 + 0.6, 3.2);
    /* the install, scrubbed: which capture, and how far into the next */
    const f = progress * (SHOTS.length - 1), i = Math.min(SHOTS.length - 2, Math.floor(f)), m = f - i;
    screenMat.uniforms.a.value = tex[i]; screenMat.uniforms.b.value = tex[i + 1]; screenMat.uniforms.blend.value = clamp01((m - 0.35) / 0.3);
    screenMat.uniforms.glow.value = 1.28 - p * 0.1;
    scene(m > 0.5 ? i + 1 : i);
    renderer.render(scn, cam);
  }
  return {
    start() {
      running = true; track.scrollTop = 0; progress = 0; shown = -1; pad.classList.remove("scrolled");
      build().then(() => { if (!gl) scene(0); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); });
    },
    stop() { running = false; cancelAnimationFrame(raf); },
  };
}
