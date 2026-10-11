/*
 * Test for light() on a destroyed dawn (#27, #2), written from the specification alone: a dawn that has been
 * destroyed (dawn.destroy()) does nothing when light() is called on it. In particular light() does not run the page's
 * GPU test: no WebGL context is made and the GPU verdict (fitness.js gpu()) is not decided by that call, even when the
 * host gives no `aside` option (whose default asks the GPU gate).
 *
 *   node tools/ci/dawn-destroyed-light-test.mjs
 *
 * No dependencies and no browser. The GPU verdict lives for the life of the page, so each case runs in a fresh Node
 * process (this file again, as `--child`) with a stub page whose canvases hand out a fake WebGL2 context and count
 * every one asked for; the dawn is mounted on a stub host and reached through assets/door/index.js alone, as a host
 * does. A live dawn's light() is the control: it must ask the gate (so the count in the other cases means something).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const INDEX = "../../assets/door/index.js";

if (process.argv[2] === "--child") {
  const how = process.argv[3];
  const asked = [];
  const gl = {
    RENDERER: 0x1f01, RGBA: 1, UNSIGNED_BYTE: 2, readPixels() {},
    getExtension: (n) => (n === "WEBGL_debug_renderer_info" ? null : n === "KHR_parallel_shader_compile" ? {} : null),
    getParameter: () => "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)",
  };
  /* a stub element for the dawn's markup: any property is another stub, any call answers one, so the mounting runs */
  const any = () => new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : k === "classList" ? { add() {}, remove() {}, contains: () => false } : k === "clientWidth" || k === "clientHeight" ? 800 : any()),
    set: () => true,
    apply: () => any(),
  });
  const canvases = [];
  const body = { classList: { add() {}, remove() {}, contains: () => false } };
  globalThis.document = {
    hidden: false, body, fonts: { ready: Promise.resolve() },
    addEventListener() {}, removeEventListener() {},
    createElement: (tag) => {
      const c = { width: 300, height: 150, style: {}, addEventListener() {}, removeEventListener() {}, setAttribute() {}, remove() {},
        getContext(kind, attrs) { asked.push({ kind, attrs: attrs ?? null }); return gl; } };
      if (tag === "canvas") canvases.push(c);
      return c;
    },
    createElementNS: () => any(),
    createTextNode: () => any(),
  };
  globalThis.window = globalThis;
  globalThis.innerWidth = 1280; globalThis.innerHeight = 800;
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 2);
  globalThis.cancelAnimationFrame = clearTimeout;
  globalThis.requestIdleCallback = (f) => setTimeout(f, 5);
  globalThis.getComputedStyle = () => ({ animationName: "none" });
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };

  const out = { error: null };
  try {
    const door = await import(INDEX);
    const d = door.createDoor({ typingWait: 0, flags: {} });
    const host = any();
    const dawn = d.dawn(host);
    if (how === "destroyed" || how === "destroyed-aside") dawn.destroy();
    const before = asked.length;
    let hooks = 0;
    const count = () => { hooks++; };
    dawn.light({ onLit: count, onOpen: count, after: count, ...(how === "destroyed-aside" ? { aside: true } : {}) });
    await new Promise((r) => setTimeout(r, 300));
    out.contexts = asked.length - before;
    out.canvases = canvases.length;
    out.hooks = hooks;
    /* whether the gate has decided: asking it now would make a context if it had not */
    const at = asked.length;
    door.gpu();
    out.decidedBefore = asked.length === at;
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
  /* control: on a live dawn, light() without `aside` asks the gate (one webgl2 context), so the cases below can tell */
  const r = run("live");
  check("control: light() on a live dawn, no aside given, decides the GPU verdict (one context)", !r.error && r.contexts === 1 && r.decidedBefore === true,
    `contexts made by light(): ${r.contexts}, verdict decided: ${r.decidedBefore}${r.error ? "; " + r.error : ""}`);
}
{
  const r = run("destroyed");
  check("light() on a destroyed dawn makes no WebGL context", !r.error && r.contexts === 0, `contexts made by light(): ${r.contexts}${r.error ? "; " + r.error : ""}`);
  check("light() on a destroyed dawn does not decide the GPU verdict", !r.error && r.decidedBefore === false,
    `verdict decided by the call: ${r.decidedBefore} (want false)${r.error ? "; " + r.error : ""}`);
  check("light() on a destroyed dawn calls none of the host's hooks", !r.error && r.hooks === 0, `hooks called: ${r.hooks}`);
}
{
  const r = run("destroyed-aside");
  check("control: with aside given, light() on a destroyed dawn makes no context", !r.error && r.contexts === 0 && r.decidedBefore === false,
    `contexts ${r.contexts}, verdict decided ${r.decidedBefore}${r.error ? "; " + r.error : ""}`);
}
process.exit(failed ? 1 : 0);
