/*
 * The docs, imported. Each source is a markdown file in one of Orbit's
 * repositories; this fetches it, sets it in the site's own type, and writes
 * it as a page the docs landing can read — one JSON per source, and an index
 * of every section for the chart and the search.
 *
 *   node tools/import-docs.mjs            fetches from GitHub
 *   node tools/import-docs.mjs --from DIR reads a local checkout instead
 *                                         (orbit-launcher's from DIR-launcher)
 *   ... --out DIR                         writes there, not assets/docs
 *
 * The pictures the pages show are copied in too, as assets/docs/img/<content
 * hash>.<type>: the page's policy loads pictures from the site alone, and
 * nothing the Orbit app uses may load from an outside source (owner,
 * 2026-10-20). A picture not copied becomes a link to it, and is warned of.
 *
 * Needs `marked` (npm ci --prefix tools --ignore-scripts). Nothing here runs
 * on the site.
 */
import { marked } from "marked";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitiseHtml } from "./sanitise-html.mjs";
import { offMarkup } from "./ci/docs-markup.mjs";
import { plain, resolveLink, droppedBlockWarning, logSafe, slugger, rawHeading, pictureFile, pictureName, picturesUsed, MAX_PICTURE_BYTES_TOTAL } from "./import-docs-lib.mjs";

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const OUT = arg("--out") ?? join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "docs");
/* a picture's size, as docs-shape.mjs and the publish job check it, how many one source may copy and how many it
   may try to fetch, missing ones included (audit 5, S4); all pictures together are MAX_PICTURE_BYTES_TOTAL (S2) */
const MAX_PICTURE = 1048576, MAX_PICTURES = 16, MAX_PICTURE_TRIES = 32;

/* the sources: a slug for the route, the constellation's name and colour,
   where the file lives, and for the README, where the page should begin */
export const SOURCES = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "docs-sources.json"), "utf8"));

const localRoot = arg("--from");

/* a file of one of the repositories, as bytes, or a reason it could not be had; at most `max` bytes */
async function fetchFile(repo, path, max = Infinity) {
  if (localRoot) {
    const dir = repo.endsWith("orbit-launcher") ? `${localRoot}-launcher` : localRoot;
    const b = await readFile(join(dir, path)).catch((e) => e.code);
    return typeof b === "string" ? { why: `cannot be read (${b})` } : b.length > max ? { why: `is larger than ${max} bytes` } : { bytes: b };
  }
  const url = `https://raw.githubusercontent.com/${repo}/main/${path}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) return { why: `cannot be fetched (${res.status})` };
    const parts = []; let n = 0;
    for await (const part of res.body) { n += part.length; if (n > max) return { why: `is larger than ${max} bytes` }; parts.push(part); }
    return { bytes: Buffer.concat(parts) };
  } catch (e) { return { why: `cannot be fetched (${e.name})` }; }
}
async function fetchSource(src) {
  const got = await fetchFile(src.repo, src.path);
  if (!got.bytes) throw new Error(`${src.repo}/${src.path} ${got.why}`);
  return got.bytes.toString("utf8");
}
const REPOS = [...new Set(SOURCES.map((s) => s.repo))];

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const unescapeHtml = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/* render(md, src, bySourcePath, pics): pics.seen(href) hears of every picture address, pics.map is what was copied,
   pics.warn says why one was not; render runs twice, first only to learn which pictures to copy */
function render(md, src, bySourcePath, pics) {
  const id = slugger();
  const headings = [];
  const picture = (href) => { pics.seen?.(href); const to = resolveLink(href, src, bySourcePath, true, pics.map); if (!to.startsWith("assets/")) pics.warn?.(href); return to; };
  const say = pics.seen ? () => {} : (m) => console.warn(m);
  const renderer = {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      const hid = id(unescapeHtml(text.replace(/<[^>]+>/g, "")));
      headings.push({ id: hid, depth, text: unescapeHtml(text.replace(/<[^>]+>/g, "")) });
      return `<h${depth} id="${hid}"><a class="anchor" href="#docs/${src.slug}/${hid}" aria-label="Link to this heading">#</a>${text}</h${depth}>\n`;
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const to = resolveLink(href, src, bySourcePath, false);
      const out = /^https?:/i.test(to) ? ' target="_blank" rel="noopener"' : "";
      return `<a href="${esc(to)}"${title ? ` title="${esc(title)}"` : ""}${out}>${text}</a>`;
    },
    image({ href, title, text }) {
      const to = picture(href);
      if (!to.startsWith("assets/")) return `<a href="${esc(to)}"${/^https?:/i.test(to) ? ' target="_blank" rel="noopener"' : ""}>${esc(text || "picture")}</a>`;
      return `<img src="${esc(to)}" alt="${esc(text || "")}"${title ? ` title="${esc(title)}"` : ""} loading="lazy" />`;
    },
    code({ text, lang }) {
      if ((lang || "").trim() === "mermaid") return `<figure class="diagram" data-mermaid><pre hidden>${esc(text)}</pre><figcaption>a diagram, drawing…</figcaption></figure>\n`;
      /* a language label only of the shape the publish check allows (tools/ci/docs-markup.mjs) */
      const l = /^[\w+#.-]{1,20}$/.exec((lang || "").trim().split(/\s+/)[0])?.[0];
      return `<pre class="code"${l ? ` data-lang="${esc(l)}"` : ""}><code>${esc(text)}</code></pre>\n`;
    },
    blockquote({ tokens }) {
      /* GitHub's alerts: > [!NOTE] and friends, set as asides */
      const first = tokens[0];
      const m = first?.type === "paragraph" && /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(first.raw);
      if (m) {
        const kind = m[1].toLowerCase();
        const rest = first.raw.replace(/^\[!\w+\]\s*/i, "");
        const inner = [...marked.lexer(rest), ...tokens.slice(1)];
        return `<aside class="alert ${kind}"><b>${kind}</b>${this.parser.parse(inner)}</aside>\n`;
      }
      return `<blockquote>${this.parser.parse(tokens)}</blockquote>\n`;
    },
    html({ text }) {
      const out = sanitiseHtml(text, {
        link: (h) => resolveLink(h, src, bySourcePath, false),
        image: picture,
        warn: (m) => say(`import-docs: ${logSafe(src.repo)}/${logSafe(src.path)}: ${m}`),
      });
      // text the page no longer shows is told in the import's log
      const lost = droppedBlockWarning(src, text, out);
      if (lost) say(lost);
      return out;
    },
  };
  marked.use({ gfm: true, renderer });
  /* a heading written as raw html becomes a heading token, so it takes the markdown heading's path: id, anchor, section, contents */
  let tokens = marked.lexer(md).map((t) => {
    const h = t.type === "html" && t.block ? rawHeading(t.text) : null;
    return h ? { type: "heading", raw: t.raw, depth: h.depth, text: h.text, tokens: marked.Lexer.lexInline(h.text) } : t;
  });
  /* the page begins at the named heading; what comes before is the repository's own banner */
  if (src.from) {
    const at = tokens.findIndex((t) => t.type === "heading" && t.text.trim() === src.from);
    if (at < 0) { console.error(`import-docs: ${logSafe(src.repo)}/${logSafe(src.path)}: the start heading "${logSafe(src.from)}" is not in the file`); process.exit(1); }
    tokens = tokens.slice(at);
  }
  const h1 = tokens.find((t) => t.type === "heading" && t.depth === 1);
  const title = src.title || (h1 ? h1.text.trim() : src.name);
  tokens = tokens.filter((t) => !(t.type === "heading" && t.depth === 1));
  /* sections at each second-level heading; anything before the first is the opening */
  const groups = []; let cur = { heading: null, tokens: [] };
  for (const t of tokens) {
    if (t.type === "heading" && t.depth === 2) { if (cur.heading || cur.tokens.length) groups.push(cur); cur = { heading: t, tokens: [t] }; }
    else cur.tokens.push(t);
  }
  if (cur.heading || cur.tokens.length) groups.push(cur);
  /* sections the site leaves out (the README's picture tour shows an older Orbit) */
  const sections = groups.filter((g) => !(g.heading && (src.skip || []).includes(g.heading.text.trim()))).map((g) => {
    const before = headings.length;
    const html = marked.parser(g.tokens);
    const own = headings.slice(before);
    const body = g.tokens.filter((t) => t.type !== "heading");
    const firstPara = body.find((t) => t.type === "paragraph" || t.type === "list" || t.type === "table");
    const summary = plain(firstPara ? [firstPara] : []).slice(0, 170).replace(/\s\S*$/, (m, off, s) => (s.length >= 170 ? "…" : m));
    return {
      id: g.heading ? own[0].id : "top",
      title: g.heading ? own[0].text : title,
      html, summary,
      text: plain(g.tokens),
      subs: own.filter((h) => h.depth === 3).map((h) => ({ id: h.id, title: h.text })),
    };
  });
  return { title, sections };
}

const bySourcePath = new Map(SOURCES.map((s) => [`${s.repo}:${s.path}`, s]));
await mkdir(OUT, { recursive: true });
const index = { generated: new Date().toISOString(), sources: [] };
let changed = false;
/* the pictures copied, "<repo>:<path>" -> name, and each name's bytes; why one could not be */
const map = new Map(), bytesOf = new Map(), why = new Map(), used = new Set();
let total = 0; /* the bytes of every picture copied, all sources together */
for (const src of SOURCES) {
  const md = await fetchSource(src);
  /* first pass: the sanitiser's hooks are synchronous, so the pictures are learnt by rendering once, then fetched */
  const files = new Map(), own = new Map(), past = new Map();
  let tries = 0;
  render(md, src, bySourcePath, { seen: (href) => { const f = pictureFile(href, src, REPOS); if (f) files.set(`${f.repo}:${f.path}`, f); } });
  for (const [key, f] of files) {
    if (why.has(key)) continue;
    if (own.size >= MAX_PICTURES) { past.set(key, `is past the ${MAX_PICTURES} pictures one source may copy`); continue; }
    if (!map.has(key)) {
      if (tries++ >= MAX_PICTURE_TRIES) { past.set(key, `is past the ${MAX_PICTURE_TRIES} pictures one source may fetch`); continue; }
      const got = await fetchFile(f.repo, f.path, MAX_PICTURE);
      const name = got.bytes && pictureName(got.bytes);
      if (!name) { why.set(key, got.why ?? "is not a PNG, JPEG, WebP or GIF picture"); continue; }
      /* the same bytes at another address are one file, counted once */
      const more = bytesOf.has(name) ? 0 : got.bytes.length;
      if (total + more > MAX_PICTURE_BYTES_TOTAL) { past.set(key, `is past the ${MAX_PICTURE_BYTES_TOTAL / 1048576} MiB of pictures one import may copy`); continue; }
      total += more;
      map.set(key, name); bytesOf.set(name, got.bytes);
    }
    own.set(key, map.get(key));
  }
  const page = render(md, src, bySourcePath, { map: own, warn: (href) => {
    const f = pictureFile(href, src, REPOS);
    const key = f && `${f.repo}:${f.path}`;
    const reason = (f && (past.get(key) ?? why.get(key))) ?? "is not a file of the listed repositories";
    console.warn(`import-docs: ${logSafe(src.repo)}/${logSafe(src.path)}: picture ${logSafe(href)} ${reason}; not copied`);
  } });
  /* what the publish job will refuse fails here, where it was written: a marked upgrade that writes something new
     breaks the import, not the publish */
  for (const s of page.sections) { const off = offMarkup(s.html); if (off) throw new Error(`${src.repo}/${src.path}: section ${s.id} carries ${off}`); }
  for (const s of page.sections) for (const n of picturesUsed(s.html)) used.add(n);
  const doc = { slug: src.slug, name: src.name, c: src.c, title: page.title, repo: src.repo, path: src.path, sections: page.sections };
  const file = join(OUT, `${src.slug}.json`), body = JSON.stringify(doc);
  if (await readFile(file, "utf8").catch(() => "") !== body) changed = true;
  await writeFile(file, body);
  index.sources.push({ slug: src.slug, name: src.name, c: src.c, title: page.title, repo: src.repo, path: src.path,
    sections: page.sections.map((s) => ({ id: s.id, title: s.title, summary: s.summary, text: s.text, subs: s.subs })) });
  console.log(`${src.slug}: ${page.sections.length} sections, ${page.sections.reduce((n, s) => n + s.html.length, 0)} bytes`);
}
/* the stamp says when the docs last changed, not when the import last ran:
   an unchanged import keeps the old one, so it changes nothing and the
   nightly job has nothing to merge (#17) */
const before = await readFile(join(OUT, "index.json"), "utf8").then(JSON.parse, () => null);
if (!changed && before && JSON.stringify(before.sources) === JSON.stringify(index.sources)) index.generated = before.generated;
await writeFile(join(OUT, "index.json"), JSON.stringify(index));
/* img/ holds exactly the pictures the pages use: the same bytes keep their file, an unused one is removed */
const IMG = join(OUT, "img");
for (const n of bytesOf.keys()) if (!used.has(n)) bytesOf.delete(n);
if (bytesOf.size) await mkdir(IMG, { recursive: true });
for (const f of await readdir(IMG).catch(() => [])) if (!bytesOf.has(f)) await rm(join(IMG, f), { recursive: true, force: true });
for (const [name, b] of bytesOf) if (!(await readFile(join(IMG, name)).catch(() => null))?.equals(b)) await writeFile(join(IMG, name), b);
if (!bytesOf.size) await rm(IMG, { recursive: true, force: true });
console.log(`index: ${index.sources.reduce((n, s) => n + s.sections.length, 0)} sections in ${index.sources.length} sources`);
