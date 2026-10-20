#!/bin/sh
# Test for the nightly docs import, which is two scripts in two jobs (#18).
#
# tools/ci/nightly-import.sh (job `import_docs`) installs the two npm packages
# from the lockfile (npm ci, scripts off, in tools/) and runs the import. It
# holds no secret: it makes no git push and no API call, and nothing in it
# names the token. Part 1 runs it with a fake token in its environment and
# checks that nothing reads, prints, writes or sends it.
#
# tools/ci/nightly-publish.sh (job `publish_docs`) asks GitLab (with the import
# token) which job made the artifact, downloads that archive itself with its job
# token, opens it entry by entry, and refuses it unless it is exactly what the
# import writes and the shape the import gives it; then it pushes a branch,
# opens a merge request and sets it to merge itself, closes the older ones, and
# sweeps stale branches. It also refuses to run in an environment that is not
# the pinned one. Part 2 runs it against a fake GitLab with good and hostile
# archives.
#
#   sh tools/ci/nightly-import-test.sh      run from anywhere inside the repository
#
# Part 2 also tries the git config the runner's own clone writes (#57, #60):
# the runner copies its template config into .git/config and adds an
# include.path to <checkout>.tmp/.gitlab-runner.ext.conf (holding its own keys
# and lfs.repositoryformatversion: runnerinc). That is the only include
# accepted: the value must be exactly that absolute path, a regular file, not a
# symlink, with that real path. Anything else is refused naming include.path:
# another file in <checkout>.tmp/ (incevil, incgtpl), a sibling folder with the
# same prefix (incsib), a path with .. (incdots, incdotsame), <checkout>.tmp as
# a symlink (incdirlink), the file as a symlink (inclink), a relative path that
# means something else from .git/ (increlcwd, increl), one into the work tree
# (incwork) or .git (incgit), a missing file (include), a file elsewhere
# (incelse), a value with a tab in it (inctab); any includeIf is refused too
# (includeif). Keys in the accepted file are judged by the allowlist (incssh
# core.sshCommand, incfsmon core.fsmonitor, incfilter filter.x.clean); a nested
# include is refused, naming its key (incnest, incnestmiss). An include cycle stops the job
# with "could not list" (inccycle). A value with a newline in it is one value,
# not two keys (nlval accepted, nlreal refused for its real core.sshCommand).
# No file is left in TMPDIR after a refused run.
#
# Pictures (#72): the import copies each upstream picture into assets/docs/img/,
# so the archive may carry that folder and files assets/docs/img/<16 hex>.(png|jpg|webp|gif) of
# at most 1 MiB, each a real picture of its extension and used by a page, and nothing else under
# it (pic and the pic* scenarios below); the entry limit allows 8 pages, the index and 128
# pictures (pics128 accepted, pictoomany refused); and the merge request's assets/docs/img/ is
# exactly the archive's: a picture the import no longer writes is deleted (picgone, picswap).
#
# Runs on a scratch copy of the current commit, so the checkout is untouched.
# npm, node, git, curl and sleep are shims first on PATH that log what they were
# called with; nothing touches the network.
set -eu

root=$(git rev-parse --show-toplevel)
tmp=$(mktemp -d)
aux=$(mktemp -d)          # shims, state and logs; outside the scratch repo
trap 'rm -rf "$tmp" "$tmp.tmp" "$tmp.tmpX" "$tmp.elsewhere" "$aux"' EXIT

git -C "$root" archive HEAD | tar -x -C "$tmp"
# a second, untouched copy: the publish script pins its host, and the copy under
# test is given the test's (the pin itself is tried on the untouched one)
mkdir "$aux/pristine"; git -C "$root" archive HEAD | tar -x -C "$aux/pristine"
sed -i 's/^EXPECT_HOST=.*/EXPECT_HOST=gitlab.invalid/' "$tmp/tools/ci/nightly-publish.sh"
cd "$tmp"
git init -q
git add -A
git -c user.name=t -c user.email=t@t commit -q -m base
base=$(git rev-parse --abbrev-ref HEAD)
realgit=$(command -v git)
realnode=$(command -v node)
basecommit=$(git rev-parse HEAD)
appendfile=$(git ls-files assets/docs | head -n 1)
cp .git/config "$aux/config.orig"
cp -R assets/docs "$aux/docs-head"
realpython=$(command -v python3)

fake=not-a-real-token-test-only
fakejob=not-a-real-job-token-test-only
mkdir scratch-tmp

failed=0
check() { # check <description> <condition: 0 = held>
  if [ "$2" -eq 0 ]; then
    echo "ok   $1"
  else
    echo "FAIL $1"
    failed=1
  fi
}
# make the checkout's pages differ from main's, as a changed import would
change_docs() {
  APPEND_FILE="$appendfile" "$realnode" -e '
    const fs = require("fs"), f = process.env.APPEND_FILE;
    const j = JSON.parse(fs.readFileSync(f, "utf8")); j.imported = process.pid;
    fs.writeFileSync(f, JSON.stringify(j));'
}
# back to a clean copy of the commit
reset_tree() {
  cp "$aux/config.orig" .git/config
  [ ! -L assets/docs ] || rm -f assets/docs
  "$realgit" checkout -q -f "$base"
  "$realgit" reset -q --hard "$basecommit"
  rm -f evil.txt; find assets -type p -delete
  "$realgit" clean -qfd -e scratch-tmp
  for b in $("$realgit" for-each-ref --format='%(refname:short)' 'refs/heads/docs/import-*'); do
    "$realgit" branch -q -D "$b"
  done
  cp "$aux/config.orig" .git/config
  find .git/hooks -type f ! -name '*.sample' -delete
  rm -f .git/fsm .git/info/attributes .git/inc.cfg
  rm -rf "$PWD.tmp" "$PWD.tmpX" "$PWD.elsewhere"   # the runner's folder beside the checkout, and look-alikes
}

# What the runner's artifact upload would hold, good and hostile. mkzip.py <out>
# <docs dir> <scenario>: the pages of the commit, with one change (a summary) so
# there is something new, and for a hostile scenario one thing wrong.
cat > "$aux/mkzip.py" <<'PY'
import hashlib, json, os, struct, sys, zipfile, zlib
def png(seed):  # a real 1x1 PNG whose pixel colour is the seed
    def ch(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)) + ch(b'IDAT', zlib.compress(bytes([0, seed & 255, (seed >> 8) & 255, (seed >> 16) & 255]))) + ch(b'IEND', b'')
def jpg(seed): return bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, seed & 255, 0xff, 0xd9])
def gif(seed): return b'GIF89a' + bytes([1, 0, 1, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 1, seed & 255, 0, 0x3b])
def webp(seed):
    tail = b'WEBPVP8L' + bytes([5, 0, 0, 0, 0x2f, 0, 0, 0, seed & 255, 0])
    return b'RIFF' + struct.pack('<I', len(tail)) + tail
def pad(head, size): return head + b'\0' * (size - len(head))
MIB = 1048576
def pname(b, ext): return hashlib.sha256(b).hexdigest()[:16] + '.' + ext
# --head <repo dir> <scenario>: the pictures the checkout (main) already holds, before the import
if sys.argv[1] == '--head':
    repo, sc = sys.argv[2:4]
    os.makedirs(os.path.join(repo, 'assets/docs/img'), exist_ok=True)
    for b in (png(90), png(91)):   # 90 will be dropped by the next import, 91 kept
        open(os.path.join(repo, 'assets/docs/img', pname(b, 'png')), 'wb').write(b)
    sys.exit(0)
out, src, sc = sys.argv[1:4]
open(out + '.imgs', 'w').close()
files = {n: open(os.path.join(src, n), 'rb').read() for n in sorted(os.listdir(src))}
extra = []   # (name, data, unix mode)
def edit(name, fn):
    j = json.loads(files[name]); fn(j); files[name] = json.dumps(j, separators=(',', ':')).encode()
if sc != 'nothing':
    edit('administration.json', lambda j: j['sections'][0].update(summary=j['sections'][0]['summary'] + ' (changed)'))
REG, LNK, CHR = 0o100644, 0o120777, 0o020644
if sc == 'symlinkfile': extra.append(('assets/docs/readme.json', b'/etc/hostname', LNK)); del files['readme.json']
if sc == 'device': extra.append(('assets/docs/readme.json', b'', CHR)); del files['readme.json']
if sc == 'traversal': extra.append(('assets/docs/../../tools/ci/nightly-publish.sh', b'echo pwned', REG))
if sc == 'absolute': extra.append(('/etc/x.json', b'{}', REG))
if sc == 'outside': extra.append(('tools/ci/serve.mjs', b'x', REG))
if sc == 'subdir': extra.append(('assets/docs/sub/x.json', b'{}', REG))
if sc == 'badtype': extra.append(('assets/docs/evil.html', b'<p>x</p>', REG))
if sc == 'webp': extra.append(('assets/docs/pic.webp', b'RIFF', REG))
if sc == 'badname': extra.append(('assets/docs/Evil.json', b'{}', REG))
if sc == 'unknown': extra.append(('assets/docs/other.json', b'{}', REG))
if sc == 'dup': extra.append(('assets/docs/readme.json', files['readme.json'], REG))
if sc == 'missing': del files['security.json']
if sc == 'toolarge': files['administration.json'] = b' ' * 3000000
if sc == 'toomuch':
    for n in ['administration.json', 'architecture.json', 'launcher.json', 'readme.json', 'releases.json']: files[n] = b' ' * 1900000
if sc == 'notjson': files['readme.json'] = b'{'
if sc == 'notobject': files['readme.json'] = b'[]'
if sc == 'xss': edit('index.json', lambda j: j['sources'][0].update(c='#fff"><img src=x onerror=alert(1)>'))
if sc == 'badid': edit('readme.json', lambda j: j['sections'][1].update(id='a"b'))
if sc == 'extrakey': edit('readme.json', lambda j: j['sections'][0].update(onclick='x'))
# a page whose section html carries script-capable markup (the lint refuses it, and so must the publish)
def addhtml(extra): edit('readme.json', lambda j: j['sections'][1].update(html=j['sections'][1]['html'] + extra))
if sc == 'scriptel': addhtml('<script>alert(1)</script>')
# (#72: its src is the mark, a picture the shape check allows, so only the handler is wrong)
if sc == 'handler': addhtml('<p><img src="assets/img/mark.svg" onerror="alert(1)"></p>')
if sc == 'jsurl': addhtml('<p><a href="jav&#x61;script:alert(1)">x</a></p>')
if sc == 'svgel': addhtml('<svg onload="alert(1)"></svg>')
# the control: harmless html that only looks like the above (entities, "on x=" and data: in prose)
if sc == 'benign': addhtml('<p>Use <a href="https://example.com/a?b=1&amp;c=2">link</a> and <code>one = 1</code> on a=b, data: x</p>')
# pictures (#72): (name, data, mode) entries under assets/docs/img/, and the page html that uses them
pics = []
def usepics(names):
    addhtml(''.join('<p><img src="assets/docs/img/%s" alt="" loading="lazy"></p>' % n for n in names))
def addpic(data, ext, used=True, name=None, mode=REG):
    n = name or pname(data, ext); pics.append((n, data, mode))
    if used: usepics([n])
    return n
imgdir = True
if sc in ('pic', 'picnodir'): addpic(png(1), 'png'); imgdir = sc == 'pic'
if sc == 'picall': addpic(png(2), 'png'); addpic(jpg(3), 'jpg'); addpic(gif(4), 'gif'); addpic(webp(5), 'webp')
if sc == 'pic1mib': addpic(pad(b'\x89PNG\r\n\x1a\n', MIB), 'png')
if sc == 'pics128':
    for i in range(128): addpic(png(1000 + i), 'png')
if sc == 'pictoomany':
    for i in range(129): addpic(png(1000 + i), 'png')
if sc == 'picswap': addpic(png(91), 'png'); addpic(png(92), 'png')
# the same as `pic`, with one thing wrong each
if sc == 'picsvg': addpic(b'<svg xmlns="http://www.w3.org/2000/svg"/>', 'svg', used=False)
if sc == 'picupper': addpic(png(1), 'png', name=pname(png(1), 'png').upper().replace('.PNG', '.png'))
if sc == 'picjpeg': addpic(jpg(3), 'jpeg')
if sc == 'pictoolarge': addpic(pad(b'\x89PNG\r\n\x1a\n', MIB + 1), 'png')
if sc == 'picmismatch': addpic(jpg(3), 'png')
if sc == 'picunused': addpic(png(1), 'png', used=False)
if sc == 'picsymlink': addpic(b'/etc/hostname', 'png', name=pname(png(1), 'png'), mode=LNK)
if sc == 'picsub': pics.append(('sub/' + pname(png(1), 'png'), png(1), REG)); usepics(['sub/' + pname(png(1), 'png')])
if sc == 'picbadsrc': addpic(png(1), 'png'); usepics(['../../../index.html'])
if sc == 'picraw': addpic(png(1), 'png'); addhtml('<p><img src="https://raw.githubusercontent.com/tomlawesome/orbit/main/docs/a.png" alt=""></p>')
if sc == 'picasfile': extra.append(('assets/docs/img', b'x', REG)); imgdir = False
if sc == 'notzip':
    open(out, 'wb').write(b'this is not a zip archive'); sys.exit(0)
def zi(name, mode):
    z = zipfile.ZipInfo(name); z.external_attr = mode << 16; z.compress_type = zipfile.ZIP_DEFLATED; return z
with zipfile.ZipFile(out, 'w') as z:
    for d in ('assets/', 'assets/docs/') + (('assets/docs/img/',) if pics and imgdir else ()):    # the directory entries a runner's archive carries
        z.writestr(zi(d, 0o040755), b'')
    for n, data in files.items(): z.writestr(zi('assets/docs/' + n, REG), data)
    for n, data, mode in extra: z.writestr(zi(n, mode), data)
    for n, data, mode in pics: z.writestr(zi('assets/docs/img/' + n, mode), data)
# the pictures a good archive carries, for the test to compare with the merge request's
open(out + '.imgs', 'w').write(''.join(n + '\n' for n, d, m in sorted(pics)))
PY

# ---------------------------------------------------------------- part 1 --
# The import job. A fake token is in its environment, as if the variable had
# been left unscoped: the script must still never read, print, write or send it.
j1="$aux/j1"; mkdir -p "$j1/bin"
cat > "$j1/bin/npm" <<'SHIM'
#!/bin/sh
echo "npm cwd=$PWD $*" >> "$J1LOG"
exit 0
SHIM
cat > "$j1/bin/node" <<'SHIM'
#!/bin/sh
case "$*" in
  *import-docs.mjs*)
    echo "node cwd=$PWD $*" >> "$J1LOG"
    case "$SCENARIO" in
      changed) APPEND_FILE=$(ls assets/docs/*.json | head -n 1) "$REAL_NODE" -e '
        const fs = require("fs"), f = process.env.APPEND_FILE;
        const j = JSON.parse(fs.readFileSync(f, "utf8")); j.imported = process.pid;
        fs.writeFileSync(f, JSON.stringify(j));' ;;
      empty) rm -f assets/docs/*.json ;;
    esac
    exit 0 ;;
esac
exec "$REAL_NODE" "$@"
SHIM
# any call to curl is a failure of the design: this half makes no API call
cat > "$j1/bin/curl" <<'SHIM'
#!/bin/sh
echo "curl $*" | sed "s/$FAKE/<token>/g" >> "$J1LOG"
exit 22
SHIM
cat > "$j1/bin/git" <<'SHIM'
#!/bin/sh
echo "git $*" >> "$J1LOG"
exec "$REAL_GIT" "$@"
SHIM
chmod +x "$j1"/bin/*

run_job1() { # run_job1 <outfile> <DRY_RUN value> <scenario>
  : > "$j1/log"
  rc=0
  env ORBIT_SITE_IMPORT_TOKEN="$fake" PATH="$j1/bin:$PATH" J1LOG="$j1/log" FAKE="$fake" \
    REAL_GIT="$realgit" REAL_NODE="$realnode" SCENARIO="$3" DRY_RUN="$2" TMPDIR="$tmp/scratch-tmp" \
    sh tools/ci/nightly-import.sh > "$1" 2>&1 || rc=$?
}

# Run 1: a real run (in the checkout), nothing changed.
out=$(mktemp)
run_job1 "$out" "" nothing
rc1=$rc
rc=0; [ "$rc1" -eq 0 ] && grep -q '^assets/docs: [1-9][0-9]* files' "$out" || rc=1
check "job 1: an import exits 0 and reports the pages it wrote (exit $rc1)" "$rc"
[ "$rc" -eq 0 ] || sed 's/^/     /' "$out"
npm_lines=$(grep '^npm ' "$j1/log" || true)
node_lines=$(grep '^node ' "$j1/log" || true)
rc=0; [ "$(printf '%s' "$npm_lines" | grep -c '^npm ' || true)" -eq 1 ] || rc=1
check "job 1: npm ran exactly once" "$rc"
rc=0; [ "$(printf '%s' "$node_lines" | grep -c '^node ' || true)" -eq 1 ] || rc=1
check "job 1: node ran exactly once" "$rc"
rc=0; printf '%s\n' "$npm_lines" | grep -q ' ci ' || rc=1
check "job 1: the install is npm ci (from the lockfile)" "$rc"
rc=0; printf '%s\n' "$npm_lines" | grep -q -e '--ignore-scripts' || rc=1
check "job 1: the install runs with --ignore-scripts" "$rc"
rc=0; printf '%s\n' "$npm_lines" | grep -q -e '--prefix tools' || rc=1
check "job 1: the install goes into tools/ (--prefix tools)" "$rc"
rc=0; ! printf '%s\n' "$npm_lines" | grep -q -e 'marked@' -e 'sharp@' || rc=1
check "job 1: the install names no package version (they live in tools/package.json)" "$rc"
rc=0; printf '%s\n' "$node_lines" | grep -q "cwd=$tmp .*tools/import-docs\.mjs\$" || rc=1
check "job 1: the import is node tools/import-docs.mjs, in the checkout" "$rc"
rc=0; ! grep -q '^curl ' "$j1/log" || rc=1
check "job 1: no API call (curl was not run)" "$rc"
rc=0; ! grep -q -e '^git .*push' -e '^git .*https\?://' "$j1/log" || rc=1
check "job 1: no git push, and no git command with a URL" "$rc"
rc=0; ! grep -q '^git ' "$j1/log" || rc=1
check "job 1: a real run runs no git at all" "$rc"
rc=0; ! grep -rq "$fake" "$out" "$j1/log" "$tmp/scratch-tmp" || rc=1
check "job 1: the token is not in the output, a log or the scratch directory" "$rc"
rc=0; ! grep -q 'ORBIT_SITE_IMPORT_TOKEN' tools/ci/nightly-import.sh || rc=1
check "job 1: the script does not name the token" "$rc"
rc=0; [ -z "$("$realgit" status --porcelain --untracked-files=no)" ] || rc=1
check "job 1: with nothing changed, no tracked file moved" "$rc"

# Run 2: the import writes nothing -> the job fails rather than hand on an empty artifact.
run_job1 "$out" "" empty
rc2=$rc
rc=0; [ "$rc2" -ne 0 ] && grep -q 'wrote no pages' "$out" || rc=1
check "job 1: an import that writes no pages fails (exit $rc2)" "$rc"
reset_tree

# Run 3: a dry run, the import changes a page. It reports, in a copy.
run_job1 "$out" 1 changed
rc3=$rc
rc=0; [ "$rc3" -eq 0 ] && grep -q 'DRY_RUN: would hand on a changed assets/docs' "$out" \
  && grep -q "$appendfile" "$out" || rc=1
check "job 1: a dry run reports what it would hand on (exit $rc3)" "$rc"
[ "$rc" -eq 0 ] || sed 's/^/     /' "$out"
rc=0; [ -z "$("$realgit" status --porcelain --untracked-files=no)" ] && ! grep -q "cwd=$tmp " "$j1/log" || rc=1
check "job 1: a dry run leaves the checkout alone and works in a copy" "$rc"
rc=0; ! grep -q '^curl ' "$j1/log" && ! grep -v '^git archive' "$j1/log" | grep -q '^git ' || rc=1
check "job 1: a dry run makes no API call and runs only git archive" "$rc"
rc=0; ! grep -rq "$fake" "$out" "$j1/log" || rc=1
check "job 1: a dry run does not show the token" "$rc"

# Run 4: a dry run, nothing changed.
run_job1 "$out" 1 nothing
rc4=$rc
rc=0; [ "$rc4" -eq 0 ] && grep -q 'DRY_RUN: nothing new' "$out" || rc=1
check "job 1: a dry run with nothing changed says so (exit $rc4)" "$rc"
reset_tree

# ---------------------------------------------------------------- part 2 --
# The publish job. Shims on PATH stand in for GitLab (curl), the GitLab remote
# (git push to an https URL), npm (which must never be called) and the wait
# between attempts (sleep). node is the real one, logged. The artifact is what
# the checkout's assets/docs holds when the script starts, as after the runner
# unpacks it; each scenario prepares it, good or hostile.
pbin="$aux/bin"
mkdir -p "$pbin"
cat > "$pbin/npm" <<'SHIM'
#!/bin/sh
echo "npm $*" >> "$STATE/npm.log"
exit 1
SHIM
cat > "$pbin/node" <<'SHIM'
#!/bin/sh
# logs every call (the publish runs node only for -e, never a file), and notes if
# a token file (the header or the credential file) is on disk while node runs
echo "node $1" >> "$STATE/node.log"
if find "$TMPDIR" \( -name hdr -o -name cred \) 2>/dev/null | grep -q .; then
  echo "token file on disk during node" >> "$STATE/node-bad.log"
fi
exec "$REAL_NODE" "$@"
SHIM
cat > "$pbin/git" <<'SHIM'
#!/bin/sh
# Real git, except a push to an https URL: that is GitLab, and is only logged.
# Every call is logged with whether the token was in its environment and whether
# hooks and fsmonitor were switched off on its command line (never the token).
h=n; case " $* " in *" core.hooksPath=/dev/null "*) h=y ;; esac
f=n; case " $* " in *" core.fsmonitor=false "*) f=y ;; esac
t=UNSET; [ -z "${ORBIT_SITE_IMPORT_TOKEN+x}" ] || t=SET
echo "git $t hooks=$h fsm=$f $*" >> "$STATE/git.log"
case "$1" in
  push) ;;
  *) case " $* " in *" push "*) ;; *) exec "$REAL_GIT" "$@" ;; esac ;;
esac
case "$*" in
  *https://*) echo "git $*" | sed "s/$FAKE/<token>/g" >> "$STATE/shim.log"
    [ "$SCENARIO" != pushfail ] || { echo "remote: HTTP 403" >&2; exit 1; }
    exit 0 ;;
esac
exec "$REAL_GIT" "$@"
SHIM
cat > "$pbin/sleep" <<'SHIM'
#!/bin/sh
# whether the header file (named hdr, under TMPDIR) is on disk during the wait
if find "$TMPDIR" -name hdr 2>/dev/null | grep -q .; then h=present; else h=absent; fi
echo "sleep $* hdr=$h" >> "$STATE/shim.log"
exit 0
SHIM
cat > "$pbin/curl" <<'SHIM'
#!/bin/sh
# A small imitation of curl against a fake GitLab. Logs method, path and data
# arguments to $STATE/api.log; never the contents of a header file.
method=GET; url=; fail=; failbody=; outf=; wfmt=; data=; hdr=no; kind=none; tflags=; connfail=; ismerge=
takes() { # takes <flag> <value>
  case $1 in
    X) method=$2 ;;
    o) outf=$2 ;;
    w) wfmt=$2 ;;
    d|data-urlencode|data|data-raw) data="$data|$2" ;;
    H|header) # only whether a -H @file carries the token is kept, never the token
      case $2 in
        @*) hfile=${2#@}
            if [ -f "$hfile" ] && grep -q "^PRIVATE-TOKEN: $FAKE\$" "$hfile"; then hdr=yes; kind=import
        elif [ -f "$hfile" ] && grep -q "^JOB-TOKEN: $FAKE_JOB\$" "$hfile"; then kind=job; fi ;;
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
    --data-urlencode|--data|--data-raw|--max-time|--retry|--connect-timeout|--retry-delay|--max-filesize)
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
          s|S|L|k|v|i|g|q) ;;
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
  "GET /merge_requests") code=200; body='[]'
    if [ -n "$OLDMR" ]; then body='[{"iid":7,"source_branch":"docs/import-20260101-0000","source_project_id":1,"target_project_id":1},{"iid":8,"source_branch":"docs/import-20260102-0000","source_project_id":2,"target_project_id":1}]'; fi ;;
  "GET /repository/branches") code=200; body='[]'
    if [ -n "$STALE" ]; then
      now=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
      body='[{"name":"docs/import-20260101-0000","commit":{"committed_date":"2026-01-01T00:00:00.000Z"}},{"name":"docs/import-20260102-0000","commit":{"committed_date":"2026-01-02T00:00:00.000Z"}},{"name":"docs/import-20260103-0000","commit":{"committed_date":"2026-01-03T00:00:00.000Z"}},{"name":"docs/import-20260104-0000","commit":{"committed_date":"'$now'"}},{"name":"docs/import-20260105-0000"},{"name":"docs/importer","commit":{"committed_date":"2026-01-01T00:00:00.000Z"}},{"name":"main"}]'
    fi ;;
  "DELETE /repository/branches/docs%2Fimport-20260103-0000"|"DELETE /repository/branches/docs%2Fimport-20260102-0000") code=204; body= ;;
  "PUT /merge_requests/7") code=200; body='{"iid":7,"state":"closed"}' ;;
  "DELETE /repository/branches/docs%2Fimport-20260101-0000") code=204; body= ;;
  "POST /merge_requests") code=201; body='{"iid":42}'
    if [ "$SCENARIO" = noiid ]; then body='{"message":"created, but no iid"}'; fi ;;
  "PUT /merge_requests/42/merge")
    n=$(cat "$STATE/merge-n" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$STATE/merge-n"
    ismerge=1
    okmerge=; case $SCENARIO in second|benign|scriptel|handler|jsurl|svgel|hook|pushfail|stage|runnerlike|runnerinc|nlval|pic*) okmerge=1 ;; esac
    if [ -n "$okmerge" ] && [ "$n" -ge 2 ]; then
      code=200; body='{"iid":42,"merge_when_pipeline_succeeds":true}'
    elif [ "$SCENARIO" = conn ] && [ "$n" -ge 2 ]; then
      # first attempt 405 with a body; every later one cannot connect at all
      code=000; body=; connfail=1
    else
      code=405; body='{"message":"405 Method Not Allowed"}'
    fi ;;
  "GET ") code=200; body='{"path_with_namespace":"ai/orbit-site"}'
    [ "$SCENARIO" != wrongproject ] || body='{"path_with_namespace":"someone/else"}' ;;
  "GET /pipelines/77/jobs") code=200
    job='{"id":555,"name":"import_docs","status":"success","ref":"main","pipeline":{"id":77,"sha":"'$HEADSHA'"},"artifacts":[{"file_type":"archive","size":1}]}'
    case $SCENARIO in
      nojob) body='[{"id":556,"name":"publish_docs","status":"running","ref":"main","pipeline":{"id":77,"sha":"'$HEADSHA'"},"artifacts":[]}]' ;;
      failedjob) body='[{"id":555,"name":"import_docs","status":"failed","ref":"main","pipeline":{"id":77,"sha":"'$HEADSHA'"},"artifacts":[{"file_type":"archive","size":1}]}]' ;;
      wrongsha) body='[{"id":555,"name":"import_docs","status":"success","ref":"main","pipeline":{"id":77,"sha":"0000000000000000000000000000000000000000"},"artifacts":[{"file_type":"archive","size":1}]}]' ;;
      wrongpipeline) body='[{"id":555,"name":"import_docs","status":"success","ref":"main","pipeline":{"id":76,"sha":"'$HEADSHA'"},"artifacts":[{"file_type":"archive","size":1}]}]' ;;
      twojobs) body="[$job,$job]" ;;
      *) body="[$job]" ;;
    esac ;;
  "GET /jobs/555/artifacts") code=200; body= ;;
  *) note=" UNEXPECTED" ;;
esac
echo "$method $route$data$note" >> "$STATE/api.log"
echo "$method $route $kind" >> "$STATE/tok.log"
echo "api $method $route" >> "$STATE/git.log"
if [ -n "$ismerge" ]; then # one line per merge PUT: header ok?, timeout flags, sha sent
  query=; case $path in *\?*) query=${path#*\?} ;; esac
  sha=$(printf '%s|%s' "$data" "$query" | tr '|&' '\n\n' | sed -n 's/^sha=//p' | head -n 1)
  echo "hdr=$hdr flags=${tflags# } sha=$sha" >> "$STATE/merge.log"
fi
# No connection: no body is written (an old -o file is left as it was), the
# write-out says 000, curl complains on stderr and exits 7.
if [ -n "$connfail" ]; then :
elif [ -z "$fail" ] || [ "$code" -lt 400 ] || [ -n "$failbody" ]; then
  if [ "$route" = /jobs/555/artifacts ] && [ -n "$outf" ]; then cp "$ZIP" "$outf"
  elif [ -n "$outf" ]; then printf '%s\n' "$body" > "$outf"; else printf '%s\n' "$body"; fi
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

# prepare <scenario>: the checkout as the runner leaves it for the publish job (a
# fresh clone), good or hostile; the archive is made apart, by mkzip.py
prepare() {
  case $1 in
    hook) # what could be left in .git: none of it may run
      for h in pre-commit commit-msg post-commit post-checkout reference-transaction pre-push pre-receive; do
        printf '#!/bin/sh\necho "$0" >> "%s/hook-ran"\n' "$aux" > ".git/hooks/$h"
        chmod +x ".git/hooks/$h"
      done
      printf '#!/bin/sh\necho ran >> "%s/fsmonitor-ran"\n' "$aux" > .git/fsm
      chmod +x .git/fsm ;;
    fsmonitorcfg) # an fsmonitor program named in the config
      printf '#!/bin/sh\necho ran >> "%s/fsmonitor-ran"\n' "$aux" > .git/fsm
      chmod +x .git/fsm
      printf '[core]\n\tfsmonitor = %s/.git/fsm\n' "$PWD" >> .git/config ;;
    cfg) # a clean filter in the checkout's own config, switched on by info/attributes
      printf '[filter "x"]\n\tclean = sh -c "echo ran >> %s/filter-ran; cat"\n' "$aux" >> .git/config
      echo '* filter=x' > .git/info/attributes ;;
    cfgonly) # the filter without the attributes file: still refused
      printf '[filter "x"]\n\tclean = sh -c "echo ran >> %s/filter-ran; cat"\n' "$aux" >> .git/config ;;
    include) printf '[include]\n\tpath = /nonexistent\n' >> .git/config ;;
    runnerinc) # the runner's own layout: .git/config includes <checkout>.tmp/.gitlab-runner.ext.conf (its keys + lfs)
      mkdir -p "$PWD.tmp"
      printf '[credential "https://gitlab.invalid"]\n\thelper = !true\n[url "https://gitlab.invalid/"]\n\tinsteadOf = ssh://git@gitlab.invalid/\n[lfs]\n\trepositoryformatversion = 0\n' > "$PWD.tmp/.gitlab-runner.ext.conf"
      printf '[include]\n\tpath = %s.tmp/.gitlab-runner.ext.conf\n' "$PWD" >> .git/config ;;
    incevil) # another file in <checkout>.tmp/, allowed keys
      mkdir -p "$PWD.tmp"
      printf '[credential "https://gitlab.invalid"]\n\thelper = !true\n' > "$PWD.tmp/evil"
      printf '[include]\n\tpath = %s.tmp/evil\n' "$PWD" >> .git/config ;;
    incgtpl) # the runner's template folder file: not the one include accepted
      mkdir -p "$PWD.tmp/git-template"
      printf '[credential "https://gitlab.invalid"]\n\thelper = !true\n' > "$PWD.tmp/git-template/config"
      printf '[include]\n\tpath = %s.tmp/git-template/config\n' "$PWD" >> .git/config ;;
    incsib) # a sibling folder with the same prefix, the right file name inside, allowed keys
      mkdir -p "$PWD.tmpX"
      printf '[credential "https://gitlab.invalid"]\n\thelper = !true\n' > "$PWD.tmpX/.gitlab-runner.ext.conf"
      printf '[include]\n\tpath = %s.tmpX/.gitlab-runner.ext.conf\n' "$PWD" >> .git/config ;;
    incdots) # a path through <checkout>.tmp/.. that resolves to another folder holding the file
      mkdir -p "$PWD.tmp" "$PWD.elsewhere"
      printf '[credential "https://gitlab.invalid"]\n\thelper = !true\n' > "$PWD.elsewhere/.gitlab-runner.ext.conf"
      printf '[include]\n\tpath = %s.tmp/../%s.elsewhere/.gitlab-runner.ext.conf\n' "$PWD" "${PWD##*/}" >> .git/config ;;
    incdotsame) # a path with .. that resolves to the right file: not the exact value, so refused
      mkdir -p "$PWD.tmp/sub"
      printf '[credential "https://gitlab.invalid"]\n\thelper = !true\n' > "$PWD.tmp/.gitlab-runner.ext.conf"
      printf '[include]\n\tpath = %s.tmp/sub/../.gitlab-runner.ext.conf\n' "$PWD" >> .git/config ;;
    incdirlink) # <checkout>.tmp is a symlink to another folder that holds the file
      mkdir -p "$aux/runnerdir"
      printf '[credential "https://gitlab.invalid"]\n\thelper = !true\n' > "$aux/runnerdir/.gitlab-runner.ext.conf"
      ln -s "$aux/runnerdir" "$PWD.tmp"
      printf '[include]\n\tpath = %s.tmp/.gitlab-runner.ext.conf\n' "$PWD" >> .git/config ;;
    inclink) # the file itself is a symlink to a regular file with the right name
      mkdir -p "$PWD.tmp/real"
      printf '[credential "https://gitlab.invalid"]\n\thelper = !true\n' > "$PWD.tmp/real/.gitlab-runner.ext.conf"
      ln -s "$PWD.tmp/real/.gitlab-runner.ext.conf" "$PWD.tmp/.gitlab-runner.ext.conf"
      printf '[include]\n\tpath = %s.tmp/.gitlab-runner.ext.conf\n' "$PWD" >> .git/config ;;
    increlcwd) # relative: from the checkout it is the right file, from .git/ (where git resolves it) another one
      mkdir -p "$PWD.tmp" "$PWD/${PWD##*/}.tmp"
      printf '[credential "https://gitlab.invalid"]\n\thelper = !true\n' > "$PWD.tmp/.gitlab-runner.ext.conf"
      printf '[credential "https://gitlab.invalid"]\n\thelper = !true\n' > "$PWD/${PWD##*/}.tmp/.gitlab-runner.ext.conf"
      printf '[include]\n\tpath = ../%s.tmp/.gitlab-runner.ext.conf\n' "${PWD##*/}" >> .git/config ;;
    inccycle) # the accepted file includes itself: git cannot list the config
      mkdir -p "$PWD.tmp"
      printf '[include]\n\tpath = %s.tmp/.gitlab-runner.ext.conf\n' "$PWD" > "$PWD.tmp/.gitlab-runner.ext.conf"
      printf '[include]\n\tpath = %s.tmp/.gitlab-runner.ext.conf\n' "$PWD" >> .git/config ;;
    nlval) # one value with a newline and key-shaped text in it, in an allowed key: one value, accepted
      printf '[remote "origin"]\n\turl = "https://gitlab.invalid/ai/orbit-site.git\\ncore.sshCommand=evil"\n' >> .git/config ;;
    nlreal) # the same value, and a real core.sshCommand after it: refused for the real one
      printf '[remote "origin"]\n\turl = "https://gitlab.invalid/ai/orbit-site.git\\ncredential.helper=x"\n[core]\n\tsshCommand = evil\n' >> .git/config ;;
    incelse) # an absolute include.path to a harmless file elsewhere (outside the checkout and <checkout>.tmp/)
      printf '[credential "https://gitlab.invalid"]\n\thelper = !true\n' > "$aux/runner.cfg"
      printf '[include]\n\tpath = %s/runner.cfg\n' "$aux" >> .git/config ;;
    inctab) # a value with a tab: the part before it is the right file, the whole value is not a file
      mkdir -p "$PWD.tmp"
      printf '[credential "https://gitlab.invalid"]\n\thelper = !true\n' > "$PWD.tmp/.gitlab-runner.ext.conf"
      printf '[include]\n\tpath = %s.tmp/.gitlab-runner.ext.conf\tx\n' "$PWD" >> .git/config ;;
    increl) # a relative include.path: git resolves it against .git/, so this reaches the work tree
      printf '[credential]\n\tinteractive = never\n' > inc.cfg
      printf '[include]\n\tpath = ../inc.cfg\n' >> .git/config ;;
    incwork) # an absolute include.path to a file inside the work tree
      printf '[credential]\n\tinteractive = never\n' > inc.cfg
      printf '[include]\n\tpath = %s/inc.cfg\n' "$PWD" >> .git/config ;;
    incgit) # an absolute include.path to a file under .git (inside the work tree)
      printf '[credential]\n\tinteractive = never\n' > .git/inc.cfg
      printf '[include]\n\tpath = %s/.git/inc.cfg\n' "$PWD" >> .git/config ;;
    incssh) # the accepted include holding core.sshCommand
      mkdir -p "$PWD.tmp"
      printf '[core]\n\tsshCommand = sh -c "echo ran >> %s/filter-ran"\n' "$aux" > "$PWD.tmp/.gitlab-runner.ext.conf"
      printf '[include]\n\tpath = %s.tmp/.gitlab-runner.ext.conf\n' "$PWD" >> .git/config ;;
    incfsmon) # the accepted include naming an fsmonitor program
      mkdir -p "$PWD.tmp"
      printf '[core]\n\tfsmonitor = %s/fsm\n' "$aux" > "$PWD.tmp/.gitlab-runner.ext.conf"
      printf '[include]\n\tpath = %s.tmp/.gitlab-runner.ext.conf\n' "$PWD" >> .git/config ;;
    incfilter) # the accepted include holding a clean filter
      mkdir -p "$PWD.tmp"
      printf '[filter "x"]\n\tclean = sh -c "echo ran >> %s/filter-ran; cat"\n' "$aux" > "$PWD.tmp/.gitlab-runner.ext.conf"
      printf '[include]\n\tpath = %s.tmp/.gitlab-runner.ext.conf\n' "$PWD" >> .git/config ;;
    incnest) # the accepted include includes a second file in <checkout>.tmp/ holding core.sshCommand
      mkdir -p "$PWD.tmp"
      printf '[core]\n\tsshCommand = sh -c "echo ran >> %s/filter-ran"\n' "$aux" > "$PWD.tmp/second.cfg"
      printf '[include]\n\tpath = %s.tmp/second.cfg\n' "$PWD" > "$PWD.tmp/.gitlab-runner.ext.conf"
      printf '[include]\n\tpath = %s.tmp/.gitlab-runner.ext.conf\n' "$PWD" >> .git/config ;;
    incnestmiss) # the accepted include includes a missing file
      mkdir -p "$PWD.tmp"
      printf '[include]\n\tpath = %s.tmp/no-such-file.cfg\n' "$PWD" > "$PWD.tmp/.gitlab-runner.ext.conf"
      printf '[include]\n\tpath = %s.tmp/.gitlab-runner.ext.conf\n' "$PWD" >> .git/config ;;
    includeif) # a conditional include, even to a harmless file
      printf '[credential]\n\tinteractive = never\n' > "$aux/runner.cfg"
      printf '[includeIf "gitdir:/x"]\n\tpath = %s/runner.cfg\n' "$aux" >> .git/config ;;
    worktreecfg) printf '[extensions]\n\tworktreeConfig = true\n' >> .git/config ;;
    runnerlike) # what a runner's clone writes besides git's own: all of it allowed
      printf '[remote "origin"]\n\turl = https://gitlab-ci-token:x@gitlab.invalid/ai/orbit-site.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[init]\n\tdefaultBranch = none\n[fetch]\n\trecurseSubmodules = false\n[credential]\n\tinteractive = never\n[gc]\n\tautoDetach = false\n[credential "https://gitlab.invalid"]\n\thelper = !true\n[url "https://gitlab.invalid/"]\n\tinsteadOf = ssh://git@gitlab.invalid/\n[http]\n\tuserAgent = x\n' >> .git/config ;;
    stage) # changes staged in the checkout's own index, the files since put back: none may reach the commit
      echo evil > evil.txt
      echo "<!-- planted -->" >> index.html
      "$realgit" add evil.txt index.html
      rm evil.txt
      "$realgit" show HEAD:index.html > index.html ;;
    tampered) echo "<!-- planted -->" >> index.html ;;
    picgone|picswap) # main already holds two pictures (#72); the commit is what the clone has as HEAD
      "$realpython" -W ignore "$aux/mkzip.py" --head "$PWD" "$1"
      "$realgit" add assets/docs/img
      "$realgit" -c user.name=t -c user.email=t@t commit -q -m "two pictures" ;;
  esac
}
run_push() { # run_push <outfile> <scenario>
  outfile=$1
  # a clean scratch repository and state for every run
  reset_tree
  rm -rf scratch-tmp; mkdir scratch-tmp
  rm -f "$aux"/api.log "$aux"/shim.log "$aux"/merge-n "$aux"/merge.log "$aux"/git.log "$aux"/npm.log \
    "$aux"/node.log "$aux"/node-bad.log "$aux"/hook-ran "$aux"/fsmonitor-ran "$aux"/filter-ran
  : > "$aux/api.log"; : > "$aux/shim.log"; : > "$aux/merge.log"; : > "$aux/git.log"
  : > "$aux/npm.log"; : > "$aux/node.log"; : > "$aux/node-bad.log"
  rm -f "$aux"/tok.log; : > "$aux/tok.log"
  prepare "$2"
  headsha=$basecommit     # unless the scenario's main already holds pictures
  case $2 in picgone|picswap) headsha=$("$realgit" rev-parse HEAD) ;; esac
  "$realpython" -W ignore "$aux/mkzip.py" "$aux/artifact.zip" "$aux/docs-head" "$2"
  rc=0
  env -i HOME="$aux" ORBIT_SITE_IMPORT_TOKEN="$fake" CI_JOB_TOKEN="$fakejob" \
    FAKE_JOB="$fakejob" CI_PIPELINE_ID=77 HEADSHA="$headsha" ZIP="$aux/artifact.zip" \
    CI_COMMIT_BRANCH=main CI_PIPELINE_SOURCE=schedule GIT_STRATEGY=clone \
    PATH="$pbin:$PATH" STATE="$aux" SCENARIO="$2" FAKE="$fake" \
    REAL_GIT="$realgit" REAL_NODE="$realnode" \
    TMPDIR="$tmp/scratch-tmp" CI_API_V4_URL=https://gitlab.invalid/api/v4 CI_PROJECT_ID=1 \
    CI_SERVER_HOST=gitlab.invalid CI_PROJECT_PATH=ai/orbit-site OLDMR="${oldmr:-}" STALE="${stale:-}" DRY_RUN="${dry:-}" \
    sh tools/ci/nightly-publish.sh > "$outfile" 2>&1 || rc=$?
  merge_puts=$(grep -c '^PUT /merge_requests/42/merge' "$aux/api.log" || true)
  bare_puts=$(grep '^PUT /merge_requests/42/merge' "$aux/api.log" | grep -vc 'auto_merge=true' || true)
  sleeps=$(grep -c '^sleep ' "$aux/shim.log" || true)
  # the commit the publish pushed: the real tip of the docs/import-* branch it made
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

# Run 5: the environment is pinned and all three tokens are needed. Each refusal
# comes before any call to GitLab. pin_run <script dir> [VAR=value ...] runs the
# script in a clean environment, the good one plus the given changes.
pin_run() {
  dir=$1; shift
  : > "$aux/api.log"; : > "$aux/tok.log"
  rc=0
  ( cd "$dir" && env -i PATH="$pbin:$PATH" REAL_GIT="$realgit" REAL_NODE="$realnode" HOME="$aux" TMPDIR="$tmp/scratch-tmp" STATE="$aux" SCENARIO=none \
      FAKE="$fake" FAKE_JOB="$fakejob" \
      ORBIT_SITE_IMPORT_TOKEN="$fake" CI_JOB_TOKEN="$fakejob" CI_PIPELINE_ID=77 \
      CI_API_V4_URL=https://gitlab.invalid/api/v4 CI_PROJECT_ID=1 CI_SERVER_HOST=gitlab.invalid CI_PROJECT_PATH=ai/orbit-site \
      CI_COMMIT_BRANCH=main CI_PIPELINE_SOURCE=schedule ${pin_strategy:+GIT_STRATEGY=$pin_strategy} "$@" sh tools/ci/nightly-publish.sh ) > "$out" 2>&1 || rc=$?
}
# The job runs with GIT_STRATEGY=clone (the CI file sets it, #60 round 4), and the script
# refuses to run without it. So every run here has it, as the runner gives it; pin_strategy
# is that default, and a scenario for another value (or none) sets it first, or passes
# GIT_STRATEGY=value among the changes, which comes later and wins.
pin_strategy=clone
pinned() { # pinned <label> <script dir> <text the refusal must carry> [VAR=value ...]
  label=$1; dir=$2; want=$3; shift 3
  pin_run "$dir" "$@"
  rcp=$rc
  rc=0; [ "$rcp" -ne 0 ] && grep -q -e "$want" "$out" || rc=1
  check "job 2 refuses to run $label (exit $rcp)" "$rc"
  [ "$rc" -eq 0 ] || sed 's/^/     /' "$out"
  rc=0; [ ! -s "$aux/api.log" ] && [ ! -s "$aux/tok.log" ] && ! grep -q -e "$fake" -e "$fakejob" "$out" || rc=1
  check "job 2: after refusing to run $label, nothing was sent to GitLab and no token was shown" "$rc"
}
pinned "without the import token" "$tmp" "ORBIT_SITE_IMPORT_TOKEN is not set" ORBIT_SITE_IMPORT_TOKEN=
pinned "without the job token" "$tmp" "CI_JOB_TOKEN" CI_JOB_TOKEN=
pinned "on the real script's host (the test's is not it)" "$aux/pristine" "CI_SERVER_HOST is not gitlab.tomlawson.io"
pinned "with another API address" "$tmp" "CI_API_V4_URL is not" CI_API_V4_URL=https://evil.invalid/api/v4
pinned "in another project" "$tmp" "CI_PROJECT_PATH is not" CI_PROJECT_PATH=evil/x
pinned "with a project id that is not a number" "$tmp" "CI_PROJECT_ID is not a number" "CI_PROJECT_ID=1/../2"
pinned "off main" "$tmp" "CI_COMMIT_BRANCH is not main" CI_COMMIT_BRANCH=dev
pinned "from a pipeline that is not a schedule" "$tmp" "CI_PIPELINE_SOURCE is not schedule" CI_PIPELINE_SOURCE=push
for v in LD_LIBRARY_PATH=/nonexistent NODE_OPTIONS=--version GIT_EXEC_PATH=/x GIT_SSH_COMMAND=x PYTHONPATH=/x SSL_CERT_FILE=/x OPENSSL_CONF=/x BASH_ENV=/x; do
  pinned "with ${v%%=*} set" "$tmp" "refusing to run: ${v%%=*} is set" "$v"
done
# the runner's own CA file, and its own variables, are not refused
pin_run "$tmp" SSL_CERT_FILE=/ca.pem CI_SERVER_TLS_CA_FILE=/ca.pem NODE_VERSION=22.0.0 GIT_DEPTH=1 GIT_STRATEGY=clone
rc=0; ! grep -q 'is set in the environment' "$out" || rc=1
check "job 2: the runner's own CA file, NODE_VERSION, GIT_DEPTH and GIT_STRATEGY are not refused" "$rc"

# The guard names a variable that exists (audit 4). A harmless variable whose
# VALUE holds a newline and then text shaped like an assignment is one variable,
# HARMLESS_NOTE; it must not be read as a second, GIT_FAKE, and being harmless it
# must not be refused at all. Control: a real GIT_FAKE is refused, by name.
multiline=$(printf 'line one\nGIT_FAKE=1')
pin_run "$tmp" "HARMLESS_NOTE=$multiline"
rc=0; ! grep -q 'GIT_FAKE' "$out" || rc=1
check "job 2: a newline and GIT_FAKE=1 inside a harmless variable's value does not name GIT_FAKE" "$rc"
[ "$rc" -eq 0 ] || sed 's/^/     /' "$out"
rc=0; ! grep -q 'is set in the environment' "$out" && grep -q '^== the checkout' "$out" || rc=1
check "job 2: a harmless variable whose value holds a newline is not refused" "$rc"
[ "$rc" -eq 0 ] || sed 's/^/     /' "$out"
pinned "with a real GIT_FAKE set (control for the newline case)" "$tmp" "refusing to run: GIT_FAKE is set" GIT_FAKE=1

# The pipeline's own variables are not refused (#18). GitLab puts every variable
# of .gitlab-ci.yml's top-level `variables:` and of publish_docs's own into the
# job's shell, NODE_IMAGE (the job's image reference) among them; the guard must
# let each through and still refuse the dangerous ones. The list is read from the
# committed .gitlab-ci.yml, so a variable added there is tried here as well.
# passes_guard <label> [VAR=value ...]: no "is set in the environment" line, and
# the script got as far as its first line, "== the checkout".
passes_guard() {
  label=$1; shift
  pin_run "$tmp" "$@"
  rc=0
  ! grep -q 'is set in the environment' "$out" && grep -q '^== the checkout' "$out" || rc=1
  check "job 2: $label passes the environment guard" "$rc"
  [ "$rc" -eq 0 ] || sed 's/^/     /' "$out"
}
ci_vars=$(awk '
  function emit(   l, n, v) {
    l = $0; sub(/^ +/, "", l); n = l; sub(/:.*/, "", n)
    v = l; sub(/^[^:]*: */, "", v); sub(/ +#.*$/, "", v); sub(/ +$/, "", v)
    if (v ~ /^".*"$/) v = substr(v, 2, length(v) - 2)
    print n "=" v
  }
  /^[^ #]/ { s = ($0 ~ /^variables:/) ? "top" : (($0 ~ /^publish_docs:/) ? "pub" : ""); v = 0; next }
  s == "top" && /^  [A-Za-z_][A-Za-z0-9_]*:/ { emit() }
  s == "pub" && /^  [A-Za-z_]+:/ { v = ($0 ~ /^  variables:/); next }
  s == "pub" && v && /^    [A-Za-z_][A-Za-z0-9_]*:/ { emit() }
' "$tmp/.gitlab-ci.yml")
rc=0; [ -n "$ci_vars" ] && printf '%s\n' "$ci_vars" | grep -q '^NODE_IMAGE=' || rc=1
check "job 2: the variables read from .gitlab-ci.yml are not empty and hold NODE_IMAGE" "$rc"
[ "$rc" -eq 0 ] || echo "     parsed: $ci_vars"
# the pipeline's variables, then what the runner adds, as the job sees them
# (none holds a space, so word splitting is safe)
realvars="$(printf '%s' "$ci_vars" | tr '\n' ' ') NODE_VERSION=22.0.0 YARN_VERSION=1.22.22 IMPORT_DOCS=true GITLAB_CI=true GITLAB_USER_LOGIN=x FF_USE_FASTZIP=true CI_JOB_NAME=publish_docs CI_ENVIRONMENT_NAME=docs-import CI_RUNNER_ID=1 CI_SERVER_TLS_CA_FILE=/ca.pem"
# E1: the real variables, all at once
set -f; set -- $realvars; set +f
passes_guard "the pipeline's real variables" "$@"
# E2: NODE_IMAGE alone
passes_guard "NODE_IMAGE alone" NODE_IMAGE=docker.io/library/node:22-bookworm@sha256:0000
# E3: still refused with the real variables present
for v in NODE_OPTIONS=--require=/x NODE_PATH=/x NODE_EXTRA_CA_CERTS=/x NODE_REPL_EXTERNAL_MODULE=/x LD_PRELOAD=/x.so \
  LD_LIBRARY_PATH=/x PYTHONPATH=/x PYTHONSTARTUP=/x GIT_EXEC_PATH=/x GIT_CONFIG_GLOBAL=/x GIT_SSH_COMMAND=x BASH_ENV=/x \
  OPENSSL_CONF=/x SSL_CERT_FILE=/other.pem; do
  set -f; set -- $realvars "$v"; set +f
  pinned "with ${v%%=*} set beside the pipeline's real variables" "$tmp" "refusing to run: ${v%%=*} is set" "$@"
done
# E4: a NODE_ variable added to the YAML is refused by name (and E1 above is the
# lint-time gate: it fails on any new NODE_ variable in the YAML)
set -f; set -- $realvars NODE_FUTURE=1; set +f
pinned "with a new NODE_FUTURE beside the pipeline's real variables" "$tmp" "refusing to run: NODE_FUTURE is set" "$@"

# Round 4 (#60) item 6: the script checks GIT_STRATEGY=clone itself, at the point of use, in
# case the CI file's setting were overridden (a parallel matrix, a rule's variables, a project
# variable). Anything but clone is refused, before any call to GitLab, with the one wording.
# pin_strategy is cleared for the unset case so the harness does not supply the variable.
pin_strategy=
pinned "with GIT_STRATEGY unset" "$tmp" "refusing to run: GIT_STRATEGY is not clone"
pin_strategy=clone
pinned "with GIT_STRATEGY empty" "$tmp" "refusing to run: GIT_STRATEGY is not clone" GIT_STRATEGY=
pinned "with GIT_STRATEGY=fetch" "$tmp" "refusing to run: GIT_STRATEGY is not clone" GIT_STRATEGY=fetch
pinned "with GIT_STRATEGY=none" "$tmp" "refusing to run: GIT_STRATEGY is not clone" GIT_STRATEGY=none
pinned "with GIT_STRATEGY=Clone (not exactly clone)" "$tmp" "refusing to run: GIT_STRATEGY is not clone" GIT_STRATEGY=Clone
pinned "with GIT_STRATEGY=clone and a space after it" "$tmp" "refusing to run: GIT_STRATEGY is not clone" "GIT_STRATEGY=clone "
set -f; set -- $realvars GIT_STRATEGY=fetch; set +f
pinned "with GIT_STRATEGY=fetch beside the pipeline's real variables" "$tmp" "refusing to run: GIT_STRATEGY is not clone" "$@"
passes_guard "GIT_STRATEGY=clone" GIT_STRATEGY=clone

# Run 6: GitLab refuses every auto-merge request (405). The job must fail and
# show why: the merge request, GitLab's status code and its message.
run_push "$out" refused
rc3=$rc
rc=0; [ "$rc3" -ne 0 ] || rc=1
check "job 2: when GitLab keeps refusing, the job fails (exit $rc3)" "$rc"
rc=0; grep -q 'could not set !42' "$out" || rc=1
check "job 2: the failure line names the merge request (could not set !42)" "$rc"
rc=0; grep -q 'HTTP 405' "$out" || rc=1
check "job 2: the failure shows GitLab's HTTP status (HTTP 405)" "$rc"
rc=0; grep -q 'Method Not Allowed' "$out" || rc=1
check "job 2: the failure shows GitLab's error message (Method Not Allowed)" "$rc"
rc=0; ! grep -rq --exclude-dir=pristine -e "$fake" -e "$fakejob" "$out" "$aux" || rc=1
check "job 2: the token is in neither the output nor any log" "$rc"
rc=0; [ "$merge_puts" -gt 1 ] || rc=1
check "job 2: it retried the auto-merge request (saw $merge_puts attempts)" "$rc"
rc=0; [ "$merge_puts" -gt 0 ] && [ "$bare_puts" -eq 0 ] || rc=1
check "job 2: every auto-merge attempt sent auto_merge=true" "$rc"
rc=0; [ "$merge_puts" -gt 0 ] && [ "$sleeps" -eq $((merge_puts - 1)) ] || rc=1
check "job 2: no wait after the last attempt (saw $sleeps sleeps for $merge_puts attempts)" "$rc"
check_merge_calls() { # check_merge_calls <label>: checks A, E and F on the run just made
  rc=0; printf '%s' "$tip" | grep -Eq '^[0-9a-f]{40}$' || rc=1
  check "$1: the publish left a docs/import-* branch with a full SHA at its tip" "$rc"
  rc=0; [ "$merge_puts" -gt 0 ] && [ "$merge_calls" -eq "$merge_puts" ] && [ "$sha_wrong" -eq 0 ] \
    && printf '%s' "$tip" | grep -Eq '^[0-9a-f]{40}$' || rc=1
  check "$1: every auto-merge request sent sha= the commit that was pushed" "$rc"
  [ "$rc" -eq 0 ] || { echo "     pushed tip: $tip"; sed 's/^/     merge call: /' "$aux/merge.log"; }
  rc=0; [ "$merge_calls" -gt 0 ] && [ "$hdr_missing" -eq 0 ] || rc=1
  check "$1: the token header file (-H @file) was sent on every auto-merge request" "$rc"
  rc=0; [ "$merge_calls" -gt 0 ] && [ "$no_timeouts" -eq 0 ] && [ "$no_maxtime" -eq 0 ] || rc=1
  check "$1: every auto-merge request passed --connect-timeout and --max-time" "$rc"
}
rc=0; [ "$sleeps" -gt 0 ] && ! grep '^sleep ' "$aux/shim.log" | grep -vq 'hdr=absent' || rc=1
check "job 2: the header file is not on disk while the job waits between attempts" "$rc"
check_merge_calls "run 6"
rc=0; [ ! -s "$aux/npm.log" ] && ! grep -qv -e '^node -e$' -e '^node tools/ci/docs-shape.mjs$' -e '^node tools/ci/docs-noscript.mjs$' "$aux/node.log" && [ ! -s "$aux/node-bad.log" ] || rc=1
check "job 2: no npm, node only for -e and the shape and no-script checks, and never with a token file on disk" "$rc"
[ "$rc" -eq 0 ] || { cat "$aux/npm.log" "$aux/node.log" "$aux/node-bad.log" | sed 's/^/     /'; }
[ "$rc3" -ne 0 ] && grep -q 'HTTP 405' "$out" || sed 's/^/     /' "$out"

# Run 7: GitLab refuses once, then accepts (200). The job succeeds and stops.
run_push "$out" second
rc4=$rc
rc=0; [ "$rc4" -eq 0 ] || rc=1
check "job 2: when GitLab accepts on the second try, the job exits 0 (exit $rc4)" "$rc"
rc=0; grep -q 'set to merge when the pipeline passes' "$out" || rc=1
check "job 2: it says the merge request is set to merge when the pipeline passes" "$rc"
rc=0; [ "$merge_puts" -eq 2 ] || rc=1
check "job 2: it stopped retrying once GitLab accepted (saw $merge_puts attempts)" "$rc"
check_merge_calls "run 7"
rc=0; changed=$("$realgit" diff --name-only "$basecommit" "$tip"); [ "$changed" = "$appendfile" ] || rc=1
check "job 2: the commit changes only the page that changed" "$rc"
[ "$rc4" -eq 0 ] || sed 's/^/     /' "$out"

# Which token went where: the project and the pipeline's jobs are asked with the
# import token (a job token cannot list jobs), the archive is fetched with the
# job token, and no call goes without a token.
rc=0; grep -q '^GET  import$' "$aux/tok.log" && grep -q '^GET /pipelines/77/jobs import$' "$aux/tok.log" \
  && grep -q '^GET /jobs/555/artifacts job$' "$aux/tok.log" || rc=1
check "job 2: the project and the pipeline's jobs are asked with the import token, the archive with the job token" "$rc"
rc=0; ! grep -q ' none$' "$aux/tok.log" && ! grep -q '^GET /jobs/555/artifacts import$' "$aux/tok.log" || rc=1
check "job 2: the archive is not fetched with the import token, and no call goes without a token" "$rc"
rc=0; ! grep -E '^(POST|PUT|DELETE) ' "$aux/tok.log" | grep -qv ' import$' || rc=1
check "job 2: every write to GitLab was made with the import token" "$rc"
[ "$rc" -eq 0 ] || sed 's/^/     /' "$aux/tok.log"

# Run 8: the first attempt gets a 405 with a body; every later attempt cannot
# connect at all (curl: status 000, no body, exit 7). The last thing shown must
# be the connection failure, not the old 405 body.
run_push "$out" conn
rc5=$rc
rc=0; [ "$rc5" -ne 0 ] || rc=1
check "job 2: when the last attempt cannot connect, the job fails (exit $rc5)" "$rc"
rc=0; [ "$merge_puts" -gt 1 ] || rc=1
check "job 2: it retried after the first refusal (saw $merge_puts attempts)" "$rc"
rc=0; grep -q 'could not set !42' "$out" || rc=1
check "job 2: the failure line names the merge request (could not set !42)" "$rc"
rc=0; grep -q 'HTTP 000' "$out" || rc=1
check "job 2: the failure shows the last attempt's status (HTTP 000)" "$rc"
rc=0; ! grep -q 'Method Not Allowed' "$out" || rc=1
check "job 2: a stale body from an earlier attempt is not shown (no Method Not Allowed)" "$rc"
[ "$rc" -eq 0 ] || sed 's/^/     /' "$out"

# Run 9: hooks and an fsmonitor script left in the checkout's .git: none may run, and
# no git command may have the token in its environment or lack the switches that
# turn hooks and fsmonitor off.
run_push "$out" hook
rc6=$rc
rc=0; [ "$rc6" -eq 0 ] || rc=1
check "job 2: the job still succeeds with hooks and an fsmonitor script planted (exit $rc6)" "$rc"
rc=0; [ ! -e "$aux/hook-ran" ] && [ ! -e "$aux/fsmonitor-ran" ] || rc=1
check "job 2: no planted hook and no planted fsmonitor ran" "$rc"
[ "$rc" -eq 0 ] || sed "s/^/     git call: /" "$aux/git.log"
calls=$(grep -c '^git ' "$aux/git.log" || true)
bad_env=$(grep '^git ' "$aux/git.log" | grep -vc '^git UNSET ' || true)
bad_off=$(grep '^git ' "$aux/git.log" | grep -vc ' hooks=y fsm=y ' || true)
rc=0; [ "$calls" -ge 6 ] || rc=1
check "job 2: git ran (saw $calls calls)" "$rc"
rc=0; [ "$bad_env" -eq 0 ] || rc=1
check "job 2: no git command had the token in its environment ($bad_env did)" "$rc"
rc=0; [ "$bad_off" -eq 0 ] || rc=1
check "job 2: every git command ran with hooks and fsmonitor off ($bad_off did not)" "$rc"
rc=0; grep -q 'git .*push.*https://gitlab.invalid/ai/orbit-site.git' "$aux/shim.log" || rc=1
check "job 2: the push to GitLab still happened" "$rc"

# Run 10: a clean filter in the checkout's .git config -> refused, nothing run.
run_push "$out" cfg
rc7=$rc
rc=0; [ "$rc7" -ne 0 ] && grep -q "checkout's git" "$out" || rc=1
check "job 2: a filter in the checkout's git config stops the job and says so (exit $rc7)" "$rc"
rc=0; [ ! -e "$aux/filter-ran" ] || rc=1
check "job 2: no planted clean filter ran" "$rc"
rc=0; [ -z "$("$realgit" for-each-ref 'refs/heads/docs/import-*')" ] && [ ! -s "$aux/api.log" ] && ! grep -q 'push' "$aux/shim.log" || rc=1
check "job 2: nothing was committed, pushed or sent to GitLab" "$rc"
[ "$rc" -eq 0 ] || sed 's/^/     /' "$out"

# Run 10b: other things the runner's clone does not write are refused the same way
# before any call to GitLab; what it does write is not.
for sc in cfgonly include worktreecfg fsmonitorcfg; do
  run_push "$out" "$sc"
  rcz=$rc
  rc=0; [ "$rcz" -ne 0 ] && grep -q "checkout's git" "$out" && [ ! -s "$aux/api.log" ] && [ ! -e "$aux/filter-ran" ] && [ ! -e "$aux/fsmonitor-ran" ] || rc=1
  check "job 2: a checkout git config with $sc is refused before anything is sent (exit $rcz)" "$rc"
  [ "$rc" -eq 0 ] || sed 's/^/     /' "$out"
done
run_push "$out" runnerinc
rcz=$rc
rc=0; [ "$rcz" -eq 0 ] && grep -q 'set to merge' "$out" && ! grep -q "checkout's git" "$out" || rc=1
check "job 2: runnerinc, the runner's layout (include.path to <checkout>.tmp/.gitlab-runner.ext.conf with its keys and lfs.repositoryformatversion), is accepted (exit $rcz)" "$rc"
[ "$rc" -eq 0 ] || sed 's/^/     /' "$out"
# refused, and the refusal names the key: <scenario>:<key>
for pair in increl:include.path incwork:include.path incgit:include.path include:include.path \
  incelse:include.path inclink:include.path inctab:include.path \
  incevil:include.path incgtpl:include.path incsib:include.path incdots:include.path incdotsame:include.path \
  incdirlink:include.path increlcwd:include.path \
  incssh:core.sshCommand incfsmon:core.fsmonitor incfilter:filter.x.clean incnest:core.sshCommand \
  incnestmiss:include.path includeif:includeif.gitdir:/x.path nlreal:core.sshCommand inccycle:"could not list"; do
  sc=${pair%%:*}; key=${pair#*:}
  run_push "$out" "$sc"
  rcz=$rc
  rc=0; [ "$rcz" -ne 0 ] && grep -qiF "$key" "$out" && [ ! -s "$aux/api.log" ] && [ ! -e "$aux/filter-ran" ] && [ ! -e "$aux/fsmonitor-ran" ] || rc=1
  [ "$sc" = inccycle ] || grep -q "checkout's git" "$out" || rc=1
  check "job 2: a checkout git config with $sc is refused, naming $key (exit $rcz)" "$rc"
  [ "$rc" -eq 0 ] || sed 's/^/     /' "$out"
  # the listing file lives in the script's own scratch folder: nothing is left in TMPDIR
  rc=0; [ -z "$(ls -A scratch-tmp)" ] || rc=1
  check "job 2: after refusing $sc, nothing is left in TMPDIR" "$rc"
  [ "$rc" -eq 0 ] || ls -A scratch-tmp | sed 's/^/     left: /'
done
run_push "$out" nlval
rcz=$rc
rc=0; [ "$rcz" -eq 0 ] && grep -q 'set to merge' "$out" && ! grep -q "checkout's git" "$out" || rc=1
check "job 2: nlval, a remote.origin.url holding a newline and text shaped like core.sshCommand, is one value and is accepted (exit $rcz)" "$rc"
[ "$rc" -eq 0 ] || sed 's/^/     /' "$out"
run_push "$out" runnerlike
rcz=$rc
rc=0; [ "$rcz" -eq 0 ] && grep -q 'set to merge' "$out" || rc=1
check "job 2: the keys a runner's clone writes (remote, credential, url rewrite, ...) are accepted (exit $rcz)" "$rc"
[ "$rc" -eq 0 ] || sed 's/^/     /' "$out"

# Runs 11 and 12: an older import merge request (!7) is open, and a fork's (!8,
# another source project) that must never be touched. Run 11: the new merge
# request is opened first, and only then is !7 closed and its branch deleted.
# Run 12: the push fails, so there is no new merge request, and !7 stays open.
oldmr=1
run_push "$out" second
rc8=$rc
n_post=$(grep -n '^POST /merge_requests' "$aux/api.log" | head -n 1 | cut -d: -f1)
n_close=$(grep -n '^PUT /merge_requests/7|state_event=close' "$aux/api.log" | head -n 1 | cut -d: -f1)
n_del=$(grep -n '^DELETE /repository/branches/docs%2Fimport-20260101-0000' "$aux/api.log" | head -n 1 | cut -d: -f1)
rc=0; [ "$rc8" -eq 0 ] || rc=1
check "job 2: with an older import merge request open, the job exits 0 (exit $rc8)" "$rc"
rc=0; [ -n "$n_post" ] && [ -n "$n_close" ] && [ "$n_post" -lt "$n_close" ] || rc=1
check "job 2: the new merge request is opened before the older one is closed" "$rc"
rc=0; [ -n "$n_close" ] && [ -n "$n_del" ] && [ "$n_close" -lt "$n_del" ] || rc=1
check "job 2: the older merge request's branch is deleted after it is closed" "$rc"
rc=0; ! grep -q -e '/merge_requests/8' -e 'import-20260102' "$aux/api.log" || rc=1
check "job 2: a fork's import merge request is left alone" "$rc"
rc=0; ! grep -q -e 'PUT /merge_requests/42|state_event' "$aux/api.log" || rc=1
check "job 2: the new merge request is not closed" "$rc"
[ "$rc" -eq 0 ] || sed 's/^/     /' "$aux/api.log"

run_push "$out" pushfail
rc9=$rc
rc=0; [ "$rc9" -ne 0 ] || rc=1
check "job 2: a failed push fails the job (exit $rc9)" "$rc"
rc=0; ! grep -q -e '^POST /merge_requests' -e 'state_event=close' -e '^DELETE' "$aux/api.log" || rc=1
check "job 2: after a failed push nothing was opened, and no older merge request or branch was touched" "$rc"
[ "$rc" -eq 0 ] || sed 's/^/     /' "$aux/api.log"

# Run 13: an older import merge request is open and the artifact is what main
# has (upstream reverted): it is still closed, with its branch, and no new merge
# request is opened.
run_push "$out" nothing
rc10=$rc
rc=0; [ "$rc10" -eq 0 ] && grep -q 'nothing new' "$out" || rc=1
check "job 2: nothing new exits 0 and says so (exit $rc10)" "$rc"
rc=0; grep -q '^PUT /merge_requests/7|state_event=close' "$aux/api.log" \
  && grep -q '^DELETE /repository/branches/docs%2Fimport-20260101-0000' "$aux/api.log" || rc=1
check "job 2: with nothing new, the older import merge request and its branch are still closed" "$rc"
rc=0; ! grep -q -e '^POST /merge_requests' -e 'import-20260102' "$aux/api.log" || rc=1
check "job 2: no new merge request is opened, and the fork's is left alone" "$rc"
[ "$rc" -eq 0 ] || sed 's/^/     /' "$out"
oldmr=

# Run 14: branches an earlier run left behind. !7 (open) keeps its branch; the
# branch of a fork's merge request (!8) does not count; another name and main
# are not import branches. The clean-up comes before the merge request.
oldmr=1; stale=1
run_push "$out" second
rc11=$rc
rc=0; [ "$rc11" -eq 0 ] || rc=1
check "job 2: with stale branches about, the job exits 0 (exit $rc11)" "$rc"
rc=0; grep -q '^DELETE /repository/branches/docs%2Fimport-20260103-0000' "$aux/api.log" \
  && grep -q '^DELETE /repository/branches/docs%2Fimport-20260102-0000' "$aux/api.log" || rc=1
check "job 2: import branches with no open merge request of this project are deleted" "$rc"
n_stale=$(grep -n '^DELETE /repository/branches/docs%2Fimport-20260103' "$aux/api.log" | head -n 1 | cut -d: -f1)
n_post=$(grep -n '^POST /merge_requests' "$aux/api.log" | head -n 1 | cut -d: -f1)
rc=0; [ -n "$n_stale" ] && [ -n "$n_post" ] && [ "$n_stale" -lt "$n_post" ] || rc=1
check "job 2: they are deleted at the start, before the merge request" "$rc"
rc=0; [ "$(grep -c '^DELETE /repository/branches/docs%2Fimport-20260101' "$aux/api.log")" -eq 1 ] \
  && ! grep -q -e 'branches/main' -e 'branches/docs%2Fimporter' "$aux/api.log" || rc=1
check "job 2: the branch of an open merge request is kept until that merge request is closed, and others are not touched" "$rc"
rc=0; ! grep -q -e 'import-20260104' -e 'import-20260105' "$aux/api.log" && grep -q 'keeping docs/import-20260104-0000' "$out" || rc=1
check "job 2: a branch under an hour old, or of unknown age, is kept" "$rc"
[ "$rc" -eq 0 ] || sed 's/^/     /' "$aux/api.log"
oldmr=; stale=

# Run 15: a dry run with a changed archive, stale branches and an older merge
# request about. It reports, and touches nothing: the checkout is as it was
# (tracked files, branches, git objects) and GitLab got no write.
oldmr=1; stale=1; dry=1
objs0=$(find .git/objects -type f | wc -l)
run_push "$out" second
rc12=$rc
rc=0; [ "$rc12" -eq 0 ] && grep -q 'DRY_RUN: would push' "$out" && grep -q 'closing !7' "$out" \
  && grep -q 'deleting docs/import-20260103-0000' "$out" || rc=1
check "job 2: a dry run exits 0 and reports what it would push, close and delete (exit $rc12)" "$rc"
[ "$rc" -eq 0 ] || sed 's/^/     /' "$out"
rc=0; [ -z "$("$realgit" status --porcelain --untracked-files=no)" ] || rc=1
check "job 2: a dry run left the checkout as it was" "$rc"
rc=0; [ "$("$realgit" rev-parse --abbrev-ref HEAD)" = "$base" ] && [ -z "$("$realgit" for-each-ref 'refs/heads/docs/import-*')" ] \
  && [ -z "$("$realgit" diff --cached --name-only)" ] || rc=1
check "job 2: a dry run made no branch and staged nothing" "$rc"
rc=0; [ "$(find .git/objects -type f | wc -l)" -eq "$objs0" ] || rc=1
check "job 2: a dry run wrote no git object to the checkout" "$rc"
rc=0; ! grep -q -e '^PUT' -e '^POST' -e '^DELETE' "$aux/api.log" && ! grep -q 'https://' "$aux/shim.log" || rc=1
check "job 2: a dry run sent GitLab no write and pushed nothing" "$rc"
oldmr=; stale=; dry=

# Run 16: the publish stages nothing from the checkout's own index: files the
# checkout had staged are not in the commit.
run_push "$out" stage
rc13=$rc
changed=$("$realgit" diff --name-only "$basecommit" "$tip")
rc=0; [ "$rc13" -eq 0 ] || rc=1
check "job 2: the job succeeds when other files are staged in the checkout (exit $rc13)" "$rc"
rc=0; [ -n "$changed" ] && [ -z "$(printf '%s\n' "$changed" | grep -v -e '^assets/docs/')" ] || rc=1
check "job 2: the commit changes only assets/docs" "$rc"
[ "$rc" -eq 0 ] || printf '%s\n' "$changed" | sed 's/^/     changed: /'
rc=0; ! "$realgit" cat-file -e "$tip:evil.txt" 2>/dev/null || rc=1
check "job 2: a file staged in the checkout is not in the commit" "$rc"
check_merge_calls "run 16"

# Run 17: GitLab answers the merge request POST 2xx with no iid, an older merge
# request is open -> the job stops before it closes anything.
oldmr=1
run_push "$out" noiid
rc16=$rc
rc=0; [ "$rc16" -ne 0 ] && grep -q 'no numeric iid' "$out" || rc=1
check "job 2: an answer without an iid stops the job (exit $rc16)" "$rc"
rc=0; ! grep -q -e 'state_event=close' -e '^DELETE' "$aux/api.log" || rc=1
check "job 2: no merge request was closed and no branch deleted" "$rc"
[ "$rc" -eq 0 ] || sed 's/^/     /' "$out"
oldmr=

# Runs 18 on: hostile archives, and answers from GitLab that do not add up. Each
# is refused with a reason, before the script writes anything to GitLab, pushes
# or makes a branch, and no token is shown.
refused() { # refused <scenario> <what it is> <text the refusal must carry>
  run_push "$out" "$1"
  rcx=$rc
  ok=0
  [ "$rcx" -ne 0 ] && grep -q -e "$3" "$out" || ok=1
  check "job 2 refuses $2 (exit $rcx)" "$ok"
  [ "$ok" -eq 0 ] || sed 's/^/     /' "$out"
  ok=0
  ! grep -q -e '^PUT' -e '^POST' -e '^DELETE' "$aux/api.log" && ! grep -q 'push' "$aux/shim.log" \
    && [ -z "$("$realgit" for-each-ref 'refs/heads/docs/import-*')" ] || ok=1
  check "job 2: after refusing $2, nothing was written to GitLab, pushed or branched" "$ok"
  ok=0; ! grep -rq --exclude-dir=pristine -e "$fake" -e "$fakejob" "$out" "$aux" || ok=1
  check "job 2: after refusing $2, no token is in the output or any log" "$ok"
}
refused symlinkfile "a symlink in the archive" "is not a regular file"
refused device "a device node in the archive" "is not a regular file"
refused traversal "a path that climbs out of assets/docs" "is not a file the import writes"
refused absolute "an absolute path" "is not a file the import writes"
refused outside "a file outside assets/docs" "is not a file the import writes"
refused subdir "a path below assets/docs" "is not a file the import writes"
refused badtype "an .html file" "is not a file the import writes"
refused webp "a .webp file" "is not a file the import writes"
refused badname "a name with capitals" "is not a file the import writes"
refused unknown "a page for a source that is not listed" "is not a file the import writes"
refused dup "the same name twice" "in the archive twice"
refused missing "an archive without one of the pages" "missing:"
refused pictoomany "too many entries (8 pages, the index and 129 pictures; the old limit was 64 and a test of it is gone, see pics128)" "more than"
refused toolarge "a file over the size cap" "is larger than"
refused toomuch "too many bytes in all" "bytes in all"
refused notzip "a file that is not a zip" "not a zip archive"
refused notjson "a page that is not JSON" "readme.json: not JSON"
refused notobject "a page that is not an object" "not a JSON object"
refused xss "an index colour that is markup" "index.json sources\[0\]: c is"
refused badid "a section id with a quote" "sections\[1\].id"
refused extrakey "a section with an extra key" "sections\[0\] does not have exactly"
refused tampered "a changed tracked file in the checkout" "tracked files differ from HEAD"
refused wrongproject "an answer that names another project" "not ai/orbit-site"
refused nojob "a pipeline with no successful import job" "successful import_docs jobs"
refused failedjob "an import job that failed" "successful import_docs jobs"
refused wrongsha "an import job at another commit" "successful import_docs jobs"
refused wrongpipeline "an import job of another pipeline" "successful import_docs jobs"
refused twojobs "two import jobs" "successful import_docs jobs"

# Pictures (#72). The import copies each upstream picture into assets/docs/img/, so the archive
# may carry that folder and files assets/docs/img/<16 hex>.(png|jpg|webp|gif) of at most 1 MiB,
# each a real picture of its extension and used by a page, and nothing else under it. Every
# refusal below is paired with an accepted archive that differs in the thing refused (pic,
# picnodir, picall, pic1mib, pics128), and each accepted archive's pictures must reach the
# merge request exactly (check_pics).
check_pics() { # check_pics <label>: the pushed commit's assets/docs/img/ is exactly the archive's, each file named by its bytes
  want=$(cat "$aux/artifact.zip.imgs")
  have=$("$realgit" ls-tree -r --name-only "$tip" -- assets/docs/img | sed 's#^assets/docs/img/##' | sort)
  rc=0; [ "$have" = "$want" ] || rc=1
  check "$1: the merge request's assets/docs/img/ is exactly the archive's ($(printf '%s' "$want" | grep -c . || true) pictures)" "$rc"
  [ "$rc" -eq 0 ] || { printf '%s\n' "$want" | sed 's/^/     archive: /'; printf '%s\n' "$have" | sed 's/^/     pushed:  /'; }
  rc=0
  for f in $have; do
    h=$("$realgit" show "$tip:assets/docs/img/$f" | sha256sum | cut -c1-16)
    [ "${f%.*}" = "$h" ] || rc=1
  done
  check "$1: every pushed picture is named by the first 16 hex of its own SHA-256" "$rc"
}
accepted() { # accepted <scenario> <what it is> <how many pictures reach the merge request>
  run_push "$out" "$1"
  rcx=$rc
  ok=0; [ "$rcx" -eq 0 ] && grep -q 'set to merge when the pipeline passes' "$out" || ok=1
  check "job 2 accepts $2 (exit $rcx)" "$ok"
  [ "$ok" -eq 0 ] || sed 's/^/     /' "$out"
  ok=0; [ "$("$realgit" ls-tree -r --name-only "$tip" -- assets/docs/img | grep -c . || true)" -eq "$3" ] || ok=1
  check "job 2: after accepting $2, the pushed commit holds $3 pictures" "$ok"
  check_pics "job 2 ($1)"
}
accepted pic "an archive with one PNG picture that a page uses" 1
accepted picnodir "the same archive without a directory entry for img/" 1
accepted picall "a PNG, a JPEG, a GIF and a WebP picture, each named by its bytes" 4
accepted pic1mib "a picture of exactly 1 MiB" 1
accepted pics128 "128 pictures (the most the entry limit allows with 8 pages and the index)" 128
refused pictoomany "129 pictures (more entries than 8 pages, the index and 128 pictures)" "more than"
refused picsvg "an SVG in img/" "picsvg\|\.svg\|is not a file the import writes"
refused picupper "a picture whose name has upper-case hex" "is not a file the import writes"
refused picjpeg "a picture with the extension .jpeg" "is not a file the import writes"
refused picsub "a picture in a folder below img/" "is not a file the import writes"
refused picasfile "img as a file and not a folder" "is not a file the import writes\|not a directory"
refused pictoolarge "a picture of 1 MiB and one byte" "is larger than"
refused picmismatch "JPEG bytes named .png" "\.png"
refused picunused "a picture no page uses" "[0-9a-f]\{16\}\.png"
refused picsymlink "a symlink under img/" "is not a regular file"
refused picbadsrc "a page whose img climbs out of img/" "readme.json"
refused picraw "a page whose img points at raw.githubusercontent.com" "readme.json"

# The merge request's assets/docs/img/ is exactly the archive's: main holds two pictures, 90
# (which the import no longer writes) and 91. picgone: the archive has none, so both go.
# picswap: the archive has 91 and a new 92, so 90 goes, 91 is left alone and 92 is added.
run_push "$out" picgone
rcg=$rc
rc=0; [ "$rcg" -eq 0 ] && grep -q 'set to merge when the pipeline passes' "$out" || rc=1
check "job 2: an archive without pictures, where main holds two, is published (exit $rcg)" "$rc"
[ "$rc" -eq 0 ] || sed 's/^/     /' "$out"
rc=0; [ "$("$realgit" ls-tree -r --name-only "$headsha" -- assets/docs/img | grep -c . || true)" -eq 2 ] || rc=1
check "job 2: control: main held two pictures" "$rc"
rc=0; [ -z "$("$realgit" ls-tree -r --name-only "$tip" -- assets/docs/img)" ] || rc=1
check "job 2: pictures the import no longer writes are deleted from the merge request" "$rc"
rc=0; [ "$("$realgit" diff --name-status "$headsha" "$tip" -- assets/docs/img | grep -c '^D' || true)" -eq 2 ] || rc=1
check "job 2: the merge request deletes both" "$rc"
check_pics "job 2 (picgone)"
run_push "$out" picswap
rcw=$rc
rc=0; [ "$rcw" -eq 0 ] && grep -q 'set to merge when the pipeline passes' "$out" || rc=1
check "job 2: an archive that drops one picture, keeps one and adds one is published (exit $rcw)" "$rc"
[ "$rc" -eq 0 ] || sed 's/^/     /' "$out"
check_pics "job 2 (picswap)"
d=$("$realgit" diff --name-status "$headsha" "$tip" -- assets/docs/img 2>/dev/null || true)
rc=0; [ "$(printf '%s\n' "$d" | grep -c '^D' || true)" -eq 1 ] && [ "$(printf '%s\n' "$d" | grep -c '^A' || true)" -eq 1 ] \
  && [ "$(printf '%s\n' "$d" | grep -c . || true)" -eq 2 ] || rc=1
check "job 2: it deletes the one picture dropped, adds the new one, and leaves the one kept alone" "$rc"
[ "$rc" -eq 0 ] || printf '%s\n' "$d" | sed 's/^/     /'
rc=0; changed=$("$realgit" diff --name-only "$headsha" "$tip" 2>/dev/null | grep -v '^assets/docs/img/' || true); [ "$changed" = "$appendfile" ] || [ "$(printf '%s\n' "$changed" | sort)" = "$(printf '%s\n' "$appendfile" assets/docs/readme.json | sort)" ] || rc=1
check "job 2: apart from pictures the commit changes only the pages that changed" "$rc"

# The publish runs the lint's "the imported docs carry no script" check itself:
# the artifact is untrusted, and the import merge request's lint is not the only
# line of defence. A docs page whose section html carries script-capable markup
# is refused with the lint's wording, before any write to GitLab, any push or any
# branch. The same artifact without the script is published as usual.
# script_refused <scenario> <what it is>
script_refused() {
  refused "$1" "$2" 'carries script\|carry no script'
  rc=0; grep -q 'readme.json' "$out" || rc=1
  check "job 2: the refusal of $2 names the page (readme.json)" "$rc"
}
script_refused scriptel "a script element in a docs page"
script_refused handler "an onerror handler in a docs page"
script_refused jsurl "an encoded javascript: link in a docs page"
script_refused svgel "an svg element in a docs page"
# control: harmless html in the same place is published as today
run_push "$out" benign
rcb=$rc
rc=0; [ "$rcb" -eq 0 ] && grep -q 'set to merge when the pipeline passes' "$out" || rc=1
check "job 2: the same page with harmless html (entities, on x=, data: in prose) is published (exit $rcb)" "$rc"
[ "$rc" -eq 0 ] || sed 's/^/     /' "$out"
rc=0; grep -q '^POST /merge_requests' "$aux/api.log" && grep -q 'push' "$aux/shim.log" \
  && printf '%s' "$tip" | grep -Eq '^[0-9a-f]{40}$' || rc=1
check "job 2: the harmless page was pushed and a merge request opened" "$rc"
rc=0; ! grep -q -e 'carries script' -e 'carry no script' "$out" || rc=1
check "job 2: the harmless page is not reported as carrying script" "$rc"

reset_tree
rm -f "$out"
exit "$failed"
