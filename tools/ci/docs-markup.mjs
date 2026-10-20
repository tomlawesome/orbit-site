/*
 * The docs carry only the markup the import writes: the check the lint's section "the imported docs carry no
 * script" runs on the committed docs, and the publish job (nightly-publish.sh) on the import's artifact before it
 * pushes anything (#52), and the import on its own output. One copy, and no npm package: the publish job runs it
 * beside the token.
 *
 *   node tools/ci/docs-markup.mjs <docs dir>   prints each section off the allow-list, exits 1 if any
 *
 * An allow-list, not a list of dangers (audit 5, S1): the import ran third-party code, so a section is held to what
 * the import's writers can produce (tools/import-docs.mjs's renderer, marked's GFM output for what that leaves to
 * it, and tools/sanitise-html.mjs for raw html) and anything else, however harmless it looks, is refused.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/* each tag the import writes, each attribute it may carry and the values it may hold, as written (not decoded) */
const EMPTY = /^$/, DIGITS = /^\d+$/, FREE = /^[^"<>]*$/;
const SLUG = "[a-z0-9-]+";
/* a link: to a page or heading of the docs, or out (the scheme as the import passes it on: any case, no host
   required, the rest as written, which may hold a space) */
const HREF = new RegExp(`^#docs/${SLUG}(/${SLUG})?$|^(?:[hH][tT][tT][pP][sS]?|[mM][aA][iI][lL][tT][oO]):[^\\t\\n\\f\\r]*$`);
/* a picture: one the import copied, or the mark */
const SRC = /^assets\/docs\/img\/[0-9a-f]{16}\.(png|jpg|webp|gif)$|^assets\/img\/mark\.svg$/;
const ID = new RegExp(`^${SLUG}$`), CENTRED = /^centred$/;
const heading = { id: ID };
const cell = { align: /^(left|center|right)$/, colspan: DIGITS, rowspan: DIGITS, class: CENTRED };
const PAGE = {
  h1: heading, h2: heading, h3: heading, h4: heading, h5: heading, h6: heading,
  a: { href: HREF, class: /^anchor$/, "aria-label": /^Link to this heading$/, title: FREE, target: /^_blank$/, rel: /^noopener$/ },
  img: { src: SRC, alt: FREE, title: FREE, width: /^\d+%?$/, height: /^\d+%?$/, loading: /^lazy$/ },
  pre: { class: /^code$/, "data-lang": /^[\w+#.-]{1,20}$/, hidden: EMPTY },
  figure: { class: /^diagram$/, "data-mermaid": EMPTY },
  aside: { class: /^alert (note|tip|important|warning|caution)$/ },
  input: { type: /^checkbox$/, checked: EMPTY, disabled: EMPTY },
  ol: { start: DIGITS },
  p: { class: CENTRED }, div: { class: CENTRED }, td: cell, th: cell,
  details: { open: EMPTY },
  ...Object.fromEntries(("figcaption del br hr strong em b i code kbd sub sup summary span table thead tbody tr " +
    "ul li blockquote").split(" ").map((t) => [t, {}])),
};

/* why some html is off the table, or "" when it is all on it. Every < must open a start or end tag of the one shape
   the import writes, which a browser and this check read alike: an ascii name, html whitespace only, name="value"
   with no quote or angle bracket inside, no attributes on an end tag. Names are compared as written: the import
   writes them in lower case. Only names go in the reason, never a value: the log is the reader. */
export const offMarkup = (h) => {
  const tag = /<(?:\/([a-zA-Z][a-zA-Z0-9]*)[\t\n\f\r ]*|([a-zA-Z][a-zA-Z0-9]*)((?:[\t\n\f\r ]+[a-zA-Z][a-zA-Z0-9:-]*(?:="[^"<>]*")?)*)[\t\n\f\r ]*\/?)>/y;
  for (let i = h.indexOf("<"); i !== -1; i = h.indexOf("<", tag.lastIndex)) {
    tag.lastIndex = i;
    const m = tag.exec(h);
    if (!m) return "a < that opens no tag of the shape the import writes";
    const name = m[1] ?? m[2];
    if (!Object.hasOwn(PAGE, name)) return `a tag <${name}> the import does not write`;
    for (const a of (m[3] || "").matchAll(/[\t\n\f\r ]+([a-zA-Z][a-zA-Z0-9:-]*)(?:="([^"<>]*)")?/g)) {
      const want = Object.hasOwn(PAGE[name], a[1]) ? PAGE[name][a[1]] : null;
      if (!want) return `an attribute ${a[1]} on <${name}> the import does not write`;
      if (!want.test(a[2] ?? "")) return `a value of ${a[1]} on <${name}> the import does not write`;
    }
  }
  return "";
};

/* each section of each page in dir (not the index) whose html is off the table, as a line for the log */
export function markupProblems(dir) {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json") : [];
  const out = [];
  for (const f of files) {
    for (const s of JSON.parse(readFileSync(join(dir, f), "utf8")).sections || []) {
      const why = offMarkup(typeof s.html === "string" ? s.html : "");
      if (why) out.push(`   ${join(dir, f)} section ${JSON.stringify(String(s.id)).slice(0, 80)} carries ${why}`);
    }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = markupProblems(process.argv[2] || "assets/docs");
  for (const p of problems) console.log(p);
  process.exitCode = problems.length ? 1 : 0;
}
