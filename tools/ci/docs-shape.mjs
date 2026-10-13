/*
 * The shape of assets/docs/, as tools/import-docs.mjs writes it. Two readers
 * rely on it: tools/ci/lint.sh, on what is committed, and the publish job
 * (tools/ci/nightly-publish.sh), on an artifact that came out of a job that ran
 * third-party code. The pad draws the index's colour, slugs and ids into
 * innerHTML (assets/js/pads.js), so they must be what the import writes:
 *
 *   the files are exactly <slug>.json for each source in tools/docs-sources.json,
 *   and index.json;
 *   a page has the keys slug, name, c, title, repo, path and sections, at least
 *   one; slug, name, c, repo and path are the source's own, and c is "#" and six
 *   hex digits;
 *   a section has the keys id, title, html, summary, text and subs; ids (and the
 *   ids of subs) are lower-case letters, digits and dashes;
 *   the index has the keys generated (a date) and sources: one entry per source,
 *   in order, with the page's keys but no html, and the same slug, name, c, repo
 *   and path.
 *
 *   node tools/ci/docs-shape.mjs <docs dir> <sources.json>   prints each problem, exits 1 if any
 *
 * What a section's html may contain is the lint's separate "no script" check.
 */
import { readdirSync, readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ID = /^[a-z0-9-]+$/;
const COLOUR = /^#[0-9a-f]{6}$/;
const MAX_SECTIONS = 300, MAX_SUBS = 300, MAX_TEXT = 1_000_000;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const sameKeys = (o, want) => {
  const have = Object.keys(o).sort().join(","), need = [...want].sort().join(",");
  return have === need;
};

export function checkDocs(dir, sources) {
  const problems = [];
  const bad = (m) => problems.push(m);
  if (!Array.isArray(sources) || !sources.length || sources.some((s) => !isObj(s) || !ID.test(s.slug || "") || !COLOUR.test(s.c || ""))) {
    return ["the sources file is not a list of sources with a slug and a colour"];
  }
  const want = new Set([...sources.map((s) => `${s.slug}.json`), "index.json"]);
  let have;
  try { have = readdirSync(dir); } catch { return [`${dir} cannot be read`]; }
  for (const f of have) if (!want.has(f)) bad(`${f}: not a file the import writes`);
  for (const f of want) if (!have.includes(f)) bad(`${f}: missing`);

  const load = (f) => {
    if (!have.includes(f) || !want.has(f)) return null;
    try {
      if (!lstatSync(join(dir, f)).isFile()) { bad(`${f}: not a regular file`); return null; }
      const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (!isObj(j)) { bad(`${f}: not a JSON object`); return null; }
      return j;
    } catch { bad(`${f}: not JSON`); return null; }
  };
  const str = (f, where, v) => { if (typeof v !== "string") { bad(`${f}: ${where} is not a string`); return false; } if (v.length > MAX_TEXT) { bad(`${f}: ${where} is too long`); return false; } return true; };
  const subs = (f, where, list) => {
    if (!Array.isArray(list) || list.length > MAX_SUBS) return bad(`${f}: ${where}.subs is not a short list`);
    list.forEach((x, k) => {
      if (!isObj(x) || !sameKeys(x, ["id", "title"])) return bad(`${f}: ${where}.subs[${k}] does not have exactly id and title`);
      if (typeof x.id !== "string" || !ID.test(x.id)) bad(`${f}: ${where}.subs[${k}].id is not lower-case letters, digits and dashes`);
      str(f, `${where}.subs[${k}].title`, x.title);
    });
  };
  const sections = (f, list, withHtml) => {
    /* at least one: a source with nothing to chart, search or read is an import that went wrong (an empty or
       heading-only file, or every section skipped), not a page */
    if (!Array.isArray(list) || !list.length || list.length > MAX_SECTIONS) return bad(`${f}: sections is not a list of 1 to ${MAX_SECTIONS}`);
    const keys = withHtml ? ["id", "title", "html", "summary", "text", "subs"] : ["id", "title", "summary", "text", "subs"];
    list.forEach((s, k) => {
      const where = `sections[${k}]`;
      if (!isObj(s) || !sameKeys(s, keys)) return bad(`${f}: ${where} does not have exactly ${keys.join(", ")}`);
      if (typeof s.id !== "string" || !ID.test(s.id)) bad(`${f}: ${where}.id is not lower-case letters, digits and dashes`);
      for (const key of ["title", "summary", "text", ...(withHtml ? ["html"] : [])]) str(f, `${where}.${key}`, s[key]);
      subs(f, where, s.subs);
    });
  };
  const head = (f, p, src) => {
    for (const key of ["slug", "name", "c", "repo", "path"]) {
      if (p[key] !== src[key]) bad(`${f}: ${key} is ${JSON.stringify(String(p[key])).slice(0, 60)}, want the source's ${JSON.stringify(src[key])}`);
    }
    str(f, "title", p.title);
  };
  const pageKeys = ["slug", "name", "c", "title", "repo", "path", "sections"];

  for (const src of sources) {
    const f = `${src.slug}.json`, p = load(f);
    if (!p) continue;
    if (!sameKeys(p, pageKeys)) { bad(`${f}: does not have exactly ${pageKeys.join(", ")}`); continue; }
    head(f, p, src);
    sections(f, p.sections, true);
  }
  const idx = load("index.json");
  if (idx) {
    const f = "index.json";
    if (!sameKeys(idx, ["generated", "sources"])) bad(`${f}: does not have exactly generated, sources`);
    else {
      if (typeof idx.generated !== "string" || !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(idx.generated) || Number.isNaN(Date.parse(idx.generated))) bad(`${f}: generated is not an ISO date`);
      if (!Array.isArray(idx.sources) || idx.sources.length !== sources.length) bad(`${f}: sources is not a list of ${sources.length}`);
      else idx.sources.forEach((e, k) => {
        const g = `${f} sources[${k}]`;
        if (!isObj(e) || !sameKeys(e, pageKeys)) return bad(`${g} does not have exactly ${pageKeys.join(", ")}`);
        head(g, e, sources[k]);
        sections(g, e.sections, false);
      });
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir, srcFile] = process.argv.slice(2);
  let sources;
  try { sources = JSON.parse(readFileSync(srcFile, "utf8")); } catch { console.log(`${srcFile} cannot be read as JSON`); process.exit(1); }
  const problems = checkDocs(dir, sources);
  for (const p of problems.slice(0, 20)) console.log(`   ${p}`);
  if (problems.length > 20) console.log(`   ... and ${problems.length - 20} more`);
  process.exit(problems.length ? 1 : 0);
}
