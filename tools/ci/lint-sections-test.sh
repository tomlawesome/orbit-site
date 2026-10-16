#!/bin/sh
# Tests the section switch of tools/ci/lint.sh (#65):
#   sh tools/ci/lint.sh [SECTION...]    sh tools/ci/lint.sh --list
#
#   sh tools/ci/lint-sections-test.sh   run from anywhere inside the repository
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

ids="parse refs door types docs-index docs-shape docs-noscript milkyway proxy ci-split media csp names stray npm-pins"
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
headers() { grep '^== ' "$tmp/$1.out" || true; }
nheaders() { headers "$1" | wc -l | tr -d ' '; }
lastline() { tail -n 1 "$tmp/$1.out"; }
oneline() { tr '\n' '|' <"$tmp/$1.out" | cut -c1-200; }

# L1 no arguments: every section runs
d="no arguments, clean tree: exit 0, 15 headers, last line 'lint: ok'"
run_lint all
n=$(nheaders all)
if [ "$rc" -eq 0 ] && [ "$n" -eq 15 ] && [ "$(lastline all)" = "lint: ok" ]; then
    pass L1 "$d"
else
    fail L1 "$d" "exit=$rc headers=$n last='$(lastline all)'"
fi

# L2 --list prints the ids and runs nothing
d="--list: exit 0, the 15 ids in file order, no '== ' or 'lint:' line"
run_lint list --list
want=$(printf '%s\n' $ids)
got=$(cat "$tmp/list.out")
if [ "$rc" -eq 0 ] && [ "$got" = "$want" ] && ! grep -q '^== \|^lint:' "$tmp/list.out"; then
    pass L2 "$d"
else
    fail L2 "$d" "exit=$rc output='$(oneline list)'"
fi

# L3 one section alone
d="ci-split alone: exit 0, one header, last line 'lint: ok'"
run_lint one ci-split
n=$(nheaders one)
if [ "$rc" -eq 0 ] && [ "$n" -eq 1 ] && [ "$(lastline one)" = "lint: ok" ]; then
    pass L3 "$d"
else
    fail L3 "$d" "exit=$rc headers=$n last='$(lastline one)'"
fi

# L4 every id alone prints one header; together they equal the no-argument run
d="each id alone prints one header; the 15 together equal the no-argument headers"
: >"$tmp/each.txt"
bad=""
for id in $ids; do
    run_lint "id-$id" "$id"
    n=$(nheaders "id-$id")
    [ "$n" -eq 1 ] || bad="$bad $id($n)"
    headers "id-$id" >>"$tmp/each.txt"
done
headers all >"$tmp/all.txt"
if [ -z "$bad" ] && cmp -s "$tmp/each.txt" "$tmp/all.txt"; then
    pass L4 "$d"
else
    fail L4 "$d" "ids not giving exactly one header:${bad:- none}; combined headers match no-argument run: $(cmp -s "$tmp/each.txt" "$tmp/all.txt" && echo yes || echo no)"
fi

# L5 argument order does not matter
d="'stray ci-split' prints ci-split before stray (file order), two headers"
run_lint order stray ci-split
n=$(nheaders order)
first=$(headers order | sed -n 1p)
second=$(headers order | sed -n 2p)
want1=$(headers id-ci-split)
want2=$(headers id-stray)
if [ "$n" -eq 2 ] && [ -n "$want1" ] && [ -n "$want2" ] && [ "$first" = "$want1" ] && [ "$second" = "$want2" ]; then
    pass L5 "$d"
else
    fail L5 "$d" "headers=$n first='$first' second='$second'"
fi

# L6 repeated id runs once
d="'stray stray' prints one header"
run_lint dup stray stray
n=$(nheaders dup)
if [ "$n" -eq 1 ]; then
    pass L6 "$d"
else
    fail L6 "$d" "headers=$n"
fi

# L7 unknown id
d="unknown id: exit 2, names the id, lists valid ids, no section runs"
run_lint bad nosuch
n=$(nheaders bad)
rc1=$rc
run_lint bad2 stray nosuch
n2=$(nheaders bad2)
if [ "$rc1" -eq 2 ] && grep -q nosuch "$tmp/bad.out" && grep -q ci-split "$tmp/bad.out" && [ "$n" -eq 0 ] \
    && [ "$rc" -eq 2 ] && [ "$n2" -eq 0 ]; then
    pass L7 "$d"
else
    fail L7 "$d" "nosuch: exit=$rc1 headers=$n; stray nosuch: exit=$rc headers=$n2; output='$(oneline bad)'"
fi

# L8 selection really skips: plant a fault only the stray section catches
d="stray fault: 'stray' fails, 'ci-split' still passes, no arguments fails"
echo '{}' >package.json
git add -A -f
git -c user.name=t -c user.email=t@t commit -q -m "plant stray package.json"
run_lint f-stray stray
rs=$rc
ls_=$(lastline f-stray)
run_lint f-split ci-split
rc_=$rc
run_lint f-all
ra=$rc
if [ "$rs" -eq 1 ] && [ "$ls_" = "lint: failed" ] && [ "$rc_" -eq 0 ] && [ "$ra" -eq 1 ]; then
    pass L8 "$d"
else
    fail L8 "$d" "stray: exit=$rs last='$ls_'; ci-split: exit=$rc_; no arguments: exit=$ra"
fi

if [ "$failed" -ne 0 ]; then
    exit 1
fi
echo "lint-sections: ok"
