/*
 * Test for the "raw html lost text" warning of the docs importer: the import
 * sanitises each raw html block of a source markdown file (tools/sanitise-html.mjs)
 * and droppedBlockWarning(src, htmlIn, htmlOut) (tools/import-docs-lib.mjs) says
 * so when the sanitised block no longer shows words the source block showed.
 *
 * Required: the warning appears only when the visible text really differs.
 * "Visible text" is what a browser shows, so a real browser's parse is the
 * reference: body.textContent of DOMParser's text/html parse, with whitespace
 * folded to single spaces and trimmed. Two kinds of case:
 *
 *   - no false warning: for every block below the input is sanitised the way
 *     sanitise-html-test.mjs calls it, and when the browser shows the same text
 *     for the input and the output, droppedBlockWarning must return "" (the
 *     implication is the check; a block whose text differs is not judged here).
 *     Each input with a wrong verdict is printed. The "fixed pairs" do the same
 *     with a hand-written output, so they stay meaningful if the sanitiser's
 *     own output for a block changes.
 *   - controls: blocks whose output really loses text must warn.
 *
 *   PLAYWRIGHT_ROOT=<playwright package dir> node tools/ci/dropped-warning-test.mjs
 *
 * Needs Playwright with Chromium (no network). No other dependency.
 */
import { createRequire } from "node:module";

let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};

let sanitiseHtml, droppedBlockWarning, playwright;
try {
  ({ sanitiseHtml } = await import("../sanitise-html.mjs"));
  ({ droppedBlockWarning } = await import("../import-docs-lib.mjs"));
  playwright = createRequire(import.meta.url)(process.env.PLAYWRIGHT_ROOT || "playwright");
} catch (e) {
  check("the sanitiser, the import lib and playwright load", false, `import failed: ${e.message}`);
  process.exit(1);
}
if (typeof sanitiseHtml !== "function" || typeof droppedBlockWarning !== "function") {
  check("sanitiseHtml and droppedBlockWarning are exported", false, `got ${typeof sanitiseHtml} and ${typeof droppedBlockWarning}`);
  process.exit(1);
}

const src = { repo: "tomlawesome/orbit", path: "README.md" };
const id = (h) => h;
const std = { link: id, image: id };
const sanitise = (h) => { try { return sanitiseHtml(h, std); } catch (e) { return `threw: ${e.message}`; } };
const warning = (inn, out) => { try { return String(droppedBlockWarning(src, inn, out) || ""); } catch (e) { return `threw: ${e.message}`; } };

let browser;
try {
  browser = await playwright.chromium.launch();
} catch (e) {
  check("chromium launches", false, e.message.split("\n")[0]);
  process.exit(1);
}
const page = await browser.newPage();
const visible = (html) => page.evaluate(
  (h) => new DOMParser().parseFromString(h, "text/html").body.textContent.replace(/\s+/g, " ").trim(), html);
// the words of `a` the browser shows that `b` no longer shows
const words = (t) => t.split(" ").filter(Boolean);
const lostWords = (a, b) => { const left = words(b); return words(a).filter((w) => { const i = left.indexOf(w); if (i < 0) return true; left.splice(i, 1); return false; }); };

// ---- no false warning, through the sanitiser ---------------------------------
const blocks = {
  "A1 entities": [
    "<p>a&nbsp;b</p>", "<p>a&#160;b</p>", "<p>a&#xA0;b</p>", "<p>a&nbsp;&nbsp;b</p>", "<p>&nbsp;</p>",
    "<p>&amp;lt;b&amp;gt;</p>", "<p>&#x26;amp;</p>", "<p>1 &lt; 2 &amp;&amp; 3 &gt; 2</p>", "<p>&lt;script&gt;</p>",
    "<p>a&ampb</p>", "<p>a&nbspb</p>", "<p>a&lt b</p>", "<p>x&AMP;y</p>", "<p>a&NBSP;b</p>", "<p>&notit; &copy2</p>",
    "<p>x&#0;y</p>", "<p>x&#x0;y</p>", "<p>x&#99999999;y</p>", "<p>x&#x110000;y</p>", "<p>x&#xD800;y</p>", "<p>x&#128;y</p>",
    "<p>&#65;&#x42;&#X43;</p>", "<p>&#65 &#;x &#x;x a&</p>", "<p>x &unknown; y</p>", "<p>caf&eacute; &copy; &hellip;</p>",
  ],
  "A2 a < that opens no tag": [
    "<p>a < b</p>", "<p><3 you</p>", "<p>a <- b</p>", "<p>a <3</p>", "<p>a<</p>", "<p>a <</p>", "<p><</p>",
    "<p>1<2>3</p>", "<p>x</p><",
  ],
  "A3 unusual tag names and end tags": [
    "<p>a</ b>c</p>", "<p>a</ p>c</p>", "<p>a<?php x ?>b</p>", "<p>a <![CDATA[ x ]]> b</p>",
    "<a1>x</a1>", "<x-y>text</x-y>", "<P>UP</P>", "<p>a <b</p>",
  ],
  "A4 attributes holding > or entities": [
    '<a href="x" title="a > b">t</a>', '<a title="&gt; &amp;">t</a>', '<p title="<b>hi</b>">shown</p>',
    "<a title='>' href=y>z</a>", '<p title="&quot;q&quot;">shown</p>', "<p align=\"x\" onclick=\"y\">alpha</p>",
    "<img alt='x>y' src=z>",
  ],
  "A5 comments": [
    "<p>a<!-- hidden words -->b</p>", "<!-- c --><p>a</p>", "<!---->", "<!-- a > b -->", "<!-- <p>x</p> -->",
    "<!-- <font>f</font> -->", "<b>kept</b><!-- <font>f</font> -->", "<p>a<!-->b</p>",
    // an unterminated comment: the browser shows nothing of it, and the sanitiser drops the tag inside it
    "<!-- x<font>f</font>", "<!-- x<a1>x</a1>", "<!-- x <font>f</font> --!>", "<!-- a --><!-- <font>f</font>",
    "<p>a</p><!-- x<font>f</font>",
  ],
};
let judged = 0;
const verdicts = [];
for (const [group, list] of Object.entries(blocks)) {
  for (const input of list) {
    const output = sanitise(input);
    const [a, b] = [await visible(input), await visible(output)];
    const w = warning(input, output);
    const same = a === b;
    if (same) judged++;
    verdicts.push({ group, input, output, a, b, w, same });
    if (!same) continue;
    check(`${group}: same visible text, no warning: ${JSON.stringify(input)}`, w === "",
      `browser shows ${JSON.stringify(a)} in and out (sanitised to ${JSON.stringify(output)}); warning ${JSON.stringify(w)} (want none)`);
  }
}
{
  const wrong = verdicts.filter((v) => v.same && v.w !== "");
  check("A the inputs with a false warning (all groups)", wrong.length === 0,
    wrong.length ? `${wrong.length} wrong: ${wrong.map((v) => JSON.stringify(v.input)).join(" ")}` : "none");
  // the plain entity cases keep this check from passing by judging nothing
  check("A the entity and stray < groups were judged (not vacuous)", judged >= 30, `${judged} blocks had the same browser text in and out (want at least 30)`);
}

// ---- no false warning, fixed pairs ------------------------------------------
// A hand-written input and output the browser shows the same text for.
const pairs = [
  ["an unterminated comment holding a tag, output empty", "<!-- x<font>f</font>", ""],
  ["an unterminated comment holding an unknown tag, output empty", "<!-- x<a1>x</a1>", ""],
  ["an unterminated comment closed by --!>, output empty", "<!-- x <font>f</font> --!>", ""],
  ["a closed comment then an unterminated one, output empty", "<!-- a --><!-- <font>f</font>", ""],
  ["a no-break space entity kept", "<p>a&nbsp;b</p>", "<p>a&nbsp;b</p>"],
  ["a numeric entity written as a character", "<p>a&#160;b</p>", "<p>a b</p>"],
  ["an entity without a semicolon kept", "<p>a&ampb</p>", "<p>a&ampb</p>"],
  ["an upper-case entity kept", "<p>x&AMP;y</p>", "<p>x&AMP;y</p>"],
  ["a stray < escaped", "<p>a < b</p>", "<p>a &lt; b</p>"],
  ["a closed comment dropped", "<p>a<!-- note -->b</p>", "<p>ab</p>"],
];
for (const [label, inn, out] of pairs) {
  const [a, b] = [await visible(inn), await visible(out)];
  const w = warning(inn, out);
  check(`A fixed pair, ${label}: reference agrees`, a === b, `browser shows ${JSON.stringify(a)} in and ${JSON.stringify(b)} out (want the same: a mistake in the test)`);
  check(`A fixed pair, ${label}: no warning`, w === "", `${JSON.stringify(inn)} to ${JSON.stringify(out)} gave ${JSON.stringify(w)} (want none)`);
}

// ---- controls: a real loss warns ---------------------------------------------
// Blocks where the sanitiser drops an element holding text (found by comparing the browser's text in and out).
for (const input of ["<p>a <font>b</font></p>", "<center>mid</center>", "<p>a</p><section>sec</section>", "<a1>x</a1>", "<x-y>text</x-y>",
  "<p>a</p><!-- x<font>f</font>"]) {
  const output = sanitise(input);
  const [a, b] = [await visible(input), await visible(output)];
  const lost = lostWords(a, b);
  const w = warning(input, output);
  check(`control: lost words warn: ${JSON.stringify(input)}`, lost.length > 0 && w !== "" && !w.startsWith("threw:"),
    `browser shows ${JSON.stringify(a)} in, ${JSON.stringify(b)} out (lost ${JSON.stringify(lost)}); warning ${JSON.stringify(w)} (want a warning)`);
}
{
  const [inn, out] = ["<p>alpha</p><p>beta</p>", "<p>alpha</p>"];
  const w = warning(inn, out);
  check("control: a hand-written partial drop warns", w !== "" && !w.startsWith("threw:"), `gave ${JSON.stringify(w)} (want a warning)`);
}

await browser.close();
process.exit(failed ? 1 : 0);
