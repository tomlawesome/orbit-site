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
 *   - raw-text and plain-text elements (<textarea>, <xmp>, <plaintext>,
 *     <title>, <noscript>, <iframe>, <noembed>, <noframes>, CDATA in <svg> and
 *     <math>): a refused block ("") whose text the browser shows must warn;
 *   - reader rules and joined character references: the sanitised output must
 *     show the browser the same text as the input (a removed comment, tag or
 *     bogus comment must not join `&` and `lt;` into a different reference),
 *     with no warning, and the attribute syntax the reader follows is checked
 *     against the attributes the browser itself parses;
 *   - fuzz (fixed seed): for random fragment mixes the output must show no text
 *     the browser hid, and any text it shows less of must be warned of.
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

let sanitiseHtml, droppedBlockWarning, visibleText, playwright;
try {
  ({ sanitiseHtml } = await import("../sanitise-html.mjs"));
  ({ droppedBlockWarning, visibleText } = await import("../import-docs-lib.mjs"));
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
  "<p>a</p><!-- x --><font>f</font>", "<p>a</p><!-- x --!><font>f</font>"]) {
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

// ---- raw-text and plain-text elements: a refused block that showed text warns --
// The sanitiser refuses these elements (output ""). The browser's text for the
// input is the reference: when it shows words, the importer must say they went.
// The text is read from a fragment parsed into a <div> (as the docs page does),
// because a whole-document parse moves a leading <title> into <head>.
{
  const visible = (html) => page.evaluate(
    (h) => { const d = document.createElement("div"); d.innerHTML = h; return d.textContent.replace(/\s+/g, " ").trim(); }, html);
  const rawBlocks = [
    "<textarea>some words</textarea>", "<textarea><!-- config --></textarea>", "<TEXTAREA>some words</TEXTAREA>",
    "<textarea>unclosed words", "<p>keep</p><textarea>some words</textarea>",
    "<xmp>some <b>words</b> here</xmp>", "<plaintext>some words here", "<title>some words</title>",
    "<noscript>some words</noscript>", "<iframe>some words</iframe>", "<noembed>some words</noembed>",
    "<noframes>some words</noframes>", "<svg><![CDATA[some words]]></svg>", "<math><![CDATA[some words]]></math>",
    // a body that looks like markup is still raw text (or plain text), so each rule is pinned on its own
    "<xmp><b>x</b></xmp>", "<noscript><b>x</b></noscript>", "<plaintext><b>x", "<title><b>x</b></title>", "<iframe><b>x</b></iframe>",
    // the first </textareax> is not the end tag: the element runs to the real </textarea>
    "<textarea>a</textareax>b</textarea>c",
  ];
  for (const input of rawBlocks) {
    const output = sanitise(input);
    const a = await visible(input);
    const w = warning(input, output);
    check(`raw text: the browser shows text for ${JSON.stringify(input)}`, a !== "", `browser shows ${JSON.stringify(a)} (want some text: a mistake in the test)`);
    check(`raw text: refused, output is empty: ${JSON.stringify(input)}`, output === "", `sanitised to ${JSON.stringify(output)} (want "")`);
    check(`raw text: lost text warns: ${JSON.stringify(input)}`, w !== "" && !w.startsWith("threw:"),
      `browser shows ${JSON.stringify(a)}, output ${JSON.stringify(output)}; warning ${JSON.stringify(w)} (want a warning)`);
  }
  // script and style text is not shown; the block is still refused (a warning is not required)
  for (const input of ["<script>alert(1)</script>", "<style>p { color: red }</style>"]) {
    const output = sanitise(input);
    check(`raw text: ${JSON.stringify(input)} still outputs ""`, output === "", `sanitised to ${JSON.stringify(output)} (want "")`);
  }
}

// ---- joined character references and the reader's rules, against the browser --
// [input, what the browser shows]. The browser is asked for the text of the
// input (a guard against a wrong table), and the sanitised output must show
// the same text, with no warning. Removing a comment, tag or bogus comment
// must not join two text runs into a different character reference.
const readerRules = [
  // character references split by something the browser does not show
  ["a&<!-- x -->lt;b", "a&lt;b"], ["AT&<img alt=1>amp;T", "AT&amp;T"], ["a&<img alt=1>lt;b", "a&lt;b"],
  ["a&<!x>lt;b", "a&lt;b"], ["a&<?x>lt;b", "a&lt;b"], ["a&</ x>lt;b", "a&lt;b"], ["a&<!-x>lt;b", "a&lt;b"],
  ["<p>a&<!-- x -->lt;b</p>", "a&lt;b"], ["a&<!-- x --><!-- y -->lt;b", "a&lt;b"],
  ["&#<!-- x -->65;", "&#65;"], ["&#x<!-- x -->41;", "&#x41;"], ["&am<!-- x -->p;", "&amp;"], ["&<!-- x -->nbsp;", "&nbsp;"],
  ["a&amp<!-- x -->;b", "a&;b"], ["a&lt<!-- x -->b", "a<b"],
  // bogus comments <!-x> and <!->, to the first >
  ["a<!-x>b", "ab"], ["<!-x>shown", "shown"], ["a<!-x y>b", "ab"], ["a<!-x --> b", "a b"], ["a<!-x<p>y</p>", "ay"],
  ["a<!->b", "ab"], ["<!->shown", "shown"], ["a<!->b -->c", "ab -->c"], ["x<!-x>y<!->z", "xyz"],
  ["a<!-", "a"], ["a<!-x", "a"], ["<p>a</p><!-", "a"],
  // a legacy named reference (no ; needed) cut off at the end of a run by a comment: the browser decodes the
  // longest legacy prefix there (&not is the legacy prefix of &notin, so it shows the not sign then "in")
  ["a&nbsp<!-- -->x", "a x"], ["a&copy<!-- -->x", "a\u00a9x"], ["a&Aacute<!-- -->x", "a\u00c1x"], ["a&notin<!-- -->x", "a\u00acinx"],
  // a lone </ at the end of the block is text
  ["a</", "a</"], ["<p>a</", "a</"],
];
{
  const fold = (t) => t.replace(/\s+/g, " ").trim();
  for (const [input, want] of readerRules) {
    const output = sanitise(input);
    const [a, b] = [await visible(input), await visible(output)];
    check(`reader rules: reference, the browser shows ${JSON.stringify(want)} for ${JSON.stringify(input)}`, a === want, `browser shows ${JSON.stringify(a)} (a mistake in the test)`);
    check(`reader rules: the output shows the browser's text: ${JSON.stringify(input)}`, b === a,
      `sanitised to ${JSON.stringify(output)}; browser shows ${JSON.stringify(b)} for it, ${JSON.stringify(a)} for the input`);
    if (b === a) {
      const w = warning(input, output);
      check(`reader rules: no lost-text warning: ${JSON.stringify(input)}`, w === "", `warning ${JSON.stringify(w)} (want none)`);
    }
  }
  // the hand-written pairs for the two headline inputs
  for (const [label, inn, out] of [
    ["a comment between & and lt;", "a&<!-- x -->lt;b", "a&amp;lt;b"],
    ["an img between & and amp;", "AT&<img alt=1>amp;T", "AT&amp;amp;T"],
    ["a bogus comment between & and lt;", "a&<!x>lt;b", "a&amp;lt;b"],
  ]) {
    const [a, b] = [await visible(inn), await visible(out)];
    const w = warning(inn, out);
    check(`joined reference, fixed pair, ${label}: reference agrees`, a === b, `browser shows ${JSON.stringify(a)} in and ${JSON.stringify(b)} out (a mistake in the test)`);
    check(`joined reference, fixed pair, ${label}: no warning`, w === "", `${JSON.stringify(inn)} to ${JSON.stringify(out)} gave ${JSON.stringify(w)} (want none)`);
  }
  // visibleText reads the input the way the browser does
  if (typeof visibleText !== "function") check("import-docs-lib exports visibleText", false, `got ${typeof visibleText}`);
  else for (const [input, want] of readerRules.slice(0, 15)) {
    let got;
    try { got = fold(String(visibleText(input))); } catch (e) { got = `threw: ${e.message}`; }
    check(`visibleText: ${JSON.stringify(input)}`, got === want, `read as ${JSON.stringify(got)} (want ${JSON.stringify(want)}, what the browser shows)`);
  }
}

// ---- attribute syntax: what the browser parses is what the reader keeps -------
// The browser says what each tag's href and title are; the sanitised output
// must carry the same two values (the link resolver is the identity).
{
  const attrsOf = (html) => page.evaluate((h) => {
    const a = new DOMParser().parseFromString(h, "text/html").body.querySelector("a");
    return a ? { href: a.getAttribute("href"), title: a.getAttribute("title") } : null;
  }, html);
  const U = "https://h/u";
  const cases = [
    ["/ between attributes separates them", `<a/href="${U}"/title="t">x</a>`],
    ["an unquoted value keeps /", "<a href=https://h/a/b title=t>x</a>"],
    ["an unquoted value keeps a trailing /", "<a href=https://h/a/ title=t>x</a>"],
    ["an unquoted value stops at whitespace", `<a href=${U}  title=t>x</a>`],
    ["spaces around =", `<a href = "${U}" title = 't'>x</a>`],
    ["an attribute name may start with =", `<a =x href="${U}" title="t">x</a>`],
    ["a name made of = and a quoted word", `<a ="y" href="${U}" title="t">x</a>`],
  ];
  for (const [label, input] of cases) {
    const output = sanitise(input);
    const [want, got] = [await attrsOf(input), await attrsOf(output)];
    check(`attributes, ${label}: reference`, want && want.href && want.title, `browser reads ${JSON.stringify(want)} (want an href and a title: a mistake in the test)`);
    check(`attributes, ${label}: the output keeps href and title`,
      !!got && !!want && got.href === want.href && got.title === want.title,
      `${JSON.stringify(input)} sanitised to ${JSON.stringify(output)}; browser reads ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
  }
  // a tag name with : is not <a>
  const colon = await page.evaluate(() => new DOMParser().parseFromString("<a:b>x</a:b>", "text/html").body.firstChild.localName);
  check("attributes, <a:b>: reference, the browser's tag is not a", colon === "a:b", `browser reads the tag name ${JSON.stringify(colon)} (want "a:b")`);
}

// ---- character references: a fuzz of small pieces ---------------------------
// Pieces that make or break character references, comments, bogus comments and
// a dropped <img>. None of them shows text of its own that the sanitiser may
// drop, so the output must show the browser exactly the text the input showed.
{
  let seed = 20261014;
  const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pieces = ["&", "&", "lt;", "amp;", "#", "x", "65;", "41;", "nbsp;", "a", ";", "<!-- x -->", "<!x>", "<!-x>", "<?x>", "</ x>", "<img alt=1>", "-"];
  const N = 3000;
  const inputs = Array.from({ length: N }, () => Array.from({ length: 2 + Math.floor(rand() * 5) }, () => pieces[Math.floor(rand() * pieces.length)]).join(""));
  const outputs = inputs.map(sanitise);
  const batch = (list) => page.evaluate(
    (hs) => hs.map((h) => new DOMParser().parseFromString(h, "text/html").body.textContent.replace(/\s+/g, " ").trim()), list);
  const [ins, outs] = [await batch(inputs), await batch(outputs)];
  const differ = [], falseWarn = [];
  inputs.forEach((input, i) => {
    const example = { input, output: outputs[i], a: ins[i], b: outs[i] };
    if (ins[i] !== outs[i]) { differ.push(example); return; }
    const w = warning(input, outputs[i]);
    if (w !== "") falseWarn.push({ ...example, w });
  });
  const show = (list) => list.slice(0, 5).map((e) => `\n      ${JSON.stringify(e.input)} -> ${JSON.stringify(e.output)}: browser shows ${JSON.stringify(e.a)} in, ${JSON.stringify(e.b)} out${e.w ? `; warning ${JSON.stringify(e.w)}` : ""}`).join("");
  check("fuzz B: the blocks are not vacuous", ins.filter((t) => t !== "").length > N / 2, `${ins.filter((t) => t !== "").length} of ${N} blocks show text (want over ${N / 2})`);
  check("fuzz B: the output shows the same text as the input", differ.length === 0, `${differ.length} of ${N} blocks differ${show(differ)}`);
  check("fuzz B: no false lost-text warning", falseWarn.length === 0, `${falseWarn.length} of ${N} blocks warned with the same text${show(falseWarn)}`);
}

// ---- the missed-warning direction: a fuzz of fragment mixes -----------------
// Each block is a random mix of fragments built around comments, bogus
// comments and quotes. Against the browser's text for the input and for the
// sanitised output, a block fails when
//   (extra) the output shows words the browser hid for the input, or
//   (silent) the output shows fewer words than the browser showed for the
//            input and droppedBlockWarning returned "".
// The seed is fixed, so the same blocks run every time.
{
  let seed = 20261013;
  const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const frags = ["<!--", "-->", "--!>", "<!", "<?", "</", "</ ", "</1", "<!>", "<img alt='x>y'>", "<img alt=\"p>q\">", ">", "<", "'", "\"", "=",
    "alpha", "beta", "gamma", "delta", "x", "y", " ", "<b>", "</b>", "<pre>", "</pre>", "<p>", "</p>", "<font>", "</font>", "<![CDATA[", "]]>", "?>",
    "-", "&", "lt;", "amp;", "<!-x>", "<textarea>", "</textarea>"];
  const N = 4000;
  const inputs = Array.from({ length: N }, () => Array.from({ length: 1 + Math.floor(rand() * 8) }, () => frags[Math.floor(rand() * frags.length)]).join(""));
  const outputs = inputs.map(sanitise);
  const batch = (list) => page.evaluate(
    (hs) => hs.map((h) => new DOMParser().parseFromString(h, "text/html").body.textContent.replace(/\s+/g, " ").trim()), list);
  const [ins, outs] = [await batch(inputs), await batch(outputs)];
  const extra = [], silent = [], threw = [];
  let withText = 0, lossy = 0;
  inputs.forEach((input, i) => {
    const [a, b, output] = [ins[i], outs[i], outputs[i]];
    if (a !== "") withText++;
    const w = warning(input, output);
    const example = { input, output, browserIn: a, browserOut: b, warning: w };
    if (output.startsWith("threw:") || w.startsWith("threw:")) { threw.push(example); return; }
    if (lostWords(b, a).length > 0) extra.push(example);
    if (lostWords(a, b).length > 0) { lossy++; if (w === "") silent.push(example); }
  });
  const show = (list) => list.slice(0, 5).map((e) => `\n      ${JSON.stringify(e.input)} -> ${JSON.stringify(e.output)}: browser shows ${JSON.stringify(e.browserIn)} in, ${JSON.stringify(e.browserOut)} out; warning ${JSON.stringify(e.warning)}`).join("");
  check("fuzz: the blocks are not vacuous", withText > N / 2 && lossy > 0, `${withText} of ${N} blocks show text in the browser; ${lossy} lose words in the output (want over ${N / 2} and at least 1)`);
  check("fuzz: nothing throws", threw.length === 0, `${threw.length} of ${N} threw${show(threw)}`);
  check("fuzz: the output never shows text the browser hid", extra.length === 0, `${extra.length} of ${N} blocks fail${show(extra)}`);
  check("fuzz: every loss of text is warned of", silent.length === 0, `${silent.length} of ${N} blocks lost words with no warning${show(silent)}`);
}

await browser.close();
process.exit(failed ? 1 : 0);
