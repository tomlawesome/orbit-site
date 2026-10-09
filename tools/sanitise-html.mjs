/*
 * Raw html in a source is kept only as an allow-list of tags and attributes,
 * every link and picture resolved and its scheme checked: the markdown's own
 * escaping does not cover it, and a page is set with innerHTML.
 *
 *   sanitiseHtml(text, { link, image })
 *
 * `link(href)` and `image(src)` are the caller's resolvers: the source's
 * value, entity-decoded, in; the address to write out. A tag outside the list
 * makes the whole call return "".
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

const TAG = /<(\/?)([a-z][a-z0-9-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/iy;
const ATTR = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
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
  if (at.get("align") === "center" && ALLOWED[name].includes("class")) out.set("class", "centred");
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

export function sanitiseHtml(text, resolvers) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt < 0) { out += text.slice(i); break; }
    out += text.slice(i, lt);
    if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt + 4);
      if (end > -1) { i = end + 3; continue; }
    }
    TAG.lastIndex = lt;
    const m = TAG.exec(text);
    if (!m) { out += "&lt;"; i = lt + 1; continue; }
    i = TAG.lastIndex;
    const name = m[2].toLowerCase();
    if (!Object.hasOwn(ALLOWED, name)) return "";
    out += m[1] ? `</${name}>` : open(name, attributes(m[3]), resolvers);
  }
  return out;
}
