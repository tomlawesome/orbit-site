/*
 * Test for the GPU gate (#2, ADR-0002 "the door tests the GPU once per visit"), written from the ADR's specification
 * alone: sections 2 and 3, behaviours 8 (the part a fake gl can show), 9 and the unit halves of 1, 5 and compilesAside.
 *
 *   node tools/ci/gpu-gate-test.mjs
 *
 * No dependencies and no browser. Two kinds of check:
 *  - frameCost, isSoftware and FIT_MS are pure, and are imported from assets/door/fitness.js, which the ADR says
 *    tests may do (ADR section 2). frameCost(gl, draw, { now }) is Orbit's signature: two untimed frames, then up
 *    to five timed, the median judged against FIT_MS; a fake clock and a fake draw give the costs.
 *  - gpu() and compilesAside() keep state for the life of the page, so each case runs in a fresh Node process
 *    (this file again, as `--child`) with a stub `document` whose canvases hand out a fake WebGL2 context, and
 *    they are reached through assets/door/index.js alone, as a host does.
 *
 * Not here, because they need a real browser: behaviours 11 and 12 (journey.later, the speculative warm) and 1-7
 * (tools/ci/freeze.mjs, which also drives tests/gate.html).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const INDEX = "../../assets/door/index.js";
const FITNESS = "../../assets/door/fitness.js";
const UNMASKED = 0x9246;
const PLAIN = 0x1f01;

/* ------------------------------------------------------------------ the child: one fresh page, one scenario -- */
if (process.argv[2] === "--child") {
  const spec = JSON.parse(process.argv[3]);
  const calls = [];
  const asked = [];
  const stored = [];
  let lost = 0;
  const gl = {
    RENDERER: PLAIN, RGBA: 1, UNSIGNED_BYTE: 2,
    readPixels() {},
    getExtension(name) {
      asked.push(name);
      if (name === "WEBGL_debug_renderer_info") return spec.masked === false ? null : { UNMASKED_RENDERER_WEBGL: UNMASKED };
      if (name === "WEBGL_lose_context") return { loseContext() { lost++; } };
      if (name === "KHR_parallel_shader_compile") return spec.parallel === false ? null : {};
      return null;
    },
    getParameter(p) {
      if (p === UNMASKED) return spec.renderer;
      if (p === PLAIN) return spec.masked === false ? spec.renderer : "WebKit WebGL";
      return null;
    },
  };
  globalThis.document = {
    hidden: false,
    addEventListener() {}, removeEventListener() {},
    createElement: () => ({
      width: 300, height: 150, style: {},
      addEventListener() {}, removeEventListener() {},
      getContext(kind, attrs) { calls.push({ kind, attrs: attrs ?? null }); return spec.context === false ? null : gl; },
    }),
  };
  globalThis.localStorage = { getItem: () => null, setItem: (k) => stored.push(String(k)), removeItem() {}, key: () => null, length: 0 };

  const out = { error: null };
  try {
    const door = await import(INDEX);
    door.createDoor({ flags: spec.flags ?? {}, typingWait: 0 });
    out.exports = { gpu: typeof door.gpu, isSoftware: typeof door.isSoftware, FIT_MS: door.FIT_MS };
    if (spec.compilesFirst) out.compilesAside = door.compilesAside();
    if (typeof door.gpu === "function") {
      const a = door.gpu();
      const b = door.gpu();
      out.isNull = a === null;
      out.same = a === b;
      out.shape = a ? { renderer: a.renderer, parallel: a.parallel, hasGl: !!a.gl, hasCanvas: !!a.canvas } : null;
    }
    if (!spec.compilesFirst && spec.compiles) out.compilesAside = door.compilesAside();
    if (spec.frames) {
      /* the verdict is not remembered: two runs of the fitness test both draw their frames, and nothing is stored */
      const { frameCost } = await import(FITNESS);
      const run = () => {
        let t = 0, draws = 0;
        const costs = [0, 0, 5, 5, 5];
        const r = frameCost({ ...gl }, () => { draws++; t += costs.shift() ?? 0; }, { now: () => t });
        return { r, draws };
      };
      out.runs = [run(), run()];
    }
  } catch (e) { out.error = String(e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e); }
  out.calls = calls;
  out.lost = lost;
  out.stored = stored;
  console.log("RESULT " + JSON.stringify(out));
  process.exit(0);
}

/* ------------------------------------------------------------------------------------------------- the checks -- */
let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};

const run = (spec) => {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child", JSON.stringify(spec)], { encoding: "utf8", timeout: 60000 });
  const line = (r.stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) return { error: `the child printed no result (exit ${r.status}): ${(r.stderr || "").split("\n").slice(0, 3).join(" | ")}` };
  return JSON.parse(line.slice(7));
};

const HARDWARE = "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)";
const SOFTWARE = [
  "llvmpipe (LLVM 19.1.7, 256 bits)",
  "softpipe",
  "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)",
  "Microsoft Basic Render Driver",
];

/* ---- the entry point: exports -------------------------------------------------------------------------------- */
{
  const r = run({ renderer: HARDWARE });
  check("index.js exports gpu()", r.exports?.gpu === "function", `typeof gpu is ${r.exports?.gpu} (want function)${r.error ? "; " + r.error : ""}`);
  check("index.js exports isSoftware()", r.exports?.isSoftware === "function", `typeof isSoftware is ${r.exports?.isSoftware} (want function)`);
  check("index.js exports FIT_MS, 30", r.exports?.FIT_MS === 30, `FIT_MS is ${r.exports?.FIT_MS} (want 30)`);
}

/* ---- gpu(): the one context, asked with the caveat ------------------------------------------------------------ */
{
  const r = run({ renderer: HARDWARE });
  const c = r.calls ?? [];
  check("gpu() asks for one webgl2 context, with failIfMajorPerformanceCaveat: true",
    c.length === 1 && c[0].kind === "webgl2" && c[0].attrs?.failIfMajorPerformanceCaveat === true,
    `${c.length} getContext call(s): ${JSON.stringify(c)}${r.error ? "; " + r.error : ""}`);
  check("a hardware renderer is accepted: a non-null { canvas, gl, parallel, renderer }",
    r.isNull === false && r.shape?.hasGl && r.shape?.hasCanvas && typeof r.shape?.parallel === "boolean" && /NVIDIA/.test(r.shape?.renderer ?? ""),
    `isNull ${r.isNull}, shape ${JSON.stringify(r.shape)}`);
  check("the gate decides once: a second gpu() is the same object, and made no second context", r.same === true && c.length === 1, `same ${r.same}, ${c.length} getContext calls`);
  check("an accepted context is kept, not lost (the probe and the world build on it)", r.isNull === false && r.lost === 0, `isNull ${r.isNull}, loseContext called ${r.lost} time(s) (want accepted, 0)`);
  check("the parallel flag is true when KHR_parallel_shader_compile is there", r.shape?.parallel === true, `parallel ${r.shape?.parallel}`);
}
{
  const r = run({ renderer: HARDWARE, parallel: false });
  check("the parallel flag is false when the extension is missing", r.isNull === false && r.shape?.parallel === false, `isNull ${r.isNull}, parallel ${r.shape?.parallel}`);
}

/* ---- gpu(): refusals ------------------------------------------------------------------------------------------ */
for (const name of SOFTWARE) {
  const r = run({ renderer: name });
  const c = r.calls ?? [];
  check(`a software renderer is refused: ${name}`, r.isNull === true && c.length === 1 && c[0].attrs?.failIfMajorPerformanceCaveat === true,
    `isNull ${r.isNull}; ${c.length} getContext call(s)${r.error ? "; " + r.error : ""}`);
}
{
  /* the name read from the plain RENDERER where the browser does not mask it (Firefox) */
  const r = run({ renderer: "llvmpipe (LLVM 19.1.7, 256 bits)", masked: false });
  check("a software renderer named by the plain RENDERER string is refused", r.isNull === true, `isNull ${r.isNull}${r.error ? "; " + r.error : ""}`);
  const ok = run({ renderer: HARDWARE, masked: false });
  check("a hardware renderer named by the plain RENDERER string is accepted (the guard for the refusal above)", ok.isNull === false, `isNull ${ok.isNull}${ok.error ? "; " + ok.error : ""}`);
}
{
  const r = run({ context: false, renderer: HARDWARE });
  const c = r.calls ?? [];
  check("when the browser declines the caveat context, gpu() is null", r.isNull === true && c.length === 1 && c[0].attrs?.failIfMajorPerformanceCaveat === true,
    `isNull ${r.isNull}; ${JSON.stringify(c)}${r.error ? "; " + r.error : ""}`);
}
{
  /* ?level= chooses among live-door weights once the GPU is accepted; it never grants the GPU */
  const r = run({ renderer: "llvmpipe (LLVM 19.1.7, 256 bits)", flags: { level: "2", door3d: true } });
  check("?level=2 does not grant a software renderer the GPU", r.isNull === true, `isNull ${r.isNull}${r.error ? "; " + r.error : ""}`);
}

/* ---- ?gpu=force ----------------------------------------------------------------------------------------------- */
{
  const r = run({ renderer: "llvmpipe (LLVM 19.1.7, 256 bits)", flags: { gpu: "force" } });
  const c = r.calls ?? [];
  check("gpu=force takes the context without the caveat attribute", c.length === 1 && c[0].kind === "webgl2" && c[0].attrs?.failIfMajorPerformanceCaveat !== true,
    `${JSON.stringify(c)}${r.error ? "; " + r.error : ""}`);
  check("gpu=force skips the name check: a software renderer is accepted", r.isNull === false && /llvmpipe/.test(r.shape?.renderer ?? ""), `isNull ${r.isNull}, renderer ${r.shape?.renderer}`);
  check("gpu=force: the context is kept", r.isNull === false && r.lost === 0, `isNull ${r.isNull}, loseContext called ${r.lost} time(s) (want accepted, 0)`);
}

/* ---- compilesAside() ------------------------------------------------------------------------------------------ */
{
  const r = run({ renderer: "llvmpipe (LLVM 19.1.7, 256 bits)", compiles: true });
  check("compilesAside() is true when the GPU is refused (nothing will compile)", r.compilesAside === true, `compilesAside() gave ${r.compilesAside}${r.error ? "; " + r.error : ""}`);
}
{
  /* the refusal wins over the extension: a refused renderer that has no parallel compile is still "aside" */
  const r = run({ renderer: "llvmpipe (LLVM 19.1.7, 256 bits)", parallel: false, compiles: true });
  check("compilesAside() is true when the GPU is refused, whatever the parallel extension says", r.compilesAside === true && r.isNull === true, `compilesAside() gave ${r.compilesAside}, gpu() null: ${r.isNull}${r.error ? "; " + r.error : ""}`);
}
{
  const r = run({ context: false, renderer: HARDWARE, compilesFirst: true });
  const c = r.calls ?? [];
  check("compilesAside() asks gpu(): one webgl2 context with the caveat, true when it is declined",
    r.compilesAside === true && c.length === 1 && c[0].attrs?.failIfMajorPerformanceCaveat === true,
    `compilesAside() ${r.compilesAside}; ${JSON.stringify(c)}${r.error ? "; " + r.error : ""}`);
}
{
  const r = run({ renderer: HARDWARE, parallel: true, compiles: true });
  check("compilesAside() reads gpu().parallel: true where compiles run in the background", r.compilesAside === true, `compilesAside() gave ${r.compilesAside}`);
}
{
  const r = run({ renderer: HARDWARE, parallel: false, compiles: true });
  check("compilesAside() is false where the browser compiles on the page's thread (no parallel extension)", r.compilesAside === false, `compilesAside() gave ${r.compilesAside}`);
}
{
  const r = run({ renderer: HARDWARE, parallel: true, compiles: true, flags: { mainthread: true } });
  check("compilesAside() is false under mainthread", r.compilesAside === false, `compilesAside() gave ${r.compilesAside}`);
}

/* ---- behaviour 8, what a fake gl shows: nothing remembered, tested every time --------------------------------- */
{
  const r = run({ renderer: HARDWARE, frames: true });
  const [a, b] = r.runs ?? [];
  check("a real GPU: nothing is written to localStorage for fitness", !!a && !!b && r.stored && !r.stored.some((k) => /fitness|orbit-flight/i.test(k)),
    `keys written: ${JSON.stringify(r.stored)}${r.error ? "; " + r.error : ""}`);
  check("a second visit times the frames again (no remembered verdict)", !!a && !!b && a.draws === b.draws && b.draws === 5 && b.r?.fit === true,
    `first run ${JSON.stringify(a)}, second run ${JSON.stringify(b)} (want 5 draws each, fit)`);
}

/* ---- frameCost and isSoftware, from fitness.js ---------------------------------------------------------------- */
let fit = null;
try { fit = await import(FITNESS); } catch (e) { check("assets/door/fitness.js loads", false, String(e.message).split("\n")[0]); }

if (fit) {
  const { frameCost, isSoftware, FIT_MS } = fit;
  check("fitness.js exports FIT_MS, 30", FIT_MS === 30, `FIT_MS is ${FIT_MS}`);

  /* a gl whose frames cost what `costs` says, in order, on a fake clock; every frame is synced with a 1x1 readPixels */
  const stub = (costs) => {
    let t = 0;
    const syncs = [];
    const gl = { RGBA: 1, UNSIGNED_BYTE: 2, readPixels: (x, y, w, h) => syncs.push([x, y, w, h]) };
    let draws = 0;
    const draw = () => { draws++; t += costs.shift() ?? 0; };
    return { gl, draw, now: () => t, draws: () => draws, syncs };
  };

  if (typeof frameCost !== "function") check("frameCost is exported by fitness.js", false, `typeof frameCost is ${typeof frameCost}`);
  else {
    {
      /* behaviour 9: medians [5,5,5,40,40] -> fit */
      const s = stub([0, 0, 5, 5, 5, 40, 40]);
      const v = frameCost(s.gl, s.draw, { now: s.now });
      check("frameCost: timed frames [5,5,5,40,40] are fit (median 5)", v?.fit === true && v?.ms === 5, `got ${JSON.stringify(v)} (want { fit: true, ms: 5 })`);
      check("frameCost: the two untimed frames and the three that agree are drawn, no more", s.draws() === 5, `${s.draws()} draws (want 2 + 3)`);
    }
    {
      /* [40,40,40,5,5] -> unfit, stopped after 3 frames */
      const s = stub([0, 0, 40, 40, 40, 5, 5]);
      const v = frameCost(s.gl, s.draw, { now: s.now });
      check("frameCost: timed frames [40,40,40,5,5] are unfit (median 40)", v?.fit === false && v?.ms === 40, `got ${JSON.stringify(v)} (want { fit: false, ms: 40 })`);
      check("frameCost: stops after 3 timed frames once most have agreed", s.draws() === 5, `${s.draws()} draws (want 2 + 3)`);
    }
    {
      const s = stub([95, 60, 6, 7, 5, 6, 8]);
      const v = frameCost(s.gl, s.draw, { now: s.now });
      check("frameCost: slow cold frames are not timed", v?.fit === true && v?.ms === 6, `got ${JSON.stringify(v)} (want { fit: true, ms: 6 })`);
      check("frameCost: each untimed frame is finished with a 1x1 readPixels", JSON.stringify(s.syncs.slice(0, 2)) === JSON.stringify([[0, 0, 1, 1], [0, 0, 1, 1]]), `first syncs ${JSON.stringify(s.syncs.slice(0, 2))}`);
    }
    {
      const s = stub([0, 0, 6, 48, 7, 5]);
      const v = frameCost(s.gl, s.draw, { now: s.now });
      check("frameCost: one hitch among quick frames is not a slow machine", v?.fit === true, `got ${JSON.stringify(v)}`);
    }
    {
      const s = stub([0, 0, FIT_MS, FIT_MS, FIT_MS]);
      check("frameCost: a median of exactly FIT_MS is fit", frameCost(s.gl, s.draw, { now: s.now })?.fit === true, "median = FIT_MS");
      const u = stub([0, 0, FIT_MS + 1, FIT_MS + 1, FIT_MS + 1]);
      check("frameCost: a median over FIT_MS is unfit", frameCost(u.gl, u.draw, { now: u.now })?.fit === false, `median = FIT_MS + 1`);
    }
    {
      /* a throwing draw */
      const gl = { RGBA: 1, UNSIGNED_BYTE: 2, readPixels() {} };
      const v = frameCost(gl, () => { throw new Error("context lost"); }, { now: () => 0 });
      check("frameCost: a throwing draw is { fit: false, ms: Infinity }", v?.fit === false && v?.ms === Infinity, `got ${JSON.stringify(v)} (JSON shows Infinity as null)`);
    }
  }

  if (typeof isSoftware !== "function") check("isSoftware is exported by fitness.js", false, `typeof isSoftware is ${typeof isSoftware}`);
  else {
    for (const name of [...SOFTWARE, "LLVMPIPE (LLVM 15.0.7, 256 bits)", "Mesa/X.org llvmpipe", "SwiftShader"]) {
      check(`isSoftware: ${name}`, isSoftware(name) === true, `gave ${isSoftware(name)} (want true)`);
    }
    for (const name of [HARDWARE, "NVIDIA GeForce RTX 4070", "AMD Radeon RX 7800 XT", "Apple M2", "Mesa Intel(R) UHD Graphics 620 (KBL GT2)", "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)"]) {
      check(`isSoftware: a real GPU, ${name}, is not`, isSoftware(name) === false, `gave ${isSoftware(name)} (want false)`);
    }
  }
}

process.exit(failed ? 1 : 0);
