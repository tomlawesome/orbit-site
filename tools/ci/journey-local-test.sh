#!/bin/sh
# Test for tools/ci/journey-local.sh, rewritten from ADR-0005 section 3a
# (#95) alone, before the script changes: it now runs the gate's own runner,
# tools/ci/live-run.mjs, once, under one Xvfb. Kept from the first version
# (#19): the Playwright lookup (PLAYWRIGHT_ROOT, else the highest version
# under ORBIT_DIR, default the orbit checkout beside this one), exit 2 when
# Playwright or xvfb-run is missing, the run's status passed on, and the run
# from the repository's top level. New: no argument runs
#   xvfb-run -a -s "-screen 0 1280x800x24" node tools/ci/live-run.mjs firefox --changed --base dev
# with BROWSER, HEADED=1, WEBGL=required, LIBGL_ALWAYS_SOFTWARE=1 and
# PLAYWRIGHT_ROOT set; --browser chromium; --all and TEST names handed on in
# place of --changed --base dev; an unknown option exits 64 with the usage.
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

pre="ARGS|-a|-s|-screen 0 1280x800x24|node|tools/ci/live-run.mjs"

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

# Case 1: no argument runs live-run.mjs once, in Firefox, on the change since dev.
run
want_rc 0; want_calls 1; want_args "$pre|firefox|--changed|--base|dev"
verdict "no argument runs one xvfb-run of live-run.mjs firefox --changed --base dev"

# Case 2: the environment that run gets.
run
want_every "BROWSER=firefox" 1; want_every "HEADED=1" 1
want_every "WEBGL=required" 1; want_every "LIBGL_ALWAYS_SOFTWARE=1" 1
verdict "the run gets BROWSER=firefox HEADED=1 WEBGL=required LIBGL_ALWAYS_SOFTWARE=1"

# Case 3: --browser chromium puts chromium in the argument and in BROWSER.
run --browser chromium
want_rc 0; want_calls 1; want_args "$pre|chromium|--changed|--base|dev"
want_every "BROWSER=chromium" 1; want_every "HEADED=1" 1
verdict "--browser chromium runs live-run.mjs chromium with BROWSER=chromium"

# Case 4: --browser firefox, said outright, is the default.
run --browser firefox
want_rc 0; want_calls 1; want_args "$pre|firefox|--changed|--base|dev"
want_every "BROWSER=firefox" 1
verdict "--browser firefox is the same as no --browser"

# Case 5: --all is handed on in place of --changed --base dev.
run --all
want_rc 0; want_calls 1; want_args "$pre|firefox|--all"
verdict "--all is handed on in place of --changed --base dev"

# Case 6: --browser chromium --all.
run --browser chromium --all
want_rc 0; want_calls 1; want_args "$pre|chromium|--all"
want_every "BROWSER=chromium" 1
verdict "--browser chromium --all runs live-run.mjs chromium --all"

# Case 7: TEST names are handed on, in the order given.
run journey csp
want_rc 0; want_calls 1; want_args "$pre|firefox|journey|csp"
verdict "TEST names are handed on in place of --changed --base dev"

# Case 8: one TEST name, in Chromium.
run --browser chromium freeze
want_rc 0; want_calls 1; want_args "$pre|chromium|freeze"
want_every "BROWSER=chromium" 1
verdict "--browser chromium freeze runs live-run.mjs chromium freeze"

# Case 9: an unknown option -> usage on stderr, exit 64, nothing run.
run --bogus
want_rc 64; want_calls 0
[ -s "$err" ] || why="$why no usage on stderr;"
[ ! -s "$out" ] || why="$why usage went to stdout;"
verdict "an unknown option prints usage on stderr and exits 64, running nothing"

# Case 10: an unknown option after a good one -> exit 64, nothing run.
run --browser chromium --bogus
want_rc 64; want_calls 0
[ -s "$err" ] || why="$why no usage on stderr;"
verdict "an unknown option after --browser exits 64, running nothing"

# Case 11: PLAYWRIGHT_ROOT, when set, is used as it is.
mkdir -p "$tmp/custom"
extra="ORBIT_DIR=$orbit PLAYWRIGHT_ROOT=$tmp/custom"
run
want_rc 0; want_every "PLAYWRIGHT_ROOT=$tmp/custom" 1
verdict "PLAYWRIGHT_ROOT is honoured when set"

# Case 12: otherwise the highest version wins (1.52.0 over 1.40.0 and 1.9.0)
# and is exported as PLAYWRIGHT_ROOT.
run
want_rc 0; want_every "PLAYWRIGHT_ROOT=$(pwpath "$orbit" 1.52.0)" 1
verdict "the highest Playwright version is chosen and exported"

# Case 13: version order, not string order (1.40.0 over 1.9.0).
extra="ORBIT_DIR=$tmp/old"
run
want_rc 0; want_every "PLAYWRIGHT_ROOT=$(pwpath "$tmp/old" 1.40.0)" 1
verdict "1.40.0 beats 1.9.0 (version order, not string order)"

# Case 14: ORBIT_DIR defaults to the orbit directory beside the top level.
extra=""; sc=$tmp/work/site/tools/ci/journey-local.sh
run
want_rc 0; want_every "PLAYWRIGHT_ROOT=$(pwpath "$tmp/work/orbit" 1.20.0)" 1
verdict "ORBIT_DIR defaults to the orbit directory beside the repository"

# Case 15: no Playwright anywhere -> exit 2 naming the variables, no run.
extra="ORBIT_DIR=$tmp/empty"
run
want_rc 2; want_calls 0
cat "$out" "$err" | grep -Eq 'PLAYWRIGHT_ROOT|ORBIT_DIR' || why="$why message names neither variable;"
verdict "no Playwright found exits 2 saying to set PLAYWRIGHT_ROOT or ORBIT_DIR"

# Case 16: xvfb-run not on PATH -> exit 2 saying so.
path=$nox
run
want_rc 2
cat "$out" "$err" | grep -q 'xvfb-run' || why="$why message does not name xvfb-run;"
verdict "xvfb-run missing from PATH exits 2 saying so"

# Case 17: the run's status is the script's (live-run.mjs exits 1 when a gating test failed).
exits="1"
run
want_rc 1; want_calls 1
verdict "a failing run exits with its status (1)"
exits="2"
run --all
want_rc 2; want_calls 1
verdict "a failing run exits with its status (2)"

# Case 18: runs from the repository's top level, whatever the current
# directory (live-run.mjs is named relative to it).
want=$(cd "$site" && pwd -P)
mkdir -p "$site/tools/ci/deep"
cwd=$site/tools/ci/deep
run --all
want_rc 0; want_every "PWD=$want" 1
verdict "runs from the top level when started in a subdirectory"
run --all
want_rc 0; want_every "PWD=$want" 1
verdict "runs from the top level when started outside the repository"

echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
