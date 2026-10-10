/*
 * The door's markup, written into index.html from its master copy (assets/door/markup.js: dawnMarkup, duskMarkup),
 * so the page carries the door for first paint and the folder stays the one place the door is edited. The site's
 * own parts (the planets in the lockup, the gate and the maintenance notice, the credit at the foot) are read back
 * from the page between the slot markers and put into the slots, so they are edited in index.html as ever.
 *
 *   node tools/door-markup.mjs            rewrites index.html between <!-- door --> … <!-- /door --> and the dusk's
 *   node tools/door-markup.mjs --check    exits 1 if index.html differs from what it would write (the lint)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { dawnMarkup, duskMarkup } from "../assets/door/markup.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = join(root, "index.html");
const html = readFileSync(page, "utf8");
const image = (p) => `assets/door/img/${p}`;

/* a block of the page between its markers: `<!-- name -->` on its own line, and `<!-- /name -->` */
function block(src, name) {
  const open = new RegExp(`^([ \\t]*)<!-- ${name} -->[^\\n]*\\n`, "m"), close = new RegExp(`^[ \\t]*<!-- /${name} -->`, "m");
  const a = src.match(open), b = src.match(close);
  if (!a || !b || b.index < a.index) throw new Error(`index.html: no <!-- ${name} --> … <!-- /${name} --> block`);
  const start = a.index + a[0].length;
  return { start, end: b.index, indent: a[1], inner: src.slice(start, b.index) };
}
/* a slot's content, as the page has it, markers and all (so it is found again next time). A slot whose markers are
   missing or mistyped is an error, never an empty slot: a plain run must not quietly drop the site's own parts */
function slot(src, block, name) {
  const re = new RegExp(`[ \\t]*<!-- slot:${name} -->[\\s\\S]*?<!-- /slot:${name} -->`);
  const m = src.match(re);
  if (!m) throw new Error(`index.html: the ${block} block has no <!-- slot:${name} --> … <!-- /slot:${name} --> markers (mistyped, or lost?)`);
  return m[0];
}

let out = html;
for (const [name, render, names] of [["door", dawnMarkup, ["lockup", "gate", "foot"]], ["dusk", duskMarkup, ["gate", "foot"]]]) {
  const b = block(out, name);
  const slots = Object.fromEntries(names.map((s) => [s, slot(b.inner, name, s)]));
  /* the gate's slot sits inline inside .gate-wrap: its markers carry no indent */
  slots.gate = slots.gate.trim();
  const fresh = render({ image, indent: b.indent, ...slots }) + "\n";
  out = out.slice(0, b.start) + fresh + out.slice(b.end);
}

if (process.argv.includes("--check")) {
  if (out !== html) { console.log("   index.html: the door's markup differs from assets/door/markup.js (run: node tools/door-markup.mjs)"); process.exit(1); }
  console.log("   index.html carries the door as markup.js writes it");
} else if (out !== html) {
  writeFileSync(page, out);
  console.log("index.html: the door's markup rewritten from assets/door/markup.js");
} else {
  console.log("index.html: already as markup.js writes it");
}
