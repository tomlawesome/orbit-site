/*
 * Test for the release-readiness script (tools/ci/release-readiness.mjs), written from the specification on issue
 * #156 before the script existed. It drives the script's exports (CHECKS, runReadiness, renderReport, guideSteps,
 * checkRecord) with made-up lookups: every check passing, each failing alone, a lookup that throws, each way a
 * release record can be wrong, the report's lines and order, and the guide's step numbers. Only what a caller sees
 * is asserted: ok, the prefix of a message, ready, the report's lines.
 *
 *   node tools/ci/release-readiness-test.mjs
 *
 * No dependencies, no git, no network. Exits non-zero on the first failed assertion.
 */
import assert from "node:assert/strict";
import { CHECKS, runReadiness, renderReport, guideSteps, checkRecord } from "./release-readiness.mjs";

const GUIDE = ["# Releasing", "", "## Step 1: dev holds main", "text", "## Step 2: mirror current", "## Step 3: door folder", "more"].join("\n");
const WORDS = { 1: "done: dev merged main", 2: "done: mirrors equal", 3: "not needed: owner says no door change" };
const stepLines = (nums = [1, 2, 3]) => nums.map((n) => `step ${n}: ${WORDS[n] ?? "done: evidence"}`);
const recordText = (lines = stepLines(), blob = "abc123", signer = "Ada Agent") =>
  ["# Release 2026-11-19", "", `guide-blob: ${blob}`, "", "Some prose about this release.", "", ...lines, "", signer === null ? "" : `Signed-off-by: ${signer}`, ""].join("\n");
const REC = "docs/releases/2026-11-19.md";

const lookups = (over = {}) => ({
  source: () => "dev",
  target: () => "main",
  targetTip: () => "t1",
  sourceHolds: (c) => c === "t1",
  mirrorTip: () => "t1",
  newRecords: () => [REC],
  read: (p) => (p === REC || /releases\/.*\.md$/.test(p) ? recordText() : GUIDE),
  guideBlob: () => "abc123",
  lastCommit: () => ({ author: "Ada Agent", trailers: ["Ada Agent"] }),
  ...over,
});
const run = (over) => runReadiness(lookups(over));
const byId = (r, id) => r.results.find((x) => x.id === id);
const group = (name) => console.log(`ok   ${name}`);

// The record and the guide (docs/releasing.md) are both read through read(path).
const withTexts = (record, guide = GUIDE) => ({ read: (p) => (/releases\/.*\.md$/.test(p) ? record : guide) });
const rec = (o = {}) => ({ text: recordText(), guideBlob: "abc123", steps: [1, 2, 3], lastCommit: { author: "Ada Agent", trailers: ["Ada Agent"] }, ...o });
const withText = (text, o = {}) => checkRecord(rec({ text, ...o }));

// 1. all passing
{
  const r = await run();
  assert.equal(r.ready, true);
  assert.deepEqual(r.results.map((x) => x.id), CHECKS);
  assert.deepEqual(CHECKS, ["branches", "contains-target", "mirror-current", "release-record"]);
  assert.ok(r.results.every((x) => x.ok === true));
  const lines = renderReport(r.results).split("\n");
  for (const id of CHECKS) assert.equal(lines.filter((l) => l.startsWith(`ok ${id}: `)).length, 1, id);
  assert.ok(lines.at(-1).startsWith("Ready:"));
  group("all passing: ready, results in CHECKS order, report lines");
}

// 2. each check failing alone
{
  const fails = {
    branches: { source: () => "feature/x" },
    "contains-target": { sourceHolds: () => false },
    "mirror-current": { mirrorTip: () => "other" },
    "release-record": { newRecords: () => [] },
  };
  for (const [id, over] of Object.entries(fails)) {
    const r = await run(over);
    assert.equal(r.ready, false, id);
    assert.equal(r.results.length, CHECKS.length, id);
    for (const x of r.results) {
      assert.equal(x.ok, x.id !== id, `${id} alone: ${x.id}`);
      if (!x.ok) assert.ok(x.message.length > 0);
    }
  }
  group("each check failing alone, the others still run");
}

// 3. a lookup that throws
{
  const boom = () => { throw new Error("no network"); };
  const asyncBoom = async () => { throw new Error("no network"); };
  for (const [id, over] of [["branches", { source: boom }], ["contains-target", { targetTip: asyncBoom }], ["mirror-current", { mirrorTip: asyncBoom }], ["release-record", { newRecords: boom }]]) {
    const r = await run(over);
    assert.equal(r.ready, false, id);
    assert.equal(r.results.length, CHECKS.length);
    assert.equal(byId(r, id).ok, false);
    assert.ok(byId(r, id).message.startsWith("could not check: "), id);
    for (const x of r.results.filter((y) => y.id !== id && !(id === "contains-target" && y.id === "mirror-current"))) assert.equal(x.ok, true, `${id} throws: ${x.id}`);
  }
  group("a throwing lookup: could not check, the others still run");
}

// 4. branches
{
  let r = await run({ source: () => "main" });
  assert.equal(byId(r, "branches").ok, false);
  r = await run({ target: () => "dev" });
  assert.equal(byId(r, "branches").ok, false);
  assert.ok(byId(r, "branches").message.length > 0);
  group("branches: wrong source, wrong target");
}

// 5. contains-target, mirror-current
{
  let r = await run({ sourceHolds: () => false });
  assert.equal(byId(r, "contains-target").ok, false);
  assert.ok(byId(r, "contains-target").message.length > 0);
  r = await run({ mirrorTip: () => "behind" });
  assert.equal(byId(r, "mirror-current").ok, false);
  assert.ok(byId(r, "mirror-current").message.length > 0);
  group("contains-target and mirror-current: the false case");
}

// 6. release-record, through runReadiness
{
  const recFails = async (over) => {
    const x = byId(await run(over), "release-record");
    assert.equal(x.ok, false);
    assert.ok(x.message.length > 0);
    return x.message;
  };
  const none = await recFails({ newRecords: () => [] });
  const two = await recFails({ newRecords: () => [REC, "docs/releases/2026-11-19-2.md"] });
  const badName = await recFails({ newRecords: () => ["docs/releases/release-notes.md"] });
  assert.notEqual(none, two);
  assert.notEqual(none, badName);
  assert.notEqual(two, badName);

  const second = await run({ newRecords: () => ["docs/releases/2026-11-19-2.md"] });
  assert.equal(byId(second, "release-record").ok, true);
  group("release-record: none, two, bad name, second record of a day");
}

// 7. checkRecord
{
  const good = checkRecord(rec());
  assert.equal(good.ok, true);

  const missingBlob = checkRecord(rec({ text: recordText(stepLines(), "abc123").replace(/guide-blob:.*\n/, "") }));
  const differs = checkRecord(rec({ guideBlob: "zzz999" }));
  const missingStep = withText(recordText(stepLines([1, 3])));
  const extraStep = withText(recordText([...stepLines(), "step 4: done: x"]));
  const outOfOrder = withText(recordText(stepLines([1, 3, 2])));
  const noWord = withText(recordText(["step 1: finished: x", ...stepLines([2, 3])]));
  const noText = withText(recordText(["step 1: done:", ...stepLines([2, 3])]));
  const noText2 = withText(recordText(["step 1: done:   ", ...stepLines([2, 3])]));
  const noSign = withText(recordText(stepLines(), "abc123", null));
  const twoSign = withText(recordText(stepLines(), "abc123", "Ada Agent") + "Signed-off-by: Ada Agent\n");
  const wrongAuthor = checkRecord(rec({ lastCommit: { author: "Someone Else", trailers: ["Ada Agent"] } }));
  const wrongTrailer = checkRecord(rec({ lastCommit: { author: "Ada Agent", trailers: ["Someone Else"] } }));
  const noTrailers = checkRecord(rec({ lastCommit: { author: "Ada Agent", trailers: [] } }));
  const noSteps = checkRecord(rec({ steps: [], text: recordText([]) }));

  const failures = { missingBlob, differs, missingStep, extraStep, outOfOrder, noWord, noText, noText2, noSign, twoSign, wrongAuthor, wrongTrailer, noTrailers, noSteps };
  for (const [name, x] of Object.entries(failures)) {
    assert.equal(x.ok, false, name);
    assert.ok(typeof x.message === "string" && x.message.length > 0, name);
  }
  group("checkRecord: every listed failure fails with a message");

  const distinct = [["missingBlob", "differs"], ["missingStep", "extraStep"], ["missingStep", "outOfOrder"], ["extraStep", "outOfOrder"], ["noWord", "noText"], ["noSign", "twoSign"], ["noSign", "wrongAuthor"], ["wrongAuthor", "wrongTrailer"], ["noSteps", "missingStep"], ["differs", "noSign"]];
  for (const [a, b] of distinct) assert.notEqual(failures[a].message, failures[b].message, `${a} vs ${b}`);
  group("checkRecord: distinct failures give different messages");

  for (const w of ["done: shown on the site", "not needed: owner decision", "after merge: open the site"]) {
    const x = withText(recordText([`step 1: ${w}`, ...stepLines([2, 3])]));
    assert.equal(x.ok, true, w);
  }
  group("checkRecord: each of the three words accepted");

  const busy = withText(["# A title", "", "Intro prose.", "", "guide-blob: abc123", "", "More prose: with a colon.", "", ...stepLines(), "", "Closing words.", "Signed-off-by: Ada Agent", "", ""].join("\n"));
  assert.equal(busy.ok, true);
  group("checkRecord: unrelated lines (title, blanks, prose) still pass");
}

// 8. release-record end to end through runReadiness with a bad record
{
  const r = await run({ ...withTexts(recordText(stepLines([1, 3]))) });
  assert.equal(byId(r, "release-record").ok, false);
  assert.equal(r.ready, false);
  const r2 = await run({ ...withTexts(recordText()) });
  assert.equal(byId(r2, "release-record").ok, true);
  group("release-record: a wrong record read through lookups fails the check");
}

// 9. renderReport on a mix
{
  const results = [
    { id: "branches", ok: true, message: "dev into main" },
    { id: "contains-target", ok: false, message: "merge main into dev" },
    { id: "mirror-current", ok: true, message: "equal" },
    { id: "release-record", ok: false, message: "write a record" },
  ];
  for (const given of [results, [...results].reverse()]) {
    const lines = renderReport(given).split("\n").filter((l) => l !== "");
    assert.equal(lines.length, 5);
    assert.ok(lines[0].startsWith("ok branches: "));
    assert.ok(lines[1].startsWith("FAIL contains-target: "));
    assert.ok(lines[2].startsWith("ok mirror-current: "));
    assert.ok(lines[3].startsWith("FAIL release-record: "));
    assert.ok(lines[4].startsWith("Not ready: 2 of 4 checks failed ("));
    assert.ok(lines[4].includes("contains-target, release-record") || lines[4].includes("contains-target,release-record"));
    assert.ok(!lines[4].includes("branches"));
  }
  group("renderReport: mixed results, order follows CHECKS, summary line");
}

// 10. guideSteps
{
  assert.deepEqual(guideSteps(GUIDE), [1, 2, 3]);
  const odd = ["# Guide", "## Step 2: second written first", "x", "## Step 1: first", "### Step 9: not a step heading", "## Steps overview", "## Step three: words", "Step 7: no hashes", "## Step 3: third"].join("\n");
  assert.deepEqual(guideSteps(odd), [2, 1, 3]);
  assert.deepEqual(guideSteps("# Nothing here\n\ntext"), []);
  group("guideSteps: in the order written, other headings ignored");
}

console.log("all release-readiness cases passed");
