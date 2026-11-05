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
 *   T17 --dry-run with no key prints the estimate (tokens, dollars) and the plan, makes no request, exits 0, and
 *       writes nothing (also with a key present)
 *   T18 an estimate above the cap exits 3 with nothing sent and nothing written; at the cap the run goes on. The
 *       boundary is found by the dry run's own exit code (0 or 3), so the test needs no copy of the estimate
 *   T23 --api-base is honoured; the key goes only as the x-api-key header: never in a URL, a body, the output or the
 *       report, and never as an argument (--api-key is refused)
 *
 *   node tools/ci/translate-request-test.mjs
 */
import { readFileSync } from "node:fs";
import { startFake, FAKE_KEY } from "./fake-claude.mjs";
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
    all("T5f fallbacks is \"default\" (in the request's params, or on the batch body)", (p) => p.fallbacks === "default" || (post && post.json && post.json.fallbacks === "default"));
    T.check("T5g headers: anthropic-version 2023-06-01 and the server-side-fallback beta", !!post && post.headers["anthropic-version"] === "2023-06-01" && String(post.headers["anthropic-beta"] || "").includes("server-side-fallback-2026-07-01"), JSON.stringify(post && { v: post.headers["anthropic-version"], b: post.headers["anthropic-beta"] }));
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
