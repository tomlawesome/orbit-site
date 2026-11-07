/*
 * Test for orbit-site #125 stage 2 (the translation job), written from the specification alone (issue #125, spec
 * sections 2, 2.1, 2.4 and 6, items 4, 5, 17, 18 and 23). The API is the fake of tools/ci/fake-claude.mjs, reached
 * through --api-base; no test reaches the network or holds a real key (the key is sk-ant-FAKE...).
 *
 *   T4  every request of a batch has one byte-identical system block with cache_control (ephemeral) and the whole
 *       glossary in it; the language and the item are in the user message only, which is uncached
 *   T5  request parameters: model claude-opus-5-5, max_tokens 4 x estimated English tokens (chars / 3.5) + 1,024 and
 *       at most 16,000, output_config.effort high, a strict JSON schema, fallbacks "default" and its beta header,
 *       anthropic-version 2023-06-01, no temperature, no thinking
 *   T31 custom_id: every request's is "r" + its zero-padded index in the run's request list (r0000, r0001, ...),
 *       unique, within ^[a-zA-Z0-9_-]{1,64}$ (the fake answers 400 to any other, so a run that breaks it fails)
 *   T17 --dry-run with no key prints the estimate (tokens, dollars) and the plan, makes no request, exits 0, and
 *       writes nothing (also with a key present)
 *   T18 an estimate above the cap exits 3 with nothing sent and nothing written; at the cap the run goes on. The
 *       boundary is found by the dry run's own exit code (0 or 3), so the test needs no copy of the estimate
 *   T23 --api-base is honoured; the key goes only as the x-api-key header: never in a URL, a body, the output or the
 *       report, and never as an argument (--api-key is refused)
 *   T18g-k the default cap is 3,000,000 when neither --max-tokens nor TRANSLATE_MAX_TOKENS is set: an estimate of
 *       about 2.5M proceeds, about 3.1M exits 3 with nothing sent (amendment 1, item 4)
 *   T18m-o (finding 4) the retry batch counts against the same cap: with the cap one token over the plan's estimate, a run
 *       that needs a retry exits 3 before submitting it, and a run that needs none goes through
 *   T18p (fix review 7) resuming a retry batch already submitted is not stopped by the cap: with the cap over round 1's
 *       estimate only, the resume goes through
 *
 *   node tools/ci/translate-request-test.mjs
 */
import { readFileSync } from "node:fs";
import { startFake, FAKE_KEY } from "./fake-claude.mjs";
import { CUSTOM_ID } from "./fake-claude.mjs";
import { T, mkFixture, runTool, argsFor, snapshot } from "./translate-fixture.mjs";

const run = (fx, fake, ...more) => runTool(fx, argsFor(fx, fake, ...more));
const blocks = (v) => (Array.isArray(v) ? v : typeof v === "string" ? [{ type: "text", text: v }] : []);

await T.attempt("T4/T5", async () => {
  const fx = mkFixture(), fake = await startFake();
  try {
    /* a section far past the others, so the cap of 16,000 output tokens is reached */
    fx.addSection("guide", { id: "huge", title: "Huge", subs: [], html: '<h2 id="huge"><a class="anchor" href="#docs/guide/huge" aria-label="Link to this heading">#</a>Huge</h2>\n' + "<p>A long line of plain words about the household, repeated for length.</p>\n".repeat(900) });
    const r = await run(fx, fake, "--langs", "de,ja");
    T.exit("T4a a run for de and ja exits 0", r, 0);
    const sent = fake.sent;
    T.check("T4b requests were made, in one batch", sent.length > 2 && fake.batches.length === 1, `${sent.length} requests in ${fake.batches.length} batch(es)`);
    const sys = sent.map((q) => JSON.stringify(q.params.system));
    T.check("T4c the system block is byte-identical in every request, of both languages", sent.length > 0 && new Set(sys).size === 1, `${new Set(sys).size} distinct`);
    const b = blocks(sent[0] && sent[0].params.system);
    T.check("T4d it is one block with cache_control ephemeral", b.length === 1 && b[0].cache_control && b[0].cache_control.type === "ephemeral", JSON.stringify(b.map((x) => x.cache_control)));
    const text = b.map((x) => x.text).join("\n");
    T.check("T4e the whole glossary is in it (terms and pinned renderings)", ["Orbit", "the launcher", "der Launcher", "le lanceur"].every((t) => text.includes(t)), "terms present");
    T.check("T4f no language name, date, id or item text in it", sent.length > 0 && text.length > 0 && !/German|Japanese|Deutsch|日本語/.test(text) && !/\d{4}-\d\d-\d\d/.test(text) && !sent.some((q) => text.includes(q.customId)) && !text.includes("keeps your household inbox") && !text.includes("Plain sentence number"), "volatile text absent");
    const de = sent.find((q) => q.customId === "docs/readme/top@de"), ja = sent.find((q) => q.customId === "docs/readme/top@ja");
    T.check("T4g the user message carries the language (code, English name) and the item; it is not cached", !!de && !!ja && /\bde\b/.test(de.user) && /German/.test(de.user) && /Japanese/.test(ja.user) && de.user.includes("keeps your household inbox") && !JSON.stringify(de.params.messages).includes("cache_control"), de ? de.user.slice(0, 120) : "no request docs/readme/top@de");
    /* parameters */
    const all = (name, f) => { const bad = sent.filter((q) => !f(q.params, q)); T.check(name, sent.length > 0 && !bad.length, bad.length ? `${bad.length} off, first ${bad[0].customId}: ${JSON.stringify(bad[0].params).slice(0, 160)}` : `${sent.length} requests`); };
    all("T5a model claude-opus-5-5", (p) => p.model === "claude-opus-5-5");
    all("T5b output_config.effort is high", (p) => p.output_config && p.output_config.effort === "high");
    all("T5c a strict JSON schema is the output format", (p) => { const f = p.output_config && p.output_config.format; return f && f.type === "json_schema" && f.schema && f.schema.additionalProperties === false && f.schema.type === "object"; });
    all("T5d the schema is {items:[{id,text}]} for a chunk, {title,html,subs} for a section", (p, q) => { const pr = p.output_config.format.schema.properties || {}; return q.customId.startsWith("site/") ? !!pr.items : ["title", "html", "subs"].every((k) => pr[k]); });
    all("T5e no temperature and no thinking", (p) => !("temperature" in p) && !("thinking" in p));
    const post = fake.requests.find((r) => r.method === "POST" && r.path === "/v1/messages/batches");
    all("T5f no fallbacks field in any request's params", (p) => !("fallbacks" in p));
    T.check("T5f2 no fallbacks field on the batch body", !!post && post.json && !("fallbacks" in post.json), JSON.stringify(post && post.json && Object.keys(post.json)));
    T.check("T5g headers: anthropic-version 2023-06-01 and no anthropic-beta server-side-fallback header, on any call", !!post && post.headers["anthropic-version"] === "2023-06-01" && fake.requests.every((r) => !/server-side-fallback/.test(String(r.headers["anthropic-beta"] || ""))), JSON.stringify(post && { v: post.headers["anthropic-version"], b: post.headers["anthropic-beta"] }));
    all("T5h max_tokens is an integer from 1,024 to 16,000", (p) => Number.isInteger(p.max_tokens) && p.max_tokens >= 1024 && p.max_tokens <= 16000);
    /* the formula: 4 x (chars / 3.5) + 1,024; the item's chars lie between its html (or text) and its whole JSON */
    const within = sent.filter((q) => q.item).every((q) => {
      const lo = q.item.items ? q.item.items.reduce((n, x) => n + x.text.length, 0) : q.item.html.length;
      const hi = JSON.stringify(q.item).length + 200;
      const f = (c) => Math.min(16000, Math.ceil((4 * c) / 3.5) + 1024);
      return q.params.max_tokens >= f(lo) - 8 && q.params.max_tokens <= f(hi) + 8;
    });
    T.check("T5i max_tokens follows 4 x estimated English tokens + 1,024 for every item", sent.length > 0 && within, "the formula");
    const huge = sent.find((q) => q.customId === "docs/guide/huge@de");
    T.check("T5j an item whose estimate is past the cap gets exactly 16,000", !!huge && huge.params.max_tokens === 16000, `max_tokens ${huge && huge.params.max_tokens}`);
    const tiny = sent.filter((q) => q.customId === "docs/guide/start@de")[0];
    T.check("T5k a short item gets far less (4 x tokens + 1,024)", !!tiny && tiny.params.max_tokens < 3000, `max_tokens ${tiny && tiny.params.max_tokens}`);
  } finally { await fake.close(); fx.cleanup(); }
});

await T.attempt("T17", async () => {
  for (const withKey of [false, true]) {
    const fx = mkFixture(), fake = await startFake();
    try {
      const before = snapshot(fx.dir);
      const r = await runTool(fx, argsFor(fx, fake, "--dry-run", "--langs", "de"), { key: withKey ? FAKE_KEY : null });
      const tag = withKey ? "with a key" : "with no key";
      T.exit(`T17a --dry-run ${tag} exits 0`, r, 0);
      T.check(`T17b it prints the estimate in tokens and in dollars ${tag}`, !r.notBuilt && /tokens/i.test(r.out) && /\$\s*\d|\d\s*(USD|dollars)/i.test(r.out), r.out.slice(0, 160).replace(/\n/g, " | "));
      T.check(`T17c it prints the plan: the items that would be sent ${tag}`, !r.notBuilt && r.out.includes("docs/readme/top") && r.out.includes("de"), r.out.slice(0, 160).replace(/\n/g, " | "));
      T.check(`T17d no request was made and nothing written ${tag}`, !r.notBuilt && fake.requests.length === 0 && snapshot(fx.dir) === before, `${fake.requests.length} requests`);
    } finally { await fake.close(); fx.cleanup(); }
  }
});

await T.attempt("T18", async () => {
  const fx = mkFixture(), fake = await startFake();
  try {
    const dry = async (n) => (await run(fx, fake, "--dry-run", "--langs", "de", "--max-tokens", String(n))).code;
    const probe = await run(fx, fake, "--dry-run", "--langs", "de", "--max-tokens", "100000000");
    if (probe.notBuilt) return T.check("T18 the cap's boundary", false, probe.err);
    let lo = 1, hi = 100000000;
    if (probe.code !== 0) return T.check("T18 a dry run far under the cap exits 0", false, `exit ${probe.code}`);
    while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if ((await dry(mid)) === 0) hi = mid; else lo = mid + 1; }
    const cap = lo;
    T.check("T18a the boundary is a real estimate (above 1,000 tokens) and one token under it is refused with exit 3", cap > 1000 && (await dry(cap - 1)) === 3 && (await dry(cap)) === 0, `smallest passing cap ${cap}`);
    const before = snapshot(fx.dir);
    let r = await run(fx, fake, "--langs", "de", "--max-tokens", String(cap - 1));
    T.exit("T18b one under the estimate: exit 3", r, 3);
    T.check("T18c nothing was sent and nothing written, the estimate and the items are printed", fake.requests.length === 0 && snapshot(fx.dir) === before && r.out.includes("docs/readme/top") && /tokens/i.test(r.out), `${fake.requests.length} requests; ${r.out.slice(0, 100).replace(/\n/g, " | ")}`);
    r = await runTool(fx, argsFor(fx, fake, "--langs", "de"), { env: { TRANSLATE_MAX_TOKENS: String(cap - 1) } });
    T.exit("T18d TRANSLATE_MAX_TOKENS is the cap when --max-tokens is absent: exit 3", r, 3);
    r = await runTool(fx, argsFor(fx, fake, "--langs", "de", "--max-tokens", String(cap)), { env: { TRANSLATE_MAX_TOKENS: "1000" } });
    T.exit("T18e at the cap the run goes on (--max-tokens wins over the variable): exit 0", r, 0);
    T.check("T18f requests were made and the files written at the cap", fake.posts > 0 && fx.exists("assets/i18n/de.json"), `${fake.posts} posts`);
  } finally { await fake.close(); fx.cleanup(); }
});

await T.attempt("T18m", async () => {
  /* finding 4: the cap is a spend ceiling, and the retry batch is spend. The owner keeps TRANSLATE_MAX_TOKENS as the way to
     raise it, so the test is only that round 2 counts against the same cap as round 1. The cap is set one token over the
     estimate of the whole plan: a run with nothing to retry fits, a run that needs a retry batch does not. */
  const TOP = "docs/readme/top";
  const fx = mkFixture(), fake = await startFake();
  try {
    const dry = async (n) => (await run(fx, fake, "--dry-run", "--langs", "de", "--max-tokens", String(n))).code;
    let lo = 1, hi = 100000000;
    if ((await dry(hi)) !== 0) return T.check("T18m the plan's estimate", false, "a dry run far under the cap does not exit 0");
    while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if ((await dry(mid)) === 0) hi = mid; else lo = mid + 1; }
    const cap = lo + 1;
    const clean = await run(fx, fake, "--langs", "de", "--max-tokens", String(cap));
    T.exit("T18m control: at one token over the estimate a run with nothing to retry goes through: exit 0", clean, 0);
    const fx2 = mkFixture(), fake2 = await startFake({ script: (cid, n, q, ans) => { if (cid === `${TOP}@de` && n === 1) { ans.html = ans.html.replace("<strong>", "").replace("</strong>", ""); return { answer: ans }; } return undefined; } });
    try {
      const before = snapshot(fx2.dir);
      const r = await run(fx2, fake2, "--langs", "de", "--max-tokens", String(cap));
      T.exit("T18n one item needs a retry batch and the estimate of both rounds is over the cap: exit 3", r, 3);
      T.check("T18o the retry batch is not submitted (one batch only), and nothing is written", !r.notBuilt && fake2.batches.length === 1 && snapshot(fx2.dir) === before, `${fake2.batches.length} batches`);
    } finally { await fake2.close(); fx2.cleanup(); }
  } finally { await fake.close(); fx.cleanup(); }
});

await T.attempt("T18p", async () => {
  /* fix review 7: the retry round's estimate is checked against the cap before it is submitted; a resume of a retry
     batch already submitted (and paid) must not be stopped by it. The first run has the default cap and its retry batch
     does not end (exit 5); the resume is given a cap one token over round 1's estimate, under both rounds'. */
  const TOP = "docs/readme/top";
  const fx = mkFixture(), fake = await startFake({ never: 1, script: (cid, n, q, ans) => { if (cid === `${TOP}@de` && n === 1) { ans.html = ans.html.replace("<strong>", "").replace("</strong>", ""); return { answer: ans }; } return undefined; } });
  try {
    const dry = async (n) => (await run(fx, fake, "--dry-run", "--langs", "de", "--max-tokens", String(n))).code;
    let lo = 1, hi = 100000000;
    if ((await dry(hi)) !== 0) return T.check("T18p the plan's estimate", false, "a dry run far under the cap does not exit 0");
    while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if ((await dry(mid)) === 0) hi = mid; else lo = mid + 1; }
    const r1 = await runTool(fx, argsFor(fx, fake, "--langs", "de", "--timeout-minutes", "0.02"));
    T.exit("T18p the retry batch does not end: exit 5", r1, 5);
    const m = /TRANSLATE_BATCH_ID=(\S+)/.exec(r1.out + r1.err), id = m ? m[1] : "";
    if (!id || fake.batches.length !== 2) return T.check("T18p two batches and a token to resume", false, `${fake.batches.length} batches, token ${id || "none"}`);
    fake.never = false;
    const posts = fake.posts;
    const r = await runTool(fx, argsFor(fx, fake, "--langs", "de", "--max-tokens", String(lo + 1)), { env: { TRANSLATE_BATCH_ID: id } });
    T.exit("T18p resuming the paid retry batch under a cap that fits round 1 only goes through: exit 0 (not 3)", r, 0);
    T.check("T18p and it submitted nothing", !r.notBuilt && fake.posts === posts, `${fake.posts - posts} new posts`);
  } finally { await fake.close(); fx.cleanup(); }
});

await T.attempt("T18g", async () => {
  /* a fixture of n big sections (90,000 chars each, under the 100,000 limit); the estimate is read from the dry run's
     own exit codes against explicit caps, never copied */
  const big = (i) => ({ id: `big${i}`, title: `Big ${i}`, subs: [], html: `<h2 id="big${i}"><a class="anchor" href="#docs/guide/big${i}" aria-label="Link to this heading">#</a>Big ${i}</h2>\n` + "<p>A long line of plain words about the household and its reminders.</p>\n".repeat(1250) });
  const fx = mkFixture(), fake = await startFake();
  try {
    const dry = async (cap, env = {}) => (await runTool(fx, argsFor(fx, fake, "--dry-run", "--langs", "de", ...(cap ? ["--max-tokens", String(cap)] : [])), { env })).code;
    const estimate = async () => { let lo = 1, hi = 20000000; while (lo < hi) { const m = Math.floor((lo + hi) / 2); if ((await dry(m)) === 0) hi = m; else lo = m + 1; } return lo; };
    let n = 0;
    const grow = (k) => { for (let i = 0; i < k; i++) fx.addSection("guide", big(n++)); };
    grow(10); const e10 = await estimate();
    const per = e10 / 10; /* the base of the small sections is negligible next to it; the bounds below check the result */
    if (!(per > 10000)) return T.check("T18g a big section has an estimate", false, `estimate ${e10} for 10`);
    grow(Math.max(0, Math.round(2500000 / per) - 10));
    const e25 = await estimate();
    T.check("T18g the fixture's estimate is about 2.5M tokens (2.4M to 2.6M)", e25 > 2400000 && e25 < 2600000, `estimate ${e25}`);
    T.check("T18h with no --max-tokens and no TRANSLATE_MAX_TOKENS an estimate of about 2.5M proceeds (dry run exit 0)", (await dry(0)) === 0, "default cap above 2.5M");
    grow(Math.round(600000 / per));
    const e31 = await estimate();
    T.check("T18i the fixture's estimate is about 3.1M tokens (3.05M to 3.2M)", e31 > 3050000 && e31 < 3200000, `estimate ${e31}`);
    T.check("T18j about 3.1M with the default cap: dry run exits 3", (await dry(0)) === 3, "default cap below 3.1M");
    const before = snapshot(fx.dir);
    const r = await runTool(fx, argsFor(fx, fake, "--langs", "de"));
    T.exit("T18k a real run at about 3.1M with the default cap: exit 3", r, 3);
    T.check("T18l nothing was sent and nothing written", !r.notBuilt && fake.requests.length === 0 && snapshot(fx.dir) === before, `${fake.requests.length} requests`);
  } finally { await fake.close(); fx.cleanup(); }
});

await T.attempt("T31", async () => {
  const fx = mkFixture(), fake = await startFake();
  try {
    const r = await run(fx, fake, "--langs", "de,ja");
    T.exit("T31a a run for de and ja exits 0 (the fake refuses any custom_id off the pattern with 400)", r, 0);
    const posts = fake.requests.filter((q) => q.method === "POST" && q.path === "/v1/messages/batches");
    const first = posts[0] && posts[0].json && posts[0].json.requests || [];
    const ids = first.map((q) => q.custom_id);
    T.check("T31b every custom_id matches ^[a-zA-Z0-9_-]{1,64}$", ids.length > 2 && ids.every((i) => CUSTOM_ID.test(i)), `${ids.length} ids, first ${ids[0]}`);
    const pad = String(ids.length - 1).length;
    T.check("T31c each is r + its zero-padded index (r0000, r0001, ...) in the order sent", ids.length > 2 && ids.every((id, n) => id === "r" + String(n).padStart(Math.max(4, pad), "0")), ids.slice(0, 3).join(","));
    T.check("T31d no id repeats within a batch", new Set(ids).size === ids.length, `${new Set(ids).size} distinct of ${ids.length}`);
    T.check("T31e the request list is sorted: ids follow the run's order, de requests before ja (ordered by language)", fake.sent.length > 2 && fake.sent.findIndex((q) => q.lang === "ja") > fake.sent.map((q) => q.lang).lastIndexOf("de"), "languages in order");
  } finally { await fake.close(); fx.cleanup(); }
});

await T.attempt("T23", async () => {
  const fx = mkFixture(), fake = await startFake();
  try {
    const r = await run(fx, fake, "--langs", "de");
    T.exit("T23a a run against --api-base exits 0", r, 0);
    T.check("T23b the fake got the requests (--api-base honoured), each with x-api-key", fake.requests.length > 0 && fake.requests.every((q) => q.headers["x-api-key"] === FAKE_KEY), `${fake.requests.length} requests`);
    const leaks = fake.requests.filter((q) => q.path.includes(FAKE_KEY) || q.bodyText.includes(FAKE_KEY) || Object.entries(q.headers).some(([h, v]) => h !== "x-api-key" && String(v).includes(FAKE_KEY)));
    T.check("T23c the key is in no URL, body or other header", fake.requests.length > 0 && !leaks.length, `${leaks.length} requests carry it`);
    const rep = (() => { try { return readFileSync(fx.report, "utf8"); } catch { return null; } })();
    T.check("T23d the key is in neither the output nor the report", !r.notBuilt && rep !== null && !rep.includes(FAKE_KEY) && !r.out.includes(FAKE_KEY) && !r.err.includes(FAKE_KEY), rep === null ? "no report written" : "clean");
    const f2 = await startFake();
    const a = await run(fx, f2, "--langs", "de", "--api-key", FAKE_KEY);
    T.exit("T23e the key as an argument (--api-key) is refused: exit 1", a, 1);
    T.check("T23f and nothing was sent", !a.notBuilt && f2.requests.length === 0, `${f2.requests.length} requests`);
    await f2.close();
  } finally { await fake.close(); fx.cleanup(); }
});
T.done();
