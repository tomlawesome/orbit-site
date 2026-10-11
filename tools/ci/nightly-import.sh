#!/bin/sh
# The nightly docs import, as a merge request into main that merges itself
# once its pipeline passes (owner decision 13a, 2026-10-09). Nobody pushes
# to main: the import pushes its own branch, opens the merge request, and
# asks GitLab to merge it when the lint and the live journey are green, so
# every import is tested before Pages serves it. A run with nothing new
# opens nothing, but still closes the older ones. Once the new merge request
# is open, any older import merge request still open is closed and its branch
# deleted: the new one carries everything it had.
#
# Runs in the `import_docs` job, from a schedule on main. Needs
# ORBIT_SITE_IMPORT_TOKEN: a project access token, role Maintainer (to
# merge into main), scopes api and write_repository, held as a Masked +
# Protected CI/CD variable. Pushes read it from a mode-600 credential file
# and API calls from a header file, so it is never in a URL, an argument
# list or the log. The npm install and the import run with it withheld, and
# so does every git command: the import could plant a hook, an fsmonitor or a
# filter in the checkout (#18), so git runs with no hooks, no fsmonitor, no
# global or system config and no token in its environment, after a check that
# the config the checkout's git reads is what it was before the import. The
# header and credential files exist only for the moment they are used.
#
#   DRY_RUN=1 sh tools/ci/nightly-import.sh   import and report, write nothing
#
# DRY_RUN touches nothing in the checkout: it runs the install and the import
# in a scratch copy of HEAD (so it fetches and installs again even if the
# checkout has node_modules) and deletes the copy on exit. It reads from the
# network and the GitLab API, and changes nothing there either.
set -eu
cd "$(dirname "$0")/../.."

: "${CI_API_V4_URL:?}" "${CI_PROJECT_ID:?}" "${CI_SERVER_HOST:?}" "${CI_PROJECT_PATH:?}"
: "${ORBIT_SITE_IMPORT_TOKEN:?ORBIT_SITE_IMPORT_TOKEN is not set -- is the schedule on main and the variable protected?}"
DRY_RUN=${DRY_RUN:-}

umask 077
scratch=$(mktemp -d); trap 'rm -rf "$scratch"' EXIT
hdr=$scratch/hdr; cred=$scratch/cred   # written only while in use, never during the import
mkdir "$scratch/home"
# curl -q: no ~/.curlrc, which the import could have written and which curl
# would read while the header file is on disk.
hdr_on() { printf 'PRIVATE-TOKEN: %s\n' "$ORBIT_SITE_IMPORT_TOKEN" > "$hdr"; }
hdr_off() { rm -f "$hdr"; }
api() { m=$1; p=$2; shift 2; hdr_on; r=0
  curl -q -fsS -X "$m" -H @"$hdr" "$CI_API_V4_URL/projects/$CI_PROJECT_ID$p" "$@" || r=$?
  hdr_off; return "$r"; }
# git for everything after the import: the token out of its environment, no
# hooks, no fsmonitor, no global or system config (the import runs as this
# user and could write ~/.gitconfig), no ssh or gpg program, no background gc.
# Command-line -c beats the repository's own config.
nogit() {
  env -u ORBIT_SITE_IMPORT_TOKEN -u GIT_DIR -u GIT_WORK_TREE HOME="$scratch/home" \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 \
    git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.sshCommand= \
    -c core.attributesFile=/dev/null -c core.pager=cat -c credential.helper= \
    -c commit.gpgSign=false -c gc.auto=0 -c maintenance.auto=false "$@"
}
top=$PWD
gitdir=$(nogit rev-parse --absolute-git-dir)
cgit() { nogit -c safe.directory="$top" --git-dir="$gitdir" --work-tree="$top" "$@"; }
if [ -n "$DRY_RUN" ]; then
  mkdir "$scratch/tree"
  cgit archive HEAD | tar -x -C "$scratch/tree"
  cd "$scratch/tree"
  top=$PWD
  nogit init -q --template=
  gitdir=$(nogit rev-parse --absolute-git-dir)
  cgit add -A
  cgit -c user.name=dry-run -c user.email=dry-run@invalid commit -q -m base
fi
# every value git would read for the checkout, with the file each came from
# (includes followed): the same before and after the import, or it tampered
gitcfg() { cgit config --list --show-origin; }
# The API answer is parsed only after the call has returned and the header file
# is gone, so node never runs while the token is on disk.
apij() { js=$1; shift; ans=$(api "$@") || return 1; printf '%s\n' "$ans" | json "$js"; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);$1})"; }

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
    if [ "$age" != old ]; then echo "   keeping $b: under an hour old, or its age is unknown"; continue; fi
    echo "   deleting $b: no open merge request has it"
    [ -z "$DRY_RUN" ] || continue
    delete_branch "$b" || echo "   (could not delete $b)"
  done
}
# The whole flow is one function, called on the last line: the shell has read
# the entire file before the import runs, so the import cannot change what the
# rest of this script does by rewriting it.
main() {
  echo "== import branches left by an earlier run"
  clean_stale_branches || echo "   (could not check; the next run will)"

  echo "== import"
  gitcfg > "$scratch/gitcfg.before"
  # What the import must not move: HEAD, the branch it is on and every ref. The
  # commit below is built on this base, from a fresh index, so whatever the
  # import staged in the checkout's own index is never in it (H1).
  gitstate() {
    cgit symbolic-ref -q HEAD || echo detached
    cgit rev-parse HEAD
    cgit for-each-ref --format='%(refname) %(objectname)'
  }
  base=$(cgit rev-parse HEAD)
  gitstate > "$scratch/gitstate.before"
  # Exact versions from the lockfile, hashes checked, no install scripts, and
  # the token withheld from the install and the import: a bad release of a
  # package, or of one it pulls in, runs here before anything is pushed.
  [ -d tools/node_modules/marked ] || env -u ORBIT_SITE_IMPORT_TOKEN \
    npm ci --prefix tools --ignore-scripts --no-audit --no-fund >/dev/null
  env -u ORBIT_SITE_IMPORT_TOKEN node tools/import-docs.mjs
  rm -rf tools/node_modules
  if ! gitcfg | cmp -s - "$scratch/gitcfg.before"; then
    echo "the import changed the git configuration of the checkout; stopping before anything is committed or pushed:"
    gitcfg | diff "$scratch/gitcfg.before" - | sed 's/^/   /' | cut -c1-200 || true
    exit 1
  fi
  if ! gitstate | cmp -s - "$scratch/gitstate.before"; then
    echo "the import moved HEAD or a ref of the checkout; stopping before anything is committed or pushed"
    exit 1
  fi
  # The index is built afresh: the base commit's tree plus the paths the import
  # writes, nothing else. A path outside them in the result stops the job.
  export GIT_INDEX_FILE="$scratch/index"
  cgit read-tree "$base"
  cgit add assets/docs
  outside=$(cgit diff --cached --name-only "$base" | grep -v -e '^assets/docs/' || true)
  if [ -n "$outside" ]; then
    echo "the import changed paths it may not write; stopping before anything is committed or pushed:"
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
    --data-urlencode "description=The nightly import (tools/ci/nightly-import.sh). It merges itself once the lint and the live journey pass.")
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
