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

echo "== nothing stray at the root"
for f in node_modules package.json package-lock.json .agents; do
  [ ! -e "$f" ] || { echo "   $f must not be committed"; fail=1; }
done

[ "$fail" = 0 ] && echo "lint: ok" || { echo "lint: failed"; exit 1; }
