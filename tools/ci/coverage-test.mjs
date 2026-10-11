/*
 * Test for the coverage check itself (#14): V8's ranges become lines that ran, the Chromium and Node records merge by
 * union, and the ratchet fails a file below its floor, a file with no floor and a floor with no file, and says what
 * can be raised.
 *
 *   node tools/ci/coverage-test.mjs
 *
 * No dependencies and no browser.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { coveredRanges, codeMask, lineStats, wholePercent } from "./coverage-lib.mjs";
import { measure, ratchet, siteFiles } from "./coverage.mjs";

let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* V8's ranges: the inner range wins, a count of 0 is not run */
{
  const src = "function f() {\n  if (x) {\n    a();\n  } else {\n    b();\n  }\n}\n";
  const at = (s) => src.indexOf(s);
  const fns = [
    { ranges: [{ startOffset: 0, endOffset: src.length, count: 1 }] },
    { ranges: [{ startOffset: 0, endOffset: src.length - 1, count: 3 }, { startOffset: at("else"), endOffset: src.length - 2, count: 0 }] },
  ];
  const ran = new Uint8Array(src.length);
  for (const [s, e] of coveredRanges(fns, src.length)) ran.fill(1, s, e);
  const l = lineStats(src, ran);
  check("an else branch that never ran is the lines missed (the line holding the else keyword ran by its closing brace)", same(l.missed, [5, 6]) && l.total === 7 && l.covered === 5, JSON.stringify(l));
  check("a range of count 0 inside a range of count 3 stays uncovered", ran[at("b()")] === 0 && ran[at("a()")] === 1, `a ${ran[at("a()")]}, b ${ran[at("b()")]}`);
}

/* which lines hold code */
{
  const src = [
    "// a comment",
    "",
    "const a = 1; // trailing",
    "/* block",
    "   comment */ const b = '//not a comment';",
    "const re = /ab\\/\\/c[/]/g, d = a / 2 / 1;",
    "const t = `x ${a + `inner ${b}`}",
    "  // inside a template, so text",
    "`;",
    "   ",
    "}",
  ].join("\n");
  const code = codeMask(src);
  const lines = src.split("\n");
  let start = 0;
  const has = lines.map((l) => { const h = [...l].some((_, k) => code[start + k]); start += l.length + 1; return h; });
  check("comment-only and blank lines hold no code", same(has, [false, false, true, false, true, true, true, true, true, false, true]), JSON.stringify(has));
  const strs = src.indexOf("'//not");
  check("a // inside a string is code, not a comment", code[strs + 2] === 1, `mask ${code[strs + 2]}`);
  const rx = src.indexOf("/ab");
  check("a // inside a regular expression is code, and the division after it is read as one", code[rx + 4] === 1 && code[src.indexOf("/ 2")] === 1 && code[src.indexOf("2 /") + 2] === 1, "mask");
}

check("a floor is the whole percent rounded down, and 100 for a file with no code", wholePercent(2, 3) === 66 && wholePercent(3, 3) === 100 && wholePercent(0, 0) === 100 && wholePercent(0, 5) === 0, "2/3 -> 66");

/* the ratchet */
{
  const files = { a: { percent: 80 }, b: { percent: 50 }, c: { percent: 60 }, d: { percent: 10 } };
  const r = ratchet(files, { a: 80, b: 55, c: 40, gone: 20 });
  check("below, unset, gone and raisable are found", same(r.below, [{ file: "b", percent: 50, floor: 55 }]) && same(r.unset, ["d"]) && same(r.gone, ["gone"]) && same(r.raisable, [{ file: "c", percent: 60, floor: 40 }]), JSON.stringify(r));
}

/* a small site on disk, with a Chromium record and a Node record */
const tmp = mkdtempSync(join(tmpdir(), "coverage-test-"));
try {
  const site = join(tmp, "site");
  mkdirSync(join(site, "assets/js"), { recursive: true });
  mkdirSync(join(site, "assets/door"), { recursive: true });
  const a = "const x = 1;\nfunction f() {\n  return 2;\n}\nfunction g() {\n  return 3;\n}\n";
  writeFileSync(join(site, "assets/js/a.js"), a);
  writeFileSync(join(site, "sw.js"), "self.x = 1;\n");
  const cov = join(tmp, "cov");
  mkdirSync(join(cov, "node"), { recursive: true });
  /* Chromium ran the top level and f; Node ran the top level and g */
  const f = a.indexOf("function f"), g = a.indexOf("function g");
  writeFileSync(join(cov, "browser-x-1.json"), JSON.stringify({ scripts: { "assets/js/a.js": { length: a.length, ran: [[0, g]] } } }));
  writeFileSync(join(cov, "node", "coverage-1.json"), JSON.stringify({ result: [
    { url: "file://" + join(site, "assets/js/a.js"), functions: [{ ranges: [{ startOffset: 0, endOffset: a.length, count: 1 }] }, { ranges: [{ startOffset: f, endOffset: g, count: 0 }] }] },
    { url: "file://" + join(site, "assets/js/other.js"), functions: [] },
    { url: "node:internal/x", functions: [] },
  ] }));
  check("siteFiles lists sw.js and the .js files of assets/js and assets/door", same(siteFiles(site), ["sw.js", "assets/js/a.js"]), JSON.stringify(siteFiles(site)));
  const m = measure([cov], site).files;
  check("a line counts if either record ran it", m["assets/js/a.js"].covered === 7 && m["assets/js/a.js"].total === 7, JSON.stringify(m["assets/js/a.js"]));
  check("a file no record names is 0%", m["sw.js"].percent === 0 && m["sw.js"].total === 1, JSON.stringify(m["sw.js"]));
} finally { rmSync(tmp, { recursive: true, force: true }); }

/* the command, on the real site: a hand-made record of lock.js running, floors from what it measures */
{
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const dir = mkdtempSync(join(tmpdir(), "coverage-test-"));
  try {
    const lock = readFileSync(join(root, "assets/js/lock.js"), "utf8");
    writeFileSync(join(dir, "browser-x-1.json"), JSON.stringify({ scripts: { "assets/js/lock.js": { length: lock.length, ran: [[0, lock.length]] } } }));
    const floors = { floors: Object.fromEntries(Object.entries(measure([dir]).files).map(([f, m]) => [f, m.percent])), reasons: {} };
    const floorsFile = join(dir, "floors.json");
    const run = () => spawnSync(process.execPath, [join(root, "tools/ci/coverage.mjs"), "--floors", floorsFile, dir], { encoding: "utf8" });
    writeFileSync(floorsFile, JSON.stringify(floors));
    let r = run();
    check("floors at what was measured pass", r.status === 0 && /coverage: ok/.test(r.stdout), `exit ${r.status}: ${r.stdout.split("\n").slice(-3).join(" | ")}`);
    floors.floors["assets/js/lock.js"] = 0;
    writeFileSync(floorsFile, JSON.stringify(floors));
    r = run();
    check("a floor under what was measured passes and says it can be raised", r.status === 0 && /can be raised/.test(r.stdout) && /lock\.js: 0% -> 100%/.test(r.stdout), `exit ${r.status}`);
    floors.floors["assets/js/lock.js"] = 101;
    writeFileSync(floorsFile, JSON.stringify(floors));
    r = run();
    check("a floor above what was measured fails and names the file", r.status === 1 && /BELOW ITS FLOOR/.test(r.stdout) && /lock\.js: 100% < 101%/.test(r.stdout), `exit ${r.status}`);
    delete floors.floors["assets/js/lock.js"];
    writeFileSync(floorsFile, JSON.stringify(floors));
    r = run();
    check("a file with no floor fails", r.status === 1 && /NO FLOOR/.test(r.stdout), `exit ${r.status}`);
    floors.floors["assets/js/lock.js"] = 100;
    floors.floors["assets/js/not-there.js"] = 10;
    writeFileSync(floorsFile, JSON.stringify(floors));
    r = run();
    check("a floor for a file that is gone fails", r.status === 1 && /GONE/.test(r.stdout), `exit ${r.status}`);
    floors.floors["assets/js/lock.js"] = 50;
    writeFileSync(floorsFile, JSON.stringify(floors));
    r = spawnSync(process.execPath, [join(root, "tools/ci/coverage.mjs"), "--raise", "--floors", floorsFile, dir], { encoding: "utf8" });
    const after = JSON.parse(readFileSync(floorsFile, "utf8")).floors;
    check("--raise lifts floors, adds new files and drops gone ones, and never lowers", after["assets/js/lock.js"] === 100 && !("assets/js/not-there.js" in after) && Object.keys(after).length === Object.keys(floors.floors).length - 1, `lock.js ${after["assets/js/lock.js"]}, ${Object.keys(after).length} floors`);
    writeFileSync(floorsFile, JSON.stringify({ floors: { ...after, "assets/js/main.js": 90 }, reasons: {} }));
    spawnSync(process.execPath, [join(root, "tools/ci/coverage.mjs"), "--raise", "--floors", floorsFile, dir], { encoding: "utf8" });
    check("--raise leaves a floor above the measurement where it is", JSON.parse(readFileSync(floorsFile, "utf8")).floors["assets/js/main.js"] === 90, "main.js stays 90");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

process.exit(failed ? 1 : 0);
