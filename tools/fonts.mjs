/*
 * Writes the site's typefaces into assets/fonts/ (#92: nothing on the site loads from a third party): each family's
 * upstream release, trimmed the same way every time, as woff2, with its licence and fonts.css (the @font-face rules).
 *
 *   npm ci --prefix tools && node tools/fonts.mjs        (needs the network and unzip)
 *
 * The trim, for every family: the latin characters Google Fonts' latin files cover (LATIN, below; text outside it falls
 * back to the system's fonts), the weight axis cut to the weights the pages use (weight), every other axis pinned to
 * its default (Inter's optical size), the layout features HarfBuzz keeps by default plus tabular figures, the name
 * table's licence entries kept, and hinting dropped. HarfBuzz's own subsetter (harfbuzzjs) trims; Google's woff2
 * encoder (wawoff2) packs. Both are pinned in tools/package.json, as dev dependencies: nothing here runs on the site.
 *
 * Each release is named by its tag and checked against its sha256 here, the fonts' one pin. A new release: change its
 * tag and sha256 (Renovate bumps the tag, renovate.json; the old sha256 then refuses the download until it is set to
 * the new file's), run this, and commit what it writes; sw.js's MEDIA changes with the files (the lint prints it).
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "assets", "fonts");
const wawoff2 = createRequire(import.meta.url)("wawoff2");

/* {v} is the tag without a leading v */
const FAMILIES = [
  { family: "Space Grotesk", repo: "floriankarsten/space-grotesk", tag: "2.0.0", sha256: "53b415577d4139248555300710bea0d268c7a5be67b93de53b716a9736cabffd",
    asset: "SpaceGrotesk-{v}.zip", ttf: "SpaceGrotesk-{v}/ttf/SpaceGrotesk[wght].ttf", licence: "SpaceGrotesk-{v}/OFL.txt",
    weight: [500, 600], pin: [], file: "space-grotesk-latin.woff2", licenceFile: "OFL-SpaceGrotesk.txt" },
  { family: "Inter", repo: "rsms/inter", tag: "v4.1", sha256: "9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e",
    asset: "Inter-{v}.zip", ttf: "InterVariable.ttf", licence: "LICENSE.txt",
    weight: [400, 600], pin: ["opsz"], file: "inter-latin.woff2", licenceFile: "OFL-Inter.txt" },
  { family: "JetBrains Mono", repo: "JetBrains/JetBrainsMono", tag: "v2.304", sha256: "6f6376c6ed2960ea8a963cd7387ec9d76e3f629125bc33d1fdcd7eb7012f7bbf",
    asset: "JetBrainsMono-{v}.zip", ttf: "fonts/variable/JetBrainsMono[wght].ttf", licence: "OFL.txt",
    weight: [400, 500], pin: [], file: "jetbrains-mono-latin.woff2", licenceFile: "OFL-JetBrainsMono.txt" },
];

/* Google Fonts' latin range, as its stylesheets give it in unicode-range */
const LATIN = [[0x0000, 0x00ff], [0x0131], [0x0152, 0x0153], [0x02bb, 0x02bc], [0x02c6], [0x02da], [0x02dc], [0x0304], [0x0308], [0x0329],
  [0x2000, 0x206f], [0x20ac], [0x2122], [0x2191], [0x2193], [0x2212], [0x2215], [0xfeff], [0xfffd]];
const hex = (n) => n.toString(16).toUpperCase().padStart(4, "0");
const UNICODE_RANGE = LATIN.map(([a, b]) => b === undefined ? `U+${hex(a)}` : `U+${hex(a)}-${hex(b)}`).join(", ");

/* HarfBuzz's subsetter, called through its C API in harfbuzzjs's wasm build */
const wasm = readFileSync(join(here, "node_modules", "harfbuzzjs", "dist", "harfbuzz-subset.wasm"));
const hb = (await WebAssembly.instantiate(wasm, {})).instance.exports;
const tag = (s) => ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;
const SETS_NAME_ID = 4, SETS_LAYOUT_FEATURE_TAG = 6, FLAGS_NO_HINTING = 0x1, MEMORY_MODE_WRITABLE = 2;

function trim(ttf, f) {
  const at = hb.malloc(ttf.length);
  new Uint8Array(hb.memory.buffer).set(ttf, at);
  const blob = hb.hb_blob_create(at, ttf.length, MEMORY_MODE_WRITABLE, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  const input = hb.hb_subset_input_create_or_fail();
  if (!input) throw new Error("hb_subset_input_create_or_fail failed");
  try {
    const chars = hb.hb_subset_input_unicode_set(input);
    for (const [a, b = a] of LATIN) for (let c = a; c <= b; c++) hb.hb_set_add(chars, c);
    hb.hb_set_add(hb.hb_subset_input_set(input, SETS_NAME_ID), 13); /* licence description */
    hb.hb_set_add(hb.hb_subset_input_set(input, SETS_NAME_ID), 14); /* licence URL */
    hb.hb_set_add(hb.hb_subset_input_set(input, SETS_LAYOUT_FEATURE_TAG), tag("tnum")); /* site.css: tabular-nums */
    hb.hb_subset_input_set_flags(input, hb.hb_subset_input_get_flags(input) | FLAGS_NO_HINTING);
    if (!hb.hb_subset_input_set_axis_range(input, face, tag("wght"), f.weight[0], f.weight[1], NaN)) throw new Error(`${f.family}: cannot cut wght to ${f.weight.join("-")}`);
    for (const a of f.pin) if (!hb.hb_subset_input_pin_axis_to_default(input, face, tag(a))) throw new Error(`${f.family}: cannot pin ${a}`);
    const result = hb.hb_subset_or_fail(face, input);
    if (!result) throw new Error(`${f.family}: the subset failed`);
    const out = hb.hb_face_reference_blob(result);
    const len = hb.hb_blob_get_length(out);
    const bytes = new Uint8Array(hb.memory.buffer, hb.hb_blob_get_data(out, 0), len).slice();
    hb.hb_blob_destroy(out); hb.hb_face_destroy(result);
    return bytes;
  } finally {
    hb.hb_subset_input_destroy(input); hb.hb_face_destroy(face); hb.hb_blob_destroy(blob); hb.free(at);
  }
}

const tmp = mkdtempSync(join(tmpdir(), "orbit-fonts-"));
const faces = [];
try {
  for (const f of FAMILIES) {
    const v = f.tag.replace(/^v/, ""), name = (s) => s.replaceAll("{v}", v);
    const url = `https://github.com/${f.repo}/releases/download/${f.tag}/${name(f.asset)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const zip = Buffer.from(await res.arrayBuffer());
    const sum = createHash("sha256").update(zip).digest("hex");
    if (sum !== f.sha256) throw new Error(`${url}: sha256 is ${sum}, want ${f.sha256} (a new release: set its sha256 here)`);
    const zipPath = join(tmp, name(f.asset));
    writeFileSync(zipPath, zip);
    /* unzip reads a name as a pattern: [wght] would be a character class */
    const take = (member) => execFileSync("unzip", ["-p", zipPath, member.replace(/[[\]*?\\]/g, "\\$&")], { maxBuffer: 64 << 20 });
    const ttf = take(name(f.ttf));
    const woff2 = Buffer.from(await wawoff2.compress(trim(ttf, f)));
    writeFileSync(join(OUT, f.file), woff2);
    writeFileSync(join(OUT, f.licenceFile), take(name(f.licence)));
    console.log(`${f.file}: ${f.family} ${f.tag}, weights ${f.weight.join("-")}, ${woff2.length} bytes (from ${ttf.length})`);
    faces.push(`/* ${f.family}: release ${f.tag} of github.com/${f.repo} (${name(f.asset)}, ${name(f.ttf)}), licence ${f.licenceFile} */
@font-face {
  font-family: "${f.family}";
  font-style: normal;
  font-weight: ${f.weight.join(" ")};
  font-display: swap;
  src: url(${f.file}) format("woff2");
  unicode-range: ${UNICODE_RANGE};
}`);
  }
} finally { rmSync(tmp, { recursive: true, force: true }); }

writeFileSync(join(OUT, "fonts.css"), `/* The site's three typefaces, served from the site itself (#92). Written by tools/fonts.mjs, which says how each is
   trimmed (latin, the weights the pages use); run it rather than editing this. Licences: SIL Open Font License 1.1,
   OFL-*.txt beside them. jetbrains-mono-latin.woff2 is also the file the door's worker is given to write with
   (ADR-0004 6a, settings.fonts). */
${faces.join("\n")}
`);
