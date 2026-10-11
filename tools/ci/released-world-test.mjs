/*
 * Test for a destroyed journey giving back what its world made on the GPU, written from the specification alone. The
 * page has ONE WebGL2 context; each journey's flight builds a world on it (textures, programs, shaders, buffers, vertex
 * arrays, framebuffers). Once journey.destroy() has returned, none of those objects may be left alive on the context,
 * whether the world was finished or still being made, and the next journey mounted on the same page must still be whole.
 *
 *   node tools/ci/released-world-test.mjs
 *
 * No dependencies and no browser. The page's state lives for the life of the page, so each case runs in a fresh Node
 * process (this file again, as `--child <case>`) against a stub page whose fake WebGL2 context hands out a fresh handle
 * for every create* call, records it, and marks it released on delete*. A delete* of a handle already released, or one
 * the context never made, is a fault (delete*(null) is ignored, as WebGL does). "Live" is made and not released. The
 * crop probe's own objects (upload.js: shader source with texelFetch(t, ivec2(0, 0), 0), the program built from it, the
 * texture it uploads its probe image to, the buffer it reads back) are left out of the counts. The journey is reached
 * through assets/door/index.js alone, as a host does.
 *
 *   T1 control            nothing destroyed: the counting sees what a fix must release
 *   T2 released when done  destroy a finished world: nothing live, no fault, the context not lost by it
 *   T3 released in flight  destroy before the chores open and with every fetch held: nothing live, no fault
 *   T4 next mount whole    a second journey after T2 builds its world, loses none of it, and gives it all back
 *   T5 twice is harmless   destroy() twice: no throw, no fault, nothing live
 *   T6 a lost context      webglcontextlost, then destroy: no throw, no fault
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const INDEX = "../../assets/door/index.js";
const KINDS = ["texture", "program", "shader", "buffer", "vertexArray", "framebuffer"];
const DEADLINE_MS = 45000;   /* per child; the child's own waits add up to well under it */

if (process.argv[2] === "--child") {
  const name = process.argv[3];
  const made = [], faults = [], listeners = {};
  let sharedCanvas = null, loseCalls = 0, lost = false;
  const boundTex = {}, boundBuf = {};
  const any = () => new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : any()),
    set: () => true,
    apply: () => any(),
  });
  const isProbeSrc = (s) => /texelFetch\(t, ivec2\(0, 0\), 0\)|precision mediump float; out vec4 o;/.test(String(s));
  const glBase = {
    RGBA: 1, UNSIGNED_BYTE: 2, RENDERER: 0x1f01,
    isContextLost: () => lost,
    getError: () => 0,
    getExtension(n) {
      if (n === "WEBGL_lose_context") return { loseContext() { loseCalls++; } };
      if (n === "WEBGL_debug_renderer_info") return null;
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
    getBufferSubData(t, o, out) { const b = boundBuf[t]; if (b) b.probe = true; out[0] = 0; out[1] = 1; },
    shaderSource(s, src) { if (s && s.kind === "shader") { s.src = src; if (isProbeSrc(src)) s.probe = true; } },
    attachShader(p, s) { if (p && s?.probe) p.probe = true; },
    bindTexture(t, h) { boundTex[t] = h; },
    bindBuffer(t, h) { boundBuf[t] = h; },
    texImage2D(...a) { const src = a.length === 6 ? a[5] : a[a.length - 1]; if (src?.probe && boundTex[a[0]]) boundTex[a[0]].probe = true; },
    texSubImage2D(...a) { const src = a[a.length - 1]; if (src?.probe && boundTex[a[0]]) boundTex[a[0]].probe = true; },
  };
  for (const kind of KINDS) {
    const K = kind[0].toUpperCase() + kind.slice(1);
    glBase["create" + K] = () => { const h = { kind, id: made.length, released: false, probe: false, src: "" }; made.push(h); return h; };
    glBase["delete" + K] = (h) => {
      if (h == null) return;
      if (!h || !made.includes(h) || h.kind !== kind) faults.push(`delete${K} of a handle this context never made`);
      else if (h.released) faults.push(`delete${K} of #${h.id} twice`);
      else h.released = true;
    };
  }
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
  globalThis.createImageBitmap = async (src, ...r) => {
    const cut = r.length >= 4;
    return { width: cut ? r[2] : (src.probe ? 1 : 64), height: cut ? r[3] : (src.probe ? 2 : 64), probe: !!src.probe, close() {} };
  };
  /* the pictures' fetches are held until release() (T3 holds them past the destroy) */
  let release; const gate = new Promise((r) => { release = r; });
  globalThis.fetch = () => gate.then(() => ({ ok: true, blob: async () => ({ size: 1 }) }));
  console.info = () => {}; console.warn = () => {};

  const hostCanvas = () => ({ width: 300, height: 150, style: {}, parentNode: { insertBefore() {} }, getContext: () => any(), addEventListener() {}, removeEventListener() {}, setAttribute() {} });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /* a program built from the probe's shader is the probe's; its other objects are found by binding (above) */
  const counted = (from = 0) => made.slice(from).filter((h) => !h.probe);
  const live = (from = 0) => Object.fromEntries(KINDS.map((k) => [k, counted(from).filter((h) => h.kind === k && !h.released).length]));
  const out = { error: null, loseCalls: 0 };
  try {
    const door = await import(INDEX);
    const d = door.createDoor({ typingWait: 0, flags: {} });
    const mount = () => d.journey({ canvas: hostCanvas(), name: any(), dawnGlyph: () => null, duskGlyph: () => null, on: {} });
    const quiet = async () => {
      await Promise.race([door.quiet(), sleep(6000)]); await sleep(300); await Promise.race([door.quiet(), sleep(6000)]);
    };
    const warmed = (j, opts) => Promise.race([j.warm(opts).then(() => true), sleep(15000).then(() => false)]);
    const finish = async (j) => { release(); door.openChores(); out.warmed = await warmed(j); await quiet(); };
    const tryDo = (what, fn) => { try { fn(); } catch (e) { out.threw = `${what}: ${e && e.message}`; } };

    if (name === "t3" || name === "t3control") {
      const j = mount();
      j.warm({ prove: false }).catch(() => {});
      await sleep(80);                        /* the world is begun; the chores are not open, the fetches are held */
      if (name === "t3") tryDo("destroy", () => j.destroy());
      release(); door.openChores();
      await quiet();
    } else {
      const j = mount();
      await finish(j);
      if (name === "t1") out.liveBefore = live();
      if (name === "t2" || name === "t4") { tryDo("destroy", () => j.destroy()); await sleep(50); out.isContextLost = gl.isContextLost(); }
      if (name === "t5") { tryDo("first destroy", () => j.destroy()); tryDo("second destroy", () => j.destroy()); await sleep(50); }
      if (name === "t6") {
        for (const fn of [...(listeners.webglcontextlost || [])]) fn({ type: "webglcontextlost", preventDefault() {} });
        lost = true; await sleep(50);
        tryDo("destroy", () => j.destroy()); await sleep(50);
      }
      if (name === "t4") {
        const mark = made.length, programsBefore = made.filter((h) => h.kind === "program").length;
        const j2 = mount();
        out.warmed2 = await warmed(j2); await quiet();
        const mine = counted(mark);
        out.programs2 = mine.filter((h) => h.kind === "program").length;
        out.made2 = mine.length; out.released2 = mine.filter((h) => h.released).length;
        out.early = Object.fromEntries(KINDS.map((k) => [k, mine.filter((h) => h.kind === k && h.released).length]));
        out.live2 = live(mark); out.programsBefore = programsBefore;
        tryDo("destroy second", () => j2.destroy()); await sleep(50);
      }
    }
    out.live = live(); out.faults = faults.slice(0, 5); out.nfaults = faults.length; out.loseCalls = loseCalls;
    out.probeLeft = made.filter((h) => h.probe && !h.released).length;
  } catch (e) { out.error = String(e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e); }
  process.stdout.write("RESULT " + JSON.stringify(out) + "\n");
  process.exit(0);
}

let failed = false;
const run = (name) => {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child", name], { encoding: "utf8", timeout: DEADLINE_MS, killSignal: "SIGKILL" });
  const waited = Date.now() - t0;
  if (r.error?.code === "ETIMEDOUT" || r.signal === "SIGKILL") return { error: `killed the child after waiting ${waited} ms (deadline ${DEADLINE_MS} ms)` };
  const line = (r.stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) return { error: `the child printed no result (exit ${r.status}): ${(r.stderr || "").split("\n").slice(0, 3).join(" | ")}` };
  return JSON.parse(line.slice(7));
};
const show = (live) => (live ? KINDS.map((k) => `${k} ${live[k]}`).join(", ") : "no counts");
const check = (label, r, ok, want, extra = "") => {
  const pass = !r.error && ok(r);
  const seen = r.error ? r.error : `live ${show(r.live)}; faults ${r.nfaults}${r.faults?.length ? ` (${r.faults.join("; ")})` : ""}${extra}${r.threw ? `; threw ${r.threw}` : ""}`;
  console.log(`${pass ? "ok  " : "FAIL"} ${label}: want ${want}; saw ${seen}`);
  if (!pass) failed = true;
};
const none = (r) => KINDS.every((k) => r.live[k] === 0) && r.nfaults === 0 && !r.threw;

const t1 = run("t1");
{
  const r = t1;
  check("T1 control (no destroy): the counting sees what a fix must release", r,
    (r) => r.live.texture >= 10 && r.live.program >= 3 && r.live.shader >= 4 && r.live.buffer >= 2 && r.live.vertexArray >= 2 && r.live.framebuffer >= 7 && r.nfaults === 0,
    "textures >= 10, programs >= 3, shaders >= 4, buffers >= 2, vertexArrays >= 2, framebuffers >= 7, no faults", `; warm resolved ${r.warmed}`);
}
{
  const r = run("t2");
  check("T2 released when done: destroy leaves nothing live", r,
    (r) => none(r) && r.loseCalls === 0 && r.isContextLost === false, "every kind 0, no fault, loseContext never called, context not lost",
    `; loseContext calls ${r.loseCalls}, isContextLost ${r.isContextLost}`);
}
{
  const c = run("t3control");
  check("T3 control (same timing, no destroy): the pictures are on the GPU", c, (r) => r.live.texture >= 8, "textures >= 8");
  const r = run("t3");
  check("T3 released in flight: destroy before the chores open, fetches held, then let go", r, none, "every kind 0, no fault");
}
{
  /* The second world frees some transient objects of its own while it builds (see "released early"), so "none of it was
     released by the first journey" is judged as: the second world, built after a destroy, ends with exactly the live
     objects a single journey's world has on a fresh page (T1's), and gives them all back on its own destroy. */
  const r = run("t4"), want = t1.liveBefore;
  const same = !r.error && want && r.live2 && KINDS.every((k) => r.live2[k] === want[k]);
  check("T4 the next mount is whole: built, kept as a first world is, and given back on its own destroy", r,
    (r) => none(r) && r.warmed2 === true && r.programs2 >= 3 && same,
    `second warm resolved, programs >= 3, live before its destroy equal to T1's (${show(want)}), then every kind 0 after its destroy`,
    `; second warm ${r.warmed2}, programs made ${r.programs2}, live before its destroy: ${show(r.live2)}; the world frees ${JSON.stringify(r.early)} of its own while building`);
}
{
  const r = run("t5");
  check("T5 twice is harmless: destroy() twice", r, none, "no throw, no fault, every kind 0");
}
{
  const r = run("t6");
  check("T6 a lost context: webglcontextlost, then destroy", r, (r) => r.nfaults === 0 && !r.threw, "no throw, no fault");
}
process.exit(failed ? 1 : 0);
