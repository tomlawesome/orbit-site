/*
 * Test for #116 ("no way in plays a cheaper version because its proper one is not ready yet"), ADR-0002 section 6,
 * cases R1-R11 and H1-H4, written from the specification alone, before the code. A way in opens when its proper version
 * is loaded AND the verdict on the world is in (journey.verdict(), 6.3): a remembered pass (6.4), this visit's test, the
 * gate's refusal, or the world's failure. A flight held for a world that does not come is let go at 30 s as a failure
 * (6.7), and a descent holds for it as a flight does (6.8).
 *
 * Reached through assets/door/index.js alone on the stub page (door-stub.mjs, ready-ways-bed.mjs), the clock virtual.
 * The flight's world is a fake (fake-voyage.mjs) the case settles with a verdict, a death, or never; "the gate opens" is
 * the promise `Promise.all([journey.warm({ prove: false }), journey.verdict()])` settling, as the site reads it. The
 * store is a recording map the case seeds. No case reads a clock and none passes on a timing: a wait is the virtual
 * clock moved on, and what is read is a state (a class, a call, a stored key, a console line).
 *
 *   node tools/ci/ready-ways-test.mjs
 *
 *   R1  no memory: the gate pends after warm({ prove: false }) alone, settles when the proof does; verdict() is
 *       { fit: true, how: "tested" }
 *   R2  a remembered pass: the gate settles with warm({ prove: false }), before any proof; verdict() how "remembered";
 *       the proof, asked as the host asks it, renews the store with the fresh ms
 *   R3  a remembered unfit: as R1 (the gate waits); a fit proof leaves a pass in the store
 *   R4  no memory, the proof unfit: the gate settles, { fit: false, how: "tested" }, the world retired, the next flight
 *       starts painted, the unfit stored
 *   R5  a remembered pass, the fresh proof unfit: the gate opened on the memory; the next flight starts painted; the
 *       unfit is stored. Control: the fresh proof fit, the flight starts with the world
 *   R6  the GPU gate refuses (software renderer): the gate settles with the Earth alone, how "refused", nothing stored.
 *       Control: gpu: "force" with fit: "skip": how "skipped", nothing stored
 *   R7  the world dies before any proof: how "failed", the gate opens, the next warm() makes a new world and verdict()
 *       is a new promise for it
 *   R8  the docs' way in: warmDocs({ prove: false }) and verdict() settle before warm({ prove: false }) does when the
 *       proof is in and the maps are not. Control: proof pending, not settled
 *   R10 save-data: no webgl2 context asked, no map fetched, no key read or written, the ways in open at once, the
 *       flight starts painted with no hold. Control: save-data off, the gate waits as R1
 *   R11 a first visit, the proof asked at once behind the load with the chore queue not yet open: none of the proof's
 *       chores runs until it opens, then they do (the real world, not the fake). Control: open already, they run
 *       (R9 is live: journey.mjs L5)
 *
 *   H1  fly(UP, { ready }) with ready and the proof never settling: holding from the start, the clock standing at the
 *       warp beat, still standing at 29 s, at 30 s the journey goes on painted, holding cleared, the world retired and
 *       "off: not ready in 30 s" said. Control: ready settles at 25 s with a fit proof, the world is drawn, no line
 *   H2  the next warm() after H1 makes a new world with its own verdict()
 *   H3  descend({ ready }) with ready pending: held before withdrawing, holding set; ready settles: the descent runs,
 *       holding cleared, the world drawn when fit. Control: no ready, no hold. Reduced motion: no hold. With `at`: no hold
 *   H4  a held descent and the world dies meanwhile: the hold lets go at once and the descent is painted
 *       (H5 is live: journey.mjs L6)
 *
 * One fresh Node process a case, the world a fake (fake-voyage.mjs), except R11 which runs the real world on the stub.
 */
import { childMain, chk, finish, runCase } from "./door-stub.mjs";
import { bootWays, keyOf, track, never, brief, runFaked, DAY, NOW, SOFT_NAME } from "./ready-ways-bed.mjs";

const here = import.meta.url;
const gateOf = (j) => Promise.all([j.warm({ prove: false }), j.verdict()]);
const pass = (days, ms = 12) => ({ t: NOW - days * DAY, fit: true, ms });
const unfit = (days, ms = 80) => ({ t: NOW - days * DAY, fit: false, ms });
const stored = (b) => b.store.fit(keyOf()) ?? null;
const hasClass = (b, name) => b.page.bodyClasses.has(name);
/* a class the body ever took (the climb's showwarp and the descent's withdrawing are passing: a later beat takes them off) */
const ever = (b, name) => b.page.bodyLog.some((e) => e.op === "add" && e.name === name);
const shown = (v) => (v.state === "resolved" ? brief(v.value) : v.state);

/* the climb flown from the gate, to the beat where the canvas comes up (200 ms in) and a little past it: was the world used? */
async function flyUp(b) {
  const w = b.world(0), before = w ? w.resets : 0;
  b.journey.fly(b.door.UP);
  await b.clock.advance(2000);
  return { warped: ever(b, "showwarp"), withWorld: !!w && w.resets > before };
}

const CASES = {
  async r1() {
    const b = await bootWays({ holdPlain: true });
    const j = b.journey;
    const gate = track(gateOf(j)), plain = track(j.warm({ prove: false })), v = track(j.verdict());
    const proof = track(j.warm());
    await b.clock.advance(1000);
    const w = b.world(0);
    if (!w) return { none: "no world was made" };
    w.releasePlain();
    await b.clock.advance(8000);
    const between = { plain: plain.state, gate: gate.state, verdict: v.state };
    w.settle({ fit: true, ms: 12 });
    await b.clock.advance(1000);
    return { between, after: { gate: gate.state, proof: proof.state, verdict: v.state, value: v.value ?? null } };
  },

  async r2() {
    const b = await bootWays({ holdPlain: true, store: { seed: { [keyOf()]: pass(2, 9) } } });
    const j = b.journey;
    const gate = track(gateOf(j)), v = track(j.verdict());
    await b.clock.advance(1000);
    const w = b.world(0);
    if (!w) return { none: "no world was made" };
    w.releasePlain();
    await b.clock.advance(1000);
    const early = { gate: gate.state, verdict: v.state, value: v.value ?? null, proofs: w.proveCalls + w.docProveCalls, kept: stored(b) };
    const proof = track(j.warm());                                /* the host's proof, at leisure */
    await b.clock.advance(1000);
    w.settle({ fit: true, ms: 21 });
    await b.clock.advance(1000);
    return { early, proofAsked: w.proveCalls, proof: proof.state, final: stored(b), verdict: v.value ?? null };
  },

  async r3() {
    const b = await bootWays({ holdPlain: true, store: { seed: { [keyOf()]: unfit(1, 80) } } });
    const j = b.journey;
    const gate = track(gateOf(j)), v = track(j.verdict());
    const proof = track(j.warm());
    await b.clock.advance(1000);
    const w = b.world(0);
    if (!w) return { none: "no world was made" };
    w.releasePlain();
    await b.clock.advance(8000);
    const between = { gate: gate.state, verdict: v.state };
    w.settle({ fit: true, ms: 14 });
    await b.clock.advance(1000);
    return { between, after: { gate: gate.state, verdict: v.state, value: v.value ?? null, kept: stored(b), proof: proof.state } };
  },

  async r4() {
    const b = await bootWays({ holdPlain: true });
    const j = b.journey;
    const gate = track(gateOf(j)), v = track(j.verdict());
    j.warm();
    await b.clock.advance(1000);
    const w = b.world(0);
    if (!w) return { none: "no world was made" };
    w.releasePlain();
    w.settle({ fit: false, ms: 80 });
    await b.clock.advance(1000);
    const out = { gate: gate.state, value: v.value ?? null, kept: stored(b), retired: w.dead };
    return { ...out, flight: await flyUp(b) };
  },

  async r5() { return afterMemory({ fit: false, ms: 80 }); },
  async r5control() { return afterMemory({ fit: true, ms: 21 }); },

  async r6() {
    const b = await bootWays({ renderer: SOFT_NAME });
    const j = b.journey;
    const gate = track(gateOf(j)), v = track(j.verdict());
    j.warm();
    await b.clock.advance(3000);
    return { gate: gate.state, verdict: v.value ?? null, writes: b.store.sets.length, keys: b.store.fitKeys(), reads: b.store.fitGets().length, worlds: b.worlds().length };
  },
  async r6skip() {
    const b = await bootWays({ renderer: SOFT_NAME, flags: { gpu: "force", fit: "skip" } });
    const j = b.journey;
    const gate = track(gateOf(j)), v = track(j.verdict());
    j.warm();
    await b.clock.advance(1000);
    const w = b.world(0);
    if (!w) return { none: "no world was made under gpu: force" };
    w.settle({ fit: true, ms: 0, skipped: true });
    await b.clock.advance(1000);
    return { gate: gate.state, verdict: v.value ?? null, writes: b.store.sets.length, keys: b.store.fitKeys(), reads: b.store.fitGets().length };
  },

  async r7() {
    const b = await bootWays({ holdPlain: true });
    const j = b.journey;
    const gate = track(gateOf(j)), v1 = track(j.verdict());
    j.warm();
    await b.clock.advance(1000);
    const w1 = b.world(0);
    if (!w1) return { none: "no world was made" };
    w1.releasePlain();
    await b.clock.advance(1000);
    const before = { gate: gate.state, verdict: v1.state };
    w1.die();
    await b.clock.advance(1000);
    const first = { gate: gate.state, verdict: v1.state, value: v1.value ?? null };
    j.warm();
    const v2 = track(j.verdict());
    await b.clock.advance(1000);
    const made = b.worlds().length;
    const pending = v2.state;
    const w2 = b.world(1);
    if (w2) { w2.releasePlain(); w2.settle({ fit: true, ms: 15 }); }
    await b.clock.advance(1000);
    return { before, first, made, pending, second: { state: v2.state, value: v2.value ?? null }, stoppedFirst: w1.stopCalls };
  },

  async r8() {
    const b = await bootWays({ holdPlain: true });
    const j = b.journey;
    const docs = track(Promise.all([j.warmDocs({ prove: false }), j.verdict()]));
    const flight = track(gateOf(j));
    j.warmDocs();                                                 /* the docs' proof, asked at once */
    await b.clock.advance(8000);
    const w = b.world(0);
    if (!w) return { none: "no world was made" };
    const control = { docs: docs.state, flight: flight.state };
    w.settle({ fit: true, ms: 12 });
    await b.clock.advance(1000);
    const proofIn = { docs: docs.state, flight: flight.state };
    w.releasePlain();
    await b.clock.advance(1000);
    return { control, proofIn, last: { docs: docs.state, flight: flight.state } };
  },

  async r10() { return savedata(true); },
  async r10control() { return savedata(false); },

  async h1() { return climbHeld(null); },
  async h1control() { return climbHeld(25000); },

  async h2() {
    const b = await bootWays({});
    const j = b.journey;
    j.warm();
    await b.clock.advance(1000);
    const t0 = b.clock.now();
    j.fly(b.door.UP, { ready: never() });
    await b.clock.advance(31000);
    const first = { worlds: b.worlds().length, stops: b.world(0).stopCalls };
    j.warm();
    const v = track(j.verdict());
    await b.clock.advance(1000);
    const second = { worlds: b.worlds().length, verdict: v.state };
    const w2 = b.world(1);
    if (w2) { w2.settle({ fit: true, ms: 15 }); }
    await b.clock.advance(1000);
    return { t0, first, second, final: v.state, value: v.value ?? null, proved: w2 ? w2.proveCalls : -1 };
  },

  async h3() { return descent({}); },
  async h3control() { return descent({ noReady: true }); },
  async h3reduced() { return descent({ reduced: true }); },
  async h3pinned() { return descent({ at: 500 }); },
  async h4() { return descent({ die: true }); },
};

/* R10: the page has save-data, or not */
async function savedata(on) {
  const b = await bootWays({ saveData: on, holdPlain: true });
  const j = b.journey;
  const gate = track(gateOf(j)), v = track(j.verdict());
  const proof = track(j.warm());
  await b.clock.advance(3000);
  const early = { gate: gate.state, verdict: v.state, proof: proof.state };
  j.fly(b.door.UP, { ready: j.warm() });
  await b.clock.advance(2000);
  return { early, contexts: b.page.contexts, fetched: b.fetched.length, fitReads: b.store.fitGets().length, fitWrites: b.store.fitSets().length,
    warped: ever(b, "showwarp"), holding: hasClass(b, "holding"), resets: b.worlds().reduce((n, w) => n + w.resets, 0) };
}

/* H1: the climb held for a ready that never comes (or, with settleAt, for the proof, which then settles fit at that many ms) */
async function climbHeld(settleAt) {
  const b = await bootWays({});
  const j = b.journey;
  const proofP = j.warm(), proof = track(proofP);
  await b.clock.advance(1000);
  const w = b.world(0);
  if (!w) return { none: "no world was made" };
  const t0 = b.clock.now();
  const at = (ms) => b.clock.advance(Math.max(0, t0 + ms - b.clock.now()));
  j.fly(b.door.UP, { ready: settleAt ? proofP : never() });
  const snap = () => ({ holding: hasClass(b, "holding"), warped: ever(b, "showwarp"), resets: w.resets, stops: w.stopCalls });
  await at(1000);
  const early = snap();
  if (settleAt) { await at(settleAt); w.settle({ fit: true, ms: 12 }); }
  await at(29000);
  const late = snap();
  await at(31000);
  const gone = snap();
  return { early, late, gone, notReady: b.said(/flight world: off: not ready in 30 s/).length, proof: proof.state };
}

/* R5: a remembered pass, the fresh proof as given; the climb flown after the proof */
async function afterMemory(fresh) {
  const b = await bootWays({ holdPlain: true, store: { seed: { [keyOf()]: pass(2, 9) } } });
  const j = b.journey;
  const gate = track(gateOf(j)), v = track(j.verdict());
  await b.clock.advance(1000);
  const w = b.world(0);
  if (!w) return { none: "no world was made" };
  w.releasePlain();
  await b.clock.advance(1000);
  const opened = { gate: gate.state, verdict: v.state, proofs: w.proveCalls + w.docProveCalls };
  const proof = track(j.warm());
  await b.clock.advance(1000);
  w.settle(fresh);
  await b.clock.advance(1000);
  return { opened, proof: proof.state, kept: stored(b), flight: await flyUp(b), verdictValue: v.value ?? null };
}

/* a descent from the landing, with the world made and its proof pending */
async function descent({ noReady = false, reduced = false, at, die = false }) {
  const b = await bootWays({ reduced });
  const j = b.journey;
  const proof = j.warm();
  await b.clock.advance(1000);
  const w = b.world(0);
  if (!w) return { none: "no world was made" };
  const t0 = b.clock.now();
  const at_ = (ms) => b.clock.advance(Math.max(0, t0 + ms - b.clock.now()));
  const snap = () => ({ holding: hasClass(b, "holding"), everHolding: ever(b, "holding"), withdrawing: ever(b, "withdrawing"), warped: ever(b, "showwarp"), dusk: ever(b, "showdusk") });
  j.descend({ ...(noReady ? {} : { ready: proof }), ...(typeof at === "number" ? { at } : {}) });
  await at_(100);
  const start = snap();
  if (noReady || reduced || typeof at === "number") { await at_(1500); return { start, later: snap(), resets: w.resets }; }
  await at_(5000);
  const held = snap();
  const t1 = b.clock.now();
  if (die) w.die(); else w.settle({ fit: true, ms: 12 });
  await b.clock.advance(100);
  const soon = snap();
  await b.clock.advance(1500);
  return { start, held, soon, later: snap(), resets: w.resets, waited: b.clock.now() - t1 };
}

/* R11: the real world on the stub; the proof asked at once, the queue closed or already open */
CASES.r11 = async () => r11(false);
CASES.r11control = async () => r11(true);
async function r11(open) {
  const b = await bootWays({ open });
  const { choresNow } = await import("../../assets/door/chores.js");
  const j = b.journey;
  j.warmDocs({ prove: false }); j.warm({ prove: false });         /* the speculative asks, then the proof, at once */
  const docs = track(j.warmDocs()), flight = track(j.warm());
  await b.clock.advance(60000);
  const snap = () => ({ open: choresNow().open, draws: b.page.draws, reads: b.page.readPixels, verdicts: b.verdictLines().length, docs: docs.state, flight: flight.state });
  const closed = snap();
  b.door.openChores();
  await b.clock.advance(60000);
  return { closed, opened: snap() };
}

if (process.argv[2] === "--child") await childMain(CASES);

const seen = new Map();
const c = (how, real = false) => { if (!seen.has(how)) seen.set(how, real ? runCase(here, how) : runFaked(here, how)); return seen.get(how); };

const J = (v) => JSON.stringify(v);
const asked = (r) => (r.none ? r.none : null);

/* R1 */
chk("R1 no memory: the gate pends after warm({ prove: false }) alone (which has settled), the verdict with it", c("r1"),
  (r) => [r.between.plain === "resolved" && r.between.gate === "pending" && r.between.verdict === "pending", J(r.between)]);
chk("R1 and settles when the proof does: verdict() is { fit: true, how: \"tested\" }", c("r1"),
  (r) => [r.after.gate === "resolved" && r.after.verdict === "resolved" && r.after.value && r.after.value.fit === true && r.after.value.how === "tested" && r.after.value.ms === 12, J(r.after)]);

/* R2 */
chk("R2 a remembered pass: the gate settles with warm({ prove: false }), before any proof; how \"remembered\"", c("r2"),
  (r) => [r.early.gate === "resolved" && r.early.proofs === 0 && r.early.value && r.early.value.fit === true && r.early.value.how === "remembered", J(r.early)]);
chk("R2 the proof, asked after, renews the store with the fresh ms", c("r2"),
  (r) => [r.proofAsked === 1 && r.final && r.final.fit === true && r.final.ms === 21 && r.final.t >= NOW, `asked ${r.proofAsked}, store ${J(r.final)}`]);
chk("R2 and the verdict already given stays \"remembered\"", c("r2"), (r) => [r.verdict && r.verdict.how === "remembered", J(r.verdict)]);

/* R3 */
chk("R3 a remembered unfit: the gate waits for the proof (as R1), and verdict() does not resolve on it", c("r3"),
  (r) => [r.between.gate === "pending" && r.between.verdict === "pending", J(r.between)]);
chk("R3 a fit proof opens it, how \"tested\", and leaves a pass in the store", c("r3"),
  (r) => [r.after.gate === "resolved" && r.after.value && r.after.value.how === "tested" && r.after.value.fit === true && r.after.kept && r.after.kept.fit === true && r.after.kept.ms === 14, J(r.after)]);

/* R4 */
chk("R4 no memory, the proof unfit: the gate settles (an unfit is an answer), { fit: false, how: \"tested\" }", c("r4"),
  (r) => [r.gate === "resolved" && r.value && r.value.fit === false && r.value.how === "tested", `gate ${r.gate}, verdict ${J(r.value)}`]);
chk("R4 the world is retired: the climb reaches its warp and starts painted", c("r4"),
  (r) => [r.flight.warped && !r.flight.withWorld, J(r.flight)]);
chk("R4 and the unfit is in the store", c("r4"), (r) => [r.kept && r.kept.fit === false && r.kept.ms === 80, J(r.kept)]);

/* R5 */
chk("R5 a remembered pass: the gate opened on the memory, before the fresh proof", c("r5"),
  (r) => [r.opened.gate === "resolved" && r.opened.proofs === 0 && r.verdictValue && r.verdictValue.how === "remembered", J(r.opened)]);
chk("R5 the fresh proof unfit: the climb starts painted, and the store now holds the unfit", c("r5"),
  (r) => [r.flight.warped && !r.flight.withWorld && r.kept && r.kept.fit === false && r.kept.ms === 80, `flight ${J(r.flight)}, store ${J(r.kept)}`]);
chk("R5 control: the fresh proof fit, the climb starts with the world and the store holds the fresh figures", c("r5control"),
  (r) => [r.flight.warped && r.flight.withWorld && r.kept && r.kept.fit === true && r.kept.ms === 21, `flight ${J(r.flight)}, store ${J(r.kept)}`]);

/* R6 */
chk("R6 the GPU gate refuses: the gate settles at once, how \"refused\", nothing stored", c("r6"),
  (r) => [r.gate === "resolved" && r.verdict && r.verdict.fit === false && r.verdict.how === "refused" && r.writes === 0 && r.keys.length === 0 && r.reads === 0, J(r)]);
chk("R6 control: gpu: \"force\" with fit: \"skip\": how \"skipped\", nothing stored (nor read)", c("r6skip"),
  (r) => [r.gate === "resolved" && r.verdict && r.verdict.fit === true && r.verdict.how === "skipped" && r.writes === 0 && r.keys.length === 0 && r.reads === 0, J(r)]);

/* R7 */
chk("R7 the world dies before any proof: the gate was pending, then opens with how \"failed\"", c("r7"),
  (r) => [r.before.gate === "pending" && r.first.gate === "resolved" && r.first.value && r.first.value.how === "failed", `before ${J(r.before)}, after ${J(r.first)}`]);
chk("R7 the next warm() asks a new world, and verdict() is a new promise for it", c("r7"),
  (r) => [r.made === 2 && r.pending === "pending" && r.second.state === "resolved" && r.second.value && r.second.value.how === "tested" && r.second.value.fit === true,
    `worlds ${r.made}, new verdict first ${r.pending}, then ${J(r.second)}`]);

/* R8 */
chk("R8 the docs' way in, the proof pending: not settled (control)", c("r8"), (r) => [r.control.docs === "pending" && r.control.flight === "pending", J(r.control)]);
chk("R8 the proof in and the maps not: the docs' way in settles, the flight's gate does not", c("r8"),
  (r) => [r.proofIn.docs === "resolved" && r.proofIn.flight === "pending", J(r.proofIn)]);
chk("R8 the maps in: the flight's gate settles after it", c("r8"), (r) => [r.last.docs === "resolved" && r.last.flight === "resolved", J(r.last)]);

/* R10 */
chk("R10 save-data: no webgl2 context asked, no map fetched, no fit key read or written", c("r10"),
  (r) => [r.contexts === 0 && r.fetched === 0 && r.fitReads === 0 && r.fitWrites === 0, J({ contexts: r.contexts, fetched: r.fetched, reads: r.fitReads, writes: r.fitWrites })]);
chk("R10 save-data: the ways in open at once (the gate settles though the world's plain ask is held)", c("r10"),
  (r) => [r.early.gate === "resolved" && r.early.verdict === "resolved", J(r.early)]);
chk("R10 save-data: the climb starts painted with no hold", c("r10"), (r) => [r.warped && !r.holding && r.resets === 0, J({ warped: r.warped, holding: r.holding, resets: r.resets })]);
chk("R10 control: save-data off, the gate waits as R1", c("r10control"),
  (r) => [r.early.gate === "pending" && r.contexts > 0 && r.fetched > 0, J({ early: r.early, contexts: r.contexts, fetched: r.fetched })]);

/* R11 */
chk("R11 first visit, queue closed: none of the proof's chores runs (no frame drawn, no pixel read, no verdict, nothing settled)", c("r11", true),
  (r) => [!r.closed.open && r.closed.draws === 0 && r.closed.reads === 0 && r.closed.verdicts === 0 && r.closed.docs === "pending" && r.closed.flight === "pending", J(r.closed)]);
chk("R11 and once it opens they run: the world is drawn, judged, and both proofs settle", c("r11", true),
  (r) => [r.opened.open && r.opened.draws > 0 && r.opened.verdicts >= 1 && r.opened.docs === "resolved" && r.opened.flight === "resolved", J(r.opened)]);
chk("R11 control: the queue open already, the proof's chores run at once", c("r11control", true),
  (r) => [r.closed.open && r.closed.draws > 0 && r.closed.verdicts >= 1 && r.closed.docs === "resolved" && r.closed.flight === "resolved", J(r.closed)]);

/* H1 */
chk("H1 ready and the proof never settling: holding from the start, the clock standing at the warp beat", c("h1"),
  (r) => [r.early.holding && !r.early.warped, J(r.early)]);
chk("H1 still standing at 29 s", c("h1"), (r) => [r.late.holding && !r.late.warped && r.late.stops === 0, J(r.late)]);
chk("H1 at 30 s the journey goes on painted, holding cleared, the world retired, \"off: not ready in 30 s\" said once", c("h1"),
  (r) => [r.gone.warped && !r.gone.holding && r.gone.resets === 0 && r.gone.stops >= 1 && r.notReady === 1 && r.proof !== "rejected", `${J(r.gone)}, said ${r.notReady}, proof ${r.proof}`]);
chk("H1 control: ready settles at 25 s with a fit proof: the world is drawn, no line, no abandon", c("h1control"),
  (r) => [r.late.warped && !r.late.holding && r.late.resets >= 1 && r.late.stops === 0 && r.gone.stops === 0 && r.notReady === 0, `${J(r.late)}, ${J(r.gone)}, said ${r.notReady}`]);

/* H2 */
chk("H2 after H1 the next warm() makes a new world with its own verdict()", c("h2"),
  (r) => [r.first.worlds === 1 && r.first.stops >= 1 && r.second.worlds === 2 && r.second.verdict === "pending" && r.final === "resolved" && r.value && r.value.how === "tested" && r.value.fit === true && r.proved === 1,
    `after H1 ${J(r.first)}, after warm ${J(r.second)}, then ${r.final} ${J(r.value)}, proved ${r.proved}`]);

/* H3 */
chk("H3 descend({ ready }) pending: held before withdrawing (the landing as it was), holding set, for as long as it is pending", c("h3"),
  (r) => [r.start.holding && !r.start.withdrawing && r.held.holding && !r.held.withdrawing && !r.held.warped, `${J(r.start)}, ${J(r.held)}`]);
chk("H3 ready settles: the descent runs, holding cleared, the world drawn when fit", c("h3"),
  (r) => [r.soon.withdrawing && !r.soon.holding && r.later.warped && r.resets >= 1, `${J(r.soon)}, ${J(r.later)}, resets ${r.resets}`]);
chk("H3 control: no ready, no hold, the descent as today (painted: the world is not proved)", c("h3control"),
  (r) => [!r.start.everHolding && r.start.withdrawing && r.later.warped && r.resets === 0, `${J(r.start)}, ${J(r.later)}, resets ${r.resets}`]);
chk("H3 reduced motion with ready pending: no hold, the descent ran", c("h3reduced"), (r) => [!r.start.everHolding && r.start.dusk, J(r.start)]);
chk("H3 with `at` set and ready pending: no hold, pinned at once", c("h3pinned"), (r) => [!r.start.everHolding && r.start.withdrawing, J(r.start)]);

/* H4 */
chk("H4 a held descent and the world dies: the hold lets go at once, the descent runs painted", c("h4"),
  (r) => [r.held.holding && !r.held.withdrawing && r.soon.withdrawing && !r.soon.holding && r.later.warped && r.resets === 0, `${J(r.held)}, ${J(r.soon)}, ${J(r.later)}, resets ${r.resets}`]);

void asked;
finish();
