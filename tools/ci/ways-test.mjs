/*
 * Test for #119 (the planets' names wait for the door's first reveal; #157 planet names before the door is revealed),
 * cases N1-N13, written from the specification alone, before the code. Fault: a way readied while the first visit's
 * ring still ran opened its label (class `ready`) and the gate over a door whose planets were not yet in.
 *
 * The seam (decision D1/D4): assets/js/ways.js, `createWays({ $, body, BACKS, reduced, raf, animations })` returns
 * `{ open(ids, gate), revealed() }`. open() is openWays; revealed() is what showDoor's onLit does: a frame on, find
 * the `#door .planet .body` opacity animation (animations() is document.getAnimations), wait its `finished` (a
 * rejection counts), else the frame, then release every way asked for. Before the first revealed() the planets and
 * the gate wait; the backs to the dawn (id "back") open at once and are faded in once (600 ms ease, on filter).
 *
 *   N1  before revealed(): install, docs and info keep their tabindex and aria-disabled and get no `ready`
 *   N2  before revealed(): open(["docs"], true) leaves #gate disabled and sets no `ready-flight`
 *   N3  revealed() then the fade ends: every way asked has `ready`, no tabindex, no aria-disabled, the gate is
 *       enabled and `ready-flight` set; not before the fade's `finished` is released (a look-alike one is ignored)
 *   N4  revealed() with no matching animation: the ways open at the next frame, not at the call
 *   N5  a cancelled fade (`finished` rejects) still opens them
 *   N6  open(["back"]) before revealed(): at once every back loses tabindex and aria-disabled; one 600 ms ease
 *       filter-opacity animate call each (none when reduced: N6-reduced); the reveal adds no second one
 *   N7  open(["back"], true) before revealed(): backs at once, the gate and `ready-flight` wait for the reveal
 *   N8  the save-data call open(["install","docs","info","back"], true): backs at once, planets and gate at the reveal
 *   N9  after the first reveal has ended, open(...) opens within microtasks: no frame or timer is advanced
 *   N10 a second revealed() (the door shown again) holds ways asked while its fade runs, and releases at its end
 *   N11 revealed() never called (a deep link to a landing): planets and gate stay closed after 60 s of virtual time;
 *       only the backs opened
 *   N12 (source) ways.js reads no flag and imports nothing from assets/door/
 *   N13 (source) main.js imports createWays, has no `let planetsIn = Promise.resolve()`, and showDoor's onLit
 *       calls revealed()
 *
 * Statements this file cannot test (a browser is needed; no browser here):
 *   B1 the real fade: that the `#door .planet .body` opacity transition is what getAnimations() lists a frame after
 *      onLit, and that its end is when the planets' opacity is full (the fake animation is what the spec says it is).
 *   B2 that the owner no longer sees INSTALL / INFORMATION names over the loading ring on a first visit (desktop
 *      Firefox): the end-to-end result of N1-N3 on the real page.
 *   B3 that the backs' filter fade looks right and is not doubled on screen (N6 counts animate calls only).
 *
 *   node tools/ci/ways-test.mjs
 *
 * No dependencies and no browser; each case runs in a fresh Node process (this file again, as `--child`) on the
 * virtual clock of door-stub.mjs, with a fake DOM: elements with a class set, attributes, `disabled`, and `animate`
 * recorded. The module is loaded from ../../assets/js/ways.js; until it exists every case fails on the import.
 */
import { readFileSync } from "node:fs";
import { installClock, childMain, runCase, check, finish, errOf } from "./door-stub.mjs";

const WAYS = "../../assets/js/ways.js";
const rootOf = (p) => new URL(p, import.meta.url);
const PLANET = (id) => `#door .planet[data-section="${id}"]`;
const IDS = ["install", "docs", "info"];
const micro = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

class El {
  constructor(attrs = {}) {
    this.classes = new Set(); this.attrs = new Map(Object.entries(attrs)); this.animateCalls = [];
  }
  get classList() { const s = this.classes; return { add: (...n) => n.forEach((x) => s.add(x)), remove: (...n) => n.forEach((x) => s.delete(x)), contains: (x) => s.has(x) }; }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  removeAttribute(k) { this.attrs.delete(k); }
  hasAttribute(k) { return this.attrs.has(k); }
  animate(frames, opts) { this.animateCalls.push({ frames, opts }); return {}; }
}

/* a deferred promise whose rejection is only raised when the case says (so a handler is on it by then) */
const deferred = () => { let ok, no; const p = new Promise((a, b) => { ok = a; no = b; }); return { p, ok, no }; };
/* an animation as the browser lists it: a transition on a property of an element that matches selectors */
const anim = (finished, { prop = "opacity", target = "#door .planet .body" } = {}) =>
  ({ transitionProperty: prop, effect: { target: { matches: (s) => s === target } }, finished });

/* the page: closed planets, closed backs, a disabled gate, an empty body; then createWays on them */
async function mount({ reduced = false, anims = () => [] } = {}) {
  const clock = installClock();
  let unhandled = 0;
  process.on("unhandledRejection", () => { unhandled++; });
  const planets = Object.fromEntries(IDS.map((id) => [id, new El({ tabindex: "-1", "aria-disabled": "true" })]));
  const backs = [new El({ tabindex: "-1", "aria-disabled": "true" }), new El({ tabindex: "-1", "aria-disabled": "true" }), new El({ tabindex: "-1", "aria-disabled": "true" })];
  const gate = new El(); gate.disabled = true;
  const body = new El();
  const $ = (s) => { for (const id of IDS) if (s === PLANET(id)) return planets[id]; return s === "#gate" ? gate : null; };
  const { createWays } = await import(WAYS);
  const ways = createWays({ $, body, BACKS: () => backs, reduced, raf: (f) => globalThis.requestAnimationFrame(f), animations: anims });
  const isOpen = (el) => el.classes.has("ready") && !el.attrs.has("tabindex") && !el.attrs.has("aria-disabled");
  const isShut = (el) => !el.classes.has("ready") && el.getAttribute("tabindex") === "-1" && el.getAttribute("aria-disabled") === "true";
  const snap = () => ({
    planetsShut: IDS.every((id) => isShut(planets[id])), planetsOpen: IDS.every((id) => isOpen(planets[id])),
    gateOn: gate.disabled === false, flight: body.classes.has("ready-flight"),
    backsOpen: backs.every((b) => !b.attrs.has("tabindex") && !b.attrs.has("aria-disabled")),
    backAnims: backs.map((b) => b.animateCalls.length),
  });
  return { clock, ways, planets, backs, gate, body, isOpen, isShut, snap, unhandled: () => unhandled };
}

const BACK_ANIM = (b) => b.animateCalls.length === 1 && JSON.stringify(b.animateCalls[0].frames) === JSON.stringify([{ filter: "opacity(0)" }, { filter: "opacity(1)" }])
  && b.animateCalls[0].opts?.duration === 600 && b.animateCalls[0].opts?.easing === "ease";

const CASES = {
  async N1() {
    const m = await mount();
    m.ways.open(["install"]); m.ways.open(["docs"]); m.ways.open(["info"]);
    await micro(); await m.clock.advance(5000);
    return m.snap();
  },
  async N2() {
    const m = await mount();
    m.ways.open(["docs"], true);
    await micro(); await m.clock.advance(5000);
    return m.snap();
  },
  async N3() {
    const fade = deferred(), decoy = deferred();
    const m = await mount({ anims: () => [anim(decoy.p, { prop: "transform" }), anim(decoy.p, { target: "#door .something" }), anim(fade.p)] });
    m.ways.open(["install"]); m.ways.open(["docs"], true); m.ways.open(["info"]);
    m.ways.revealed(); await m.clock.advance(200);
    const during = m.snap();                           /* the fade is running: nothing yet */
    fade.ok(); await micro(); await m.clock.advance(1);
    return { during, after: m.snap() };
  },
  async N4() {
    const m = await mount({ anims: () => [] });
    m.ways.open(["install"]); m.ways.open(["docs"], true); m.ways.open(["info"]);
    m.ways.revealed(); await micro();
    const atCall = m.snap();
    await m.clock.advance(5);                          /* before the frame (16 ms on the virtual clock) */
    const early = m.snap();
    await m.clock.advance(60);
    return { atCall, early, after: m.snap() };
  },
  async N5() {
    const fade = deferred();
    const m = await mount({ anims: () => [anim(fade.p)] });
    m.ways.open(["install"]); m.ways.open(["docs"], true); m.ways.open(["info"]);
    m.ways.revealed(); await m.clock.advance(100);
    const during = m.snap();
    fade.no(new Error("cancelled")); await micro(); await m.clock.advance(5);
    return { during, after: m.snap(), unhandled: m.unhandled() };
  },
  async N6() { return backsCase({ reduced: false, gate: false }); },
  async "N6-reduced"() { return backsCase({ reduced: true, gate: false }); },
  async N7() { return backsCase({ reduced: false, gate: true }); },
  async N8() {
    const fade = deferred();
    const m = await mount({ anims: () => [anim(fade.p)] });
    m.ways.open(["install", "docs", "info", "back"], true);
    await micro();
    const atOnce = m.snap();
    await m.clock.advance(5000);
    const waiting = m.snap();
    m.ways.revealed(); await m.clock.advance(100);
    fade.ok(); await micro(); await m.clock.advance(1);
    const after = m.snap();
    return { atOnce, waiting, after, anims1: m.backs.every(BACK_ANIM) };
  },
  async N9() {
    const fade = deferred();
    const m = await mount({ anims: () => [anim(fade.p)] });
    m.ways.revealed(); await m.clock.advance(100); fade.ok(); await micro(); await m.clock.advance(1);
    const t0 = m.clock.now();
    m.ways.open(["install"]); m.ways.open(["docs"], true); m.ways.open(["info", "back"]);
    await micro();
    return { snap: m.snap(), advanced: m.clock.now() - t0, anims1: m.backs.every(BACK_ANIM) };
  },
  async N10() {
    const first = deferred(), second = deferred();
    let which = first;
    const m = await mount({ anims: () => [anim(which.p)] });
    m.ways.revealed(); await m.clock.advance(100); first.ok(); await micro(); await m.clock.advance(1);
    which = second;                                    /* the door shown again: a new fade */
    m.ways.revealed();
    m.ways.open(["docs"], true); m.ways.open(["install"]);
    await micro(); await m.clock.advance(200);
    const during = { docs: m.isOpen(m.planets.docs), install: m.isOpen(m.planets.install), gate: m.gate.disabled === false, flight: m.body.classes.has("ready-flight") };
    second.ok(); await micro(); await m.clock.advance(1);
    const after = { docs: m.isOpen(m.planets.docs), install: m.isOpen(m.planets.install), gate: m.gate.disabled === false, flight: m.body.classes.has("ready-flight") };
    return { during, after };
  },
  async N11() {
    const m = await mount({ anims: () => [] });
    m.ways.open(["install", "docs", "info", "back"], true);
    await micro();
    const atOnce = m.snap();
    await m.clock.advance(60000);
    return { atOnce, late: m.snap(), anims1: m.backs.every(BACK_ANIM), now: m.clock.now() };
  },
};

/* N6 / N7: the backs before the reveal, with or without the gate; then the reveal */
async function backsCase({ reduced, gate }) {
  const fade = deferred();
  const m = await mount({ reduced, anims: () => [anim(fade.p)] });
  m.ways.open(["back"], gate);
  await micro();
  const atOnce = m.snap();
  const animOnce = reduced ? m.backs.every((b) => b.animateCalls.length === 0) : m.backs.every(BACK_ANIM);
  await m.clock.advance(5000);
  const waiting = m.snap();
  m.ways.revealed(); await m.clock.advance(100); fade.ok(); await micro(); await m.clock.advance(1);
  const after = m.snap();
  const animStill = reduced ? m.backs.every((b) => b.animateCalls.length === 0) : m.backs.every(BACK_ANIM);
  return { atOnce, animOnce, waiting, after, animStill };
}

if (process.argv[2] === "--child") await childMain(CASES);

const run = (c) => runCase(import.meta.url, c, 30000);
const ok = (r) => !r.error;

{
  const r = run("N1");
  check("N1 before revealed(), install, docs and info stay closed (no ready, tabindex and aria-disabled kept)", ok(r) && r.planetsShut && !r.planetsOpen, `${JSON.stringify(r.planetsShut)}${errOf(r)}`);
}
{
  const r = run("N2");
  check("N2 before revealed(), open([docs], true) leaves the gate disabled and sets no ready-flight", ok(r) && !r.gateOn && !r.flight, `gate on ${r.gateOn}, ready-flight ${r.flight}${errOf(r)}`);
}
{
  const r = run("N3");
  check("N3 the fade running (its finished held, look-alike animations ignored): nothing is open yet", ok(r) && r.during.planetsShut && !r.during.gateOn && !r.during.flight, `${JSON.stringify(r.during)}${errOf(r)}`);
  check("N3 when the fade ends: every way asked is open, the gate enabled and ready-flight set", ok(r) && r.after.planetsOpen && r.after.gateOn && r.after.flight, `${JSON.stringify(r.after)}${errOf(r)}`);
}
{
  const r = run("N4");
  check("N4 no matching animation: the ways are not open at the call", ok(r) && r.atCall.planetsShut && !r.atCall.gateOn && r.early.planetsShut, `at the call ${JSON.stringify(r.atCall)}; 5 ms on ${JSON.stringify(r.early)}${errOf(r)}`);
  check("N4 ... they open at the next frame", ok(r) && r.after.planetsOpen && r.after.gateOn && r.after.flight, `${JSON.stringify(r.after)}${errOf(r)}`);
}
{
  const r = run("N5");
  check("N5 a cancelled fade: still held while it runs", ok(r) && r.during.planetsShut, `${JSON.stringify(r.during)}${errOf(r)}`);
  check("N5 ... and `finished` rejecting still opens the ways, with no unhandled rejection", ok(r) && r.after.planetsOpen && r.after.gateOn && r.unhandled === 0, `${JSON.stringify(r.after)}; unhandled rejections ${r.unhandled}${errOf(r)}`);
}
for (const [name, tag, gate, reduced] of [["N6", "N6", false, false], ["N6-reduced", "N6 (reduced motion)", false, true], ["N7", "N7", true, false]]) {
  const r = run(name);
  check(`${tag} open([back]${gate ? ", true" : ""}) before revealed(): every back opens at once`, ok(r) && r.atOnce.backsOpen, `${JSON.stringify(r.atOnce)}${errOf(r)}`);
  check(`${tag} ... ${reduced ? "with no animate call" : "with one 600 ms ease filter-opacity animate call each"}`, ok(r) && r.animOnce, `backs' animate calls ${JSON.stringify(r.atOnce?.backAnims)}${errOf(r)}`);
  check(`${tag} ... the planets${gate ? ", the gate and ready-flight" : ""} are untouched until the reveal`, ok(r) && r.waiting.planetsShut && !r.waiting.gateOn && !r.waiting.flight, `${JSON.stringify(r.waiting)}${errOf(r)}`);
  check(`${tag} ... the reveal adds no second animate call${gate ? " and opens the gate and ready-flight" : ""}`, ok(r) && r.animStill && (!gate || (r.after.gateOn && r.after.flight)) && (gate || (!r.after.gateOn && !r.after.flight)), `${JSON.stringify(r.after)}${errOf(r)}`);
}
{
  const r = run("N8");
  check("N8 save-data call: backs open at once (one animate each); planets and gate wait", ok(r) && r.atOnce.backsOpen && r.atOnce.planetsShut && !r.atOnce.gateOn && r.waiting.planetsShut && !r.waiting.flight, `at once ${JSON.stringify(r.atOnce)}; 5 s on ${JSON.stringify(r.waiting)}${errOf(r)}`);
  check("N8 ... planets and gate open at the reveal, backs not faded a second time", ok(r) && r.after.planetsOpen && r.after.gateOn && r.after.flight && r.anims1, `${JSON.stringify(r.after)}; one animate each ${r.anims1}${errOf(r)}`);
}
{
  const r = run("N9");
  check("N9 after the first reveal ended, open(...) opens within microtasks, no frame or timer advanced", ok(r) && r.snap.planetsOpen && r.snap.gateOn && r.snap.flight && r.snap.backsOpen && r.advanced === 0, `${JSON.stringify(r.snap)}; virtual ms advanced ${r.advanced}${errOf(r)}`);
  check("N9 ... the backs are faded once", ok(r) && r.anims1, `${errOf(r) || "one animate each"}`);
}
{
  const r = run("N10");
  check("N10 a second revealed(): ways asked while its fade runs wait", ok(r) && !r.during.docs && !r.during.install && !r.during.gate && !r.during.flight, `${JSON.stringify(r.during)}${errOf(r)}`);
  check("N10 ... and are released at its end", ok(r) && r.after.docs && r.after.install && r.after.gate && r.after.flight, `${JSON.stringify(r.after)}${errOf(r)}`);
}
{
  const r = run("N11");
  check("N11 revealed() never called: only the backs open at once", ok(r) && r.atOnce.backsOpen && r.atOnce.planetsShut && !r.atOnce.gateOn, `${JSON.stringify(r.atOnce)}${errOf(r)}`);
  check("N11 ... after 60 s of virtual time planets and gate are still closed, backs faded once", ok(r) && r.now >= 60000 && r.late.planetsShut && !r.late.gateOn && !r.late.flight && r.anims1, `${JSON.stringify(r.late)} at ${r.now} ms${errOf(r)}`);
}
{
  let src = null, why = "";
  try { src = readFileSync(rootOf(WAYS), "utf8"); } catch (e) { why = `; assets/js/ways.js does not exist (${e.code})`; }
  const flag = src && /\bFLAGS\b|\bflags\b|location\.search|URLSearchParams/.exec(src);
  check("N12 ways.js reads no flag", src !== null && !flag, src === null ? `no file${why}` : `${flag ? "found " + flag[0] : "none read"}`);
  const door = src && /(?:from|import\s*\()\s*["'][^"']*\/door\//.exec(src);
  check("N12 ... and imports nothing from assets/door/", src !== null && !door, src === null ? `no file${why}` : `${door ? "found " + door[0] : "no door import"}`);
}
{
  const src = readFileSync(rootOf("../../assets/js/main.js"), "utf8");
  check("N13 main.js imports createWays from ./ways.js", /import\s*\{[^}]*\bcreateWays\b[^}]*\}\s*from\s*["']\.\/ways\.js["']/.test(src), "import line");
  check("N13 ... and no longer holds `let planetsIn = Promise.resolve()`", !/let\s+planetsIn\s*=\s*Promise\.resolve\(\)/.test(src), "the settled-from-load promise");
  const at = src.indexOf("onLit(");
  const end = src.indexOf("onOpen(", at);
  const onLit = at >= 0 && end > at ? src.slice(at, end) : "";
  check("N13 ... and showDoor's onLit calls revealed()", /\brevealed\(\)/.test(onLit), onLit ? "onLit body read" : "onLit not found");
}
finish();
