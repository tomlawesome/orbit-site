/*
 * Test for how sanitiseHtml (tools/sanitise-html.mjs) treats comments and
 * bogus comments in a source's raw html. A browser follows the WHATWG HTML
 * tokeniser (https://html.spec.whatwg.org/#tokenization, 13.2.5), and the
 * sanitised block must show the reader no text the browser hid:
 *
 *   - a comment that is never closed (`<!-- x`) runs to the end of the block
 *     and hides everything after it;
 *   - a bogus comment is `<!` not followed by `--`, `<?`, or `</` followed by
 *     a non-letter (or `>`); it runs to the next `>` and is hidden, and the
 *     text after that `>` is shown. With no `>` it runs to the end.
 *
 * The expected text below is written down from those rules, not taken from a
 * browser (tools/ci/dropped-warning-test.mjs checks against a real one). The
 * "visible text" of the sanitised output is read here by removing its tags,
 * decoding the few entities the sanitiser writes, and folding whitespace; the
 * cases use only <p> and <b>, which the sanitiser keeps.
 *
 *   node tools/ci/comment-rules-test.mjs
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

const id = (h) => h;
const shown = (html) => html
  .replace(/<[^>]*>/g, "")
  .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0*39;|&#x27;/gi, "'")
  .replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();
const shows = (name, input, want) => {
  let out;
  try { out = sanitiseHtml(input, { link: id, image: id }); } catch (e) { out = `threw: ${e.message}`; }
  const got = out.startsWith("threw:") ? out : shown(out);
  check(name, got === want, `${JSON.stringify(input)} sanitised to ${JSON.stringify(out)} shows ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
};

// ---- controls: these hold today -----------------------------------------------
shows("control: a closed comment hides only itself", "<!-- x --> y", "y");
shows("control: plain text is unchanged", "plain words here", "plain words here");
shows("control: a closed comment inside text", "a<!-- note -->b", "ab");
shows("control: markup stays (no space is added between paragraphs)", "<p>one</p><p>two</p>", "onetwo");
shows("control: a stray < is shown", "a < b", "a < b");
shows("control: a comment between paragraphs", "<p>a</p><!-- x --><p>b</p>", "ab");

// ---- the other ways a comment closes (a closed comment hides only itself) --
shows("closed: <!--> is an empty comment", "a<!-->b", "ab");
shows("closed: <!---> is an empty comment", "a<!--->b", "ab");
shows("closed: --!> closes a comment", "a<!-- x --!> b", "a b");

// ---- a comment never closed hides the rest of the block -----------------------
shows("unclosed: at the end of text", "a<!-- x", "a");
shows("unclosed: alone", "<!-- x", "");
shows("unclosed: only the opener", "a<!--", "a");
shows("unclosed: hides later markup and text", "<p>a</p><!-- x <b>y</b> z", "a");
shows("unclosed: hides the end tags and later paragraphs", "<p>a<!-- b</p><p>c</p>", "a");
shows("unclosed: --! at the end does not close it", "a<!-- x --!", "a");
shows("unclosed: a lone -- does not close it", "a<!-- x -- y", "a");
shows("unclosed: a closed one first, then an open one", "a<!-- c --> b <!-- d e", "a b");
shows("unclosed: text before it inside a tag is kept", "<b>a<!-- x</b> y", "a");

// ---- bogus comments run to the next > -----------------------------------------
shows("bogus: <!x>", "a<!x>b", "ab");
shows("bogus: <!x> keeps the text after it", "<!x>shown", "shown");
shows("bogus: <!> is empty", "a<!>b", "ab");
shows("bogus: <! with a quote and > inside (ends at the first >)", "a<!<img alt='x>y'>b", "ay'>b");
shows("bogus: <![CDATA[ ... ]]> outside foreign content", "a <![CDATA[ x ]]> b", "a b");
shows("bogus: <?php ... ?>", "a<?php x ?>b", "ab");
shows("bogus: <? with a quote and > inside", "a<?x 'y>z'>b", "az'>b");
shows("bogus: </ followed by a space", "a</ x>b", "ab");
shows("bogus: </ followed by a digit", "a</1>b", "ab");
shows("bogus: </> alone", "a</>b", "ab");
shows("bogus: </ stops at the first >", "a</ x>y>b", "ay>b");
shows("bogus: no > runs to the end (<!)", "a<!x y", "a");
shows("bogus: no > runs to the end (<?)", "a<?x y", "a");
shows("bogus: no > runs to the end (</ )", "a</ x y", "a");
shows("bogus: <! at the very end", "a<!", "a");
shows("bogus: between paragraphs", "<p>a</p><!x><p>b</p>", "ab");
shows("control: an end tag with a letter is not bogus", "<p>a</p>b", "ab");

// ---- the bogus comments <!-x> and <!-> end at the first > ----------------------
// (<!-- starts a comment; <!-x and <!-> do not, so they are bogus comments)
shows("bogus: <!-x> hides itself", "a<!-x>b", "ab");
shows("bogus: <!-x> keeps the text after it", "<!-x>shown", "shown");
shows("bogus: <!-x y> ends at the first >", "a<!-x y>b", "ab");
shows("bogus: <!-x --> is not a comment, it ends at its first >", "a<!-x --> b", "a b");
shows("bogus: <!-x<p> ends at the > of the tag", "a<!-x<p>y</p>", "ay");
shows("bogus: <!-> hides itself", "a<!->b", "ab");
shows("bogus: <!-> keeps the text after it", "<!->shown", "shown");
shows("bogus: <!-> is not the start of a comment", "a<!->b -->c", "ab -->c");
shows("bogus: <!-x> and <!-> in one block", "x<!-x>y<!->z", "xyz");
shows("bogus: <!- at the end runs to the end", "a<!-", "a");
shows("bogus: <!-x at the end runs to the end", "a<!-x", "a");
shows("bogus: <!- at the end after a paragraph", "<p>a</p><!-", "a");

// ---- a </ at the very end of the block is text --------------------------------
shows("end: a</ shows as text", "a</", "a</");
shows("end: a</ in a paragraph shows as text", "<p>a</", "a</");

// ---- removing a comment, tag or bogus comment must not join a character reference
// (the browser shows the text on the right: "&" and "lt;" are two runs, so it is a plain "&lt;")
shows("join: a comment between & and lt;", "a&<!-- x -->lt;b", "a&lt;b");
shows("join: an img between & and amp;", "AT&<img alt=1>amp;T", "AT&amp;T");
shows("join: an img between & and lt;", "a&<img alt=1>lt;b", "a&lt;b");
shows("join: a bogus comment <!x> between & and lt;", "a&<!x>lt;b", "a&lt;b");
shows("join: a bogus comment <?x> between & and lt;", "a&<?x>lt;b", "a&lt;b");
shows("join: a bogus comment </ x> between & and lt;", "a&</ x>lt;b", "a&lt;b");
shows("join: a bogus comment <!-x> between & and lt;", "a&<!-x>lt;b", "a&lt;b");
shows("join: in a paragraph", "<p>a&<!-- x -->lt;b</p>", "a&lt;b");
shows("join: two comments", "a&<!-- x --><!-- y -->lt;b", "a&lt;b");
shows("join: &# and a number", "&#<!-- x -->65;", "&#65;");
shows("join: &#x and a number", "&#x<!-- x -->41;", "&#x41;");
shows("join: &am and p;", "&am<!-- x -->p;", "&amp;");
shows("join: & and nbsp;", "&<!-- x -->nbsp;", "&nbsp;");
shows("join: a reference without ; ends at the comment", "a&amp<!-- x -->;b", "a&;b");
shows("join: &lt without ; ends at the comment", "a&lt<!-- x -->b", "a<b");

process.exit(failed ? 1 : 0);
