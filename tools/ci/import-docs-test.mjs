/*
 * Test for the pure helpers of the docs importer: plain() (the text that
 * search and summaries use), resolveLink() (what a link or picture address
 * becomes) and the warning for raw html that sanitising dropped.
 *
 *   npm ci --prefix tools --ignore-scripts && node tools/ci/import-docs-test.mjs
 *
 * tools/import-docs.mjs fetches and writes files the moment it is imported, so
 * it cannot be imported here. The helpers are expected in tools/import-docs-lib.mjs
 * (assumed name), exported as: plain(tokens), resolveLink(href, src,
 * bySourcePath, isImage) and droppedBlockWarning(src, htmlIn, htmlOut), which
 * returns the warning text, or "" / null / undefined for no warning; and the
 * heading ids: slugOf(text) (the id a heading's text gives, "" when nothing
 * is left) and slugger() (a function that gives each heading of one page its
 * id, unique and never empty), both ASCII only, as the page and the checks
 * accept. Needs `marked`. No network.
 */
let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};

let lib, marked;
try {
  ({ marked } = await import("marked"));
  lib = await import("../import-docs-lib.mjs");
} catch (e) {
  check("tools/import-docs-lib.mjs and marked load", false, `import failed: ${e.message}`);
  process.exit(1);
}
for (const n of ["plain", "resolveLink", "droppedBlockWarning"]) {
  if (typeof lib[n] !== "function") {
    check(`tools/import-docs-lib.mjs exports ${n}`, false, `got ${typeof lib[n]}`);
    failed = true;
  }
}
if (failed) process.exit(1);
const { plain, resolveLink, droppedBlockWarning } = lib;
// the heading-id helpers are checked case by case below, so a missing one fails each case and not just the load
for (const n of ["slugOf", "slugger"]) {
  if (typeof lib[n] !== "function") check(`tools/import-docs-lib.mjs exports ${n}`, false, `got ${typeof lib[n]}`);
}

const text = (md) => { try { return plain(marked.lexer(md)); } catch (e) { return `threw: ${e.message}`; } };
const eq = (name, got, want) => check(name, got === want, `gave ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);

// T4: plain() keeps escaped characters, image alt text and table header cells.
eq("T4 an escaped asterisk keeps the asterisk", text("Use 2 \\* 3 here"), "Use 2 * 3 here");
eq("T4 other escaped characters stay", text("a \\_b\\_ and \\#tag"), "a _b_ and #tag");
eq("T4 image alt text is kept", text("See ![the launcher splash](a.png) now"), "See the launcher splash now");
{
  const got = text("| Name | Role |\n| --- | --- |\n| Ann | Lead |\n");
  check("T4 table header cells are kept", got.includes("Name") && got.includes("Role") && got.includes("Ann") && got.includes("Lead"),
    `gave ${JSON.stringify(got)} (want Name, Role, Ann and Lead)`);
}

// T5: resolveLink() no longer passes a data: address through.
const src = { repo: "tomlawesome/orbit", path: "README.md" };
const bySourcePath = new Map([[`${src.repo}:${src.path}`, { ...src, slug: "readme" }]]);
const link = (h, image = false) => { try { return resolveLink(h, src, bySourcePath, image); } catch (e) { return `threw: ${e.message}`; } };
const notData = (name, h, image) => {
  const got = link(h, image);
  check(name, !/^\s*data:/i.test(String(got ?? "")) && !String(got).startsWith("threw:"),
    `${JSON.stringify(h)} gave ${JSON.stringify(got)} (want not starting with data:)`);
};
notData("T5 a data: link is not passed through", "data:text/html,<b>x</b>", false);
notData("T5 a DATA: link in any case is not passed through", "DATA:text/html;base64,AAAA", false);
notData("T5 a data: picture is not passed through", "data:image/png;base64,AAAA", true);
eq("T5 an https link is unchanged", link("https://example.com/a?b=1"), "https://example.com/a?b=1");
eq("T5 an http link is unchanged", link("http://example.com/a"), "http://example.com/a");
eq("T5 a mailto link is unchanged", link("mailto:a@example.com"), "mailto:a@example.com");
{
  const got = link("#frag");
  check("T5 an #anchor stays an anchor", typeof got === "string" && got.startsWith("#") && got.includes("frag"),
    `gave ${JSON.stringify(got)} (want a string starting with # and holding frag)`);
}

// T6: the dropped-block warning compares the visible text in and out.
const warn = (inn, out) => { try { return droppedBlockWarning(src, inn, out); } catch (e) { return `threw: ${e.message}`; } };
const warns = (inn, out) => { const w = warn(inn, out); return !!w && !String(w).startsWith("threw:"); };
check("T6 an empty output after visible text warns", warns("<p>Hello world</p>", ""), `gave ${JSON.stringify(warn("<p>Hello world</p>", ""))} (want a warning)`);
check("T6 a comment-only block does not warn", !warn("<!-- just a note -->", ""), `gave ${JSON.stringify(warn("<!-- just a note -->", ""))} (want none)`);
check("T6 a whitespace-only block does not warn", !warn("  \n ", ""), `gave ${JSON.stringify(warn("  \n ", ""))} (want none)`);
check("T6 a partial drop warns", warns("<p>alpha</p><p>beta</p>", "<p>alpha</p>"),
  `gave ${JSON.stringify(warn("<p>alpha</p><p>beta</p>", "<p>alpha</p>"))} (want a warning)`);
check("T6 nothing lost does not warn", !warn("<p>alpha &amp; beta</p>", "<p>alpha &amp; beta</p>"),
  `gave ${JSON.stringify(warn("<p>alpha &amp; beta</p>", "<p>alpha &amp; beta</p>"))} (want none)`);
check("T6 only markup lost does not warn", !warn("<p align=\"x\" onclick=\"y\">alpha</p>", "<p>alpha</p>"),
  `gave ${JSON.stringify(warn("<p align=\"x\" onclick=\"y\">alpha</p>", "<p>alpha</p>"))} (want none)`);
{
  const w = String(warn("<p>\u001b[31mred\u001b[0m\r\nline two \u0007bell</p>", ""));
  check("T6 control characters in fetched text are stripped from the warning", w !== "" && w !== "null" && !/[\u0000-\u001f\u007f]/.test(w),
    `gave ${JSON.stringify(w)} (want a warning with no control characters)`);
}

// S1-S4: slugOf() keeps ASCII letters and digits, folds accents to their letters, drops the rest.
const slug = (h) => { try { return lib.slugOf(h); } catch (e) { return `threw: ${e.message}`; } };
eq("S1 slugOf('Quick start')", slug("Quick start"), "quick-start");
eq("S1 slugOf('R&D')", slug("R&D"), "rd");
eq("S1 slugOf('<b>Bold</b> title')", slug("<b>Bold</b> title"), "bold-title");
eq("S1 slugOf('a b')", slug("a b"), "a-b");
eq("S2 slugOf('Über Orbit')", slug("Über Orbit"), "uber-orbit");
eq("S2 slugOf('Café')", slug("Café"), "cafe");
eq("S2 slugOf('naïve façade')", slug("naïve façade"), "naive-facade");
eq("S2 slugOf('x²')", slug("x²"), "x2");
eq("S3 slugOf('🚀 Launch')", slug("🚀 Launch"), "-launch");
eq("S3 slugOf('日本語 docs')", slug("日本語 docs"), "-docs");
eq("S3 slugOf('Ωmega')", slug("Ωmega"), "mega");
eq("S4 slugOf('🚀') is empty", slug("🚀"), "");
eq("S4 slugOf('???') is empty", slug("???"), "");

// S5: slugger() never gives an empty id, and a repeat gets a number.
{
  let id;
  try { id = lib.slugger(); } catch (e) { id = () => `threw: ${e.message}`; }
  const next = (h) => { try { return id(h); } catch (e) { return `threw: ${e.message}`; } };
  eq("S5 slugger()('🚀') is section", next("🚀"), "section");
  eq("S5 then ('🎉') is section-1", next("🎉"), "section-1");
  eq("S5 then ('Section') is section-2", next("Section"), "section-2");
  eq("S5 then ('Über') is uber", next("Über"), "uber");
  eq("S5 then ('Uber') is uber-1", next("Uber"), "uber-1");
  eq("S5 then ('Café') is cafe", next("Café"), "cafe");
}

// S6: whatever the heading, the id is what the page's checks accept (their regex, written out).
for (const h of ["Über", "日本語", "🚀", "a b", "x²", "Ωmega", "<b>Bold</b>", "R&D", "", " "]) {
  let got;
  try { got = lib.slugger()(h); } catch (e) { got = `threw: ${e.message}`; }
  check(`S6 slugger()(${JSON.stringify(h)}) matches /^[a-z0-9-]+$/`, typeof got === "string" && /^[a-z0-9-]+$/.test(got),
    `gave ${JSON.stringify(got)} (want lower-case letters, digits and dashes only)`);
}

// S7-S9: a link to a heading is made from the same id the heading gets.
const srcR = { ...src, slug: "readme" };
const linkR = (h) => { try { return resolveLink(h, srcR, bySourcePath, false); } catch (e) { return `threw: ${e.message}`; } };
eq("S7 '#über-orbit' points at uber-orbit", linkR("#über-orbit"), "#docs/readme/uber-orbit");
eq("S7 '#Quick-Start' points at quick-start", linkR("#Quick-Start"), "#docs/readme/quick-start");
eq("S7 '#-launch' keeps its dash", linkR("#-launch"), "#docs/readme/-launch");
eq("S7 '#🚀' points at the page", linkR("#🚀"), "#docs/readme");
eq("S7 '#' points at the page", linkR("#"), "#docs/readme");
{
  const map = new Map([[`${src.repo}:docs/x.md`, { repo: src.repo, path: "docs/x.md", slug: "x" }]]);
  const to = (h) => { try { return resolveLink(h, srcR, map, false); } catch (e) { return `threw: ${e.message}`; } };
  eq("S8 'docs/x.md#Über' points at uber in the other source", to("docs/x.md#Über"), "#docs/x/uber");
  eq("S8 'docs/x.md' points at the other source", to("docs/x.md"), "#docs/x");
  eq("S9 a link out keeps its anchor as written", to("OTHER.md#Über"), "https://github.com/tomlawesome/orbit/blob/main/OTHER.md#Über");
}

process.exit(failed ? 1 : 0);
