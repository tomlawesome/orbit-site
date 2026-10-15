#!/bin/sh
# Line coverage of the site's JavaScript, measured and held to its floors (#14).
# Chromium records which JavaScript ran (V8 coverage); Firefox cannot, so these
# are second runs of tests the gate already runs in Firefox. The tests gate the
# merge there; here a Chromium run that fails is reported and its coverage still
# counted, and what gates is tools/ci/coverage.mjs: no file below its floor.
#
#   sh tools/ci/coverage-run.sh           by hand: the Node tests, the Chromium runs, the check
#   sh tools/ci/coverage-run.sh browser   the gate's: the Chromium runs and the check (the lint job's Node
#                                         coverage is already in $COVERAGE_DIR/node)
#   sh tools/ci/coverage-run.sh check     only the check, on what is in $COVERAGE_DIR
#
# COVERAGE_DIR defaults to ./coverage (ignored by git). Playwright is found as
# journey-local.sh finds it. `node tools/ci/coverage.mjs --raise $COVERAGE_DIR`
# raises the floors to what was measured.
set -eu

case "${1-all}" in all|browser|check) mode=${1-all} ;; *) echo "usage: sh tools/ci/coverage-run.sh [browser|check]" >&2; exit 64 ;; esac

root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"
COVERAGE_DIR=${COVERAGE_DIR:-coverage}
case $COVERAGE_DIR in /*) ;; *) COVERAGE_DIR=$root/$COVERAGE_DIR ;; esac
export COVERAGE_DIR

if [ "$mode" = all ]; then
  rm -rf "$COVERAGE_DIR"
  sh tools/ci/node-tests.sh
fi

if [ "$mode" != check ]; then
  if [ -z "${PLAYWRIGHT_ROOT-}" ]; then
    orbit=${ORBIT_DIR:-$(dirname "$root")/orbit}
    PLAYWRIGHT_ROOT=$(ls -d "$orbit"/node_modules/.pnpm/playwright@*/node_modules/playwright 2>/dev/null |
      sort -V | tail -n 1)
    if [ -z "$PLAYWRIGHT_ROOT" ]; then
      echo "coverage-run: no playwright found under $orbit; set PLAYWRIGHT_ROOT or ORBIT_DIR" >&2
      exit 2
    fi
  fi
  if ! command -v xvfb-run >/dev/null 2>&1; then
    echo "coverage-run: xvfb-run is not on PATH" >&2
    exit 2
  fi
  BROWSER=chromium
  HEADED=1
  WEBGL=required
  LIBGL_ALWAYS_SOFTWARE=1
  ENGINES=chromium
  export PLAYWRIGHT_ROOT BROWSER HEADED WEBGL LIBGL_ALWAYS_SOFTWARE ENGINES

  # dawn and asdawn are left out: 100 s each for 6 and 23 lines more, and asdawn's 390x844 control does not pass
  # in Chromium (it is Firefox's). journey, upload, pin and freeze are the ones that run the site's code.
  failed=
  for run in journey upload pin freeze; do
    case $run in
      journey) test=tools/ci/journey.mjs; screen=1280x800x24 ;;
      upload) test=tools/ci/upload-test.mjs; screen=1280x720x24 ;;
      pin) test=tools/ci/pin-test.mjs; screen=1280x800x24 ;;
      freeze) test=tools/ci/freeze.mjs; screen=1280x800x24 ;;
    esac
    echo "== $run, in Chromium, recording coverage"
    xvfb-run -a -s "-screen 0 $screen" node --import ./tools/ci/coverage-hook.mjs "$test" || failed="$failed $run"
  done
  if [ -n "$failed" ]; then
    echo "coverage-run: failed in Chromium:$failed (the Firefox runs are what gate these; their coverage is still counted)"
  fi
fi

echo "== coverage"
node tools/ci/coverage.mjs "$COVERAGE_DIR"
