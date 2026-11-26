/*
 * Test for orbit-site #125 stage 1 (German proves the pattern), written from the specification alone (issue #125,
 * notes 52454, 52457 and the AI-notice addition). No browser.
 *
 *   C1  de.json has exactly en.json's keys, with the same {placeholder} sets; both hold the key `ai-notice`
 *   C2  every data-i18n / data-i18n-attr key in index.html exists in en.json
 *   P1  `node tools/pages.mjs --check` exits 0 (de/index.html is fresh)
 *   P2  build(index.html, de.json, "de") equals de/index.html on disk
 *   P3  the built page: <html lang="de">, hreflang en/de/x-default, robots noindex, no <base>
 *   P4  German strings stand in place of English for a sample of keys (read from the catalogues)
 *   P5  every local src/href of de/index.html exists on disk relative to de/
 *   P6  de/index.html carries the AI notice (.ai-notice, key ai-notice, a link hreflang="en") at least on the door and
 *       the docs pad; the root index.html has the hreflang set, no noindex and no notice
 *   P9  (#159, ALL-F3) the built language page keeps `hidden` on the docs "not translated" line (data-translated-only)
 *   L1  lang.js t(): placeholders filled; a missing key falls back to the key's English
 *   L2  lang.js pick(): stored beats languages; "de-AT" picks de; no match gives null; stored "en" gives null;
 *       "en" in languages means the root (null)
 *   N1  404.html says its line in German and English and has no <script>
 *   P8  (#138, W1-F1) every key a script looks up with tr() that the German catalogue words differently is in the German
 *       page's own script catalogue (so tr() answers in German), including the year-ring's boiler-service, car-mot and
 *       home-insurance, which the markup also names
 *   S1  (#138, ALL-S1) the root's auto-lang script, run over a table of address x storage x browser (the visitor's
 *       address is the one signal left when the browser keeps nothing and sends no referrer): an explicit lang in the
 *       address beats a stored choice and the browser's languages ("en" stays, a built language goes there, anything
 *       else is ignored); with no lang in the address the rule is as before
 *
 *   node tools/ci/i18n-test.mjs
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const at = (p) => join(ROOT, p);
let failed = false;
const check = (name, ok, detail) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`); if (!ok) failed = true; };
/* a missing file is a failed check, never a crash */
const attempt = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, String(e && e.message || e)); } };
const read = (p) => { if (!existsSync(at(p))) throw new Error(`${p} does not exist`); return readFileSync(at(p), "utf8"); };
const json = (p) => JSON.parse(read(p));
const holders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => m[0]);
const attr = (tag, a) => (tag.match(new RegExp(`\\b${a}\\s*=\\s*"([^"]*)"`, "i")) || [])[1];
const hreflangs = (html) => tags(html, "link").filter((t) => /rel="alternate"/i.test(t) && attr(t, "hreflang")).map((t) => attr(t, "hreflang")).sort();

const indexHtml = existsSync(at("index.html")) ? readFileSync(at("index.html"), "utf8") : "";
let en = null, de = null;

await attempt("C1 catalogues", async () => {
  en = json("assets/i18n/en.json"); de = json("assets/i18n/de.json");
  const ek = Object.keys(en).sort(), dk = Object.keys(de).sort();
  const gone = ek.filter((k) => !(k in de)), extra = dk.filter((k) => !(k in en));
  check("C1a de.json has exactly en.json's keys", !gone.length && !extra.length && ek.length > 0, `${ek.length} keys; missing ${JSON.stringify(gone.slice(0, 5))}, extra ${JSON.stringify(extra.slice(0, 5))}`);
  const bad = ek.filter((k) => k in de && holders(en[k]) !== holders(de[k]));
  check("C1b same placeholder sets per key", !bad.length, bad.length ? `differ: ${bad.slice(0, 5).join(", ")}` : "all alike");
  check("C1c both hold ai-notice (non-empty, German differs)", !!en["ai-notice"] && !!de["ai-notice"] && en["ai-notice"] !== de["ai-notice"], `en ${JSON.stringify(en["ai-notice"])}`);
});

const usedKeys = () => {
  const keys = new Set();
  for (const m of indexHtml.matchAll(/\bdata-i18n\s*=\s*"([^"]+)"/g)) keys.add(m[1]);
  for (const m of indexHtml.matchAll(/\bdata-i18n-attr\s*=\s*"([^"]+)"/g)) for (const pair of m[1].split(",")) keys.add(pair.split(":").slice(1).join(":").trim());
  return [...keys];
};
await attempt("C2 keys used", async () => {
  const used = usedKeys();
  const miss = used.filter((k) => !en || !(k in en));
  check("C2 every data-i18n / data-i18n-attr key of index.html is in en.json", used.length > 0 && !miss.length, `${used.length} used; missing ${JSON.stringify(miss.slice(0, 5))}`);
});

await attempt("P1 pages --check", async () => {
  if (!existsSync(at("tools/pages.mjs"))) throw new Error("tools/pages.mjs does not exist");
  const r = spawnSync(process.execPath, [at("tools/pages.mjs"), "--check"], { cwd: ROOT, encoding: "utf8" });
  check("P1 node tools/pages.mjs --check exits 0", r.status === 0, `exit ${r.status} ${(r.stderr || r.stdout || "").trim().slice(0, 120)}`);
});

let built = "";
await attempt("P2 build", async () => {
  const { build } = await import(pathToFileURL(at("tools/pages.mjs")).href);
  built = build(indexHtml, de, "de");
  check("P2 build() returns a string equal to de/index.html", typeof built === "string" && built === read("de/index.html"), `${built.length} chars`);
});

await attempt("P3 head", async () => {
  const html = built || read("de/index.html");
  check("P3a <html lang=\"de\">", /<html\b[^>]*\blang="de"/i.test(html), "html tag");
  const hl = hreflangs(html);
  check("P3b hreflang en, de, x-default", ["de", "en", "x-default"].every((l) => hl.includes(l)), JSON.stringify(hl));
  check("P3c robots noindex", tags(html, "meta").some((t) => attr(t, "name") === "robots" && /noindex/.test(attr(t, "content") || "")), "meta robots");
  check("P3d no <base>", !/<base\b/i.test(html), "base");
});

await attempt("P4 strings", async () => {
  const html = built || read("de/index.html");
  const texts = [...indexHtml.matchAll(/\bdata-i18n\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  const sample = [...new Set(texts)].filter((k) => en[k] && de[k] && en[k] !== de[k] && !holders(en[k]) && /^[\p{L}\p{N} ,.!?-]+$/u.test(de[k]) && /^[\p{L}\p{N} ,.!?-]+$/u.test(en[k])).slice(0, 8);
  const noDe = sample.filter((k) => !html.includes(de[k]));
  const stillEn = sample.filter((k) => html.includes(`>${en[k]}<`));
  check("P4 German in place of English for a sample of keys", sample.length >= 3 && !noDe.length && !stillEn.length, `${sample.length} sampled; no German ${JSON.stringify(noDe)}; still English ${JSON.stringify(stillEn)}`);
});

await attempt("P9 untranslated line", async () => {
  /* #159 ALL-F3: a language page keeps `hidden` on the docs "not translated" line; pads.js un-hides it only when the
     docs really are English, so with the docs fetch blocked or delayed the line stays hidden */
  const html = built || read("de/index.html");
  const lines = [...html.matchAll(/<p\b[^>]*\bclass="[^"]*\buntranslated\b[^"]*"[^>]*>/g)].map((m) => m[0]);
  check("P9a the built language page has the docs untranslated line(s)", lines.length >= 1, `${lines.length} found`);
  check("P9b each stays hidden and keeps data-translated-only (the build does not strip them)", lines.length >= 1 && lines.every((t) => /\shidden(\s|>|=)/.test(t) && /\bdata-translated-only\b/.test(t)), JSON.stringify(lines.slice(0, 2)));
  check("P9c de/index.html on disk agrees", (read("de/index.html").match(/<p\b[^>]*\buntranslated\b[^>]*\shidden/g) || []).length === lines.length, "on disk");
});

await attempt("P5 paths", async () => {
  const html = built || read("de/index.html");
  const refs = [];
  for (const t of [...tags(html, "link"), ...tags(html, "script"), ...tags(html, "img"), ...tags(html, "source"), ...tags(html, "a")]) {
    for (const a of ["src", "href"]) { const v = attr(t, a); if (v !== undefined) refs.push(v); }
  }
  const local = refs.filter((v) => v && !/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(v));
  const missing = [...new Set(local)].filter((v) => !existsSync(join(ROOT, "de", decodeURIComponent(v.split(/[?#]/)[0] || "."))));
  check("P5 every local src/href exists relative to de/", local.length > 0 && !missing.length, `${local.length} local; missing ${JSON.stringify(missing.slice(0, 5))}`);
});

await attempt("P6 notice and root", async () => {
  const html = built || read("de/index.html");
  const notices = [...html.matchAll(/<(\w+)\b[^>]*class="[^"]*\bai-notice\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/g)];
  const withLink = notices.filter((m) => /<a\b[^>]*\bhreflang="en"/.test(m[2]));
  check("P6a de/ has the AI notice at least twice (door and docs pad), each with an English link", notices.length >= 2 && withLink.length === notices.length, `${notices.length} notices, ${withLink.length} with an hreflang=en link`);
  check("P6b the notice text comes from key ai-notice", /data-i18n="ai-notice"/.test(indexHtml) && notices.every((m) => m[2].includes(de["ai-notice"]) ), "data-i18n=ai-notice in index.html, German text in de/");
  const hl = hreflangs(indexHtml);
  check("P6c root index.html has hreflang en, de, x-default", ["de", "en", "x-default"].every((l) => hl.includes(l)), JSON.stringify(hl));
  check("P6d root has no noindex", !tags(indexHtml, "meta").some((t) => /noindex/.test(attr(t, "content") || "")), "meta robots");
  check("P6e root does not show the notice", !/class="[^"]*\bai-notice\b/.test(indexHtml), "no .ai-notice element in the root page");
});

await attempt("P7 switch", async () => {
  for (const [name, html] of [["root", indexHtml], ["de/", built || read("de/index.html")]]) {
    const menus = [...html.matchAll(/<(\w+)\b[^>]*class="[^"]*\blangs\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/g)];
    const good = menus.filter((m) => /<button\b[^>]*\baria-expanded="false"/.test(m[2]) && ["en", "de"].every((c) => new RegExp(`<a\\b(?=[^>]*\\bdata-lang="${c}")(?=[^>]*\\bhreflang="${c}")(?=[^>]*\\blang="${c}")(?=[^>]*\\bhref=)`).test(m[2])));
    check(`P7 ${name}: each .langs switch is a button[aria-expanded=false] and a link per language with data-lang, hreflang, lang, href`, menus.length > 0 && good.length === menus.length, `${menus.length} switches, ${good.length} right`);
  }
});

await attempt("L lang.js", async () => {
  const { t, pick } = await import(pathToFileURL(at("assets/js/lang.js")).href);
  check("L1a placeholders filled", t({ hi: "Hallo {name}, {n}" }, "hi", { name: "Ann", n: 2 }) === "Hallo Ann, 2", String(t({ hi: "Hallo {name}, {n}" }, "hi", { name: "Ann", n: 2 })));
  const k = Object.keys(en || {}).find((x) => !holders(en[x]));
  check("L1b a missing key falls back to the key's English", !!k && t({}, k) === en[k], `key ${k}`);
  check("L2a stored beats languages", pick({ stored: "en", languages: ["de"], built: ["de"] }) === null && pick({ stored: "de", languages: ["fr-FR"], built: ["de"] }) === "de", "stored en vs de; stored de vs fr");
  check("L2b de-AT picks de", pick({ stored: null, languages: ["de-AT"], built: ["de"] }) === "de", "de-AT");
  check("L2c first built language wins over earlier unbuilt ones", pick({ stored: null, languages: ["fr-FR", "de-DE", "en"], built: ["de"] }) === "de", "fr, de");
  check("L2d no match gives null", pick({ stored: null, languages: ["fr-FR", "ja"], built: ["de"] }) === null, "fr, ja");
  check("L2e stored en gives null", pick({ stored: "en", languages: ["de-DE"], built: ["de"] }) === null, "en stored");
});

await attempt("P8 script words", async () => {
  const html = built || read("de/index.html");
  const json = /<script type="application\/json" id="i18n">([\s\S]*?)<\/script>/.exec(html);
  if (!json) throw new Error("de/ has no <script type=\"application/json\" id=\"i18n\">");
  const page = JSON.parse(json[1]);
  const looked = new Set();
  for (const f of readdirSync(at("assets/js")).filter((x) => x.endsWith(".js"))) {
    /* every quoted key inside a tr(...) call, so tr(id === "willow" ? "the-dawn" : "your-sky") counts both (words that are
       not keys, such as "willow", are dropped below, where a key must be in both catalogues) */
    for (const call of read(`assets/js/${f}`).matchAll(/\btr\(([^)]*)\)/g)) for (const m of call[1].matchAll(/"([\w-]+)"/g)) looked.add(m[1]);
  }
  const gone = [...looked].filter((k) => de && en && de[k] && en[k] && de[k] !== en[k] && page[k] !== de[k]);
  check("P8a every key a script looks up with tr() that German words differently is in the German page's catalogue, in German", looked.size > 0 && !gone.length, `${looked.size} looked up; not in the page's catalogue in German: ${JSON.stringify(gone)}`);
  const ring = ["boiler-service", "car-mot", "home-insurance"].filter((k) => !de || page[k] !== de[k]);
  check("P8b the year-ring's three labels (boiler-service, car-mot, home-insurance) are in the page's catalogue in German", !ring.length, `missing or English: ${JSON.stringify(ring)}`);
});

await attempt("S1 auto-lang address", async () => {
  const auto = /<!-- auto-lang:[\s\S]*?-->\n[ \t]*<script>([\s\S]*?)<\/script>/.exec(indexHtml);
  if (!auto) throw new Error("index.html has no auto-lang script");
  const HERE = "https://example.test/site/";
  /* where the script sends a visitor: the address it replaces the page with, or null when it stays */
  const goes = ({ search = "", hash = "", referrer = "", stored = null, browser = [] }) => {
    let went = null;
    vm.runInNewContext(auto[1], {
      localStorage: { getItem: () => { if (stored === "unreadable") throw new Error("blocked"); return stored; } },
      navigator: { languages: browser, language: browser[0] },
      document: { referrer },
      location: { href: `${HERE}${search}${hash}`, search, hash, replace: (u) => { went = u; } },
      String,
    });
    return went;
  };
  /* the visitor the finding names: German first, site data blocked, no referrer */
  const blocked = { stored: "unreadable", browser: ["de-DE"] };
  check("S1a ?lang=en keeps a German browser with blocked storage and no referrer at the root", goes({ ...blocked, search: "?lang=en" }) === null, `goes to ${goes({ ...blocked, search: "?lang=en" })}`);
  check("S1b the same with another query riding along (?preview&lang=en) and a hash", goes({ ...blocked, search: "?preview&lang=en", hash: "#docs" }) === null, `goes to ${goes({ ...blocked, search: "?preview&lang=en", hash: "#docs" })}`);
  check("S1c ?lang=en beats a stored German choice", goes({ stored: "de", browser: ["de-DE"], search: "?lang=en" }) === null, `goes to ${goes({ stored: "de", browser: ["de-DE"], search: "?lang=en" })}`);
  check("S1d ?lang=de sends an English browser with nothing stored to de/, the address kept", goes({ browser: ["en-GB"], search: "?lang=de", hash: "#h" }) === "de/?lang=de#h", `goes to ${goes({ browser: ["en-GB"], search: "?lang=de", hash: "#h" })}`);
  check("S1e ?lang=de beats a stored English choice", goes({ stored: "en", browser: ["en-GB"], search: "?lang=de" }) === "de/?lang=de", `goes to ${goes({ stored: "en", browser: ["en-GB"], search: "?lang=de" })}`);
  check("S1i ?lang=de with a same-site referrer (a click from the site's own page) still sends the visitor to de/: the address is a choice too", goes({ browser: ["en-GB"], search: "?lang=de", referrer: `${HERE}de/` }) === "de/?lang=de", `goes to ${goes({ browser: ["en-GB"], search: "?lang=de", referrer: `${HERE}de/` })}`);
  check("S1f control: no lang in the address, the same visitor is sent to de/", goes({ ...blocked, search: "?q", hash: "#h" }) === "de/?q#h", `goes to ${goes({ ...blocked, search: "?q", hash: "#h" })}`);
  /* an unbuilt language, read from languages.json (the first with built false) */
  const unbuilt = Object.keys(JSON.parse(read("tools/i18n/languages.json"))).find((k) => !JSON.parse(read("tools/i18n/languages.json"))[k].built);
  if (!unbuilt) check("S1g no unbuilt language in languages.json: skipped", true, "none");
  else check(`S1g control: an unbuilt language in the address (?lang=${unbuilt}) is ignored: the browser's German still sends the visitor to de/`, goes({ ...blocked, search: `?lang=${unbuilt}` }) === `de/?lang=${unbuilt}`, `goes to ${goes({ ...blocked, search: `?lang=${unbuilt}` })}`);
  check("S1h control: ?lang=en with an English browser stays", goes({ browser: ["en-GB"], search: "?lang=en" }) === null, `goes to ${goes({ browser: ["en-GB"], search: "?lang=en" })}`);
});

/* ---- #125 languages live: the six go live with the machine-translation notice (spec sections 5 and 6) ---- */
const LANGS = (() => { try { return json("tools/i18n/languages.json"); } catch { return {}; } })();
const builtKeys = Object.keys(LANGS).filter((k) => LANGS[k].built);
const SIX = ["fr", "es", "pt", "id", "zh-Hans", "ja"];

await attempt("B1 six built", async () => {
  const off = SIX.filter((k) => !(LANGS[k] && LANGS[k].built === true));
  check("B1a fr, es, pt, id, zh-Hans and ja are built in languages.json", !off.length, `not built: ${JSON.stringify(off)}`);
  check("B1b de stays built and ar stays off", LANGS.de?.built === true && LANGS.ar?.built === false, `de ${LANGS.de?.built}, ar ${LANGS.ar?.built}`);
});

await attempt("W1 notices on every built page", async () => {
  check("W1 languages.json lists at least de", builtKeys.includes("de"), JSON.stringify(builtKeys));
  for (const lang of builtKeys) {
    const html = read(`${lang}/index.html`), cat = json(`assets/i18n/${lang}.json`);
    const notices = [...html.matchAll(/<(\w+)\b[^>]*class="[^"]*\bai-notice\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/g)];
    check(`W1a ${lang}/ has exactly four .ai-notice`, notices.length === 4, `${notices.length} found`);
    check(`W1b ${lang}/ notices each hold the catalogue's ai-notice text (not the English) and an <a hreflang="en" data-lang="en">`, notices.length > 0 && notices.every((m) => m[2].includes(cat["ai-notice"]) && !m[2].includes(en["ai-notice"]) && /<a\b(?=[^>]*\bhreflang="en")(?=[^>]*\bdata-lang="en")/.test(m[2])), `catalogue text ${JSON.stringify(String(cat["ai-notice"]).slice(0, 30))}`);
    /* one in each of the four containers the build stamps (the spec's "#home" is the info pad, #infopad, in the built page:
       index.html's four markers sit in #door, #installpad, #docspad and #infopad): count the notices between each container's
       start and the next of the four */
    const ids = ["door", "installpad", "docspad", "infopad"];
    const where = ids.map((id) => html.search(new RegExp(`\\bid="${id}"`)));
    const pos = notices.map((m) => m.index);
    const order = where.every((w) => w >= 0) ? [...where].sort((a, b) => a - b) : [];
    const per = order.map((w, i) => pos.filter((q) => q > w && q < (order[i + 1] ?? Infinity)).length);
    check(`W1c ${lang}/ one notice in each of #door, #installpad, #docspad, #infopad`, per.length === 4 && per.every((n) => n === 1), `ids at ${JSON.stringify(where)}, per container ${JSON.stringify(per)}`);
  }
  for (const f of ["index.html", "404.html", "install.html"]) {
    if (!existsSync(at(f))) { check(`W1d ${f} has no .ai-notice`, true, "no such file"); continue; }
    check(`W1d ${f} has no .ai-notice`, !/class="[^"]*\bai-notice\b/.test(read(f)), f);
  }
});

await attempt("Z1 zh-Hans rule", async () => {
  const { pick } = await import(pathToFileURL(at("assets/js/lang.js")).href);
  const Z = ["zh-Hans"];
  const p = (languages, built = Z) => pick({ stored: null, languages, built });
  check("Z1a zh-CN, zh, zh-SG and zh-Hans-SG pick zh-Hans (built zh-Hans)", ["zh-CN", "zh", "zh-SG", "zh-Hans-SG", "zh-Hans"].every((l) => p([l]) === "zh-Hans"), JSON.stringify(["zh-CN", "zh", "zh-SG", "zh-Hans-SG", "zh-Hans"].map((l) => p([l]))));
  check("Z1b zh-TW, zh-HK and zh-Hant give null", ["zh-TW", "zh-HK", "zh-Hant", "zh-Hant-TW"].every((l) => p([l]) === null), JSON.stringify(["zh-TW", "zh-HK", "zh-Hant", "zh-Hant-TW"].map((l) => p([l]))));
  check("Z1c a built key without a script keeps the primary-subtag rule (de-AT, fr-CA)", pick({ stored: null, languages: ["de-AT"], built: ["de", "zh-Hans"] }) === "de" && pick({ stored: null, languages: ["fr-CA"], built: ["fr"] }) === "fr", "de-AT, fr-CA");
  check("Z1d the first matching language wins past zh-TW (zh-TW, zh-CN gives zh-Hans)", p(["zh-TW", "zh-CN"]) === "zh-Hans", String(p(["zh-TW", "zh-CN"])));
  check("Z1e stored zh-Hans is honoured", pick({ stored: "zh-Hans", languages: [], built: Z }) === "zh-Hans", "stored");
  /* with the languages.json default (BUILT) as the build will leave it */
  check("Z1f pick({languages:[zh-CN]}) with the shipped BUILT gives zh-Hans, [zh-TW] gives null, [zh-Hans-SG] gives zh-Hans", pick({ languages: ["zh-CN"] }) === "zh-Hans" && pick({ languages: ["zh-TW"] }) === null && pick({ languages: ["zh-Hans-SG"] }) === "zh-Hans", JSON.stringify([pick({ languages: ["zh-CN"] }), pick({ languages: ["zh-TW"] }), pick({ languages: ["zh-Hans-SG"] })]));
  /* the root's inline script: same rule */
  const auto = /<!-- auto-lang:[\s\S]*?-->\n[ \t]*<script>([\s\S]*?)<\/script>/.exec(indexHtml);
  if (!auto) throw new Error("index.html has no auto-lang script");
  const goes = (browser) => { let went = null; vm.runInNewContext(auto[1], { localStorage: { getItem: () => null }, navigator: { languages: browser, language: browser[0] }, document: { referrer: "" }, location: { href: "https://example.test/", search: "", hash: "", replace: (u) => { went = u; } }, String }); return went; };
  check("Z1g the root's auto-lang script sends zh-CN, zh-Hans-CN and zh to zh-Hans/ and zh-TW nowhere", ["zh-CN", "zh-Hans-CN", "zh"].every((l) => goes([l]) === "zh-Hans/") && goes(["zh-TW"]) === null, JSON.stringify(["zh-CN", "zh-Hans-CN", "zh", "zh-TW"].map((l) => goes([l]))));
});

await attempt("Z2 LANG on zh-Hans/", async () => {
  /* lang.js reads document at import: give it a page whose <html lang> is zh-Hans */
  globalThis.document = { documentElement: { lang: "zh-Hans" }, baseURI: "https://example.test/zh-Hans/", getElementById: () => null };
  try {
    const m = await import(`${pathToFileURL(at("assets/js/lang.js")).href}?zh125`);
    check("Z2 on zh-Hans/, LANG is \"zh-Hans\"", m.LANG === "zh-Hans", String(m.LANG));
  } finally { delete globalThis.document; }
});

await attempt("PG pages --check with six built", async () => {
  /* languages.json is the build's input: with all six built, the folders must exist and be fresh */
  const missing = builtKeys.filter((k) => !existsSync(at(`${k}/index.html`)));
  check("PG every built language has its <lang>/index.html", !missing.length && builtKeys.length >= 7, `built ${JSON.stringify(builtKeys)}; missing ${JSON.stringify(missing)}`);
});

await attempt("N1 404", async () => {
  const html = read("404.html");
  check("N1a no <script>", !/<script\b/i.test(html), "404.html");
  check("N1b has German and English", /Not in this world/.test(html) && /\b(nicht|Seite|diese|Welt|gefunden)\b/i.test(html), "both lines");
});

process.exit(failed ? 1 : 0);
