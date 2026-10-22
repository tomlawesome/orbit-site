/*
 * Tests for the flight's nearby-star cloud on a portrait screen (#74, ADR-0004 section 5), written from the
 * specification alone (tests first).
 *
 *   P1  voyage.js galaxyStars(n, rest) is pure: two calls with the same arguments give identical arrays.
 *   P2  the cloud is made about the point it is given: with rest = PATH[3] at least 5% of the stars lie within 0.23 of
 *       it and under 1% within 0.23 of PATH_TALL[3]; with rest = PATH_TALL[3], the reverse. The two outputs differ
 *       only in the stars of that cloud: a star within 0.23 of neither point is the same in both.
 *   P3  through the engine: a world warmed on a 400x800 page uploads a star cloud about PATH_TALL[3]; on 1280x800,
 *       about PATH[3].
 *   P4  a world warmed landscape and then turned to portrait before a flight: a new star upload carries the portrait
 *       cloud before the flight's first frame and the old buffers are deleted; no remake happens from the flight's
 *       first frame to its end.
 *   (P5 is docs-sky-portrait-test.mjs, which already exists.)
 *
 *   node tools/ci/star-cloud-test.mjs
 *
 * No dependencies and no browser; each case runs in a fresh Node process (this file again, as `--child`) against the
 * stub page in door-stub.mjs, on a virtual clock. Behaviour only: nothing here depends on how fast anything runs.
 */
import { INDEX, installPage, installClock, childMain, runCase, check, finish, errOf } from "./door-stub.mjs";

const RADIUS = 0.23, STARS = 48000, BIG = 30000;

/* the star positions of whatever galaxyStars answers: a flat x, y, z list (the answer itself, or its `P`) */
const positionsOf = (out) => (ArrayBuffer.isView(out) || Array.isArray(out) ? out : out && out.P);
const dist = (p, i, pt) => Math.hypot(p[i] - pt[0], p[i + 1] - pt[1], p[i + 2] - pt[2]);
/* the share of the stars within RADIUS of a point */
function share(p, pt) {
  let n = 0;
  for (let i = 0; i + 2 < p.length; i += 3) if (dist(p, i, pt) <= RADIUS) n++;
  return n / (p.length / 3);
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/* the page's fake context, made to remember star-sized uploads, buffer and array deletions and draws, in order */
function watchGl(page) {
  const log = [];
  const g = page.glBase;
  let bound = null, n = 0;
  g.createBuffer = () => ({ buf: ++n });
  g.bindBuffer = (target, b) => { bound = b; };
  g.bufferData = (target, data) => {
    const star = ArrayBuffer.isView(data) && data.length >= BIG && data.length % 3 === 0 && data.some((v) => v < 0);
    log.push({ op: "upload", star, buffer: bound, pos: star ? Float32Array.from(data) : null });
  };
  g.deleteBuffer = (b) => { log.push({ op: "deleteBuffer", buffer: b }); };
  g.deleteVertexArray = () => { log.push({ op: "deleteVertexArray" }); };
  for (const fn of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) g[fn] = () => { log.push({ op: "draw" }); };
  return log;
}
const starUploads = (log) => log.filter((e) => e.op === "upload" && e.star);

async function setup(width, height) {
  const page = installPage();
  const clock = installClock();
  globalThis.innerWidth = width; globalThis.innerHeight = height;
  const log = watchGl(page);
  const door = await import(INDEX);
  const engine = await import("../../assets/door/engine.js");
  const d = door.createDoor({ typingWait: 0, flags: {} });
  const journey = d.journey(page.journeyOptions());
  door.openChores();
  return { page, clock, log, door, engine, journey };
}

const CASES = {
  async "pure"() {
    installPage();
    const { PATH_TALL } = await import("../../assets/door/engine.js");
    const { galaxyStars } = await import("../../assets/door/voyage.js");
    const a = positionsOf(galaxyStars(STARS, PATH_TALL[3])), b = positionsOf(galaxyStars(STARS, PATH_TALL[3]));
    const whole = JSON.stringify(galaxyStars(2000, PATH_TALL[3])) === JSON.stringify(galaxyStars(2000, PATH_TALL[3]));
    return { count: a.length, identical: same(Array.from(a), Array.from(b)), whole };
  },

  async "about-the-point"() {
    installPage();
    const { PATH, PATH_TALL } = await import("../../assets/door/engine.js");
    const { galaxyStars } = await import("../../assets/door/voyage.js");
    const wide = positionsOf(galaxyStars(STARS, PATH[3])), tall = positionsOf(galaxyStars(STARS, PATH_TALL[3]));
    let others = 0, changed = 0;
    for (let i = 0; i + 2 < wide.length; i += 3) {
      const far = (p) => dist(p, i, PATH[3]) > RADIUS && dist(p, i, PATH_TALL[3]) > RADIUS;
      if (far(wide) && far(tall)) {
        others++;
        if (wide[i] !== tall[i] || wide[i + 1] !== tall[i + 1] || wide[i + 2] !== tall[i + 2]) changed++;
      }
    }
    return {
      stride: wide.length / STARS, sameLength: wide.length === tall.length,
      wideNearWide: share(wide, PATH[3]), wideNearTall: share(wide, PATH_TALL[3]),
      tallNearTall: share(tall, PATH_TALL[3]), tallNearWide: share(tall, PATH[3]),
      others, changed,
    };
  },

  /* P3: a world warmed on a page of this size uploads its stars; where are they? */
  async "engine-tall"() { return engineCase(400, 800); },
  async "engine-wide"() { return engineCase(1280, 800); },

  /* P4: warmed and proved landscape, turned portrait, then a flight */
  async "turned"() {
    const { page, clock, log, door, engine, journey } = await setup(1280, 800);
    journey.warm({ prove: false }).catch(() => {});
    journey.warm().catch(() => {});
    await clock.advance(30000, () => page.lines.some((l) => /flight world: (on|off)/.test(l)));
    await clock.advance(2000);
    const verdict = page.lines.find((l) => /flight world: (on|off)/.test(l)) || null;
    const before = starUploads(log);
    const oldBuffers = new Set(log.filter((e) => e.op === "upload" && e.buffer && e.pos !== undefined && e.star).map((e) => e.buffer));
    const mark = log.length;
    page.resize(400, 800);                                       /* the screen turns before the next flight */
    journey.fly(door.UP, { title: "Orbit", subtitle: "to somewhere", ready: Promise.resolve() });
    await clock.advance(15000);
    const after = log.slice(mark);
    const firstDraw = after.findIndex((e) => e.op === "draw");
    const ups = after.map((e, i) => ({ e, i })).filter(({ e }) => e.op === "upload" && e.star);
    const portraitAt = ups.findIndex(({ e }) => share(e.pos, engine.PATH_TALL[3]) >= 0.05);
    const inFlight = firstDraw < 0 ? after : after.slice(firstDraw);
    return {
      verdict, starsBefore: before.length, oldBuffers: oldBuffers.size, draws: after.filter((e) => e.op === "draw").length,
      landscapeBefore: before.length ? share(before[before.length - 1].pos, engine.PATH[3]) : null,
      portraitUploads: ups.filter(({ e }) => share(e.pos, engine.PATH_TALL[3]) >= 0.05).length,
      portraitBeforeFirstFrame: portraitAt >= 0 && (firstDraw < 0 || ups[portraitAt].i < firstDraw),
      oldDeleted: [...oldBuffers].filter((b) => after.some((e) => e.op === "deleteBuffer" && e.buffer === b)).length,
      arraysDeleted: after.filter((e) => e.op === "deleteVertexArray").length,
      remakesInFlight: inFlight.filter((e) => (e.op === "upload" && e.star) || e.op === "deleteBuffer" || e.op === "deleteVertexArray").length,
    };
  },
};

async function engineCase(width, height) {
  const { page, clock, log, engine, journey } = await setup(width, height);
  journey.warm({ prove: false }).catch(() => {});
  await clock.advance(10000);
  await clock.advance(5000);
  const ups = starUploads(log);
  const last = ups.length ? ups[ups.length - 1].pos : null;
  return {
    uploads: ups.length, drawnOn: page.contexts,
    nearTall: last ? share(last, engine.PATH_TALL[3]) : null, nearWide: last ? share(last, engine.PATH[3]) : null,
  };
}

if (process.argv[2] === "--child") await childMain(CASES);

/* P1 */
{
  const r = runCase(import.meta.url, "pure");
  check("P1 (precondition): galaxyStars is exported and answers star positions", !r.error && r.count >= 3, `${r.count} number(s)${errOf(r)}`);
  check("P1: two calls with the same arguments give identical arrays", !r.error && r.identical === true && r.whole === true, `positions identical ${r.identical}, whole answer identical ${r.whole}${errOf(r)}`);
}
/* P2 */
{
  const r = runCase(import.meta.url, "about-the-point");
  const pc = (x) => `${(100 * x).toFixed(2)}%`;
  check("P2 (precondition): both calls answer the same number of stars, in threes", !r.error && r.sameLength === true && r.stride === 3, `stride ${r.stride}, same length ${r.sameLength}${errOf(r)}`);
  check("P2: with rest = PATH[3], at least 5% of the stars lie within 0.23 of it and under 1% within 0.23 of PATH_TALL[3]",
    !r.error && r.wideNearWide >= 0.05 && r.wideNearTall < 0.01, `near PATH[3] ${pc(r.wideNearWide)}, near PATH_TALL[3] ${pc(r.wideNearTall)}${errOf(r)}`);
  check("P2: with rest = PATH_TALL[3], at least 5% lie within 0.23 of it and under 1% within 0.23 of PATH[3]",
    !r.error && r.tallNearTall >= 0.05 && r.tallNearWide < 0.01, `near PATH_TALL[3] ${pc(r.tallNearTall)}, near PATH[3] ${pc(r.tallNearWide)}${errOf(r)}`);
  check("P2: the two outputs differ only in the stars of that cloud (every star within 0.23 of neither point is identical in both)",
    !r.error && r.others > 0 && r.changed === 0, `${r.changed} of ${r.others} far stars differ${errOf(r)}`);
}
/* P3 */
{
  const t = runCase(import.meta.url, "engine-tall"), w = runCase(import.meta.url, "engine-wide");
  const pc = (x) => (x === null || x === undefined ? "n/a" : `${(100 * x).toFixed(2)}%`);
  check("P3 (precondition): a warmed world uploads star positions, on a portrait page and on a landscape one", !t.error && !w.error && t.uploads >= 1 && w.uploads >= 1, `portrait ${t.uploads} upload(s), landscape ${w.uploads}${errOf(t)}${errOf(w)}`);
  check("P3: warmed on 1280x800, the star cloud is about PATH[3]", !w.error && w.nearWide >= 0.05 && w.nearTall < 0.01, `near PATH[3] ${pc(w.nearWide)}, near PATH_TALL[3] ${pc(w.nearTall)}${errOf(w)}`);
  check("P3: warmed on 400x800, the star cloud is about PATH_TALL[3]", !t.error && t.nearTall >= 0.05 && t.nearWide < 0.01, `near PATH_TALL[3] ${pc(t.nearTall)}, near PATH[3] ${pc(t.nearWide)}${errOf(t)}`);
}
/* P4 */
{
  const r = runCase(import.meta.url, "turned", 120000);
  check("P4 (precondition): the world was warmed and proved on the landscape page (a cloud about PATH[3] uploaded, the verdict `on`), and the flight drew",
    !r.error && /flight world: on/.test(r.verdict || "") && r.starsBefore >= 1 && r.landscapeBefore >= 0.05 && r.draws >= 1, `verdict ${JSON.stringify(r.verdict)}, ${r.starsBefore} star upload(s), landscape share ${r.landscapeBefore}, ${r.draws} draw(s) in the flight${errOf(r)}`);
  check("P4: a new star upload carries the portrait cloud, and before the flight's first frame",
    !r.error && r.portraitUploads >= 1 && r.portraitBeforeFirstFrame === true, `${r.portraitUploads} portrait upload(s); before the first frame ${r.portraitBeforeFirstFrame}${errOf(r)}`);
  check("P4: the old star buffers were deleted, and a vertex array given back",
    !r.error && r.oldBuffers >= 1 && r.oldDeleted === r.oldBuffers && r.arraysDeleted >= 1, `${r.oldDeleted} of ${r.oldBuffers} old star buffer(s) deleted; ${r.arraysDeleted} vertex array(s) deleted${errOf(r)}`);
  check("P4: nothing is remade from the flight's first frame to its end (no star upload, no buffer or array deleted)",
    !r.error && r.draws >= 1 && r.remakesInFlight === 0, `${r.remakesInFlight} remake event(s) after the first frame${errOf(r)}`);
}
finish();
