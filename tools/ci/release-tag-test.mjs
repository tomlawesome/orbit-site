/*
 * Test for the release tag under the door's wordmark (#63), written from the decision and build notes alone, before
 * the code. dawnMarkup and duskMarkup (asDawn included) take `tag`, a string:
 *   - empty or missing: the markup is byte for byte what it was before the option;
 *   - else, right after the .name element: <div class="release" data-channel="C">W</div>, W the tag's first word and
 *     C that word if it is alpha, beta or preview, else "build"; anything after the first whitespace is the build,
 *     <span class="build">…</span> after "W ";
 *   - the tag is TEXT, escaped: no element and no attribute can come out of it, by the channel word or the build.
 * The site passes no tag, so index.html must not change (`node tools/door-markup.mjs --check`).
 *
 *   node tools/ci/release-tag-test.mjs
 *
 * No dependencies and no browser: the markup functions are pure string functions.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { dawnMarkup, duskMarkup } from "../../assets/door/markup.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};
const sha = (s) => createHash("sha256").update(s).digest("hex");
const image = (p) => `IMG/${p}`;
const GATE = '<button class="gate" type="button">Sign in</button>';
const FOOT = '<p class="foot">credit</p>';
const LOCK = '<div class="planets"></div>';
const FULL = { image, lockup: LOCK, gate: GATE, foot: FOOT, indent: "  " };

/* the surfaces, each with option sets. `today(s)` is the sha256 of the markup the code writes now with no tag,
   worked out from the current files, so an edit to the door's markup does not break the byte-for-byte checks; that
   the site's page matches the writer is checked in 6 */
const SURFACES = {
  "dawn, image only": { fn: dawnMarkup, opts: { image } },
  "dawn, slots and indent": { fn: dawnMarkup, opts: FULL },
  "dawn, heading: false": { fn: dawnMarkup, opts: { ...FULL, heading: false } },
  "dusk, image only": { fn: duskMarkup, opts: { image } },
  "dusk, gate foot farewell indent": { fn: duskMarkup, opts: { image, gate: GATE, foot: FOOT, farewell: { said: "Goodbye", sub: "see you" }, indent: "  " } },
  "dusk, asDawn": { fn: duskMarkup, opts: { image, gate: GATE, foot: FOOT, asDawn: true, indent: "  " } },
  "dusk, asDawn, image only": { fn: duskMarkup, opts: { image, asDawn: true } },
};

const today = (s) => sha(s.fn(s.opts));

/* ---- 1. no tag: byte for byte today's ---- */
for (const [name, s] of Object.entries(SURFACES)) {
  const want = today(s);
  const got = (o) => sha(s.fn(o));
  check(`1. ${name}, no tag: the same bytes as today`, got(s.opts) === want, got(s.opts) === want ? "sha256 matches" : `sha256 ${got(s.opts).slice(0, 12)}… (today: ${want.slice(0, 12)}…)`);
  check(`1. ${name}, tag: "": the same bytes as today`, got({ ...s.opts, tag: "" }) === want, got({ ...s.opts, tag: "" }) === want ? "sha256 matches" : "differs");
  check(`1. ${name}, tag: undefined: the same bytes as today`, got({ ...s.opts, tag: undefined }) === want, got({ ...s.opts, tag: undefined }) === want ? "sha256 matches" : "differs");
  check(`1. ${name}, no tag: no .release element`, !/class="release"/.test(s.fn(s.opts)), "none written");
}

/* ---- helpers for reading what the tag added ---- */
const NAME = /<(?:h1|div) class="name">orbit<\/(?:h1|div)>/g;
/* what the tag added: the tagged markup is the plain markup with one string put in right after the .name element.
   Returns { inserted, lead } or null if that is not how they differ */
function added(s, tag) {
  const plain = s.fn(s.opts), tagged = s.fn({ ...s.opts, tag });
  const names = [...plain.matchAll(NAME)];
  if (names.length !== 1) return { error: `${names.length} .name elements in the plain markup` };
  const at = names[0].index + names[0][0].length;
  const head = plain.slice(0, at), tail = plain.slice(at);
  if (!tagged.startsWith(head) || !tagged.endsWith(tail) || tagged.length < plain.length) return { error: "the tagged markup is not the plain markup with one string put in after .name" };
  const inserted = tagged.slice(at, tagged.length - tail.length);
  const lead = plain.slice(0, at).match(/(?:^|\n)([ \t]*)<(?:h1|div) class="name">orbit<\/(?:h1|div)>$/)[1];
  return { inserted, lead, tagged };
}
const decode = (t) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&amp;/g, "&");
const ENTITY_OK = /&(?!amp;|lt;|gt;|quot;|#39;|#x27;)/;
const channelOf = (w) => (["alpha", "beta", "preview"].includes(w) ? w : "build");

/* ---- 2. the exact markup for plain tags, on every surface and indent ---- */
const CASES = [
  ["alpha", '<div class="release" data-channel="alpha">alpha</div>'],
  ["beta", '<div class="release" data-channel="beta">beta</div>'],
  ["preview 3f2a9c1", '<div class="release" data-channel="preview">preview <span class="build">3f2a9c1</span></div>'],
  ["preview", '<div class="release" data-channel="preview">preview</div>'],
  ["nightly 20261015", '<div class="release" data-channel="build">nightly <span class="build">20261015</span></div>'],
  ["nightly", '<div class="release" data-channel="build">nightly</div>'],
  ["v1.2.3-rc1", '<div class="release" data-channel="build">v1.2.3-rc1</div>'],
];
for (const [name, s] of Object.entries(SURFACES)) {
  for (const [tag, html] of CASES) {
    const a = added(s, tag);
    const ok = !a.error && a.inserted === `\n${a.lead}${html}`;
    check(`2. ${name}, tag ${JSON.stringify(tag)}: ${html}`, ok, a.error || (ok ? "right after .name, on a line of its own at the name's indent" : `got ${JSON.stringify(a.inserted)}`));
  }
  const tagged = s.fn({ ...s.opts, tag: "preview 3f2a9c1" });
  check(`2. ${name}: the tag is written once, and nothing else in the markup changes`, tagged.split("3f2a9c1").length === 2 && (tagged.match(/class="release"/g) || []).length === 1, "one .release, the build once");
}

/* ---- 3. the channel is a fixed set: an unknown first word is "build", and no other word makes a channel ---- */
for (const word of ["gamma", "stable", "Release", "alphabet", "preview-2", "dev"]) {
  const a = added(SURFACES["dawn, slots and indent"], `${word} abc123`);
  check(`3. an unknown first word (${word}) gives data-channel="build"`, !a.error && a.inserted.includes('data-channel="build"') && !/data-channel="(alpha|beta|preview)"/.test(a.inserted), a.error || (a.inserted.match(/data-channel="[^"]*"/) || ["no data-channel"])[0]);
}

/* ---- 4. escaping: the tag is text; nothing of it is markup, by the channel word or by the build ---- */
const HOSTILE = [
  "<b>x</b>",
  "alpha <i>1</i>",
  'preview "><img src=x onerror=alert(1)>',
  '"><script>alert(1)</script>',
  'x" onmouseover="alert(1) rest',
  "' onfocus='alert(1)' autofocus x='",
  "</div><div class=\"gate\">",
  "preview </span></div><a href=//evil>x</a>",
  "alpha<img src=x>",
  "a&b c&amp;d &lt;e&gt;",
  "preview &#60;script&#62;",
  "<!-- x --> y",
];
/* reads the release element the way a parser would: the div, its attribute, the text, and at most one span.build */
function inert(inserted, lead, tag) {
  const m = inserted.match(/^\n([ \t]*)<div class="release" data-channel="(alpha|beta|preview|build)">([\s\S]*)<\/div>$/);
  if (!m) return "the .release element is not <div class=\"release\" data-channel=\"…\"> with only a fixed channel";
  if (m[1] !== lead) return "not at the name's indent";
  let inner = m[3], build = null;
  const sp = inner.match(/^([^<>]*) <span class="build">([^<>]*)<\/span>$/);
  if (sp) { inner = sp[1]; build = sp[2]; }
  if (/[<>]/.test(inner) || (build !== null && /[<>]/.test(build))) return "a raw < or > is left in the text";
  if (ENTITY_OK.test(m[3])) return "a raw & is left in the text";
  const wantChannel = channelOf(tag.split(/\s+/)[0]);
  if (m[2] !== wantChannel) return `data-channel is ${m[2]}, wanted ${wantChannel}`;
  const text = decode(inner) + (build !== null ? " " + decode(build) : "");
  if (text !== tag) return `the text reads back as ${JSON.stringify(text)}, not the tag`;
  return null;
}
for (const [name, s] of Object.entries(SURFACES)) {
  for (const tag of HOSTILE) {
    const a = added(s, tag);
    const why = a.error || inert(a.inserted, a.lead, tag);
    check(`4. ${name}, tag ${JSON.stringify(tag)}: only the .release div (and its .build span), the tag read back as text`, !why, why || "inert");
  }
}
/* a tag with no whitespace at all and markup in it cannot add a span, and a build with markup cannot add a tag */
{
  const s = SURFACES["dusk, asDawn"], a = added(s, 'preview <span class="build">x</span>');
  const spans = (a.inserted.match(/<span\b/g) || []).length;
  check("4. a tag that spells out a span adds none of its own (the one span is the build's)", !a.error && spans === 1 && a.inserted.includes("&lt;span"), a.error || `${spans} <span`);
}

/* ---- 5. the README documents it ---- */
const readme = readFileSync(join(root, "assets", "door", "README.md"), "utf8");
const sec = (from, to) => { const a = readme.indexOf(from), b = readme.indexOf(to, a + 1); return a < 0 ? "" : readme.slice(a, b < 0 ? undefined : b); };
const markupSec = sec("### Markup (`markup.js`)", "### Stylesheet");
check("5. the Markup section lists tag in dawnMarkup's options", /dawnMarkup\(\{[^)]*\btag\b/.test(markupSec), "dawnMarkup({ … tag … })");
check("5. the Markup section lists tag in duskMarkup's options", /duskMarkup\(\{[^)]*\btag\b/.test(markupSec), "duskMarkup({ … tag … })");
{
  const m = /`tag`/.exec(markupSec), near = m ? markupSec.slice(m.index, m.index + 300) : "";
  check("5. the Markup section says `tag` is text and escaped", !!m && /\btext\b/i.test(near) && /escaped/i.test(near), m ? "`tag` … text … escaped" : "no `tag` entry");
}
check("5. the stylesheet contract lists .release", /\.release\b/.test(sec("### Stylesheet", "### What the folder touches")), ".release in the Stylesheet section");

/* ---- 6. the site passes no tag: its page is unchanged ---- */
const r = spawnSync(process.execPath, [join(root, "tools", "door-markup.mjs"), "--check"], { encoding: "utf8", cwd: root });
check("6. index.html is unchanged by the writer (--check exits 0)", r.status === 0, `exit ${r.status}: ${(r.stdout + r.stderr).trim().split("\n")[0]}`);
check("6. index.html has no .release", !/class="release"/.test(readFileSync(join(root, "index.html"), "utf8")), "none in the page");
/* ---- 7. review fixes: only a string is a tag ---- */
for (const [name, sf] of Object.entries(SURFACES)) {
  for (const [label, v] of [["false", false], ["0", 0], ["null", null], ["{}", {}], ["[]", []], ["true", true], ["1", 1]]) {
    const got = sha(sf.fn({ ...sf.opts, tag: v }));
    check(`7. ${name}, tag: ${label} (not a string): the same bytes as today`, got === today(sf), got === today(sf) ? "sha256 matches" : "a tag was written");
  }
}

/* ---- 8. the first word picks the channel in any case; the markup keeps the host's text ---- */
const CASE_CASES = [
  ["Alpha", '<div class="release" data-channel="alpha">Alpha</div>'],
  ["ALPHA", '<div class="release" data-channel="alpha">ALPHA</div>'],
  ["Beta", '<div class="release" data-channel="beta">Beta</div>'],
  ["PREVIEW 3F2A9C1", '<div class="release" data-channel="preview">PREVIEW <span class="build">3F2A9C1</span></div>'],
  ["Preview 3f2a9c1", '<div class="release" data-channel="preview">Preview <span class="build">3f2a9c1</span></div>'],
  ["Alphabet", '<div class="release" data-channel="build">Alphabet</div>'],
  ["BETAS 1", '<div class="release" data-channel="build">BETAS <span class="build">1</span></div>'],
];
for (const [name, sf] of Object.entries(SURFACES)) {
  for (const [tag, html] of CASE_CASES) {
    const a = added(sf, tag);
    const ok = !a.error && a.inserted === `\n${a.lead}${html}`;
    check(`8. ${name}, tag ${JSON.stringify(tag)}: ${html}`, ok, a.error || (ok ? "channel by any case, text as given" : `got ${JSON.stringify(a.inserted)}`));
  }
}

/* ---- 9. any run of whitespace becomes one space; one element per line ---- */
const WS = [
  ["preview\t3f2a9c1", '<div class="release" data-channel="preview">preview <span class="build">3f2a9c1</span></div>'],
  ["preview\n3f2a9c1", '<div class="release" data-channel="preview">preview <span class="build">3f2a9c1</span></div>'],
  ["preview\r\n3f2a9c1", '<div class="release" data-channel="preview">preview <span class="build">3f2a9c1</span></div>'],
  ["preview\u20283f2a9c1", '<div class="release" data-channel="preview">preview <span class="build">3f2a9c1</span></div>'],
  ["preview\u20293f2a9c1", '<div class="release" data-channel="preview">preview <span class="build">3f2a9c1</span></div>'],
  ["preview\u00a03f2a9c1", '<div class="release" data-channel="preview">preview <span class="build">3f2a9c1</span></div>'],
  ["preview\u00853f2a9c1", '<div class="release" data-channel="preview">preview <span class="build">3f2a9c1</span></div>'],
  ["nightly a\u0085b", '<div class="release" data-channel="build">nightly <span class="build">a b</span></div>'],
  ["preview \t\n \u00a0  3f2a9c1", '<div class="release" data-channel="preview">preview <span class="build">3f2a9c1</span></div>'],
  ["nightly a\tb\n\nc\u00a0\u00a0d", '<div class="release" data-channel="build">nightly <span class="build">a b c d</span></div>'],
];
for (const [name, sf] of Object.entries(SURFACES)) {
  for (const [tag, html] of WS) {
    const a = added(sf, tag);
    const ok = !a.error && a.inserted === `\n${a.lead}${html}`;
    check(`9. ${name}, tag ${JSON.stringify(tag)}: whitespace folded to one space`, ok, a.error || (ok ? "one space, one line" : `got ${JSON.stringify(a.inserted)}`));
  }
  const a = added(sf, "alpha\n<b>\u2028x\u00a0y\u0085z</b>");
  check(`9. ${name}: a tag with line breaks writes no newline, U+2028 or non-breaking space of its own`, !a.error && a.inserted.split("\n").length === 2 && !/[\u0085\u2028\u2029\u00a0\r]/.test(a.inserted), a.error || `${a.inserted.split("\n").length - 1} newline(s) in what was added`);
}

/* ---- 10. the stylesheet: the long tag, the case, the line height (read as text) ---- */
const css = readFileSync(join(root, "assets", "door", "door.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const base = rules.find((r) => r.sel.split(",").map((x) => x.trim()).includes(".lockup .release"));
const decl = (body, prop) => { const m = body.match(new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`)); return m ? m[1].trim() : null; };
check("10. door.css has a `.lockup .release` rule", !!base, base ? "found" : "none");
if (base) {
  check("10. .release: text-transform: lowercase", decl(base.body, "text-transform") === "lowercase", `text-transform: ${decl(base.body, "text-transform")}`);
  check("10. .release: has a max-width (never wider than the ring's inside)", !!decl(base.body, "max-width"), `max-width: ${decl(base.body, "max-width")}`);
  check("10. .release: text-overflow: ellipsis", decl(base.body, "text-overflow") === "ellipsis", `text-overflow: ${decl(base.body, "text-overflow")}`);
  const ov = decl(base.body, "overflow") || decl(base.body, "overflow-x");
  check("10. .release: overflow hidden (so the ellipsis takes effect)", ov === "hidden", `overflow: ${ov}`);
  const fi = base.body.search(/(?:^|[;\s])font\s*:/), li = base.body.search(/(?:^|[;\s])line-height\s*:/);
  check("10. .release: line-height is declared after the font shorthand (which would reset it)", fi >= 0 && li >= 0 && li > fi, `font at ${fi}, line-height at ${li}`);
}

/* ---- 11. the README no longer says Orbit passes it today ---- */
check("11. the README does not say Orbit passes its channel (it does not yet)", !/Orbit\s+passes\b/i.test(readme), /Orbit\s+passes\b/i.test(readme) ? "still says Orbit passes it" : "no such claim");
check("11. the README says Orbit will pass its channel or short commit", /Orbit\s+will\s+pass/i.test(readme), /Orbit\s+will\s+pass/i.test(readme) ? "found" : "no `Orbit will pass`");
process.exit(failed ? 1 : 0);
