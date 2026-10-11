/*
 * Test for what the docs pad draws from assets/docs/index.json (#18), written from the specification alone, before the
 * code, by the same agent that then wrote the code. The pad puts the index's colour, slug and section ids into
 * innerHTML (style="--c:…", href="#docs/…"), so a hostile index must not reach the page as markup. assets/js/pads.js
 * exports:
 *   cleanSources(sources) -> the array the pad draws. For an array of sources:
 *   P1  a colour that is "#" and six hex digits (either case) is kept; any other value (a string with a quote or a
 *       semicolon in it, a short "#fff", a non-string) is replaced by the pad's grey, "#8791b3".
 *   P2  a source whose slug is not lower-case letters, digits and dashes is left out.
 *   P3  within a kept source, a section whose id is not lower-case letters, digits and dashes is left out.
 *   P4  name and title are strings afterwards (a non-string becomes "").
 *   P5  everything else of a valid source is returned as it was: slug, name, title, repo, path, and each section's id,
 *       title, summary, text, html and subs.
 *   P6  the input is not changed, and an input that is not an array gives [].
 *
 *   node tools/ci/site-pads-sources-test.mjs
 *
 * No dependencies and no browser. pads.js loads in Node once matchMedia exists.
 */
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });

let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};
const show = (v) => JSON.stringify(v);

const { cleanSources } = await import("../../assets/js/pads.js");
check("cleanSources is exported from pads.js", typeof cleanSources === "function", `typeof cleanSources is ${typeof cleanSources} (want function)`);

if (typeof cleanSources === "function") {
  const section = (id) => ({ id, title: "T", summary: "S", text: "X", html: "<p>h</p>", subs: [{ id: "sub-1", title: "U" }] });
  const source = (over = {}) => ({ slug: "readme", name: "README", c: "#d8b45a", title: "Orbit", repo: "o/r", path: "README.md", sections: [section("top"), section("quick-start")], ...over });
  const run = (sources) => { try { return { v: cleanSources(sources) }; } catch (e) { return { threw: e.message }; } };
  const one = (name, over, want) => {
    const r = run([source(over)]);
    const got = r.v && r.v[0] ? r.v[0].c : undefined;
    check(name, !r.threw && got === want, r.threw ? `threw ${r.threw}` : `got ${show(got)} (want ${show(want)})`);
  };

  /* P1 */
  one("P1 a six-digit colour is kept", { c: "#d8b45a" }, "#d8b45a");
  one("P1 upper case is kept", { c: "#D8B45A" }, "#D8B45A");
  one("P1 a colour with a quote and markup becomes the grey", { c: '#fff"><img src=x onerror=alert(1)>' }, "#8791b3");
  one("P1 a colour with a semicolon (a style escape) becomes the grey", { c: "red;background:url(//x.invalid/a)" }, "#8791b3");
  one("P1 a three-digit colour becomes the grey", { c: "#fff" }, "#8791b3");
  one("P1 a colour with trailing text becomes the grey", { c: "#d8b45a;x" }, "#8791b3");
  one("P1 a colour with a trailing newline becomes the grey", { c: "#d8b45a\n" }, "#8791b3");
  one("P1 a number becomes the grey", { c: 123456 }, "#8791b3");
  one("P1 a missing colour becomes the grey", { c: undefined }, "#8791b3");

  /* P2 */
  for (const slug of ['a"b', "a b", "../x", "A", "a/b", "", "a<b>", 7]) {
    const r = run([source({ slug }), source({ slug: "ok" })]);
    check(`P2 slug ${show(slug)} is left out and the next source stays`, !r.threw && r.v.length === 1 && r.v[0].slug === "ok", r.threw ? `threw ${r.threw}` : `got ${show(r.v && r.v.map((s) => s.slug))} (want ["ok"])`);
  }
  {
    const r = run([source({ slug: "sign-in2" })]);
    check("P2 a slug of letters, digits and dashes is kept", !r.threw && r.v.length === 1, r.threw ? `threw ${r.threw}` : `got ${r.v.length} sources (want 1)`);
  }

  /* P3 */
  for (const id of ['x"y', "a b", "x><b", "", "Top", 5, "über-orbit", "日本語", "section "]) {
    const r = run([source({ sections: [section(id), section("keep-me")] })]);
    const ids = r.v && r.v[0] ? r.v[0].sections.map((s) => s.id) : null;
    check(`P3 section id ${show(id)} is left out`, !r.threw && show(ids) === show(["keep-me"]), r.threw ? `threw ${r.threw}` : `got ${show(ids)} (want ["keep-me"])`);
  }

  /* P4 */
  {
    const r = run([source({ name: { a: 1 }, title: null })]);
    check("P4 a non-string name and title become strings", !r.threw && r.v[0].name === "" && r.v[0].title === "", r.threw ? `threw ${r.threw}` : `got ${show(r.v && [r.v[0].name, r.v[0].title])} (want ["",""])`);
  }

  /* P5 */
  {
    const input = [source(), source({ slug: "sign-in", name: "Sign-in", c: "#8fb8ff" })];
    const r = run(input);
    check("P5 valid sources come back as they were", !r.threw && show(r.v) === show(input), r.threw ? `threw ${r.threw}` : `got ${show(r.v).slice(0, 120)}...`);
  }

  /* P6 */
  {
    const input = [source({ c: "bad;" })];
    const before = show(input);
    run(input);
    check("P6 the input is not changed", show(input) === before, show(input) === before ? "unchanged" : "the input was changed");
    for (const v of [null, undefined, {}, "x", 3]) {
      const r = run(v);
      check(`P6 input ${show(v)} gives []`, !r.threw && Array.isArray(r.v) && r.v.length === 0, r.threw ? `threw ${r.threw}` : `got ${show(r.v)}`);
    }
  }
}

process.exit(failed ? 1 : 0);
