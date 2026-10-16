/*
 * Raw html in a source is kept only as an allow-list of tags and attributes,
 * every link and picture resolved and its scheme checked: the markdown's own
 * escaping does not cover it, and a page is set with innerHTML.
 *
 *   sanitiseHtml(text, { link, image, warn })
 *
 * `link(href)` and `image(src)` are the caller's resolvers: the source's
 * value, entity-decoded, in; the address to write out. A tag outside the list
 * makes the whole call return "". `warn(message)` is optional: it hears of a
 * pre or details left open, which is closed at the end. Time is linear in the
 * length of the text, whatever is crafted into it.
 *
 * What is guaranteed about text: the source is read as a browser's tokeniser
 * reads it (htmlTokens, below) and the output is rebuilt from that reading.
 * Text the browser hid (in a tag, a comment or a bogus comment) is not
 * written. Each run of text it showed is written as the source had it, except
 * that every "<" is written "&lt;" and the run's end is sealed (sealRun), so
 * removing a comment or tag between two runs cannot join them into another
 * character reference. Text inside textarea, title, xmp, plaintext, noscript,
 * iframe, noembed, noframes, script or style, or CDATA in svg or math, is
 * never written: those tags are off the list, so the block is "". The output
 * therefore shows either nothing or, run for run, the text the source showed.
 * The tree builder is not followed: it may move text (out of a table, say),
 * but it reads the source's own tags in both.
 */

/* each allowed tag and, in the order they are written, its attributes */
const ALLOWED = {
  p: ["class"], div: ["class"],
  td: ["colspan", "rowspan", "class"], th: ["colspan", "rowspan", "class"],
  img: ["src", "alt", "title", "width", "height", "loading"],
  a: ["href", "title", "target", "rel"],
  details: ["open"],
  ...Object.fromEntries("br hr strong em b i code kbd sub sup summary span table thead tbody tr h1 h2 h3 h4 h5 h6 ul ol li blockquote pre".split(" ").map((t) => [t, []])),
};

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);?/gi, (m, e) => {
  if (e[0] !== "#") return NAMED[e.toLowerCase()];
  const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "\ufffd";
});
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/* ---- character references in text --------------------------------------------
   The references a browser reads in text without a ";": the HTML spec's fixed
   list of 106 (https://html.spec.whatwg.org/#named-character-references), each
   also a reference with ";" for the same character. The Latin-1 names are in
   code point order from U+00A0. */
const LEGACY = new Map([
  ...[["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", '"']].flatMap(([k, c]) => [[k, c], [k.toUpperCase(), c]]),
  ["COPY", "\u00a9"], ["REG", "\u00ae"],
  ...("nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute " +
    "micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig " +
    "Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash " +
    "Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc " +
    "euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml " +
    "yacute thorn yuml").split(" ").map((k, i) => [k, String.fromCodePoint(0xa0 + i)]),
]);
/* the longest name on that list that s starts with, or "" */
const legacyPrefix = (s) => {
  for (let n = Math.min(s.length, 6); n > 1; n--) if (LEGACY.has(s.slice(0, n))) return s.slice(0, n);
  return "";
};

/* an "&" at the end of a run of text, with what follows it there: the
   reference it starts could go on into whatever comes next */
const OPEN_END = /&(#[xX][0-9A-Fa-f]*|#[0-9]*|[0-9A-Za-z]*)$/;

/* a run of text written out so that nothing after it can change what it shows.
   In the source a run ends at a "<" or the end of the block, and a reference
   ends there too; once a comment or tag between two runs is removed, the next
   run could carry it on ("&" and "lt;" make "&lt;"). So a reference open at
   the end is closed with ";" ("&#65" is "&#65;", "&notx" is "&not;x", the same
   characters), and an "&" that starts none is written "&amp;". */
export function sealRun(run) {
  const m = OPEN_END.exec(run);
  if (!m) return run;
  const ref = m[1], head = run.slice(0, m.index);
  if (/^#([xX][0-9A-Fa-f]+|[0-9]+)$/.test(ref)) return `${head}&${ref};`;
  const name = ref[0] === "#" ? "" : legacyPrefix(ref);
  return name ? `${head}&${name};${ref.slice(name.length)}` : `${head}&amp;${ref}`;
}

/* what a browser shows for one run of text read as markup (between two "<"s,
   or inside a textarea or title), its character references read: numeric
   ones, the 106 above with or without ";", and "&apos;". Any other named
   reference is left as written; for a run and its sealed form that gives the
   same text, which is what the lost-text warning compares. */
const REF = /&(?:#([xX][0-9A-Fa-f]+|[0-9]+);?|([0-9A-Za-z]+)(;?))/g;
/* U+0080 to U+009F as a numeric reference: the windows-1252 character, where it has one */
const C1 = "\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f" +
  "\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178";
export function readText(run) {
  return run.replace(REF, (m, num, name, semi) => {
    if (num !== undefined) {
      const n = num[0] === "x" || num[0] === "X" ? parseInt(num.slice(1), 16) : parseInt(num, 10);
      if (n >= 0x80 && n <= 0x9f) return C1[n - 0x80];
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "\ufffd";
    }
    if (semi && (LEGACY.has(name) || name === "apos")) return LEGACY.get(name) ?? "'";
    const k = legacyPrefix(name);
    return k ? LEGACY.get(k) + name.slice(k.length) + semi : m;
  });
}

/* one opening tag written out, or "" when it is dropped */
function open(name, at, { link, image }) {
  const out = new Map();
  if (at.get("align")?.trim().toLowerCase() === "center" && ALLOWED[name].includes("class")) out.set("class", "centred");
  for (const k of ["colspan", "rowspan"]) if (/^\d+$/.test(at.get(k) ?? "") && ALLOWED[name].includes(k)) out.set(k, at.get(k));
  if (name === "img") {
    if (!at.has("src")) return "";
    const to = image(at.get("src"));
    if (typeof to !== "string" || !/^(https:\/\/|assets\/)/.test(to)) return "";
    out.set("src", to).set("alt", at.get("alt") ?? "");
    if (at.has("title")) out.set("title", at.get("title"));
    for (const k of ["width", "height"]) if (/^\d+%?$/.test(at.get(k) ?? "") && at.get(k) !== "100%") out.set(k, at.get(k));
    out.set("loading", "lazy");
  }
  if (name === "a") {
    const to = at.has("href") ? link(at.get("href")) : null;
    if (typeof to === "string" && /^(https:\/\/|http:\/\/|#docs\/|mailto:)/.test(to)) {
      out.set("href", to);
      if (to.startsWith("http")) out.set("target", "_blank").set("rel", "noopener");
    }
    if (at.has("title")) out.set("title", at.get("title"));
  }
  if (name === "details" && at.has("open")) out.set("open", null);
  return `<${name}${ALLOWED[name].filter((k) => out.has(k)).map((k) => out.get(k) === null ? ` ${k}` : ` ${k}="${esc(out.get(k))}"`).join("")}>`;
}

/* ---- reading html as a browser does ----------------------------------------
   The WHATWG HTML tokeniser (https://html.spec.whatwg.org/#tokenization,
   13.2.5), as far as text and tags go, in one left-to-right pass with no
   backtracking. After a "<":
     - a letter, or "/" and a letter: a tag, ending at the first ">" outside a
       quoted attribute value; one cut off by the end of the text is dropped,
       and so is everything after it;
     - "!--": a comment. "<!-->" and "<!--->" are empty ones; otherwise it ends
       at the first "-->" or "--!>", and one never closed hides the rest;
     - "!" (a bogus comment, a doctype, CDATA outside svg and math), "?", or
       "/" and anything else: hidden up to the next ">", or to the end ("</>"
       is hidden whole);
     - anything else, or the end of the text: the "<" is text.
   After the start tag of an element whose inside is not read as markup, that
   inside is text up to its end tag ("</" and the name, then a space, "/" or
   ">"), or to the end: textarea and title (references read), xmp, iframe,
   noembed, noframes and noscript (as written), plaintext (the rest of the
   text), script and style (not shown). Inside svg or math, "<![CDATA[" starts
   text up to "]]>". None of these tags is on the sanitiser's list; the lost-
   text warning reads their text. Where the reader is unsure (these tags inside
   svg or math, which the browser may read as markup), it takes the inside as
   text: the warning may then speak of text the browser hid, never miss text
   it showed. */
const WS = new Set(["\t", "\n", "\f", "\r", " "]);
const isLetter = (c) => c !== undefined && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z"));
const lower = (s) => s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
const COMMENT_END = /--!?>/g;
const RCDATA = new Set(["textarea", "title"]), RAWTEXT = new Set(["xmp", "iframe", "noembed", "noframes", "noscript"]);
const UNSHOWN = new Set(["script", "style"]);
const ENDS = new Map([...RCDATA, ...RAWTEXT, ...UNSHOWN].map((t) => [t, new RegExp(`</${t}[\\t\\n\\f\\r />]`, "gi")]));

/* where the comment whose "<!--" ends just before p ends */
function commentEnd(s, p) {
  if (s[p] === ">") return p + 1;
  if (s[p] === "-" && s[p + 1] === ">") return p + 2;
  COMMENT_END.lastIndex = p;
  const m = COMMENT_END.exec(s);
  return m ? m.index + m[0].length : s.length;
}

/* the tag at s[lt]: { end, closing, name, at } with names lower-cased and the
   first of each attribute's value as written, or null when the text ends first */
function readTag(s, lt) {
  const n = s.length;
  let p = lt + 1;
  const closing = s[p] === "/";
  if (closing) p++;
  const n0 = p;
  while (p < n && !WS.has(s[p]) && s[p] !== "/" && s[p] !== ">") p++;
  const name = lower(s.slice(n0, p));
  const at = new Map();
  for (;;) {
    while (p < n && WS.has(s[p])) p++;
    if (p >= n) return null;
    if (s[p] === ">") return { end: p + 1, closing, name, at };
    if (s[p] === "/") { p++; continue; }
    const a0 = p++; /* a name may start with "=" */
    while (p < n && !WS.has(s[p]) && s[p] !== "/" && s[p] !== ">" && s[p] !== "=") p++;
    const key = lower(s.slice(a0, p));
    let value = "";
    while (p < n && WS.has(s[p])) p++;
    if (s[p] === "=") {
      p++;
      while (p < n && WS.has(s[p])) p++;
      const q = s[p];
      if (q === '"' || q === "'") {
        const close = s.indexOf(q, p + 1);
        if (close < 0) return null;
        value = s.slice(p + 1, close);
        p = close + 1;
      } else if (q !== ">") {
        const v0 = p;
        while (p < n && !WS.has(s[p]) && s[p] !== ">") p++;
        value = s.slice(v0, p);
      }
    }
    if (!at.has(key)) at.set(key, value);
  }
}

/* the text and tags of some html, in order: a run of text as written (no
   character reference read; a "<" that is text comes alone), a tag from
   readTag, or { text, refs }: the inside of an element not read as markup, or
   CDATA (refs: the browser reads its character references). Comments, bogus
   comments and a cut-off tag are left out. */
export function* htmlTokens(s) {
  const n = s.length;
  let i = 0, svg = 0, math = 0;
  while (i < n) {
    const lt = s.indexOf("<", i);
    if (lt < 0) { yield s.slice(i); return; }
    if (lt > i) yield s.slice(i, lt);
    const c = s[lt + 1], d = s[lt + 2];
    if (isLetter(c) || (c === "/" && isLetter(d))) {
      const tag = readTag(s, lt);
      if (!tag) return;
      yield tag;
      i = tag.end;
      const { name } = tag;
      if (tag.closing) {
        if (name === "svg" && svg) svg--;
        if (name === "math" && math) math--;
      } else if (name === "svg") svg++;
      else if (name === "math") math++;
      else if (name === "plaintext") { if (i < n) yield { text: s.slice(i), refs: false }; return; }
      else if (ENDS.has(name)) {
        const end = ENDS.get(name);
        end.lastIndex = i;
        const e = end.exec(s)?.index ?? n;
        if (e > i && (!UNSHOWN.has(name) || svg || math)) yield { text: s.slice(i, e), refs: RCDATA.has(name) };
        i = e;
      }
    } else if (c === "!" && (svg || math) && s.startsWith("[CDATA[", lt + 2)) {
      const e = s.indexOf("]]>", lt + 9);
      if ((e < 0 ? n : e) > lt + 9) yield { text: s.slice(lt + 9, e < 0 ? n : e), refs: false };
      i = e < 0 ? n : e + 3;
    } else if (c === "!" && d === "-" && s[lt + 3] === "-") {
      i = commentEnd(s, lt + 4);
    } else if (c === "!" || c === "?" || (c === "/" && d !== undefined)) {
      const gt = s.indexOf(">", lt + 2);
      i = gt < 0 ? n : gt + 1;
    } else {
      yield "<";
      i = lt + 1;
    }
  }
}

export function sanitiseHtml(text, resolvers) {
  const warn = resolvers.warn ?? (() => {});
  let out = "";
  const unclosed = []; /* the pre and details tags still open */
  for (const t of htmlTokens(text)) {
    if (typeof t === "string") { out += sealRun(t).replaceAll("<", "&lt;"); continue; }
    const { name } = t;
    if (!t.at || !Object.hasOwn(ALLOWED, name)) return ""; /* text not read as markup comes only after a refused tag */
    if (name === "pre" || name === "details") {
      if (!t.closing) unclosed.push(name);
      else if (unclosed.lastIndexOf(name) > -1) unclosed.splice(unclosed.lastIndexOf(name), 1);
    }
    out += t.closing ? `</${name}>` : open(name, new Map([...t.at].map(([k, v]) => [k, decode(v)])), resolvers);
  }
  /* an unclosed pre or details would swallow what follows it on the page: close it here and say so */
  for (const name of unclosed.reverse()) { warn(`unclosed <${name}> closed at the end of the block`); out += `</${name}>`; }
  return out;
}
