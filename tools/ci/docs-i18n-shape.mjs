/*
 * The shape of a translated docs folder, assets/docs-i18n/<lang>/, as tools/ci/translate.mjs writes it (#125 stage
 * 2, spec 1 and 4): the English folder's shape (docs-shape.mjs's checkDocs) with one more key on each page and each
 * index entry, source, one more on each section, en, and no pictures of its own:
 *
 *   en, each section's first key (of a page and of an index entry), is the hash16 (16 lower-case hex) of the English
 *   section it was made from (#145; the layout before it kept these in a table, source.sections, keyed by section id,
 *   which the secret scan took for leaked keys); an index entry's sections have their page's en;
 *   source is exactly {generated, kept}: generated the English index's date the page was made from (an ISO
 *   date), kept the ids of the sections left in English, each a section of the page, once;
 *   an index entry's source is its page's;
 *   no img/ folder: every <img src> is one of the English folder's pictures (assets/docs/img/) or the mark.
 *
 *   node tools/ci/docs-i18n-shape.mjs <dir> <sources.json> <english docs dir>   prints each problem, exits 1 if any
 *        [--same-english]   (publish_translations) every page made from exactly that English, not merely no later
 *   node tools/ci/docs-i18n-shape.mjs --lag                                     the lag, on the checkout: prints each
 *        page behind; exits 1 only for a page stamped later than the English
 *
 * A page's source.generated later than the English index's generated (in <english docs dir>/index.json) is a
 * problem of the shape: no translation is made from English that is not yet committed, so it is a wrong stamp or a
 * bad resume (#125 amendment 5).
 *
 * The lag (amendments 5 and 6, replacing spec 4's lint rule) is a freshness check on the data's own stamps against
 * the clock, never on git history: a page is behind when its source.generated is before the English's generated,
 * and stalled when it is behind and the English's generated is LAG_STALE_HOURS (36) hours ago or more. The clock is
 * $LAG_NOW when set (an ISO date, for tests). How far a translation trails is the nightly schedule's state, not
 * something a commit can break, so it is watched, never failed: publish_docs logs a page behind and puts a stalled
 * one in the "Docs import warnings" issue (the same rule, in nightly-publish.sh).
 *
 * Run by the lint on each language folder present, and by the publish job on the translate job's artifact.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDocs } from "./docs-shape.mjs";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const HASH = /^[0-9a-f]{16}$/, ISO = /^\d{4}-\d\d-\d\dT[\d:.]+Z$/;

/* the problems of the en of each section of the page or entry `where` (#145): the first key, 16 lower-case hex; and,
   given the page's sections for an index entry, its page's */
function enProblems(where, sections, page = null) {
  const out = [];
  sections.forEach((x, k) => {
    if (!isObj(x)) return; /* checkDocs named it */
    const at = `${where} sections[${k}]`;
    if (!Object.hasOwn(x, "en")) return out.push(`${at}: no en, the hash16 of the English it was made from`);
    if (typeof x.en !== "string" || !HASH.test(x.en)) return out.push(`${at}: en is not 16 lower-case hex`);
    if (Object.keys(x)[0] !== "en") out.push(`${at}: en is not the section's first key`);
    if (page && isObj(page[k]) && page[k].id === x.id && page[k].en !== x.en) out.push(`${at}: en is not its page's for section ${x.id}`);
  });
  return out;
}

/* the problems of one source object, for the page or entry `where` whose section ids are ids */
function sourceProblems(where, src, ids) {
  if (!isObj(src)) return [`${where}: source is not an object`];
  if (Object.hasOwn(src, "sections")) return [`${where}: source.sections is the layout before #145: each section carries its own en instead`];
  if (Object.keys(src).sort().join(",") !== "generated,kept") return [`${where}: source does not have exactly generated, kept`];
  const out = [];
  if (typeof src.generated !== "string" || !ISO.test(src.generated) || Number.isNaN(Date.parse(src.generated))) out.push(`${where}: source.generated is not an ISO date`);
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
  const problems = checkDocs(dir, sources, { extraPageKeys: ["source"], extraSectionKeys: ["en"], pictures: join(englishDir, "img"), noImgDir: true });
  if (!Array.isArray(sources)) return problems;
  const read = (f) => { try { return JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { return null; } };
  let english = null;
  try { english = JSON.parse(readFileSync(join(englishDir, "index.json"), "utf8")).generated; } catch { /* checkDocs of the English names it */ }
  /* --same-english compares each stamp with the English's: an English index.json that cannot be read is a problem here */
  if (sameEnglish && (typeof english !== "string" || !ISO.test(english))) problems.push(`${join(englishDir, "index.json")}: missing, not JSON or without a generated date: the translation's stamps cannot be compared with the English's`);
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
    problems.push(...enProblems(f, p.sections));
    problems.push(...sourceProblems(f, p.source, p.sections.map((x) => isObj(x) ? x.id : null)));
    later(f, p.source);
  }
  const idx = existsSync(join(dir, "index.json")) ? read("index.json") : null;
  if (isObj(idx) && Array.isArray(idx.sources)) idx.sources.forEach((e, k) => {
    const where = `index.json sources[${k}]`;
    if (!isObj(e)) return; /* checkDocs named it */
    const p = pages[e.slug];
    if (Array.isArray(e.sections)) problems.push(...enProblems(where, e.sections, p ? p.sections : null));
    if (!Object.hasOwn(e, "source")) return; /* checkDocs named it */
    if (p && JSON.stringify(e.source) !== JSON.stringify(p.source)) problems.push(`${where}: source is not its page's (${e.slug}.json)`);
    if (!p || JSON.stringify(e.source) !== JSON.stringify(p.source)) problems.push(...sourceProblems(where, e.source, Array.isArray(e.sections) ? e.sections.map((x) => isObj(x) ? x.id : null) : []));
  });
  return problems;
}

export const LAG_STALE_HOURS = 36;
/* the clock: $LAG_NOW when it is a date in the format of generated, else now, with a note when LAG_NOW is set but
   is not one (as nightly-publish.sh's reading of it) */
const LAG_NOW_FORMAT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
export function lagClock(env = process.env) {
  const v = typeof env.LAG_NOW === "string" ? env.LAG_NOW : "";
  const t = LAG_NOW_FORMAT.test(v) ? Date.parse(v) : NaN;
  if (Number.isFinite(t)) return { now: t, note: null };
  return { now: Date.now(), note: v ? "(LAG_NOW is not a date in the format of generated; the clock is used)" : null };
}
export const lagNow = (env = process.env) => lagClock(env).now;
/*
 * { behind, later, report } for every translated page under root: behind holds { file, lang, generated, stalled,
 * hours } for each page stamped before the committed English (hours: how long ago the English's generated was, by
 * the clock), later each page stamped after it (the one failure), report a line for each of both
 */
export function lagProblems(root, now = lagNow()) {
  const out = { behind: [], later: [], report: [] };
  const base = join(root, "assets/docs-i18n");
  if (!existsSync(base)) return out;
  let current;
  try { current = JSON.parse(readFileSync(join(root, "assets/docs/index.json"), "utf8")).generated; } catch { return out; }
  if (typeof current !== "string" || !ISO.test(current)) return out;
  const hours = Math.floor((now - Date.parse(current)) / 3600e3);
  for (const lang of readdirSync(base).sort()) {
    if (!existsSync(join(base, lang)) || !/^[a-z]{2,3}(-[A-Z][a-z]{3})?$/.test(lang)) continue;
    for (const f of readdirSync(join(base, lang)).sort()) {
      if (!f.endsWith(".json") || f === "index.json") continue;
      let g;
      try { g = JSON.parse(readFileSync(join(base, lang, f), "utf8")).source.generated; } catch { continue; } /* the shape check names it */
      if (typeof g !== "string" || !ISO.test(g)) continue;
      const file = `assets/docs-i18n/${lang}/${f}`;
      if (g > current) {
        out.later.push(file);
        out.report.push(`${file}: source.generated ${g} is later than the English's generated ${current}: a wrong stamp or a bad resume`);
      } else if (g < current) {
        const stalled = hours >= LAG_STALE_HOURS;
        out.behind.push({ file, lang, generated: g, stalled, hours });
        out.report.push(`${file}: behind the English, translated from ${g}; the English changed ${current}, ${hours} hours ago${stalled ? `: stalled (${LAG_STALE_HOURS} hours or more; publish_docs reports it in the warnings issue)` : ": the next translation run catches up"}`);
      }
    }
  }
  return out;
}

const main = process.argv[1] === fileURLToPath(import.meta.url);
if (main && process.argv[2] === "--lag") {
  let report = [], later = [];
  const clock = lagClock();
  if (clock.note) console.log(`   ${clock.note}`);
  try { ({ report, later } = lagProblems(process.cwd(), clock.now)); } catch (e) { console.log(`   (the lag could not be read: ${String(e && e.message).slice(0, 200)})`); }
  for (const l of report.slice(0, 40)) console.log(`   (reported) ${l}`);
  if (report.length > 40) console.log(`   ... and ${report.length - 40} more`);
  /* the one failure: every page stamped later than the English, named, however many */
  for (const p of later) console.log(`   ${p}: stamped later than the committed English's generated (a wrong stamp or a bad resume)`);
  process.exit(later.length ? 1 : 0);
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
