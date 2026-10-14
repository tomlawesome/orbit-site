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
 * The text is read as a browser reads it (htmlTokens, below), so the output
 * shows no text the browser hid and hides none it showed.
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
   Raw-text elements (script, style, textarea...) and foreign content are not
   read specially: no such tag is on the sanitiser's list. */
const WS = new Set(["\t", "\n", "\f", "\r", " "]);
const isLetter = (c) => c !== undefined && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z"));
const lower = (s) => s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
const COMMENT_END = /--!?>/g;

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
   character reference read; a "<" that is text comes alone), or a tag from
   readTag. Comments, bogus comments and a cut-off tag are left out. */
export function* htmlTokens(s) {
  const n = s.length;
  let i = 0;
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
    if (typeof t === "string") { out += t === "<" ? "&lt;" : t; continue; }
    const { name } = t;
    if (!Object.hasOwn(ALLOWED, name)) return "";
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
