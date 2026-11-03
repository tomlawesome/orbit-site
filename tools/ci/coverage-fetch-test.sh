#!/bin/sh
# Test for tools/ci/coverage-fetch.sh, written from ADR-0005 section 6a (#95,
# batch 3) alone, before the script exists. For each JOB_ID it runs
#   ${GLAB:-glab} api projects/ai%2Forbit-site/jobs/<id>/artifacts
# to a temporary zip and unpacks it into coverage/ci-<id>/ (emptied first);
# the archive must hold coverage/node/ and a coverage/selection.json saying
# all true, else it fails naming the id and `not a full run` / `no node
# coverage`. It prints the folders made, then the --raise command to run on
# them. No argument: exit 64 with the usage. Never a token argument.
#
#   sh tools/ci/coverage-fetch-test.sh        run from anywhere
#
# A stub glab (named by GLAB) logs its arguments and the GLAB_CONFIG_DIR it
# was given, and writes to stdout the zip prepared for the id in its path.
# The script is copied into a scratch directory, so the checkout is untouched.
set -eu

root=$(cd "$(dirname "$0")/../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

site=$tmp/site
stub=$tmp/stub/glab
log=$tmp/stub/log
zips=$tmp/zips
mkdir -p "$site/tools/ci" "$tmp/stub" "$zips"
git init -q "$site"
if [ -f "$root/tools/ci/coverage-fetch.sh" ]; then
  cp "$root/tools/ci/coverage-fetch.sh" "$site/tools/ci/coverage-fetch.sh"
fi

cat > "$stub" <<'STUB'
#!/bin/sh
{
  printf 'ARGS'; for a in "$@"; do printf '|%s' "$a"; done; echo
  echo "GLAB_CONFIG_DIR=${GLAB_CONFIG_DIR-<unset>}"
} >> "$FAKE_LOG"
for a in "$@"; do
  case $a in
    */jobs/*/artifacts)
      id=${a%/artifacts}; id=${id##*/}
      if [ -f "$FAKE_ZIPS/$id.zip" ]; then cat "$FAKE_ZIPS/$id.zip"; exit 0; fi
      echo "404 Not Found" >&2; exit 1 ;;
  esac
done
echo "stub glab: no artifacts path in: $*" >&2
exit 1
STUB
chmod +x "$stub"

# mkzip ID ALL NODE: a coverage job's archive for ID; ALL is the selection's
# `all` (or "none" for no selection.json), NODE is yes or no.
mkzip() {
  d=$tmp/build-$1
  rm -rf "$d"; mkdir -p "$d/coverage"
  if [ "$3" = yes ]; then
    mkdir -p "$d/coverage/node"
    echo '{"result":[]}' > "$d/coverage/node/coverage-$1.json"
  fi
  echo '{"scripts":{}}' > "$d/coverage/browser-journey-1-$1.json"
  if [ "$2" != none ]; then
    printf '{"all": %s, "tests": ["journey"], "changed": []}\n' "$2" > "$d/coverage/selection.json"
  fi
  rm -f "$zips/$1.zip"
  if command -v zip >/dev/null 2>&1; then
    ( cd "$d" && zip -qr "$zips/$1.zip" coverage )
  else
    ( cd "$d" && python3 -m zipfile -c "$zips/$1.zip" coverage )
  fi
}
mkzip 101 true yes
mkzip 102 true yes
mkzip 103 false yes
mkzip 104 true no

failed=0
passed=0
why=""
out=$tmp/out
err=$tmp/err

run() {
  rm -f "$log"
  rc=0
  ( cd "$site" && env GLAB="$stub" FAKE_LOG="$log" FAKE_ZIPS="$zips" \
      GLAB_CONFIG_DIR="$tmp/glab-config" sh tools/ci/coverage-fetch.sh "$@" ) \
    > "$out" 2> "$err" || rc=$?
  # a missing script must never pass as a legitimate exit code
  [ -f "$root/tools/ci/coverage-fetch.sh" ] || rc=255
}
said() { cat "$out" "$err"; }
want_rc() { [ "$rc" -eq "$1" ] || why="$why exit $rc (want $1);"; }
want_fail() { [ "$rc" -ne 0 ] && [ "$rc" -ne 255 ] || why="$why exit $rc (want a failure);"; }
want_said() { said | grep -qF -- "$1" || why="$why output does not say '$1';"; }
want_file() { [ -f "$site/$1" ] || why="$why no $1;"; }
want_args() { # expected ARGS lines, in order
  got=$( { grep '^ARGS' "$log" 2>/dev/null || true; } )
  exp=$(printf '%s\n' "$@")
  [ "$got" = "$exp" ] || why="$why stub called with: $(echo "$got" | tr '\n' ' ');"
}
verdict() {
  if [ -z "$why" ]; then
    echo "ok   $1"; passed=$((passed + 1))
  else
    echo "FAIL $1 ($why )"
    sed 's/^/     out: /' "$out"; sed 's/^/     err: /' "$err"
    failed=$((failed + 1))
  fi
  why=""
}

# Case 1: two full runs fetched into coverage/ci-101/ and coverage/ci-102/.
mkdir -p "$site/coverage/ci-101"
echo stale > "$site/coverage/ci-101/stale.txt"
run 101 102
want_rc 0
want_args "ARGS|api|projects/ai%2Forbit-site/jobs/101/artifacts" "ARGS|api|projects/ai%2Forbit-site/jobs/102/artifacts"
verdict "the stub is called with api projects/ai%2Forbit-site/jobs/<id>/artifacts, once per id, in order, and the run exits 0"

want_file coverage/ci-101/node/coverage-101.json; want_file coverage/ci-101/selection.json
want_file coverage/ci-102/node/coverage-102.json; want_file coverage/ci-102/selection.json
want_file coverage/ci-101/browser-journey-1-101.json
verdict "each archive's coverage/ is unpacked into coverage/ci-<id>/: node/, selection.json and the browser records"

[ ! -e "$site/coverage/ci-101/stale.txt" ] || why="$why coverage/ci-101/stale.txt is still there;"
[ ! -e "$site/coverage/ci-101/coverage" ] || why="$why coverage/ci-101/coverage/ exists (the archive's coverage/ was not stripped);"
verdict "an existing coverage/ci-101/ is emptied first"

said | grep -F -- 'coverage/ci-101' | grep -vq -- '--raise' || why="$why no line names the folder coverage/ci-101;"
said | grep -F -- 'coverage/ci-102' | grep -vq -- '--raise' || why="$why no line names the folder coverage/ci-102;"
verdict "it prints the folders made"

said | grep -F -- 'node tools/ci/coverage.mjs --raise' | grep -F -- 'coverage/ci-101' | grep -qF -- 'coverage/ci-102' \
  || why="$why no 'node tools/ci/coverage.mjs --raise' line naming both folders;"
verdict "it prints the --raise command naming both folders"

grep -qx "GLAB_CONFIG_DIR=$tmp/glab-config" "$log" 2>/dev/null || why="$why the stub did not get GLAB_CONFIG_DIR as the environment had it;"
if grep '^ARGS' "$log" 2>/dev/null | grep -qi -e 'PRIVATE-TOKEN' -e 'token'; then why="$why a token-like argument reached the stub;"; fi
verdict "the agent's own GLAB_CONFIG_DIR is used as it is, and no token argument is passed"

# Case 2: a partial run's archive is refused, naming the id.
run 103
want_fail; want_said 103; want_said "not a full run"
verdict "an archive whose selection says all false fails naming the id and 'not a full run'"

# Case 3: an archive without coverage/node/ is refused, naming the id.
run 104
want_fail; want_said 104; want_said "no node coverage"
verdict "an archive without coverage/node/ fails naming the id and 'no node coverage'"

# Case 4: a good id beside a partial one still fails, naming the bad one.
run 101 103
want_fail; want_said 103; want_said "not a full run"
verdict "a full run beside a partial one: the fetch fails naming the partial one"

# Case 5: no argument -> usage, exit 64, nothing fetched.
run
want_rc 64
said | grep -qi usage || why="$why no usage printed;"
[ ! -f "$log" ] || why="$why the stub was called;"
verdict "no argument exits 64 with the usage and calls nothing"

echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
