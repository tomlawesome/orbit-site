/*
 * Test for orbit-site #125 stage 2 (the translation job), written from the specification alone (issue #125, spec
 * sections 1, 2, 2.2, 2.3 and 6, items 13 to 16 and 19 to 21). The API is the fake of tools/ci/fake-claude.mjs;
 * nothing reaches the network. The tool is run as its CLI against a scratch checkout.
 *
 *   T13 retry: a failed item is in a second batch exactly once with the failed rules in its user message; a passing
 *       second answer is written; an item that passed is never sent twice; never a third batch
 *   T14 keep English: a twice-failed section is copied from English with its hash in source.sections and its id in
 *       source.kept; a twice-failed key equals en.json and is in state.kept; both are in the report with the rule;
 *       a kept item is not sent again while the English is unchanged
 *   T15 an errored, an expired and a refused result are kept English and reported, exit 0, the rest written
 *   T16 output shape: pages and index pass docs-i18n-shape and docs-markup; text and summary are derived per 2.3
 *       (summary cut at 170 with an ellipsis); page, section and source keys are exactly the spec's; no img/ folder
 *   T19 exit 4: a batch that never ends within --timeout-minutes is cancelled (POST .../cancel) and nothing is
 *       written; HTTP 401 and 403, no key (when not a dry run) and a network failure after 3 tries are exit 4 too
 *   T20 exit 2: English docs off shape, off the markup allow-list, or a section over 100,000 characters, before any request
 *   T21 exit 1: an unknown language, an unknown flag, a bad value, a malformed glossary or languages.json
 *
 * Assumption (the spec leaves it open): --poll-seconds and --timeout-minutes take fractions (0.05, 0.02).
 *
 *   node tools/ci/translate-flow-test.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { startFake } from "./fake-claude.mjs";
import { T, mkFixture, runTool, argsFor, snapshot, reportNames, hash16, sectionHash, textOf, summaryOf } from "./translate-fixture.mjs";

const RULE_A = /skeleton|\btags?\b|\(a\)/i, RULE_K = /holes?|placeholder|\{|\btags?\b|\(k\)/i;
const TOP = "docs/readme/top", dropStrong = (a) => { a.html = a.html.replace("<strong>", "").replace("</strong>", ""); return a; };
const noPlaceholder = (a) => { a.items = a.items.map((x) => (x.id === "k003" ? { id: x.id, text: "Du hast Elemente fällig" } : x)); return a; };

await T.attempt("T13", async () => {
  const fx = mkFixture(), fake = await startFake({ script: (cid, n, q, ans) => (cid === `${TOP}@de` && n === 1 ? { answer: dropStrong(ans) } : undefined) });
  try {
    const r = await runTool(fx, argsFor(fx, fake, "--langs", "de"));
    T.exit("T13a a run with one bad first answer exits 0", r, 0);
    T.check("T13b exactly two batches", fake.batches.length === 2, `${fake.batches.length} batches`);
    const second = fake.batches[1] ? fake.batches[1].requests : [];
    T.check("T13c the second batch holds the failed item, once, and nothing else", second.length === 1 && second[0].customId === `${TOP}@de`, JSON.stringify(second.map((q) => q.customId)));
    T.check("T13d its user message says the previous answer broke, and names the rule", !!second[0] && /previous answer broke/i.test(second[0].user) && RULE_A.test(second[0].user.split(/previous answer broke/i)[1] || ""), second[0] ? second[0].user.slice(-160) : "no request");
    T.check("T13e it carries the item again (feedback is added to it, not instead of it)", !!second[0] && second[0].user.includes("keeps your household inbox"), "item present");
    const sent = fake.sent.map((q) => q.customId), once = sent.filter((c) => c !== `${TOP}@de`);
    T.check("T13f every other item was sent exactly once", sent.length > 2 && new Set(once).size === once.length, `${sent.length} requests`);
    const p = fx.read("assets/docs-i18n/de/readme.json"), s = p.sections.find((x) => x.id === "top");
    T.check("T13g the passing second answer is written (translated, not kept)", !!s && s.html.includes("é") && s.html.includes("<strong>") && !p.source.kept.includes("top"), s ? `kept ${JSON.stringify(p.source.kept)}` : "section missing");
  } finally { await fake.close(); fx.cleanup(); }
});

await T.attempt("T14", async () => {
  const fx = mkFixture(), fake = await startFake({ script: (cid, n, q, ans) => (cid === `${TOP}@de` ? { answer: dropStrong(ans) } : cid.startsWith("site/") ? { answer: noPlaceholder(ans) } : undefined) });
  try {
    let r = await runTool(fx, argsFor(fx, fake, "--langs", "de"));
    T.exit("T14a a run where two items fail twice exits 0", r, 0);
    T.check("T14b never a third batch; each failing item sent exactly twice", fake.batches.length === 2 && fake.sent.filter((q) => q.customId === `${TOP}@de`).length === 2, `${fake.batches.length} batches`);
    const p = fx.read("assets/docs-i18n/de/readme.json"), s = p.sections.find((x) => x.id === "top"), eng = fx.pages.readme.sections.find((x) => x.id === "top");
    T.check("T14c the section is copied from English, its hash in source.sections, its id in source.kept", !!s && JSON.stringify(s) === JSON.stringify(eng) && p.source.sections.top === sectionHash(eng) && p.source.kept.includes("top"), s ? `kept ${JSON.stringify(p.source.kept)}` : "section missing");
    const cat = fx.read("assets/i18n/de.json"), st = fx.read("tools/i18n/state/de.json");
    T.check("T14d the key is copied from en.json and is in state.kept, its hash recorded", cat.k003 === fx.en.k003 && st.kept.includes("k003") && st.catalogue.k003 === hash16(fx.en.k003), `k003 = ${JSON.stringify(cat.k003)}`);
    const rep = fx.readReport();
    T.check("T14e the report lists the section with its rule", reportNames(rep, TOP, RULE_A), "docs/readme/top and a skeleton rule");
    T.check("T14f the report lists the key with its rule", reportNames(rep, "k003", RULE_K), "k003 and a placeholder rule");
    const posts = fake.posts;
    r = await runTool(fx, argsFor(fx, fake, "--langs", "de"));
    T.check("T14g a kept item is not sent again while its English is unchanged", r.code === 0 && fake.posts === posts, `exit ${r.code}, ${fake.posts - posts} new batches`);
  } finally { await fake.close(); fx.cleanup(); }
});

await T.attempt("T15", async () => {
  const bad = { [`${TOP}@de`]: { errored: true }, "docs/readme/diagram@de": { expired: true }, "docs/guide/start@de": { refusal: true } };
  const fx = mkFixture(), fake = await startFake({ script: (cid) => bad[cid] });
  try {
    const r = await runTool(fx, argsFor(fx, fake, "--langs", "de"));
    T.exit("T15a errored, expired and refused results do not abort the run: exit 0", r, 0);
    const readme = fx.exists("assets/docs-i18n/de/readme.json") ? fx.read("assets/docs-i18n/de/readme.json") : null, guide = fx.exists("assets/docs-i18n/de/guide.json") ? fx.read("assets/docs-i18n/de/guide.json") : null;
    T.check("T15b each of the three is kept English in its page", !!readme && !!guide && readme.source.kept.includes("top") && readme.source.kept.includes("diagram") && guide.source.kept.includes("start"), JSON.stringify([readme && readme.source.kept, guide && guide.source.kept]));
    T.check("T15c the other items are written as translated", !!readme && !!guide && readme.sections.find((s) => s.id === "shot").html.includes("é") && guide.sections.find((s) => s.id === "long").html.includes("é") && fx.exists("assets/i18n/de.json"), "shot, long and the catalogue");
    const rep = fx.readReport();
    T.check("T15d the report lists each, with what happened", reportNames(rep, TOP, /error/i) && reportNames(rep, "docs/readme/diagram", /expire/i) && reportNames(rep, "docs/guide/start", /refus/i), "errored, expired, refused");
  } finally { await fake.close(); fx.cleanup(); }
});

await T.attempt("T16", async () => {
  const fx = mkFixture(), fake = await startFake();
  try {
    const r = await runTool(fx, argsFor(fx, fake, "--langs", "de,ja"));
    T.exit("T16a a run for de and ja exits 0", r, 0);
    if (r.code !== 0) return;
    for (const lang of ["de", "ja"]) {
      const d = `assets/docs-i18n/${lang}`;
      const shape = spawnSync(process.execPath, ["tools/ci/docs-i18n-shape.mjs", d, "tools/docs-sources.json", "assets/docs"], { cwd: fx.dir, encoding: "utf8" });
      T.check(`T16b ${lang}: docs-i18n-shape accepts the written folder`, shape.status === 0, existsSync(fx.at("tools/ci/docs-i18n-shape.mjs")) ? `exit ${shape.status}: ${(shape.stdout + shape.stderr).slice(0, 200)}` : "not built yet: tools/ci/docs-i18n-shape.mjs");
      const markup = spawnSync(process.execPath, ["tools/ci/docs-markup.mjs", d], { cwd: fx.dir, encoding: "utf8" });
      T.check(`T16c ${lang}: docs-markup accepts it`, markup.status === 0, `exit ${markup.status}: ${(markup.stdout + markup.stderr).slice(0, 200)}`);
      T.check(`T16d ${lang}: no img/ folder (pictures are the English ones), every picture src as English has it`, !fx.exists(`${d}/img`) && fx.read(`${d}/readme.json`).sections.find((s) => s.id === "shot").html.includes('src="assets/docs/img/'), "img/ absent, src kept");
      const key = (o) => Object.keys(o).sort().join(",");
      const pageKeys = "c,name,path,repo,sections,slug,source,title";
      let derived = 0, cut = 0, copied = 0;
      for (const src of fx.sources) {
        const p = fx.read(`${d}/${src.slug}.json`), eng = fx.pages[src.slug];
        T.check(`T16e ${lang}/${src.slug}: page keys are the English page's plus source; source is {generated, sections, kept}`, key(p) === pageKeys && key(p.source) === "generated,kept,sections" && p.source.generated === fx.generated && JSON.stringify(Object.keys(p.source.sections)) === JSON.stringify(eng.sections.map((s) => s.id)) && Object.values(p.source.sections).every((h) => /^[0-9a-f]{16}$/.test(h)), key(p));
        T.check(`T16f ${lang}/${src.slug}: sections in English's order, with exactly id, title, html, summary, text, subs`, JSON.stringify(p.sections.map((s) => s.id)) === JSON.stringify(eng.sections.map((s) => s.id)) && p.sections.every((s) => key(s) === "html,id,subs,summary,text,title"), "section keys");
        for (const [k, s] of p.sections.entries()) {
          if (s.text === textOf(s.html) && s.summary === summaryOf(s.html) && p.source.sections[s.id] === sectionHash(eng.sections[k])) derived++;
          if (s.summary.endsWith("…") && s.summary.length <= 171) cut++;
          if (s.text === eng.sections[k].text) copied++;
        }
      }
      T.check(`T16g ${lang}: text and summary derived from the translated html (spec 2.3) in every section`, derived === 5, `${derived} of 5`);
      T.check(`T16h ${lang}: a long first paragraph gives a summary cut at 170 with an ellipsis`, cut >= 1, `${cut} cut summaries`);
      T.check(`T16i ${lang}: the English text is not copied into a translated section`, copied === 0, `${copied} sections kept the English text`);
      const idx = fx.read(`${d}/index.json`);
      T.check(`T16j ${lang}: index.json is {generated: English's, sources: each page without html, with its source} in English's order`, key(idx) === "generated,sources" && idx.generated === fx.generated && JSON.stringify(idx.sources.map((s) => s.slug)) === JSON.stringify(fx.sources.map((s) => s.slug)) && idx.sources.every((s) => s.source && s.sections.every((x) => !("html" in x))), key(idx));
      const cat = fx.read(`assets/i18n/${lang}.json`), st = fx.read(`tools/i18n/state/${lang}.json`);
      T.check(`T16k ${lang}: the catalogue has en.json's keys, the state the same keys and an empty kept`, JSON.stringify(Object.keys(cat)) === JSON.stringify(Object.keys(fx.en)) && JSON.stringify(Object.keys(st.catalogue)) === JSON.stringify(Object.keys(fx.en)) && st.kept.length === 0, `${Object.keys(cat).length} keys`);
    }
  } finally { await fake.close(); fx.cleanup(); }
});

await T.attempt("T19", async () => {
  const same = async (label, fake, fx, args, want, opts) => {
    const before = snapshot(fx.dir);
    const r = await runTool(fx, argsFor(fx, fake, ...args), opts);
    T.exit(`${label}: exit ${want}`, r, want);
    T.check(`${label}: no output file was touched`, !r.notBuilt && snapshot(fx.dir) === before, "the checkout's data changed");
    return r;
  };
  { const fx = mkFixture(), fake = await startFake({ never: true });
    try {
      await same("T19a a batch that never ends", fake, fx, ["--langs", "de", "--timeout-minutes", "0.02"], 4);
      T.check("T19b the batch is cancelled (POST .../cancel seen)", fake.cancels.length === 1 && fake.cancels[0].path.includes(fake.batches[0] ? fake.batches[0].id : "?"), `${fake.cancels.length} cancels`);
    } finally { await fake.close(); fx.cleanup(); } }
  for (const status of [401, 403]) {
    const fx = mkFixture(), fake = await startFake({ status });
    try { await same(`T19c HTTP ${status}`, fake, fx, ["--langs", "de"], 4); } finally { await fake.close(); fx.cleanup(); }
  }
  { const fx = mkFixture(), fake = await startFake();
    try {
      const r = await same("T19d no key, not a dry run", fake, fx, ["--langs", "de"], 4, { key: null });
      T.check("T19e and no request was made", !r.notBuilt && r.code === 4 && fake.requests.length === 0, `${fake.requests.length} requests`);
    } finally { await fake.close(); fx.cleanup(); } }
  { const fx = mkFixture(), fake = await startFake({ drop: 10 });
    try {
      await same("T19f a network failure", fake, fx, ["--langs", "de"], 4, { timeout: 120000 });
      T.check("T19g it was tried 3 times in all", fake.posts === 3, `${fake.posts} tries`);
    } finally { await fake.close(); fx.cleanup(); } }
});

await T.attempt("T20", async () => {
  const cases = [
    ["a section with a key the shape does not have", (fx) => { fx.pages.readme.sections[0].onclick = "x"; fx.write(); }],
    ["a section html with a <script>", (fx) => fx.setSection("readme", "top", { html: fx.pages.readme.sections[0].html + "<script>alert(1)</script>" })],
    ["a section html of 100,001 characters", (fx) => fx.setSection("guide", "long", { html: '<h2 id="long"><a class="anchor" href="#docs/guide/long" aria-label="Link to this heading">#</a>Doors</h2>\n<p>' + "x ".repeat(50000) + "y</p>" })],
    ["a page that is not an object", (fx) => writeFileSync(fx.at("assets/docs/guide.json"), "[]")],
    ["a catalogue value that is not text", (fx) => { fx.en.k009 = 9; fx.write(); }],
  ];
  for (const [what, edit] of cases) {
    const fx = mkFixture(), fake = await startFake();
    try {
      edit(fx);
      const before = snapshot(fx.dir);
      const r = await runTool(fx, argsFor(fx, fake, "--langs", "de"));
      T.exit(`T20 ${what}: exit 2`, r, 2);
      T.check(`T20 ${what}: before any request, no file touched`, !r.notBuilt && fake.requests.length === 0 && snapshot(fx.dir) === before, `${fake.requests.length} requests`);
    } finally { await fake.close(); fx.cleanup(); }
  }
});

await T.attempt("T21", async () => {
  const cases = [
    ["an unknown language", ["--langs", "xx"], () => {}],
    ["a known and an unknown language", ["--langs", "de,xx"], () => {}],
    ["an unknown flag", ["--bogus"], () => {}],
    ["a value --only does not take", ["--only", "everything"], () => {}],
    ["a cap that is not a number", ["--max-tokens", "lots"], () => {}],
    ["a glossary that is not JSON", [], (fx) => writeFileSync(fx.at("tools/i18n/glossary.json"), "{")],
    ["a glossary entry with no term", [], (fx) => { fx.glossary.push({ keep: true }); fx.write(); }],
    ["a glossary entry that neither keeps nor pins", [], (fx) => { fx.glossary.push({ term: "x" }); fx.write(); }],
    ["a languages.json that is not JSON", [], (fx) => writeFileSync(fx.at("tools/i18n/languages.json"), "[")],
    ["a language with a script the tool does not know", [], (fx) => { fx.languages.de.script = "klingon"; fx.write(); }],
  ];
  for (const [what, args, edit] of cases) {
    const fx = mkFixture(), fake = await startFake();
    try {
      edit(fx);
      const before = snapshot(fx.dir);
      const r = await runTool(fx, argsFor(fx, fake, ...args));
      T.exit(`T21 ${what}: exit 1`, r, 1);
      T.check(`T21 ${what}: no request, no file touched`, !r.notBuilt && fake.requests.length === 0 && snapshot(fx.dir) === before, `${fake.requests.length} requests`);
    } finally { await fake.close(); fx.cleanup(); }
  }
});
T.done();
