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
  /* the rule of tools/i18n/lib.mjs:42-43 (i18n-check): a key of en.json the catalogue lacks is pending, allowed only while the state holds no hash for it; extra keys never */
  const gap = (cat, state) => { const h = state.catalogue || {}; return { gone: ek.filter((k) => !(k in cat) && k in h), extra: Object.keys(cat).filter((k) => !(k in en)) }; };
  const state = json("tools/i18n/state/de.json"), { gone: g2, extra: x2 } = gap(de, state);
  check("C1a de.json has en.json's keys, or lacks one that has no hash in its state (pending), and no others", !g2.length && !x2.length && ek.length > 0, `${ek.length} keys; missing with a hash ${JSON.stringify(g2.slice(0, 5))}, extra ${JSON.stringify(x2.slice(0, 5))}`);
  const k0 = ek[0], { [k0]: _drop, ...lacking } = de;
  const hashed = gap(lacking, { catalogue: { ...state.catalogue, [k0]: "0123456789abcdef" } }), pending = gap(lacking, { catalogue: Object.fromEntries(Object.entries(state.catalogue).filter(([k]) => k !== k0)) });
  check("C1a' a key missing from the catalogue that has a hash is refused; with no hash it is pending and allowed; an extra key is refused", hashed.gone.join() === k0 && !pending.gone.length && gap({ ...de, zz_extra: "x" }, state).extra.join() === "zz_extra", `hash ${JSON.stringify(hashed.gone)}, no hash ${JSON.stringify(pending.gone)}`);
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
  check("B1b de stays built and ar is built too (#173)", LANGS.de?.built === true && LANGS.ar?.built === true, `de ${LANGS.de?.built}, ar ${LANGS.ar?.built}`);
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

/* ---- #173 Arabic, right to left (spec "Arabic right-to-left layout", sections 2 to 5; no browser) ----
 *   D1  languages.json: ar carries "dir": "rtl", no other language carries a dir
 *   D2  ar/index.html is <html lang="ar" dir="rtl">; the root, 404, install and every other built page carry no dir; build() agrees
 *   D3  the Arabic page and the root's markup carry dir="ltr" on `.cmd code`, `.theline code` and #relay-addr
 *   D4  ar is in lang.js BUILT, pick() and the root's auto-lang script send an Arabic browser to ar/, every page's switch links ar
 *       with lang and hreflang
 *   D5  site.css: logical properties carry the chrome, :lang(ar) zeroes letter-spacing and raises the small print, the code rule,
 *       the font stack, and at most a handful of [dir=rtl] rules (no override sheet); door.css is left alone
 *   D6  lang.js tr() on an Arabic page wraps a filled {value} in U+2068 ... U+2069; on the root it does not
 *   M1  (#176) assets/js/home.js holds no hard-coded English chrome of the inbox (lane headings, burns up, sure/unsure, Add to
 *       orbit, Dismiss, the armed buttons, nothing here, the Decide label): each comes from tr()
 *   M2  (#176) en.json holds a key whose words are each of those strings and the account drawer's THEME label (matched on the
 *       words, not the key's name), so the build has them to look up
 *   M3  (#176) index.html's THEME span carries data-i18n, with a key of M2, and de/index.html shows that key's de.json words
 *       (its English while de.json lacks it), whatever they are
 *   M4  (#176) i18n-check.mjs exits 0 (a new key is in each catalogue and state, or pending in neither)
 *   M5  (#176 remainder) home.js, comments stripped, holds no English of the suggestion row's line ("forwarded document"), of the
 *       inbox button's aria-label ("Inbox —", a "waiting" literal) or of the burns-up value ("in " / "d" around burnsInDays), in
 *       any quote or backtick; M6 data.js no longer holds "in 51 days"
 *   M7  (#176 remainder) en.json and the generated en.js each hold exactly one value equal to "Inbox — {n} waiting" and to
 *       "Found in 1 forwarded document · renews {date} · {cost}"
 *   M8  (#176 remainder) i18n-check.mjs still exits 0
 *   N1  (#177) home.js, law.js and data.js (string and template literals only, comments out) no longer write the demo's English
 *       page words: the dial's spoken labels and callout, the list's lines, the item drawer's labels, buttons and notes, the
 *       search box's words, law.js's month and weekday tables and repeat phrases, data.js's section names and inbox sentences
 *   N2  (#177) en.json and the generated en.js each hold an English value containing each of those phrases (matched on the
 *       value, not on a key's name), and the four section names as values of their own
 *   N3  (#177) dates, months, relative times and numbers are the browser's: Intl.DateTimeFormat, Intl.NumberFormat (unit month),
 *       and no hard-coded "en-GB" in the three files
 *   N4  (#177) point 8: no translated word is put into an HTML string (a template literal that holds markup and a tr() call)
 *   N5  (#177) i18n-check.mjs still exits 0 (the new keys are pending in the other languages)
 */
const rtlTag = (html) => (/<html\b[^>]*>/i.exec(html) || [""])[0];
await attempt("D1 dir in languages.json", async () => {
  const withDir = Object.keys(LANGS).filter((k) => "dir" in LANGS[k]);
  check("D1a ar has dir \"rtl\"", LANGS.ar?.dir === "rtl", JSON.stringify(LANGS.ar));
  check("D1b no other language carries a dir (ltr is the default)", withDir.length === 1 && withDir[0] === "ar", JSON.stringify(withDir));
});

await attempt("D2 html dir", async () => {
  const ar = read("ar/index.html");
  check("D2a ar/index.html is <html lang=\"ar\" dir=\"rtl\">", /<html\b[^>]*\blang="ar"[^>]*\bdir="rtl"|<html\b[^>]*\bdir="rtl"[^>]*\blang="ar"/.test(rtlTag(ar)), rtlTag(ar));
  const others = ["index.html", "404.html", "install.html", ...builtKeys.filter((k) => k !== "ar").map((k) => `${k}/index.html`)].filter((f) => existsSync(at(f)));
  const withDir = others.filter((f) => /\sdir\s*=/.test(rtlTag(read(f))));
  check("D2b no other page has a dir attribute on <html>", others.length >= 8 && !withDir.length, `${others.length} pages; with dir ${JSON.stringify(withDir)}`);
  const { build } = await import(pathToFileURL(at("tools/pages.mjs")).href);
  const arCat = json("assets/i18n/ar.json");
  check("D2c build(index.html, ar.json, \"ar\") equals ar/index.html on disk", build(indexHtml, arCat, "ar") === ar, "ar");
  check("D2d build(..., \"de\") still has no dir", !/\sdir\s*=/.test(rtlTag(build(indexHtml, de, "de"))), rtlTag(build(indexHtml, de, "de")));
  const dirs = [...ar.matchAll(/<[a-z][^>]*\sdir="(?:rtl)"/gi)].length;
  check("D2e dir=\"rtl\" is on <html> only (nothing else in the page is marked rtl)", dirs === 1, `${dirs} element(s) with dir="rtl"`);
});

await attempt("D3 code stays ltr", async () => {
  /* the code elements: .cmd code, .theline code and #relay-addr, found by their container in the markup */
  const find = (html) => {
    const out = [];
    for (const m of html.matchAll(/<div\b[^>]*class="cmd"[^>]*>\s*(<code\b[^>]*>)/g)) out.push([".cmd code", m[1]]);
    for (const m of html.matchAll(/<p\b[^>]*class="theline"[^>]*>\s*(<code\b[^>]*>)/g)) out.push([".theline code", m[1]]);
    for (const m of html.matchAll(/<code\b[^>]*\bid="relay-addr"[^>]*>/g)) out.push(["#relay-addr", m[0]]);
    return out;
  };
  for (const [name, html] of [["ar/index.html", read("ar/index.html")], ["index.html", indexHtml]]) {
    const found = find(html);
    const kinds = new Set(found.map((f) => f[0]));
    check(`D3 ${name}: .cmd code, .theline code and #relay-addr are found and each has dir="ltr"`, kinds.size === 3 && found.every(([, tag]) => attr(tag, "dir") === "ltr"), JSON.stringify(found.map(([k, tag]) => [k, attr(tag, "dir") || null])));
  }
});

await attempt("D4 ar is a built language everywhere", async () => {
  const { BUILT, pick } = await import(pathToFileURL(at("assets/js/lang.js")).href);
  check("D4a lang.js BUILT lists ar", BUILT.includes("ar"), JSON.stringify(BUILT));
  check("D4b pick() sends ar, ar-EG and ar-SA to ar; stored ar is honoured", ["ar", "ar-EG", "ar-SA"].every((l) => pick({ languages: [l] }) === "ar") && pick({ stored: "ar", languages: [] }) === "ar", JSON.stringify(["ar", "ar-EG", "ar-SA"].map((l) => pick({ languages: [l] }))));
  const auto = /<!-- auto-lang:[\s\S]*?-->\n[ \t]*<script>([\s\S]*?)<\/script>/.exec(indexHtml);
  if (!auto) throw new Error("index.html has no auto-lang script");
  const goes = (browser) => { let went = null; vm.runInNewContext(auto[1], { localStorage: { getItem: () => null }, navigator: { languages: browser, language: browser[0] }, document: { referrer: "" }, location: { href: "https://example.test/", search: "", hash: "", replace: (u) => { went = u; } }, String }); return went; };
  check("D4c the root's auto-lang script sends ar-EG and ar to ar/", goes(["ar-EG"]) === "ar/" && goes(["ar"]) === "ar/", JSON.stringify([goes(["ar-EG"]), goes(["ar"])]));
  for (const [name, html] of [["root", indexHtml], ...builtKeys.map((k) => [`${k}/`, read(`${k}/index.html`)])]) {
    const sw = (/<nav\b[^>]*class="langs"[^>]*>([\s\S]*?)<\/nav>/.exec(html) || [])[1] || "";
    check(`D4d ${name}: the switch has an ar link with lang, hreflang and data-lang`, /<a\b(?=[^>]*\bdata-lang="ar")(?=[^>]*\bhreflang="ar")(?=[^>]*\blang="ar")(?=[^>]*\bhref=)/.test(sw), sw.slice(0, 60));
  }
});

await attempt("D5 css", async () => {
  const css = read("assets/site.css");
  const count = (re) => (css.match(re) || []).length;
  const logical = count(/\b(?:inset-inline-(?:start|end)|margin-inline-(?:start|end)|padding-inline-(?:start|end)|border-inline-(?:start|end)(?:-[a-z]+)?|border-(?:start|end)-(?:start|end)-radius)\s*:/g) + count(/text-align\s*:\s*(?:start|end)\b/g);
  check("D5a site.css carries at least 30 logical-property declarations (the spec converts about 50 text and chrome rules)", logical >= 30, `${logical} found`);
  const rules = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
  const arRules = rules.filter(([sel]) => /:lang\(\s*ar\s*\)/.test(sel));
  check("D5b a :lang(ar) rule sets letter-spacing:0", arRules.some(([, b]) => /letter-spacing\s*:\s*0(?:px|em)?\s*(?:;|$|!)/.test(b)), `${arRules.length} :lang(ar) rules`);
  const small = arRules.flatMap(([, b]) => [...b.matchAll(/font-size\s*:\s*([\d.]+)px/g)].map((m) => +m[1]));
  check("D5c a :lang(ar) rule raises small print to 12px", small.includes(12), JSON.stringify(small));
  check("D5d :lang(ar) sets --ui to a stack with 'Noto Sans Arabic' and --display to var(--ui); --mono is not touched", arRules.some(([, b]) => /--ui\s*:[^;}]*Noto Sans Arabic/.test(b) && /--display\s*:\s*var\(--ui\)/.test(b)) && !arRules.some(([, b]) => /--mono\s*:/.test(b)), "font vars");
  const code = rules.find(([sel]) => /\bpre\b/.test(sel) && /\bcode\b/.test(sel) && /\bkbd\b/.test(sel) && /\.cmd\b/.test(sel) && /\.theline\b/.test(sel) && /\.addr\b/.test(sel));
  check("D5e one rule gives pre, code, kbd, .cmd, .theline, .addr direction:ltr, unicode-bidi:isolate, text-align:start", !!code && /direction\s*:\s*ltr/.test(code[1]) && /unicode-bidi\s*:\s*isolate/.test(code[1]) && /text-align\s*:\s*start/.test(code[1]), code ? code[1] : "no such rule");
  const rtl = rules.filter(([sel]) => /\[dir=["']?rtl["']?\]/.test(sel));
  check("D5f [dir=rtl] rules exist for the drawers' translate and number at most 6 (logical properties, not an override sheet)", rtl.length >= 1 && rtl.length <= 6 && rtl.some(([sel]) => /drawer/.test(sel)), `${rtl.length}: ${JSON.stringify(rtl.map((r) => r[0]).slice(0, 6))}`);
  const door = read("assets/door/door.css");
  check("D5g door.css is untouched by direction: no logical property, dir selector or :lang(ar)", !/inset-inline|margin-inline|padding-inline|border-inline|\[dir|:lang\(|text-align\s*:\s*(?:start|end)/.test(door), "door.css");
});

await attempt("D6 tr isolates", async () => {
  const arCat = json("assets/i18n/ar.json");
  const key = Object.keys(en).find((k) => /\{\w+\}/.test(en[k]) && /\{\w+\}/.test(arCat[k] || ""));
  const name = (en[key].match(/\{(\w+)\}/) || [])[1];
  const run = async (lang, dir, tag) => {
    globalThis.document = { documentElement: { lang, dir }, dir, baseURI: `https://example.test/${lang}/`, getElementById: (id) => (id === "i18n" && lang === "ar" ? { textContent: JSON.stringify(arCat) } : null) };
    try { const m = await import(`${pathToFileURL(at("assets/js/lang.js")).href}?${tag}`); return m.tr(key, { [name]: "Orbit v1" }); } finally { delete globalThis.document; }
  };
  const a = await run("ar", "rtl", "rtl173ar"), e = await run("en", "ltr", "rtl173en");
  check(`D6a on ar/, tr("${key}", {${name}}) holds U+2068 + value + U+2069`, a.includes("\u2068Orbit v1\u2069"), JSON.stringify(a));
  check("D6b on the root the same call has no isolates", !/[\u2066-\u2069]/.test(e) && e.includes("Orbit v1"), JSON.stringify(e));
});

/* #174: ?lang= and a stored choice match a built language in any letter case, landing on its canonical code */
await attempt("K1 case-insensitive ?lang= and stored choice", async () => {
  const { pick, BUILT } = await import(pathToFileURL(at("assets/js/lang.js")).href);
  const auto = /<!-- auto-lang:[\s\S]*?-->\n[ \t]*<script>([\s\S]*?)<\/script>/.exec(indexHtml);
  if (!auto) throw new Error("index.html has no auto-lang script");
  /* the inline script: where it sends an English-browser visitor with this address and this stored choice */
  const inline = ({ search = "", stored = null, browser = ["en-GB"] }) => {
    let went = null;
    vm.runInNewContext(auto[1], { localStorage: { getItem: () => stored }, navigator: { languages: browser, language: browser[0] }, document: { referrer: "" }, location: { href: `https://example.test/${search}`, search, hash: "", replace: (u) => { went = u; } }, String });
    return went;
  };
  const dest = (u) => (u === null ? null : u.replace(/\/.*$/, ""));
  const cases = [["zh-hans", "zh-Hans"], ["ZH-HANS", "zh-Hans"], ["zh-HANS", "zh-Hans"], ["JA", "ja"], ["Ja", "ja"], ["DE", "de"]];
  const fmt = (f) => JSON.stringify(cases.map(([i]) => f(i)));
  check("K1a inline: ?lang=<any case> goes to the canonical built folder (zh-hans, ZH-HANS, JA, DE)", cases.every(([i, o]) => dest(inline({ search: `?lang=${i}` })) === o), fmt((i) => dest(inline({ search: `?lang=${i}` }))));
  check("K1b inline: a stored choice in any case does the same", cases.every(([i, o]) => dest(inline({ stored: i })) === o), fmt((i) => dest(inline({ stored: i }))));
  check("K1c lang.js pick(): a stored choice in any case gives the canonical code", cases.every(([i, o]) => pick({ stored: i, languages: ["en-GB"] }) === o), fmt((i) => pick({ stored: i, languages: ["en-GB"] })));
  check("K1d the shipped BUILT has these canonical codes", cases.every(([, o]) => BUILT.includes(o)), JSON.stringify(BUILT));
  const bad = ["ru", "RU", "xx", "zh-Hant", "ZH-HANT", "zh-tw", "zh"];
  check("K1e inline: an unbuilt or unknown ?lang= is ignored, the browser (English) decides: stays at the root", bad.every((c) => inline({ search: `?lang=${c}` }) === null), JSON.stringify(bad.map((c) => inline({ search: `?lang=${c}` }))));
  check("K1f inline: an unbuilt or unknown ?lang= falls back to the browser's language (de-DE goes to de/)", bad.every((c) => dest(inline({ search: `?lang=${c}`, browser: ["de-DE"] })) === "de"), JSON.stringify(bad.map((c) => inline({ search: `?lang=${c}`, browser: ["de-DE"] }))));
  check("K1g inline and lang.js: an unbuilt or unknown stored choice is ignored (English browser stays, German browser goes to de)", bad.every((c) => inline({ stored: c }) === null && pick({ stored: c, languages: ["en-GB"] }) === null && dest(inline({ stored: c, browser: ["de-DE"] })) === "de" && pick({ stored: c, languages: ["de-DE"] }) === "de"), JSON.stringify(bad.map((c) => [inline({ stored: c }), pick({ stored: c, languages: ["en-GB"] })])));
  check("K1h ?lang=EN and stored EN keep the visitor at the root (as en does)", inline({ search: "?lang=EN", browser: ["de-DE"] }) === null && inline({ stored: "EN", browser: ["de-DE"] }) === null && pick({ stored: "EN", languages: ["de-DE"] }) === null, JSON.stringify([inline({ search: "?lang=EN", browser: ["de-DE"] }), inline({ stored: "EN", browser: ["de-DE"] }), pick({ stored: "EN", languages: ["de-DE"] })]));
  check("K1i inline: the address keeps its query and hash and carries the canonical code (?lang=zh-hans goes to zh-Hans/?lang=zh-hans: query untouched)", inline({ search: "?lang=zh-hans" }) === "zh-Hans/?lang=zh-hans", String(inline({ search: "?lang=zh-hans" })));
  /* both copies agree over a table of stored choices */
  const table = ["zh-hans", "ZH-HANS", "JA", "ja", "ru", "xx", "zh-Hant", "zh-HK", "en", "EN", ""];
  const agree = table.every((c) => { const a = dest(inline({ stored: c })), b = pick({ stored: c, languages: ["en-GB"] }); return a === b; });
  check("K1j inline and lang.js give the same answer for each stored choice in a table", agree, JSON.stringify(table.map((c) => [c, dest(inline({ stored: c })), pick({ stored: c, languages: ["en-GB"] })])));
  /* browser languages: zh-HK and zh-Hant must not give zh-Hans in either copy */
  const hk = ["zh-HK", "zh-Hant", "zh-Hant-HK", "zh-TW", "ZH-hk", "zh-MO"];
  check("K1k inline and lang.js: zh-HK, zh-Hant, zh-Hant-HK, zh-TW, ZH-hk and zh-MO do not give zh-Hans", hk.every((l) => inline({ browser: [l] }) === null && pick({ stored: null, languages: [l] }) === null), JSON.stringify(hk.map((l) => [inline({ browser: [l] }), pick({ languages: [l] })])));
  check("K1l inline and lang.js: zh-CN, zh-SG and ZH-hans-cn still give zh-Hans", ["zh-CN", "zh-SG", "ZH-hans-cn"].every((l) => inline({ browser: [l] }) === "zh-Hans/" && pick({ languages: [l] }) === "zh-Hans"), JSON.stringify(["zh-CN", "zh-SG", "ZH-hans-cn"].map((l) => [inline({ browser: [l] }), pick({ languages: [l] })])));
});

/* ---- #176: the inbox drawer's and the account drawer's words come from the catalogue ---- */
/* the English the drawers hard-coded; the keys are found by their words, so the build is free to name them */
const CHROME176 = ["Filed", "For your review", "Still reading", "Failed to process", "renews", "cost", "provider", "burns up", "sure", "unsure", "Add to orbit", "Dismiss", "THEME"];
const norm176 = (x) => String(x).trim().toLowerCase();
const keysFor176 = (words) => Object.keys(en || {}).filter((k) => norm176(en[k]) === norm176(words));

await attempt("M1 home.js chrome", async () => {
  const src = read("assets/js/home.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const found = [];
  /* a literal that is only the words: "Filed", `Filed`, >Filed< (a class name such as "unsure" is not words) */
  for (const w of ["Filed", "For your review", "Still reading", "Failed to process", "burns up", "Add to orbit", "Dismiss", "nothing here", "Decide", "tap again to add", "tap again to dismiss"]) {
    if (new RegExp(`(["'\`>])\\s*${w}\\s*(["'\`<])`).test(src)) found.push(w);
  }
  if (/\?\s*["'`]sure["'`]\s*:\s*["'`]unsure["'`]/.test(src)) found.push("sure/unsure");
  check("M1 home.js has no hard-coded English chrome of the inbox", !found.length, found.length ? `still hard-coded in home.js: ${JSON.stringify(found)}` : "none");
});

await attempt("M2 en.json keys", async () => {
  const none = CHROME176.filter((w) => !keysFor176(w).length);
  check("M2 en.json has a key for each inbox and THEME word", !none.length, none.length ? `no key in en.json has the words ${JSON.stringify(none)}` : `${CHROME176.length} found`);
});

await attempt("M3 THEME span", async () => {
  const m = /<div\b[^>]*class="swatches"[^>]*>\s*(<span\b[^>]*>)([\s\S]*?)<\/span>/.exec(indexHtml);
  if (!m) throw new Error("index.html has no .swatches > span");
  const key = attr(m[1], "data-i18n");
  const ok = !!key && keysFor176("THEME").includes(key);
  check("M3a index.html's THEME span has data-i18n with a key whose English is Theme", ok, `span ${m[1]}${m[2]}</span>`);
  const dePage = read("de/index.html");
  const d = /<div\b[^>]*class="swatches"[^>]*>\s*<span\b[^>]*>([\s\S]*?)<\/span>/.exec(dePage);
  const want = key && en ? (de && key in de ? de[key] : en[key]) : null;
  check("M3b de/index.html's THEME span reads the catalogue's words for that key", !!d && want !== null && d[1].trim() === want, `de page says ${JSON.stringify(d && d[1].trim())}, catalogue ${JSON.stringify(want)}`);
});

await attempt("M4 i18n-check", async () => {
  const r = spawnSync(process.execPath, [at("tools/ci/i18n-check.mjs")], { cwd: ROOT, encoding: "utf8" });
  check("M4 node tools/ci/i18n-check.mjs exits 0", r.status === 0, `exit ${r.status} ${(r.stdout || r.stderr || "").trim().slice(0, 160)}`);
});

/* ---- #176 remainder: the inbox button's label, the suggestion row's line and the two relative times ---- */
const INBOX_ARIA176 = "Inbox \u2014 {n} waiting";
const FOUND176 = "Found in 1 forwarded document \u00b7 renews {date} \u00b7 {cost}";
/* comments out, so a note about the old words does not count; string and template literals are left in, as M1 misses the latter */
const code176 = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

await attempt("M5 home.js English", async () => {
  const src = code176(read("assets/js/home.js"));
  const found = [];
  if (/forwarded document/i.test(src)) found.push("the suggestion row's 'forwarded document' line");
  if (/Inbox\s*\u2014/.test(src)) found.push("the 'Inbox \u2014' aria-label");
  /* a literal that says "waiting" among other words (the bare class name "waiting" is not words) */
  for (const m of src.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) if (/\bwaiting\b/i.test(m[2]) && m[2].trim() !== "waiting") found.push(`a literal with 'waiting': ${m[0].slice(0, 60)}`);
  for (const line of src.split("\n")) {
    if (!/burnsInDays/.test(line)) continue;
    if (/\bin\s*\$\{[^}]*burnsInDays/.test(line) || /\$\{[^}]*burnsInDays[^}]*\}\s*d\b/.test(line) || /["'`]\s*in\s*["'`]\s*\+[^;\n]*burnsInDays/.test(line) || /burnsInDays\s*\+\s*["'`]\s*d\b/.test(line)) found.push(`'in \u2026d' written around burnsInDays: ${line.trim().slice(0, 70)}`);
  }
  check("M5 home.js has no hard-coded English for the inbox label, the suggestion line or burns-up's 'in Nd'", !found.length, found.length ? `still in home.js: ${JSON.stringify(found)}` : "none");
});

await attempt("M6 data.js", async () => {
  const src = code176(read("assets/js/data.js"));
  check("M6 data.js no longer holds the English words 'in 51 days'", !/in 51 days/.test(src), /in 51 days/.test(src) ? "assets/js/data.js still has \"in 51 days\"" : "none");
});

await attempt("M7 catalogue strings", async () => {
  const enJs = read("assets/i18n/en.js");
  for (const [tag, text] of [["inbox label", INBOX_ARIA176], ["suggestion line", FOUND176]]) {
    const n = Object.values(en).filter((v) => v === text).length;
    check(`M7 en.json has exactly one value equal to the ${tag} ${JSON.stringify(text)}`, n === 1, `${n} found`);
    const g = enJs.split(`: ${JSON.stringify(text)}`).length - 1;
    check(`M7 en.js (generated) carries the same ${tag}`, g === 1, `${g} found`);
  }
});

await attempt("M8 i18n-check", async () => {
  const r = spawnSync(process.execPath, [at("tools/ci/i18n-check.mjs")], { cwd: ROOT, encoding: "utf8" });
  check("M8 node tools/ci/i18n-check.mjs still exits 0", r.status === 0, `exit ${r.status} ${(r.stdout || r.stderr || "").trim().slice(0, 160)}`);
});

/* ---- #177: the demo's page words follow the page's language ---- */
/* the literals of a source file, comments out: { text, raw }, where text is a string's value or a template's fixed parts (an
   expression is a NUL), raw the source as written (a template's expressions in it). Written as a scanner, not a regex, so a
   multi-line template and a quote inside a comment or an expression are read right. */
const lits177 = (src) => {
  const out = [], n = src.length;
  const str = (i) => {
    const q = src[i]; let j = i + 1, t = "";
    while (j < n && src[j] !== q && src[j] !== "\n") { if (src[j] === "\\") { t += src[j + 1]; j += 2; } else { t += src[j]; j++; } }
    out.push({ text: t, raw: src.slice(i, j + 1) }); return j + 1;
  };
  const tpl = (i) => {
    let j = i + 1, t = "";
    while (j < n && src[j] !== "`") {
      if (src[j] === "\\") { t += src[j + 1]; j += 2; continue; }
      if (src[j] === "$" && src[j + 1] === "{") { t += "\u0000"; j = code(j + 2, true) + 1; continue; }
      t += src[j]; j++;
    }
    out.push({ text: t, raw: src.slice(i, j + 1) }); return j + 1;
  };
  const code = (i, stop) => {
    let depth = 0;
    while (i < n) {
      const c = src[i], d = src[i + 1];
      if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
      if (c === "/" && d === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; continue; }
      if (c === "\"" || c === "'") { i = str(i); continue; }
      if (c === "`") { i = tpl(i); continue; }
      if (c === "{") depth++;
      if (c === "}") { if (stop && depth === 0) return i; depth--; }
      i++;
    }
    return i;
  };
  code(0, false);
  return out;
};
/* what each file must no longer write. A phrase is found anywhere in a literal (case as written today); a word is found
   only as a whole literal, so that a key, a class or an id that happens to be that word is not flagged */
const WORDS177 = {
  "assets/js/home.js": {
    phrases: ["this household", "Fly to", "suggested", "renews in", "approaching", "beyond the horizon", "nothing scheduled past", "nothing in orbit yet",
      "orbital period", "last completed", "a week, from the last reminder", "Item actions", "completed today", "snooze a week", "snoozed a week",
      "a repeat is never finished", "does not come round", "attached on acceptance", "nothing in this orbit matches", "add an item", "d before"],
    words: ["due", "snoozed", "section", "type", "cost", "provider", "reminders", "documents", "complete", "today", "one-off"],
    tails: ["documents"],
  },
  "assets/js/law.js": {
    phrases: ["January", "February", "March", "April", "June", "July", "August", "September", "October", "November", "December", "TODAY", "one-off", "every year", "every month", "every ", "en-GB"],
    words: ["May", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC", "SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"],
    tails: [],
  },
  "assets/js/data.js": {
    phrases: ["added 12 Jun", "filed against the item", "scanned clean", "A message arrived", "A message from", "minutes ago", "Orbit is reading its document", "too large", "no readable document", "Its attachment was larger", "It carried no document", "12 Jun", "09 Aug", "06 Aug"],
    words: ["Home", "Vehicles", "Devices", "Services"],
    tails: [],
  },
};
await attempt("N1 English page words in code", async () => {
  for (const [file, spec] of Object.entries(WORDS177)) {
    const lits = lits177(read(file));
    const found = [];
    for (const l of lits) {
      for (const p of spec.phrases) if (l.text.includes(p)) found.push(p);
      const t = l.text.trim();
      if (spec.words.includes(t)) found.push(t);
      for (const w of spec.tails) if (new RegExp(`(^|[>\\s\u0000])${w}($|[<\\s,.])`).test(l.text) && !found.includes(w)) found.push(w);
    }
    const uniq = [...new Set(found)];
    check(`N1 ${file} writes none of the demo's English page words in a string or template`, !uniq.length, uniq.length ? `still written in ${file}: ${JSON.stringify(uniq)}` : `none (${lits.length} literals read)`);
  }
});

await attempt("N2 catalogue holds the phrases", async () => {
  const PHRASES = ["this household", "Fly to", "approaching", "beyond the horizon", "nothing in orbit yet", "orbital period", "last completed", "snooze a week",
    "snoozed a week", "completed today", "a week, from the last reminder", "Item actions", "attached on acceptance", "nothing in this orbit matches", "add an item",
    "every year", "one-off", "scanned clean", "filed against the item", "A message arrived", "A message from", "renews", "documents", "d before", "nothing scheduled past", "a repeat is never finished"];
  const enJs = read("assets/i18n/en.js");
  const vals = Object.values(en || {});
  const noJson = PHRASES.filter((p) => !vals.some((v) => String(v).includes(p)));
  check("N2a en.json has a value containing each of the demo's English phrases", !noJson.length, noJson.length ? `no value in en.json contains ${JSON.stringify(noJson)}` : `${PHRASES.length} found`);
  const noJs = PHRASES.filter((p) => !enJs.includes(p));
  check("N2b the generated en.js carries them too", !noJs.length, noJs.length ? `en.js has no ${JSON.stringify(noJs)}` : `${PHRASES.length} found`);
  const names = ["Home", "Vehicles", "Devices", "Services"].filter((w) => !vals.includes(w));
  check("N2c en.json has the four section names as values of their own", !names.length, names.length ? `no value equal to ${JSON.stringify(names)}` : "found");
  const gone = ["TODAY", "approaching"].filter((w) => !vals.some((v) => String(v).includes(w)));
  check("N2d the TODAY line and the count have a value each with a named placeholder", !gone.length && vals.some((v) => /TODAY/.test(v) && /\{\w+\}/.test(v)) && vals.some((v) => /\{\w+\} approaching/.test(v)), gone.length ? `missing ${JSON.stringify(gone)}` : "TODAY and {n} approaching");
});

await attempt("N3 Intl", async () => {
  const code = ["assets/js/home.js", "assets/js/law.js", "assets/js/data.js", "assets/js/lang.js"].map((f) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1")).join("\n");
  check("N3a dates are written by Intl.DateTimeFormat (or toLocaleDateString) in the site's modules", /Intl\.DateTimeFormat|toLocaleDateString/.test(code), "the four modules");
  check("N3b money's digits and the months' count are written by Intl.NumberFormat (or toLocaleString), the count with unit month", /Intl\.NumberFormat|toLocaleString/.test(code) && /unit\s*:\s*["']month["']/.test(code), "the four modules");
  check("N3c relative times are Intl.RelativeTimeFormat's", /Intl\.RelativeTimeFormat/.test(code), "lang.js");
  const fixed = ["assets/js/home.js", "assets/js/law.js", "assets/js/data.js"].filter((f) => lits177(read(f)).some((l) => /^en(-GB|-US)?$/.test(l.text)));
  check("N3d no module fixes the locale to English in a literal", !fixed.length, fixed.length ? `an "en…" locale literal in ${JSON.stringify(fixed)}` : "none");
});

await attempt("N4 words are text, not markup", async () => {
  const bad = [];
  for (const f of ["assets/js/home.js", "assets/js/law.js", "assets/js/data.js"]) {
    for (const l of lits177(read(f))) if (/<[a-z]/i.test(l.raw) && /\$\{[^}]*\b(?:tr|t)\(/.test(l.raw)) bad.push(`${f}: ${l.raw.replace(/\s+/g, " ").slice(0, 70)}`);
  }
  check("N4 no HTML template has a catalogue word (tr() or t()) put into it", !bad.length, bad.length ? `${bad.length} template(s): ${JSON.stringify(bad.slice(0, 4))}` : "none");
});

await attempt("N5 i18n-check", async () => {
  const r = spawnSync(process.execPath, [at("tools/ci/i18n-check.mjs")], { cwd: ROOT, encoding: "utf8" });
  check("N5 node tools/ci/i18n-check.mjs still exits 0", r.status === 0, `exit ${r.status} ${(r.stdout || r.stderr || "").trim().slice(0, 160)}`);
});

process.exit(failed ? 1 : 0);
