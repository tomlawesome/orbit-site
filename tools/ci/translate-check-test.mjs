/*
 * Test for orbit-site #125 stage 2 (the translation job), written from the specification alone (issue #125, spec
 * sections 2.2 "Checks on every result" and 6, items 6 to 12). The fake API answers an item with a damaged result
 * on every try, so after the one retry the item is kept in English and the report names the item and the rule; an
 * undamaged or acceptably changed result is written as translated. The report's shape is not fixed by the spec,
 * so it is searched for the item and for the rule's words (reportNames in translate-fixture.mjs).
 *
 *   T6  (a) a result that drops a <strong>, adds a <br> or changes an href is refused, the rule named
 *   T7  (b) a changed character in <pre class="code"> or <code> is refused
 *   T8  (e) a mermaid label translated passes; a changed arrow, node id or line count is refused
 *   T9  (f)/(m) German 3x English is refused, Japanese 0.4x passes; and the table is the right one: German 0.4x
 *       and Japanese 2x are refused; a catalogue 3x is refused
 *   T10 (k) a catalogue value missing {n}, or adding <a>, is refused
 *   T11 (n) a result translating "Orbit" is refused; the pinned rendering of "the launcher" passes
 *   T12 (h)/(i) javascript:, an on*= handler or a <script> in a result is refused even with the skeleton alike
 *
 *   node tools/ci/translate-check-test.mjs
 */
import { startFake } from "./fake-claude.mjs";
import { T, mkFixture, runTool, argsFor, reportNames, hash16, sectionHash, swap, plainLength } from "./translate-fixture.mjs";

const RULE = {
  a: /skeleton|\btags?\b|\(a\)/i, b: /\bcode\b|\(b\)/i, c: /href|\bsrc\b|\(c\)/i, e: /mermaid|\(e\)/i, f: /length|ratio|\(f\)|\(m\)/i,
  h: /script|style|javascript|handler|on\*|\(h\)/i, i: /markup|allow-?list|\(i\)/i, k: /holes?|placeholder|\{|tags?\b|\(k\)/i, n: /glossary|keep|\(n\)/i,
};
const copy = (o) => structuredClone(o);

/* one run: the answer for `target` (a custom id without its @lang, or a prefix ending in /) is changed on every try */
async function go(label, { target, lang = "de", only = "docs", mutate }) {
  const fx = mkFixture(), fake = await startFake({ script: (cid, n, q, ans) => ((target.endsWith("/") ? cid.startsWith(target) : cid === `${target}@${lang}`) && mutate ? { answer: mutate(copy(ans), q) } : undefined) });
  const r = await runTool(fx, argsFor(fx, fake, "--langs", lang, "--only", only));
  const out = { fx, fake, r, done: () => { fake.close(); fx.cleanup(); } };
  if (r.code !== 0 && !r.notBuilt) T.check(`${label}: the run itself exits 0`, false, `exit ${r.code}; ${(r.err || r.out).trim().split("\n").slice(-2).join(" | ")}`);
  if (r.notBuilt) T.check(label, false, r.err);
  return out;
}
/* the answer is refused: the section (slug/id) is English, its hash recorded, its id in source.kept, the report names the rule */
async function refused(label, id, rule, mutate, lang = "de") {
  const [, slug, sid] = id.split("/");
  const { fx, r, done } = await go(label, { target: id, lang, mutate });
  try {
    if (r.code !== 0) return T.check(label, false, r.notBuilt ? r.err : `exit ${r.code}`);
    const p = fx.read(`assets/docs-i18n/${lang}/${slug}.json`), s = p.sections.find((x) => x.id === sid), eng = fx.pages[slug].sections.find((x) => x.id === sid);
    T.check(`${label}: refused, so the section is the English one, its hash recorded and its id in source.kept`, !!s && s.html === eng.html && p.source.sections[sid] === sectionHash(eng) && p.source.kept.includes(sid), s ? `html ${s.html === eng.html ? "English" : "NOT English"}, kept ${JSON.stringify(p.source.kept)}` : "section missing");
    T.check(`${label}: the report names ${id} and the rule`, reportNames(fx.readReport(), id, rule), `no report entry for ${id} matching ${rule}`);
  } catch (e) { T.check(label, false, String(e && e.message || e)); } finally { done(); }
}
async function accepted(label, id, mutate, test, lang = "de") {
  const [, slug, sid] = id.split("/");
  const { fx, r, done } = await go(label, { target: id, lang, mutate });
  try {
    if (r.code !== 0) return T.check(label, false, r.notBuilt ? r.err : `exit ${r.code}`);
    const p = fx.read(`assets/docs-i18n/${lang}/${slug}.json`), s = p.sections.find((x) => x.id === sid);
    T.check(label, !!s && !p.source.kept.includes(sid) && test(s.html), s ? `kept ${JSON.stringify(p.source.kept)}` : "section missing");
  } catch (e) { T.check(label, false, String(e && e.message || e)); } finally { done(); }
}
const html = (f) => (a) => { a.html = f(a.html); return a; };
const TOP = "docs/readme/top", SHOT = "docs/readme/shot", DIAGRAM = "docs/readme/diagram", LONG = "docs/guide/long";

await T.attempt("T6", async () => {
  await accepted("T6 control: the undamaged default answer is written as translated", TOP, (a) => a, (h) => h.includes("é"));
  await refused("T6a a dropped <strong>", TOP, RULE.a, html((h) => h.replace("<strong>", "").replace("</strong>", "")));
  await refused("T6b an added <br>", TOP, RULE.a, html((h) => h.replace("</p>", "<br></p>")));
  await refused("T6c a changed href", TOP, new RegExp(`${RULE.a.source}|${RULE.c.source}`, "i"), html((h) => h.replace("https://example.invalid/site", "https://example.invalid/other")));
  await refused("T6d a changed anchor href (a heading link)", TOP, new RegExp(`${RULE.a.source}|${RULE.c.source}`, "i"), html((h) => h.replace('href="#docs/readme/top"', 'href="#docs/readme/elsewhere"')));
});

await T.attempt("T7", async () => {
  await refused("T7a a changed character in <pre class=\"code\"><code>", TOP, RULE.b, html((h) => h.replace("--door 8080", "--door 8081")));
  await refused("T7b a changed word in an inline <code>", TOP, RULE.b, html((h) => h.replace("<code>orbit stop</code>", "<code>orbit halt</code>")));
});

await T.attempt("T8", async () => {
  await accepted("T8a a mermaid with translated labels passes", DIAGRAM, html((h) => h.replace("Your browser", "Dein Browser").replace("The database", "Die Datenbank")), (h) => h.includes("Dein Browser") && h.includes("Die Datenbank"));
  await refused("T8b a changed arrow", DIAGRAM, RULE.e, html((h) => h.replace("--&gt; b(", "--- b(")));
  await refused("T8c a changed node id", DIAGRAM, RULE.e, html((h) => h.replace("b --&gt; c[", "x --&gt; c[")));
  await refused("T8d a missing line", DIAGRAM, RULE.e, html((h) => h.replace("\n    b --&gt; c[(&quot;The database&quot;)]", "")));
});

await T.attempt("T9", async () => {
  const fx = mkFixture(), eng = fx.pages.guide.sections.find((s) => s.id === "long").html, L = plainLength(eng);
  fx.cleanup();
  const p = (h) => /<p>([\s\S]*)<\/p>$/.exec(h)[1];
  const scaled = (k) => html((h) => { const body = p(h), want = Math.max(10, Math.round(k * L) - 5); const t = body.repeat(Math.ceil(want / body.length) + 1).slice(0, want).replace(/\s+\S*$/, ""); return h.replace(body, t); });
  await refused("T9a German at 3x English", LONG, RULE.f, scaled(3));
  await refused("T9b German at 0.4x English (below the Latin table's 0.5)", LONG, RULE.f, scaled(0.4));
  await accepted("T9c Japanese at 0.4x English passes (the CJK table)", LONG, scaled(0.4), (h) => plainLength(h) < 0.5 * L, "ja");
  await refused("T9d Japanese at 2x English (above the CJK table's 1.5)", LONG, RULE.f, scaled(2), "ja");
  await accepted("T9e German at 2x English passes (the Latin table)", LONG, scaled(2), (h) => plainLength(h) > 1.5 * L);
  /* the catalogue: every value three times as long */
  const c = await go("T9f", { target: "site/", only: "site", mutate: (a) => { a.items = a.items.map((x) => ({ id: x.id, text: `${x.text} ${x.text} ${x.text}` })); return a; } });
  try {
    if (c.r.code === 0) {
      const st = c.fx.read("tools/i18n/state/de.json");
      T.check("T9f a catalogue three times as long is refused: its keys are English and in state.kept, the report says length", st.kept.includes("k001") && c.fx.read("assets/i18n/de.json").k001 === c.fx.en.k001 && reportNames(c.fx.readReport(), "k001", RULE.f) || reportNames(c.fx.readReport(), "site/", RULE.f), `kept ${st.kept.length} keys`);
    }
  } catch (e) { T.check("T9f", false, String(e && e.message || e)); } finally { c.done(); }
});

/* a catalogue case: the answer for the chunk is changed in one key */
async function keyCase(label, key, newText, { pass, rule, extra } = {}) {
  const c = await go(label, { target: "site/", only: "site", mutate: (a) => { a.items = a.items.map((x) => (x.id === key ? { id: x.id, text: newText } : x)); return a; } });
  try {
    if (c.r.code !== 0) return;
    const cat = c.fx.read("assets/i18n/de.json"), st = c.fx.read("tools/i18n/state/de.json");
    if (pass) T.check(`${label}: written as translated`, cat[key] === newText && !st.kept.includes(key), `${key} = ${JSON.stringify(cat[key])}, kept ${st.kept.includes(key)}`);
    else {
      T.check(`${label}: refused, so the key is English's and in state.kept`, cat[key] === c.fx.en[key] && st.kept.includes(key), `${key} = ${JSON.stringify(cat[key])}`);
      T.check(`${label}: the report names ${key} and the rule`, reportNames(c.fx.readReport(), key, rule), `no entry for ${key} matching ${rule}`);
    }
  } catch (e) { T.check(label, false, String(e && e.message || e)); } finally { c.done(); }
}
await T.attempt("T10", async () => {
  await keyCase("T10 control: a value with {n} kept is written", "k003", "Du hast {n} Elemente fällig", { pass: true });
  await keyCase("T10a a value missing {n}", "k003", "Du hast Elemente fällig", { rule: RULE.k });
  await keyCase("T10b a value that adds <a>", "k001", `${swap("Plain sentence number 1 about the household door.")} <a>mehr</a>`, { rule: RULE.k });
  await keyCase("T10c a value that drops the <a>", "k004", "Lies zuerst die Dokumente", { rule: RULE.k });
});

await T.attempt("T11", async () => {
  await keyCase("T11a \"Orbit\" translated in a catalogue value", "k005", "Orbita vergisst nie eine Aufgabe", { rule: RULE.n });
  await keyCase("T11b \"Orbit\" kept in a catalogue value", "k005", "Orbit vergisst nie eine Aufgabe", { pass: true });
  await keyCase("T11c the pinned rendering of \"the launcher\" passes", "k007", "Öffne der Launcher für {n} Türen", { pass: true });
  await refused("T11d \"Orbit\" translated in a section", TOP, RULE.n, html((h) => h.replace("</a>Orbit</h2>", "</a>Orbita</h2>").replace("Orbit keeps", "Orbita keeps")));
});

await T.attempt("T12", async () => {
  await accepted("T12 control: a translated alt (allowed to differ) passes", SHOT, html((h) => h.replace('alt="The sky screen, filled with made-up data"', 'alt="Der Himmel-Bildschirm mit erfundenen Daten"')), (h) => h.includes("Himmel-Bildschirm"));
  await refused("T12a javascript: in an alt", SHOT, new RegExp(`${RULE.h.source}|${RULE.i.source}`, "i"), html((h) => h.replace('alt="The sky screen, filled with made-up data"', 'alt="javascript:alert(1)"')));
  await refused("T12b an on*= handler in an alt", SHOT, new RegExp(`${RULE.h.source}|${RULE.i.source}`, "i"), html((h) => h.replace('alt="The sky screen, filled with made-up data"', 'alt="y onclick=alert(1)"')));
  await refused("T12c a <script> in an alt", SHOT, new RegExp(`${RULE.h.source}|${RULE.i.source}`, "i"), html((h) => h.replace('alt="The sky screen, filled with made-up data"', 'alt="<script>alert(1)</script>"')));
  await refused("T12d an onclick attribute added to a <strong>", TOP, new RegExp(`${RULE.h.source}|${RULE.i.source}|${RULE.a.source}`, "i"), html((h) => h.replace("<strong>", '<strong onclick="x()">')));
});
T.done();
