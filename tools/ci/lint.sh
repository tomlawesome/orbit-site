#!/bin/sh
# The cheap checks: every module parses, every file the page and the
# service worker name exists, and nothing has been left in the tree that
# Pages would serve by accident. Runs in CI (lint stage) and by hand.
set -eu
cd "$(dirname "$0")/../.."
fail=0

echo "== modules parse"
for f in sw.js assets/js/*.js assets/door/*.js tests/*.js tools/*.mjs tools/ci/*.mjs; do
  node --experimental-default-type=module --check "$f" 2>/dev/null \
    || node --check "$f" || { echo "   $f does not parse"; fail=1; }
done

echo "== every local src/href in the pages exists"
for page in index.html install.html 404.html tests/index.html; do
  grep -o -E '(src|href)="[^"#?:]+"' "$page" | sed -E 's/^[a-z]+="//; s/"$//' | sort -u | while read -r ref; do
    case "$ref" in /*|data:*) continue ;; esac
    [ -e "$(dirname "$page")/$ref" ] || { echo "   $page -> $ref is missing"; exit 1; }
  done || fail=1
done

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

echo "== the docs index names pages that exist"
if [ -f assets/docs/index.json ]; then
  node -e '
    const idx = require("./assets/docs/index.json"); const fs = require("fs");
    const slugs = new Set((idx.sources || idx).map((s) => s.slug).filter(Boolean));
    for (const s of slugs) if (!fs.existsSync(`assets/docs/${s}.json`)) { console.log(`   assets/docs/${s}.json is missing`); process.exitCode = 1; }
  ' || fail=1
fi

echo "== the imported docs carry no script"
# the stored pages are what Pages serves; a handler or script tag here would
# run on every visitor, whatever the importer let through. This reads the html
# the way a browser does, since a hand edit or a hole in the sanitiser can
# produce what its own tokeniser would allow: attributes are found after any
# separator (a space, a slash, a control character, a closing quote) and in
# any case; a URL attribute has its entities decoded and its whitespace and
# control characters removed before the scheme is looked at.
node -e '
  const fs = require("fs");
  const bad = [/<(script|style|iframe|svg|math|object|embed|form|base|meta|link|template)\b/i];
  const named = { colon: ":", tab: "\t", newline: "\n", nbsp: "\xa0", amp: "&", quot: "\"", apos: "\x27", lt: "<", gt: ">", lpar: "(", rpar: ")" };
  const cp = (n) => { try { return String.fromCodePoint(n); } catch { return ""; } };
  const decode = (v) => {
    for (let i = 0; i < 4; i++) {
      const w = v.replace(/&#x([0-9a-f]+);?/gi, (m, h) => cp(parseInt(h, 16)))
        .replace(/&#(\d+);?/g, (m, d) => cp(Number(d)))
        .replace(/&([a-z]+);/gi, (m, n) => (named[n.toLowerCase()] !== undefined ? named[n.toLowerCase()] : m));
      if (w === v) break;
      v = w;
    }
    return v;
  };
  const scheme = (v) => decode(v).replace(/[\p{Cc}\p{Z}\p{Cf}]/gu, "");
  const urlAttr = new Set(["href", "src", "xlink:href", "action", "formaction", "data", "poster", "background", "ping", "srcset"]);
  const danger = (h) => {
    const tagRe = /<([a-z][^\s\/>\x00-\x20]*)/gi;
    let m;
    while ((m = tagRe.exec(h))) {
      let i = tagRe.lastIndex;
      for (;;) {
        const sep = /[\s\/\x00-\x20"\x27=]*/y; sep.lastIndex = i; sep.exec(h); i = sep.lastIndex;
        if (i >= h.length || h[i] === ">") break;
        const a = /([^\s\/>=\x00-\x20"\x27]+)(?:[\s\x00-\x20]*=[\s\x00-\x20]*("[^"]*"|\x27[^\x27]*\x27|[^\s>\x00-\x20]*))?/y;
        a.lastIndex = i;
        const r = a.exec(h);
        if (!r) break;
        i = a.lastIndex;
        const name = r[1].toLowerCase(), value = (r[2] || "").replace(/^["\x27]|["\x27]$/g, "");
        if (/^on/.test(name)) return true;
        if (urlAttr.has(name) && /(^|,)(javascript|vbscript|data):/.test(scheme(value))) return true;
      }
      tagRe.lastIndex = i;
    }
    return bad.some((re) => re.test(h));
  };
  const files = fs.existsSync("assets/docs") ? fs.readdirSync("assets/docs").filter((f) => f.endsWith(".json") && f !== "index.json") : [];
  for (const f of files) {
    for (const s of JSON.parse(fs.readFileSync(`assets/docs/${f}`, "utf8")).sections || []) {
      if (danger(s.html || "")) { console.log(`   assets/docs/${f} section ${s.id} carries script`); process.exitCode = 1; }
    }
  }
' || fail=1

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
  const bot = rules.findIndex((r) => /CI_COMMIT_AUTHOR =~ \/project_\[0-9\]\+_bot_\//.test(first(r)));
  const last = rules.findIndex((r) => first(r) === "if: $CI_COMMIT_BRANCH");
  if (docs < 0) bad("no workflow rule matches merge requests from docs/import- branches");
  else {
    if (!sets(rules[docs])) bad("the docs/import- merge-request rule does not set CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX: docker.io (or says when: never), so those merge requests pull through the group proxy the import bot cannot use");
    if (mr < 0) bad("no general merge-request workflow rule to order the docs/import- rule before");
    else if (docs > mr) bad("the docs/import- merge-request rule comes after the general merge-request rule, which matches first, so its Docker Hub override never applies");
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

echo "== nothing stray at the root"
# what git tracks, not what is on disk: a local, ignored .agents/ or
# node_modules/ is fine; a committed one is not (#5)
for f in node_modules package.json package-lock.json .agents; do
  [ -z "$(git ls-files -- "$f")" ] || { echo "   $f must not be committed"; fail=1; }
done

echo "== the npm pins live in tools/package.json only"
# the docs import installs marked and sharp with npm ci from tools/, so the
# manifest names exact versions, the lockfile holds a hash for every package,
# and Renovate's npm manager bumps both; a version named anywhere else
# escapes all three
for f in $(grep -l -E '(marked|sharp)@[0-9]' .gitlab-ci.yml tools/ci/*.sh tools/*.mjs AGENTS.md 2>/dev/null || true); do
  echo "   $f names a marked/sharp version; the pins live in tools/package.json"; fail=1
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
  const r = require("./renovate.json");
  if (!(r.enabledManagers || []).includes("npm")) bad("renovate.json: enabledManagers lacks npm");
  for (const m of r.customManagers || []) {
    if ((m.matchStrings || []).some((s) => /marked|sharp/.test(s))) bad("renovate.json: a customManager still matches marked/sharp");
    // Renovate compiles these with RE2, which has no look-arounds: one makes it reject the whole config
    for (const s of m.matchStrings || []) if (/\(\?(=|!|<=|<!)/.test(s)) bad(`renovate.json: a matchString has a look-around, which Renovate cannot compile: ${s}`);
  }
' || fail=1

[ "$fail" = 0 ] && echo "lint: ok" || { echo "lint: failed"; exit 1; }
