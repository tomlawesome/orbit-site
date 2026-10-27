/*
 * Test for #85 batch 1, the seam (ADR-0004 6a.5, test D7), written from the specification alone: `chores.js` gains
 * `pace("none")`, the worker's pace, under which nothing of the flight waits for the page: `end` schedules the next
 * chore at once (no frame, no rest of up to 20 ms), `pump` ignores the opening and the typing wait, and `uploadBanded`
 * puts a picture on whole. The measures keep their 200 ms rest. Every case has its control under the default pace,
 * which shows the thing paced away is there to begin with.
 *
 *   node tools/ci/draw-pace-test.mjs
 *
 *   R  ten chores (rest 20) queued and opened: under "none" none asks a frame between the first and the last, and all
 *      run within one rest; control: frames are asked between them
 *   O  three chores, the queue never opened: under "none" they run; control: they wait, and run once opened
 *   T  typingWait 600, a key pressed, a chore queued: under "none" it runs within 100 ms; control: it waits past
 *      100 ms, and runs later
 *   M  under "none", a chore with the measure's 200 ms rest, then another: the second starts 200 ms or more after the
 *      first (control: R's rest-20 chores run within one rest)
 *   U  uploadBanded(gl, 4096x4096 bitmap): under "none" one texImage2D of the full height and nothing else of the
 *      picture's; control: the picture goes on in bands (more than one upload call)
 *
 * The chores are reached through assets/door/index.js as a host reaches them (chore(fn, rest, tag), openChores,
 * uploadBanded); `pace` from index.js if it exports it, else from chores.js by its own path (6a.5 names it there).
 * Each case runs in a fresh Node process on the stub page (door-stub.mjs), on the virtual clock: every time read here
 * is virtual, so nothing depends on the runner's speed. requestAnimationFrame is counted.
 */
import { INDEX, installPage, installClock, childMain, runCase, check, finish, errOf } from "./door-stub.mjs";

const CHORES = "../../assets/door/chores.js";
const REST = 20;
const MEASURE_REST = 200;

async function setup({ typingWait = 0, none }) {
  const page = installPage();
  const clock = installClock();
  const raf = globalThis.requestAnimationFrame;
  const frames = { n: 0 };
  globalThis.requestAnimationFrame = (f) => { frames.n++; return raf(f); };
  const door = await import(INDEX);
  door.createDoor({ typingWait, flags: {} });
  if (none) {
    const pace = typeof door.pace === "function" ? door.pace : (await import(CHORES)).pace;
    if (typeof pace !== "function") throw new Error("no pace() exported by index.js or chores.js");
    pace("none");
  }
  return { page, clock, door, frames };
}

/* chores that note when they ran (virtual ms) and how many frames had been asked by then */
const noter = (clock, frames, ran) => (name) => () => { ran.push({ name, at: clock.now(), frames: frames.n }); };

async function rests({ none }) {
  const { clock, door, frames } = await setup({ none });
  const ran = [];
  const note = noter(clock, frames, ran);
  for (let i = 0; i < 10; i++) door.chore(note(`c${i}`), REST, "");
  door.openChores();
  await clock.advance(5000);
  return { ran };
}

async function opening({ none }) {
  const { clock, door, frames } = await setup({ none });
  const ran = [];
  const note = noter(clock, frames, ran);
  for (let i = 0; i < 3; i++) door.chore(note(`c${i}`), 0, "");
  await clock.advance(3000);
  const unopened = ran.length;
  door.openChores();
  await clock.advance(3000);
  return { unopened, opened: ran.length };
}

async function typing({ none }) {
  const { page, clock, door, frames } = await setup({ none, typingWait: 600 });
  door.openChores();
  await clock.advance(100);
  const listening = { window: Object.keys(page.winListeners), document: Object.keys(page.docListeners) };
  for (const type of ["keydown", "input"]) {
    const ev = { type, key: "a", code: "KeyA", target: page.document.body, isTrusted: true };
    for (const fn of [...(page.winListeners[type] || [])]) fn(ev);
    for (const fn of [...(page.docListeners[type] || [])]) fn(ev);
  }
  const t0 = clock.now();
  const ran = [];
  door.chore(noter(clock, frames, ran)("typed"), 0, "");
  await clock.advance(100);
  const soon = ran.length;
  await clock.advance(5000);
  return { listening, soon, later: ran.length, at: ran[0] ? ran[0].at - t0 : null };
}

async function measure() {
  const { clock, door, frames } = await setup({ none: true });
  const ran = [];
  const note = noter(clock, frames, ran);
  door.chore(note("measure"), MEASURE_REST, "");
  door.chore(note("after"), REST, "");
  door.openChores();
  await clock.advance(5000);
  return { ran };
}

async function upload({ none }) {
  const { page, clock, door } = await setup({ none });
  const calls = [];
  const img = page.glBase.texImage2D, sub = page.glBase.texSubImage2D;
  page.glBase.texImage2D = (...a) => {
    const src = a.length >= 9 ? a[8] : a[5];
    const h = a.length >= 9 ? a[4] : src && src.height;
    calls.push({ fn: "texImage2D", h, probe: !!(src && src.probe), withSource: !!src });
    return img(...a);
  };
  page.glBase.texSubImage2D = (...a) => {
    const src = a[a.length - 1];
    calls.push({ fn: "texSubImage2D", h: a.length >= 9 ? a[5] : src && src.height, probe: !!(src && src.probe) });
    return sub(...a);
  };
  door.openChores();
  const bitmap = { width: 4096, height: 4096, close() {} };
  let settled = "pending";
  try {
    const v = door.uploadBanded(page.gl, bitmap, { name: "stub" });
    if (v && typeof v.then === "function") v.then(() => { settled = "resolved"; }, (e) => { settled = `rejected: ${e && e.message}`; });
    else settled = "returned";
  } catch (e) { settled = `threw: ${e && e.message}`; }
  await clock.advance(60000, () => settled !== "pending");
  return { settled, calls: calls.filter((c) => !c.probe) };
}

const CASES = {
  "rests-none": () => rests({ none: true }), "rests-control": () => rests({ none: false }),
  "open-none": () => opening({ none: true }), "open-control": () => opening({ none: false }),
  "typing-none": () => typing({ none: true }), "typing-control": () => typing({ none: false }),
  "measure-none": () => measure(),
  "upload-none": () => upload({ none: true }), "upload-control": () => upload({ none: false }),
};

if (process.argv[2] === "--child") await childMain(CASES);

const span = (ran) => (ran && ran.length ? { at: ran[ran.length - 1].at - ran[0].at, frames: ran[ran.length - 1].frames - ran[0].frames } : null);
const showRan = (r) => `${r.ran ? r.ran.length : 0} ran; ${JSON.stringify(span(r.ran))} (virtual ms, frames asked) first to last${errOf(r)}`;

{
  const c = runCase(import.meta.url, "rests-control");
  const s = span(c.ran);
  check("R control: under the default pace the ten chores run with frames asked between them", !c.error && c.ran.length === 10 && s.frames > 0, showRan(c));
  const r = runCase(import.meta.url, "rests-none");
  const n = span(r.ran);
  check("R pace(\"none\"): ten chores run with no frame asked between the first and the last", !r.error && r.ran.length === 10 && n.frames === 0, showRan(r));
  check("R pace(\"none\"): ... and with no rest between them (all ten within one 20 ms rest)", !r.error && r.ran.length === 10 && n.at < REST, showRan(r));
}
{
  const c = runCase(import.meta.url, "open-control");
  check("O control: under the default pace an unopened queue runs nothing, and runs once opened", !c.error && c.unopened === 0 && c.opened === 3, `${c.unopened} ran unopened, ${c.opened} once opened${errOf(c)}`);
  const r = runCase(import.meta.url, "open-none");
  check("O pace(\"none\"): the chores run though the queue was never opened", !r.error && r.unopened === 3, `${r.unopened} ran unopened${errOf(r)}`);
}
{
  const c = runCase(import.meta.url, "typing-control");
  check("T control: under the default pace a chore waits while someone types, and runs later", !c.error && c.soon === 0 && c.later === 1, `ran within 100 ms: ${c.soon}; later: ${c.later} (at ${c.at} ms); listening ${JSON.stringify(c.listening)}${errOf(c)}`);
  const r = runCase(import.meta.url, "typing-none");
  check("T pace(\"none\"): the typing wait is ignored (the chore runs within 100 ms of the key)", !r.error && r.soon === 1, `ran within 100 ms: ${r.soon}; at ${r.at} ms${errOf(r)}`);
}
{
  const r = runCase(import.meta.url, "measure-none");
  const gap = r.ran && r.ran.length === 2 ? r.ran[1].at - r.ran[0].at : null;
  check("M pace(\"none\"): the measure's 200 ms rest is still honoured (the next chore starts 200 ms or more after it)", !r.error && gap !== null && gap >= MEASURE_REST, `${r.ran ? r.ran.length : 0} ran; gap ${gap} virtual ms${errOf(r)}`);
}
{
  const c = runCase(import.meta.url, "upload-control");
  check("U control: under the default pace the picture goes on in bands (more than one upload call)", !c.error && /resolved|returned/.test(c.settled) && c.calls.length > 1, `${c.settled}; calls ${JSON.stringify(c.calls)}${errOf(c)}`);
  const r = runCase(import.meta.url, "upload-none");
  const one = r.calls && r.calls.length === 1 ? r.calls[0] : null;
  check("U pace(\"none\"): the picture goes on in one texImage2D of its full height", !r.error && /resolved|returned/.test(r.settled) && one && one.fn === "texImage2D" && one.h === 4096 && one.withSource, `${r.settled}; calls ${JSON.stringify(r.calls)}${errOf(r)}`);
}
finish();
