#!/bin/sh
# Test for tools/ci/coverage-run.sh, written from ADR-0005 section 6a (#95,
# batch 3) alone, before the script changes. No argument is the full local
# run: node-tests.sh with Node coverage into $COVERAGE_DIR/node, then
# `node tools/ci/live-run.mjs chromium --all` with COVERAGE_DIR, then the
# check (coverage.mjs) as a full run; `check` runs only the check; `browser`
# is gone: exit 64 with the usage.
#
#   sh tools/ci/coverage-run-test.sh        run from anywhere
#
# A stub node stands first on PATH and logs each call's arguments with the
# COVERAGE_DIR and NODE_V8_COVERAGE it was given, then exits 0: no test, no
# browser and no check really runs. A stub xvfb-run drops its own options and
# runs the rest. The scripts are copied into a scratch directory, so the
# checkout is untouched.
set -eu

root=$(cd "$(dirname "$0")/../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

site=$tmp/site
bin=$tmp/bin
log=$tmp/log
cov=$tmp/cov
mkdir -p "$site/tools/ci" "$bin" "$tmp/pw"
git init -q "$site"
for f in coverage-run.sh node-tests.sh; do
  cp "$root/tools/ci/$f" "$site/tools/ci/$f"
done

cat > "$bin/node" <<'STUB'
#!/bin/sh
{
  printf 'ARGS'; for a in "$@"; do printf '|%s' "$a"; done
  printf ' ## COVERAGE_DIR=%s ## NODE_V8_COVERAGE=%s\n' "${COVERAGE_DIR-<unset>}" "${NODE_V8_COVERAGE-<unset>}"
} >> "$FAKE_LOG"
exit 0
STUB
cat > "$bin/xvfb-run" <<'STUB'
#!/bin/sh
while [ $# -gt 0 ]; do
  case $1 in
    -a|--auto-servernum) shift ;;
    -s|-n|-e|-f|-p|-w|--server-args|--server-num|--error-file|--auth-file|--xauth-protocol|--wait) shift 2 ;;
    -*=*|--*) shift ;;
    *) break ;;
  esac
done
exec "$@"
STUB
chmod +x "$bin/node" "$bin/xvfb-run"

failed=0
passed=0
why=""
out=$tmp/out
err=$tmp/err

run() {
  rm -f "$log"
  rc=0
  ( cd "$site" && env -u NODE_V8_COVERAGE PATH="$bin:$PATH" FAKE_LOG="$log" COVERAGE_DIR="$cov" \
      PLAYWRIGHT_ROOT="$tmp/pw" sh tools/ci/coverage-run.sh "$@" ) > "$out" 2> "$err" || rc=$?
}
calls() { { grep '^ARGS' "$log" 2>/dev/null || true; }; }
# the line number of the first call whose ARGS match the pattern (grep -E), or 0
nth() { n=$(calls | grep -nE -- "$1" | head -n 1 | cut -d: -f1); echo "${n:-0}"; }
want_rc() { [ "$rc" -eq "$1" ] || why="$why exit $rc (want $1);"; }
verdict() {
  if [ -z "$why" ]; then
    echo "ok   $1"; passed=$((passed + 1))
  else
    echo "FAIL $1 ($why )"
    sed 's/^/     out: /' "$out" | tail -n 5; sed 's/^/     err: /' "$err" | tail -n 5
    calls | sed 's/^/     node: /' | tail -n 5
    failed=$((failed + 1))
  fi
  why=""
}

# Case 1: browser is gone: usage, exit 64, nothing run.
run browser
want_rc 64
grep -qi usage "$err" || why="$why no usage on stderr;"
[ -z "$(calls)" ] || why="$why node was called;"
verdict "coverage-run.sh browser exits 64 with the usage and runs nothing"

# Case 2: no argument: Node tests with Node coverage, then live-run.mjs chromium --all, then the check.
run
want_rc 0
live='^ARGS(\|[^|]*)*\|(\./)?tools/ci/live-run\.mjs\|'
lr=$(calls | grep -cE -- "$live" || true)
[ "$lr" -eq 1 ] || why="$why $lr live-run.mjs calls (want 1);"
calls | grep -E -- "$live" | grep -qE -- '\|(\./)?tools/ci/live-run\.mjs\|chromium\|--all ## ' \
  || why="$why live-run.mjs not called with exactly chromium --all;"
calls | grep -E -- "$live" | grep -qF -- "## COVERAGE_DIR=$cov ##" || why="$why live-run.mjs not given COVERAGE_DIR=$cov;"
verdict "no argument runs node tools/ci/live-run.mjs chromium --all once, with COVERAGE_DIR"

at_live=$(nth "$live")
at_test=$(nth '\|(\./)?tools/ci/[^|]*-test\.mjs( ##|\|)')
calls | grep -E -- '\|(\./)?tools/ci/[^|]*-test\.mjs( ##|\|)' | grep -qF -- "NODE_V8_COVERAGE=$cov/node" \
  || why="$why no Node test ran with NODE_V8_COVERAGE=$cov/node;"
[ "$at_test" -gt 0 ] && [ "$at_live" -gt 0 ] && [ "$at_test" -lt "$at_live" ] \
  || why="$why the Node tests (call $at_test) did not run before live-run.mjs (call $at_live);"
verdict "no argument first runs the Node tests with Node coverage into \$COVERAGE_DIR/node"

at_check=$(nth '\|(\./)?tools/ci/coverage\.mjs(\||$| ##)')
total=$(calls | wc -l | tr -d ' ')
[ "$at_check" -gt "$at_live" ] && [ "$at_live" -gt 0 ] || why="$why coverage.mjs (call $at_check) did not run after live-run.mjs (call $at_live);"
[ "$at_check" -eq "$total" ] || why="$why coverage.mjs is call $at_check of $total, not the last;"
calls | sed -n "${at_check}p" | grep -qF -- "|$cov" || why="$why coverage.mjs not given $cov;"
verdict "no argument then runs the check, coverage.mjs on \$COVERAGE_DIR, last"

# Case 3: check runs only coverage.mjs.
mkdir -p "$cov/node"
run check
want_rc 0
n=$(calls | wc -l | tr -d ' ')
[ "$n" -eq 1 ] || why="$why $n node calls (want 1);"
calls | grep -qE -- '\|(\./)?tools/ci/coverage\.mjs\|' || why="$why the call is not coverage.mjs;"
verdict "check runs coverage.mjs and nothing else"

echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
