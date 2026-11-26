/*
 * Tests for #104 (the flight world's verdict, after a compile): written from the issue alone, before the fix. Seen on a
 * real device in desktop Firefox: the machine was remembered "on" at 10 ms frames; the flight's shaders finished
 * compiling in the worker (3.3 s); in the next second the browser withheld frames (pauses of 100-333 ms, the page's
 * thread free); the verdict's re-check timed three frames at 58, 63 and 69 ms, called them quiet, and judged the world
 * off. busy.js's quiet() holds only SETTLE (100 ms) after work ends, which is shorter than the browser's withholding.
 *
 *   node tools/ci/quiet-after-compile-test.mjs
 *
 * What the code must do, and what is tested (the settling window chosen here is WINDOW = 1000 ms after the work ended:
 * the observed withholding lasted about 1 s after the compile; no existing constant fits: SETTLE is 100 ms, SPAN_CAP
 * 5000 ms, QUIET_WAIT 8000 ms is the bound on the whole wait):
 *
 *   R1  work ends (a worker's compile reported done, a page compile read, or a picture uploaded), then the first 3
 *       frames timed inside the next WINDOW ms cost 60 ms (the browser withholding): the verdict is "on", because those
 *       frames were waited out or thrown away; the frames after cost 10 ms. No 60 ms frame is among those timed.
 *   R2  control: the same 60 ms frames with no compile or upload anywhere: "off" at once (no extra delay).
 *   R3  work ends, and every frame costs 60 ms long after the window: "off", said within QUIET_WAIT (8000 ms) + WINDOW
 *       + 1000 ms of the work's end (a bounded wait, no endless deferral).
 *
 * No browser; each case runs in a fresh Node process against the stub page of door-stub.mjs, on its virtual clock.
 */
import { INDEX, installPage, installClock, childMain, runCase, check, finish } from "./door-stub.mjs";

const BUSY = "../../assets/door/busy.js";
const WINDOW = 1000, END_AT = 1500, FIRST = 3;

/* the journey on the stub page; every frame of the fitness test is seen and given the cost cost(frame, b) */
async function boot(cost) {
  const page = installPage({ hidden: false });
  const clock = installClock();
  const rec = { frames: [], world: null, lines: [], endedAt: -1 };
  const say = (...a) => { const l = a.join(" "); page.lines.push(l); rec.lines.push({ t: clock.now(), l }); };
  console.info = say; console.log = say;
  const create = page.document.createElement;
  page.document.createElement = (tag) => {
    const c = create(tag);
    if (tag !== "canvas") return c;
    const get = c.getContext;
    c.getContext = (kind, ...r) => { if (kind === "webgl2") rec.world ||= c; return get(kind, ...r); };
    return c;
  };
  const read = page.glBase.readPixels;
  const seen = new Map();
  page.glBase.readPixels = (x, y, w, h, ...r) => {
    read(x, y, w, h, ...r);
    const c = rec.world;
    if (!(w === 1 && h === 1 && c && c.width <= 0.5 * globalThis.innerWidth)) return;
    const key = `${c.width}x${c.height}`, idx = seen.get(key) || 0;
    seen.set(key, idx + 1);
    const f = { t: clock.now(), warm: idx < 2, cost: 0 };
    if (!f.warm) f.cost = cost(f, rec);
    rec.frames.push(f);
    clock.jump(f.cost || 10);
  };
  const rawSet = globalThis.setTimeout;
  const b = { page, clock, rec, later: (f, ms) => rawSet(f, ms) };
  b.door = await import(INDEX);
  const d = b.door.createDoor({ typingWait: 0, flags: {} });
  b.door.openChores();
  b.door.gpu();
  b.journey = d.journey(page.journeyOptions());
  b.verdict = () => rec.lines.find((x) => /flight world: (on|off)/.test(x.l)) || null;
  b.timed = () => rec.frames.filter((f) => !f.warm);
  b.run = async () => { b.journey.warm().catch(() => {}); await clock.advance(40000, () => !!b.verdict()); await clock.advance(500); };
  return b;
}

/* 60 ms for the first FIRST timed frames that start inside WINDOW ms after the work ended, else 10 ms */
const withheld = (f, rec) => (rec.endedAt >= 0 && f.t < rec.endedAt + WINDOW && ++rec.n <= FIRST ? 60 : 10);
const withheldCost = (f, rec) => { rec.n ||= 0; return withheld(f, rec); };

/* the work: a worker's compile (busyHeard), a page compile (read at END_AT) or one upload (at END_AT) */
async function work(b, kind) {
  const busy = await import(BUSY);
  const gl = b.page.gl;
  const ended = () => { b.rec.endedAt = b.clock.now(); };
  if (kind === "worker") {
    b.later(() => busy.busyHeard("worker", { n: 1, gen: 1 }), 1);
    b.later(() => { busy.busyHeard("worker", { n: 0, gen: 2 }); ended(); }, END_AT);
  } else if (kind === "page") {
    b.later(() => { b.s = gl.createShader(35633); gl.compileShader(b.s); }, 1);
    b.later(() => { gl.getShaderParameter(b.s, 35713); ended(); }, END_AT);
  } else {
    /* (an upload is over at once: put early, before the first frame the test can take) */
    b.later(() => { gl.texSubImage2D(3553, 0, 0, 0, 1, 1, 6408, 5121, null); ended(); }, 200);
  }
}
const summary = (b) => {
  const v = b.verdict(), line = b.rec.lines.find((x) => /frames? timed/.test(x.l));
  const list = line && /\(([\d, ]+) ms\)/.exec(line.l);
  return { verdict: v && v.l, at: v && v.t, endedAt: b.rec.endedAt, timed: b.timed().map((f) => [Math.round(f.t), f.cost]), listed: list ? list[1].split(",").map(Number) : [], line: line && line.l };
};

const CASES = {};
for (const kind of ["worker", "page", "upload"]) {
  CASES[`r1_${kind}`] = async () => { const b = await boot(withheldCost); await work(b, kind); await b.run(); return summary(b); };
  CASES[`r3_${kind}`] = async () => { const b = await boot(() => 60); await work(b, kind); await b.run(); return summary(b); };
}
CASES.r2 = async () => { const b = await boot(() => 60); await b.run(); return summary(b); };

if (process.argv[2] === "--child") await childMain(CASES);

const run = (name) => runCase(import.meta.url, name, 120000);
const show = (v) => JSON.stringify(v);
const chk = (name, r, fn) => {
  if (r.error || r.none) { check(name, false, String(r.none || r.error)); return; }
  let ok = false, detail = "";
  try { [ok, detail] = fn(r); } catch (e) { detail = `unreadable (${e && e.message}): ${show(r).slice(0, 240)}`; }
  check(name, !!ok, detail);
};

for (const kind of ["worker", "page", "upload"]) {
  const r = run(`r1_${kind}`);
  chk(`R1 (${kind}) work ends, 3 frames of 60 ms follow within ${WINDOW} ms, then 10 ms ones: the verdict is "on", not "off"`, r,
    (r) => [/flight world: on/.test(r.verdict || ""), `verdict ${show(r.verdict)}; timed [t, ms] ${show(r.timed)}; work ended at ${r.endedAt}`]);
  chk(`R1 (${kind}) no 60 ms frame is among the frames the verdict counted`, r,
    (r) => [r.listed.length > 0 && r.listed.every((ms) => ms <= 30), `counted (ms) ${show(r.listed)}; line ${show(r.line)}`]);
}
{
  const r = run("r2");
  chk("R2 control: 60 ms frames with no compile or upload anywhere: \"off\", said within 2 s", r,
    (r) => [/flight world: off/.test(r.verdict || "") && r.at < 2000, `verdict ${show(r.verdict)} at ${r.at} ms; timed ${show(r.timed)}`]);
}
for (const kind of ["worker", "page", "upload"]) {
  const r = run(`r3_${kind}`);
  chk(`R3 (${kind}) work ends, frames stay at 60 ms past the window: "off", said within 8000 + ${WINDOW} + 1000 ms of its end`, r,
    (r) => [/flight world: off/.test(r.verdict || "") && r.endedAt >= 0 && r.at <= r.endedAt + 8000 + WINDOW + 1000, `verdict ${show(r.verdict)} at ${r.at} ms, work ended ${r.endedAt}`]);
}
finish();
