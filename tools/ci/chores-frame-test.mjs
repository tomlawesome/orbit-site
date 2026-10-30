/*
 * Tests for #101's second step (ADR-0004 section 6d.2), written from the specification alone: the page's chore queue
 * runs its share inside the animation frame's callback, before the paint, with a backstop timer, instead of hopping
 * from the frame to a later task. Behaviour only, never timings: every time is the stub's virtual clock.
 *
 *   node tools/ci/chores-frame-test.mjs
 *
 *   B1  opened, yields 6 ms late, twelve soft chores of 3 ms: every share's first chore starts at the frame
 *       callback's time, the chores of one share have no yield and no timer between them, at most 4 frames asked
 *   B2  the window never cuts a chore: chores of 5 ms run two a frame (starts 0 and 5 ms into the callback), chores of
 *       9 ms one a frame
 *   B3  a hard chore (rest 60) then a soft one: `timer 20`, then a frame or the backstop, whichever first (on the
 *       stub's healthy frames it is the frame), the soft chore starting at that callback with no yield; a measure
 *       (rest 200): `timer 200`, then likewise
 *   B4  frames absent: every chore still runs, a share per 50 ms (the backstop), `backstops 4` and `frames 4` in the
 *       line; frames 200 ms late: all ten run within 300 ms, `backstops` 3 or more
 *   B5  healthy frames: `backstops 0`, and no share begins 50 ms after the last one's end
 *   B6  the reveal (openSoft) keeps one soft chore a frame and its hop after the frame, and sets no backstop
 *   B7  the worker's queue (pace("none")) sets no backstop and asks no frame (its pacing is chores-yield-test Y6)
 *   B8  the line: `yields 0, 0 ms` and `backstops 0` after B1's run; `yields 3, 18 ms` after a reveal of three soft
 *       chores with yields 6 ms late; `backstops 4` after B4's; `timers` counts rests alone (B3: `timers 1, asked
 *       20 ms`); `resting` within 1 ms of 0 in each
 *   B9  a chore arriving while the window is open joins it, in a task of the arrival's own (never synchronously, no
 *       frame, no yield); one arriving after the window waits for a frame
 *   B11 hard chores (3 ms, rest 60) on slow and absent frames (ADR-0004 6d.6): frames 200 ms late, two queued and
 *       opened: the second starts 70 ms (within 1 ms) after the first ended, from the backstop (`backstops` 1 or more),
 *       with no frame callback between them; hurried, 50 ms; frames absent, six all run, each 70 ms after the last,
 *       `backstops 6`; healthy 16 ms frames: the second starts at the first frame callback after the 20 ms rest, never
 *       before it, `backstops 0`. (The control, today's code 792b724 with frames absent, never starts the second: not
 *       asserted here)
 *   B12 two hard chores never share one window: healthy frames, hard chores (1 ms, rest 60) queued three deep: each
 *       starts in a later frame callback than the one before, never 1 ms after it in the same window
 *   B10 `moving`: exported; while held (by hand, or by a page-path flight's loop) the window is 4 ms (two 3 ms chores
 *       a frame) and `choresNow().moving` is 1; released, at the loop's end, or after `reset()`, 8 ms (three a frame)
 *       and 0; on the worker path `moving` stays 0 and the page's queue stays at 8 ms
 *
 * Every case runs in a fresh Node process on the stub page (door-stub.mjs), on its virtual clock. A chore "spends"
 * time by moving the page's clock on inside it. The frame (requestAnimationFrame) is wrapped to log the time of each
 * callback; "frames absent" is one that never calls back, "frames slow" one that calls back 200 ms late. Timers set
 * (setTimeout) are counted apart from the two guards the queue sets (the cap's 15000 ms and the backstop's 50 ms:
 * neither a hop nor a rest). Chores are reached through assets/door/index.js as a host reaches them.
 */
import { INDEX, installPage, installClock, installDom, fakeWorkers, FONTS, BASE, hostImage, childMain, runCase, chk, finish } from "./door-stub.mjs";

const CHORES = "../../assets/door/chores.js";

/* frames: "stub" (the stub's, 16 ms), "absent" (asked, never called back), "slow" (called back 200 ms later) */
async function setup({ none = false, frames = "stub", flags = {} } = {}) {
  const page = installPage();
  const clock = installClock();
  let extra = 0;
  const base = performance.now;
  Object.defineProperty(performance, "now", { value: () => base() + extra, configurable: true, writable: true });
  const spend = (ms) => { extra += ms; };
  /* frames asked, rest timers set, in order (ev); the backstop's 50 ms apart (back); the callbacks' times (cb) */
  const log = { frames: 0, timers: [], ev: [], back: [], cb: [] };
  let inFrame = false;
  const raf = globalThis.requestAnimationFrame;
  const set = globalThis.setTimeout;
  let fakeId = 1e9;
  globalThis.requestAnimationFrame = (f) => {
    log.frames++; log.ev.push("frame");
    const cb = (t) => { log.cb.push(performance.now()); f(t); };
    if (frames === "absent") return ++fakeId;
    if (frames === "slow") return set(() => cb(performance.now()), 200);
    inFrame = true;
    try { return raf(cb); } finally { inFrame = false; }
  };
  globalThis.setTimeout = (f, ms = 0, ...a) => {
    if (!inFrame) {
      const m = Number(ms) || 0;
      if (m === 50) log.back.push(performance.now());
      else if (m !== 15000) { log.timers.push(m); log.ev.push(`timer ${m}`); }
    }
    return set(f, ms, ...a);
  };
  const { choresNow } = await import(CHORES);
  const door = await import(INDEX);
  const d = door.createDoor({ typingWait: 0, flags });
  if (none) door.pace("none");
  const reset = () => { log.frames = 0; log.timers.length = 0; log.ev.length = 0; log.back.length = 0; log.cb.length = 0; };
  return { page, clock, door, d, spend, log, reset, choresNow };
}

const lineOf = (page) => page.lines.filter((l) => /chores at x\b/.test(l));

/* a chore: records where it started (the page's clock, the frames asked, the yields and rest timers so far, `moving`)
   and spends `dur` ms */
const rec = (ctx, ran, name, dur = 0) => () => {
  ran.push({ name, at: performance.now(), dur, frames: ctx.log.frames, yields: ctx.clock.yields(), timers: ctx.log.timers.length, moving: ctx.choresNow().moving });
  if (dur) ctx.spend(dur);
};
const batch = (ctx, ran, tag, n = 12, dur = 3) => { for (let i = 0; i < n; i++) ctx.door.chore(rec(ctx, ran, `${tag}${i}`, dur), 0, "", { soft: true }); };
const until = async (ctx, cond, limit = 30000, step = 100) => { let t = 0; while (t < limit && !cond()) { await ctx.clock.advance(step); t += step; } return cond(); };

async function run(n, dur, { delay = 0, frames = "stub", settle = 5000, tag = "s" } = {}) {
  const ctx = await setup({ frames });
  const ran = [];
  batch(ctx, ran, tag, n, dur);
  ctx.reset();
  ctx.clock.yieldDelay(delay);
  ctx.door.openChores();
  const t0 = performance.now();
  await ctx.clock.advance(settle);
  ctx.door.noteChores("x");
  return { ran, cb: ctx.log.cb.slice(), frames: ctx.log.frames, timers: ctx.log.timers.slice(), back: ctx.log.back.length, yields: ctx.clock.yields(), lines: lineOf(ctx.page), t0 };
}

async function hardThenSoft(rest) {
  const ctx = await setup();
  const ran = [];
  let hardN = 0;
  /* the soft chore is queued from inside the hard one: queued together before the open, the queue serves the soft
     chore first (seen on today's code), and the case is the soft chore that follows a hard one */
  ctx.door.chore(() => {
    hardN = ctx.log.ev.length;
    rec(ctx, ran, "hard")();
    ctx.door.chore(() => { rec(ctx, ran, "soft")(); ran[ran.length - 1].since = ctx.log.ev.slice(hardN); }, 0, "", { soft: true });
  }, rest, rest === 200 ? "measure" : "hard");
  ctx.reset();
  ctx.door.openChores();
  await ctx.clock.advance(5000);
  ctx.door.noteChores("x");
  return { ran, cb: ctx.log.cb.slice(), lines: lineOf(ctx.page) };
}

/* B11/B12: n hard chores (tag "hard", rest 60) of `dur` ms, queued and opened; `hurry` hurries their tag ("flight") */
async function hardRun(n, { dur = 3, frames = "stub", hurry = false, settle = 5000 } = {}) {
  const ctx = await setup({ frames });
  const ran = [];
  const tag = hurry ? "flight" : "hard";
  for (let i = 0; i < n; i++) ctx.door.chore(rec(ctx, ran, `h${i}`, dur), 60, tag);
  ctx.reset();
  ctx.door.openChores();
  if (hurry) ctx.door.hurryChores("flight");
  await ctx.clock.advance(settle);
  ctx.door.noteChores("x");
  return { ran, cb: ctx.log.cb.slice(), timers: ctx.log.timers.slice(), lines: lineOf(ctx.page) };
}

async function reveal(n, dur, delay) {
  const ctx = await setup();
  const ran = [];
  batch(ctx, ran, "r", n, dur);
  ctx.reset();
  ctx.clock.yieldDelay(delay);
  ctx.door.openSoft();
  await ctx.clock.advance(5000);
  ctx.door.noteChores("x");
  return { ran, timers: ctx.log.timers.slice(), back: ctx.log.back.length, lines: lineOf(ctx.page) };
}

async function worker() {
  const ctx = await setup({ none: true });
  const ran = [];
  for (let i = 0; i < 6; i++) ctx.door.chore(rec(ctx, ran, `w${i}`), 20, "");
  ctx.door.chore(rec(ctx, ran, "measure"), 200, "measure");
  ctx.reset();
  ctx.door.openChores();
  await ctx.clock.advance(5000);
  ctx.door.noteChores("x");
  return { ran: ran.length, frames: ctx.log.frames, back: ctx.log.back.length, lines: lineOf(ctx.page) };
}

async function joins() {
  const ctx = await setup();
  const ran = [];
  const mark = {};
  ctx.door.chore(() => {
    rec(ctx, ran, "A", 2)();
    setTimeout(() => { mark.bTask = performance.now(); ctx.door.chore(rec(ctx, ran, "B", 1), 0, "", { soft: true }); mark.bSync = ran.filter((r) => r.name === "B").length; }, 1);
    setTimeout(() => { mark.cFrames = ctx.log.frames; mark.cQueued = performance.now(); ctx.door.chore(rec(ctx, ran, "C", 1), 0, "", { soft: true }); }, 10);
  }, 0, "", { soft: true });
  ctx.reset();
  ctx.door.openChores();
  await ctx.clock.advance(5000);
  return { ran, mark, cb: ctx.log.cb.slice() };
}

/* B10: the budget while held by hand */
async function movingHeld() {
  const ctx = await setup();
  const ran = [];
  const out = { api: typeof ctx.door.moving, ran };
  if (out.api !== "function") return { ...out, none: "`moving` is not exported from assets/door/index.js" };
  ctx.door.openChores();
  const release = ctx.door.moving();
  out.during = ctx.choresNow().moving;
  batch(ctx, ran, "h");
  await ctx.clock.advance(3000);
  release();
  out.after = ctx.choresNow().moving;
  batch(ctx, ran, "f");
  await ctx.clock.advance(3000);
  out.cb = ctx.log.cb.slice();
  return out;
}

/* B10: a page-path flight (the fit-skip bed: gpu forced, the fitness test skipped); the loop is `moving` */
async function movingFlight(how) {
  const ctx = await setup({ flags: { gpu: "force", fit: "skip" } });
  const journey = ctx.d.journey(ctx.page.journeyOptions());
  ctx.door.openChores();
  const ran = [];
  const out = { ran };
  journey.fly(ctx.door.UP, { title: "Orbit", subtitle: "to somewhere" });
  if (!(await until(ctx, () => ctx.choresNow().moving === 1))) return { ...out, none: `choresNow().moving never reached 1 during a page-path flight (it reads ${JSON.stringify(ctx.choresNow().moving)})` };
  batch(ctx, ran, "m");
  await ctx.clock.advance(1500);
  out.movingNow = ctx.choresNow().moving;
  if (how === "reset") {
    journey.reset();
    await ctx.clock.advance(100);
  } else {
    out.ended = await until(ctx, () => ctx.choresNow().moving === 0);
  }
  out.after = ctx.choresNow().moving;
  batch(ctx, ran, "f");
  await ctx.clock.advance(3000);
  out.cb = ctx.log.cb.slice();
  return out;
}

/* B10: the worker path (draw-hello-test's bed, built here so the clock can be spent in before the door is imported) */
async function movingWorker() {
  const page = installPage();
  const clock = installClock();
  let extra = 0;
  const base = performance.now;
  Object.defineProperty(performance, "now", { value: () => base() + extra, configurable: true, writable: true });
  const dom = installDom(page, { baseURI: BASE });
  globalThis.innerWidth = 1280; globalThis.innerHeight = 800; globalThis.devicePixelRatio = 1.5;
  globalThis.Worker = class Worker {};
  const ext = page.glBase.getExtension;
  page.glBase.getExtension = (n) => (n === "KHR_parallel_shader_compile" ? null : ext(n));
  const host = fakeWorkers();
  const { choresNow } = await import(CHORES);
  const door = await import(INDEX);
  const d = door.createDoor({ typingWait: 0, settle: 700, image: hostImage, flags: { draw: "worker" }, drawWorker: () => host.make(), fonts: FONTS.map((f) => ({ ...f })) });
  door.openChores();
  const journey = d.journey(dom.journeyOptions());
  const ctx = { clock, door, choresNow, log: { frames: 0, timers: [] }, spend: (ms) => { extra += ms; } };
  const ran = [];
  const samples = [choresNow().moving];
  journey.fly(door.UP, { on: {} });
  let queued = false;
  for (let i = 0; i < 120; i++) {
    await clock.advance(100);
    samples.push(choresNow().moving);
    if (!queued && host.first() && host.first().of("start").length >= 1) { queued = true; batch(ctx, ran, "w"); }
  }
  await clock.advance(3000);
  return { samples, ran, started: host.first() ? host.first().of("start").length : 0, queued };
}

const CASES = {
  b1: () => run(12, 3, { delay: 6 }),
  b2a: () => run(6, 5, { delay: 6 }),
  b2b: () => run(4, 9, { delay: 6 }),
  b3a: () => hardThenSoft(60),
  b3b: () => hardThenSoft(200),
  b11a: () => hardRun(2, { frames: "slow" }),
  b11b: () => hardRun(2, { frames: "slow", hurry: true }),
  b11c: () => hardRun(6, { frames: "absent" }),
  b11d: () => hardRun(2),
  b12: () => hardRun(3, { dur: 1 }),
  b4a: () => run(10, 3, { frames: "absent" }),
  b4b: () => run(10, 3, { frames: "slow", settle: 3000 }),
  b5: () => run(12, 3, { delay: 6 }),
  b6: () => reveal(5, 5, 0),
  b7: worker,
  b8: () => reveal(3, 5, 6),
  b9: joins,
  b10a: movingHeld,
  b10b: () => movingFlight("end"),
  b10c: () => movingFlight("reset"),
  b10d: movingWorker,
};

if (process.argv[2] === "--child") await childMain(CASES);

/* ----- reading the results ----- */

const NUM = "(\\d+(?:\\.\\d+)?)";
const shown = (r) => (r.lines && r.lines.length ? r.lines[0] : "no \"chores at x\" line");
const line = (r) => (r.lines && r.lines.length === 1 ? r.lines[0] : "");
const figure = (r, re) => { const m = re.exec(line(r)); return m ? m.slice(1).map(Number) : null; };
const lineFrames = (r) => figure(r, new RegExp(`\\bframes (\\d+), ${NUM} ms \\(longest ${NUM} ms, (\\d+) over 50 ms\\)`));
const lineTimers = (r) => figure(r, new RegExp(`\\btimers (\\d+), asked ${NUM} ms, took ${NUM} ms`));
const lineYields = (r) => figure(r, new RegExp(`\\byields (\\d+), ${NUM} ms`));
const lineBackstops = (r) => figure(r, /\bbackstops (\d+)/);
const lineResting = (r) => figure(r, /\bresting (-?\d+(?:\.\d+)?) ms/);
const text = (x, name) => (x ? `${name} ${x.join(", ")}` : `no \`${name}\` figure`);

/* the shares: runs of chores that started back to back (a gap above 1 ms from the last one's end is a new share) */
const shares = (ran) => {
  const out = [];
  for (const r of ran) {
    const g = out[out.length - 1];
    const p = g && g[g.length - 1];
    if (p && r.at - (p.at + p.dur) <= 1) g.push(r); else out.push([r]);
  }
  return out;
};
const atCb = (cb, t) => cb.some((c) => Math.abs(c - t) <= 0.5);
const sizes = (ran) => JSON.stringify(shares(ran).map((g) => g.length));
const gaps = (ran) => shares(ran).slice(1).map((g, i) => { const p = shares(ran)[i]; const l = p[p.length - 1]; return +(g[0].at - (l.at + l.dur)).toFixed(2); });
const restingOk = (r) => { const x = lineResting(r); return [!!x && Math.abs(x[0]) <= 1, `${x ? `resting ${x[0]} ms` : "no `resting` figure"}: ${shown(r)}`]; };

/* ----- the checks ----- */

{
  const r = runCase(import.meta.url, "b1");
  chk("B1 control: all twelve soft chores ran, with yields 6 ms late and frame callbacks logged", r, (r) => [r.ran.length === 12 && r.cb.length > 0, `${r.ran.length} ran; callbacks at ${JSON.stringify(r.cb)}`]);
  chk("B1 every share's first chore starts at the frame callback's time (today it starts 6 ms after)", r, (r) => [shares(r.ran).every((g) => atCb(r.cb, g[0].at)), `first starts ${JSON.stringify(shares(r.ran).map((g) => g[0].at))}; callbacks ${JSON.stringify(r.cb)}`]);
  chk("B1 the chores of one share have no yield and no timer between them (and shares of more than one chore exist)", r, (r) => [shares(r.ran).some((g) => g.length > 1) && shares(r.ran).every((g) => g.every((c) => c.yields === g[0].yields && c.timers === g[0].timers)), JSON.stringify(shares(r.ran).map((g) => g.map((c) => [c.yields, c.timers])))]);
  chk("B1 at most 4 frames asked", r, (r) => [r.frames <= 4, `${r.frames} frames asked; shares ${sizes(r.ran)}`]);
}
{
  const r = runCase(import.meta.url, "b2a");
  chk("B2 control: all six chores of 5 ms ran", r, (r) => [r.ran.length === 6, `${r.ran.length} ran`]);
  chk("B2 chores of 5 ms: two a frame, the first at the callback and the second 5 ms into it", r, (r) => {
    const s = shares(r.ran);
    return [s.length === 3 && s.every((g) => g.length === 2 && atCb(r.cb, g[0].at) && Math.abs(g[1].at - g[0].at - 5) <= 0.5), `shares ${sizes(r.ran)}, starts ${JSON.stringify(s.map((g) => g.map((c) => c.at)))}, callbacks ${JSON.stringify(r.cb)}`];
  });
}
{
  const r = runCase(import.meta.url, "b2b");
  chk("B2 control: all four chores of 9 ms ran", r, (r) => [r.ran.length === 4, `${r.ran.length} ran`]);
  chk("B2 chores of 9 ms: one a frame, each at a callback (a chore started inside the window runs whole; the window then shuts)", r, (r) => {
    const s = shares(r.ran);
    return [s.length === 4 && s.every((g) => g.length === 1 && atCb(r.cb, g[0].at)), `shares ${sizes(r.ran)}, starts ${JSON.stringify(r.ran.map((c) => c.at))}, callbacks ${JSON.stringify(r.cb)}`];
  });
}
for (const [id, rest, ask] of [["b3a", 60, 20], ["b3b", 200, 200]]) {
  const r = runCase(import.meta.url, id);
  const name = rest === 60 ? "a hard chore (rest 60)" : "a measure (rest 200)";
  chk(`B3 control: ${name} and the soft chore after it both ran, one \`chores at x\` line`, r, (r) => [r.ran.length === 2 && r.lines.length === 1, `${r.ran.length} ran; ${shown(r)}`]);
  chk(`B3 after ${name} the order is \`timer ${ask}\`, then a frame or the backstop, whichever first (here, healthy frames: the frame)`, r, (r) => [JSON.stringify(r.ran[1].since) === JSON.stringify([`timer ${ask}`, "frame"]), JSON.stringify(r.ran[1].since)]);
  chk(`B3 on healthy frames the soft chore starts at that frame's callback, with no yield since ${name}`, r, (r) => [atCb(r.cb, r.ran[1].at) && r.ran[1].at > r.ran[0].at && r.ran[1].yields === r.ran[0].yields, `hard at ${r.ran[0].at}, soft at ${r.ran[1].at}, callbacks ${JSON.stringify(r.cb)}, yields ${r.ran[0].yields} then ${r.ran[1].yields}`]);
}
{
  const r = runCase(import.meta.url, "b4a");
  chk("B4 control: with no frame ever called back, a frame was asked (the queue is waiting on one)", r, (r) => [r.frames >= 1 && r.cb.length === 0, `${r.frames} frames asked, ${r.cb.length} called back`]);
  chk("B4 frames absent: all ten chores still run (today 3 of 10 do: the first share, then the queue waits for a frame that never comes)", r, (r) => [r.ran.length === 10, `${r.ran.length} of 10 ran after 5000 ms`]);
  chk("B4 frames absent: each share after the first begins 50 ms after the last share's end", r, (r) => { const g = gaps(r.ran); return [g.length >= 2 && g.every((x) => Math.abs(x - 50) <= 1), `shares ${sizes(r.ran)}, gaps ${JSON.stringify(g)}`]; });
  chk("B4 frames absent: the line reads `backstops 4` and `frames 4`", r, (r) => { const b = lineBackstops(r), f = lineFrames(r); return [!!b && b[0] === 4 && !!f && f[0] === 4, `${text(b, "backstops")}; ${f ? `frames ${f[0]}` : "no `frames` figure"}: ${shown(r)}`]; });
}
{
  const r = runCase(import.meta.url, "b4b");
  chk("B4 frames 200 ms late: all ten chores run within 300 ms of opening", r, (r) => [r.ran.length === 10 && r.ran[9].at - r.t0 < 300, `${r.ran.length} ran; the last started ${r.ran.length ? r.ran[r.ran.length - 1].at - r.t0 : "never"} ms after opening`]);
  chk("B4 frames 200 ms late: shares are 50 ms apart and the line reads `backstops` 3 or more", r, (r) => { const b = lineBackstops(r), g = gaps(r.ran); return [!!b && b[0] >= 3 && g.length >= 2 && g.slice(0, 2).every((x) => Math.abs(x - 50) <= 1), `${text(b, "backstops")}; gaps ${JSON.stringify(g)}`]; });
}
{
  const r = runCase(import.meta.url, "b5");
  chk("B5 control: healthy frames, all twelve chores ran, with the shares a frame apart", r, (r) => [r.ran.length === 12 && r.cb.length > 0, `${r.ran.length} ran; callbacks ${JSON.stringify(r.cb)}`]);
  chk("B5 healthy frames: the line reads `backstops 0`", r, (r) => { const b = lineBackstops(r); return [!!b && b[0] === 0, `${text(b, "backstops")}: ${shown(r)}`]; });
  chk("B5 healthy frames: no share begins 50 ms after the previous one's end", r, (r) => { const g = gaps(r.ran); return [g.length >= 1 && g.every((x) => Math.abs(x - 50) > 1), `gaps ${JSON.stringify(g)}`]; });
}
{
  const r = runCase(import.meta.url, "b6");
  chk("B6 control: all five soft chores of the reveal ran", r, (r) => [r.ran.length === 5, `${r.ran.length} ran`]);
  chk("B6 the reveal still runs one soft chore a frame (a frame asked between each start and the next)", r, (r) => [r.ran.length === 5 && r.ran.every((c, i) => i === 0 || c.frames > r.ran[i - 1].frames), `frames asked at each start: ${JSON.stringify(r.ran.map((c) => c.frames))}`]);
  chk("B6 the reveal keeps its hop: at least one yield before each chore", r, (r) => [r.ran.length === 5 && r.ran[0].yields >= 1 && r.ran.every((c, i) => i === 0 || c.yields >= r.ran[i - 1].yields + 1), `yields at each start: ${JSON.stringify(r.ran.map((c) => c.yields))}`]);
  chk("B6 the reveal sets no backstop timer and no rest timer", r, (r) => [r.back === 0 && r.timers.length === 0, `${r.back} backstop timers, rest timers ${JSON.stringify(r.timers)}`]);
}
{
  const r = runCase(import.meta.url, "b7");
  chk("B7 control: under pace(\"none\") all seven chores ran and the queue printed one line", r, (r) => [r.ran === 7 && r.lines.length === 1, `${r.ran} ran; ${shown(r)}`]);
  chk("B7 under pace(\"none\") no frame is asked and no backstop timer is set", r, (r) => [r.frames === 0 && r.back === 0, `${r.frames} frames, ${r.back} backstop timers`]);
  chk("B7 under pace(\"none\") the line reads `backstops 0`", r, (r) => { const b = lineBackstops(r); return [!!b && b[0] === 0, `${text(b, "backstops")}: ${shown(r)}`]; });
}
{
  const r = runCase(import.meta.url, "b1");
  chk("B8 after B1's run the line reads `yields 0, 0 ms`", r, (r) => { const y = lineYields(r); return [r.lines.length === 1 && !!y && y[0] === 0 && y[1] === 0, `${text(y, "yields")}: ${shown(r)}`]; });
  chk("B8 after B1's run the line reads `backstops 0`", r, (r) => { const b = lineBackstops(r); return [!!b && b[0] === 0, `${text(b, "backstops")}: ${shown(r)}`]; });
  chk("B8 after B1's run `timers` counts rests alone (0) and `resting` is within 1 ms of 0", r, (r) => { const t = lineTimers(r), [ok, d] = restingOk(r); return [!!t && t[0] === 0 && ok, `${text(t, "timers")}; ${d}`]; });
}
{
  const r = runCase(import.meta.url, "b8");
  chk("B8 control: all three soft chores of the reveal ran, yields 6 ms late", r, (r) => [r.ran.length === 3 && r.lines.length === 1, `${r.ran.length} ran; ${shown(r)}`]);
  chk("B8 after a reveal of three soft chores with yields 6 ms late the line reads `yields 3, 18 ms`", r, (r) => { const y = lineYields(r); return [!!y && y[0] === 3 && Math.abs(y[1] - 18) <= 1, `${text(y, "yields")}: ${shown(r)}`]; });
  chk("B8 after the reveal `resting` is within 1 ms of 0", r, (r) => restingOk(r));
}
{
  const r = runCase(import.meta.url, "b3a");
  chk("B8 after B3's hard chore the line reads `timers 1, asked 20 ms` (rests alone)", r, (r) => { const t = lineTimers(r); return [!!t && t[0] === 1 && t[1] === 20, `${text(t, "timers")}: ${shown(r)}`]; });
  chk("B8 after B3's hard chore `resting` is within 1 ms of 0", r, (r) => restingOk(r));
}
{
  const r = runCase(import.meta.url, "b4a");
  chk("B8 after B4's run `timers` counts rests alone (0) and `resting` is within 1 ms of 0", r, (r) => { const t = lineTimers(r), [ok, d] = restingOk(r); return [!!t && t[0] === 0 && ok, `${text(t, "timers")}; ${d}`]; });
}
const endOf = (c) => c.at + c.dur;
const cbBetween = (cb, a, b) => cb.filter((c) => c > a + 0.5 && c < b - 0.5);
const gapsAfterEnd = (ran) => ran.slice(1).map((c, i) => +(c.at - endOf(ran[i])).toFixed(2));
const near = (x, y) => Math.abs(x - y) <= 1;
{
  const r = runCase(import.meta.url, "b11a");
  chk("B11 control: frames 200 ms late, both hard chores (3 ms, rest 60) ran and the queue printed one line", r, (r) => [r.ran.length === 2 && r.lines.length === 1, `${r.ran.length} ran; ${shown(r)}`]);
  chk("B11 frames 200 ms late: the second hard chore starts 70 ms after the first ended (20 ms rest, 50 ms backstop)", r, (r) => { const g = gapsAfterEnd(r.ran); return [g.length === 1 && near(g[0], 70), `gap after the first's end ${JSON.stringify(g)}`]; });
  chk("B11 frames 200 ms late: no frame callback fell between the two hard chores, and `backstops` is 1 or more", r, (r) => { const b = lineBackstops(r); return [r.ran.length === 2 && cbBetween(r.cb, endOf(r.ran[0]), r.ran[1].at).length === 0 && !!b && b[0] >= 1, `callbacks between ${JSON.stringify(r.ran.length === 2 ? cbBetween(r.cb, endOf(r.ran[0]), r.ran[1].at) : "?")}; ${text(b, "backstops")}`]; });
}
{
  const r = runCase(import.meta.url, "b11b");
  chk("B11 control: hurried, frames 200 ms late, both hard chores ran", r, (r) => [r.ran.length === 2, `${r.ran.length} ran; ${shown(r)}`]);
  chk("B11 hurried, frames 200 ms late: the second hard chore starts 50 ms after the first ended", r, (r) => { const g = gapsAfterEnd(r.ran); return [g.length === 1 && near(g[0], 50), `gap after the first's end ${JSON.stringify(g)}`]; });
}
{
  const r = runCase(import.meta.url, "b11c");
  chk("B11 frames absent: all six hard chores run (the control, today's code, never starts the second)", r, (r) => [r.ran.length === 6, `${r.ran.length} of 6 ran after 5000 ms`]);
  chk("B11 frames absent: each hard chore starts 70 ms after the last one ended", r, (r) => { const g = gapsAfterEnd(r.ran); return [g.length === 5 && g.every((x) => near(x, 70)), `gaps after each end ${JSON.stringify(g)}`]; });
  chk("B11 frames absent: the line reads `backstops 6`", r, (r) => { const b = lineBackstops(r); return [!!b && b[0] === 6, `${text(b, "backstops")}: ${shown(r)}`]; });
}
{
  const r = runCase(import.meta.url, "b11d");
  chk("B11 control: healthy frames, both hard chores ran and frame callbacks were logged", r, (r) => [r.ran.length === 2 && r.cb.length > 0, `${r.ran.length} ran; callbacks ${JSON.stringify(r.cb)}`]);
  chk("B11 healthy frames: the second hard chore starts at the first frame callback after the 20 ms rest, never before it", r, (r) => {
    if (r.ran.length !== 2) return [false, `${r.ran.length} ran`];
    const ready = endOf(r.ran[0]) + 20;
    return [atCb(r.cb, r.ran[1].at) && r.ran[1].at >= ready - 0.5 && cbBetween(r.cb, ready, r.ran[1].at).length === 0, `first ended ${endOf(r.ran[0])}, rest over ${ready}, second at ${r.ran[1].at}; callbacks ${JSON.stringify(r.cb)}`];
  });
  chk("B11 healthy frames: the line reads `backstops 0`", r, (r) => { const b = lineBackstops(r); return [!!b && b[0] === 0, `${text(b, "backstops")}: ${shown(r)}`]; });
}
{
  const r = runCase(import.meta.url, "b12");
  const idx = (r, c) => r.cb.findIndex((t) => Math.abs(t - c.at) <= 0.5);
  chk("B12 control: healthy frames, all three hard chores (1 ms, rest 60) ran", r, (r) => [r.ran.length === 3 && r.cb.length > 0, `${r.ran.length} ran; callbacks ${JSON.stringify(r.cb)}`]);
  chk("B12 each hard chore after the first starts in a later frame callback than the one before, not in the same window", r, (r) => [r.ran.length === 3 && r.ran.every((c, i) => i === 0 || (idx(r, c) >= 0 && idx(r, c) > idx(r, r.ran[i - 1]) && c.at - r.ran[i - 1].at > 1.5)), `starts ${JSON.stringify(r.ran.map((c) => c.at))}, callback numbers ${JSON.stringify(r.ran.map((c) => idx(r, c)))}`]);
  chk("B12 no hard chore starts before the 20 ms rest after the last has passed", r, (r) => { const g = gapsAfterEnd(r.ran); return [g.length === 2 && g.every((x) => x >= 19.5), `gaps after each end ${JSON.stringify(g)}`]; });
}
{
  const r = runCase(import.meta.url, "b9");
  const get = (r, n) => r.ran.find((c) => c.name === n);
  chk("B9 control: the first chore and both that were queued later ran", r, (r) => [r.ran.length === 3 && !!get(r, "A") && !!get(r, "B") && !!get(r, "C"), `${r.ran.map((c) => c.name)}`]);
  chk("B9 a chore queued while the window is open is not run synchronously by the call", r, (r) => [r.mark.bSync === 0, `${r.mark.bSync} ran by the time chore() returned`]);
  chk("B9 ... it runs in the same task as the call (no frame asked, no yield between)", r, (r) => { const a = get(r, "A"), b = get(r, "B"); return [!!b && Math.abs(b.at - r.mark.bTask) < 0.001 && b.frames === a.frames && b.yields === a.yields, `queued at ${r.mark.bTask}, ran at ${b && b.at}; frames ${a.frames} then ${b && b.frames}, yields ${a.yields} then ${b && b.yields}`]; });
  chk("B9 a chore queued after the window has shut waits for a frame: one is asked, and it starts at that callback", r, (r) => { const c = get(r, "C"); return [!!c && c.frames > r.mark.cFrames && c.at > r.mark.cQueued && atCb(r.cb, c.at), `frames ${r.mark.cFrames} at the call, ${c && c.frames} at the start; queued ${r.mark.cQueued}, ran ${c && c.at}; callbacks ${JSON.stringify(r.cb)}`]; });
}
{
  const r = runCase(import.meta.url, "b10a");
  chk("B10 `moving` is exported from assets/door/index.js", r, (r) => [r.api === "function", `typeof door.moving: ${r.api}`]);
  chk("B10 `moving()` is counted: choresNow().moving is 1 while held and 0 once released", r, (r) => [r.during === 1 && r.after === 0, `held ${r.during}, released ${r.after}`]);
  const held = (r) => r.ran.filter((c) => c.name[0] === "h"), free = (r) => r.ran.filter((c) => c.name[0] === "f");
  chk("B10 control: all twelve chores of each batch ran", r, (r) => [held(r).length === 12 && free(r).length === 12, `${held(r).length} then ${free(r).length}`]);
  chk("B10 while held the window is 4 ms: two 3 ms chores a frame, starting at the callback and 3 ms into it", r, (r) => { const s = shares(held(r)); return [s.length === 6 && s.every((g) => g.length === 2 && atCb(r.cb, g[0].at) && Math.abs(g[1].at - g[0].at - 3) <= 0.5) && held(r).every((c) => c.moving === 1), `shares ${sizes(held(r))}, moving ${JSON.stringify(held(r).map((c) => c.moving))}`]; });
  chk("B10 once released the window is 8 ms again: three 3 ms chores a frame", r, (r) => { const s = shares(free(r)); return [s.length === 4 && s.every((g) => g.length === 3 && atCb(r.cb, g[0].at)) && free(r).every((c) => c.moving === 0), `shares ${sizes(free(r))}, moving ${JSON.stringify(free(r).map((c) => c.moving))}`]; });
}
{
  const r = runCase(import.meta.url, "b10b", 120000);
  const m = (r) => r.ran.filter((c) => c.name[0] === "m"), f = (r) => r.ran.filter((c) => c.name[0] === "f");
  chk("B10 control: during a page-path flight's loop, all twelve chores queued ran", r, (r) => [m(r).length === 12 && r.movingNow === 1, `${m(r).length} ran; moving ${r.movingNow} after them`]);
  chk("B10 during a page-path flight: two 3 ms chores a frame and `moving` 1 at each", r, (r) => { const s = shares(m(r)); return [s.length === 6 && s.every((g) => g.length === 2) && m(r).every((c) => c.moving === 1), `shares ${sizes(m(r))}, moving ${JSON.stringify(m(r).map((c) => c.moving))}`]; });
  chk("B10 after the loop ends `moving` is 0", r, (r) => [r.ended === true && r.after === 0, `loop ended ${r.ended}, moving ${r.after}`]);
  chk("B10 after the loop ends: three 3 ms chores a frame, `moving` 0 at each", r, (r) => { const s = shares(f(r)); return [f(r).length === 12 && s.every((g) => g.length === 3) && f(r).every((c) => c.moving === 0), `shares ${sizes(f(r))}, moving ${JSON.stringify(f(r).map((c) => c.moving))}`]; });
}
{
  const r = runCase(import.meta.url, "b10c", 120000);
  const m = (r) => r.ran.filter((c) => c.name[0] === "m"), f = (r) => r.ran.filter((c) => c.name[0] === "f");
  chk("B10 control: during a page-path flight, `moving` is 1 and the chores ran two a frame", r, (r) => [r.movingNow === 1 && m(r).length === 12 && shares(m(r)).every((g) => g.length === 2), `moving ${r.movingNow}; shares ${sizes(m(r))}`]);
  chk("B10 a flight cancelled midway by reset(): `moving` is 0", r, (r) => [r.after === 0, `moving ${r.after}`]);
  chk("B10 a flight cancelled midway by reset(): three 3 ms chores a frame again", r, (r) => [f(r).length === 12 && shares(f(r)).every((g) => g.length === 3) && f(r).every((c) => c.moving === 0), `shares ${sizes(f(r))}, moving ${JSON.stringify(f(r).map((c) => c.moving))}`]);
}
{
  const r = runCase(import.meta.url, "b10d", 120000);
  chk("B10 worker path control: the flight started in the worker, and chores queued during it ran", r, (r) => [r.started >= 1 && r.queued && r.ran.length === 12, `${r.started} start message(s); ${r.ran.length} chores ran`]);
  chk("B10 worker path: `moving` stays 0 before and through the flight", r, (r) => [r.samples.length > 10 && r.samples.every((v) => v === 0), `moving samples ${JSON.stringify([...new Set(r.samples)])}`]);
  chk("B10 worker path: the page's queue stays at 8 ms (three 3 ms chores a frame)", r, (r) => [shares(r.ran).every((g) => g.length === 3), `shares ${sizes(r.ran)}`]);
}
finish();
