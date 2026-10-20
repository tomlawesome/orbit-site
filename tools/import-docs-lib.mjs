/*
 * The docs importer's pure helpers, kept apart from import-docs.mjs, which
 * fetches and writes files the moment it is imported. Nothing here touches the
 * network or the disk, so tools/ci/import-docs-test.mjs can import it.
 */
import { posix } from "node:path";
import { createHash } from "node:crypto";
import { htmlTokens, readText } from "./sanitise-html.mjs";

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

/* a block of raw html that is one heading, h1 to h6, and nothing else: { depth, text } with
   the heading's inner text, or null. Its attributes are not read: the import gives the
   heading its own id, as for a markdown heading, and keeps nothing the source set on it. */
const RAW_HEADING = /^\s*<h([1-6])(?:\s(?:"[^"]*"|'[^']*'|[^>"'])*)?>((?:(?!<\/?h[1-6][\s>\/])[\s\S])*)<\/h\1\s*>\s*$/i;
export function rawHeading(html) {
  const m = RAW_HEADING.exec(html);
  return m ? { depth: Number(m[1]), text: m[2].trim() } : null;
}

/* an editor may write a fragment percent-encoded ("#caf%C3%A9"): decoded, it
   folds to the same id as the heading; a broken escape is folded as written */
const unescapeFragment = (f) => { try { return decodeURIComponent(f); } catch { return f; } };

/* the most all the pictures one import copies may come to, every source together (audit 5, S2): the import links
   any past it, and docs-shape.mjs holds assets/docs/img/ to the same sum. Each is a commit on main for good, and
   the pages themselves are about 330 KB. */
export const MAX_PICTURE_BYTES_TOTAL = 6 * 1048576;

/* a picture's type by its own leading bytes, never its name: png, jpg, webp, gif, or null */
export function pictureType(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const at = (i, s) => b.length >= i + s.length && b.subarray(i, i + s.length).equals(Buffer.from(s, "latin1"));
  if (at(0, "\x89PNG\r\n\x1a\n")) return "png";
  if (at(0, "\xff\xd8\xff")) return "jpg";
  if (at(0, "GIF87a") || at(0, "GIF89a")) return "gif";
  if (at(0, "RIFF") && at(8, "WEBP")) return "webp";
  return null;
}
/* the name the site keeps a picture under: its content hash, so the same bytes are one file and a changed
   picture is a new name (build-time asset localisation, as Hugo's resources.GetRemote does) */
export function pictureName(bytes) {
  const type = pictureType(bytes);
  return type && `${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.${type}`;
}

/* a raw.githubusercontent.com address: owner/repo, branch, path */
const RAW = /^https:\/\/raw\.githubusercontent\.com\/([^/?#]+\/[^/?#]+)\/([^/?#]+)\/([^?#]+)$/;
/* a path in a repository, from its folder `dir`, or null if it climbs out */
const repoPath = (file, dir = ".") => {
  const target = posix.normalize(posix.join(dir, file)).replace(/^\.\//, "");
  return target === ".." || target.startsWith("../") ? null : target;
};
/* the file of a listed repository a picture address names, { repo, path }, or null: a relative address, or the
   raw host's copy of one on main; the import copies only these */
export function pictureFile(href, src, repos) {
  const raw = RAW.exec(href);
  if (raw) { const path = repoPath(raw[3]); return raw[2] === "main" && repos.includes(raw[1]) && path ? { repo: raw[1], path } : null; }
  if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return null;
  const path = repoPath(href.split("#")[0], posix.dirname(src.path));
  return path ? { repo: src.repo, path } : null;
}

/* the copied pictures some html shows, read as docs-shape reads them: the set to
   write is taken from the pages as written, since a block the sanitiser drops
   after its pictures were seen shows none of them */
export function picturesUsed(html) {
  const out = new Set();
  for (const t of htmlTokens(html)) {
    const src = typeof t !== "string" && t.name === "img" && !t.closing && t.at?.get("src");
    if (src && src.startsWith("assets/docs/img/")) out.add(src.slice(16));
  }
  return out;
}

/* a link inside a source: to a heading of its own, to another imported
   source, or out to the repository. A picture is the site's copy of it (its
   name in `pictures`, keyed "<repo>:<path>"), or else an address to link to:
   its file on github.com, never the raw host, or another host's as written.
   A data: address is not passed on: it is read as the path it looks like,
   so it ends on GitHub and never runs on the page. */
export function resolveLink(href, src, bySourcePath, isImage, pictures) {
  // the app's own mark, wherever a page points at it, is the site's current one (the repo's copy is out of date)
  if (isImage && /(^|\/)orbit-mark\.svg$/i.test(href)) return "assets/img/mark.svg";
  const raw = isImage && RAW.exec(href);
  if (raw) {
    const name = raw[2] === "main" && pictures?.get(`${raw[1]}:${repoPath(raw[3])}`);
    return name ? `assets/docs/img/${name}` : `https://github.com/${raw[1]}/blob/${raw[2]}/${raw[3]}`;
  }
  if (/^(https?:|mailto:)/i.test(href)) return href;
  // a fragment that folds to nothing points at the page itself
  if (href.startsWith("#")) { const a = slugOf(unescapeFragment(href.slice(1))); return `#docs/${src.slug}${a ? `/${a}` : ""}`; }
  const [file, anchor] = href.split("#");
  const base = posix.dirname(src.path);
  const target = posix.normalize(posix.join(base, file)).replace(/^\.\//, "");
  const hit = bySourcePath.get(`${src.repo}:${target}`);
  if (hit && !isImage) { const a = slugOf(unescapeFragment(anchor ?? "")); return `#docs/${hit.slug}${a ? `/${a}` : ""}`; }
  const name = isImage && pictures?.get(`${src.repo}:${target}`);
  if (name) return `assets/docs/img/${name}`;
  return `https://github.com/${src.repo}/blob/main/${target}${anchor && !isImage ? `#${anchor}` : ""}`;
}

/* the text a reader would see in some html: read as a browser reads it, by
   the sanitiser's own reader (htmlTokens in sanitise-html.mjs), so tags,
   comments and bogus comments are hidden by the same rules there and here;
   character references read in each run of text on its own, as the browser
   does (readText); the inside of a textarea, title, xmp, plaintext, noscript,
   iframe, noembed or noframes, and CDATA in svg or math, counted as shown;
   spaces folded */
export function visibleText(html) {
  let out = "";
  for (const t of htmlTokens(html)) {
    if (typeof t === "string") out += readText(t);
    else if (t.text !== undefined) out += t.refs ? readText(t.text) : t.text;
  }
  return out.replace(/\s+/g, " ").trim();
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
