/*
 * Test for the door setting flags.fit: "skip" (#38), written from the specification alone. It leaves out the flight
 * world's fitness speed test, so a tool that draws pictures on software GL (tools/docsky.cjs) is not told its world is
 * too slow. It does not grant the GPU: a software renderer still needs gpu: "force" (one switch per question, ADR-0002).
 *
 *   node tools/ci/fit-skip-test.mjs
 *
 * No dependencies and no browser. The page's state lives for the life of the page, so each case runs in a fresh Node
 * process (this file again, as `--child <case>`) against a stub page whose fake WebGL2 context reports a software
 * renderer and makes every draw call take 50 ms on the page's clock (so every timed frame is slow). The journey is
 * reached through assets/door/index.js alone, as a host does, and its verdict is read from the console line
 * "orbit · flight world: ...".
 *
 *   control   flags { gpu: "force" }                 slow frames: the world is let go, "off: frame N ms"
 *   skip      flags { gpu: "force", fit: "skip" }    slow frames: not let go, "on (fitness skipped)", no "off"
 *   no force  flags { fit: "skip" }, software GL     still refused: "off: software renderer"
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const INDEX = "../../assets/door/index.js";
const CASES = {
  control: { gpu: "force" },
  skip: { gpu: "force", fit: "skip" },
  noforce: { fit: "skip" },
};

if (process.argv[2] === "--child") {
  const name = process.argv[3];
  const flags = CASES[name];
  let skew = 0;                                   /* the milliseconds the fake GPU has taken, added to the page's clock */
  const realNow = performance.now.bind(performance);
  Object.defineProperty(globalThis.performance, "now", { configurable: true, writable: true, value: () => realNow() + skew });
  const any = () => new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : any()),
    set: () => true,
    apply: () => any(),
  });
  const slow = () => { skew += 50; };
  const glBase = {
    RGBA: 1, UNSIGNED_BYTE: 2, RENDERER: 0x1f01,
    isContextLost: () => false,
    getError: () => 0,
    getExtension(n) {
      if (n === "WEBGL_lose_context") return { loseContext() {} };
      if (n === "WEBGL_debug_renderer_info") return null;
      return { COMPLETION_STATUS_KHR: 0x91b1 };
    },
    getParameter: (n) => (n === 0x1f01 ? "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)" : 4096),
    getProgramParameter: () => true, getShaderParameter: () => true,
    getProgramInfoLog: () => "", getShaderInfoLog: () => "",
    getActiveUniform: (p, i) => ({ name: `u${i}` }),
    getUniformLocation: (p, n) => ({ n }),
    checkFramebufferStatus: () => 0x8cd5, FRAMEBUFFER_COMPLETE: 0x8cd5,
    readPixels() {},
    clientWaitSync: () => 1,
    getBufferSubData(t, o, out) { out[0] = 0; out[1] = 1; },
    drawArrays: slow, drawElements: slow, drawArraysInstanced: slow, drawElementsInstanced: slow, clear: slow,
  };
  const gl = new Proxy(glBase, { get: (t, k) => (k in t ? t[k] : typeof k === "string" && /^[A-Z0-9_]+$/.test(k) ? 1 : () => any()) });
  let sharedCanvas = null;
  const mkCanvas = () => {
    const c = {
      width: 300, height: 150, style: {}, id: "", setAttribute() {}, remove() {},
      addEventListener() {}, removeEventListener() {},
      getContext(kind) { if (kind === "webgl2") { sharedCanvas ||= c; return c === sharedCanvas ? gl : any(); } return any(); },
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
  globalThis.createImageBitmap = async (src, ...r) => {
    const cut = r.length >= 4;
    return { width: cut ? r[2] : (src.probe ? 1 : 64), height: cut ? r[3] : (src.probe ? 2 : 64), probe: !!src.probe, close() {} };
  };
  globalThis.fetch = async () => ({ ok: true, blob: async () => ({ size: 1 }) });
  const lines = [];
  console.info = (...a) => { lines.push(a.join(" ")); };
  console.log = console.info;
  console.warn = (...a) => { lines.push(a.join(" ")); };

  const hostCanvas = () => ({ width: 300, height: 150, style: {}, parentNode: { insertBefore() {} }, getContext: () => any(), addEventListener() {}, removeEventListener() {}, setAttribute() {} });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { error: null };
  try {
    const door = await import(INDEX);
    const d = door.createDoor({ typingWait: 0, flags });
    const j = d.journey({ canvas: hostCanvas(), name: any(), dawnGlyph: () => null, duskGlyph: () => null, on: {} });
    door.openChores();
    out.warmed = await Promise.race([j.warm().then(() => true, (e) => `rejected: ${e && e.message}`), sleep(20000).then(() => "timeout")]);
    await Promise.race([door.quiet(), sleep(6000)]);
    await sleep(300);
    out.verdicts = lines.filter((l) => /flight world:/.test(l));
    out.skewed = skew;
  } catch (e) { out.error = String(e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e); }
  process.stdout.write("RESULT " + JSON.stringify(out) + "\n");
  process.exit(0);
}

let failed = false;
const check = (label, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${detail}`);
  if (!ok) failed = true;
};
const run = (name) => {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child", name], { encoding: "utf8", timeout: 90000 });
  const line = (r.stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) return { error: `the child printed no result (exit ${r.status}): ${(r.stderr || "").split("\n").slice(0, 3).join(" | ")}`, verdicts: [] };
  return JSON.parse(line.slice(7));
};
const said = (r) => `${r.error ? r.error + "; " : ""}lines ${JSON.stringify(r.verdicts)}`;
const has = (r, re) => (r.verdicts || []).some((l) => re.test(l));

const control = run("control");
check("control (force, slow frames): the world is let go with an \"off: frame\" line",
  !control.error && has(control, /flight world: off: frame \d/) && !has(control, /flight world: on/), said(control));
check("control: the frames really were slow (the fake clock moved)", !control.error && control.skewed > 0, `clock moved ${control.skewed} ms`);

const skip = run("skip");
check("skip (force + fit skip, slow frames): the verdict line says the fitness test was skipped",
  !skip.error && has(skip, /flight world: on \(fitness skipped\)/), said(skip));
check("skip: the world is not let go for a slow frame", !skip.error && !has(skip, /flight world: off/), said(skip));

const noforce = run("noforce");
check("fit skip without force on a software renderer: still refused",
  !noforce.error && has(noforce, /flight world: off: software renderer/) && !has(noforce, /flight world: on/), said(noforce));

process.exit(failed ? 1 : 0);
