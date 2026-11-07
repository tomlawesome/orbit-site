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
 *        [--same-english]   (publish_translations) every page made from exactly that English, not merely no later
 *   node tools/ci/docs-i18n-shape.mjs --lag                                     the lag, on the checkout
 *
 * A page's source.generated later than the English index's generated (in <english docs dir>/index.json) is a
 * problem of the shape: no translation is made from English that is not yet committed, so it is a wrong stamp or a
 * bad resume (#125 amendment 5).
 *
 * The lag (amendment 5, replacing spec 4's lint rule): a translated page is made from the English of its
 * source.generated; the imports since are the distinct generated dates assets/docs/index.json has had in git
 * history after it. How far a translation trails is the nightly schedule's state, not something a commit can break,
 * so it is watched, never failed: --lag prints each page behind and always exits 0, and publish_docs puts a page two
 * or more imports behind in the "Docs import warnings" issue (counting the same way, in nightly-publish.sh). Without git history (a shallow clone) only "behind" is
 * known.
 *
 * Run by the lint on each language folder present, and by the publish job on the translate job's artifact.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

export function checkTranslated(dir, sources, englishDir, { sameEnglish = false } = {}) {
  const problems = checkDocs(dir, sources, { extraPageKeys: ["source"], pictures: join(englishDir, "img"), noImgDir: true });
  if (!Array.isArray(sources)) return problems;
  const read = (f) => { try { return JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { return null; } };
  let english = null;
  try { english = JSON.parse(readFileSync(join(englishDir, "index.json"), "utf8")).generated; } catch { /* checkDocs of the English names it */ }
  const later = (where, src) => {
    if (!isObj(src) || typeof english !== "string" || typeof src.generated !== "string" || !ISO.test(src.generated)) return;
    if (src.generated > english) problems.push(`${where}: source.generated ${src.generated} is later than the English's generated ${english}: no translation is made from English not yet committed (a wrong stamp or a bad resume)`);
    else if (sameEnglish && src.generated !== english) problems.push(`${where}: source.generated ${src.generated} is not the English's generated ${english}: the translation was made from other English than this checkout's`);
  };
  const pages = {};
  for (const s of sources) {
    const f = `${s.slug}.json`, p = existsSync(join(dir, f)) ? read(f) : null;
    if (!isObj(p) || !Array.isArray(p.sections)) continue;
    pages[s.slug] = p;
    if (!Object.hasOwn(p, "source")) continue; /* checkDocs named it */
    problems.push(...sourceProblems(f, p.source, p.sections.map((x) => isObj(x) ? x.id : null)));
    later(f, p.source);
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

/* the English index's generated dates newer than since, newest first, from git history (null: no history) */
function importsAfter(root, since) {
  const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 });
  let shas;
  try {
    if (git("rev-parse", "--is-shallow-repository").trim() !== "false") return null; /* a shallow clone cannot count them */
    shas = git("log", "--format=%H", "--", "assets/docs/index.json").split("\n").filter(Boolean);
  } catch { return null; }
  if (!shas.length) return null;
  const seen = [];
  for (const sha of shas) {
    let g;
    try { g = JSON.parse(git("show", `${sha}:assets/docs/index.json`)).generated; } catch { continue; }
    if (typeof g !== "string") continue;
    if (g <= since) break;
    if (!seen.includes(g)) seen.push(g);
  }
  return seen;
}

/* { behind: [...], report: [...] } for every translated page under root that trails the committed English: behind
   holds { file, lang, generated, imports } (imports null without history), report a line for each */
export function lagProblems(root) {
  const out = { behind: [], report: [] };
  const base = join(root, "assets/docs-i18n");
  if (!existsSync(base)) return out;
  let current;
  try { current = JSON.parse(readFileSync(join(root, "assets/docs/index.json"), "utf8")).generated; } catch { return out; }
  const pages = [];
  for (const lang of readdirSync(base).sort()) {
    if (!existsSync(join(base, lang)) || !/^[a-z]{2,3}(-[A-Z][a-z]{3})?$/.test(lang)) continue;
    for (const f of readdirSync(join(base, lang)).sort()) {
      if (!f.endsWith(".json") || f === "index.json") continue;
      let g;
      try { g = JSON.parse(readFileSync(join(base, lang, f), "utf8")).source.generated; } catch { continue; } /* the shape check names it */
      if (typeof g === "string" && g < current) pages.push([`assets/docs-i18n/${lang}/${f}`, g]);
    }
  }
  if (!pages.length) return out;
  const oldest = pages.reduce((m, [, g]) => (g < m ? g : m), current);
  const after = importsAfter(root, oldest);
  for (const [f, g] of pages) {
    const n = after === null ? null : after.filter((x) => x > g).length;
    out.behind.push({ file: f, lang: f.split("/")[2], generated: g, imports: n });
    if (n === null) out.report.push(`${f}: translated from the English of ${g}, older than the English's ${current} (no git history to count the imports since)`);
    else if (n >= 2) out.report.push(`${f}: translated from the English of ${g}, ${n} imports behind the English (${current}); one is the nightly order, two or more mean the translation job has not kept up (publish_docs reports it in the warnings issue)`);
    else if (n === 1) out.report.push(`${f}: translated from the English of ${g}, one import behind (${current}): the next translation run catches up`);
  }
  return out;
}

const main = process.argv[1] === fileURLToPath(import.meta.url);
if (main && process.argv[2] === "--lag") {
  let report = [];
  try { ({ report } = lagProblems(process.cwd())); } catch (e) { console.log(`   (the lag could not be read: ${String(e && e.message).slice(0, 200)})`); }
  for (const l of report.slice(0, 40)) console.log(`   (reported) ${l}`);
  if (report.length > 40) console.log(`   ... and ${report.length - 40} more`);
  process.exit(0);
} else if (main) {
  const [dir, srcFile, englishDir, flag] = process.argv.slice(2);
  if (!dir || !srcFile || !englishDir || (flag !== undefined && flag !== "--same-english")) { console.log("usage: node tools/ci/docs-i18n-shape.mjs <dir> <sources.json> <english docs dir> [--same-english]"); process.exit(1); }
  let sources;
  try { sources = JSON.parse(readFileSync(srcFile, "utf8")); } catch { console.log(`${srcFile} cannot be read as JSON`); process.exit(1); }
  const problems = checkTranslated(dir, sources, englishDir, { sameEnglish: flag === "--same-english" });
  for (const p of problems.slice(0, 20)) console.log(`   ${p}`);
  if (problems.length > 20) console.log(`   ... and ${problems.length - 20} more`);
  process.exit(problems.length ? 1 : 0);
}
