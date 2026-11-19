/*
 * Test for #119 (the flight's shaders asked after the install's first draw), main.js's two decisions, lifted into
 * assets/js/ring.js (D7: main.js starts the page when it is imported, so its own code cannot be tested; as ringWaits was,
 * world-ring-test.mjs): statements L15 and L16 of the specification, written from it alone, before the code. Pure: no page,
 * no process per case.
 *
 *   node tools/ci/flight-late-ring-test.mjs
 *
 *   flightLate(o) -> boolean: whether the flight's shaders are asked late (links "late", the flight drawn in a worker
 *       (the door's drawnAside) and the browser not compiling in the background (the door's compilesAside)).
 *       The specification names the function, not the keys of `o`: they are the ones ringWaits takes where it has the same
 *       thing (`drawnAside`, and `aside` for compilesAside()), with `links` the flag's value (the door's flag("links"), which
 *       is false when absent); `compilesAside` is given beside `aside`, the same value, so a build that names it either
 *       way reads it.
 *   giveWord({ late, baked, drawn, go }): calls go() once: where late, after `baked` AND `drawn` have settled, not at
 *       `baked`; where not late, at `baked`. A promise that rejects still runs it (a failed bake, a failed first draw:
 *       the flight is never left waiting for the word).
 *
 *   l15  L15  giveWord, late: go after baked and drawn, not at baked alone, nor at drawn alone; once
 *   l15b L15  giveWord, not late: go at baked (drawn not waited for); once
 *   l15c L15  giveWord, rejected inputs still run it (late: baked rejected, drawn rejected, both; not late: baked rejected),
 *             and leave no unhandled rejection
 *   l16  L16  flightLate is true only for links "late" + drawnAside + not compilesAside: false on the page path (drawnAside
 *             false), with the extension (aside true), links absent (false or undefined) or "now" (or any other value)
 *   w    L15/L16  main.js calls them: a source check only (D7), that main.js imports and calls flightLate and giveWord from
 *             ring.js and statusGo from the door. That compiledAll then keeps journey.compiled() when flightLate is false, and
 *             leaves it out when true, is main.js's own and is browser-checked, as are its maintenance and save-data returns
 *             giving the word at once (D5) and the `?links=now` switch.
 *
 * A missing module or export is said in plain words.
 */
import { readFileSync } from "node:fs";

const MODULE = "../../assets/js/ring.js";
let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};
const show = (x) => JSON.stringify(x);

let mod = null, why = null;
try { mod = await import(MODULE); }
catch (e) { why = /Cannot find module|ERR_MODULE_NOT_FOUND/.test(String(e && (e.code || e.message))) ? "assets/js/ring.js does not exist" : `assets/js/ring.js could not be imported: ${e && e.message}`; }
const fn = (name) => {
  if (!mod) return { why };
  if (typeof mod[name] !== "function") return { why: `assets/js/ring.js exports no ${name} function (it exports ${show(Object.keys(mod))})` };
  return { f: mod[name] };
};
const flush = () => new Promise((r) => setImmediate(r));
const unhandled = [];
process.on("unhandledRejection", (e) => { unhandled.push(String(e && e.message || e)); });

/* a promise a case settles by hand */
const later = () => { let ok, no; const p = new Promise((a, b) => { ok = a; no = b; }); return { p, ok, no }; };
const spyGo = () => { const s = { n: 0, go() { s.n++; } }; return s; };

/* ── giveWord ───────────────────────────────────────────────────────────────────────────────────────────────── */
{
  const { f, why: w } = fn("giveWord");
  const cases = [];
  const add = (name, run) => cases.push([name, run]);

  add("L15 late: not at `baked` alone (drawn still pending), but once `drawn` has settled", async () => {
    const baked = later(), drawn = later(), s = spyGo();
    f({ late: true, baked: baked.p, drawn: drawn.p, go: s.go });
    baked.ok(true); await flush();
    const atBaked = s.n;
    drawn.ok(); await flush();
    return [atBaked === 0 && s.n === 1, `go calls at baked ${atBaked}, after drawn ${s.n}`];
  });
  add("L15 late: not at `drawn` alone (baked still pending), but once `baked` has settled", async () => {
    const baked = later(), drawn = later(), s = spyGo();
    f({ late: true, baked: baked.p, drawn: drawn.p, go: s.go });
    drawn.ok(); await flush();
    const atDrawn = s.n;
    baked.ok(true); await flush();
    return [atDrawn === 0 && s.n === 1, `go calls at drawn ${atDrawn}, after baked ${s.n}`];
  });
  add("L15 late: both already settled: go is called, once", async () => {
    const s = spyGo();
    f({ late: true, baked: Promise.resolve(true), drawn: Promise.resolve(), go: s.go });
    await flush(); await flush();
    return [s.n === 1, `go calls ${s.n}`];
  });
  add("L15 not late: go at `baked`, drawn not waited for, and once (drawn settling later calls nothing more)", async () => {
    const baked = later(), drawn = later(), s = spyGo();
    f({ late: false, baked: baked.p, drawn: drawn.p, go: s.go });
    await flush();
    const before = s.n;
    baked.ok(true); await flush();
    const atBaked = s.n;
    drawn.ok(); await flush();
    return [before === 0 && atBaked === 1 && s.n === 1, `go calls before baked ${before}, at baked ${atBaked}, after drawn ${s.n}`];
  });
  for (const [label, o] of [
    ["late, baked rejected (drawn settles)", () => ({ late: true, baked: Promise.reject(new Error("no bake")), drawn: Promise.resolve() })],
    ["late, drawn rejected", () => ({ late: true, baked: Promise.resolve(true), drawn: Promise.reject(new Error("no draw")) })],
    ["late, both rejected", () => ({ late: true, baked: Promise.reject(new Error("no bake")), drawn: Promise.reject(new Error("no draw")) })],
    ["not late, baked rejected", () => ({ late: false, baked: Promise.reject(new Error("no bake")), drawn: Promise.resolve() })],
  ]) {
    add(`L15 rejected inputs still run it: ${label}: go once, no unhandled rejection`, async () => {
      const s = spyGo(), u0 = unhandled.length;
      f({ ...o(), go: s.go });
      await flush(); await flush(); await flush();
      return [s.n === 1 && unhandled.length === u0, `go calls ${s.n}, unhandled rejections ${unhandled.length - u0}`];
    });
  }
  for (const [name, run] of cases) {
    if (!f) { check(name, false, w); continue; }
    let r;
    try { r = await run(); } catch (e) { r = [false, `threw: ${e && e.message}`]; }
    check(name, r[0], r[1]);
  }
}

/* ── flightLate ─────────────────────────────────────────────────────────────────────────────────────────────── */
{
  const { f, why: w } = fn("flightLate");
  const ask = (links, drawnAside, aside) => {
    const input = { links, drawnAside, aside, compilesAside: aside }, copy = show(input);
    const out = f(input);
    if (show(input) !== copy) throw new Error("flightLate changed the object it was given");
    return out;
  };
  const expect = (name, links, drawnAside, aside, want) => {
    if (!f) { check(name, false, w); return; }
    let got;
    try { got = ask(links, drawnAside, aside); } catch (e) { check(name, false, `flightLate threw: ${e && e.message}`); return; }
    check(name, got === want, `links ${show(links)}, drawnAside ${drawnAside}, aside ${aside}: ${show(got)} (want ${want})`);
  };
  expect("L16 links \"late\", drawn in a worker, the browser not compiling aside: late", "late", true, false, true);
  expect("L16 the page path (drawnAside false): not late", "late", false, false, false);
  expect("L16 with the extension (compilesAside true): not late", "late", true, true, false);
  expect("L16 the page path with the extension: not late", "late", false, true, false);
  for (const [label, v] of [["absent (undefined)", undefined], ["absent (the flag's false)", false], ["null", null], ["\"now\"", "now"], ["\"held\" (dropped, D3)", "held"]]) {
    expect(`L16 links ${label}, drawn in a worker, no extension: not late`, v, true, false, false);
  }
  /* every other combination of the three (the whole table) */
  if (f) {
    const bad = [];
    for (const links of ["late", "now", "held", false, undefined]) for (const d of [true, false]) for (const a of [true, false]) {
      let got;
      try { got = ask(links, d, a); } catch (e) { bad.push(`threw ${e && e.message}`); continue; }
      if (got !== (links === "late" && d && !a)) bad.push(`${show([links, d, a])} gave ${show(got)}`);
    }
    check("L16 true only for links \"late\" + drawnAside + not compilesAside: the whole table", bad.length === 0, bad.join("; ") || "all 20 combinations as wanted");
  } else check("L16 true only for links \"late\" + drawnAside + not compilesAside: the whole table", false, w);
}

/* ── main.js calls them (a source check: main.js cannot be imported) ────────────────────────────────────────── */
{
  const src = readFileSync(new URL("../../assets/js/main.js", import.meta.url), "utf8");
  const imports = (name, from) => new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*"${from}"`).test(src);
  check("L15/L16 main.js imports flightLate and giveWord from ring.js and calls both", imports("flightLate", "./ring.js") && imports("giveWord", "./ring.js") && /\bflightLate\s*\(/.test(src) && /\bgiveWord\s*\(/.test(src),
    `flightLate imported ${imports("flightLate", "./ring.js")}, called ${/\bflightLate\s*\(/.test(src)}; giveWord imported ${imports("giveWord", "./ring.js")}, called ${/\bgiveWord\s*\(/.test(src)}`);
  check("L15 main.js gives the word with the door's statusGo", imports("statusGo", "../door/index.js") && /\bstatusGo\b[^\n]*\)/.test(src.replace(/import[^;]*;/g, "")), `statusGo imported ${imports("statusGo", "../door/index.js")}`);
}
process.exit(failed ? 1 : 0);
