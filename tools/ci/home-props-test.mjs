/*
 * Test for homeProps (#24, "export homeProps from the door folder"), written from the issue's specification alone.
 *
 * homeProps(homes) is exported from assets/door/index.js, the only file a host imports. For each home h at index i it
 * returns { kind: "home", name: h.name, bodies: h.bodies, t0: 760 + i * 380, dur: 2000 + (i % 3) * 350,
 * ang: BEAR[i % BEAR.length], z: ZED[i % ZED.length], spin: 0 }, one prop per home, in order. BEAR and ZED are
 * fixed lists, so ang and z repeat with a period. The site's demoFlight(homes) (assets/js/journeys.js) must fly
 * exactly those props.
 *
 *   node tools/ci/home-props-test.mjs
 *
 * No dependencies and no browser. Neither module needs a stub to load in Node (checked when this was written).
 */
let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const door = await import("../../assets/door/index.js");
const { homeProps } = door;

check("homeProps is exported from the door's entry point", typeof homeProps === "function", `typeof homeProps is ${typeof homeProps} (want function)`);

if (typeof homeProps === "function") {
  const homes = Array.from({ length: 30 }, (_, i) => ({ name: `Home ${i}`, bodies: [{ id: `b${i}`, n: i }, { id: `c${i}`, n: i + 1 }] }));
  const before = JSON.stringify(homes);

  const none = homeProps([]);
  check("no homes, no props", Array.isArray(none) && none.length === 0, `got ${JSON.stringify(none)} (want [])`);

  const props = homeProps(homes);
  check("one prop per home", Array.isArray(props) && props.length === homes.length, `${props?.length} props for ${homes.length} homes`);
  check("the homes are not changed", JSON.stringify(homes) === before, "the input after the call " + (JSON.stringify(homes) === before ? "is unchanged" : "differs"));

  const each = (name, test, want) => {
    const bad = homes.map((h, i) => [i, props?.[i]]).filter(([i, p]) => !test(p, i));
    check(name, bad.length === 0, bad.length ? `home ${bad[0][0]} gave ${JSON.stringify(bad[0][1])} (want ${want})` : `all ${homes.length} as wanted`);
  };
  each("kind is home", (p) => p?.kind === "home", `kind "home"`);
  each("the name is carried", (p, i) => p?.name === homes[i].name, "the home's name");
  each("the bodies are carried", (p, i) => same(p?.bodies, homes[i].bodies), "the home's bodies");
  each("spin is 0", (p) => p?.spin === 0, "spin 0");
  each("t0 is 760 + i * 380", (p, i) => p?.t0 === 760 + i * 380, "t0 = 760 + i * 380");
  each("dur is 2000 + (i % 3) * 350", (p, i) => p?.dur === 2000 + (i % 3) * 350, "dur = 2000 + (i % 3) * 350");
  each("ang and z are finite numbers", (p) => Number.isFinite(p?.ang) && Number.isFinite(p?.z), "finite ang and z");

  /* ang and z come from short fixed lists indexed by i modulo their length: each repeats with some period of at most
     a dozen homes (the lists are shorter than that) */
  const period = (key) => {
    const values = props.map((p) => p?.[key]);
    for (let n = 1; n <= 15; n++) if (values.every((v, i) => v === values[i % n])) return n;
    return 0;
  };
  for (const key of ["ang", "z"]) {
    const n = period(key);
    check(`${key} repeats with the list's period`, n > 0, n ? `period ${n}` : `no period of 15 or fewer over ${homes.length} homes`);
  }
  check("the bearings differ from home to home", new Set(props.map((p) => p?.ang)).size >= 2, `${new Set(props.map((p) => p?.ang)).size} distinct bearings (want 2 or more)`);

  /* a short list is the start of a longer one: homes do not look at each other */
  const three = homeProps(homes.slice(0, 3));
  check("the first three homes get the same props whatever follows", same(three, props.slice(0, 3)), same(three, props.slice(0, 3)) ? "same" : "differ");

  /* demoFlight flies them */
  let demo, loaded = true;
  try { demo = (await import("../../assets/js/journeys.js")).demoFlight; } catch (e) { loaded = false; check("demoFlight loads in Node", false, e.message.split("\n")[0]); }
  if (loaded && typeof demo !== "function") check("demoFlight is exported by assets/js/journeys.js", false, `typeof demoFlight is ${typeof demo}`);
  if (typeof demo === "function") {
    for (const n of [0, 1, 5]) {
      const given = homes.slice(0, n);
      const flown = demo(given)?.props;
      const want = homeProps(given);
      let found = Array.isArray(flown);
      if (found) {
        found = false;
        for (let at = 0; at + want.length <= flown.length && !found; at++) found = same(flown.slice(at, at + want.length), want);
      }
      check(`demoFlight of ${n} home${n === 1 ? "" : "s"} flies exactly homeProps`, found, found ? "props found, in order" : `props ${JSON.stringify(flown)} do not hold ${JSON.stringify(want)}`);
    }
  }
}

process.exit(failed ? 1 : 0);
