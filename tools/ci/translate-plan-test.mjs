/*
 * Test for orbit-site #125 stage 2 (the translation job), written from the specification alone (issue #125, spec
 * sections 2.1 "Plan" and 6, items 2, 3 and 22). The API is the fake of tools/ci/fake-claude.mjs; nothing reaches
 * the network. What is sent is read from the requests the fake recorded, so the plan's own print is not relied on.
 *
 *   T2  unchanged hashes are not due; a changed section, a new section and a new language are due; a removed
 *       section is dropped from the page: every item is sent once, none twice, none missed
 *   T3  a catalogue chunk holds at most 60 keys, only keys whose hash differs from the stored one, and every due
 *       key is in exactly one chunk
 *   T22 a second run over the written output has an empty plan: no request at all, nothing rewritten
 *
 *   node tools/ci/translate-plan-test.mjs
 */
import { startFake } from "./fake-claude.mjs";
import { T, hash16, mkFixture, runTool, argsFor, snapshot, docsIds, siteQs } from "./translate-fixture.mjs";

const run = async (fx, fake, ...more) => runTool(fx, argsFor(fx, fake, ...more));
const keysOf = (q) => (q.item && q.item.items || []).map((x) => x.id);
const ALL = ["readme/top", "readme/diagram", "readme/shot", "guide/start", "guide/long"];

await T.attempt("T2", async () => {
  const fx = mkFixture(), fake = await startFake();
  try {
    let r = await run(fx, fake, "--langs", "de");
    T.exit("T2a first run for de exits 0", r, 0);
    const first = docsIds(fake);
    T.check("T2b the first run sends every section once (5, no duplicates)", JSON.stringify(first) === JSON.stringify(ALL.map((i) => `docs/${i}@de`).sort()), JSON.stringify(first));
    /* English changes: one section edited, one added, one removed; and a language is added */
    fake.requests.length = 0; fake.batches.length = 0;
    fx.setSection("guide", "long", { html: fx.pages.guide.sections[1].html.replace("Doors are", "All doors are") });
    fx.addSection("guide", { id: "extra", title: "Extra", subs: [], html: '<h2 id="extra"><a class="anchor" href="#docs/guide/extra" aria-label="Link to this heading">#</a>Extra</h2>\n<p>One more thing to read about the household.</p>' });
    fx.removeSection("readme", "diagram");
    r = await run(fx, fake, "--langs", "de,fr");
    T.exit("T2c the second run (changed, new, removed, new language) exits 0", r, 0);
    const want = ["guide/long@de", "guide/extra@de", ...["readme/top", "readme/shot", "guide/start", "guide/long", "guide/extra"].map((i) => `${i}@fr`)].map((i) => `docs/${i}`).sort();
    const got = docsIds(fake);
    T.check("T2d sent: the changed and the new section for de, every section for fr, nothing else, none twice", JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);
    T.check("T2e the removed section is not sent", got.length > 0 && !got.some((i) => i.includes("readme/diagram")), "docs/readme/diagram absent");
    const de = fx.read("assets/docs-i18n/de/readme.json");
    T.check("T2f the removed section is dropped from the translated page", JSON.stringify(de.sections.map((s) => s.id)) === JSON.stringify(["top", "shot"]), JSON.stringify(de.sections.map((s) => s.id)));
    T.check("T2g the unchanged catalogue of de is not sent again, fr's is sent", !siteQs(fake).some((q) => q.lang === "de") && siteQs(fake).some((q) => q.lang === "fr"), siteQs(fake).map((q) => q.customId).join(","));
  } finally { await fake.close(); fx.cleanup(); }
});

await T.attempt("T3", async () => {
  const fx = mkFixture({ keys: 130 }), fake = await startFake();
  try {
    let r = await run(fx, fake, "--langs", "fr", "--only", "site");
    T.exit("T3a a catalogue-only run for fr exits 0", r, 0);
    let chunks = siteQs(fake), all = chunks.flatMap(keysOf);
    T.check("T3b no chunk holds more than 60 keys", chunks.length > 0 && chunks.every((q) => keysOf(q).length <= 60), JSON.stringify(chunks.map((q) => keysOf(q).length)));
    T.check("T3c the chunks together hold each of the 130 keys exactly once", all.length === 130 && new Set(all).size === 130 && Object.keys(fx.en).every((k) => all.includes(k)), `${all.length} keys, ${new Set(all).size} distinct`);
    T.check("T3d no docs item is sent under --only site", chunks.length > 0 && docsIds(fake).length === 0, docsIds(fake).join(","));
    /* five keys edited and one added: only these are due */
    fake.requests.length = 0; fake.batches.length = 0;
    const changed = ["k010", "k020", "k030", "k040", "k050"];
    for (const k of changed) fx.en[k] = `${fx.en[k]} Changed.`;
    fx.setKey("k131", "A brand new key");
    r = await run(fx, fake, "--langs", "fr", "--only", "site");
    T.exit("T3e the run after the edit exits 0", r, 0);
    chunks = siteQs(fake); all = chunks.flatMap(keysOf);
    T.check("T3f one chunk, holding exactly the 5 changed keys and the new one", chunks.length === 1 && JSON.stringify([...all].sort()) === JSON.stringify([...changed, "k131"].sort()), JSON.stringify(all));
    const st = fx.read("tools/i18n/state/fr.json");
    const have = st.catalogue, want = hash16(fx.en.k010), wantNew = hash16("A brand new key");
    T.check("T3g the state holds the hash of the changed English of a key", have.k010 === want && have.k131 === wantNew, JSON.stringify(have.k010));
  } finally { await fake.close(); fx.cleanup(); }
});

await T.attempt("T22", async () => {
  const fx = mkFixture(), fake = await startFake();
  try {
    let r = await run(fx, fake, "--langs", "de,ja");
    T.exit("T22a the first run exits 0", r, 0);
    const written = snapshot(fx.dir), batches = fake.batches.length;
    r = await run(fx, fake, "--langs", "de,ja");
    T.exit("T22b the second run exits 0", r, 0);
    T.check("T22c the second run made no request at all", batches > 0 && fake.batches.length === batches && fake.posts === batches, `${fake.posts} posts, ${batches} batches before`);
    T.check("T22d nothing was rewritten", batches > 0 && snapshot(fx.dir) === written, "the checkout's data changed");
    const st = fx.read("tools/i18n/state/de.json"), p = fx.read("assets/docs-i18n/de/guide.json");
    T.check("T22e the hashes are stored (16 lower hex) in the state and in the page's source", Object.values(st.catalogue).length === 130 && Object.values(st.catalogue).every((h) => /^[0-9a-f]{16}$/.test(h)) && Object.values(p.source.sections).every((h) => /^[0-9a-f]{16}$/.test(h)), "stored hashes");
  } finally { await fake.close(); fx.cleanup(); }
});
T.done();
