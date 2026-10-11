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
 * returns the warning text, or "" / null / undefined for no warning. Needs
 * `marked`. No network.
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

process.exit(failed ? 1 : 0);
