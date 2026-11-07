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
 * Review round (#125, findings 2 to 16 of the inline review):
 *   T15 (finding 6) the fake now reports the API's real request_counts, so one expired or canceled item among
 *       succeeded ones is kept English, exit 0 (T15a, T15e)
 *   T34 (2)  a resume whose English changed in place (same count, same ids) is refused: exit 4, nothing written
 *   T35 (5)  a second run while the first batch is still running submits no second batch
 *   T36 (12) a retry batch that does not end prints an id that resumes the run, round 1's results kept
 *   T37 (12) a max_tokens cut-off is retried with a larger max_tokens
 *   T38 (13) a batch whose creation answer was lost is found again, not created twice
 *   T39 (14) an errored or expired item is tried again on the next run; it is not kept for good
 *   T40 (10) a redirect from the results URL to another origin never carries the key
 *   T41 (11) a body that does not end is cut off by a limit; T42 (11) a call that never answers does not outlast
 *       --timeout-minutes
 *   T44 (fix review 2) a batch that ended after its run exited 5 is taken up on the next run, its results read, with no
 *       second batch: through this machine's record, and through the key's batch list when the record is gone
 *   T45 (fix review 6) batches.json: a record older than 29 days is not used (the API keeps results 29 days), one just
 *       under is; a file over 1 MiB is refused rather than read, one just under is read
 *   T43 (15) the fake's ids for a retried chunk are the tool's, and its attempt counts go on
 *
 * Assumption (the spec leaves it open): --poll-seconds and --timeout-minutes take fractions (0.05, 0.02).
 *
 *   node tools/ci/translate-flow-test.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
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
    if (r.code !== 0) return;
    const readme = fx.exists("assets/docs-i18n/de/readme.json") ? fx.read("assets/docs-i18n/de/readme.json") : null, guide = fx.exists("assets/docs-i18n/de/guide.json") ? fx.read("assets/docs-i18n/de/guide.json") : null;
    T.check("T15b each of the three is kept English in its page", !!readme && !!guide && readme.source.kept.includes("top") && readme.source.kept.includes("diagram") && guide.source.kept.includes("start"), JSON.stringify([readme && readme.source.kept, guide && guide.source.kept]));
    T.check("T15c the other items are written as translated", !!readme && !!guide && readme.sections.find((s) => s.id === "shot").html.includes("é") && guide.sections.find((s) => s.id === "long").html.includes("é") && fx.exists("assets/i18n/de.json"), "shot, long and the catalogue");
    const rep = fx.readReport();
    T.check("T15d the report lists each, with what happened", reportNames(rep, TOP, /error/i) && reportNames(rep, "docs/readme/diagram", /expire/i) && reportNames(rep, "docs/guide/start", /refus/i), "errored, expired, refused");
  } finally { await fake.close(); fx.cleanup(); }
});

await T.attempt("T15e", async () => {
  /* one canceled request among succeeded ones: the batch's counts say canceled 1, succeeded N-1 */
  const fx = mkFixture(), fake = await startFake({ script: (cid) => (cid === `${TOP}@de` ? { canceled: true } : undefined) });
  try {
    const r = await runTool(fx, argsFor(fx, fake, "--langs", "de"));
    T.exit("T15e one canceled item among succeeded ones: exit 0", r, 0);
    if (r.code !== 0) return;
    const readme = fx.read("assets/docs-i18n/de/readme.json");
    T.check("T15e the canceled item is kept English and the others are translated", readme.source.kept.includes("top") && readme.sections.find((s) => s.id === "shot").html.includes("é"), JSON.stringify(readme.source.kept));
    T.check("T15e the report lists it as canceled", reportNames(fx.readReport(), TOP, /cancel/i), "canceled");
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
  { /* the default timeout is 50 minutes: parseArgs' own default, since a test cannot wait that long */
    const { parseArgs } = await import(pathToFileURL(join(REPO, "tools/ci/translate.mjs")).href);
    const o = parseArgs([], {});
    T.check("T19e --timeout-minutes defaults to 50", o.timeoutMinutes === 50, `parseArgs([]).timeoutMinutes = ${o.timeoutMinutes}`); }
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

/* ---- the review round (findings 2 to 16): each case plants one fault the review found ---- */
const idOf = (r) => { const m = /TRANSLATE_BATCH_ID=(\S+)/.exec(r.out + r.err); return m ? m[1] : ""; };

await T.attempt("T34", async () => {
  /* finding 2: the batch was made from the English of an earlier commit; one section's English is edited in place since,
     so the count and the ids still match. The translation of the OLD English must not be stamped with the new hash. */
  const fx = mkFixture(), fake = await startFake({ never: true });
  try {
    const r1 = await runTool(fx, argsFor(fx, fake, "--langs", "de", "--timeout-minutes", "0.02"));
    T.exit("T34a the first run is pending: exit 5", r1, 5);
    const id = fake.batches[0] && fake.batches[0].id;
    if (!id) return T.check("T34a a batch was submitted", false, "none");
    const top = fx.pages.readme.sections.find((x) => x.id === "top");
    fx.setSection("readme", "top", { html: top.html.replace("tidy", "calm and orderly") });
    fake.never = false;
    const posts = fake.posts, before = snapshot(fx.dir);
    const r = await runTool(fx, argsFor(fx, fake, "--langs", "de"), { env: { TRANSLATE_BATCH_ID: id } });
    const written = fx.exists("assets/docs-i18n/de/readme.json") ? fx.read("assets/docs-i18n/de/readme.json") : null;
    const stamped = written && written.source.sections.top === sectionHash(fx.pages.readme.sections.find((x) => x.id === "top")) && written.sections.find((x) => x.id === "top").html.includes("tidy");
    T.exit("T34b a resume whose English changed in place (same count, same ids): exit 4", r, 4);
    T.check("T34c nothing submitted, nothing written", !r.notBuilt && fake.posts === posts && snapshot(fx.dir) === before, stamped ? "the translation of the old English was stamped with the new English's hash" : `${fake.posts - posts} new posts`);
  } finally { await fake.close(); fx.cleanup(); }
});

await T.attempt("T35", async () => {
  /* finding 5: the first run left its batch running (exit 5); the next run on the same commit, with no id, must not pay
     for a second full batch */
  const fx = mkFixture(), fake = await startFake({ never: true });
  try {
    const r1 = await runTool(fx, argsFor(fx, fake, "--langs", "de", "--timeout-minutes", "0.02"));
    T.exit("T35a the first run is pending: exit 5", r1, 5);
    /* the machine's record would take the first batch up by itself (T44); without it the key's batch list is the only
       guard CI has (a runner has no cache), so the record is deleted and the list guard is what is tried */
    rmSync(join(fx.tmp, ".cache"), { recursive: true, force: true });
    const before = snapshot(fx.dir);
    const r2 = await runTool(fx, argsFor(fx, fake, "--langs", "de", "--timeout-minutes", "0.02"));
    T.check("T35b the second run submits no second batch while the first still runs", !r2.notBuilt && fake.posts === 1, `${fake.posts} batches submitted`);
    T.check("T35c and it does not claim to have finished: not exit 0, nothing written", !r2.notBuilt && r2.code !== 0 && snapshot(fx.dir) === before, `exit ${r2.code}`);
  } finally { await fake.close(); fx.cleanup(); }
});

await T.attempt("T44", async () => {
  /* fix review 2: the first run exits 5, its batch ends afterwards; the next run on the same commit must read that
     batch's results, not drop its record and pay for a second full batch. Once through the record, once with the record
     gone (a CI runner has none), through the key's list. */
  for (const [name, wipe] of [["the record", false], ["the key's batch list (no record)", true]]) {
    const fx = mkFixture(), fake = await startFake({ never: true });
    try {
      const r1 = await runTool(fx, argsFor(fx, fake, "--langs", "de", "--timeout-minutes", "0.02"));
      T.exit(`T44 (${name}) the first run is pending: exit 5`, r1, 5);
      if (wipe) rmSync(join(fx.tmp, ".cache"), { recursive: true, force: true });
      fake.never = false;
      const r2 = await runTool(fx, argsFor(fx, fake, "--langs", "de"));
      T.exit(`T44 (${name}) the batch ended in between: the next run finishes: exit 0`, r2, 0);
      T.check(`T44 (${name}) no second batch is submitted`, !r2.notBuilt && fake.posts === 1, `${fake.posts} batches submitted`);
      T.check(`T44 (${name}) the paid results are written`, fx.exists("assets/docs-i18n/de/readme.json"), "no German page");
    } finally { await fake.close(); fx.cleanup(); }
  }
});

await T.attempt("T45", async () => {
  /* fix review 6: ~/.cache/orbit-translate/batches.json. A bare batch id is taken only on this machine's record, so
     the record being used or not shows in whether a bare id is accepted. Records older than 29 days are pruned when
     the file is read; a file over 1 MiB is refused rather than read. */
  const DAY = 86400e3;
  const bare = async (mutate) => {
    const fx = mkFixture(), fake = await startFake({ never: true });
    try {
      const r1 = await runTool(fx, argsFor(fx, fake, "--langs", "de", "--timeout-minutes", "0.02"));
      const id = fake.batches[0] && fake.batches[0].id, file = join(fx.tmp, ".cache/orbit-translate/batches.json");
      if (r1.code !== 5 || !id || !existsSync(file)) return { setup: `first run exit ${r1.code}, id ${id || "none"}, record ${existsSync(file)}` };
      const j = JSON.parse(readFileSync(file, "utf8"));
      mutate(j, id); writeFileSync(file, JSON.stringify(j));
      fake.never = false;
      const posts = fake.posts, before = snapshot(fx.dir);
      const r = await runTool(fx, argsFor(fx, fake, "--langs", "de"), { env: { TRANSLATE_BATCH_ID: id } });
      return { r, posts: fake.posts - posts, untouched: snapshot(fx.dir) === before };
    } finally { await fake.close(); fx.cleanup(); }
  };
  const aged = (days) => (j, id) => { j[id].made = new Date(Date.now() - days * DAY).toISOString(); };
  const padded = (bytes) => (j) => { j.pad = "x".repeat(bytes); };
  const c1 = await bare(aged(28));
  T.check("T45a a record 28 days old is used: a bare id resumes it, exit 0", !c1.setup && c1.r.code === 0, c1.setup || `exit ${c1.r.code}`);
  const c2 = await bare(aged(30));
  T.check("T45b a record 30 days old is pruned: a bare id is refused (exit 1, no record), nothing submitted or written", !c2.setup && c2.r.code === 1 && /record/i.test(c2.r.out + c2.r.err) && c2.posts === 0 && c2.untouched, c2.setup || `exit ${c2.r.code}, ${c2.posts} posts`);
  const c3 = await bare(padded(900 * 1024));
  T.check("T45c a record file just under 1 MiB is read: exit 0", !c3.setup && c3.r.code === 0, c3.setup || `exit ${c3.r.code}`);
  const c4 = await bare(padded(1200 * 1024));
  T.check("T45d a record file over 1 MiB is refused, not read: a bare id is not accepted (exit 1), nothing submitted or written", !c4.setup && c4.r.code === 1 && c4.posts === 0 && c4.untouched, c4.setup || `exit ${c4.r.code}, ${c4.posts} posts`);
});

await T.attempt("T36", async () => {
  /* finding 12: round 1 ends with one item broken, the retry batch does not end: the id the run prints must resume it,
     with round 1's paid results kept */
  const fx = mkFixture(), fake = await startFake({ never: 1, script: (cid, n, q, ans) => (cid === `${TOP}@de` && n === 1 ? { answer: dropStrong(ans) } : undefined) });
  try {
    const r1 = await runTool(fx, argsFor(fx, fake, "--langs", "de", "--timeout-minutes", "0.02"));
    T.exit("T36a a retry batch that does not end: exit 5", r1, 5);
    const id = idOf(r1);
    T.check("T36b two batches were made and the run prints an id to resume", fake.batches.length === 2 && !!id, `${fake.batches.length} batches, id ${id || "none"}`);
    if (!id) return;
    fake.never = false;
    const posts = fake.posts;
    const r = await runTool(fx, argsFor(fx, fake, "--langs", "de"), { env: { TRANSLATE_BATCH_ID: id } });
    T.exit("T36c resuming with the printed id finishes the run: exit 0", r, 0);
    T.check("T36d it submitted nothing", !r.notBuilt && fake.posts === posts, `${fake.posts - posts} new posts`);
    const p = fx.exists("assets/docs-i18n/de/readme.json") ? fx.read("assets/docs-i18n/de/readme.json") : null;
    T.check("T36e round 1's results are kept (shot translated) and the retried item is translated too (top)", !!p && p.sections.find((x) => x.id === "shot").html.includes("é") && p.sections.find((x) => x.id === "top").html.includes("é") && !p.source.kept.includes("top"), p ? `kept ${JSON.stringify(p.source.kept)}` : "no page");
  } finally { await fake.close(); fx.cleanup(); }
});

await T.attempt("T37", async () => {
  /* finding 12: an answer cut off at max_tokens is asked again with room for more, not with the same limit */
  const fx = mkFixture(), fake = await startFake({ script: (cid, n) => (cid === `${TOP}@de` && n === 1 ? { cutoff: true } : undefined) });
  try {
    const r = await runTool(fx, argsFor(fx, fake, "--langs", "de"));
    T.exit("T37a a cut-off first answer, a good second one: exit 0", r, 0);
    const tries = fake.sent.filter((q) => q.customId === `${TOP}@de`);
    T.check("T37b the item was sent twice", tries.length === 2, `${tries.length} times`);
    T.check("T37c the second request has a larger max_tokens than the first", tries.length === 2 && tries[1].params.max_tokens > tries[0].params.max_tokens, tries.map((q) => q.params.max_tokens).join(" then "));
  } finally { await fake.close(); fx.cleanup(); }
});

await T.attempt("T38", async () => {
  /* finding 13: the API made the batch but the answer was lost on the way; the retry must find that batch, not make a second */
  const fx = mkFixture(), fake = await startFake({ lose: 1 });
  try {
    const r = await runTool(fx, argsFor(fx, fake, "--langs", "de"), { timeout: 120000 });
    T.exit("T38a a lost answer to the batch's creation: the run finishes, exit 0", r, 0);
    T.check("T38b exactly one batch exists (the retry found the one already made)", fake.batches.length === 1, `${fake.batches.length} batches, ${fake.posts} posts`);
  } finally { await fake.close(); fx.cleanup(); }
});

await T.attempt("T39", async () => {
  /* finding 14: an errored item (an expired or canceled one is the same kind of trouble) is the API's trouble, not the text's: the next run on the same English tries it again */
  let fail = true;
  const fx = mkFixture(), fake = await startFake({ script: (cid) => (fail && cid === `${TOP}@de` ? { errored: true } : fail && cid === "site/de/2@de" ? { errored: true } : undefined) });
  try {
    let r = await runTool(fx, argsFor(fx, fake, "--langs", "de"));
    T.exit("T39a a run with one errored section and one errored chunk: exit 0", r, 0);
    const n1 = fake.sent.length;
    fail = false;
    r = await runTool(fx, argsFor(fx, fake, "--langs", "de"));
    T.exit("T39b the next run, the same English: exit 0", r, 0);
    const again = fake.sent.slice(n1).map((q) => q.customId);
    T.check("T39c the errored section is sent again", again.includes(`${TOP}@de`), JSON.stringify(again));
    T.check("T39d the errored chunk is sent again", again.some((c) => c.startsWith("site/de/")), JSON.stringify(again));
    const p = fx.exists("assets/docs-i18n/de/readme.json") ? fx.read("assets/docs-i18n/de/readme.json") : null, st = fx.exists("tools/i18n/state/de.json") ? fx.read("tools/i18n/state/de.json") : null;
    T.check("T39e both are translated now, nothing kept", !!p && !!st && p.sections.find((x) => x.id === "top").html.includes("é") && !p.source.kept.length && st.kept.length === 0, p ? `kept ${JSON.stringify(p.source.kept)} / ${st && st.kept.length} keys` : "no page");
  } finally { await fake.close(); fx.cleanup(); }
});

await T.attempt("T40", async () => {
  /* finding 10: the results URL answers with a redirect to another origin; the key is a custom header and fetch keeps it
     across origins unless told not to follow */
  const seen = [];
  const other = createServer((req, res) => { seen.push(req.headers); res.writeHead(200, { "content-type": "application/x-jsonl" }); res.end("\n"); });
  await new Promise((ok) => other.listen(0, "127.0.0.1", ok));
  const fx = mkFixture(), fake = await startFake({ redirectResults: `http://127.0.0.1:${other.address().port}/stolen` });
  try {
    const before = snapshot(fx.dir);
    const r = await runTool(fx, argsFor(fx, fake, "--langs", "de"));
    const leaked = seen.filter((h) => h["x-api-key"]);
    T.check("T40a the other origin never receives the x-api-key header", !r.notBuilt && leaked.length === 0, `${leaked.length} of ${seen.length} requests carried the key`);
    T.check("T40b and the run does not go on with what the other origin answered: not exit 0, nothing written", !r.notBuilt && r.code !== 0 && snapshot(fx.dir) === before, `exit ${r.code}`);
  } finally { await fake.close(); await new Promise((ok) => { other.closeAllConnections?.(); other.close(ok); }); fx.cleanup(); }
});

await T.attempt("T41", async () => {
  /* finding 11: a body from outside has a limit. The fake sends 256 MiB that never forms a result; a limit stops reading
     well before that (the limit's own size is the tool's to choose, under 256 MiB) */
  for (const what of ["results", "status"]) {
    const fx = mkFixture(), fake = await startFake({ flood: what });
    try {
      const before = snapshot(fx.dir);
      const r = await runTool(fx, argsFor(fx, fake, "--langs", "de"), { timeout: 120000 });
      T.check(`T41 a ${what} body that does not end: the tool hangs up before the end`, !r.notBuilt && fake.flooded.aborted, `${Math.round(fake.flooded.sent / 1048576)} MiB written, aborted ${fake.flooded.aborted}`);
      T.exit(`T41 a ${what} body that does not end: exit 4`, r, 4);
      T.check(`T41 ${what}: nothing written`, !r.notBuilt && snapshot(fx.dir) === before, "files changed");
    } finally { await fake.close(); fx.cleanup(); }
  }
});

await T.attempt("T42", async () => {
  /* finding 11: a poll the API never answers must not outlast --timeout-minutes (the batch is left running: exit 5) */
  const fx = mkFixture(), fake = await startFake({ hang: "status" });
  try {
    const r = await runTool(fx, argsFor(fx, fake, "--langs", "de", "--timeout-minutes", "0.02"), { timeout: 20000 });
    T.exit("T42a a status call that never answers, --timeout-minutes 0.02: exit 5", r, 5);
    const id = fake.batches[0] && fake.batches[0].id;
    T.check("T42b the batch id is printed and the batch is not cancelled", !r.notBuilt && !!id && (r.out + r.err).includes(id) && fake.cancels.length === 0, `id ${id}`);
  } finally { await fake.close(); fx.cleanup(); }
});

await T.attempt("T43", async () => {
  /* finding 15: the fake names a retried chunk as the tool does, so a script sees attempt 1 then 2 for it */
  const calls = [];
  const noHole = (a) => { a.items = a.items.map((x) => (x.id === "k003" ? { id: x.id, text: "Du hast Elemente fällig" } : x)); return a; };
  const fx = mkFixture(), fake = await startFake({ script: (cid, n, q, ans) => { calls.push(`${cid}#${n}`); return cid.startsWith("site/de/1@") && n === 1 ? { answer: noHole(ans) } : undefined; } });
  try {
    const r = await runTool(fx, argsFor(fx, fake, "--langs", "de", "--only", "site"));
    T.exit("T43a a run where one key of the first chunk fails once: exit 0", r, 0);
    const planned = [...r.out.matchAll(/^\s+(site\/\S+@de)\s/gm)].map((m) => m[1]);
    const sent1 = fake.batches[0] ? fake.batches[0].requests.map((q) => q.customId) : [];
    T.check("T43b the ids the fake gives the first batch are the ids the tool plans", planned.length === 3 && JSON.stringify(planned) === JSON.stringify(sent1), `tool ${planned.join(",")}; fake ${sent1.join(",")}`);
    T.check("T43c the retry of the chunk is that chunk's attempt 2", calls.includes("site/de/1@de#1") && calls.includes("site/de/1@de#2"), calls.filter((c) => c.startsWith("site/de/1@")).join(" "));
  } finally { await fake.close(); fx.cleanup(); }
});
T.done();
