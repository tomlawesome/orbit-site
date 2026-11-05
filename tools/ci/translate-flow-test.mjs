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
 *   T19 a batch that never ends within --timeout-minutes: exit 5 (pending), the batch id printed, NO cancel call,
 *       nothing written; the default of --timeout-minutes is 50. Exit 4: HTTP 401 and 403, no key (when not a dry
 *       run), a network failure after 3 tries, a batch that ends errored, expired or canceled
 *   T32 results are mapped back by custom_id, never by position: shuffled results map correctly; an unknown or a
 *       repeated custom_id in the results is exit 4 with nothing written
 *   T33 resume: TRANSLATE_BATCH_ID=<id> or --resume <id> submits nothing (no POST /batches), polls that batch and
 *       writes the result; a rebuilt request list that does not match the batch's ids is exit 4, nothing written
 *   T20 exit 2: English docs off shape, off the markup allow-list, or a section over 100,000 characters, before any request
 *   T21 exit 1: an unknown language, an unknown flag, a bad value, a malformed glossary or languages.json
 *
 * Assumption (the spec leaves it open): --poll-seconds and --timeout-minutes take fractions (0.05, 0.02).
 *
 *   node tools/ci/translate-flow-test.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { startFake } from "./fake-claude.mjs";
import { T, REPO, swap, translateHtml, mkFixture, runTool, argsFor, snapshot, reportNames, hash16, sectionHash, textOf, summaryOf } from "./translate-fixture.mjs";

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
      const r = await same("T19a a batch that never ends within --timeout-minutes", fake, fx, ["--langs", "de", "--timeout-minutes", "0.02"], 5);
      const id = fake.batches[0] && fake.batches[0].id;
      T.check("T19b the batch id is printed", !!id && (r.out + r.err).includes(id), `id ${id}; ${(r.out + r.err).trim().split("\n").slice(-2).join(" | ").slice(0, 160)}`);
      T.check("T19c the batch is NOT cancelled (no POST .../cancel)", fake.cancels.length === 0 && !!id, `${fake.cancels.length} cancels`);
      T.check("T19d no report claims success: no assets/i18n/de.json, no docs-i18n/de", !fx.exists("assets/i18n/de.json") && !fx.exists("assets/docs-i18n/de"), "nothing written");
    } finally { await fake.close(); fx.cleanup(); } }
  { /* the default timeout is 50 minutes: read from the tool's text, since a test cannot wait that long */
    const src = readFileSync(join(REPO, "tools/ci/translate.mjs"), "utf8");
    T.check("T19e --timeout-minutes defaults to 50", /timeout-minutes[^\n]*\b50\b|\b50\b[^\n]*timeout/i.test(src) && !/timeout-minutes[^\n]*\b170\b/.test(src), "50, not 170"); }
  for (const status of [401, 403]) {
    const fx = mkFixture(), fake = await startFake({ status });
    try { await same(`T19f HTTP ${status}`, fake, fx, ["--langs", "de"], 4); } finally { await fake.close(); fx.cleanup(); }
  }
  { const fx = mkFixture(), fake = await startFake();
    try {
      const r = await same("T19g no key, not a dry run", fake, fx, ["--langs", "de"], 4, { key: null });
      T.check("T19h and no request was made", !r.notBuilt && r.code === 4 && fake.requests.length === 0, `${fake.requests.length} requests`);
    } finally { await fake.close(); fx.cleanup(); } }
  { const fx = mkFixture(), fake = await startFake({ drop: 10 });
    try {
      await same("T19i a network failure", fake, fx, ["--langs", "de"], 4, { timeout: 120000 });
      T.check("T19j it was tried 3 times in all", fake.posts === 3, `${fake.posts} tries`);
    } finally { await fake.close(); fx.cleanup(); } }
  for (const endAs of ["errored", "expired", "canceled"]) {
    const fx = mkFixture(), fake = await startFake({ endAs });
    try { await same(`T19k a batch that ends ${endAs}`, fake, fx, ["--langs", "de"], 4); } finally { await fake.close(); fx.cleanup(); }
  }
});

await T.attempt("T32", async () => {
  { const fx = mkFixture(), fake = await startFake({ corrupt: "shuffle" });
    try {
      const r = await runTool(fx, argsFor(fx, fake, "--langs", "de"));
      T.exit("T32a results returned in reverse order: exit 0", r, 0);
      const readme = fx.exists("assets/docs-i18n/de/readme.json") ? fx.read("assets/docs-i18n/de/readme.json") : null;
      const top = readme && readme.sections.find((x) => x.id === "top"), en = fx.pages.readme.sections.find((x) => x.id === "top");
      T.check("T32b every item holds its own translation (matched by custom_id, not position)", !!top && top.html === translateHtml(en.html) && (readme.source.kept || []).length === 0, top ? "readme/top differs from its translation" : "no page written");
      const de = fx.exists("assets/i18n/de.json") ? fx.read("assets/i18n/de.json") : {};
      T.check("T32c the catalogue keys hold their own translations", Object.entries(fx.en).every(([k, v]) => de[k] === swap(v)), "catalogue");
    } finally { await fake.close(); fx.cleanup(); } }
  for (const corrupt of ["unknown", "duplicate"]) {
    const fx = mkFixture(), fake = await startFake({ corrupt });
    try {
      const before = snapshot(fx.dir);
      const r = await runTool(fx, argsFor(fx, fake, "--langs", "de"));
      T.exit(`T32d an ${corrupt} custom_id in the results: exit 4`, r, 4);
      T.check(`T32e ${corrupt}: nothing written`, !r.notBuilt && snapshot(fx.dir) === before, "the checkout's data changed");
    } finally { await fake.close(); fx.cleanup(); }
  }
});

await T.attempt("T33", async () => {
  for (const how of ["env", "flag"]) {
    const fx = mkFixture(), fake = await startFake({ never: true });
    try {
      const r1 = await runTool(fx, argsFor(fx, fake, "--langs", "de", "--timeout-minutes", "0.02"));
      T.exit(`T33a (${how}) the first run is pending: exit 5`, r1, 5);
      const id = fake.batches[0] && fake.batches[0].id;
      if (!id) { T.check(`T33a (${how}) a batch was submitted`, false, "none"); continue; }
      fake.never = false;
      const posts = fake.posts, before = snapshot(fx.dir);
      const r = how === "env" ? await runTool(fx, argsFor(fx, fake, "--langs", "de"), { env: { TRANSLATE_BATCH_ID: id } }) : await runTool(fx, argsFor(fx, fake, "--langs", "de", "--resume", id));
      T.exit(`T33b (${how}) the resume run finishes: exit 0`, r, 0);
      T.check(`T33c (${how}) it submitted nothing (no POST /v1/messages/batches)`, fake.posts === posts && fake.batches.length === 1, `${fake.posts - posts} new posts`);
      T.check(`T33d (${how}) it polled that batch`, fake.requests.some((q) => q.method === "GET" && q.path.startsWith(`/v1/messages/batches/${id}`)), "GET seen");
      T.check(`T33e (${how}) the result is written`, !r.notBuilt && snapshot(fx.dir) !== before && fx.exists("assets/i18n/de.json") && fx.exists("assets/docs-i18n/de/readme.json") && fx.read("assets/docs-i18n/de/readme.json").sections.find((x) => x.id === "top").html.includes("é"), "de written");
      T.check(`T33f (${how}) and still no cancel`, fake.cancels.length === 0, `${fake.cancels.length} cancels`);
    } finally { await fake.close(); fx.cleanup(); }
  }
  { /* the input is not the batch's commit: a section added after the batch was made */
    const fx = mkFixture(), fake = await startFake({ never: true });
    try {
      await runTool(fx, argsFor(fx, fake, "--langs", "de", "--timeout-minutes", "0.02"));
      const id = fake.batches[0] && fake.batches[0].id;
      fx.addSection("guide", { id: "later", title: "Later", subs: [], html: '<h2 id="later"><a class="anchor" href="#docs/guide/later" aria-label="Link to this heading">#</a>Later</h2>\n<p>Added after the batch was made.</p>\n' });
      fake.never = false;
      const posts = fake.posts, before = snapshot(fx.dir);
      const r = await runTool(fx, argsFor(fx, fake, "--langs", "de"), { env: { TRANSLATE_BATCH_ID: id } });
      T.exit("T33g a rebuilt request list that does not match the batch's ids: exit 4", r, 4);
      T.check("T33h nothing submitted, nothing written", !r.notBuilt && fake.posts === posts && snapshot(fx.dir) === before, `${fake.posts - posts} new posts`);
    } finally { await fake.close(); fx.cleanup(); }
  }
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
