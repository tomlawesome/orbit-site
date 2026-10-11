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

const ATTR = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const NAME = /([a-z][a-z0-9-]*)/iy;
const ATTR_NAME = /[^\s"'>\/=]+/y;
const UNQUOTED = /[^\s"'=<>`]+/y;
const SPACE = /\s*/y;
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);?/gi, (m, e) => {
  if (e[0] !== "#") return NAMED[e.toLowerCase()];
  const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "\ufffd";
});
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/* the attributes of one tag, names lower-cased, values decoded; the first of a name wins */
function attributes(s) {
  const at = new Map();
  for (const m of s.matchAll(ATTR)) {
    const name = m[1].toLowerCase();
    if (!at.has(name)) at.set(name, decode(m[2] ?? m[3] ?? m[4] ?? ""));
  }
  return at;
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

/* one tag read at text[lt] in a single left-to-right pass, no backtracking:
   { end, closing, name, attrs } when it is a tag, else { fail: true }. What
   is left to read after the tag name or an attribute depends only on where
   that is, so every such place a failed read passed is remembered in `dead`
   and a later read that reaches one fails there: no stretch is read twice. */
function scanTag(text, lt, quotes, dead) {
  const at = (re, p) => { re.lastIndex = p; return re.test(text) ? re.lastIndex : -1; };
  const space = (p) => at(SPACE, p);
  let p = lt + 1;
  const closing = text[p] === "/";
  if (closing) p++;
  NAME.lastIndex = p;
  const nm = NAME.exec(text);
  if (!nm) return { fail: true };
  p = NAME.lastIndex;
  const attrs = p;
  const passed = [];
  const fail = () => { for (const x of passed) dead.add(x); return { fail: true }; };
  for (;;) {
    if (dead.has(p)) return fail();
    passed.push(p);
    const q = space(p);
    if (text[q] === ">") return { end: q + 1, closing, name: nm[1].toLowerCase(), attrs: text.slice(attrs, q) };
    if (text[q] === "/" && text[q + 1] === ">") return { end: q + 2, closing, name: nm[1].toLowerCase(), attrs: text.slice(attrs, q) };
    if (q === p) return fail();
    let r = at(ATTR_NAME, q);
    if (r < 0) return fail();
    const s = space(r);
    if (text[s] !== "=") { p = r; continue; }
    const v = space(s + 1);
    const c = text[v];
    if (c === '"' || c === "'") {
      /* a quote with no partner after it cannot close: asked once, not again */
      const close = quotes[c] === undefined || v < quotes[c] ? text.indexOf(c, v + 1) : -1;
      if (close < 0) { quotes[c] = v; return fail(); }
      p = close + 1;
    } else {
      r = at(UNQUOTED, v);
      if (r < 0) return fail();
      p = r;
    }
  }
}

export function sanitiseHtml(text, resolvers) {
  const warn = resolvers.warn ?? (() => {});
  let out = "";
  let i = 0;
  const unclosed = []; /* the pre and details tags still open */
  let noCommentEnd = false; /* no "-->" anywhere after the last look */
  const quotes = {};
  const dead = new Set();
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt < 0) { out += text.slice(i); break; }
    out += text.slice(i, lt);
    if (!noCommentEnd && text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt + 4);
      if (end > -1) { i = end + 3; continue; }
      noCommentEnd = true;
    }
    const tag = scanTag(text, lt, quotes, dead);
    if (tag.fail) {
      out += "&lt;"; i = lt + 1; continue;
    }
    i = tag.end;
    const { name } = tag;
    if (!Object.hasOwn(ALLOWED, name)) return "";
    if (name === "pre" || name === "details") {
      if (!tag.closing) unclosed.push(name);
      else if (unclosed.lastIndexOf(name) > -1) unclosed.splice(unclosed.lastIndexOf(name), 1);
    }
    out += tag.closing ? `</${name}>` : open(name, attributes(tag.attrs), resolvers);
  }
  /* an unclosed pre or details would swallow what follows it on the page: close it here and say so */
  for (const name of unclosed.reverse()) { warn(`unclosed <${name}> closed at the end of the block`); out += `</${name}>`; }
  return out;
}
