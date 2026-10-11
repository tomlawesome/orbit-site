/*
 * Test for the docs pad's small helpers (#12, items S6, S7, S9), written from the specification alone. assets/js/pads.js
 * exports:
 *   S6  highlight(text, query) -> HTML: the escaped text with case-insensitive matches of query wrapped in <mark>, each
 *       piece escaped. "R&D <tips>" with "d" gives `R&amp;<mark>D</mark> &lt;tips&gt;`. An empty query gives the escaped
 *       text. The query "&amp" matches nothing in "R&D" (an entity is never cut open).
 *   S7  createScriptLoader(load) -> { get() }: calls load() once and shares its promise while pending and after success;
 *       after a rejection the next get() calls load() again.
 *   S9  docsPath(hash) -> the decoded path after "#docs/", the raw string when decodeURIComponent throws, null when
 *       the hash is not a docs one; it never throws.
 *
 *   node tools/ci/site-pads-test.mjs
 *
 * No dependencies and no browser. pads.js loads in Node once matchMedia exists.
 */
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });

let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};
const show = (v) => JSON.stringify(v);
const attempt = (fn) => { try { return { v: fn() }; } catch (e) { return { threw: e.message }; } };

const { highlight, createScriptLoader, docsPath } = await import("../../assets/js/pads.js");

/* S6 */
check("highlight is exported from pads.js", typeof highlight === "function", `typeof highlight is ${typeof highlight} (want function)`);
if (typeof highlight === "function") {
  const eq = (name, args, want) => {
    const r = attempt(() => highlight(...args));
    check(name, r.v === want, r.threw ? `threw ${r.threw}` : `got ${show(r.v)} (want ${show(want)})`);
  };
  eq("S6 a match is marked, the pieces escaped", ["R&D <tips>", "d"], "R&amp;<mark>D</mark> &lt;tips&gt;");
  eq("S6 the match is case-insensitive and keeps the text's case", ["Docs", "DOC"], "<mark>Doc</mark>s");
  eq("S6 an empty query gives the escaped text", ["R&D <tips>", ""], "R&amp;D &lt;tips&gt;");
  eq("S6 a query of an entity's text matches nothing in the raw text", ["R&D", "&amp"], "R&amp;D");
  eq("S6 a query that is not in the text gives the escaped text", ["a < b", "zz"], "a &lt; b");
  eq("S6 every match is marked", ["banana", "an"], "b<mark>an</mark><mark>an</mark>a");
}

/* S7 */
check("createScriptLoader is exported from pads.js", typeof createScriptLoader === "function", `typeof createScriptLoader is ${typeof createScriptLoader} (want function)`);
if (typeof createScriptLoader === "function") {
  const deferred = () => { let ok, no; const p = new Promise((a, b) => { ok = a; no = b; }); p.catch(() => {}); return { p, ok, no }; };

  {
    let n = 0; const d = deferred();
    const g = createScriptLoader(() => { n++; return d.p; });
    const a = g.get(), b = g.get();
    a.catch?.(() => {});
    check("S7 two gets while pending: one load", n === 1, `load ran ${n} time(s) (want 1)`);
    check("S7 two gets while pending share the promise", a === b, a === b ? "same promise" : "different promises");
  }
  {
    let n = 0;
    const g = createScriptLoader(() => { n++; return Promise.resolve("script"); });
    await g.get(); const again = await g.get();
    check("S7 resolve then get: one load", n === 1 && again === "script", `load ran ${n} time(s), second get gave ${show(again)} (want 1, "script")`);
  }
  {
    let n = 0;
    const g = createScriptLoader(() => { n++; return n === 1 ? Promise.reject(new Error("blocked")) : Promise.resolve("script"); });
    let first = "resolved";
    try { await g.get(); } catch { first = "rejected"; }
    const second = await g.get().catch((e) => `rejected: ${e.message}`);
    check("S7 a failed load rejects the first get", first === "rejected", `first get ${first} (want rejected)`);
    check("S7 reject then get: load runs again and succeeds", n === 2 && second === "script", `load ran ${n} time(s), second get gave ${show(second)} (want 2, "script")`);
  }
}

/* S9 */
check("docsPath is exported from pads.js", typeof docsPath === "function", `typeof docsPath is ${typeof docsPath} (want function)`);
if (typeof docsPath === "function") {
  const eq = (name, hash, want) => {
    const r = attempt(() => docsPath(hash));
    check(name, !r.threw && r.v === want, r.threw ? `threw ${r.threw}` : `got ${show(r.v)} (want ${show(want)})`);
  };
  eq("S9 a plain path", "#docs/foo", "foo");
  eq("S9 a percent sequence is decoded", "#docs/a%20b", "a b");
  eq("S9 a malformed sequence gives the raw string, no throw", "#docs/foo%E0%A4%A", "foo%E0%A4%A");
  eq("S9 a hash that is not a docs one gives null", "#other", null);
}

process.exit(failed ? 1 : 0);
