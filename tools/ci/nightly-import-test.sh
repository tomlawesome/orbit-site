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
aux=$(mktemp -d)          # shims, state and logs for the runs that push; outside the scratch repo
trap 'rm -rf "$tmp" "$aux"' EXIT

git -C "$root" archive HEAD | tar -x -C "$tmp"
cd "$tmp"
git init -q
git add -A
git -c user.name=t -c user.email=t@t commit -q -m base
base=$(git rev-parse --abbrev-ref HEAD)
realgit=$(command -v git)
realnode=$(command -v node)

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

# Runs 3 and 4 go past the dry-run stop: the script pushes a docs/import-*
# branch, opens a merge request and asks GitLab to merge it when its pipeline
# passes. Shims on PATH stand in for GitLab (curl), the GitLab remote (git push
# to an https URL), the import (node) and the wait between attempts (sleep).
pbin="$aux/bin"
mkdir -p "$pbin"
cp bin/npm "$pbin/npm"
cat > "$pbin/node" <<'SHIM'
#!/bin/sh
# node -e (the script parsing JSON) is real; the import changes a tracked page.
case "$*" in
  *import-docs.mjs*)
    echo "node import-docs" >> "$STATE/shim.log"
    echo "imported $$" >> "$APPEND_FILE"
    exit 0 ;;
esac
exec "$REAL_NODE" "$@"
SHIM
cat > "$pbin/git" <<'SHIM'
#!/bin/sh
# Real git, except a push to an https URL: that is GitLab, and is only logged.
case "$1" in
  push) ;;
  *) case " $* " in *" push "*) ;; *) exec "$REAL_GIT" "$@" ;; esac ;;
esac
case "$*" in
  *https://*) echo "git $*" | sed "s/$FAKE/<token>/g" >> "$STATE/shim.log"; exit 0 ;;
esac
exec "$REAL_GIT" "$@"
SHIM
cat > "$pbin/sleep" <<'SHIM'
#!/bin/sh
echo "sleep $*" >> "$STATE/shim.log"
exit 0
SHIM
cat > "$pbin/curl" <<'SHIM'
#!/bin/sh
# A small imitation of curl against a fake GitLab. Logs method, path and data
# arguments to $STATE/api.log; never the contents of a header file.
method=GET; url=; fail=; failbody=; outf=; wfmt=; data=; hdr=no; tflags=; connfail=; ismerge=
takes() { # takes <flag> <value>
  case $1 in
    X) method=$2 ;;
    o) outf=$2 ;;
    w) wfmt=$2 ;;
    d|data-urlencode|data|data-raw) data="$data|$2" ;;
    H|header) # only whether a -H @file carries the token is kept, never the token
      case $2 in
        @*) hfile=${2#@}
            if [ -f "$hfile" ] && grep -q "^PRIVATE-TOKEN: $FAKE" "$hfile"; then hdr=yes; fi ;;
      esac ;;
    m|max-time) tflags="$tflags max-time" ;;
    connect-timeout) tflags="$tflags connect-timeout" ;;
    *) echo "curl: ignored $1 $2" >> "$STATE/api.log" ;;
  esac
}
while [ $# -gt 0 ]; do
  a=$1; shift
  case $a in
    --) while [ $# -gt 0 ]; do url=$1; shift; done ;;
    --fail) fail=1 ;;
    --fail-with-body) fail=1; failbody=1 ;;
    --request) takes X "$1"; shift ;;
    --output) takes o "$1"; shift ;;
    --write-out) takes w "$1"; shift ;;
    --header) takes H "$1"; shift ;;
    --data-urlencode|--data|--data-raw|--max-time|--retry|--connect-timeout|--retry-delay)
      case $a in
        --data-urlencode|--data|--data-raw|--max-time|--connect-timeout) takes "${a#--}" "$1" ;;
      esac; shift ;;
    --max-time=*) takes max-time "${a#*=}" ;;
    --connect-timeout=*) takes connect-timeout "${a#*=}" ;;
    --*=*) ;;
    --*) echo "curl: ignored flag $a" >> "$STATE/api.log" ;;
    -?*)
      rest=${a#-}
      while [ -n "$rest" ]; do
        c=${rest%"${rest#?}"}; rest=${rest#?}
        case $c in
          f) fail=1 ;;
          s|S|L|k|v|i|g) ;;
          X|H|o|w|d|m)
            if [ -n "$rest" ]; then val=$rest; rest=; else val=$1; shift; fi
            takes "$c" "$val" ;;
          *) echo "curl: ignored flag -$c" >> "$STATE/api.log" ;;
        esac
      done ;;
    *) url=$a ;;
  esac
done
path=${url#"$CI_API_V4_URL/projects/$CI_PROJECT_ID"}
route=${path%%\?*}
code=404; body='{"message":"404 Not Found"}'; note=
case "$method $route" in
  "GET /merge_requests") code=200; body='[]' ;;
  "POST /merge_requests") code=201; body='{"iid":42}' ;;
  "PUT /merge_requests/42/merge")
    n=$(cat "$STATE/merge-n" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$STATE/merge-n"
    ismerge=1
    if [ "$SCENARIO" = second ] && [ "$n" -ge 2 ]; then
      code=200; body='{"iid":42,"merge_when_pipeline_succeeds":true}'
    elif [ "$SCENARIO" = conn ] && [ "$n" -ge 2 ]; then
      # first attempt 405 with a body; every later one cannot connect at all
      code=000; body=; connfail=1
    else
      code=405; body='{"message":"405 Method Not Allowed"}'
    fi ;;
  *) note=" UNEXPECTED" ;;
esac
echo "$method $route$data$note" >> "$STATE/api.log"
if [ -n "$ismerge" ]; then # one line per merge PUT: header ok?, timeout flags, sha sent
  query=; case $path in *\?*) query=${path#*\?} ;; esac
  sha=$(printf '%s|%s' "$data" "$query" | tr '|&' '\n\n' | sed -n 's/^sha=//p' | head -n 1)
  echo "hdr=$hdr flags=${tflags# } sha=$sha" >> "$STATE/merge.log"
fi
# No connection: no body is written (an old -o file is left as it was), the
# write-out says 000, curl complains on stderr and exits 7.
if [ -n "$connfail" ]; then :
elif [ -z "$fail" ] || [ "$code" -lt 400 ] || [ -n "$failbody" ]; then
  if [ -n "$outf" ]; then printf '%s\n' "$body" > "$outf"; else printf '%s\n' "$body"; fi
fi
if [ -n "$wfmt" ]; then
  printf '%b' "$(printf '%s' "$wfmt" | sed -e "s/%{http_code}/$code/g" -e "s/%{response_code}/$code/g")"
fi
if [ -n "$connfail" ]; then
  echo "curl: (7) Failed to connect to gitlab.invalid port 443: Connection refused" >&2
  exit 7
fi
if [ -n "$fail" ] && [ "$code" -ge 400 ]; then
  echo "curl: (22) The requested URL returned error: $code" >&2
  exit 22
fi
exit 0
SHIM
chmod +x "$pbin"/*

appendfile=$(git ls-files assets/docs | head -n 1)
run_push() { # run_push <outfile> <scenario: refused | second | conn>
  outfile=$1
  # a clean scratch repository and state for every run
  "$realgit" checkout -q -f "$base"
  "$realgit" clean -qfd -e bin -e scratch-tmp
  for b in $("$realgit" for-each-ref --format='%(refname:short)' 'refs/heads/docs/import-*'); do
    "$realgit" branch -q -D "$b"
  done
  rm -rf scratch-tmp; mkdir scratch-tmp
  rm -f "$aux"/api.log "$aux"/shim.log "$aux"/merge-n "$aux"/merge.log
  : > "$aux/api.log"; : > "$aux/shim.log"; : > "$aux/merge.log"
  rc=0
  env ORBIT_SITE_IMPORT_TOKEN="$fake" PATH="$pbin:$PATH" STATE="$aux" SCENARIO="$2" FAKE="$fake" \
    REAL_GIT="$realgit" REAL_NODE="$realnode" APPEND_FILE="$appendfile" LOG="$log" HITS="$hits" \
    TMPDIR="$tmp/scratch-tmp" CI_API_V4_URL=https://gitlab.invalid/api/v4 CI_PROJECT_ID=1 \
    CI_SERVER_HOST=gitlab.invalid CI_PROJECT_PATH=ai/orbit-site \
    GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t \
    sh tools/ci/nightly-import.sh > "$outfile" 2>&1 || rc=$?
  merge_puts=$(grep -c '^PUT /merge_requests/42/merge' "$aux/api.log" || true)
  bare_puts=$(grep '^PUT /merge_requests/42/merge' "$aux/api.log" | grep -vc 'auto_merge=true' || true)
  sleeps=$(grep -c '^sleep ' "$aux/shim.log" || true)
  # the commit the import pushed: the real tip of the docs/import-* branch it made
  tip=$("$realgit" for-each-ref --format='%(objectname)' 'refs/heads/docs/import-*' | head -n 1)
  merge_calls=$(grep -c '^hdr=' "$aux/merge.log" || true)
  hdr_missing=$(grep -vc '^hdr=yes ' "$aux/merge.log" || true)
  no_timeouts=$(grep -v 'flags=.*connect-timeout' "$aux/merge.log" | wc -l)
  no_maxtime=$(grep -v 'flags=.*max-time' "$aux/merge.log" | wc -l)
  sha_wrong=$(grep -vc "sha=$tip\$" "$aux/merge.log" || true)
  if grep -q UNEXPECTED "$aux/api.log"; then
    echo "     note: unexpected API calls in this run:"; grep UNEXPECTED "$aux/api.log" | sed 's/^/       /'
  fi
}

# Run 3: GitLab refuses every auto-merge request (405). The job must fail and
# show why: the merge request, GitLab's status code and its message.
run_push "$out" refused
rc3=$rc
rc=0; [ "$rc3" -ne 0 ] || rc=1
check "when GitLab keeps refusing, the job fails (exit $rc3)" "$rc"
rc=0; grep -q 'could not set !42' "$out" || rc=1
check "the failure line names the merge request (could not set !42)" "$rc"
rc=0; grep -q 'HTTP 405' "$out" || rc=1
check "the failure shows GitLab's HTTP status (HTTP 405)" "$rc"
rc=0; grep -q 'Method Not Allowed' "$out" || rc=1
check "the failure shows GitLab's error message (Method Not Allowed)" "$rc"
rc=0; ! grep -rq "$fake" "$out" "$aux" || rc=1
check "the token is in neither the output nor any log" "$rc"
rc=0; [ "$merge_puts" -gt 1 ] || rc=1
check "it retried the auto-merge request (saw $merge_puts attempts)" "$rc"
rc=0; [ "$merge_puts" -gt 0 ] && [ "$bare_puts" -eq 0 ] || rc=1
check "every auto-merge attempt sent auto_merge=true" "$rc"
rc=0; [ "$merge_puts" -gt 0 ] && [ "$sleeps" -eq $((merge_puts - 1)) ] || rc=1
check "no wait after the last attempt (saw $sleeps sleeps for $merge_puts attempts)" "$rc"
check_merge_calls() { # check_merge_calls <label>: checks A, E and F on the run just made
  rc=0; printf '%s' "$tip" | grep -Eq '^[0-9a-f]{40}$' || rc=1
  check "$1: the import left a docs/import-* branch with a full SHA at its tip" "$rc"
  rc=0; [ "$merge_puts" -gt 0 ] && [ "$merge_calls" -eq "$merge_puts" ] && [ "$sha_wrong" -eq 0 ] \
    && printf '%s' "$tip" | grep -Eq '^[0-9a-f]{40}$' || rc=1
  check "$1: every auto-merge request sent sha= the commit that was pushed" "$rc"
  [ "$rc" -eq 0 ] || { echo "     pushed tip: $tip"; sed 's/^/     merge call: /' "$aux/merge.log"; }
  rc=0; [ "$merge_calls" -gt 0 ] && [ "$hdr_missing" -eq 0 ] || rc=1
  check "$1: the token header file (-H @file) was sent on every auto-merge request" "$rc"
  rc=0; [ "$merge_calls" -gt 0 ] && [ "$no_timeouts" -eq 0 ] && [ "$no_maxtime" -eq 0 ] || rc=1
  check "$1: every auto-merge request passed --connect-timeout and --max-time" "$rc"
}
check_merge_calls "run 3"
[ "$rc3" -ne 0 ] && grep -q 'HTTP 405' "$out" || sed 's/^/     /' "$out"

# Run 4: GitLab refuses once, then accepts (200). The job succeeds and stops.
run_push "$out" second
rc4=$rc
rc=0; [ "$rc4" -eq 0 ] || rc=1
check "when GitLab accepts on the second try, the job exits 0 (exit $rc4)" "$rc"
rc=0; grep -q 'set to merge when the pipeline passes' "$out" || rc=1
check "it says the merge request is set to merge when the pipeline passes" "$rc"
rc=0; [ "$merge_puts" -eq 2 ] || rc=1
check "it stopped retrying once GitLab accepted (saw $merge_puts attempts)" "$rc"
check_merge_calls "run 4"
[ "$rc4" -eq 0 ] || sed 's/^/     /' "$out"

# Run 5: the first attempt gets a 405 with a body; every later attempt cannot
# connect at all (curl: status 000, no body, exit 7). The last thing shown must
# be the connection failure, not the old 405 body.
run_push "$out" conn
rc5=$rc
rc=0; [ "$rc5" -ne 0 ] || rc=1
check "when the last attempt cannot connect, the job fails (exit $rc5)" "$rc"
rc=0; [ "$merge_puts" -gt 1 ] || rc=1
check "run 5 retried after the first refusal (saw $merge_puts attempts)" "$rc"
rc=0; grep -q 'could not set !42' "$out" || rc=1
check "run 5: the failure line names the merge request (could not set !42)" "$rc"
rc=0; grep -q 'HTTP 000' "$out" || rc=1
check "the failure shows the last attempt's status (HTTP 000)" "$rc"
rc=0; ! grep -q 'Method Not Allowed' "$out" || rc=1
check "a stale body from an earlier attempt is not shown (no Method Not Allowed)" "$rc"
[ "$rc" -eq 0 ] || sed 's/^/     /' "$out"

rm -f "$out"
exit "$failed"
