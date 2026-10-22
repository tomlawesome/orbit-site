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
// Two << keys in one mapping (block or flow) are read two ways as well: Psych takes
// the second, js-yaml the first, so that mapping is refused too (TWICE), even with
// no explicit key. The list form <<: [*a, *b] is one key and both keep the first.
// Mappings are tracked while open (OPEN: pushed by create, popped by finalize), and
// each << key scalar the schema resolves counts for the innermost open mapping.
const EXPLICIT = new WeakSet(), MERGING = new WeakMap(), LATE = new WeakSet();
const OPEN = [], MERGE_KEYS = new WeakMap(), TWICE = new WeakSet();
const mergeKey = yaml.defineScalarTag(yaml.mergeTag.tagName, {
  implicit: true,
  implicitFirstChars: ["<"],
  resolve: (source, isExplicit, tagName) => {
    const r = yaml.mergeTag.resolve(source, isExplicit, tagName);
    const c = OPEN[OPEN.length - 1];
    if (r !== yaml.NOT_RESOLVED && c !== undefined) {
      const n = (MERGE_KEYS.get(c) ?? 0) + 1;
      MERGE_KEYS.set(c, n);
      if (n > 1) TWICE.add(c);
    }
    return r;
  },
  identify: () => false,
});
const map = yaml.defineMappingTag("tag:yaml.org,2002:map", {
  create: () => { const c = {}; OPEN.push(c); return c; },
  finalize: (c) => { OPEN.pop(); return c; },
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
const schema = yaml.CORE_SCHEMA.withTags(map, mergeKey, reference);
const src = fs.readFileSync(at(".gitlab-ci.yml"), "utf8");

// The file holds only tab, line feed and printable ASCII (0x20-0x7E), judged on
// the raw text before any YAML is read (#60). GitLab's reader ends a line at a
// carriage return, U+0085, U+2028 or U+2029, so a comment holding one can hide a
// job this check's reader never sees; other control characters, a byte order
// mark and any non-ASCII letter are refused too, since the rule is plain ASCII.
// Lines count line feeds; a byte that is not UTF-8 reads as U+FFFD and is refused.
{
  const found = [];
  let line = 1;
  for (const ch of src) {
    const c = ch.codePointAt(0);
    if (c === 0x0a) line++;
    else if (c !== 0x09 && !(c >= 0x20 && c <= 0x7e) && found.at(-1)?.[0] !== line) found.push([line, c]);
  }
  for (const [l, c] of found) console.log(`   .gitlab-ci.yml: line ${l}: the character U+${c.toString(16).toUpperCase().padStart(4, "0")} is not plain ASCII; the file holds only tab, line feed and printable ASCII, since GitLab's reader can split a line where this check's does not`);
  if (found.length) process.exit(1);
}

// GitLab reads the file with Ruby Psych (YAML.safe_load, Symbol permitted,
// aliases on, then deep_symbolize_keys), this check with js-yaml. Rather than
// imitate Psych, the file must keep to a subset both read the same way (#60),
// judged on js-yaml's event stream, which still shows how each node is written:
// no directive and one document; no explicit tag but !reference on a list; every
// mapping key a plain name or a quoted string, so not a quoted "<<" (Psych merges
// it, js-yaml keeps a key named <<), not a key led by a colon (Psych makes :x a
// Symbol, which GitLab folds onto x), and not a plain yes, on, y, ~, null, true,
// 1 or the like (a boolean, null or number to one reader or both). The variables
// publish_docs's image reads are defined once, in the global variables.

// publish_docs's image, as .gitlab-ci.yml has it. The image runs beside the
// token, so changing it is a deliberate edit to this check, not to the CI file alone.
const PUBLISH_IMAGE = "$NODE_IMAGE";
const IMAGE_VARS = new Set([...PUBLISH_IMAGE.matchAll(/\$\{?(\w+)\}?/g)].map((m) => m[1]));
const NAME = /^\.?[A-Za-z_][A-Za-z0-9_.:/ -]*$/, NOT_NAME = /^(y|n|yes|no|on|off|true|false|null|\.inf|\.nan)$/i;
const E = yaml.EVENT_ID, STYLE = yaml.SCALAR_STYLE;
let events;
try {
  events = yaml.parseEvents(src, {});
} catch (e) {
  stop(`.gitlab-ci.yml: does not parse as YAML: ${String(e.message).split("\n")[0]}`);
}
const lineAt = (i) => src.slice(0, Math.max(i, 0)).split("\n").length;
const startOf = (e) => (e.type === E.SCALAR ? e.valueStart : e.type === E.ALIAS ? e.anchorStart : e.start);
let ev = 0;
const node = () => {
  const e = events[ev++];
  if (e.type === E.SCALAR || e.type === E.ALIAS) return { e };
  const items = [];
  while (events[ev].type !== E.POP) items.push(node());
  ev++;
  return { e, items };
};
const docs = [];
while (ev < events.length) {
  const d = events[ev++];
  docs.push({ d, root: events[ev].type === E.POP ? null : node() });
  ev++;
}
const imageVars = []; // [name, path, line] for every key naming a variable the image reads
// The value nodes of GIT_DEPTH and GIT_STRATEGY written under publish_docs > variables
// (#60 round 5): js-yaml reads 1.0, 1e0, 0o1, 0x1 and +1 all as 1, GitLab's reader
// (Psych) does not, so they are judged on how they are written, not on the value read.
const GIT_RAW = ["GIT_DEPTH", "GIT_STRATEGY"];
const gitRaw = { GIT_DEPTH: [], GIT_STRATEGY: [] };
const at_ = (path, e) => `line ${lineAt(startOf(e))}${path.length ? `, in ${path.join(" > ")}` : ""}`;
const walk = (n, path) => {
  const e = n.e;
  if (e.tagStart >= 0) {
    const t = src.slice(e.tagStart, e.tagEnd);
    if (!(t === "!reference" && e.type === E.SEQUENCE)) bad(`.gitlab-ci.yml: ${at_(path, e)}: the explicit tag ${t}; GitLab's reader can read a tagged node differently from this check's, so no tag but !reference [...] is allowed`);
  }
  if (e.type === E.SEQUENCE) n.items.forEach((x, i) => walk(x, [...path, String(i)]));
  if (e.type !== E.MAPPING) return;
  for (let i = 0; i + 1 < n.items.length; i += 2) {
    const k = n.items[i], v = n.items[i + 1];
    walk(k, path);
    let name = null;
    const ke = k.e;
    if (ke.type !== E.SCALAR || ![STYLE.PLAIN, STYLE.SINGLE_QUOTED, STYLE.DOUBLE_QUOTED].includes(ke.style)) {
      bad(`.gitlab-ci.yml: ${at_(path, ke)}: a key that is an alias, a list, a mapping or a block scalar is not a plain string to both readers; write keys as names`);
    } else {
      const t = yaml.getScalarValue(src, ke);
      if (ke.style !== STYLE.PLAIN && t === "<<") bad(`.gitlab-ci.yml: ${at_(path, ke)}: a quoted merge key ${src.slice(ke.valueStart - 1, ke.valueEnd + 1)}; GitLab's reader (Ruby Psych) merges it as <<, this check's reader keeps a key named <<, so it is an ambiguous merge key: write << unquoted`);
      else if (t.startsWith(":")) bad(`.gitlab-ci.yml: ${at_(path, ke)}: the key ${t} starts with a colon; GitLab's reader makes it a symbol and folds it onto ${t.slice(1) || "an empty key"}, which this check's reader does not, so the job GitLab runs is not the one judged here`);
      else if (ke.style === STYLE.PLAIN && t !== "<<" && (!NAME.test(t) || NOT_NAME.test(t))) bad(`.gitlab-ci.yml: ${at_(path, ke)}: the key ${t || "(empty)"} is not a plain string to both readers (GitLab's reader takes yes, on, ~, null, true, numbers and the like as a boolean, a null or a number); write a key as a name (a letter, _ or . first, then letters, digits, spaces or _ . : / -) or quote it`);
      else name = t;
    }
    if (name !== null && IMAGE_VARS.has(name)) imageVars.push([name, path, lineAt(ke.valueStart)]);
    if (GIT_RAW.includes(name) && path.length === 2 && path[0] === "publish_docs" && path[1] === "variables") gitRaw[name].push(v.e);
    walk(v, [...path, name ?? "?"]);
  }
};
if (docs.length !== 1) stop(`.gitlab-ci.yml: holds ${docs.length} YAML documents; GitLab's reader takes the first and this check's reader refuses more than one, so the file is one document`);
if (docs[0].d.directives.length) bad(".gitlab-ci.yml: has a %YAML or %TAG directive; it can change how either reader reads tags, so the file has none");
if (docs[0].root !== null) walk(docs[0].root, []);
for (const v of IMAGE_VARS) {
  const defs = imageVars.filter(([n]) => n === v);
  const global = defs.filter(([, p]) => p.length === 1 && p[0] === "variables");
  if (global.length !== 1) bad(`.gitlab-ci.yml: ${v} is defined ${global.length} times in the global variables${global.length > 1 ? ` (a duplicate key, lines ${global.map(([, , l]) => l).join(", ")})` : ""}; publish_docs's image reads it, so it is defined once there, pinned`);
  for (const [, p, l] of defs.filter((d) => !global.includes(d))) bad(`.gitlab-ci.yml: line ${l}, in ${p.join(" > ") || "the top level"}: sets ${v}; publish_docs's image reads it, so it is defined once, pinned, in the global variables and nowhere else (not in workflow rules, default, a job or a template)`);
}

let doc;
try {
  doc = yaml.load(src, { schema, json: true });
} catch (e) {
  stop(`.gitlab-ci.yml: does not parse as YAML: ${String(e.message).split("\n")[0]}`);
}
if (doc === null || typeof doc !== "object" || Array.isArray(doc)) stop(".gitlab-ci.yml: is not a mapping of jobs");

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
// the one global definition of each variable the image reads is pinned to a digest
for (const v of IMAGE_VARS) {
  const val = isObj(doc.variables) ? doc.variables[v] : undefined;
  if (!(typeof val === "string" && /^\$\{CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX\}\/\S+@sha256:[a-f0-9]{64}$/.test(val))) bad(`.gitlab-ci.yml: the global ${v} must be a string that starts with \${CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX}/ and pins a digest, found: ${JSON.stringify(val ?? null)}; publish_docs's image reads it`);
}
// whether a mapping in the set (LATE or TWICE) is in v, replaced values included
const within = (set, v, seen = new Set()) => {
  if (v === null || typeof v !== "object" || seen.has(v)) return false;
  seen.add(v);
  if (set.has(v)) return true;
  if (Array.isArray(v)) return v.some((x) => within(set, x, seen));
  return Object.values(v).some((x) => within(set, x, seen)) || (v[SHADOW] || []).some(([, x]) => within(set, x, seen));
};
const late = (v) => within(LATE, v), twice = (v) => within(TWICE, v);
const lateMsg = "a merge key (<<) after an explicit key in the same mapping; GitLab's reader lets the later << overwrite the explicit key and this check's reader keeps it, so the job GitLab runs is not the one judged here: put the << first";
if (LATE.has(doc)) bad(`.gitlab-ci.yml: the top level has ${lateMsg}`);
for (const [k, v] of Object.entries(doc)) if (late(v)) bad(`.gitlab-ci.yml: ${k} has ${lateMsg}`);
for (const [k, v] of doc[SHADOW] || []) if (late(v)) bad(`.gitlab-ci.yml: ${k} (an earlier, replaced ${k}) has ${lateMsg}`);
const twiceMsg = "two merge keys (<<) in one mapping; GitLab's reader (Ruby Psych) takes the second and this check's reader the first, so the job GitLab runs is not the one judged here: use one << with a list (<<: [*a, *b])";
if (TWICE.has(doc)) bad(`.gitlab-ci.yml: the top level has ${twiceMsg}`);
for (const [k, v] of Object.entries(doc)) if (twice(v)) bad(`.gitlab-ci.yml: ${k} has ${twiceMsg}`);
for (const [k, v] of doc[SHADOW] || []) if (twice(v)) bad(`.gitlab-ci.yml: ${k} (an earlier, replaced ${k}) has ${twiceMsg}`);
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
  // the pages and the import's warnings (#82), exactly: the publish job requires both and refuses anything else
  if (JSON.stringify(paths) !== JSON.stringify(["assets/docs/", "import-warnings.txt"])) bad(`.gitlab-ci.yml: import_docs artifacts must be exactly assets/docs/ and import-warnings.txt, found: ${paths.join(", ") || "none"}`);
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
  // a variable in an environment name ($A, ${A} or %A%, which GitLab also
  // expands) could resolve to a scoped one
  for (const env of environments(v)) {
    const n = envName(env);
    if (typeof n === "string" && /[$%]/.test(n)) { varied.add(k); bad(`.gitlab-ci.yml: ${k} has environment ${n}, which holds a variable; it could resolve to ${Object.keys(envs).join(" or ")}, so environment names are written out`); }
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
const expanded = new Map(), expanding = [], parentsOf = new Map();
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
    parentsOf.set(k, parents.filter((p) => typeof p === "string" && isObj(doc[p])));
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
  if (/[$%]/.test(n) && !varied.has(k)) bad(`.gitlab-ci.yml: ${k} inherits environment ${n}, which holds a variable; it could resolve to ${Object.keys(envs).join(" or ")}, so environment names are written out`);
}
// The deprecated global keywords: GitLab still applies each at the top level to
// every job, publish_docs included, and this check judges default: instead (#60).
for (const k of ["before_script", "after_script", "cache", "services", "image", "hooks"]) {
  if (Object.hasOwn(doc, k)) bad(`.gitlab-ci.yml: has a top-level ${k}, a deprecated global keyword GitLab still applies to every job, publish_docs included; put it under default:, which this check judges`);
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
  if (!(isObj(pub.variables) && pub.variables.GIT_STRATEGY === "clone")) bad(".gitlab-ci.yml: publish_docs needs GIT_STRATEGY: clone, a fresh checkout and not a reused build folder");
  if (!lines(pub.script).some((l) => /nightly-publish\.sh/.test(l))) bad(".gitlab-ci.yml: publish_docs does not run tools/ci/nightly-publish.sh");
  // what runs beside the token is judged on the job as GitLab runs it: extends
  // and !reference resolved, and default:'s hooks where the job sets none
  const ex = isObj(expand("publish_docs")) ? expand("publish_docs") : {};
  const def = isObj(doc.default) && isObj(expand("default")) ? expand("default") : {};
  // needs is one entry, import_docs without its artifacts: another entry would
  // bring that job's artifacts (artifacts defaults to true), dotenv reports included
  const needs = ex.needs;
  const one = Array.isArray(needs) && needs.length === 1 && isObj(needs[0]) && Object.keys(needs[0]).length === 2 && needs[0].job === "import_docs" && needs[0].artifacts === false;
  if (!one) bad(`.gitlab-ci.yml: publish_docs needs must take import_docs without its artifacts (artifacts: false) and nothing else, exactly one entry { job: import_docs, artifacts: false }, found: ${JSON.stringify(needs ?? null)}; artifacts from any job could carry a dotenv report that sets this job's variables`);
  // hooks run shell commands, and a cache is files other jobs (which run npm)
  // can write, both beside the token: neither on publish_docs, on anything it
  // extends (at any depth), nor under default:, which every job takes
  const ancestors = (k, out = []) => { for (const p of parentsOf.get(k) || []) if (!out.includes(p)) { out.push(p); ancestors(p, out); } return out; };
  const has = (key, ...vs) => vs.some((v) => isObj(v) && Object.hasOwn(v, key));
  for (const [key, what, why] of [["hooks", "hooks", "a hook runs shell commands beside the token"], ["cache", "a cache", "a cache holds files other jobs, which run npm, can write"]]) {
    const from = ancestors("publish_docs").filter((p) => has(key, doc[p], expand(p)));
    // its own, or by !reference, where no parent gives it
    if (has(key, pub) || (has(key, ex) && from.length === 0)) bad(`.gitlab-ci.yml: publish_docs has ${what}; ${why}`);
    for (const p of from) bad(`.gitlab-ci.yml: publish_docs extends ${p}, which has ${what}; ${why}`);
    if (has(key, doc.default, expand("default"))) bad(`.gitlab-ci.yml: default has ${what}, which publish_docs takes; ${why}`);
  }
  // dependencies, whatever its value, would be a second say in which artifacts
  // publish_docs takes beside needs: none, its own or through extends (#60)
  const depWhy = "whatever its value, it is a second say in which jobs' artifacts (dotenv reports included) reach the job holding the token; needs alone decides that";
  const depFrom = ancestors("publish_docs").filter((p) => has("dependencies", doc[p], expand(p)));
  if (has("dependencies", pub) || (has("dependencies", ex) && depFrom.length === 0)) bad(`.gitlab-ci.yml: publish_docs has dependencies; ${depWhy}`);
  for (const p of depFrom) bad(`.gitlab-ci.yml: publish_docs extends ${p}, which has dependencies; ${depWhy}`);
  const pm = (l) => /\b(npm|npx|yarn|pnpm)\b/.test(l);
  for (const h of ["script", "before_script", "after_script"]) {
    const from = Object.hasOwn(ex, h) ? "" : Object.hasOwn(def, h) ? " from default" : null;
    if (from === null || !lines(from ? def[h] : ex[h]).some(pm)) continue;
    if (h === "script" && !from) bad(".gitlab-ci.yml: publish_docs runs npm or another package manager; it holds the token and runs no third-party code");
    else bad(`.gitlab-ci.yml: publish_docs runs npm or another package manager ${from ? `in the ${h} it takes from default` : `in its ${h}`}; it holds the token and runs no third-party code`);
  }
  // the image runs beside the token, so publish_docs names its own, and it is
  // PUBLISH_IMAGE; NODE_IMAGE itself is pinned to a digest by lint.sh
  if (pub.image !== PUBLISH_IMAGE || ex.image !== PUBLISH_IMAGE) bad(`.gitlab-ci.yml: publish_docs must set its own image: ${PUBLISH_IMAGE}, found: ${Object.hasOwn(pub, "image") ? JSON.stringify(ex.image) : "none of its own"}; the image runs beside the token`);
  if (isObj(ex.variables) && Object.hasOwn(ex.variables, "NODE_IMAGE")) bad(".gitlab-ci.yml: publish_docs sets NODE_IMAGE in its variables, which would change its image; the image runs beside the token");
  if (Object.hasOwn(ex, "services")) bad(".gitlab-ci.yml: publish_docs has services; a service container runs beside the token");
  // What runs beside the token is exactly what is written (#60 round 4): the
  // job's shape is allowlisted, judged as GitLab runs it (extends and
  // !reference resolved, default:'s hooks where the job sets none), rather than
  // the commands in it denylisted.
  // No parallel, in any form: a matrix can override the job's variables, GIT_STRATEGY included.
  if (Object.hasOwn(ex, "parallel")) bad(`.gitlab-ci.yml: publish_docs has parallel (${JSON.stringify(ex.parallel)}); a parallel matrix can override the job's variables, GIT_STRATEGY included, so the job holding the token runs once, as written`);
  // No rule sets variables: a rule's variables override the job's own.
  const rulesOf = Array.isArray(ex.rules) ? ex.rules.flat(Infinity) : ex.rules === undefined ? [] : [ex.rules];
  if (rulesOf.some((r) => isObj(r) && Object.hasOwn(r, "variables"))) bad(".gitlab-ci.yml: publish_docs has rules that set variables; a rule's variables override the job's own, GIT_STRATEGY included, so no rule of the job holding the token sets any");
  // The script is the one line that runs the publish script, nothing beside it.
  const PUBLISH_LINE = "sh tools/ci/nightly-publish.sh";
  const script = lines(ex.script);
  if (!(script.length === 1 && script[0] === PUBLISH_LINE)) bad(`.gitlab-ci.yml: publish_docs script must be exactly one line, ${PUBLISH_LINE}, found: ${JSON.stringify(ex.script ?? null)}; nothing else runs beside the token`);
  // No before_script or after_script: the job's own (extends and !reference
  // included), or default:'s where the job sets none. An empty list is none.
  const empty = (v) => v === undefined || v === null || (Array.isArray(v) && v.flat(Infinity).length === 0);
  for (const h of ["before_script", "after_script"]) {
    const own = Object.hasOwn(ex, h) && ex[h] !== null;
    const v = own ? ex[h] : def[h];
    if (!empty(v)) bad(`.gitlab-ci.yml: publish_docs ${own ? "has" : "takes"} ${h === "after_script" ? "an" : "a"} ${h}${own ? "" : " from default"} (${JSON.stringify(v)}); nothing runs beside the token but ${PUBLISH_LINE}`);
  }
  // Its own variables are exactly GIT_DEPTH: 1 and GIT_STRATEGY: clone, as
  // written (GIT_DEPTH a number, not "1"), and so are they with what it extends.
  const VARS = { GIT_DEPTH: 1, GIT_STRATEGY: "clone" };
  const exact = (v) => isObj(v) && Object.keys(v).length === Object.keys(VARS).length && Object.entries(VARS).every(([k, x]) => Object.hasOwn(v, k) && v[k] === x);
  const varsWhy = "a variable on the job holding the token can change what the runner or its programs do";
  if (!exact(pub.variables)) bad(`.gitlab-ci.yml: publish_docs variables must be exactly GIT_DEPTH: 1 and GIT_STRATEGY: clone, found: ${JSON.stringify(pub.variables ?? null)}; ${varsWhy}`);
  else if (!exact(ex.variables)) bad(`.gitlab-ci.yml: publish_docs variables, with what it extends, must be exactly GIT_DEPTH: 1 and GIT_STRATEGY: clone, found: ${JSON.stringify(ex.variables ?? null)}; ${varsWhy}`);
  // ...and as written (#60 round 5): GIT_DEPTH the plain scalar 1 (not 1.0, 1e0,
  // 0o1, 0x1 or +1, which GitLab's reader can take as a float or a string), and
  // GIT_STRATEGY the plain or quoted text clone. Each is written out under
  // publish_docs's own variables, not brought in by an alias or a merge key, and
  // every time it is written (a repeated key included) it is written that way.
  const RAW = {
    GIT_DEPTH: ["the plain number 1", (e) => e.type === E.SCALAR && e.style === STYLE.PLAIN && yaml.getScalarValue(src, e) === "1"],
    GIT_STRATEGY: ["the plain or quoted text clone", (e) => e.type === E.SCALAR && [STYLE.PLAIN, STYLE.SINGLE_QUOTED, STYLE.DOUBLE_QUOTED].includes(e.style) && yaml.getScalarValue(src, e) === "clone"],
  };
  for (const [v, [want, ok]] of Object.entries(RAW)) {
    if (gitRaw[v].length === 0) bad(`.gitlab-ci.yml: publish_docs ${v} is not written out as ${want} in the job itself; GitLab's reader can read a value brought in another way differently from this check's`);
    for (const e of gitRaw[v].filter((x) => !ok(x))) {
      const quoted = e.style === STYLE.SINGLE_QUOTED || e.style === STYLE.DOUBLE_QUOTED;
      const shown = e.type !== E.SCALAR ? "as an alias, a list or a mapping" : quoted ? src.slice(e.valueStart - 1, e.valueEnd + 1) : e.style === STYLE.PLAIN ? src.slice(e.valueStart, e.valueEnd) : "as a block scalar";
      bad(`.gitlab-ci.yml: line ${lineAt(startOf(e))}: publish_docs ${v} is written ${shown}; write it as ${want}, since GitLab's reader can read another spelling as a float or a string where this check's reads ${v === "GIT_DEPTH" ? "1" : "clone"}`);
    }
  }
  // Its own keys are an allowlist (#60 round 5): anything else (tags, retry,
  // id_tokens, extends, a keyword GitLab adds later) is refused, naming only the
  // key found. extends is refused too: the job is written out in full.
  const OWN = new Set(["stage", "image", "interruptible", "needs", "environment", "rules", "variables", "script"]);
  for (const k of Object.keys(pub)) if (!OWN.has(k)) bad(`.gitlab-ci.yml: publish_docs has ${k}, a key the job holding the token does not take; that job is written out in full and holds nothing else`);
  // stage exactly publish, interruptible exactly false (a boolean), its own: a
  // missing interruptible takes default:'s, which is true
  if (pub.stage !== "publish") bad(`.gitlab-ci.yml: publish_docs stage must be publish, its own, found: ${Object.hasOwn(pub, "stage") ? JSON.stringify(pub.stage) : "none"}`);
  if (pub.interruptible !== false) bad(`.gitlab-ci.yml: publish_docs interruptible must be false (a boolean), its own, found: ${Object.hasOwn(pub, "interruptible") ? JSON.stringify(pub.interruptible) : "none"}; a newer pipeline must not cancel the job holding the token midway`);
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
