/*
 * Test for a destroyed journey's world doing more work on the page's shared WebGL context (#2), written from the
 * specification alone. The page has ONE context (fitness.js gpu()); each journey's flight builds a world (voyage.js) on
 * it. Once journey.destroy() has returned, its stopped world must put nothing more on that context:
 *   a) the docs' galaxy's shaders are not compiled (no galaxy shader or program is made after destroy);
 *   b) the pictures still on their way put nothing on the GPU (no texImage2D / texSubImage2D / texStorage2D for the
 *      maps; the fetches may still resolve after destroy: here they are held until after it);
 *   c) the galaxy's stars are not made (no bufferData of vertex data after destroy);
 *   d) if the shared context is lost afterwards (webglcontextlost on the shared canvas) the destroyed world prints no
 *      verdict line ("orbit · flight world: off: the context was lost").
 *
 *   node tools/ci/destroyed-world-test.mjs
 *
 * No dependencies and no browser. The page's state lives for the life of the page, so each case runs in a fresh Node
 * process (this file again, as `--child`) against a stub page whose fake WebGL2 context records every call. The journey
 * is reached through assets/door/index.js alone, as a host does. The world is made (journey.warm({ prove: false })) and
 * the journey is destroyed BEFORE any chore may run (the chores open afterwards) and with every picture's fetch still
 * pending; the calls after that point are counted. The control is the same page without the destroy: the same calls must
 * then happen, or the other checks prove nothing. The crop probe (upload.js: cropHonoured), which is the context's own
 * and not a map's, is left out of the counts.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const INDEX = "../../assets/door/index.js";
const LOST_LINE = /flight world: off: the context was lost/;

if (process.argv[2] === "--child") {
  const how = process.argv[3];                 /* "control" | "destroyed" */
  let marked = false;                          /* true once the point of destroy (or, in the control, its place) is passed */
  const shaders = [], programs = [], texCalls = [], bufCalls = [], listeners = {}, said = [];
  let sharedCanvas = null;
  const any = () => new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : any()),
    set: () => true,
    apply: () => any(),
  });
  /* the crop probe's source: texelFetch of one texel into a transform-feedback buffer */
  const isProbeSrc = (s) => /texelFetch\(t, ivec2\(0, 0\), 0\)|precision mediump float; out vec4 o;/.test(String(s));
  const glBase = {
    RGBA: 1, UNSIGNED_BYTE: 2, RENDERER: 0x1f01,
    isContextLost: () => false,
    getError: () => 0,
    getExtension(name) {
      if (name === "WEBGL_lose_context") return { loseContext() {} };
      if (name === "WEBGL_debug_renderer_info") return null;
      return { COMPLETION_STATUS_KHR: 0x91b1 };
    },
    getParameter: () => "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)",
    getProgramParameter: () => true, getShaderParameter: () => true,
    getProgramInfoLog: () => "", getShaderInfoLog: () => "",
    getActiveUniform: (p, i) => ({ name: `u${i}` }),
    getUniformLocation: (p, n) => ({ n }),
    checkFramebufferStatus: () => 0x8cd5, FRAMEBUFFER_COMPLETE: 0x8cd5,
    readPixels() {},
    clientWaitSync: () => 1,                                      /* ALREADY_SIGNALED */
    getBufferSubData(t, o, out) { out[0] = 0; out[1] = 1; },      /* the crop is honoured: the pictures go in bands */
    createShader(type) { const s = { type, src: "", at: marked, compiled: false }; shaders.push(s); return s; },
    shaderSource(s, src) { if (s) s.src = src; },
    compileShader(s) { if (s) { s.compiled = true; s.compiledAfter = marked; } },
    createProgram() { const p = { at: marked, shaders: [] }; programs.push(p); return p; },
    attachShader(p, s) { p?.shaders?.push(s); },
    texImage2D(...a) { const src = a.length === 6 ? a[5] : null; texCalls.push({ fn: "texImage2D", after: marked, probe: !!src?.probe }); },
    texSubImage2D(...a) { const src = a[a.length - 1]; texCalls.push({ fn: "texSubImage2D", after: marked, probe: !!src?.probe }); },
    texStorage2D() { texCalls.push({ fn: "texStorage2D", after: marked, probe: false }); },
    bufferData(t, data) { bufCalls.push({ after: marked, vertex: ArrayBuffer.isView(data) }); },
  };
  const gl = new Proxy(glBase, { get: (t, k) => (k in t ? t[k] : typeof k === "string" && /^[A-Z0-9_]+$/.test(k) ? 1 : () => any()) });
  const mkCanvas = () => {
    const c = {
      width: 300, height: 150, style: {}, id: "", setAttribute() {}, remove() {},
      addEventListener(type, fn) { if (c === sharedCanvas) (listeners[type] ||= []).push(fn); },
      removeEventListener(type, fn) { if (c === sharedCanvas && listeners[type]) listeners[type] = listeners[type].filter((f) => f !== fn); },
      getContext(kind) { if (kind === "webgl2") { sharedCanvas ||= c; return gl; } return any(); },
    };
    return c;
  };
  globalThis.document = {
    hidden: false, body: { classList: { add() {}, remove() {}, contains: () => false } },
    addEventListener() {}, removeEventListener() {},
    createElement: () => mkCanvas(), createTextNode: () => any(),
  };
  globalThis.window = globalThis;
  globalThis.innerWidth = 1280; globalThis.innerHeight = 800;
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 2);
  globalThis.cancelAnimationFrame = clearTimeout;
  globalThis.requestIdleCallback = (f) => setTimeout(f, 5);
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
  globalThis.Path2D = class { constructor() { return any(); } };
  globalThis.ImageData = class { constructor() { this.probe = true; } };
  /* a bitmap: the crop probe's (and what is cut from it) is marked, so the probe is left out of the counts */
  globalThis.createImageBitmap = async (src, ...r) => {
    const cut = r.length >= 4;
    return { width: cut ? r[2] : (src.probe ? 1 : 64), height: cut ? r[3] : (src.probe ? 2 : 64), probe: !!src.probe, close() {} };
  };
  /* the pictures' fetches are held until the test lets them go (after the destroy) */
  let release; const gate = new Promise((r) => { release = r; });
  globalThis.fetch = () => gate.then(() => ({ ok: true, blob: async () => ({ size: 1 }) }));
  const lines = [];
  console.info = (...a) => { lines.push(a.join(" ")); };
  console.warn = () => {};

  const hostCanvas = () => {
    const parent = { insertBefore() {} };
    return { width: 300, height: 150, style: {}, parentNode: parent, getContext: () => any(), addEventListener() {}, removeEventListener() {}, setAttribute() {} };
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { error: null };
  try {
    const door = await import(INDEX);
    const d = door.createDoor({ typingWait: 0, flags: {} });
    const journey = d.journey({ canvas: hostCanvas(), name: any(), dawnGlyph: () => null, duskGlyph: () => null, on: {} });
    const proof = journey.warm({ prove: false });
    proof.catch(() => {});
    await sleep(80);                      /* the world is made (its shaders asked for); the chores are not open yet */
    out.before = { programs: programs.length, galaxyShaders: shaders.filter((s) => !isProbeSrc(s.src)).length };
    if (how.startsWith("destroyed")) journey.destroy();
    marked = true;                        /* from here on: after destroy() has returned */
    release();                            /* the fetches resolve now */
    door.openChores();
    await Promise.race([door.quiet(), sleep(6000)]);
    await sleep(300);
    await Promise.race([door.quiet(), sleep(6000)]);
    /* the shared context is lost */
    const before = lines.filter((l) => LOST_LINE.test(l)).length;
    for (const fn of [...(listeners.webglcontextlost || [])]) fn({ type: "webglcontextlost", preventDefault() {} });
    await sleep(50);
    out.shaders = shaders.filter((s) => s.at && !isProbeSrc(s.src)).length;
    out.programs = programs.filter((p) => p.at && !p.shaders.some((s) => isProbeSrc(s.src))).length;
    out.compiled = shaders.filter((s) => s.compiledAfter && !isProbeSrc(s.src)).length;
    out.tex = texCalls.filter((c) => c.after && !c.probe).length;
    out.buf = bufCalls.filter((c) => c.after && c.vertex).length;
    out.lost = lines.filter((l) => LOST_LINE.test(l)).length - before;
    out.lostLines = lines.filter((l) => LOST_LINE.test(l));
  } catch (e) { out.error = String(e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e); }
  process.stdout.write("RESULT " + JSON.stringify(out) + "\n");
  process.exit(0);
}

let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};
const run = (how) => {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child", how], { encoding: "utf8", timeout: 90000 });
  const line = (r.stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) return { error: `the child printed no result (exit ${r.status}): ${(r.stderr || "").split("\n").slice(0, 3).join(" | ")}` };
  return JSON.parse(line.slice(7));
};

/* (the browser that compiles on the page's own thread, compilesAside false, is not covered: there the world and the
   galaxy are consecutive "compile" chores run together under the first light, with no point between them to destroy at) */
for (const label of ["background compiles"]) {
  const c = run("control"), d = run("destroyed");
  const e = (r) => (r.error ? `; ${r.error}` : "");
  /* controls: the same page without a destroy does all four */
  check(`control (${label}): the world is made before the point, and the galaxy's shaders and programs after it`,
    !c.error && c.before.programs >= 3 && c.programs >= 2 && c.shaders >= 3 && c.compiled >= 3, `before ${JSON.stringify(c.before)}, after: ${c.programs} programs, ${c.shaders} shaders, ${c.compiled} compiled${e(c)}`);
  check(`control (${label}): the maps are put on the GPU`, !c.error && c.tex >= 8, `${c.tex} texture upload calls (want 8 or more)${e(c)}`);
  check(`control (${label}): the galaxy's stars are made`, !c.error && c.buf >= 2, `${c.buf} bufferData calls (want 2 or more)${e(c)}`);
  check(`control (${label}): a lost context prints the verdict line`, !c.error && c.lost === 1, `${c.lost} line(s) (want 1)${e(c)}`);
  /* the destroyed journey */
  check(`destroyed (${label}): the world was made, and the galaxy not yet, when the journey was destroyed`,
    !d.error && d.before.programs >= 3, `programs made before destroy: ${d.before?.programs}${e(d)}`);
  check(`a) destroyed (${label}): no galaxy shader or program is made after destroy`,
    !d.error && d.shaders === 0 && d.programs === 0 && d.compiled === 0, `${d.programs} programs, ${d.shaders} shaders created and ${d.compiled} compiled after destroy (want 0)${e(d)}`);
  check(`b) destroyed (${label}): pending pictures put nothing on the GPU after destroy`,
    !d.error && d.tex === 0, `${d.tex} texImage2D/texSubImage2D/texStorage2D calls after destroy (want 0)${e(d)}`);
  check(`c) destroyed (${label}): its stars are not made after destroy`,
    !d.error && d.buf === 0, `${d.buf} bufferData calls after destroy (want 0)${e(d)}`);
  check(`d) destroyed (${label}): a lost shared context prints no verdict line from it`,
    !d.error && d.lost === 0, `${d.lost} "off: the context was lost" line(s) (want 0)${e(d)}`);
}
process.exit(failed ? 1 : 0);
