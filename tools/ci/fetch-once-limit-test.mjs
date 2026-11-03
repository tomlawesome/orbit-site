/*
 * Test for fetchOnce (assets/door/chores.js) having a time limit (#84, item 1), written from the specification alone:
 * a picture fetch that never answers must not hold its caller for ever. With a fetch that never resolves, the promise
 * fetchOnce gives rejects within the limit (about 20 s), and the address is forgotten, so the next fetchOnce of the
 * same address calls fetch again. Control: a fetch that answers still resolves, and is remembered (fetch ran once).
 *
 *   node tools/ci/fetch-once-limit-test.mjs
 *
 * No dependencies and no browser: fetch is stubbed. The wait runs on a virtual clock (door-stub.mjs installClock):
 * setTimeout and Date.now move only when the test moves them, so nothing depends on how fast the machine runs and the
 * run takes milliseconds. LIMIT_MS is the most the rejection may take on that clock.
 */
import { installClock, check, finish } from "./door-stub.mjs";

const LIMIT_MS = 25000;
const clock = installClock();
const calls = {};
globalThis.fetch = (u) => {
  calls[u] = (calls[u] || 0) + 1;
  if (/never/.test(u)) return new Promise(() => {});
  return Promise.resolve({ ok: true, blob: async () => "b" });
};

const { fetchOnce } = await import("../../assets/door/chores.js");

/* control: a normal fetch resolves, and the answer is remembered */
const good = "/assets/fetch-once-limit-test/good.bin";
const g1 = await fetchOnce(good);
const g2 = fetchOnce(good);
check("control: a fetch that answers resolves", g1 === "b", `gave ${JSON.stringify(g1)} (want "b")`);
check("control: the second ask for it is the remembered one (fetch ran once)", calls[good] === 1 && (await g2) === "b", `${calls[good]} fetch call(s) (want 1)`);

/* a fetch that never answers */
const u = "/assets/fetch-once-limit-test/never.bin";
let state = "pending";
const first = fetchOnce(u);
first.then(() => { state = "resolved"; }, () => { state = "rejected"; });
await clock.advance(LIMIT_MS, () => state !== "pending");
const at = clock.now();
check("a fetch that never answers: fetchOnce rejects within the limit", state === "rejected", `${state} after ${at} ms of the page's clock (want rejected by ${LIMIT_MS} ms)`);

/* the key is forgotten: the same address asked again calls fetch again */
let state2 = "pending";
const second = fetchOnce(u);
second.then(() => { state2 = "resolved"; }, () => { state2 = "rejected"; });
check("after the timeout the address is forgotten: fetch is called again", calls[u] === 2 && second !== first, `${calls[u]} fetch call(s) for the address (want 2); the same promise again: ${second === first}`);
await clock.advance(LIMIT_MS, () => state2 !== "pending");
check("... and that second ask also has the limit", state2 === "rejected", `${state2} (want rejected)`);

finish();
