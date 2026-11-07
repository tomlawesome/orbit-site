#!/bin/sh
# The nightly docs import, second half: take the pages the `import_docs` job
# made (tools/ci/nightly-import.sh) and, if they differ from `dev`, publish
# them as a merge request into dev that merges itself once its pipeline
# passes (owner decision 10a, which replaced 13a). Nobody pushes to dev: this pushes
# its own branch, opens the merge request, and asks GitLab to merge it when the
# lint and the live journey are green, so every import is tested before Pages
# serves it. A run with nothing new opens nothing, but still closes the older
# ones. Opening the merge request is tried up to 5 times, 3 seconds apart,
# each refusal logged with GitLab's status and answer (#75). Once the new merge
# request is open, any older import merge request still open is closed and its
# branch deleted: the new one carries everything it had. Last of all, the one
# standing "Docs import warnings" issue is rewritten with the import's warnings
# (#82); nothing in that step can fail the job.
#
# Privilege separation (#18): this is the only code that holds
# ORBIT_SITE_IMPORT_TOKEN, a service account's personal access token, role
# Developer on orbit-site (to merge into dev) and Reporter on ai/agent-infra (to
# read the shared private-details check), scopes api and write_repository, a
# Masked + Protected CI/CD variable scoped to the `docs-import` environment,
# which exactly two jobs join: publish_docs and publish_translations, both
# running this script (the second with the argument `translations`, #125).
# It runs no third-party code: no npm, and node and python only for the
# image's own JSON and zip handling. The import job ran such code, so nothing
# from it is trusted:
#   - this job does not take the import job's artifacts through `needs` (the
#     runner would load any dotenv report in them as variables of this job, over
#     this job's own YAML, and could rewrite CI_API_V4_URL or LD_PRELOAD); it
#     fetches the archive itself, by job id, with its own job token, into a
#     scratch directory, and opens it with python's zipfile: only the entries
#     assets/docs/<slug>.json for each source in tools/docs-sources.json,
#     assets/docs/index.json and the pictures assets/docs/img/<16 hex>.(png|jpg|
#     webp|gif), regular files, under the size caps, are read, and
#     each is written by this script, never unpacked by a tool that follows
#     names or links; and import-warnings.txt, required, at the archive's root,
#     outside assets/docs/ so it can never reach the commit;
#   - what is written is held to the shape the import writes
#     (tools/ci/docs-shape.mjs): the pad draws the index's colour and ids into
#     innerHTML; the warnings file line by line to its own rules
#     (check_warnings): a file that breaks one is refused, never repaired or
#     cut, as a bad page is;
#   - which job to fetch comes from GitLab, asked with the import token (a job
#     token cannot list a pipeline's jobs; the archive itself is downloaded with
#     the job token);
#   - the environment is pinned (host, project, branch, no preload or
#     interpreter overrides), and the checkout, a fresh clone (GIT_STRATEGY:
#     clone in .gitlab-ci.yml, checked here too), must be what git has, with
#     only the git config the runner writes (check_git).
# The merge request's own pipeline (lint, with its markup check, and the
# live journey) then judges the content before it reaches dev. Pushes read the
# token from a mode-600 credential file and API calls from a header file, so it
# is never in a URL, an argument list or the log; both files exist only for the
# moment they are used. Every git command runs with no hooks, no fsmonitor, no
# global or system config and no token in its environment.
#
#   DRY_RUN=1 sh tools/ci/nightly-publish.sh   check the artifact and report
#
# With the argument `translations` (job publish_translations, #125 stage 2) it
# does the same for the artifact of `translate_docs`, the job that holds the
# Anthropic key and translates the committed English: only the entries
# assets/docs-i18n/<lang>/<slug|index>.json, assets/i18n/<lang>.json and
# tools/i18n/state/<lang>.json, for a language of HEAD's tools/i18n/languages.json
# (never en), and translate-report.json, required, at the root, which never
# reaches the commit. Each language comes whole or not at all. The pages are
# held to docs-i18n-shape and docs-markup, the catalogues to i18n-check's rules,
# and each built language's page (<lang>/index.html) is written again by the
# checkout's own tools/pages.mjs from its new catalogue. The branch is
# i18n/translate-<stamp>, the merge request goes into the branch the pipeline
# is on (dev, batch-a or batch-b; never main) titled "Translations <date>", its
# description the report's summary in a fence, and it merges itself only into
# dev: into a batch branch it stays open for review. The warnings issue is the
# import's and is not touched.
#
# DRY_RUN needs the same variables (it is meant for a job's environment). It
# reads the artifact and the GitLab API, builds the commit in a scratch copy of
# HEAD, and writes nothing to the checkout, its git objects or GitLab.
set -eu
cd "$(dirname "$0")/../.."

MODE=${1:-docs}
case $MODE in
  docs) JOB=import_docs; PREFIX=docs/import- ;;
  translations) JOB=translate_docs; PREFIX=i18n/translate- ;;
  *) echo "refusing to run: unknown mode $MODE (docs or translations)"; exit 1 ;;
esac
# the branch prefix as a JavaScript pattern and in a URL
PREFIX_RE=$(printf '%s' "$PREFIX" | sed 's|/|\\/|g')
PREFIX_URL=$(printf '%s' "$PREFIX" | sed 's|/|%2F|g')

# Where this runs: nothing else is accepted, whatever the environment says.
EXPECT_HOST=gitlab.tomlawson.io
EXPECT_PATH=ai/orbit-site
# What the import writes: a page per source and an index, about 220 KB in
# eleven files for ten sources, and its pictures, at most 16 a source of 1 MiB
# each and 6 MiB in all (MAX_PICTURE_BYTES_TOTAL in tools/import-docs-lib.mjs;
# docs-shape.mjs holds the artifact's img/ to that sum). Well above that, but
# nowhere near "a disk". Entries, counted from HEAD's tools/docs-sources.json
# so the cap follows the sources (#130): 3 folders, a page per source, the
# index, 16 pictures per source and the warnings file (#82) -- 175 for ten.
MAX_PICTURES_PER_SOURCE=16
MAX_PICTURE_BYTES=1048576
MAX_FILE_BYTES=2097152
MAX_TOTAL_BYTES=8388608
MAX_ZIP_BYTES=16777216
# The warnings file (#82): at most 200 lines of 400 characters, 64 KiB in all;
# the import keeps to these (tools/import-docs.mjs), so a file past them means
# the import job is broken or captured.
MAX_WARNING_LINES=200
MAX_WARNING_LINE=400
MAX_WARNING_MESSAGE=300
MAX_WARNING_BYTES=65536
WARN_TITLE="Docs import warnings"

# Variables that change what a program loads, trusts or runs are never set
# here. (The job takes no variables from the import job; this is the second
# lock on that door, and for LD_PRELOAD it can only be a check after the fact.)
# The names come from awk's ENVIRON, not `env` read line by line, where a value
# holding a newline would read as more names (#52).
# shellcheck disable=SC2013 # awk prints one valid variable name per line (its pattern allows nothing else), so splitting on words is exact
for name in $(awk 'BEGIN { for (k in ENVIRON) if (k ~ /^[A-Za-z_][A-Za-z0-9_]*$/) print k }'); do
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
: "${ORBIT_SITE_IMPORT_TOKEN:?ORBIT_SITE_IMPORT_TOKEN is not set -- is the schedule on dev, the variable protected and scoped to the docs-import environment?}"
DRY_RUN=${DRY_RUN:-}
pin() { echo "refusing to run: $1"; exit 1; }
# A fresh clone (#60): the CI file sets GIT_STRATEGY: clone, and this checks it
# at the point of use, in case that setting were overridden (a parallel matrix,
# a rule's variables, a project variable), since check_git trusts a fresh clone.
[ "${GIT_STRATEGY:-}" = clone ] || pin "GIT_STRATEGY is not clone"
[ "$CI_SERVER_HOST" = "$EXPECT_HOST" ] || pin "CI_SERVER_HOST is not $EXPECT_HOST"
[ "$CI_API_V4_URL" = "https://$EXPECT_HOST/api/v4" ] || pin "CI_API_V4_URL is not https://$EXPECT_HOST/api/v4"
[ "$CI_PROJECT_PATH" = "$EXPECT_PATH" ] || pin "CI_PROJECT_PATH is not $EXPECT_PATH"
case $CI_PROJECT_ID in ''|*[!0-9]*) pin "CI_PROJECT_ID is not a number" ;; esac
case $CI_PIPELINE_ID in ''|*[!0-9]*) pin "CI_PIPELINE_ID is not a number" ;; esac
if [ "$MODE" = translations ]; then
  # the translation publishes into the branch it was made from, never main, and
  # always says which: TARGET is where its merge request goes
  case ${CI_COMMIT_BRANCH:-} in dev|batch-a|batch-b) ;; *) pin "CI_COMMIT_BRANCH is not dev, batch-a or batch-b: the translation publishes only into one of those branches" ;; esac
  if [ -z "$DRY_RUN" ]; then
    case ${CI_PIPELINE_SOURCE:-} in schedule|web) ;; *) pin "CI_PIPELINE_SOURCE is not schedule or web" ;; esac
  fi
  TARGET=$CI_COMMIT_BRANCH
elif [ -z "$DRY_RUN" ]; then
  [ "${CI_COMMIT_BRANCH:-}" = dev ] || pin "CI_COMMIT_BRANCH is not dev"
  [ "${CI_PIPELINE_SOURCE:-}" = schedule ] || pin "CI_PIPELINE_SOURCE is not schedule"
  TARGET=dev
else
  TARGET=dev
fi
REF=dev; [ "$MODE" = docs ] || REF=$TARGET

umask 077
scratch=$(mktemp -d); trap 'rm -rf "$scratch"' EXIT
# a job stopped by a signal leaves through the EXIT trap too
trap 'exit 1' HUP INT TERM
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
# me: the import token's own user (GET /user), the one call not under
# /projects/:id, the header file on disk only while it runs
me() { r=0; hdr_on
  curl -q -fsS --connect-timeout 10 --max-time 30 -X GET -H @"$hdr" "$CI_API_V4_URL/user" || r=$?
  hdr_off; return "$r"; }
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
# git reads the checkout's config, includes and all, even to find the git
# directory: a config it cannot list (an include cycle) stops the job here, with
# the same refusal check_git gives.
gitdir=$(nogit rev-parse --absolute-git-dir 2>/dev/null) \
  || { echo "refusing to run: git could not list the checkout's config"; exit 1; }
cgit() { nogit -c safe.directory="$top" --git-dir="$gitdir" --work-tree="$top" "$@"; }
# The API answer is parsed only after the call has returned and the header file
# is gone, so node never runs while a token is on disk.
apij() { js=$1; shift; ans=$(api "$@") || return 1; printf '%s\n' "$ans" | json "$js"; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);$1})"; }
# answer <file>: a saved API answer and curl's own complaint (<file>.err), on one
# line, cut to 300 characters, for the log
answer() { cat "$1" "$1.err" 2>/dev/null | tr -s '\n' ' ' | cut -c1-300; }

refuse() { echo "refusing the artifact: $1"; exit 1; }

# The checkout is a fresh clone, so its git directory holds what the runner
# wrote and nothing else: GitLab Runner copies its template config into
# .git/config (the keys git init and clone set, and its own) and adds one
# include.path to the file it writes beside the checkout,
# <checkout>.tmp/.gitlab-runner.ext.conf (its credential and url rewrites and
# lfs.repositoryformatversion; #57). git reports that file's keys in the local
# scope, so the allowlist below judges them too. Anything else (a filter or diff
# driver, another include, a worktree config, a command that git would run)
# stops the job, because the only switches on the command line are the ones for
# hooks and fsmonitor. Checked in the local and the worktree scope, which git
# reads after includes.
check_git() {
  if [ -s "$gitdir/info/attributes" ] || [ -e "$gitdir/config.worktree" ]; then
    echo "refusing to run: the checkout's git has an info/attributes or config.worktree file"
    exit 1
  fi
  # The one include taken is that file, named exactly: the value must be the
  # absolute path <checkout>.tmp/.gitlab-runner.ext.conf as written (no `..`,
  # no relative path, no other file in that folder, #60), a regular file, and
  # its real path that same path, so no folder on the way is a symlink either.
  # The listing is read NUL-separated (-z), so no character in a path or value
  # can split an entry, and a listing git could not make stops the job. It is
  # kept in the scratch folder, which the EXIT trap removes however the job ends.
  cfg=$scratch/git-config-list
  if ! cgit config --list --show-scope -z > "$cfg" 2>/dev/null; then
    echo "refusing to run: git could not list the checkout's config"; exit 1
  fi
  # shellcheck disable=SC2016 # the single quotes hold JavaScript for node, not shell
  CFG=$cfg WANT="$top.tmp/.gitlab-runner.ext.conf" node -e '
    const fs = require("fs");
    const allowed = /^(include\.path|lfs\.repositoryformatversion|core\.(repositoryformatversion|filemode|bare|logallrefupdates|symlinks|ignorecase|precomposeunicode)|extensions\.objectformat|remote\.origin\.(url|fetch|tagopt)|branch\..+\.(remote|merge)|init\.defaultbranch|fetch\.recursesubmodules|fetch\.uriprotocols|credential\.interactive|gc\.(auto|autodetach)|transfer\.bundleuri|http\.(useragent|extraheader)|http\..+\.(proactiveauth|extraheader)|url\..+\.insteadof|credential\..+\.helper)$/is;
    const parts = fs.readFileSync(process.env.CFG, "utf8").split("\0");
    if (parts[parts.length - 1] === "") parts.pop();
    if (parts.length % 2) { console.log("refusing to run: the checkout\x27s git config listing is malformed"); process.exit(1); }
    const want = process.env.WANT;
    const bad = [], inc = [];
    for (let i = 0; i < parts.length; i += 2) {
      const scope = parts[i], nl = parts[i + 1].indexOf("\n");
      if (scope !== "local" && scope !== "worktree") continue;
      const key = nl < 0 ? parts[i + 1] : parts[i + 1].slice(0, nl), val = nl < 0 ? "" : parts[i + 1].slice(nl + 1);
      if (!allowed.test(key)) { bad.push(key); continue; }
      if (key.toLowerCase() !== "include.path") continue;
      let why = null;
      if (val !== want) why = "not " + JSON.stringify(want);
      else {
        let st = null, real = null;
        try { st = fs.lstatSync(val); } catch {}
        try { real = fs.realpathSync(val); } catch {}
        if (!st || !st.isFile()) why = "not a regular file";
        else if (real !== want) why = "its real path is " + JSON.stringify(real) + ", a symlink on the way";
      }
      if (why) inc.push(`refusing to run: the checkout\x27s git config has include.path ${JSON.stringify(val)}, ${why}`);
    }
    /* every include refused and every key outside the list is named, so a
       nested include is reported with what the file it names holds */
    for (const m of inc.slice(0, 5)) console.log(m);
    if (bad.length) {
      console.log("refusing to run: the checkout\x27s git config has settings the runner\x27s clone does not write; stopping:");
      for (const k of bad.slice(0, 5)) console.log("   " + k.slice(0, 97));
    }
    if (inc.length || bad.length) process.exit(1);
  ' || exit 1
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

# Which job is this pipeline's import (or translation), and is its archive the
# pipeline's: GitLab says, to the import token. The project is checked first
# (the id came from the environment), then the one successful $JOB job of this
# pipeline, on $REF (dev, or for a translation the pinned branch), at the commit
# this job is checked out at, with an archive.
import_job() {
  proj=$(apij 'console.log(j.path_with_namespace)' GET "") || refuse "could not read the project from GitLab"
  [ "$proj" = "$EXPECT_PATH" ] || refuse "project $CI_PROJECT_ID is $proj, not $EXPECT_PATH"
  apij 'const ok = j.filter((x) => x.name === "'"$JOB"'" && x.status === "success" && x.ref === "'"$REF"'" && x.pipeline && String(x.pipeline.id) === "'"$CI_PIPELINE_ID"'" && x.pipeline.sha === "'"$1"'" && Array.isArray(x.artifacts) && x.artifacts.some((a) => a.file_type === "archive"));
    if (ok.length !== 1 || !Number.isInteger(ok[0].id)) { console.log("refusing the artifact: found " + ok.length + " successful '"$JOB"' jobs with an archive in this pipeline at this commit, want 1"); process.exit(1); }
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
    python3 -I - "$1" "$2" "$3" "$MAX_PICTURES_PER_SOURCE" "$MAX_FILE_BYTES" "$MAX_TOTAL_BYTES" "$MAX_PICTURE_BYTES" <<'PY'
import json, os, re, stat, sys, zipfile

zpath, out, srcs = sys.argv[1], sys.argv[2], sys.argv[3]
per_source, max_file, max_total, max_picture = int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6]), int(sys.argv[7])
picture = re.compile(r"assets/docs/img/[0-9a-f]{16}\.(png|jpg|webp|gif)\Z")

def refuse(msg):
    print("refusing the artifact: " + msg)
    sys.exit(1)

sources = json.load(open(srcs))
allowed = {"assets/docs/index.json", "import-warnings.txt"} | {"assets/docs/%s.json" % s["slug"] for s in sources}
max_entries = 3 + len(sources) + 1 + per_source * len(sources) + 1
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
    if i.filename in ("assets/", "assets/docs/", "assets/docs/img/"):
        if mode and not stat.S_ISDIR(mode):
            refuse("%s is not a directory" % printable)
        continue
    pic = picture.match(i.filename)
    if i.filename not in allowed and not pic:
        refuse("%s is not a file the import writes (only assets/docs/<slug>.json, index.json, img/<16 hex>.<png|jpg|webp|gif> and import-warnings.txt)" % printable)
    if mode and not stat.S_ISREG(mode):
        refuse("%s is not a regular file (a link or a device)" % printable)
    if i.filename in seen:
        refuse("%s is in the archive twice" % printable)
    if i.flag_bits & 0x1:
        refuse("%s is encrypted" % printable)
    if i.file_size > (max_picture if pic else max_file):
        refuse("%s is larger than %d bytes" % (printable, max_picture if pic else max_file))
    seen.add(i.filename)
    total += i.file_size
    files.append(i)
if total > max_total:
    refuse("%d bytes in all, more than %d" % (total, max_total))
if not allowed <= seen:
    refuse("missing: %s" % ", ".join(sorted(allowed - seen)))
os.makedirs(os.path.join(out, "assets", "docs", "img"))
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

# unpack_tr <zip> <out dir> <sources file> <languages file>: the translation's
# archive (#125 stage 2), judged as unpack judges the import's: every entry from
# the archive's own listing before anything is written, then written by this
# program from the bytes. Allowed: for each language of HEAD's languages.json
# (never en), assets/docs-i18n/<lang>/<slug>.json for each source and index.json,
# assets/i18n/<lang>.json and tools/i18n/state/<lang>.json; and
# translate-report.json, required. A language present comes whole. The
# languages present are printed last, one line, for the checks that follow.
unpack_tr() {
  env -u ORBIT_SITE_IMPORT_TOKEN -u CI_JOB_TOKEN \
    python3 -I - "$1" "$2" "$3" "$4" "$MAX_FILE_BYTES" "$MAX_TOTAL_BYTES" <<'PY'
import json, os, re, stat, sys, zipfile

zpath, out, srcs, langs_file = sys.argv[1:5]
max_file, max_total = int(sys.argv[5]), int(sys.argv[6])

def refuse(msg):
    print("refusing the artifact: " + msg)
    sys.exit(1)

sources = json.load(open(srcs, encoding="utf-8"))
langs = [l for l in json.load(open(langs_file, encoding="utf-8")) if l != "en" and re.fullmatch(r"[a-z]{2,3}(-[A-Za-z0-9]{2,8})*", l)]
need = {}
for l in langs:
    need[l] = {"assets/docs-i18n/%s/index.json" % l, "assets/i18n/%s.json" % l, "tools/i18n/state/%s.json" % l} \
        | {"assets/docs-i18n/%s/%s.json" % (l, s["slug"]) for s in sources}
owner = {f: l for l, fs in need.items() for f in fs}
dirs = {"assets/", "assets/docs-i18n/", "assets/i18n/", "tools/", "tools/i18n/", "tools/i18n/state/"} | {"assets/docs-i18n/%s/" % l for l in langs}
max_entries = len(dirs) + sum(len(v) for v in need.values()) + 1
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
    if i.filename in dirs:
        if mode and not stat.S_ISDIR(mode):
            refuse("%s is not a directory" % printable)
        continue
    if i.filename not in owner and i.filename != "translate-report.json":
        refuse("%s is not a file the translation writes (only assets/docs-i18n/<lang>/<slug|index>.json, assets/i18n/<lang>.json and tools/i18n/state/<lang>.json for a language of tools/i18n/languages.json but en, and translate-report.json)" % printable)
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
if "translate-report.json" not in seen:
    refuse("missing: translate-report.json")
present = [l for l in langs if need[l] & seen]
for l in present:
    if not need[l] <= seen:
        refuse("%s is not whole; missing: %s" % (l, ", ".join(sorted(need[l] - seen))))
if not present:
    refuse("it holds no language")
for d in sorted(dirs):
    os.makedirs(os.path.join(out, d), exist_ok=True)
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
print(" ".join(present))
PY
}

# report_body <translate-report.json> <out>: the merge request's description: a
# fixed first paragraph, then the report's summary (a string of lines, per
# language its counts and each item kept in English with its rule, then the
# tokens and dollars) in one four-backtick fence. The rules can quote the model's
# answer, so every backtick becomes ', controls and bidi characters are dropped,
# and the summary is cut to 200 lines of 300 characters; inside the fence GitLab
# renders no mention, reference or quick action.
report_body() {
  env -u ORBIT_SITE_IMPORT_TOKEN -u CI_JOB_TOKEN \
    python3 -I - "$1" "$2" <<'PY'
import json, re, sys

rpath, out = sys.argv[1:3]
bad = re.compile("[\x00-\x08\x0b-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]")
try:
    with open(rpath, "rb") as f:
        rep = json.loads(f.read(2097153).decode("utf-8"))
    summary = rep["summary"]
    assert isinstance(summary, str)
except Exception:
    print("refusing the artifact: translate-report.json has no summary (a string)")
    sys.exit(1)
lines = [bad.sub("", l).replace("`", "'")[:300] for l in summary.split("\n")]
more = len(lines) - 200
lines = lines[:200] + (["... and %d more lines (the job's report has them)" % more] if more > 0 else [])
body = ["The translation of the committed English (tools/ci/translate.mjs translates, tools/ci/nightly-publish.sh "
        "translations publishes). Its summary, as the job wrote it:", "", "````"] + lines + ["````"]
with open(out, "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(body) + "\n")
PY
}

# check_warnings <file> <sources file>: the import's warnings, held to the
# format the import writes (#82): UTF-8, LF, at most MAX_WARNING_LINES lines of
# MAX_WARNING_LINE characters and MAX_WARNING_BYTES in all, each line
# repo<TAB>path<TAB>kind<TAB>message, repo and path a pair of the sources,
# kind one of a fixed set, the message at most MAX_WARNING_MESSAGE characters
# with no C0 or C1 control, line or paragraph separator, or bidi control. Any
# fault refuses the artifact (not cut, not repaired), naming the line, never
# quoting it.
check_warnings() {
  env -u ORBIT_SITE_IMPORT_TOKEN -u CI_JOB_TOKEN \
    python3 -I - "$1" "$2" "$MAX_WARNING_LINES" "$MAX_WARNING_LINE" "$MAX_WARNING_MESSAGE" "$MAX_WARNING_BYTES" <<'PY'
import json, re, sys

wpath, srcs = sys.argv[1], sys.argv[2]
max_lines, max_line, max_message, max_bytes = (int(a) for a in sys.argv[3:7])
kinds = {"link-cleaned", "link-dropped", "block-lost-text", "block-unclosed", "picture-not-copied", "more"}
bad = re.compile("[\x00-\x1f\x7f-\x9f  ‪-‮⁦-⁩]")

def refuse(msg):
    print("refusing the artifact: import-warnings.txt" + msg)
    sys.exit(1)

pairs = {(s["repo"], s["path"]) for s in json.load(open(srcs, encoding="utf-8"))}
with open(wpath, "rb") as f:
    data = f.read(max_bytes + 1)
if len(data) > max_bytes:
    refuse(" is larger than %d bytes" % max_bytes)
try:
    text = data.decode("utf-8")
except UnicodeDecodeError:
    refuse(" is not UTF-8")
if text and not text.endswith("\n"):
    refuse(": its last line has no newline")
lines = text.split("\n")[:-1]
if len(lines) > max_lines:
    refuse(" has %d lines, more than %d" % (len(lines), max_lines))
for n, l in enumerate(lines, 1):
    at = " line %d: " % n
    if len(l) > max_line:
        refuse(at + "longer than %d characters" % max_line)
    f = l.split("\t")
    if len(f) != 4:
        refuse(at + "not four tab-separated fields (repo, path, kind, message)")
    repo, path, kind, message = f
    if (repo, path) not in pairs:
        refuse(at + "its repo and path are not a source in tools/docs-sources.json")
    if kind not in kinds:
        refuse(at + "its kind is not one of %s" % ", ".join(sorted(kinds)))
    if len(message) > max_message:
        refuse(at + "its message is longer than %d characters" % max_message)
    c = bad.search(message)
    if c:
        refuse(at + "its message holds U+%04X, a control, separator or bidi character" % ord(c.group()))
print("   import-warnings.txt: %d lines, every one in the import's format" % len(lines))
PY
}

# warnings_body <warnings file> <sources file> <out>: the issue's body, from a
# checked warnings file: a fixed first paragraph, then `none`, or per source
# (in the sources' order) a `### <repo>/<path>` heading, both from the sources,
# and one four-backtick fence holding its lines as `<kind>  <message>`. Every
# backtick in a message is made ' so no line can close the fence, and every line
# in it starts with a kind, so none is a quick action (/), a mention (@) or a
# reference (#, !); inside a fence GitLab renders none of them. Then, when the
# lag file <lag> (translation_lag's) has rows, a "### Translations" block: per
# language each page two or more imports behind the English, in one fence too.
warnings_body() {
  env -u ORBIT_SITE_IMPORT_TOKEN -u CI_JOB_TOKEN \
    python3 -I - "$1" "$2" "$3" "$CI_PIPELINE_ID" "$(date -u '+%Y-%m-%d %H:%M UTC')" "$4" <<'PY'
import json, re, sys

wpath, srcs, out, pipeline, when, lagpath = sys.argv[1:7]
with open(wpath, encoding="utf-8") as f:
    lines = f.read().split("\n")[:-1]
by = {}
for l in lines:
    repo, path, kind, message = l.split("\t")
    by.setdefault((repo, path), []).append("%s  %s" % (kind, message.replace("`", "'")))
body = ["This issue lists the warnings of the nightly docs import, one block per source. The nightly publish job "
        "rewrites it on every run and reopens it when a run has warnings, so closing it hides them only until the "
        "next run that has some. Written by pipeline %s at %s." % (pipeline, when), ""]
if not lines:
    body.append("none")
seen = set()
for s in json.load(open(srcs, encoding="utf-8")):
    k = (s["repo"], s["path"])
    if k in by and k not in seen:
        seen.add(k)
        body += ["### %s/%s" % k, "", "````"] + by[k] + ["````", ""]
rows = []
try:
    with open(lagpath, encoding="utf-8") as f:
        for l in f.read().split("\n"):
            p = l.split("\t")
            # only what the lag check writes: a language code, a slug, a count, a date or "-"
            if len(p) == 4 and re.fullmatch(r"[a-z]{2,3}(-[A-Z][a-z]{3})?", p[0]) and re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", p[1]) \
                    and re.fullmatch(r"[0-9]{1,4}", p[2]) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}|-", p[3]):
                rows.append(p)
except OSError:
    pass
if rows:
    body += ["### Translations", "", "Translated pages two or more imports behind the English: the nightly translation "
             "has not kept up (one behind is the nightly order and is not listed).", ""]
    for lang in sorted({r[0] for r in rows}):
        body += ["%s:" % lang, "", "````"]
        for r in rows:
            if r[0] == lang:
                body.append("%s  %s imports behind; no translation has landed since %s" % (r[1], r[2], r[3] if r[3] != "-" else "(unknown)"))
        body += ["````", ""]
with open(out, "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(body).rstrip("\n") + "\n")
PY
}

# The one standing "Docs import warnings" issue (#82), kept the way Renovate
# keeps its Dependency Dashboard: found by author (the import token's own user),
# label docs-import and exact title, rewritten in place, never duplicated. None:
# it is created; two or more: nothing is edited. A closed one is reopened when
# there are warnings or a translation two or more imports behind (#125
# amendment 5). Run last, in a subshell, as
# `( update_warnings_issue ) || echo ...`, so nothing in it can change how the
# job ends. Every call has a time limit and the header file on disk only while
# it runs; answers are parsed once it is gone; the body goes from a file, never
# an argument. GitLab's own filter by author_id is checked again here. Under
# DRY_RUN it only reads, and prints the action and the body.
update_warnings_issue() {
  wf=$art/import-warnings.txt; body=$scratch/issue-body; reopen=; lagf=$scratch/lag-block
  warnings_body "$wf" "$scratch/sources.json" "$body" "$lagf" || return 1
  ans=$(me) || { echo "   (could not ask GitLab who the import token's user is)"; return 1; }
  uid=$(printf '%s\n' "$ans" | json 'if (!Number.isInteger(j.id) || j.id < 1) process.exit(1); console.log(j.id)') || return 1
  found=$(apij 'const m = j.filter((x) => x && x.title === "'"$WARN_TITLE"'" && x.author && x.author.id === '"$uid"' && Array.isArray(x.labels) && x.labels.includes("docs-import"));
    console.log(m.length, m.length === 1 && Number.isInteger(m[0].iid) ? m[0].iid : "-", m.length === 1 && m[0].state === "closed" ? "closed" : "open")' \
    GET "/issues?labels=docs-import&author_id=$uid&state=all&per_page=100" --connect-timeout 10 --max-time 30) || return 1
  # shellcheck disable=SC2086 # intended splitting of the three words the node snippet above printed (count, iid, state)
  set -- $found
  count=${1:-}; iid=${2:-}; state=${3:-}
  case $count in ''|*[!0-9]*) return 1 ;; esac
  if [ "$count" -gt 1 ]; then
    echo "   the warnings issue is ambiguous: $count issues of the import token's user are titled \"$WARN_TITLE\" with label docs-import; none edited"
    return 0
  fi
  if [ "$count" -eq 1 ]; then
    case $iid in ''|*[!0-9]*) return 1 ;; esac
    { [ ! -s "$wf" ] && [ ! -s "$lagf" ]; } || [ "$state" != closed ] || reopen=1
  fi
  if [ -n "$DRY_RUN" ]; then
    if [ "$count" -eq 0 ]; then echo "DRY_RUN: would create the warnings issue, with this body:"
    else echo "DRY_RUN: would rewrite the warnings issue #$iid${reopen:+ and reopen it}, with this body:"; fi
    sed 's/^/   | /' "$body"
    return 0
  fi
  if [ "$count" -eq 0 ]; then
    api POST "/issues" --connect-timeout 10 --max-time 30 --data-urlencode "title=$WARN_TITLE" \
      --data-urlencode "labels=docs-import" --data-urlencode "description@$body" >/dev/null || return 1
    echo "   created the warnings issue"
  else
    api PUT "/issues/$iid" --connect-timeout 10 --max-time 30 --data-urlencode "description@$body" \
      ${reopen:+--data-urlencode} ${reopen:+state_event=reopen} >/dev/null || return 1
    echo "   rewrote the warnings issue #$iid${reopen:+ and reopened it}"
  fi
}

# How far the translations trail the English (#125 amendment 5), from the
# checkout's history, read with cgit (node runs no file here): a page's imports
# behind are the distinct generated dates assets/docs/index.json has had after
# the page's source.generated, as the lint's --lag counts them. Each page behind
# is a line in the log; those two or more behind go to $scratch/lag-block
# ("<lang> TAB <slug> TAB <imports> TAB <date of the page's last commit>") for
# the warnings issue. Watched, never failed: run as `( translation_lag ) ||
# echo ...`. A shallow checkout has no history to count, so nothing is reported.
translation_lag() {
  lagd=$scratch/lag; mkdir -p "$lagd/idx" "$lagd/pages"; : > "$scratch/lag-block"
  if [ "$(cgit rev-parse --is-shallow-repository)" != false ]; then
    echo "   the checkout is shallow: no history to count the imports since each translation, so no lag is reported"
    return 0
  fi
  cgit cat-file blob HEAD:assets/docs/index.json > "$lagd/current.json" || return 1
  : > "$lagd/pages.txt"; n=0
  cgit ls-tree -r --name-only HEAD -- assets/docs-i18n > "$lagd/tree" || return 1
  while IFS= read -r f; do
    case $f in assets/docs-i18n/*/*.json) ;; *) continue ;; esac
    case ${f#assets/docs-i18n/} in */*/*|*/index.json) continue ;; esac
    n=$((n + 1))
    cgit cat-file blob "HEAD:$f" > "$lagd/pages/$n" || return 1
    printf '%s\t%s\t%s\n' "$n" "$f" "$(cgit log -1 --format=%cs -- "$f")" >> "$lagd/pages.txt"
  done < "$lagd/tree"
  [ "$n" -gt 0 ] || return 0
  # the oldest stamp bounds the history read: an import after it was committed after it
  oldest=$(lag_py oldest) || return 1
  [ -n "$oldest" ] || return 0
  m=0
  for sha in $(cgit log --format=%H --since="$oldest" -- assets/docs/index.json); do
    m=$((m + 1)); cgit cat-file blob "$sha:assets/docs/index.json" > "$lagd/idx/$(printf '%06d' "$m")" 2>/dev/null || :
  done
  lag_py count
}
# lag_py <oldest|count>: translation_lag's reading of the files it fetched
lag_py() {
  env -u ORBIT_SITE_IMPORT_TOKEN -u CI_JOB_TOKEN python3 -I - "$1" "$lagd" "$scratch/lag-block" <<'PY'
import json, os, re, sys

step, d, block = sys.argv[1:4]
ISO = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z")
def generated(path):
    try:
        g = json.load(open(path, encoding="utf-8")).get("generated")
    except (OSError, ValueError, AttributeError):
        return None
    return g if isinstance(g, str) and ISO.fullmatch(g) else None
current = generated(os.path.join(d, "current.json"))
pages = []
for l in open(os.path.join(d, "pages.txt"), encoding="utf-8").read().split("\n"):
    p = l.split("\t")
    m = len(p) == 3 and re.fullmatch(r"assets/docs-i18n/([a-z]{2,3}(?:-[A-Z][a-z]{3})?)/([a-z0-9][a-z0-9-]{0,79})\.json", p[1])
    if not m or current is None:
        continue
    try:
        src = json.load(open(os.path.join(d, "pages", p[0]), encoding="utf-8")).get("source")
        g = src.get("generated") if isinstance(src, dict) else None
    except (OSError, ValueError, AttributeError):
        continue  # the lint's shape check names it
    if isinstance(g, str) and ISO.fullmatch(g) and g < current:
        pages.append((m.group(1), m.group(2), p[1], g, p[2] if re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", p[2]) else "-"))
if step == "oldest":
    print(min((x[3] for x in pages), default=""))
    sys.exit(0)
# newest first, as git log gave them; a page's imports are the distinct dates down to the first not after its stamp
history = [x for x in (generated(os.path.join(d, "idx", f)) for f in sorted(os.listdir(os.path.join(d, "idx")))) if x is not None]
def imports_after(g):
    seen = set()
    for x in history:
        if x <= g:
            break
        seen.add(x)
    return len(seen)
rows = []
for lang, slug, f, g, landed in pages:
    n = imports_after(g)
    if n >= 2:
        print("   %s: translated from the English of %s, %d imports behind the English (%s): in the warnings issue" % (f, g, n, current))
        rows.append("%s\t%s\t%d\t%s" % (lang, slug, n, landed))
    elif n == 1:
        print("   %s: translated from the English of %s, one import behind (%s): the next translation run catches up" % (f, g, current))
with open(block, "w", encoding="utf-8", newline="\n") as f:
    f.write("".join(r + "\n" for r in rows))
PY
}

# The warnings issue is the import's: a translation leaves it alone.
warnings_issue() {
  [ "$MODE" = docs ] || return 0
  echo "== the warnings issue"
  ( update_warnings_issue ) || echo "   (could not update the warnings issue; the next run will)"
}

# Older import merge requests still open, as "iid branch" lines. Only a merge
# request whose source and target are both this project and whose branch is
# named like an import's is ever matched, so a fork's is never touched (#12).
# (A translation's are its own, i18n/translate-*, into the same target.)
older_mrs() {
  apij 'for (const m of j) if (m.source_project_id === m.target_project_id && /^'"$PREFIX_RE"'[0-9-]+$/.test(m.source_branch)) console.log(m.iid, m.source_branch)' \
    GET "/merge_requests?state=opened&target_branch=$TARGET&per_page=100"
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
  found=$(apij 'for (const b of j) if (/^'"$PREFIX_RE"'[0-9-]+$/.test(b.name)) { const t = Date.parse(b.commit && b.commit.committed_date); console.log(b.name, t < Date.now() - 3600e3 ? "old" : "young") }' \
    GET "/repository/branches?search=%5E$PREFIX_URL&per_page=100") || return 1
  printf '%s\n' "$found" | while read -r b age; do
    [ -n "$b" ] || continue
    if printf '%s\n' "$open" | grep -qx -e "$b"; then continue; fi
    if [ "$age" != old ]; then echo "   keeping $b: under an hour old, or its age is not known"; continue; fi
    echo "   deleting $b: no open merge request has it"
    [ -z "$DRY_RUN" ] || continue
    delete_branch "$b" || echo "   (could not delete $b)"
  done
}
# The import's artifact: unpacked, held to the shape and the markup the import
# writes, and its warnings to their format.
check_import() {
  unpack "$scratch/artifact.zip" "$art" "$scratch/sources.json" || exit 1
  if ! shape=$(env -u ORBIT_SITE_IMPORT_TOKEN -u CI_JOB_TOKEN \
      node tools/ci/docs-shape.mjs "$art/assets/docs" "$scratch/sources.json"); then
    echo "refusing the artifact: it is not the shape the import writes:"
    printf '%s\n' "$shape"
    exit 1
  fi
  # the lint's markup check, here too: a bad artifact is refused in this job,
  # not left as a failed merge request (#52); an allow-list of what the import
  # writes (audit 5, S1)
  if ! script=$(env -u ORBIT_SITE_IMPORT_TOKEN -u CI_JOB_TOKEN \
      node tools/ci/docs-markup.mjs "$art/assets/docs"); then
    echo "refusing the artifact: the imported docs must carry no script, only the markup the import writes:"
    printf '%s\n' "$script"
    exit 1
  fi
  check_warnings "$art/import-warnings.txt" "$scratch/sources.json" || exit 1
}

# The translation's artifact (#125 stage 2): unpacked, each language's pages
# held to docs-i18n-shape against the checkout's English (every page stamped
# with exactly its generated, amendment 5: a translation of other English is
# refused, nothing pushed) and to docs-markup, and
# the catalogues and their state to i18n-check's rules (en.json and
# languages.json from the checkout). LANGS is the languages it holds.
check_translations() {
  cgit cat-file blob HEAD:tools/i18n/languages.json > "$scratch/languages.json"
  got=$(unpack_tr "$scratch/artifact.zip" "$art" "$scratch/sources.json" "$scratch/languages.json") || { printf '%s\n' "$got"; exit 1; }
  printf '%s\n' "$got" | sed '$d'
  LANGS=$(printf '%s\n' "$got" | tail -n 1)
  for l in $LANGS; do
    if ! shape=$(env -u ORBIT_SITE_IMPORT_TOKEN -u CI_JOB_TOKEN \
        node tools/ci/docs-i18n-shape.mjs "$art/assets/docs-i18n/$l" "$scratch/sources.json" assets/docs --same-english); then
      echo "refusing the artifact: assets/docs-i18n/$l is not the shape the translation writes:"
      printf '%s\n' "$shape"
      exit 1
    fi
    if ! script=$(env -u ORBIT_SITE_IMPORT_TOKEN -u CI_JOB_TOKEN \
        node tools/ci/docs-markup.mjs "$art/assets/docs-i18n/$l"); then
      echo "refusing the artifact: assets/docs-i18n/$l must carry no script, only the markup the import writes:"
      printf '%s\n' "$script"
      exit 1
    fi
  done
  if ! cats=$(env -u ORBIT_SITE_IMPORT_TOKEN -u CI_JOB_TOKEN node tools/ci/i18n-check.mjs --catalogues "$art"); then
    echo "refusing the artifact: its catalogues break i18n-check's rules:"
    printf '%s\n' "$cats"
    exit 1
  fi
  printf '%s\n' "$cats"
  report_body "$art/translate-report.json" "$scratch/mr-description" || exit 1
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
  if [ "$MODE" = translations ]; then
    check_translations
  else
    check_import
    echo "== the translations' lag"
    ( translation_lag ) || echo "   (could not read the translations' lag; the next run will)"
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

  echo "== $PREFIX* branches left by an earlier run"
  clean_stale_branches || echo "   (could not check; the next run will)"

  echo "== compare with $TARGET"
  base=$(cgit rev-parse HEAD)
  # The index is built afresh: the base commit's tree, its pictures taken out,
  # plus the checked pages and pictures as blobs, nothing else, and not through
  # the work tree at all, so the merge request's assets/docs/img/ is exactly the
  # archive's. A path outside assets/docs in the result stops the job.
  export GIT_INDEX_FILE="$scratch/index"
  cgit read-tree "$base"
  if [ "$MODE" = translations ]; then
    # Each language held: its docs folder replaced whole (a page the English no
    # longer has goes), its catalogue and state, and, for a built language, its
    # page written again by the base commit's tools/pages.mjs from the new
    # catalogue (in a scratch copy of the base: the checkout is only read).
    mkdir "$scratch/pages"
    cgit archive "$base" | tar -x -C "$scratch/pages"
    for l in $LANGS; do
      cgit rm -r -q --cached --ignore-unmatch -- "assets/docs-i18n/$l"
      cp "$art/assets/i18n/$l.json" "$scratch/pages/assets/i18n/$l.json"
      for f in "$art/assets/docs-i18n/$l"/*.json "$art/assets/i18n/$l.json" "$art/tools/i18n/state/$l.json"; do
        blob=$(cgit hash-object -w --no-filters -- "$f")
        cgit update-index --add --cacheinfo "100644,$blob,${f#"$art"/}"
      done
    done
    if ! made=$(cd "$scratch/pages" && env -u ORBIT_SITE_IMPORT_TOKEN -u CI_JOB_TOKEN node tools/pages.mjs); then
      echo "refusing the artifact: tools/pages.mjs could not write the pages from its catalogues:"
      printf '%s\n' "$made"
      exit 1
    fi
    for l in $LANGS; do
      [ -f "$scratch/pages/$l/index.html" ] || continue   # a language not built has no page
      blob=$(cgit hash-object -w --no-filters -- "$scratch/pages/$l/index.html")
      cgit update-index --add --cacheinfo "100644,$blob,$l/index.html"
    done
    # what a translation may change, for a language it holds: its docs, its
    # catalogue (never en.json or en.js), its state and its built page
    outside=$(cgit diff --cached --name-only "$base" | while IFS= read -r f; do
      ok=
      for l in $LANGS; do
        case $f in
          "assets/docs-i18n/$l/"*.json) case ${f#"assets/docs-i18n/$l/"} in */*) ;; *) ok=1 ;; esac ;;
          "assets/i18n/$l.json"|"tools/i18n/state/$l.json"|"$l/index.html") ok=1 ;;
        esac
      done
      [ -n "$ok" ] || printf '%s\n' "$f"
    done)
  else
    cgit rm -r -q --cached --ignore-unmatch -- assets/docs/img
    for f in "$art"/assets/docs/*.json "$art"/assets/docs/img/*; do
      [ -f "$f" ] || continue   # an empty img/ leaves its pattern unexpanded
      blob=$(cgit hash-object -w --no-filters -- "$f")
      cgit update-index --add --cacheinfo "100644,$blob,${f#"$art"/}"
    done
    outside=$(cgit diff --cached --name-only "$base" | grep -v -e '^assets/docs/' || true)
  fi
  if [ -n "$outside" ]; then
    echo "the artifact changed paths it may not write; stopping before anything is committed or pushed:"
    printf '%s\n' "$outside" | head -n 10 | sed 's/^/   /'
    exit 1
  fi
  if cgit diff --cached --quiet "$base"; then
    echo "nothing new"
    # An import merge request still open carries what upstream has since
    # reverted, and would merge itself: close it and its branch (#21).
    echo "== older $PREFIX* merge requests"
    close_older "" "nothing new upstream" || exit 1
    warnings_issue
    exit 0
  fi
  cgit diff --cached --no-ext-diff --no-textconv --stat "$base" | tail -1

  stamp=$(date -u +%Y%m%d-%H%M)
  branch="$PREFIX$stamp"

  if [ -n "$DRY_RUN" ]; then
    echo "DRY_RUN: would push $branch, open a merge request into $TARGET, then close:"
    close_older "" "$branch" || true
    warnings_issue
    exit 0
  fi

  echo "== push $branch"
  tree=$(cgit write-tree)
  unset GIT_INDEX_FILE
  if [ "$MODE" = translations ]; then
    commit=$(cgit -c user.name="orbit-site translate" -c user.email="translate@orbit-site.invalid" \
      commit-tree -p "$base" -m "Translations: from the committed English" "$tree")
  else
    commit=$(cgit -c user.name="orbit-site import" -c user.email="import@orbit-site.invalid" \
      commit-tree -p "$base" -m "Docs: imported from the repositories" "$tree")
  fi
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
  # GitLab can refuse the open for a moment (#75): it is tried up to 5 times in
  # all, 3 seconds apart (the auto-merge below is 30 tries, 10 seconds apart).
  # Each refusal is logged with its status and answer, cut to 300 characters,
  # never the request. Before each try after the first, the branch's opened
  # merge requests are asked for: a create that took longer than its 30 seconds
  # may have been made all the same, and a second would be a duplicate (#91).
  # The header file is on disk only while one try runs, never across the waits,
  # and the answer is parsed only once it is gone.
  mrans="$scratch/mr-answer"
  # the description goes from a file, as the warnings issue's body does
  mrdesc="$scratch/mr-description"
  if [ "$MODE" = translations ]; then
    # written by check_translations from the report's summary
    title="Translations $(date -u +%Y-%m-%d)"
  else
    printf '%s\n' "The nightly import (tools/ci/nightly-import.sh imports, tools/ci/nightly-publish.sh publishes). It merges itself once the lint and the live journey pass." > "$mrdesc"
    title="Docs: imported from the repositories ($stamp)"
  fi
  mrtries=5
  for i in $(seq 1 "$mrtries"); do
    rm -f "$mrans" "$mrans.err"
    if [ "$i" -gt 1 ]; then
      found=$(apij "const m = j.find((m) => m.source_branch === '$branch'); console.log(m ? m.iid : '')" \
        GET "/merge_requests?state=opened&source_branch=$PREFIX_URL$stamp&per_page=100" --connect-timeout 10 --max-time 30) || found=
      case $found in ''|*[!0-9]*) ;; *)
        echo "   try $((i - 1)) had opened it: !$found is already open for $branch"
        printf '{"iid":%s}\n' "$found" > "$mrans"; code=200; break ;;
      esac
    fi
    hdr_on
    code=$(curl -q -sS --connect-timeout 10 --max-time 30 -o "$mrans" -w '%{http_code}' \
      -X POST -H @"$hdr" "$CI_API_V4_URL/projects/$CI_PROJECT_ID/merge_requests" \
      --data-urlencode "source_branch=$branch" --data-urlencode "target_branch=$TARGET" \
      --data-urlencode "title=$title" \
      --data-urlencode "remove_source_branch=true" \
      --data-urlencode "description@$mrdesc" \
      2>"$mrans.err") || code=000
    hdr_off
    case $code in 2??) break ;; esac
    echo "   try $i of $mrtries refused: HTTP $code $(answer "$mrans")"
    [ "$i" -eq "$mrtries" ] || sleep 3
  done
  case $code in 2??) ;; *)
    echo "could not open the merge request for $branch after $mrtries tries; nothing closed. GitLab's last answer: HTTP $code $(answer "$mrans")"
    exit 1 ;;
  esac
  iid=$(json 'console.log(j.iid)' < "$mrans" 2>/dev/null) || iid=
  case $iid in ''|*[!0-9]*)
    echo "GitLab's answer to the merge request had no numeric iid ('$iid'); stopping before closing anything"
    exit 1 ;;
  esac
  echo "   !$iid"

  # Only now, with the new merge request open, are the older ones closed: a push
  # or an open that failed leaves them standing. A failure here does not stop the
  # new one from being set to merge.
  echo "== older $PREFIX* merge requests"
  close_older "$iid" "!$iid" || echo "   (the older ones stay open; the next run closes them)"

  # Auto-merge can only be set once the merge request's pipeline exists. GitLab
  # also needs the commit to merge (sha), so it merges exactly what was pushed
  # and tested, never anything newer (#15). Each answer is kept, so a refusal
  # says why: its status and body, never the request, so the token stays out
  # of the log.
  # A translation into a batch branch stays open for review (#125: the first
  # run deserves a look, and the token may not merge into a protected batch).
  if [ "$TARGET" != dev ]; then
    echo "   left open for review: it targets $TARGET, and only a merge request into dev merges itself"
    exit 0
  fi
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
    case $code in 2??)
      echo "   set to merge when the pipeline passes"
      warnings_issue
      exit 0 ;;
    esac
    [ "$i" -eq "$tries" ] || sleep 10
  done
  echo "could not set !$iid to merge itself; it is open for a maintainer"
  echo "   GitLab's last answer: HTTP $code $(answer "$resp")"
  exit 1
}
main "$@"
