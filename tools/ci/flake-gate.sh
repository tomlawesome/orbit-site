#!/bin/sh
# The flake rule's CI gate (#106): docs/flakes.md read by flake-check.sh, the
# copy of agent-infra's shared check. A flake at three sightings needs an
# issue and a quarantine.
#
# The quarantine list comes from the code that really takes a test out of the
# gate, never from a second list kept by hand: every call in tools/ci/*.mjs
# (journey.mjs, docs-planet-test.mjs) written as a line of its own that starts,
# after any indent, `await quarantined("#<issue>",` adds the line `[#<issue>]`,
# and the flake's heading links that issue as `[#<issue>](...)`.
#
# Only that form counts (SEC-12, #138), and the lint (test-map section) refuses
# every other `quarantined("#` in tools/ci/*.mjs: in a comment, a string, a
# template literal or after other code on its line. So this needs no parser;
# the job's image has sh, grep and sed only. The one form a line test cannot
# tell from a call, such a line inside a /* */ comment, is left out here too: a
# comment that starts its line runs to the line holding */.
set -eu
cd "$(dirname "$0")/../.."
list=$(mktemp)
trap 'rm -f "$list"' EXIT
for f in tools/ci/*.mjs; do
  sed -e '/^[[:space:]]*\/\*.*\*\//d' -e '/^[[:space:]]*\/\*/,/\*\//d' "$f"
done | grep -oE '^[[:space:]]*await quarantined\("#[0-9]+"' \
  | sed -E 's/^.*quarantined\("(#[0-9]+)"$/[\1]/' | sort -u > "$list"
sh tools/ci/flake-check.sh --quarantined "$list" docs/flakes.md
