/*
 * Test for #93 batch 2, the worker (ADR-0004 6b.3 and 6b.7 test W8), written from the specification alone: the governor's
 * measure, told apart from the page's. On the worker path the page's own frame period no longer sees the drawing (the
 * worker draws, the page's frames come as fast as the page can post), so install.js's governor (govern: it lowers the
 * density when frames come slow, and raises it back) must be fed by the worker's own period, `drew { dt }`, and by nothing
 * else (owner, answer 6b-3a: "we need to be careful here that the test is actually good and doesn't just default to the
 * old stuff"). A build that still reads the page's own period fails (a) and (b) both.
 *
 *   node tools/ci/world-govern-test.mjs
 *
 * install.js runs on the stub page (door-stub.mjs). The page's frames are the test's: its requestAnimationFrame comes P ms
 * apart (16.7 or 50) once the world is made. On the worker path the page's `Worker` is a fake class (installWorldWorker)
 * that answers every `view` with `drew { dt: D }` (D 50, 16.7, or none at all). On the page path (`draw: "page"`: the
 * control) the world reports each frame with the loop's own dt, as it does today. The density is read two ways, because
 * govern has two branches:
 *
 *   rest   the camera at rest (start(), 20 s of virtual time): the canvas's scale. Where the worker draws, the last
 *          `resize` it was posted; on the page, the canvas's bitmap width over the screen's.
 *   dive   the dive into the world (form(), to its end): the part of the scene drawn while the camera moves, read as the
 *          `part` of a view drawn at the shot's start (still) before and after, and the `first second N frames, worst N ms`
 *          line, which counts the frames the worker drew too.
 *
 *   a  the worker slow (D 50), the page fast (P 16.7): the density drops, as the page path's does for a 50 ms frame
 *   b  the worker fast (D 16.7), the page slow (P 50): the density does not drop (the page path's, for the same page frames, does)
 *   c  no `drew` at all (P 50): the density holds where it was, never reading the page's period instead
 *
 * One fresh Node process a case, on the virtual clock; nothing here depends on how fast the runner is.
 */
import { bootInstallPage, settled, fakeWorldWorkers, installWorldWorker, sceneAt, DOT, runCaseSpied, childMain, chk, check, finish } from "./door-stub.mjs";

const INSTALL = "../../assets/js/install.js";

async function scenario({ path, mode, P, D }) {
  const b = await bootInstallPage({ draw: path });
  const counts = { drews: 0 };
  let ww = null;
  if (path === "worker") ww = installWorldWorker(b, fakeWorldWorkers({ drew: D === null ? null : { dt: () => { counts.drews++; return D; }, ms: 1 } }));
  const { createInstall } = await import(INSTALL);
  const pad = b.pad();
  const ring = createInstall(pad);
  const p = await settled(ring.prepare(), b.clock);
  await b.clock.advance(3000);
  if (path === "worker" && !ww.first()) return { none: "no worker was made (install.js never made one with `new Worker`)" };
  if (path === "worker" && p.state !== "resolved") return { none: `the install did not prepare on the worker path (${p.state})` };

  /* the page's frames from here on come P ms apart */
  const gaps = []; let lastFrame = null;
  globalThis.requestAnimationFrame = (f) => globalThis.setTimeout(() => { const t = performance.now(); if (lastFrame !== null) gaps.push(t - lastFrame); lastFrame = t; f(t); }, P);

  const views = () => (path === "worker" ? ww.first().of("view").length : globalThis.__worldSpy?.views.length ?? 0);
  const scale = () => (path === "worker" ? ww.first().of("resize").at(-1)?.scale ?? null : pad.canvas.width / 1280);
  const mq = async () => {
    const s = await settled(ring.still(0.1, 0, { ...DOT }), b.clock);
    if (s.state !== "resolved" || s.value !== true) return null;
    const v = path === "worker" ? ww.first().of("view").at(-1)?.view : globalThis.__worldSpy?.views.at(-1);
    return v ? v.part : null;
  };
  const out = { counts };
  if (mode === "rest") {
    out.before = scale();
    const v0 = views();
    ring.start();
    await b.clock.advance(20000);
    out.after = scale();
    out.views = views() - v0;
    ring.stop();
  } else {
    out.before = await mq();
    const v0 = views();
    const shot = { done: false };
    ring.form(sceneAt()).then(() => { shot.done = true; });
    await b.clock.advance(30000, () => shot.done);
    await b.clock.advance(3000);
    out.views = views() - v0;
    out.settled = shot.done;
    ring.stop();
    out.after = await mq();
    out.line = b.page.lines.filter((l) => /first second \d+ frames, worst \d+ ms/.test(l));
  }
  out.pageFrame = gaps.length ? gaps.reduce((a, c) => a + c, 0) / gaps.length : null;
  return out;
}

const SPEC = {
  a: { worker: { P: 16.7, D: 50 }, page: { P: 50 } },
  b: { worker: { P: 50, D: 16.7 }, page: { P: 16.7 } },
  c: { worker: { P: 50, D: null } },
};
const CASES = {};
for (const mode of ["rest", "dive"]) {
  for (const [key, s] of Object.entries(SPEC)) {
    CASES[`${mode}-${key}-worker`] = () => scenario({ path: "worker", mode, ...s.worker });
    if (s.page) CASES[`${mode}-${key}-page`] = () => scenario({ path: "page", mode, D: null, ...s.page });
  }
}

if (process.argv[2] === "--child") await childMain(CASES);

const show = (x) => JSON.stringify(x);
const run = (n) => runCaseSpied(import.meta.url, n);
const DROP = 0.01;
const dropped = (r) => r.before !== null && r.after !== null && r.after < r.before - DROP;
const held = (r) => r.before !== null && r.after !== null && r.before === r.after;
const worst = (r) => { const m = /worst (\d+) ms/.exec(r.line?.[0] ?? ""); return m ? +m[1] : null; };
const frames = (r, P) => `the page's frames came ${r.pageFrame === null ? "never" : r.pageFrame.toFixed(1)} ms apart (want ${P})`;
const pageFrames = (r, P) => r.pageFrame !== null && Math.abs(r.pageFrame - P) < 0.5;

for (const mode of ["rest", "dive"]) {
  const what = mode === "rest" ? "at rest (the canvas's scale)" : "in the dive (the scene's part)";
  const A = run(`${mode}-a-worker`), AP = run(`${mode}-a-page`), B = run(`${mode}-b-worker`), BP = run(`${mode}-b-page`), C = run(`${mode}-c-worker`);
  const seen = (r) => `density ${show(r.before)} -> ${show(r.after)}`;
  const dive = mode === "dive";

  chk(`W8 ${what} control, page path, page frames 50 ms: the density drops`, AP, (r) => [pageFrames(r, 50) && dropped(r), `${frames(r, 50)}; ${seen(r)}`]);
  chk(`W8 ${what} control, page path, page frames 16.7 ms: the density holds`, BP, (r) => [pageFrames(r, 16.7) && held(r), `${frames(r, 16.7)}; ${seen(r)}`]);
  if (dive) {
    chk("W8 in the dive control, page path: the frame count reports the page's own worst frame (50 ms, then 17 ms)", AP, (r) => [worst(r) === 50 && worst(BP) === 17, `lines ${show(r.line)} and ${show(BP.line)}`]);
  }

  chk(`W8 (a) ${what}, the worker slow (drew.dt 50 ms), the page fast (16.7 ms): the density drops, as the page path's does for a 50 ms frame`, A, (r) => [pageFrames(r, 16.7) && dropped(r) && r.counts.drews > 0, `${frames(r, 16.7)}; ${seen(r)}; drew answered ${r.counts.drews} time(s)`]);
  chk(`W8 (b) ${what}, the worker fast (drew.dt 16.7 ms), the page slow (50 ms): the density does not drop`, B, (r) => [pageFrames(r, 50) && held(r) && r.counts.drews >= (dive ? 10 : 24), `${frames(r, 50)}; ${seen(r)}; drew answered ${r.counts.drews} time(s) (enough for the governor to act)`]);
  chk(`W8 (c) ${what}, no drew at all, the page slow (50 ms): the density holds where it was, never reading the page's period instead`, C, (r) => [pageFrames(r, 50) && held(r) && r.counts.drews === 0 && r.views >= 30, `${frames(r, 50)}; ${seen(r)}; views posted ${r.views}, drew answered ${r.counts.drews} time(s)`]);
  if (dive) {
    chk("W8 in the dive (a) the frame count is the worker's: worst frame 50 ms, not the page's 17", A, (r) => [worst(r) === 50, `lines ${show(r.line)}`]);
    chk("W8 in the dive (b) the frame count is the worker's: worst frame 17 ms, not the page's 50", B, (r) => [worst(r) === 17, `lines ${show(r.line)}`]);
    chk("W8 in the dive (c) no frame was drawn by the worker, so the frame count says nothing (it is not the page's)", C, (r) => [!r.line || r.line.length === 0, `lines ${show(r.line)}`]);
    chk("W8 in the dive (a, b, c) the dive settles all the same", A, (r) => [r.settled === true && B.settled === true && C.settled === true, `settled ${r.settled}, ${B.settled}, ${C.settled}`]);
  }
}
finish();
