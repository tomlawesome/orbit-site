/*
 * The docs, imported. Each source is a markdown file in one of Orbit's
 * repositories; this fetches it, sets it in the site's own type, and writes
 * it as a page the docs landing can read — one JSON per source, and an index
 * of every section for the chart and the search.
 *
 *   node tools/import-docs.mjs            fetches from GitHub
 *   node tools/import-docs.mjs --from DIR reads a local checkout instead
 *
 * Needs `marked` (npm ci --prefix tools --ignore-scripts). Nothing here runs
 * on the site.
 */
import { marked } from "marked";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitiseHtml } from "./sanitise-html.mjs";
import { plain, resolveLink, droppedBlockWarning, logSafe } from "./import-docs-lib.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "docs");

/* the sources: a slug for the route, the constellation's name and colour,
   where the file lives, and for the README, where the page should begin */
export const SOURCES = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "docs-sources.json"), "utf8"));

const localRoot = (() => { const i = process.argv.indexOf("--from"); return i > -1 ? process.argv[i + 1] : null; })();

async function fetchSource(src) {
  if (localRoot) {
    const dir = src.repo.endsWith("orbit-launcher") ? `${localRoot}-launcher` : localRoot;
    return readFile(join(dir, src.path), "utf8");
  }
  const url = `https://raw.githubusercontent.com/${src.repo}/main/${src.path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}

/* heading ids the way GitHub makes them, so the repository's own anchors keep working */
function slugger() {
  const seen = new Map();
  return (text) => {
    let s = text.toLowerCase().trim().replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-");
    const n = seen.get(s) ?? 0; seen.set(s, n + 1);
    return n ? `${s}-${n}` : s;
  };
}
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const unescapeHtml = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function render(md, src, bySourcePath) {
  const id = slugger();
  const headings = [];
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
      const to = resolveLink(href, src, bySourcePath, true);
      return `<img src="${esc(to)}" alt="${esc(text || "")}"${title ? ` title="${esc(title)}"` : ""} loading="lazy" />`;
    },
    code({ text, lang }) {
      if ((lang || "").trim() === "mermaid") return `<figure class="diagram" data-mermaid><pre hidden>${esc(text)}</pre><figcaption>a diagram, drawing…</figcaption></figure>\n`;
      const l = (lang || "").trim().split(/\s+/)[0];
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
        image: (h) => resolveLink(h, src, bySourcePath, true),
        warn: (m) => console.warn(`import-docs: ${logSafe(src.repo)}/${logSafe(src.path)}: ${m}`),
      });
      // text the page no longer shows is told in the import's log
      const lost = droppedBlockWarning(src, text, out);
      if (lost) console.warn(lost);
      return out;
    },
  };
  marked.use({ gfm: true, renderer });
  let tokens = marked.lexer(md);
  /* the page begins at the named heading; what comes before is the repository's own banner */
  if (src.from) {
    const at = tokens.findIndex((t) => t.type === "heading" && t.text.trim() === src.from);
    if (at > -1) tokens = tokens.slice(at);
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
for (const src of SOURCES) {
  const md = await fetchSource(src);
  const page = render(md, src, bySourcePath);
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
console.log(`index: ${index.sources.reduce((n, s) => n + s.sections.length, 0)} sections in ${index.sources.length} sources`);
