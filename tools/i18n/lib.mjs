/*
 * What the translation job (tools/ci/translate.mjs), the lint (tools/ci/i18n-check.mjs) and the publish job
 * (tools/ci/nightly-publish.sh, through i18n-check --catalogues) share about translated text (#125 stage 2):
 *
 *   - the catalogue rules: a catalogue has exactly en.json's keys, each a non-empty string with English's {holes}
 *     and bare inline tags; its state file (tools/i18n/state/<lang>.json) has exactly the catalogue's keys, each a
 *     16-hex hash, and a kept key (left in English after a failed check) holds English's value;
 *   - a translated docs section's derived fields (spec 2.3): text, the html's words (heading anchors and mermaid
 *     sources dropped, entities decoded, whitespace collapsed), and summary, those of the first paragraph, list or
 *     table after the heading, cut at a word before 170 characters with an ellipsis, as tools/import-docs.mjs cuts.
 *
 * Node's standard library only: the job that holds the API key runs no third-party code.
 */
export { hash16, sectionText } from "../../assets/js/hash.js";

export const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
export const tags = (s) => [...String(s).matchAll(/<\/?([a-zA-Z][\w-]*)\s*\/?>/g)].map((m) => m[0].replace(/\s+/g, "")).sort().join("");
export const HASH = /^[0-9a-f]{16}$/;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/* one catalogue value against its English: why it is refused, or "" */
export function valueProblem(enValue, value) {
  if (typeof value !== "string" || !value.trim()) return "is empty";
  if (holes(value) !== holes(enValue)) return `fills {${holes(value)}}, English {${holes(enValue)}} (placeholder holes differ)`;
  if (tags(value) !== tags(enValue)) return `has tags ${tags(value) || "none"}, English ${tags(enValue) || "none"}`;
  return "";
}

/* a catalogue (file names it in each line) against en.json */
export function catalogueProblems(en, cat, file) {
  if (!isObj(cat)) return [`${file}: not a JSON object of key to text`];
  const out = [];
  for (const k of Object.keys(en)) if (!Object.hasOwn(cat, k)) out.push(`${file}: no "${k}" (en.json has it)`);
  for (const k of Object.keys(cat)) {
    if (!Object.hasOwn(en, k)) { out.push(`${file}: "${k}" is not in en.json`); continue; }
    const why = valueProblem(en[k], cat[k]);
    if (why) out.push(`${file}: "${k}" ${why}`);
  }
  return out;
}

/* a state file against its catalogue and en.json */
export function stateProblems(en, cat, state, file, catFile) {
  if (!isObj(state) || Object.keys(state).sort().join(",") !== "catalogue,kept" || !isObj(state.catalogue) || !Array.isArray(state.kept)) {
    return [`${file}: not {"catalogue": {key: hash}, "kept": [key, ...]}`];
  }
  const out = [], keys = isObj(cat) ? Object.keys(cat) : [];
  for (const k of keys) if (!Object.hasOwn(state.catalogue, k)) out.push(`${file}: no hash for "${k}" (${catFile} has it)`);
  for (const [k, h] of Object.entries(state.catalogue)) {
    if (!keys.includes(k)) out.push(`${file}: "${k}" is not a key of ${catFile}`);
    else if (typeof h !== "string" || !HASH.test(h)) out.push(`${file}: the hash of "${k}" is not 16 lower-case hex`);
  }
  const seen = new Set();
  for (const k of state.kept) {
    if (typeof k !== "string" || !keys.includes(k)) { out.push(`${file}: kept ${JSON.stringify(k)} is not a key of ${catFile}`); continue; }
    if (seen.has(k)) out.push(`${file}: kept "${k}" twice`);
    seen.add(k);
    if (cat[k] !== en[k]) out.push(`${catFile}: "${k}" is kept in English (${file}) but differs from English`);
  }
  return out;
}

/* ---- derived fields (spec 2.3) ---- */
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
export const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => ENT[e.toLowerCase()] ?? (e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : m));
export const textOf = (html) => decode(String(html)
  .replace(/<a class="anchor"[^>]*>[\s\S]*?<\/a>/g, "")
  .replace(/<figure[^>]*data-mermaid[^>]*>[\s\S]*?<\/figure>/g, (f) => f.replace(/<pre[^>]*>[\s\S]*?<\/pre>/, ""))
  .replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
export const summaryOf = (html) => {
  const m = /<(p|ul|ol|table)\b[\s\S]*?<\/\1>/.exec(String(html).replace(/^\s*<h\d[\s\S]*?<\/h\d>/, ""));
  return (m ? textOf(m[0]) : "").slice(0, 170).replace(/\s\S*$/, (x, off, s) => (s.length >= 170 ? "…" : x));
};
