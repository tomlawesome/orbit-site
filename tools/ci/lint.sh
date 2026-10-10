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
# none_of <file> <pattern> <message> [<except>]: every line of the file matching the (extended) pattern, and not
# the exception, fails and is named
none_of() {
  hits=$(grep -n -E "$2" "$1" | grep -v -E "${4:-^\$}" || true)
  [ -z "$hits" ] || { printf '%s\n' "$hits" | sed "s|^|   $1:|; s|\$| $3|"; fail=1; }
}
for f in assets/door/*.js; do
  none_of "$f" '(import|export)[^;]*from *"\.\./|import\("\.\./' "imports from outside the folder"
  none_of "$f" 'location\.search' "reads the address (a flag is a setting: settings.js)"
  none_of "$f" 'import\.meta\.url' "uses import.meta.url (a picture's place is a setting: settings.js)"
done
for f in sw.js assets/js/*.js; do
  none_of "$f" '(from|import\() *"[^"]*door/([a-z0-9-]+\.js)?"' "must import assets/door/index.js alone" '"\.\./door/index\.js"'
done
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
# run on every visitor, whatever the importer let through
node -e '
  const fs = require("fs");
  const bad = [/<[a-z][^>]*\son[a-z]+\s*=/i, /<(script|style|iframe|svg|math|object|embed|form|base|meta|link|template)\b/i,
    /(href|src)\s*=\s*["\x27]?\s*(javascript|vbscript|data):/i];
  const files = fs.existsSync("assets/docs") ? fs.readdirSync("assets/docs").filter((f) => f.endsWith(".json") && f !== "index.json") : [];
  for (const f of files) {
    for (const s of JSON.parse(fs.readFileSync(`assets/docs/${f}`, "utf8")).sections || []) {
      if (bad.some((re) => re.test(s.html || ""))) { console.log(`   assets/docs/${f} section ${s.id} carries script`); process.exitCode = 1; }
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
printf '%s\n' "$wf" | grep -q 'CI_MERGE_REQUEST_SOURCE_BRANCH_NAME =~ /^docs\\/import-/' \
  && printf '%s\n' "$wf" | grep -q '^ *CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX: docker.io$' \
  || { echo "   .gitlab-ci.yml: no workflow rule sends docs/import- merge requests to Docker Hub"; fail=1; }
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
