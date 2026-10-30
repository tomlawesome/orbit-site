/*
 * Tests for #101's first step (ADR-0004 section 6d.1), written from the specification alone: the docs' trip starts on
 * its own galaxy and is no longer held for the flight's pictures. The journey is reached through assets/door/index.js
 * alone, as a host does, on the stub page (door-stub.mjs) and its virtual clock.
 *
 *   node tools/ci/chores-docs-ready-test.mjs
 *
 * "Maps never arrive": the page's fetch keeps a promise for every request of one of the flight world's pictures and
 * settles it only when a case says; every other request is answered with a 1-byte blob.
 *
 *   A1  maps never arrive, warmDocs({ prove: false }) and warm({ prove: false }) both asked: within 5000 ms the first
 *       has resolved and the second is still pending (control: the second resolves by 25 000 ms, the bed makes a world)
 *   A2  the same bed, when warmDocs({ prove: false }) resolves: the star cloud is on the GPU, the line "docs galaxy:
 *       shaders compiled" is printed, and no map texture has been made
 *   A3  maps never arrive, warmDocs() proves the world: it resolves within 5000 ms with one "flight world: on", the
 *       fitness frames drawn with every map branch on (uHas is [1, 1, 1, 0]); the maps let land and warm() asked: it
 *       resolves and the verdict is still printed once
 *   A4  maps never arrive, fly(UP, { ready: warmDocs() }): `holding` from the call, lost within 1000 ms of the proof
 *       resolving and well before WORLD_WAIT; the world draws before any map is in; a map that lands mid-flight is
 *       used before the flight ends
 *   A5  maps arrive: warm({ prove: false }) resolves, "flight: ready" and "chores at flight ready" print once each,
 *       after every map texture is made; warmDocs({ prove: false }) resolved no later than warm({ prove: false })
 *
 * Every time is the virtual clock's; nothing reads the runner. Each case runs in a fresh Node process.
 */
import { INDEX, installPage, installClock, childMain, runCase, chk, finish, namedUniforms } from "./door-stub.mjs";

const WORLD_WAIT = 8000;
const BLOB = { ok: true, status: 200, blob: async () => ({ size: 1, type: "image/webp" }) };
/* the flight world's pictures: the five under flight/ and the three near ones under dawn/ (the Earth's own photo, dawn/dawn.webp, is a plain picture, not asked for with fetch) */
const isMap = (u) => /(?:^|\/)(?:flight\/[^/]+|dawn\/(?:lights|clouds|land)-near\.webp)$/.test(String(u).split("?")[0]);

/* the stub page whose fetch holds the maps while bed.hold is set */
function bed({ hold }) {
  const b = { hold, held: [], asked: [] };
  const fetch = (url) => {
    const u = String(url);
    b.asked.push(u);
    if (b.hold && isMap(u)) return new Promise((resolve) => { b.held.push(() => resolve(BLOB)); });
    return Promise.resolve(BLOB);
  };
  b.page = installPage({ fetch });
  b.clock = installClock();
  b.release = () => { b.hold = false; for (const go of b.held.splice(0)) go(); };
  return b;
}

async function mount(b) {
  const door = await import(INDEX);
  const d = door.createDoor({ typingWait: 0, flags: {} });
  door.openChores();
  return { door, journey: d.journey(b.page.journeyOptions()) };
}

/* a promise's outcome and the virtual time it came at */
function track(p, clock) {
  const t = { state: "pending", at: null };
  p.then(() => { t.state = "resolved"; t.at = clock.now(); }, () => { t.state = "rejected"; t.at = clock.now(); });
  return t;
}

async function a1() {
  const b = bed({ hold: true });
  const { journey } = await mount(b);
  const docs = track(journey.warmDocs({ prove: false }), b.clock);
  const flight = track(journey.warm({ prove: false }), b.clock);
  await b.clock.advance(5000, () => docs.state !== "pending");
  const out = { docs: docs.state, docsAt: docs.at };
  if (b.clock.now() < 5000) await b.clock.advance(5000 - b.clock.now());
  out.flightAt5000 = flight.state;
  await b.clock.advance(25000 - b.clock.now(), () => flight.state !== "pending");
  out.flightLate = flight.state; out.flightAt = flight.at;
  return out;
}

async function a2() {
  const b = bed({ hold: true });
  const { page } = b;
  /* a star-cloud-sized vertex upload, as star-cloud-test P3 reads it: many floats, 8 a star, some below 0 */
  const stars = [];
  const upload = page.glBase.bufferData;
  page.glBase.bufferData = (t, data) => {
    if (ArrayBuffer.isView(data) && data.length >= 30000 && data.length % 8 === 0 && data.some((v) => v < 0)) stars.push(data.length / 8);
    return upload(t, data);
  };
  const { journey } = await mount(b);
  let snap = null;
  journey.warmDocs({ prove: false }).then(() => {
    snap = { stars: stars.slice(), vertex: page.bufCalls.some((c) => c.vertex), galaxy: page.lines.filter((l) => /docs galaxy: shaders compiled/.test(l)).length, maps: page.mapTextures().size, at: b.clock.now() };
  }, () => {});
  await b.clock.advance(5000, () => snap !== null);
  return snap ? { ...snap } : { none: "warmDocs({ prove: false }) had not resolved by 5000 ms of virtual time" };
}

async function a3() {
  const b = bed({ hold: true });
  const { page, clock } = b;
  const log = namedUniforms(page);
  /* each uniform call is stamped with whether the galaxy line had been printed and how many map textures existed */
  for (const fn of ["uniform1f", "uniform1i", "uniform2f", "uniform2i", "uniform3f", "uniform4f", "uniform1fv", "uniform2fv", "uniform3fv", "uniform4fv", "uniform1iv"]) {
    const was = page.glBase[fn];
    page.glBase[fn] = (loc, ...a) => {
      const n = log.length;
      const r = was(loc, ...a);
      if (log.length > n) log[log.length - 1].ctx = { galaxy: page.lines.some((l) => /docs galaxy/.test(l)), maps: page.mapTextures().size };
      return r;
    };
  }
  const { journey } = await mount(b);
  let snap = null;
  journey.warmDocs().then(() => {
    snap = { at: clock.now(), world: page.lines.filter((l) => /flight world: on/.test(l)).length, off: page.lines.filter((l) => /flight world: off/.test(l)).length, upto: log.length };
  }, () => {});
  await clock.advance(5000, () => snap !== null);
  if (!snap) return { none: "warmDocs() (proving) had not resolved by 5000 ms of virtual time with the maps held" };
  const has = log.slice(0, snap.upto).filter((e) => e[1] === "uHas" && e.ctx && e.ctx.galaxy && e.ctx.maps === 0).map((e) => e.slice(2).flat());
  const out = { ...snap, early: has.length, earlyWrong: has.filter((v) => JSON.stringify(v) !== "[1,1,1,0]").slice(0, 3) };
  b.release();
  let later = "pending";
  journey.warm().then(() => { later = "resolved"; }, () => { later = "rejected"; });
  await clock.advance(40000, () => later !== "pending");
  await clock.advance(1000);
  out.later = later;
  out.worldLater = page.lines.filter((l) => /flight world: on/.test(l)).length;
  out.offLater = page.lines.filter((l) => /flight world: off/.test(l)).length;
  return out;
}

async function a4run() {
  const b = bed({ hold: true });
  const { page, clock } = b;
  const { door, journey } = await mount(b);
  const ready = journey.warmDocs();
  const proof = track(ready, clock);
  journey.fly(door.UP, { title: "Orbit", subtitle: "to somewhere", ready });
  const out = { holdingAtCall: page.bodyClasses.has("holding") };
  /* run on until `holding` is lost (at most WORLD_WAIT + 2 s), noting the draws just before the step it was lost in */
  let before = page.draws, lift = null;
  for (let t = 0; t < WORLD_WAIT + 2000 && lift === null; t += 50) {
    before = page.draws;
    await clock.advance(50);
    if (!page.bodyClasses.has("holding")) lift = clock.now();
  }
  out.proof = proof.state; out.proofAt = proof.at; out.liftAt = lift;
  /* the first removal after the first add (fly() clears every class before it sets its own) */
  const addAt = page.bodyLog.findIndex((e) => e.op === "add" && e.name === "holding");
  const removed = addAt < 0 ? undefined : page.bodyLog.slice(addAt).find((e) => e.op === "remove" && e.name === "holding");
  out.removedAt = removed ? removed.at : null;
  if (lift === null) { out.drawsFlight = page.draws; out.maps = page.mapTextures().size; return out; }
  await clock.advance(2800);
  out.drawsFlight = page.draws - before;
  out.mapsEarly = page.mapTextures().size;
  out.asked = b.held.length;
  if (b.held.length) b.held.shift()();
  await clock.advance(1500);
  out.mapsLate = page.mapTextures().size;
  out.flightOver = page.bodyClasses.has("instrument");
  journey.reset();
  return out;
}

async function a5() {
  const b = bed({ hold: false });
  const { page, clock } = b;
  const snaps = {};
  for (const k of ["info", "log"]) {
    const was = console[k];
    console[k] = (...a) => {
      was(...a);
      const s = a.join(" ");
      if (/chores at flight ready/.test(s)) snaps.chores = page.mapTextures().size;
      else if (/flight: ready/.test(s)) snaps.ready = page.mapTextures().size;
    };
  }
  const { journey } = await mount(b);
  const docs = track(journey.warmDocs({ prove: false }), clock);
  const flight = track(journey.warm({ prove: false }), clock);
  await clock.advance(30000, () => flight.state !== "pending" && docs.state !== "pending");
  await clock.advance(2000);
  return {
    docs: docs.state, docsAt: docs.at, flight: flight.state, flightAt: flight.at,
    ready: page.lines.filter((l) => /flight: ready/.test(l)).length, chores: page.lines.filter((l) => /chores at flight ready/.test(l)).length,
    mapsAtReady: snaps.ready ?? null, mapsAtChores: snaps.chores ?? null, maps: page.mapTextures().size, asked: b.asked.filter(isMap).length,
  };
}

const CASES = { a1, a2, a3, a4: a4run, a5 };

if (process.argv[2] === "--child") await childMain(CASES);

/* ----- the checks ----- */

{
  const r = runCase(import.meta.url, "a1", 120000);
  chk("A1 maps never arrive: warmDocs({ prove: false }) resolves within 5000 ms (today it is pending)", r, (r) => [r.docs === "resolved" && r.docsAt <= 5000, `warmDocs ${r.docs}${r.docsAt === null ? "" : ` at ${r.docsAt} ms`}`]);
  chk("A1 ... while warm({ prove: false }) is still pending at 5000 ms", r, (r) => [r.flightAt5000 === "pending", `warm ${r.flightAt5000} at 5000 ms`]);
  chk("A1 control: warm({ prove: false }) resolves by 25 000 ms (the pictures' wait has run out), so the bed makes a world", r, (r) => [r.flightLate === "resolved" && r.flightAt <= 25000, `warm ${r.flightLate}${r.flightAt === null ? "" : ` at ${r.flightAt} ms`}`]);
}
{
  const r = runCase(import.meta.url, "a2", 120000);
  chk("A2 when warmDocs({ prove: false }) resolves, the star cloud is on the GPU (a vertex upload of 8 floats a star)", r, (r) => [r.vertex && r.stars.length >= 1, `vertex uploads seen ${r.vertex}; star-cloud uploads (stars) ${JSON.stringify(r.stars)}`]);
  chk("A2 ... the line \"docs galaxy: shaders compiled\" has been printed", r, (r) => [r.galaxy >= 1, `${r.galaxy} line(s)`]);
  chk("A2 ... and no map texture has been made", r, (r) => [r.maps === 0, `${r.maps} map texture(s) at ${r.at} ms`]);
}
{
  const r = runCase(import.meta.url, "a3", 120000);
  chk("A3 maps never arrive: warmDocs() (proving) resolves within 5000 ms (today it is pending)", r, (r) => [r.at <= 5000, `resolved at ${r.at} ms`]);
  chk("A3 ... with exactly one \"flight world: on\" and no \"off\"", r, (r) => [r.world === 1 && r.off === 0, `${r.world} 'on', ${r.off} 'off'`]);
  chk("A3 control: uHas was set while the galaxy line was out and no map texture existed (the fitness frames were drawn)", r, (r) => [r.early >= 1, `${r.early} uHas call(s)`]);
  chk("A3 the fitness frames take every map branch: each of those uHas calls is [1, 1, 1, 0]", r, (r) => [r.early >= 1 && r.earlyWrong.length === 0, `${r.early} calls; other values ${JSON.stringify(r.earlyWrong)}`]);
  chk("A3 once the maps land, warm() resolves", r, (r) => [r.later === "resolved", `warm() ${r.later}`]);
  chk("A3 ... and \"flight world: on\" is still printed once (no second verdict), with no \"off\"", r, (r) => [r.worldLater === 1 && r.offLater === 0, `${r.worldLater} 'on', ${r.offLater} 'off'`]);
}
{
  const r = runCase(import.meta.url, "a4", 120000);
  chk("A4 fly(UP, { ready: warmDocs() }): `holding` is on from the call", r, (r) => [r.holdingAtCall === true, `holding at the call: ${r.holdingAtCall}`]);
  chk("A4 ... the proof resolves and `holding` is lost within 1000 ms of it, well before WORLD_WAIT (today it stays until WORLD_WAIT)", r, (r) => [r.proof === "resolved" && r.removedAt !== null && r.removedAt - r.proofAt <= 1000 && r.removedAt < WORLD_WAIT - 1000, `proof ${r.proof} at ${r.proofAt}; holding lost at ${r.removedAt} (WORLD_WAIT ${WORLD_WAIT})`]);
  chk("A4 the world draws before any map is in: draw calls by the flight's 3000 ms, no map texture", r, (r) => [r.drawsFlight > 0 && r.mapsEarly === 0, `${r.drawsFlight} draw call(s) since the hold lifted, ${r.mapsEarly} map texture(s)`]);
  chk("A4 a map that lands mid-flight is used before the flight ends", r, (r) => [r.asked >= 1 && r.mapsLate > 0 && !r.flightOver, `${r.asked} map request(s) held; ${r.mapsLate} map texture(s) after one landed; flight over: ${r.flightOver}`]);
}
{
  const r = runCase(import.meta.url, "a5", 120000);
  chk("A5 control: with the maps arriving, warm({ prove: false }) resolves and every map is asked for", r, (r) => [r.flight === "resolved" && r.asked >= 8, `warm ${r.flight}; ${r.asked} map request(s)`]);
  chk("A5 control: the maps are on the GPU (at least eight map textures)", r, (r) => [r.maps >= 8, `${r.maps} map textures`]);
  chk("A5 \"flight: ready\" and \"chores at flight ready\" are each printed once", r, (r) => [r.ready === 1 && r.chores === 1, `${r.ready} 'flight: ready', ${r.chores} 'chores at flight ready'`]);
  chk("A5 ... after every map texture exists (the count then is the final count)", r, (r) => [r.mapsAtReady === r.maps && r.mapsAtChores === r.maps, `maps at 'flight: ready' ${r.mapsAtReady}, at 'chores at flight ready' ${r.mapsAtChores}, at the end ${r.maps}`]);
  chk("A5 warmDocs({ prove: false }) resolved no later than warm({ prove: false })", r, (r) => [r.docs === "resolved" && r.docsAt <= r.flightAt, `warmDocs ${r.docs} at ${r.docsAt} ms, warm at ${r.flightAt} ms`]);
}
finish();
