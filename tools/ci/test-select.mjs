// Which browser tests a change runs (#95, ADR-0005 section 2): reads tools/ci/test-map.json and the changed paths,
// and prints the selection. Test impact analysis from a path-to-test map, failing safe: a path the map does not
// know selects everything. Node built-ins only.
//
//   node tools/ci/test-select.mjs [--base REF] [--json]
//
// The rule, in order:
//   1. LIVE_ALL=true, promotion (a merge request from dev into main), a push whose CI_COMMIT_BEFORE_SHA is all
//      zeros or empty, or no CI and no --base: everything.
//   2. The changed paths, deletions and both sides of a rename: --base REF diffs from the merge base of REF and
//      HEAD; a merge request diffs CI_MERGE_REQUEST_DIFF_BASE_SHA..HEAD; a push CI_COMMIT_BEFORE_SHA..HEAD.
//   3. A changed path in group `all`, or matching no group and no test's own file: everything, reason printed.
//   4. Otherwise the tests of every group a changed path matches, plus every test whose own file changed.
//      `none` matches (so the path is mapped) and adds nothing.
// --json prints {"all": <bool>, "tests": [<names>]} and nothing else; without it, the reasoning for a job's log.
// A git failure (a range not in the clone) selects everything, with the reason.
import { readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// path.matchesGlob is experimental on some Node 22 releases: keep its warning out of the output
const emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  const type = typeof rest[0] === "string" ? rest[0] : rest[0]?.type;
  if (type === "ExperimentalWarning" || warning?.name === "ExperimentalWarning") return;
  return emitWarning.call(process, warning, ...rest);
};

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const MAP_PATH = "tools/ci/test-map.json";
const ZEROS = /^0+$/;

export const loadMap = (root = ROOT) => JSON.parse(readFileSync(path.join(root, MAP_PATH), "utf8"));

/* the groups a path matches, in the map's order */
export const groupsOf = (map, p) =>
  Object.entries(map.groups || {}).filter(([, pats]) => (pats || []).some((g) => path.matchesGlob(p, g))).map(([n]) => n);

/* the tests whose own file is this path */
export const ownTestsOf = (map, p) => Object.entries(map.tests || {}).filter(([, t]) => t.file === p).map(([n]) => n);

/* the selection for a list of changed paths: { all, tests, reason, lines, matched } */
export function selectFor(map, changed) {
  const names = Object.keys(map.tests || {});
  const lines = [], matched = new Set(), picked = new Set();
  let reason = null;
  for (const p of changed) {
    const groups = groupsOf(map, p), own = ownTestsOf(map, p);
    for (const g of groups) matched.add(g);
    for (const t of own) picked.add(t);
    const what = [...groups, ...own.map((t) => `test ${t}'s own file`)];
    lines.push(`  ${p}: ${what.length ? what.join(", ") : "matches no group"}`);
    if (!reason && groups.includes("all")) reason = `${p} is in group all`;
    if (!reason && !what.length) reason = `${p} matches no group in ${MAP_PATH} (unmapped: everything runs)`;
  }
  if (reason) return { all: true, tests: names, reason, lines, matched };
  for (const [n, t] of Object.entries(map.tests || {})) if ((t.groups || []).some((g) => matched.has(g))) picked.add(n);
  return { all: false, tests: names.filter((n) => picked.has(n)), reason: null, lines, matched };
}

function git(root, ...args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${(r.stderr || r.error?.message || "").trim()}`);
  return r.stdout;
}
const changedSince = (root, from) =>
  [...new Set(git(root, "diff", "--name-only", "--no-renames", "-z", from, "HEAD").split("\0").filter(Boolean))];

/* where the change comes from: { everything: reason } or { from, label } */
export function source(env, base) {
  if (env.LIVE_ALL === "true") return { everything: "LIVE_ALL=true" };
  if (base) return { mergeBase: base, label: `--base ${base}` };
  const mr = env.CI_PIPELINE_SOURCE === "merge_request_event" || !!env.CI_MERGE_REQUEST_IID;
  if (mr) {
    const src = env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME, dst = env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME;
    if (src === "dev" && dst === "main") return { everything: "promotion (a merge request from dev into main)" };
    if (!env.CI_MERGE_REQUEST_DIFF_BASE_SHA) return { everything: "a merge request without CI_MERGE_REQUEST_DIFF_BASE_SHA" };
    return { from: env.CI_MERGE_REQUEST_DIFF_BASE_SHA, label: `merge request !${env.CI_MERGE_REQUEST_IID || "?"} (${src} -> ${dst}), since ${env.CI_MERGE_REQUEST_DIFF_BASE_SHA.slice(0, 12)}` };
  }
  if (env.CI === "true" || env.GITLAB_CI === "true") {
    const before = env.CI_COMMIT_BEFORE_SHA || "";
    if (!before || ZEROS.test(before)) return { everything: "a push with no before-SHA (a branch's first push)" };
    return { from: before, label: `push to ${env.CI_COMMIT_BRANCH || env.CI_COMMIT_REF_NAME || "?"}, since ${before.slice(0, 12)}` };
  }
  return { everything: "no CI and no --base (give --base REF to select for a change)" };
}

function main(argv, env) {
  let json = false, base = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") json = true;
    else if (argv[i] === "--base" && i + 1 < argv.length) base = argv[++i];
    else if (argv[i].startsWith("--base=")) base = argv[i].slice(7);
    else { console.error(`test-select: unknown argument ${argv[i]} (usage: node tools/ci/test-select.mjs [--base REF] [--json])`); return 2; }
  }
  const map = loadMap();
  const names = Object.keys(map.tests || {});
  const src = source(env, base);
  let sel, label;
  if (src.everything) {
    sel = { all: true, tests: names, reason: src.everything, lines: [], matched: new Set() };
    label = "no diff taken";
  } else {
    try {
      const from = src.mergeBase ? git(ROOT, "merge-base", src.mergeBase, "HEAD").trim() : src.from;
      const changed = changedSince(ROOT, from);
      sel = selectFor(map, changed);
      label = `${src.label}: ${changed.length} changed path${changed.length === 1 ? "" : "s"}`;
    } catch (e) {
      sel = { all: true, tests: names, reason: `the changed paths could not be read (${e.message})`, lines: [], matched: new Set() };
      label = src.label;
    }
  }
  if (json) {
    process.stdout.write(JSON.stringify({ all: sel.all, tests: sel.tests }) + "\n");
    return 0;
  }
  const out = [`test-select: ${label}`, ...sel.lines];
  const groups = [...sel.matched];
  out.push(`groups matched: ${groups.length ? groups.join(", ") : "(no group)"}`);
  if (sel.all) out.push(`everything: ${sel.reason}`);
  out.push(`selected ${sel.tests.length} of ${names.length}${sel.tests.length ? `: ${sel.tests.join(", ")}` : ""}`);
  process.stdout.write(out.join("\n") + "\n");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2), process.env);
}
