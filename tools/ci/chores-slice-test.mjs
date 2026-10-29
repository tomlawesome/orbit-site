/*
 * Test for #101 batch 1, the slice (ADR-0004 6c.2 and 6c.6, tests S1-S9, S11 and S12), written from the specification
 * alone: the page's chore queue, once open, runs chores back to back for a time budget (a slice), yields one frame,
 * and starts the next slice in the task after it. The budget is 8 ms still and 4 ms while something moves on the page's
 * thread; it is counted from the slice's first chore, never cuts a chore, and no timer is set between the chores of a
 * slice. A hard chore is a slice of its own. The reveal, the worker's queue and `flags.pace: "frame"` keep today's rule.
 *
 *   node tools/ci/chores-slice-test.mjs
 *
 *   S1   opened, twenty 3 ms soft chores: three a slice (starts at 0, 3 and 6), exactly one frame asked between
 *        slices, no timer set between the chores of a slice; control (pace "frame"): a timer after every chore
 *   S2   the budget never cuts a chore: 5 ms chores run two a slice (0 and 5), 9 ms chores one a slice
 *   S3   five hard chores (rest 60) and ten 1 ms soft ones: a hard chore is alone in its slice, one frame between it
 *        and the next slice, whose first chore starts within one frame interval of its end; control: 20 ms or more after
 *        that frame
 *   S4   a measure (rest 200) then a soft chore: the soft one starts 200 ms or more after the measure ends
 *   S5   moving(): 3 ms soft chores run two a slice (0 and 3); after its release three a slice; called twice, still two
 *        after one release, three after both; hard chores one a slice either way
 *   S6   hurryChores("flight", 6000): two a slice during the opening, three once the clock is past 6000
 *   S7   the reveal (openSoft() without openChores()): 3 ms chores two a frame, 5 ms one a frame, a timer after each,
 *        no hard chore starts; identical in every count under pace "frame"
 *   S8   typingWait 600 and a key pressed: no slice starts until 600 ms after the key; then one does
 *   S9   joining: a chore queued inside the budget runs in the slice with no frame asked between; one queued after the
 *        budget is spent waits for a frame
 *   S11  the console line: `in N slices` (N the frames asked after open), `(20 soft, 0 hard)`, `moving 0 ms` after S1's
 *        run; `moving` above 0 after S5's; `0 slices` under pace("none")
 *   S12  flags.pace as a number: "5" gives two a slice (0 and 3; 6 is past 5); "12" four a slice
 *
 * The chores are reached through assets/door/index.js as a host reaches them (chore(fn, rest, tag, { soft }),
 * openChores, openSoft, hurryChores, moving, pace, noteChores); choresNow() is read from chores.js by its own path, as
 * draw-pace-test.mjs reads pace. Each case runs in a fresh Node process on the stub page (door-stub.mjs), on the virtual
 * clock: every time here is virtual, a chore's cost is clock.spend(ms), requestAnimationFrame and setTimeout are
 * counted, so nothing depends on the runner. Slices are read from what the chores saw, never from the code: chores
 * that start with the same count of frames asked are in one slice.
 */
import { INDEX, installPage, installClock, childMain, runCase, chk, finish } from "./door-stub.mjs";

const CHORES = "../../assets/door/chores.js";
const FRAME = 16;                         /* the stub's requestAnimationFrame: a callback 16 virtual ms after the ask */

async function setup({ flags = {}, typingWait = 0 } = {}) {
  const page = installPage();
  const clock = installClock();
  const raf = globalThis.requestAnimationFrame;
  const frames = { n: 0, cb: [] };
  globalThis.requestAnimationFrame = (f) => { frames.n++; return raf((t) => { frames.cb.push(clock.now()); f(t); }); };
  const door = await import(INDEX);
  door.createDoor({ typingWait, flags });
  const { choresNow } = await import(CHORES);
  return { page, clock, frames, door, choresNow };
}

/* a chore that notes when it started (virtual ms), the frames and timers asked by then, and the slice count the queue
   reported; then spends its cost on the clock */
const work = (ctx, ran, name, ms, after) => () => {
  const e = { name, at: ctx.clock.now(), frames: ctx.frames.n, sched: ctx.clock.scheduled, slice: ctx.choresNow().slice };
  ran.push(e);
  ctx.clock.spend(ms);
  e.end = ctx.clock.now();
  if (after) after();
};
const soft = (ctx, ran, n, ms, tag = "", prefix = "s") => { for (let i = 0; i < n; i++) ctx.door.chore(work(ctx, ran, `${prefix}${i}`, ms), 0, tag, { soft: true }); };
const hard = (ctx, ran, n, ms, rest = 60, prefix = "h") => { for (let i = 0; i < n; i++) ctx.door.chore(work(ctx, ran, `${prefix}${i}`, ms), rest, ""); };
const need = (ctx, name) => { if (typeof ctx.door[name] !== "function") throw new Error(`assets/door/index.js does not export ${name}() (typeof ${typeof ctx.door[name]})`); };

/* ----- the cases ----- */

async function slice1({ flags }) {
  const ctx = await setup({ flags });
  const ran = [];
  soft(ctx, ran, 20, 3);
  ctx.door.openChores();
  await ctx.clock.advance(3000);
  return { ran };
}

async function budget(cost, n) {
  const ctx = await setup();
  const ran = [];
  soft(ctx, ran, n, cost);
  ctx.door.openChores();
  await ctx.clock.advance(3000);
  return { ran };
}

async function hardChores({ flags }) {
  const ctx = await setup({ flags });
  const ran = [];
  hard(ctx, ran, 5, 5);
  soft(ctx, ran, 10, 1);
  ctx.door.openChores();
  await ctx.clock.advance(5000);
  return { ran, callbacks: ctx.frames.cb };
}

async function measure() {
  const ctx = await setup();
  const ran = [];
  /* the soft chore is queued from inside the measure, so the queue's own order cannot put it first */
  ctx.door.chore(work(ctx, ran, "measure", 2, () => ctx.door.chore(work(ctx, ran, "soft", 1), 0, "", { soft: true })), 200, "measure");
  ctx.door.openChores();
  await ctx.clock.advance(5000);
  return { ran };
}

/* a batch of soft chores (or hard ones), run to the end; the clock moves on after it, so the next batch is a new slice */
async function batch(ctx, n, ms, { hardOnes = false, tag = "" } = {}) {
  const ran = [];
  if (hardOnes) hard(ctx, ran, n, ms); else soft(ctx, ran, n, ms, tag);
  await ctx.clock.advance(2000);
  return ran;
}

async function movingOnce() {
  const ctx = await setup();
  need(ctx, "moving");
  ctx.door.openChores();
  const release = ctx.door.moving();
  const counts = [ctx.choresNow().moving];
  const held = await batch(ctx, 12, 3);
  release();
  counts.push(ctx.choresNow().moving);
  const released = await batch(ctx, 12, 3);
  return { held, released, counts };
}

async function movingTwice() {
  const ctx = await setup();
  need(ctx, "moving");
  ctx.door.openChores();
  const r1 = ctx.door.moving(), r2 = ctx.door.moving();
  const counts = [ctx.choresNow().moving];
  const both = await batch(ctx, 12, 3);
  r1();
  counts.push(ctx.choresNow().moving);
  const one = await batch(ctx, 12, 3);
  r2();
  counts.push(ctx.choresNow().moving);
  const none = await batch(ctx, 12, 3);
  return { both, one, none, counts };
}

async function movingHard() {
  const ctx = await setup();
  need(ctx, "moving");
  ctx.door.openChores();
  const release = ctx.door.moving();
  const held = await batch(ctx, 4, 2, { hardOnes: true });
  release();
  const released = await batch(ctx, 4, 2, { hardOnes: true });
  return { held, released };
}

async function hurried() {
  const ctx = await setup();
  ctx.door.openChores();
  ctx.door.hurryChores("flight", 6000);
  const during = await batch(ctx, 12, 3, { tag: "flight" });
  await ctx.clock.advance(5000);
  const after = await batch(ctx, 12, 3, { tag: "flight" });
  return { during, after, nowAfter: ctx.clock.now() };
}

async function reveal({ cost, flags }) {
  const ctx = await setup({ flags });
  const ran = [];
  hard(ctx, ran, 2, 1, 0);
  soft(ctx, ran, 14, cost);
  ctx.door.openSoft();
  await ctx.clock.advance(3000);
  return { ran };
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
  const key = clock.now();
  const ran = [];
  soft(ctx, ran, 4, 3);
  await clock.advance(590);
  const early = ran.length;
  await clock.advance(3000);
  return { key, early, ran, listening: Object.keys(page.winListeners).concat(Object.keys(page.docListeners)) };
}

async function joining() {
  const ctx = await setup();
  const ran = [];
  const { door } = ctx;
  const queue = (name, ms, after) => door.chore(work(ctx, ran, name, ms, after), 0, "", { soft: true });
  door.openChores();
  /* A runs 6 ms; 1 ms after it ends B is queued (inside the 8 ms budget); 1 ms after B ends C is queued (budget spent) */
  queue("A", 6, () => setTimeout(() => queue("B", 1, () => setTimeout(() => queue("C", 1), 1)), 1));
  await ctx.clock.advance(3000);
  return { ran };
}

async function paceNumber(pace) {
  const ctx = await setup({ flags: { pace } });
  const ran = [];
  soft(ctx, ran, 12, 3);
  ctx.door.openChores();
  await ctx.clock.advance(3000);
  return { ran };
}

const lineOf = (page) => page.lines.filter((l) => /chores at x\b/.test(l));

async function lineS1() {
  const ctx = await setup();
  const ran = [];
  soft(ctx, ran, 20, 3);
  const before = ctx.frames.n;
  ctx.door.openChores();
  await ctx.clock.advance(3000);
  const asked = ctx.frames.n - before;
  ctx.door.noteChores("x");
  return { lines: lineOf(ctx.page), asked, ran: ran.length };
}

async function lineS5() {
  const ctx = await setup();
  need(ctx, "moving");
  ctx.door.openChores();
  const release = ctx.door.moving();
  const ran = await batch(ctx, 12, 3);
  release();
  ctx.door.noteChores("x");
  return { lines: lineOf(ctx.page), ran: ran.length };
}

async function lineNone() {
  const ctx = await setup();
  need(ctx, "pace");
  ctx.door.pace("none");
  const ran = [];
  soft(ctx, ran, 6, 1);
  hard(ctx, ran, 2, 1, 20);
  ctx.door.openChores();
  await ctx.clock.advance(3000);
  ctx.door.noteChores("x");
  return { lines: lineOf(ctx.page), ran: ran.length };
}

const CASES = {
  "s1": () => slice1({ flags: {} }), "s1-control": () => slice1({ flags: { pace: "frame" } }),
  "s2-5": () => budget(5, 12), "s2-9": () => budget(9, 6),
  "s3": () => hardChores({ flags: {} }), "s3-control": () => hardChores({ flags: { pace: "frame" } }),
  "s4": measure,
  "s5-once": movingOnce, "s5-twice": movingTwice, "s5-hard": movingHard,
  "s6": hurried,
  "s7-3": () => reveal({ cost: 3, flags: {} }), "s7-3-frame": () => reveal({ cost: 3, flags: { pace: "frame" } }),
  "s7-5": () => reveal({ cost: 5, flags: {} }), "s7-5-frame": () => reveal({ cost: 5, flags: { pace: "frame" } }),
  "s8": typing,
  "s9": joining,
  "s11-s1": lineS1, "s11-s5": lineS5, "s11-none": lineNone,
  "s12-5": () => paceNumber("5"), "s12-12": () => paceNumber("12"),
};

if (process.argv[2] === "--child") await childMain(CASES);

/* ----- reading what a case saw ----- */

const run = (n) => runCase(import.meta.url, n);
const show = (x) => JSON.stringify(x);
const short = (x) => { const s = JSON.stringify(x); return s.length > 220 ? `${s.slice(0, 220)}...` : s; };

/* the chores that started with the same count of frames asked: one slice; each as the ms from its first start */
const groups = (ran) => {
  const g = [];
  for (const c of ran) { const last = g[g.length - 1]; if (last && last[0].frames === c.frames) last.push(c); else g.push([c]); }
  return g;
};
const offsets = (ran) => groups(ran).map((g) => g.map((c) => c.at - g[0].at));
const sizes = (ran) => groups(ran).map((g) => g.length);
/* what `total` chores of `step` ms look like at `per` a slice: the last slice takes what is left */
const expected = (total, per, step) => {
  const out = [];
  for (let left = total; left > 0; left -= per) out.push(Array.from({ length: Math.min(per, left) }, (_, i) => i * step));
  return out;
};
const same = (a, b) => show(a) === show(b);
const timersBetween = (ran) => ran.slice(1).map((c, i) => c.sched - ran[i].sched);
const framesBetweenSlices = (ran) => { const g = groups(ran); return g.slice(1).map((s, i) => s[0].frames - g[i][0].frames); };
const timerInSlice = (ran) => groups(ran).some((g) => g.some((c, i) => i > 0 && c.sched !== g[i - 1].sched));
const shape = (ran) => `${ran.length} ran; slices ${short(offsets(ran))}`;
const sliced = (what, ran, total, per, step) => [ran.length === total && same(offsets(ran), expected(total, per, step)), `${what}: ${shape(ran)}; want ${short(expected(total, per, step))}`];

/* S1 */
{
  const r = run("s1"), c = run("s1-control");
  chk("S1 opened, twenty 3 ms soft chores run three to a slice (starts at 0, 3 and 6; 9 is past the budget)", r, (r) => sliced("slices", r.ran, 20, 3, 3));
  chk("S1 exactly one frame is asked between one slice and the next", r, (r) => { const f = framesBetweenSlices(r.ran); return [r.ran.length === 20 && f.length > 0 && f.every((n) => n === 1), `frames asked between slice starts ${short(f)}`]; });
  chk("S1 no timer is set between the chores of a slice (scheduled is unchanged across them)", r, (r) => [r.ran.length === 20 && !timerInSlice(r.ran), `timers set between starts ${short(timersBetween(r.ran))}; slices ${short(sizes(r.ran))}`]);
  chk("S1 control (pace frame): a timer is set after every chore", c, (c) => { const t = timersBetween(c.ran); return [c.ran.length === 20 && t.every((n) => n >= 1), `timers set between starts ${short(t)}`]; });
}
/* S2 */
{
  const five = run("s2-5"), nine = run("s2-9");
  chk("S2 5 ms soft chores run two a slice (starts at 0 and 5; the budget is 8)", five, (r) => sliced("slices", r.ran, 12, 2, 5));
  chk("S2 9 ms soft chores run one a slice (the next would start at 9)", nine, (r) => sliced("slices", r.ran, 6, 1, 9));
  for (const [what, r, cost] of [["5 ms", five, 5], ["9 ms", nine, 9]]) {
    chk(`S2 a ${what} chore started inside the budget runs whole (it ends at its start plus its cost, and none starts inside it)`, r, (r) => [r.ran.length > 0 && r.ran.every((c, i) => c.end - c.at === cost && (i === 0 || c.at >= r.ran[i - 1].end)), `starts and ends ${short(r.ran.slice(0, 4).map((c) => [c.at, c.end]))}`]);
  }
}
/* S3 */
{
  const r = run("s3"), c = run("s3-control");
  const neighbours = (r) => r.ran.map((e, i) => ({ e, prev: r.ran[i - 1], next: r.ran[i + 1] })).filter((x) => x.e.name.startsWith("h"));
  chk("S3 all fifteen chores run: five hard and ten soft", r, (r) => [r.ran.length === 15 && r.ran.filter((e) => e.name.startsWith("h")).length === 5, `${r.ran.length} ran: ${short(r.ran.map((e) => e.name))}`]);
  chk("S3 a hard chore is alone in its slice (the queue's slice count at its start is no more than 1)", r, (r) => { const h = r.ran.filter((e) => e.name.startsWith("h")); return [h.length === 5 && h.every((e) => typeof e.slice === "number" && e.slice <= 1), `slice at each hard start ${short(h.map((e) => e.slice))}`]; });
  chk("S3 exactly one frame is asked between a hard chore and the chore before it and after it", r, (r) => { const n = neighbours(r); return [n.length === 5 && n.every((x) => (!x.prev || x.e.frames - x.prev.frames === 1) && (!x.next || x.next.frames - x.e.frames === 1)), `frames asked, hard minus before / after minus hard ${short(n.map((x) => [x.prev ? x.e.frames - x.prev.frames : null, x.next ? x.next.frames - x.e.frames : null]))}`]; });
  chk("S3 the next slice's first chore starts within one frame interval of the hard chore's end", r, (r) => { const g = neighbours(r).filter((x) => x.next).map((x) => x.next.at - x.e.end); return [g.length >= 4 && g.every((d) => d <= FRAME), `ms from a hard chore's end to the next start ${short(g)} (a frame is ${FRAME})`]; });
  chk("S3 control (pace frame): the chore after a hard one starts 20 ms or more after the frame that followed it", c, (c) => {
    const g = c.ran.map((e, i) => ({ e, next: c.ran[i + 1] })).filter((x) => x.e.name.startsWith("h") && x.next).map((x) => x.next.at - c.callbacks.find((t) => t >= x.e.end));
    return [g.length >= 4 && g.every((d) => d >= 20), `ms after the frame callback ${short(g)}`];
  });
}
/* S4 */
{
  const r = run("s4");
  chk("S4 a soft chore starts 200 ms or more after a measure (rest 200) ends", r, (r) => {
    const m = r.ran.find((e) => e.name === "measure"), s = r.ran.find((e) => e.name === "soft");
    return [!!m && !!s && s.at - m.end >= 200, m && s ? `measure ran ${m.at}-${m.end}, the soft chore started at ${s.at} (${s.at - m.end} ms after)` : `ran ${short(r.ran.map((e) => e.name))}`];
  });
}
/* S5 */
{
  const once = run("s5-once"), twice = run("s5-twice"), hardOnes = run("s5-hard");
  chk("S5 moving() called once: 3 ms soft chores run two a slice (0 and 3; 6 is past 4)", once, (r) => sliced("while moving", r.held, 12, 2, 3));
  chk("S5 ... after its release they run three a slice again", once, (r) => sliced("after release", r.released, 12, 3, 3));
  chk("S5 ... choresNow().moving is 1 while it is held and 0 after the release", once, (r) => [same(r.counts, [1, 0]), `moving ${short(r.counts)}`]);
  chk("S5 moving() called twice: two a slice with both held", twice, (r) => sliced("both held", r.both, 12, 2, 3));
  chk("S5 ... still two a slice after one release", twice, (r) => sliced("one released", r.one, 12, 2, 3));
  chk("S5 ... three a slice after both", twice, (r) => sliced("both released", r.none, 12, 3, 3));
  chk("S5 ... choresNow().moving counts 2, 1, 0", twice, (r) => [same(r.counts, [2, 1, 0]), `moving ${short(r.counts)}`]);
  chk("S5 hard chores run one a slice while moving", hardOnes, (r) => sliced("while moving", r.held, 4, 1, 2));
  chk("S5 ... and one a slice after the release", hardOnes, (r) => sliced("after release", r.released, 4, 1, 2));
}
/* S6 */
{
  const r = run("s6");
  chk("S6 hurryChores(\"flight\", 6000): 3 ms flight chores run two a slice during the opening (0 and 3; 6 is past 4)", r, (r) => sliced("during", r.during, 12, 2, 3));
  chk("S6 ... three a slice once the clock is past 6000 with nothing wanted", r, (r) => [r.nowAfter > 6000 && same(offsets(r.after), expected(12, 3, 3)) && r.after.length === 12, `clock ${r.nowAfter}; ${shape(r.after)}; want ${short(expected(12, 3, 3))}`]);
}
/* S7 */
{
  for (const [cost, per] of [[3, 2], [5, 1]]) {
    const r = run(`s7-${cost}`), c = run(`s7-${cost}-frame`);
    const softOnly = (r) => r.ran.filter((e) => e.name.startsWith("s"));
    /* the first frame's group may be started by the queue's own timer, not a frame: the ones in between are read */
    const middle = (r) => sizes(softOnly(r)).slice(1, -1);
    const sig = (r) => ({ sizes: sizes(softOnly(r)), timers: timersBetween(softOnly(r)).map((n) => n >= 1), hard: r.ran.filter((e) => e.name.startsWith("h")).length, offsets: offsets(softOnly(r)) });
    chk(`S7 the reveal, ${cost} ms soft chores: ${per === 2 ? "two" : "one"} a frame`, r, (r) => [softOnly(r).length === 14 && middle(r).length >= 3 && middle(r).every((n) => n === per), `soft ran ${softOnly(r).length}; chores a frame ${short(sizes(softOnly(r)))}`]);
    chk(`S7 the reveal, ${cost} ms soft chores: a timer is set after each`, r, (r) => [softOnly(r).length === 14 && timersBetween(softOnly(r)).every((n) => n >= 1), `timers set between starts ${short(timersBetween(softOnly(r)))}`]);
    chk(`S7 the reveal, ${cost} ms soft chores: no hard chore starts`, r, (r) => [sig(r).hard === 0, `${sig(r).hard} hard chore(s) ran`]);
    chk(`S7 the reveal under pace "frame", ${cost} ms: identical in every count (sizes, timers, hard chores, starts)`, c, (c) => [same(sig(c), sig(r)), `pace frame ${short(sig(c))} against default ${short(sig(r))}`]);
  }
}
/* S8 */
{
  const r = run("s8");
  chk("S8 typing: no slice starts within 590 ms of the key", r, (r) => [r.early === 0, `${r.early} chore(s) ran by 590 ms after the key`]);
  chk("S8 ... then one does, no sooner than 600 ms after the key", r, (r) => { const first = r.ran[0]; return [r.ran.length === 4 && first.at - r.key >= 600, `${r.ran.length} ran; the first at ${first ? first.at - r.key : "never"} ms after the key`]; });
}
/* S9 */
{
  const r = run("s9");
  const by = (r, n) => r.ran.find((e) => e.name === n);
  chk("S9 joining: A, B and C all run", r, (r) => [r.ran.length === 3, `ran ${short(r.ran.map((e) => [e.name, e.at, e.frames]))}`]);
  chk("S9 a chore queued 1 ms after the last ended, inside the budget, joins the slice (no frame asked between)", r, (r) => { const a = by(r, "A"), b = by(r, "B"); return [!!a && !!b && b.frames === a.frames && b.at - a.at <= 8, `A at ${a && a.at} (${a && a.frames} frames), B at ${b && b.at} (${b && b.frames} frames)`]; });
  chk("S9 a chore queued after the budget is spent, before any frame, waits: a frame is asked before it starts", r, (r) => { const b = by(r, "B"), c = by(r, "C"); return [!!b && !!c && c.frames > b.frames, `B at ${b && b.at} (${b && b.frames} frames), C at ${c && c.at} (${c && c.frames} frames)`]; });
}
/* S11 */
{
  const r = run("s11-s1");
  const line = (r) => (r.lines.length === 1 ? r.lines[0] : null);
  const text = (r) => (r.lines.length ? r.lines[0] : "no \"chores at x\" line");
  chk("S11 after S1's run the line says `in N slices`, N the frames asked after open", r, (r) => { const m = /\bin (\d+) slices\b/.exec(line(r) || ""); return [r.ran === 20 && !!m && r.asked > 0 && Number(m[1]) === r.asked, `${text(r)} (frames asked after open: ${r.asked})`]; });
  chk("S11 ... and `(20 soft, 0 hard)`", r, (r) => [/\(20 soft, 0 hard\)/.test(line(r) || ""), text(r)]);
  chk("S11 ... and `moving 0 ms`", r, (r) => [/\bmoving 0 ms\b/.test(line(r) || ""), text(r)]);
  const m = run("s11-s5");
  chk("S11 after S5's run (moving() held) `moving` is greater than 0 ms", m, (m) => { const x = /\bmoving (\d+(?:\.\d+)?) ms\b/.exec(m.lines[0] || ""); return [m.ran === 12 && m.lines.length === 1 && !!x && Number(x[1]) > 0, m.lines[0] || "no \"chores at x\" line"]; });
  const n = run("s11-none");
  chk("S11 under pace(\"none\") the line says `0 slices`", n, (n) => [n.ran === 8 && n.lines.length === 1 && /\bin 0 slices\b/.test(n.lines[0]), n.lines[0] || "no \"chores at x\" line"]);
}
/* S12 */
{
  chk("S12 flags.pace \"5\": 3 ms soft chores run two a slice (0 and 3; 6 is past 5)", run("s12-5"), (r) => sliced("slices", r.ran, 12, 2, 3));
  chk("S12 flags.pace \"12\": 3 ms soft chores run four a slice (0, 3, 6 and 9; 12 is past 12)", run("s12-12"), (r) => sliced("slices", r.ran, 12, 4, 3));
}
finish();
