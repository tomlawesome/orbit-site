/*
 * Test for a remounted door's world making its own rich Earth (#35), written from the specification alone. The flight's
 * world (journey.warm()) is lean until it is asked for the rich Earth; voyage.js's wantRich() (no arguments) returns a
 * Promise that resolves (true/false) once the CURRENT flight world's rich Earth is made, and asking makes that world
 * compile and link its rich program on the page's shared WebGL context. The answer must belong to the world that is live
 * now: a host that destroys a journey and mounts a new one (Orbit remounts the door on every route change) must find
 * that the new world, asked, makes its own rich Earth, and that a stopped world's answer is never handed to it.
 *
 *   node tools/ci/rich-remount-test.mjs
 *
 * No dependencies and no browser. The page's state lives for the life of the page, so each case runs in a fresh Node
 * process (this file again, as `--child`) against a stub page whose fake WebGL2 context records every createProgram /
 * linkProgram / compileShader call. The journeys are mounted through assets/door/index.js as a host does, wantRich is
 * imported from voyage.js (the same module instance, ESM caching by URL). Chores are opened and let run to quiet.
 *
 *   control   journey A warm, then wantRich(): at least one program is linked after the ask, and the promise resolves
 *   remount   journey A warm, ask, settle; A.destroy(); journey B warm, ask: the promise is not A's, and at least one
 *             program is linked (and one shader compiled) on the context after B's ask
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const INDEX = "../../assets/door/index.js";
const VOYAGE = "../../assets/door/voyage.js";

if (process.argv[2] === "--child") {
  const how = process.argv[3];                 /* "control" | "remount" */
  let marked = 0;                              /* which ask the calls are counted against: 0 none, 1 A's, 2 B's */
  const made = { 1: { programs: 0, links: 0, compiles: 0 }, 2: { programs: 0, links: 0, compiles: 0 } };
  const any = () => new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : any()),
    set: () => true,
    apply: () => any(),
  });
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
    clientWaitSync: () => 1,
    getBufferSubData(t, o, out) { out[0] = 0; out[1] = 1; },
    createProgram() { if (marked) made[marked].programs++; return {}; },
    linkProgram() { if (marked) made[marked].links++; },
    compileShader() { if (marked) made[marked].compiles++; },
  };
  const gl = new Proxy(glBase, { get: (t, k) => (k in t ? t[k] : typeof k === "string" && /^[A-Z0-9_]+$/.test(k) ? 1 : () => any()) });
  const mkCanvas = () => {
    const c = {
      width: 300, height: 150, style: {}, id: "", setAttribute() {}, remove() {}, addEventListener() {}, removeEventListener() {},
      getContext(kind) { return kind === "webgl2" ? gl : any(); },
    };
    return c;
  };
  const stubEl = () => ({
    style: {}, classList: { add() {}, remove() {}, contains: () => false }, dataset: {}, setAttribute() {}, getAttribute: () => null,
    addEventListener() {}, removeEventListener() {}, clientWidth: 1280, clientHeight: 800,
    getBoundingClientRect: () => ({ left: 0, top: 0, x: 0, y: 0, width: 1280, height: 800, right: 1280, bottom: 800 }),
  });
  globalThis.document = {
    hidden: false, baseURI: "http://localhost/", body: stubEl(), documentElement: stubEl(),
    addEventListener() {}, removeEventListener() {},
    querySelector: () => stubEl(), querySelectorAll: () => [],
    createElement: () => mkCanvas(), createTextNode: () => any(),
  };
  globalThis.window = globalThis;
  globalThis.devicePixelRatio = 1; globalThis.screen = { width: 1280, height: 800 };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
  globalThis.innerWidth = 1280; globalThis.innerHeight = 800;
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 2);
  globalThis.cancelAnimationFrame = clearTimeout;
  globalThis.requestIdleCallback = (f) => setTimeout(f, 5);
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
  globalThis.Path2D = class { constructor() { return any(); } };
  globalThis.ImageData = class { constructor() { this.probe = true; } };
  globalThis.createImageBitmap = async (src) => ({ width: 64, height: 64, probe: !!src.probe, close() {} });
  globalThis.fetch = async () => ({ ok: true, blob: async () => ({ size: 1 }) });
  console.info = () => {}; console.warn = () => {};

  const hostCanvas = () => ({ width: 300, height: 150, style: {}, parentNode: { insertBefore() {} }, getContext: () => any(), addEventListener() {}, removeEventListener() {}, setAttribute() {} });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { error: null };
  try {
    const door = await import(INDEX);
    const { wantRich } = await import(VOYAGE);
    const d = door.createDoor({ typingWait: 0, flags: {} });
    const mount = () => d.journey({ canvas: hostCanvas(), name: any(), dawnGlyph: () => null, duskGlyph: () => null, on: {} });
    const settle = async () => {
      await Promise.race([door.quiet(), sleep(6000)]); await sleep(300); await Promise.race([door.quiet(), sleep(6000)]);
    };
    const state = (p) => Promise.race([p.then((v) => `resolved ${v}`, () => "rejected"), sleep(200).then(() => "pending")]);
    const A = mount();
    door.openChores();
    await A.warm({ prove: false }); await settle();
    marked = 1;
    const askA = wantRich();
    await settle();
    out.a = { ...made[1], promise: askA instanceof Promise, state: await state(askA) };
    if (how === "remount") {
      A.destroy(); await sleep(50);
      const B = mount();
      await B.warm({ prove: false }); await settle();
      marked = 2;
      const askB = wantRich();
      await settle();
      out.b = { ...made[2], promise: askB instanceof Promise, same: askB === askA, state: await state(askB) };
    }
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

{
  const r = run("control"), a = r.a, e = r.error ? `; ${r.error}` : "";
  check("control: journey A's world, asked for the rich Earth, links a program (the check can pass)",
    !r.error && !!a && a.promise && a.links >= 1 && a.compiles >= 1, `${JSON.stringify(a)} (want a Promise, 1 or more program links and shader compiles after the ask)${e}`);
  check("control: A's promise resolves", !r.error && !!a && a.state === "resolved true", `${a?.state} (want resolved true)${e}`);
}
{
  const r = run("remount"), a = r.a, b = r.b, e = r.error ? `; ${r.error}` : "";
  check("remount: A's own ask made its rich Earth first (the setup holds)", !r.error && !!a && a.links >= 1, `A: ${JSON.stringify(a)}${e}`);
  check("remount: B's ask returns a promise that is not A's (a stopped world's answer is not handed on)",
    !r.error && !!b && b.promise && b.same === false, `same promise as A's: ${b?.same} (want false)${e}`);
  check("remount: B's world links a program after B's ask (it makes its own rich Earth)",
    !r.error && !!b && b.links >= 1 && b.compiles >= 1, `after B's ask: ${b?.programs} programs created, ${b?.links} linked, ${b?.compiles} shaders compiled (want 1 or more linked and compiled)${e}`);
  check("remount: B's promise resolves", !r.error && !!b && b.state === "resolved true", `${b?.state} (want resolved true)${e}`);
}
process.exit(failed ? 1 : 0);
