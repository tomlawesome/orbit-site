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
 * Audit 5: the output passes tools/ci/docs-markup.mjs (S1); one import copies at most 6 MiB of pictures (S2) and one
 * source tries at most 32 pictures (S4), the rest becoming links warned "past".
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
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
    // E8 (audit 5, S1): what the import writes passes the publish job's allow-list of tags, attributes and values
    const mk = spawnSync(process.execPath, ["tools/ci/docs-markup.mjs", out], { encoding: "utf8", timeout: 120000 });
    check("E8 the import's output passes the markup check (node tools/ci/docs-markup.mjs <out>)", mk.status === 0, `status ${mk.status}; ${(mk.stdout ?? "").slice(0, 400)} ${(mk.stderr ?? "").slice(0, 400)}`);

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


// ---------------------------------------------------------------- a missing start heading (#78) --
// A source's `from` names the heading its page begins at. When the source's markdown has no such heading the import
// stops: it exits non-zero and says on stderr which source (repo and path) and which heading, instead of keeping the
// whole file. The scratch copy's tools/docs-sources.json is the real list with the readme given its own `from`, so the
// case does not depend on what the committed list says; the control is the same source with the heading present.
{
  const real = JSON.parse(readFileSync("tools/docs-sources.json", "utf8"));
  const HEAD = "Start here";
  const sources = real.map(({ skip, from: f, ...s2 }) => (s2.slug === "readme" ? { ...s2, from: HEAD } : s2));
  const tmp = mkdtempSync(join(tmpdir(), "import-from-"));
  const repoCopy = join(tmp, "repo");
  cpSync("tools", join(repoCopy, "tools"), { recursive: true, filter: (p) => !/node_modules/.test(p) });
  symlinkSync(join(process.cwd(), "tools", "node_modules"), join(repoCopy, "tools", "node_modules"));
  writeFileSync(join(repoCopy, "tools", "docs-sources.json"), JSON.stringify(sources, null, 1) + "\n");
  mkdirSync(join(repoCopy, "assets", "docs"), { recursive: true });
  const O = "tomlawesome/orbit";
  const put = (dir, path, data) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), data); };
  const stub = (s2) => `# ${s2.name}\n\nAbout ${s2.name}.\n\n## Details\n\nText for ${s2.name}.\n`;
  const readme = (withHead) => ["# Orbit", "", "Landing words.", "", "## Before the start", "", "Not on the page.", "",
    withHead ? `## ${HEAD}` : "## Somewhere else", "", "The page begins here.", "", "## After", "", "More text.", ""].join("\n");
  let k = 0;
  const scenario = (withHead) => {
    const from = join(tmp, `checkout${k}`), fromL = `${from}-launcher`, out = join(tmp, `out${k}`); k++;
    for (const s2 of sources) put(s2.repo === O ? from : fromL, s2.path, s2.slug === "readme" ? readme(withHead) : stub(s2));
    const r = spawnSync(process.execPath, ["tools/import-docs.mjs", "--from", from, "--out", out], { cwd: repoCopy, encoding: "utf8", timeout: 120000, env: { ...process.env, NODE_NO_WARNINGS: "1" } });
    return { status: r.status, stderr: r.stderr ?? "", err: r.error ? String(r.error.message) : "", out };
  };

  // M1: the heading is missing -> the import stops, naming the source and the heading
  {
    const r = scenario(false);
    check("M1 a source whose `from` heading is missing stops the import (exit non-zero)", r.status !== 0 && r.status !== null,
      `status ${r.status}${r.err ? " " + r.err : ""}; stderr: ${r.stderr.slice(0, 300)}`);
    // one line names the repo (not the launcher's), the path and the heading
    const named = r.stderr.split("\n").some((l) => /tomlawesome\/orbit(?!-launcher)/.test(l) && l.includes("README.md") && l.includes(HEAD));
    check("M1 stderr names the source (tomlawesome/orbit and README.md) and the missing heading on one line", named,
      `stderr: ${JSON.stringify(r.stderr.slice(0, 400))}`);
  }
  // M2 (control): the same source with the heading present -> exit 0, and the page begins at that heading
  {
    const r = scenario(true);
    check("M2 the same source with its `from` heading present imports (exit 0; control)", r.status === 0,
      `status ${r.status}${r.err ? " " + r.err : ""}; stderr: ${r.stderr.slice(0, 300)}`);
    const file = join(r.out, "readme.json");
    const page = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
    const secs = page?.sections ?? [];
    const html = secs.map((x) => x.html).join("\n");
    check("M2 the page begins at the `from` heading (its first section is it; nothing above it is kept; control)",
      secs.length > 0 && secs[0].title === HEAD && secs[0].id === "start-here" && html.includes("The page begins here.") && html.includes("More text.")
        && !html.includes("Not on the page.") && !html.includes("Landing words."),
      page ? `sections ${JSON.stringify(secs.map((x) => [x.id, x.title]))}` : `no ${file}`);
  }
  rmSync(tmp, { recursive: true, force: true });
}

// ------------------------------------------------- picture budget and fetch cap (audit 5, S2 and S4) --
// S2: one import copies at most 6 MiB of pictures across all its sources; a picture past that becomes a link to its
// file in the repo, warned about on stderr with "past". S4: one source may try at most 32 pictures, missing ones
// included; past that, a real picture becomes a link too. The budget is shared by every source of one run, so each
// scenario is its own import, from its own --from into its own --out, with only one source holding pictures.
{
  const sources = JSON.parse(readFileSync("tools/docs-sources.json", "utf8"));
  const tmp = mkdtempSync(join(tmpdir(), "import-budget-"));
  const repoCopy = join(tmp, "repo");
  cpSync("tools", join(repoCopy, "tools"), { recursive: true, filter: (p) => !/node_modules/.test(p) });
  symlinkSync(join(process.cwd(), "tools", "node_modules"), join(repoCopy, "tools", "node_modules"));
  mkdirSync(join(repoCopy, "assets", "docs"), { recursive: true });
  const O = "tomlawesome/orbit", base = "assets/docs/img/";
  const put = (dir, path, data) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), data); };
  const stub = (s2) => `# ${s2.name}\n\nAbout ${s2.name}.\n\n## Quick start\n\nText for ${s2.name}.\n\n## Details\n\nMore text.\n`;
  const srcs = (h) => [...h.matchAll(/<img\b[^>]*?\bsrc="([^"]*)"/g)].map((m) => m[1]).sort();
  const link = (h, href, text) => new RegExp(`<a href="${href.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&")}"[^>]*>${text}</a>`).test(h);
  // a decodable 512 x 680 PNG of seeded random pixels, stored uncompressed: about 1,045,000 bytes, under the 1 MiB a
  // picture may be, so six fit in 6 MiB and seven do not
  const bigPng = (seed) => {
    const w = 512, hgt = 680, row = 1 + w * 3, raw = Buffer.alloc(row * hgt);
    let x = (Math.imul(seed + 1, 2654435761) >>> 0) || 1;
    for (let i = 0; i < raw.length; i++) {
      if (i % row === 0) continue; // filter byte 0 (none) at the start of each row
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
      raw[i] = x & 255;
    }
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(hgt, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([PNG_SIG, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 0 })), chunk("IEND", Buffer.alloc(0))]);
  };
  const big = Array.from({ length: 9 }, (_, i) => bigPng(8000 + i));
  check("B0 control: each ~1 MiB picture is distinct and under 1 MiB, six sum under 6 MiB and seven over",
    new Set(big.map(sha16)).size === 9 && big.every((b) => b.length < MIB) && big.slice(0, 6).reduce((a, b) => a + b.length, 0) <= 6 * MIB
      && big.slice(0, 7).reduce((a, b) => a + b.length, 0) > 6 * MIB, `sizes ${big.map((b) => b.length).join(",")}`);

  let k = 0;
  // scenario(slug, md, pictures): the source <slug> gets md appended and the pictures [path, bytes] beside it
  // (paths relative to its file); every other source is a stub. Returns the run, the page's html and the link base.
  const scenario = (label, slug, md, pictures) => {
    const from = join(tmp, `checkout${k}`), fromL = `${from}-launcher`, out = join(tmp, `out${k}`); k++;
    const target = sources.find((s2) => s2.slug === slug);
    const rel = posix.dirname(target.path);
    for (const s2 of sources) put(s2.repo === O ? from : fromL, s2.path, stub(s2) + (s2 === target ? `\n${md}\n` : ""));
    for (const [p, b] of pictures) put(target.repo === O ? from : fromL, posix.join(rel, p), b);
    const r = spawnSync(process.execPath, ["tools/import-docs.mjs", "--from", from, "--out", out], { cwd: repoCopy, encoding: "utf8", timeout: 120000, env: { ...process.env, NODE_NO_WARNINGS: "1" } });
    const stderr = r.stderr ?? "";
    const ok = r.status === 0 && existsSync(join(out, `${slug}.json`));
    check(`${label}: the import exits 0 and writes the page`, ok, `status ${r.status}; stderr: ${stderr.slice(0, 300)}`);
    const h = ok ? JSON.parse(readFileSync(join(out, `${slug}.json`), "utf8")).sections.map((x) => x.html).join("\n") : "";
    const imgDir = join(out, "img");
    const files = existsSync(imgDir) ? readdirSync(imgDir) : [];
    const bytes = files.reduce((a, f) => a + statSync(join(imgDir, f)).size, 0);
    const pastWarned = (p) => stderr.split("\n").some((l) => l.includes(posix.join(rel, p)) && l.includes("past"));
    return { ok, h, files, bytes, pastWarned, gh: (p) => `https://github.com/${target.repo}/blob/main/${posix.join(rel, p)}` };
  };
  const bigMd = (n) => Array.from({ length: n }, (_, i) => `![Big ${i}](big/q${i}.png)`).join("\n\n");
  const bigPics = (n) => big.slice(0, n).map((b, i) => [`big/q${i}.png`, b]);
  const names = (n) => big.slice(0, n).map((b) => `${base}${sha16(b)}.png`).sort();

  // B1 (S2): nine ~1 MiB pictures in one source -> the first six are copied, the 7th to 9th are links, warned "past"
  {
    const s = scenario("B1 nine ~1 MiB pictures", "security", bigMd(9), bigPics(9));
    check("B1 nine ~1 MiB pictures in one source: the first six are copied as img and no more",
      JSON.stringify(srcs(s.h)) === JSON.stringify(names(6)), `${srcs(s.h).length} img srcs (want the first 6): ${JSON.stringify(srcs(s.h).slice(0, 9))}`);
    for (const i of [6, 7, 8]) {
      check(`B1 the picture past the 6 MiB budget (Big ${i}) becomes a link to its file in the repo`, link(s.h, s.gh(`big/q${i}.png`), `Big ${i}`), `no <a href="${s.gh(`big/q${i}.png`)}"> reading Big ${i}`);
      check(`B1 the picture past the budget (Big ${i}) is warned about on stderr with "past"`, s.pastWarned(`big/q${i}.png`), `no stderr line holds both big/q${i}.png and "past"`);
    }
    check("B1 img/ holds six files summing to at most 6 MiB", s.files.length === 6 && s.bytes <= 6 * MIB, `${s.files.length} files, ${s.bytes} bytes`);
  }
  // B2 (S2 control): five ~1 MiB pictures in one source -> all copied, none warned "past"
  {
    const s = scenario("B2 five ~1 MiB pictures", "security", bigMd(5), bigPics(5));
    check("B2 five ~1 MiB pictures in one source are all copied (control: under the budget)",
      JSON.stringify(srcs(s.h)) === JSON.stringify(names(5)), `${srcs(s.h).length} img srcs (want 5): ${JSON.stringify(srcs(s.h))}`);
    check("B2 none of the five is warned about with \"past\"", [0, 1, 2, 3, 4].every((i) => !s.pastWarned(`big/q${i}.png`)), `warned past: ${JSON.stringify([0, 1, 2, 3, 4].filter((i) => s.pastWarned(`big/q${i}.png`)))}`);
  }
  // B3 (S4): 40 missing pictures, then one real one -> the real one is past the 32 tries a source may make: a link
  const missMd = (n) => [...Array.from({ length: n }, (_, i) => `![Miss ${i}](miss/m${i}.png)`), "![Real](miss/real.png)"].join("\n\n");
  const real = png(5000), realName = `${base}${sha16(real)}.png`;
  {
    const s = scenario("B3 forty missing then one real", "security", missMd(40), [["miss/real.png", real]]);
    check("B3 after 40 missing pictures the real one becomes a link to its file in the repo", link(s.h, s.gh("miss/real.png"), "Real"), `no <a href="${s.gh("miss/real.png")}"> reading Real`);
    check("B3 after 40 missing pictures the real one is not an img", !srcs(s.h).includes(realName) && !s.files.includes(`${sha16(real)}.png`), `img srcs ${JSON.stringify(srcs(s.h))}`);
    check("B3 the real picture past the fetch cap is warned about on stderr with \"past\"", s.pastWarned("miss/real.png"), "no stderr line holds both miss/real.png and \"past\"");
  }
  // B4 (S4 control): 10 missing pictures, then one real one -> copied
  {
    const s = scenario("B4 ten missing then one real", "security", missMd(10), [["miss/real.png", real]]);
    check("B4 after 10 missing pictures the real one is copied (control: under the fetch cap)", srcs(s.h).includes(realName) && s.files.includes(`${sha16(real)}.png`), `img srcs ${JSON.stringify(srcs(s.h))}; files ${JSON.stringify(s.files)}`);
    check("B4 the real picture is not warned about with \"past\"", !s.pastWarned("miss/real.png"), `warned past: ${s.pastWarned("miss/real.png")}`);
  }
  rmSync(tmp, { recursive: true, force: true });
}

// ------------------------------------------------- link addresses and the warnings file (#82) --
// cleanAddress(href) in tools/import-docs-lib.mjs cleans an address as a browser does before it judges the scheme:
// U+0009, U+000A and U+000D are removed anywhere, U+0000-U+0020 trimmed at both ends; it returns { address, changed }.
// resolveLink() is only given the cleaned address, and returns null for any scheme but http, https and mailto (the
// text of such a link is kept, without its address). The import writes import-warnings.txt at the checkout root
// (--warnings <file> names another), always, empty when there is nothing: one line per warning,
// repo<TAB>path<TAB>kind<TAB>message, at most 200 lines (the first 199, then one line of kind `more`).
{
  if (typeof lib.cleanAddress !== "function") check("tools/import-docs-lib.mjs exports cleanAddress", false, `got ${typeof lib.cleanAddress}`);
  const clean = (h) => { try { return lib.cleanAddress(h); } catch (e) { return `threw: ${e.message}`; } };
  const same = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `gave ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
  const addr = (h) => { const c = clean(h); return c && typeof c === "object" ? c.address : `no address: ${JSON.stringify(c)}`; };
  // what a link becomes: cleaned, then resolved (the way the importer calls the two)
  const cleanLink = (h, s2 = src, map = bySourcePath) => { const a = addr(h); if (a.startsWith("no address")) return a; try { return resolveLink(a, s2, map, false, new Map()); } catch (e) { return `threw: ${e.message}`; } };

  // L1: a tab and a newline inside an address are removed; the link is kept
  same("L1 cleanAddress('https://ex\\tample.com/a\\nb') is https://example.com/ab, changed", clean("https://ex\tample.com/a\nb"), { address: "https://example.com/ab", changed: true });
  same("L1 cleanAddress(a clean address) is the address, not changed (control)", clean("https://example.com/a?b=1"), { address: "https://example.com/a?b=1", changed: false });
  same("L1 cleanAddress('a\\rb') removes the carriage return", clean("https://example.com/a\rb"), { address: "https://example.com/ab", changed: true });
  eq("L1 the cleaned address is kept as a link", cleanLink("https://ex\tample.com/a\nb"), "https://example.com/ab");
  // L2: a scheme that is not http, https or mailto, once cleaned, gives no address
  eq("L2 cleanAddress('java\\tscript:alert(1)') is javascript:alert(1)", addr("java\tscript:alert(1)"), "javascript:alert(1)");
  eq("L2 'java\\tscript:alert(1)' resolves to null (the href is dropped)", cleanLink("java\tscript:alert(1)"), null);
  eq("L2 cleanAddress('\\u0001javascript:x ') is javascript:x", addr("\u0001javascript:x "), "javascript:x");
  eq("L2 '\\u0001javascript:x ' resolves to null", cleanLink("\u0001javascript:x "), null);
  eq("L2 'JAVASCRIPT:x' in any case resolves to null", cleanLink("JAVASCRIPT:x"), null);
  eq("L2 a data: link resolves to null", cleanLink("data:text/html,<b>x</b>"), null);
  eq("L2 a vbscript: link resolves to null", cleanLink("vbscript:x"), null);
  eq("L2 a mailto link is still a link (control)", cleanLink("mailto:a@example.com"), "mailto:a@example.com");
  // L3: spaces and C0 controls at the edges are trimmed
  eq("L3 cleanAddress(' https://x/ ') is https://x/", addr(" https://x/ "), "https://x/");
  same("L3 cleanAddress('\\u0000\\u001f https://x/ \\u0001\\u001f') is https://x/, changed", clean("\u0000\u001f https://x/ \u0001\u001f"), { address: "https://x/", changed: true });
  eq("L3 the trimmed address is a link, not dropped", cleanLink("\u0000\u001f https://x/ \u0001\u001f"), "https://x/");
  // L4: an anchor and a relative path with an inner tab still resolve to the site's anchors
  eq("L4 '#fr\\tag' resolves to #docs/readme/frag", cleanLink("#fr\tag", srcR), "#docs/readme/frag");
  {
    const map = new Map([[`${src.repo}:docs/x.md`, { repo: src.repo, path: "docs/x.md", slug: "x" }]]);
    eq("L4 'docs/\\tx.md' resolves to #docs/x", cleanLink("docs/\tx.md", srcR, map), "#docs/x");
    eq("L4 'docs/x.md#Ü\\tber' resolves to #docs/x/uber", cleanLink("docs/x.md#Ü\tber", srcR, map), "#docs/x/uber");
  }

  // L1-L7 end to end: the readme carries every case above, as markdown links and as raw html; the import is run from
  // a scratch copy of tools/, as the picture cases are.
  const sources = JSON.parse(readFileSync("tools/docs-sources.json", "utf8"));
  const tmp = mkdtempSync(join(tmpdir(), "import-links-"));
  const repoCopy = join(tmp, "repo");
  cpSync("tools", join(repoCopy, "tools"), { recursive: true, filter: (p) => !/node_modules/.test(p) });
  symlinkSync(join(process.cwd(), "tools", "node_modules"), join(repoCopy, "tools", "node_modules"));
  mkdirSync(join(repoCopy, "assets", "docs"), { recursive: true });
  const O = "tomlawesome/orbit";
  const put = (dir, path, data) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), data); };
  const stub = (s2) => `# ${s2.name}\n\nAbout ${s2.name}.\n\n## Quick start\n\nText for ${s2.name}.\n\n## Details\n\nMore text.\n`;
  const KINDS = new Set(["link-cleaned", "link-dropped", "block-lost-text", "block-unclosed", "picture-not-copied", "more"]);
  const pairs = new Set(sources.map((s2) => `${s2.repo}\t${s2.path}`));
  const BAD = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
  let k = 0;
  // scenario(extra, args): <slug> gets md appended, every other source is a stub; args are added to the command line
  const scenario = (extra, args = []) => {
    const from = join(tmp, `checkout${k}`), fromL = `${from}-launcher`, out = join(tmp, `out${k}`); k++;
    rmSync(join(repoCopy, "import-warnings.txt"), { force: true });
    for (const s2 of sources) put(s2.repo === O ? from : fromL, s2.path, stub(s2) + (extra[s2.slug] ? `\n${extra[s2.slug]}\n` : ""));
    const r = spawnSync(process.execPath, ["tools/import-docs.mjs", "--from", from, "--out", out, ...args], { cwd: repoCopy, encoding: "utf8", timeout: 120000, env: { ...process.env, NODE_NO_WARNINGS: "1" } });
    return { status: r.status, stderr: r.stderr ?? "", err: r.error ? String(r.error.message) : "", out };
  };
  const readWarnings = (f) => (existsSync(f) ? readFileSync(f, "utf8") : null);
  const rows = (t) => (t ?? "").split("\n").filter((l, i, a) => !(l === "" && i === a.length - 1)).map((l) => l.split("\t"));
  // every line of a warnings file holds four fields: a listed repo/path pair, a kind of the set, a clean message
  const wellFormed = (label, t) => {
    const bad = rows(t).filter((f) => f.length !== 4 || !pairs.has(`${f[0]}\t${f[1]}`) || !KINDS.has(f[2]) || f.some((x) => BAD.test(x))
      || f[3].length > 300 || f.join("\t").length > 400);
    check(`${label}: every line is repo<TAB>path<TAB>kind<TAB>message, from the sources and the kinds, with no control character`,
      t !== null && bad.length === 0 && !t.includes("\r"), t === null ? "no file" : `bad lines ${JSON.stringify(bad.slice(0, 3))}`);
  };

  const readme = sources.find((s2) => s2.slug === "readme");
  const signIn = sources.find((s2) => s2.slug === "sign-in");
  const md = [
    "[L1 md](<https://ex\tample.com/one>)", "",
    "<p><a href=\"https://ex\tample.com/two\nx\">L1 raw</a></p>", "",
    "[L2 md](<java\tscript:alert(1)>)", "",
    "<p><a href=\"\u0001javascript:x \">L2 raw</a></p>", "",
    "<p><a href=\" \u0001https://example.com/l3\u001f \">L3 raw</a></p>", "",
    "<p><a href=\"#qu\tick-start\">L4 anchor</a></p>", "",
    `<p><a href="${signIn.path.replace("authentication", "authen\ttication")}">L4 rel</a></p>`, "",
    "<p><a href=\"javascript:`@someone Closes #1\u202ex\">L7 raw</a></p>", "",
  ].join("\n");
  const r = scenario({ readme: md });
  // L5: the import does not stop, and what it writes passes the publish job's allow-list
  check("L5 an import with tabs, newlines and javascript: in link addresses exits 0", r.status === 0, `status ${r.status}${r.err ? " " + r.err : ""}; stderr: ${r.stderr.slice(0, 300)}`);
  const page = join(r.out, "readme.json");
  const h = existsSync(page) ? JSON.parse(readFileSync(page, "utf8")).sections.map((x) => x.html).join("\n") : "";
  const mk = spawnSync(process.execPath, ["tools/ci/docs-markup.mjs", r.out], { encoding: "utf8", timeout: 120000 });
  check("L5 the output passes the markup check (node tools/ci/docs-markup.mjs <out>)", existsSync(page) && mk.status === 0, `status ${mk.status}; ${(mk.stdout ?? "").slice(0, 300)} ${(mk.stderr ?? "").slice(0, 300)}`);
  const anchor = (text) => (h.match(new RegExp(`<a\\b[^>]*>${text}</a>`)) ?? [""])[0];
  const hrefOf = (text) => (anchor(text).match(/\bhref="([^"]*)"/) ?? [null, null])[1];
  eq("L1 the markdown link with a tab is https://example.com/one", hrefOf("L1 md"), "https://example.com/one");
  eq("L1 the raw-html link with a tab and a newline is https://example.com/twox", hrefOf("L1 raw"), "https://example.com/twox");
  for (const t of ["L2 md", "L2 raw", "L7 raw"]) {
    check(`L2 the ${t} link keeps its text and has no href`, h.includes(t) && hrefOf(t) === null, `gave ${JSON.stringify(anchor(t) || "no such text")}`);
  }
  check("L2 no href in the page holds a script: scheme", !/href="[^"]*script:/i.test(h), `found ${JSON.stringify((h.match(/href="[^"]*script:[^"]*"/i) ?? [""])[0])}`);
  eq("L3 the raw-html link with edge spaces and controls is https://example.com/l3", hrefOf("L3 raw"), "https://example.com/l3");
  eq("L4 the anchor with a tab is #docs/readme/quick-start", hrefOf("L4 anchor"), "#docs/readme/quick-start");
  eq(`L4 the relative link with a tab is #docs/${signIn.slug}`, hrefOf("L4 rel"), `#docs/${signIn.slug}`);

  // L6: the warnings file
  const wf = join(repoCopy, "import-warnings.txt");
  const t = readWarnings(wf);
  check("L6 import-warnings.txt is written at the checkout root", t !== null, `no ${wf}`);
  wellFormed("L6 the warnings of the link import", t);
  const mine = rows(t).filter((f) => f[0] === readme.repo && f[1] === readme.path);
  const kinded = (kind, s) => mine.filter((f) => f[2] === kind && f[3].includes(s));
  eq("L1 one link-cleaned warning for the markdown link (ample.com/one)", kinded("link-cleaned", "ample.com/one").length, 1);
  eq("L1 one link-cleaned warning for the raw-html link (ample.com/two)", kinded("link-cleaned", "ample.com/two").length, 1);
  check("L2 a link-dropped warning names the scheme javascript for alert(1)", kinded("link-dropped", "alert(1)").some((f) => f[3].includes("javascript")),
    `readme lines ${JSON.stringify(mine.slice(0, 6))}`);
  check("L2 a link-dropped warning names the scheme javascript for javascript:x", kinded("link-dropped", "javascript:x").length >= 1, `readme lines ${JSON.stringify(mine.slice(0, 6))}`);
  check("L3 the trimmed link is not warned as dropped", kinded("link-dropped", "example.com/l3").length === 0, JSON.stringify(kinded("link-dropped", "example.com/l3")));
  check("L1-L4 the stderr warnings name the readme", r.stderr.split("\n").some((l) => l.includes("link address cleaned") && l.includes(readme.path)),
    `stderr: ${r.stderr.slice(0, 300)}`);
  // L7: a hostile message keeps none of the controls; the rest arrives as text
  check("L7 a message with a backtick, @someone and Closes #1 arrives as text", kinded("link-dropped", "`@someone Closes #1").length === 1,
    `readme lines ${JSON.stringify(mine.filter((f) => f[3].includes("someone")))}`);
  check("L7 no U+202E (or any other bidi or control character) is in the warnings file", t !== null && !/[\u202a-\u202e\u2066-\u2069]/.test(t), "found one");

  // L6: a clean import writes the file empty; --warnings names another file
  const c = scenario({});
  check("L6 a clean import exits 0", c.status === 0, `status ${c.status}; stderr: ${c.stderr.slice(0, 300)}`);
  eq("L6 a clean import writes import-warnings.txt empty", readWarnings(wf), "");
  const other = join(tmp, "elsewhere", "w.txt");
  mkdirSync(dirname(other), { recursive: true });
  const c2 = scenario({ readme: "<p><a href=\"java\tscript:x\">W</a></p>" }, ["--warnings", other]);
  check("L6 --warnings <file> writes the warnings there", c2.status === 0 && rows(readWarnings(other)).some((f) => f[2] === "link-dropped"),
    `status ${c2.status}; ${other}: ${JSON.stringify(readWarnings(other))}`);

  // L6: 250 warnings -> the first 199, then one line of kind `more` saying how many were left out (51)
  const many = Array.from({ length: 250 }, (_, i) => `[d${i}](javascript:x${i})`).join("\n\n");
  const m = scenario({ security: many });
  const mt = readWarnings(wf), mr = rows(mt);
  check("L6 an import with 250 warnings exits 0", m.status === 0, `status ${m.status}; stderr: ${m.stderr.slice(0, 300)}`);
  wellFormed("L6 the warnings of 250 dropped links", mt);
  eq("L6 250 warnings are capped at 200 lines", mr.length, 200);
  check("L6 the first 199 are warnings, the 200th of kind more", mr.length === 200 && mr.slice(0, 199).every((f) => f[2] === "link-dropped") && mr[199][2] === "more",
    `kinds ${JSON.stringify([...new Set(mr.map((f) => f[2]))])}; last ${JSON.stringify(mr[mr.length - 1])}`);
  check("L6 the more line says 51 were left out", mr.length > 0 && /\b51\b/.test(mr[mr.length - 1][3] ?? ""), `last ${JSON.stringify(mr[mr.length - 1])}`);
  rmSync(tmp, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
