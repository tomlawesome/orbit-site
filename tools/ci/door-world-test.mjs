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
import { INDEX, isProbeSrc, installPage, installClock, sleep, childMain, runCase, check, finish, errOf } from "./door-stub.mjs";

/* ---- D4: the lint (pure) ---- */
const SAFE_CALLS = new Set(["abs", "max", "clamp", "exp", "exp2", "sqrt", "length", "smoothstep", "pow", "fract", "step", "min"]);
const SIGNED_CALLS = new Set(["sin", "cos", "dot"]);
/* is this expression's value possibly negative, going only by its top level? */
function canBeNegative(expr) {
  let depth = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === "(") {
      /* the name before the paren */
      let j = i - 1; while (j >= 0 && /\s/.test(expr[j])) j--;
      let k = j; while (k >= 0 && /[A-Za-z0-9_]/.test(expr[k])) k--;
      const name = expr.slice(k + 1, j + 1);
      /* find the matching paren */
      let d = 1, e = i + 1;
      while (e < expr.length && d > 0) { if (expr[e] === "(") d++; else if (expr[e] === ")") d--; e++; }
      const inner = expr.slice(i + 1, e - 1);
      if (name && SIGNED_CALLS.has(name)) return true;
      if (!name && canBeNegative(inner)) return true;           /* plain parentheses: look inside */
      i = e - 1;                                                /* any other call (abs, max, clamp, mix, ...): not looked into */
      continue;
    }
    if (c === "-" ) {
      /* the exponent of a literal (1e-3) is not a subtraction */
      if (i > 0 && /[eE]/.test(expr[i - 1]) && /[0-9.]/.test(expr[i - 2] || "")) continue;
      return true;
    }
    depth += 0;
  }
  return false;
}
/* the first argument of every pow( in a source: [{ base, at }] */
function powBases(src) {
  const out = [];
  const re = /\bpow\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    let d = 1, i = m.index + m[0].length, start = i;
    while (i < src.length && d > 0) {
      const c = src[i];
      if (c === "(") d++; else if (c === ")") d--;
      else if (c === "," && d === 1) break;
      i++;
    }
    out.push({ base: src.slice(start, i).trim(), at: src.slice(Math.max(0, m.index - 20), Math.min(src.length, i + 24)).replace(/\s+/g, " ") });
  }
  return out;
}
const riskyPows = (src) => powBases(src).filter((p) => canBeNegative(p.base));

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
finish();
