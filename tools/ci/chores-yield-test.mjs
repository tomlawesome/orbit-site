/*
 * Test for #101's fix, written from the specification alone: the chore queue yields through a task that is not
 * clamped (`page.yield(fn)`, as a scheduler such as React's does with MessageChannel) for every hop that asked for
 * 0 ms, and keeps timers only where a rest is asked for. Behaviour only, never timings.
 *
 *   node tools/ci/chores-yield-test.mjs
 *
 *   Y1  opened, ten soft chores of 1 ms: `timers 0` in the line, no timer set at all, at most 5 frames, every chore
 *       started after a yield or a frame (control: all ten ran and the line printed once; today's line reads
 *       `timers 10`, which is the failure it shows first)
 *   Y2  a hard chore (rest 60): one frame, then one timer asked 20, and nothing else
 *   Y3  a measure (rest 200): its timer asked 200 is kept, and no timer asked 0 is set
 *   Y4  before `run`: opening the queue sets no timer and makes one yield, the chore not yet run; it runs after
 *   Y5  the reveal (openSoft), soft chores that fill the share: still one soft chore a frame, and no timer
 *   Y6  pace("none"): no frame between ten chores, and the hops stay 0 ms timers, not yields (the worker's own
 *       messages share the task queue with a yield: draw-pixels P1, 2026-10-30); a measure still sets its 200 ms timer
 *   Y7  the docs' chores rank before the flight's (owner decision 13a): a flight chore queued before a docs chore
 *       runs second; install and info keep their place (install first, info after both)
 *   Y8  yields delivered late (each 6 ms of virtual time after it is posted, as on a phone that paints between a frame
 *       and the next task), the queue opened, twelve soft chores of 3 ms: at least two chores run per frame asked, so
 *       at most 7 frames (the share counts from the first chore's start after a frame, not from the frame callback;
 *       today it counts from the callback, the first chore starts after the share is spent, and every chore asks a
 *       frame: 12). Control, the delay 0: at most 7 frames as well (the share works today when the hop is instant)
 *
 * The stub's MessageChannel (installClock, door-stub.mjs) is the unclamped next task: an immediate on the virtual
 * clock, counted as clock.yields(), set without a setTimeout. Timers set (setTimeout, apart from the one a frame
 * wraps) and frames (requestAnimationFrame) are counted here, in order. Every case runs in a fresh Node process on
 * the stub page, on its virtual clock; chores are reached through assets/door/index.js as a host reaches them.
 */
import { INDEX, installPage, installClock, childMain, runCase, chk, finish } from "./door-stub.mjs";

async function setup({ none = false, spendable = false } = {}) {
  const page = installPage();
  const clock = installClock();
  /* a chore that takes time: the page's clock moves on inside it */
  let extra = 0;
  if (spendable) {
    const base = performance.now;
    Object.defineProperty(performance, "now", { value: () => base() + extra, configurable: true, writable: true });
  }
  const spend = (ms) => { extra += ms; };
  /* frames and timers asked, in order; a frame's own setTimeout in the stub is not a timer of the page's, and the
     15000 ms one a running chore sets (a stall guard: neither a hop nor a rest) is left out */
  const log = { frames: 0, timers: [], ev: [] };
  let inFrame = false;
  const raf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (f) => { log.frames++; log.ev.push("frame"); inFrame = true; try { return raf(f); } finally { inFrame = false; } };
  const set = globalThis.setTimeout;
  globalThis.setTimeout = (f, ms = 0, ...a) => {
    if (!inFrame && Number(ms) !== 15000) { const m = Number(ms) || 0; log.timers.push(m); log.ev.push(`timer ${m}`); }
    return set(f, ms, ...a);
  };
  const door = await import(INDEX);
  door.createDoor({ typingWait: 0, flags: {} });
  if (none) door.pace("none");
  const reset = () => { log.frames = 0; log.timers.length = 0; log.ev.length = 0; };
  return { page, clock, door, spend, log, reset };
}

const lineOf = (page) => page.lines.filter((l) => /chores at x\b/.test(l));
const noter = (ctx, ran, name, ms = 0) => () => { ran.push({ name, at: performance.now(), frames: ctx.log.frames }); if (ms) ctx.spend(ms); };

async function softTen() {
  const ctx = await setup({ spendable: true });
  const ran = [];
  for (let i = 0; i < 10; i++) ctx.door.chore(noter(ctx, ran, `s${i}`, 1), 0, "", { soft: true });
  ctx.reset();
  ctx.door.openChores();
  await ctx.clock.advance(5000);
  ctx.door.noteChores("x");
  return { lines: lineOf(ctx.page), ran: ran.length, frames: ctx.log.frames, timers: ctx.log.timers, yields: ctx.clock.yields() };
}

async function softTwelve(delay) {
  const ctx = await setup({ spendable: true });
  const ran = [];
  for (let i = 0; i < 12; i++) ctx.door.chore(noter(ctx, ran, `s${i}`, 3), 0, "", { soft: true });
  ctx.reset();
  ctx.clock.yieldDelay(delay);
  ctx.door.openChores();
  await ctx.clock.advance(5000);
  return { ran: ran.length, frames: ctx.log.frames, yields: ctx.clock.yields() };
}

async function hardOne() {
  const ctx = await setup();
  const ran = [];
  ctx.door.chore(noter(ctx, ran, "hard"), 60, "hard");
  ctx.reset();
  ctx.door.openChores();
  await ctx.clock.advance(5000);
  ctx.door.noteChores("x");
  return { lines: lineOf(ctx.page), ran: ran.length, ev: ctx.log.ev.slice() };
}

async function measureOne() {
  const ctx = await setup();
  const ran = [];
  ctx.door.chore(noter(ctx, ran, "measure"), 200, "measure");
  ctx.reset();
  ctx.door.openChores();
  await ctx.clock.advance(5000);
  ctx.door.noteChores("x");
  return { lines: lineOf(ctx.page), ran: ran.length, timers: ctx.log.timers.slice() };
}

async function beforeRun() {
  const ctx = await setup();
  const ran = [];
  ctx.door.chore(noter(ctx, ran, "one"), 0, "one");
  ctx.reset();
  const y0 = ctx.clock.yields();
  ctx.door.openChores();
  const at = { timers: ctx.log.timers.slice(), yields: ctx.clock.yields() - y0, ran: ran.length };
  await ctx.clock.advance(5000);
  return { at, ranAfter: ran.length };
}

async function reveal() {
  const ctx = await setup({ spendable: true });
  const ran = [];
  for (let i = 0; i < 5; i++) ctx.door.chore(noter(ctx, ran, `r${i}`, 5), 0, "", { soft: true });
  ctx.reset();
  ctx.door.openSoft();
  await ctx.clock.advance(5000);
  return { ran: ran.map((r) => r.frames), timers: ctx.log.timers.slice() };
}

async function noneTen() {
  const ctx = await setup({ none: true });
  const ran = [];
  for (let i = 0; i < 10; i++) ctx.door.chore(noter(ctx, ran, `c${i}`), 20, "");
  ctx.reset();
  ctx.door.openChores();
  await ctx.clock.advance(5000);
  return { ran: ran.length, frames: ctx.log.frames, timers: ctx.log.timers.slice(), yields: ctx.clock.yields() };
}

async function noneMeasure() {
  const ctx = await setup({ none: true });
  const ran = [];
  ctx.door.chore(noter(ctx, ran, "measure"), 200, "measure");
  ctx.door.chore(noter(ctx, ran, "after"), 20, "");
  ctx.reset();
  ctx.door.openChores();
  await ctx.clock.advance(5000);
  return { ran: ran.length, gap: ran.length === 2 ? ran[1].at - ran[0].at : null, frames: ctx.log.frames, timers: ctx.log.timers.slice(), yields: ctx.clock.yields() };
}

async function order(tags) {
  const ctx = await setup();
  const ran = [];
  for (const t of tags) ctx.door.chore(() => { ran.push(t); }, 0, t);
  ctx.door.openChores();
  await ctx.clock.advance(5000);
  return { ran };
}

const CASES = {
  y1: softTen, y2: hardOne, y3: measureOne, y4: beforeRun, y5: reveal, y6a: noneTen, y6b: noneMeasure,
  y7: () => order(["flight", "docs"]),
  y7b: () => order(["info", "flight", "docs", "install"]),
  y8a: () => softTwelve(6), y8b: () => softTwelve(0),
};

if (process.argv[2] === "--child") await childMain(CASES);

/* ----- reading the line ----- */

const NUM = "(\\d+(?:\\.\\d+)?)";
const shown = (r) => (r.lines && r.lines.length ? r.lines[0] : "no \"chores at x\" line");
const line = (r) => (r.lines && r.lines.length === 1 ? r.lines[0] : "");
const figure = (r, re) => { const m = re.exec(line(r)); return m ? m.slice(1).map(Number) : null; };
const lineFrames = (r) => figure(r, new RegExp(`\\bframes (\\d+), ${NUM} ms \\(longest ${NUM} ms, (\\d+) over 50 ms\\)`));
const lineTimers = (r) => figure(r, new RegExp(`\\btimers (\\d+), asked ${NUM} ms, took ${NUM} ms`));
const NOTIMERS = "no `timers N, asked A ms, took T ms` figure";
const NOFRAMES = "no `frames N, F ms (longest L ms, S over 50 ms)` figure";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ----- the checks ----- */

{
  const r = runCase(import.meta.url, "y1");
  chk("Y1 control: all ten soft chores ran, and the queue printed one `chores at x` line", r, (r) => [r.ran === 10 && r.lines.length === 1, `${r.ran} ran; ${shown(r)}`]);
  chk("Y1 the line reads `timers 0` (every hop a yield; today it reads `timers 10`)", r, (r) => { const t = lineTimers(r); return [!!t && t[0] === 0, `${t ? `timers ${t.join(", ")}` : NOTIMERS}: ${shown(r)}`]; });
  chk("Y1 no timer was set by the page at all", r, (r) => [r.timers.length === 0, `timers set: ${JSON.stringify(r.timers)}`]);
  chk("Y1 at most 5 frames", r, (r) => { const f = lineFrames(r); return [r.frames <= 5 && !!f && f[0] <= 5, `${r.frames} frames asked; ${f ? `frames ${f.join(", ")}` : NOFRAMES}`]; });
  chk("Y1 every chore started after a yield or a frame (yields + frames at least 10)", r, (r) => [r.yields + r.frames >= 10, `${r.yields} yields, ${r.frames} frames`]);
}
{
  const r = runCase(import.meta.url, "y2");
  chk("Y2 control: the hard chore ran, and the queue printed one `chores at x` line", r, (r) => [r.ran === 1 && r.lines.length === 1, `${r.ran} ran; ${shown(r)}`]);
  chk("Y2 one frame, then one timer asked 20, and nothing else (no timer before the chore)", r, (r) => [same(r.ev, ["frame", "timer 20"]), JSON.stringify(r.ev)]);
  chk("Y2 the line reads `frames 1` and `timers 1, asked 20 ms`", r, (r) => {
    const f = lineFrames(r), t = lineTimers(r);
    return [!!f && f[0] === 1 && !!t && t[0] === 1 && t[1] === 20, `${f ? `frames ${f.slice(0, 2).join(", ")}` : NOFRAMES}; ${t ? `timers ${t.join(", ")}` : NOTIMERS}`];
  });
}
{
  const r = runCase(import.meta.url, "y3");
  chk("Y3 control: the measure ran, and the queue printed one `chores at x` line", r, (r) => [r.ran === 1 && r.lines.length === 1, `${r.ran} ran; ${shown(r)}`]);
  chk("Y3 a measure's timer asked 200 is kept", r, (r) => [r.timers.includes(200), `timers set: ${JSON.stringify(r.timers)}`]);
  chk("Y3 no timer asked 0 is set (the hops are yields)", r, (r) => [r.timers.length > 0 && r.timers.every((m) => m > 0), `timers set: ${JSON.stringify(r.timers)}`]);
  chk("Y3 the line's `asked` includes 200 ms", r, (r) => { const t = lineTimers(r); return [!!t && t[1] >= 200, `${t ? `timers ${t.join(", ")}` : NOTIMERS}: ${shown(r)}`]; });
}
{
  const r = runCase(import.meta.url, "y4");
  chk("Y4 control: the chore had not run when the queue was opened, and ran afterwards", r, (r) => [r.at.ran === 0 && r.ranAfter === 1, `ran at open ${r.at.ran}, after ${r.ranAfter}`]);
  chk("Y4 opening the queue sets no timer (the hop before `run` is not a setTimeout)", r, (r) => [r.at.timers.length === 0, `timers set at open: ${JSON.stringify(r.at.timers)}`]);
  chk("Y4 opening the queue makes one yield", r, (r) => [r.at.yields === 1, `${r.at.yields} yields at open`]);
}
{
  const r = runCase(import.meta.url, "y5");
  chk("Y5 control: all five soft chores of the reveal ran", r, (r) => [r.ran.length === 5, `${r.ran.length} ran (frames asked at each start: ${JSON.stringify(r.ran)})`]);
  chk("Y5 the reveal still runs one soft chore a frame (a frame asked between each start and the next)", r, (r) => [r.ran.length === 5 && r.ran.every((f, i) => i === 0 || f > r.ran[i - 1]), `frames asked at each start: ${JSON.stringify(r.ran)}`]);
  chk("Y5 no timer is set during the reveal", r, (r) => [r.timers.length === 0, `timers set: ${JSON.stringify(r.timers)}`]);
}
{
  const r = runCase(import.meta.url, "y6a");
  chk("Y6 control: under pace(\"none\") all ten chores ran", r, (r) => [r.ran === 10, `${r.ran} ran`]);
  chk("Y6 under pace(\"none\") no frame is asked and every timer between chores asks 0 ms", r, (r) => [r.frames === 0 && r.timers.length >= 9 && r.timers.every((ms) => ms === 0), `timers ${JSON.stringify(r.timers)}, frames ${r.frames}`]);
  chk("Y6 under pace(\"none\") the hops are not yields", r, (r) => [r.yields === 0, `${r.yields} yields`]);
}
{
  const r = runCase(import.meta.url, "y6b");
  chk("Y6 control: under pace(\"none\") a measure still holds the next chore back 200 ms or more", r, (r) => [r.ran === 2 && r.gap >= 200, `${r.ran} ran; gap ${r.gap} ms`]);
  chk("Y6 under pace(\"none\") the measure's timer asked 200 is kept, beside the 0 ms hops", r, (r) => [r.timers.includes(200) && r.timers.every((ms) => ms === 0 || ms === 200), `timers set: ${JSON.stringify(r.timers)}`]);
  chk("Y6 under pace(\"none\") no yield and no frame", r, (r) => [r.yields === 0 && r.frames === 0, `${r.yields} yields, ${r.frames} frames`]);
}
{
  const r = runCase(import.meta.url, "y7");
  chk("Y7 control: both chores ran", r, (r) => [r.ran.length === 2, JSON.stringify(r.ran)]);
  chk("Y7 with a flight chore queued before a docs chore, the docs' chore runs first (today the flight's does)", r, (r) => [same(r.ran, ["docs", "flight"]), JSON.stringify(r.ran)]);
}
{
  const r = runCase(import.meta.url, "y7b");
  chk("Y7 control: all four ran", r, (r) => [r.ran.length === 4, JSON.stringify(r.ran)]);
  chk("Y7 install keeps its place before the docs and the flight, and info after both (queued info, flight, docs, install)", r, (r) => [same(r.ran, ["install", "docs", "flight", "info"]), JSON.stringify(r.ran)]);
}
{
  const r = runCase(import.meta.url, "y8a");
  chk("Y8 control: all twelve soft chores ran, with each yield delivered 6 ms late", r, (r) => [r.ran === 12 && r.yields > 0, `${r.ran} ran, ${r.yields} yields`]);
  chk("Y8 with every yield 6 ms late, at least two chores run per frame asked (at most 7 frames; today 12)", r, (r) => [r.frames <= 7, `${r.frames} frames asked for ${r.ran} chores`]);
}
{
  const r = runCase(import.meta.url, "y8b");
  chk("Y8 control: all twelve soft chores ran with no delay", r, (r) => [r.ran === 12, `${r.ran} ran`]);
  chk("Y8 control: with the delay 0, at most 7 frames as well (the share works today when the hop is instant)", r, (r) => [r.frames <= 7, `${r.frames} frames asked for ${r.ran} chores`]);
}
finish();
