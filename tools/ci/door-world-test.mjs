/*
 * Tests for the flight's world and journey (#12, #21, #39), written from the specification alone (batch fix/m2-door).
 *
 *   D4  voyage.js shaders: GLSL pow(x, y) is undefined for x < 0, so no pow( in a shader source the world compiles may
 *       take a base that can be negative (a bare subtraction, or sin/cos/dot, without abs/max/clamp around it).
 *       A lint-like check over the sources the fake context records; control: a known-bad snippet is flagged.
 *   D6  a flight-world map whose download fails is fetched again on the next warm of a live world, and put on the GPU
 *       when it succeeds. Control: a map that loaded is not fetched twice.
 *   D8  journey.js body.holding: an older flight's ready settling must not clear the class a newer flight set.
 *       Control: a single flight sets and clears it.
 *   D9  (#39) the world's fitness speed test does not run while document.hidden: a slow world is not retired while the
 *       tab is hidden; it runs when the tab becomes visible. Control: visible and slow -> retired.
 *   D10 (#39) in the flight's world, a picture whose upload fails after the world stopped is given back: no texture
 *       left alive for it. Control: a live world keeps its textures (so the count can see them).
 *
 *   node tools/ci/door-world-test.mjs
 *
 * No dependencies and no browser; each case runs in a fresh Node process (this file again, as `--child`) against the
 * stub page in door-stub.mjs. The journey is reached through assets/door/index.js alone, as a host does. D8 runs on a
 * virtual clock.
 */
import { riskyPows, riskyPowsStrict, powBases } from "./door-pow-lint.mjs";
import { INDEX, isProbeSrc, mountLive, listenerCounts, installPage, installClock, sleep, childMain, runCase, check, finish, errOf } from "./door-stub.mjs";

const CASES = {
  async "shaders"() {
    const page = installPage();
    const door = await import(INDEX);
    const d = door.createDoor({ typingWait: 0, flags: {} });
    const journey = d.journey(page.journeyOptions());
    journey.warm({ prove: false }).catch(() => {});
    journey.warmDocs({ prove: false }).catch(() => {});
    door.openChores();
    await Promise.race([door.quiet(), sleep(6000)]);
    await sleep(200);
    await Promise.race([door.quiet(), sleep(6000)]);
    const sources = [...new Set(page.shaders.map((s) => s.src).filter((s) => s && !isProbeSrc(s)))];
    return { sources };
  },

  /* D6: the first map fetched is refused (every time it is asked for, during the first warm); then a second warm */
  async "retry"() {
    const calls = {};
    let failedUrl = null, refusing = true;
    const page = installPage({
      fetch: (u) => {
        calls[u] = (calls[u] || 0) + 1;
        failedUrl ??= u;
        if (refusing && u === failedUrl) return Promise.reject(new Error("the network dropped"));
        return Promise.resolve({ ok: true, blob: async () => ({ size: 1 }) });
      },
    });
    const door = await import(INDEX);
    const d = door.createDoor({ typingWait: 0, flags: {} });
    const journey = d.journey(page.journeyOptions());
    door.openChores();
    await Promise.race([journey.warm({ prove: false }).catch(() => {}), sleep(6000)]);
    await Promise.race([door.quiet(), sleep(6000)]);
    await sleep(200);
    const afterFirst = { ...calls }, texFirst = page.tex.filter((c) => !c.probe).length;
    refusing = false;                                           /* the network is back */
    await Promise.race([journey.warm({ prove: false }).catch(() => {}), sleep(6000)]);
    await Promise.race([door.quiet(), sleep(6000)]);
    await sleep(200);
    const others = Object.keys(calls).filter((u) => u !== failedUrl);
    return {
      failedUrl, firstFetches: afterFirst[failedUrl] || 0, fetches: calls[failedUrl] || 0, urls: Object.keys(calls).length,
      othersTwice: others.filter((u) => calls[u] > (afterFirst[u] || 0)), texFirst, texSecond: page.tex.filter((c) => !c.probe).length - texFirst,
    };
  },

  /* R1: the retry's download is held for ever; the proof must not wait for it */
  async "retry-held"() { return retryProof({ hold: true }); },
  async "retry-free"() { return retryProof({ hold: false }); },

  /* R2: a stopped world's waits settle, and leave no listener */
  async "stop-waiting"() { return stopCase("waiting"); },
  async "stop-before-wait"() { return stopCase("before"); },
  async "stop-control"() { return stopCase("control"); },

  /* R3: visible when proving starts, hidden by the time the timed frames would run */
  async "hide-midway"() { return midwayCase(); },

  /* R6: a retried map is mipped like the others */
  async "mips-control"() { return mipsCase({ fail: false }); },
  async "mips-retry"() { return mipsCase({ fail: true }); },

  /* R5: the live door's program */
  async "live-shaders"() {
    const page = installPage();
    const clock = installClock();
    const m = await mountLive(page);
    const { sceneHead } = await import("../../assets/door/voyage.js");
    m.dawn.start();
    m.dawn.light({ firstVisit: false, aside: true, onLit() {}, onOpen() {}, after() {} });
    m.dawn.live.compile();
    await clock.advance(3000);
    m.dawn.live.start();
    await clock.advance(3000);
    const sources = [...new Set(page.shaders.map((x) => x.src).filter((x) => x && !isProbeSrc(x)))];
    return { sources, head: sceneHead({ door: true }) };
  },

  /* D8: one flight, or two, each with a ready held */
  async "holding-single"() { return holdingCase(false); },
  async "holding-two"() { return holdingCase(true); },

  /* D9: a slow world, the tab hidden or visible */
  async "fit-hidden"() { return fitCase({ hidden: true }); },
  async "fit-visible"() { return fitCase({ hidden: false }); },

  /* D10: an upload that fails after the world stopped (or, in the control, none) */
  async "upload-fails-stopped"() { return uploadCase({ fail: true }); },
  async "upload-control"() { return uploadCase({ fail: false }); },
};

/* R1: phase 1 as D6 (the first map refused every time); phase 2: the network is back for every map but that one, whose
   fetch is held for ever (or, in the control, answers). The proving warm() must reach its verdict either way. */
async function retryProof({ hold }) {
  const calls = {};
  let failedUrl = null, phase = 1;
  const page = installPage({
    fetch: (u) => {
      calls[u] = (calls[u] || 0) + 1;
      failedUrl ??= u;
      if (u === failedUrl && phase === 1) return Promise.reject(new Error("the network dropped"));
      if (u === failedUrl && hold) return new Promise(() => {});
      return Promise.resolve({ ok: true, blob: async () => ({ size: 1 }) });
    },
  });
  const clock = installClock();
  const door = await import(INDEX);
  const d = door.createDoor({ typingWait: 0, flags: {} });
  const journey = d.journey(page.journeyOptions());
  door.openChores();
  journey.warm({ prove: false }).catch(() => {});
  await clock.advance(10000);
  phase = 2;
  const t0 = clock.now();
  let settled = false;
  journey.warm().then(() => { settled = true; }, () => { settled = true; });
  const line = () => page.lines.find((l) => /flight world: (on|off)/.test(l));
  await clock.advance(30000, () => !!line());
  return { failedUrl, retried: (calls[failedUrl] || 0) >= 2, verdict: line() || null, verdictAfter: line() ? clock.now() - t0 : null, settled };
}

/* R2 */
async function stopCase(how) {
  const page = installPage({ hidden: how !== "control" });
  const clock = installClock();
  const door = await import(INDEX);
  const d = door.createDoor({ typingWait: 0, flags: {} });
  const journey = d.journey(page.journeyOptions());
  const baseline = listenerCounts(page);
  let settled = false;
  if (how === "waiting") {
    door.openChores();
    journey.warm().then(() => { settled = true; }, () => { settled = true; });
    await clock.advance(4000);                                // the world is made and is waiting for the tab to show
    var waitingBefore = { settled, listeners: listenerCounts(page) };
    journey.destroy();
  } else if (how === "before") {
    journey.warm().then(() => { settled = true; }, () => { settled = true; });   // the chores are not open: the wait is not reached
    journey.destroy();
    door.openChores();
  } else {
    door.openChores();
    journey.warm().then(() => { settled = true; }, () => { settled = true; });
  }
  await clock.advance(6000);
  return { settled, baseline, after: listenerCounts(page), waitingBefore: typeof waitingBefore === "undefined" ? null : waitingBefore, verdicts: page.lines.filter((l) => /flight world/.test(l)).length };
}

/* R3: the tab is hidden at the first draw (the proof has started, the timed frames have not) */
async function midwayCase() {
  const page = installPage();
  const spin = (ms) => { const t = performance.now(); while (performance.now() - t < ms) { /* a slow frame */ } };
  page.glBase.readPixels = () => { page.readPixels++; spin(40); };
  let flipped = false;
  for (const fn of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
    page.glBase[fn] = () => { page.draws++; if (!flipped) { flipped = true; page.setHidden(true); } };
  }
  const door = await import(INDEX);
  const d = door.createDoor({ typingWait: 0, flags: {} });
  const journey = d.journey(page.journeyOptions());
  door.openChores();
  journey.warm().catch(() => {});
  const verdict = () => page.lines.filter((l) => /flight world: off: frame/.test(l)).length;
  await sleep(2500);
  const during = { flipped, verdicts: verdict(), removed: page.removed, lost: page.lost, readPixels: page.readPixels };
  page.setHidden(false);
  for (let i = 0; i < 100 && !verdict(); i++) await sleep(100);
  return { during, after: { verdicts: verdict(), removed: page.removed, lost: page.lost } };
}

/* R6 */
async function mipsCase({ fail }) {
  let failedUrl = null, refusing = fail;
  const page = installPage({
    fetch: (u) => {
      failedUrl ??= u;
      if (refusing && u === failedUrl) return Promise.reject(new Error("the network dropped"));
      return Promise.resolve({ ok: true, blob: async () => ({ size: 1 }) });
    },
  });
  const door = await import(INDEX);
  const d = door.createDoor({ typingWait: 0, flags: {} });
  const journey = d.journey(page.journeyOptions());
  door.openChores();
  const settle = async () => { await Promise.race([door.quiet(), sleep(6000)]); await sleep(200); await Promise.race([door.quiet(), sleep(6000)]); };
  await Promise.race([journey.warm({ prove: false }).catch(() => {}), sleep(6000)]);
  await settle();
  refusing = false;
  await Promise.race([journey.warm({ prove: false }).catch(() => {}), sleep(6000)]);
  await settle();
  const maps = page.mapTextures();
  return { maps: maps.size, mipped: [...maps].filter((t) => page.mipped.includes(t)).length };
}

async function holdingCase(two) {
  const page = installPage();
  const clock = installClock();
  const door = await import(INDEX);
  const d = door.createDoor({ typingWait: 0, flags: {} });
  const journey = d.journey(page.journeyOptions());
  const holds = () => page.bodyLog.filter((e) => e.name === "holding");
  let r1, r2;
  const p1 = new Promise((r) => { r1 = r; }), p2 = new Promise((r) => { r2 = r; });
  const has = () => page.bodyClasses.has("holding");
  const out = {};
  journey.fly(door.UP, { title: "Orbit", subtitle: "to somewhere", ready: p1 });
  await clock.advance(20000, () => has());
  out.firstHolds = has();
  if (!two) {
    r1();
    await clock.advance(500);
    out.afterOnlyFlight = has();
    return out;
  }
  const adds = () => holds().filter((e) => e.op === "add").length;
  const addsBefore = adds();
  journey.fly(door.UP, { title: "Orbit", subtitle: "to elsewhere", ready: p2 });
  /* the newer flight reaches its own wait */
  await clock.advance(20000, () => adds() > addsBefore && has());
  out.secondHolds = has() && adds() > addsBefore;
  r1();                                       /* the OLDER flight's ready settles */
  await clock.advance(300);
  out.afterOlderSettled = has();
  r2();
  await clock.advance(500);
  out.afterNewerSettled = has();
  out.log = holds().map((e) => `${e.op}@${Math.round(e.at)}`);
  return out;
}

async function fitCase({ hidden }) {
  const page = installPage({ hidden });
  const spin = (ms) => { const t = performance.now(); while (performance.now() - t < ms) { /* a slow frame */ } };
  page.glBase.readPixels = () => { page.readPixels++; spin(40); };      /* every timed frame syncs with one: all are over FIT_MS */
  const door = await import(INDEX);
  const d = door.createDoor({ typingWait: 0, flags: {} });
  const journey = d.journey(page.journeyOptions());
  door.openChores();
  let proved = "pending";
  journey.warm().then((v) => { proved = "settled"; }, () => { proved = "rejected"; });
  const verdict = () => page.lines.filter((l) => /flight world: off: frame/.test(l)).length;
  const t0 = Date.now();
  if (hidden) {
    await sleep(2500);                                          /* hidden all this while */
    const during = { verdicts: verdict(), removed: page.removed, lost: page.lost, readPixels: page.readPixels, made: page.shaders.filter((s) => !isProbeSrc(s.src)).length };
    page.setHidden(false);                                      /* the tab is shown */
    for (let i = 0; i < 100 && !verdict(); i++) await sleep(100);
    return { during, after: { verdicts: verdict(), removed: page.removed, lost: page.lost, readPixels: page.readPixels }, lines: page.lines.filter((l) => /flight world/.test(l)) };
  }
  for (let i = 0; i < 100 && !verdict(); i++) await sleep(100);
  return { after: { verdicts: verdict(), removed: page.removed, lost: page.lost, readPixels: page.readPixels }, ms: Date.now() - t0 };
}

async function uploadCase({ fail }) {
  const page = installPage({ fetch: () => Promise.resolve({ ok: true, blob: async () => ({ size: 1 }) }) });
  let journey = null, stopped = false;
  if (fail) {
    /* the first picture upload of the world: the journey goes, and that upload (and each after it) fails */
    const tex = page.glBase.texSubImage2D, img = page.glBase.texImage2D, store = page.glBase.texStorage2D;
    const strike = (orig, args) => {
      const src = args[args.length - 1];
      if (src?.probe) return orig(...args);
      orig(...args);                                              /* the call is recorded, then it fails */
      if (!stopped && journey) { stopped = true; journey.destroy(); }
      if (stopped) throw new Error("the upload failed");
    };
    page.glBase.texSubImage2D = (...a) => strike(tex, a);
    page.glBase.texImage2D = (...a) => strike(img, a);
    page.glBase.texStorage2D = (...a) => { store(...a); };
  }
  const door = await import(INDEX);
  const d = door.createDoor({ typingWait: 0, flags: {} });
  journey = d.journey(page.journeyOptions());
  const proof = journey.warm({ prove: false });
  proof.catch(() => {});
  door.openChores();
  await Promise.race([door.quiet(), sleep(6000)]);
  await sleep(300);
  await Promise.race([door.quiet(), sleep(6000)]);
  const used = page.mapTextures();
  const alive = [...used].filter((t) => !page.deletedTextures.includes(t));
  return { stopped, picturesTouched: used.size, alive: alive.length };
}

if (process.argv[2] === "--child") await childMain(CASES);

/* D4 */
{
  const bad = ["pow(sin(x), 2.0)", "pow(a - b, 2.0)", "pow(1.0 - r, 3.0)", "pow(cos(t) * 0.5, y)", "pow((a - b) * c, 2.0)", "pow(dot(n, l), 8.0)"];
  const good = ["pow(max(a - b, 0.0), 2.0)", "pow(abs(sin(x)), 2.0)", "pow(clamp(dot(n, l), 0.0, 1.0), 8.0)", "pow(v, 2.0)", "pow(x * x, 0.5)", "pow(1e-3, y)"];
  check("control (D4): each known-bad pow snippet is flagged", bad.every((s) => riskyPows(s).length === 1), `flagged ${bad.filter((s) => riskyPows(s).length === 1).length} of ${bad.length}`);
  check("control (D4): each known-good pow snippet is not flagged", good.every((s) => riskyPows(s).length === 0), `flagged by mistake: ${JSON.stringify(good.filter((s) => riskyPows(s).length))}`);
  const r = runCase(import.meta.url, "shaders");
  const sources = r.sources || [];
  check("control (D4): the world's shader sources were recorded (the check has something to read)", !r.error && sources.length >= 3 && sources.some((s) => /\bpow\s*\(/.test(s)), `${sources.length} sources, ${sources.reduce((n, s) => n + powBases(s).length, 0)} pow( calls${errOf(r)}`);
  const found = sources.flatMap((s) => riskyPows(s));
  check("D4: no pow( in the world's shaders takes a base that can be negative", !r.error && found.length === 0, `${found.length} risky call(s): ${JSON.stringify(found.slice(0, 5).map((f) => f.at))}${errOf(r)}`);
}
/* D6 */
{
  const r = runCase(import.meta.url, "retry");
  check("control (D6): the first warm fetched several maps, and the first one was refused", !r.error && r.urls >= 2 && r.firstFetches >= 1, `${r.urls} URL(s) fetched; the refused one ${r.failedUrl} was asked for ${r.firstFetches}x${errOf(r)}`);
  check("control (D6): a map that loaded in the first warm is not fetched again by the second", !r.error && r.othersTwice.length === 0, `fetched again: ${JSON.stringify(r.othersTwice)}${errOf(r)}`);
  check("D6: the map whose download failed is fetched again on the next warm", !r.error && r.fetches > r.firstFetches, `${r.failedUrl} asked for ${r.firstFetches}x in the first warm, ${r.fetches}x in all (want more)${errOf(r)}`);
  check("D6: ... and, when that succeeds, it is put on the GPU", !r.error && r.texSecond >= 1, `${r.texSecond} texture upload call(s) during the second warm (want 1 or more)${errOf(r)}`);
}
/* D8 */
{
  const c = runCase(import.meta.url, "holding-single");
  check("control (D8): a single flight sets body.holding while it waits on ready, and clears it when ready settles",
    !c.error && c.firstHolds === true && c.afterOnlyFlight === false, `holding while waiting: ${c.firstHolds}; after ready settled: ${c.afterOnlyFlight}${errOf(c)}`);
  const r = runCase(import.meta.url, "holding-two");
  check("D8 (precondition): the newer flight is holding on its own ready", !r.error && r.firstHolds === true && r.secondHolds === true, `first flight held ${r.firstHolds}, second ${r.secondHolds}${errOf(r)}`);
  check("D8: the older flight's ready settling does not clear body.holding the newer flight set", !r.error && r.afterOlderSettled === true, `body.holding after the older ready settled: ${r.afterOlderSettled} (want true); log ${JSON.stringify(r.log)}${errOf(r)}`);
  check("D8: the newer flight's ready settling clears it", !r.error && r.afterNewerSettled === false, `body.holding after the newer ready settled: ${r.afterNewerSettled} (want false)${errOf(r)}`);
}
/* D9 */
{
  const c = runCase(import.meta.url, "fit-visible");
  check("control (D9): visible and slow -> the world is judged too slow and retired (verdict line, canvas removed, context lost)",
    !c.error && c.after.verdicts >= 1 && c.after.removed >= 1 && c.after.lost === true, `${JSON.stringify(c.after)} after ${c.ms} ms${errOf(c)}`);
  const r = runCase(import.meta.url, "fit-hidden");
  check("D9 (precondition): while hidden the world was made", !r.error && r.during.made >= 1, `shaders made while hidden: ${r.during?.made}${errOf(r)}`);
  check("D9: a hidden tab does not run the speed test (no frame timed, no 'off: frame' line)", !r.error && r.during.verdicts === 0 && r.during.readPixels === 0, `while hidden: ${JSON.stringify(r.during)}${errOf(r)}`);
  check("D9: a hidden tab never retires the world (canvas kept, context not lost)", !r.error && r.during.removed === 0 && r.during.lost === false, `while hidden: removed ${r.during?.removed}, lost ${r.during?.lost}${errOf(r)}`);
  check("D9: when the tab becomes visible the test runs (slow -> retired)", !r.error && r.after.verdicts >= 1, `after visible: ${JSON.stringify(r.after)}; lines ${JSON.stringify(r.lines)}${errOf(r)}`);
}
/* D10 */
{
  const c = runCase(import.meta.url, "upload-control");
  check("control (D10): in a live world the pictures' textures are alive (the count can see them)", !c.error && c.picturesTouched >= 1 && c.alive >= 1, `${c.picturesTouched} picture texture(s) uploaded to, ${c.alive} alive${errOf(c)}`);
  const r = runCase(import.meta.url, "upload-fails-stopped");
  check("D10 (precondition): the world was stopped by the first picture upload, which then failed", !r.error && r.stopped === true && r.picturesTouched >= 1, `stopped ${r.stopped}, ${r.picturesTouched} picture texture(s) touched${errOf(r)}`);
  check("D10: a picture whose upload fails after the world stopped leaves no texture alive", !r.error && r.alive === 0, `${r.alive} of ${r.picturesTouched} picture texture(s) still alive (want 0)${errOf(r)}`);
}
/* R1 */
{
  const c = runCase(import.meta.url, "retry-free");
  check("control (R1): with the retry answering, the proving warm() prints its verdict promptly (within 5 s)", !c.error && c.retried && c.verdictAfter !== null && c.verdictAfter < 5000, `retried ${c.retried}; verdict ${JSON.stringify(c.verdict)} after ${c.verdictAfter} ms${errOf(c)}`);
  const r = runCase(import.meta.url, "retry-held");
  check("R1 (precondition): the failed map was asked for again", !r.error && r.retried === true, `retried ${r.retried}${errOf(r)}`);
  check("R1: with the retry's download held for ever, the proof still completes and prints its verdict (within 5 s)", !r.error && r.verdictAfter !== null && r.verdictAfter < 5000, `verdict ${JSON.stringify(r.verdict)} after ${r.verdictAfter} ms (virtual); warm() settled ${r.settled}${errOf(r)}`);
  check("R1: ... and the verdict is `on`", !r.error && /flight world: on/.test(r.verdict || ""), `${JSON.stringify(r.verdict)}${errOf(r)}`);
}
/* R2 */
{
  const c = runCase(import.meta.url, "stop-control");
  check("control (R2): a visible page's proving warm() settles", !c.error && c.settled === true, `settled ${c.settled}${errOf(c)}`);
  const w = runCase(import.meta.url, "stop-waiting");
  check("R2 (precondition): a hidden page's proving warm() is waiting (not settled) with a listener added", !w.error && w.waitingBefore && w.waitingBefore.settled === false && w.waitingBefore.listeners.visibility > w.baseline.visibility, `before stop: ${JSON.stringify(w.waitingBefore)}, baseline ${JSON.stringify(w.baseline)}${errOf(w)}`);
  check("R2: the world stopped while warm() waits for the tab -> warm() settles", !w.error && w.settled === true, `settled ${w.settled}${errOf(w)}`);
  check("R2: ... and no visibilitychange listener is left registered", !w.error && w.after.visibility <= w.baseline.visibility, `after ${JSON.stringify(w.after)}, baseline ${JSON.stringify(w.baseline)}${errOf(w)}`);
  const b = runCase(import.meta.url, "stop-before-wait");
  check("R2: a world stopped before the wait starts adds no visibilitychange listener", !b.error && b.after.visibility <= b.baseline.visibility, `after ${JSON.stringify(b.after)}, baseline ${JSON.stringify(b.baseline)}${errOf(b)}`);
  check("R2: ... and its warm() settles", !b.error && b.settled === true, `settled ${b.settled}${errOf(b)}`);
}
/* R3 */
{
  const r = runCase(import.meta.url, "hide-midway");
  check("R3 (precondition): the tab was hidden at the first draw, after proving began", !r.error && r.during.flipped === true, `flipped ${r.during?.flipped}${errOf(r)}`);
  check("R3: hidden by the time the timed frames would run -> no timed frames, no verdict, no retire", !r.error && r.during.verdicts === 0 && r.during.removed === 0 && r.during.lost === false, `while hidden: ${JSON.stringify(r.during)}${errOf(r)}`);
  check("R3: visible again -> the test runs (slow -> retired)", !r.error && r.after.verdicts >= 1, `after visible: ${JSON.stringify(r.after)}${errOf(r)}`);
}
/* R6 */
{
  const c = runCase(import.meta.url, "mips-control"), r = runCase(import.meta.url, "mips-retry");
  check("control (R6): the maps are mipped when all load first time (the check can see mips)", !c.error && c.maps >= 1 && c.mipped >= 1, `${c.mipped} of ${c.maps} map texture(s) mipped${errOf(c)}`);
  check("R6: a map whose download failed and was retried is mipped like the rest (as many mipped as in the control)", !r.error && !c.error && r.maps === c.maps && r.mipped === c.mipped, `retry run: ${r.mipped} of ${r.maps} mipped; control: ${c.mipped} of ${c.maps}${errOf(r)}`);
}
/* R5 */
{
  const r = runCase(import.meta.url, "live-shaders");
  const sources = r.sources || [];
  check("control (R5): the live door's shader sources were recorded", !r.error && sources.length >= 1, `${sources.length} source(s), ${sources.reduce((n, x) => n + powBases(x).length, 0)} pow( call(s), ${sources.filter((x) => /\bsq\s*\(/.test(x)).length} using sq(${errOf(r)}`);
  const found = [...sources, r.head || ""].flatMap((x) => riskyPowsStrict(x));
  check("R5: (stricter than D4: a square is written v*v) no pow( in the live door's program (sceneHead({ door: true }) and its own main) takes a base that can be negative", !r.error && found.length === 0, `${found.length} risky call(s): ${JSON.stringify(found.slice(0, 5).map((f) => f.at))}${errOf(r)}`);
}
finish();
