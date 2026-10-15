/*
 * Test for the coverage check itself (#14): V8's ranges become lines that ran, the Chromium and Node records merge by
 * union, and the ratchet fails a file below its floor, a file with no floor and a floor with no file, and says what
 * can be raised.
 *
 *   node tools/ci/coverage-test.mjs
 *
 * No dependencies and no browser.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, copyFileSync, readdirSync } from "node:fs";
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

/* 2. --raise prints each floor it adds or removes: the file and the value, and a removed floor's reason */
{
  const dir = mkdtempSync(join(tmpdir(), "coverage-test-"));
  try {
    const run = makeRun(join(dir, "run"), [[LOCK, lockSrc, [[0, lockSrc.length]]], [DATA, dataSrc, [[0, dataSrc.length]]]]);
    const floorsFile = join(dir, "floors.json");
    const GONE = "assets/js/not-there.js";
    const reason = "needs a real GPU to run at all";
    writeFileSync(floorsFile, JSON.stringify({ floors: { [LOCK]: 60, [GONE]: 37 }, reasons: { [GONE]: reason } }));
    const r = raise(floorsFile, [run]);
    const after = floorsOf(floorsFile);
    const added = siteFiles(root).filter((f) => f !== LOCK);
    check("(setup) --raise added floors and removed the gone one", added.every((f) => f in after) && !(GONE in after) && r.status === 0, `exit ${r.status}, ${Object.keys(after).length} floors`);
    const missing = added.filter((f) => !linesOf(r).some((l) => l.includes(f) && l.includes(String(after[f]))));
    check("--raise prints a line with the file and the floor value for every floor it adds", missing.length === 0, missing.length ? `no line for ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? " ..." : ""}` : `${added.length} added, each named`);
    check("... the value printed for data.js is the one written (100)", after[DATA] === 100 && linesOf(r).some((l) => l.includes(DATA) && /\b100\b/.test(l)), JSON.stringify(linesOf(r).filter((l) => l.includes(DATA))));
    const goneLine = linesOf(r).find((l) => l.includes(GONE));
    check("--raise prints the file and the value of a floor it removes", !!goneLine && /\b37\b/.test(goneLine), JSON.stringify(goneLine));
    check("... and the removed floor's reason", out(r).includes(reason), out(r).includes(reason) ? "reason printed" : "the reason is not in the output");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/* 2. a rename keeps its floor: a floor added for a file is never lower than the floor removed for a file of identical content.
   A scratch repo holds the tool; the old file is committed, then renamed in the working tree (git mv, not committed). */
{
  const dir = mkdtempSync(join(tmpdir(), "coverage-test-"));
  const git = (...a) => spawnSync("/usr/bin/git", a, { cwd: dir, encoding: "utf8" });
  try {
    mkdirSync(join(dir, "tools/ci"), { recursive: true });
    mkdirSync(join(dir, "assets/js"), { recursive: true });
    mkdirSync(join(dir, "assets/door"), { recursive: true });
    for (const f of ["coverage.mjs", "coverage-lib.mjs"]) copyFileSync(join(root, "tools/ci", f), join(dir, "tools/ci", f));
    const body = "const a = 1;\nfunction f() {\n  return 2;\n}\nfunction g() {\n  return 3;\n}\nf();\ng();\n";
    const other = body + "const extra = 4;\n";
    writeFileSync(join(dir, "sw.js"), "self.x = 1;\n");
    writeFileSync(join(dir, "assets/js/old.js"), body);
    writeFileSync(join(dir, "assets/js/old2.js"), body.replace("return 2", "return 22"));
    git("init", "-q"); git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "-m", "x");
    git("mv", "assets/js/old.js", "assets/js/new.js");
    git("mv", "assets/js/old2.js", "assets/js/new2.js");
    writeFileSync(join(dir, "assets/js/new2.js"), other); /* renamed AND changed: not identical */
    const tool = join(dir, "tools/ci/coverage.mjs");
    const half = body.indexOf("function g");
    const run = join(dir, "run");
    mkdirSync(run);
    writeFileSync(join(run, "browser-t-1.json"), JSON.stringify({ scripts: {
      "assets/js/new.js": { length: body.length, ran: [[0, half]] },
      "assets/js/new2.js": { length: other.length, ran: [[0, half]] },
    } }));
    const floorsFile = join(dir, "floors.json");
    writeFileSync(floorsFile, JSON.stringify({ floors: { "assets/js/old.js": 95, "assets/js/old2.js": 95, "sw.js": 0 }, reasons: {} }));
    const r = raise(floorsFile, [run], dir, tool);
    const after = floorsOf(floorsFile);
    check("(setup) the scratch run measures the renamed files below the old floor, and the old paths are removed", r.status === 0 && !("assets/js/old.js" in after) && "assets/js/new.js" in after && after["assets/js/new.js"] !== undefined, `exit ${r.status}, floors ${JSON.stringify(after)}; ${out(r).split("\n").slice(0, 3).join(" | ")}`);
    check("a floor added for a renamed file (identical content) is not lower than the floor removed for the old name", after["assets/js/new.js"] >= 95, `new.js floor ${after["assets/js/new.js"]} (want at least 95)`);
    check("a renamed file whose content changed gets no carried-over floor (it is added at what was measured)", after["assets/js/new2.js"] < 95, `new2.js floor ${after["assets/js/new2.js"]} (want under 95)`);
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
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/* 4. coverage-run.sh: no stale browser runs, and a clear stop when the Node coverage is missing. `node` is a stand-in that
   fails at once (so no test or browser runs) and leaves a mark if anything calls it; PLAYWRIGHT_ROOT is a bare directory. */
{
  const dir = mkdtempSync(join(tmpdir(), "coverage-test-"));
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "node"), '#!/bin/sh\necho called >> "$FAKE_NODE_MARK"\nexit 1\n', { mode: 0o755 });
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

process.exit(failed ? 1 : 0);
