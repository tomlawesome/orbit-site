/*
 * Test for orbit-site #125 stage 2 (the translation job), written from the specification alone (issue #125, spec
 * section 4 "Lint and shape" and section 6, items 25 to 27). Each case works on a scratch copy of the working tree
 * (tracked and untracked files), so the checkout is untouched. The ci-split cases need js-yaml, as the lint does
 * (tools/node_modules after `npm ci --prefix tools`, or NODE_PATH).
 *
 *   T25 i18n-check: the catalogue of an unbuilt language (languages.json built:false) is checked for keys, {holes}
 *       and bare tags, but it has no hreflang, no BUILT entry and no page; state/<lang>.json has exactly the
 *       catalogue's keys; each kept key equals English's
 *   T26 the lint's lag rule (sh tools/ci/lint.sh docs-shape): a translated page whose source.generated is two
 *       imports behind the committed English index fails and is named; one import behind is reported, not failed.
 *       "Imports" are the commits that moved assets/docs/index.json's generated, one a night (an assumption: the
 *       spec says only "older than two imports")
 *   T27 ci-split: a second job naming environment translate, a package manager in translate_docs, needs with
 *       artifacts, the key's name (joined below from its parts) in another file, a third job in docs-import, import_docs with an environment
 *       or a changed image are each refused and named; the shipped .gitlab-ci.yml passes and holds translate_docs
 *       and publish_translations
 *
 *   translate_docs also has timeout: 1h (T27c)
 *
 *   node tools/ci/translate-lint-test.mjs
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { T, REPO, mkFixture, stateFor, swap } from "./translate-fixture.mjs";

/* the host's global git config (its hooks, its identity) is left out of the scratch repositories */
const git = (cwd, ...a) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...a], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } });
const walk = (dir, rel = "") => readdirSync(join(dir, rel)).flatMap((f) => (statSync(join(dir, rel, f)).isDirectory() ? walk(dir, join(rel, f)) : [join(rel, f)]));
/* the checkout's own files: git's list (tracked and untracked, not ignored); a scratch folder: all it holds */
const listed = (dir) => (dir === REPO ? git(dir, "ls-files", "-co", "--exclude-standard").stdout.split("\n").filter(Boolean) : walk(dir));
/* a scratch copy of the working tree (tracked and untracked, not ignored); skip(f) leaves a file out */
function copyTree(into, skip = () => false, from = REPO) {
  for (const f of listed(from)) {
    if (skip(f) || !existsSync(join(from, f))) continue;
    mkdirSync(dirname(join(into, f)), { recursive: true });
    copyFileSync(join(from, f), join(into, f));
  }
}
const scratch = () => mkdtempSync(join(tmpdir(), "translate-lint-"));
const read = (d, p) => readFileSync(join(d, p), "utf8");
const put = (d, p, v) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), typeof v === "string" ? v : JSON.stringify(v)); };
/* the key's name, joined: spec §4 allows it written out only in translate.mjs, nightly-translate.sh and .gitlab-ci.yml */
const KEY = ["ANTHROPIC", "API", "KEY"].join("_");
const tail = (s) => s.slice(0, 240).replace(/\n/g, " | ");

/* ---------------- T25 ---------------- */
await T.attempt("T25", async () => {
  const base = scratch();
  try {
    /* what i18n-check reads: the page, the scripts, the door, the catalogues of en and de, and a built de and an
       unbuilt fr declared in languages.json (the real languages.json and any other language's files are left out) */
    const keep = (f) => /^tools\//.test(f) ? !/^tools\/i18n\/(?!lib\.mjs$)/.test(f) && !/^tools\/ci\/.*-test\./.test(f)
      : /^assets\/i18n\/(en|de)\.(js|json)$/.test(f) || /^assets\/(js|door)\//.test(f) || /^(index|404|install)\.html$/.test(f) || f === "de/index.html";
    copyTree(base, (f) => !keep(f));
    const en = JSON.parse(read(base, "assets/i18n/en.json"));
    const plain = Object.keys(en).filter((k) => !/[{<]/.test(en[k]));
    const holey = Object.keys(en).find((k) => /\{\w+\}/.test(en[k]));
    const translated = new Set([plain[0], plain[1], plain[2], holey]);
    put(base, "assets/i18n/fr.json", Object.fromEntries(Object.entries(en).map(([k, v]) => [k, translated.has(k) ? swap(v) : v])));
    put(base, "tools/i18n/languages.json", { de: { name: "Deutsch", english: "German", voice: "informal (du)", built: true, script: "latin" }, fr: { name: "Français", english: "French", voice: "formal (vous)", built: false, script: "latin" } });
    put(base, "tools/i18n/state/de.json", stateFor(en, []));
    put(base, "tools/i18n/state/fr.json", stateFor(en, Object.keys(en).filter((k) => !translated.has(k))));
    const extra = ["assets/i18n/fr.json", "tools/i18n/languages.json", "tools/i18n/state/de.json", "tools/i18n/state/fr.json"];
    let control = null;   /* the control's verdict: a refusal means nothing from a check that refuses the good tree too */
    const case_ = (name, mutate, want) => {
      if (want && control !== true) return T.check(name, false, "the control (T25a) does not pass, so this refusal proves nothing");
      const d = scratch();
      try {
        copyTree(d, () => false, base);
        for (const f of extra) { mkdirSync(dirname(join(d, f)), { recursive: true }); copyFileSync(join(base, f), join(d, f)); }
        mutate(d);
        const r = spawnSync(process.execPath, ["tools/ci/i18n-check.mjs"], { cwd: d, encoding: "utf8" }), text = `${r.stdout}${r.stderr}`;
        if (!want) { control = r.status === 0; T.check(name, control, `exit ${r.status}: ${tail(text)}`); }
        else T.check(name, r.status === 1 && want.test(text), `exit ${r.status}, want 1 naming ${want}; got ${tail(text)}`);
      } catch (e) { T.check(name, false, String(e && e.message || e)); } finally { rmSync(d, { recursive: true, force: true }); }
    };
    const edit = (d, p, fn) => { const j = JSON.parse(read(d, p)); fn(j); put(d, p, j); };
    case_("T25a the control: de built, fr unbuilt with its catalogue and state, no fr page, no fr hreflang: passes", () => {});
    case_("T25b an unbuilt catalogue missing a key is refused, fr.json named", (d) => edit(d, "assets/i18n/fr.json", (j) => { delete j[plain[5]]; }), /fr\.json/);
    case_("T25c an unbuilt catalogue whose {holes} differ is refused", (d) => edit(d, "assets/i18n/fr.json", (j) => { j[holey] = `${en[holey].replace(/\{\w+\}/g, "").trim()} x`; }), /fr\.json[^\n]*(\{|holes|placeholder)/i);
    case_("T25d an unbuilt catalogue that adds a bare tag is refused", (d) => edit(d, "assets/i18n/fr.json", (j) => { j[plain[0]] = `${j[plain[0]]} <b>x</b>`; }), /fr\.json[^\n]*tag/i);
    case_("T25e an unbuilt catalogue with an empty value is refused", (d) => edit(d, "assets/i18n/fr.json", (j) => { j[plain[1]] = ""; }), /fr\.json[^\n]*empty/i);
    case_("T25f an unbuilt language with a page (fr/index.html) is refused", (d) => put(d, "fr/index.html", read(d, "de/index.html")), /fr\/index\.html|fr[^\n]*(built|page)/i);
    case_("T25g an unbuilt language in the page's hreflang set is refused", (d) => {
      const h = read(d, "index.html"), m = /^[ \t]*<link rel="alternate" hreflang="de"[^\n]*$/m.exec(h);
      if (!m) throw new Error("no de hreflang line in index.html to copy");
      put(d, "index.html", h.replace(m[0], `${m[0]}\n${m[0].replace(/hreflang="de"/, 'hreflang="fr"').replace(/\/de\//, "/fr/")}`));
    }, /hreflang|fr/i);
    case_("T25h an unbuilt language in lang.js BUILT is refused", (d) => {
      const l = read(d, "assets/js/lang.js");
      if (!l.includes('["de"]')) throw new Error('BUILT is not ["de"] in lang.js');
      put(d, "assets/js/lang.js", l.replace('["de"]', '["de", "fr"]'));
    }, /BUILT|lang\.js|fr/);
    case_("T25i state with a key the catalogue lacks is refused, state/fr.json named", (d) => edit(d, "tools/i18n/state/fr.json", (j) => { j.catalogue.ghost = "0123456789abcdef"; }), /state\/fr\.json/);
    case_("T25j state missing a key of the catalogue is refused", (d) => edit(d, "tools/i18n/state/fr.json", (j) => { delete j.catalogue[plain[6]]; }), /state\/fr\.json/);
    case_("T25k a kept key that is not in the catalogue is refused", (d) => edit(d, "tools/i18n/state/fr.json", (j) => { j.kept.push("ghost"); }), /state\/fr\.json|ghost/);
    case_("T25l a kept key whose value differs from English is refused", (d) => edit(d, "assets/i18n/fr.json", (j) => { const k = Object.keys(en).find((x) => !translated.has(x)); j[k] = `${swap(en[k])} changed`; }), /fr\.json[^\n]*(kept|English)|state\/fr\.json/i);
    case_("T25m a built language without its state file is refused", (d) => rmSync(join(d, "tools/i18n/state/de.json")), /state\/de\.json|de[^\n]*state/i);
  } catch (e) { T.check("T25", false, String(e && e.message || e)); } finally { rmSync(base, { recursive: true, force: true }); }
});

/* ---------------- T26 ---------------- */
await T.attempt("T26", async () => {
  const G = ["2026-03-01T04:00:00.000Z", "2026-03-02T04:00:00.000Z", "2026-03-03T04:00:00.000Z"];
  const lint = (generated) => {
    const fx = mkFixture();
    try {
      git(fx.dir, "init", "-q");
      for (const g of G) { fx.generated = g; fx.write(); git(fx.dir, "add", "-A"); git(fx.dir, "commit", "-q", "--no-verify", "--allow-empty", "-m", `import ${g}`); }
      fx.translated("de", { generated });
      git(fx.dir, "add", "-A"); git(fx.dir, "commit", "-q", "--no-verify", "-m", "translate");
      const r = spawnSync("sh", ["tools/ci/lint.sh", "docs-shape"], { cwd: fx.dir, encoding: "utf8" });
      return { status: r.status, text: `${r.stdout}${r.stderr}` };
    } finally { fx.cleanup(); }
  };
  const a = lint(G[2]), b = lint(G[1]), c = lint(G[0]);
  T.check("T26a translated from the English as it is: passes", a.status === 0, `exit ${a.status}: ${tail(a.text)}`);
  T.check("T26b one import behind: not failed, but reported per page", b.status === 0 && /readme/.test(b.text) && /guide/.test(b.text), `exit ${b.status}: ${tail(b.text)}`);
  T.check("T26c two imports behind: fails and names each page", c.status === 1 && /readme/.test(c.text) && /guide/.test(c.text), `exit ${c.status}: ${tail(c.text)}`);
});

/* ---------------- T27 ---------------- */
await T.attempt("T27", async () => {
  const skip = (f) => /^assets\/(img|fonts|vendor|docs\/img)\//.test(f) || /\.(png|jpg|webp|woff2?|gif|ico|svg)$/.test(f);
  const base = scratch();
  try {
    copyTree(base, skip);
    const ci = read(base, ".gitlab-ci.yml");
    T.check("T27a the shipped .gitlab-ci.yml holds translate_docs and publish_translations, and the key's name", /^translate_docs:/m.test(ci) && /^publish_translations:/m.test(ci) && ci.includes(KEY), `translate_docs / publish_translations / ${KEY}`);
    const NODE_PATH = [process.env.NODE_PATH, join(REPO, "tools/node_modules")].filter(Boolean).join(":");
    const split = (d) => { const r = spawnSync(process.execPath, ["tools/ci/ci-split.mjs"], { cwd: d, encoding: "utf8", env: { ...process.env, NODE_PATH } }); return { status: r.status, text: `${r.stdout}${r.stderr}` }; };
    const ctl = split(base);
    T.check("T27b the shipped file passes ci-split", ctl.status === 0, `exit ${ctl.status}: ${tail(ctl.text)}`);
    const block = (ci.match(/^translate_docs:\n(?:[ \t].*\n|\n)*/m) || [""])[0];
    T.check("T27c translate_docs has timeout: 1h (the one-hour runner lane; amendment 1)", /^[ \t]+timeout:\s*1h\s*$/m.test(block) && !/timeout:\s*3h/.test(block), (block.match(/timeout:[^\n]*/) || ["no timeout line"])[0]);
    /* a line put under a job's own line: the job's own key order does not matter to YAML */
    const after = (text, job, line) => { const re = new RegExp(`^${job}:[^\\n]*\\n`, "m"); if (!re.test(text)) throw new Error(`no job ${job} in .gitlab-ci.yml to change`); return text.replace(re, (m) => `${m}${line}\n`); };
    const refused = (name, fn, want) => {
      const d = scratch();
      try {
        copyTree(d, skip, base);
        fn(d);
        const r = split(d);
        T.check(`T27 refuses ${name}`, r.status === 1 && want.test(r.text), `exit ${r.status}, want 1 naming ${want}; got ${tail(r.text)}`);
      } catch (e) { T.check(`T27 refuses ${name}`, false, String(e && e.message || e)); } finally { rmSync(d, { recursive: true, force: true }); }
    };
    const ed = (fn) => (d) => put(d, ".gitlab-ci.yml", fn(read(d, ".gitlab-ci.yml")));
    refused("a second job naming environment translate", ed((t) => `${t}\nextra_translate:\n  stage: maintenance\n  image: $NODE_IMAGE\n  environment: { name: translate, deployment_tier: other }\n  script: [echo hi]\n`), /translate/);
    refused("a package manager in translate_docs", ed((t) => after(t, "translate_docs", "  before_script: [npm ci --prefix tools]")), /translate_docs[^\n]*(npm|package manager)|npm[^\n]*translate_docs/i);
    refused("needs with artifacts in translate_docs", ed((t) => after(t, "translate_docs", "  needs: [{ job: import_docs, artifacts: true }]")), /translate_docs[^\n]*needs|needs[^\n]*translate_docs/i);
    refused("translate_docs on another image", ed((t) => after(t, "translate_docs", "  image: node:latest")), /translate_docs[^\n]*(image|NODE_IMAGE)|(image|NODE_IMAGE)[^\n]*translate_docs/i);
    refused(`${KEY} in another file`, (d) => put(d, "tools/ci/serve.mjs", `${read(d, "tools/ci/serve.mjs")}\n// ${KEY}\n`), new RegExp(KEY));
    refused("import_docs with an environment", ed((t) => after(t, "import_docs", "  environment: { name: translate }")), /import_docs[^\n]*environment|environment[^\n]*import_docs/i);
    refused("a third job in the docs-import environment", ed((t) => `${t}\nextra_publish:\n  stage: publish\n  image: $NODE_IMAGE\n  environment: { name: docs-import }\n  script: [echo hi]\n`), /docs-import/);
  } catch (e) { T.check("T27", false, String(e && e.message || e)); } finally { rmSync(base, { recursive: true, force: true }); }
});
T.done();
