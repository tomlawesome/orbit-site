/*
 * Test for the site's saved state (assets/js/data.js), written from the specification alone.
 *
 * S17: the saved state records which version of the site's sample it came from. When a returning visitor's saved
 *      sample is from an older version, the sample items are replaced with the current sample and the items the
 *      visitor added are kept. Same version: everything is kept as saved. Nothing saved: the current sample.
 * S18: "reset the site" (forget) clears every key the site stores in localStorage, including the seen-intro and
 *      read marks, so the next load behaves like a first visit.
 *
 *   node tools/ci/site-data-test.mjs
 *
 * No dependencies and no browser; localStorage and sessionStorage are stubbed.
 *
 * Names this test assumes the fix adds to data.js (the module exports no version today):
 *   SAMPLE_VERSION          exported number: the version of the current sample.
 *   serialise().sampleVersion  the number saved with the state (beside the existing `v`, which is left alone).
 * A saved state with no sampleVersion (every state saved before this change) counts as older.
 * Existing exports used: households, serialise, hydrate, recall, forget, pristine.
 */
const store = new Map();
const stub = () => ({
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => { store.clear(); },
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
});
globalThis.localStorage = stub();
globalThis.sessionStorage = stub();

let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};

const data = await import("../../assets/js/data.js");
const { households, serialise, recall, forget, pristine, SAMPLE_VERSION } = data;
const STATE_KEY = "orbit-site-state";

const items = () => Object.values(households).flatMap((h) => h.items);
const titleOf = () => new Map(items().map((i) => [i.id, i.title]));
const sample = titleOf(); // the current sample, as loaded
const sampleIds = [...sample.keys()];

check("the module exports its sample version", typeof SAMPLE_VERSION === "number", `typeof SAMPLE_VERSION is ${typeof SAMPLE_VERSION} (want number)`);
check("a fresh save records the sample version", typeof SAMPLE_VERSION === "number" && serialise().sampleVersion === SAMPLE_VERSION,
  `serialise().sampleVersion is ${JSON.stringify(serialise().sampleVersion)} (want ${SAMPLE_VERSION})`);

// A saved state as a visitor would have: two sample items out of step with the current sample (one edited, one
// missing) and one item the visitor added.
const [editedId, missingId] = sampleIds;
const VISITOR = { id: "i-visitor-own", title: "Visitor's own item" };
const saved = (version) => {
  const s = JSON.parse(JSON.stringify(serialise()));
  const [first] = Object.keys(s.households);
  s.households[first] = s.households[first].filter((x) => x.id !== missingId);
  const edited = Object.values(s.households).flat().find((x) => x.id === editedId);
  edited.title = "OLD " + sample.get(editedId);
  const template = Object.values(s.households).flat().find((x) => x.id !== editedId);
  s.households[first].push({ ...template, ...VISITOR });
  if (version === undefined) delete s.sampleVersion; else s.sampleVersion = version;
  return s;
};
const load = (state) => {
  pristine();
  store.clear();
  if (state) store.set(STATE_KEY, JSON.stringify(state));
  return recall();
};
const visitorItem = () => items().find((i) => i.id === VISITOR.id);

// Control: the same version is kept exactly as saved.
load(saved(SAMPLE_VERSION));
check("same version: the visitor's item is kept", visitorItem()?.title === VISITOR.title, `visitor item is ${JSON.stringify(visitorItem()?.title)}`);
check("same version: the sample items are as saved", titleOf().get(editedId) === "OLD " + sample.get(editedId) && !titleOf().has(missingId),
  `${editedId} is ${JSON.stringify(titleOf().get(editedId))}, ${missingId} ${titleOf().has(missingId) ? "present" : "absent"} (want edited, absent)`);

// An older version, and a state saved before versions were recorded.
for (const [label, version] of [["older version", SAMPLE_VERSION - 1], ["no version saved", undefined]]) {
  load(saved(version));
  const now = titleOf();
  check(`${label}: an edited sample item is the current sample's`, now.get(editedId) === sample.get(editedId), `${editedId} is ${JSON.stringify(now.get(editedId))} (want ${JSON.stringify(sample.get(editedId))})`);
  check(`${label}: a missing sample item is back`, now.get(missingId) === sample.get(missingId), `${missingId} is ${JSON.stringify(now.get(missingId))} (want ${JSON.stringify(sample.get(missingId))})`);
  const stray = [...now.keys()].filter((id) => !sample.has(id) && id !== VISITOR.id);
  check(`${label}: no other items`, stray.length === 0, stray.length ? `unexpected ${stray.join(", ")}` : "only the sample and the visitor's");
  check(`${label}: the visitor's item is still there`, visitorItem()?.title === VISITOR.title, `visitor item is ${JSON.stringify(visitorItem()?.title)} (want ${JSON.stringify(VISITOR.title)})`);
}

// Nothing saved: the current sample.
load(null);
const none = titleOf();
check("nothing saved: the current sample", none.size === sample.size && [...sample].every(([id, t]) => none.get(id) === t), `${none.size} items (want ${sample.size})`);

// S18: reset clears every key the site stores.
const KEYS = {
  "orbit-site-state": '{"v":1}', "orbit-pack": "dusk", "orbit-theme": "dawn", "orbit-site-seen": String(Date.now()),
  "orbit-site-read": '["/docs/"]', "orbit-probe Mozilla/5.0 1920x1080@1": '{"t":1,"r":{"ok":true}}',
};
store.clear();
for (const [k, v] of Object.entries(KEYS)) store.set(k, v);
const present = Object.keys(KEYS).filter((k) => localStorage.getItem(k) !== null);
check("control: every key is present before the reset", present.length === Object.keys(KEYS).length, `${present.length} of ${Object.keys(KEYS).length} present`);
forget();
const left = Object.keys(KEYS).filter((k) => localStorage.getItem(k) !== null);
check("reset leaves none of the site's keys", left.length === 0, left.length ? `still set: ${left.join(", ")}` : "none left");
check("reset leaves nothing starting orbit", [...store.keys()].every((k) => !k.startsWith("orbit")), `keys left: ${JSON.stringify([...store.keys()])}`);

process.exit(failed ? 1 : 0);
