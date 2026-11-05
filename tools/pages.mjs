/*
 * The site in each language it is built in (#125): a folder per language (de/), its index.html written from the
 * English index.html and that language's catalogue (assets/i18n/<lang>.json), so the page carries its words for first
 * paint and needs no build step on Pages. The commit holds what this writes; the lint runs it with --check.
 *
 * What a translated page is: index.html with
 *   - <html lang> the language's; <meta name="robots" content="noindex"> (until the language's review pass, H1)
 *   - every element's data-i18n text and every data-i18n-attr attribute from the catalogue. A text may hold the
 *     element's own inline tags, bare (<a>…</a>, <br/>): each is put back as the element has it, attributes and all,
 *     in order, so a translation can move a link but never change where it goes
 *   - the dusk's words (the door's farewell setting) from the catalogue, through tools/door-markup.mjs
 *   - the AI notice (the <template id="ai-notice">'s paragraph) at each <!-- ai-notice --> marker, and every element
 *     marked data-translated-only shown; the template itself and the root's auto-lang script left out (a language's
 *     address never redirects), with that script's hash out of the policy
 *   - each language link (a[data-lang]) pointing at that language's page from here, the page's own one aria-current
 *   - every path to the site's files (src, href, data-href: assets/…, sw.js) one up, to the root's; a link to "./"
 *     stays this language's own landing. No <base>: it would turn every #link into a link to the root
 *   - the words the site's scripts write, as <script type="application/json" id="i18n"> (assets/js/lang.js reads it):
 *     every key of the catalogue no element of the page names
 * and assets/i18n/en.js, the English catalogue as a module for lang.js (a JSON module would need a newer browser).
 *
 *   node tools/pages.mjs            writes de/index.html (each language's) and assets/i18n/en.js
 *   node tools/pages.mjs --check    exits 1 if any differs from what it would write
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { doorBlocks } from "./door-markup.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const escText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => escText(s).replace(/"/g, "&quot;");
const decode = (s) => s.replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/* an element's content as a catalogue holds it: its inline tags bare, its text decoded, its spaces collapsed */
export const asWords = (inner) => decode(inner.replace(/<([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g, "<$1$2>")).replace(/\s+/g, " ").trim();

/* each open tag carrying data-i18n, with the end of its content (the matching close, nesting counted) */
function texts(html) {
  const out = [];
  for (const m of html.matchAll(/<([a-zA-Z][\w-]*)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>/g)) {
    const name = m[1], start = m.index + m[0].length;
    const re = new RegExp(`<(/?)${name}\\b[^>]*>`, "gi"); re.lastIndex = start;
    let depth = 1, end = -1, close = -1, t;
    while ((t = re.exec(html))) { depth += t[1] ? -1 : 1; if (!depth) { end = t.index; close = t.index + t[0].length; break; } }
    if (end < 0) throw new Error(`<${name} data-i18n="${m[2]}"> is never closed`);
    out.push({ key: m[2], at: m.index, start, end, close, inner: html.slice(start, end) });
  }
  return out;
}
/* each data-i18n-attr pair: attribute and key */
const pairs = (v) => v.split(",").map((p) => { const i = p.indexOf(":"); return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; });
const attrOf = (tag, a) => { const m = tag.match(new RegExp(`\\s${a}="([^"]*)"`)); return m ? decode(m[1]) : undefined; };

/* every string the page names, as index.html has it in English: [{ key, kind: "text" | attribute name, words }] */
export function strings(html) {
  const out = [];
  for (const e of texts(html)) out.push({ key: e.key, kind: "text", words: asWords(e.inner) });
  for (const m of html.matchAll(/<[a-zA-Z][\w-]*\b[^>]*\sdata-i18n-attr="([^"]+)"[^>]*>/g)) {
    for (const [a, key] of pairs(m[1])) out.push({ key, kind: a, words: attrOf(m[0], a) ?? "" });
  }
  return out;
}

/* a catalogue's text as markup, its bare tags given back the element's own (by name, in order) */
export function markup(words, inner, key = "?") {
  const pool = {};
  for (const m of inner.matchAll(/<([a-zA-Z][\w-]*)\b[^>]*>/g)) (pool[m[1].toLowerCase()] ??= []).push(m[0]);
  return String(words).split(/(<\/?[a-zA-Z][\w-]*\s*\/?>)/).map((piece, i) => {
    if (!(i % 2)) return escText(piece);
    const m = /^<(\/?)([a-zA-Z][\w-]*)/.exec(piece);
    if (m[1]) return piece;
    const tag = pool[m[2].toLowerCase()]?.shift();
    if (!tag) throw new Error(`${key}: the translation has a <${m[2]}> the page's element does not`);
    return tag;
  }).join("");
}

const SITE_FILE = /(\s(?:src|href|data-href)=")(assets\/|sw\.js")/g;
const sha = (s) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;

/* index.html in a language, from its catalogue */
export function build(indexHtml, catalogue, lang) {
  const cat = catalogue || {};
  const need = (key) => { if (!Object.hasOwn(cat, key)) throw new Error(`${lang}.json has no "${key}"`); return cat[key]; };
  let html = indexHtml;
  /* the root's auto-lang script, and its hash in the policy */
  const auto = /\n[ \t]*<!-- auto-lang:[\s\S]*?-->\n[ \t]*<script>([\s\S]*?)<\/script>/.exec(html);
  if (auto) html = html.replace(auto[0], "").replace(` ${sha(auto[1])}`, "");
  /* the AI notice: the template's paragraph at each marker, the template gone */
  const tpl = /\n[ \t]*<!-- the AI notice[\s\S]*?-->\n[ \t]*<template id="ai-notice">([\s\S]*?)<\/template>/.exec(html);
  if (!tpl) throw new Error("index.html has no <template id=\"ai-notice\">");
  html = html.replace(tpl[0], "");
  const notice = tpl[1].replace(/<p data-ai-notice>/, '<p class="ai-notice">');
  html = html.replace(/<!-- ai-notice -->/g, notice);
  html = html.replace(/\sdata-translated-only hidden/g, "");
  html = html.replace(/<html lang="[^"]*"/, `<html lang="${lang}"`);
  html = html.replace(/(\n([ \t]*)<meta name="viewport"[^>]*>)/, `$1\n$2<meta name="robots" content="noindex" />`);
  /* attributes first (a text's own inline tags then carry theirs translated), then texts, last first */
  html = html.replace(/<[a-zA-Z][\w-]*\b[^>]*\sdata-i18n-attr="([^"]+)"[^>]*>/g, (tag, v) => {
    for (const [a, key] of pairs(v)) tag = tag.replace(new RegExp(`(\\s${a}=")[^"]*"`), (_, pre) => `${pre}${escAttr(need(key))}"`);
    return tag;
  });
  for (const e of texts(html).reverse()) html = html.slice(0, e.start) + markup(need(e.key), e.inner, e.key) + html.slice(e.end);
  /* the dusk's words, through the door's own setting */
  html = doorBlocks(html, { "dusk-said": need("dusk-said"), "dusk-sub": need("dusk-sub") });
  /* each language link: that language's page from this folder */
  html = html.replace(/<a data-lang="([a-z-]+)" href="[^"]*"([^>]*)>/g, (_, to, rest) => {
    const href = to === lang ? "./" : to === "en" ? "../" : `../${to}/`;
    rest = rest.replace(/\saria-current="page"/, "");
    return `<a data-lang="${to}" href="${href}"${rest}${to === lang ? ' aria-current="page"' : ""}>`;
  });
  html = html.replace(SITE_FILE, "$1../$2");
  /* the words the scripts write */
  const named = new Set(strings(indexHtml).map((s) => s.key));
  const own = Object.fromEntries(Object.keys(cat).filter((k) => !named.has(k)).sort().map((k) => [k, cat[k]]));
  const data = JSON.stringify(own).replace(/</g, "\\u003c");
  html = html.replace(/\n([ \t]*)<\/head>/, `\n$1  <script type="application/json" id="i18n">${data}</script>\n$1</head>`);
  return html;
}

/* assets/i18n/en.js: the English catalogue as a module */
export const englishModule = (en) => `/* written by tools/pages.mjs from assets/i18n/en.json: edit that, then run it (the lint checks this is fresh) */\nexport default ${JSON.stringify(en, null, 1)};\n`;

/* the languages built: every catalogue but English's */
export const languages = () => readdirSync(join(ROOT, "assets/i18n")).filter((f) => /^[a-z-]+\.json$/.test(f) && f !== "en.json").map((f) => f.slice(0, -5)).sort();

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const check = process.argv.includes("--check");
  const read = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : null);
  const index = read("index.html");
  const want = { "assets/i18n/en.js": englishModule(JSON.parse(read("assets/i18n/en.json"))) };
  for (const lang of languages()) want[`${lang}/index.html`] = build(index, JSON.parse(read(`assets/i18n/${lang}.json`)), lang);
  let stale = 0;
  for (const [p, body] of Object.entries(want)) {
    if (read(p) === body) continue;
    if (check) { console.log(`   ${p} is not what tools/pages.mjs writes from index.html and the catalogues (run: node tools/pages.mjs)`); stale++; continue; }
    mkdirSync(dirname(join(ROOT, p)), { recursive: true });
    writeFileSync(join(ROOT, p), body);
    console.log(`${p}: written`);
  }
  if (check && stale) process.exit(1);
  if (check) console.log(`   ${Object.keys(want).join(", ")}: fresh`);
}
