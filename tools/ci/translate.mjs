/*
 * The translation job (#125 stage 2): the site's catalogue (assets/i18n/en.json) and the imported docs
 * (assets/docs/) in each language of tools/i18n/languages.json, by the Claude API's Message Batches, sending only what
 * changed since the stored hash of the English each translation was made from.
 *
 *   node tools/ci/translate.mjs [--langs de,fr] [--only site|docs] [--dry-run] [--max-tokens N]
 *        [--out DIR] [--report FILE] [--poll-seconds 60] [--timeout-minutes 170] [--api-base URL]
 *
 * Patterns: a content-hash incremental build (each translated item carries hash16 of its English; only a changed
 * hash is sent again); schema-constrained output with post-validation (structured JSON out, the mechanical checks of
 * spec 2.2, one bounded retry with the broken rules named, then the English kept and reported); prefix caching (one
 * frozen system block, the volatile text after it); a hard spend ceiling before work starts (the estimate is printed
 * and checked against the cap before anything is sent; --dry-run needs no key and sends nothing).
 *
 * The key is read from the environment (ANTHROPIC_API_KEY) and nowhere else: never an argument, never printed,
 * sent only as the x-api-key header, and only to --api-base's own origin (a results URL elsewhere is refused). The
 * job that runs this holds the key, so it runs no third-party code: Node's standard library and fetch, raw HTTP.
 *
 * Writes, under --out (default the checkout): assets/i18n/<lang>.json and tools/i18n/state/<lang>.json, and
 * assets/docs-i18n/<lang>/<slug>.json and index.json (spec 1); and the report (default translate-report.json).
 * A file whose content would not change is not rewritten.
 *
 * Exit codes: 0 done (items kept in English are in the report); 1 usage or configuration; 2 the English is off its
 * shape; 3 the estimate is above the cap, nothing sent; 4 the API (no key, 401/403, a batch that did not end in
 * time, which is cancelled first, a network failure after 3 tries). On 1 to 4 no output file is touched.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
export const DEFAULT_CAP = 2_000_000;
const CHUNK = 60, MAX_HTML = 100_000, MAX_OUT = 16_000;
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
const FLAGS = new Set(["--langs", "--only", "--dry-run", "--max-tokens", "--out", "--report", "--poll-seconds", "--timeout-minutes", "--api-base"]);
export function parseArgs(argv, env = process.env) {
  const o = { langs: null, only: null, dryRun: false, maxTokens: null, out: null, report: null, pollSeconds: 60, timeoutMinutes: 170, apiBase: "https://api.anthropic.com" };
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
    else if (a === "--api-base") { let u; try { u = new URL(v); } catch { throw new Exit(1, `--api-base ${JSON.stringify(v)} is not a URL`); } if (!/^https?:$/.test(u.protocol)) throw new Exit(1, "--api-base is not http(s)"); o.apiBase = u.origin; }
  }
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

function request(item, system, broke) {
  return {
    custom_id: item.customId,
    params: {
      model: MODEL,
      max_tokens: maxTokensFor(item.chars),
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userText(item.lang, item.L, item, broke) }],
      output_config: { effort: "high", format: { type: "json_schema", schema: item.kind === "section" ? SECTION_SCHEMA : CHUNK_SCHEMA } },
      fallbacks: "default",
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

export function estimate(items, system) {
  const sys = system.length / 3.5;
  let input = 0, output = 0, itemIn = 0;
  for (const it of items) {
    input += sys + it.chars / 3.5;
    itemIn += it.chars / 3.5;
    output += (it.chars * 1.3) / (it.L.script === "cjk" ? 2 : 3.5);
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
    else { const k = le.findIndex((l, j) => blankLabels(l) !== blankLabels(la[j])); if (k >= 0) p.push(`(e) mermaid diagram ${i + 1} line ${k + 1} changes more than its labels (a node id, arrow or keyword)`); }
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
function api(o) {
  const headers = (extra) => ({ "x-api-key": o.key, "anthropic-version": "2023-06-01", ...extra });
  async function call(method, url, body, extra = {}) {
    if (new URL(url).origin !== o.apiBase) throw new Exit(4, `the API pointed at another host (${new URL(url).host}); the key goes only to ${new URL(o.apiBase).host}`);
    for (let t = 1; ; t++) {
      let res;
      try {
        res = await o.fetch(url, { method, headers: headers(body ? { "content-type": "application/json", ...extra } : extra), body: body ? JSON.stringify(body) : undefined });
      } catch (e) {
        if (t >= 3) throw new Exit(4, `network failure after 3 tries: ${method} ${new URL(url).pathname}: ${String(e && (e.cause?.code || e.message)).slice(0, 120)}`);
        await sleep(Math.min(5, o.pollSeconds) * t); continue;
      }
      if (res.status === 401 || res.status === 403) throw new Exit(4, `HTTP ${res.status} from the API: the key was refused`);
      if (res.status === 429 || res.status >= 500) {
        if (t >= 3) throw new Exit(4, `HTTP ${res.status} from the API after 3 tries: ${method} ${new URL(url).pathname}`);
        await res.text().catch(() => ""); await sleep(Math.min(5, o.pollSeconds) * t); continue;
      }
      if (!res.ok) throw new Exit(4, `HTTP ${res.status} from the API: ${method} ${new URL(url).pathname}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
      return res;
    }
  }
  const base = `${o.apiBase}/v1/messages/batches`;
  return {
    async create(requests) {
      const j = await (await call("POST", base, { requests }, { "anthropic-beta": "server-side-fallback-2026-07-01" })).json();
      if (!j || typeof j.id !== "string" || !/^[\w-]+$/.test(j.id)) throw new Exit(4, "the API's answer to the batch has no id");
      return j.id;
    },
    get: async (id) => (await call("GET", `${base}/${id}`)).json(),
    cancel: async (id) => { await (await call("POST", `${base}/${id}/cancel`)).text(); },
    results: async (url) => (await call("GET", url)).text(),
  };
}

/* one batch, sent, waited for and read: custom_id -> result */
async function runBatch(o, client, requests, deadline, log) {
  const id = await client.create(requests);
  log(`batch ${id}: ${requests.length} requests`);
  for (;;) {
    const b = await client.get(id);
    if (b && b.processing_status === "ended") {
      if (typeof b.results_url !== "string") throw new Exit(4, `batch ${id} ended with no results_url`);
      const out = new Map();
      for (const line of (await client.results(b.results_url)).split("\n")) {
        if (!line.trim()) continue;
        let r; try { r = JSON.parse(line); } catch { throw new Exit(4, `batch ${id}: a results line is not JSON`); }
        if (isObj(r) && typeof r.custom_id === "string") out.set(r.custom_id, r.result);
      }
      return out;
    }
    if (Date.now() >= deadline) {
      log(`batch ${id} has not ended within --timeout-minutes; cancelling it`);
      await client.cancel(id);
      throw new Exit(4, `batch ${id} did not end within ${o.timeoutMinutes} minutes; cancelled, nothing written`);
    }
    await sleep(Math.min(o.pollSeconds, Math.max(0.01, (deadline - Date.now()) / 1000)));
  }
}

/* a result's text, or why there is none (errored, expired, canceled, refusal, max_tokens) */
function resultText(r) {
  if (!isObj(r)) return { fail: "errored: no result came back for this request", keep: true };
  if (r.type === "errored") return { fail: `errored: the API answered with an error (${String(r.error?.error?.type || r.error?.type || "unknown").slice(0, 40)})`, keep: true };
  if (r.type === "expired") return { fail: "expired: the batch expired before this request ran", keep: true };
  if (r.type === "canceled") return { fail: "canceled: the request was canceled", keep: true };
  const m = r.message;
  if (r.type !== "succeeded" || !isObj(m)) return { fail: `errored: an unknown result type ${String(r.type).slice(0, 20)}`, keep: true };
  if (m.stop_reason === "refusal") return { fail: "refused: the model declined this item (stop_reason refusal)", keep: true, usage: m.usage };
  if (m.stop_reason === "max_tokens") return { fail: "(g) the answer was cut off at max_tokens", usage: m.usage };
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
    log(`   about $${est.dollars.toFixed(2)} at batch prices with the system block cached; at most $${est.dollarsNoCache.toFixed(2)} with no cache hit (${MODEL}: $${PRICES.input} in, $${PRICES.output} out, $${PRICES.cacheRead} cache read per million tokens; a retry batch comes on top)`);
    if (est.total > o.maxTokens) throw new Exit(3, `the estimate, ${fmt(est.total)} tokens, is above the cap of ${fmt(o.maxTokens)}: nothing sent`);
    if (o.dryRun) { log("dry run: nothing sent, nothing written"); return 0; }

    const outcome = new Map(); /* customId -> { section } | { good: {key: text}, bad: {key: [rules]} } | { kept: [rules] } */
    const usage = { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 };
    const add = (u) => { if (isObj(u)) for (const k of Object.keys(usage)) usage[k] += Number.isFinite(u[k]) ? u[k] : 0; };
    let batches = 0;
    if (items.length) {
      if (!o.key) throw new Exit(4, "ANTHROPIC_API_KEY is not set: the run needs the key (a dry run does not)");
      const client = api(o), deadline = Date.now() + o.timeoutMinutes * 60_000;
      let todo = items.map((it) => ({ it, broke: null }));
      for (let round = 1; round <= 2 && todo.length; round++) {
        const results = await runBatch(o, client, todo.map(({ it, broke }) => request(round === 1 || it.kind !== "chunk" ? it : { ...it, payload: { items: it.payload.items.filter((x) => broke.keys.includes(x.id)) } }, system, broke && broke.rules)), deadline, log);
        batches++;
        const again = [];
        for (const { it, broke } of todo) {
          const r = resultText(results.get(it.customId));
          add(r.usage);
          const prev = outcome.get(it.customId);
          if (r.fail) {
            if (r.keep || round === 2) {
              if (it.kind === "chunk") { const keys = broke ? broke.keys : it.keys; outcome.set(it.customId, { good: prev ? prev.good : {}, bad: { ...(prev ? prev.bad : {}), ...Object.fromEntries(keys.map((k) => [k, [r.fail]])) } }); }
              else outcome.set(it.customId, { kept: [r.fail] });
            } else again.push({ it, broke: { rules: [r.fail], keys: broke ? broke.keys : it.keys } });
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
    }

    /* the files, in memory first: nothing is written until every batch is read */
    const files = new Map(), summary = [], reportLangs = {}, keptAll = [];
    for (const p of plans) {
      const R = reportLangs[p.lang] = { translated: 0, unchanged: p.unchanged, kept: 0, keptItems: [] };
      const keep = (id, rules, extra = {}) => { R.kept++; const e = { lang: p.lang, id, ...extra, rules }; R.keptItems.push(e); keptAll.push(e); };
      if (p.cat) {
        const cat = {}, kept = new Set(p.state.kept.filter((k) => typeof k === "string"));
        const chunkOf = new Map(p.items.filter((it) => it.kind === "chunk").flatMap((it) => it.keys.map((k) => [k, it])));
        for (const k of Object.keys(eng.en)) {
          const it = chunkOf.get(k);
          if (!it) { cat[k] = p.cat[k]; continue; }
          const res = outcome.get(it.customId) || { good: {}, bad: { [k]: ["errored: no result"] } };
          if (Object.hasOwn(res.good, k) && !res.bad[k]) { cat[k] = res.good[k]; kept.delete(k); R.translated++; }
          else { cat[k] = eng.en[k]; kept.add(k); keep(it.id, res.bad[k] || ["errored: no result"], { key: k }); }
        }
        const state = { catalogue: { ...p.hashes }, kept: Object.keys(eng.en).filter((k) => kept.has(k)) };
        files.set(join(out, `assets/i18n/${p.lang}.json`), `${JSON.stringify(cat, null, 2)}\n`);
        files.set(join(out, `tools/i18n/state/${p.lang}.json`), `${JSON.stringify(state, null, 2)}\n`);
      }
      if (Object.keys(p.pages).length) {
        const entries = [];
        for (const src of eng.sources) {
          const engPage = eng.pages[src.slug], pg = p.pages[src.slug], prev = pg.prev;
          const sections = [], keptIds = [];
          for (const s of engPage.sections) {
            const res = outcome.get(`docs/${src.slug}/${s.id}@${p.lang}`);
            const due = p.items.some((it) => it.kind === "section" && it.slug === src.slug && it.eng.id === s.id);
            if (!due) {
              sections.push(prev.sections.find((x) => isObj(x) && x.id === s.id));
              if (prev.source.kept.includes(s.id)) keptIds.push(s.id);
            } else if (res && res.section) { sections.push(res.section); R.translated++; }
            else { sections.push(structuredClone(s)); keptIds.push(s.id); keep(`docs/${src.slug}/${s.id}`, res ? res.kept : ["errored: no result"]); }
          }
          const { sections: _drop, ...head } = engPage;
          const page = { ...head, sections, source: { generated: eng.generated, sections: pg.hashes, kept: keptIds } };
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
