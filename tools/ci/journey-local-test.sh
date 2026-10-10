#!/bin/sh
# Test for tools/ci/journey-local.sh (issue #19, "Runbooks become scripts"),
# written from the issue's specification alone: usage and exit 64, the
# Playwright lookup (PLAYWRIGHT_ROOT, else the highest version under
# ORBIT_DIR), the environment and the exact xvfb-run commands, exit 2 when
# Playwright or xvfb-run is missing, stop at the first failing run.
#
#   sh tools/ci/journey-local-test.sh        run from anywhere
#
# A stub xvfb-run stands first on PATH and logs its arguments, cwd and the
# environment it was given; no browser runs. The script is copied into a
# scratch git repository, so the checkout is untouched.
set -eu

root=$(git rev-parse --show-toplevel)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

stubdir=$tmp/stub
log=$stubdir/log
site=$tmp/site
orbit=$tmp/orbit
sc=$site/tools/ci/journey-local.sh
mkdir -p "$stubdir" "$tmp/elsewhere" "$tmp/empty"

# Stub: log one record per call, then exit with the Nth code of XVFB_EXITS
# (space separated; default 0).
cat > "$stubdir/xvfb-run" <<'STUB'
#!/bin/sh
d=$(dirname "$0")
n=$(cat "$d/count" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$d/count"
{
  echo CALL
  printf 'ARGS'; for a in "$@"; do printf '|%s' "$a"; done; echo
  echo "BROWSER=${BROWSER-<unset>}"
  echo "HEADED=${HEADED-<unset>}"
  echo "WEBGL=${WEBGL-<unset>}"
  echo "LIBGL_ALWAYS_SOFTWARE=${LIBGL_ALWAYS_SOFTWARE-<unset>}"
  echo "PLAYWRIGHT_ROOT=${PLAYWRIGHT_ROOT-<unset>}"
  echo "PWD=$(pwd -P)"
} >> "$d/log"
set -- $XVFB_EXITS
eval "code=\${$n:-0}"
exit "$code"
STUB
chmod +x "$stubdir/xvfb-run"

# A fake repository holding a copy of the script (absent while the script is).
mkrepo() {
  git init -q "$1"
  mkdir -p "$1/tools/ci"
  if [ -f "$root/tools/ci/journey-local.sh" ]; then
    cp "$root/tools/ci/journey-local.sh" "$1/tools/ci/journey-local.sh"
  fi
}
mkrepo "$site"
mkrepo "$tmp/work/site"

# Fake Playwright installs under an ORBIT_DIR-shaped directory.
pw() { mkdir -p "$1/node_modules/.pnpm/playwright@$2/node_modules/playwright"; }
pwpath() { echo "$1/node_modules/.pnpm/playwright@$2/node_modules/playwright"; }
pw "$orbit" 1.40.0
pw "$orbit" 1.52.0
pw "$orbit" 1.9.0
pw "$tmp/old" 1.9.0
pw "$tmp/old" 1.40.0
pw "$tmp/work/orbit" 1.20.0

# A PATH without xvfb-run: only the plain utilities a script may need.
nox=$tmp/nox
mkdir -p "$nox"
for u in sh git dirname basename sort head tail tr sed awk grep ls cat printf \
         find cut expr pwd readlink realpath uname env mkdir rm test '[' echo; do
  p=$(command -v "$u" 2>/dev/null || true)
  case "$p" in /*) ln -sf "$p" "$nox/$u" ;; esac
done
shpath=$(command -v sh)

jsh=1280x800x24
ush=1280x720x24
jargs="ARGS|-a|-s|-screen 0 $jsh|node|tools/ci/journey.mjs"
uargs="ARGS|-a|-s|-screen 0 $ush|node|tools/ci/upload-test.mjs"

failed=0
passed=0
why=""
out=$tmp/out
err=$tmp/err

# run [args...]: the script's settings come from the globals extra (env
# assignments), exits (XVFB_EXITS), cwd and path, reset afterwards. rc and
# the captured stdout/stderr land in $rc, $out and $err.
extra="ORBIT_DIR=$orbit"; exits=""; cwd=$tmp/elsewhere; path="$stubdir:$PATH"
run() {
  rm -f "$stubdir/count" "$log"
  rc=0
  # shellcheck disable=SC2086
  ( cd "$cwd" && env -u PLAYWRIGHT_ROOT -u BROWSER -u HEADED -u WEBGL \
      -u LIBGL_ALWAYS_SOFTWARE -u ORBIT_DIR \
      PATH="$path" XVFB_EXITS="$exits" $extra "$shpath" "$sc" "$@" ) \
    > "$out" 2> "$err" || rc=$?
  extra="ORBIT_DIR=$orbit"; exits=""; cwd=$tmp/elsewhere; path="$stubdir:$PATH"
  sc=$site/tools/ci/journey-local.sh
  # a missing script must never pass as a legitimate exit code
  [ -f "$root/tools/ci/journey-local.sh" ] || rc=255
}

want_rc() { [ "$rc" -eq "$1" ] || why="$why exit $rc (want $1);"; }
calls() { if [ -f "$log" ]; then grep -c '^CALL$' "$log" || true; else echo 0; fi; }
want_calls() { [ "$(calls)" -eq "$1" ] || why="$why $(calls) xvfb-run calls (want $1);"; }
want_args() { # expected ARGS lines, in order, one per argument
  got=$( { grep '^ARGS' "$log" 2>/dev/null || true; } )
  exp=$(printf '%s\n' "$@")
  [ "$got" = "$exp" ] || why="$why ARGS lines differ (got: $(echo "$got" | tr '\n' ' '));"
}
want_every() { # a log line present in every call (n calls)
  n=0
  if [ -f "$log" ]; then n=$(grep -cxF -- "$1" "$log" || true); fi
  [ "$n" -eq "$2" ] || why="$why '$1' in $n of $2 calls;"
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

# Case 1: no argument runs journey then upload, with the gate's commands.
run
want_rc 0; want_calls 2; want_args "$jargs" "$uargs"
verdict "no argument runs journey, then upload, with the gate's arguments"

# Case 2: journey runs only the journey.
run journey
want_rc 0; want_calls 1; want_args "$jargs"
verdict "journey runs only the journey"

# Case 3: upload runs only the upload test.
run upload
want_rc 0; want_calls 1; want_args "$uargs"
verdict "upload runs only the upload test"

# Case 4: an unknown argument -> usage on stderr, exit 64, nothing run.
run bogus
want_rc 64; want_calls 0
[ -s "$err" ] || why="$why no usage on stderr;"
[ ! -s "$out" ] || why="$why usage went to stdout;"
verdict "an unknown argument prints usage on stderr and exits 64"

# Case 5: two arguments -> exit 64, nothing run.
run journey upload
want_rc 64; want_calls 0
[ -s "$err" ] || why="$why no usage on stderr;"
verdict "two arguments exit 64"

# Case 6: the environment both runs get, with BROWSER defaulting to firefox.
run
want_every "BROWSER=firefox" 2; want_every "HEADED=1" 2
want_every "WEBGL=required" 2; want_every "LIBGL_ALWAYS_SOFTWARE=1" 2
verdict "both runs get BROWSER=firefox HEADED=1 WEBGL=required LIBGL_ALWAYS_SOFTWARE=1"

# Case 7: the caller's BROWSER wins.
extra="ORBIT_DIR=$orbit BROWSER=chromium"
run
want_every "BROWSER=chromium" 2; want_every "HEADED=1" 2
verdict "a caller's BROWSER overrides the firefox default"

# Case 8: PLAYWRIGHT_ROOT, when set, is used as it is.
mkdir -p "$tmp/custom"
extra="ORBIT_DIR=$orbit PLAYWRIGHT_ROOT=$tmp/custom"
run
want_rc 0; want_every "PLAYWRIGHT_ROOT=$tmp/custom" 2
verdict "PLAYWRIGHT_ROOT is honoured when set"

# Case 9: otherwise the highest version wins (1.52.0 over 1.40.0 and 1.9.0)
# and is exported as PLAYWRIGHT_ROOT.
run
want_rc 0; want_every "PLAYWRIGHT_ROOT=$(pwpath "$orbit" 1.52.0)" 2
verdict "the highest Playwright version is chosen and exported"

# Case 10: version order, not string order (1.40.0 over 1.9.0).
extra="ORBIT_DIR=$tmp/old"
run
want_rc 0; want_every "PLAYWRIGHT_ROOT=$(pwpath "$tmp/old" 1.40.0)" 2
verdict "1.40.0 beats 1.9.0 (version order, not string order)"

# Case 11: ORBIT_DIR defaults to the orbit directory beside the top level.
extra=""; sc=$tmp/work/site/tools/ci/journey-local.sh
run
want_rc 0; want_every "PLAYWRIGHT_ROOT=$(pwpath "$tmp/work/orbit" 1.20.0)" 2
verdict "ORBIT_DIR defaults to the orbit directory beside the repository"

# Case 12: no Playwright anywhere -> exit 2 naming the variables, no run.
extra="ORBIT_DIR=$tmp/empty"
run
want_rc 2; want_calls 0
cat "$out" "$err" | grep -Eq 'PLAYWRIGHT_ROOT|ORBIT_DIR' || why="$why message names neither variable;"
verdict "no Playwright found exits 2 saying to set PLAYWRIGHT_ROOT or ORBIT_DIR"

# Case 13: xvfb-run not on PATH -> exit 2 saying so.
path=$nox
run
want_rc 2
cat "$out" "$err" | grep -q 'xvfb-run' || why="$why message does not name xvfb-run;"
verdict "xvfb-run missing from PATH exits 2 saying so"

# Case 14: the first run fails -> its status, and the upload run is skipped.
exits="3 0"
run
want_rc 3; want_calls 1; want_args "$jargs"
verdict "a failing journey exits 3 and the upload run is not started"

# Case 15: the second run fails -> its status.
exits="0 5"
run
want_rc 5; want_calls 2
verdict "a failing upload run exits with its status"

# Case 16: runs from the repository's top level, whatever the current directory.
want=$(cd "$site" && pwd -P)
mkdir -p "$site/tools/ci/deep"
cwd=$site/tools/ci/deep
run journey
want_rc 0; want_every "PWD=$want" 1
verdict "runs from the top level when started in a subdirectory"
run journey
want_rc 0; want_every "PWD=$want" 1
verdict "runs from the top level when started outside the repository"

echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
