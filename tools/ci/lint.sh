#!/bin/sh
# The cheap checks: every module parses, every file the page and the
# service worker name exists, and nothing has been left in the tree that
# Pages would serve by accident. Runs in CI (lint stage) and by hand.
set -eu
cd "$(dirname "$0")/../.."
fail=0

# Sections, in the order they run: `sh tools/ci/lint.sh` runs them all (CI does);
# `sh tools/ci/lint.sh ci-split names` runs only those, in this order, so a test
# that plants one fault pays for one section (#65); `--list` names them. An
# unknown name runs nothing and exits 2, so a typo cannot pass.
sections="parse refs door types docs-index docs-shape docs-noscript milkyway proxy ci-split media csp names stray npm-pins"
if [ "$#" = 1 ] && [ "$1" = --list ]; then printf '%s\n' $sections; exit 0; fi
for s in "$@"; do
  case " $sections " in *" $s "*) ;; *) echo "lint.sh: no section named '$s' (sections: $sections)"; exit 2 ;; esac
done
chosen=" $* "
on() { [ "$chosen" = "  " ] || case "$chosen" in *" $1 "*) ;; *) false ;; esac; }

if on parse; then
echo "== modules parse"
# one Node for every file, not one or two per file (#67): V8 parses each without
# running it, as a module (compiled, never linked or evaluated) and, for a .js
# that is not one, as a CommonJS script inside Node's own wrapper, as node --check does;
# a file that is neither is reported with the module parse error
node --experimental-vm-modules --no-warnings -e '
  const vm = require("vm"), fs = require("fs");
  for (const f of process.argv.slice(1)) {
    let src, why;
    try { src = fs.readFileSync(f, "utf8"); } catch (e) { console.log(`   ${f} does not parse: ${e.message}`); process.exitCode = 1; continue; }
    try { new vm.SourceTextModule(src, { identifier: f }); continue; } catch (e) { why = e; }
    if (!f.endsWith(".mjs")) {
      try { vm.compileFunction(src, ["exports", "require", "module", "__filename", "__dirname"], { filename: f }); continue; } catch {}
    }
    console.log(`   ${f} does not parse: ${why.name}: ${why.message}`);
    process.exitCode = 1;
  }
' sw.js assets/js/*.js assets/door/*.js tests/*.js tools/*.mjs tools/ci/*.mjs || fail=1
fi

if on refs; then
echo "== every local src/href in the pages exists"
for page in index.html install.html 404.html tests/index.html; do
  grep -o -E '(src|href)="[^"#?:]+"' "$page" | sed -E 's/^[a-z]+="//; s/"$//' | sort -u | while read -r ref; do
    case "$ref" in /*|data:*) continue ;; esac
    [ -e "$(dirname "$page")/$ref" ] || { echo "   $page -> $ref is missing"; exit 1; }
  done || fail=1
done
fi

if on door; then
echo "== the shared door is self-contained (assets/door, ADR-0001)"
# the folder is copied into Orbit unchanged: nothing in it may reach outside it, read the address, or make a URL
# from import.meta.url (a bundler leaks that into server-rendered pages); the site's own modules use only its entry
# point, so the interface is one file. tests/ and tools/ may reach in: they are not the site
# every module specifier (import … from, export … from, a bare import, a dynamic import; either quote, over any
# number of lines, comments set aside) is read by node, so nothing slips past a line-by-line grep
node -e '
  const fs = require("fs");
  const bad = (m) => { console.log(`   ${m}`); process.exitCode = 1; };
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
  const specifiers = (s) => {
    const out = [], q = "[\"\x27]";
    const re = new RegExp(`\\b(?:import|export)\\b[^;\"\x27\`]*?\\bfrom\\s*(${q})([^\"\x27]+)\\1|\\bimport\\s*(${q})([^\"\x27]+)\\3|\\bimport\\s*\\(\\s*(${q})([^\"\x27]+)\\5`, "g");
    let m; while ((m = re.exec(s))) out.push(m[2] ?? m[4] ?? m[6]);
    return out;
  };
  const js = (dir) => fs.readdirSync(dir).filter((n) => n.endsWith(".js")).map((n) => `${dir}/${n}`);
  for (const f of js("assets/door")) {
    const src = strip(fs.readFileSync(f, "utf8"));
    for (const sp of specifiers(src)) if (!/^\.\/[^/]+$/.test(sp)) bad(`${f}: imports ${sp} from outside the folder (a door module imports only ./name.js)`);
    if (/\blocation\s*(\.\s*search\b|\[\s*[\"\x27]search[\"\x27]\s*\])/.test(src)) bad(`${f}: reads the address (a flag is a setting: settings.js)`);
    if (/\bimport\s*\.\s*meta\s*\.\s*url\b/.test(src)) bad(`${f}: uses import.meta.url (a picture\x27s place is a setting: settings.js)`);
  }
  for (const f of ["sw.js", ...js("assets/js")]) {
    const src = strip(fs.readFileSync(f, "utf8"));
    for (const sp of specifiers(src)) if (/(^|\/)door\//.test(sp) && sp !== "../door/index.js") bad(`${f}: imports ${sp}; a site module imports assets/door/index.js alone`);
  }
' || fail=1
# its stylesheet reaches nothing outside the folder either: every url() in it is a fragment, data, or a file in it
for ref in $(grep -o -E 'url\("?[^")]+"?\)' assets/door/door.css | sed -E 's/^url\("?//; s/"?\)$//' | sort -u); do
  case "$ref" in \#*|data:*) continue ;; /*|../*|*://*) echo "   assets/door/door.css -> $ref reaches outside the folder"; fail=1; continue ;; esac
  [ -e "assets/door/$ref" ] || { echo "   assets/door/door.css -> $ref is missing"; fail=1; }
done
# and the page carries the door's markup as the folder writes it (tools/door-markup.mjs)
node tools/door-markup.mjs --check || fail=1
fi

if on types; then
echo "== the shared door type-checks strictly (assets/door, #30)"
# TypeScript's checkJs in strict mode over every module in the folder, settings in
# tools/ci/tsconfig.door.json; TypeScript is pinned in tools/package.json, so the lint
# job runs npm ci --prefix tools first. tools/ci/door-types.mjs says more.
node tools/ci/door-types.mjs || fail=1
fi

if on docs-index; then
echo "== the docs index names pages that exist"
if [ -f assets/docs/index.json ]; then
  node -e '
    const idx = require("./assets/docs/index.json"); const fs = require("fs");
    const slugs = new Set((idx.sources || idx).map((s) => s.slug).filter(Boolean));
    for (const s of slugs) if (!fs.existsSync(`assets/docs/${s}.json`)) { console.log(`   assets/docs/${s}.json is missing`); process.exitCode = 1; }
  ' || fail=1
fi
fi

if on docs-shape; then
echo "== the imported docs have the shape the import writes"
# the pad draws the index's colour, slugs and ids into innerHTML: they must be
# what tools/import-docs.mjs writes for the sources in tools/docs-sources.json
# (the publish job holds the artifact to the same check, #18)
node tools/ci/docs-shape.mjs assets/docs tools/docs-sources.json || fail=1
fi

if on docs-noscript; then
echo "== the imported docs carry no script"
# the stored pages are what Pages serves; a handler or script tag here would
# run on every visitor, whatever the importer let through. A stored section
# may hold only tags written the one way a browser and this check read alike:
# an ascii name, html whitespace, name="value" with no quote or angle bracket
# inside, and no attributes on an end tag. Anything else is refused outright:
# the import never writes it, and the browser's tokeniser has states this check
# does not follow. A URL attribute has its entities decoded and its whitespace
# and control characters removed before the scheme is looked at. A construct
# that would put a browser into a comment or a raw-text element is refused
# outright, since the import never writes one and the check cannot follow it.
node tools/ci/docs-noscript.mjs assets/docs || fail=1
fi

if on milkyway; then
echo "== the Milky Way is drawn: no Gaia picture, credit or licence shipped"
for f in assets/img/*/galaxy*.webp assets/img/galaxy*.webp; do
  [ ! -e "$f" ] || { echo "   $f must be deleted (the galaxy is drawn, not a picture)"; fail=1; }
done
[ ! -e tools/galaxy.py ] || { echo "   tools/galaxy.py must be deleted"; fail=1; }
for f in index.html 404.html install.html README.md LICENSE; do
  if grep -q -i -E 'gaia|CC BY-NC 3\.0 IGO|by-nc/3\.0/igo' "$f"; then
    echo "   $f still mentions Gaia or its CC BY-NC 3.0 IGO licence"; fail=1
  fi
done
if grep -q 'svs\.gsfc\.nasa\.gov/4851' index.html; then
  echo "   index.html still links svs.gsfc.nasa.gov/4851"; fail=1
fi
grep -q 'svs\.gsfc\.nasa\.gov/4720' index.html \
  || { echo "   index.html has no link to svs.gsfc.nasa.gov/4720"; fail=1; }
fi

if on proxy; then
echo "== docs-import merge requests pull without the dependency proxy"
# the import's bot cannot use the group proxy: its merge requests must pull
# from Docker Hub, and the node pin must keep the prefix that rule swaps
wf=$(awk '/^workflow:/{w=1} /^[a-z]/&&!/^workflow:/{w=0} w' .gitlab-ci.yml)
# GitLab takes the first workflow rule that matches, so each rule is judged as
# one block (its condition, its variables, no `when: never`) and by its place:
# the docs/import rule must come before the general merge-request rule, and
# the bot-author rule before the closing `if: $CI_COMMIT_BRANCH` rule, or the
# general rule matches first and the override never applies.
WF="$wf" node -e '
  const bad = (m) => { console.log(`   .gitlab-ci.yml: ${m}`); process.exitCode = 1; };
  const rules = [];
  let inRules = false;
  for (const l of process.env.WF.split("\n")) {
    if (/^\s*#/.test(l) || !l.trim()) continue;
    if (/^  rules:/.test(l)) { inRules = true; continue; }
    if (!inRules) continue;
    if (/^    - /.test(l)) rules.push(l.trim().replace(/^- /, "") + "\n");
    else if (rules.length) rules[rules.length - 1] += l.trim() + "\n";
  }
  const sets = (r) => /^variables:\n(?:.*\n)*?CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX: docker\.io\n/m.test(r) && !/^when: never$/m.test(r);
  const first = (r) => r.split("\n")[0];
  const docs = rules.findIndex((r) => /CI_PIPELINE_SOURCE == "merge_request_event"/.test(first(r)) && /CI_MERGE_REQUEST_SOURCE_BRANCH_NAME =~ \/\^docs\\\/import-\//.test(first(r)));
  const mr = rules.findIndex((r) => first(r) === `if: $CI_PIPELINE_SOURCE == "merge_request_event"`);
  const botMr = rules.findIndex((r) => /CI_PIPELINE_SOURCE == "merge_request_event"/.test(first(r)) && /GITLAB_USER_LOGIN =~ \/project_\[0-9\]\+_bot_\//.test(first(r)));
  const bot = rules.findIndex((r) => /CI_COMMIT_AUTHOR =~ \/project_\[0-9\]\+_bot_\//.test(first(r)));
  const last = rules.findIndex((r) => first(r) === "if: $CI_COMMIT_BRANCH");
  if (docs < 0) bad("no workflow rule matches merge requests from docs/import- branches");
  else {
    if (!sets(rules[docs])) bad("the docs/import- merge-request rule does not set CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX: docker.io (or says when: never), so those merge requests pull through the group proxy the import bot cannot use");
    if (mr < 0) bad("no general merge-request workflow rule to order the docs/import- rule before");
    else if (docs > mr) bad("the docs/import- merge-request rule comes after the general merge-request rule, which matches first, so its Docker Hub override never applies");
  }
  // a merge request whose pipeline the bot started, by moving its source branch (#70)
  if (botMr < 0) bad("no workflow rule sends merge-request pipelines the import bot starts (GITLAB_USER_LOGIN =~ /project_[0-9]+_bot_/) to Docker Hub");
  else {
    if (!sets(rules[botMr])) bad("the bot merge-request rule does not set CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX: docker.io (or says when: never)");
    if (mr >= 0 && botMr > mr) bad("the bot merge-request rule comes after the general merge-request rule, which matches first, so its Docker Hub override never applies");
  }
  if (bot < 0) bad("no workflow rule sends the import bot pushes (its self-merge on main) to Docker Hub");
  else {
    if (!sets(rules[bot])) bad("the bot-author rule does not set CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX: docker.io (or says when: never)");
    if (last < 0) bad("no closing `if: $CI_COMMIT_BRANCH` workflow rule to order the bot-author rule before");
    else if (bot > last) bad("the bot-author rule comes after the general `if: $CI_COMMIT_BRANCH` rule, which matches first, so its Docker Hub override never applies");
  }
' || fail=1
grep -q '^  NODE_IMAGE: \${CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX}/[^ ]*@sha256:[a-f0-9]\{64\}$' .gitlab-ci.yml \
  || { echo "   .gitlab-ci.yml: NODE_IMAGE must start with \${CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX}/ and pin a digest"; fail=1; }
fi

if on ci-split; then
echo "== the docs import is split: import_docs holds no token, publish_docs alone is in the docs-import environment, renovate alone in renovate"
# The import runs other people's code (npm packages) and so must hold nothing
# worth stealing; the publish holds the token, runs no third-party code, and is
# the only job in the docs-import environment, where the token is scoped (#18).
# Both run from the schedule on main alone, never on a merge request pipeline.
# The Renovate tokens are scoped the same way to the renovate environment,
# which only the renovate job joins, since every other job runs npm packages.
# Joining counts whether by name or inherited by extends or !reference (#52).
# Also refused (#52, #59): a << merge key after an explicit key, a child
# pipeline, a package manager in publish_docs's script or hooks (extended,
# referenced or from default:), services or a changed image beside the token,
# and import_docs artifacts kept over a day. And (#60) anything GitLab's reader
# (Ruby Psych) could read differently from js-yaml: a quoted "<<", a key led by a
# colon or read as a boolean, null or number, a tag but !reference, a %VAR% in an
# environment name; and on publish_docs, needs beyond import_docs without its
# artifacts, hooks or a cache (its own, a parent's or default:'s), or NODE_IMAGE
# set anywhere but once in the global variables.
# Read as YAML with js-yaml from tools/node_modules (#52), so the lint job runs
# npm ci --prefix tools first; without it, or if the file does not parse, this fails.
node tools/ci/ci-split.mjs || fail=1
fi

if on media; then
echo "== the service worker's picture cache name follows the pictures"
# sw.js keeps pictures in the visitor's browser under the name MEDIA; replacing
# a picture without a new name would leave the old one served for 36 hours. So
# the name is computed: orbit-media- and the first 12 hex characters of the
# SHA-256 over one line "<path> <git blob sha>" for each tracked file the
# worker caches as media (its isMedia extensions), outside assets/docs/ (the
# nightly import owns that), sorted by path in byte order. A changed, added or
# removed picture changes the name; paste the one printed here into sw.js.
node -e '
  const fs = require("fs");
  const { execFileSync } = require("child_process");
  const rows = execFileSync("git", ["ls-files", "-s", "-z"]).toString("utf8").split("\0").filter(Boolean)
    .map((r) => { const m = /^\d+ ([0-9a-f]+) \d\t([\s\S]*)$/.exec(r); return { sha: m[1], path: m[2] }; })
    .filter((r) => /\.(webp|png|jpe?g|gif|svg|exr|woff2?)$/i.test(r.path) && !r.path.startsWith("assets/docs/"))
    .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const body = rows.map((r) => `${r.path} ${r.sha}\n`).join("");
  const want = "orbit-media-" + require("crypto").createHash("sha256").update(body).digest("hex").slice(0, 12);
  const m = /const MEDIA = "([^"]*)"/.exec(fs.readFileSync("sw.js", "utf8"));
  if (!m) { console.log("   sw.js: no const MEDIA = \"...\" found"); process.exitCode = 1; }
  else if (m[1] !== want) { console.log(`   sw.js: MEDIA is ${m[1]}, but the pictures hash to ${want}; set MEDIA to ${want}`); process.exitCode = 1; }
' || fail=1
fi

if on csp; then
echo "== the pages carry a Content-Security-Policy that covers what they run"
# GitHub Pages sends no headers, so index.html, 404.html and install.html each carry the policy as a
# <meta http-equiv="Content-Security-Policy">. A meta covers only what follows it, so it comes first in <head>, before
# any script, link or style. Scripts run only from the site, jsDelivr (the pinned Mermaid) and the page's own inline
# scripts, each allowed by its sha256 in script-src: no 'unsafe-inline' or 'unsafe-eval' for scripts, object-src 'none',
# base-uri 'self', and no inline event handler (it would need 'unsafe-inline'). An inline script edited without its
# hash changed is blocked in every visitor's browser, so a missing or stale hash prints the value to paste (audit #12).
node - <<'CSP_EOF' || fail=1
const fs = require("fs");
const crypto = require("crypto");
const bad = (m) => { console.log(`   ${m}`); process.exitCode = 1; };
const hash = (t) => "\x27sha256-" + crypto.createHash("sha256").update(t, "utf8").digest("base64") + "\x27";
for (const page of ["index.html", "404.html", "install.html"]) {
  const raw = fs.readFileSync(page, "utf8");
  // comments set aside, but keeping every offset, so a tag named in a comment is not read as a tag
  const text = raw.replace(/<!--[\s\S]*?-->/g, (c) => " ".repeat(c.length));
  const scripts = [...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .map((m) => ({ at: m.index, attrs: m[1], src: /\bsrc\s*=/i.test(m[1]), body: raw.slice(m.index + m[0].indexOf(">") + 1, m.index + m[0].length - m[0].match(/<\/script\s*>$/i)[0].length) }));
  const meta = [...text.matchAll(/<meta\b[^>]*\bhttp-equiv\s*=\s*["\x27]?content-security-policy["\x27]?[^>]*>/gi)];
  if (!meta.length) { bad(`${page}: has no <meta http-equiv="Content-Security-Policy"> (Pages sends no header, so the page carries its own policy)`); continue; }
  if (meta.length > 1) bad(`${page}: has ${meta.length} policy metas; one`);
  const tag = meta[0][0], at = meta[0].index;
  const early = text.slice(0, at).match(/<(script|link|style)\b/i);
  if (early) bad(`${page}: the policy meta comes after a <${early[1].toLowerCase()}>; a meta covers only what follows it, so put it first in <head>, before any script, link or style`);
  const content = (tag.match(/\bcontent\s*=\s*"([^"]*)"/i) || tag.match(/\bcontent\s*=\s*\x27([^\x27]*)\x27/i) || [, ""])[1];
  const dir = {};
  for (const d of content.split(";").map((x) => x.trim()).filter(Boolean)) { const [n, ...v] = d.split(/\s+/); dir[n.toLowerCase()] = v; }
  const src = dir["script-src"];
  if (!src) { bad(`${page}: the policy has no script-src`); continue; }
  for (const u of ["\x27unsafe-inline\x27", "\x27unsafe-eval\x27"]) {
    if (src.includes(u)) bad(`${page}: script-src allows ${u}; allow an inline script by its hash instead`);
  }
  if (!(dir["object-src"] || []).includes("\x27none\x27")) bad(`${page}: the policy lacks object-src \x27none\x27`);
  if (!(dir["base-uri"] || []).includes("\x27self\x27")) bad(`${page}: the policy lacks base-uri \x27self\x27`);
  const inline = scripts.filter((s) => !s.src).map((s) => hash(s.body));
  for (const h of inline) if (!src.includes(h)) bad(`${page}: an inline script has no matching hash in script-src (it would be blocked); add ${h}`);
  for (const h of src.filter((t) => /^\x27sha(256|384|512)-/.test(t))) if (!inline.includes(h)) bad(`${page}: script-src has ${h}, which matches no inline script (an edited script keeps its old hash?); the inline scripts hash to ${inline.join(" ") || "nothing"}`);
  // an inline event handler (onclick=, …) or a javascript: address needs 'unsafe-inline'; attribute values and script text set aside
  const markup = text.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "<script></script>");
  for (const m of markup.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const t = m[0].replace(/"[^"]*"|\x27[^\x27]*\x27/g, '""');
    const h = t.match(/\son[a-z]+\s*=/i);
    if (h) bad(`${page}: an inline event handler (${h[0].trim()}) in ${m[0].slice(0, 60)}; the policy would block it, so attach it from a script`);
    if (/\b(href|src|action|formaction)\s*=\s*["\x27]?\s*javascript:/i.test(m[0])) bad(`${page}: a javascript: address in ${m[0].slice(0, 60)}`);
  }
}
CSP_EOF
fi

if on names; then
echo "== no real names, host logins or private addresses (#56)"
# only sha256 digests are stored; a hit is reported as file:line, never the value (CI logs are public)
node tools/ci/no-real-names.mjs || fail=1
fi

if on stray; then
echo "== nothing stray at the root"
# what git tracks, not what is on disk: a local, ignored .agents/ or
# node_modules/ is fine; a committed one is not (#5)
for f in node_modules package.json package-lock.json .agents; do
  [ -z "$(git ls-files -- "$f")" ] || { echo "   $f must not be committed"; fail=1; }
done
fi

if on npm-pins; then
echo "== the npm pins live in tools/package.json only"
# the docs import installs marked and sharp with npm ci from tools/, so the
# manifest names exact versions, the lockfile holds a hash for every package,
# and Renovate's npm manager bumps both; a version named anywhere else
# escapes all three
for f in $(grep -l -E '(marked|sharp|typescript)@[0-9]' .gitlab-ci.yml tools/ci/*.sh tools/*.mjs AGENTS.md 2>/dev/null || true); do
  echo "   $f names a marked/sharp/typescript version; the pins live in tools/package.json"; fail=1
done
node -e '
  const fs = require("fs");
  const bad = (m) => { console.log(`   ${m}`); process.exitCode = 1; };
  const lock = "tools/package-lock.json";
  if (!fs.existsSync(lock)) bad(`${lock} is missing`);
  else {
    const j = JSON.parse(fs.readFileSync(lock, "utf8"));
    if (!(j.lockfileVersion >= 3)) bad(`${lock} is lockfileVersion ${j.lockfileVersion}, want 3`);
    for (const [k, p] of Object.entries(j.packages || {})) if (k !== "" && !p.integrity) bad(`${lock}: ${k} has no integrity`);
  }
  const man = "tools/package.json";
  const deps = fs.existsSync(man) ? JSON.parse(fs.readFileSync(man, "utf8")).dependencies || {} : {};
  for (const n of ["marked", "sharp"]) {
    if (!/^\d+\.\d+\.\d+$/.test(deps[n] || "")) bad(`${man}: ${n} is ${JSON.stringify(deps[n])}, want an exact x.y.z`);
  }
  // TypeScript, for the door type check (#30), is dev-only: the docs import (npm ci --omit=dev) never installs it
  const dev = fs.existsSync(man) ? JSON.parse(fs.readFileSync(man, "utf8")).devDependencies || {} : {};
  if (!/^\d+\.\d+\.\d+$/.test(dev.typescript || "")) bad(`${man}: devDependencies.typescript is ${JSON.stringify(dev.typescript)}, want an exact x.y.z`);
  const r = require("./renovate.json");
  if (!(r.enabledManagers || []).includes("npm")) bad("renovate.json: enabledManagers lacks npm");
  for (const m of r.customManagers || []) {
    if ((m.matchStrings || []).some((s) => /marked|sharp/.test(s))) bad("renovate.json: a customManager still matches marked/sharp");
    // Renovate compiles these with RE2, which has no look-arounds: one makes it reject the whole config
    for (const s of m.matchStrings || []) if (/\(\?(=|!|<=|<!)/.test(s)) bad(`renovate.json: a matchString has a look-around, which Renovate cannot compile: ${s}`);
  }
' || fail=1
fi

[ "$fail" = 0 ] && echo "lint: ok" || { echo "lint: failed"; exit 1; }
