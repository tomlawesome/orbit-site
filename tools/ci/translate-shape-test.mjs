/*
 * Test for orbit-site #125 stage 2 (the translation job), written from the specification alone (issue #125, spec
 * section 4 "Lint and shape" and section 6, item 24):
 *
 *   node tools/ci/docs-i18n-shape.mjs <translated dir> <sources.json> <english docs dir>
 *
 * checks a language's folder of translated pages (assets/docs-i18n/<lang>/) as docs-shape.mjs checks English's, with
 * the extra page key `source` ({generated, kept: [id]}), the pictures those of the English
 * folder and no img/ folder of its own. Works on copies in a scratch folder. Since #145 each section (of a page and of an
 * index entry) carries its English's fingerprint itself, as its first field `en`, instead of a table in source.sections.
 *
 *   T24 accepts a well-formed folder; refuses an img/ folder, a page without source, a source of the wrong shape,
 *       an unknown id in source.kept, a hash that is not 16 lower hex, a picture that is not
 *       the English one, an index entry without source, and still the English shape's own rules: a loosened check
 *       lets one of them through
 *
 *   T48 (#145) refuses a section (page or index entry) without en, an en that is not 16 lower-case hex, any source.sections
 *       key, and a page in the layout before #145; accepts an en of sixteen zeros (the retry hash) and the committed
 *       secret-scan fixture is in the new layout
 *
 *   node tools/ci/translate-shape-test.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { T, REPO, mkFixture, oldLayout } from "./translate-fixture.mjs";

const TOOL = join(REPO, "tools/ci/docs-i18n-shape.mjs");
const shape = (fx) => {
  if (!existsSync(TOOL)) return { status: -1, text: "not built yet: tools/ci/docs-i18n-shape.mjs" };
  const r = spawnSync(process.execPath, [TOOL, fx.at("assets/docs-i18n/de"), fx.at("tools/docs-sources.json"), fx.at("assets/docs")], { encoding: "utf8" });
  return { status: r.status, text: `${r.stdout}${r.stderr}` };
};
const edit = (fx, file, fn) => { const f = fx.at(`assets/docs-i18n/de/${file}`), j = JSON.parse(readFileSync(f, "utf8")); fn(j); writeFileSync(f, JSON.stringify(j)); };
const fresh = () => { const fx = mkFixture(); fx.translated("de"); return fx; };

await T.attempt("T24", async () => {
  { const fx = fresh(), r = shape(fx);
    T.check("T24a the well-formed folder is accepted", r.status === 0, r.status === -1 ? r.text : `exit ${r.status}: ${r.text.slice(0, 200)}`); fx.cleanup(); }
  const refuses = (name, mutate, want) => {
    const fx = fresh();
    try { mutate(fx); const r = shape(fx);
      T.check(`T24 refuses ${name}`, r.status === 1 && want.test(r.text), r.status === -1 ? r.text : `exit ${r.status}, want 1 naming ${want}; got ${r.text.slice(0, 160).replace(/\n/g, " | ")}`);
    } finally { fx.cleanup(); }
  };
  refuses("an img/ folder", (fx) => { mkdirSync(fx.at("assets/docs-i18n/de/img")); writeFileSync(fx.at("assets/docs-i18n/de/img/0123456789abcdef.png"), "x"); }, /img/);
  refuses("a page without source", (fx) => edit(fx, "readme.json", (j) => { delete j.source; }), /source/);
  refuses("a source that is not an object", (fx) => edit(fx, "readme.json", (j) => { j.source = "x"; }), /source/);
  refuses("a source with an extra key", (fx) => edit(fx, "readme.json", (j) => { j.source.extra = 1; }), /source/);
  refuses("a source with no kept", (fx) => edit(fx, "readme.json", (j) => { delete j.source.kept; }), /source|kept/);
  refuses("a kept that is not a list", (fx) => edit(fx, "readme.json", (j) => { j.source.kept = "top"; }), /kept|source/);
  refuses("a source.generated that is not a date", (fx) => edit(fx, "readme.json", (j) => { j.source.generated = "yesterday"; }), /generated|source/);
  refuses("an unknown id in source.kept", (fx) => edit(fx, "readme.json", (j) => { j.source.kept = ["ghost"]; }), /ghost|kept/);
  refuses("a source.sections key (the table before #145)", (fx) => edit(fx, "readme.json", (j) => { j.source.sections = {}; }), /source\.sections/);
  refuses("a section without en", (fx) => edit(fx, "readme.json", (j) => { delete j.sections.find((x) => x.id === "top").en; }), /\ben\b/);
  refuses("an en of 15 hex", (fx) => edit(fx, "readme.json", (j) => { j.sections.find((x) => x.id === "top").en = "0123456789abcde"; }), /\ben\b/);
  refuses("an en in capitals", (fx) => edit(fx, "readme.json", (j) => { j.sections.find((x) => x.id === "top").en = "0123456789ABCDEF"; }), /\ben\b/);
  refuses("an en that is not hex", (fx) => edit(fx, "readme.json", (j) => { j.sections.find((x) => x.id === "top").en = "0123456789abcdeg"; }), /\ben\b/);
  refuses("a picture that is not one of the English folder's", (fx) => edit(fx, "readme.json", (j) => { const s = j.sections.find((x) => x.id === "shot"); s.html = s.html.replace(/assets\/docs\/img\/[0-9a-f]{16}\.png/, "assets/docs/img/ffffffffffffffff.png"); }), /picture|img|shot/);
  refuses("an index entry without source", (fx) => edit(fx, "index.json", (j) => { delete j.sources[0].source; }), /source|index/);
  refuses("a page that is not a source's", (fx) => writeFileSync(fx.at("assets/docs-i18n/de/stray.json"), "{}"), /stray|not a file/);
  refuses("a section with a key the shape does not have", (fx) => edit(fx, "guide.json", (j) => { j.sections[0].onclick = "x"; }), /sections\[0\]|onclick/);
  refuses("a changed page colour", (fx) => edit(fx, "guide.json", (j) => { j.c = "#000000"; }), /\bc is\b/);
});

/* #145 */
await T.attempt("T48", async () => {
  const top = (j) => j.sections.find((x) => x.id === "top"), entry = (j) => j.sources.find((e) => e.slug === "readme");
  const refuses = (name, file, mutate, want) => {
    const fx = fresh();
    try { edit(fx, file, mutate); const r = shape(fx);
      T.check(`T48 refuses ${name}`, r.status === 1 && want.test(r.text), r.status === -1 ? r.text : `exit ${r.status}, want 1 naming ${want}; got ${r.text.slice(0, 160).replace(/\n/g, " | ")}`);
    } finally { fx.cleanup(); }
  };
  const EN = /\ben\b/;
  refuses("a page section whose en is a number", "readme.json", (j) => { top(j).en = 123456789012345; }, EN);
  refuses("a page section whose en is empty", "readme.json", (j) => { top(j).en = ""; }, EN);
  refuses("a page section whose en is 17 hex", "readme.json", (j) => { top(j).en = "0123456789abcdef0"; }, EN);
  refuses("an en with a space inside", "readme.json", (j) => { top(j).en = "01234567 89abcde"; }, EN);
  refuses("an index entry's section without en", "index.json", (j) => { delete entry(j).sections[0].en; }, EN);
  refuses("an index entry's section with an en of 15 hex", "index.json", (j) => { entry(j).sections[0].en = "0123456789abcde"; }, EN);
  refuses("an index entry's section with an en in capitals", "index.json", (j) => { entry(j).sections[0].en = "0123456789ABCDEF"; }, EN);
  refuses("an index entry's source with a sections key", "index.json", (j) => { entry(j).source.sections = {}; }, /source\.sections/);
  refuses("a source.sections table with the hashes in it, beside a valid en in every section", "readme.json", (j) => { j.source.sections = Object.fromEntries(j.sections.map((x) => [x.id, x.en])); }, /source\.sections/);
  refuses("a page in the layout before #145 (no en, a source.sections table)", "readme.json", (j) => { const o = oldLayout(j); for (const k of Object.keys(j)) delete j[k]; Object.assign(j, o); }, EN);
  { const fx = fresh();
    try { edit(fx, "readme.json", (j) => { top(j).en = "0000000000000000"; });
      edit(fx, "index.json", (j) => { entry(j).sections.find((x) => x.id === "top").en = "0000000000000000"; });
      const r = shape(fx);
      T.check("T48 accepts an en of sixteen zeros (the retry hash: a section left in English is still 16 lower hex)", r.status === 0, r.status === -1 ? r.text : `exit ${r.status}: ${r.text.slice(0, 200)}`);
    } finally { fx.cleanup(); } }
  { /* the committed fixture of the secret scan (a section id ending in "key" beside an en) is in the new layout */
    const f = join(REPO, "tests/fixtures/docs-i18n-secret-scan-145/de-security.json");
    let j = null; try { j = JSON.parse(readFileSync(f, "utf8")); } catch { /* checked below */ }
    const keyed = j && j.sections.filter((x) => /key$/.test(x.id));
    T.check("T48 the secret-scan fixture page is in the new layout: en first, 16 lower hex, no source.sections, a section id ending in key", !!j && keyed.length > 0 && j.sections.every((x) => Object.keys(x)[0] === "en" && /^[0-9a-f]{16}$/.test(x.en)) && !("sections" in j.source), j ? `${keyed.length} key section(s)` : "tests/fixtures/docs-i18n-secret-scan-145/de-security.json missing or not JSON"); }
});
T.done();
