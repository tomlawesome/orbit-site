/*
 * Test for sanitiseHtml (tools/sanitise-html.mjs): the first-party filter the
 * docs importer runs over the HTML it takes from other repositories' READMEs.
 * Only a short list of tags and attributes survives; a tag outside the list
 * makes the whole call return "" (fail closed).
 *
 *   node tools/ci/sanitise-html-test.mjs
 *
 * No dependencies.
 */
let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};

let sanitiseHtml;
try {
  ({ sanitiseHtml } = await import("../sanitise-html.mjs"));
} catch (e) {
  check("tools/sanitise-html.mjs loads", false, `import failed: ${e.message}`);
  process.exit(1);
}
if (typeof sanitiseHtml !== "function") {
  check("tools/sanitise-html.mjs exports sanitiseHtml", false, `got ${typeof sanitiseHtml}`);
  process.exit(1);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const id = (h) => h;
const eq = (name, input, opts, want) => {
  let got;
  try { got = sanitiseHtml(input, opts); } catch (e) { got = `threw: ${e.message}`; }
  check(name, got === want, `${JSON.stringify(input)} gave ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
};

// 1. align="center" becomes the centred class; the image resolver is called once.
{
  const seen = [];
  eq("1 centred paragraph with a resolved image",
    '<p align="center"><img src="docs/orbit-mark.svg" width="52"></p>',
    { link: id, image: (h) => { seen.push(h); return "assets/img/mark.svg"; } },
    '<p class="centred"><img src="assets/img/mark.svg" alt="" width="52" loading="lazy"></p>');
  check("1 the image resolver was called once with the source", same(seen, ["docs/orbit-mark.svg"]),
    `calls: ${JSON.stringify(seen)} (want ["docs/orbit-mark.svg"])`);
}

// 2. event handlers are dropped.
eq("2 onerror is dropped from an img", '<img src=x onerror="alert(1)">',
  { link: id, image: () => "https://h/x" },
  '<img src="https://h/x" alt="" loading="lazy">');

// 3. details keeps open, drops ontoggle.
eq("3 details keeps open and drops ontoggle",
  "<details open ontoggle=alert(1)><summary>More</summary>text</details>",
  { link: id, image: id },
  "<details open><summary>More</summary>text</details>");

// 4. a javascript: link loses its href; a resolved https link gets target and rel.
eq("4 a javascript: href is dropped", "<a href='javascript:alert(1)'>go</a>",
  { link: id, image: id }, "<a>go</a>");
eq("4 a link the resolver turns into https gets target and rel", "<a href='javascript:alert(1)'>go</a>",
  { link: () => "https://github.com/x", image: id },
  '<a href="https://github.com/x" target="_blank" rel="noopener">go</a>');

// 5. an in-page link keeps its docs address and no target; the title is decoded then escaped.
{
  const seen = [];
  eq("5 an in-page link resolves to #docs/ with no target",
    '<a href="#top" title="a &amp; b">t</a>',
    { link: (h) => { seen.push(h); return "#docs/readme/top"; }, image: id },
    '<a href="#docs/readme/top" title="a &amp; b">t</a>');
  check("5 the link resolver was called with the source", same(seen, ["#top"]),
    `calls: ${JSON.stringify(seen)} (want ["#top"])`);
}

// 6. any tag outside the list empties the whole result.
const std = { link: id, image: id };
eq("6 svg with onload returns an empty string", "<p>hi</p><svg onload=alert(1)>", std, "");
eq("6 script returns an empty string", "<p>x</p><script>1</script>", std, "");
eq("6 iframe in upper case returns an empty string", "<P><IFRAME src=x></P>", std, "");
eq("6 form returns an empty string", "<form action=x><p>x</p></form>", std, "");

// 7. upper-case names, a quoted > in a value, 100% width dropped.
eq("7 upper-case tag, odd attributes, > in a value",
  '<IMG SRC="https://h/a.png" ONERROR=x STYLE="x" alt="a > b" width="100%">', std,
  '<img src="https://h/a.png" alt="a &gt; b" loading="lazy">');

// 8. a data: image is dropped, nothing else was there.
eq("8 a data: image source drops the img", '<img src="data:image/png;base64,AAAA" alt="x">', std, "");

// 9. only digits for colspan/rowspan; align becomes a class.
eq("9 td keeps a numeric colspan, drops a bad rowspan, centres",
  '<td colspan="2" rowspan="x" align="center">c</td>', std,
  '<td colspan="2" class="centred">c</td>');

// 10. a stray <, comments, self-closing br, and plain attributes dropped.
eq("10 a bare < becomes &lt;", "<p>a < b</p>", std, "<p>a &lt; b</p>");
eq("10 a comment goes and <br/> becomes <br>", "<!-- note --><br/>", std, "<br>");
eq("10 id, style and onclick are dropped", '<p id="x" style="color:red" onclick="y">t</p>', std, "<p>t</p>");

// 11. the first of a duplicated attribute wins.
eq("11 the first href wins", '<a href="https://h/" href="javascript:1">t</a>', std,
  '<a href="https://h/" target="_blank" rel="noopener">t</a>');

// 12. percentage widths other than 100% stay; the resolver result is used.
eq("12 a 92% width and a numeric height stay",
  '<img src="docs/a.png" width="92%" height="10">',
  { link: id, image: (h) => "https://raw/" + h },
  '<img src="https://raw/docs/a.png" alt="" width="92%" height="10" loading="lazy">');

// 13. the heading block from orbit-launcher's README keeps its structure, text and entities.
{
  const sep = "  &nbsp;&nbsp;\u00b7&nbsp;&nbsp;\n";
  const input =
    "<h3>\n" +
    '  <a href="https://tomlawesome.github.io/orbit-site/">Website</a>\n' + sep +
    '  <a href="https://github.com/tomlawesome/orbit-launcher/security/policy">Report a vulnerability</a>\n' + sep +
    '  <a href="https://github.com/tomlawesome/orbit-launcher/blob/main/LICENSE">Licence</a>\n' +
    "</h3>";
  const want =
    "<h3>\n" +
    '  <a href="https://tomlawesome.github.io/orbit-site/" target="_blank" rel="noopener">Website</a>\n' + sep +
    '  <a href="https://github.com/tomlawesome/orbit-launcher/security/policy" target="_blank" rel="noopener">Report a vulnerability</a>\n' + sep +
    '  <a href="https://github.com/tomlawesome/orbit-launcher/blob/main/LICENSE" target="_blank" rel="noopener">Licence</a>\n' +
    "</h3>";
  eq("13 the launcher README heading block keeps its links and text", input, std, want);
  let got;
  try { got = sanitiseHtml(input, std); } catch (e) { got = ""; }
  check("13 the result is non-empty and holds all three link texts",
    got !== "" && ["Website", "Report a vulnerability", "Licence"].every((t) => got.includes(`>${t}</a>`)),
    `result: ${JSON.stringify(got)}`);
}

// 14. headings, lists, hr, blockquote and pre are kept with no attributes.
eq("14 headings, lists, hr, blockquote and pre lose their attributes",
  '<ul class="x"><li onclick="y">a</li></ul><hr/><blockquote cite="z">q</blockquote><pre>1 &lt; 2</pre><h2 id="t">T</h2>',
  std,
  "<ul><li>a</li></ul><hr><blockquote>q</blockquote><pre>1 &lt; 2</pre><h2>T</h2>");

// 15. an allowed heading beside a tag outside the list still fails closed.
eq("15 a heading beside a video returns an empty string", "<h3>x</h3><video src=y></video>", std, "");

process.exit(failed ? 1 : 0);
