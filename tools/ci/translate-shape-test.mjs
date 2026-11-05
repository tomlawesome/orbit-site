/*
 * Test for orbit-site #125 stage 2 (the translation job), written from the specification alone (issue #125, spec
 * section 4 "Lint and shape" and section 6, item 24):
 *
 *   node tools/ci/docs-i18n-shape.mjs <translated dir> <sources.json> <english docs dir>
 *
 * checks a language's folder of translated pages (assets/docs-i18n/<lang>/) as docs-shape.mjs checks English's, with
 * the extra page key `source` ({generated, sections: {id: hash16}, kept: [id]}), the pictures those of the English
 * folder and no img/ folder of its own. Works on copies in a scratch folder.
 *
 *   T24 accepts a well-formed folder; refuses an img/ folder, a page without source, a source of the wrong shape,
 *       an unknown id in source.kept or source.sections, a hash that is not 16 lower hex, a picture that is not
 *       the English one, an index entry without source, and still the English shape's own rules: a loosened check
 *       lets one of them through
 *
 *   node tools/ci/translate-shape-test.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { T, REPO, mkFixture } from "./translate-fixture.mjs";

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
  refuses("an unknown id in source.sections", (fx) => edit(fx, "readme.json", (j) => { j.source.sections.ghost = "0123456789abcdef"; }), /ghost|sections/);
  refuses("a section missing from source.sections", (fx) => edit(fx, "readme.json", (j) => { delete j.source.sections.top; }), /top|sections|source/);
  refuses("a hash of 15 hex", (fx) => edit(fx, "readme.json", (j) => { j.source.sections.top = "0123456789abcde"; }), /hash|source|top/);
  refuses("a hash in capitals", (fx) => edit(fx, "readme.json", (j) => { j.source.sections.top = "0123456789ABCDEF"; }), /hash|source|top/);
  refuses("a hash that is not hex", (fx) => edit(fx, "readme.json", (j) => { j.source.sections.top = "0123456789abcdeg"; }), /hash|source|top/);
  refuses("a picture that is not one of the English folder's", (fx) => edit(fx, "readme.json", (j) => { const s = j.sections.find((x) => x.id === "shot"); s.html = s.html.replace(/assets\/docs\/img\/[0-9a-f]{16}\.png/, "assets/docs/img/ffffffffffffffff.png"); }), /picture|img|shot/);
  refuses("an index entry without source", (fx) => edit(fx, "index.json", (j) => { delete j.sources[0].source; }), /source|index/);
  refuses("a page that is not a source's", (fx) => writeFileSync(fx.at("assets/docs-i18n/de/stray.json"), "{}"), /stray|not a file/);
  refuses("a section with a key the shape does not have", (fx) => edit(fx, "guide.json", (j) => { j.sections[0].onclick = "x"; }), /sections\[0\]|onclick/);
  refuses("a changed page colour", (fx) => edit(fx, "guide.json", (j) => { j.c = "#000000"; }), /\bc is\b/);
});
T.done();
