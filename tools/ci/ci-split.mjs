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
// A merge key (<<) after an explicit key in the same mapping is read two ways:
// GitLab's reader (Ruby Psych) applies each << in order, so it overwrites the
// explicit key, while js-yaml keeps the explicit key. Such a mapping is refused
// (LATE), since the job GitLab runs is not the one judged here; a << before
// every explicit key reads the same in both. js-yaml asks `has` once per key a
// << brings in (and nowhere else when reading with json: true), then adds the
// keys that are not there yet with addPair: so `has` marks the next addPair of
// that key as merged, and any other addPair is an explicit key, in file order.
const EXPLICIT = new WeakSet(), MERGING = new WeakMap(), LATE = new WeakSet();
const map = yaml.defineMappingTag("tag:yaml.org,2002:map", {
  create: () => ({}),
  addPair: (c, key, value) => {
    if (MERGING.get(c) === key) MERGING.delete(c);
    else EXPLICIT.add(c);
    if ((key === null || typeof key !== "object") && Object.hasOwn(c, String(key))) (c[SHADOW] ??= []).push([String(key), c[String(key)]]);
    return yaml.mapTag.addPair(c, key, value);
  },
  has: (c, key) => {
    if (EXPLICIT.has(c)) LATE.add(c);
    const there = yaml.mapTag.has(c, key);
    if (!there) MERGING.set(c, key);
    return there;
  },
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
// whether a mapping with a late << is in v, replaced values included
const late = (v, seen = new Set()) => {
  if (v === null || typeof v !== "object" || seen.has(v)) return false;
  seen.add(v);
  if (LATE.has(v)) return true;
  if (Array.isArray(v)) return v.some((x) => late(x, seen));
  return Object.values(v).some((x) => late(x, seen)) || (v[SHADOW] || []).some(([, x]) => late(x, seen));
};
const lateMsg = "a merge key (<<) after an explicit key in the same mapping; GitLab's reader lets the later << overwrite the explicit key and this check's reader keeps it, so the job GitLab runs is not the one judged here: put the << first";
if (LATE.has(doc)) bad(`.gitlab-ci.yml: the top level has ${lateMsg}`);
for (const [k, v] of Object.entries(doc)) if (late(v)) bad(`.gitlab-ci.yml: ${k} has ${lateMsg}`);
for (const [k, v] of doc[SHADOW] || []) if (late(v)) bad(`.gitlab-ci.yml: ${k} (an earlier, replaced ${k}) has ${lateMsg}`);
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

// expire_in as GitLab reads it (a ChronicDuration string: "1 day", "24 hours",
// "30 min", "1h 30m", "2 hrs and 20 mins"; a bare number is seconds), in
// seconds; NaN for anything else ("never" included), which is refused.
const UNIT = { s: 1, m: 60, h: 3600, d: 86400, w: 604800, mo: 2592000, y: 31557600 };
const UNITS = [
  [/^(s|secs?|seconds?)$/, "s"], [/^(m|mins?|minutes?)$/, "m"], [/^(h|hrs?|hours?)$/, "h"],
  [/^(d|days?)$/, "d"], [/^(w|wks?|weeks?)$/, "w"], [/^(mos?|months?)$/, "mo"], [/^(y|yrs?|years?)$/, "y"],
];
const seconds = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v !== "string") return NaN;
  const t = v.trim().toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  const parts = t.replace(/,|\band\b/g, " ").match(/\d+(?:\.\d+)?\s*[a-z]+|\S+/g) || [];
  if (parts.length === 0) return NaN;
  let total = 0;
  for (const p of parts) {
    const m = /^(\d+(?:\.\d+)?)\s*([a-z]+)$/.exec(p);
    const u = m && UNITS.find(([re]) => re.test(m[2]));
    if (!u) return NaN;
    total += Number(m[1]) * UNIT[u[1]];
  }
  return total;
};

// publish_docs's image, as .gitlab-ci.yml has it. The image runs beside the
// token, so changing it is a deliberate edit to this check, not to the CI file alone.
const PUBLISH_IMAGE = "$NODE_IMAGE";
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
  const life = seconds(art.expire_in);
  if (!(life > 0 && life <= 86400)) bad(`.gitlab-ci.yml: import_docs artifacts need a short expire_in (at most 1 day), found: ${art.expire_in ?? "none"}`);
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
// so could a child pipeline (trigger: include, a file, a list or an artifact),
// whether the job writes it, extends it or takes it by !reference
for (const k of Object.keys(doc)) {
  const own = isObj(doc[k]) ? doc[k].trigger : undefined, x = expand(k);
  if ([own, isObj(x) ? x.trigger : undefined].some((t) => isObj(t) && Object.hasOwn(t, "include"))) bad(`.gitlab-ci.yml: ${k} starts a child pipeline (trigger: include); a job in that pipeline would escape this check`);
}

const ren = job("renovate");
if (ren !== null && envName(ren.environment) !== "renovate") bad(".gitlab-ci.yml: renovate has no environment named renovate, where the Renovate tokens are scoped");
if (pub !== null) {
  if (envName(pub.environment) !== "docs-import") bad(".gitlab-ci.yml: publish_docs has no environment named docs-import, where the token is scoped");
  const needs = Array.isArray(pub.needs) ? pub.needs : [];
  if (!needs.some((n) => isObj(n) && n.job === "import_docs" && n.artifacts === false)) bad(".gitlab-ci.yml: publish_docs needs must take import_docs without its artifacts (artifacts: false); a dotenv report in them would set this job's variables");
  if (!(isObj(pub.variables) && pub.variables.GIT_STRATEGY === "clone")) bad(".gitlab-ci.yml: publish_docs needs GIT_STRATEGY: clone, a fresh checkout and not a reused build folder");
  if (!lines(pub.script).some((l) => /nightly-publish\.sh/.test(l))) bad(".gitlab-ci.yml: publish_docs does not run tools/ci/nightly-publish.sh");
  // what runs beside the token is judged on the job as GitLab runs it: extends
  // and !reference resolved, and default:'s hooks where the job sets none
  const ex = isObj(expand("publish_docs")) ? expand("publish_docs") : {};
  const def = isObj(doc.default) && isObj(expand("default")) ? expand("default") : {};
  const pm = (l) => /\b(npm|npx|yarn|pnpm)\b/.test(l);
  for (const h of ["script", "before_script", "after_script"]) {
    const from = Object.hasOwn(ex, h) ? "" : Object.hasOwn(def, h) ? " from default" : null;
    if (from === null || !lines(from ? def[h] : ex[h]).some(pm)) continue;
    if (h === "script" && !from) bad(".gitlab-ci.yml: publish_docs runs npm or another package manager; it holds the token and runs no third-party code");
    else bad(`.gitlab-ci.yml: publish_docs runs npm or another package manager ${from ? `in the ${h} it takes from default` : `in its ${h}`}; it holds the token and runs no third-party code`);
  }
  // the image runs beside the token, so publish_docs names its own, and it is
  // PUBLISH_IMAGE; NODE_IMAGE itself is pinned to a digest by lint.sh
  if (!Object.hasOwn(pub, "image") || ex.image !== PUBLISH_IMAGE) bad(`.gitlab-ci.yml: publish_docs must set its own image: ${PUBLISH_IMAGE}, found: ${Object.hasOwn(pub, "image") ? JSON.stringify(ex.image) : "none of its own"}; the image runs beside the token`);
  if (isObj(ex.variables) && Object.hasOwn(ex.variables, "NODE_IMAGE")) bad(".gitlab-ci.yml: publish_docs sets NODE_IMAGE in its variables, which would change its image; the image runs beside the token");
  if (Object.hasOwn(ex, "services")) bad(".gitlab-ci.yml: publish_docs has services; a service container runs beside the token");
}
if (isObj(doc.default) && (Object.hasOwn(doc.default, "services") || (isObj(expand("default")) && Object.hasOwn(expand("default"), "services")))) bad(".gitlab-ci.yml: default has services; they would run beside the token in publish_docs");

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
