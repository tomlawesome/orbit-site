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
import { join, dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitiseHtml } from "./sanitise-html.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "docs");

/* the sources: a slug for the route, the constellation's name and colour,
   where the file lives, and for the README, where the page should begin */
export const SOURCES = [
  { slug: "readme",         name: "README",         c: "#d8b45a", repo: "tomlawesome/orbit",          path: "README.md",                       from: "Quick start", title: "Orbit", skip: ["A quick visual tour"] },
  { slug: "sign-in",        name: "Sign-in",        c: "#8fb8ff", repo: "tomlawesome/orbit",          path: "docs/authentication.md" },
  { slug: "security",       name: "Security",       c: "#f87171", repo: "tomlawesome/orbit",          path: "SECURITY.md" },
  { slug: "releases",       name: "Releases",       c: "#a78bfa", repo: "tomlawesome/orbit",          path: "docs/releasing.md" },
  { slug: "launcher",       name: "The launcher",   c: "#4ade80", repo: "tomlawesome/orbit-launcher", path: "README.md", title: "The launcher" },
  { slug: "administration", name: "Administration", c: "#f0b429", repo: "tomlawesome/orbit",          path: "docs/administrator-operations.md" },
  { slug: "architecture",   name: "Architecture",   c: "#6ee7d8", repo: "tomlawesome/orbit",          path: "docs/architecture.md" },
  { slug: "supply-chain",   name: "Supply chain",   c: "#f59e8b", repo: "tomlawesome/orbit",          path: "docs/supply-chain.md" },
];

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
const plain = (tokens) => (tokens || []).map((t) => t.type === "text" || t.type === "codespan" ? (t.tokens ? plain(t.tokens) : t.text) : t.type === "code" ? t.text : plain(t.tokens || t.items || t.rows?.flat() || [])).join(" ").replace(/\s+/g, " ").trim();
const unescapeHtml = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/* a link inside a source: to a heading of its own, to another imported
   source, or out to the repository; an image stays on GitHub's raw host */
function resolveLink(href, src, bySourcePath, isImage) {
  // the app's own mark, wherever a page points at it, is the site's current one (the repo's copy is out of date)
  if (isImage && /(^|\/)orbit-mark\.svg$/i.test(href)) return "assets/img/mark.svg";
  if (/^(https?:|mailto:|data:)/i.test(href)) return href;
  if (href.startsWith("#")) return `#docs/${src.slug}/${href.slice(1)}`;
  const [file, anchor] = href.split("#");
  const base = posix.dirname(src.path);
  const target = posix.normalize(posix.join(base, file)).replace(/^\.\//, "");
  const hit = bySourcePath.get(`${src.repo}:${target}`);
  if (hit && !isImage) return `#docs/${hit.slug}${anchor ? `/${anchor}` : ""}`;
  return isImage
    ? `https://raw.githubusercontent.com/${src.repo}/main/${target}`
    : `https://github.com/${src.repo}/blob/main/${target}${anchor ? `#${anchor}` : ""}`;
}

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
      const out = sanitiseHtml(text, { link: (h) => resolveLink(h, src, bySourcePath, false), image: (h) => resolveLink(h, src, bySourcePath, true) });
      // a dropped block is content the page no longer shows: say so in the import's log
      if (!out && text.trim()) console.warn(`import-docs: ${src.repo}/${src.path}: raw html dropped: ${text.trim().slice(0, 80)}`);
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
for (const src of SOURCES) {
  const md = await fetchSource(src);
  const page = render(md, src, bySourcePath);
  const doc = { slug: src.slug, name: src.name, c: src.c, title: page.title, repo: src.repo, path: src.path, sections: page.sections };
  await writeFile(join(OUT, `${src.slug}.json`), JSON.stringify(doc));
  index.sources.push({ slug: src.slug, name: src.name, c: src.c, title: page.title, repo: src.repo, path: src.path,
    sections: page.sections.map((s) => ({ id: s.id, title: s.title, summary: s.summary, text: s.text, subs: s.subs })) });
  console.log(`${src.slug}: ${page.sections.length} sections, ${page.sections.reduce((n, s) => n + s.html.length, 0)} bytes`);
}
await writeFile(join(OUT, "index.json"), JSON.stringify(index));
console.log(`index: ${index.sources.reduce((n, s) => n + s.sections.length, 0)} sections in ${index.sources.length} sources`);

/* the launcher's own screens, for the install page: fetched from the
   launcher's repository when they are there, kept as they are when not.
   `sharp` sizes them for the web; without it the pictures are left alone. */
const SHOTS = ["01-splash", "02-install-profile", "03-install-ready", "04-install-console", "05-install-success", "06-splash-alive",
  "07-update-confirm", "08-update-console", "09-repair-proposed", "10-repair-applied", "11-remove-confirm", "12-remove-done"];
const IMG = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "img", "launcher");
let sharp = null; try { sharp = (await import("sharp")).default; } catch { /* not installed: the pictures stay */ }
if (sharp && !localRoot) {
  await mkdir(IMG, { recursive: true });
  let got = 0;
  for (const name of SHOTS) {
    const res = await fetch(`https://raw.githubusercontent.com/tomlawesome/orbit-launcher/main/docs/assets/screenshots/${name}.png`);
    if (!res.ok) continue;
    const png = Buffer.from(await res.arrayBuffer());
    await writeFile(join(IMG, `${name}.webp`), await sharp(png).resize(1280, 720).webp({ quality: 82 }).toBuffer());
    got++;
  }
  console.log(`launcher: ${got} of ${SHOTS.length} screens${got ? "" : " (none on the launcher's main yet; the pictures kept)"}`);
}
