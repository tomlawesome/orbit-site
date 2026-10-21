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
  door-probe-chores door-world door-banded-upload door-sky door-live-teardown local-server \
  site-world site-home-date site-home site-tilt site-lock site-pads site-pads-sources docs-shape docs-sky-portrait site-data sw; do
  echo "== $t"
  node "tools/ci/$t-test.mjs"
done
