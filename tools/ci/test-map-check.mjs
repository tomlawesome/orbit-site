// The lint's test-map section (#95, ADR-0005 section 2): keeps tools/ci/test-map.json honest, so the selection
// (tools/ci/test-select.mjs) fails safe end to end.
//   1. every tracked path matches a group, or is a map test's own file;
//   2. every pattern matches a tracked file (a renamed file leaves no hole behind it);
//   3. every tools/ci/*-test.mjs, *-test.sh, journey.mjs and freeze.mjs is named in exactly one place: the map's
//      tests (browser), tools/ci/node-tests.sh (Node), a lint job's script in .gitlab-ci.yml (read with js-yaml
//      from tools/node_modules, as ci-split.mjs reads it) or the map's hand list (a test run by hand); every hand
//      entry is on disk and is such a test file;
//   4. every map test's file is on disk, its groups exist and are neither all nor none, it runs in a browser,
//      gates only where it runs, and has seconds for each browser.
//   node tools/ci/test-map-check.mjs        exit 0 ok, 1 refused
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { ROOT, MAP_PATH, loadMap, groupsOf } from "./test-select.mjs";

const BROWSERS = ["firefox", "chromium"];
const at = (p) => path.join(ROOT, p);
const bad = (m) => { console.log(`   ${m}`); process.exitCode = 1; };
const stop = (m) => { console.log(`   ${m}`); process.exit(1); };

let map;
try { map = loadMap(); } catch (e) { stop(`${MAP_PATH} does not parse: ${e.message}`); }
const groups = map.groups && typeof map.groups === "object" ? map.groups : stop(`${MAP_PATH}: no groups`);
const tests = map.tests && typeof map.tests === "object" ? map.tests : stop(`${MAP_PATH}: no tests`);
for (const [g, pats] of Object.entries(groups)) {
  if (!Array.isArray(pats) || pats.some((p) => typeof p !== "string")) stop(`${MAP_PATH}: group ${g} is not a list of patterns`);
}

const ls = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (ls.status !== 0) stop(`git ls-files failed: ${(ls.stderr || "").trim()}`);
const tracked = ls.stdout.split("\0").filter(Boolean);
const testFiles = new Set(Object.values(tests).map((t) => t && t.file));

// 1. every tracked path is mapped
for (const p of tracked) {
  if (!testFiles.has(p) && groupsOf(map, p).length === 0) bad(`unmapped: ${p}; add it to a group in ${MAP_PATH}, none if no test can see it`);
}

// 2. every pattern is live
for (const [g, pats] of Object.entries(groups)) {
  for (const pat of pats) {
    if (!tracked.some((p) => path.matchesGlob(p, pat))) bad(`${MAP_PATH}: group ${g}: pattern ${pat} matches no tracked file`);
  }
}

// 3. every test file is named in exactly one place
const isTest = (p) => ["tools/ci/*-test.mjs", "tools/ci/*-test.sh", "tools/ci/journey.mjs", "tools/ci/freeze.mjs"].some((g) => path.matchesGlob(p, g));
const places = new Map();
const named = (f, where) => { if (!places.has(f)) places.set(f, []); places.get(f).push(where); };
const hand = map.hand === undefined ? [] : map.hand;
if (!Array.isArray(hand) || hand.some((h) => typeof h !== "string")) stop(`${MAP_PATH}: hand is not a list of test files`);
for (const h of hand) {
  named(h, "hand");
  if (!existsSync(at(h))) bad(`${MAP_PATH}: hand: ${h} is not on disk`);
  if (!isTest(h)) bad(`${MAP_PATH}: hand: ${h} is not a test file (tools/ci/*-test.mjs, *-test.sh, journey.mjs or freeze.mjs)`);
}
for (const [n, t] of Object.entries(tests)) if (t && typeof t.file === "string") named(t.file, `the map's test ${n}`);

const nodeTests = "tools/ci/node-tests.sh";
const list = /^\s*for t in ([^;]*); do\s*$/m.exec(readFileSync(at(nodeTests), "utf8").replace(/\\\n/g, " "));
if (!list) bad(`${nodeTests}: cannot find its list (for t in ...; do)`);
else for (const t of list[1].split(/\s+/).filter(Boolean)) named(`tools/ci/${t}-test.mjs`, nodeTests);

let yaml;
try {
  yaml = createRequire(new URL("../package.json", import.meta.url))("js-yaml");
} catch {
  stop(".gitlab-ci.yml: cannot load js-yaml to read it; run npm ci --prefix tools --ignore-scripts first");
}
// js-yaml 5, as ci-split.mjs reads it: GitLab's `!reference [job, key]` kept as { "!reference": [...] }, << merged
const reference = yaml.defineSequenceTag("!reference", {
  create: () => [],
  addItem: (c, item) => { c.push(item); },
  finalize: (c) => ({ "!reference": c }),
  identify: () => false,
});
let ci;
try { ci = yaml.load(readFileSync(at(".gitlab-ci.yml"), "utf8"), { schema: yaml.CORE_SCHEMA.withTags(yaml.mergeTag, reference), json: true }); }
catch (e) { stop(`.gitlab-ci.yml does not parse: ${e.message}`); }
ci = ci && typeof ci === "object" ? ci : {};
// a job's own key, else the first it inherits by extends:, as GitLab resolves it
const inherited = (job, key, seen = new Set()) => {
  const def = ci[job];
  if (!def || typeof def !== "object" || seen.has(job)) return undefined;
  seen.add(job);
  if (key in def) return def[key];
  for (const parent of [].concat(def.extends || []).reverse()) {
    const v = inherited(parent, key, seen);
    if (v !== undefined) return v;
  }
  return undefined;
};
const lines = (s) => (typeof s === "string" ? [s] : Array.isArray(s) ? s.flatMap(lines) : []);
for (const job of Object.keys(ci)) {
  if (job.startsWith(".") || !ci[job] || typeof ci[job] !== "object" || inherited(job, "stage") !== "lint") continue;
  for (const line of lines(inherited(job, "script"))) for (const [f] of line.matchAll(/tools\/ci\/[A-Za-z0-9._-]+/g)) named(f, `job ${job}'s script`);
}

for (const f of tracked.filter(isTest)) {
  const w = places.get(f) || [];
  if (w.length === 0) bad(`${f} is named nowhere: name it once, in ${nodeTests} (a Node test), a lint job's script in .gitlab-ci.yml, the map's tests (a browser test) or the map's hand list (run by hand)`);
  else if (w.length > 1) bad(`${f} is named in ${w.length} places (${w.join("; ")}): name it in exactly one`);
}

// 4. every map test is whole
for (const [n, t] of Object.entries(tests)) {
  if (!t || typeof t !== "object") { bad(`test ${n}: not an entry`); continue; }
  if (typeof t.file !== "string" || !existsSync(at(t.file))) bad(`test ${n}: its file ${t.file} is not on disk`);
  const gs = Array.isArray(t.groups) ? t.groups : [];
  if (gs.length === 0) bad(`test ${n}: is in no group`);
  for (const g of gs) {
    if (g === "all" || g === "none") bad(`test ${n}: is in group ${g}; all and none name no test`);
    else if (!Object.hasOwn(groups, g)) bad(`test ${n}: is in group ${g}, which does not exist`);
  }
  const bs = Array.isArray(t.browsers) ? t.browsers : [];
  if (bs.length === 0) bad(`test ${n}: runs in no browser`);
  for (const b of bs) if (!BROWSERS.includes(b)) bad(`test ${n}: browser ${b} is not one of ${BROWSERS.join(", ")}`);
  for (const b of Array.isArray(t.gates) ? t.gates : []) if (!bs.includes(b)) bad(`test ${n}: gates in ${b}, which it does not run in`);
  if (!Array.isArray(t.gates)) bad(`test ${n}: has no gates list`);
  for (const b of bs) {
    const s = t.seconds && t.seconds[b];
    if (typeof s !== "number" || !Number.isFinite(s) || s < 0) bad(`test ${n}: has no seconds for ${b}`);
  }
}
