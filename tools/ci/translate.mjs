/*
 * The translation job (#125 stage 2): the site's catalogue (assets/i18n/en.json) and the imported docs
 * (assets/docs/) in each language of tools/i18n/languages.json, by the Claude API's Message Batches, sending only what
 * changed since the stored hash of the English each translation was made from.
 *
 *   node tools/ci/translate.mjs [--langs de,fr] [--only site|docs] [--dry-run] [--max-tokens N]
 *        [--out DIR] [--report FILE] [--poll-seconds 60] [--timeout-minutes 50] [--api-base URL]
 *        [--resume TOKEN]   (or TRANSLATE_BATCH_ID=TOKEN in the environment)
 *
 * Patterns: a content-hash incremental build (each translated item carries hash16 of its English; only a changed
 * hash is sent again); schema-constrained output with post-validation (structured JSON out, the mechanical checks of
 * spec 2.2, one bounded retry with the broken rules named, then the English kept and reported); prefix caching (one
 * frozen system block, the volatile text after it); a hard spend ceiling before work starts (the estimate is printed
 * and checked against the cap before anything is sent; --dry-run needs no key and sends nothing).
 *
 * The key is read from the environment (ANTHROPIC_API_KEY) and nowhere else: never an argument, never printed,
 * sent only as the x-api-key header, and only to --api-base's own origin (a results URL elsewhere is refused, and a
 * redirect is never followed). The job that runs this holds the key, so it runs no third-party code: Node's standard
 * library and fetch, raw HTTP. Every call has a time limit and every answer a size limit (LIMITS).
 *
 * Writes, under --out (default the checkout): assets/i18n/<lang>.json and tools/i18n/state/<lang>.json, and
 * assets/docs-i18n/<lang>/<slug>.json and index.json (spec 1); and the report (default translate-report.json).
 * A file whose content would not change is not rewritten.
 *
 * Requests go out as one Message Batch with custom_ids r0000-<key>, r0001-<key>, ... (the index in the run's request
 * list, which is in language order and then plan order, and the idempotency key: the first 12 hex of the run's
 * digest, the same in the retry round); results are mapped back by custom_id, never by position. Submit, then
 * poll with a resumable job id (spec amendment 1): a batch not ended within --timeout-minutes is left running, a
 * resume token printed, exit 5. The token is <batch>.<digest> (round 1) or <round-1 batch>.<round-2 batch>.<digest>
 * (the retry round), the digest being hash16 of the round-1 request list with bare ids (r0000, ...; the params: the
 * English, the prompt, the model). A later run with --resume <token> or TRANSLATE_BATCH_ID=<token> submits nothing for those
 * batches, rebuilds the request list, refuses it unless its digest is the token's (so a translation of other English
 * is never stamped with this English's hash), checks the batch holds its ids and finishes from the results, round
 * 1's included. A bare batch id is taken only when this machine's record (~/.cache/orbit-translate/batches.json,
 * written when a batch is made, dropped once its results are read or prove unusable (exit 4); records older than
 * 29 days, the API's keeping of results, are pruned on read, and a file over 1 MiB is refused) gives its digest.
 *
 * One batch at a time is paid for: a run with no token takes up a batch its machine's record holds for the same
 * request list, running or ended with its results unread; failing that, it lists the key's batches and submits
 * nothing while one is in progress (exit 5), and takes up the newest ended one when it holds exactly this many
 * requests, all succeeded, made after this English (a CI runner keeps no record). A create whose answer was lost
 * looks for the batch it made before trying again. The retry round counts against the same cap as the first (exit
 * 3 before it is submitted, nothing written); a retry batch already made and taken up is never stopped by it.
 *
 * An item that failed for the API's reasons (errored, expired, canceled) is kept in English with RETRY_HASH, a hash
 * no English has, so the next run sends it again; an item whose answer broke the rules twice, or was refused, is kept
 * with its English's hash until that English changes.
 *
 * Exit codes: 0 done (items kept in English are in the report); 1 usage or configuration; 2 the English is off its
 * shape; 3 an estimate is above the cap, nothing sent (or the retry round not sent and nothing written); 4 the API (no
 * key, 401/403, a redirect, an answer over its size limit, a network failure after 3 tries, a batch with no succeeded
 * request, a results file with an unknown or repeated custom_id, a resumed batch that does not match the rebuilt
 * request list or its digest); 5 pending (a batch has not ended or could not be polled, or another is in progress:
 * resume with the token).
 * On 1 to 5 no output file is touched.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { htmlTokens } from "../sanitise-html.mjs";
import { checkDocs } from "./docs-shape.mjs";
import { offMarkup, markupProblems } from "./docs-markup.mjs";
import { hash16, sectionText, catalogueProblems, valueProblem, textOf, summaryOf, decode, HASH } from "../i18n/lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const MODEL = "claude-opus-5-5";
/* batch prices per million tokens (Opus 5.5, Message Batches: half the standard rate) */
export const PRICES = { input: 2, output: 10, cacheRead: 0.2 };
export const DEFAULT_CAP = 3_000_000;
const CHUNK = 60, MAX_HTML = 100_000, MAX_OUT = 16_000;
/* the source hash of an item kept in English for the API's reasons: no English hashes to it, so the next run sends it */
export const RETRY_HASH = "0000000000000000";
/* the size of an answer read from the API (a status, a list, a create) and of a batch's results file; past it the
   connection is dropped and the run is exit 4. A request answers at most MAX_OUT tokens (about 64 KB of text), so
   even a full run of every language (some 800 requests) stays under half the results limit. */
const MiB = 1 << 20;
export const LIMITS = { json: 4 * MiB, results: 128 * MiB };
/* how long one call may take: a poll at most a minute (and never past the deadline), the rest five minutes */
const CALL_MS = { poll: 60_000, other: 300_000 };
const RATIO = { latin: [0.5, 2.5], arabic: [0.5, 2.5], cjk: [0.2, 1.5] };
/* the shortest English catalogue value whose length ratio is judged: "Go" for "Los geht's" is a fine translation */
const RATIO_MIN_CHARS = 20;

/*
 * The app's own UI labels (owner decision U1, #125 note 53859): the app is not translated, so a label a reader will
 * see on screen stays in English, with the translation in brackets on first use. This is the one place the rule
 * lives: when Orbit ships its own translations, this text changes (to "use the app's own <language> label") and the
 * next run, whose system block then differs, is a fresh prompt.
 */
export const UI_LABEL_RULE = "The app itself is not translated: its own UI labels (text in <strong> or <kbd> naming a button, menu, " +
  "field or screen of the app) stay in English exactly as written, followed on their first use in a section by the " +
  "translation in parentheses, e.g. <strong>Settings</strong> (Einstellungen). Later uses in the same section stay " +
  "in English alone. The parentheses are text outside the tag, so the tags stay as they were.";

class Exit extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const fmt = (n) => Math.round(n).toLocaleString("en-GB");

/* ---------------------------------------------------------------- arguments -- */
/* a resume token: <batch>, <batch>.<digest> or <round-1 batch>.<round-2 batch>.<digest> -> { ids, digest|null } */
const BATCH_ID = /^[\w-]{1,128}$/, DIGEST = /^[0-9a-f]{16}$/;
export function parseToken(t) {
  const parts = String(t).split("."), digest = parts.length > 1 ? parts.pop() : null;
  if (parts.length > 2 || !parts.every((p) => BATCH_ID.test(p)) || (digest !== null && !DIGEST.test(digest))) {
    throw new Exit(1, "the batch to resume (--resume or TRANSLATE_BATCH_ID) is not a resume token: <batch>.<digest> or <batch>.<batch>.<digest>, as a pending run prints it");
  }
  return { ids: parts, digest };
}
const FLAGS = new Set(["--langs", "--only", "--dry-run", "--max-tokens", "--out", "--report", "--poll-seconds", "--timeout-minutes", "--api-base", "--resume"]);
export function parseArgs(argv, env = process.env) {
  const o = { langs: null, only: null, dryRun: false, maxTokens: null, out: null, report: null, pollSeconds: 60, timeoutMinutes: 50, resume: null, apiBase: "https://api.anthropic.com" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!FLAGS.has(a)) throw new Exit(1, `unknown argument ${JSON.stringify(a).slice(0, 40)} (the key is read from the environment only)`);
    if (a === "--dry-run") { o.dryRun = true; continue; }
    const v = argv[++i];
    if (v === undefined) throw new Exit(1, `${a} needs a value`);
    const num = (min) => { const n = Number(v); if (!/^\d+(\.\d+)?$/.test(v) || !(n > min)) throw new Exit(1, `${a} ${JSON.stringify(v)} is not a positive number`); return n; };
    if (a === "--langs") o.langs = v.split(",").map((x) => x.trim()).filter(Boolean);
    else if (a === "--only") { if (!["site", "docs"].includes(v)) throw new Exit(1, `--only takes site or docs, not ${JSON.stringify(v)}`); o.only = v; }
    else if (a === "--max-tokens") { if (!/^\d+$/.test(v) || Number(v) < 1) throw new Exit(1, `--max-tokens ${JSON.stringify(v)} is not a whole number of tokens`); o.maxTokens = Number(v); }
    else if (a === "--out") o.out = resolve(v);
    else if (a === "--report") o.report = resolve(v);
    else if (a === "--poll-seconds") o.pollSeconds = num(0);
    else if (a === "--timeout-minutes") o.timeoutMinutes = num(0);
    else if (a === "--resume") o.resume = v;
    else if (a === "--api-base") { let u; try { u = new URL(v); } catch { throw new Exit(1, `--api-base ${JSON.stringify(v)} is not a URL`); } if (!/^https?:$/.test(u.protocol)) throw new Exit(1, "--api-base is not http(s)"); o.apiBase = u.origin; }
  }
  if (o.resume === null && env.TRANSLATE_BATCH_ID) o.resume = env.TRANSLATE_BATCH_ID;
  if (o.resume !== null) o.resume = parseToken(o.resume);
  if (o.maxTokens === null) {
    const e = env.TRANSLATE_MAX_TOKENS;
    if (e !== undefined && e !== "") { if (!/^\d+$/.test(e) || Number(e) < 1) throw new Exit(1, "TRANSLATE_MAX_TOKENS is not a whole number of tokens"); o.maxTokens = Number(e); }
    else o.maxTokens = DEFAULT_CAP;
  }
  return o;
}

/* ---------------------------------------------------------------- configuration -- */
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const tryJson = (p) => { try { return existsSync(p) ? readJson(p) : null; } catch { return null; } };

export function loadConfig(root) {
  let languages, glossary;
  try { languages = readJson(join(root, "tools/i18n/languages.json")); } catch { throw new Exit(1, "tools/i18n/languages.json is not JSON"); }
  if (!isObj(languages) || !Object.keys(languages).length) throw new Exit(1, "tools/i18n/languages.json is not an object of languages");
  for (const [code, l] of Object.entries(languages)) {
    const where = `tools/i18n/languages.json: ${JSON.stringify(code).slice(0, 20)}`;
    if (!/^[a-z]{2,3}(-[A-Z][a-z]{3})?$/.test(code) || code === "en") throw new Exit(1, `${where} is not a language code`);
    if (!isObj(l) || ["name", "english", "voice"].some((k) => typeof l[k] !== "string" || !l[k].trim()) || typeof l.built !== "boolean") throw new Exit(1, `${where} needs name, english, voice (text) and built (true or false)`);
    if (!Object.hasOwn(RATIO, l.script)) throw new Exit(1, `${where} has script ${JSON.stringify(l.script)}; the tool knows ${Object.keys(RATIO).join(", ")}`);
  }
  try { glossary = readJson(join(root, "tools/i18n/glossary.json")); } catch { throw new Exit(1, "tools/i18n/glossary.json is not JSON"); }
  if (!Array.isArray(glossary)) throw new Exit(1, "tools/i18n/glossary.json is not a list");
  glossary.forEach((g, i) => {
    const where = `tools/i18n/glossary.json: entry ${i + 1}`;
    if (!isObj(g) || typeof g.term !== "string" || !g.term.trim()) throw new Exit(1, `${where} has no term`);
    const keep = g.keep === true, to = isObj(g.to) && Object.values(g.to).every((v) => typeof v === "string" && v.trim());
    if (keep === to) throw new Exit(1, `${where} (${g.term}) must either keep the term (keep: true) or pin renderings (to: {lang: text}), one of the two`);
    if (g.keep !== undefined && g.keep !== true) throw new Exit(1, `${where} (${g.term}) has keep that is not true`);
    if (g.to !== undefined && !to) throw new Exit(1, `${where} (${g.term}) has a to that is not {lang: text}`);
    if (g.note !== undefined && typeof g.note !== "string") throw new Exit(1, `${where} (${g.term}) has a note that is not text`);
  });
  return { languages, glossary };
}

/* the English, held to the shape the lint holds it to; anything off it is exit 2, before any request */
export function loadEnglish(root) {
  let en, sources, index;
  try { en = readJson(join(root, "assets/i18n/en.json")); } catch { throw new Exit(2, "assets/i18n/en.json is not JSON"); }
  if (!isObj(en) || !Object.keys(en).length) throw new Exit(2, "assets/i18n/en.json is not an object of key to text");
  for (const [k, v] of Object.entries(en)) if (typeof v !== "string" || !v.trim()) throw new Exit(2, `assets/i18n/en.json: "${k}" is not text`);
  try { sources = readJson(join(root, "tools/docs-sources.json")); } catch { throw new Exit(2, "tools/docs-sources.json is not JSON"); }
  const dir = join(root, "assets/docs");
  const problems = checkDocs(dir, sources);
  if (problems.length) throw new Exit(2, `assets/docs is not the shape the import writes:\n${problems.slice(0, 10).map((p) => `   ${p}`).join("\n")}`);
  const markup = markupProblems(dir);
  if (markup.length) throw new Exit(2, `assets/docs carries markup the import does not write:\n${markup.slice(0, 10).join("\n")}`);
  const pages = {};
  for (const s of sources) {
    pages[s.slug] = readJson(join(dir, `${s.slug}.json`));
    for (const sec of pages[s.slug].sections) if (sec.html.length > MAX_HTML) throw new Exit(2, `assets/docs/${s.slug}.json: section ${sec.id} is ${sec.html.length} characters of html, more than ${MAX_HTML}`);
  }
  index = readJson(join(dir, "index.json"));
  return { en, sources, pages, generated: index.generated };
}

/* ---------------------------------------------------------------- the prompt -- */
export function systemText(glossary) {
  return [
    "You translate the website and the documentation of Orbit, a self-hosted app that keeps a household's reminders, " +
      "chores and bills. Each request names the target language and gives one item as JSON: a section of the docs " +
      "(its title, its HTML and the titles of its sub-headings) or a set of the website's short texts. Translate the " +
      "text for a native reader of that language, in the voice the request names, natural rather than word for word.",
    "Rules:",
    "1. Keep every HTML tag and attribute exactly as written and in the same order: add none, drop none, move none. " +
      "Only the text between tags changes, and the alt and title attributes of <img>.",
    "2. Never change an id, href, src, class, aria-label or data-* attribute.",
    "3. Leave the contents of <pre class=\"code\"> and of <code> byte for byte as they are.",
    "4. In a <figure data-mermaid>, translate only the label text inside [...], (...), {...}, |...| and quotes; keep " +
      "node ids, arrows, keywords and the line breaks exactly.",
    "5. Keep every {placeholder} in braces exactly, and every character reference (&amp;, &lt;, &quot;) as an entity.",
    "6. Glossary (below): a term with keep stays exactly as written, in every language; a term with to uses that " +
      "rendering for the language (inflect it as the grammar needs); a language missing from to is translated freely.",
    `7. ${UI_LABEL_RULE}`,
    "8. Keep numbers, URLs, file names, commands, product names and people's names as they are.",
    "9. Answer with the JSON the schema asks for and nothing else: no preface, no note. For a section, give its " +
      "title, html and subs (each sub-heading's id unchanged, its title translated); for a set of texts, every id " +
      "given, once, with its text.",
    "Glossary (JSON):",
    JSON.stringify(glossary, null, 1),
  ].join("\n\n");
}
const SECTION_SCHEMA = {
  type: "object", additionalProperties: false, required: ["title", "html", "subs"],
  properties: {
    title: { type: "string" }, html: { type: "string" },
    subs: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "title"], properties: { id: { type: "string" }, title: { type: "string" } } } },
  },
};
const CHUNK_SCHEMA = {
  type: "object", additionalProperties: false, required: ["items"],
  properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "text"], properties: { id: { type: "string" }, text: { type: "string" } } } } },
};
const userText = (lang, L, item, broke) => [
  `Language: ${lang} (${L.english}, ${L.name}). Voice: ${L.voice}.`,
  item.kind === "section" ? "Translate this section of the documentation:" : "Translate these texts of the website:",
  JSON.stringify(item.payload),
  ...(broke ? [`Your previous answer broke: ${broke.join("; ")}. Answer again, keeping to every rule.`] : []),
].join("\n\n");
export const maxTokensFor = (chars) => Math.min(MAX_OUT, Math.ceil((4 * chars) / 3.5) + 1024);

/* the bare id of the n-th request of a batch of `count`; on the wire it carries the run's key, wireId(n, count) + "-" +
   12 hex (the API allows only [a-zA-Z0-9_-]{1,64}) */
export const wireId = (n, count) => `r${String(n).padStart(Math.max(4, String(Math.max(0, count - 1)).length), "0")}`;
/* a retry of an answer cut off at max_tokens gets twice the room, up to twice MAX_OUT */
const maxTokensAgain = (chars) => Math.min(2 * MAX_OUT, 2 * maxTokensFor(chars));
function request(item, system, broke, custom_id) {
  return {
    custom_id,
    params: {
      model: MODEL,
      max_tokens: broke && broke.cutoff ? maxTokensAgain(item.chars) : maxTokensFor(item.chars),
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userText(item.lang, item.L, item, broke && broke.rules) }],
      output_config: { effort: "high", format: { type: "json_schema", schema: item.kind === "section" ? SECTION_SCHEMA : CHUNK_SCHEMA } },
    },
  };
}

/* ---------------------------------------------------------------- the plan -- */
async function planLanguage(root, lang, L, eng, only) {
  const plan = { lang, L, items: [], cat: null, state: null, pages: {}, unchanged: 0 };
  if (only !== "docs") {
    const cat = tryJson(join(root, `assets/i18n/${lang}.json`)), st = tryJson(join(root, `tools/i18n/state/${lang}.json`));
    plan.cat = isObj(cat) ? cat : {};
    plan.state = isObj(st) && isObj(st.catalogue) && Array.isArray(st.kept) ? st : { catalogue: {}, kept: [] };
    plan.hashes = {};
    const due = [];
    for (const [k, v] of Object.entries(eng.en)) {
      plan.hashes[k] = await hash16(v);
      if (plan.state.catalogue[k] !== plan.hashes[k] || typeof plan.cat[k] !== "string") due.push(k); else plan.unchanged++;
    }
    for (let i = 0; i < due.length; i += CHUNK) {
      const keys = due.slice(i, i + CHUNK), id = `site/${lang}/${i / CHUNK + 1}`;
      const payload = { items: keys.map((k) => ({ id: k, text: eng.en[k] })) };
      plan.items.push({ kind: "chunk", id, lang, L, customId: `${id}@${lang}`, keys, payload, chars: JSON.stringify(payload).length });
    }
  }
  if (only !== "site") {
    for (const src of eng.sources) {
      const old = tryJson(join(root, `assets/docs-i18n/${lang}/${src.slug}.json`));
      const prev = isObj(old) && isObj(old.source) && isObj(old.source.sections) && Array.isArray(old.sections) ? old : null;
      const page = { prev, hashes: {} };
      plan.pages[src.slug] = page;
      for (const s of eng.pages[src.slug].sections) {
        const h = page.hashes[s.id] = await hash16(sectionText(s));
        const had = prev && prev.sections.find((x) => isObj(x) && x.id === s.id);
        if (had && prev.source.sections[s.id] === h) { plan.unchanged++; continue; }
        const id = `docs/${src.slug}/${s.id}`;
        const payload = { slug: src.slug, id: s.id, title: s.title, html: s.html, subs: s.subs };
        plan.items.push({ kind: "section", id, lang, L, customId: `${id}@${lang}`, slug: src.slug, eng: s, payload, chars: JSON.stringify(payload).length });
      }
    }
  }
  return plan;
}

/* output tokens per estimated answer token, measured (#144): the first real run (pipeline 3802, job 48253,
   2026-11-08, all 8 languages from nothing) was estimated at 831,414 output tokens and used 2,275,267 (thinking at
   effort high is billed as output). Check it against the next full run's report. */
export const OUTPUT_MEASURED = 2.74;
export function estimate(items, system) {
  const sys = system.length / 3.5;
  let input = 0, output = 0, itemIn = 0;
  for (const it of items) {
    input += sys + it.chars / 3.5;
    itemIn += it.chars / 3.5;
    output += (OUTPUT_MEASURED * it.chars * 1.3) / (it.L.script === "cjk" ? 2 : 3.5);
  }
  input = Math.ceil(input); output = Math.ceil(output);
  const most = (input * PRICES.input + output * PRICES.output) / 1e6;
  /* every request after the first reads the system block from the cache */
  const cached = items.length ? (itemIn * PRICES.input + sys * (PRICES.input + (items.length - 1) * PRICES.cacheRead) + output * PRICES.output) / 1e6 : 0;
  return { input, output, total: input + output, dollars: Math.round(cached * 100) / 100, dollarsNoCache: Math.round(most * 100) / 100 };
}

/* ---------------------------------------------------------------- the checks (spec 2.2) -- */
const LOOSE = new Set(["alt", "title"]);
function skeleton(html) {
  const out = [];
  for (const t of htmlTokens(html)) {
    if (typeof t === "string" || !t.name) continue;
    const at = [...t.at].filter(([k]) => !(t.name === "img" && LOOSE.has(k))).map(([k, v]) => `${k}=${JSON.stringify(v ?? "")}`);
    out.push(`<${t.closing ? "/" : ""}${t.name}${at.length ? ` ${at.join(" ")}` : ""}>`);
  }
  return out;
}
function links(html) {
  const out = [];
  for (const t of htmlTokens(html)) if (typeof t !== "string" && t.name && !t.closing) for (const k of ["href", "src"]) if (t.at.has(k)) out.push(`${k}=${t.at.get(k)}`);
  return out;
}
const codeOf = (html) => [...String(html).matchAll(/<pre\b[^>]*\bclass="code"[^>]*>[\s\S]*?<\/pre>|<code\b[^>]*>[\s\S]*?<\/code>/g)].map((m) => m[0]);
const mermaidOf = (html) => [...String(html).matchAll(/<figure\b[^>]*\bdata-mermaid\b[^>]*>[\s\S]*?<pre\b[^>]*>([\s\S]*?)<\/pre>/g)].map((m) => decode(m[1]));
/* a mermaid line with its label text blanked: quotes first, then the innermost bracket pair again and again */
export function blankLabels(line) {
  let s = line.replace(/"[^"\n]*"/g, '""');
  for (let prev = null; prev !== s;) { prev = s; s = s.replace(/\[[^[\](){}|]*\]|\([^[\](){}|]*\)|\{[^[\](){}|]*\}|\|[^|]*\|/g, "\u0001"); }
  return s.replace(/\s+/g, " ").trim();
}
/* how much markup a mermaid line's label text holds: each <, > or entity for one in the parts blankLabels blanks
   (the line is already entity-decoded once, so an escaped tag in the source is a tag here) */
export function labelMarkup(line) {
  let s = line, n = 0;
  const tally = (m) => { n += (m.match(/[<>]|&(lt|gt|#0*6[02]|#x0*3[ce]);/gi) || []).length; return "\u0001"; };
  s = s.replace(/"[^"\n]*"/g, tally);
  for (let prev = null; prev !== s;) { prev = s; s = s.replace(/\[[^[\](){}|]*\]|\([^[\](){}|]*\)|\{[^[\](){}|]*\}|\|[^|]*\|/g, tally); }
  return n;
}
const DANGER = /<script|<style|javascript:|\bon\w+\s*=/gi;
const dangers = (s) => (String(s).match(DANGER) || []).length;
const firstDiff = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return `at ${i + 1}: English ${a[i] ?? "nothing"}, answer ${b[i] ?? "nothing"}`.slice(0, 200); return ""; };
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/* how often a keep term stands in a text: as a word (case-sensitive), or anywhere in a CJK text */
const count = (text, term, cjk) => (cjk ? text.split(term).length - 1 : (text.match(new RegExp(`(?<![\\p{L}\\p{N}])${escRe(term)}(?![\\p{L}\\p{N}])`, "gu")) || []).length);
/* the keep terms an answer has fewer times than its English: each place English has one, the answer keeps it */
function glossaryMiss(glossary, enText, outText, cjk) {
  return glossary.filter((g) => g.keep && count(outText, g.term, cjk) < count(enText, g.term, false)).map((g) => g.term);
}
function ratioProblem(enLen, outLen, script, rule) {
  if (!enLen) return "";
  const r = outLen / enLen, [lo, hi] = RATIO[script];
  return r < lo || r > hi ? `${rule} length ratio ${r.toFixed(2)} to English is outside ${lo}-${hi} for ${script} script` : "";
}

/* the answer for a section: its problems (rule-named lines), or [] and the translated section */
export function checkSection(item, text, glossary) {
  const eng = item.eng, script = item.L.script, cjk = script === "cjk";
  let a;
  try { a = JSON.parse(text); } catch { return { problems: ["(g) the answer is not JSON"] }; }
  if (!isObj(a) || Object.keys(a).sort().join(",") !== "html,subs,title" || typeof a.title !== "string" || typeof a.html !== "string" || !Array.isArray(a.subs)
    || !a.subs.every((x) => isObj(x) && Object.keys(x).sort().join(",") === "id,title" && typeof x.id === "string" && typeof x.title === "string")) {
    return { problems: ["(g) the answer does not match the schema {title, html, subs: [{id, title}]}"] };
  }
  const p = [];
  const sk = firstDiff(skeleton(eng.html), skeleton(a.html));
  if (sk) p.push(`(a) the tag skeleton (tags and attributes) differs from English ${sk}`);
  const ln = firstDiff(links(eng.html), links(a.html));
  if (ln) p.push(`(c) an href or src differs from English ${ln}`);
  if (JSON.stringify(codeOf(eng.html)) !== JSON.stringify(codeOf(a.html))) p.push("(b) the text of a <pre class=\"code\"> or <code> differs from English");
  if (JSON.stringify(a.subs.map((x) => x.id)) !== JSON.stringify(eng.subs.map((x) => x.id))) p.push("(d) the subs' ids differ from English's");
  if (!a.title.trim() || a.subs.some((x) => !x.title.trim())) p.push("(d) a title is empty");
  const me = mermaidOf(eng.html), ma = mermaidOf(a.html);
  if (me.length !== ma.length) p.push("(e) the mermaid diagrams differ in number");
  else me.forEach((src, i) => {
    const le = src.split("\n"), la = ma[i].split("\n");
    if (le.length !== la.length) p.push(`(e) mermaid diagram ${i + 1} has ${la.length} lines, English ${le.length}`);
    else {
      const k = le.findIndex((l, j) => blankLabels(l) !== blankLabels(la[j]));
      if (k >= 0) p.push(`(e) mermaid diagram ${i + 1} line ${k + 1} changes more than its labels (a node id, arrow or keyword)`);
      const m = le.findIndex((l, j) => labelMarkup(la[j]) > labelMarkup(l));
      if (m >= 0) p.push(`(e) mermaid diagram ${i + 1} line ${m + 1}: a label carries markup (<, > or an entity for one) the English label lacks, which Mermaid would render as html`);
    }
  });
  const r = ratioProblem(textOf(eng.html).length, textOf(a.html).length, script, "(f)");
  if (r) p.push(r);
  if (dangers(a.html) > dangers(eng.html) || dangers(a.title) > dangers(eng.title)) p.push("(h) the answer adds a <script, <style, javascript: or on*= handler");
  const off = offMarkup(a.html);
  if (off) p.push(`(i) the html is off the docs markup allow-list: ${off}`);
  const miss = [...glossaryMiss(glossary, textOf(eng.html), textOf(a.html), cjk), ...glossaryMiss(glossary, eng.title, a.title, cjk)];
  eng.subs.forEach((s, i) => { if (a.subs[i]) miss.push(...glossaryMiss(glossary, s.title, a.subs[i].title, cjk)); });
  if (miss.length) p.push(`(n) the glossary keep term ${[...new Set(miss)].join(", ")} is missing (it stays as written)`);
  if (p.length) return { problems: p };
  return { problems: [], section: { id: eng.id, title: a.title, html: a.html, summary: summaryOf(a.html), text: textOf(a.html), subs: a.subs.map((x) => ({ id: x.id, title: x.title })) } };
}

/* the answer for a chunk: per key, its problems or its text */
export function checkChunk(item, text, en, glossary) {
  const script = item.L.script, cjk = script === "cjk";
  const all = (why) => ({ bad: Object.fromEntries(item.keys.map((k) => [k, [why]])), good: {} });
  let a;
  try { a = JSON.parse(text); } catch { return all("(g) the answer is not JSON"); }
  if (!isObj(a) || Object.keys(a).join(",") !== "items" || !Array.isArray(a.items) || !a.items.every((x) => isObj(x) && Object.keys(x).sort().join(",") === "id,text" && typeof x.id === "string" && typeof x.text === "string")) {
    return all("(g) the answer does not match the schema {items: [{id, text}]}");
  }
  const ids = a.items.map((x) => x.id);
  if (new Set(ids).size !== ids.length || ids.some((k) => !item.keys.includes(k))) return all("(j) a key is returned twice or a key that was not asked for is returned");
  const bad = {}, good = {};
  for (const k of item.keys) {
    const got = a.items.find((x) => x.id === k);
    if (!got) { bad[k] = ["(j) the key is missing from the answer"]; continue; }
    const p = [];
    const why = valueProblem(en[k], got.text);
    if (why) p.push(why === "is empty" ? "(l) the text is empty" : `(k) the text ${why}`);
    else {
      if (en[k].length >= RATIO_MIN_CHARS) { const r = ratioProblem(en[k].length, got.text.length, script, "(m)"); if (r) p.push(r); }
      if (dangers(got.text) > dangers(en[k])) p.push("(h) the text adds a <script, <style, javascript: or on*= handler");
      const miss = glossaryMiss(glossary, en[k], got.text, cjk);
      if (miss.length) p.push(`(n) the glossary keep term ${miss.join(", ")} is missing (it stays as written)`);
    }
    if (p.length) bad[k] = p; else good[k] = got.text;
  }
  return { bad, good };
}

/* ---------------------------------------------------------------- the API -- */
const sleep = (s) => new Promise((ok) => setTimeout(ok, s * 1000));
/* an Exit the caller may try again: a network failure, a time-out, a 429 or a 5xx */
const retryable = (msg) => Object.assign(new Exit(4, msg), { retry: true });
/* a body read up to `limit` bytes: past it the connection is dropped and the answer refused */
async function readCapped(res, limit, what, ctl) {
  if (!res.body) return "";
  const reader = res.body.getReader(), chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > limit) {
      ctl.abort();
      await reader.cancel().catch(() => {});
      throw new Exit(4, `${what}: the answer is larger than ${limit / MiB} MiB, its limit; it was cut off and refused`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function api(o) {
  const headers = (extra) => ({ "x-api-key": o.key, "anthropic-version": "2023-06-01", ...extra });
  /* one call: its answer's text, within its time and size limits, never following a redirect (the key is a custom
     header, which fetch would carry to the redirect's host); tries: how often a network failure, 429 or 5xx is tried */
  async function call(method, url, body, { tries = 3, limit = LIMITS.json, ms = CALL_MS.other } = {}) {
    if (new URL(url).origin !== o.apiBase) throw new Exit(4, `the API pointed at another host (${new URL(url).host}); the key goes only to ${new URL(o.apiBase).host}`);
    const what = `${method} ${new URL(url).pathname}`;
    for (let t = 1; ; t++) {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
      let status, text;
      try {
        const res = await o.fetch(url, { method, redirect: "manual", signal: ctl.signal,
          headers: headers(body ? { "content-type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
        status = res.status;
        if (res.type === "opaqueredirect" || (status >= 300 && status < 400)) {
          ctl.abort();
          throw new Exit(4, `HTTP ${status} from the API: ${what} answered with a redirect, which is not followed (the key goes only to ${new URL(o.apiBase).host}); nothing written`);
        }
        text = await readCapped(res, limit, what, ctl);
      } catch (e) {
        if (e instanceof Exit) throw e;
        const why = ctl.signal.aborted ? `no answer within ${Math.round(ms / 1000)} s` : String(e && (e.cause?.code || e.message)).slice(0, 120);
        if (t >= tries) throw retryable(`network failure${tries > 1 ? ` after ${tries} tries` : ""}: ${what}: ${why}`);
        await sleep(Math.min(5, o.pollSeconds) * t); continue;
      } finally { clearTimeout(timer); }
      if (status === 401 || status === 403) throw new Exit(4, `HTTP ${status} from the API: the key was refused`);
      if (status === 429 || status >= 500) {
        if (t >= tries) throw retryable(`HTTP ${status} from the API${tries > 1 ? ` after ${tries} tries` : ""}: ${what}`);
        await sleep(Math.min(5, o.pollSeconds) * t); continue;
      }
      if (status < 200 || status > 299) throw new Exit(4, `HTTP ${status} from the API: ${what}: ${text.slice(0, 300)}`);
      return text;
    }
  }
  const json = (text, what) => { try { return JSON.parse(text); } catch { throw new Exit(4, `${what}: the API's answer is not JSON`); } };
  const base = `${o.apiBase}/v1/messages/batches`;
  /* the key's batches, newest first (the first page: the job makes one or two a night) */
  const list = async () => { const j = json(await call("GET", `${base}?limit=100`), "the batch list"); return isObj(j) && Array.isArray(j.data) ? j.data.filter(isObj) : []; };
  return {
    list,
    /*
     * make a batch. A create whose answer is lost (a network failure, a 5xx) may have made it: before trying again the
     * list is read, and a batch in progress with this many requests that was not there before is taken as the one made
     */
    async create(requests, log) {
      const before = new Set((await list()).map((b) => b.id));
      for (let t = 1; ; t++) {
        try {
          const j = json(await call("POST", base, { requests }, { tries: 1 }), "the batch's creation");
          if (!isObj(j) || typeof j.id !== "string" || !BATCH_ID.test(j.id)) throw new Exit(4, "the API's answer to the batch has no id");
          return j.id;
        } catch (e) {
          if (!(e instanceof Exit && e.retry)) throw e;
          const made = (await list()).filter((b) => !before.has(b.id) && b.processing_status === "in_progress" && isObj(b.request_counts) && b.request_counts.processing === requests.length);
          if (made.length === 1 && BATCH_ID.test(made[0].id)) { log(`the answer to the batch's creation was lost, but the batch was made: ${made[0].id}`); return made[0].id; }
          if (t >= 3) throw new Exit(4, `${e.message} (3 tries in all)`);
          await sleep(Math.min(5, o.pollSeconds) * t);
        }
      }
    },
    get: async (id, ms) => json(await call("GET", `${base}/${id}`, null, { tries: 1, ms }), `batch ${id}`),
    results: async (url) => call("GET", url, null, { limit: LIMITS.results }),
  };
}

/*
 * this machine's record of the batches it made and has not read: batch id -> { digest, round, first, made }. A record
 * older than RECORD_DAYS (the Batches API keeps results 29 days) is pruned when the file is read; a file over
 * RECORD_MAX is refused, not read (nor written over): the run goes on as with no record.
 */
export const RECORD_DAYS = 29, RECORD_MAX = MiB;
function records(o, log = () => {}) {
  const file = join(o.env.HOME || homedir(), ".cache/orbit-translate/batches.json");
  let refused = false;
  const read = () => {
    if (refused) return {};
    try { if (existsSync(file) && statSync(file).size > RECORD_MAX) { refused = true; log(`${file} is larger than ${RECORD_MAX / MiB} MiB: refused, not read; the run goes on as with no record`); return {}; } } catch { return {}; }
    const j = tryJson(file);
    if (!isObj(j)) return {};
    const since = Date.now() - RECORD_DAYS * 86400e3, out = {};
    for (const [id, e] of Object.entries(j)) if (isObj(e) && typeof e.made === "string" && Date.parse(e.made) >= since) out[id] = e;
    return out;
  };
  const write = (j) => { if (refused) return; try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(`${file}.tmp`, `${JSON.stringify(j, null, 1)}\n`); renameSync(`${file}.tmp`, file); } catch { /* a convenience: a token resumes without it */ } };
  return {
    get: (id) => { const e = read()[id]; return isObj(e) && DIGEST.test(e.digest) && (e.round === 1 || (e.round === 2 && BATCH_ID.test(e.first))) ? e : null; },
    entries: () => Object.entries(read()).filter(([id, e]) => BATCH_ID.test(id) && isObj(e) && DIGEST.test(e.digest)),
    set: (id, e) => { const j = read(); j[id] = { ...e, made: new Date().toISOString() }; write(j); },
    drop: (id) => { const j = read(); if (Object.hasOwn(j, id)) { delete j[id]; write(j); } },
  };
}
export const digestOf = (requests) => createHash("sha256").update(JSON.stringify(requests), "utf8").digest("hex").slice(0, 16);

/*
 * one batch, sent (or, resuming, found), waited for and read: a Map of the index in `requests` -> result. Results are
 * mapped back by custom_id; an unknown or repeated one is exit 4. A batch not ended by the deadline is left running
 * (no cancel): exit 5 with the token that resumes it (job.token(id)). Resuming, the batch must hold exactly these
 * requests' ids. A batch made is recorded on this machine (job.made(id)) until its results are read.
 */
async function runBatch(o, client, requests, deadline, log, job) {
  const index = new Map(requests.map((r, n) => [r.custom_id, n]));
  const resumeId = job.resumeId;
  const id = job.id = resumeId || await client.create(requests, log);
  if (!resumeId) job.made(id);
  log(resumeId ? `resuming batch ${id}: ${requests.length} requests expected, nothing submitted` : `batch ${id}: ${requests.length} requests`);
  const pending = (why) => new Exit(5, `batch ${id} ${why}; it is left running (not cancelled) and nothing is written. ` +
    `Resume it from the same commit with TRANSLATE_BATCH_ID=${job.token(id)} (or --resume ${job.token(id)}).`);
  for (let fails = 0; ;) {
    let b;
    try { b = await client.get(id, Math.max(1000, Math.min(CALL_MS.poll, deadline - Date.now()))); fails = 0; }
    catch (e) {
      if (!(e instanceof Exit && e.retry)) throw e;
      if (Date.now() >= deadline) throw pending(`has not been seen to end within ${o.timeoutMinutes} minutes (${e.message})`);
      if (++fails >= 3) throw pending(`could not be polled (${e.message})`);
      await sleep(Math.min(5, o.pollSeconds) * fails); continue;
    }
    if (isObj(b) && b.processing_status === "ended") try {
      const c = isObj(b.request_counts) ? b.request_counts : {}, n = (k) => (Number.isFinite(c[k]) ? c[k] : 0);
      const total = ["processing", "succeeded", "errored", "canceled", "expired"].reduce((t, k) => t + n(k), 0);
      const notOurs = (why) => Object.assign(new Exit(4, why), { notOurs: true });
      if (job.adopt && total !== requests.length) throw notOurs(`it holds ${total} requests, not ${requests.length}`);
      if (resumeId && total !== requests.length) throw new Exit(4, `batch ${id} holds ${total} requests but this commit's sources make ${requests.length}: it is not this run's batch; nothing written`);
      /* one errored, expired or canceled request is kept in English (and sent again next run); none succeeded is the batch's failure */
      if (requests.length && n("succeeded") === 0) throw new Exit(4, `batch ${id} ended with no request succeeded (errored ${n("errored")}, canceled ${n("canceled")}, expired ${n("expired")}); nothing written`);
      if (typeof b.results_url !== "string") throw new Exit(4, `batch ${id} ended with no results_url`);
      const out = new Map();
      for (const line of (await client.results(b.results_url)).split("\n")) {
        if (!line.trim()) continue;
        let r; try { r = JSON.parse(line); } catch { throw new Exit(4, `batch ${id}: a results line is not JSON`); }
        if (!isObj(r) || typeof r.custom_id !== "string") throw new Exit(4, `batch ${id}: a results line has no custom_id`);
        const k = index.get(r.custom_id);
        if (k === undefined && job.adopt) throw notOurs(`its results hold a custom_id without this run's key (${JSON.stringify(r.custom_id.slice(0, 70))})`);
        if (k === undefined) throw new Exit(4, `batch ${id}: the results hold a custom_id this run never sent (${JSON.stringify(r.custom_id.slice(0, 70))})${resumeId ? ": it is not this run's batch" : ""}; nothing written`);
        if (out.has(k)) throw new Exit(4, `batch ${id}: the results hold custom_id ${r.custom_id} twice; nothing written`);
        out.set(k, r.result);
      }
      if (job.adopt && out.size !== requests.length) throw notOurs(`it returned ${out.size} results for ${requests.length} requests`);
      if (resumeId && out.size !== requests.length) throw new Exit(4, `batch ${id} returned ${out.size} results for ${requests.length} requests: it is not this run's batch; nothing written`);
      job.read(id);
      return out;
    } catch (e) {
      /* the batch's results cannot be used (exit 4): its record goes, so no later run takes it up again */
      if (e instanceof Exit && e.code === 4 && !e.retry && !e.notOurs && job.failed) job.failed(id);
      throw e;
    }
    if (Date.now() >= deadline) throw pending(`has not ended within ${o.timeoutMinutes} minutes`);
    await sleep(Math.min(o.pollSeconds, Math.max(0.01, (deadline - Date.now()) / 1000)));
  }
}

/*
 * a result's text, or why there is none (errored, expired, canceled, refusal, max_tokens). keep: not retried in this
 * run; transient: the API's trouble, not the text's, so it is kept with RETRY_HASH and the next run sends it again
 */
function resultText(r) {
  const api = (fail) => ({ fail, keep: true, transient: true });
  if (!isObj(r)) return api("errored: no result came back for this request");
  if (r.type === "errored") return api(`errored: the API answered with an error (${String(r.error?.error?.type || r.error?.type || "unknown").slice(0, 40)})`);
  if (r.type === "expired") return api("expired: the batch expired before this request ran");
  if (r.type === "canceled") return api("canceled: the request was canceled");
  const m = r.message;
  if (r.type !== "succeeded" || !isObj(m)) return api(`errored: an unknown result type ${String(r.type).slice(0, 20)}`);
  if (m.stop_reason === "refusal") return { fail: "refused: the model declined this item (stop_reason refusal)", keep: true, usage: m.usage };
  if (m.stop_reason === "max_tokens") return { fail: "(g) the answer was cut off at max_tokens", cutoff: true, usage: m.usage };
  const text = (Array.isArray(m.content) ? m.content : []).filter((b) => b && b.type === "text").map((b) => b.text).join("");
  return { text, usage: m.usage };
}

/* ---------------------------------------------------------------- the run -- */
export async function run(opts) {
  const o = { root: ROOT, fetch: globalThis.fetch, log: (s) => console.log(s), env: process.env, ...opts };
  const log = o.log;
  try {
    Object.assign(o, parseArgs(o.args || [], o.env));
    o.key = o.env.ANTHROPIC_API_KEY || "";
    const out = o.out || o.root, report = o.report || join(o.root, "translate-report.json");
    const { languages, glossary } = loadConfig(o.root);
    const langs = o.langs || Object.keys(languages);
    const unknown = langs.filter((l) => !Object.hasOwn(languages, l));
    if (unknown.length || !langs.length) throw new Exit(1, `unknown language ${unknown.join(", ") || "(none given)"}; tools/i18n/languages.json has ${Object.keys(languages).join(", ")}`);
    const eng = loadEnglish(o.root);
    const system = systemText(glossary);

    const plans = [];
    for (const lang of Object.keys(languages).filter((l) => langs.includes(l))) plans.push(await planLanguage(o.root, lang, languages[lang], eng, o.only));
    const items = plans.flatMap((p) => p.items);
    const est = estimate(items, system);
    log(`plan: ${items.length} item(s) to send, ${plans.reduce((n, p) => n + p.unchanged, 0)} unchanged (${plans.map((p) => `${p.lang}: ${p.items.length}`).join(", ")})`);
    for (const it of items) log(`   ${it.customId}  ${it.kind === "chunk" ? `${it.keys.length} keys, ` : ""}${it.chars} chars`);
    log(`estimate: ${fmt(est.input)} input tokens + ${fmt(est.output)} output tokens = ${fmt(est.total)} tokens (cap ${fmt(o.maxTokens)})`);
    log(`   about $${est.dollars.toFixed(2)} at batch prices with the system block cached; at most $${est.dollarsNoCache.toFixed(2)} with no cache hit (${MODEL}: $${PRICES.input} in, $${PRICES.output} out, $${PRICES.cacheRead} cache read per million tokens; a retry batch, if one is needed, counts against the same cap)`);
    if (est.total > o.maxTokens) throw new Exit(3, `the estimate, ${fmt(est.total)} tokens, is above the cap of ${fmt(o.maxTokens)}: nothing sent`);
    if (o.dryRun) { log("dry run: nothing sent, nothing written"); return 0; }

    const outcome = new Map(); /* customId -> { section } | { good: {key: text}, bad: {key: [rules]}, retry: [key] } | { kept: [rules], retry } */
    const usage = { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 };
    const add = (u) => { if (isObj(u)) for (const k of Object.keys(usage)) usage[k] += Number.isFinite(u[k]) ? u[k] : 0; };
    let batches = 0;
    if (items.length) {
      if (!o.key) throw new Exit(4, "ANTHROPIC_API_KEY is not set: the run needs the key (a dry run does not)");
      const client = api(o), rec = records(o, log), deadline = Date.now() + o.timeoutMinutes * 60_000;
      /* the round-n item of a todo entry: a chunk's retry carries only the keys that broke */
      const itemFor = (round, { it, broke }) => {
        if (round === 1 || it.kind !== "chunk") return it;
        const payload = { items: it.payload.items.filter((x) => broke.keys.includes(x.id)) };
        return { ...it, payload, chars: JSON.stringify(payload).length };
      };
      const bareFor = (round, todo) => todo.map((t, n) => request(itemFor(round, t), system, t.broke, wireId(n, todo.length)));
      let todo = items.map((it) => ({ it, broke: null }));
      /* the idempotency key: the digest of round 1's requests with bare ids rides in every custom_id of the run */
      const bare = bareFor(1, todo), digest = digestOf(bare), key = digest.slice(0, 12);
      const requestsFor = (round, todo) => bareFor(round, todo).map((q) => ({ ...q, custom_id: `${q.custom_id}-${key}` }));
      const first = requestsFor(1, todo);
      /* the batches to take up instead of submitting: [round 1's, round 2's] */
      let resume = null, adopt = false;
      if (o.resume) {
        let { ids, digest: want } = o.resume;
        if (want === null) {
          const e = rec.get(ids[0]);
          if (!e) throw new Exit(1, `batch ${ids[0]}: this machine has no record of it, so nothing shows it was made from this checkout's English; resume with the whole token the pending run printed (<batch>.<digest>)`);
          ids = e.round === 2 ? [e.first, ids[0]] : ids; want = e.digest;
        }
        if (want !== digest) throw new Exit(4, `batch ${ids[ids.length - 1]} was made from another request list (digest ${want}) than this checkout makes (${digest}): the English, the prompt or the plan changed since; it is not this run's batch; nothing submitted, nothing written`);
        resume = ids;
      } else {
        /*
         * a batch made from this very request list whose results were never read (a run that ended pending): still
         * running or ended, it is taken up rather than paid for twice. Its record goes only once its results are read,
         * or turn out unusable (exit 4).
         */
        for (const [id, e] of rec.entries().sort((a, b) => b[1].round - a[1].round)) {
          if (e.digest !== digest) continue;
          let b = null; try { b = await client.get(id, CALL_MS.poll); } catch (err) { if (!(err instanceof Exit && err.retry)) throw err; }
          if (isObj(b) && (b.processing_status === "in_progress" || b.processing_status === "ended")) {
            resume = e.round === 2 ? [e.first, id] : [id];
            log(`batch ${id}, made from this same request list, ${b.processing_status === "ended" ? "has ended with its results unread" : "is still running"}: taking it up, nothing submitted`);
            break;
          }
        }
        if (!resume) {
          const all = await client.list(), running = all.filter((b) => b.processing_status === "in_progress");
          if (running.length) throw new Exit(5, `batch ${String(running[0].id).slice(0, 80)} is still in progress on this key${running.length > 1 ? ` (and ${running.length - 1} more)` : ""}: nothing submitted, so no second batch is paid for. Resume it with the TRANSLATE_BATCH_ID its run printed, or run again once it has ended`);
          /*
           * with no record (a CI runner keeps none), the key's newest ended batch is a candidate for this run's unread
           * one when it holds exactly this many requests, every one succeeded, made after the English it would
           * translate (created_at after its generated) and within RECORD_DAYS. It is taken up only if every result's
           * custom_id carries this run's key (runBatch, job.adopt); otherwise a new batch is made and none of the
           * other batch's text is used.
           */
          const n = (b, k) => (isObj(b.request_counts) && Number.isFinite(b.request_counts[k]) ? b.request_counts[k] : 0);
          const ended = all.find((b) => b.processing_status === "ended");
          const made = ended && typeof ended.created_at === "string" ? Date.parse(ended.created_at) : null;
          if (ended && BATCH_ID.test(String(ended.id)) && n(ended, "succeeded") === first.length && ["errored", "canceled", "expired", "processing"].every((k) => n(ended, k) === 0)
            && (made === null || (Number.isFinite(made) && made > Date.parse(eng.generated) && made >= Date.now() - RECORD_DAYS * 86400e3))) {
            resume = [ended.id]; adopt = true;
            log(`batch ${ended.id} on this key ended with ${first.length} requests, all succeeded, made after this English: taking it up if its ids carry this run's key (${key})`);
          }
        }
      }
      const ids = [];
      for (let round = 1; round <= 2 && todo.length; round++) {
        const requests = round === 1 ? first : requestsFor(2, todo);
        if (round === 2 && !(resume && resume[1])) {
          /* the retry round is spend too: it counts against the same cap as the first (one already made and paid for,
             taken up, is never stopped by it) */
          const est2 = estimate(todo.map((t) => { const x = itemFor(2, t); return { ...x, chars: x.chars + t.broke.rules.join("; ").length }; }), system);
          log(`retry: ${todo.length} item(s); estimate ${fmt(est2.total)} tokens, ${fmt(est.total + est2.total)} with the first round (cap ${fmt(o.maxTokens)})`);
          if (est.total + est2.total > o.maxTokens) throw new Exit(3, `the estimate of both rounds, ${fmt(est.total + est2.total)} tokens, is above the cap of ${fmt(o.maxTokens)}: the retry batch is not sent and nothing is written`);
        }
        const job = {
          resumeId: resume ? resume[round - 1] || null : null,
          token: (id) => [...ids, id, digest].join("."),
          made: (id) => rec.set(id, round === 1 ? { digest, round } : { digest, round, first: ids[0] }),
          read: (id) => rec.drop(id),
          failed: (id) => rec.drop(id),
        };
        job.adopt = adopt && round === 1;
        let results;
        try { results = await runBatch(o, client, requests, deadline, log, job); }
        catch (e) {
          if (!(e && e.notOurs && job.adopt)) throw e;
          /* the candidate from the list is another run's: nothing of it is used, and this run's batch is made */
          log(`batch ${job.resumeId}: ${e.message}; it is another run's, so none of its text is used and a batch is made for this one`);
          resume = null; adopt = false; job.adopt = false; job.resumeId = null;
          results = await runBatch(o, client, requests, deadline, log, job);
        }
        ids.push(job.id);
        batches++;
        const again = [];
        for (const [n, { it, broke }] of todo.entries()) {
          const r = resultText(results.get(n));
          add(r.usage);
          const prev = outcome.get(it.customId);
          if (r.fail) {
            if (r.keep || round === 2) {
              const retry = r.transient ? (it.kind === "chunk" ? (broke ? broke.keys : it.keys) : true) : null;
              if (it.kind === "chunk") { const keys = broke ? broke.keys : it.keys; outcome.set(it.customId, { good: prev ? prev.good : {}, bad: { ...(prev ? prev.bad : {}), ...Object.fromEntries(keys.map((k) => [k, [r.fail]])) }, retry: [...(prev && prev.retry || []), ...(retry || [])] }); }
              else outcome.set(it.customId, { kept: [r.fail], retry: !!retry });
            } else again.push({ it, broke: { rules: [r.fail], keys: broke ? broke.keys : it.keys, cutoff: !!r.cutoff } });
            continue;
          }
          if (it.kind === "section") {
            const c = checkSection(it, r.text, glossary);
            if (!c.problems.length) outcome.set(it.customId, { section: c.section });
            else if (round === 2) outcome.set(it.customId, { kept: c.problems });
            else again.push({ it, broke: { rules: c.problems } });
          } else {
            const keys = broke ? broke.keys : it.keys;
            const c = checkChunk({ ...it, keys }, r.text, eng.en, glossary);
            const good = { ...(prev ? prev.good : {}), ...c.good };
            const badKeys = Object.keys(c.bad);
            if (round === 2 || !badKeys.length) outcome.set(it.customId, { good, bad: c.bad });
            else {
              outcome.set(it.customId, { good, bad: {} });
              again.push({ it, broke: { keys: badKeys, rules: badKeys.map((k) => `${k}: ${c.bad[k].join(", ")}`) } });
            }
          }
        }
        todo = again;
      }
      if (resume && resume.length > ids.length) throw new Exit(4, `batch ${resume[resume.length - 1]} is a retry round, but this checkout's first round needs none: it is not this run's batch; nothing written`);
    }

    /* the files, in memory first: nothing is written until every batch is read */
    const files = new Map(), summary = [], reportLangs = {}, keptAll = [];
    for (const p of plans) {
      const R = reportLangs[p.lang] = { translated: 0, unchanged: p.unchanged, kept: 0, keptItems: [] };
      const keep = (id, rules, extra = {}) => { R.kept++; const e = { lang: p.lang, id, ...extra, rules }; R.keptItems.push(e); keptAll.push(e); };
      if (p.cat) {
        const cat = {}, kept = new Set(p.state.kept.filter((k) => typeof k === "string")), hashes = { ...p.hashes };
        const chunkOf = new Map(p.items.filter((it) => it.kind === "chunk").flatMap((it) => it.keys.map((k) => [k, it])));
        for (const k of Object.keys(eng.en)) {
          const it = chunkOf.get(k);
          if (!it) { cat[k] = p.cat[k]; continue; }
          const res = outcome.get(it.customId) || { good: {}, bad: { [k]: ["errored: no result"] }, retry: [k] };
          if (Object.hasOwn(res.good, k) && !res.bad[k]) { cat[k] = res.good[k]; kept.delete(k); R.translated++; }
          else {
            cat[k] = eng.en[k]; kept.add(k); keep(it.id, res.bad[k] || ["errored: no result"], { key: k });
            if (!res.bad[k] || (res.retry || []).includes(k)) hashes[k] = RETRY_HASH; /* the API failed it: sent again next run */
          }
        }
        const state = { catalogue: hashes, kept: Object.keys(eng.en).filter((k) => kept.has(k)) };
        files.set(join(out, `assets/i18n/${p.lang}.json`), `${JSON.stringify(cat, null, 2)}\n`);
        files.set(join(out, `tools/i18n/state/${p.lang}.json`), `${JSON.stringify(state, null, 2)}\n`);
      }
      if (Object.keys(p.pages).length) {
        const entries = [];
        for (const src of eng.sources) {
          const engPage = eng.pages[src.slug], pg = p.pages[src.slug], prev = pg.prev;
          const sections = [], keptIds = [], hashes = { ...pg.hashes };
          for (const s of engPage.sections) {
            const res = outcome.get(`docs/${src.slug}/${s.id}@${p.lang}`);
            const due = p.items.some((it) => it.kind === "section" && it.slug === src.slug && it.eng.id === s.id);
            if (!due) {
              sections.push(prev.sections.find((x) => isObj(x) && x.id === s.id));
              if (prev.source.kept.includes(s.id)) keptIds.push(s.id);
            } else if (res && res.section) { sections.push(res.section); R.translated++; }
            else {
              sections.push(structuredClone(s)); keptIds.push(s.id); keep(`docs/${src.slug}/${s.id}`, res ? res.kept : ["errored: no result"]);
              if (!res || res.retry) hashes[s.id] = RETRY_HASH; /* the API failed it: sent again next run */
            }
          }
          const { sections: _drop, ...head } = engPage;
          const page = { ...head, sections, source: { generated: eng.generated, sections: hashes, kept: keptIds } };
          files.set(join(out, `assets/docs-i18n/${p.lang}/${src.slug}.json`), JSON.stringify(page));
          entries.push({ ...head, sections: sections.map(({ html, ...rest }) => rest), source: page.source });
        }
        files.set(join(out, `assets/docs-i18n/${p.lang}/index.json`), JSON.stringify({ generated: eng.generated, sources: entries }));
      }
      summary.push(`${p.lang}: ${R.translated} translated, ${R.unchanged} unchanged, ${R.kept} kept in English`);
      for (const e of R.keptItems) summary.push(`   kept ${e.id}${e.key ? ` key ${e.key}` : ""}: ${e.rules.join("; ")}`);
    }
    const dollars = (usage.input_tokens * PRICES.input + usage.cache_creation_input_tokens * PRICES.input * 1.25 + usage.cache_read_input_tokens * PRICES.cacheRead + usage.output_tokens * PRICES.output) / 1e6;
    summary.push(`tokens: ${fmt(usage.input_tokens)} input, ${fmt(usage.cache_read_input_tokens)} cache read, ${fmt(usage.cache_creation_input_tokens)} cache write, ${fmt(usage.output_tokens)} output in ${batches} batch(es): about $${dollars.toFixed(2)}`);

    /* write: only what changes; stale pages of a language written here are removed */
    let written = 0;
    for (const [f, text] of files) {
      if (existsSync(f) && readFileSync(f, "utf8") === text) continue;
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(`${f}.tmp`, text);
      renameSync(`${f}.tmp`, f);
      written++;
    }
    for (const p of plans) {
      const d = join(out, `assets/docs-i18n/${p.lang}`);
      if (!Object.keys(p.pages).length || !existsSync(d)) continue;
      const want = new Set([...eng.sources.map((s) => `${s.slug}.json`), "index.json"]);
      for (const f of readdirSync(d)) if (f.endsWith(".json") && !want.has(f)) { rmSync(join(d, f)); written++; }
    }
    const rep = { model: MODEL, estimate: est, usage, dollars: Math.round(dollars * 100) / 100, batches, summary: summary.join("\n"), languages: reportLangs, kept: keptAll };
    mkdirSync(dirname(report), { recursive: true });
    writeFileSync(report, `${JSON.stringify(rep, null, 2)}\n`);
    for (const l of summary) log(l);
    log(`${written} file(s) written; report ${report}`);
    return 0;
  } catch (e) {
    if (e instanceof Exit) { (e.code === 3 ? log : console.error)(e.message); return e.code; }
    throw e;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  run({ args: process.argv.slice(2) }).then((code) => { process.exitCode = code; }, (e) => { console.error(e && e.stack || String(e)); process.exitCode = 1; });
}
