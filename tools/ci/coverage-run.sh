#!/bin/sh
# Line coverage of the site's JavaScript, measured and held to its floors (#14).
# Node's V8 coverage of the Node tests, and Chromium's of every browser test
# (tools/ci/live-run.mjs loads tools/ci/coverage-hook.mjs on each when
# COVERAGE_DIR is set, as the live:chromium jobs do), checked by
# tools/ci/coverage.mjs: no file below its floor (#95, ADR-0005 section 6a).
#
#   sh tools/ci/coverage-run.sh         the full local run: the Node tests, every browser test in
#                                       Chromium (live-run.mjs chromium --all), then the check as a full run
#   sh tools/ci/coverage-run.sh check   only the check, on what is in $COVERAGE_DIR (which needs node/)
#
# COVERAGE_DIR defaults to ./coverage (ignored by git). Playwright is found as
# journey-local.sh finds it. Floors are raised from three full CI runs, never
# local ones: sh tools/ci/coverage-fetch.sh JOB JOB JOB, then the
# `node tools/ci/coverage.mjs --raise ...` it prints.
set -eu

usage() { echo "usage: sh tools/ci/coverage-run.sh [check]" >&2; exit 64; }
case $# in
  0) mode=all ;;
  1) [ "$1" = check ] || usage; mode=check ;;
  *) usage ;;
esac

root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"
COVERAGE_DIR=${COVERAGE_DIR:-coverage}
case $COVERAGE_DIR in /*) ;; *) COVERAGE_DIR=$root/$COVERAGE_DIR ;; esac
export COVERAGE_DIR

if [ "$mode" = all ]; then
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
  rm -rf "$COVERAGE_DIR"
  sh tools/ci/node-tests.sh
  # every browser test the gate runs in Chromium, headed under Xvfb with software GL as journey-local.sh runs
  # them; a test that fails is reported and what it reached is still counted
  export PLAYWRIGHT_ROOT
  echo "== every browser test, in Chromium, recording coverage"
  xvfb-run -a -s "-screen 0 1280x800x24" node tools/ci/live-run.mjs chromium --all ||
    echo "coverage-run: a browser test failed in Chromium (above); the coverage of a run that stopped early is incomplete, so a file below its floor may be that, not a lost line"
fi

if [ "$mode" = check ] && [ ! -d "$COVERAGE_DIR/node" ]; then
  echo "coverage-run: no Node coverage in $COVERAGE_DIR: run sh tools/ci/coverage-run.sh, or take the lint job's artifact (it lasts 24 hours)" >&2
  exit 2
fi

echo "== coverage"
exec node tools/ci/coverage.mjs "$COVERAGE_DIR"
