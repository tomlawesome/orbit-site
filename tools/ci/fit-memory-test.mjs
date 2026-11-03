/*
 * Test for #116's memory of the speed test (ADR-0002 section 6.4, cases M1-M7), written from the specification alone,
 * before the code. The verdict on the flight's world is kept on the device for a week under one key,
 * `orbit-fit <renderer> <width>x<height>@<pixel ratio>`, value `{ t, fit, ms }`, as capability.js keeps the probe's.
 * Reached through assets/door/index.js (`rememberedFit`) and fitness.js (`rememberFit`) on the stub page
 * (door-stub.mjs, ready-ways-bed.mjs), the clock virtual, the page's localStorage a recording map the case seeds.
 *
 *   node tools/ci/fit-memory-test.mjs
 *
 *   M1  store empty: rememberedFit() is null (control for M2-M5)
 *   M2  a pass 3 days old under the key: returned, and the console says `remembered on (frame N ms, 3 d ago)` once,
 *       not twice on a second call
 *   M3  8 days old: null; one hour in the future: null; nothing said either time. Control: 6 days old, returned
 *   M4  the same pass under another renderer, another screen size, another devicePixelRatio: null each
 *   M5  a stored unfit 1 day old: returned as { fit: false }, said as `remembered off (frame N ms), tested again`
 *       (that verdict() does not resolve on it is ready-ways-test.mjs R3)
 *   M6  rememberFit({ fit, ms, skipped: false }) writes { t, fit, ms } under the key, pass and unfit alike; with
 *       skipped: true nothing is written; under fit: "skip" nothing is read or written though the store holds a pass.
 *       Control: gpu: "force" alone writes, and the entry is read as unforced
 *   M7  a localStorage that throws on get and on set: rememberedFit() is null, rememberFit does not throw, and the
 *       proof is unaffected (the verdict is still in)
 *
 * Behaviour only: every time is the virtual clock's, and the age of an entry is the clock's date. One fresh Node
 * process a case, the flight's world a fake (fake-voyage.mjs).
 */
import { childMain, chk, finish } from "./door-stub.mjs";
import { bootWays, keyOf, track, brief, exported, runFaked, DAY, NOW } from "./ready-ways-bed.mjs";

const here = import.meta.url;
const FITNESS = "../../assets/door/fitness.js";
const lines = (b, re) => b.page.lines.filter((l) => re.test(l));
const REMEMBERED = /flight world: remembered/;

async function memory(o) {
  const b = await bootWays(o);
  const rememberedFit = exported(b.door, "rememberedFit", "assets/door/index.js");
  const first = rememberedFit();
  const second = rememberedFit();
  return { first, second, said: lines(b, REMEMBERED) };
}
const pass = (days, ms = 12) => ({ t: NOW - days * DAY, fit: true, ms });

const CASES = {
  async m1() { return memory({}); },
  async m2() { return memory({ store: { seed: { [keyOf()]: pass(3) } } }); },
  async m3old() { return memory({ store: { seed: { [keyOf()]: pass(8) } } }); },
  async m3future() { return memory({ store: { seed: { [keyOf()]: { t: NOW + 3600e3, fit: true, ms: 12 } } } }); },
  async m3six() { return memory({ store: { seed: { [keyOf()]: pass(6) } } }); },
  async m4renderer() { return memory({ renderer: "ANGLE (AMD, AMD Radeon RX 7800 XT Direct3D11 vs_5_0 ps_5_0)", store: { seed: { [keyOf()]: pass(1) } } }); },
  async m4size() { return memory({ size: [1920, 1080, 1], store: { seed: { [keyOf()]: pass(1) } } }); },
  async m4ratio() { return memory({ size: [1280, 800, 2], store: { seed: { [keyOf()]: pass(1) } } }); },
  async m5() { return memory({ store: { seed: { [keyOf()]: { t: NOW - 1 * DAY, fit: false, ms: 80 } } } }); },

  async m6written() {
    const b = await bootWays({});
    const { rememberFit } = await import(FITNESS);
    exported({ rememberFit }, "rememberFit", "assets/door/fitness.js");
    rememberFit({ fit: true, ms: 12, skipped: false });
    const afterPass = { ...b.store.fit(keyOf()) };
    rememberFit({ fit: false, ms: 80, skipped: false });
    const afterUnfit = { ...b.store.fit(keyOf()) };
    return { afterPass, afterUnfit, keys: b.store.fitKeys(), sets: b.store.fitSets().length };
  },
  async m6skipped() {
    const b = await bootWays({});
    const { rememberFit } = await import(FITNESS);
    exported({ rememberFit }, "rememberFit", "assets/door/fitness.js");
    rememberFit({ fit: true, ms: 0, skipped: true });
    return { sets: b.store.sets.length, keys: b.store.fitKeys() };
  },
  async m6flag() {
    const seeded = pass(1);
    const b = await bootWays({ flags: { fit: "skip" }, store: { seed: { [keyOf()]: seeded } } });
    const rememberedFit = exported(b.door, "rememberedFit", "assets/door/index.js");
    const { rememberFit } = await import(FITNESS);
    exported({ rememberFit }, "rememberFit", "assets/door/fitness.js");
    const read = rememberedFit();
    rememberFit({ fit: true, ms: 12, skipped: false });
    return { read, sets: b.store.sets.length, fitGets: b.store.fitGets().length, kept: b.store.fit(keyOf()) };
  },
  async m6force() {
    const b = await bootWays({ flags: { gpu: "force" } });
    const { rememberFit } = await import(FITNESS);
    exported({ rememberFit }, "rememberFit", "assets/door/fitness.js");
    const rememberedFit = exported(b.door, "rememberedFit", "assets/door/index.js");
    rememberFit({ fit: true, ms: 12, skipped: false });
    const written = b.store.fit(keyOf()) ?? null;
    b.door.createDoor({ typingWait: 0, flags: {} });          /* the same page, the flag taken off: the entry is read as unforced */
    return { written, read: rememberedFit() };
  },

  async m7() {
    const b = await bootWays({ store: { throws: { get: true, set: true } } });
    const rememberedFit = exported(b.door, "rememberedFit", "assets/door/index.js");
    const { rememberFit } = await import(FITNESS);
    exported({ rememberFit }, "rememberFit", "assets/door/fitness.js");
    const out = { read: rememberedFit(), wrote: "no throw" };
    try { rememberFit({ fit: true, ms: 12, skipped: false }); } catch (e) { out.wrote = `threw: ${e.message}`; }
    /* the proof, asked as a host asks it, is unaffected: the verdict is in */
    const j = b.journey;
    const gate = track(Promise.all([j.warm({ prove: false }), j.verdict()]));
    const proof = track(j.warm());
    await b.clock.advance(1000);
    b.world(0).settle({ fit: true, ms: 12 });
    await b.clock.advance(1000);
    const verdict = track(j.verdict());
    await b.clock.advance(10);
    out.gate = gate.state; out.proof = proof.state; out.verdict = verdict.state === "resolved" ? brief(verdict.value) : null;
    return out;
  },
};

if (process.argv[2] === "--child") await childMain(CASES);

const seen = new Map();
const c = (how) => { if (!seen.has(how)) seen.set(how, runFaked(here, how)); return seen.get(how); };

chk("M1 store empty: rememberedFit() is null", c("m1"), (r) => [r.first === null && r.second === null && r.said.length === 0, `first ${JSON.stringify(r.first)}, second ${JSON.stringify(r.second)}, said ${JSON.stringify(r.said)}`]);

chk("M2 a pass 3 days old under the key: returned", c("m2"), (r) => [r.first && r.first.fit === true && r.first.ms === 12 && r.first.t === NOW - 3 * DAY, `got ${JSON.stringify(r.first)}`]);
chk("M2 and said once, as `remembered on (frame 12 ms, 3 d ago)`, not twice on a second call", c("m2"), (r) => [r.said.length === 1 && /flight world: remembered on \(frame 12 ms, 3 d ago\)/.test(r.said[0]), `lines ${JSON.stringify(r.said)}`]);

chk("M3 8 days old: null, and nothing said", c("m3old"), (r) => [r.first === null && r.said.length === 0, `got ${JSON.stringify(r.first)}, said ${JSON.stringify(r.said)}`]);
chk("M3 an hour in the future (clock skew): null, and nothing said", c("m3future"), (r) => [r.first === null && r.said.length === 0, `got ${JSON.stringify(r.first)}, said ${JSON.stringify(r.said)}`]);
chk("M3 control: 6 days old is returned", c("m3six"), (r) => [r.first && r.first.fit === true && r.first.t === NOW - 6 * DAY, `got ${JSON.stringify(r.first)}`]);

chk("M4 the same pass under another renderer: null", c("m4renderer"), (r) => [r.first === null, `got ${JSON.stringify(r.first)}`]);
chk("M4 the same pass under another screen size: null", c("m4size"), (r) => [r.first === null, `got ${JSON.stringify(r.first)}`]);
chk("M4 the same pass under another devicePixelRatio: null", c("m4ratio"), (r) => [r.first === null, `got ${JSON.stringify(r.first)}`]);

chk("M5 a stored unfit 1 day old: returned as { fit: false }", c("m5"), (r) => [r.first && r.first.fit === false, `got ${JSON.stringify(r.first)}`]);
chk("M5 and said as `remembered off (frame 80 ms), tested again`", c("m5"), (r) => [r.said.length === 1 && /flight world: remembered off \(frame 80 ms\), tested again/.test(r.said[0]), `lines ${JSON.stringify(r.said)}`]);

chk("M6 rememberFit writes { t, fit, ms } under the key, a pass and then an unfit", c("m6written"), (r) => {
  const shape = (v) => Object.keys(v).sort().join(",") === "fit,ms,t";
  return [r.keys.length === 1 && r.keys[0] === keyOf() && shape(r.afterPass) && r.afterPass.fit === true && r.afterPass.ms === 12 && r.afterPass.t === NOW
    && shape(r.afterUnfit) && r.afterUnfit.fit === false && r.afterUnfit.ms === 80, `pass ${JSON.stringify(r.afterPass)}, unfit ${JSON.stringify(r.afterUnfit)}, keys ${JSON.stringify(r.keys)}`];
});
chk("M6 skipped: true writes nothing", c("m6skipped"), (r) => [r.sets === 0 && r.keys.length === 0, `writes ${r.sets}, keys ${JSON.stringify(r.keys)}`]);
chk("M6 under fit: \"skip\" the store holding a pass is not read (null) and nothing is written", c("m6flag"), (r) => [r.read === null && r.sets === 0 && r.fitGets === 0 && r.kept && r.kept.ms === 12, `read ${JSON.stringify(r.read)}, writes ${r.sets}, fit-key reads ${r.fitGets}, kept ${JSON.stringify(r.kept)}`]);
chk("M6 control: gpu: \"force\" alone writes, and the entry is read as unforced", c("m6force"), (r) => [r.written && r.written.fit === true && r.read && r.read.fit === true && r.read.ms === 12, `written ${JSON.stringify(r.written)}, read ${JSON.stringify(r.read)}`]);

chk("M7 a storage that throws: null read, no throw on write, the proof unaffected", c("m7"), (r) => [r.read === null && r.wrote === "no throw" && r.gate === "resolved" && r.proof === "resolved" && r.verdict && r.verdict.fit === true && r.verdict.how === "tested",
  `read ${JSON.stringify(r.read)}, write ${r.wrote}, gate ${r.gate}, proof ${r.proof}, verdict ${JSON.stringify(r.verdict)}`]);

finish();
