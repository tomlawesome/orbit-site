/*
 * Test for the goodbye as the sign-in (#25), the markup half, written from docs/adr/0003 alone (its "Behaviours" 1-6
 * and owner decision 11a). duskMarkup() is a pure string function exported by assets/door/index.js.
 *
 * Without the option the markup must be byte-identical to what it is today: the sha256 of the output for three option
 * sets was taken from the code as it stood before the option (8e1bd13), and index.html (written by
 * tools/door-markup.mjs) must still pass its --check. With `asDawn: true` the markup is the sign-in's face: the
 * dawn's glyph, the gold planet on its trail, the farewell inside the lockup's gate-wrap, and the Earth's two
 * pictures under the ember rim (11a).
 *
 *   node tools/ci/goodbye-markup-test.mjs
 *
 * No dependencies and no browser. The browser half (geometry, visibility) is tools/ci/asdawn-test.mjs.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};
const sha = (s) => createHash("sha256").update(s).digest("hex");

const { duskMarkup, dawnMarkup } = await import("../../assets/door/index.js");
const image = (p) => `IMG/${p}`;
const GATE = '<button class="gate" id="gate-back" type="button">Sign back in</button>';

/* ---- a small reader for the markup: tags, attributes, nesting (no text), enough to ask where things sit ---- */
function parse(html) {
  const top = { tag: "#root", attrs: {}, kids: [], parent: null };
  let at = top;
  const re = /<!--[\s\S]*?-->|<\/([A-Za-z][\w:-]*)\s*>|<([A-Za-z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
  for (let m; (m = re.exec(html)); ) {
    if (m[1]) { if (at.tag === m[1]) at = at.parent; continue; }
    if (!m[2]) continue;
    const attrs = {};
    for (const a of m[3].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[a[1]] = a[2] ?? a[3] ?? a[4] ?? "";
    const node = { tag: m[2], attrs, kids: [], parent: at };
    at.kids.push(node);
    if (!m[4]) at = node;
  }
  return top;
}
const classes = (n) => (n.attrs.class || "").split(/\s+/).filter(Boolean);
const walk = (n, f) => { f(n); n.kids.forEach((k) => walk(k, f)); };
const find = (n, pred) => { const out = []; walk(n, (x) => pred(x) && out.push(x)); return out; };
const byClass = (n, ...cs) => find(n, (x) => cs.every((c) => classes(x).includes(c)));
const within = (n, anc) => { for (let p = n.parent; p; p = p.parent) if (p === anc) return true; return false; };

/* ---- 1. without the option: byte for byte today's ---- */
const SETS = {
  "image only": [{ image }, "c9594b2848edcf53a5613af550dc4f77e6474986b0bb95f215983f6704fe2ccf"],
  "gate, foot, farewell words, indent": [{ image, gate: GATE, foot: '<p class="foot">credit</p>', farewell: { said: "Goodbye", sub: "see you" }, indent: "  " }, "35e28a91373fd9b66343b330cc24f0241bf843e191c092319be75cc22bc3c21f"],
  "another resolver, indent": [{ image: (p) => `../x/${p}?v=2`, indent: "      " }, "8e189e06bf997508267d58f63f3222a22756b67bf13721a3964e4b5cbe38f9b3"],
};
for (const [name, [opts, want]] of Object.entries(SETS)) {
  const got = sha(duskMarkup(opts));
  check(`1. no option, ${name}: the same bytes as today`, got === want, got === want ? "sha256 matches" : `sha256 ${got.slice(0, 12)}… (today: ${want.slice(0, 12)}…)`);
  const off = sha(duskMarkup({ ...opts, asDawn: false }));
  check(`1. asDawn: false, ${name}: the same bytes as no option`, off === want, off === want ? "sha256 matches" : `sha256 ${off.slice(0, 12)}… (today: ${want.slice(0, 12)}…)`);
}
{
  const plain = duskMarkup({ image });
  const bad = ["asdawn", "planet-gold", "d-ringlit", 'class="lux"'].filter((s) => plain.includes(s));
  check("1. no option: no asdawn, planet-gold, d-ringlit or class=\"lux\"", bad.length === 0, bad.length ? `found ${bad.join(", ")}` : "none of them");
  const tree = parse(plain);
  const [fw] = byClass(tree, "farewell"), [lockup] = byClass(tree, "lockup");
  check("1. no option: .farewell is a sibling of .lockup", !!fw && !!lockup && fw.parent === lockup.parent && !within(fw, lockup), fw && lockup ? `.farewell is in ${fw.parent.tag}.${classes(fw.parent).join(".")}` : "missing");
  check("1. no option: the root is <div id=\"dusk\" hidden>", plain.trimStart().startsWith('<div id="dusk" hidden>'), JSON.stringify(plain.trimStart().slice(0, 30)));
  const r = spawnSync(process.execPath, [join(root, "tools", "door-markup.mjs"), "--check"], { cwd: root, encoding: "utf8" });
  check("1. tools/door-markup.mjs --check passes against the unchanged index.html", r.status === 0, `exit ${r.status}: ${(r.stdout + r.stderr).trim().split("\n")[0]}`);
}

/* ---- 2-6, 11a. with the option ---- */
const dawn = dawnMarkup({ image });
const s = duskMarkup({ image, asDawn: true });
const tree = parse(s);
const [dusk] = find(tree, (n) => n.attrs.id === "dusk");

check("2. the root is <div id=\"dusk\" class=\"asdawn\" hidden>", s.trimStart().startsWith('<div id="dusk" class="asdawn" hidden>'), JSON.stringify(s.trimStart().slice(0, 40)));

const [glyph] = find(tree, (n) => n.attrs.id === "dusk-glyph");
check("3. #dusk-glyph is there, with one svg", !!glyph && find(glyph, (n) => n.tag === "svg").length === 1, glyph ? "found" : "no #dusk-glyph");
if (glyph) {
  const ids = find(glyph, (n) => n.tag === "defs").flatMap((d) => find(d, (n) => n.attrs.id).map((n) => n.attrs.id));
  const want = ["d-ringlit", "d-disclit", "d-discwarm", "d-trail"];
  const missing = want.filter((i) => !ids.includes(i));
  check("3. <defs> carries d-ringlit, d-disclit, d-discwarm and d-trail", missing.length === 0, missing.length ? `missing ${missing.join(", ")} (has ${ids.join(", ") || "no defs"})` : `has ${ids.join(", ")}`);

  const lux = byClass(glyph, "lux");
  const circles = (n) => find(n, (x) => x.tag === "circle");
  /* a disc is a circle filled with a disc gradient, carrying .lux itself or sitting in a .lux group */
  const discs = circles(glyph).filter((c) => /^url\(#d-disc(lit|warm)\)$/.test(c.attrs.fill || ""));
  const fills = discs.map((c) => c.attrs.fill).sort();
  const luxed = discs.every((c) => classes(c).includes("lux") || lux.some((g) => within(c, g)));
  check("3. two .lux discs, filled d-disclit and d-discwarm", discs.length === 2 && fills[0] === "url(#d-disclit)" && fills[1] === "url(#d-discwarm)" && luxed, `${discs.length} disc circles, fills ${JSON.stringify(fills)}, ${luxed ? "all" : "not all"} .lux`);
  const ringLux = circles(glyph).filter((c) => classes(c).includes("ring") && classes(c).includes("lux"));
  check("3. two .ring.lux circles, stroked d-ringlit", ringLux.length === 2 && ringLux.every((c) => c.attrs.stroke === "url(#d-ringlit)"), `${ringLux.length} found, strokes ${JSON.stringify(ringLux.map((c) => c.attrs.stroke))}`);
  const plainRing = circles(glyph).filter((c) => classes(c).includes("ring") && !classes(c).includes("lux"));
  check("3. one plain .ring, #8791b3, 2 wide", plainRing.length === 1 && plainRing[0].attrs.stroke === "#8791b3" && plainRing[0].attrs["stroke-width"] === "2", plainRing.length === 1 ? `stroke ${plainRing[0].attrs.stroke}, width ${plainRing[0].attrs["stroke-width"]}` : `${plainRing.length} found`);
  check("3. no .runner", byClass(tree, "runner").length === 0, `${byClass(tree, "runner").length} found`);

  const [tr] = byClass(glyph, "tr");
  check("4. <g class=\"tr\"> is there", !!tr && tr.tag === "g", tr ? "found" : "no .tr");
  if (tr) {
    const path = find(tr, (n) => n.tag === "path");
    check("4. .tr holds the trail path M46.5 51.8 A72 72 0 0 1 163 63.5", path.length === 1 && path[0].attrs.d === "M46.5 51.8 A72 72 0 0 1 163 63.5", `d = ${JSON.stringify(path.map((p) => p.attrs.d))}`);
    check("4. the trail is stroked with d-trail", path.length === 1 && path[0].attrs.stroke === "url(#d-trail)", `stroke ${path[0]?.attrs.stroke}`);
    const img = find(tr, (n) => n.tag === "image");
    const a = img[0]?.attrs || {};
    const ok = img.length === 1 && classes(img[0]).includes("world") && a.href === image("dawn/planet-gold.webp") && a.x === "145" && a.y === "45.5" && a.width === "36" && a.height === "36";
    check("4. the planet: <image class=\"world\" href=image(\"dawn/planet-gold.webp\") x=145 y=45.5 36x36>", ok, `${img.length} image(s): ${JSON.stringify(a)}`);
    check("4. no gold <circle> (the planet is a picture)", find(tr, (n) => n.tag === "circle").length === 0 && !s.includes("#d8b45a"), `${find(tr, (n) => n.tag === "circle").length} circle(s) in .tr, #d8b45a ${s.includes("#d8b45a") ? "present" : "absent"}`);
  }
}

{
  const [wrap] = byClass(tree, "gate-wrap"), [lockup] = byClass(tree, "lockup");
  const fws = byClass(tree, "farewell");
  const inWrap = fws.filter((f) => wrap && f.parent === wrap);
  check("5. exactly one .farewell, and it is a child of .gate-wrap", fws.length === 1 && inWrap.length === 1, `${fws.length} .farewell, ${inWrap.length} directly in .gate-wrap`);
  check("5. no .farewell outside the lockup", fws.every((f) => lockup && within(f, lockup)), fws.map((f) => f.parent.tag + "." + classes(f.parent).join(".")).join(", "));
  const g = duskMarkup({ image, asDawn: true, gate: GATE });
  const t = parse(g);
  const [w2] = byClass(t, "gate-wrap");
  const kids = w2 ? w2.kids : [];
  const ig = kids.findIndex((k) => classes(k).includes("gate")), ifw = kids.findIndex((k) => classes(k).includes("farewell"));
  check("5. .farewell is the last child of .gate-wrap, after the gate", ig === 0 && ifw === kids.length - 1 && kids.length === 2, `children: ${kids.map((k) => k.tag + "." + classes(k).join(".")).join(", ")}`);
  const [f2] = byClass(t, "farewell");
  const sub = f2 ? f2.kids.map((k) => classes(k)[0]) : [];
  check("5. .farewell holds .said then .sub", sub.join() === "said,sub", `children ${sub.join() || "none"}`);
  const words = (opts) => { const x = duskMarkup({ image, asDawn: true, ...opts }); return [x.includes("You are signed out."), x.includes("the sky keeps turning · your systems keep their orbits")]; };
  check("5. the default words are there", words({}).every(Boolean), JSON.stringify(words({})));
  const custom = duskMarkup({ image, asDawn: true, farewell: { said: "Goodbye AAA", sub: "see you BBB" } });
  check("5. the given words replace the default ones", custom.includes("Goodbye AAA") && custom.includes("see you BBB") && !custom.includes("You are signed out."), "said/sub taken from the option");
}

{
  /* 6. image, gate, foot, farewell, indent behave as before */
  const plain = duskMarkup({ image });
  const hrefs = (x) => [...x.matchAll(/(?:data-)?href="([^"]*)"/g)].map((m) => m[1]);
  const lost = hrefs(plain).filter((h) => !hrefs(s).includes(h));
  check("6. image(): every picture the plain dusk asks for is still asked for", lost.length === 0, lost.length ? `missing ${lost.join(", ")}` : "all there");
  check("6. every picture goes through image()", hrefs(s).every((h) => h.startsWith("IMG/")), JSON.stringify(hrefs(s).filter((h) => !h.startsWith("IMG/"))));
  const a = duskMarkup({ image: (p) => `../x/${p}?v=2`, asDawn: true });
  check("6. image(): a different resolver is used for the new pictures too", /href="\.\.\/x\/dawn\/planet-gold\.webp\?v=2"/.test(a), "planet-gold through the given resolver");
  const withGate = duskMarkup({ image, asDawn: true, gate: "<b>GATE</b>" });
  const [w] = byClass(parse(withGate), "gate-wrap");
  check("6. gate: the host's gate is inside .gate-wrap", !!w && find(w, (n) => n.tag === "b").length === 1, "found in .gate-wrap");
  const withFoot = duskMarkup({ image, asDawn: true, foot: "<i>FOOT</i>" });
  const dt = parse(withFoot);
  const [d2] = find(dt, (n) => n.attrs.id === "dusk");
  const foot = d2 && d2.kids.find((k) => k.tag === "i");
  check("6. foot: the host's foot is a child of #dusk, after .loginchrome", !!foot && d2.kids.indexOf(foot) > d2.kids.findIndex((k) => classes(k).includes("loginchrome")), foot ? "found" : "not a child of #dusk");
  const ind = "      ";
  const lines = duskMarkup({ image, asDawn: true, indent: ind }).split("\n").filter((l) => l.trim());
  const bare = lines.filter((l) => !l.startsWith(ind));
  check("6. indent: every line starts with the given indent", bare.length === 0, bare.length ? `${bare.length} line(s) without it, first: ${JSON.stringify(bare[0].slice(0, 50))}` : `${lines.length} lines`);
}

{
  /* 11a. the Earth's two pictures, as the dawn names them, under the ember rim */
  const imgs = find(tree, (n) => n.tag === "image");
  const lazy = imgs.filter((i) => i.attrs["data-href"] && /^IMG\/dawn\/dawn(-pre)?\.webp$/.test(i.attrs["data-href"]));
  const order = lazy.map((i) => i.attrs["data-href"]);
  check("11a. both Earth pictures are carried as data-href images (dawn-pre, then dawn)", order.join() === "IMG/dawn/dawn-pre.webp,IMG/dawn/dawn.webp", `found ${JSON.stringify(order)}`);
  check("11a. they have no href of their own (they load as the dawn's do)", lazy.every((i) => i.attrs.href === undefined), "href absent");
  const [world] = dusk ? byClass(dusk, "world").filter((n) => n.tag === "div") : [];
  check("11a. they are inside the dusk's .world", !!world && lazy.length === 2 && lazy.every((i) => within(i, world)), `${lazy.filter((i) => world && within(i, world)).length} of ${lazy.length} inside`);
  const all = [];
  walk(tree, (n) => all.push(n));
  const at = (pred) => all.findIndex(pred);
  const rim = at((n) => n.tag === "image" && n.attrs["data-raster"] === "rim");
  const rimStroke = at((n) => n.tag === "circle" && n.attrs.stroke === "url(#d-rim)");
  const last = Math.max(...lazy.map((i) => all.indexOf(i)));
  check("11a. they are drawn under the ember rim (before the glow-rim picture and the rim stroke)", lazy.length === 2 && rim > -1 && rimStroke > -1 && last < rim && last < rimStroke, `Earth at ${lazy.map((i) => all.indexOf(i))}, rim picture ${rim}, rim stroke ${rimStroke}`);
  const plain = duskMarkup({ image });
  check("11a. without the option the dusk does not carry them", !/dawn\/dawn(-pre)?\.webp/.test(plain), "none in the plain dusk");
}

{
  /* ids: a page with both surfaces has no duplicate */
  const ids = (x) => find(parse(x), (n) => n.attrs.id).map((n) => n.attrs.id);
  const both = [...ids(dawn), ...ids(s)];
  const dup = [...new Set(both.filter((i, k) => both.indexOf(i) !== k))];
  check("3. a page with the dawn and the sign-in-faced dusk has no duplicate id", dup.length === 0, dup.length ? `duplicate: ${dup.join(", ")}` : `${both.length} ids, all different`);
  const plainBoth = [...ids(dawn), ...ids(duskMarkup({ image }))];
  check("1. (control) the plain pair has none either", new Set(plainBoth).size === plainBoth.length, `${plainBoth.length} ids`);
}

{
  /* the picture itself ships in the folder, a copy of the site's */
  let a = null, b = null;
  try { a = readFileSync(join(root, "assets/door/img/dawn/planet-gold.webp")); } catch { /* absent */ }
  try { b = readFileSync(join(root, "assets/img/door/planet-gold.webp")); } catch { /* absent */ }
  check("4. assets/door/img/dawn/planet-gold.webp exists", !!a, a ? `${a.length} bytes` : "not in the folder");
  check("4. it is a copy of assets/img/door/planet-gold.webp", !!a && !!b && a.equals(b), a && b ? (a.equals(b) ? "same bytes" : "different bytes") : "one of the two is missing");
  check("4. the site's own copy is still there", !!b, b ? `${b.length} bytes` : "removed");
}

process.exit(failed ? 1 : 0);
