#!/bin/sh
# Test for tools/ci/nightly-import.sh: the docs import installs its two npm
# packages from the lockfile (npm ci, scripts off, in tools/) and runs the
# install and the import with the project access token withheld, so no
# package's code can read it. The token is only needed to push, later.
#
#   sh tools/ci/nightly-import-test.sh      run from anywhere inside the repository
#
# Runs on a scratch copy of the current commit, so the checkout is untouched.
# npm and node are shims first on PATH that log what they were called with and
# whether the token was in their environment; nothing touches the network.
set -eu

root=$(git rev-parse --show-toplevel)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

git -C "$root" archive HEAD | tar -x -C "$tmp"
cd "$tmp"
git init -q
git add -A
git -c user.name=t -c user.email=t@t commit -q -m base

fake=not-a-real-token-test-only
mkdir bin scratch-tmp
log="$tmp/shim.log"       # outside scratch-tmp: it records the token's state
hits="$tmp/token-hits"    # files under scratch-tmp that held the token
: > "$log"
: > "$hits"

cat > bin/npm <<'SHIM'
#!/bin/sh
echo "npm ${ORBIT_SITE_IMPORT_TOKEN+SET}${ORBIT_SITE_IMPORT_TOKEN-UNSET} $*" >> "$LOG"
exit 0
SHIM
cat > bin/node <<'SHIM'
#!/bin/sh
echo "node ${ORBIT_SITE_IMPORT_TOKEN+SET}${ORBIT_SITE_IMPORT_TOKEN-UNSET} $*" >> "$LOG"
grep -rl not-a-real-token-test-only "$TMPDIR" >> "$HITS" 2>/dev/null || true
exit 0
SHIM
# A stray network call fails loudly instead of leaving the machine.
cat > bin/curl <<'SHIM'
#!/bin/sh
echo "curl called: $*" >&2
exit 22
SHIM
chmod +x bin/npm bin/node bin/curl

failed=0
check() { # check <description> <condition: 0 = held>
  if [ "$2" -eq 0 ]; then
    echo "ok   $1"
  else
    echo "FAIL $1"
    failed=1
  fi
}
run_import() { # run_import <outfile> <token value, or "-" for unset>
  outfile=$1
  if [ "$2" = "-" ]; then tokarg="-u ORBIT_SITE_IMPORT_TOKEN"; else tokarg="ORBIT_SITE_IMPORT_TOKEN=$2"; fi
  rc=0
  # shellcheck disable=SC2086 # tokarg is two words on purpose
  env $tokarg PATH="$tmp/bin:$PATH" LOG="$log" HITS="$hits" TMPDIR="$tmp/scratch-tmp" \
    DRY_RUN=1 CI_API_V4_URL=https://gitlab.invalid/api/v4 CI_PROJECT_ID=1 \
    CI_SERVER_HOST=gitlab.invalid CI_PROJECT_PATH=ai/orbit-site \
    sh tools/ci/nightly-import.sh > "$outfile" 2>&1 || rc=$?
}

# Run 1: token set, nothing new to import.
out=$(mktemp)
run_import "$out" "$fake"
rc1=$rc
npm_lines=$(grep '^npm ' "$log" || true)
node_lines=$(grep '^node ' "$log" || true)
npm_n=$(printf '%s' "$npm_lines" | grep -c '^npm ' || true)
node_n=$(printf '%s' "$node_lines" | grep -c '^node ' || true)

rc=0; [ "$rc1" -eq 0 ] && grep -q "nothing new" "$out" || rc=1
check "a dry run with nothing new exits 0 and says so (exit $rc1)" "$rc"
[ "$rc" -eq 0 ] || sed 's/^/     /' "$out"

rc=0; [ ! -s "$hits" ] || rc=1
check "no file under TMPDIR held the token when node ran" "$rc"
[ "$rc" -eq 0 ] || sed 's/^/     held it: /' "$hits"

rc=0; [ "$npm_n" -eq 1 ] || rc=1
check "npm was run exactly once (saw $npm_n)" "$rc"
rc=0; [ "$node_n" -eq 1 ] || rc=1
check "node was run exactly once (saw $node_n)" "$rc"

rc=0; printf '%s\n' "$npm_lines" | grep -q '^npm UNSET ' || rc=1
check "the install runs with the token withheld" "$rc"
[ "$rc" -eq 0 ] || echo "     npm line: $(printf '%s' "$npm_lines" | sed 's/not-a-real-token-test-only/<token>/')"
rc=0; printf '%s\n' "$node_lines" | grep -q '^node UNSET ' || rc=1
check "the import runs with the token withheld" "$rc"
[ "$rc" -eq 0 ] || echo "     node line: $(printf '%s' "$node_lines" | sed 's/not-a-real-token-test-only/<token>/')"

rc=0; printf '%s\n' "$npm_lines" | grep -q ' ci ' || rc=1
check "the install is npm ci (from the lockfile)" "$rc"
rc=0; printf '%s\n' "$npm_lines" | grep -q -e '--ignore-scripts' || rc=1
check "the install runs with --ignore-scripts" "$rc"
rc=0; printf '%s\n' "$npm_lines" | grep -q -e '--prefix tools' || rc=1
check "the install goes into tools/ (--prefix tools)" "$rc"
rc=0; ! printf '%s\n' "$npm_lines" | grep -q -e 'marked@' -e 'sharp@' || rc=1
check "the install names no package version (they live in tools/package.json)" "$rc"

rc=0; printf '%s\n' "$node_lines" | grep -q 'tools/import-docs\.mjs$' || rc=1
check "the import is node tools/import-docs.mjs" "$rc"

# Run 2: no token -> the script still refuses before it can push.
: > "$log"
run_import "$out" -
rc2=$rc
rc=0; [ "$rc2" -ne 0 ] && grep -q "ORBIT_SITE_IMPORT_TOKEN is not set" "$out" || rc=1
check "without the token the script fails and says ORBIT_SITE_IMPORT_TOKEN is not set (exit $rc2)" "$rc"
[ "$rc" -eq 0 ] || sed 's/^/     /' "$out"

rm -f "$out"
exit "$failed"
