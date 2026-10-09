#!/bin/sh
# Test for tools/ci/lint.sh, section "nothing stray at the root": it judges
# what git tracks, not what is on disk (issue #5); and section "Renovate
# watches where the npm pins live": a pin in a file renovate.json does not
# watch fails and names that file.
#
#   sh tools/ci/lint-test.sh        run from anywhere inside the repository
#
# Works on a scratch copy of the current commit, so the checkout is untouched.
set -eu

root=$(git rev-parse --show-toplevel)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

git -C "$root" archive HEAD | tar -x -C "$tmp"
cd "$tmp"
git init -q
git add -A
git -c user.name=t -c user.email=t@t commit -q -m base

failed=0

# Case 1: present on disk but untracked -> the section passes.
mkdir -p .agents node_modules
echo x > .agents/x
echo x > node_modules/x
out=$(mktemp)
rc=0
sh tools/ci/lint.sh > "$out" 2>&1 || rc=$?
if [ "$rc" -eq 0 ] && ! grep -q "must not be committed" "$out"; then
  echo "ok   untracked .agents and node_modules pass"
else
  echo "FAIL untracked .agents and node_modules pass (exit $rc)"
  sed 's/^/     /' "$out"
  failed=1
fi

# Case 2: tracked package.json -> the section fails and names it.
echo '{}' > package.json
git add -f package.json
git -c user.name=t -c user.email=t@t commit -q -m "add package.json"
rc=0
sh tools/ci/lint.sh > "$out" 2>&1 || rc=$?
if [ "$rc" -ne 0 ] && grep -q "package.json must not be committed" "$out"; then
  echo "ok   tracked package.json fails"
else
  echo "FAIL tracked package.json fails (exit $rc)"
  sed 's/^/     /' "$out"
  failed=1
fi
# Case 3: the marked/sharp pin moved to a file renovate.json does not watch
# (tools/ci/pins.sh) -> the section fails and names it.
git rm -q package.json
pin=$(grep 'npm i .*marked' tools/ci/nightly-import.sh)
grep -v 'npm i .*marked' tools/ci/nightly-import.sh > nightly.tmp
mv nightly.tmp tools/ci/nightly-import.sh
printf '%s\n' "$pin" > tools/ci/pins.sh
git add -A
git -c user.name=t -c user.email=t@t commit -q -m "move the npm pins"
rc=0
sh tools/ci/lint.sh > "$out" 2>&1 || rc=$?
if [ "$rc" -eq 1 ] && grep -q "tools/ci/pins.sh pins marked/sharp" "$out"; then
  echo "ok   an npm pin renovate.json does not watch fails"
else
  echo "FAIL an npm pin renovate.json does not watch fails (exit $rc)"
  sed 's/^/     /' "$out"
  failed=1
fi
rm -f "$out"

exit "$failed"
