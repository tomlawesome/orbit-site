/*
 * Test for tools/ci/docs-shape.mjs (#18): the committed assets/docs/ passes,
 * and each way a page or the index could carry something the import does not
 * write is refused and named. Works on copies in a scratch directory.
 * Pictures (#72): assets/docs/ may hold a folder img/ of regular files named
 * <16 hex>.(png|jpg|webp|gif), at most 1 MiB, whose leading bytes match the
 * extension, each used by a section; every <img src> in a section is one of
 * those files or assets/img/mark.svg. All of img/ sums to at most 6 MiB, the
 * import's picture budget (audit 5, S2).
 *
 *   node tools/ci/docs-shape-test.mjs
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, symlinkSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkDocs } from "./docs-shape.mjs";

let failed = false;
const check = (name, ok, detail) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: ${detail}`}`); if (!ok) failed = true; };

const sources = JSON.parse(readFileSync("tools/docs-sources.json", "utf8"));
const tmp = mkdtempSync(join(tmpdir(), "docs-shape-"));
let n = 0;
const fresh = () => { const d = join(tmp, String(n++)); cpSync("assets/docs", d, { recursive: true }); return d; };
const edit = (d, file, fn) => { const f = join(d, file), j = JSON.parse(readFileSync(f, "utf8")); fn(j); writeFileSync(f, JSON.stringify(j)); };
/* (#77) The page whose sections 1 and 2 take planted html: readme.json, or, if an import wrote it with fewer, the first
   page that has three. bare(d) takes the committed pictures out of a copy (img/, and each img of a section that shows
   one), for the cases about img/ itself; docs without pictures it leaves as they are. */
const pages = readdirSync("assets/docs").filter((f) => f.endsWith(".json") && f !== "index.json").sort();
const PAGE = ["readme.json", ...pages].find((f) => pages.includes(f) && JSON.parse(readFileSync(join("assets/docs", f), "utf8")).sections.length >= 3);
const bare = (d) => {
  if (!existsSync(join(d, "img"))) return;
  rmSync(join(d, "img"), { recursive: true });
  for (const f of pages) edit(d, f, (j) => { for (const s of j.sections) s.html = s.html.replace(/<img [^>]*src="assets\/docs\/img\/[^"]*"[^>]*>/g, ""); });
};
const refuses = (name, mutate, want) => {
  const d = fresh(); mutate(d);
  const p = checkDocs(d, sources);
  check(name, p.length > 0 && p.some((x) => x.includes(want)), `want a problem naming "${want}", got ${JSON.stringify(p.slice(0, 3))}`);
};

check("the committed assets/docs has the shape", checkDocs("assets/docs", sources).length === 0, JSON.stringify(checkDocs("assets/docs", sources).slice(0, 3)));

refuses("an index colour with a quote and markup", (d) => edit(d, "index.json", (j) => { j.sources[0].c = '#fff"><img src=x onerror=alert(1)>'; }), "index.json sources[0]: c is");
refuses("an index colour that is a style escape", (d) => edit(d, "index.json", (j) => { j.sources[2].c = "red;background:url(//x.invalid/a)"; }), "sources[2]: c is");
refuses("a page colour changed", (d) => edit(d, "readme.json", (j) => { j.c = "#000000"; }), "readme.json: c is");
refuses("a slug changed in the index", (d) => edit(d, "index.json", (j) => { j.sources[1].slug = 'x"y'; }), "slug is");
refuses("a name changed in the index", (d) => edit(d, "index.json", (j) => { j.sources[1].name = "<b>x</b>"; }), "name is");
refuses("a repo changed in a page", (d) => edit(d, "security.json", (j) => { j.repo = "evil/repo"; }), "repo is");
refuses("a path changed in a page", (d) => edit(d, "security.json", (j) => { j.path = "../x"; }), "path is");
refuses("a section id with a quote", (d) => edit(d, "index.json", (j) => { j.sources[0].sections[0].id = 'a"b'; }), "sections[0].id");
refuses("a section id in a page with a space", (d) => edit(d, PAGE, (j) => { j.sections[1].id = "a b"; }), "sections[1].id");
refuses("a sub id with markup", (d) => edit(d, "index.json", (j) => { const s = j.sources[0].sections.find((x) => x.subs.length); s.subs[0].id = "<x>"; }), "subs[0].id");
refuses("a section id with an accented letter (the importer once wrote these)", (d) => edit(d, "index.json", (j) => { j.sources[0].sections[0].id = "über-orbit"; }), "sections[0].id");
refuses("an empty section id in a page", (d) => edit(d, "readme.json", (j) => { j.sections[0].id = ""; }), "sections[0].id");
refuses("a sub id with an accented letter", (d) => edit(d, "index.json", (j) => { const s = j.sources[0].sections.find((x) => x.subs.length); s.subs[0].id = "café"; }), "subs[0].id");
refuses("a page with no sections", (d) => edit(d, "readme.json", (j) => { j.sections = []; }), "readme.json: sections is");
refuses("an index entry with no sections", (d) => edit(d, "index.json", (j) => { j.sources[2].sections = []; }), "sources[2]: sections is");
{
  /* one section is the least a page or an entry may have: the chart draws from at least one */
  const d = fresh();
  edit(d, "readme.json", (j) => { j.sections = [j.sections[0]]; });
  edit(d, "index.json", (j) => { j.sources[0].sections = [j.sources[0].sections[0]]; });
  const p = checkDocs(d, sources);
  check("a page and an entry with a single section", p.length === 0, JSON.stringify(p.slice(0, 3)));
}
refuses("an extra key in a section", (d) => edit(d, "readme.json", (j) => { j.sections[0].onclick = "x"; }), "sections[0]");
refuses("an extra key in the index", (d) => edit(d, "index.json", (j) => { j.extra = 1; }), "index.json: does not have exactly");
refuses("a non-string title", (d) => edit(d, "readme.json", (j) => { j.sections[0].title = { a: 1 }; }), "title is not a string");
refuses("generated that is not a date", (d) => edit(d, "index.json", (j) => { j.generated = "<script>"; }), "generated is not an ISO date");
refuses("fewer sources in the index", (d) => edit(d, "index.json", (j) => { j.sources.pop(); }), "sources is not a list of");
refuses("a page that is not JSON", (d) => writeFileSync(join(d, "readme.json"), "{"), "readme.json: not JSON");
refuses("a page that is an array", (d) => writeFileSync(join(d, "readme.json"), "[]"), "not a JSON object");
refuses("a file the import does not write", (d) => writeFileSync(join(d, "extra.json"), "{}"), "extra.json: not a file the import writes");
refuses("a page missing", (d) => unlinkSync(join(d, "security.json")), "security.json: missing");
refuses("a page that is a symlink", (d) => { unlinkSync(join(d, "security.json")); symlinkSync("/etc/hostname", join(d, "security.json")); }, "security.json: not a regular file");

/* One colour rule (audit 4): a source's colour is "#" and six hex digits in either case, here and in the docs pad
   (assets/js/pads.js). `recolour` sets one colour in the index entry, in the page, and in the sources list passed in, so a
   colour the rule accepts is not refused for the three disagreeing. */
const recoloured = (c) => {
  const d = fresh();
  edit(d, "index.json", (j) => { j.sources[0].c = c; });
  edit(d, "readme.json", (j) => { j.c = c; });
  const list = JSON.parse(JSON.stringify(sources));
  list[0].c = c;
  return checkDocs(d, list);
};
for (const c of ["#a1b2c3", "#A1B2C3", "#a1B2c3"]) {
  const p = recoloured(c);
  check(`the colour ${c} is accepted${c === "#a1b2c3" ? " (control: lower case passes today)" : ""}`, p.length === 0, `want no problems, got ${JSON.stringify(p.slice(0, 3))}`);
}
for (const c of ["#abc", "#abcdeg", "abcdef", "#abcdef0", ""]) {
  refuses(`the colour ${JSON.stringify(c)} is refused (control: refused today)`, (d) => edit(d, "index.json", (j) => { j.sources[0].c = c; }), "index.json sources[0]: c is");
}

/* Pictures (#72). Real bytes, named by the first 16 hex digits of their SHA-256. Every refusal below is paired with an
   accepted case that differs only in the thing refused. */
const crcTable = Array.from({ length: 256 }, (_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (seed) => { // a real 1x1 PNG whose pixel colour is the seed, so each seed is a different file
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([PNG_SIG, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from([0, seed & 255, (seed >> 8) & 255, (seed >> 16) & 255]))), chunk("IEND", Buffer.alloc(0))]);
};
const jpg = (seed) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, seed & 255, 0xff, 0xd9]);
const gif = (seed, v = "GIF89a") => Buffer.concat([Buffer.from(v, "latin1"), Buffer.from([1, 0, 1, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 1, seed & 255, 0, 0x3b])]);
const webp = (seed) => { const tail = Buffer.concat([Buffer.from("WEBPVP8L", "latin1"), Buffer.from([5, 0, 0, 0, 0x2f, 0, 0, 0, seed & 255, 0])]); const n = Buffer.alloc(4); n.writeUInt32LE(tail.length); return Buffer.concat([Buffer.from("RIFF", "latin1"), n, tail]); };
const MIB = 1048576;
const padded = (head, size) => Buffer.concat([head, Buffer.alloc(size - head.length)]);
const hash16 = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);
const IMG = "assets/docs/img";
const tag = (src) => `<p><img src="${src}" alt="" loading="lazy"></p>`;
const appendHtml = (d, file, html, k = 1) => edit(d, file, (j) => { j.sections[k].html += html; });
/* put a picture in a copy of assets/docs and have a section use it: pic(d, bytes, ext) -> its name */
const pic = (d, bytes, ext, o = {}) => {
  const name = o.name ?? `${hash16(bytes)}.${ext}`;
  mkdirSync(join(d, "img"), { recursive: true });
  writeFileSync(join(d, "img", name), bytes);
  if (o.used !== false) appendHtml(d, o.page ?? PAGE, tag(`${IMG}/${name}`));
  return name;
};
const accepts = (name, mutate) => {
  const d = fresh(); mutate(d);
  const p = checkDocs(d, sources);
  check(name, p.length === 0, `want no problems, got ${JSON.stringify(p.slice(0, 3))}`);
};

accepts("P0 a section showing the orbit mark (control: an img with assets/img/mark.svg is the one allowed outside img/)",
  (d) => appendHtml(d, PAGE, tag("assets/img/mark.svg")));

// P1: each picture type, by its own leading bytes
accepts("P1 a PNG picture used by a section", (d) => pic(d, png(1), "png"));
accepts("P1 a JPEG picture used by a section", (d) => pic(d, jpg(2), "jpg"));
accepts("P1 a GIF89a picture used by a section", (d) => pic(d, gif(3), "gif"));
accepts("P1 a GIF87a picture used by a section", (d) => pic(d, gif(4, "GIF87a"), "gif"));
accepts("P1 a WebP picture used by a section", (d) => pic(d, webp(5), "webp"));
accepts("P1 pictures of every type, one used by two sections of two pages", (d) => {
  const n = pic(d, png(10), "png"); pic(d, jpg(11), "jpg"); pic(d, gif(12), "gif"); pic(d, webp(13), "webp");
  appendHtml(d, PAGE, tag(`${IMG}/${n}`), 2); appendHtml(d, "security.json", tag(`${IMG}/${n}`), 0);
});
accepts("P1 a picture used only by another page (security.json)", (d) => pic(d, png(14), "png", { page: "security.json" }));
accepts("P1 the mark beside a picture", (d) => { pic(d, png(15), "png"); appendHtml(d, "security.json", tag("assets/img/mark.svg")); });
accepts("P1 an img written as text in a code sample is not an img", (d) => {
  appendHtml(d, PAGE, '<pre class="code"><code>&lt;img src="https://raw.githubusercontent.com/x/y/main/a.png"&gt;</code></pre>');
});

// P2: a picture is a regular file, named <16 hex>.<ext>, at most 1 MiB
{
  const b = png(20), h = hash16(b);
  refuses("P2 a name with upper-case hex", (d) => pic(d, b, "png", { name: `${h.toUpperCase()}.png` }), h.toUpperCase());
  refuses("P2 a name with 15 hex digits", (d) => pic(d, b, "png", { name: `${h.slice(0, 15)}.png` }), h.slice(0, 15));
  refuses("P2 a name with 17 hex digits", (d) => pic(d, b, "png", { name: `${h}0.png` }), `${h}0.png`);
  refuses("P2 a name that is not hex", (d) => pic(d, b, "png", { name: `${h.slice(0, 15)}g.png` }), `${h.slice(0, 15)}g.png`);
  refuses("P2 the extension jpeg", (d) => pic(d, jpg(21), "jpeg"), "jpeg");
  refuses("P2 an upper-case extension", (d) => pic(d, b, "PNG"), `${h}.PNG`);
  refuses("P2 an SVG picture", (d) => pic(d, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "svg"), ".svg");
  refuses("P2 a second extension", (d) => pic(d, b, "png.png"), `${h}.png.png`);
  refuses("P2 a text file in img/", (d) => pic(d, Buffer.from("notes"), "txt", { used: false }), ".txt");
  refuses("P2 a folder in img/", (d) => { mkdirSync(join(d, "img", "sub"), { recursive: true }); writeFileSync(join(d, "img", "sub", `${h}.png`), b); }, "sub");
  refuses("P2 a symlink in img/ to a real picture", (d) => {
    const real = join(tmp, `real-${n++}.png`); writeFileSync(real, b);
    bare(d); mkdirSync(join(d, "img")); symlinkSync(real, join(d, "img", `${h}.png`)); appendHtml(d, PAGE, tag(`${IMG}/${h}.png`));
  }, `${h}.png`);
  refuses("P2 img as a regular file", (d) => { bare(d); writeFileSync(join(d, "img"), b); }, "img");
  refuses("P2 img as a symlink to a folder", (d) => {
    const real = join(tmp, `dir-${n++}`); mkdirSync(real); writeFileSync(join(real, `${h}.png`), b);
    bare(d); symlinkSync(real, join(d, "img")); appendHtml(d, PAGE, tag(`${IMG}/${h}.png`));
  }, "img");
  refuses("P2 a picture directly in assets/docs", (d) => writeFileSync(join(d, `${h}.png`), b), `${h}.png`);
}
accepts("P2 control: the same picture as a lower-case name in img/", (d) => pic(d, png(20), "png"));
accepts("P2 control: a PNG of exactly 1 MiB", (d) => pic(d, padded(PNG_SIG, MIB), "png"));
refuses("P2 a PNG of 1 MiB and one byte", (d) => pic(d, padded(PNG_SIG, MIB + 1), "png"), hash16(padded(PNG_SIG, MIB + 1)));
accepts("P2 control: a JPEG of exactly 1 MiB", (d) => pic(d, padded(Buffer.from([0xff, 0xd8, 0xff]), MIB), "jpg"));
refuses("P2 a JPEG of 1 MiB and one byte", (d) => pic(d, padded(Buffer.from([0xff, 0xd8, 0xff]), MIB + 1), "jpg"), hash16(padded(Buffer.from([0xff, 0xd8, 0xff]), MIB + 1)));

// P3: the leading bytes must match the extension (control for each: the same bytes under their own extension are accepted above)
refuses("P3 JPEG bytes named .png", (d) => pic(d, jpg(30), "png"), ".png");
refuses("P3 PNG bytes named .jpg", (d) => pic(d, png(31), "jpg"), ".jpg");
refuses("P3 GIF bytes named .webp", (d) => pic(d, gif(32), "webp"), ".webp");
refuses("P3 WebP bytes named .gif", (d) => pic(d, webp(33), "gif"), ".gif");
refuses("P3 text named .png", (d) => pic(d, Buffer.from("not a picture at all"), "png"), ".png");
refuses("P3 an empty file named .png", (d) => pic(d, Buffer.alloc(0), "png"), ".png");
refuses("P3 an SVG named .png", (d) => pic(d, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "png"), ".png");
refuses("P3 RIFF without WEBP named .webp", (d) => pic(d, Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.alloc(4), Buffer.from("WAVEfmt ", "latin1")]), "webp"), ".webp");
refuses("P3 GIF88a named .gif", (d) => pic(d, gif(34, "GIF88a"), "gif"), ".gif");
refuses("P3 a PNG signature cut short named .png", (d) => pic(d, PNG_SIG.subarray(0, 7), "png"), ".png");

// P4: each picture is used by at least one section's html
refuses("P4 a picture no section uses", (d) => pic(d, png(40), "png", { used: false }), hash16(png(40)));
accepts("P4 control: the same picture used by a section", (d) => pic(d, png(40), "png"));
refuses("P4 two pictures, one unused", (d) => { pic(d, png(41), "png"); pic(d, png(42), "png", { used: false }); }, hash16(png(42)));
refuses("P4 a picture named only in a section's text, not as an img", (d) => {
  const n2 = pic(d, png(43), "png", { used: false }); appendHtml(d, PAGE, `<p>see ${IMG}/${n2}</p>`);
}, hash16(png(43)));
refuses("P4 a picture named only in a link, not as an img", (d) => {
  const n2 = pic(d, png(44), "png", { used: false }); appendHtml(d, PAGE, `<p><a href="${IMG}/${n2}">x</a></p>`);
}, hash16(png(44)));

// P5: every <img src> is a file in img/ or the mark
{
  const n1 = `${hash16(png(50))}.png`;
  const bad = (name, src, want = PAGE) => refuses(name, (d) => { pic(d, png(50), "png"); appendHtml(d, PAGE, tag(src)); }, want);
  accepts("P5 control: two imgs, a picture in img/ and the mark", (d) => { pic(d, png(50), "png"); appendHtml(d, PAGE, tag("assets/img/mark.svg")); });
  bad("P5 a picture that is not in img/", `${IMG}/${hash16(png(51))}.png`);
  bad("P5 an https picture", "https://example.com/a.png");
  bad("P5 a raw.githubusercontent.com picture", "https://raw.githubusercontent.com/tomlawesome/orbit/main/docs/a.png");
  bad("P5 another file under assets/", "assets/img/other.svg");
  bad("P5 the mark's folder with another name", "assets/img/mark.png");
  bad("P5 a picture in img/ with a query", `${IMG}/${n1}?x=1`);
  bad("P5 a picture in img/ with a fragment", `${IMG}/${n1}#x`);
  bad("P5 a path that climbs out of img/", `${IMG}/../../index.html`);
  bad("P5 an absolute path to the picture", `/${IMG}/${n1}`);
  bad("P5 a data: picture", "data:image/png;base64,AAAA");
  bad("P5 a relative picture as written upstream", "docs/a.png");
  refuses("P5 a bad src beside good ones in a second page", (d) => { pic(d, png(50), "png"); appendHtml(d, "security.json", tag("https://example.com/a.png"), 0); }, "security.json");
}

// P6: no img/ folder at all is fine when no section uses a picture, and a section that uses one needs the folder
accepts("P6 no img/ folder and no picture in use (the committed shape before #72's first import)", (d) => bare(d));
refuses("P6 a section uses a picture and there is no img/ folder", (d) => { bare(d); appendHtml(d, PAGE, tag(`${IMG}/${hash16(png(60))}.png`)); }, PAGE);

// P7 (audit 5, S2): the pictures in img/ sum to at most the import's picture budget, 6 MiB across all sources. Each picture
// is a distinct, used PNG of exactly 1 MiB (the most one picture may be), so the sum alone is what differs.
const mibs = (d, k, base) => { bare(d); for (let i = 0; i < k; i++) pic(d, padded(png(base + i), MIB), "png"); };
refuses("P7 img/ summing to 7 MiB (seven 1 MiB pictures, each used)", (d) => mibs(d, 7, 700), "img");
accepts("P7 control: img/ summing to 5 MiB (five 1 MiB pictures, each used)", (d) => mibs(d, 5, 700));

rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
