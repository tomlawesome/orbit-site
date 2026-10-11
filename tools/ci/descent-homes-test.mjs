/*
 * Test for households on the way down (#26), written from docs/adr/0003 alone (its "Behaviours" 15-18).
 *
 * descentProfile({ onto, from, homes }) is a pure export of assets/door/index.js: the profile descend() starts the
 * engine with. Without homes it is today's: DOWN itself (onto "dusk", the default), DOWN_DAWN itself (onto "dawn"),
 * or descentFrom(P) for a climb profile `from: P`. With n homes the props are the base's followed by exactly n more,
 * mirrored(homeProps(homes)), whichever base; the base is never changed.
 *
 * Today's descentFrom(P) is not exported, so the golden values for `from` are the sha256 of its canonical JSON,
 * taken from the code before the option (8e1bd13) for two climb profiles. The live half of #26 (descend({ homes })
 * still flies) is in tools/ci/asdawn-test.mjs.
 *
 *   node tools/ci/descent-homes-test.mjs
 *
 * No dependencies and no browser.
 */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((q) => [q, x[q]])) : x));
const sha = (v) => createHash("sha256").update(canon(v)).digest("hex");
const close = (a, b) => typeof a === "number" && Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b));

const door = await import("../../assets/door/index.js");
const { descentProfile, DOWN, DOWN_DAWN, DOWNDUR, UPDUR, homeProps, mirrored, UP } = door;

for (const [name, v] of Object.entries({ descentProfile, DOWN, DOWN_DAWN, DOWNDUR, UPDUR, homeProps, mirrored })) {
  check(`index.js exports ${name}`, v !== undefined, `typeof ${typeof v}`);
}
if (typeof descentProfile !== "function" || typeof mirrored !== "function" || !DOWN || !DOWN_DAWN) {
  console.log("FAIL 15-18: not run, the exports above are missing (every case below needs them)");
  process.exit(1);
}

/* two climb profiles: the site's own, and one with another vanishing point, bearings and fewer props */
const P2 = { ...UP, vpY: -0.3, a0: 40, a1: 140, props: UP.props.slice(0, 3) };
const GOLD = { up: "7ac29245fd615074191028b7e7f3ca3b72f6c8f43d819adcce5558ef191d5d72", p2: "6fdb9fe08ed77653a7fd09b68919b60f2ff586bf4f4a0b9ef9e26c08a6217f7e" };
const homesOf = (n) => Array.from({ length: n }, (_, i) => ({ name: `Home ${i}`, bodies: [[i, -i, "#8791b3", 3 + (i % 4)], [i + 1, i, "#f0b429", 2]] }));

/* ---- 15, 16. nothing asked, nothing changed ---- */
const downBefore = canon(DOWN), dawnBefore = canon(DOWN_DAWN), upBefore = canon(UP), p2Before = canon(P2);
const base = [
  ["descentProfile()", () => descentProfile(), DOWN, "DOWN"],
  ["descentProfile({})", () => descentProfile({}), DOWN, "DOWN"],
  ["{ onto: \"dusk\" }", () => descentProfile({ onto: "dusk" }), DOWN, "DOWN"],
  ["{ onto: \"dawn\" }", () => descentProfile({ onto: "dawn" }), DOWN_DAWN, "DOWN_DAWN"],
  ["{ onto: \"dusk\", homes: [] }", () => descentProfile({ onto: "dusk", homes: [] }), DOWN, "DOWN"],
  ["{ onto: \"dawn\", homes: [] }", () => descentProfile({ onto: "dawn", homes: [] }), DOWN_DAWN, "DOWN_DAWN"],
  ["{ homes: [] }", () => descentProfile({ homes: [] }), DOWN, "DOWN"],
  ["{ homes: undefined }", () => descentProfile({ homes: undefined }), DOWN, "DOWN"],
];
for (const [name, call, want, wname] of base) {
  let got, err = null;
  try { got = call(); } catch (e) { err = e.message.split("\n")[0]; }
  check(`15/16. ${name} is ${wname} itself`, !err && got === want, err ? `threw: ${err}` : got === want ? "the same object" : "another object");
}
for (const [name, P, gold] of [["UP", UP, GOLD.up], ["another climb", P2, GOLD.p2]]) {
  for (const [label, opts] of [["{ from }", { from: P }], ["{ onto: \"dusk\", from }", { onto: "dusk", from: P }], ["{ from, homes: [] }", { from: P, homes: [] }]]) {
    let got, err = null;
    try { got = descentProfile(opts); } catch (e) { err = e.message.split("\n")[0]; }
    check(`15/16. ${label} for ${name} is today's descentFrom`, !err && !!got && sha(got) === gold, err ? `threw: ${err}` : got ? (sha(got) === gold ? "canonical JSON matches" : `differs (sha256 ${sha(got).slice(0, 12)}…, today ${gold.slice(0, 12)}…)`) : "nothing returned");
  }
}

/* ---- 17. n homes ---- */
const REV = DOWNDUR / UPDUR;
const bases = [
  ["onto dusk", {}, () => DOWN],
  ["onto dawn", { onto: "dawn" }, () => DOWN_DAWN],
  ["from UP", { from: UP }, () => descentProfile({ from: UP })],
  ["from another climb", { from: P2 }, () => descentProfile({ from: P2 })],
];
for (const [bname, opts, getBase] of bases) {
  const b = getBase();
  const baseProps = canon(b.props);
  const baseLen = b.props.length;
  for (const n of [1, 2, 3, 4, 7, 30]) {
    const homes = homesOf(n), snapshot = canon(homes);
    let got, err = null;
    try { got = descentProfile({ ...opts, homes }); } catch (e) { err = e.message.split("\n")[0]; }
    const tag = `17. ${bname}, ${n} home${n === 1 ? "" : "s"}`;
    if (err || !got) { check(`${tag}: a profile comes back`, false, err ? `threw: ${err}` : "nothing returned"); continue; }
    check(`${tag}: props are the base's, then exactly ${n} more`, got.props.length === baseLen + n && canon(got.props.slice(0, baseLen)) === baseProps, `${got.props.length} props (want ${baseLen + n}); the first ${baseLen} ${canon(got.props.slice(0, baseLen)) === baseProps ? "are the base's" : "differ from the base's"}`);
    const rest = { ...got }, rb = { ...b };
    delete rest.props; delete rb.props;
    check(`${tag}: every other field is the base's`, canon(rest) === canon(rb), canon(rest) === canon(rb) ? "same" : "differs");
    check(`${tag}: the base is not changed`, b.props.length === baseLen && canon(b.props) === baseProps && got !== b && got.props !== b.props, `base has ${b.props.length} props (was ${baseLen}); ${got.props === b.props ? "the same array was returned" : "a new array"}`);
    check(`${tag}: the homes are not changed`, canon(homes) === snapshot, canon(homes) === snapshot ? "unchanged" : "the input was altered");
    const home = homeProps(homes), added = got.props.slice(baseLen);
    const bad = [];
    added.forEach((p, i) => {
      const h = home[i];
      for (const k of ["kind", "name", "bodies", "ang", "z"]) if (!isDeepStrictEqual(p?.[k], h[k])) bad.push(`${i}.${k}: ${JSON.stringify(p?.[k])} (want ${JSON.stringify(h[k])})`);
      if (p?.spin !== 0) bad.push(`${i}.spin: ${p?.spin} (want 0)`);
      const dur = (2000 + (i % 3) * 350) * REV * 0.75, t0 = Math.max(0, (UPDUR - (760 + i * 380 + 2000 + (i % 3) * 350)) * REV);
      if (!close(p?.dur, dur)) bad.push(`${i}.dur: ${p?.dur} (want ${dur})`);
      if (!close(p?.t0, t0)) bad.push(`${i}.t0: ${p?.t0} (want ${t0})`);
    });
    check(`${tag}: each added prop is the mirrored home prop`, added.length === n && bad.length === 0, bad.length ? bad.slice(0, 3).join("; ") : `${n} props as wanted`);
    const m = mirrored(homeProps(homes));
    check(`${tag}: mirrored(homeProps(homes)) deep-equals the added props`, canon(m) === canon(added) && m.length === n, `mirrored gave ${m.length} props, ${canon(m) === canon(added) ? "equal" : "not equal"}`);
  }
}
/* the profile's own constants are not touched by any of it */
check("17. DOWN, DOWN_DAWN and the climb profiles are as they were after all the calls", canon(DOWN) === downBefore && canon(DOWN_DAWN) === dawnBefore && canon(UP) === upBefore && canon(P2) === p2Before, "unchanged");

/* ---- mirrored on its own ---- */
{
  const homes = homesOf(5);
  const m = mirrored(homeProps(homes));
  check("17. mirrored() of no props is no props", Array.isArray(mirrored([])) && mirrored([]).length === 0, JSON.stringify(mirrored([])));
  check("17. mirrored() does not change what it is given", canon(homeProps(homes)) === canon(homeProps(homesOf(5))), "same");
  check("17. mirrored() keeps order and count", m.length === 5 && m.every((p, i) => p.name === `Home ${i}`), m.map((p) => p.name).join(", "));
}

/* ---- 18. from with homes: the climb's props mirrored, then the homes mirrored ---- */
for (const [name, P, gold] of [["UP", UP, GOLD.up], ["another climb", P2, GOLD.p2]]) {
  const homes = homesOf(4);
  const plain = descentProfile({ from: P });
  let got, err = null;
  try { got = descentProfile({ from: P, homes }); } catch (e) { err = e.message.split("\n")[0]; }
  const want = [...plain.props, ...mirrored(homeProps(homes))];
  check(`18. from ${name} with 4 homes: descentFrom's props, then the mirrored homes`, !err && !!got && canon(got.props) === canon(want), err ? `threw: ${err}` : got ? `${got.props.length} props (want ${want.length})` : "nothing returned");
  check(`18. from ${name} with 4 homes: the climb's own props are exactly today's`, !err && !!got && sha({ ...got, props: got.props.slice(0, plain.props.length) }) === gold, err ? `threw: ${err}` : "compared with today's descentFrom");
  check(`18. from ${name}: the climb is not changed`, canon(P) === (P === UP ? upBefore : p2Before), "unchanged");
}

process.exit(failed ? 1 : 0);
