/*
 * Test for the world's three small faults (assets/js/world.js), written from the specification alone (#12, items S4, S13
 * and S14). createWorld(canvas, opts) returns { gl, made, bake(), baked, ... }; `made` resolves true or false once the
 * shaders are compiled, bake() resolves true or false once the map is in and the galaxy is painted.
 *
 *   S13  the shader-compile poll gives up when the context is lost while compiling: `made` settles false.
 *   S14  the sky shader's link status is not read until COMPLETION_STATUS_KHR says that program is done, as the other
 *        programs already do (the extension exists here).
 *   S4   (the world's half) a failed map load is not kept: asked to bake again, the world fetches the map again.
 *        The install's half (the prepared-world memo) is not reachable in Node: see the commit message.
 *
 *   node tools/ci/site-world-test.mjs
 *
 * No dependencies and no browser. The page's state lives for the life of the page, so each case runs in a fresh Node
 * process (this file again, as `--child`) against a stub page whose fake WebGL2 context records the calls. Every case
 * has a control (the same page without the fault) that must pass, or the checks prove nothing.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const WORLD = "../../assets/js/world.js";
const COMPLETION = 0x91b1, LINK_STATUS = 0x8b82, COMPILE_STATUS = 0x8b81;

if (process.argv[2] === "--child") {
  const spec = JSON.parse(process.argv[3]);
  const early = [];             /* link-status reads of a program before it had been told done */
  const fetches = {};
  let lost = false, programsMade = 0, linkReads = 0;
  const programs = [];
  /* the door's crop probe (texelFetch of one texel into a transform-feedback buffer) is the door's, not a world program */
  const isProbe = (p) => p.shaders.some((s) => /texelFetch\(t, ivec2\(0, 0\), 0\)|precision mediump float; out vec4 o;/.test(String(s.src)));
  const size = (p) => p.shaders.reduce((n, s) => n + String(s.src).length, 0);
  const any = () => new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : any()),
    set: () => true,
    apply: () => any(),
  });
  const glBase = {
    RGBA: 1, UNSIGNED_BYTE: 2, RENDERER: 0x1f01, LINK_STATUS, COMPILE_STATUS,
    isContextLost: () => lost,
    getError: () => 0,
    getExtension(name) {
      if (name === "WEBGL_lose_context") return { loseContext() {} };
      if (name === "WEBGL_debug_renderer_info") return null;
      if (name === "KHR_parallel_shader_compile") return { COMPLETION_STATUS_KHR: COMPLETION };
      return {};
    },
    getParameter: () => "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)",
    getProgramParameter(p, pname) {
      if (pname === COMPLETION) {
        p.asked = (p.asked || 0) + 1;
        if (spec.neverDone) return false;
        if (p.asked > spec.completeAfter) { p.done = true; return true; }
        return false;
      }
      if (pname === LINK_STATUS) {
        linkReads++;
        if (!p.done && !isProbe(p)) early.push(`program #${p.id} (${size(p)} chars of source)`);
        return true;
      }
      return true;
    },
    getShaderParameter: () => true,
    getProgramInfoLog: () => "", getShaderInfoLog: () => "",
    getActiveUniform: (p, i) => ({ name: `u${i}` }),
    getUniformLocation: (p, n) => ({ n }),
    checkFramebufferStatus: () => 0x8cd5, FRAMEBUFFER_COMPLETE: 0x8cd5,
    readPixels() {},
    clientWaitSync: () => 1,
    getBufferSubData(t, o, out) { out[0] = 0; out[1] = 1; },
    createShader(type) { return { type, src: "" }; },
    shaderSource(s, src) { if (s) s.src = src; },
    createProgram() { programsMade++; const p = { id: programs.length, shaders: [] }; programs.push(p); return p; },
    attachShader(p, s) { p?.shaders?.push(s); },
  };
  const gl = new Proxy(glBase, { get: (t, k) => (k in t ? t[k] : typeof k === "string" && /^[A-Z0-9_]+$/.test(k) ? 1 : () => any()) });
  const mkCanvas = () => ({
    width: 300, height: 150, style: {}, id: "", setAttribute() {}, remove() {},
    addEventListener() {}, removeEventListener() {},
    getContext: (kind) => (kind === "webgl2" ? gl : any()),
  });
  globalThis.document = {
    hidden: false, body: { classList: { add() {}, remove() {}, contains: () => false } },
    addEventListener() {}, removeEventListener() {},
    createElement: () => mkCanvas(), createTextNode: () => any(),
  };
  globalThis.window = globalThis;
  globalThis.innerWidth = 1280; globalThis.innerHeight = 800;
  globalThis.screen = { width: 1280, height: 800 };
  globalThis.devicePixelRatio = 1;
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 2);
  globalThis.cancelAnimationFrame = clearTimeout;
  globalThis.requestIdleCallback = (f) => setTimeout(f, 5);
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
  globalThis.Path2D = class { constructor() { return any(); } };
  globalThis.ImageData = class { constructor() { this.probe = true; } };
  globalThis.createImageBitmap = async (src, ...r) => {
    const cut = r.length >= 4;
    return { width: cut ? r[2] : (src.probe ? 1 : 64), height: cut ? r[3] : (src.probe ? 2 : 64), probe: !!src.probe, close() {} };
  };
  let mapFails = !!spec.mapFailsFirst;
  globalThis.fetch = async (url) => {
    const u = String(url);
    fetches[u] = (fetches[u] || 0) + 1;
    if (mapFails && u.includes("map-under-test")) return { ok: false, status: 503 };
    return { ok: true, status: 200, blob: async () => ({ size: 1 }) };
  };
  console.info = () => {}; console.warn = process.env.DBG ? console.log : () => {}; console.error = process.env.DBG ? console.log : () => {};
  process.on("uncaughtException", () => {}); process.on("unhandledRejection", () => {});

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const settle = (p, ms) => Promise.race([p.then((v) => v, () => "rejected"), sleep(ms).then(() => "pending")]);
  const out = { error: null };
  try {
    const { createWorld } = await import(WORLD);
    const world = createWorld(mkCanvas(), {
      small: true, map: "http://localhost/map-under-test.webp", rings: "http://localhost/rings.png", moon: "http://localhost/moon.webp",
    });
    if (!world) throw new Error("createWorld returned null on the stub page");
    (await import("../../assets/door/index.js")).openChores();   /* the pictures are chores: they wait for the door to open them */
    if (spec.loseAt != null) setTimeout(() => { lost = true; }, spec.loseAt);
    out.made = await settle(world.made, 3000);
    if (spec.bake) {
      out.programsAfterMade = programsMade;
      out.bake1 = await settle(world.bake(), 6000);
      out.programsAfterBake = programsMade;
      if (spec.bakeAgain) {
        mapFails = false;
        out.bake2 = await settle(world.bake(), 6000);
        out.mapFetches = Object.entries(fetches).filter(([u]) => u.includes("map-under-test")).reduce((n, [, c]) => n + c, 0);
      }
    }
    out.early = early; out.linkReads = linkReads;
    out.sizes = programs.filter((p) => !isProbe(p)).map(size);
  } catch (e) { out.error = String(e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e); }
  process.stdout.write("RESULT " + JSON.stringify(out) + "\n");
  process.exit(0);
}

/* ------------------------------------------------------------------------------------------------ the parent -- */
let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};
const run = (spec) => {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child", JSON.stringify(spec)], { encoding: "utf8", timeout: 40000 });
  const line = (r.stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) return { error: `no result (exit ${r.status}) ${String(r.stderr || "").split("\n")[0]}` };
  return JSON.parse(line.slice(7));
};

/* S13: the context is lost while the shaders compile */
{
  const control = run({ completeAfter: 3 });
  check("S13 control: with the context kept, the shaders compile and made is true", !control.error && control.made === true, control.error || `made is ${JSON.stringify(control.made)} (want true)`);
  const r = run({ neverDone: true, loseAt: 60 });
  check("S13 made settles false when the context is lost while compiling", !r.error && r.made === false, r.error || `made is ${JSON.stringify(r.made)} (want false, not pending)`);
}

/* S14: the sky shader's link status waits for COMPLETION_STATUS_KHR */
{
  const r = run({ completeAfter: 3, bake: true });
  check("S14 control: the world is made and baked, programs linked", !r.error && r.made === true && r.linkReads > 0, r.error || `made ${JSON.stringify(r.made)}, ${r.linkReads} link-status reads`);
  check("S14 the galaxy's program is made in bake (else this proves nothing)", !r.error && r.programsAfterBake > r.programsAfterMade, r.error || `${r.programsAfterMade} programs after made, ${r.programsAfterBake} after bake`);
  check("S14 no program's link status is read before it is done", !r.error && r.early.length === 0, r.error || `${r.early.length} early read${r.early.length === 1 ? "" : "s"}: ${r.early.join(", ")}`);
}

/* S4 (world half): a failed map load is not kept */
{
  const control = run({ completeAfter: 1, bake: true });
  check("S4 control: with the map available the world bakes", !control.error && control.bake1 === true, control.error || `bake gave ${JSON.stringify(control.bake1)} (want true)`);
  const r = run({ completeAfter: 1, bake: true, bakeAgain: true, mapFailsFirst: true });
  check("S4 a map that failed makes the first bake false", !r.error && r.bake1 === false, r.error || `first bake gave ${JSON.stringify(r.bake1)} (want false)`);
  check("S4 baking again fetches the map again and succeeds", !r.error && r.bake2 === true && r.mapFetches === 2, r.error || `second bake gave ${JSON.stringify(r.bake2)} after ${r.mapFetches} map fetch(es) (want true after 2)`);
}

process.exit(failed ? 1 : 0);
