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
# It runs no third-party code: no npm, and node and python only for the
# image's own JSON and zip handling. The import job ran such code, so nothing
# from it is trusted:
#   - this job does not take the import job's artifacts through `needs` (the
#     runner would load any dotenv report in them as variables of this job, over
#     this job's own YAML, and could rewrite CI_API_V4_URL or LD_PRELOAD); it
#     fetches the archive itself, by job id, with its own job token, into a
#     scratch directory, and opens it with python's zipfile: only the entries
#     assets/docs/<slug>.json for each source in tools/docs-sources.json and
#     assets/docs/index.json, regular files, under the size caps, are read, and
#     each is written by this script, never unpacked by a tool that follows
#     names or links;
#   - what is written is held to the shape the import writes
#     (tools/ci/docs-shape.mjs): the pad draws the index's colour and ids into
#     innerHTML;
#   - which job to fetch comes from GitLab, asked with the import token (a job
#     token cannot list a pipeline's jobs; the archive itself is downloaded with
#     the job token);
#   - the environment is pinned (host, project, branch, no preload or
#     interpreter overrides), and the checkout, a fresh clone (GIT_STRATEGY:
#     clone in .gitlab-ci.yml), must be what git has.
# The merge request's own pipeline (lint, with its no-script check, and the
# live journey) then judges the content before it reaches main. Pushes read the
# token from a mode-600 credential file and API calls from a header file, so it
# is never in a URL, an argument list or the log; both files exist only for the
# moment they are used. Every git command runs with no hooks, no fsmonitor, no
# global or system config and no token in its environment.
#
#   DRY_RUN=1 sh tools/ci/nightly-publish.sh   check the artifact and report
#
# DRY_RUN needs the same variables (it is meant for a job's environment). It
# reads the artifact and the GitLab API, builds the commit in a scratch copy of
# HEAD, and writes nothing to the checkout, its git objects or GitLab.
set -eu
cd "$(dirname "$0")/../.."

# Where this runs: nothing else is accepted, whatever the environment says.
EXPECT_HOST=gitlab.tomlawson.io
EXPECT_PATH=ai/orbit-site
# What the import writes: a page per source and an index, about 330 KB in nine
# files. Well above that, but nowhere near "a disk".
MAX_ENTRIES=64
MAX_FILE_BYTES=2097152
MAX_TOTAL_BYTES=8388608
MAX_ZIP_BYTES=16777216

# Variables that change what a program loads, trusts or runs are never set
# here. (The job takes no variables from the import job; this is the second
# lock on that door, and for LD_PRELOAD it can only be a check after the fact.)
for name in $(env | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p'); do
  case $name in
    # the runner's git settings, the image's version stamp and the pipeline's
    # own image reference (GitLab exports every pipeline variable to the job):
    # nothing here reads them
    GIT_DEPTH|GIT_STRATEGY|GIT_CLONE_PATH|GIT_FETCH_EXTRA_FLAGS|GIT_CHECKOUT|GIT_CLEAN_FLAGS|GIT_SUBMODULE_*|NODE_VERSION|NODE_IMAGE) ;;
    # the runner's own CA file, where it sets one, is the only trust store accepted
    GIT_SSL_CAINFO|SSL_CERT_FILE|CURL_CA_BUNDLE)
      val=; eval "val=\${$name}"
      [ -n "${CI_SERVER_TLS_CA_FILE:-}" ] && [ "$val" = "$CI_SERVER_TLS_CA_FILE" ] \
        || { echo "refusing to run: $name is set in the environment"; exit 1; } ;;
    LD_*|DYLD_*|NODE_*|PYTHON*|GIT_*|OPENSSL_*|SSL_CERT_*|CURL_*|BASH_ENV|ENV|IFS|PERL*|RUBY*)
      echo "refusing to run: $name is set in the environment"; exit 1 ;;
  esac
done

: "${CI_API_V4_URL:?}" "${CI_PROJECT_ID:?}" "${CI_SERVER_HOST:?}" "${CI_PROJECT_PATH:?}" "${CI_PIPELINE_ID:?}"
: "${CI_JOB_TOKEN:?}"
: "${ORBIT_SITE_IMPORT_TOKEN:?ORBIT_SITE_IMPORT_TOKEN is not set -- is the schedule on main, the variable protected and scoped to the docs-import environment?}"
DRY_RUN=${DRY_RUN:-}
pin() { echo "refusing to run: $1"; exit 1; }
[ "$CI_SERVER_HOST" = "$EXPECT_HOST" ] || pin "CI_SERVER_HOST is not $EXPECT_HOST"
[ "$CI_API_V4_URL" = "https://$EXPECT_HOST/api/v4" ] || pin "CI_API_V4_URL is not https://$EXPECT_HOST/api/v4"
[ "$CI_PROJECT_PATH" = "$EXPECT_PATH" ] || pin "CI_PROJECT_PATH is not $EXPECT_PATH"
case $CI_PROJECT_ID in ''|*[!0-9]*) pin "CI_PROJECT_ID is not a number" ;; esac
case $CI_PIPELINE_ID in ''|*[!0-9]*) pin "CI_PIPELINE_ID is not a number" ;; esac
if [ -z "$DRY_RUN" ]; then
  [ "${CI_COMMIT_BRANCH:-}" = main ] || pin "CI_COMMIT_BRANCH is not main"
  [ "${CI_PIPELINE_SOURCE:-}" = schedule ] || pin "CI_PIPELINE_SOURCE is not schedule"
fi

umask 077
scratch=$(mktemp -d); trap 'rm -rf "$scratch"' EXIT
hdr=$scratch/hdr; cred=$scratch/cred   # written only while in use
mkdir "$scratch/home"
# curl -q: no ~/.curlrc, which curl would otherwise read while the header file
# is on disk.
hdr_on() { printf 'PRIVATE-TOKEN: %s\n' "$ORBIT_SITE_IMPORT_TOKEN" > "$hdr"; }
hdr_off() { rm -f "$hdr"; }
# req <header name> <token> <method> <path> [curl args]: one call to this
# project's API, the header file on disk only while it runs
req() { hn=$1; tk=$2; m=$3; p=$4; shift 4; printf '%s: %s\n' "$hn" "$tk" > "$hdr"; r=0
  curl -q -fsS -X "$m" -H @"$hdr" "$CI_API_V4_URL/projects/$CI_PROJECT_ID$p" "$@" || r=$?
  hdr_off; return "$r"; }
api() { req PRIVATE-TOKEN "$ORBIT_SITE_IMPORT_TOKEN" "$@"; }
# git: the token out of its environment, no hooks, no fsmonitor, no global or
# system config, no ssh or gpg program, no background gc, no index refresh
# written back. Command-line -c beats the repository's own config.
nogit() {
  env -u ORBIT_SITE_IMPORT_TOKEN -u CI_JOB_TOKEN -u GIT_DIR -u GIT_WORK_TREE HOME="$scratch/home" \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 GIT_OPTIONAL_LOCKS=0 \
    git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.sshCommand= \
    -c core.attributesFile=/dev/null -c core.pager=cat -c credential.helper= \
    -c commit.gpgSign=false -c gc.auto=0 -c maintenance.auto=false "$@"
}
top=$PWD
gitdir=$(nogit rev-parse --absolute-git-dir)
cgit() { nogit -c safe.directory="$top" --git-dir="$gitdir" --work-tree="$top" "$@"; }
# The API answer is parsed only after the call has returned and the header file
# is gone, so node never runs while a token is on disk.
apij() { js=$1; shift; ans=$(api "$@") || return 1; printf '%s\n' "$ans" | json "$js"; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);$1})"; }

refuse() { echo "refusing the artifact: $1"; exit 1; }

# The checkout is a fresh clone, so its git directory holds what the runner
# wrote and nothing else: the keys below are what GitLab Runner's clone sets
# (git init and clone, the template config, the credential and url rewrites).
# Anything else (a filter or diff driver, an include, a worktree config, a
# command that git would run) stops the job, because the only switches on the
# command line are the ones for hooks and fsmonitor. Checked in the local and
# the worktree scope, which git reads after includes.
check_git() {
  if [ -s "$gitdir/info/attributes" ] || [ -e "$gitdir/config.worktree" ]; then
    echo "refusing to run: the checkout's git has an info/attributes or config.worktree file"
    exit 1
  fi
  keys=$(cgit config --list --show-scope --name-only | awk -F'\t' '$1=="local"||$1=="worktree"{print $2}' |
    grep -v -i -E '^(core\.(repositoryformatversion|filemode|bare|logallrefupdates|symlinks|ignorecase|precomposeunicode)|extensions\.objectformat|remote\.origin\.(url|fetch|tagopt)|branch\..+\.(remote|merge)|init\.defaultbranch|fetch\.recursesubmodules|fetch\.uriprotocols|credential\.interactive|gc\.(auto|autodetach)|transfer\.bundleuri|http\.(useragent|extraheader)|http\..+\.(proactiveauth|extraheader)|url\..+\.insteadof|credential\..+\.helper)$' |
    head -n 5 || true)
  if [ -n "$keys" ]; then
    echo "refusing to run: the checkout's git config has settings the runner's clone does not write; stopping:"
    printf '%s\n' "$keys" | sed 's/^/   /' | cut -c1-100
    exit 1
  fi
}

# The rest of the checkout is what git has at HEAD (a fresh clone, so it is; this
# is the second lock on a build folder that was reused).
check_tree() {
  if ! cgit diff --quiet --no-ext-diff --no-textconv HEAD -- .; then
    echo "refusing to run: tracked files differ from HEAD:"
    cgit diff --name-only --no-ext-diff --no-textconv HEAD -- . | head -n 10 | sed 's/^/   /'
    exit 1
  fi
}

# Which job is this pipeline's import, and is its archive the pipeline's: GitLab
# says, to the import token. The project is checked first (the id came from the
# environment), then the one successful import_docs job of this pipeline, on
# main, at the commit this job is checked out at, with an archive.
import_job() {
  proj=$(apij 'console.log(j.path_with_namespace)' GET "") || refuse "could not read the project from GitLab"
  [ "$proj" = "$EXPECT_PATH" ] || refuse "project $CI_PROJECT_ID is $proj, not $EXPECT_PATH"
  apij 'const ok = j.filter((x) => x.name === "import_docs" && x.status === "success" && x.ref === "main" && x.pipeline && String(x.pipeline.id) === "'"$CI_PIPELINE_ID"'" && x.pipeline.sha === "'"$1"'" && Array.isArray(x.artifacts) && x.artifacts.some((a) => a.file_type === "archive"));
    if (ok.length !== 1 || !Number.isInteger(ok[0].id)) { console.log("refusing the artifact: found " + ok.length + " successful import_docs jobs with an archive in this pipeline at this commit, want 1"); process.exit(1); }
    console.log(ok[0].id)' GET "/pipelines/$CI_PIPELINE_ID/jobs?per_page=100"
}

# The archive, by job id, with this job's own token. The size is capped on the
# way in and again after.
download() { # download <job id> <file>
  req JOB-TOKEN "$CI_JOB_TOKEN" GET "/jobs/$1/artifacts" --max-filesize "$MAX_ZIP_BYTES" -o "$2" || refuse "could not download the archive of job $1"
  size=$(wc -c < "$2")
  [ "$size" -le "$MAX_ZIP_BYTES" ] || refuse "the archive is $size bytes, more than $MAX_ZIP_BYTES"
}

# unpack <zip> <out dir> <sources file>: every entry is judged from the archive's
# own listing before anything is written; then the files are written by this
# program, from the bytes, to names it chose.
unpack() {
  env -u ORBIT_SITE_IMPORT_TOKEN -u CI_JOB_TOKEN \
    python3 -I - "$1" "$2" "$3" "$MAX_ENTRIES" "$MAX_FILE_BYTES" "$MAX_TOTAL_BYTES" <<'PY'
import json, os, stat, sys, zipfile

zpath, out, srcs = sys.argv[1], sys.argv[2], sys.argv[3]
max_entries, max_file, max_total = int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6])

def refuse(msg):
    print("refusing the artifact: " + msg)
    sys.exit(1)

allowed = {"assets/docs/index.json"} | {"assets/docs/%s.json" % s["slug"] for s in json.load(open(srcs))}
try:
    z = zipfile.ZipFile(zpath)
    infos = z.infolist()
except Exception:
    refuse("not a zip archive")
if len(infos) > max_entries:
    refuse("%d entries, more than %d" % (len(infos), max_entries))
files, seen, total = [], set(), 0
for i in infos:
    mode = (i.external_attr >> 16) & 0xFFFF
    printable = i.filename.encode("ascii", "replace").decode()[:80]
    if i.filename in ("assets/", "assets/docs/"):
        if mode and not stat.S_ISDIR(mode):
            refuse("%s is not a directory" % printable)
        continue
    if i.filename not in allowed:
        refuse("%s is not a file the import writes (only assets/docs/<slug>.json and index.json)" % printable)
    if mode and not stat.S_ISREG(mode):
        refuse("%s is not a regular file (a link or a device)" % printable)
    if i.filename in seen:
        refuse("%s is in the archive twice" % printable)
    if i.flag_bits & 0x1:
        refuse("%s is encrypted" % printable)
    if i.file_size > max_file:
        refuse("%s is larger than %d bytes" % (printable, max_file))
    seen.add(i.filename)
    total += i.file_size
    files.append(i)
if total > max_total:
    refuse("%d bytes in all, more than %d" % (total, max_total))
if seen != allowed:
    refuse("missing: %s" % ", ".join(sorted(allowed - seen)))
os.makedirs(os.path.join(out, "assets", "docs"))
try:
    for i in files:
        with z.open(i) as f:
            data = f.read(max_file + 1)
        if len(data) != i.file_size:
            refuse("%s is not the size the archive says" % i.filename)
        fd = os.open(os.path.join(out, i.filename), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as g:
            g.write(data)
except Exception:
    refuse("the archive is damaged")
print("   %d files, %d bytes: from the archive's listing, no other entry" % (len(files), total))
PY
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
  echo "== the checkout"
  check_git
  check_tree
  headsha=$(cgit rev-parse HEAD)

  echo "== the artifact"
  jobid=$(import_job "$headsha") || { printf '%s\n' "$jobid"; exit 1; }
  art=$scratch/art
  download "$jobid" "$scratch/artifact.zip"
  cgit cat-file blob HEAD:tools/docs-sources.json > "$scratch/sources.json"
  unpack "$scratch/artifact.zip" "$art" "$scratch/sources.json" || exit 1
  if ! shape=$(env -u ORBIT_SITE_IMPORT_TOKEN -u CI_JOB_TOKEN \
      node tools/ci/docs-shape.mjs "$art/assets/docs" "$scratch/sources.json"); then
    echo "refusing the artifact: it is not the shape the import writes:"
    printf '%s\n' "$shape"
    exit 1
  fi

  if [ -n "$DRY_RUN" ]; then
    # the commit is built in a scratch repository whose base is HEAD; the
    # checkout is only read
    mkdir "$scratch/tree"
    cgit archive HEAD | tar -x -C "$scratch/tree"
    nogit init -q --template= "$scratch/tree"
    gitdir=$(nogit -C "$scratch/tree" rev-parse --absolute-git-dir)
    top=$scratch/tree
    cgit add -A
    cgit -c user.name=dry-run -c user.email=dry-run@invalid commit -q -m base
    cd "$top"
  fi

  echo "== import branches left by an earlier run"
  clean_stale_branches || echo "   (could not check; the next run will)"

  echo "== compare with main"
  base=$(cgit rev-parse HEAD)
  # The index is built afresh: the base commit's tree plus the checked pages as
  # blobs, nothing else, and not through the work tree at all. A path outside
  # assets/docs in the result stops the job.
  export GIT_INDEX_FILE="$scratch/index"
  cgit read-tree "$base"
  for f in "$art"/assets/docs/*.json; do
    blob=$(cgit hash-object -w --no-filters -- "$f")
    cgit update-index --add --cacheinfo "100644,$blob,assets/docs/$(basename "$f")"
  done
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
