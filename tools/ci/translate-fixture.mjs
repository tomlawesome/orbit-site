/*
 * Shared fixtures for the translation job's tests (#125 stage 2): a small English checkout in a scratch folder that
 * has the tool's own files copied in (tools/, assets/js/), a runner for the CLI, and builders for translated output
 * in the shape of spec section 1 (no test of the tool itself relies on the tool to make its fixtures).
 *
 * Not a test: tools/ci/translate-*-test.mjs import it. Only fake placeholders: keys sk-ant-FAKE..., hosts
 * example.invalid.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cpSync, rmSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, lstatSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FAKE_KEY, swap, translateHtml } from "./fake-claude.mjs";

export { FAKE_KEY, swap, translateHtml };
export const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const hash16 = (s) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
export const sectionHash = (s) => hash16(JSON.stringify([s.title, s.html, s.subs]));

/* ---- derived fields, as spec 2.3 states them ---- */
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => ENT[e.toLowerCase()] ?? (e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : m));
export const textOf = (html) => decode(String(html)
  .replace(/<a class="anchor"[^>]*>[\s\S]*?<\/a>/g, "")
  .replace(/<figure[^>]*data-mermaid[^>]*>[\s\S]*?<\/figure>/g, (f) => f.replace(/<pre[^>]*>[\s\S]*?<\/pre>/, ""))
  .replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
export const summaryOf = (html) => {
  const m = /<(p|ul|ol|table)\b[\s\S]*?<\/\1>/.exec(String(html).replace(/^\s*<h\d[\s\S]*?<\/h\d>/, ""));
  return (m ? textOf(m[0]) : "").slice(0, 170).replace(/\s\S*$/, (x, off, s) => (s.length >= 170 ? "…" : x));
};
/* the visible text length of a section's html: what rule (f) compares */
export const plainLength = (html) => textOf(html).length;

/* ---- a 1x1 png and its stored name, as the import names pictures ---- */
function png() {
  const ch = (t, d) => { const b = Buffer.alloc(8 + d.length + 4); b.writeUInt32BE(d.length, 0); b.write(t, 4, "latin1"); d.copy(b, 8);
    let c = ~0; for (const x of b.subarray(4, 8 + d.length)) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } b.writeUInt32BE(~c >>> 0, 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), ch("IHDR", ihdr), ch("IDAT", deflateSync(Buffer.from([0, 7, 8, 9]))), ch("IEND", Buffer.alloc(0))]);
}
const PNG = png(), PNG_NAME = `${createHash("sha256").update(PNG).digest("hex").slice(0, 16)}.png`;

/* ---- the English checkout ---- */
export const SOURCES = [
  { slug: "readme", name: "README", c: "#d8b45a", repo: "example/orbit", path: "README.md", title: "Orbit" },
  { slug: "guide", name: "Guide", c: "#6ee7d8", repo: "example/orbit", path: "docs/guide.md" },
];
export const GLOSSARY = [
  { term: "Orbit", keep: true, note: "the product" },
  { term: "the launcher", note: "the app that starts the doors", to: { de: "der Launcher", fr: "le lanceur" } },
];
export const LANGUAGES = {
  de: { name: "Deutsch", english: "German", voice: "informal (du)", built: true, script: "latin" },
  fr: { name: "Français", english: "French", voice: "formal (vous)", built: false, script: "latin" },
  ja: { name: "日本語", english: "Japanese", voice: "polite (desu/masu)", built: false, script: "cjk" },
};
const head = (slug, id, title, depth = 2) => `<h${depth} id="${id}"><a class="anchor" href="#docs/${slug}/${id}" aria-label="Link to this heading">#</a>${title}</h${depth}>\n`;
const LONG = "Doors are the rooms of the household where every reminder lives, and each door keeps its own list of the things that need doing, so that nothing is left to chance and nobody has to remember what the week still holds for them. ".repeat(2).trim();
export const ENGLISH_SECTIONS = {
  readme: [
    { id: "top", title: "Orbit", subs: [], html: head("readme", "top", "Orbit") +
      '<p>Orbit keeps your household inbox tidy, with every item in its place. Read <strong>the guide</strong> or visit <a href="https://example.invalid/site">the site</a>.</p>\n' +
      '<pre class="code" data-lang="sh"><code>orbit run --door 8080</code></pre>\n<p>Use <code>orbit stop</code> to stop it again.</p>' },
    { id: "diagram", title: "How it fits", subs: [], html: head("readme", "diagram", "How it fits") +
      "<p>The browser talks to the server, which keeps its state in a database.</p>\n" +
      '<figure class="diagram" data-mermaid><pre hidden>flowchart LR\n    a[&quot;Your browser&quot;] --&gt; b(&quot;Orbit&quot;)\n    b --&gt; c[(&quot;The database&quot;)]</pre><figcaption>a diagram, drawing…</figcaption></figure>' },
    { id: "shot", title: "The screens", subs: [{ id: "details", title: "Details" }], html: head("readme", "shot", "The screens") +
      `<p class="centred">\n  <img src="assets/docs/img/${PNG_NAME}" alt="The sky screen, filled with made-up data" loading="lazy">\n</p>\n<p>Here is the home screen.</p>\n` + head("readme", "details", "Details", 3) + "<p>Each thing you look after is a body.</p>" },
  ],
  guide: [
    { id: "start", title: "Getting started", subs: [], html: head("guide", "start", "Getting started") +
      '<p>Start here, then see <a href="#docs/readme/top">the overview</a> for the rest of the household story.</p>\n<ul>\n<li>Open the door</li>\n<li>Add an item</li>\n</ul>' },
    { id: "long", title: "Doors", subs: [], html: head("guide", "long", "Doors") + `<p>${LONG}</p>` },
  ],
};

const section = (s) => ({ id: s.id, title: s.title, html: s.html, summary: summaryOf(s.html), text: textOf(s.html), subs: s.subs });
const page = (src, sections) => ({ slug: src.slug, name: src.name, c: src.c, title: src.title || src.name, repo: src.repo, path: src.path, sections });
export const noHtml = (p) => ({ ...p, sections: p.sections.map(({ html, ...rest }) => rest) });

export function englishCatalogue(n = 130) {
  const en = {};
  for (let i = 1; i <= n; i++) en[`k${String(i).padStart(3, "0")}`] = `Plain sentence number ${i} about the household door.`;
  en.k003 = "You have {n} items due";
  en.k004 = "Read <a>the docs</a> first";
  en.k005 = "Orbit never forgets a chore";
  en.k007 = "Open the launcher for {n} doors";
  return en;
}
/* a catalogue as the job would write it, and the state beside it */
export const translateCatalogue = (en) => Object.fromEntries(Object.entries(en).map(([k, v]) => [k, swap(v)]));
export const stateFor = (en, kept = []) => ({ catalogue: Object.fromEntries(Object.keys(en).map((k) => [k, hash16(en[k])])), kept });

const put = (dir, p, v) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), typeof v === "string" ? v : JSON.stringify(v)); };

export function mkFixture({ keys = 130 } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "translate-"));
  const dir = join(tmp, "checkout");
  mkdirSync(dir);
  /* the tool's own files, whatever exists of them: the checkout it reads is its own */
  cpSync(join(REPO, "tools"), join(dir, "tools"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  mkdirSync(join(dir, "assets"), { recursive: true });
  cpSync(join(REPO, "assets/js"), join(dir, "assets/js"), { recursive: true });
  const fx = {
    tmp, dir, report: join(tmp, "report.json"), sources: structuredClone(SOURCES), glossary: structuredClone(GLOSSARY), languages: structuredClone(LANGUAGES),
    en: englishCatalogue(keys), generated: "2026-03-01T04:00:00.000Z",
    pages: Object.fromEntries(SOURCES.map((s) => [s.slug, page(s, ENGLISH_SECTIONS[s.slug].map(section))])),
    cleanup: () => rmSync(tmp, { recursive: true, force: true }),
    at: (p) => join(dir, p),
    exists: (p) => existsSync(join(dir, p)),
    read: (p) => JSON.parse(readFileSync(join(dir, p), "utf8")),
    readReport: () => JSON.parse(readFileSync(fx.report, "utf8")),
    write() {
      put(dir, "assets/i18n/en.json", fx.en);
      put(dir, "tools/docs-sources.json", fx.sources);
      put(dir, "tools/i18n/glossary.json", fx.glossary);
      put(dir, "tools/i18n/languages.json", fx.languages);
      mkdirSync(join(dir, "assets/docs/img"), { recursive: true });
      writeFileSync(join(dir, "assets/docs/img", PNG_NAME), PNG);
      for (const p of Object.values(fx.pages)) put(dir, `assets/docs/${p.slug}.json`, p);
      put(dir, "assets/docs/index.json", { generated: fx.generated, sources: fx.sources.map((s) => noHtml(fx.pages[s.slug])) });
    },
    /* edit English: patch a section (html and subs recompute the derived fields), add or remove one, or a key */
    setSection(slug, id, patch) { const s = fx.pages[slug].sections.find((x) => x.id === id); Object.assign(s, patch); s.summary = summaryOf(s.html); s.text = textOf(s.html); fx.write(); },
    addSection(slug, s) { fx.pages[slug].sections.push(section(s)); fx.write(); },
    removeSection(slug, id) { fx.pages[slug].sections = fx.pages[slug].sections.filter((x) => x.id !== id); fx.write(); },
    setKey(k, v) { fx.en[k] = v; fx.write(); },
    /* a whole translated language in the shape of spec section 1, for the tests of the checks that read it */
    translated(lang, { generated = fx.generated, kept = [] } = {}) {
      const keptKeys = kept.filter((k) => k in fx.en);
      put(dir, `assets/i18n/${lang}.json`, Object.fromEntries(Object.entries(fx.en).map(([k, v]) => [k, keptKeys.includes(k) ? v : swap(v)])));
      put(dir, `tools/i18n/state/${lang}.json`, stateFor(fx.en, keptKeys));
      const out = [];
      for (const src of fx.sources) {
        const eng = fx.pages[src.slug];
        const secs = eng.sections.map((s) => { const keep = kept.includes(`${src.slug}/${s.id}`);
          const html = keep ? s.html : translateHtml(s.html);
          return { id: s.id, title: keep ? s.title : swap(s.title), html, summary: summaryOf(html), text: textOf(html), subs: keep ? s.subs : s.subs.map((u) => ({ id: u.id, title: swap(u.title) })) }; });
        const p = { ...eng, title: swap(eng.title), sections: secs,
          source: { generated, sections: Object.fromEntries(eng.sections.map((s) => [s.id, sectionHash(s)])), kept: kept.filter((k) => k.startsWith(`${src.slug}/`)).map((k) => k.split("/")[1]) } };
        put(dir, `assets/docs-i18n/${lang}/${src.slug}.json`, p);
        out.push({ ...noHtml(p) });
      }
      put(dir, `assets/docs-i18n/${lang}/index.json`, { generated: fx.generated, sources: out });
    },
  };
  fx.write();
  return fx;
}

/* every file under dir (tools/ left out: the tool's own copy), with its content hash: to see that nothing changed */
export function snapshot(dir) {
  const out = [];
  const walk = (d, rel) => { for (const f of readdirSync(d).sort()) {
    const p = join(d, f), r = rel ? `${rel}/${f}` : f;
    if (rel === "" && f === "tools") { /* only tools/i18n holds data the job writes */ walk(join(p, "i18n"), "tools/i18n"); continue; }
    if (lstatSync(p).isDirectory()) walk(p, r); else out.push(`${r} ${hash16(readFileSync(p, "latin1"))}`);
  } };
  walk(dir, "");
  return out.join("\n");
}

/* run the CLI in the fixture. Resolves { code, out, err, notBuilt }: a tool that does not exist yet is
   notBuilt, never a plain exit 1 (which the usage cases would read as a pass) */
export function runTool(fx, args = [], { key = FAKE_KEY, env = {}, timeout = 60000 } = {}) {
  const script = join(fx.dir, "tools/ci/translate.mjs");
  if (!existsSync(script)) return Promise.resolve({ code: -1, out: "", err: "not built yet: tools/ci/translate.mjs", notBuilt: true });
  return new Promise((resolve) => {
    const e = { PATH: process.env.PATH, HOME: fx.tmp, ...env };
    if (key) e.ANTHROPIC_API_KEY = key;
    const p = spawn(process.execPath, [script, ...args], { cwd: fx.dir, env: e });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    const t = setTimeout(() => p.kill("SIGKILL"), timeout);
    p.on("close", (code) => { clearTimeout(t); resolve({ code, out, err }); });
  });
}
/* the arguments every run takes: the fake's address, the report, a quick poll */
export const argsFor = (fx, fake, ...more) => ["--api-base", fake.url, "--report", fx.report, "--poll-seconds", "0.05", ...more];

/* does the report name the item with the rule: some node (an object, or a string) names the id and matches the
   rule's words. The report's exact shape is not fixed by the spec, so this reads any shape. */
export function reportNames(report, id, rule) {
  let hit = false;
  const walk = (v) => {
    if (typeof v === "string") { if (v.includes(id) && rule.test(v)) hit = true; }
    else if (v && typeof v === "object") {
      if (!Array.isArray(v)) { const s = JSON.stringify(v); if (s.includes(id) && rule.test(s)) hit = true; }
      for (const x of Object.values(v)) walk(x);
    }
  };
  walk(report);
  return hit;
}

/* the tests' shared reporting: a line per check, and a case that throws is a failed check, never a crash */
export const T = {
  failed: false,
  check(name, ok, detail) { console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`); if (!ok) T.failed = true; },
  async attempt(name, fn) { try { await fn(); } catch (e) { T.check(name, false, String(e && e.message || e)); } },
  /* the exit code of a run, with "not built yet" as the failure line when the tool is missing */
  exit(name, r, want) {
    if (r.notBuilt) return T.check(name, false, r.err);
    T.check(name, r.code === want, `exit ${r.code}, want ${want}${r.code === want ? "" : `; ${(r.err || r.out).trim().split("\n").slice(-2).join(" | ").slice(0, 200)}`}`);
  },
  done() { process.exit(T.failed ? 1 : 0); },
};
/* the ids sent in the batches, split into the docs items and the catalogue chunks */
export const idsOf = (fake) => fake.sent.map((q) => q.customId);
export const docsIds = (fake) => idsOf(fake).filter((i) => i.startsWith("docs/")).sort();
export const siteQs = (fake) => fake.sent.filter((q) => q.customId.startsWith("site/"));
