/*
 * Test for #101's measurement step (the owner's 12a, 2026-10-29), written from the specification alone: the
 * `chores at …` console line says where the idle time goes, and the `?door3d` per-chore line says it chore by chore.
 * No change to how chores are paced. After `empty` the line gains
 *
 *   frames N, F ms (longest L ms, S over 50 ms)   the waits for an animation frame between chores
 *   timers N, asked A ms, took T ms               the setTimeout waits between chores (a soft chore's 0 ms hop, a hard
 *                                                 chore's up to 20 ms, a measure's rest)
 *   opening O ms                                  an unhurried chore waiting for a journey's opening (now < until)
 *   typing Y ms                                   waiting for typing to pause
 *
 * `empty` includes the span since the queue last emptied, if it is empty when the line prints; `resting` is what is
 * left of the wall time when all of those are taken off, which should be near 0. The per-chore line (`chores, each`)
 * gives each entry as `tag waited/ran/frame/timer ms`.
 *
 *   node tools/ci/chores-line-test.mjs
 *
 *   M1  opened, three hard chores (rest 60): `frames 3`, `timers 3, asked 60 ms`; resting within 1 ms of 0
 *   M2  opened, six soft chores of 1 ms: fewer frames than chores (the share), `timers 0` (the hops are yields, not
 *       timers, since the fix); resting within 1 ms of 0
 *   M3  a measure chore: `asked` includes 200 (no control for the 200 itself: under the page's pace the chore after a
 *       measure starts 36 ms later today, not 200, so whether the page keeps the measure's rest is for the spec to say)
 *   M4  hurryChores("flight", 6000) with one unhurried chore queued: `opening` at least the wait it took; resting
 *       within 1 ms of 0 (control: the chore did wait about 6000 ms)
 *   M5  typingWait 600, a key pressed, one chore: `typing` at least 500 (control: the chore waited past 100 ms)
 *   M6  one chore, the clock run on 5000 ms with nothing queued, then noteChores: `empty` at least 5000 and resting
 *       within 1 ms of 0
 *   M7  ?door3d (counting on): each per-chore entry has four numbers
 *   M8  the worker's pace, pace("none"): a measure's 200 ms shows under `timers … asked`
 *
 * Every case runs in a fresh Node process on the stub page (door-stub.mjs), on its virtual clock: every time here is
 * virtual, and the frame (requestAnimationFrame) and timer lengths are the stub's. Chores are reached through
 * assets/door/index.js as a host reaches them; each figure is read from the line with a regex.
 */
import { INDEX, installPage, installClock, childMain, runCase, chk, finish } from "./door-stub.mjs";

async function setup({ typingWait = 0, flags = {}, none = false, spendable = false } = {}) {
  const page = installPage();
  const clock = installClock();
  /* a chore that takes time: the page's clock moves on inside it (the stub's own clock moves only by advance) */
  let extra = 0;
  if (spendable) {
    const base = performance.now;
    Object.defineProperty(performance, "now", { value: () => base() + extra, configurable: true, writable: true });
  }
  const spend = (ms) => { extra += ms; };
  const door = await import(INDEX);
  door.createDoor({ typingWait, flags });
  if (none) door.pace("none");
  return { page, clock, door, spend };
}

const lineOf = (page) => page.lines.filter((l) => /chores at x\b/.test(l));

const noter = (ctx, ran, name, ms = 0) => () => { ran.push({ name, at: performance.now() }); if (ms) ctx.spend(ms); };

async function hardThree() {
  const ctx = await setup();
  const ran = [];
  for (const n of ["a", "b", "c"]) ctx.door.chore(noter(ctx, ran, n), 60, n);
  ctx.door.openChores();
  await ctx.clock.advance(5000);
  ctx.door.noteChores("x");
  return { lines: lineOf(ctx.page), ran: ran.length };
}

async function softSix() {
  const ctx = await setup({ spendable: true });
  const ran = [];
  for (let i = 0; i < 6; i++) ctx.door.chore(noter(ctx, ran, `s${i}`, 1), 0, "", { soft: true });
  ctx.door.openChores();
  await ctx.clock.advance(5000);
  ctx.door.noteChores("x");
  return { lines: lineOf(ctx.page), ran: ran.length };
}

async function measureCase({ none }) {
  const ctx = await setup({ none });
  const ran = [];
  ctx.door.chore(noter(ctx, ran, "measure"), 200, "measure");
  ctx.door.chore(noter(ctx, ran, "after"), 20, "");
  ctx.door.openChores();
  await ctx.clock.advance(5000);
  ctx.door.noteChores("x");
  return { lines: lineOf(ctx.page), ran: ran.length, gap: ran.length === 2 ? ran[1].at - ran[0].at : null };
}

async function hurried() {
  const ctx = await setup();
  const ran = [];
  ctx.door.openChores();
  await ctx.clock.advance(100);
  const t0 = performance.now();
  ctx.door.hurryChores("flight", 6000);
  ctx.door.chore(noter(ctx, ran, "docs"), 0, "docs");
  await ctx.clock.advance(20000);
  ctx.door.noteChores("x");
  return { lines: lineOf(ctx.page), ran: ran.length, wait: ran.length ? ran[0].at - t0 : null };
}

async function typing() {
  const ctx = await setup({ typingWait: 600 });
  const { page, clock, door } = ctx;
  door.openChores();
  await clock.advance(100);
  for (const type of ["keydown", "input"]) {
    const ev = { type, key: "a", code: "KeyA", target: page.document.body, isTrusted: true };
    for (const fn of [...(page.winListeners[type] || [])]) fn(ev);
    for (const fn of [...(page.docListeners[type] || [])]) fn(ev);
  }
  const key = performance.now();
  const ran = [];
  door.chore(noter(ctx, ran, "typed"), 0, "typed");
  await clock.advance(100);
  const soon = ran.length;
  await clock.advance(5000);
  door.noteChores("x");
  return { lines: lineOf(page), soon, ran: ran.length, wait: ran.length ? ran[0].at - key : null };
}

async function emptied() {
  const ctx = await setup();
  const ran = [];
  ctx.door.chore(noter(ctx, ran, "one"), 0, "one");
  ctx.door.openChores();
  await ctx.clock.advance(100);
  await ctx.clock.advance(5000);
  ctx.door.noteChores("x");
  return { lines: lineOf(ctx.page), ran: ran.length };
}

async function each() {
  const ctx = await setup({ flags: { door3d: "1" } });
  const ran = [];
  for (const n of ["alpha", "beta", "gamma"]) ctx.door.chore(noter(ctx, ran, n), 60, n);
  ctx.door.openChores();
  await ctx.clock.advance(5000);
  ctx.door.noteChores("x");
  return { lines: ctx.page.lines.filter((l) => /chores/.test(l)), ran: ran.length };
}

const CASES = {
  m1: hardThree, m2: softSix, m3: () => measureCase({ none: false }), m4: hurried, m5: typing, m6: emptied, m7: each,
  m8: () => measureCase({ none: true }),
};

if (process.argv[2] === "--child") await childMain(CASES);

/* ----- reading the line ----- */

const NUM = "(\\d+(?:\\.\\d+)?)";
const shown = (r) => (r.lines && r.lines.length ? r.lines[0] : "no \"chores at x\" line");
const line = (r) => (r.lines && r.lines.length === 1 ? r.lines[0] : "");
const figure = (r, re) => { const m = re.exec(line(r)); return m ? m.slice(1).map(Number) : null; };
const frames = (r) => figure(r, new RegExp(`\\bframes (\\d+), ${NUM} ms \\(longest ${NUM} ms, (\\d+) over 50 ms\\)`));
const timers = (r) => figure(r, new RegExp(`\\btimers (\\d+), asked ${NUM} ms, took ${NUM} ms`));
const opening = (r) => figure(r, new RegExp(`\\bopening ${NUM} ms`));
const typingMs = (r) => figure(r, new RegExp(`\\btyping ${NUM} ms`));
const empty = (r) => figure(r, new RegExp(`\\bempty ${NUM} ms`));
const resting = (r) => figure(r, new RegExp(`\\bresting (-?\\d+(?:\\.\\d+)?) ms`));
const nearZero = (r) => { const x = resting(r); return !!x && Math.abs(x[0]) <= 1; };
const restingText = (r) => { const x = resting(r); return x ? `resting ${x[0]} ms` : "no `resting` figure"; };

/* ----- the checks ----- */

{
  const r = runCase(import.meta.url, "m1");
  chk("M1 control: three hard chores ran, and the queue printed one `chores at x` line", r, (r) => [r.ran === 3 && r.lines.length === 1, `${r.ran} ran; ${shown(r)}`]);
  chk("M1 `frames 3` (one frame wait after each chore)", r, (r) => { const f = frames(r); return [!!f && f[0] === 3 && f[1] > 0 && f[2] > 0 && f[3] === 0, `${f ? `frames ${f.join(", ")}` : "no `frames N, F ms (longest L ms, S over 50 ms)` figure"}: ${shown(r)}`]; });
  chk("M1 `timers 3, asked 60 ms` (the 20 ms after each hard chore), took about as long", r, (r) => { const t = timers(r); return [!!t && t[0] === 3 && t[1] === 60 && Math.abs(t[2] - t[1]) <= 1, `${t ? `timers ${t.join(", ")}` : "no `timers N, asked A ms, took T ms` figure"}: ${shown(r)}`]; });
  chk("M1 resting within 1 ms of 0", r, (r) => [nearZero(r), `${restingText(r)}: ${shown(r)}`]);
}
{
  const r = runCase(import.meta.url, "m2");
  chk("M2 control: six soft chores ran, and the queue printed one `chores at x` line", r, (r) => [r.ran === 6 && r.lines.length === 1, `${r.ran} ran; ${shown(r)}`]);
  chk("M2 fewer frames than chores (soft chores share a frame)", r, (r) => { const f = frames(r); return [!!f && f[0] < 6, `${f ? `frames ${f.join(", ")}` : "no `frames N, F ms (longest L ms, S over 50 ms)` figure"}: ${shown(r)}`]; });
  chk("M2 `timers 0` (the 0 ms hop after each soft chore is a yield, not a timer)", r, (r) => { const t = timers(r); return [!!t && t[0] === 0 && t[1] === 0, `${t ? `timers ${t.join(", ")}` : "no `timers N, asked A ms, took T ms` figure"}: ${shown(r)}`]; });
  chk("M2 resting within 1 ms of 0", r, (r) => [nearZero(r), `${restingText(r)}: ${shown(r)}`]);
}
{
  const r = runCase(import.meta.url, "m3");
  chk("M3 control: the measure and the chore after it both ran (the gap between them is shown, not judged)", r, (r) => [r.ran === 2, `${r.ran} ran; gap ${r.gap} ms`]);
  chk("M3 a measure chore: `timers … asked` includes 200 ms", r, (r) => { const t = timers(r); return [!!t && t[1] >= 200, `${t ? `timers ${t.join(", ")}` : "no `timers N, asked A ms, took T ms` figure"}: ${shown(r)}`]; });
}
{
  const r = runCase(import.meta.url, "m4");
  chk("M4 control: the unhurried chore waited for the opening (about 6000 ms) and ran once", r, (r) => [r.ran === 1 && r.wait >= 5000, `${r.ran} ran; waited ${r.wait} ms`]);
  chk("M4 `opening O ms` is at least the wait it took", r, (r) => { const o = opening(r); return [!!o && o[0] >= r.wait - 1, `${o ? `opening ${o[0]} ms` : "no `opening O ms` figure"} against a wait of ${r.wait} ms: ${shown(r)}`]; });
  chk("M4 resting within 1 ms of 0", r, (r) => [nearZero(r), `${restingText(r)}: ${shown(r)}`]);
}
{
  const r = runCase(import.meta.url, "m5");
  chk("M5 control: the chore did not run within 100 ms of the key, and ran later", r, (r) => [r.soon === 0 && r.ran === 1 && r.wait >= 500, `ran within 100 ms: ${r.soon}; ${r.ran} ran; waited ${r.wait} ms`]);
  chk("M5 `typing Y ms` is at least 500", r, (r) => { const y = typingMs(r); return [!!y && y[0] >= 500, `${y ? `typing ${y[0]} ms` : "no `typing Y ms` figure"}: ${shown(r)}`]; });
}
{
  const r = runCase(import.meta.url, "m6");
  chk("M6 control: the one chore ran, and the queue printed one `chores at x` line", r, (r) => [r.ran === 1 && r.lines.length === 1, `${r.ran} ran; ${shown(r)}`]);
  chk("M6 `empty` includes the span still open when the line prints (at least 5000 ms)", r, (r) => { const e = empty(r); return [!!e && e[0] >= 5000, `${e ? `empty ${e[0]} ms` : "no `empty N ms` figure"}: ${shown(r)}`]; });
  chk("M6 resting within 1 ms of 0", r, (r) => [nearZero(r), `${restingText(r)}: ${shown(r)}`]);
}
{
  const r = runCase(import.meta.url, "m7");
  const tail = (r) => { const l = r.lines.find((x) => x.includes("chores, each")); return l ? l.slice(l.indexOf("chores, each")) : null; };
  const entries = (t) => (t ? t.match(/\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)+/g) || [] : []);
  chk("M7 control: under ?door3d the console has a `chores, each` line with an entry for each of the three chores", r, (r) => { const t = tail(r); return [r.ran === 3 && !!t && entries(t).length === 3, `${r.ran} ran; ${t || "no `chores, each` line"}`]; });
  chk("M7 each entry is `tag waited/ran/frame/timer`: four numbers", r, (r) => { const t = tail(r), e = entries(t); return [e.length === 3 && e.every((x) => x.split("/").length === 4), t || "no `chores, each` line"]; });
  chk("M7 the first chore's entry names its tag, with a frame wait and a timer wait after it", r, (r) => {
    const t = tail(r) || "";
    const m = new RegExp(`\\balpha ${NUM}/${NUM}/${NUM}/${NUM} ms`).exec(t);
    return [!!m && Number(m[3]) > 0 && Number(m[4]) > 0, t || "no `chores, each` line"];
  });
}
{
  const r = runCase(import.meta.url, "m8");
  chk("M8 control: under pace(\"none\") a measure still keeps its rest (the next chore starts 200 ms or more later)", r, (r) => [r.ran === 2 && r.gap >= 200, `${r.ran} ran; gap ${r.gap} ms`]);
  chk("M8 under pace(\"none\") the measure's 200 ms shows under `timers … asked`", r, (r) => { const t = timers(r); return [!!t && t[1] >= 200, `${t ? `timers ${t.join(", ")}` : "no `timers N, asked A ms, took T ms` figure"}: ${shown(r)}`]; });
}
finish();
