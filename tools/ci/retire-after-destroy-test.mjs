/*
 * Test for a world proof that outlives its journey (#2), written from the specification alone: after
 * journey.destroy(), a warm-up of the flight's world that was already under way (journey.warm(): the world's shaders,
 * its test frames, its fitness test) never retires the page's shared WebGL context. The page has ONE context (fitness.js
 * gpu(), canvas #warpgl); a world judged too slow lets it go (removes the canvas, loses the context), which is right
 * for a journey still there and wrong for one that has gone, because a journey mounted afterwards on the same page
 * would find its context dead and draw no world.
 *
 *   node tools/ci/retire-after-destroy-test.mjs
 *
 * No dependencies and no browser. The page's state lives for the life of the page, so each case runs in a fresh Node
 * process (this file again, as `--child`) against a stub page: a fake WebGL2 context that takes any call, whose frames
 * are made slow by its readPixels (the fitness test syncs every frame with one), so the world is judged unfit; the
 * journey is reached through assets/door/index.js alone, as a host does. The journey is destroyed at the first
 * readPixels of the proof, so the proof is under way when it goes. The control (no destroy) must retire the world, or the
 * other cases prove nothing.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const INDEX = "../../assets/door/index.js";
const SLOW_MS = 40;   /* over FIT_MS (30) for every timed frame */

if (process.argv[2] === "--child") {
  const how = process.argv[3];
  const ev = { removed: 0, lost: 0, glLost: false, readPixels: 0, inserted: [], contexts: 0 };
  let journey = null, destroyed = false;
  const spin = (ms) => { const t = performance.now(); while (performance.now() - t < ms) { /* a slow frame */ } };
  const any = () => new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : any()),
    set: () => true,
    apply: () => any(),
  });
  const glBase = {
    RGBA: 1, UNSIGNED_BYTE: 2, RENDERER: 0x1f01,
    isContextLost: () => ev.glLost,
    getError: () => 0,
    getExtension(name) {
      if (name === "WEBGL_lose_context") return { loseContext() { ev.lost++; ev.glLost = true; } };
      if (name === "WEBGL_debug_renderer_info") return null;
      return { COMPLETION_STATUS_KHR: 0x91b1 };
    },
    getParameter: () => "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)",
    getProgramParameter: () => true,
    getShaderParameter: () => true,
    getProgramInfoLog: () => "", getShaderInfoLog: () => "",
    getActiveUniform: (p, i) => ({ name: `u${i}` }),
    getUniformLocation: (p, n) => ({ n }),
    checkFramebufferStatus: () => 0x8cd5,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    readPixels() {
      ev.readPixels++;
      /* the first synced draw of the proof: the journey goes while its proof is under way */
      if (how !== "control" && ev.readPixels === 1 && journey && !destroyed) { destroyed = true; journey.destroy(); }
      spin(SLOW_MS);
    },
  };
  const gl = new Proxy(glBase, { get: (t, k) => (k in t ? t[k] : typeof k === "string" && /^[A-Z0-9_]+$/.test(k) ? 1 : () => any()) });
  const mkCanvas = () => {
    const c = {
      width: 300, height: 150, style: {}, id: "", setAttribute() {}, addEventListener() {}, removeEventListener() {},
      remove() { ev.removed++; },
      getContext(kind) { if (kind === "webgl2") { ev.contexts++; return gl; } return any(); },
    };
    return c;
  };
  globalThis.document = {
    hidden: false, body: { classList: { add() {}, remove() {}, contains: () => false } },
    addEventListener() {}, removeEventListener() {},
    createElement: () => mkCanvas(),
    createTextNode: () => any(),
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
  globalThis.fetch = () => Promise.reject(new Error("no network here"));   /* the pictures are drawn without */

  /* a journey's host canvas: a 2D canvas in a parent, where the world's canvas goes under it */
  const hostCanvas = () => {
    const parent = { insertBefore(c) { ev.inserted.push(c); } };
    return { width: 300, height: 150, style: {}, parentNode: parent, getContext: () => any(), addEventListener() {}, removeEventListener() {}, setAttribute() {} };
  };
  const out = { error: null };
  try {
    const door = await import(INDEX);
    const d = door.createDoor({ typingWait: 0, flags: {} });
    const mount = () => d.journey({ canvas: hostCanvas(), name: any(), dawnGlyph: () => null, duskGlyph: () => null, on: {} });
    journey = mount();
    door.openChores();
    const proof = journey.warm();
    await Promise.race([proof, new Promise((r) => setTimeout(r, 15000))]);
    await new Promise((r) => setTimeout(r, 200));   /* whatever the proof does last */
    out.afterProof = { removed: ev.removed, lost: ev.lost, glLost: ev.glLost, readPixels: ev.readPixels, destroyed };
    if (how === "second") {
      /* a journey mounted afterwards on the same page: its world gets the page's context, if there is one still live */
      const before = ev.inserted.length;
      const second = mount();
      await second.warm({ prove: false });
      out.second = { insertedCanvases: ev.inserted.length - before, glLost: ev.glLost, contexts: ev.contexts };
    }
  } catch (e) { out.error = String(e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e); }
  console.log("RESULT " + JSON.stringify(out));
  process.exit(0);
}

let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};
const run = (how) => {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child", how], { encoding: "utf8", timeout: 60000 });
  const line = (r.stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) return { error: `the child printed no result (exit ${r.status}): ${(r.stderr || "").split("\n").slice(0, 3).join(" | ")}` };
  return JSON.parse(line.slice(7));
};

{
  const r = run("control");
  const a = r.afterProof;
  check("control: a journey that stays, and a world too slow for it, retires the context (canvas removed, context lost)",
    !r.error && !!a && a.removed >= 1 && a.lost >= 1, `${JSON.stringify(a)}${r.error ? "; " + r.error : ""}`);
}
{
  const r = run("destroyed");
  const a = r.afterProof;
  check("the proof was under way when the journey was destroyed (the test reached the proof's first synced draw)", !r.error && !!a && a.destroyed === true, `${JSON.stringify(a)}${r.error ? "; " + r.error : ""}`);
  check("after journey.destroy(), the proof under way does not remove the shared canvas", !r.error && !!a && a.removed === 0, `canvas.remove() called ${a?.removed} time(s) (want 0)`);
  check("after journey.destroy(), the proof under way does not lose the shared context", !r.error && !!a && a.lost === 0 && a.glLost === false, `WEBGL_lose_context.loseContext() called ${a?.lost} time(s) (want 0)`);
}
{
  const r = run("second");
  const s = r.second;
  check("a journey mounted after that still has a live context, and its world is put under its canvas",
    !r.error && !!s && s.glLost === false && s.insertedCanvases >= 1, `${JSON.stringify(s)}${r.error ? "; " + r.error : ""} (want the context not lost, a canvas inserted)`);
}
process.exit(failed ? 1 : 0);
