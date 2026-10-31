/*
 * Test for #116's worker path (ADR-0002 section 6.12, cases W1-W3), written from the specification alone, before the
 * code. The memory of the speed test is the page's: the worker posts a new message, `verdict { fit, ms, skipped }`, from
 * its judgement, which the page stores and resolves journey.verdict() on; `hello` carries nothing remembered; a fallback
 * to the page hands verdict() to the page engine as it hands compiled(). The page side, through assets/door/index.js on
 * the stub page with a fake Worker (door-stub.mjs: bootWorkerPage, fakeWorkers), the clock virtual; the page engine
 * that a fallback makes has the fake world (fake-voyage.mjs). The worker's own side (draw-worker.js) is not exercised
 * here: its `verdict` message is the fake worker's to say.
 *
 *   node tools/ci/ready-ways-worker-test.mjs
 *
 *   W1  the worker answers a proving warm with `verdict { fit: true, ms: 12, skipped: false }` then `warmed`: the page
 *       stores the pass under the page's renderer key and verdict() resolves how "tested"; with skipped: true nothing
 *       is stored. Control: no `verdict` message, only `warmed`: verdict() pending, the store empty
 *   W2  a remembered pass on the page and the worker path: the gate (warm({ prove: false }) and verdict()) opens on the
 *       worker's `warmed` alone, how "remembered"; `hello` carries no verdict field
 *   W3  the worker falls back (no `up` within WORKER_WAIT, on the virtual clock): verdict() resolves from the page
 *       engine's judgement afterwards, and the store was read once in all, not a second time
 *
 * One fresh Node process a case.
 */
import { bootWorkerPage, childMain, chk, finish } from "./door-stub.mjs";
import { installStore, keyOf, track, brief, runFaked, DAY, NOW, GPU_NAME } from "./ready-ways-bed.mjs";

const here = import.meta.url;
const gateOf = (j) => Promise.all([j.warm({ prove: false }), j.verdict()]);
/* bootWorkerPage's window is 1280 x 800 at a pixel ratio of 1.5 */
const KEY = keyOf(GPU_NAME, 1280, 800, 1.5);
const pass = { t: NOW - 2 * DAY, fit: true, ms: 9 };

async function worker(o, store) {
  const b = await bootWorkerPage(o);
  globalThis.screen = { width: 1280, height: 800 };
  b.store = installStore(store);
  return b;
}

async function w1(verdict) {
  const b = await worker({ draw: "worker", auto: verdict ? { verdict } : {} });
  const j = b.journey;
  const gate = track(gateOf(j)), v = track(j.verdict());
  const proof = track(j.warm());
  await b.clock.advance(30000, () => proof.state !== "pending" && (!verdict || v.state !== "pending"));
  await b.clock.advance(1000);
  const w = b.host.first();
  return { worker: !!w, gate: gate.state, proof: proof.state, verdict: v.state, value: v.value ?? null, stored: b.store.fit(KEY) ?? null, keys: b.store.fitKeys(), writes: b.store.fitSets().length };
}

const CASES = {
  async w1() { return w1({ fit: true, ms: 12, skipped: false }); },
  async w1skipped() { return w1({ fit: true, ms: 0, skipped: true }); },
  async w1control() { return w1(null); },

  async w2() {
    const b = await worker({ draw: "worker" }, { seed: { [KEY]: pass } });
    const j = b.journey;
    const gate = track(gateOf(j)), v = track(j.verdict());
    await b.clock.advance(30000, () => gate.state !== "pending");
    await b.clock.advance(1000);
    const w = b.host.first();
    const hello = w ? w.of("hello")[0] : null;
    return { worker: !!w, hello: !!hello, helloKeys: hello ? Object.keys(hello) : [], gate: gate.state, value: v.value ?? null, proofs: w ? w.of("warm").filter((m) => m.prove !== false).length : -1 };
  },

  async w3() {
    const b = await worker({ auto: { up: null } });
    const j = b.journey;
    const gate = track(gateOf(j)), v = track(j.verdict());
    const proof = track(j.warm());
    await b.clock.advance(4000);
    const before = { gate: gate.state, verdict: v.state, worlds: (globalThis.__fakeWorlds || []).length };
    await b.clock.advance(3000);                             /* past WORKER_WAIT: the page engine takes over */
    const w = b.host.first();
    const fell = { terminated: w ? w.terminated : -1, worlds: (globalThis.__fakeWorlds || []).length };
    const world = (globalThis.__fakeWorlds || [])[0];
    if (!world) return { before, fell, none: "the page engine made no world after the fallback" };
    world.settle({ fit: true, ms: 15 });
    await b.clock.advance(2000);
    return { before, fell, gate: gate.state, proof: proof.state, verdict: v.state, value: v.value ?? null, stored: b.store.fit(KEY) ?? null, reads: b.store.fitGets().length };
  },
};

if (process.argv[2] === "--child") await childMain(CASES);

const seen = new Map();
const c = (how) => { if (!seen.has(how)) seen.set(how, runFaked(here, how)); return seen.get(how); };
const J = (v) => JSON.stringify(v);

chk("W1 the worker says verdict { fit: true, ms: 12 } then warmed: the page stores the pass under its renderer's key", c("w1"),
  (r) => [r.worker && r.stored && r.stored.fit === true && r.stored.ms === 12 && r.stored.t >= NOW && r.keys.length === 1, `stored ${J(r.stored)}, keys ${J(r.keys)}`]);
chk("W1 and verdict() resolves how \"tested\"", c("w1"), (r) => [r.verdict === "resolved" && r.value && r.value.fit === true && r.value.how === "tested" && r.value.ms === 12, `${r.verdict} ${J(r.value)}`]);
chk("W1 with skipped: true nothing is stored", c("w1skipped"), (r) => [r.writes === 0 && r.keys.length === 0 && r.verdict === "resolved", `writes ${r.writes}, keys ${J(r.keys)}, verdict ${r.verdict}`]);
chk("W1 control: no verdict message, only warmed: verdict() pending, the store empty", c("w1control"),
  (r) => [r.worker && r.proof === "resolved" && r.verdict === "pending" && r.writes === 0 && r.keys.length === 0, `proof ${r.proof}, verdict ${r.verdict}, writes ${r.writes}`]);

chk("W2 a remembered pass: the gate opens on warm({ prove: false })'s warmed alone, how \"remembered\"", c("w2"),
  (r) => [r.worker && r.gate === "resolved" && r.proofs === 0 && r.value && r.value.fit === true && r.value.how === "remembered", `gate ${r.gate}, proving warms ${r.proofs}, ${J(r.value)}`]);
chk("W2 hello carries no verdict field", c("w2"), (r) => [r.hello && !r.helloKeys.some((k) => /verdict|fit|remembered|ms/i.test(k)), `hello's fields: ${J(r.helloKeys)}`]);

chk("W3 the worker falls back: before WORKER_WAIT verdict() is pending", c("w3"), (r) => [r.before.gate === "pending" && r.before.verdict === "pending", J(r.before)]);
chk("W3 after it the page engine judges: verdict() resolves how \"tested\", and the pass is stored", c("w3"),
  (r) => [r.fell.terminated >= 1 && r.verdict === "resolved" && r.value && r.value.how === "tested" && r.value.fit === true && r.stored && r.stored.ms === 15, `fell ${J(r.fell)}, ${r.verdict} ${J(r.value)}, stored ${J(r.stored)}`]);
chk("W3 and the store was read once in all, not a second time by the page engine", c("w3"), (r) => [r.reads === 1, `fit-key reads ${r.reads}`]);

void brief;
finish();
