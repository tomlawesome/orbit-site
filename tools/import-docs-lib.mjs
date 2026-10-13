/*
 * The docs importer's pure helpers, kept apart from import-docs.mjs, which
 * fetches and writes files the moment it is imported. Nothing here touches the
 * network or the disk, so tools/ci/import-docs-test.mjs can import it.
 */
import { posix } from "node:path";

/* the words of some markdown tokens, as the search and the summaries read them.
   Words in one run of inline marks join with nothing between them (`2 \* 3`
   stays `2 * 3`); a block starts a new word. */
const INLINE = new Set(["text", "escape", "strong", "em", "codespan", "del", "link", "image", "br"]);
const words = (tokens) => {
  let out = "", prevInline = false;
  for (const t of tokens || []) {
    const inline = INLINE.has(t.type);
    if (out && !(inline && prevInline)) out += " ";
    out += word(t);
    prevInline = inline;
  }
  return out;
};
const word = (t) => {
  if (t.type === "br") return " ";
  if (t.type === "html") return /^<br\s*\/?>$/i.test(t.text.trim()) ? " " : "";
  if (t.type === "table") return [...t.header, ...t.rows.flat()].map((c) => words(c.tokens)).join(" ");
  if (t.type === "list") return t.items.map((i) => words(i.tokens)).join(" ");
  if (t.tokens) return words(t.tokens);
  return t.text ?? "";
};
export const plain = (tokens) => words(tokens).replace(/\s+/g, " ").trim();

/* heading ids: GitHub's anchor, then folded to plain letters and digits: an id
   is a route and an attribute the pad trusts (tools/ci/docs-shape.mjs), so it
   can carry nothing else; the repository's own links are folded the same way
   in resolveLink, so they still land. Known limits: "Über" and "Uber" in one
   page both fold to "uber", so a link to the second lands on the first; and a
   fragment GitHub never made ("#Quick-Start") now works where GitHub's would
   not. May return "". */
export const slugOf = (text) => text.toLowerCase().trim().replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "")
  .replace(/\s+/g, "-").normalize("NFKD").replace(/[^a-z0-9-]/g, "");
/* each heading of one page its id: never empty, a repeat numbered */
export function slugger() {
  const seen = new Map();
  return (text) => {
    const s = slugOf(text) || "section";
    const n = seen.get(s) ?? 0; seen.set(s, n + 1);
    return n ? `${s}-${n}` : s;
  };
}

/* an editor may write a fragment percent-encoded ("#caf%C3%A9"): decoded, it
   folds to the same id as the heading; a broken escape is folded as written */
const unescapeFragment = (f) => { try { return decodeURIComponent(f); } catch { return f; } };

/* a link inside a source: to a heading of its own, to another imported
   source, or out to the repository; an image stays on GitHub's raw host.
   A data: address is not passed on: it is read as the path it looks like,
   so it ends on GitHub and never runs on the page. */
export function resolveLink(href, src, bySourcePath, isImage) {
  // the app's own mark, wherever a page points at it, is the site's current one (the repo's copy is out of date)
  if (isImage && /(^|\/)orbit-mark\.svg$/i.test(href)) return "assets/img/mark.svg";
  if (/^(https?:|mailto:)/i.test(href)) return href;
  // a fragment that folds to nothing points at the page itself
  if (href.startsWith("#")) { const a = slugOf(unescapeFragment(href.slice(1))); return `#docs/${src.slug}${a ? `/${a}` : ""}`; }
  const [file, anchor] = href.split("#");
  const base = posix.dirname(src.path);
  const target = posix.normalize(posix.join(base, file)).replace(/^\.\//, "");
  const hit = bySourcePath.get(`${src.repo}:${target}`);
  if (hit && !isImage) { const a = slugOf(unescapeFragment(anchor ?? "")); return `#docs/${hit.slug}${a ? `/${a}` : ""}`; }
  return isImage
    ? `https://raw.githubusercontent.com/${src.repo}/main/${target}`
    : `https://github.com/${src.repo}/blob/main/${target}${anchor ? `#${anchor}` : ""}`;
}

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const entities = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);?/gi, (m, e) => {
  if (e[0] !== "#") return NAMED[e.toLowerCase()];
  const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "�";
});

/* the text a reader would see in some html: comments and tags removed, entities
   read, spaces folded. One pass; a "<" that does not open a tag, or whose tag
   never closes, is text, as the sanitiser writes it out. A comment ends as a
   browser ends it, at "-->" or "--!>" ("<!-->" and "<!--->" at once), and one
   never closed hides the rest (#52: read as text, it gave a false "lost text"). */
export function visibleText(html) {
  let out = "", i = 0;
  const noClose = {}; /* a character with none after the place it was last looked for */
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) { out += html.slice(i); break; }
    out += html.slice(i, lt);
    let end = -1;
    if (html.startsWith("<!--", lt)) {
      const c = /--!?>/g; c.lastIndex = lt + 2;
      const m = c.exec(html);
      if (!m) break;
      end = m.index + m[0].length;
    } else if (/^<\/?[a-z]/i.test(html.slice(lt, lt + 3))) {
      let p = lt + 2;
      for (;;) {
        const c = /[>"']/g; c.lastIndex = p;
        const m = c.exec(html);
        if (!m) break;
        if (m[0] === ">") { end = m.index + 1; break; }
        const q = noClose[m[0]] <= m.index ? -1 : html.indexOf(m[0], m.index + 1);
        if (q < 0) { noClose[m[0]] = m.index; break; }
        p = q + 1;
      }
    }
    if (end < 0) { out += "<"; i = lt + 1; } else i = end;
  }
  return entities(out).replace(/\s+/g, " ").trim();
}

/* control characters in text fetched from another repository are not written
   to the CI log as they came: they could redraw or hide what the log says */
export const logSafe = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/ {2,}/g, " ").trim();

/* the warning for a block of raw html in a source when the page no longer shows
   words the source had, or a falsy value when nothing a reader sees was lost
   (a comment, a dropped attribute or an empty block loses none) */
export function droppedBlockWarning(src, htmlIn, htmlOut) {
  const was = visibleText(htmlIn);
  if (!was || visibleText(htmlOut) === was) return "";
  return `import-docs: ${logSafe(src.repo)}/${logSafe(src.path)}: raw html lost text: ${logSafe(htmlIn).slice(0, 80)}`;
}
