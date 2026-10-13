/*
 * Test for tools/ci/docs-shape.mjs (#18): the committed assets/docs/ passes,
 * and each way a page or the index could carry something the import does not
 * write is refused and named. Works on copies in a scratch directory.
 *
 *   node tools/ci/docs-shape-test.mjs
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkDocs } from "./docs-shape.mjs";

let failed = false;
const check = (name, ok, detail) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: ${detail}`}`); if (!ok) failed = true; };

const sources = JSON.parse(readFileSync("tools/docs-sources.json", "utf8"));
const tmp = mkdtempSync(join(tmpdir(), "docs-shape-"));
let n = 0;
const fresh = () => { const d = join(tmp, String(n++)); cpSync("assets/docs", d, { recursive: true }); return d; };
const edit = (d, file, fn) => { const f = join(d, file), j = JSON.parse(readFileSync(f, "utf8")); fn(j); writeFileSync(f, JSON.stringify(j)); };
const refuses = (name, mutate, want) => {
  const d = fresh(); mutate(d);
  const p = checkDocs(d, sources);
  check(name, p.length > 0 && p.some((x) => x.includes(want)), `want a problem naming "${want}", got ${JSON.stringify(p.slice(0, 3))}`);
};

check("the committed assets/docs has the shape", checkDocs("assets/docs", sources).length === 0, JSON.stringify(checkDocs("assets/docs", sources).slice(0, 3)));

refuses("an index colour with a quote and markup", (d) => edit(d, "index.json", (j) => { j.sources[0].c = '#fff"><img src=x onerror=alert(1)>'; }), "index.json sources[0]: c is");
refuses("an index colour that is a style escape", (d) => edit(d, "index.json", (j) => { j.sources[2].c = "red;background:url(//x.invalid/a)"; }), "sources[2]: c is");
refuses("a page colour changed", (d) => edit(d, "readme.json", (j) => { j.c = "#000000"; }), "readme.json: c is");
refuses("a slug changed in the index", (d) => edit(d, "index.json", (j) => { j.sources[1].slug = 'x"y'; }), "slug is");
refuses("a name changed in the index", (d) => edit(d, "index.json", (j) => { j.sources[1].name = "<b>x</b>"; }), "name is");
refuses("a repo changed in a page", (d) => edit(d, "security.json", (j) => { j.repo = "evil/repo"; }), "repo is");
refuses("a path changed in a page", (d) => edit(d, "security.json", (j) => { j.path = "../x"; }), "path is");
refuses("a section id with a quote", (d) => edit(d, "index.json", (j) => { j.sources[0].sections[0].id = 'a"b'; }), "sections[0].id");
refuses("a section id in a page with a space", (d) => edit(d, "readme.json", (j) => { j.sections[1].id = "a b"; }), "sections[1].id");
refuses("a sub id with markup", (d) => edit(d, "index.json", (j) => { const s = j.sources[0].sections.find((x) => x.subs.length); s.subs[0].id = "<x>"; }), "subs[0].id");
refuses("a section id with an accented letter (the importer once wrote these)", (d) => edit(d, "index.json", (j) => { j.sources[0].sections[0].id = "über-orbit"; }), "sections[0].id");
refuses("an empty section id in a page", (d) => edit(d, "readme.json", (j) => { j.sections[0].id = ""; }), "sections[0].id");
refuses("a sub id with an accented letter", (d) => edit(d, "index.json", (j) => { const s = j.sources[0].sections.find((x) => x.subs.length); s.subs[0].id = "café"; }), "subs[0].id");
refuses("a page with no sections", (d) => edit(d, "readme.json", (j) => { j.sections = []; }), "readme.json: sections is");
refuses("an index entry with no sections", (d) => edit(d, "index.json", (j) => { j.sources[2].sections = []; }), "sources[2]: sections is");
{
  /* one section is the least a page or an entry may have: the chart draws from at least one */
  const d = fresh();
  edit(d, "readme.json", (j) => { j.sections = [j.sections[0]]; });
  edit(d, "index.json", (j) => { j.sources[0].sections = [j.sources[0].sections[0]]; });
  const p = checkDocs(d, sources);
  check("a page and an entry with a single section", p.length === 0, JSON.stringify(p.slice(0, 3)));
}
refuses("an extra key in a section", (d) => edit(d, "readme.json", (j) => { j.sections[0].onclick = "x"; }), "sections[0]");
refuses("an extra key in the index", (d) => edit(d, "index.json", (j) => { j.extra = 1; }), "index.json: does not have exactly");
refuses("a non-string title", (d) => edit(d, "readme.json", (j) => { j.sections[0].title = { a: 1 }; }), "title is not a string");
refuses("generated that is not a date", (d) => edit(d, "index.json", (j) => { j.generated = "<script>"; }), "generated is not an ISO date");
refuses("fewer sources in the index", (d) => edit(d, "index.json", (j) => { j.sources.pop(); }), "sources is not a list of");
refuses("a page that is not JSON", (d) => writeFileSync(join(d, "readme.json"), "{"), "readme.json: not JSON");
refuses("a page that is an array", (d) => writeFileSync(join(d, "readme.json"), "[]"), "not a JSON object");
refuses("a file the import does not write", (d) => writeFileSync(join(d, "extra.json"), "{}"), "extra.json: not a file the import writes");
refuses("a page missing", (d) => unlinkSync(join(d, "security.json")), "security.json: missing");
refuses("a page that is a symlink", (d) => { unlinkSync(join(d, "security.json")); symlinkSync("/etc/hostname", join(d, "security.json")); }, "security.json: not a regular file");

/* One colour rule (audit 4): a source's colour is "#" and six hex digits in either case, here and in the docs pad
   (assets/js/pads.js). `recolour` sets one colour in the index entry, in the page, and in the sources list passed in, so a
   colour the rule accepts is not refused for the three disagreeing. */
const recoloured = (c) => {
  const d = fresh();
  edit(d, "index.json", (j) => { j.sources[0].c = c; });
  edit(d, "readme.json", (j) => { j.c = c; });
  const list = JSON.parse(JSON.stringify(sources));
  list[0].c = c;
  return checkDocs(d, list);
};
for (const c of ["#a1b2c3", "#A1B2C3", "#a1B2c3"]) {
  const p = recoloured(c);
  check(`the colour ${c} is accepted${c === "#a1b2c3" ? " (control: lower case passes today)" : ""}`, p.length === 0, `want no problems, got ${JSON.stringify(p.slice(0, 3))}`);
}
for (const c of ["#abc", "#abcdeg", "abcdef", "#abcdef0", ""]) {
  refuses(`the colour ${JSON.stringify(c)} is refused (control: refused today)`, (d) => edit(d, "index.json", (j) => { j.sources[0].c = c; }), "index.json sources[0]: c is");
}

rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
