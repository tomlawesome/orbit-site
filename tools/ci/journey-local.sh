#!/bin/sh
# The gate's live check, run locally as the live:firefox and live:chromium
# jobs run it (#19, #95): tools/ci/live-run.mjs once, under one Xvfb, headed
# with software GL (the only way Firefox gets WebGL here), one site server
# and one browser for the whole run.
#
#   sh tools/ci/journey-local.sh [--browser firefox|chromium] [--all | --changed | TEST...]
#
# No argument is --changed against dev (the selection is printed first);
# --all is the gate's full run in that browser; TEST names are the map's
# (tools/ci/test-map.json). Firefox by default.
#
# Playwright comes from $PLAYWRIGHT_ROOT, or else the newest copy in Orbit's
# pnpm store ($ORBIT_DIR, default: the orbit checkout beside this one).
set -eu

usage() {
  echo "usage: sh tools/ci/journey-local.sh [--browser firefox|chromium] [--all | --changed | TEST...]" >&2
  exit 64
}

browser=firefox
if [ "${1-}" = --browser ]; then
  [ "$#" -ge 2 ] || usage
  case $2 in firefox|chromium) browser=$2 ;; *) usage ;; esac
  shift 2
fi
for a in "$@"; do
  case $a in --all|--changed) ;; -*) usage ;; esac
done
# --changed, said or not, is the change since dev
case "$*" in ''|--changed) set -- --changed --base dev ;; esac

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

BROWSER=$browser
HEADED=1
WEBGL=required
LIBGL_ALWAYS_SOFTWARE=1
export PLAYWRIGHT_ROOT BROWSER HEADED WEBGL LIBGL_ALWAYS_SOFTWARE

exec xvfb-run -a -s "-screen 0 1280x800x24" node tools/ci/live-run.mjs "$browser" "$@"
