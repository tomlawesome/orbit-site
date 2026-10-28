/*
 * Test for the coverage check itself (#14): V8's ranges become lines that ran, the Chromium and Node records merge by
 * union, and the ratchet fails a file below its floor, a file with no floor and a floor with no file, and says what
 * can be raised.
 *
 *   node tools/ci/coverage-test.mjs
 *
 * No dependencies and no browser. Since #95 (ADR-0005), also: the recorder names its file by the shard.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, copyFileSync, readdirSync, symlinkSync, lstatSync } from "node:fs";
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
    check("--raise lifts floors and never lowers or removes one (a gone file's floor stays, for a person to move or remove)", after["assets/js/lock.js"] === 100 && after["assets/js/not-there.js"] === 10 && Object.keys(after).length === Object.keys(floors.floors).length, `lock.js ${after["assets/js/lock.js"]}, not-there.js ${after["assets/js/not-there.js"]}, ${Object.keys(after).length} floors (want ${Object.keys(floors.floors).length})`);
    delete after["assets/js/not-there.js"];
    writeFileSync(floorsFile, JSON.stringify({ floors: { ...after, "assets/js/main.js": 90 }, reasons: {} }));
    spawnSync(process.execPath, [join(root, "tools/ci/coverage.mjs"), "--raise", "--floors", floorsFile, dir], { encoding: "utf8" });
    check("--raise leaves a floor above the measurement where it is", JSON.parse(readFileSync(floorsFile, "utf8")).floors["assets/js/main.js"] === 90, "main.js stays 90");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/* ---- the review fixes (#14): raise from the worst run, say what changes, say what is skipped, no stale runs ---- */
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const coverageMjs = join(root, "tools/ci/coverage.mjs");
const LOCK = "assets/js/lock.js";
const lockSrc = readFileSync(join(root, LOCK), "utf8");
const DATA = "assets/js/data.js";
const dataSrc = readFileSync(join(root, DATA), "utf8");
/* a run directory holding one Chromium record: `ran` ranges of the given site file (a script is [file, source, ranges]) */
const makeRun = (dir, scripts) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "browser-t-1.json"), JSON.stringify({ scripts: Object.fromEntries(scripts.map(([f, src, ran]) => [f, { length: src.length, ran }])) }));
  return dir;
};
const out = (r) => `${r.stdout || ""}${r.stderr || ""}`;
const linesOf = (r) => out(r).split("\n");
const raise = (floorsFile, dirs, cwd = root, tool = coverageMjs) => spawnSync(process.execPath, [tool, "--raise", "--floors", floorsFile, ...dirs], { encoding: "utf8", cwd });
const floorsOf = (file) => JSON.parse(readFileSync(file, "utf8")).floors;

/* 1. --raise treats each DIR as one run and raises to the lowest percent a file reached across them */
{
  const dir = mkdtempSync(join(tmpdir(), "coverage-test-"));
  try {
    const full = makeRun(join(dir, "full"), [[LOCK, lockSrc, [[0, lockSrc.length]]], [DATA, dataSrc, [[0, dataSrc.length]]]]);
    /* a cut of lock.js where the first part reaches some of its lines but not all */
    let cut = 0, cutPct = 0;
    for (let c = 10; c < lockSrc.length; c += 10) {
      const p = measure([makeRun(join(dir, "probe"), [[LOCK, lockSrc, [[0, c]]]])]).files[LOCK].percent;
      if (p > 0 && p < 100) { cut = c; cutPct = p; if (p >= 40) break; }
    }
    const half = makeRun(join(dir, "half"), [[LOCK, lockSrc, [[0, cut]]], [DATA, dataSrc, [[0, dataSrc.length]]]]);
    const full2 = makeRun(join(dir, "full2"), [[LOCK, lockSrc, [[0, lockSrc.length]]]]);
    const pct = (d, f) => measure([d]).files[f].percent;
    const lowest = pct(half, LOCK);
    check("(setup) the half run reaches less of lock.js than a full one, and a full one reaches 100", lowest > 0 && lowest < 100 && pct(full, LOCK) === 100, `half ${lowest}%, full ${pct(full, LOCK)}%`);
    const floorsFile = join(dir, "floors.json");
    const start = () => writeFileSync(floorsFile, JSON.stringify({ floors: { [LOCK]: 0 }, reasons: {} }));

    start();
    let r = raise(floorsFile, [full, half, full2]);
    check("--raise with three runs raises a floor only to the lowest percent the file reached in any run", floorsOf(floorsFile)[LOCK] === lowest, `lock.js floor ${floorsOf(floorsFile)[LOCK]} (want ${lowest}, the worst run; 100 means the runs were combined); exit ${r.status}`);
    check("... and the order of the runs does not matter", (() => { start(); raise(floorsFile, [half, full2, full]); return floorsOf(floorsFile)[LOCK] === lowest; })(), `lock.js floor ${floorsOf(floorsFile)[LOCK]}`);
    check("... a file one run never reached is raised to 0, not to what another run reached", (() => { start(); raise(floorsFile, [full, full2]); const f = floorsOf(floorsFile); return f[DATA] === 0 && f[LOCK] === 100; })(), `data.js floor ${floorsOf(floorsFile)[DATA]} (want 0: full2 never ran it), lock.js ${floorsOf(floorsFile)[LOCK]} (want 100)`);

    writeFileSync(floorsFile, JSON.stringify({ floors: { [LOCK]: 100 }, reasons: {} }));
    raise(floorsFile, [full, half, full2]);
    check("--raise from the worst run still never lowers a floor", floorsOf(floorsFile)[LOCK] === 100, `lock.js floor ${floorsOf(floorsFile)[LOCK]} (want it kept at 100)`);

    writeFileSync(floorsFile, JSON.stringify({ floors: { [LOCK]: 0 }, reasons: {} }));
    raise(floorsFile, [full]);
    check("--raise with one run raises to that run", floorsOf(floorsFile)[LOCK] === 100, `lock.js floor ${floorsOf(floorsFile)[LOCK]}`);

    /* without --raise, several DIRs are one combined measurement */
    const first = makeRun(join(dir, "first"), [[LOCK, lockSrc, [[0, cut]]]]);
    const second = makeRun(join(dir, "second"), [[LOCK, lockSrc, [[cut, lockSrc.length]]]]);
    const together = measure([first, second]).files[LOCK].percent;
    check("(setup) two halves together reach more than either alone", together === 100 && pct(first, LOCK) < 100 && pct(second, LOCK) < 100 && pct(first, LOCK) > 0, `together ${together}%, first ${pct(first, LOCK)}%, second ${pct(second, LOCK)}%`);
    const all = Object.fromEntries(Object.entries(measure([first, second]).files).map(([f, m]) => [f, m.percent]));
    writeFileSync(floorsFile, JSON.stringify({ floors: all, reasons: {} }));
    r = spawnSync(process.execPath, [coverageMjs, "--floors", floorsFile, first, second], { encoding: "utf8" });
    check("without --raise, several DIRs are still combined into one measurement (floors at the combined percent pass)", r.status === 0 && /coverage: ok/.test(r.stdout), `exit ${r.status}: ${r.stdout.split("\n").slice(-3).join(" | ")}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/* 1. the usage text and the floors file say to pass three runs */
{
  const usage = spawnSync(process.execPath, [coverageMjs], { encoding: "utf8", cwd: root });
  const about = JSON.parse(readFileSync(join(root, "tools/ci/coverage-floors.json"), "utf8")).about;
  check("coverage.mjs's usage text says to pass three runs to --raise", /--raise/.test(out(usage)) && /\b(three|3)\b[^\n]*runs|runs[^\n]*\b(three|3)\b/i.test(out(usage)), JSON.stringify(out(usage).trim()));
  check("coverage-floors.json's about says to pass three runs to --raise", /--raise[^.]*\b(three|3)\b[^.]*runs|\b(three|3)\b runs[^.]*--raise/i.test(about), JSON.stringify(about.slice(about.indexOf("A change"), about.indexOf("A change") + 160)));
}

/* 2. --raise prints each floor it adds or raises, with its value */
{
  const dir = mkdtempSync(join(tmpdir(), "coverage-test-"));
  try {
    const run = makeRun(join(dir, "run"), [[LOCK, lockSrc, [[0, lockSrc.length]]], [DATA, dataSrc, [[0, dataSrc.length]]]]);
    const floorsFile = join(dir, "floors.json");
    writeFileSync(floorsFile, JSON.stringify({ floors: { [LOCK]: 60 }, reasons: {} }));
    const r = raise(floorsFile, [run]);
    const after = floorsOf(floorsFile);
    const added = siteFiles(root).filter((f) => f !== LOCK);
    check("(setup) --raise raised lock.js and added the others", r.status === 0 && after[LOCK] === 100 && added.every((f) => f in after), `exit ${r.status}, lock.js ${after[LOCK]}, ${Object.keys(after).length} floors`);
    const missing = added.filter((f) => !linesOf(r).some((l) => l.includes(f) && l.includes(String(after[f]))));
    check("--raise prints a line with the file and the floor value for every floor it adds", missing.length === 0, missing.length ? `no line for ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? " ..." : ""}` : `${added.length} added, each named`);
    check("... the value printed for data.js is the one written (100)", after[DATA] === 100 && linesOf(r).some((l) => l.includes(DATA) && /\b100\b/.test(l)), JSON.stringify(linesOf(r).filter((l) => l.includes(DATA))));
    check("--raise prints a line with the file and the new value for a floor it raises (lock.js 60 -> 100)", linesOf(r).some((l) => l.includes(LOCK) && /\b100\b/.test(l) && !/^\S+\s+\d+\s+\d+\s+\d+%/.test(l.trim())), JSON.stringify(linesOf(r).filter((l) => l.includes(LOCK))));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/* 2. --raise never removes a floor: a floor whose file is gone fails the check, with or without --raise, naming the file and
   saying to move or remove it by hand. No rename detection: the old name's floor is not carried to the new one. */
{
  const dir = mkdtempSync(join(tmpdir(), "coverage-test-"));
  try {
    const run = makeRun(join(dir, "run"), [[LOCK, lockSrc, [[0, lockSrc.length]]]]);
    const floorsFile = join(dir, "floors.json");
    const GONE = "assets/js/not-there.js";
    const reason = "needs a real GPU to run at all";
    const all = Object.fromEntries(siteFiles(root).map((f) => [f, 0]));
    const original = JSON.stringify({ floors: { ...all, [LOCK]: 60, [GONE]: 37 }, reasons: { [GONE]: reason } });
    const said = (r) => out(r).split("\n").some((l) => l.includes(GONE) && /by hand/i.test(l)) || (out(r).includes(GONE) && /by hand/i.test(out(r)));
    writeFileSync(floorsFile, original);
    let r = raise(floorsFile, [run]);
    let after = JSON.parse(readFileSync(floorsFile, "utf8"));
    check("--raise keeps the floor of a file that is gone, and its reason", after.floors[GONE] === 37 && after.reasons[GONE] === reason, `floor ${after.floors[GONE]}, reason ${JSON.stringify(after.reasons[GONE])}`);
    check("--raise with a gone file fails and names it", r.status !== 0 && out(r).includes(GONE), `exit ${r.status}`);
    check("... and says to move its floor to the new name or remove it by hand", said(r) && /move/i.test(out(r)) && /remove/i.test(out(r)), JSON.stringify(out(r).split("\n").filter((l) => /GONE|gone|by hand/i.test(l))));
    writeFileSync(floorsFile, original);
    r = spawnSync(process.execPath, [coverageMjs, "--floors", floorsFile, run], { encoding: "utf8", cwd: root });
    check("the check without --raise fails on it too, saying to move or remove it by hand", r.status === 1 && said(r) && /move/i.test(out(r)) && /remove/i.test(out(r)), `exit ${r.status}: ${JSON.stringify(out(r).split("\n").filter((l) => l.includes(GONE) || /by hand/i.test(l)))}`);
    check("... and the check does not change the floors file", readFileSync(floorsFile, "utf8") === original, "file compared");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/* 2. a committed rename: the old name's floor is not moved by --raise, and the check fails on it until it is moved by hand.
   A scratch repo holds the tool; the old file is committed, then renamed and the rename committed. */
{
  const dir = mkdtempSync(join(tmpdir(), "coverage-test-"));
  const git = (...a) => spawnSync("/usr/bin/git", ["-c", "user.name=t", "-c", "user.email=t@example.test", ...a], { cwd: dir, encoding: "utf8" });
  try {
    mkdirSync(join(dir, "tools/ci"), { recursive: true });
    mkdirSync(join(dir, "assets/js"), { recursive: true });
    mkdirSync(join(dir, "assets/door"), { recursive: true });
    for (const f of ["coverage.mjs", "coverage-lib.mjs"]) copyFileSync(join(root, "tools/ci", f), join(dir, "tools/ci", f));
    const body = "const a = 1;\nfunction f() {\n  return 2;\n}\nfunction g() {\n  return 3;\n}\nf();\ng();\n";
    writeFileSync(join(dir, "sw.js"), "self.x = 1;\n");
    writeFileSync(join(dir, "assets/js/old.js"), body);
    git("init", "-q"); git("add", "-A"); git("commit", "-q", "-m", "x");
    git("mv", "assets/js/old.js", "assets/js/new.js"); git("commit", "-q", "-m", "rename");
    const tool = join(dir, "tools/ci/coverage.mjs");
    const run = join(dir, "run");
    mkdirSync(run);
    writeFileSync(join(run, "browser-t-1.json"), JSON.stringify({ scripts: { "assets/js/new.js": { length: body.length, ran: [[0, body.indexOf("function g")]] } } }));
    const floorsFile = join(dir, "floors.json");
    const original = JSON.stringify({ floors: { "assets/js/old.js": 95, "sw.js": 0 }, reasons: {} });
    writeFileSync(floorsFile, original);
    let r = raise(floorsFile, [run], dir, tool);
    let after = floorsOf(floorsFile);
    check("after a committed rename, --raise leaves the old name's floor where it is and fails naming it", after["assets/js/old.js"] === 95 && r.status !== 0 && out(r).includes("assets/js/old.js"), `exit ${r.status}, old.js floor ${after["assets/js/old.js"]}`);
    check("... and does not give the new name a floor above what it measured (no carry-over)", !(after["assets/js/new.js"] >= 95), `new.js floor ${after["assets/js/new.js"]}`);
    writeFileSync(floorsFile, original);
    r = spawnSync(process.execPath, [tool, "--floors", floorsFile, run], { encoding: "utf8", cwd: dir });
    check("the check fails on the old name and tells how to fix it by hand", r.status === 1 && /old\.js/.test(out(r)) && /by hand/i.test(out(r)), `exit ${r.status}`);
    writeFileSync(floorsFile, JSON.stringify({ floors: { "assets/js/new.js": 40, "sw.js": 0 }, reasons: {} }));
    r = spawnSync(process.execPath, [tool, "--floors", floorsFile, run], { encoding: "utf8", cwd: dir });
    check("(control) with the floor moved to the new name by hand, the check passes", r.status === 0 && /coverage: ok/.test(out(r)), `exit ${r.status}: ${out(r).split("\n").filter(Boolean).slice(-2).join(" | ")}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/* 3. the recorder says what it skips. A stand-in Playwright (a package directory the hook finds through PLAYWRIGHT_ROOT)
   hands each page V8's script entries, as stopJSCoverage returns them; the hook wraps its chromium.launch. */
{
  const dir = mkdtempSync(join(tmpdir(), "coverage-test-"));
  try {
    const pw = join(dir, "fakepw");
    mkdirSync(pw);
    writeFileSync(join(pw, "package.json"), JSON.stringify({ name: "playwright", main: "index.js" }));
    writeFileSync(join(pw, "index.js"), `
const fs = require("fs");
const entries = JSON.parse(fs.readFileSync(process.env.FAKE_ENTRIES, "utf8"));
const ORIGIN = "http://127.0.0.1:9";
function mkPage() {
  const handlers = {};
  const page = {
    url: () => ORIGIN + "/",
    on: (e, f) => { (handlers[e] ||= []).push(f); return page; },
    once: (e, f) => page.on(e, f),
    emit: (e, ...a) => (handlers[e] || []).forEach((f) => f(...a)),
    goto: async () => { page.emit("framenavigated", { parentFrame: () => null }); },
    close: async () => { page.emit("close", page); },
    coverage: {
      startJSCoverage: async () => {},
      stopJSCoverage: async () => entries.map((e) => ({ url: ORIGIN + "/" + e.path, source: e.source, functions: [{ ranges: [{ startOffset: 0, endOffset: (e.source || "").length || e.length, count: 1 }] }] })),
    },
  };
  return new Proxy(page, { get: (t, k) => (k in t || typeof k === "symbol" || k === "then") ? t[k] : async () => {} });
}
function mkCtx() {
  const handlers = {};
  return { on: (e, f) => { (handlers[e] ||= []).push(f); }, newPage: async () => { const p = mkPage(); (handlers.page || []).forEach((f) => f(p)); return p; }, close: async () => {}, pages: () => [] };
}
exports.chromium = { launch: async () => ({ newContext: async () => mkCtx(), newPage: async () => mkCtx().newPage(), close: async () => {}, contexts: () => [] }), name: () => "chromium" };
`);
    writeFileSync(join(dir, "driver.mjs"), `
import { createRequire } from "node:module";
const pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT_ROOT);
const b = await pw.chromium.launch();
const p = await (await b.newContext()).newPage();
await p.goto("http://127.0.0.1:9/");
await p.goto("http://127.0.0.1:9/#again");
await p.close();
await b.close();
`);
    const sw = readFileSync(join(root, "sw.js"), "utf8");
    const hook = (name, entries) => {
      const entriesFile = join(dir, name + ".json");
      const cov = join(dir, "cov-" + name);
      writeFileSync(entriesFile, JSON.stringify(entries));
      const r = spawnSync(process.execPath, ["--import", join(root, "tools/ci/coverage-hook.mjs"), join(dir, "driver.mjs")], { encoding: "utf8", cwd: root, env: { ...process.env, FAKE_ENTRIES: entriesFile, PLAYWRIGHT_ROOT: pw, COVERAGE_DIR: cov } });
      let scripts = null;
      try { const f = readdirSync(cov).find((x) => /^browser-.*\.json$/.test(x)); if (f) scripts = JSON.parse(readFileSync(join(cov, f), "utf8")).scripts; } catch {}
      return { r, scripts };
    };
    const only = (r, path) => linesOf(r).filter((l) => l.includes(path));

    const ok = hook("agree", [{ path: LOCK, source: lockSrc }, { path: "sw.js", source: sw }]);
    check("(setup) the stand-in Playwright runs under the hook and a script that matches the disk is recorded", ok.r.status === 0 && ok.scripts && LOCK in ok.scripts && "sw.js" in ok.scripts, `exit ${ok.r.status}, scripts ${JSON.stringify(ok.scripts && Object.keys(ok.scripts))}; ${out(ok.r).slice(0, 200)}`);
    check("a script that matches the disk is not reported as skipped", only(ok.r, LOCK).length === 0, JSON.stringify(only(ok.r, LOCK)));

    const differs = hook("differs", [{ path: LOCK, source: lockSrc + "\n// served differently\n" }, { path: "sw.js", source: sw }]);
    check("a script whose served copy differs from the disk is not counted", differs.scripts && !(LOCK in differs.scripts) && "sw.js" in differs.scripts, `scripts ${JSON.stringify(differs.scripts && Object.keys(differs.scripts))}`);
    const dl = only(differs.r, LOCK);
    check("... and the hook prints exactly one line for it, naming the path and that the served copy differs from disk", dl.length === 1 && /differ/i.test(dl[0]), `${dl.length} lines: ${JSON.stringify(dl)} (the page navigated twice and closed: still one line per script per run)`);

    const nosrc = hook("nosource", [{ path: DATA, length: dataSrc.length }, { path: "sw.js", source: sw }]);
    check("a script whose source the hook could not get to compare is not counted", nosrc.scripts && !(DATA in nosrc.scripts) && "sw.js" in nosrc.scripts, `scripts ${JSON.stringify(nosrc.scripts && Object.keys(nosrc.scripts))}`);
    const nl = only(nosrc.r, DATA);
    check("... and the hook prints exactly one line for it, naming the path and that the source was not available to compare", nl.length === 1 && /not available|unavailable|no source/i.test(nl[0]), `${nl.length} lines: ${JSON.stringify(nl)}`);
    check("the two reasons are told apart", dl.length === 1 && nl.length === 1 && !/not available|unavailable/i.test(dl[0]) && !/differ/i.test(nl[0]), `${JSON.stringify([dl[0], nl[0]])}`);

    /* the file's name carries the shard (#95, ADR-0005 sections 3 and 3a): browser-<test>-<CI_NODE_INDEX or 0>-<pid>.json,
       so shards cannot overwrite each other in the merged artifact */
    const named = (name, index) => {
      const entriesFile = join(dir, name + ".json");
      const cov = join(dir, "cov-" + name);
      writeFileSync(entriesFile, JSON.stringify([{ path: "sw.js", source: sw }]));
      const env = { ...process.env, FAKE_ENTRIES: entriesFile, PLAYWRIGHT_ROOT: pw, COVERAGE_DIR: cov };
      delete env.CI_NODE_INDEX;
      if (index !== undefined) env.CI_NODE_INDEX = index;
      const r = spawnSync(process.execPath, ["--import", join(root, "tools/ci/coverage-hook.mjs"), join(dir, "driver.mjs")], { encoding: "utf8", cwd: root, env });
      let files = [];
      try { files = readdirSync(cov); } catch {}
      return { r, files };
    };
    const s2 = named("shard2", "2");
    check("with CI_NODE_INDEX=2 the hook names its file browser-<test>-2-<pid>.json", s2.r.status === 0 && same(s2.files, [`browser-driver-2-${s2.r.pid}.json`]), `exit ${s2.r.status}, files ${JSON.stringify(s2.files)} (want ${JSON.stringify([`browser-driver-2-${s2.r.pid}.json`])})`);
    const s0 = named("shard0");
    check("without CI_NODE_INDEX the hook names its file browser-<test>-0-<pid>.json", s0.r.status === 0 && same(s0.files, [`browser-driver-0-${s0.r.pid}.json`]), `exit ${s0.r.status}, files ${JSON.stringify(s0.files)} (want ${JSON.stringify([`browser-driver-0-${s0.r.pid}.json`])})`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/* 4. coverage-run.sh: no stale browser runs, and a clear stop when the Node coverage is missing. `node` and `xvfb-run` are stand-ins that
   fail at once (so no test or browser runs) and leave a mark if anything calls it; PLAYWRIGHT_ROOT is a bare directory. */
{
  const dir = mkdtempSync(join(tmpdir(), "coverage-test-"));
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "node"), '#!/bin/sh\necho called >> "$FAKE_NODE_MARK"\nexit 1\n', { mode: 0o755 });
    /* the real xvfb-run starts an X server that outlives the stand-in node; this one starts nothing */
    writeFileSync(join(bin, "xvfb-run"), '#!/bin/sh\necho called >> "$FAKE_NODE_MARK"\nexit 1\n', { mode: 0o755 });
    const pw = join(dir, "pw");
    mkdirSync(join(pw, "node_modules/playwright"), { recursive: true });
    writeFileSync(join(pw, "node_modules/playwright/package.json"), "{}");
    const runSh = (mode, cov) => spawnSync("sh", [join(root, "tools/ci/coverage-run.sh"), mode], { encoding: "utf8", cwd: root, timeout: 60000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, COVERAGE_DIR: cov, PLAYWRIGHT_ROOT: pw, FAKE_NODE_MARK: join(dir, "mark") } });

    const stale = join(dir, "stale");
    mkdirSync(join(stale, "node"), { recursive: true });
    writeFileSync(join(stale, "browser-old-1.json"), "{}");
    writeFileSync(join(stale, "browser-journey-99.json"), "{}");
    writeFileSync(join(stale, "node", "coverage-1.json"), "{}");
    runSh("browser", stale);
    check("coverage-run.sh browser removes the earlier browser records before its runs", !existsSync(join(stale, "browser-old-1.json")) && !existsSync(join(stale, "browser-journey-99.json")), `left: ${JSON.stringify(readdirSync(stale))}`);
    check("... and keeps Node's records", existsSync(join(stale, "node", "coverage-1.json")), `left: ${JSON.stringify(readdirSync(join(stale, "node")))}`);

    /* $COVERAGE_DIR may be a symbolic link to a directory (CI artifacts, a shared scratch): the records behind it go too */
    const target = join(dir, "target");
    mkdirSync(join(target, "node"), { recursive: true });
    writeFileSync(join(target, "browser-old-1.json"), "{}");
    writeFileSync(join(target, "browser-journey-99.json"), "{}");
    writeFileSync(join(target, "node", "coverage-1.json"), "{}");
    const link = join(dir, "link");
    symlinkSync(target, link);
    runSh("browser", link);
    check("coverage-run.sh browser removes the earlier browser records when $COVERAGE_DIR is a symbolic link to a directory", !existsSync(join(target, "browser-old-1.json")) && !existsSync(join(target, "browser-journey-99.json")), `left in the target: ${JSON.stringify(readdirSync(target))}`);
    check("... keeps Node's records behind the link, and the link itself", existsSync(join(target, "node", "coverage-1.json")) && lstatSync(link).isSymbolicLink(), `node records ${existsSync(join(target, "node", "coverage-1.json")) ? "kept" : "gone"}`);

    for (const mode of ["browser", "check"]) {
      const nonode = join(dir, "nonode-" + mode);
      mkdirSync(nonode);
      writeFileSync(join(nonode, "browser-old-1.json"), "{}");
      const r = runSh(mode, nonode);
      check(`coverage-run.sh ${mode} stops with a clear message when ${"$COVERAGE_DIR"}/node is missing`, r.status !== 0 && /no Node coverage in/.test(out(r)) && out(r).includes(nonode) && /lint job/i.test(out(r)), `exit ${r.status}: ${JSON.stringify(out(r).split("\n").filter(Boolean).slice(-3))}`);
      check(`... and ${mode} did not start the runs`, !/recording coverage/.test(out(r)), JSON.stringify(out(r).split("\n").filter(Boolean).slice(0, 2)));
    }
    const withNode = join(dir, "withnode");
    mkdirSync(join(withNode, "node"), { recursive: true });
    /* every stand-in run fails, and so does the check: the failure is said to cut the coverage short, and the check's own exit stays */
    const failedRuns = runSh("browser", withNode);
    check("coverage-run.sh browser says a failed Chromium run left coverage incomplete when the check fails, and still exits non-zero", failedRuns.status !== 0 && /failed in Chromium: journey/.test(out(failedRuns)) && /incomplete because the Chromium run failed/.test(out(failedRuns)), `exit ${failedRuns.status}: ${JSON.stringify(out(failedRuns).split("\n").filter(Boolean).slice(-2))}`);
    check("(control) with a node directory, check does not say the Node coverage is missing", !/no Node coverage/.test(out(runSh("check", withNode))), "no message");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/* 5. coverage.mjs exits 2 when it finds no input */
{
  const dir = mkdtempSync(join(tmpdir(), "coverage-test-"));
  try {
    const empty = join(dir, "empty");
    mkdirSync(join(empty, "node"), { recursive: true });
    writeFileSync(join(empty, "notes.txt"), "not coverage");
    let r = spawnSync(process.execPath, [coverageMjs, empty], { encoding: "utf8", cwd: root });
    check("coverage.mjs exits 2 when the directory holds no coverage", r.status === 2 && /no coverage found/.test(out(r)), `exit ${r.status}: ${out(r).trim().split("\n")[0]}`);
    r = spawnSync(process.execPath, [coverageMjs, "--raise", "--floors", join(dir, "f.json"), empty], { encoding: "utf8", cwd: root });
    check("... and --raise with no coverage exits 2 and writes no floors", r.status === 2 && !existsSync(join(dir, "f.json")), `exit ${r.status}, floors file ${existsSync(join(dir, "f.json")) ? "written" : "not written"}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/* M. --selection FILE (#95, ADR-0005 sections 6 and 6a, batch 3), written from the ADR before the code: FILE is
   test-select.mjs --json's answer, {"all", "tests", "changed"}. `all` true, or no --selection, is a full run (the
   ratchet as today, first line `coverage: full run`). `all` false is a partial run (first line
   `coverage: partial run (<n> changed paths)`): a gone floor still fails; a measured file in `changed` is held to its
   floor, with a sentence saying the map, not the floor, is wrong; every other measured file is printed
   `<file>: <percent>% (not measured in full; floor <floor>)` and never fails; a file with no floor fails only when
   it is in `changed`, else `(new file not in this change)`. --raise refuses a directory whose selection.json says
   `all` false (exit 2, `coverage: --raise needs full runs`). Paths in `changed` that are not measured files change
   nothing. */
{
  const dir = mkdtempSync(join(tmpdir(), "coverage-test-"));
  try {
    /* a run that reaches part of lock.js and all of data.js */
    let cut = 0;
    for (let c = 10; c < lockSrc.length; c += 10) {
      const p = measure([makeRun(join(dir, "probe"), [[LOCK, lockSrc, [[0, c]]]])]).files[LOCK].percent;
      if (p > 0 && p < 100) { cut = c; if (p >= 40) break; }
    }
    const run = makeRun(join(dir, "run"), [[LOCK, lockSrc, [[0, cut]]], [DATA, dataSrc, [[0, dataSrc.length]]]]);
    const measured = Object.fromEntries(Object.entries(measure([run]).files).map(([f, m]) => [f, m.percent]));
    const p = measured[LOCK];
    check("M0 (setup) the run reaches part of lock.js and all of data.js", p > 0 && p < 100 && measured[DATA] === 100, `lock.js ${p}%, data.js ${measured[DATA]}%`);
    const floorsFile = join(dir, "floors.json");
    const selFile = join(dir, "selection.json");
    /* the check on `run` with these floors and, unless sel is null, --selection holding sel */
    const cov = (floors, sel) => {
      writeFileSync(floorsFile, JSON.stringify({ floors, reasons: {} }));
      const args = ["--floors", floorsFile];
      if (sel) { writeFileSync(selFile, JSON.stringify(sel)); args.push("--selection", selFile); }
      return spawnSync(process.execPath, [coverageMjs, ...args, run], { encoding: "utf8", cwd: root });
    };
    const sel = (all, changed) => ({ all, tests: all ? ["journey", "csp"] : ["journey"], changed });
    const first = (r) => (r.stdout || "").split("\n")[0];
    const tell = (r) => `exit ${r.status}, first line ${JSON.stringify(first(r))}; ${JSON.stringify(out(r).split("\n").filter((l) => /lock\.js|data\.js|not-there|FLOOR|GONE|coverage:/.test(l)).slice(0, 8))}`;
    const below = `${LOCK}: ${p}% < ${p + 1}%`;
    const SENTENCE = "(changed in this merge request: its group ran in full; if a test outside its group covers it, the map is wrong, not the floor)";
    const notInFull = (r, f, pct, floor) => linesOf(r).some((l) => l.includes(`${f}: ${pct}% (not measured in full; floor ${floor}`) && new RegExp(`floor ${floor}%?\\)`).test(l));
    const lockHigh = { ...measured, [LOCK]: p + 1 };

    /* (1), (2) full runs */
    const plain = cov(lockHigh, null);
    const allTrue = cov(lockHigh, sel(true, [DATA, "README.md"]));
    check("M1 no --selection is a full run: the first line is `coverage: full run`", first(plain) === "coverage: full run", tell(plain));
    check("M1 ... and the ratchet as today: a file below its floor fails with the full run's line", plain.status === 1 && /BELOW ITS FLOOR/.test(plain.stdout) && plain.stdout.includes(below), tell(plain));
    check("M2 a selection with all true is a full run: first line `coverage: full run`, and it fails on lock.js though only data.js changed", allTrue.status === 1 && first(allTrue) === "coverage: full run" && allTrue.stdout.includes(below), tell(allTrue));
    check("M2 ... and its report is the same as with no --selection", allTrue.stdout === plain.stdout && allTrue.status === plain.status, allTrue.stdout === plain.stdout ? "same" : "reports differ");
    const okPlain = cov(measured, null);
    check("M2 (control) a full run with floors at what was measured passes", okPlain.status === 0 && first(okPlain) === "coverage: full run" && /coverage: ok/.test(okPlain.stdout), tell(okPlain));
    const { [DATA]: _d, ...noDataFloor } = measured;
    const fullUnset = cov(noDataFloor, sel(true, []));
    check("M2 a full run (all true, nothing changed) still fails a file with no floor", fullUnset.status === 1 && /NO FLOOR/.test(fullUnset.stdout) && fullUnset.stdout.includes(DATA), tell(fullUnset));

    /* (3) partial: a changed file below its floor fails */
    const changedBelow = cov(lockHigh, sel(false, [LOCK, "README.md"]));
    check("M3 a partial run's first line is `coverage: partial run (<n> changed paths)`, n the length of changed", first(changedBelow) === "coverage: partial run (2 changed paths)", tell(changedBelow));
    const at = linesOf(changedBelow).findIndex((l) => l.includes(below));
    const lns = linesOf(changedBelow);
    check("M3 a changed measured file below its floor fails (exit 1) with the full run's line", changedBelow.status === 1 && at >= 0, tell(changedBelow));
    check("M3 ... and the sentence that the map is wrong, not the floor, with that line or the next", at >= 0 && (lns[at].includes(SENTENCE) || (lns[at + 1] || "").includes(SENTENCE)), JSON.stringify(lns.slice(Math.max(at, 0), at + 2)));
    check("M3 ... and lock.js is not also reported as not measured in full", !linesOf(changedBelow).some((l) => l.includes(LOCK) && /not measured in full/.test(l)), JSON.stringify(linesOf(changedBelow).filter((l) => l.includes(LOCK))));

    /* (4) partial: an untouched file below its floor passes */
    const untouched = cov(lockHigh, sel(false, [DATA, "README.md"]));
    check("M4 a partial run with an untouched measured file below its floor passes (exit 0)", untouched.status === 0 && first(untouched) === "coverage: partial run (2 changed paths)", tell(untouched));
    check("M4 ... and prints `<file>: <percent>% (not measured in full; floor <floor>)` for it", notInFull(untouched, LOCK, p, p + 1), JSON.stringify(linesOf(untouched).filter((l) => l.includes(LOCK))));
    check("M4 ... and does not print it as below its floor", !/BELOW ITS FLOOR/.test(untouched.stdout) && !untouched.stdout.includes(below), tell(untouched));
    const others = Object.keys(measured).filter((f) => f !== DATA && f !== LOCK);
    const unprinted = others.filter((f) => !notInFull(untouched, f, measured[f], measured[f]));
    check("M4 ... every other measured file not in changed is printed not measured in full, with its floor", others.length > 0 && unprinted.length === 0, unprinted.length ? `not so printed: ${unprinted.slice(0, 3).join(", ")}` : `${others.length} files`);
    check("M4 ... and data.js, which changed, is not", !linesOf(untouched).some((l) => l.includes(DATA) && /not measured in full/.test(l)), JSON.stringify(linesOf(untouched).filter((l) => l.includes(DATA))));

    /* (5) partial: a gone floor still fails */
    const GONE = "assets/js/not-there.js";
    const gone = cov({ ...measured, [GONE]: 10 }, sel(false, ["README.md", "docs/adr/0001.md"]));
    check("M5 a floor whose file is gone fails a partial run too, naming it", gone.status === 1 && first(gone) === "coverage: partial run (2 changed paths)" && /GONE/.test(gone.stdout) && gone.stdout.includes(GONE), tell(gone));

    /* (6) partial: a file with no floor */
    const unsetChanged = cov(noDataFloor, sel(false, [DATA, "README.md"]));
    check("M6 a file with no floor, in changed, fails a partial run as NO FLOOR, naming it", unsetChanged.status === 1 && /NO FLOOR/.test(unsetChanged.stdout) && linesOf(unsetChanged).some((l) => l.includes(DATA)), tell(unsetChanged));
    const unsetOther = cov(noDataFloor, sel(false, [LOCK, "README.md"]));
    check("M6 a file with no floor, not in changed, passes a partial run", unsetOther.status === 0, tell(unsetOther));
    check("M6 ... and is printed `(new file not in this change)`", linesOf(unsetOther).some((l) => l.includes(DATA) && l.includes("(new file not in this change)")), JSON.stringify(linesOf(unsetOther).filter((l) => l.includes(DATA))));

    /* (8) a changed path that is not a measured file changes nothing */
    const onlyData = cov(lockHigh, sel(false, [DATA]));
    const plusReadme = cov(lockHigh, sel(false, [DATA, "README.md"]));
    const rest = (r) => (r.stdout || "").split("\n").slice(1).join("\n");
    check("M8 adding README.md (not a measured file) to changed changes nothing but the count", onlyData.status === plusReadme.status && rest(onlyData) === rest(plusReadme) && first(plusReadme) === "coverage: partial run (2 changed paths)", `exit ${onlyData.status} and ${plusReadme.status}; reports after the first line ${rest(onlyData) === rest(plusReadme) ? "the same" : "differ"}`);
    const readmeOnly = cov(lockHigh, sel(false, ["README.md", "tools/ci/lint.sh"]));
    check("M8 ... and changed holding only paths that are not measured files fails nothing", readmeOnly.status === 0 && notInFull(readmeOnly, LOCK, p, p + 1), tell(readmeOnly));

    /* (7) --raise reads the mode from each DIR's selection.json */
    const withSel = (name, s) => { const d = makeRun(join(dir, name), [[LOCK, lockSrc, [[0, lockSrc.length]]], [DATA, dataSrc, [[0, dataSrc.length]]]]); if (s) writeFileSync(join(d, "selection.json"), JSON.stringify(s)); return d; };
    const fullDir = withSel("full-sel", sel(true, []));
    const bareDir = withSel("bare", null);
    const partDir = withSel("part-sel", sel(false, [LOCK]));
    const zero = JSON.stringify({ floors: Object.fromEntries(Object.keys(measured).map((f) => [f, 0])), reasons: {} });
    writeFileSync(floorsFile, zero);
    let r = raise(floorsFile, [fullDir, bareDir, partDir]);
    check("M7 --raise given a directory whose selection.json says all false exits 2 with `coverage: --raise needs full runs`", r.status === 2 && out(r).includes("coverage: --raise needs full runs"), `exit ${r.status}: ${JSON.stringify(out(r).split("\n").filter(Boolean).slice(0, 3))}`);
    check("M7 ... and writes no floors", readFileSync(floorsFile, "utf8") === zero, "floors file compared");
    r = raise(floorsFile, [partDir]);
    check("M7 ... and alone, too", r.status === 2 && out(r).includes("coverage: --raise needs full runs") && readFileSync(floorsFile, "utf8") === zero, `exit ${r.status}`);
    r = raise(floorsFile, [fullDir, bareDir]);
    check("M7 --raise on a directory whose selection.json says all true and one with no selection.json raises as today", r.status === 0 && floorsOf(floorsFile)[LOCK] === 100 && floorsOf(floorsFile)[DATA] === 100, `exit ${r.status}, lock.js ${floorsOf(floorsFile)[LOCK]}, data.js ${floorsOf(floorsFile)[DATA]}: ${JSON.stringify(out(r).split("\n").filter(Boolean).slice(-2))}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

process.exit(failed ? 1 : 0);
