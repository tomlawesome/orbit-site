#!/bin/sh
# The nightly docs import, second half: take the pages the `import_docs` job
# made (tools/ci/nightly-import.sh) and, if they differ from `main`, publish
# them as a merge request into main that merges itself once its pipeline
# passes (owner decision 13a, 2026-10-09). Nobody pushes to main: this pushes
# its own branch, opens the merge request, and asks GitLab to merge it when the
# lint and the live journey are green, so every import is tested before Pages
# serves it. A run with nothing new opens nothing, but still closes the older
# ones. Once the new merge request is open, any older import merge request still
# open is closed and its branch deleted: the new one carries everything it had.
#
# Privilege separation (#18): this is the only code that holds
# ORBIT_SITE_IMPORT_TOKEN, a project access token, role Maintainer (to merge
# into main), scopes api and write_repository, a Masked + Protected CI/CD
# variable scoped to the `docs-import` environment, which only this job joins.
# It runs no third-party code: no npm, and node only to parse JSON. The artifact
# from the import job came out of a job that did run such code, so it is
# untrusted: before anything is read from it, it must be exactly the files the
# import writes (flat, regular, unlinked, .json, parseable, under size and count
# caps), and the rest of the checkout must be what git has. The merge request's
# own pipeline (lint, with its no-script check, and the live journey) then
# judges the content before it reaches main. Pushes read the token from a
# mode-600 credential file and API calls from a header file, so it is never in a
# URL, an argument list or the log; both files exist only for the moment they
# are used. Every git command runs with no hooks, no fsmonitor, no global or
# system config and no token in its environment.
#
#   DRY_RUN=1 sh tools/ci/nightly-publish.sh   check the artifact and report
#
# DRY_RUN checks the artifact in the checkout, then builds the commit in a
# scratch copy of HEAD, so the checkout, its git objects and GitLab are
# unchanged. It reads from the GitLab API and writes nothing.
set -eu
cd "$(dirname "$0")/../.."

: "${CI_API_V4_URL:?}" "${CI_PROJECT_ID:?}" "${CI_SERVER_HOST:?}" "${CI_PROJECT_PATH:?}"
: "${ORBIT_SITE_IMPORT_TOKEN:?ORBIT_SITE_IMPORT_TOKEN is not set -- is the schedule on main, the variable protected and scoped to the docs-import environment?}"
DRY_RUN=${DRY_RUN:-}

# What the import writes: a page per source and an index, about 330 KB in nine
# files. Well above that, but nowhere near "a disk".
MAX_FILES=64
MAX_FILE_BYTES=2097152
MAX_TOTAL_BYTES=8388608

umask 077
scratch=$(mktemp -d); trap 'rm -rf "$scratch"' EXIT
hdr=$scratch/hdr; cred=$scratch/cred   # written only while in use
mkdir "$scratch/home"
# curl -q: no ~/.curlrc, which curl would otherwise read while the header file
# is on disk.
hdr_on() { printf 'PRIVATE-TOKEN: %s\n' "$ORBIT_SITE_IMPORT_TOKEN" > "$hdr"; }
hdr_off() { rm -f "$hdr"; }
api() { m=$1; p=$2; shift 2; hdr_on; r=0
  curl -q -fsS -X "$m" -H @"$hdr" "$CI_API_V4_URL/projects/$CI_PROJECT_ID$p" "$@" || r=$?
  hdr_off; return "$r"; }
# git: the token out of its environment, no hooks, no fsmonitor, no global or
# system config, no ssh or gpg program, no background gc, no index refresh
# written back. Command-line -c beats the repository's own config.
nogit() {
  env -u ORBIT_SITE_IMPORT_TOKEN -u GIT_DIR -u GIT_WORK_TREE HOME="$scratch/home" \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 GIT_OPTIONAL_LOCKS=0 \
    git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.sshCommand= \
    -c core.attributesFile=/dev/null -c core.pager=cat -c credential.helper= \
    -c commit.gpgSign=false -c gc.auto=0 -c maintenance.auto=false "$@"
}
top=$PWD
gitdir=$(nogit rev-parse --absolute-git-dir)
cgit() { nogit -c safe.directory="$top" --git-dir="$gitdir" --work-tree="$top" "$@"; }
# The API answer is parsed only after the call has returned and the header file
# is gone, so node never runs while the token is on disk.
apij() { js=$1; shift; ans=$(api "$@") || return 1; printf '%s\n' "$ans" | json "$js"; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);$1})"; }

refuse() { echo "refusing the artifact: $1"; exit 1; }

# The import writes assets/docs/<slug>.json and assets/docs/index.json and
# nothing else. Anything more is refused, before a line of it is read.
check_artifact() {
  export LC_ALL=C
  d=assets/docs
  for p in assets "$d"; do
    { [ -d "$p" ] && [ ! -L "$p" ]; } || refuse "$p is not a plain directory"
  done
  # not a regular file (a symlink, a directory, a device, a pipe), more than one
  # hard link, or a name other than lower-case letters, digits, dots and dashes
  # ending .json: find's own name matching, so a newline in a name is no way round
  bad=$(find "$d" -mindepth 1 \( ! -type f -o -links +1 -o \
    ! \( -name '[a-z0-9]*' -name '*.json' ! -name '*[!a-z0-9.-]*' \) \) -print |
    head -n 5 | tr -c '[:print:]\n' '?' | cut -c1-100)
  if [ -n "$bad" ]; then
    echo "refusing the artifact: only plain, single-link, lower-case .json files directly in $d are allowed; found:"
    printf '%s\n' "$bad" | sed 's/^/   /'
    exit 1
  fi
  [ -f "$d/index.json" ] || refuse "$d/index.json is missing"
  n=$(find "$d" -mindepth 1 | wc -l)
  [ "$n" -le "$MAX_FILES" ] || refuse "$n files, more than $MAX_FILES"
  big=$(find "$d" -type f -size +$((MAX_FILE_BYTES / 1024))k -print | head -n 1)
  [ -z "$big" ] || refuse "$big is larger than $MAX_FILE_BYTES bytes"
  total=0
  for f in "$d"/*.json; do
    s=$(wc -c < "$f"); total=$((total + s))
  done
  [ "$total" -le "$MAX_TOTAL_BYTES" ] || refuse "$total bytes in all, more than $MAX_TOTAL_BYTES"
  # each is JSON, an object: a page or the index
  env -u ORBIT_SITE_IMPORT_TOKEN node -e '
    const fs = require("fs");
    for (const f of process.argv.slice(1)) {
      let j;
      try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch { console.log(`refusing the artifact: ${f} is not JSON`); process.exit(1); }
      if (j === null || typeof j !== "object" || Array.isArray(j)) { console.log(`refusing the artifact: ${f} is not a JSON object`); process.exit(1); }
    }
  ' "$d"/*.json || exit 1
  echo "   $n files, $total bytes: plain .json files, all parse"
}

# A clean filter or a diff driver in the checkout's own git config would run a
# program during `git add`, and hooks and fsmonitor are the only ones the
# command line switches off. The runner's fresh clone has none of these; if the
# unpacking of the artifact left any, stop.
check_git() {
  if [ -s "$gitdir/info/attributes" ]; then
    echo "refusing the artifact: the checkout's git has an info/attributes file; stopping"
    exit 1
  fi
  keys=$(cgit config --local --name-only --list | grep -i -E '^(filter|diff|include|includeif)[.]|^include$' | head -n 5 || true)
  if [ -n "$keys" ]; then
    echo "refusing the artifact: the checkout's git config has settings that run programs or pull in more config; stopping:"
    printf '%s\n' "$keys" | sed 's/^/   /' | cut -c1-100
    exit 1
  fi
}

# Job 1 gave no say over anything but assets/docs: the rest of the checkout
# must be what git has at HEAD.
check_tree() {
  if ! cgit diff --quiet --no-ext-diff --no-textconv HEAD -- . ':(exclude)assets/docs'; then
    echo "refusing the artifact: tracked files outside assets/docs differ from HEAD:"
    cgit diff --name-only --no-ext-diff --no-textconv HEAD -- . ':(exclude)assets/docs' | head -n 10 | sed 's/^/   /'
    exit 1
  fi
}

# Older import merge requests still open, as "iid branch" lines. Only a merge
# request whose source and target are both this project and whose branch is
# named like an import's is ever matched, so a fork's is never touched (#12).
older_mrs() {
  apij 'for (const m of j) if (m.source_project_id === m.target_project_id && /^docs\/import-[0-9-]+$/.test(m.source_branch)) console.log(m.iid, m.source_branch)' \
    GET "/merge_requests?state=opened&target_branch=main&per_page=100"
}
# Close every older import merge request but !$1 and delete its branch (closing
# leaves the branch behind, #12); $2 says what replaces them. Under DRY_RUN
# it only reports. Fails only if the list cannot be fetched.
close_older() {
  keep=$1; by=$2
  list=$(older_mrs) || { echo "   (could not list the older import merge requests)"; return 1; }
  printf '%s\n' "$list" | while read -r oiid ref; do
    [ -n "$oiid" ] || continue
    [ "$oiid" != "$keep" ] || continue
    echo "   closing !$oiid and its branch $ref (superseded by $by)"
    [ -z "$DRY_RUN" ] || continue
    if api PUT "/merge_requests/$oiid" --data-urlencode "state_event=close" >/dev/null; then
      delete_branch "$ref" || echo "   (could not delete $ref)"
    else
      echo "   (could not close !$oiid)"
    fi
  done
}

# A run that failed after pushing leaves a docs/import-* branch with no merge
# request. Delete those at the start of the next run (#12). A branch is kept
# if any open merge request of this project has it as its source, or if its
# head commit is under an hour old (a run that is still between its push and
# its merge request, L2), or its age is not known. If there are 100 open merge
# requests, not all are seen, so nothing is deleted.
delete_branch() { api DELETE "/repository/branches/$(printf '%s' "$1" | sed 's|/|%2F|g')" >/dev/null; }
clean_stale_branches() {
  open=$(apij 'console.log(j.length); for (const m of j) if (m.source_project_id === m.target_project_id) console.log(m.source_branch)' \
    GET "/merge_requests?state=opened&per_page=100") || return 1
  [ "$(printf '%s\n' "$open" | head -n 1)" -lt 100 ] || { echo "   (100 open merge requests: too many to tell which branches are unused; none deleted)"; return 0; }
  found=$(apij 'for (const b of j) if (/^docs\/import-[0-9-]+$/.test(b.name)) { const t = Date.parse(b.commit && b.commit.committed_date); console.log(b.name, t < Date.now() - 3600e3 ? "old" : "young") }' \
    GET "/repository/branches?search=%5Edocs%2Fimport-&per_page=100") || return 1
  printf '%s\n' "$found" | while read -r b age; do
    [ -n "$b" ] || continue
    if printf '%s\n' "$open" | grep -qx -e "$b"; then continue; fi
    if [ "$age" != old ]; then echo "   keeping $b: under an hour old, or its age is not known"; continue; fi
    echo "   deleting $b: no open merge request has it"
    [ -z "$DRY_RUN" ] || continue
    delete_branch "$b" || echo "   (could not delete $b)"
  done
}
# The whole flow is one function, called on the last line: the shell has read
# the entire file before anything is done with the artifact.
main() {
  echo "== the artifact"
  check_artifact
  check_git
  check_tree

  if [ -n "$DRY_RUN" ]; then
    # the commit is built in a scratch repository whose base is HEAD, with the
    # checked artifact copied over its pages; the checkout is only read
    mkdir "$scratch/tree"
    cgit archive HEAD | tar -x -C "$scratch/tree"
    nogit init -q --template= "$scratch/tree"
    gitdir=$(nogit -C "$scratch/tree" rev-parse --absolute-git-dir)
    from=$top
    top=$scratch/tree
    cgit add -A
    cgit -c user.name=dry-run -c user.email=dry-run@invalid commit -q -m base
    rm -rf "$top/assets/docs"
    cp -R "$from/assets/docs" "$top/assets/docs"
    cd "$top"
  fi

  echo "== import branches left by an earlier run"
  clean_stale_branches || echo "   (could not check; the next run will)"

  echo "== compare with main"
  base=$(cgit rev-parse HEAD)
  # The index is built afresh: the base commit's tree plus the checked pages,
  # nothing else. A path outside assets/docs in the result stops the job.
  export GIT_INDEX_FILE="$scratch/index"
  cgit read-tree "$base"
  cgit add -A assets/docs
  outside=$(cgit diff --cached --name-only "$base" | grep -v -e '^assets/docs/' || true)
  if [ -n "$outside" ]; then
    echo "the artifact changed paths it may not write; stopping before anything is committed or pushed:"
    printf '%s\n' "$outside" | head -n 10 | sed 's/^/   /'
    exit 1
  fi
  if cgit diff --cached --quiet "$base"; then
    echo "nothing new"
    # An import merge request still open carries what upstream has since
    # reverted, and would merge itself: close it and its branch (#21).
    echo "== older import merge requests"
    close_older "" "nothing new upstream" || exit 1
    exit 0
  fi
  cgit diff --cached --no-ext-diff --no-textconv --stat "$base" | tail -1

  stamp=$(date -u +%Y%m%d-%H%M)
  branch="docs/import-$stamp"

  if [ -n "$DRY_RUN" ]; then
    echo "DRY_RUN: would push $branch, open a merge request into main, then close:"
    close_older "" "$branch" || true
    exit 0
  fi

  echo "== push $branch"
  tree=$(cgit write-tree)
  unset GIT_INDEX_FILE
  commit=$(cgit -c user.name="orbit-site import" -c user.email="import@orbit-site.invalid" \
    commit-tree -p "$base" -m "Docs: imported from the repositories" "$tree")
  cgit update-ref "refs/heads/$branch" "$commit"
  # Pushed from a fresh repository, not the runner's checkout: the runner's own
  # git setup there sends the job token, which may read this project and never
  # write it, and GitLab refused the push with a 403 before the token below was
  # ever asked for (#9; orbit #1081 found and fixed the same in its repin).
  # The fresh repository has no config of its own, and no global or system
  # config or HOME reaches it, so the only credential is the mode-600 store
  # file. The commit goes into it by a push from the checkout (receive-pack runs
  # in the repository this job made); the checkout is shallow, so the scratch
  # repository accepts a shallow update.
  nogit init -q --template= "$scratch/repo"
  nogit -C "$scratch/repo" config receive.shallowUpdate true
  cgit push -q "$scratch/repo" "$commit:refs/heads/$branch"
  # the credential file exists only for this push: git's environment has no
  # token, so this file is the one way the token reaches git at all
  printf 'https://oauth2:%s@%s\n' "$ORBIT_SITE_IMPORT_TOKEN" "$CI_SERVER_HOST" > "$cred"
  nogit -C "$scratch/repo" -c "credential.helper=store --file=$cred" \
    push -q "https://${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git" "refs/heads/$branch:refs/heads/$branch"
  rm -f "$cred"

  echo "== merge request"
  iid=$(apij 'console.log(j.iid)' POST "/merge_requests" \
    --data-urlencode "source_branch=$branch" --data-urlencode "target_branch=main" \
    --data-urlencode "title=Docs: imported from the repositories ($stamp)" \
    --data-urlencode "remove_source_branch=true" \
    --data-urlencode "description=The nightly import (tools/ci/nightly-import.sh imports, tools/ci/nightly-publish.sh publishes). It merges itself once the lint and the live journey pass.")
  case $iid in ''|*[!0-9]*)
    echo "GitLab's answer to the merge request had no numeric iid ('$iid'); stopping before closing anything"
    exit 1 ;;
  esac
  echo "   !$iid"

  # Only now, with the new merge request open, are the older ones closed: a push
  # or an open that failed leaves them standing. A failure here does not stop the
  # new one from being set to merge.
  echo "== older import merge requests"
  close_older "$iid" "!$iid" || echo "   (the older ones stay open; the next run closes them)"

  # Auto-merge can only be set once the merge request's pipeline exists. GitLab
  # also needs the commit to merge (sha), so it merges exactly what was pushed
  # and tested, never anything newer (#15). Each answer is kept, so a refusal
  # says why: its status and body, never the request, so the token stays out
  # of the log.
  sha=$commit
  resp="$scratch/merge-answer"
  tries=30
  # The header file is on disk only while one try runs (M3), never across the waits.
  for i in $(seq 1 "$tries"); do
    rm -f "$resp" "$resp.err"
    hdr_on
    code=$(curl -q -sS --connect-timeout 10 --max-time 30 -o "$resp" -w '%{http_code}' \
      -X PUT -H @"$hdr" "$CI_API_V4_URL/projects/$CI_PROJECT_ID/merge_requests/$iid/merge" \
      --data-urlencode "auto_merge=true" --data-urlencode "sha=$sha" 2>"$resp.err") || code=000
    hdr_off
    case $code in 2??) echo "   set to merge when the pipeline passes"; exit 0 ;; esac
    [ "$i" -eq "$tries" ] || sleep 10
  done
  echo "could not set !$iid to merge itself; it is open for a maintainer"
  echo "   GitLab's last answer: HTTP $code $(cat "$resp" "$resp.err" 2>/dev/null | tr -s '\n' ' ' | cut -c1-300)"
  exit 1
}
main "$@"
