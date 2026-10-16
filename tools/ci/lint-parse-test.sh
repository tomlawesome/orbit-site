#!/bin/sh
# Tests the 'parse' section of tools/ci/lint.sh (#67):
#   sh tools/ci/lint.sh parse
#
#   sh tools/ci/lint-parse-test.sh   run from anywhere inside the repository
#
# Works on a scratch copy of the current commit, so the checkout is untouched.
set -eu

root=$(git rev-parse --show-toplevel)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

git -C "$root" archive HEAD | tar -x -C "$tmp"
# the lint reads .gitlab-ci.yml with js-yaml from tools/node_modules (#52), which the archive leaves out
[ ! -d "$root/tools/node_modules" ] || export NODE_PATH="$root/tools/node_modules"
cd "$tmp"
git init -q
git add -A
git -c user.name=t -c user.email=t@t commit -q -m base

failed=0

pass() { printf 'ok   %s %s\n' "$1" "$2"; }
fail() { printf 'FAIL %s %s (%s)\n' "$1" "$2" "$3"; failed=1; }

# run_parse NAME  runs the parse section, leaving output in $tmp/NAME.out and the exit code in $rc
rc=0
run_parse() {
    rc=0
    sh tools/ci/lint.sh parse >"$tmp/$1.out" 2>&1 || rc=$?
}
lastline() { tail -n 1 "$tmp/$1.out"; }
oneline() { tr '\n' '|' <"$tmp/$1.out" | cut -c1-300; }
# names NAME PATH  true when the output has a line "   PATH does not parse" (the parser message may follow)
names() { grep -q "^   $2 does not parse" "$tmp/$1.out"; }
nbroken() { grep -c 'does not parse' "$tmp/$1.out" || true; }

broken='var = = ;'

# P1 clean tree
d="clean tree: exit 0, last line 'lint: ok', no 'does not parse' line"
run_parse p1
n=$(nbroken p1)
if [ "$rc" -eq 0 ] && [ "$(lastline p1)" = "lint: ok" ] && [ "$n" -eq 0 ]; then
    pass P1 "$d"
else
    fail P1 "$d" "exit=$rc last='$(lastline p1)' broken=$n output='$(oneline p1)'"
fi

# P2 a syntax error in each of the six places, one at a time
d="a syntax error in one file in each of the six places: exit 1, exactly that path named"
bad=""
i=0
for f in sw.js assets/js/zz-broken.js assets/door/zz-broken.js tests/zz-broken.js tools/zz-broken.mjs tools/ci/zz-broken.mjs; do
    i=$((i + 1))
    if [ "$f" = sw.js ]; then
        printf '%s\n' "$broken" >>sw.js
    else
        printf '%s\n' "$broken" >"$f"
    fi
    run_parse "p2-$i"
    n=$(nbroken "p2-$i")
    if [ "$rc" -ne 1 ] || [ "$(lastline "p2-$i")" != "lint: failed" ] || ! names "p2-$i" "$f" || [ "$n" -ne 1 ]; then
        bad="$bad $f(exit=$rc named=$n)"
    fi
    if [ "$f" = sw.js ]; then
        git checkout -q -- sw.js
    else
        rm -f "$f"
    fi
done
if [ -z "$bad" ]; then
    pass P2 "$d"
else
    fail P2 "$d" "wrong for:$bad"
fi

# P3 two broken files at once: both named
d="two broken files at once: exit 1, both paths named"
printf '%s\n' "$broken" >assets/js/zz-a.js
printf '%s\n' "$broken" >tools/ci/zz-b.mjs
run_parse p3
n=$(nbroken p3)
if [ "$rc" -eq 1 ] && names p3 assets/js/zz-a.js && names p3 tools/ci/zz-b.mjs && [ "$n" -eq 2 ]; then
    pass P3 "$d"
else
    fail P3 "$d" "exit=$rc named=$n output='$(oneline p3)'"
fi
rm -f assets/js/zz-a.js tools/ci/zz-b.mjs

# P4 a valid ES module .js passes
d="a valid ES module .js in assets/js: exit 0, last line 'lint: ok'"
cat >assets/js/zz-module.js <<'EOF2'
import { join } from "path";
export const joined = join("a", "b");
export default function twice(x) { return x * 2; }
EOF2
run_parse p4
n=$(nbroken p4)
if [ "$rc" -eq 0 ] && [ "$(lastline p4)" = "lint: ok" ] && [ "$n" -eq 0 ]; then
    pass P4 "$d"
else
    fail P4 "$d" "exit=$rc last='$(lastline p4)' output='$(oneline p4)'"
fi
rm -f assets/js/zz-module.js

# P5 a classic script with a top-level return passes
d="a classic script .js with var and a top-level return: exit 0"
cat >assets/js/zz-classic.js <<'EOF2'
var total = 1;
if (total > 0) { total = total + 1; }
return;
EOF2
run_parse p5
n=$(nbroken p5)
if [ "$rc" -eq 0 ] && [ "$(lastline p5)" = "lint: ok" ] && [ "$n" -eq 0 ]; then
    pass P5 "$d"
else
    fail P5 "$d" "exit=$rc last='$(lastline p5)' output='$(oneline p5)'"
fi
rm -f assets/js/zz-classic.js

# P6 an .mjs must be a module: a top-level return fails
d="an .mjs in tools/ci with a top-level return: exit 1, named"
printf 'const x = 1;\nreturn;\n' >tools/ci/zz-return.mjs
run_parse p6
n=$(nbroken p6)
if [ "$rc" -eq 1 ] && names p6 tools/ci/zz-return.mjs && [ "$n" -eq 1 ]; then
    pass P6 "$d"
else
    fail P6 "$d" "exit=$rc named=$n output='$(oneline p6)'"
fi
rm -f tools/ci/zz-return.mjs

# P7 no code runs while checking
d="no code runs: files that would write ran.txt / ran2.txt are checked, exit 0, nothing written"
printf 'require("fs").writeFileSync("ran.txt", "x");\n' >assets/js/zz-side.js
printf 'import fs from "fs";\nfs.writeFileSync("ran2.txt", "x");\n' >tools/ci/zz-side.mjs
run_parse p7
found=$(find "$tmp" \( -name ran.txt -o -name ran2.txt \) | tr '\n' ' ')
if [ "$rc" -eq 0 ] && [ -z "$found" ]; then
    pass P7 "$d"
else
    fail P7 "$d" "exit=$rc written='$found' output='$(oneline p7)'"
fi
# control: run directly, the same files do write, so the check above could have caught a run
d="control: running the same files directly writes ran.txt and ran2.txt"
node assets/js/zz-side.js >/dev/null 2>&1 || true
node tools/ci/zz-side.mjs >/dev/null 2>&1 || true
if [ -f ran.txt ] && [ -f ran2.txt ]; then
    pass P7c "$d"
else
    fail P7c "$d" "ran.txt: $([ -f ran.txt ] && echo yes || echo no); ran2.txt: $([ -f ran2.txt ] && echo yes || echo no)"
fi
rm -f ran.txt ran2.txt assets/js/zz-side.js tools/ci/zz-side.mjs

if [ "$failed" -ne 0 ]; then
    exit 1
fi
echo "lint-parse: ok"
