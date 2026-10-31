#!/bin/sh
# The Node tests of the site's own code, in the order the lint job runs them
# (the import's own tests are not here: they test tools/, not the site).
#
#   sh tools/ci/node-tests.sh
#
# With COVERAGE_DIR set, Node records which lines of the site ran in them, to
# $COVERAGE_DIR/node (V8's own coverage; tools/ci/coverage.mjs reads it) (#14).
set -eu
cd "$(dirname "$0")/../.."

if [ -n "${COVERAGE_DIR-}" ]; then
  case $COVERAGE_DIR in /*) ;; *) COVERAGE_DIR=$PWD/$COVERAGE_DIR ;; esac
  NODE_V8_COVERAGE=$COVERAGE_DIR/node
  export NODE_V8_COVERAGE
fi

for t in fetch-once dates sanitise-html comment-rules home-props goodbye-markup descent-homes \
  gpu-gate hurry dawn-destroyed-light dawn-let-go retire-after-destroy destroyed-world released-world \
  rich-remount sharp-strip-remount fit-skip door-context-restore door-wordmark release-tag door-shimmer \
  door-probe-chores door-world door-banded-upload door-sky door-rem star-cloud door-live-teardown fetch-once-limit flight-waits pin stale-prove door-live-release door-live-lost door-lows-glows door-lows-strip door-lows-probe-stored door-lows-compile-hidden door-lows-banded-fail upload-lost-and-offscreen draw-first-need draw-wire draw-pace chores-line chores-yield chores-docs-ready chores-frame draw-hello draw-rule draw-fallback draw-worker decode-route decode-wire local-server \
  site-world aniso-once site-home-date site-home site-tilt site-lock site-pads site-pads-sources world-page world-wire world-ring world-hello world-rule world-fallback world-worker world-govern docs-shape docs-sky-portrait site-data sw; do
  echo "== $t"
  node "tools/ci/$t-test.mjs"
done
