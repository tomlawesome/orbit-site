#!/bin/sh
# Tests the 'types' section of tools/ci/lint.sh and the typescript pin in 'npm-pins' (#30):
#   sh tools/ci/lint.sh types
#   sh tools/ci/lint.sh npm-pins
#
#   sh tools/ci/lint-types-test.sh   run from anywhere inside the repository
#
# Works on a scratch copy of the current commit, so the checkout is untouched.
set -eu

root=$(git rev-parse --show-toplevel)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

git -C "$root" archive HEAD | tar -x -C "$tmp"
# the lint finds TypeScript (and js-yaml) in tools/node_modules (#30, #52), which the archive leaves out
[ ! -d "$root/tools/node_modules" ] || export NODE_PATH="$root/tools/node_modules"
cd "$tmp"
git init -q
git add -A
git -c user.name=t -c user.email=t@t commit -q -m base

failed=0

pass() { printf 'ok   %s %s\n' "$1" "$2"; }
fail() { printf 'FAIL %s %s (%s)\n' "$1" "$2" "$3"; failed=1; }

# run_lint NAME ARGS...  runs the lint, leaving output in $tmp/NAME.out and the exit code in $rc
rc=0
run_lint() {
    name=$1
    shift
    rc=0
    sh tools/ci/lint.sh "$@" >"$tmp/$name.out" 2>&1 || rc=$?
}
# run_lint_bare NAME ARGS...  the same with NODE_PATH unset, so TypeScript cannot be found
run_lint_bare() {
    name=$1
    shift
    rc=0
    env -u NODE_PATH sh tools/ci/lint.sh "$@" >"$tmp/$name.out" 2>&1 || rc=$?
}
lastline() { tail -n 1 "$tmp/$1.out"; }
oneline() { tr '\n' '|' <"$tmp/$1.out" | cut -c1-300; }
hasheader() { grep -qxF '== the shared door type-checks strictly (assets/door, #30)' "$tmp/$1.out"; }
mentions() { grep -qF "$2" "$tmp/$1.out"; }
# restore: put the scratch tree back to the committed state
restore() {
    git checkout -q -- .
    git clean -fdq
}

probe_bad='/** @type {number} */ export const typesProbe = "x";'
probe_untyped='export function typesProbe(a) { return a; }'

# T1 the tree as committed
d="committed tree: 'types' exits 0, prints its header, last line 'lint: ok'"
run_lint t1 types
t1rc=$rc
if [ "$rc" -eq 0 ] && hasheader t1 && [ "$(lastline t1)" = "lint: ok" ]; then
    pass T1 "$d"
else
    fail T1 "$d" "exit=$rc header=$(hasheader t1 && echo yes || echo no) last='$(lastline t1)' output='$(oneline t1)'"
fi

# T2 a type error in the door folder
d="type error in assets/door/settings.js: exit 1, last line 'lint: failed', names the file"
printf '%s\n' "$probe_bad" >>assets/door/settings.js
run_lint t2 types
if [ "$rc" -eq 1 ] && [ "$(lastline t2)" = "lint: failed" ] && mentions t2 assets/door/settings.js; then
    pass T2 "$d"
else
    fail T2 "$d" "exit=$rc last='$(lastline t2)' output='$(oneline t2)'"
fi
restore

# T3 an untyped parameter: only strict mode objects
d="untyped parameter in assets/door/stars.js: exit 1, last line 'lint: failed', names the file (strict mode)"
printf '%s\n' "$probe_untyped" >>assets/door/stars.js
run_lint t3 types
if [ "$rc" -eq 1 ] && [ "$(lastline t3)" = "lint: failed" ] && mentions t3 assets/door/stars.js; then
    pass T3 "$d"
else
    fail T3 "$d" "exit=$rc last='$(lastline t3)' output='$(oneline t3)'"
fi
restore

# T4 the same faults outside the door folder are not its business
d="type errors in assets/js/types-probe.js: 'types' still exits 0 with last line 'lint: ok' (door folder only)"
{
    printf '%s\n' "$probe_bad"
    printf '%s\n' "$probe_untyped"
} >assets/js/types-probe.js
run_lint t4 types
if [ "$rc" -eq 0 ] && hasheader t4 && [ "$(lastline t4)" = "lint: ok" ]; then
    pass T4 "$d"
else
    fail T4 "$d" "exit=$rc header=$(hasheader t4 && echo yes || echo no) last='$(lastline t4)' output='$(oneline t4)'"
fi
restore

# T5 TypeScript unreachable: refuses, and says how to install it (paired with T1 so it is not failing for another reason)
d="TypeScript unreachable (no NODE_PATH, no tools/node_modules): exit 1, output has 'npm ci --prefix tools'; T1 passed with it"
run_lint_bare t5 types
if [ "$t1rc" -eq 0 ] && [ "$rc" -eq 1 ] && [ "$(lastline t5)" = "lint: failed" ] && mentions t5 'npm ci --prefix tools'; then
    pass T5 "$d"
else
    fail T5 "$d" "T1 exit=$t1rc; bare exit=$rc last='$(lastline t5)' output='$(oneline t5)'"
fi
restore

# T6 a range instead of an exact version (the pin is 7.0.2 when the manifest names none yet)
d="typescript pinned as a range (^x.y.z) in tools/package.json: 'npm-pins' exits 1 and names tools/package.json"
node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync("tools/package.json", "utf8"));
const cur = ((p.devDependencies || {}).typescript || "7.0.2").replace(/^[^0-9]*/, "");
p.devDependencies = Object.assign({}, p.devDependencies, { typescript: "^" + cur });
fs.writeFileSync("tools/package.json", JSON.stringify(p, null, 2) + "\n");
'
run_lint t6 npm-pins
if [ "$rc" -eq 1 ] && [ "$(lastline t6)" = "lint: failed" ] && mentions t6 tools/package.json; then
    pass T6 "$d"
else
    fail T6 "$d" "exit=$rc last='$(lastline t6)' output='$(oneline t6)'"
fi
restore

# T7 no typescript entry at all
d="no typescript entry in tools/package.json: 'npm-pins' exits 1 and names tools/package.json"
node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync("tools/package.json", "utf8"));
if (p.devDependencies) delete p.devDependencies.typescript;
if (p.dependencies) delete p.dependencies.typescript;
fs.writeFileSync("tools/package.json", JSON.stringify(p, null, 2) + "\n");
'
run_lint t7 npm-pins
if [ "$rc" -eq 1 ] && [ "$(lastline t7)" = "lint: failed" ] && mentions t7 tools/package.json; then
    pass T7 "$d"
else
    fail T7 "$d" "exit=$rc last='$(lastline t7)' output='$(oneline t7)'"
fi
restore

# T8 the manifest as committed
d="committed tools/package.json: 'npm-pins' exits 0, last line 'lint: ok'"
run_lint t8 npm-pins
if [ "$rc" -eq 0 ] && [ "$(lastline t8)" = "lint: ok" ]; then
    pass T8 "$d"
else
    fail T8 "$d" "exit=$rc last='$(lastline t8)' output='$(oneline t8)'"
fi

if [ "$failed" -ne 0 ]; then
    exit 1
fi
echo "lint-types: ok"
