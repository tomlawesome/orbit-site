#!/bin/sh
# The flake rule's CI gate (#106): docs/flakes.md read by flake-check.sh, the
# copy of agent-infra's shared check. A flake at three sightings needs an
# issue and a quarantine.
#
# The quarantine list comes from the code that really takes a test out of the
# gate, never from a second list kept by hand: every `quarantined("#<issue>",`
# call in tools/ci/*.mjs (journey.mjs, docs-planet-test.mjs) adds the line
# `[#<issue>]`, and the flake's heading links that issue as `[#<issue>](...)`.
set -eu
cd "$(dirname "$0")/../.."
list=$(mktemp)
trap 'rm -f "$list"' EXIT
grep -hoE 'quarantined\("#[0-9]+"' tools/ci/*.mjs \
  | sed -E 's/^quarantined\("(#[0-9]+)"$/[\1]/' | sort -u > "$list"
sh tools/ci/flake-check.sh --quarantined "$list" docs/flakes.md
