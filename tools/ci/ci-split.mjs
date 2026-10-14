// The lint's "docs import is split" section (#18, #52): reads .gitlab-ci.yml
// with a YAML reader (js-yaml, pinned in tools/package.json) and judges the
// jobs as GitLab sees them, not line by line. Fails closed: if js-yaml is not
// installed (npm ci --prefix tools) or the file does not parse, it fails.
//   node tools/ci/ci-split.mjs        exit 0 ok, 1 refused
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const at = (p) => `${root}${p}`;
const bad = (m) => { console.log(`   ${m}`); process.exitCode = 1; };
const stop = (m) => { console.log(`   ${m}`); process.exit(1); };

let yaml;
try {
  yaml = createRequire(new URL("../package.json", import.meta.url))("js-yaml");
} catch {
  stop(".gitlab-ci.yml: cannot load js-yaml to read it; run npm ci --prefix tools --ignore-scripts first");
}

// GitLab's `!reference [job, key]` is a tagged sequence; read it as
// { "!reference": [...] } so its names are still walked. Merge keys (<<) resolve.
// A repeated key keeps its last value, as GitLab's reader does, and the values it
// replaced are kept aside (SHADOW) so the name checks below still see them.
const reference = yaml.defineSequenceTag("!reference", {
  create: () => [],
  addItem: (c, item) => { c.push(item); },
  finalize: (c) => ({ "!reference": c }),
  identify: () => false,
});
const SHADOW = Symbol("replaced values");
const map = yaml.defineMappingTag("tag:yaml.org,2002:map", {
  create: () => ({}),
  addPair: (c, key, value) => {
    if ((key === null || typeof key !== "object") && Object.hasOwn(c, String(key))) (c[SHADOW] ??= []).push([String(key), c[String(key)]]);
    return yaml.mapTag.addPair(c, key, value);
  },
  has: yaml.mapTag.has,
  keys: yaml.mapTag.keys,
  get: yaml.mapTag.get,
  identify: yaml.mapTag.identify,
});
const schema = yaml.CORE_SCHEMA.withTags(map, yaml.mergeTag, reference);
let doc;
try {
  doc = yaml.load(fs.readFileSync(at(".gitlab-ci.yml"), "utf8"), { schema, json: true });
} catch (e) {
  stop(`.gitlab-ci.yml: does not parse as YAML: ${String(e.message).split("\n")[0]}`);
}
if (doc === null || typeof doc !== "object" || Array.isArray(doc)) stop(".gitlab-ci.yml: is not a mapping of jobs");

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const lines = (v) => (Array.isArray(v) ? v.flat(Infinity) : v === undefined ? [] : [v]).map((l) => (typeof l === "string" ? l : JSON.stringify(l)));
const envName = (v) => (typeof v === "string" ? v : isObj(v) ? v.name : undefined);
// every scalar string in a value, mapping keys and replaced values included
const strings = (v, out = []) => {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) { out.push(k); strings(x, out); }
    for (const [, x] of v[SHADOW] || []) strings(x, out);
  }
  return out;
};
// every value under an `environment` key, at any depth
const environments = (v, out = []) => {
  if (Array.isArray(v)) for (const x of v) environments(x, out);
  else if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) { if (k === "environment") out.push(x); environments(x, out); }
    for (const [k, x] of v[SHADOW] || []) { if (k === "environment") out.push(x); environments(x, out); }
  }
  return out;
};

const RULE = `$CI_PIPELINE_SOURCE == "schedule" && $IMPORT_DOCS == "true" && $CI_COMMIT_BRANCH == "main"`;
const job = (n) => (isObj(doc[n]) ? doc[n] : null);
const imp = job("import_docs"), pub = job("publish_docs");
if (imp === null) bad(".gitlab-ci.yml: there is no import_docs job");
if (pub === null) bad(".gitlab-ci.yml: there is no publish_docs job");
for (const [name, j] of [["import_docs", imp], ["publish_docs", pub]]) {
  if (j === null) continue;
  const rules = Array.isArray(j.rules) ? j.rules : j.rules === undefined ? [] : [j.rules];
  const one = rules.length === 1 && isObj(rules[0]) && Object.keys(rules[0]).length === 1 && rules[0].if === RULE;
  if (!one) bad(`.gitlab-ci.yml: ${name} rules must be the one schedule-only rule on main (if: ${RULE}), found: ${rules.map((r) => JSON.stringify(r)).join(" | ") || "none"}`);
}
if (imp !== null) {
  if ("environment" in imp) bad(".gitlab-ci.yml: import_docs has an environment; only publish_docs joins docs-import, or the token reaches the job that runs npm");
  if (strings(imp).some((t) => t.includes("ORBIT_SITE_IMPORT_TOKEN"))) bad(".gitlab-ci.yml: import_docs names ORBIT_SITE_IMPORT_TOKEN");
  if (!lines(imp.script).some((l) => /nightly-import\.sh/.test(l))) bad(".gitlab-ci.yml: import_docs does not run tools/ci/nightly-import.sh");
  const art = isObj(imp.artifacts) ? imp.artifacts : {};
  const paths = Array.isArray(art.paths) ? art.paths : art.paths === undefined ? [] : [art.paths];
  if (paths.length !== 1 || paths[0] !== "assets/docs/") bad(`.gitlab-ci.yml: import_docs artifacts must be assets/docs/ alone, found: ${paths.join(", ") || "none"}`);
  if (!/^(\d+ (minutes?|hours?)|1 days?)$/.test(String(art.expire_in ?? ""))) bad(".gitlab-ci.yml: import_docs artifacts need a short expire_in (at most 1 day)");
}

// each environment holds tokens scoped to it: no top-level entry but its own job
// (another job, a hidden template, default) may name it. Judged on the parsed
// value, merge keys resolved: `environment: e`, `environment: { name: e }` or any
// other string that is exactly e is refused; e inside a longer string
// (renovate.json, a renovate/ branch) is not a name and passes.
const envs = { "docs-import": "publish_docs", "renovate": "renovate" };
const named = new Set(); // `${k}\n${e}` already refused for naming e
const varied = new Set(); // k already refused for a variable in an environment name
for (const [k, v] of Object.entries(doc)) {
  for (const [e, j] of Object.entries(envs)) {
    if (k !== j && strings(v).some((s) => s.trim() === e)) { named.add(`${k}\n${e}`); bad(`.gitlab-ci.yml: ${k} names the ${e} environment; only ${j} may, since the tokens there are scoped to it`); }
  }
  // a variable in an environment name could resolve to a scoped one
  for (const env of environments(v)) {
    const n = envName(env);
    if (typeof n === "string" && n.includes("$")) { varied.add(k); bad(`.gitlab-ci.yml: ${k} has environment ${n}, which holds a variable; it could resolve to ${Object.keys(envs).join(" or ")}, so environment names are written out`); }
  }
}

// A job can also inherit a scoped environment without naming it (#52): by
// `extends` (a name or a list, followed recursively, later parents and then the
// job's own keys winning, mappings deep-merged as GitLab does) or by
// `!reference [job, ..., environment]`. Each top-level key's environment is
// resolved that way and judged by its name. Fails closed: an extends target
// that is missing, an extends cycle, or a !reference that does not resolve is
// refused, since the environment it would give cannot be judged.
const GLOBAL = new Set(["default", "workflow", "variables", "stages", "include", "spec"]);
const merge = (a, b) => {
  if (!isObj(a) || !isObj(b)) return b;
  const out = { ...a };
  for (const [k, x] of Object.entries(b)) out[k] = Object.hasOwn(a, k) ? merge(a[k], x) : x;
  return out;
};
const expanded = new Map(), expanding = [];
// v with every !reference replaced by the value it points at (GitLab allows 10 levels)
const resolve = (k, v, depth = 0) => {
  if (Array.isArray(v)) return v.map((x) => resolve(k, x, depth));
  if (!isObj(v)) return v;
  if (Object.hasOwn(v, "!reference")) {
    const path = v["!reference"];
    const shown = `!reference [${(Array.isArray(path) ? path : [path]).map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(", ")}]`;
    const no = (why) => { bad(`.gitlab-ci.yml: ${k} has ${shown}, which ${why}; the environment it gives cannot be judged`); return undefined; };
    if (depth >= 10) return no("nests more than 10 references deep");
    if (!Array.isArray(path) || path.length === 0 || !path.every((p) => typeof p === "string")) return no("is not a list of names");
    if (!Object.hasOwn(doc, path[0])) return no(`points at ${path[0]}, which is not in the file`);
    let at = expand(path[0]);
    for (const p of path.slice(1)) {
      if (!isObj(at) || !Object.hasOwn(at, p)) return no("does not resolve");
      at = at[p];
    }
    return resolve(k, at, depth + 1);
  }
  const out = {};
  for (const [x, y] of Object.entries(v)) out[x] = resolve(k, y, depth);
  return out;
};
// a top-level key as GitLab runs it: its extends merged in, its references resolved
function expand(k) {
  if (expanded.has(k)) return expanded.get(k);
  if (expanding.includes(k)) {
    bad(`.gitlab-ci.yml: ${k} extends or references itself (${[...expanding.slice(expanding.indexOf(k)), k].join(" -> ")}); the environment it inherits cannot be judged`);
    return {};
  }
  expanding.push(k);
  const own = resolve(k, doc[k]);
  let out = own;
  if (isObj(own) && !GLOBAL.has(k) && Object.hasOwn(own, "extends")) {
    const ext = own.extends;
    const parents = typeof ext === "string" ? [ext] : Array.isArray(ext) ? ext.flat(Infinity) : [ext];
    out = {};
    for (const p of parents) {
      if (typeof p !== "string") bad(`.gitlab-ci.yml: ${k} extends ${JSON.stringify(p)}, which is not a name; the environment it inherits cannot be judged`);
      else if (!isObj(doc[p])) bad(`.gitlab-ci.yml: ${k} extends ${p}, which is not a job or template in the file; the environment it inherits cannot be judged`);
      else out = merge(out, expand(p));
    }
    const rest = { ...own };
    delete rest.extends;
    out = merge(out, rest);
  }
  expanding.pop();
  expanded.set(k, out);
  return out;
}
// where k's environment named e came from: a !reference in its own environment,
// else the last parent in its extends that has it
const source = (k, e) => {
  const raw = isObj(doc[k]) ? doc[k] : {};
  const refs = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isObj(v)) for (const [x, y] of Object.entries(v)) { if (x === "!reference" && Array.isArray(y)) refs.push(String(y[0])); else walk(y); }
  };
  walk(raw.environment);
  if (refs.length) return `${[...new Set(refs)].join(", ")} by !reference`;
  const parents = [raw.extends].flat(Infinity).filter((p) => typeof p === "string" && isObj(doc[p]));
  const p = parents.reverse().find((q) => { const n = envName(expand(q).environment); return typeof n === "string" && n.trim() === e; });
  return p ?? "its extends";
};
for (const k of Object.keys(doc)) {
  const x = expand(k);
  if (GLOBAL.has(k) || !isObj(x)) continue;
  const n = envName(x.environment);
  if (typeof n !== "string") continue;
  for (const [e, j] of Object.entries(envs)) {
    if (k !== j && n.trim() === e && !named.has(`${k}\n${e}`)) bad(`.gitlab-ci.yml: ${k} inherits the ${e} environment from ${source(k, e)}; only ${j} may, since the tokens there are scoped to it`);
  }
  if (n.includes("$") && !varied.has(k)) bad(`.gitlab-ci.yml: ${k} inherits environment ${n}, which holds a variable; it could resolve to ${Object.keys(envs).join(" or ")}, so environment names are written out`);
}
// another file could add a job this check never sees
if ("include" in doc) bad(".gitlab-ci.yml: has a top-level include; a job in another file would escape this check");

const ren = job("renovate");
if (ren !== null && envName(ren.environment) !== "renovate") bad(".gitlab-ci.yml: renovate has no environment named renovate, where the Renovate tokens are scoped");
if (pub !== null) {
  if (envName(pub.environment) !== "docs-import") bad(".gitlab-ci.yml: publish_docs has no environment named docs-import, where the token is scoped");
  const needs = Array.isArray(pub.needs) ? pub.needs : [];
  if (!needs.some((n) => isObj(n) && n.job === "import_docs" && n.artifacts === false)) bad(".gitlab-ci.yml: publish_docs needs must take import_docs without its artifacts (artifacts: false); a dotenv report in them would set this job's variables");
  if (!(isObj(pub.variables) && pub.variables.GIT_STRATEGY === "clone")) bad(".gitlab-ci.yml: publish_docs needs GIT_STRATEGY: clone, a fresh checkout and not a reused build folder");
  const script = lines(pub.script);
  if (!script.some((l) => /nightly-publish\.sh/.test(l))) bad(".gitlab-ci.yml: publish_docs does not run tools/ci/nightly-publish.sh");
  if (script.some((l) => /\b(npm|npx|yarn|pnpm)\b/.test(l))) bad(".gitlab-ci.yml: publish_docs runs npm or another package manager; it holds the token and runs no third-party code");
}

const read = (p) => (fs.existsSync(at(p)) ? fs.readFileSync(at(p), "utf8") : null);
const imps = read("tools/ci/nightly-import.sh"), pubs = read("tools/ci/nightly-publish.sh");
if (imps === null) bad("tools/ci/nightly-import.sh: is missing");
else {
  const code = imps.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  if (/ORBIT_SITE_IMPORT_TOKEN|PRIVATE-TOKEN/.test(imps)) bad("tools/ci/nightly-import.sh: names the token; it runs other people's code and must not");
  if (/\bcurl\b|\bgit\b[^\n]*\bpush\b/.test(code)) bad("tools/ci/nightly-import.sh: calls curl or git push; the import makes no API call and no push");
}
if (pubs === null) bad("tools/ci/nightly-publish.sh: is missing");
else {
  const code = pubs.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  if (/\b(npm|npx|yarn|pnpm)\b/.test(code)) bad("tools/ci/nightly-publish.sh: runs npm or another package manager; it holds the token and runs no third-party code");
}
