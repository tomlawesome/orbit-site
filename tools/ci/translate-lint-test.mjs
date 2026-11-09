/*
 * Test for orbit-site #125 stage 2 (the translation job), written from the specification alone (issue #125, spec
 * section 4 "Lint and shape" and section 6, items 25 to 27). Each case works on a scratch copy of the working tree
 * (tracked and untracked files), so the checkout is untouched. The ci-split cases need js-yaml, as the lint does
 * (tools/node_modules after `npm ci --prefix tools`, or NODE_PATH).
 *
 *   T25 i18n-check: the catalogue of an unbuilt language (languages.json built:false) is checked for keys, {holes}
 *       and bare tags, but it has no hreflang, no BUILT entry and no page; state/<lang>.json has exactly the
 *       catalogue's keys; each kept key equals English's
 *   T26 the lag is watched, never failed (amendments 5 and 6, notes 54501, 54701): a page behind the committed
 *       English, stalled or not (the English 36 hours old or more at $LAG_NOW), passes the lint (sh tools/ci/lint.sh
 *       docs-shape) and --lag exits 0; a page whose source.generated is later than the committed English's is the
 *       one thing that fails, named, by the shape check and by --lag (exit 1). One commit, no history needed
 *       (fix review 5, 8) --same-english reports an English index.json that is missing or not JSON; a LAG_NOW that
 *       is not a date in the format of generated is not honoured, the clock is used and --lag says so (T26h-l)
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
/* Amendment 6 (note 54701, refining amendment 5): how far a translation trails the English is measured by the data's
   own timestamp against the clock ($LAG_NOW when set, for tests), not by counting imports: behind is source.generated
   before the committed English's; stalled is behind with the English 36 hours old or more. Neither fails the lint;
   the one failure is a stamp later than the English's, named, by the shape check and by --lag. */
await T.attempt("T26", async () => {
  const HOUR = 3600e3, E = "2026-03-04T04:00:00.000Z";   /* the committed English's generated */
  const at = (iso, hours) => new Date(Date.parse(iso) + hours * HOUR).toISOString();
  /* one commit holds everything (no history to count imports with); the page is stamped `generated`, the clock is `now` */
  const lint = (generated, now) => {
    const fx = mkFixture();
    try {
      fx.generated = E; fx.write();
      fx.translated("de", { generated });
      git(fx.dir, "init", "-q"); git(fx.dir, "add", "-A"); git(fx.dir, "commit", "-q", "--no-verify", "-m", "one commit");
      const run = (...a) => { const r = spawnSync(a[0], a.slice(1), { cwd: fx.dir, encoding: "utf8", env: { ...process.env, LAG_NOW: now } }); return { status: r.status, text: `${r.stdout}${r.stderr}` }; };
      return { lint: run("sh", "tools/ci/lint.sh", "docs-shape"), lag: run(process.execPath, "tools/ci/docs-i18n-shape.mjs", "--lag"),
        shape: run(process.execPath, "tools/ci/docs-i18n-shape.mjs", "assets/docs-i18n/de", "tools/docs-sources.json", "assets/docs") };
    } finally { fx.cleanup(); }
  };
  const same = lint(E, at(E, 400)), behind = lint(at(E, -24), at(E, 24)), stalled = lint(at(E, -24), at(E, 48)), later = lint(at(E, 24), at(E, 48));
  T.check("T26a translated from the English as it is, 400 hours on: the lint passes and --lag exits 0 (English that has not changed is never stale)", same.lint.status === 0 && same.lag.status === 0, `lint ${same.lint.status}, lag ${same.lag.status}: ${tail(same.lag.text)}`);
  T.check("T26b a page a day behind, the English changed 24 hours ago (behind, not stalled): the lint passes and --lag exits 0", behind.lint.status === 0 && behind.lag.status === 0, `lint ${behind.lint.status}, lag ${behind.lag.status}: ${tail(behind.lag.text)}`);
  T.check("T26c a page behind, the English changed 48 hours ago (stalled): the lint passes (a lag is watched, never a failure)", stalled.lint.status === 0, `exit ${stalled.lint.status}: ${tail(stalled.lint.text)}`);
  T.check("T26d the same stalled page: --lag exits 0", stalled.lag.status === 0, `exit ${stalled.lag.status}: ${tail(stalled.lag.text)}`);
  T.check("T26e a page stamped later than the committed English: the lint fails and names each page", later.lint.status === 1 && /readme/.test(later.lint.text) && /guide/.test(later.lint.text), `exit ${later.lint.status}: ${tail(later.lint.text)}`);
  T.check("T26f it is the shape check that fails it, naming the later stamp", later.shape.status === 1 && /readme/.test(later.shape.text) && /generated|later|newer/i.test(later.shape.text), `exit ${later.shape.status}: ${tail(later.shape.text)}`);
  /* fix review 8: LAG_NOW that is not a date in the format of generated (here a date without a time) is not honoured: the
     clock is used, and the log says so. The English is of March, the clock is later, so the page is stalled; honoured, the
     year 2000 would put the English in the future and the page would not be. */
  const bad = lint(at(E, -24), "2000-01-01");
  T.check("T26h a LAG_NOW that is not in the format of generated: --lag exits 0 and says the clock is used", bad.lag.status === 0 && /LAG_NOW/.test(bad.lag.text) && /clock/i.test(bad.lag.text), `exit ${bad.lag.status}: ${tail(bad.lag.text)}`);
  T.check("T26i and the page is judged by the clock (stalled), not by the bad value", /stalled/i.test(bad.lag.text), tail(bad.lag.text));
  /* #140: a LAG_NOW in the right format that is not a real date-time is refused like any other bad one (node would roll
     02-30 over to 03-02 and T24:00 to the next day; the python reading of it in nightly-publish.sh refuses both). The clock is
     used and the note says so. A real leap day is still honoured (no note). */
  for (const [id, v] of [["m", "2026-02-30T00:00:00Z"], ["n", "2026-11-08T24:00:00Z"]]) {
    const imp = lint(at(E, -24), v);
    T.check(`T26${id} an impossible LAG_NOW (${v}): --lag exits 0 and says the clock is used`, imp.lag.status === 0 && /LAG_NOW/.test(imp.lag.text) && /clock/i.test(imp.lag.text), `exit ${imp.lag.status}: ${tail(imp.lag.text)}`);
  }
  const leap = lint(at(E, -24), "2028-02-29T00:00:00Z");
  T.check("T26o control: a real leap day as LAG_NOW is honoured, no note", leap.lag.status === 0 && !/LAG_NOW/.test(leap.lag.text), `exit ${leap.lag.status}: ${tail(leap.lag.text)}`);
  /* fix review 5: --same-english must not pass when the checkout's English index.json is missing or not JSON (the stamp
     cannot be compared, which is what the flag is for) */
  const sameRun = (breakIt) => {
    const fx = mkFixture();
    try {
      fx.generated = E; fx.write(); fx.translated("de", { generated: E });
      if (breakIt) breakIt(join(fx.dir, "assets/docs/index.json"));
      const r = spawnSync(process.execPath, ["tools/ci/docs-i18n-shape.mjs", "assets/docs-i18n/de", "tools/docs-sources.json", "assets/docs", "--same-english"], { cwd: fx.dir, encoding: "utf8" });
      return { status: r.status, text: `${r.stdout}${r.stderr}` };
    } finally { fx.cleanup(); }
  };
  const sc = sameRun(null), sm = sameRun((p) => rmSync(p)), sj = sameRun((p) => writeFileSync(p, "{not json"));
  T.check("T26j control: --same-english with the English index present and the page stamped with it passes", sc.status === 0, `exit ${sc.status}: ${tail(sc.text)}`);
  T.check("T26k --same-english with the English index.json missing is a problem: exit 1, naming index.json", sm.status === 1 && /index\.json/.test(sm.text), `exit ${sm.status}: ${tail(sm.text)}`);
  T.check("T26l --same-english with the English index.json not JSON is a problem: exit 1, naming index.json", sj.status === 1 && /index\.json/.test(sj.text), `exit ${sj.status}: ${tail(sj.text)}`);
  T.check("T26g and --lag exits 1 for it, naming the page", later.lag.status === 1 && /readme/.test(later.lag.text) && /guide/.test(later.lag.text), `exit ${later.lag.status}: ${tail(later.lag.text)}`);
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
