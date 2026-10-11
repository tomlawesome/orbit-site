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
 * the context never made, is a fault (delete*(null) is ignored, as WebGL does). "Live" is made and not released. Each
 * canvas that asks for webgl2 gets its own fake context; the page's shared one (the gate's, the first made, which the probe
 * and the flight's world use) is judged, the others (the live door's own, made once a page) are printed, not judged. The
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
 *   T7 released mid-upload destroy at the first chore (they are run one at a time) that leaves a picture with some of
 *                          its bands in and no mipmaps; T7b: right after the first texSubImage2D. Nothing live, no fault
 *   T8 no link             every program fails to link: warm, quiet, destroy: nothing live, no fault, context kept
 *   T9 stopped in the gap  destroy once a picture has its last band in and not its mipmaps: no fault (no bind of a
 *                          released handle), nothing live, no mipmap or texParameter call afterwards on a texture the
 *                          stopped world did not make
 *   T10 a rich world       the flags that make the live door rich (door3d, level 2, rich) make the flight's rich Earth: at
 *                          least two textures more than T1's (the programs are T1's); all given back on destroy
 *   Every case also fails if the page swallows anything while the world is made: a warning, an error, an unhandled
 *   rejection, or a read of a document member the fake page lacks (so a gap in this fake cannot hide).
 *
 * The fake context also answers isTexture/isProgram/... as WebGL does, and treats a bind or useProgram of a released
 * handle as a fault (in WebGL it is INVALID_OPERATION and leaves the old binding, so later writes go to another object).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const INDEX = "../../assets/door/index.js";
const KINDS = ["texture", "program", "shader", "buffer", "vertexArray", "framebuffer"];
const DEADLINE_MS = 45000;   /* per child; the child's own waits add up to well under it */

if (process.argv[2] === "--child") {
  const name = process.argv[3];
  const made = [], faults = [], listeners = {};
  let sharedCanvas = null, loseCalls = 0, lost = false, afterDestroy = false, touches = 0, lateTexCalls = 0, onBand = null;
  const foreign = [], noLink = name === "t8", TEX2D = 0x0de1;
  const others = [];   /* the handles of every context after the gate's (the first made); the gate's are in `made` */
  const any = () => new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : any()),
    set: () => true,
    apply: () => any(),
  });
  const isProbeSrc = (s) => /texelFetch\(t, ivec2\(0, 0\), 0\)|precision mediump float; out vec4 o;/.test(String(s));
  /* one fake context per canvas that asks for webgl2: its own handles and bindings; the fault list is shared */
  const makeGl = (made) => {
  const boundTex = {}, boundBuf = {};
  const glBase = {
    RGBA: 1, UNSIGNED_BYTE: 2, RENDERER: 0x1f01, NO_ERROR: 0, LINK_STATUS: 0x8b82, COMPILE_STATUS: 0x8b81,
    TEXTURE_2D: TEX2D, TEXTURE_3D: 0x806f, TEXTURE_2D_ARRAY: 0x8c1a, TEXTURE_CUBE_MAP: 0x8513,
    isContextLost: () => lost,
    getError: () => 0,
    getExtension(n) {
      if (n === "WEBGL_lose_context") return { loseContext() { loseCalls++; } };
      if (n === "WEBGL_debug_renderer_info") return null;
      return { COMPLETION_STATUS_KHR: 0x91b1 };
    },
    getParameter: (n) => (n === 0x1f01 ? "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)" : 4096),
    getProgramParameter: (p, n) => !(noLink && n === 0x8b82), getShaderParameter: () => true,
    getProgramInfoLog: () => "", getShaderInfoLog: () => "",
    getActiveUniform: (p, i) => ({ name: `u${i}` }),
    getUniformLocation: (p, n) => ({ n }),
    checkFramebufferStatus: () => 0x8cd5, FRAMEBUFFER_COMPLETE: 0x8cd5,
    readPixels() {},
    clientWaitSync: () => 1,
    getBufferSubData(t, o, out) { const b = boundBuf[t]; if (b) b.probe = true; out[0] = 0; out[1] = 1; },
    shaderSource(s, src) { if (s && s.kind === "shader") { s.src = src; if (isProbeSrc(src)) s.probe = true; } },
    attachShader(p, s) { if (p && s?.probe) p.probe = true; },
    /* binding a released handle is INVALID_OPERATION in WebGL and leaves the old binding in place: a fault here */
    bindTexture(t, h) { if (afterDestroy) touches++; if (bindOk("bindTexture", h)) boundTex[t] = h; },
    bindBuffer(t, h) { if (bindOk("bindBuffer", h)) boundBuf[t] = h; },
    bindFramebuffer(t, h) { bindOk("bindFramebuffer", h); },
    bindVertexArray(h) { bindOk("bindVertexArray", h); },
    useProgram(p) { bindOk("useProgram", p); },
    generateMipmap(t) { if (afterDestroy) touches++; texCall(t); if (boundTex[t]) boundTex[t].mip = true; },
    texParameteri(t) { texCall(t); }, texParameterf(t) { texCall(t); }, texParameteriv(t) { texCall(t); }, texParameterfv(t) { texCall(t); },
    texStorage2D(t, lv, f, w, h) { const b = boundTex[t]; if (b) { b.height = h; b.alloc = true; } },
    texImage2D(...a) { if (afterDestroy) touches++; image(a[0], a[a.length - 1], false, a); },
    texSubImage2D(...a) { if (afterDestroy) touches++; image(a[0], a[a.length - 1], true, a); },
  };
  const bindOk = (what, h) => { if (h && h.released) { faults.push(`${what} of released ${h.kind} #${h.id}`); return false; } return true; };
  /* after destroy, a mipmap or parameter call must not land on a texture the stopped world did not make (a probe's, or none of its own) */
  const texCall = (t) => {
    if (!afterDestroy || t !== TEX2D) return;
    lateTexCalls++;
    const b = boundTex[t];
    if (b && (b.probe || !made.includes(b))) foreign.push(`${b.kind} #${b.id}`);
  };
  /* a picture's pixels reaching a texture: it is then a picture texture ("got"), "last" once its whole height is in,
     until its mipmaps are made */
  const image = (t, src, band, a) => {
    const h = boundTex[t];
    if (!h) return;
    if (src?.probe) { h.probe = true; return; }
    const pixels = src && typeof src === "object" && !ArrayBuffer.isView(src);
    if (!band && a.length >= 9 && a[1] === 0) h.height = a[4];                        /* an allocation */
    if (!pixels) return;
    h.got = true;
    if (!band) h.last = true;
    else if (a[1] === 0) {
      h.cover = Math.max(h.cover || 0, a[3] + (a.length >= 9 ? a[5] : src.height));
      if (h.height && h.cover >= h.height) h.last = true;
    }
    if (band && onBand) onBand();
  };
  for (const kind of KINDS) {
    const K = kind[0].toUpperCase() + kind.slice(1);
    glBase["create" + K] = () => { if (afterDestroy && kind === "texture") touches++; const h = { kind, id: made.length, released: false, probe: false, pre: !afterDestroy, src: "" }; made.push(h); return h; };
    glBase["is" + K] = (h) => !!h && h.kind === kind && made.includes(h) && !h.released;
    glBase["delete" + K] = (h) => {
      if (h == null) return;
      if (!h || !made.includes(h) || h.kind !== kind) faults.push(`delete${K} of a handle this context never made`);
      else if (h.released) faults.push(`delete${K} of #${h.id} twice`);
      else { h.released = true; for (const m of [boundTex, boundBuf]) for (const k in m) if (m[k] === h) m[k] = null; }
    };
  }
  return new Proxy(glBase, { get: (t, k) => (k in t ? t[k] : typeof k === "string" && /^[A-Z0-9_]+$/.test(k) ? 1 : () => any()) });
  };
  let gateGl = null;
  const mkCanvas = () => {
    const c = {
      width: 300, height: 150, style: {}, id: "", setAttribute() {}, remove() {},
      addEventListener(type, fn) { if (c === sharedCanvas) (listeners[type] ||= []).push(fn); },
      removeEventListener(type, fn) { if (c === sharedCanvas && listeners[type]) listeners[type] = listeners[type].filter((f) => f !== fn); },
      getContext(kind) {
        if (kind !== "webgl2") return any();
        sharedCanvas ||= c;
        if (c === sharedCanvas) return (gateGl ||= makeGl(made));
        if (!c.ctx) { const arr = []; others.push(arr); c.ctx = makeGl(arr); }
        return c.ctx;
      },
    };
    return c;
  };
  /* a page element as far as the door reads one: it has the window's size */
  const stubEl = () => ({
    style: {}, classList: { add() {}, remove() {}, contains: () => false }, dataset: {}, setAttribute() {}, getAttribute: () => null,
    addEventListener() {}, removeEventListener() {},
    get clientWidth() { return globalThis.innerWidth; }, get clientHeight() { return globalThis.innerHeight; },
    getBoundingClientRect() { return { left: 0, top: 0, x: 0, y: 0, width: globalThis.innerWidth, height: globalThis.innerHeight, right: globalThis.innerWidth, bottom: globalThis.innerHeight }; },
  });
  /* what the engine swallows must not hide a gap in this fake page: a document member the page does not have, a warning,
     an error or an unhandled rejection while the world is made is recorded here and fails the case */
  const swallowed = [];
  globalThis.document = new Proxy({
    hidden: false, baseURI: "http://localhost/", body: stubEl(), documentElement: stubEl(),
    addEventListener() {}, removeEventListener() {},
    querySelector: () => stubEl(), querySelectorAll: () => [],
    createElement: () => mkCanvas(), createTextNode: () => any(),
  }, { get: (t, k) => { if (typeof k === "string" && !(k in t) && k !== "then") swallowed.push(`document.${k} is not in the fake page`); return t[k]; } });
  globalThis.window = globalThis;
  globalThis.devicePixelRatio = 1; globalThis.screen = { width: 1280, height: 800 };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
  globalThis.innerWidth = 1280; globalThis.innerHeight = 800;
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 2);
  globalThis.cancelAnimationFrame = clearTimeout;
  const idle = []; let manual = false;
  globalThis.requestIdleCallback = (f) => { if (manual) idle.push(f); else setTimeout(f, 5); };
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
  const said = [];
  console.info = (...a) => { said.push(a.join(" ")); }; console.warn = (...a) => { said.push(a.join(" ")); if (name !== "t8") swallowed.push("console.warn: " + a.join(" ").slice(0, 160)); };   /* t8: a world that cannot link says so */
  console.error = (...a) => { swallowed.push("console.error: " + a.join(" ").slice(0, 160)); };
  process.on("uncaughtException", (e) => swallowed.push("uncaught: " + (e && e.message))); process.on("unhandledRejection", (e) => swallowed.push("unhandled rejection: " + (e && e.message)));

  const hostCanvas = () => ({ width: 300, height: 150, style: {}, parentNode: { insertBefore() {} }, getContext: () => any(), addEventListener() {}, removeEventListener() {}, setAttribute() {} });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /* a program built from the probe's shader is the probe's; its other objects are found by binding (above) */
  const counted = (from = 0) => made.slice(from).filter((h) => !h.probe);
  const liveOf = (arr) => Object.fromEntries(KINDS.map((k) => [k, arr.filter((h) => !h.probe && h.kind === k && !h.released).length]));
  const live = (from = 0) => Object.fromEntries(KINDS.map((k) => [k, counted(from).filter((h) => h.kind === k && !h.released).length]));
  const out = { error: null, loseCalls: 0 };
  try {
    const door = await import(INDEX);
    /* T10: the flags a page sets to have the live door rich (CAPABILITIES.md: ?door3d, ?level=2, &rich) */
    const flags = name === "t10" ? { door3d: "1", level: "2", rich: "1" } : {};
    const d = door.createDoor({ typingWait: 0, flags });
    const mount = () => d.journey({ canvas: hostCanvas(), name: any(), dawnGlyph: () => null, duskGlyph: () => null, on: {} });
    const quiet = async () => {
      await Promise.race([door.quiet(), sleep(6000)]); await sleep(300); await Promise.race([door.quiet(), sleep(6000)]);
    };
    const warmed = (j, opts) => Promise.race([j.warm(opts).then(() => true, (e) => `rejected: ${e && e.message}`), sleep(15000).then(() => false)]);
    const finish = async (j) => { release(); door.openChores(); out.warmed = await warmed(j); await quiet(); };
    const tryDo = (what, fn) => { try { fn(); } catch (e) { out.threw = `${what}: ${e && e.message}`; } };

    if (name === "t7" || name === "t7b" || name === "t9") {
      const j = mount();
      j.warm({ prove: false }).catch(() => {});
      await sleep(80);
      const texes = () => made.filter((h) => h.kind === "texture" && !h.probe && !h.released);
      const partway = () => texes().filter((h) => h.got && !h.mip).length;   /* some band in, mipmaps not yet */
      const gap = () => texes().filter((h) => h.last && !h.mip).length;      /* the last band in, mipmaps not yet */
      const here = name === "t9" ? gap : partway;
      const goDown = () => {
        if (afterDestroy) return;
        out.pendingAtDestroy = here();
        tryDo("destroy", () => j.destroy()); afterDestroy = true;
      };
      if (name === "t7b") onBand = () => { onBand = null; goDown(); };
      else manual = true;
      release(); door.openChores();
      /* t7, t9 run the idle chores one at a time and go down at the first chore that leaves a picture where they want it */
      for (let t0 = Date.now(); !afterDestroy && Date.now() - t0 < 8000;) {
        if (idle.length) idle.shift()();
        await sleep(idle.length ? 0 : 2);
        if (name !== "t7b" && here() > 0) goDown();
      }
      out.reached = afterDestroy && out.pendingAtDestroy > 0;
      manual = false; while (idle.length) setTimeout(idle.shift(), 5);
      await quiet();
    } else if (name === "t8") {
      const j = mount();
      await finish(j);
      out.liveQuiet = live();
      tryDo("destroy", () => j.destroy());
      await quiet();
      out.isContextLost = lost;
    } else if (name === "t3" || name === "t3control") {
      const j = mount();
      j.warm({ prove: false }).catch(() => {});
      await sleep(80);                        /* the world is begun; the chores are not open, the fetches are held */
      if (name === "t3") tryDo("destroy", () => j.destroy());
      release(); door.openChores();
      await quiet();
    } else {
      const j = mount();
      await finish(j);
      if (name === "t1" || name === "t10") out.liveBefore = live();
      if (name === "t10") { tryDo("destroy", () => j.destroy()); await sleep(50); }
      if (name === "t2" || name === "t4") { tryDo("destroy", () => j.destroy()); await sleep(50); out.isContextLost = lost; }
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
    out.swallowed = [...new Set(swallowed)].slice(0, 5); out.others = others.map(liveOf); out.said = said.slice(0, 8); out.touches = touches; out.lateTexCalls = lateTexCalls; out.foreign = foreign.slice(0, 5); out.nforeign = foreign.length; out.probeLeft = made.filter((h) => h.probe && !h.released).length;
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
  const pass = !r.error && !r.swallowed?.length && ok(r);
  const seen = r.error ? r.error : `live ${show(r.live)}; faults ${r.nfaults}${r.faults?.length ? ` (${r.faults.join("; ")})` : ""}${r.others?.length ? `; other contexts (not judged): ${r.others.map(show).join(" | ")}` : ""}${extra}${r.threw ? `; threw ${r.threw}` : ""}${r.swallowed?.length ? `; SWALLOWED (a harness gap or a hidden fault): ${r.swallowed.join(" | ")}` : ""}`;
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
for (const [label, name] of [["T7 released mid-upload: destroy at the first chore that leaves a picture part-way", "t7"], ["T7b released after the first band: destroy right after the first texSubImage2D", "t7b"]]) {
  const r = run(name);
  const ev = (r) => (r.reached ? "" : `did not reach mid-upload (pictures part-way at destroy ${r.pendingAtDestroy})`);
  check(label, r, (r) => none(r) && !ev(r), "every kind 0, no fault; a picture part-way at destroy",
    `; part-way pictures at destroy ${r.pendingAtDestroy}, texture calls after destroy ${r.touches} (not judged)${ev(r) ? "; " + ev(r) : ""}`);
}
{
  const r = run("t8");
  check("T8 a world whose shaders do not link: warm, quiet, destroy", r,
    (r) => none(r) && r.loseCalls === 0 && r.isContextLost === false, "every kind 0, no fault, loseContext never called, context not lost",
    `; live at quiet before destroy: ${show(r.liveQuiet)} (not judged); warm ${r.warmed}; loseContext calls ${r.loseCalls}, isContextLost ${r.isContextLost}`);
}
{
  const r = run("t9");
  const ev = (r) => (r.reached ? "" : `did not reach the gap (pictures with their last band in and no mipmaps at destroy: ${r.pendingAtDestroy})`);
  check("T9 stopped between a picture's last band and its mipmaps", r, (r) => none(r) && !ev(r) && r.nforeign === 0,
    "every kind 0, no fault (no bind of a released handle), no mipmap or texParameter call after destroy on a texture the stopped world did not make",
    `; pictures in the gap at destroy ${r.pendingAtDestroy}; mipmap/texParameter calls after destroy ${r.lateTexCalls}, on a foreign texture ${r.nforeign}${r.foreign?.length ? " (" + r.foreign.join(", ") + ")" : ""}${ev(r) ? "; " + ev(r) : ""}`);
}
{
  /* The flags make the live door rich (CAPABILITIES.md: door3d, level 2, rich). The rich Earth replaces the lean one in the
     same program count (the cloud field and glow are folded into it), so the programs are T1's and the extra is textures
     (the cloud fields, the city glow): at least two more. The page must also have said it chose the rich weight. */
  const r = run("t10"), b = t1.liveBefore, l = r.liveBefore;
  const rich = (r.said || []).some((x) => /level 2: live rich/.test(x)) && (r.said || []).some((x) => /weight rich/.test(x));
  check("T10 a rich world (door3d, level 2, rich): built richer than T1's, then given back", r,
    (r) => none(r) && !!b && !!l && rich && l.program >= b.program && l.texture >= b.texture + 2,
    `the page says level 2 and weight rich; at quiet before destroy programs >= ${b?.program} and textures >= ${b?.texture + 2} (T1's ${show(b)}; programs the same, textures plus 2), then every kind 0, no fault`,
    `; at quiet before destroy: ${show(l)}; chose rich: ${rich}`);
}
process.exit(failed ? 1 : 0);
