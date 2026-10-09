#!/bin/sh
# The cheap checks: every module parses, every file the page and the
# service worker name exists, and nothing has been left in the tree that
# Pages would serve by accident. Runs in CI (lint stage) and by hand.
set -eu
cd "$(dirname "$0")/../.."
fail=0

echo "== modules parse"
for f in sw.js assets/js/*.js tests/*.js tools/*.mjs tools/ci/*.mjs; do
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

echo "== the docs index names pages that exist"
if [ -f assets/docs/index.json ]; then
  node -e '
    const idx = require("./assets/docs/index.json"); const fs = require("fs");
    const slugs = new Set((idx.sources || idx).map((s) => s.slug).filter(Boolean));
    for (const s of slugs) if (!fs.existsSync(`assets/docs/${s}.json`)) { console.log(`   assets/docs/${s}.json is missing`); process.exitCode = 1; }
  ' || fail=1
fi

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

echo "== nothing stray at the root"
# what git tracks, not what is on disk: a local, ignored .agents/ or
# node_modules/ is fine; a committed one is not (#5)
for f in node_modules package.json package-lock.json .agents; do
  [ -z "$(git ls-files -- "$f")" ] || { echo "   $f must not be committed"; fail=1; }
done

echo "== Renovate watches where the npm pins live"
# marked and sharp are pinned inline where the docs import installs them; a
# customManagers entry for them must cover each file that pins them, or
# Renovate never sees a bump.
for f in $(grep -l -E '(marked|sharp)@[0-9]' .gitlab-ci.yml tools/ci/*.sh tools/*.mjs 2>/dev/null || true); do
  node -e '
    const f = process.argv[1];
    const pats = (require("./renovate.json").customManagers || [])
      .filter((m) => (m.matchStrings || []).some((s) => /marked|sharp/.test(s)))
      .flatMap((m) => m.managerFilePatterns || []);
    if (!pats.some((p) => new RegExp(p.replace(/^\/|\/$/g, "")).test(f))) {
      console.log(`   ${f} pins marked/sharp but renovate.json watches only ${pats.join(", ")}`);
      process.exitCode = 1;
    }
  ' "$f" || fail=1
done

[ "$fail" = 0 ] && echo "lint: ok" || { echo "lint: failed"; exit 1; }
