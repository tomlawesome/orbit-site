/*
 * The docs carry no script: the check the lint's section "the imported docs carry no script" runs on the committed
 * docs, and the publish job (nightly-publish.sh) on the import's artifact before it pushes anything (#52). One copy.
 *
 *   node tools/ci/docs-noscript.mjs <docs dir>   prints each section that carries script, exits 1 if any
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const bad = [/<(script|style|iframe|svg|math|object|embed|form|base|meta|link|template|textarea|title|xmp|noembed|noframes|noscript|plaintext)\b/i];
const named = { colon: ":", tab: "\t", newline: "\n", nbsp: "\xa0", amp: "&", quot: "\"", apos: "\x27", lt: "<", gt: ">", lpar: "(", rpar: ")" };
const cp = (n) => { try { return String.fromCodePoint(n); } catch { return ""; } };
const decode = (v) => {
  for (let i = 0; i < 4; i++) {
    const w = v.replace(/&#x([0-9a-f]+);?/gi, (m, h) => cp(parseInt(h, 16)))
      .replace(/&#(\d+);?/g, (m, d) => cp(Number(d)))
      .replace(/&([a-z]+);/gi, (m, n) => (named[n.toLowerCase()] !== undefined ? named[n.toLowerCase()] : m));
    if (w === v) break;
    v = w;
  }
  return v;
};
const scheme = (v) => decode(v).replace(/[\p{Cc}\p{Z}\p{Cf}]/gu, "");
const urlAttr = new Set(["href", "src", "xlink:href", "action", "formaction", "data", "poster", "background", "ping", "srcset"]);
export const danger = (h) => {
  // every < must open a start or end tag of the one shape the import writes, else refuse:
  // WS is html whitespace only, a value is double-quoted with no quote or angle bracket inside
  const tag = /<(?:\/[a-zA-Z][a-zA-Z0-9]*[\t\n\f\r ]*|[a-zA-Z][a-zA-Z0-9]*((?:[\t\n\f\r ]+[a-zA-Z][a-zA-Z0-9:-]*(?:="[^"<>]*")?)*)[\t\n\f\r ]*\/?)>/y;
  for (let i = h.indexOf("<"); i !== -1; i = h.indexOf("<", tag.lastIndex)) {
    tag.lastIndex = i;
    const m = tag.exec(h);
    if (!m) return true;
    for (const a of (m[1] || "").matchAll(/[\t\n\f\r ]+([a-zA-Z][a-zA-Z0-9:-]*)(?:="([^"<>]*)")?/g)) {
      const name = a[1].toLowerCase(), value = a[2] || "";
      if (/^on/.test(name)) return true;
      if (urlAttr.has(name) && /(^|,)(javascript|vbscript|data):/i.test(scheme(value))) return true;
    }
  }
  return bad.some((re) => re.test(h));
};

/* each section of each page in dir (not the index) whose html carries script, as a line for the log */
export function scriptProblems(dir) {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json") : [];
  const out = [];
  for (const f of files) {
    for (const s of JSON.parse(readFileSync(join(dir, f), "utf8")).sections || []) {
      if (danger(s.html || "")) out.push(`   ${join(dir, f)} section ${s.id} carries script`);
    }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = scriptProblems(process.argv[2] || "assets/docs");
  for (const p of problems) console.log(p);
  process.exitCode = problems.length ? 1 : 0;
}
