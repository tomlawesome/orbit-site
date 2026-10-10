#!/bin/sh
# The nightly docs import, as a merge request into main that merges itself
# once its pipeline passes (owner decision 13a, 2026-10-09). Nobody pushes
# to main: the import pushes its own branch, opens the merge request, and
# asks GitLab to merge it when the lint and the live journey are green, so
# every import is tested before Pages serves it. A run with nothing new
# does nothing. An older import merge request still open is closed first;
# the new one carries everything it had.
#
# Runs in the `import_docs` job, from a schedule on main. Needs
# ORBIT_SITE_IMPORT_TOKEN: a project access token, role Maintainer (to
# merge into main), scopes api and write_repository, held as a Masked +
# Protected CI/CD variable. Pushes read it from a mode-600 credential file
# and API calls from a header file, so it is never in a URL, an argument
# list or the log. The npm install and the import run with it withheld.
#
#   DRY_RUN=1 sh tools/ci/nightly-import.sh   import and report, write nothing
set -eu
cd "$(dirname "$0")/../.."

: "${CI_API_V4_URL:?}" "${CI_PROJECT_ID:?}" "${CI_SERVER_HOST:?}" "${CI_PROJECT_PATH:?}"
: "${ORBIT_SITE_IMPORT_TOKEN:?ORBIT_SITE_IMPORT_TOKEN is not set -- is the schedule on main and the variable protected?}"
DRY_RUN=${DRY_RUN:-}

umask 077
hdr=$(mktemp); cred=$(mktemp); scratch=$(mktemp -d); trap 'rm -rf "$hdr" "$cred" "$scratch"' EXIT
api() { m=$1; p=$2; shift 2; curl -fsS -X "$m" -H @"$hdr" "$CI_API_V4_URL/projects/$CI_PROJECT_ID$p" "$@"; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);$1})"; }

echo "== import"
# Exact versions from the lockfile, hashes checked, no install scripts, and
# the token withheld from the install and the import: a bad release of a
# package, or of one it pulls in, runs here before anything is pushed.
[ -d tools/node_modules/marked ] || env -u ORBIT_SITE_IMPORT_TOKEN \
  npm ci --prefix tools --ignore-scripts --no-audit --no-fund >/dev/null
env -u ORBIT_SITE_IMPORT_TOKEN node tools/import-docs.mjs
rm -rf tools/node_modules
printf 'PRIVATE-TOKEN: %s\n' "$ORBIT_SITE_IMPORT_TOKEN" > "$hdr"
git add assets/docs assets/img/launcher
if git diff --cached --quiet; then echo "nothing new"; exit 0; fi
git diff --cached --stat | tail -1

stamp=$(date -u +%Y%m%d-%H%M)
branch="docs/import-$stamp"

echo "== older import merge requests"
old=$(api GET "/merge_requests?state=opened&target_branch=main&per_page=100" \
  | json 'for (const m of j) if (/^docs\/import-[0-9-]+$/.test(m.source_branch)) console.log(m.iid, m.source_branch)')
# Closing leaves the branch behind, so it goes too (#12): the name is checked
# above, so only an import's own branch is ever deleted.
printf '%s\n' "$old" | while read -r iid ref; do
  [ -n "$iid" ] || continue
  echo "   closing !$iid and its branch $ref (superseded by $branch)"
  [ -n "$DRY_RUN" ] && continue
  api PUT "/merge_requests/$iid" --data-urlencode "state_event=close" >/dev/null
  api DELETE "/repository/branches/$(printf '%s' "$ref" | sed 's|/|%2F|g')" >/dev/null || echo "   (could not delete $ref)"
done

if [ -n "$DRY_RUN" ]; then echo "DRY_RUN: would push $branch and open a merge request into main"; git reset -q; exit 0; fi

echo "== push $branch"
git checkout -q -b "$branch"
git -c user.name="orbit-site import" -c user.email="import@orbit-site.invalid" \
  commit -q -m "Docs: imported from the repositories"
# Pushed from a fresh repository, not the runner's checkout: the runner's own
# git setup there sends the job token, which may read this project and never
# write it, and GitLab refused the push with a 403 before the token below was
# ever asked for (#9; orbit #1081 found and fixed the same in its repin).
# The fresh repository has no config of its own, and no global or system
# config or HOME reaches it, so the only credential is the mode-600 store
# file. The commit goes into it by a push from the checkout (receive-pack runs
# in the repository this job made); the checkout is shallow, so the scratch
# repository accepts a shallow update.
printf 'https://oauth2:%s@%s\n' "$ORBIT_SITE_IMPORT_TOKEN" "$CI_SERVER_HOST" > "$cred"
git init -q "$scratch/repo"
git -C "$scratch/repo" config receive.shallowUpdate true
git push -q "$scratch/repo" "HEAD:refs/heads/$branch"
mkdir "$scratch/home"
GIT_TERMINAL_PROMPT=0 HOME="$scratch/home" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
  git -C "$scratch/repo" -c credential.helper= -c "credential.helper=store --file=$cred" \
  push -q "https://${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git" "refs/heads/$branch:refs/heads/$branch"

echo "== merge request"
iid=$(api POST "/merge_requests" \
  --data-urlencode "source_branch=$branch" --data-urlencode "target_branch=main" \
  --data-urlencode "title=Docs: imported from the repositories ($stamp)" \
  --data-urlencode "remove_source_branch=true" \
  --data-urlencode "description=The nightly import (tools/ci/nightly-import.sh). It merges itself once the lint and the live journey pass." \
  | json 'console.log(j.iid)')
echo "   !$iid"

# Auto-merge can only be set once the merge request's pipeline exists. GitLab
# also needs the commit to merge (sha), so it merges exactly what was pushed
# and tested, never anything newer (#15). Each answer is kept, so a refusal
# says why: its status and body, never the request, so the token stays out
# of the log.
sha=$(git rev-parse HEAD)
resp="$scratch/merge-answer"
tries=30
for i in $(seq 1 "$tries"); do
  rm -f "$resp" "$resp.err"
  code=$(curl -sS --connect-timeout 10 --max-time 30 -o "$resp" -w '%{http_code}' \
    -X PUT -H @"$hdr" "$CI_API_V4_URL/projects/$CI_PROJECT_ID/merge_requests/$iid/merge" \
    --data-urlencode "auto_merge=true" --data-urlencode "sha=$sha" 2>"$resp.err") || code=000
  case $code in 2??) echo "   set to merge when the pipeline passes"; exit 0 ;; esac
  [ "$i" -eq "$tries" ] || sleep 10
done
echo "could not set !$iid to merge itself; it is open for a maintainer"
echo "   GitLab's last answer: HTTP $code $(cat "$resp" "$resp.err" 2>/dev/null | tr -s '\n' ' ' | cut -c1-300)"
exit 1
