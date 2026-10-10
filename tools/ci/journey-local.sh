#!/bin/sh
# The gate's live check, run locally exactly as `live:journey` runs it (#19):
# Firefox headed under Xvfb with software GL, the only way it gets WebGL here
# (headless it has none and never draws a world).
#
#   sh tools/ci/journey-local.sh [journey|upload]   # no argument: both
#
# Playwright comes from $PLAYWRIGHT_ROOT, or else the newest copy in Orbit's
# pnpm store ($ORBIT_DIR, default: the orbit checkout beside this one).
# BROWSER=chromium for a second engine.
set -eu

usage() {
  echo "usage: sh tools/ci/journey-local.sh [journey|upload]" >&2
  exit 64
}

[ "$#" -le 1 ] || usage
case "${1-all}" in
  all) runs="journey upload" ;;
  journey|upload) runs=$1 ;;
  *) usage ;;
esac

root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"

if [ -z "${PLAYWRIGHT_ROOT-}" ]; then
  orbit=${ORBIT_DIR:-$(dirname "$root")/orbit}
  PLAYWRIGHT_ROOT=$(ls -d "$orbit"/node_modules/.pnpm/playwright@*/node_modules/playwright 2>/dev/null |
    sort -V | tail -n 1)
  if [ -z "$PLAYWRIGHT_ROOT" ]; then
    echo "journey-local: no playwright found under $orbit; set PLAYWRIGHT_ROOT or ORBIT_DIR" >&2
    exit 2
  fi
fi

if ! command -v xvfb-run >/dev/null 2>&1; then
  echo "journey-local: xvfb-run is not on PATH" >&2
  exit 2
fi

BROWSER=${BROWSER:-firefox}
HEADED=1
WEBGL=required
LIBGL_ALWAYS_SOFTWARE=1
export PLAYWRIGHT_ROOT BROWSER HEADED WEBGL LIBGL_ALWAYS_SOFTWARE

for run in $runs; do
  case $run in
    journey) xvfb-run -a -s "-screen 0 1280x800x24" node tools/ci/journey.mjs ;;
    upload) xvfb-run -a -s "-screen 0 1280x720x24" node tools/ci/upload-test.mjs ;;
  esac
done
