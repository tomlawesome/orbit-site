/*
 * Test for fetchOnce (assets/js/chores.js): a failed fetch is not remembered.
 * The first answer is a 503; the same address asked again must try again and
 * succeed, and a call made while that retry is in flight must share it.
 *
 *   node tools/ci/fetch-once-test.mjs
 *
 * No dependencies: fetch is stubbed.
 */
let calls = 0;
globalThis.fetch = async () => {
  calls++;
  if (calls === 1) return { ok: false, status: 503 };
  await new Promise((ok) => setTimeout(ok, 20));
  return { ok: true, blob: async () => "b" };
};

const { fetchOnce } = await import("../../assets/js/chores.js");

let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};

const u = "/assets/fetch-once-test.bin";

let first = "resolved";
try { await fetchOnce(u); } catch { first = "rejected"; }
check("a 503 rejects", first === "rejected", `the first call ${first} (want rejected)`);

const second = fetchOnce(u);
const third = fetchOnce(u);
let got;
try { got = await second; } catch (e) { got = `rejected: ${e.message}`; }
check("asked again after a failure, it tries again", got === "b", `the second call gave ${JSON.stringify(got)} (want "b")`);
check("a call while that retry is in flight shares it", third === second, third === second ? "same promise" : "a different promise");
check("fetch ran exactly twice", calls === 2, `${calls} calls (want 2)`);

process.exit(failed ? 1 : 0);
