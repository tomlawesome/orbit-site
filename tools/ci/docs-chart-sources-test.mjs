/*
 * Tests for orbit-site #124 (ten docs pages), from the specification alone:
 *
 *   C1  the WIDE_SLOTS array in assets/js/pads.js has at least as many slots as tools/docs-sources.json has pages.
 *   C2  every "Start here" link in KEYS points at a page in docs-sources.json.
 *   C3  where a KEYS link names a section, that id is in assets/docs/<slug>.json (sections[].id).
 *
 *   node tools/ci/docs-chart-sources-test.mjs
 *
 * pads.js is read as text and the arrays are cut out of it; it is not imported.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};

const pads = readFileSync(resolve(root, "assets/js/pads.js"), "utf8");
const sources = JSON.parse(readFileSync(resolve(root, "tools/docs-sources.json"), "utf8"));
const slugs = sources.map((s) => s.slug);

// the text of `const NAME = [ ... ];`, brackets balanced, strings skipped
const arrayText = (name) => {
  const m = new RegExp(`\\bconst\\s+${name}\\s*=\\s*\\[`).exec(pads);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0, q = null;
  for (let i = start; i < pads.length; i++) {
    const ch = pads[i];
    if (q) { if (ch === "\\") i++; else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'" || ch === "`") q = ch;
    else if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) return pads.slice(start, i + 1);
  }
  return null;
};

const wideText = arrayText("WIDE_SLOTS");
const slots = wideText === null ? null : wideText.slice(1, -1).match(/\[[^\[\]]*\]/g) || [];
check("C1 WIDE_SLOTS has a slot for every page in docs-sources.json", slots !== null && slots.length >= sources.length, slots === null ? "WIDE_SLOTS not found in pads.js" : `${slots.length} slots for ${sources.length} pages`);

const keysText = arrayText("KEYS");
const keys = keysText === null ? null : [...keysText.matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2]);
check("C2 KEYS found and not empty", keys !== null && keys.length > 0, keys === null ? "KEYS not found in pads.js" : `${keys.length} links`);
for (const k of keys || []) {
  const m = /^#docs\/([^\/]+)(?:\/(.+))?$/.exec(k);
  if (!m) { check(`C2 ${k} is a #docs/<slug>[/<id>] link`, false, "not of that form"); continue; }
  const [, slug, id] = m;
  check(`C2 ${k} points at a page in docs-sources.json`, slugs.includes(slug), `slug ${slug} ${slugs.includes(slug) ? "listed" : "not listed"}`);
  if (id === undefined) continue;
  let ids = null;
  try { ids = JSON.parse(readFileSync(resolve(root, "assets/docs", `${slug}.json`), "utf8")).sections.map((s) => s.id); } catch (e) { ids = null; }
  check(`C3 ${k} names a section id present in assets/docs/${slug}.json`, ids !== null && ids.includes(id), ids === null ? `cannot read sections of ${slug}.json` : `id ${id} ${ids.includes(id) ? "found" : "missing"}`);
}

process.exit(failed ? 1 : 0);
