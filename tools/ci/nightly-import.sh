#!/bin/sh
# The nightly docs import, first half: fetch Orbit's markdown and set it as
# the site's pages in assets/docs/. This is the half that runs other people's
# code (the npm packages marked and sharp, which `node tools/import-docs.mjs`
# loads), so it holds no secret and can do nothing with one: it makes no git
# push and no API call, and nothing in this file names a credential. The
# `import_docs` job hands assets/docs/ on as an artifact, with the import's
# warnings, import-warnings.txt (#82); the second half,
# tools/ci/nightly-publish.sh in the `publish_docs` job, treats that artifact
# as untrusted, checks it, and does the pushing (#18). Two scripts, not one
# with a mode, so this file can be read, and linted, as token-free.
#
#   DRY_RUN=1 sh tools/ci/nightly-import.sh   import in a scratch copy of HEAD
#                                             and report; the checkout is untouched
#
# The install runs from the lockfile, hashes checked, with install scripts off.
set -eu
cd "$(dirname "$0")/../.."

DRY_RUN=${DRY_RUN:-}

# The whole flow is one function, called on the last line: the shell has read
# the entire file before the import runs, so the import cannot change what the
# rest of this script does by rewriting it.
main() {
  here=$PWD
  if [ -n "$DRY_RUN" ]; then
    scratch=$(mktemp -d); trap 'rm -rf "$scratch"' EXIT
    git archive HEAD | tar -x -C "$scratch"
    cd "$scratch"
    echo "DRY_RUN: importing in a scratch copy of HEAD"
  fi
  [ -d tools/node_modules/marked ] || npm ci --prefix tools --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null
  # the import writes its warnings at the checkout root, always (empty when
  # there are none); the publish job requires the file, so a missing one stops
  # the job here, and none left from before can stand in for it
  rm -f import-warnings.txt
  node tools/import-docs.mjs
  n=$(find assets/docs -type f -name '*.json' | wc -l)
  [ "$n" -gt 0 ] || { echo "the import wrote no pages"; exit 1; }
  echo "assets/docs: $n files"
  [ -f import-warnings.txt ] && [ ! -L import-warnings.txt ] || { echo "the import wrote no import-warnings.txt"; exit 1; }
  echo "import-warnings.txt: $(wc -l < import-warnings.txt) lines"
  if [ -n "$DRY_RUN" ]; then
    if diff -rq "$here/assets/docs" assets/docs >/dev/null 2>&1; then
      echo "DRY_RUN: nothing new; the checkout's assets/docs is what the import wrote"
    else
      echo "DRY_RUN: would hand on a changed assets/docs:"
      diff -rq "$here/assets/docs" assets/docs | sed 's/^/   /' | head -n 20 || true
    fi
  fi
}
main "$@"
