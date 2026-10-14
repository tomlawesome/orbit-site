#!/bin/sh
# Test for how tools/ci/door-timing.mjs finds Playwright (audit #21), written
# from the specification alone: with PLAYWRIGHT_ROOT unset it takes the same
# lookup as tools/ci/journey-local.sh (the newest
# node_modules/.pnpm/playwright@*/node_modules/playwright under ORBIT_DIR,
# default: the orbit checkout beside this one); when none is found it exits
# non-zero with a message naming PLAYWRIGHT_ROOT and ORBIT_DIR.
#
#   sh tools/ci/door-timing-lookup-test.sh        run from anywhere
#
# The Playwright copies here are stubs whose module prints a marker naming its
# version and then throws, so no browser opens and no server starts (SITE
# points at a closed port). The script is also copied into a scratch layout
# for the default-directory case, so the checkout is untouched.
set -eu

root=$(git rev-parse --show-toplevel)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
script=$root/tools/ci/door-timing.mjs
out=$tmp/out
failed=0

# A stub Playwright at $1 whose marker names $2.
stub() {
  mkdir -p "$1"
  printf '{"name":"playwright","version":"%s","main":"index.js"}\n' "$2" > "$1/package.json"
  printf 'console.log("STUB-PLAYWRIGHT-LOADED %s");\nthrow new Error("stub playwright %s: no browser here");\n' "$2" "$2" > "$1/index.js"
}
pw() { stub "$1/node_modules/.pnpm/playwright@$2/node_modules/playwright" "$2"; }

orbit=$tmp/orbit
pw "$orbit" 1.9.0
pw "$orbit" 1.52.0
pw "$orbit" 1.40.0
mkdir -p "$tmp/empty" "$tmp/elsewhere"
stub "$tmp/explicit/playwright" explicit

# run <script> [VAR=value ...]: PLAYWRIGHT_ROOT unset unless given; rc and output kept
run() {
  s=$1; shift
  rc=0
  (cd "$tmp/elsewhere" && env -u PLAYWRIGHT_ROOT -u ORBIT_DIR SITE=http://127.0.0.1:1/ RUNS=1 "$@" \
    timeout 30 node "$s") > "$out" 2>&1 || rc=$?
}
show() { sed 's/^/     /' "$out"; }

# Case 1: ORBIT_DIR holds three versions -> the newest by version order (1.52.0, not 1.9.0) is the one loaded.
run "$script" ORBIT_DIR="$orbit"
if grep -q "STUB-PLAYWRIGHT-LOADED 1.52.0" "$out" && ! grep -q "STUB-PLAYWRIGHT-LOADED 1.9.0\|STUB-PLAYWRIGHT-LOADED 1.40.0" "$out"; then
  echo "ok   the newest Playwright under ORBIT_DIR is loaded"
else
  echo "FAIL the newest Playwright under ORBIT_DIR is loaded (exit $rc, want the output to hold STUB-PLAYWRIGHT-LOADED 1.52.0 and no other version)"
  show; failed=1
fi

# Case 2: PLAYWRIGHT_ROOT set -> it wins over ORBIT_DIR (control).
run "$script" ORBIT_DIR="$orbit" PLAYWRIGHT_ROOT="$tmp/explicit/playwright"
if grep -q "STUB-PLAYWRIGHT-LOADED explicit" "$out" && ! grep -q "STUB-PLAYWRIGHT-LOADED 1\." "$out"; then
  echo "ok   PLAYWRIGHT_ROOT wins over ORBIT_DIR"
else
  echo "FAIL PLAYWRIGHT_ROOT wins over ORBIT_DIR (exit $rc, want STUB-PLAYWRIGHT-LOADED explicit only)"
  show; failed=1
fi

# Case 3: ORBIT_DIR unset -> the default is the orbit checkout beside this one.
mkdir -p "$tmp/work/site/tools/ci"
cp "$script" "$tmp/work/site/tools/ci/door-timing.mjs"
pw "$tmp/work/orbit" 1.20.0
pw "$tmp/work/orbit" 1.3.0
run "$tmp/work/site/tools/ci/door-timing.mjs"
if grep -q "STUB-PLAYWRIGHT-LOADED 1.20.0" "$out" && ! grep -q "STUB-PLAYWRIGHT-LOADED 1.3.0" "$out"; then
  echo "ok   the default ORBIT_DIR is the orbit checkout beside the site"
else
  echo "FAIL the default ORBIT_DIR is the orbit checkout beside the site (exit $rc, want STUB-PLAYWRIGHT-LOADED 1.20.0 only)"
  show; failed=1
fi

# Case 4: nothing found under ORBIT_DIR -> non-zero, and the message names both variables.
run "$script" ORBIT_DIR="$tmp/empty"
if [ "$rc" -ne 0 ] && [ "$rc" -ne 124 ] && grep -q "PLAYWRIGHT_ROOT" "$out" && grep -q "ORBIT_DIR" "$out" && ! grep -q "STUB-PLAYWRIGHT-LOADED" "$out"; then
  echo "ok   no Playwright found exits non-zero naming PLAYWRIGHT_ROOT and ORBIT_DIR"
else
  echo "FAIL no Playwright found exits non-zero naming PLAYWRIGHT_ROOT and ORBIT_DIR (exit $rc, want non-zero, not a timeout, with both names in the message)"
  show; failed=1
fi

exit "$failed"
