/*
 * Test for #119 (the flight's shaders asked after the install's first draw), the word itself: statement L8 of the
 * specification, written from it alone, before the code. assets/door/status.js is imported on its own (no page, no
 * worker: only the settings and a virtual clock), in a child process a case, because the word is given once for the
 * life of a page.
 *
 *   node tools/ci/flight-late-status-test.mjs
 *
 * The module's names are the specification's (D1): statusGo() gives the word; onStatusGo(fn) hears it and returns a
 * function that stops listening; statusTurn() is a promise that settles at the word or at STATUS_LATE (9000 ms from the
 * asking), whichever first, once, with the ms it waited. The flight is only asked late under the flag links "late"
 * (settings.flags.links, ADR-0001); without it, or once the word has been given, statusTurn() settles at once with 0.
 * The cap is the specification's 9000 written out (not read from an export: the specification does not say STATUS_LATE
 * is exported).
 *
 *   s1  L8  the word ends the wait: statusTurn() settles at statusGo() with the ms waited (here 2500, a little over is
 *           allowed for), and the 9000 ms timer is cleared on the word (none is left)
 *   s2  L8  no word: nothing at 8990 ms, settled at 9000 with the ms waited (9000), once (a statusGo() after it
 *           changes nothing, and does not throw)
 *   s3  L8  the word given before the asking: statusTurn() settles at once with 0 (no virtual time passes)
 *   s4  L8  no flag, or links "now": statusTurn() settles at once with 0, the word never given
 *   s5  L8  onStatusGo(fn) is heard on statusGo(); the stop it returns removes the listener (a stopped one is not
 *           called, one not stopped is); statusGo() twice is harmless (no throw, and a later statusTurn() is 0)
 *
 * One fresh Node process a case; the virtual clock only, nothing waits on the runner. A missing module is said in plain
 * words.
 */
import { installClock, childMain, runCase, chk, finish } from "./door-stub.mjs";

const STATUS = "../../assets/door/status.js", SETTINGS = "../../assets/door/settings.js";
const plainError = (message) => Object.assign(new Error(message), { plain: true });
const guarded = (cases) => Object.fromEntries(Object.entries(cases).map(([k, f]) => [k, async () => { try { return await f(); } catch (e) { if (e && e.plain) return { none: e.message }; throw e; } }]));
const LATE = 9000;

/* every timer the module sets, and whether it is still waiting (setTimeout / clearTimeout, over the virtual clock) */
function trackTimers() {
  const live = new Map();
  const set = globalThis.setTimeout, clear = globalThis.clearTimeout;
  globalThis.setTimeout = (f, ms, ...a) => { const id = set((...x) => { live.delete(id); return f(...x); }, ms, ...a); live.set(id, Number(ms) || 0); return id; };
  globalThis.clearTimeout = (id) => { live.delete(id); clear(id); };
  return { long: () => [...live.values()].filter((ms) => ms >= 5000).length };
}

async function boot(flags) {
  const clock = installClock();
  const timers = trackTimers();
  const { configure } = await import(SETTINGS);
  configure({ flags });
  let mod;
  try { mod = await import(STATUS); }
  catch (e) { throw plainError(e && e.code === "ERR_MODULE_NOT_FOUND" && /status\.js/.test(String(e.message)) ? "assets/door/status.js does not exist yet" : `assets/door/status.js did not load: ${String(e && e.stack || e).split("\n").slice(0, 3).join(" | ")}`); }
  for (const n of ["statusGo", "onStatusGo", "statusTurn"]) if (typeof mod[n] !== "function") throw plainError(`assets/door/status.js exports no ${n}`);
  return { clock, timers, ...mod };
}
/* a promise's state now, and its value */
const watch = (p) => { const o = { state: "pending", value: undefined }; Promise.resolve(p).then((v) => { o.state = "resolved"; o.value = v; }, (e) => { o.state = "rejected"; o.value = e; }); return o; };
const flushed = () => new Promise((r) => setImmediate(r));

async function s1() {
  const s = await boot({ links: "late" });
  const t = watch(s.statusTurn());
  await s.clock.advance(2500);
  const before = { state: t.state, timers: s.timers.long() };
  s.statusGo();
  await s.clock.advance(0);
  const after = { state: t.state, value: t.value, timers: s.timers.long() };
  await s.clock.advance(20000);
  return { before, after, later: { state: t.state, value: t.value } };
}
async function s2() {
  const s = await boot({ links: "late" });
  const t = watch(s.statusTurn());
  await s.clock.advance(LATE - 10);
  const early = t.state;
  await s.clock.advance(20);
  const at = { state: t.state, value: t.value };
  let threw = null;
  try { s.statusGo(); } catch (e) { threw = String(e && e.message); }
  await s.clock.advance(50);
  return { early, at, threw, after: { state: t.state, value: t.value }, timers: s.timers.long() };
}
async function s3() {
  const s = await boot({ links: "late" });
  s.statusGo();
  const t = watch(s.statusTurn());
  await flushed();
  return { state: t.state, value: t.value, now: performance.now() };
}
async function s4(flags) {
  const s = await boot(flags);
  const t = watch(s.statusTurn());
  await flushed();
  return { state: t.state, value: t.value, now: performance.now() };
}
async function s5() {
  const s = await boot({ links: "late" });
  let kept = 0, stopped = 0;
  const stop = s.onStatusGo(() => { stopped++; });
  s.onStatusGo(() => { kept++; });
  const isFn = typeof stop === "function";
  if (isFn) stop();
  let threw = null;
  try { s.statusGo(); s.statusGo(); } catch (e) { threw = String(e && e.message); }
  await s.clock.advance(10);
  const t = watch(s.statusTurn());
  await flushed();
  return { isFn, kept, stopped, threw, later: { state: t.state, value: t.value } };
}

const CASES = guarded({ s1, s2, s3, s4none: () => s4({}), s4now: () => s4({ links: "now" }), s5 });

if (process.argv[2] === "--child") await childMain(CASES);

const show = (x) => JSON.stringify(x);
const run = (n) => runCase(import.meta.url, n);
const near = (v, ms) => typeof v === "number" && v >= ms && v <= ms + 50;

{
  const r = run("s1");
  chk("L8 statusTurn() is pending while no word has come (precondition)", r, (r) => [r.before.state === "pending", show(r.before)]);
  chk("L8 ... and settles at statusGo() with the ms it waited (2500)", r, (r) => [r.after.state === "resolved" && near(r.after.value, 2500), show(r.after)]);
  chk("L8 ... and the 9000 ms timer is cleared on the word (none left)", r, (r) => [r.before.timers >= 1 && r.after.timers === 0, `long timers before the word ${r.before.timers}, after ${r.after.timers}`]);
  chk("L8 ... settled once: nothing changes when the cap would have come", r, (r) => [r.later.state === "resolved" && near(r.later.value, 2500), show(r.later)]);
}
{
  const r = run("s2");
  chk("L8 no word: statusTurn() is still pending at 8990 ms", r, (r) => [r.early === "pending", `state ${r.early}`]);
  chk("L8 ... settles at STATUS_LATE (9000 ms) with the ms it waited", r, (r) => [r.at.state === "resolved" && near(r.at.value, LATE), show(r.at)]);
  chk("L8 ... once: a statusGo() after it does not throw and changes nothing; no timer is left", r, (r) => [r.threw === null && r.after.state === "resolved" && near(r.after.value, LATE) && r.timers === 0, `threw ${show(r.threw)}, ${show(r.after)}, long timers ${r.timers}`]);
}
{
  const r = run("s3");
  chk("L8 the word given before the asking: statusTurn() settles at once with 0 (no virtual time passes)", r, (r) => [r.state === "resolved" && r.value === 0 && r.now === 0, show(r)]);
}
{
  const n = run("s4none"), l = run("s4now");
  chk("L8 no flag: statusTurn() settles at once with 0, the word never given", n, (r) => [r.state === "resolved" && r.value === 0 && r.now === 0, show(r)]);
  chk("L8 links \"now\" (no flag to the door): statusTurn() settles at once with 0", l, (r) => [r.state === "resolved" && r.value === 0 && r.now === 0, show(r)]);
}
{
  const r = run("s5");
  chk("L8 onStatusGo(fn) returns a function (its stop)", r, (r) => [r.isFn, `returned a function: ${r.isFn}`]);
  chk("L8 ... a listener not stopped hears statusGo(); the one stopped does not", r, (r) => [r.kept >= 1 && r.stopped === 0, `heard by the kept ${r.kept}, by the stopped ${r.stopped}`]);
  chk("L8 statusGo() twice is harmless: no throw, and a later statusTurn() settles at once with 0", r, (r) => [r.threw === null && r.later.state === "resolved" && r.later.value === 0, `threw ${show(r.threw)}, ${show(r.later)}`]);
}
finish();
