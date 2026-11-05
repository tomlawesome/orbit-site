/*
 * The languages agree (#125), run by the lint (door section, beside tools/pages.mjs --check):
 *   - every catalogue (assets/i18n/<lang>.json) of a language in tools/i18n/languages.json, built or not, has exactly
 *     en.json's keys, each non-empty with the same {placeholders} and the same bare inline tags (a translation may
 *     move a link, never add or drop one); a built language has one. Beside each, tools/i18n/state/<lang>.json (the
 *     translation job's record, #125 stage 2) has exactly the catalogue's keys, and a key it keeps in English holds
 *     English's words. The rules are tools/i18n/lib.mjs's, which the job applies before writing
 *   - a language not built has no page of its own (<lang>/index.html)
 *   - en.json says what index.html says: each data-i18n / data-i18n-attr key there, with the page's own English
 *   - every key the scripts look up (tr("…"), said("…") in assets/js) is in en.json, and every key of en.json is used
 *     by the page, a script (any string literal that is a key) or the dusk (tools/door-markup.mjs), so a catalogue never carries dead words
 *   - the owner's disclosure line (p.made) has no key: it is never translated
 *   - each page (the root and each language's) names the same hreflang set: en, every language built, x-default
 *
 *   node tools/ci/i18n-check.mjs                       the whole check, on the checkout
 *   node tools/ci/i18n-check.mjs --catalogues <dir>    the catalogue rules alone, on <dir>/assets/i18n/<lang>.json and
 *                                                     <dir>/tools/i18n/state/<lang>.json against the checkout's English
 *                                                     (the publish job, on the translate job's artifact)
 *   - the languages the site is built in agree: the catalogues, lang.js's BUILT and the root's auto-lang script
 *   - that inline script sends a visitor where lang.js's pick() says, for a table of stored choices and browsers, and
 *     never sends back one who came from one of the site's own pages
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { allLanguages, languages, strings } from "../pages.mjs";
import { catalogueProblems, stateProblems } from "../i18n/lib.mjs";
import { BUILT, pick } from "../../assets/js/lang.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
let failed = 0;
const bad = (m) => { console.log(`   ${m}`); failed++; };

const en = JSON.parse(read("assets/i18n/en.json"));
let all;
try { all = allLanguages(); } catch { bad("tools/i18n/languages.json: cannot be read as JSON"); process.exit(1); }
const langs = languages();
/* the catalogues and their state files under base (the checkout, or the artifact given by --catalogues) */
function catalogues(base, whole) {
  for (const lang of Object.keys(all)) {
    const file = `assets/i18n/${lang}.json`, stateFile = `tools/i18n/state/${lang}.json`;
    if (!existsSync(join(base, file))) { if (whole && all[lang] && all[lang].built === true) bad(`${file}: missing, and ${lang} is built`); continue; }
    let cat, state;
    try { cat = JSON.parse(readFileSync(join(base, file), "utf8")); } catch { bad(`${file}: not JSON`); continue; }
    for (const m of catalogueProblems(en, cat, `${file}`)) bad(m);
    if (!existsSync(join(base, stateFile))) { bad(`${stateFile}: missing; ${file} has no record of the English it was made from`); continue; }
    try { state = JSON.parse(readFileSync(join(base, stateFile), "utf8")); } catch { bad(`${stateFile}: not JSON`); continue; }
    for (const m of stateProblems(en, cat, state, `${stateFile}`, `${file}`)) bad(m);
  }
}
const at = process.argv.indexOf("--catalogues");
if (at > 0) {
  const dir = process.argv[at + 1];
  if (!dir) { console.log("   usage: node tools/ci/i18n-check.mjs --catalogues <dir>"); process.exit(1); }
  catalogues(dir, false);
  if (failed) process.exit(1);
  console.log(`   ${dir}: the catalogues and their state agree with en.json`);
  process.exit(0);
}
catalogues(ROOT, true);
/* a language not built has no page */
for (const lang of Object.keys(all)) if (!langs.includes(lang) && existsSync(join(ROOT, lang, "index.html"))) bad(`${lang}/index.html: ${lang} is not built (tools/i18n/languages.json), so it has no page`);

/* the page's words */
const index = read("index.html");
const named = new Set();
for (const s of strings(index)) {
  named.add(s.key);
  if (!Object.hasOwn(en, s.key)) bad(`index.html: ${s.kind === "text" ? "data-i18n" : `data-i18n-attr ${s.kind}`} "${s.key}" is not in assets/i18n/en.json`);
  else if (en[s.key] !== s.words) bad(`index.html: "${s.key}" says ${JSON.stringify(s.words).slice(0, 80)}, en.json ${JSON.stringify(en[s.key]).slice(0, 80)} (one key, one text)`);
}

/* the owner's disclosure line (<p class="made">) is never translated: ~/claude/EXCEPTIONS.md allows it as written,
   never reworded, so it has no key and every language's page carries it in English */
if (/<p\b[^>]*\bclass="made"[^>]*\sdata-i18n|<p\b[^>]*\sdata-i18n[^>]*\bclass="made"/.test(index)) bad(`index.html: the disclosure line (p.made) carries data-i18n; it stays as the owner wrote it, untranslated`);

/* the scripts' words */
const js = ["main.js", "pads.js", "lang.js", "home.js", "law.js", "data.js", "tour.js"].map((f) => `assets/js/${f}`)
  .filter((f) => { try { read(f); return true; } catch { return false; } });
const used = new Set(named);
for (const f of js) {
  for (const m of read(f).matchAll(/\b(?:tr|said)\(\s*"([\w-]+)"/g)) {
    used.add(m[1]);
    if (!Object.hasOwn(en, m[1])) bad(`${f}: looks up "${m[1]}", which is not in assets/i18n/en.json`);
  }
  /* a key chosen in the call (tr(n === 1 ? "a" : "b")) is used too: any string that is a key counts */
  for (const m of read(f).matchAll(/"([a-z0-9][\w-]*)"/g)) if (Object.hasOwn(en, m[1])) used.add(m[1]);
}
for (const m of read("tools/door-markup.mjs").matchAll(/\["(dusk-[\w-]+)"\]/g)) used.add(m[1]);
for (const k of Object.keys(en)) if (!used.has(k)) bad(`assets/i18n/en.json: "${k}" is used by no page, script or the dusk; drop it`);

/* hreflang: the same set on every page */
const want = ["en", ...langs, "x-default"].sort().join(",");
for (const page of ["index.html", ...langs.map((l) => `${l}/index.html`)]) {
  const got = [...read(page).matchAll(/<link\b[^>]*\shreflang="([^"]+)"[^>]*>/g)].map((m) => m[1]).sort().join(",");
  if (got !== want) bad(`${page}: hreflang ${got || "none"}, want ${want}`);
}

/* the languages built, three ways */
if ([...BUILT].sort().join(",") !== langs.join(",")) bad(`assets/js/lang.js: BUILT is ${BUILT.join(",")}, the languages built (tools/i18n/languages.json) ${langs.join(",")}`);
const auto = /<!-- auto-lang:[\s\S]*?-->\n[ \t]*<script>([\s\S]*?)<\/script>/.exec(index);
if (!auto) bad("index.html: no auto-lang script (<!-- auto-lang: … --> then an inline <script>)");
else {
  const b = /\bb=(\[[^\]]*\])/.exec(auto[1]);
  if (!b || JSON.parse(b[1]).sort().join(",") !== langs.join(",")) bad(`index.html: the auto-lang script's languages are ${b ? b[1] : "unreadable"}, the languages built ${langs.join(",")}`);
  /* and it goes where pick() says */
  const cases = [];
  for (const stored of [null, "en", ...langs, "fr", "unreadable"]) {
    for (const browser of [[], ["en-GB"], ["de-DE"], ["de-AT", "en"], ["fr", "de"], ["fr", "en", "de"], ["ja"], ["EN-us", "de"], ["DE"]]) cases.push({ stored, browser });
  }
  /* where the visitor came from: nowhere, another site, or one of this site's pages (then it never redirects) */
  const HERE = "https://example.test/site/";
  const froms = { "": true, "https://elsewhere.test/a": true, [`${HERE}de/`]: false, [HERE]: false, "https://example.test/other/": true };
  for (const [referrer, follows] of Object.entries(froms)) for (const { stored, browser } of cases) {
    let went = null;
    const ctx = {
      localStorage: { getItem: () => { if (stored === "unreadable") throw new Error("blocked"); return stored; } },
      navigator: { languages: browser, language: browser[0] },
      document: { referrer },
      location: { href: `${HERE}?q#h`, search: "?q", hash: "#h", replace: (u) => { went = u; } },
      String,
    };
    vm.runInNewContext(auto[1], ctx);
    const p = follows ? pick({ stored: stored === "unreadable" ? null : stored, languages: browser }) : null;
    const expect = p ? `${p}/?q#h` : null;
    if (went !== expect) bad(`index.html: the auto-lang script, from ${referrer || "nowhere"}, stored ${stored}, browser [${browser}], goes to ${went}; want ${expect}`);
  }
}

if (failed) process.exit(1);
console.log(`   ${langs.join(", ")}: catalogues, page, scripts, hreflang and the auto-lang script agree`);
