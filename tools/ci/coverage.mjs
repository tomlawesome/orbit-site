/*
 * Line coverage per file of the site's JavaScript, and the ratchet on it (#14).
 *
 *   node tools/ci/coverage.mjs DIR...            report, and fail if any file is below its floor
 *   node tools/ci/coverage.mjs --raise DIR DIR DIR  also raise tools/ci/coverage-floors.json: each DIR is one full run (pass
 *                                                three), and a file is raised to the lowest percent it reached in any run
 *   node tools/ci/coverage.mjs --floors FILE ... a different floors file (the tests use it)
 *
 * Each DIR holds V8 coverage, found by looking for *.json under it: the files tools/ci/coverage-hook.mjs writes for a
 * Chromium test, and/or Node's own (NODE_V8_COVERAGE=DIR node test.mjs). Their ranges are merged by union. A file
 * counts if it is sw.js or a .js file in assets/js or assets/door; test code and third-party code are not asked.
 *
 * The ratchet: tools/ci/coverage-floors.json holds, for each file, the whole percent it reached when the floor was
 * set, rounded down. The check fails if a file is below its floor, if a file has no floor (a new one: run with
 * --raise and commit the result), or if a floor names a file that is gone. When a change lifts a file the check says
 * so; the same merge request raises that floor (--raise). A floor is never lowered to pass a change; a file that
 * cannot sensibly be covered says why in the file's "reasons". Without --raise, several DIRs are one measurement (their
 * ranges are merged); with --raise each is a separate run, because a floor must hold on a bad run, not only on the
 * union of good ones. --raise prints every floor it adds or removes; a floor added for a file whose content is that of a
 * file whose floor is removed (a rename; the old content is read from git HEAD) is never lower than the old floor.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { coveredRanges, lineStats, wholePercent } from "./coverage-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SITE_FILE = /^(sw\.js|assets\/(?:js|door)\/[^/]+\.js)$/;

/* the files the report is about: every one of them, covered or not */
export function siteFiles(base = root) {
  const out = ["sw.js"].filter((f) => existsSync(join(base, f)));
  for (const d of ["assets/js", "assets/door"]) for (const f of readdirSync(join(base, d)).sort()) if (f.endsWith(".js")) out.push(`${d}/${f}`);
  return out;
}

const jsonFiles = (dir) => {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsonFiles(p));
    else if (name.endsWith(".json")) out.push(p);
  }
  return out;
};

/* Reads every coverage file under `dirs` into { file: Uint8Array of what ran }, for the files in `sources`. */
export function merge(dirs, sources, base = root) {
  const ran = new Map(Object.entries(sources).map(([f, src]) => [f, new Uint8Array(src.length)]));
  const add = (file, ranges) => {
    const mask = ran.get(file);
    if (!mask) return;
    for (const [s, e] of ranges) mask.fill(1, s, Math.min(e, mask.length));
  };
  let inputs = 0;
  for (const dir of dirs) {
    for (const p of jsonFiles(dir)) {
      let j;
      try { j = JSON.parse(readFileSync(p, "utf8")); } catch { continue; }
      if (j.scripts) { /* the hook's */
        inputs++;
        for (const [file, s] of Object.entries(j.scripts)) {
          if (!SITE_FILE.test(file) || !(file in sources)) continue;
          if (s.length !== sources[file].length) throw new Error(`${p}: ${file} was ${s.length} characters when it ran, but is ${sources[file].length} now`);
          add(file, s.ran);
        }
      } else if (Array.isArray(j.result)) { /* Node's */
        inputs++;
        for (const s of j.result) {
          if (!s.url?.startsWith("file://")) continue;
          const file = relative(base, fileURLToPath(s.url)).split("\\").join("/");
          if (!SITE_FILE.test(file) || !(file in sources)) continue;
          add(file, coveredRanges(s.functions, sources[file].length));
        }
      }
    }
  }
  return { ran, inputs };
}

/* The measurement: { file: { total, covered, percent, missed } }. */
export function measure(dirs, base = root) {
  const sources = {};
  for (const f of siteFiles(base)) sources[f] = readFileSync(join(base, f), "utf8");
  const { ran, inputs } = merge(dirs, sources, base);
  const out = {};
  for (const [f, src] of Object.entries(sources)) {
    const s = lineStats(src, ran.get(f));
    out[f] = { ...s, percent: wholePercent(s.covered, s.total) };
  }
  return { files: out, inputs };
}

/* The ratchet: what is wrong, and what could be raised. `floors` is { file: whole percent }. */
export function ratchet(files, floors) {
  const below = [], unset = [], gone = [], raisable = [];
  for (const [f, m] of Object.entries(files)) {
    if (!(f in floors)) unset.push(f);
    else if (m.percent < floors[f]) below.push({ file: f, percent: m.percent, floor: floors[f] });
    else if (m.percent > floors[f]) raisable.push({ file: f, percent: m.percent, floor: floors[f] });
  }
  for (const f of Object.keys(floors)) if (!(f in files)) gone.push(f);
  return { below, unset, gone, raisable };
}

/* The measurement across separate runs: each file at the lowest percent it reached in any one of them (a file a run
   never reached counts 0 there). Returns null if some run holds no coverage at all. */
export function measureWorst(runs, base = root) {
  const each = runs.map((d) => measure([d], base));
  const empty = runs.filter((_, i) => !each[i].inputs);
  if (empty.length) return { empty };
  const files = {};
  for (const f of Object.keys(each[0].files)) {
    const worst = each.reduce((w, m) => (m.files[f].percent < w.files[f].percent ? m : w), each[0]);
    files[f] = { ...worst.files[f] };
  }
  return { files, empty };
}

/* A file's content at git HEAD, or null (not in git, or no git). */
const committed = (file, base = root) => {
  try { return execFileSync("git", ["show", `HEAD:${file}`], { cwd: base, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; }
};

function main(argv) {
  let floorsFile = join(root, "tools/ci/coverage-floors.json");
  let raise = false;
  const dirs = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--raise") raise = true;
    else if (argv[i] === "--floors") floorsFile = resolve(argv[++i]);
    else dirs.push(argv[i]);
  }
  if (!dirs.length) { console.error("usage: node tools/ci/coverage.mjs [--raise] [--floors FILE] DIR...\n  --raise: pass three full runs, each its own DIR; a floor is raised to the lowest percent its file reached in any of them"); return 64; }
  let files;
  if (raise) {
    const w = measureWorst(dirs);
    if (w.empty.length) { console.error(`coverage: no coverage found under ${w.empty.join(", ")}`); return 2; }
    files = w.files;
    if (dirs.length < 3) console.log(`coverage: only ${dirs.length} run${dirs.length === 1 ? "" : "s"} given; pass three full runs so a floor holds on a bad run\n`);
  } else {
    const m = measure(dirs);
    if (!m.inputs) { console.error(`coverage: no coverage found under ${dirs.join(", ")}`); return 2; }
    files = m.files;
  }

  const doc = existsSync(floorsFile) ? JSON.parse(readFileSync(floorsFile, "utf8")) : { floors: {}, reasons: {} };
  const { below, unset, gone, raisable } = ratchet(files, doc.floors);

  const width = Math.max(...Object.keys(files).map((f) => f.length));
  let covered = 0, total = 0;
  console.log(`${"file".padEnd(width)}  lines  ran  percent  floor`);
  for (const [f, m] of Object.entries(files)) {
    covered += m.covered; total += m.total;
    console.log(`${f.padEnd(width)}  ${String(m.total).padStart(5)}  ${String(m.covered).padStart(3)}  ${String(m.percent).padStart(6)}%  ${f in doc.floors ? doc.floors[f] + "%" : "-"}`);
  }
  console.log(`${"all".padEnd(width)}  ${String(total).padStart(5)}  ${String(covered).padStart(3)}  ${String(wholePercent(covered, total)).padStart(6)}%`);

  if (raisable.length) {
    console.log("\ncan be raised (the same merge request raises them: node tools/ci/coverage.mjs --raise DIR DIR DIR, three full runs):");
    for (const r of raisable) console.log(`  ${r.file}: ${r.floor}% -> ${r.percent}%`);
  }
  if (raise) {
    console.log("\nfloor changes:");
    for (const r of raisable) { doc.floors[r.file] = r.percent; console.log(`  raised ${r.file}: ${r.floor}% -> ${r.percent}%`); }
    const renamedFrom = new Map(); /* added file -> the removed file of identical content */
    for (const f of unset) {
      const now = readFileSync(join(root, f), "utf8");
      const old = gone.find((g) => !renamedFrom.has(g) && committed(g) === now);
      if (old) renamedFrom.set(f, old);
    }
    const taken = new Set(renamedFrom.values());
    for (const f of unset) {
      const old = renamedFrom.get(f);
      const floor = old ? Math.max(files[f].percent, doc.floors[old]) : files[f].percent;
      doc.floors[f] = floor;
      if (old && doc.reasons?.[old]) { doc.reasons[f] = doc.reasons[old]; }
      console.log(`  added ${f}: ${floor}%${old ? ` (renamed from ${old}: keeps its floor of ${doc.floors[old]}%; measured ${files[f].percent}%)` : ` (new file, measured ${files[f].percent}%)`}`);
    }
    for (const f of gone) {
      const why = doc.reasons?.[f];
      console.log(`  removed ${f}: ${doc.floors[f]}%${taken.has(f) ? " (renamed; its floor moved to the new name)" : ""}${why ? `; its reason: ${why}` : ""}`);
      delete doc.floors[f]; delete doc.reasons?.[f];
    }
    if (!raisable.length && !unset.length && !gone.length) console.log("  none");
    doc.floors = Object.fromEntries(Object.entries(doc.floors).sort(([a], [b]) => (a < b ? -1 : 1)));
    writeFileSync(floorsFile, JSON.stringify(doc, null, 2) + "\n");
    console.log(`\nwrote ${relative(root, floorsFile)}`);
  }

  let bad = false;
  if (below.length) {
    bad = true;
    console.log("\nBELOW ITS FLOOR (a change lost coverage; cover it, never lower the floor):");
    for (const b of below) console.log(`  ${b.file}: ${b.percent}% < ${b.floor}%`);
  }
  if (unset.length && !raise) {
    bad = true;
    console.log("\nNO FLOOR (new file: node tools/ci/coverage.mjs --raise DIR DIR DIR, and commit the result):");
    for (const f of unset) console.log(`  ${f}: ${files[f].percent}%`);
  }
  if (gone.length && !raise) {
    bad = true;
    console.log("\nFLOOR FOR A FILE THAT IS GONE (node tools/ci/coverage.mjs --raise DIR DIR DIR removes it):");
    for (const f of gone) console.log(`  ${f}`);
  }
  console.log(bad ? "\ncoverage: failed" : "\ncoverage: ok");
  return bad ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
