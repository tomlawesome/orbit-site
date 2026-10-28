#!/bin/sh
# Floors from CI, not local runs (#95, ADR-0005 sections 6 and 6a): fetches
# full runs' `coverage` job artifacts so `coverage.mjs --raise` can take the
# lowest of them.
#
#   sh tools/ci/coverage-fetch.sh JOB_ID...
#
# For each id: `glab api projects/ai%2Forbit-site/jobs/<id>/artifacts` to a
# temporary zip, unpacked (python3's zipfile, which drops absolute and `..`
# paths) and its coverage/ moved into coverage/ci-<id>/, emptied first. The
# archive must hold coverage/node/ and a coverage/selection.json saying `all`
# true, else the id fails with `no node coverage` or `not a full run`. Prints
# the folders made, then the --raise command to run on them.
#
# Read-only on GitLab. glab uses its own configuration (GLAB_CONFIG_DIR as the
# environment has it); no token is ever an argument. GLAB names the command
# (a test's stub). Exit 0 all fetched, 1 an id failed, 64 usage.
set -eu

usage() { echo "usage: sh tools/ci/coverage-fetch.sh JOB_ID... (the coverage jobs of three full runs)" >&2; exit 64; }
[ $# -gt 0 ] || usage
for id in "$@"; do
  case $id in '' | *[!0-9]*) echo "coverage-fetch: $id is not a job id" >&2; usage ;; esac
done

root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

made=
bad=0
for id in "$@"; do
  dest=coverage/ci-$id
  rm -rf "$dest"
  if ! "${GLAB:-glab}" api "projects/ai%2Forbit-site/jobs/$id/artifacts" > "$tmp/$id.zip"; then
    echo "coverage-fetch: job $id: its artifacts could not be downloaded" >&2
    bad=1; continue
  fi
  if ! python3 -m zipfile -e "$tmp/$id.zip" "$tmp/$id" >/dev/null 2>&1; then
    echo "coverage-fetch: job $id: its artifacts are not a zip archive" >&2
    bad=1; continue
  fi
  if [ ! -d "$tmp/$id/coverage/node" ]; then
    echo "coverage-fetch: job $id: no node coverage (coverage/node/ is missing: not a coverage job's artifact?)" >&2
    bad=1; continue
  fi
  if ! node -e 'const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.exit(s && s.all === true ? 0 : 1)' \
    "$tmp/$id/coverage/selection.json" 2>/dev/null; then
    echo "coverage-fetch: job $id: not a full run (coverage/selection.json does not say all true); floors come from full runs only" >&2
    bad=1; continue
  fi
  mkdir -p coverage
  mv "$tmp/$id/coverage" "$dest"
  echo "coverage-fetch: job $id -> $dest/"
  made="$made $dest"
done

if [ "$bad" -ne 0 ]; then
  echo "coverage-fetch: failed; raise from full runs only" >&2
  exit 1
fi
[ $# -ge 3 ] || echo "coverage-fetch: $# run(s) fetched; a floor needs three full runs"
echo "next: node tools/ci/coverage.mjs --raise$made"
