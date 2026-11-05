/*
 * The shape of a translated docs folder, assets/docs-i18n/<lang>/, as tools/ci/translate.mjs writes it (#125 stage
 * 2, spec 1 and 4): the English folder's shape (docs-shape.mjs's checkDocs) with one more key on each page and each
 * index entry, source, and no pictures of its own:
 *
 *   source is exactly {generated, sections, kept}: generated the English index's date the page was made from (an ISO
 *   date), sections the hash16 (16 lower-case hex) of each section's English, one per section of the page and no
 *   other, kept the ids of the sections left in English, each a section of the page, once;
 *   an index entry's source is its page's;
 *   no img/ folder: every <img src> is one of the English folder's pictures (assets/docs/img/) or the mark.
 *
 *   node tools/ci/docs-i18n-shape.mjs <dir> <sources.json> <english docs dir>   prints each problem, exits 1 if any
 *
 * Run by the lint on each language folder present, and by the publish job on the translate job's artifact.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDocs } from "./docs-shape.mjs";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const HASH = /^[0-9a-f]{16}$/, ISO = /^\d{4}-\d\d-\d\dT[\d:.]+Z$/;

/* the problems of one source object, for the page or entry `where` whose section ids are ids */
function sourceProblems(where, src, ids) {
  if (!isObj(src)) return [`${where}: source is not an object`];
  if (Object.keys(src).sort().join(",") !== "generated,kept,sections") return [`${where}: source does not have exactly generated, sections, kept`];
  const out = [];
  if (typeof src.generated !== "string" || !ISO.test(src.generated) || Number.isNaN(Date.parse(src.generated))) out.push(`${where}: source.generated is not an ISO date`);
  if (!isObj(src.sections)) out.push(`${where}: source.sections is not an object of section id to hash`);
  else {
    for (const [id, h] of Object.entries(src.sections)) {
      if (!ids.includes(id)) out.push(`${where}: source.sections names ${JSON.stringify(id).slice(0, 60)}, which no section has`);
      else if (typeof h !== "string" || !HASH.test(h)) out.push(`${where}: source.sections ${id}: the hash is not 16 lower-case hex`);
    }
    for (const id of ids) if (!Object.hasOwn(src.sections, id)) out.push(`${where}: source.sections has no hash for section ${id}`);
  }
  if (!Array.isArray(src.kept)) out.push(`${where}: source.kept is not a list`);
  else {
    const seen = new Set();
    for (const id of src.kept) {
      if (typeof id !== "string" || !ids.includes(id)) out.push(`${where}: source.kept names ${JSON.stringify(id).slice(0, 60)}, which no section has`);
      else if (seen.has(id)) out.push(`${where}: source.kept names ${id} twice`);
      seen.add(id);
    }
  }
  return out;
}

export function checkTranslated(dir, sources, englishDir) {
  const problems = checkDocs(dir, sources, { extraPageKeys: ["source"], pictures: join(englishDir, "img"), noImgDir: true });
  if (!Array.isArray(sources)) return problems;
  const read = (f) => { try { return JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { return null; } };
  const pages = {};
  for (const s of sources) {
    const f = `${s.slug}.json`, p = existsSync(join(dir, f)) ? read(f) : null;
    if (!isObj(p) || !Array.isArray(p.sections)) continue;
    pages[s.slug] = p;
    if (!Object.hasOwn(p, "source")) continue; /* checkDocs named it */
    problems.push(...sourceProblems(f, p.source, p.sections.map((x) => isObj(x) ? x.id : null)));
  }
  const idx = existsSync(join(dir, "index.json")) ? read("index.json") : null;
  if (isObj(idx) && Array.isArray(idx.sources)) idx.sources.forEach((e, k) => {
    const where = `index.json sources[${k}]`;
    if (!isObj(e) || !Object.hasOwn(e, "source")) return; /* checkDocs named it */
    const p = pages[e.slug];
    if (p && JSON.stringify(e.source) !== JSON.stringify(p.source)) problems.push(`${where}: source is not its page's (${e.slug}.json)`);
    else if (!p) problems.push(...sourceProblems(where, e.source, Array.isArray(e.sections) ? e.sections.map((x) => isObj(x) ? x.id : null) : []));
  });
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir, srcFile, englishDir] = process.argv.slice(2);
  if (!dir || !srcFile || !englishDir) { console.log("usage: node tools/ci/docs-i18n-shape.mjs <dir> <sources.json> <english docs dir>"); process.exit(1); }
  let sources;
  try { sources = JSON.parse(readFileSync(srcFile, "utf8")); } catch { console.log(`${srcFile} cannot be read as JSON`); process.exit(1); }
  const problems = checkTranslated(dir, sources, englishDir);
  for (const p of problems.slice(0, 20)) console.log(`   ${p}`);
  if (problems.length > 20) console.log(`   ... and ${problems.length - 20} more`);
  process.exit(problems.length ? 1 : 0);
}
