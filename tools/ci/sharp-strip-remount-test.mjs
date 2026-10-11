/*
 * Test for a stopped world holding up the sharp lights strip (#36), written from the specification alone. Each context
 * that will draw the sharper strip calls voyage.js's sharpStrip() as it is made and gets a handle { ready(take), fail(),
 * mix() }. ready(take) says "my small strip is on the GPU, give me the sharp one by take(bitmap)"; fail() says "I never
 * will". The sharp strip (a fetch of assets/door/img/dawn/lights-strip-<ppd>.webp, then a chore tagged "rich" that calls
 * each take) is fetched only once EVERY handle has called ready or fail. A context that goes away before it has settled
 * must not hold the others up for ever, so the handle gains leave(): the context leaves the queue at once, and the queue
 * looks again so the others are served; a taker that left is never served.
 *
 *   node tools/ci/sharp-strip-remount-test.mjs
 *
 * No dependencies and no browser. The sharp tier exists only on a wide screen (innerWidth * min(devicePixelRatio, 2) of
 * 1600 or more gives lights-strip-180) and is chosen once a page, so the stub page is wide before the first import. Each
 * case runs in a fresh Node process (this file again, as `--child`); fetch is a stub that records its addresses, and
 * can be held. sharpStrip is imported from voyage.js (the same module instance index.js uses), the chores opened through
 * index.js.
 *
 *   control        a, b made; b.ready(take): nothing is fetched and take is not called (a is unsettled)
 *   control (all)  a.ready(ta), b.ready(tb): the strip is fetched, both takes called (the observation can pass)
 *   leave          a, b; b.ready(tb); leave(a): the strip is fetched and tb is called with the bitmap; a's take never
 *   fail           a.fail() in place of leave(): the same (fail already settles; guards the queue's re-check)
 *   leave served   a.ready(ta), b.ready(tb) with the fetch held, leave(a), the fetch let go: ta never called, tb called
 *   leave early    a.ready(ta); leave(a); b.ready(tb): tb is called, ta never
 *   all leave      a, b; both leave; c made afterwards and ready: c is served (a queue emptied is not stuck)
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const INDEX = "../../assets/door/index.js";
const VOYAGE = "../../assets/door/voyage.js";

if (process.argv[2] === "--child") {
  const how = process.argv[3];
  const urls = [];
  let release; const gate = new Promise((r) => { release = r; });
  const held = how === "leave-served";
  const any = () => new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : any()),
    set: () => true,
    apply: () => any(),
  });
  const stubEl = () => ({
    style: {}, classList: { add() {}, remove() {}, contains: () => false }, dataset: {}, setAttribute() {}, getAttribute: () => null,
    addEventListener() {}, removeEventListener() {}, clientWidth: 2000, clientHeight: 800,
    getBoundingClientRect: () => ({ left: 0, top: 0, x: 0, y: 0, width: 2000, height: 800, right: 2000, bottom: 800 }),
  });
  globalThis.document = {
    hidden: false, baseURI: "http://localhost/", body: stubEl(), documentElement: stubEl(),
    addEventListener() {}, removeEventListener() {},
    querySelector: () => stubEl(), querySelectorAll: () => [],
    createElement: () => any(), createTextNode: () => any(),
  };
  globalThis.window = globalThis;
  globalThis.devicePixelRatio = 1; globalThis.screen = { width: 2000, height: 1000 };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
  globalThis.innerWidth = 2000; globalThis.innerHeight = 1000;
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 2);
  globalThis.cancelAnimationFrame = clearTimeout;
  globalThis.requestIdleCallback = (f) => setTimeout(f, 5);
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
  globalThis.Path2D = class { constructor() { return any(); } };
  globalThis.createImageBitmap = async () => ({ width: 64, height: 64, strip: true, close() {} });
  globalThis.fetch = async (u) => {
    urls.push(String(u));
    if (held && /lights-strip/.test(String(u))) await gate;
    return { ok: true, blob: async () => ({ size: 1 }) };
  };
  console.info = () => {}; console.warn = () => {};

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { error: null };
  try {
    const door = await import(INDEX);
    const { sharpStrip } = await import(VOYAGE);
    const calls = { a: [], b: [], c: [] };
    const taker = (who) => (bmp) => calls[who].push(bmp);
    const settle = async () => {
      door.openChores();
      await Promise.race([door.quiet(), sleep(4000)]); await sleep(300); await Promise.race([door.quiet(), sleep(4000)]);
    };
    const strips = () => urls.filter((u) => /lights-strip-/.test(u));
    const a = sharpStrip(), b = sharpStrip();
    /* leave() is the interface the fix adds: where it is missing the case goes on without it, and fails on what it sees */
    let hasLeave = typeof a?.leave === "function";
    const leave = (h) => { if (typeof h?.leave === "function") h.leave(); };
    out.hasLeave = hasLeave;
    out.handle = { a: typeof a?.ready + "/" + typeof a?.fail + "/" + typeof a?.leave, b: typeof b?.ready };
    if (how === "control") { b.ready(taker("b")); await settle(); }
    else if (how === "control-all") { a.ready(taker("a")); b.ready(taker("b")); await settle(); }
    else if (how === "leave") { b.ready(taker("b")); await settle(); out.beforeLeave = strips().length; leave(a); await settle(); }
    else if (how === "fail") { b.ready(taker("b")); await settle(); out.beforeLeave = strips().length; a.fail(); await settle(); }
    else if (how === "leave-served") {
      a.ready(taker("a")); b.ready(taker("b")); await settle();
      out.heldFetch = strips().length;
      leave(a); await sleep(50); release(); await settle();
    } else if (how === "leave-early") { a.ready(taker("a")); leave(a); b.ready(taker("b")); await settle(); }
    else if (how === "all-leave") {
      leave(a); leave(b); const c = sharpStrip(); c.ready(taker("c")); await settle();
    }
    out.fetched = strips();
    out.calls = { a: calls.a.length, b: calls.b.length, c: calls.c.length };
    out.bitmap = !!(calls.b[0] || calls.c[0] || calls.a[0])?.strip;
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
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child", how], { encoding: "utf8", timeout: 60000 });
  const line = (r.stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) return { error: `the child printed no result (exit ${r.status}): ${(r.stderr || "").split("\n").slice(0, 3).join(" | ")}` };
  return JSON.parse(line.slice(7));
};
const show = (r) => (r.error ? `; ${r.error}` : `; fetched ${JSON.stringify(r.fetched)}, takes called ${JSON.stringify(r.calls)}, handle has leave(): ${r.hasLeave}`);

{
  const r = run("control-all");
  check("the handle has leave()", !r.error && r.hasLeave === true, `typeof handle.leave is ${r.hasLeave ? "function" : "not a function"} (want function)${r.error ? "; " + r.error : ""}`);
  check("control (all settled): the sharp strip is fetched and both takers are given the bitmap",
    !r.error && r.fetched.length === 1 && /lights-strip-180/.test(r.fetched[0]) && r.calls.a === 1 && r.calls.b === 1 && r.bitmap, `want 1 fetch of lights-strip-180, a 1, b 1${show(r)}`);
}
{
  const r = run("control");
  check("control (blocking is real): one handle unsettled, the other ready: nothing fetched, no take called",
    !r.error && r.fetched.length === 0 && r.calls.b === 0, `want 0 fetches, b 0${show(r)}`);
}
{
  const r = run("leave");
  check("leave: leave(a) with b ready: the sharp strip is fetched and b is given the bitmap, a never",
    !r.error && r.beforeLeave === 0 && r.fetched.length === 1 && r.calls.b === 1 && r.calls.a === 0 && r.bitmap, `want 0 fetches before leave, then 1, b 1, a 0${r.beforeLeave === undefined ? "" : ` (before leave: ${r.beforeLeave})`}${show(r)}`);
}
{
  const r = run("fail");
  check("fail: a.fail() with b ready: the sharp strip is fetched and b is given the bitmap",
    !r.error && r.beforeLeave === 0 && r.fetched.length === 1 && r.calls.b === 1, `want 1 fetch, b 1${show(r)}`);
}
{
  const r = run("leave-served");
  check("leave served: a is ready, then leaves while the fetch is under way: a's take is never called, b's is",
    !r.error && r.heldFetch === 1 && r.calls.a === 0 && r.calls.b === 1, `want the fetch started (1) before leave, a 0, b 1; saw ${r.heldFetch}${show(r)}`);
}
{
  const r = run("leave-early");
  check("leave early: a is ready and leaves before b settles: b is served, a's take is never called",
    !r.error && r.fetched.length === 1 && r.calls.b === 1 && r.calls.a === 0, `want 1 fetch, b 1, a 0${show(r)}`);
}
{
  const r = run("all-leave");
  check("all leave: both earlier handles leave, a later handle made and ready is served",
    !r.error && r.fetched.length === 1 && r.calls.c === 1, `want 1 fetch, c 1${show(r)}`);
}
process.exit(failed ? 1 : 0);
