/*
 * Test for the pure helpers of the docs importer: plain() (the text that
 * search and summaries use), resolveLink() (what a link or picture address
 * becomes) and the warning for raw html that sanitising dropped.
 *
 *   npm ci --prefix tools --ignore-scripts && node tools/ci/import-docs-test.mjs
 *
 * tools/import-docs.mjs fetches and writes files the moment it is imported, so
 * it cannot be imported here. The helpers are expected in tools/import-docs-lib.mjs
 * (assumed name), exported as: plain(tokens), resolveLink(href, src,
 * bySourcePath, isImage) and droppedBlockWarning(src, htmlIn, htmlOut), which
 * returns the warning text, or "" / null / undefined for no warning; and the
 * heading ids: slugOf(text) (the id a heading's text gives, "" when nothing
 * is left) and slugger() (a function that gives each heading of one page its
 * id, unique and never empty), both ASCII only, as the page and the checks
 * accept. Needs `marked`. No network.
 *
 * Pictures (#72): the page's policy is img-src 'self' data: blob:, so the import copies each picture into the site.
 * Also expected: resolveLink(href, src, bySourcePath, isImage, pictures), pictureFile(href, src, repos) and
 * pictureName(bytes) (see the cases below), and `node tools/import-docs.mjs --from DIR --out OUT`, run here
 * end to end on a scratch checkout, from a scratch copy of tools/ so that the real assets/docs is never touched.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import { checkDocs } from "./docs-shape.mjs";

let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};

let lib, marked;
try {
  ({ marked } = await import("marked"));
  lib = await import("../import-docs-lib.mjs");
} catch (e) {
  check("tools/import-docs-lib.mjs and marked load", false, `import failed: ${e.message}`);
  process.exit(1);
}
for (const n of ["plain", "resolveLink", "droppedBlockWarning"]) {
  if (typeof lib[n] !== "function") {
    check(`tools/import-docs-lib.mjs exports ${n}`, false, `got ${typeof lib[n]}`);
    failed = true;
  }
}
if (failed) process.exit(1);
const { plain, resolveLink, droppedBlockWarning } = lib;
// the picture helpers (#72) are checked case by case below, so a missing one fails each case and not just the load
for (const n of ["pictureFile", "pictureName"]) {
  if (typeof lib[n] !== "function") check(`tools/import-docs-lib.mjs exports ${n}`, false, `got ${typeof lib[n]}`);
}
// the heading-id helpers are checked case by case below, so a missing one fails each case and not just the load
for (const n of ["slugOf", "slugger"]) {
  if (typeof lib[n] !== "function") check(`tools/import-docs-lib.mjs exports ${n}`, false, `got ${typeof lib[n]}`);
}

const text = (md) => { try { return plain(marked.lexer(md)); } catch (e) { return `threw: ${e.message}`; } };
const eq = (name, got, want) => check(name, got === want, `gave ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);

// T4: plain() keeps escaped characters, image alt text and table header cells.
eq("T4 an escaped asterisk keeps the asterisk", text("Use 2 \\* 3 here"), "Use 2 * 3 here");
eq("T4 other escaped characters stay", text("a \\_b\\_ and \\#tag"), "a _b_ and #tag");
eq("T4 image alt text is kept", text("See ![the launcher splash](a.png) now"), "See the launcher splash now");
{
  const got = text("| Name | Role |\n| --- | --- |\n| Ann | Lead |\n");
  check("T4 table header cells are kept", got.includes("Name") && got.includes("Role") && got.includes("Ann") && got.includes("Lead"),
    `gave ${JSON.stringify(got)} (want Name, Role, Ann and Lead)`);
}

// T5: resolveLink() no longer passes a data: address through.
const src = { repo: "tomlawesome/orbit", path: "README.md" };
const bySourcePath = new Map([[`${src.repo}:${src.path}`, { ...src, slug: "readme" }]]);
const link = (h, image = false) => { try { return resolveLink(h, src, bySourcePath, image, new Map()); } catch (e) { return `threw: ${e.message}`; } };
const notData = (name, h, image) => {
  const got = link(h, image);
  check(name, !/^\s*data:/i.test(String(got ?? "")) && !String(got).startsWith("threw:"),
    `${JSON.stringify(h)} gave ${JSON.stringify(got)} (want not starting with data:)`);
};
notData("T5 a data: link is not passed through", "data:text/html,<b>x</b>", false);
notData("T5 a DATA: link in any case is not passed through", "DATA:text/html;base64,AAAA", false);
notData("T5 a data: picture is not passed through", "data:image/png;base64,AAAA", true);
eq("T5 an https link is unchanged", link("https://example.com/a?b=1"), "https://example.com/a?b=1");
eq("T5 an http link is unchanged", link("http://example.com/a"), "http://example.com/a");
eq("T5 a mailto link is unchanged", link("mailto:a@example.com"), "mailto:a@example.com");
{
  const got = link("#frag");
  check("T5 an #anchor stays an anchor", typeof got === "string" && got.startsWith("#") && got.includes("frag"),
    `gave ${JSON.stringify(got)} (want a string starting with # and holding frag)`);
}

// T6: the dropped-block warning compares the visible text in and out.
const warn = (inn, out) => { try { return droppedBlockWarning(src, inn, out); } catch (e) { return `threw: ${e.message}`; } };
const warns = (inn, out) => { const w = warn(inn, out); return !!w && !String(w).startsWith("threw:"); };
check("T6 an empty output after visible text warns", warns("<p>Hello world</p>", ""), `gave ${JSON.stringify(warn("<p>Hello world</p>", ""))} (want a warning)`);
check("T6 a comment-only block does not warn", !warn("<!-- just a note -->", ""), `gave ${JSON.stringify(warn("<!-- just a note -->", ""))} (want none)`);
check("T6 a whitespace-only block does not warn", !warn("  \n ", ""), `gave ${JSON.stringify(warn("  \n ", ""))} (want none)`);
check("T6 a partial drop warns", warns("<p>alpha</p><p>beta</p>", "<p>alpha</p>"),
  `gave ${JSON.stringify(warn("<p>alpha</p><p>beta</p>", "<p>alpha</p>"))} (want a warning)`);
check("T6 nothing lost does not warn", !warn("<p>alpha &amp; beta</p>", "<p>alpha &amp; beta</p>"),
  `gave ${JSON.stringify(warn("<p>alpha &amp; beta</p>", "<p>alpha &amp; beta</p>"))} (want none)`);
check("T6 only markup lost does not warn", !warn("<p align=\"x\" onclick=\"y\">alpha</p>", "<p>alpha</p>"),
  `gave ${JSON.stringify(warn("<p align=\"x\" onclick=\"y\">alpha</p>", "<p>alpha</p>"))} (want none)`);
{
  const w = String(warn("<p>\u001b[31mred\u001b[0m\r\nline two \u0007bell</p>", ""));
  check("T6 control characters in fetched text are stripped from the warning", w !== "" && w !== "null" && !/[\u0000-\u001f\u007f]/.test(w),
    `gave ${JSON.stringify(w)} (want a warning with no control characters)`);
}

// S1-S4: slugOf() keeps ASCII letters and digits, folds accents to their letters, drops the rest.
const slug = (h) => { try { return lib.slugOf(h); } catch (e) { return `threw: ${e.message}`; } };
eq("S1 slugOf('Quick start')", slug("Quick start"), "quick-start");
eq("S1 slugOf('R&D')", slug("R&D"), "rd");
eq("S1 slugOf('<b>Bold</b> title')", slug("<b>Bold</b> title"), "bold-title");
eq("S1 slugOf('a b')", slug("a b"), "a-b");
eq("S2 slugOf('Über Orbit')", slug("Über Orbit"), "uber-orbit");
eq("S2 slugOf('Café')", slug("Café"), "cafe");
eq("S2 slugOf('naïve façade')", slug("naïve façade"), "naive-facade");
eq("S2 slugOf('x²')", slug("x²"), "x2");
eq("S3 slugOf('🚀 Launch')", slug("🚀 Launch"), "-launch");
eq("S3 slugOf('日本語 docs')", slug("日本語 docs"), "-docs");
eq("S3 slugOf('Ωmega')", slug("Ωmega"), "mega");
eq("S4 slugOf('🚀') is empty", slug("🚀"), "");
eq("S4 slugOf('???') is empty", slug("???"), "");

// S5: slugger() never gives an empty id, and a repeat gets a number.
{
  let id;
  try { id = lib.slugger(); } catch (e) { id = () => `threw: ${e.message}`; }
  const next = (h) => { try { return id(h); } catch (e) { return `threw: ${e.message}`; } };
  eq("S5 slugger()('🚀') is section", next("🚀"), "section");
  eq("S5 then ('🎉') is section-1", next("🎉"), "section-1");
  eq("S5 then ('Section') is section-2", next("Section"), "section-2");
  eq("S5 then ('Über') is uber", next("Über"), "uber");
  eq("S5 then ('Uber') is uber-1", next("Uber"), "uber-1");
  eq("S5 then ('Café') is cafe", next("Café"), "cafe");
}

// S6: whatever the heading, the id is what the page's checks accept (their regex, written out).
for (const h of ["Über", "日本語", "🚀", "a b", "x²", "Ωmega", "<b>Bold</b>", "R&D", "", " "]) {
  let got;
  try { got = lib.slugger()(h); } catch (e) { got = `threw: ${e.message}`; }
  check(`S6 slugger()(${JSON.stringify(h)}) matches /^[a-z0-9-]+$/`, typeof got === "string" && /^[a-z0-9-]+$/.test(got),
    `gave ${JSON.stringify(got)} (want lower-case letters, digits and dashes only)`);
}

// S7-S9: a link to a heading is made from the same id the heading gets.
const srcR = { ...src, slug: "readme" };
const linkR = (h) => { try { return resolveLink(h, srcR, bySourcePath, false, new Map()); } catch (e) { return `threw: ${e.message}`; } };
eq("S7 '#über-orbit' points at uber-orbit", linkR("#über-orbit"), "#docs/readme/uber-orbit");
eq("S7 '#Quick-Start' points at quick-start", linkR("#Quick-Start"), "#docs/readme/quick-start");
eq("S7 '#-launch' keeps its dash", linkR("#-launch"), "#docs/readme/-launch");
eq("S7 '#🚀' points at the page", linkR("#🚀"), "#docs/readme");
eq("S7 '#' points at the page", linkR("#"), "#docs/readme");
{
  const map = new Map([[`${src.repo}:docs/x.md`, { repo: src.repo, path: "docs/x.md", slug: "x" }]]);
  const to = (h) => { try { return resolveLink(h, srcR, map, false, new Map()); } catch (e) { return `threw: ${e.message}`; } };
  eq("S8 'docs/x.md#Über' points at uber in the other source", to("docs/x.md#Über"), "#docs/x/uber");
  eq("S8 'docs/x.md' points at the other source", to("docs/x.md"), "#docs/x");
  eq("S9 a link out keeps its anchor as written", to("OTHER.md#Über"), "https://github.com/tomlawesome/orbit/blob/main/OTHER.md#Über");
}

// S10: a percent-encoded fragment (as editors write non-ASCII anchors) is decoded
// before folding, so it lands on the same id as the raw form.
eq("S10a '#caf%C3%A9' points at cafe, like '#café'", linkR("#caf%C3%A9"), "#docs/readme/cafe");
eq("S10b '#%C3%9Cber-orbit' points at uber-orbit", linkR("#%C3%9Cber-orbit"), "#docs/readme/uber-orbit");
{
  const map = new Map([[`${src.repo}:docs/x.md`, { repo: src.repo, path: "docs/x.md", slug: "x" }]]);
  const to = (h) => { try { return resolveLink(h, srcR, map, false, new Map()); } catch (e) { return `threw: ${e.message}`; } };
  eq("S10c 'docs/x.md#%C3%9Cber' points at uber in the other source", to("docs/x.md#%C3%9Cber"), "#docs/x/uber");
  eq("S10e a link out keeps its percent-encoded anchor as written", to("OTHER.md#caf%C3%A9"), "https://github.com/tomlawesome/orbit/blob/main/OTHER.md#caf%C3%A9");
}
for (const bad of ["#100%-sure", "#%E0%A4%A"]) {
  const got = linkR(bad);
  check(`S10d ${JSON.stringify(bad)} does not throw and gives a clean fragment`,
    typeof got === "string" && /^#docs\/readme(\/[a-z0-9-]+)?$/.test(got),
    `gave ${JSON.stringify(got)} (want #docs/readme, optionally /<a-z0-9- only>)`);
}

// ---------------------------------------------------------------- pictures (#72) --
const sha16 = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);
const crcTable = Array.from({ length: 256 }, (_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (seed) => { // a real 1x1 PNG whose pixel colour is the seed
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([PNG_SIG, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from([0, seed & 255, (seed >> 8) & 255, (seed >> 16) & 255]))), chunk("IEND", Buffer.alloc(0))]);
};
const jpg = (seed) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, seed & 255, 0xff, 0xd9]);
const gif = (seed, v = "GIF89a") => Buffer.concat([Buffer.from(v, "latin1"), Buffer.from([1, 0, 1, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 1, seed & 255, 0, 0x3b])]);
const webp = (seed) => { const tail = Buffer.concat([Buffer.from("WEBPVP8L", "latin1"), Buffer.from([5, 0, 0, 0, 0x2f, 0, 0, 0, seed & 255, 0])]); const n = Buffer.alloc(4); n.writeUInt32LE(tail.length); return Buffer.concat([Buffer.from("RIFF", "latin1"), n, tail]); };
const MIB = 1048576;
const padded = (head, size) => Buffer.concat([head, Buffer.alloc(size - head.length)]);

// P1: pictureName(bytes) names a picture by its own bytes.
{
  const call = (b) => { try { return lib.pictureName(b); } catch (e) { return `threw: ${e.message}`; } };
  const named = (name, bytes, ext) => eq(name, call(bytes), `${sha16(bytes)}.${ext}`);
  named("P1 a PNG is <16 hex of its SHA-256>.png", png(1), "png");
  named("P1 a JPEG is .jpg", jpg(2), "jpg");
  named("P1 a GIF89a is .gif", gif(3), "gif");
  named("P1 a GIF87a is .gif", gif(4, "GIF87a"), "gif");
  named("P1 a WebP is .webp", webp(5), "webp");
  eq("P1 a Uint8Array gives the same name", call(new Uint8Array(png(1))), `${sha16(png(1))}.png`);
  check("P1 the same bytes give the same name", /^[0-9a-f]{16}\.png$/.test(String(call(Buffer.from(png(6))))) && call(Buffer.from(png(6))) === call(Buffer.from(png(6))),
    `gave ${JSON.stringify(call(Buffer.from(png(6))))} twice (want the same <16 hex>.png both times)`);
  check("P1 other bytes give another name", call(png(6)) !== call(png(7)) && /^[0-9a-f]{16}\.png$/.test(call(png(7))), `${call(png(6))} / ${call(png(7))}`);
  check("P1 a one-byte change after the signature changes the name", /^[0-9a-f]{16}\.png$/.test(String(call(png(8)))) && call(Buffer.concat([png(8), Buffer.from([0])])) !== call(png(8)),
    `gave ${JSON.stringify(call(png(8)))} and ${JSON.stringify(call(Buffer.concat([png(8), Buffer.from([0])])))} (want two different <16 hex>.png names)`);
  // not a picture by its leading bytes: null, whatever the caller thinks it is
  const none = (name, bytes) => eq(name, call(bytes), null);
  none("P1 SVG text is null", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'));
  none("P1 HTML is null", Buffer.from("<!doctype html><p>x</p>"));
  none("P1 no bytes is null", Buffer.alloc(0));
  none("P1 plain text is null", Buffer.from("hello world"));
  none("P1 the word PNG is null", Buffer.from("PNG"));
  none("P1 a PNG signature cut short is null", PNG_SIG.subarray(0, 7));
  none("P1 a JPEG signature cut short is null", Buffer.from([0xff, 0xd8]));
  none("P1 GIF88a is null", gif(1, "GIF88a"));
  none("P1 RIFF without WEBP is null", Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.alloc(4), Buffer.from("WAVEfmt ", "latin1")]));
  none("P1 WEBP without RIFF is null", Buffer.concat([Buffer.alloc(8), Buffer.from("WEBP", "latin1")]));
  none("P1 a PNG signature one byte off is null", Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b]), png(1).subarray(8)]));
}

// P2: pictureFile(href, src, repos) says which file of which repo an address is, or null.
{
  const repos = ["tomlawesome/orbit", "tomlawesome/orbit-launcher"];
  const call = (h, s2 = src, r = repos) => { try { return lib.pictureFile(h, s2, r); } catch (e) { return `threw: ${e.message}`; } };
  const same = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `gave ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
  const O = "tomlawesome/orbit", L = "tomlawesome/orbit-launcher";
  const doc = { repo: O, path: "docs/authentication.md" };
  same("P2 a relative address beside a README is in its folder", call("shot.png"), { repo: O, path: "shot.png" });
  same("P2 a relative address in a folder", call("docs/img/a.png"), { repo: O, path: "docs/img/a.png" });
  same("P2 ./ is the same folder", call("./docs/img/a.png"), { repo: O, path: "docs/img/a.png" });
  same("P2 a relative address is resolved against the source's folder", call("img/a.png", doc), { repo: O, path: "docs/img/a.png" });
  same("P2 .. climbs from the source's folder", call("../assets/b.png", doc), { repo: O, path: "assets/b.png" });
  same("P2 a launcher source stays in its repo", call("shot.png", { repo: L, path: "README.md" }), { repo: L, path: "shot.png" });
  same("P2 a raw.githubusercontent.com address of a known repo", call("https://raw.githubusercontent.com/tomlawesome/orbit/main/docs/img/a.png"), { repo: O, path: "docs/img/a.png" });
  same("P2 a raw address of the other known repo", call("https://raw.githubusercontent.com/tomlawesome/orbit-launcher/main/x/y.webp"), { repo: L, path: "x/y.webp" });
  same("P2 a raw address of a repo not in the list is null", call("https://raw.githubusercontent.com/tomlawesome/orbit-launcher/main/x.png", src, [O]), null);
  same("P2 control: the same raw address with its repo in the list", call("https://raw.githubusercontent.com/tomlawesome/orbit-launcher/main/x.png", src, [O, L]), { repo: L, path: "x.png" });
  same("P2 a raw address of someone else's repo is null", call("https://raw.githubusercontent.com/someone/else/main/x.png"), null);
  same("P2 a raw address of another branch is null", call("https://raw.githubusercontent.com/tomlawesome/orbit/dev/x.png"), null);
  same("P2 an http raw address is null", call("http://raw.githubusercontent.com/tomlawesome/orbit/main/x.png"), null);
  same("P2 another host is null", call("https://example.com/a.png"), null);
  same("P2 github.com is another host and is null", call("https://github.com/tomlawesome/orbit/blob/main/a.png"), null);
  same("P2 a protocol-relative address is null", call("//example.com/a.png"), null);
  same("P2 a mailto address is null", call("mailto:a@example.com"), null);
  same("P2 a fragment is null", call("#frag"), null);
  same("P2 a data: address is null", call("data:image/png;base64,AAAA"), null);
  same("P2 a javascript: address is null", call("javascript:alert(1)"), null);
}

// P3: resolveLink() for a picture: the site's own copy, or an https address to link to, never the raw host.
{
  const O = "tomlawesome/orbit", L = "tomlawesome/orbit-launcher";
  const doc = { repo: O, path: "docs/authentication.md", slug: "sign-in" };
  const pics = new Map([[`${O}:docs/img/a.png`, "0123456789abcdef.png"], [`${L}:shot.webp`, "fedcba9876543210.webp"]]);
  const img = (h, s2 = src, p = pics) => { try { return resolveLink(h, s2, bySourcePath, true, p); } catch (e) { return `threw: ${e.message}`; } };
  eq("P3 a relative picture the import has copied is its copy", img("docs/img/a.png"), "assets/docs/img/0123456789abcdef.png");
  eq("P3 ./ and the same path give the same copy", img("./docs/img/a.png"), "assets/docs/img/0123456789abcdef.png");
  eq("P3 a relative picture from a docs page is looked up by its path in the repo", img("img/a.png", doc), "assets/docs/img/0123456789abcdef.png");
  eq("P3 .. is resolved before the lookup", img("../docs/img/a.png", doc), "assets/docs/img/0123456789abcdef.png");
  eq("P3 a raw.githubusercontent.com address of a copied picture is its copy", img("https://raw.githubusercontent.com/tomlawesome/orbit/main/docs/img/a.png"), "assets/docs/img/0123456789abcdef.png");
  eq("P3 the launcher's picture is looked up under the launcher", img("shot.webp", { repo: L, path: "README.md" }), "assets/docs/img/fedcba9876543210.webp");
  eq("P3 the same path in another repo is not the first repo's copy", img("shot.webp"), `https://github.com/${O}/blob/main/shot.webp`);
  eq("P3 a picture not copied is a link to the file in its repo", img("docs/img/other.png"), `https://github.com/${O}/blob/main/docs/img/other.png`);
  eq("P3 a picture not copied, from a docs page, links to the resolved path", img("img/other.svg", doc), `https://github.com/${O}/blob/main/docs/img/other.svg`);
  eq("P3 a raw address not copied links to github.com, never the raw host", img("https://raw.githubusercontent.com/tomlawesome/orbit/main/docs/img/other.png"), `https://github.com/${O}/blob/main/docs/img/other.png`);
  eq("P3 with no pictures, the copied one is a link", img("docs/img/a.png", src, new Map()), `https://github.com/${O}/blob/main/docs/img/a.png`);
  eq("P3 another host's picture is the address as written", img("https://example.com/p/a.png?x=1"), "https://example.com/p/a.png?x=1");
  eq("P3 the orbit mark is assets/img/mark.svg", img("docs/orbit-mark.svg", src, new Map()), "assets/img/mark.svg");
  eq("P3 the orbit mark by a raw address is assets/img/mark.svg", img("https://raw.githubusercontent.com/tomlawesome/orbit/main/docs/orbit-mark.svg", src, new Map()), "assets/img/mark.svg");
  eq("P3 a link to a copied picture's file is still the file in its repo (a link is not a picture)", (() => { try { return resolveLink("docs/img/a.png", src, bySourcePath, false, pics); } catch (e) { return `threw: ${e.message}`; } })(), `https://github.com/${O}/blob/main/docs/img/a.png`);
  eq("P3 a data: picture is still not passed through", /^\s*data:/i.test(String(img("data:image/png;base64,AAAA"))), false);
}

// ---------------------------------------------------------------- end to end (#72) --
// A scratch checkout holds every source of tools/docs-sources.json, with pictures in some. The import is run from a
// scratch copy of tools/ (so nothing it does by default can reach this checkout) as
// `node tools/import-docs.mjs --from <dir> --out <out>`; nothing is fetched: sources and pictures come from --from.
{
  const sources = JSON.parse(readFileSync("tools/docs-sources.json", "utf8"));
  const tmp = mkdtempSync(join(tmpdir(), "import-pictures-"));
  const repoCopy = join(tmp, "repo");
  cpSync("tools", join(repoCopy, "tools"), { recursive: true, filter: (p) => !/node_modules/.test(p) });
  symlinkSync(join(process.cwd(), "tools", "node_modules"), join(repoCopy, "tools", "node_modules"));
  mkdirSync(join(repoCopy, "assets", "docs"), { recursive: true });
  const O = "tomlawesome/orbit", L = "tomlawesome/orbit-launcher";
  const from = join(tmp, "checkout"), fromL = `${from}-launcher`, out = join(tmp, "out");
  const put = (dir, path, data) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), data); };

  const A = png(1000), Bj = jpg(7), C = gif(8), W = webp(9), D = png(4000), EDGE = padded(PNG_SIG, MIB), HUGE = padded(PNG_SIG, MIB + 1);
  const nA = `${sha16(A)}.png`, nB = `${sha16(Bj)}.jpg`, nC = `${sha16(C)}.gif`, nW = `${sha16(W)}.webp`, nD = `${sha16(D)}.png`, nE = `${sha16(EDGE)}.png`;
  put(from, "docs/img/a.png", A);
  put(from, "docs/img/a-copy.png", A);                  // the same bytes under another name
  put(from, "docs/img/b.png", Bj);                      // JPEG bytes in a file named .png: named by its bytes
  put(from, "docs/img/c.gif", C);
  put(from, "docs/img/d.png", D);                      // used only inside a raw-html block the sanitiser drops whole
  put(from, "docs/img/w.webp", W);
  put(from, "docs/img/edge.png", EDGE);                 // exactly 1 MiB: kept
  put(from, "docs/img/huge.png", HUGE);                 // 1 MiB and a byte: a link
  put(from, "docs/img/v.svg", '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
  put(from, "docs/img/notes.png", "this is text, not a picture");
  const bodies = {
    readme: [
      // the mark sits below Quick start, where the page begins (the source's "from"), as upstream's does
      "# Orbit", "",
      "## Quick start", "", "Intro text.", "", "<p align=\"center\"><img src=\"docs/orbit-mark.svg\" alt=\"Orbit\" width=\"52\"></p>", "",
      // one tag outside the allow-list (<picture>) makes the sanitiser drop the whole block, its <img> too
      "<p align=\"center\"><img src=\"docs/img/d.png\" alt=\"Dropped\"><picture><source srcset=\"docs/img/d.png\"></picture></p>", "",
      "![Relative shot](docs/img/a.png)", "",
      "![Same bytes](docs/img/a-copy.png)", "",
      `![Raw shot](https://raw.githubusercontent.com/${O}/main/docs/img/b.png)`, "",
      "![Edge](docs/img/edge.png)", "",
      "![Vector drawing](docs/img/v.svg)", "",
      "![Huge](docs/img/huge.png)", "",
      "![Gone](docs/img/gone.png)", "",
      "![Text](docs/img/notes.png)", "",
      "![Badge](https://img.shields.io/badge/orbit-ok-green.png)", "",
      "![](https://example.com/unnamed.png)", "",
      "<p align=\"center\"><img src=\"docs/img/c.gif\" alt=\"Raw html shot\" width=\"40\"></p>", "",
      "![Webp shot](docs/img/w.webp)", "",
      "## More", "", "Second part.", "",
    ],
  };
  const stub = (s2) => `# ${s2.name}\n\nAbout ${s2.name}.\n\n## Quick start\n\nText for ${s2.name}.\n\n## Details\n\nMore text.\n`;
  // sixteen distinct pictures for the security source (the most one source may copy) and seventeen for the launcher's
  for (let i = 0; i < 17; i++) { put(from, `sec/p${i}.png`, png(2000 + i)); put(fromL, `p${i}.png`, png(3000 + i)); }
  const writeSources = (dropForSecondRun = false) => {
    for (const s2 of sources) {
      const dir = s2.repo === O ? from : fromL;
      let md = stub(s2);
      if (s2.slug === "readme") {
        let lines = bodies.readme;
        if (dropForSecondRun) lines = lines.filter((l) => !/Webp shot|Edge|a-copy|Same bytes/.test(l));
        md = lines.join("\n");
      }
      if (s2.slug === "sign-in") md += "\n![Sign-in shot](img/a.png)\n";
      if (s2.slug === "security") md += "\n" + Array.from({ length: 16 }, (_, i) => `![Sec ${i}](sec/p${i}.png)`).join("\n\n") + "\n";
      if (s2.slug === "launcher") md += "\n" + Array.from({ length: 17 }, (_, i) => `![Launch ${i}](p${i}.png)`).join("\n\n") + "\n";
      put(dir, s2.path, md);
    }
  };
  const run = () => {
    const r = spawnSync(process.execPath, ["tools/import-docs.mjs", "--from", from, "--out", out], { cwd: repoCopy, encoding: "utf8", timeout: 120000, env: { ...process.env, NODE_NO_WARNINGS: "1" } });
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", err: r.error ? String(r.error.message) : "" };
  };
  const readPage = (slug) => JSON.parse(readFileSync(join(out, `${slug}.json`), "utf8"));
  const html = (slug) => readPage(slug).sections.map((x) => x.html).join("\n");
  const srcs = (h) => [...h.matchAll(/<img\b[^>]*?\bsrc="([^"]*)"/g)].map((m) => m[1]).sort();
  const imgFiles = () => (existsSync(join(out, "img")) ? readdirSync(join(out, "img")).sort() : []);
  const lines = (r) => r.stderr.split("\n");
  const warned = (r, what, src2) => lines(r).some((l) => l.includes(what) && (l.includes(src2.path) || l.includes(src2.slug)));
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const bySlug = Object.fromEntries(sources.map((s2) => [s2.slug, s2]));

  writeSources();
  // an unused picture is already in the output folder, as an earlier import could have left it
  mkdirSync(join(out, "img"), { recursive: true });
  writeFileSync(join(out, "img", "0123456789abcdef.png"), png(99));
  writeFileSync(join(out, "img", "fedcba9876543210.jpg"), jpg(99));
  const r1 = run();
  check("E1 the import with --from and --out exits 0", r1.status === 0, `status ${r1.status}${r1.err ? " " + r1.err : ""}; stderr: ${r1.stderr.slice(0, 300)}`);
  const pagesOk = sources.every((s2) => existsSync(join(out, `${s2.slug}.json`))) && existsSync(join(out, "index.json"));
  check("E1 the pages and the index are written to --out", pagesOk, `found ${existsSync(out) ? readdirSync(out).join(",") : "no out folder"}`);
  check("E1 the default assets/docs of the scratch copy was not written (--out replaces it)", !existsSync(join(repoCopy, "assets", "docs", "index.json")),
    `${existsSync(join(repoCopy, "assets", "docs")) ? readdirSync(join(repoCopy, "assets", "docs")).join(",") : ""} is in assets/docs`);

  if (pagesOk) {
    const want = [nA, nB, nC, nE, nW, ...Array.from({ length: 16 }, (_, i) => `${sha16(png(2000 + i))}.png`), ...Array.from({ length: 16 }, (_, i) => `${sha16(png(3000 + i))}.png`)].sort();
    const have = imgFiles();
    check("E2 img/ holds exactly the pictures the sections use (37 files; the pre-seeded unused ones are gone)",
      JSON.stringify(have) === JSON.stringify(want), `has ${have.length} files, want ${want.length}; missing ${JSON.stringify(want.filter((x) => !have.includes(x)))}; extra ${JSON.stringify(have.filter((x) => !want.includes(x)))}`);
    check("E2 the unused pictures that were already there are removed", !have.includes("0123456789abcdef.png") && !have.includes("fedcba9876543210.jpg"), `has ${JSON.stringify(have.filter((x) => /^(0123|fedc)/.test(x)))}`);
    const content = (n, b) => existsSync(join(out, "img", n)) && readFileSync(join(out, "img", n)).equals(b);
    check("E2 each file holds the picture's own bytes", content(nA, A) && content(nB, Bj) && content(nC, C) && content(nW, W) && content(nE, EDGE), "a file differs from its source");
    check("E2 JPEG bytes in a file named .png are written as .jpg", have.includes(nB) && !have.includes(`${sha16(Bj)}.png`), `has ${have.filter((x) => x.startsWith(sha16(Bj)))}`);

    const hr = html("readme");
    const base = "assets/docs/img/";
    const gotSrc = srcs(hr);
    const wantSrc = [`${base}${nA}`, `${base}${nB}`, `${base}${nC}`, `${base}${nE}`, `${base}${nW}`, "assets/img/mark.svg"].sort();
    // the same bytes twice (a.png and a-copy.png) are one file, used twice
    check("E3 the readme's pictures are its copies, the mark stays assets/img/mark.svg, and the same bytes are one file",
      JSON.stringify([...new Set(gotSrc)]) === JSON.stringify(wantSrc) && gotSrc.filter((x) => x === `${base}${nA}`).length === 2,
      `img srcs ${JSON.stringify(gotSrc)} (want ${JSON.stringify(wantSrc)}, the first twice)`);
    check("E3 a raw.githubusercontent.com picture of a known repo is copied", gotSrc.includes(`${base}${nB}`), `img srcs ${JSON.stringify(gotSrc)}`);
    check("E3 a picture in raw html is copied", gotSrc.includes(`${base}${nC}`), `img srcs ${JSON.stringify(gotSrc)}`);
    check("E3 a picture of exactly 1 MiB is kept", gotSrc.includes(`${base}${nE}`), `img srcs ${JSON.stringify(gotSrc)}`);
    const hs = html("sign-in");
    check("E3 the same bytes from another source use the same file", JSON.stringify(srcs(hs)) === JSON.stringify([`${base}${nA}`]), `img srcs ${JSON.stringify(srcs(hs))}`);
    const hsec = srcs(html("security")), hl = srcs(html("launcher"));
    check("E3 sixteen pictures in one source are all copied", hsec.length === 16 && hsec.every((x) => x.startsWith(base)), `${hsec.length} img srcs: ${JSON.stringify(hsec.slice(0, 3))}`);
    check("E3 past sixteen pictures in one source the rest are links: 16 imgs, the 17th a link", hl.length === 16 && hl.every((x) => x.startsWith(base)), `${hl.length} img srcs`);

    // the fallbacks are links with the alt text as their text
    const link = (h, href, text) => new RegExp(`<a href="${href.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&")}"[^>]*>${text}</a>`).test(h);
    const gh = `https://github.com/${O}/blob/main/`;
    const fall = [
      ["an SVG", `${gh}docs/img/v.svg`, "Vector drawing", "docs/img/v.svg"],
      ["a picture over 1 MiB", `${gh}docs/img/huge.png`, "Huge", "docs/img/huge.png"],
      ["a picture that cannot be fetched", `${gh}docs/img/gone.png`, "Gone", "docs/img/gone.png"],
      ["a file that is not a picture", `${gh}docs/img/notes.png`, "Text", "docs/img/notes.png"],
      ["a picture on another host", "https://img.shields.io/badge/orbit-ok-green.png", "Badge", "img.shields.io/badge/orbit-ok-green.png"],
      ["a picture with no alt text", "https://example.com/unnamed.png", "picture", "example.com/unnamed.png"],
    ];
    for (const [what, href, text, written] of fall) {
      check(`E4 ${what} becomes a link reading ${JSON.stringify(text)}`, link(hr, href, text), `no <a href="${href}"> reading ${text} in the readme page`);
      check(`E4 ${what} is not an img`, !hr.includes(`src="${href}"`) && !srcs(hr).some((x) => x.includes(written)), `an img still points at ${written}`);
      check(`E4 ${what} is warned about on stderr, naming the source and the address`, warned(r1, written, bySlug.readme), `no stderr line holds both ${written} and README.md`);
    }
    const lastL = `${L}`;
    check("E4 the 17th picture of a source becomes a link to its file in the repo", link(html("launcher"), `https://github.com/${lastL}/blob/main/p16.png`, "Launch 16"), "no link to p16.png reading Launch 16 in the launcher page");
    check("E4 the 17th picture is warned about, naming the source and the address", warned(r1, "p16.png", bySlug.launcher), `stderr: ${r1.stderr.slice(0, 200)}`);
    check("E4 the 16th picture is an img (control: only the 17th is a link)", !link(html("launcher"), `https://github.com/${lastL}/blob/main/p15.png`, "Launch 15") && html("launcher").includes(`${sha16(png(3015))}.png`), "the 16th is not a copied img");
    check("E4 pictures that were copied raise no warning (control)", !["a.png", "a-copy.png", "b.png", "c.gif", "w.webp", "edge.png", "sec/p0.png"].some((n) => lines(r1).some((l) => l.includes(n))),
      `stderr names a copied picture: ${lines(r1).filter((l) => /a\.png|b\.png|c\.gif|w\.webp|edge\.png|sec\/p0/.test(l)).slice(0, 2).join(" | ")}`);

    // no raw host anywhere
    const all = walk(out).filter((f) => !f.includes(`${join(out, "img")}/`)).map((f) => [f, readFileSync(f, "utf8")]);
    const bad = all.filter(([, t]) => t.includes("raw.githubusercontent.com")).map(([f]) => f);
    check("E5 raw.githubusercontent.com is nowhere in the output", all.length >= 9 && bad.length === 0, `${all.length} files read; found in ${JSON.stringify(bad)}`);
    const shape = (() => { try { return checkDocs(out, sources); } catch (e) { return [`threw: ${e.message}`]; } })();
    check("E5 the output passes the docs shape check", shape.length === 0, JSON.stringify(shape.slice(0, 3)));

    // E7: a picture only a dropped raw-html block uses is not written, and the whole output is well formed
    check("E7 a picture in a raw-html block the sanitiser refuses is not written to img/", !imgFiles().includes(nD), `img/ holds ${nD}`);
    const cli = spawnSync(process.execPath, ["tools/ci/docs-shape.mjs", out, "tools/docs-sources.json"], { encoding: "utf8", timeout: 120000 });
    check("E7 the import's output passes the shape check", cli.status === 0, `status ${cli.status}; ${(cli.stdout ?? "").slice(0, 400)} ${(cli.stderr ?? "").slice(0, 400)}`);

    // a second run after a picture is dropped from a source: the orphan goes, the shared picture stays
    writeSources(true);
    const r2 = run();
    check("E6 a second import exits 0", r2.status === 0, `status ${r2.status}; stderr: ${r2.stderr.slice(0, 300)}`);
    const have2 = imgFiles();
    check("E6 a picture no section uses any more is removed (the webp and the 1 MiB one)", !have2.includes(nW) && !have2.includes(nE), `still has ${JSON.stringify(have2.filter((x) => x === nW || x === nE))}`);
    check("E6 a picture another source still uses stays (a-copy.png is gone from the readme, but a.png is still used twice)", have2.includes(nA), `has ${JSON.stringify(have2.slice(0, 4))}`);
    check("E6 the other pictures stay (control: 37 minus the two removed is 35)", have2.length === 35 && have2.includes(nB) && have2.includes(nC), `has ${have2.length} files`);
    const shape2 = (() => { try { return checkDocs(out, sources); } catch (e) { return [`threw: ${e.message}`]; } })();
    check("E6 the output of the second import passes the docs shape check", shape2.length === 0, JSON.stringify(shape2.slice(0, 3)));
    const r3 = run();
    check("E6 a third import of the same sources leaves the same files (control: the same bytes give the same file)",
      r3.status === 0 && JSON.stringify(imgFiles()) === JSON.stringify(have2), `status ${r3.status}; ${imgFiles().length} files vs ${have2.length}`);
  }
  rmSync(tmp, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
