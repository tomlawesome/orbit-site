#!/bin/sh
# Test for tools/ci/lint.sh, section "nothing stray at the root": it judges
# what git tracks, not what is on disk (issue #5); section "the npm pins live
# in tools/package.json only": a version named in a script, a lockfile entry
# without integrity, a range in the manifest, or npm dropped from Renovate's
# managers fails and names the file; and section "the imported docs carry no
# script": a handler or script tag in a stored section fails and names it; and
# the renovate.json section: a look-around in a customManagers matchString
# fails and names renovate.json (Renovate compiles these with RE2); and the
# .gitlab-ci.yml section: the docs/import-* merge-request rule must set
# CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX: docker.io (issue #13); and section
# "the shared door is self-contained" (ADR-0001, issue #16): a file in
# assets/door/ that imports from outside the folder, reads location.search or
# uses import.meta.url fails and is named, as is a site module that imports a
# file of the folder other than its index.js, a url() in door.css that reaches
# outside the folder, and an index.html whose door differs from markup.js; and
# section "the docs import is split" (issue #18): import_docs holding the token
# or an environment, publish_docs losing its environment, taking npm, or its
# artifact, or either job running anywhere but the schedule on main; and section "the service worker's picture cache name" (audit #12, #21): MEDIA in
# sw.js must be orbit-media- plus the first 12 hex characters of a SHA-256 over the
# tracked picture files outside assets/docs/ (a change to a picture without a new
# name fails and names sw.js and the expected name; a change only under
# assets/docs/ does not). And section "the pages carry a Content-Security-Policy" (audit #12): a page without the meta,
# with it after a script, link or style, with an inline script and no matching hash, a stale hash, 'unsafe-inline' or
# 'unsafe-eval' in script-src, no object-src 'none' or base-uri 'self', or an inline event handler fails and names the
# page (cases c0-c8). And section "no real names, host logins or private addresses" (#56): a private or
# shared-space IPv4 address in a tracked text file fails and names file:line without printing the address, an
# edit to the one LICENSE line the owner keeps fails and names LICENSE:3, and a documentation address passes (cases n1-n3). The same section also refuses history carrying a banned
# email (#56, decision 8a): a commit reachable from HEAD whose author or committer email is banned (stored only
# as sha256 digests) fails and names the commit by short id and the field, author or committer, never the
# address; a commit with an invented address is not reported. The tests plant the digest of an invented address
# in NO_REAL_NAMES_EXTRA_EMAIL_DIGESTS (comma-separated sha256 of the lower-cased address, added to the banned
# set for tests): cases n4 (invented address, not reported), n5 (author) and n6 (committer).
# And the "docs import is split" section reads .gitlab-ci.yml as YAML, not line by line (issue #52): a job that
# only mentions renovate.json or a renovate/ branch name, in a script line or a trailing comment, without joining
# the renovate environment is not refused (cases y1-y3); a job joining docs-import or renovate from a YAML shape
# a line reader does not see (a key with a trailing comment, a job in flow style, environment as a mapping,
# in flow style or after a comment) fails and names the job (cases y4-y9).
# A job that inherits a scoped environment without naming it is refused too, naming the job and the environment
# (cases y10-y15): extends: publish_docs; extends: [ .something, publish_docs ]; environment: !reference
# [publish_docs, environment]; extends a hidden template that names docs-import (the template is refused as well,
# case y14); and extends: renovate.
# Further refusals (issue #52 review, #59, #60; cases p1-p71): a YAML merge key after an explicit key in the same
# mapping (Ruby Psych lets the later << win, other readers keep the explicit key; a << first stays allowed; two << in one mapping are refused, a << list passes, cases p19-p20); a
# child pipeline (trigger: include, file or artifact); a package manager through !reference, or in
# publish_docs's before_script or after_script (its own, extended or from default:); services: on publish_docs or
# default:, or a changed publish_docs image; and import_docs expire_in of 999 hours or 2 days (24 hours and
# 30 minutes pass).
#
#   sh tools/ci/lint-test.sh        run from anywhere inside the repository
#
# Works on a scratch copy of the current commit, so the checkout is untouched.
set -eu

root=$(git rev-parse --show-toplevel)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

git -C "$root" archive HEAD | tar -x -C "$tmp"
# the lint reads .gitlab-ci.yml with js-yaml from tools/node_modules (#52), which the archive leaves out:
# the scratch copy uses the checkout's install (npm ci --prefix tools), or the lint fails closed
[ ! -d "$root/tools/node_modules" ] || export NODE_PATH="$root/tools/node_modules"
cd "$tmp"
git init -q
git add -A
git -c user.name=t -c user.email=t@t commit -q -m base

failed=0

# Case 1: present on disk but untracked -> the section passes.
mkdir -p .agents node_modules
echo x > .agents/x
echo x > node_modules/x
out=$(mktemp)
rc=0
sh tools/ci/lint.sh > "$out" 2>&1 || rc=$?
if [ "$rc" -eq 0 ] && ! grep -q "must not be committed" "$out"; then
  echo "ok   untracked .agents and node_modules pass"
else
  echo "FAIL untracked .agents and node_modules pass (exit $rc)"
  sed 's/^/     /' "$out"
  failed=1
fi

# Case 2: tracked package.json -> the section fails and names it.
echo '{}' > package.json
git add -f package.json
git -c user.name=t -c user.email=t@t commit -q -m "add package.json"
rc=0
sh tools/ci/lint.sh > "$out" 2>&1 || rc=$?
if [ "$rc" -ne 0 ] && grep -q "package.json must not be committed" "$out"; then
  echo "ok   tracked package.json fails"
else
  echo "FAIL tracked package.json fails (exit $rc)"
  sed 's/^/     /' "$out"
  failed=1
fi
# Cases (a)-(c) judge section "the imported docs carry no script". Case 2 left
# package.json tracked, which would fail lint for another reason: drop it first.
git rm -q package.json
git -c user.name=t -c user.email=t@t commit -q -m "drop package.json"

# Put html into the first section of assets/docs/readme.json (kept valid JSON)
# and commit it; prints the id of that section.
poison() {
  SECTION_HTML="$1" node -e '
    const fs = require("fs");
    const f = "assets/docs/readme.json";
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    j.sections[0].html = process.env.SECTION_HTML;
    fs.writeFileSync(f, JSON.stringify(j));
    console.log(j.sections[0].id);
  '
  git add -A
  git -c user.name=t -c user.email=t@t commit -q -m "poison readme.json"
}

# Case (a): an onerror handler in an imported section -> fails, names file and section.
sid=$(poison '<p><img src="x" onerror="alert(1)"></p>')
rc=0
sh tools/ci/lint.sh > "$out" 2>&1 || rc=$?
if [ "$rc" -eq 1 ] && grep -q "assets/docs/readme.json" "$out" && grep -q "$sid" "$out"; then
  echo "ok   an onerror handler in an imported section fails"
else
  echo "FAIL an onerror handler in an imported section fails (exit $rc, want 1 naming assets/docs/readme.json and $sid)"
  sed 's/^/     /' "$out"
  failed=1
fi
git reset -q --hard HEAD~1

# Case (b): a script element in an imported section -> fails.
sid=$(poison '<script>1</script>')
rc=0
sh tools/ci/lint.sh > "$out" 2>&1 || rc=$?
if [ "$rc" -eq 1 ] && grep -q "assets/docs/readme.json" "$out" && grep -q "$sid" "$out"; then
  echo "ok   a script element in an imported section fails"
else
  echo "FAIL a script element in an imported section fails (exit $rc, want 1 naming assets/docs/readme.json and $sid)"
  sed 's/^/     /' "$out"
  failed=1
fi
git reset -q --hard HEAD~1

# Cases (b2)-(b13): what the sanitiser's own tokeniser could let through in
# hand-edited or hole-produced output (issue #12). Each of these passed the
# first version of the check, which looked at one tag with plain text matches;
# the check now reads attributes as a browser does. poison_case <label> <html>
# expects the lint to fail, naming the file and the section.
poison_case() {
  sid=$(poison "$2")
  rc=0
  sh tools/ci/lint.sh > "$out" 2>&1 || rc=$?
  if [ "$rc" -eq 1 ] && grep -q "assets/docs/readme.json" "$out" && grep -q "$sid" "$out"; then
    echo "ok   $1 fails"
  else
    echo "FAIL $1 fails (exit $rc, want 1 naming assets/docs/readme.json and $sid)"
    sed 's/^/     /' "$out"
    failed=1
  fi
  git reset -q --hard HEAD~1
}
tab=$(printf '\t'); nl=$(printf '\n'); ctl=$(printf '\001')
nbsp=$(printf '\302\240'); vt=$(printf '\013'); bom=$(printf '\357\273\277')
poison_case "a hex-encoded letter in a javascript: scheme" '<a href="jav&#x61;script:alert(1)">x</a>'
poison_case "a decimal-encoded letter in a javascript: scheme" '<a href="&#106;avascript:alert(1)">x</a>'
poison_case "an encoded tab inside a scheme" '<a href="java&#9;script:alert(1)">x</a>'
poison_case "a tab inside a scheme" "<a href=\"java${tab}script:alert(1)\">x</a>"
poison_case "a newline inside an unquoted scheme" "<a href=java${nl}script:alert(1)>x</a>"
poison_case "an encoded vbscript: scheme" '<a href="&#x76;bscript:x">x</a>'
poison_case "an encoded data: scheme with an encoded colon" '<img src="&#100;ata&colon;text/html,x">'
poison_case "a handler after a slash" '<img/onerror=alert(1) src=x>'
poison_case "a handler straight after a closing quote" '<img src="x"onerror=alert(1)>'
poison_case "a handler after a control character" "<img${ctl}onerror=alert(1) src=x>"
poison_case "a handler after an attribute value holding a >" '<img alt=">" onerror=alert(1)>'
poison_case "an upper-case unquoted handler" '<IMG SRC=x ONERROR=alert(1)>'

# Case (b14): ordinary html that only looks like the above -> passes: an
# entity in a URL, "on x=" in text and in an attribute value, data: in prose.
sid=$(poison '<p>Use <a href="https://example.com/a?b=1&amp;c=2">link</a> and <code>one = 1</code> on a=b, data: x</p><img alt="a onfoo=b" src="x.png">')
rc=0
sh tools/ci/lint.sh > "$out" 2>&1 || rc=$?
if [ "$rc" -eq 0 ] && ! grep -q "carries script" "$out"; then
  echo "ok   ordinary html with entities, 'on x=' text and data: prose passes"
else
  echo "FAIL ordinary html with entities, 'on x=' text and data: prose passes (exit $rc, section $sid)"
  sed 's/^/     /' "$out"
  failed=1
fi
git reset -q --hard HEAD~1

# Cases (b15)-(b19): html the import never writes, which a browser reads
# differently from the check's tokeniser (an HTML comment, a doctype, a <?
# construct, a </ not followed by a letter, and the elements textarea, title,
# xmp, noembed, noframes, noscript and plaintext, whose content is raw text).
# The import writes such text escaped (&lt;!--), so a stored section holding
# any of them is refused outright. The attacker's quote opens inside one
# construct and closes inside another, so a handler hides in an attribute value.
poison_case "(b15) an html comment hiding a quote" '<!-- <a x=" --><img src=x onerror=alert(1)><!-- "> -->'
poison_case "(b16) a textarea holding a closing tag in an attribute" '<textarea><a title="</textarea><img src=x onerror=alert(1)>">x</a>'
poison_case "(b17) a <? construct hiding a quote" '<? <a x=" ><img src=x onerror=alert(1)><a x=" >'
poison_case "(b18) an upper-case noscript holding a closing tag in an attribute" '<NOSCRIPT><a title="</noscript><img src=x onerror=alert(1)>">x</a>'
poison_case "(b19) a </ not followed by a letter" '</ x="><img src=x onerror=alert(1)><a x="'

# Cases (b21)-(b29): the lint reads the html by the strict grammar the import
# writes, not by a browser's lenient one. The attacker hides a quote with a
# character a browser treats as space or name (a no-break space, a vertical tab,
# a byte-order mark) or with a construct the import never writes (an end tag
# with attributes, a < in text or in a value, an upper-case javascript: scheme).
# The import escapes every < as &lt;, so each of these is refused outright.
poison_case "(b21) a no-break space after = before a quote" "<a b=${nbsp}\"><img src=x onerror=alert(1)><a b=\"\">x</a>"
poison_case "(b22) a vertical tab after = before a quote" "<a b=${vt}\"><img src=x onerror=alert(1)><a b=\"\">x</a>"
poison_case "(b23) a byte-order mark after = before a quote" "<a b=${bom}\"><img src=x onerror=alert(1)><a b=\"\">x</a>"
poison_case "(b24) a no-break space inside a tag name" "<a${nbsp}b=\"><img src=x onerror=alert(1)><a b=\"\">x</a>"
poison_case "(b25) a no-break space ending an unquoted value" "<a b=x${nbsp}c=\"><img src=x onerror=alert(1)><a c=\"\">x</a>"
poison_case "(b26) an end tag carrying a quoted attribute" '</a b="><a c="><img src=x onerror=alert(1)><a d="">x</a>'
poison_case "(b27) an upper-case javascript: scheme" '<a href="JAVASCRIPT:alert(1)">x</a>'
poison_case "(b28) a < inside a quoted value" '<a title="<b>">x</a>'
poison_case "(b29) a bare < in text" '<p>a < b</p>'

# Case (b20): what the import writes when a document mentions these words
# (escaped, in a code block; a diagram; a note) -> passes.
sid=$(poison '<pre class="code" data-lang="html"><code>&lt;!-- a --&gt; &lt;textarea&gt; &lt;?x&gt;</code></pre><figure class="diagram" data-mermaid><pre hidden>graph TD</pre><figcaption>a diagram, drawing…</figcaption></figure><aside class="alert note"><b>note</b><p>titled</p></aside>')
rc=0
sh tools/ci/lint.sh > "$out" 2>&1 || rc=$?
if [ "$rc" -eq 0 ] && ! grep -q "carries script" "$out"; then
  echo "ok   escaped comment, textarea and <? text in code, a diagram and a note pass"
else
  echo "FAIL escaped comment, textarea and <? text in code, a diagram and a note pass (exit $rc, section $sid)"
  sed 's/^/     /' "$out"
  failed=1
fi
git reset -q --hard HEAD~1

# Case (b30): the forms the import does write -> passes: a non-ASCII id and
# label, an apostrophe and entities in a value, an empty value, a bare
# attribute, and a > in text.
sid=$(poison '<h2 id="café"><a class="anchor" href="#docs/x/café" aria-label="Link to this heading">#</a>Café &gt; a > b</h2><p>it'"'"'s <a href="https://e.com/a?b=1&amp;c='"'"'d'"'"'" target="_blank" rel="noopener">x</a></p><td class=""></td><figure data-mermaid><pre hidden>graph TD</pre></figure><br>')
rc=0
sh tools/ci/lint.sh > "$out" 2>&1 || rc=$?
if [ "$rc" -eq 0 ] && ! grep -q "carries script" "$out"; then
  echo "ok   the forms the import writes (non-ASCII, entities, empty and bare attributes) pass"
else
  echo "FAIL the forms the import writes (non-ASCII, entities, empty and bare attributes) pass (exit $rc, section $sid)"
  sed 's/^/     /' "$out"
  failed=1
fi
git reset -q --hard HEAD~1

# Case (c): the committed docs as they are -> the section runs and passes.
rc=0
sh tools/ci/lint.sh > "$out" 2>&1 || rc=$?
if [ "$rc" -eq 0 ] && grep -q "the imported docs carry no script" "$out"; then
  echo "ok   the committed docs carry no script"
else
  echo "FAIL the committed docs carry no script (exit $rc, want 0 with the section's heading in the output)"
  sed 's/^/     /' "$out"
  failed=1
fi

# Cases (a)-(d) judge section "the npm pins live in tools/package.json only".
# Each commits one fault, runs the lint, then restores the previous state.
# Before the manifest and lockfile exist the cases FAIL with a clear line
# instead of stopping the run.
commit_all() {
  git add -A
  git -c user.name=t -c user.email=t@t commit -q --allow-empty -m "$1"   # (a case may change nothing: m2 sets the name it already has)
}
lint_to_out() {
  rc=0
  sh tools/ci/lint.sh > "$out" 2>&1 || rc=$?
}

# Case (a): a package version named in a script (an install line for marked
# added to tools/ci/nightly-import.sh)
# (the line is built from parts: this file is itself a script the lint reads)
printf '%s\n' "npm i $(printf '%s@%s' marked 18.0.0)" >> tools/ci/nightly-import.sh
commit_all "pin in a script"
lint_to_out
if [ "$rc" -eq 1 ] && grep -q "tools/ci/nightly-import.sh" "$out"; then
  echo "ok   a marked@ pin in a script fails"
else
  echo "FAIL a marked@ pin in a script fails (exit $rc, want 1 naming tools/ci/nightly-import.sh)"
  sed 's/^/     /' "$out"
  failed=1
fi
git reset -q --hard HEAD~1

# Case (b): an entry of the lockfile with no integrity -> fails, names the
# lockfile and the entry.
if [ ! -f tools/package-lock.json ]; then
  echo "FAIL a lockfile entry without integrity fails (tools/package-lock.json missing)"
  failed=1
else
  entry=$(node -e '
    const fs = require("fs");
    const f = "tools/package-lock.json";
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    const k = Object.keys(j.packages || {}).find((p) => p !== "" && j.packages[p].integrity);
    if (!k) process.exit(1);
    delete j.packages[k].integrity;
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
    console.log(k);
  ') || entry=""
  if [ -z "$entry" ]; then
    echo "FAIL a lockfile entry without integrity fails (tools/package-lock.json has no entry with integrity to remove)"
    failed=1
  else
    commit_all "lockfile entry without integrity"
    lint_to_out
    if [ "$rc" -eq 1 ] && grep -q "tools/package-lock.json" "$out" && grep -q "$entry" "$out"; then
      echo "ok   a lockfile entry without integrity fails"
    else
      echo "FAIL a lockfile entry without integrity fails (exit $rc, want 1 naming tools/package-lock.json and $entry)"
      sed 's/^/     /' "$out"
      failed=1
    fi
    git reset -q --hard HEAD~1
  fi
fi

# Case (c): a range instead of an exact version in tools/package.json ->
# fails, names the manifest.
if [ ! -f tools/package.json ]; then
  echo "FAIL a range for marked in tools/package.json fails (tools/package.json missing)"
  failed=1
else
  node -e '
    const fs = require("fs");
    const f = "tools/package.json";
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    j.dependencies = j.dependencies || {};
    j.dependencies.marked = "^18.0.0";
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
  '
  commit_all "range for marked"
  lint_to_out
  if [ "$rc" -eq 1 ] && grep -q "tools/package.json" "$out"; then
    echo "ok   a range for marked in tools/package.json fails"
  else
    echo "FAIL a range for marked in tools/package.json fails (exit $rc, want 1 naming tools/package.json)"
    sed 's/^/     /' "$out"
    failed=1
  fi
  git reset -q --hard HEAD~1
fi

# Case (d): Renovate no longer watches npm -> fails, names renovate.json.
if ! node -e '
  const j = JSON.parse(require("fs").readFileSync("renovate.json", "utf8"));
  process.exit((j.enabledManagers || []).includes("npm") ? 0 : 1);
'; then
  echo "FAIL removing npm from enabledManagers fails (renovate.json does not list npm in enabledManagers)"
  failed=1
else
  node -e '
    const fs = require("fs");
    const j = JSON.parse(fs.readFileSync("renovate.json", "utf8"));
    j.enabledManagers = j.enabledManagers.filter((m) => m !== "npm");
    fs.writeFileSync("renovate.json", JSON.stringify(j, null, 2) + "\n");
  '
  commit_all "renovate without npm"
  lint_to_out
  if [ "$rc" -eq 1 ] && grep -q "renovate.json" "$out"; then
    echo "ok   removing npm from enabledManagers fails"
  else
    echo "FAIL removing npm from enabledManagers fails (exit $rc, want 1 naming renovate.json)"
    sed 's/^/     /' "$out"
    failed=1
  fi
  git reset -q --hard HEAD~1
fi

# Cases (e)-(f) judge the renovate.json check that no matchString of a
# customManagers item holds a look-around (Renovate compiles them with RE2,
# which has none, and rejects the whole config over one).
# The look-around is built from parts: this file is itself a script the lint reads.
la='(?'

# Case (e): a look-around in the first matchString -> fails, names renovate.json.
LOOK="${la}!x" node -e '
  const fs = require("fs");
  const j = JSON.parse(fs.readFileSync("renovate.json", "utf8"));
  j.customManagers[0].matchStrings[0] = process.env.LOOK;
  fs.writeFileSync("renovate.json", JSON.stringify(j, null, 2) + "\n");
'
commit_all "look-around in a matchString"
lint_to_out
if [ "$rc" -eq 1 ] && grep -q "renovate.json" "$out"; then
  echo "ok   a look-around in a matchString fails"
else
  echo "FAIL a look-around in a matchString fails (exit $rc, want 1 naming renovate.json)"
  sed 's/^/     /' "$out"
  failed=1
fi
git reset -q --hard HEAD~1

# Case (f): the committed renovate.json as it is -> no matchString holds a
# look-around (named groups such as the depName one are fine), and the lint
# reports none.
bad=$(node -e '
  const j = JSON.parse(require("fs").readFileSync("renovate.json", "utf8"));
  const re = new RegExp("\\(\\?(?:=|!|<=|<!)");
  for (const m of j.customManagers || [])
    for (const s of m.matchStrings || [])
      if (re.test(s)) console.log(s);
')
lint_to_out
if [ -z "$bad" ] && ! grep -Eiq 'look-?(around|ahead|behind)' "$out"; then
  echo "ok   the committed renovate.json has no look-around"
else
  echo "FAIL the committed renovate.json has no look-around (exit $rc, matchString: $bad)"
  sed 's/^/     /' "$out"
  failed=1
fi

# Cases (g)-(h) judge the .gitlab-ci.yml section "docs-import merge requests
# pull without the dependency proxy" (issue #13): the workflow rule for source
# branches docs/import-* sets CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX: docker.io,
# and (issue #20) so does the rule for pushes whose commit author is a GitLab
# project bot (CI_COMMIT_AUTHOR =~ /project_N_bot_/): the import's merge request
# merges itself as the bot, so main's push pipeline runs as the bot too.
proxy_line='^[[:space:]]*CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX:[[:space:]]*docker\.io[[:space:]]*$'

# Case (g): the docs/import rule loses its prefix override -> fails, names
# .gitlab-ci.yml. Before the rule exists there is nothing to remove: FAIL with
# a clear line instead of stopping the run.
if ! grep -q 'docs/import-' .gitlab-ci.yml || ! grep -Eq "$proxy_line" .gitlab-ci.yml; then
  echo "FAIL removing the docs/import prefix override fails (no docs/import rule to remove: .gitlab-ci.yml has no docs/import- rule setting CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX: docker.io)"
  failed=1
else
  sed -i -E "/$proxy_line/d" .gitlab-ci.yml
  commit_all "docs/import rule without the prefix override"
  lint_to_out
  if [ "$rc" -eq 1 ] && grep -q "\.gitlab-ci\.yml" "$out"; then
    echo "ok   removing the docs/import prefix override fails"
  else
    echo "FAIL removing the docs/import prefix override fails (exit $rc, want 1 naming .gitlab-ci.yml)"
    sed 's/^/     /' "$out"
    failed=1
  fi
  git reset -q --hard HEAD~1
fi

# Case (g2): the bot-author rule loses its prefix override -> fails, names
# .gitlab-ci.yml. Before the rule exists there is nothing to remove: FAIL with
# a clear line instead of stopping the run.
if ! grep -q 'CI_COMMIT_AUTHOR =~' .gitlab-ci.yml; then
  echo "FAIL removing the bot-author prefix override fails (no bot-author rule to remove: .gitlab-ci.yml has no CI_COMMIT_AUTHOR =~ rule)"
  failed=1
else
  sed -i '/CI_COMMIT_AUTHOR =~/d' .gitlab-ci.yml
  commit_all "bot-author rule removed"
  lint_to_out
  if [ "$rc" -eq 1 ] && grep -q "\.gitlab-ci\.yml" "$out"; then
    echo "ok   removing the bot-author prefix override fails"
  else
    echo "FAIL removing the bot-author prefix override fails (exit $rc, want 1 naming .gitlab-ci.yml)"
    sed 's/^/     /' "$out"
    failed=1
  fi
  git reset -q --hard HEAD~1
fi

# Cases (g3)-(g6): the rules are judged as blocks, in order (GitLab takes the
# first workflow rule that matches). Each edit leaves every line of the old
# checks in the file, so only a block-and-order check catches it. rule_case
# <label> <named> <js>: <js> edits the string y (the file) and must change it.
rule_case() {
  Y="$(cat .gitlab-ci.yml)" JS="$3" node -e '
    let y = process.env.Y; const before = y;
    new Function("y", "return y")(y);
    y = new Function("y", process.env.JS + "; return y;")(y);
    if (y === before) { console.error("the edit changed nothing"); process.exit(3); }
    require("fs").writeFileSync(".gitlab-ci.yml", y + "\n");
  ' || { echo "FAIL $1 (the test edit did not apply)"; failed=1; return; }
  commit_all "$1"
  lint_to_out
  if [ "$rc" -eq 1 ] && grep -q "\.gitlab-ci\.yml: .*$2" "$out"; then
    echo "ok   $1 fails"
  else
    echo "FAIL $1 fails (exit $rc, want 1 naming .gitlab-ci.yml: $2)"
    sed 's/^/     /' "$out"
    failed=1
  fi
  git reset -q --hard HEAD~1
}
# (g3) the docs/import rule moved below the general merge-request rule
rule_case "the docs/import rule after the general merge-request rule" "comes after the general merge-request rule" '
  const m = y.match(/    - if: \$CI_PIPELINE_SOURCE == "merge_request_event" && \$CI_MERGE_REQUEST_SOURCE_BRANCH_NAME =~ \/\^docs\\\/import-\/\n      variables:\n        CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX: docker.io\n/);
  const g = "    - if: $CI_PIPELINE_SOURCE == \"merge_request_event\"\n";
  y = y.replace(m[0], "").replace(g, g + m[0]);'
# (g4) its override moved to another rule: every old line is still in the file
rule_case "the docs/import rule's override moved to the general merge-request rule" "docs/import- merge-request rule does not set" '
  const o = "      variables:\n        CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX: docker.io\n";
  const d = "=~ /^docs\\/import-/\n";
  const g = "    - if: $CI_PIPELINE_SOURCE == \"merge_request_event\"\n";
  y = y.replace(d + o, d).replace(g, g + o);'
# (g5) the docs/import rule turned off
rule_case "the docs/import rule with when: never" "docs/import- merge-request rule does not set" '
  y = y.replace("=~ /^docs\\/import-/\n      variables:", "=~ /^docs\\/import-/\n      when: never\n      variables:");'
# (g6) the bot-author rule moved below the closing rule
rule_case "the bot-author rule after the general branch rule" "bot-author rule comes after" '
  const b = "    - if: $CI_COMMIT_BRANCH && $CI_COMMIT_AUTHOR =~ /project_[0-9]+_bot_/\n      variables:\n        CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX: docker.io\n";
  const c = "    - if: $CI_COMMIT_BRANCH\n";
  y = y.replace(b, "").replace(c, c + b);'

# Case (h): the committed tree as it is -> the lint passes and has a heading
# for the section, a "==" line naming both "import" and "dependency proxy".
lint_to_out
if [ "$rc" -eq 0 ] && grep -i '^==' "$out" | grep -i 'import' | grep -iq 'dependency proxy'; then
  echo "ok   the committed .gitlab-ci.yml has the docs-import proxy section and passes"
else
  echo "FAIL the committed .gitlab-ci.yml has the docs-import proxy section and passes (exit $rc, want 0 with a == heading naming import and dependency proxy)"
  sed 's/^/     /' "$out"
  failed=1
fi
# Cases (i)-(l) judge section "the shared door is self-contained" (ADR-0001).
# Each adds one offending line, runs the lint, and takes the commit back.
# door_case <label> <file> <line> <named>: the line appended to the file must
# fail the lint with a message naming <named>.
door_case() {
  printf '%s\n' "$3" >> "$2"
  commit_all "$1"
  lint_to_out
  if [ "$rc" -eq 1 ] && grep -q "$4" "$out"; then
    echo "ok   $1 fails"
  else
    echo "FAIL $1 fails (exit $rc, want 1 naming $4)"
    sed 's/^/     /' "$out"
    failed=1
  fi
  git reset -q --hard HEAD~1
}
# Case (i): a module of the folder importing a site module -> fails, names the file.
door_case "a door module importing from outside the folder" assets/door/stars.js 'import { reduced } from "../js/sky.js";' "assets/door/stars.js:.*outside the folder"
# Case (i2): the same over several lines, and (i3) a bare import with no `from` -> fail.
door_case "a door module importing from outside over several lines" assets/door/stars.js 'import {
  reduced,
} from "../js/sky.js";' "assets/door/stars.js:.*outside the folder"
door_case "a door module with a bare import from outside" assets/door/stars.js "import '../js/sky.js';" "assets/door/stars.js:.*outside the folder"
# Case (j): a module of the folder reading the address -> fails.
door_case "a door module reading location.search" assets/door/stars.js 'export const X = /x/.test(location.search);' "assets/door/stars.js:.*reads the address"
# Case (k): a module of the folder making a URL from import.meta.url -> fails.
door_case "a door module using import.meta.url" assets/door/stars.js 'export const Y = new URL("./img/dawn/dawn.webp", import.meta.url).href;' "assets/door/stars.js:.*import.meta.url"
# Case (l): a site module importing a file of the folder other than index.js -> fails, names the module.
door_case "a site module importing inside the folder" assets/js/sky.js 'import { DAWN_FAR as Z } from "../door/stars.js";' "assets/js/sky.js:.*index.js"
# Case (n): a url() in door.css reaching outside the folder -> fails, names door.css.
door_case "a door.css url outside the folder" assets/door/door.css '#door .x{background:url(../img/mark.svg)}' "assets/door/door.css -> ../img/mark.svg"
# Case (o): the page's copy of the door edited by hand -> fails, names index.html.
sed -i 's/<svg class="wl wash" /<svg class="wl washed" /' index.html
commit_all "index.html door edited by hand"
lint_to_out
if [ "$rc" -eq 1 ] && grep -q "index.html: the door's markup differs" "$out"; then
  echo "ok   a hand-edited door in index.html fails"
else
  echo "FAIL a hand-edited door in index.html fails (exit $rc, want 1 naming index.html)"
  sed 's/^/     /' "$out"
  failed=1
fi
git reset -q --hard HEAD~1
# Case (m): the committed tree as it is -> the section runs and passes.
lint_to_out
if [ "$rc" -eq 0 ] && grep -i '^==' "$out" | grep -iq 'shared door'; then
  echo "ok   the committed door folder passes the self-contained section"
else
  echo "FAIL the committed door folder passes the self-contained section (exit $rc, want 0 with a == heading naming the shared door)"
  sed 's/^/     /' "$out"
  failed=1
fi
# Cases (s1)-(s11) judge the section "the docs import is split" (issue #18):
# import_docs runs other people's code and holds no token; publish_docs holds it
# in the docs-import environment, runs no npm, and takes the artifact. Both run
# from the schedule on main alone. split_case <label> <file> <named> <js>: <js>
# edits the string y (the file's text) and must change it; the lint must fail
# naming <file> with <named>. <named> is an extended regular expression and the
# whole of it, alternatives included, must sit on a line after "<file>: ", so a
# refusal for an unrelated reason cannot pass a case.
split_case() {
  F="$2" Y="$(cat "$2")" JS="$4" node -e '
    let y = process.env.Y; const before = y;
    y = new Function("y", process.env.JS + "; return y;")(y);
    if (y === before) { console.error("the edit changed nothing"); process.exit(3); }
    require("fs").writeFileSync(process.env.F, y + "\n");
  ' || { echo "FAIL $1 (the test edit did not apply)"; failed=1; return; }
  commit_all "$1"
  lint_to_out
  if [ "$rc" -eq 1 ] && grep -Eq "$2: .*($3)" "$out"; then
    echo "ok   $1 fails"
  else
    echo "FAIL $1 fails (exit $rc, want 1 naming $2: $3)"
    sed 's/^/     /' "$out"
    failed=1
  fi
  git reset -q --hard HEAD~1
}
ci=.gitlab-ci.yml
split_case "import_docs joining an environment" $ci "import_docs has an environment" '
  y = y.replace("import_docs:\n  stage: maintenance\n", "import_docs:\n  stage: maintenance\n  environment:\n    name: docs-import\n");'
split_case "import_docs naming the token" $ci "import_docs names ORBIT_SITE_IMPORT_TOKEN" '
  y = y.replace("  script:\n    - sh tools/ci/nightly-import.sh\n", "  script:\n    - echo $ORBIT_SITE_IMPORT_TOKEN | wc -c\n    - sh tools/ci/nightly-import.sh\n");'
split_case "import_docs running on merge requests" $ci "import_docs rules must be" '
  y = y.replace("import_docs:\n  stage: maintenance\n  image: $NODE_IMAGE\n  interruptible: false\n  rules:\n", "import_docs:\n  stage: maintenance\n  image: $NODE_IMAGE\n  interruptible: false\n  rules:\n    - if: $CI_PIPELINE_SOURCE == \"merge_request_event\"\n");'
split_case "import_docs handing on more than the docs" $ci "import_docs artifacts must be assets/docs/ alone" '
  y = y.replace("      - assets/docs/\n", "      - assets/docs/\n      - tools/\n");'
split_case "import_docs with a long-lived artifact" $ci "import_docs artifacts need a short expire_in" '
  y = y.replace("    expire_in: 1 day\n", "    expire_in: 30 days\n");'
split_case "another job joining the docs-import environment" $ci "renovate names the docs-import environment" '
  y = y.replace("renovate:\n  stage: maintenance\n", "renovate:\n  stage: maintenance\n  environment:\n    name: docs-import\n");'
split_case "a hidden template naming the docs-import environment" $ci "names the docs-import environment" '
  y = y + "\n.template:\n  environment:\n    name: docs-import\n";'
# Cases (s12)-(s14): the renovate job joins the environment renovate (the
# schedule's token scope), and no other job or template may name it.
split_case "renovate without its environment" $ci "renovate.*environment" '
  y = y.replace(/(\nrenovate:\n(?:[ \t][^\n]*\n|\n(?=[ \t]))*?)  environment:\n(?:    [^\n]*\n)+/, "$1");'
split_case "another job joining the renovate environment" $ci "lint.*renovate" '
  y = y.replace("lint:\n  stage: lint\n", "lint:\n  stage: lint\n  environment:\n    name: renovate\n");'
split_case "a hidden template naming the renovate environment" $ci "renovate" '
  y = y + "\n.t:\n  environment:\n    name: renovate\n";'
split_case "a template joining renovate by the short form" $ci "names the renovate environment" '
  y = y + "\n.t:\n  environment: renovate\n";'
# The forms a line reader misses and a word test does not (fix review round 2).
# Each must be refused however the environment key is written.
split_case "a template joining renovate with a trailing comment" $ci "names the renovate environment" '
  y = y + "\n.t:\n  environment: renovate # tokens\n";'
split_case "a template joining renovate in flow style" $ci "names the renovate environment" '
  y = y + "\n.t:\n  environment: {name: renovate}\n";'
split_case "publish_docs joining renovate by a second environment key" $ci "publish_docs names the renovate environment" '
  y = y.replace(/(\npublish_docs:\n[\s\S]*?    deployment_tier: other\n)/, "$1  environment: renovate\n");'
split_case "a four-space-indented template joining renovate" $ci "names the renovate environment" '
  y = y + "\n.t:\n    environment:\n        name: renovate\n";'
split_case "publish_docs without its environment" $ci "publish_docs has no environment named docs-import" '
  y = y.replace("    name: docs-import\n", "    name: other\n");'
split_case "publish_docs taking the import job's artifacts through needs" $ci "publish_docs needs must take import_docs without its artifacts" '
  y = y.replace("      artifacts: false\n", "      artifacts: true\n");'
split_case "publish_docs on a reused build folder" $ci "publish_docs needs GIT_STRATEGY: clone" '
  y = y.replace("    GIT_STRATEGY: clone\n", "");'
split_case "publish_docs on a different schedule rule" $ci "publish_docs rules must be" '
  y = y.replace("publish_docs:", "publish_docs:").replace(/(publish_docs:[\s\S]*?  rules:\n    - if: [^\n]*) && \$CI_COMMIT_BRANCH == "main"\n/, "$1\n");'
split_case "publish_docs running npm" $ci "publish_docs runs npm" '
  y = y.replace("    - sh tools/ci/nightly-publish.sh\n", "    - npm ci --prefix tools\n    - sh tools/ci/nightly-publish.sh\n");'
split_case "the import script naming the token" tools/ci/nightly-import.sh "names the token" '
  y = y.replace("DRY_RUN=${DRY_RUN:-}\n", "DRY_RUN=${DRY_RUN:-}\ntoken=${ORBIT_SITE_IMPORT_TOKEN:-}\n");'
split_case "the import script calling the API" tools/ci/nightly-import.sh "calls curl or git push" '
  y = y.replace("  node tools/import-docs.mjs\n", "  node tools/import-docs.mjs\n  curl -fsS https://gitlab.invalid/api\n");'
split_case "the publish script running npm" tools/ci/nightly-publish.sh "runs npm" '
  y = y.replace("  echo \"== the artifact\"\n", "  echo \"== the artifact\"\n  npm ci --prefix tools\n");'

# Cases (y1)-(y9) judge the same section once it reads .gitlab-ci.yml as YAML
# (issue #52). yaml_pass_case <label> <js>: <js> edits the string y and must
# change it; the whole lint must pass and print no line saying a job names the
# docs-import or renovate environment (a job that only mentions them is no
# member). The refusal cases use split_case: the lint must fail naming the job.
yaml_pass_case() {
  F="$ci" Y="$(cat "$ci")" JS="$2" node -e '
    let y = process.env.Y; const before = y;
    y = new Function("y", process.env.JS + "; return y;")(y);
    if (y === before) { console.error("the edit changed nothing"); process.exit(3); }
    require("fs").writeFileSync(process.env.F, y + "\n");
  ' || { echo "FAIL $1 (the test edit did not apply)"; failed=1; return; }
  commit_all "$1"
  lint_to_out
  if [ "$rc" -eq 0 ] && ! grep -Eq "names the (docs-import|renovate) environment" "$out" \
    && grep -i '^==' "$out" | grep -iq 'docs import is split'; then
    echo "ok   $1 passes"
  else
    echo "FAIL $1 passes (exit $rc, want 0 and no job refused for naming an environment)"
    sed 's/^/     /' "$out"
    failed=1
  fi
  git reset -q --hard HEAD~1
}
# Over-refusal: the words appear, no environment is joined.
yaml_pass_case "a job running a script line that names renovate.json" '
  y = y.replace("    - sh tools/ci/lint.sh\n", "    - sh tools/ci/lint.sh\n    - test -f renovate.json\n");'
yaml_pass_case "a job with a trailing comment naming renovate.json" '
  y = y.replace("    - sh tools/ci/lint.sh\n", "    - sh tools/ci/lint.sh # renovate.json is read by the renovate job\n");'
yaml_pass_case "a job naming a renovate/ branch" '
  y = y.replace("    - sh tools/ci/lint.sh\n", "    - sh tools/ci/lint.sh\n    - test \"$CI_COMMIT_BRANCH\" != renovate/marked-18.x\n");'
# Under-refusal: valid YAML a line reader does not see, joining an environment.
split_case "a job key with a trailing comment joining docs-import" $ci "sneaky names the docs-import environment" '
  y = y + "\nsneaky: # note\n  stage: lint\n  environment: docs-import\n  script:\n    - \"true\"\n";'
split_case "a job in flow style joining docs-import" $ci "sneaky names the docs-import environment" '
  y = y + "\nsneaky: { stage: lint, environment: docs-import, script: [ \"true\" ] }\n";'
split_case "a job with environment as a mapping joining docs-import" $ci "sneaky names the docs-import environment" '
  y = y + "\nsneaky:\n  stage: lint\n  environment: { name: docs-import }\n  script:\n    - \"true\"\n";'
split_case "a job key with a trailing comment joining renovate" $ci "sneaky names the renovate environment" '
  y = y + "\nsneaky: # note\n  stage: lint\n  environment:\n    name: renovate\n  script:\n    - \"true\"\n";'
split_case "a job in flow style joining renovate" $ci "sneaky names the renovate environment" '
  y = y + "\nsneaky: { stage: lint, environment: { name: renovate }, script: [ \"true\" ] }\n";'
split_case "a job with environment as a mapping joining renovate after a comment" $ci "sneaky names the renovate environment" '
  y = y + "\nsneaky: # note\n  stage: lint\n  environment: { name: renovate } # tokens\n  script:\n    - \"true\"\n";'

# A job may also INHERIT a scoped environment without naming it (issue #52): by
# extends (one name or a list), by !reference, or by extending a template that
# names it. The lint must fail naming the inheriting job and the environment.
split_case "a job extending publish_docs" $ci "inheritor.*docs-import" '
  y = y + "\ninheritor:\n  stage: lint\n  extends: publish_docs\n  script:\n    - \"true\"\n";'
split_case "a job extending publish_docs in a list" $ci "inheritor.*docs-import" '
  y = y + "\n.something:\n  interruptible: true\n\ninheritor:\n  stage: lint\n  extends: [ .something, publish_docs ]\n  script:\n    - \"true\"\n";'
split_case "a job taking the environment of publish_docs by !reference" $ci "inheritor.*docs-import" '
  y = y + "\ninheritor:\n  stage: lint\n  environment: !reference [publish_docs, environment]\n  script:\n    - \"true\"\n";'
split_case "a job extending a template that names docs-import" $ci "inheritor.*docs-import" '
  y = y + "\n.tpl:\n  environment: docs-import\n\ninheritor:\n  stage: lint\n  extends: .tpl\n  script:\n    - \"true\"\n";'
split_case "the template that names docs-import is still refused" $ci "\\.tpl.*docs-import" '
  y = y + "\n.tpl:\n  environment: docs-import\n\ninheritor:\n  stage: lint\n  extends: .tpl\n  script:\n    - \"true\"\n";'
split_case "a job extending renovate" $ci "inheritor.*renovate" '
  y = y + "\ninheritor:\n  stage: lint\n  extends: renovate\n  script:\n    - \"true\"\n";'

# Cases (M1)-(M6) judge the same section against .gitlab-ci.yml edits GitLab
# accepts and the first YAML check let through (issue #52 review, issue #59).
# A YAML merge key AFTER an explicit key in the same mapping: GitLab's reader
# (Ruby Psych) lets the later << overwrite the explicit key, other readers keep
# the explicit key, so the file is ambiguous and is refused (cases p1-p2); a
# << that comes FIRST is unambiguous and passes (case p3). A child pipeline
# (trigger: include) may hold a job the check never sees (cases p4-p5). A package
# manager reached through !reference (case p6), or in publish_docs's
# before_script or after_script, its own, through extends, or from default:
# (cases p7-p11). publish_docs gaining services:, default: gaining services:,
# or publish_docs's image changing (cases p12-p14). import_docs's expire_in
# 999 hours and 2 days are refused, 24 hours and 30 minutes pass (cases p15-p18).
# M1: merge key after an explicit key, the environment mapping form.
split_case "p1: a merge key after an explicit environment name" $ci "evil has a merge key \\(<<\\) after an explicit key" '
  y = y.replace("  environment:\n    name: docs-import\n", "  environment: &penv\n    name: docs-import\n");
  y = y + "\nevil:\n  stage: lint\n  environment:\n    name: production\n    <<: *penv\n  script:\n    - \"true\"\n";'
# M1: the whole-job form.
split_case "p2: a whole-job merge key after an explicit environment" $ci "evil has a merge key \\(<<\\) after an explicit key" '
  y = y.replace("\npublish_docs:\n", "\npublish_docs: &pub\n");
  y = y + "\nevil:\n  stage: lint\n  environment: production\n  <<: *pub\n  script:\n    - \"true\"\n";'
# M1: a merge key first, then explicit keys, with a harmless anchor: unambiguous, allowed.
yaml_pass_case "p3: a merge key before the explicit keys passes" '
  y = y + "\n.harmless: &harmless\n  interruptible: false\n\nfine:\n  <<: *harmless\n  stage: lint\n  script:\n    - \"true\"\n";'
# M2: child pipelines.
split_case "p4: a child pipeline from a file" $ci "spawner starts a child pipeline" '
  y = y + "\nspawner:\n  stage: lint\n  trigger: { include: ci/child.yml }\n";'
split_case "p5: a child pipeline from an artifact" $ci "spawner starts a child pipeline" '
  y = y + "\nspawner:\n  stage: lint\n  trigger: { include: [ { artifact: x.yml, job: lint } ] }\n";'
# M3: a package manager through !reference.
split_case "p6: publish_docs running a package manager through !reference" $ci "publish_docs runs npm or another package manager; it holds" '
  y = y + "\n.n: { script: [ \"npx evil\" ] }\n";
  y = y.replace("  script:\n    - sh tools/ci/nightly-publish.sh\n", "  script: [ !reference [.n, script], sh tools/ci/nightly-publish.sh ]\n");'
# M4 (#59): a package manager in a hook of publish_docs.
split_case "p7: publish_docs with a package manager in its before_script" $ci "publish_docs runs npm or another package manager in its before_script" '
  y = y.replace("  script:\n    - sh tools/ci/nightly-publish.sh\n", "  before_script:\n    - npm ci --prefix tools\n  script:\n    - sh tools/ci/nightly-publish.sh\n");'
split_case "p8: publish_docs with a package manager in its after_script" $ci "publish_docs runs npm or another package manager in its after_script" '
  y = y.replace("  script:\n    - sh tools/ci/nightly-publish.sh\n", "  script:\n    - sh tools/ci/nightly-publish.sh\n  after_script:\n    - npm ci --prefix tools\n");'
split_case "p9: publish_docs extending a parent with a package manager in before_script" $ci "publish_docs runs npm or another package manager in its before_script" '
  y = y.replace("publish_docs:\n  stage: publish\n", "publish_docs:\n  extends: .pre\n  stage: publish\n");
  y = y + "\n.pre:\n  before_script:\n    - npm ci --prefix tools\n";'
split_case "p10: publish_docs extending a parent with a package manager in after_script" $ci "publish_docs runs npm or another package manager in its after_script" '
  y = y.replace("publish_docs:\n  stage: publish\n", "publish_docs:\n  extends: .post\n  stage: publish\n");
  y = y + "\n.post:\n  after_script:\n    - npm ci --prefix tools\n";'
split_case "p11: a package manager in default before_script" $ci "publish_docs runs npm or another package manager in the before_script it takes from default" '
  y = y.replace("default:\n  tags: [light]\n", "default:\n  tags: [light]\n  before_script:\n    - npm ci --prefix tools\n");'
# M5: services and image.
split_case "p12: publish_docs gaining services" $ci "publish_docs has services; a service container" '
  y = y.replace("publish_docs:\n  stage: publish\n  image: $NODE_IMAGE\n", "publish_docs:\n  stage: publish\n  image: $NODE_IMAGE\n  services:\n    - some/image\n");'
split_case "p13: default gaining services" $ci "default has services; they would run beside the token" '
  y = y.replace("default:\n  tags: [light]\n", "default:\n  tags: [light]\n  services:\n    - some/image\n");'
split_case "p14: publish_docs with a different image" $ci "publish_docs must set its own image" '
  y = y.replace("publish_docs:\n  stage: publish\n  image: $NODE_IMAGE\n", "publish_docs:\n  stage: publish\n  image: some/other:1\n");'
# M6 (#59): expire_in is a short time in hours or minutes, one day at most.
split_case "p15: import_docs with expire_in 999 hours" $ci "import_docs artifacts need a short expire_in" '
  y = y.replace("    expire_in: 1 day\n", "    expire_in: 999 hours\n");'
split_case "p16: import_docs with expire_in 2 days" $ci "import_docs artifacts need a short expire_in" '
  y = y.replace("    expire_in: 1 day\n", "    expire_in: 2 days\n");'
yaml_pass_case "p17: import_docs with expire_in 24 hours passes" '
  y = y.replace("    expire_in: 1 day\n", "    expire_in: 24 hours\n");'
yaml_pass_case "p18: import_docs with expire_in 30 minutes passes" '
  y = y.replace("    expire_in: 1 day\n", "    expire_in: 30 minutes\n");'
# Two merge keys in ONE mapping before any explicit key (#52): Ruby Psych (GitLab's reader) takes the
# second <<, js-yaml the first, so the file is ambiguous and is refused (case p19). The list form
# <<: [*a, *b] is one key and both readers keep the first, so it passes (case p20).
split_case "p19: two merge keys in one environment mapping" $ci "evil has two merge keys \\(<<\\) in one mapping" '
  y = y.replace("  environment:\n    name: docs-import\n", "  environment: &penv\n    name: docs-import\n");
  y = y + "\n.stg: &a\n  name: staging\n\nevil:\n  stage: lint\n  environment:\n    <<: *a\n    <<: *penv\n    url: https://example.invalid\n  script:\n    - \"true\"\n";'
yaml_pass_case "p20: a merge key list of two harmless anchors passes" '
  y = y + "\n.h1: &h1\n  interruptible: false\n\n.h2: &h2\n  retry: 1\n\nfine2:\n  <<: [*h1, *h2]\n  stage: lint\n  script:\n    - \"true\"\n";'
# Cases p21-p71 (#60) judge the same section against readings where GitLab's reader (Ruby Psych:
# YAML.safe_load with permitted_classes [Symbol] and aliases, then deep_symbolize_keys) and js-yaml part ways.
# Anything the two could read differently is refused, not interpreted. Quoted merge keys "<<" and '<<'
# (Psych merges them; cases p21-p26). A mapping key starting with a colon, which Psych makes a Symbol that
# GitLab folds onto the plain key (p27-p31). A key that is not a plain string to both readers: yes, on, y, ~,
# 1, null, true (p32-p38; p39 passes names that only begin like one). An explicit tag other than !reference
# (p40-p44; p45 passes !reference). An environment name holding a %NAME% variable (p46-p48). publish_docs's
# needs holding anything but the one import_docs entry without artifacts (p49-p53). hooks: (p54-p58) or cache:
# (p59-p63) on publish_docs, a parent or default:. A second NODE_IMAGE, or any variable the image reads, outside
# the one pinned global definition (p64-p70; p71 passes an unrelated variable). Hooks and a cache on a job that
# publish_docs does not inherit from are not the token job's concern (p58b, p63b pass).
# Quoted merge keys.
split_case "p21: a top-level double-quoted merge key" $ci "a quoted merge key \"<<\"" '
  y = y + "\n\"<<\": *not_scheduled\n";'
split_case "p22: a double-quoted merge key holding an alias in a job" $ci "in fine4: a quoted merge key \"<<\"" '
  y = y + "\n.base: &base\n  interruptible: false\n\nfine4:\n  \"<<\": *base\n  stage: lint\n  script:\n    - \"true\"\n";'
split_case "p23: a single-quoted merge key holding a mapping in a job" $ci "in fine5: a quoted merge key '<<'" '
  y = y + "\nfine5:\n  \x27<<\x27: { interruptible: false }\n  stage: lint\n  script:\n    - \"true\"\n";'
split_case "p24: a single-quoted merge key holding an alias in a hidden job" $ci "in .hidden: a quoted merge key '<<'" '
  y = y + "\n.base: &base\n  interruptible: false\n\n.hidden:\n  \x27<<\x27: *base\n  stage: lint\n";'
split_case "p25: a double-quoted merge key in publish_docs" $ci "in publish_docs: a quoted merge key \"<<\"" '
  y = y.replace("publish_docs:\n  stage: publish\n", "publish_docs:\n  \"<<\": { retry: 1 }\n  stage: publish\n");'
split_case "p26: a double-quoted merge key in a job's variables" $ci "in fine6 > variables: a quoted merge key \"<<\"" '
  y = y + "\n.vars: &vars\n  A: one\n\nfine6:\n  stage: lint\n  variables:\n    \"<<\": *vars\n  script:\n    - \"true\"\n";'
# Keys starting with a colon.
split_case "p27: a :script key in a job" $ci "the key :script starts with a colon" '
  y = y + "\nfine7:\n  stage: lint\n  :script:\n    - \"true\"\n";'
split_case "p28: a job inheriting publish_docs through an :extends key" $ci "in inheritor: the key :extends starts with a colon" '
  y = y + "\ninheritor:\n  stage: lint\n  :extends: publish_docs\n  script:\n    - \"true\"\n";'
split_case "p29: a top-level :include key" $ci "the key :include starts with a colon" '
  y = y + "\n:include:\n  - local: other.yml\n";'
split_case "p30: a :rules key in publish_docs" $ci "the key :rules starts with a colon" '
  y = y.replace("publish_docs:\n  stage: publish\n", "publish_docs:\n  :rules:\n    - when: always\n  stage: publish\n");'
split_case "p31: a colon-led variable name" $ci "the key :FOO starts with a colon" '
  y = y.replace("    GIT_STRATEGY: clone\n", "    GIT_STRATEGY: clone\n    :FOO: bar\n");'
# Keys that are not a plain string to both readers.
split_case "p32: a job named yes" $ci "the key yes is not a plain string" '
  y = y + "\nyes:\n  stage: lint\n  script:\n    - \"true\"\n";'
split_case "p33: a top-level key on" $ci "the key on is not a plain string" '
  y = y + "\non:\n  stage: lint\n  script:\n    - \"true\"\n";'
split_case "p34: a variable named y" $ci "the key y is not a plain string" '
  y = y.replace("    GIT_STRATEGY: clone\n", "    GIT_STRATEGY: clone\n    y: \"1\"\n");'
split_case "p35: a job named ~" $ci "the key ~ is not a plain string" '
  y = y + "\n~:\n  stage: lint\n  script:\n    - \"true\"\n";'
split_case "p36: a job named 1" $ci "the key 1 is not a plain string" '
  y = y + "\n1:\n  stage: lint\n  script:\n    - \"true\"\n";'
split_case "p37: a variable named null" $ci "the key null is not a plain string" '
  y = y.replace("    GIT_STRATEGY: clone\n", "    GIT_STRATEGY: clone\n    null: \"1\"\n");'
split_case "p38: a nested key true" $ci "the key true is not a plain string" '
  y = y + "\nfine8:\n  stage: lint\n  variables:\n    true: \"1\"\n  script:\n    - \"true\"\n";'
yaml_pass_case "p39: job names that only begin like a boolean, a null or a number pass" '
  y = y + "\nyesterday:\n  stage: lint\n  script:\n    - \"true\"\n\nonline:\n  stage: lint\n  script:\n    - \"true\"\n\ny2:\n  stage: lint\n  script:\n    - \"true\"\n\nv1:\n  stage: lint\n  script:\n    - \"true\"\n\nnope:\n  stage: lint\n  script:\n    - \"true\"\n";'
# Explicit tags other than !reference.
split_case "p40: a !!str tag on a value" $ci "the explicit tag !!str" '
  y = y + "\nfine9:\n  stage: !!str lint\n  script:\n    - \"true\"\n";'
split_case "p41: a !!merge tag on a merge key" $ci "the explicit tag !!merge" '
  y = y + "\n.base: &base\n  interruptible: false\n\nfine10:\n  !!merge <<: *base\n  stage: lint\n  script:\n    - \"true\"\n";'
split_case "p42: a !ruby tag on a value" $ci "the explicit tag !ruby" '
  y = y + "\nfine11:\n  stage: lint\n  variables: !ruby/object:Object {}\n  script:\n    - \"true\"\n";'
split_case "p43: a !!str tag on a key" $ci "the explicit tag !!str" '
  y = y + "\nfine12:\n  stage: lint\n  !!str script:\n    - \"true\"\n";'
split_case "p44: a !!int tag on a value in publish_docs" $ci "the explicit tag !!int" '
  y = y.replace("    GIT_DEPTH: 1\n    GIT_STRATEGY: clone\n", "    GIT_DEPTH: !!int 1\n    GIT_STRATEGY: clone\n");'
yaml_pass_case "p45: a harmless !reference passes" '
  y = y + "\n.refd:\n  script:\n    - \"true\"\n\nfine13:\n  stage: lint\n  script: [ !reference [.refd, script] ]\n";'
# An environment name holding a %NAME% variable.
split_case "p46: an environment name built from two %VAR% variables" $ci "sneaky.*(holds a variable|%)" '
  y = y + "\nsneaky:\n  stage: lint\n  variables: { A: docs, B: import }\n  environment: { name: \"%A%-%B%\" }\n  script:\n    - \"true\"\n";'
split_case "p47: an environment name that is one %VAR% in the block form" $ci "sneaky.*(holds a variable|%)" '
  y = y + "\nsneaky:\n  stage: lint\n  variables:\n    A: abc\n  environment:\n    name: \"%A%\"\n  script:\n    - \"true\"\n";'
split_case "p48: a hidden template naming an environment by %VAR% in the short form" $ci "\\.t.*(holds a variable|%)" '
  y = y + "\n.t:\n  variables:\n    X: abc\n  environment: \"%X%\"\n";'
# publish_docs's needs.
split_case "p49: publish_docs needing a second job" $ci "publish_docs needs must take import_docs without its artifacts" '
  y = y.replace("      artifacts: false\n  environment:", "      artifacts: false\n    - job: prep\n  environment:");
  y = y + "\nprep:\n  stage: lint\n  script:\n    - \"true\"\n";'
split_case "p50: publish_docs taking the artifacts of lint" $ci "publish_docs needs must take import_docs without its artifacts" '
  y = y.replace("      artifacts: false\n  environment:", "      artifacts: false\n    - { job: lint, artifacts: true }\n  environment:");'
split_case "p51: publish_docs needing lint without its artifacts" $ci "publish_docs needs must take import_docs without its artifacts" '
  y = y.replace("      artifacts: false\n  environment:", "      artifacts: false\n    - { job: lint, artifacts: false }\n  environment:");'
split_case "p52: publish_docs needing import_docs twice" $ci "publish_docs needs must take import_docs without its artifacts" '
  y = y.replace("      artifacts: false\n  environment:", "      artifacts: false\n    - job: import_docs\n      artifacts: false\n  environment:");'
split_case "p53: publish_docs needing lint instead of import_docs" $ci "publish_docs needs must take import_docs without its artifacts" '
  y = y.replace("    - job: import_docs\n      artifacts: false\n  environment:", "    - job: lint\n      artifacts: false\n  environment:");'
# hooks:
split_case "p54: publish_docs with hooks" $ci "publish_docs has hooks; a hook runs shell commands" '
  y = y.replace("  script:\n    - sh tools/ci/nightly-publish.sh\n", "  hooks:\n    pre_get_sources_script:\n      - echo hi\n  script:\n    - sh tools/ci/nightly-publish.sh\n");'
split_case "p55: publish_docs extending a parent with hooks" $ci "publish_docs extends .parent, which has hooks" '
  y = y.replace("publish_docs:\n  stage: publish\n", "publish_docs:\n  extends: .parent\n  stage: publish\n");
  y = y + "\n.parent:\n  hooks:\n    pre_get_sources_script:\n      - echo hi\n";'
split_case "p56: publish_docs extending a grandparent with hooks" $ci "publish_docs extends .grand, which has hooks" '
  y = y.replace("publish_docs:\n  stage: publish\n", "publish_docs:\n  extends: .parent\n  stage: publish\n");
  y = y + "\n.parent:\n  extends: .grand\n\n.grand:\n  hooks:\n    pre_get_sources_script:\n      - echo hi\n";'
split_case "p57: default with hooks" $ci "default has hooks, which publish_docs takes" '
  y = y.replace("default:\n  tags: [light]\n", "default:\n  tags: [light]\n  hooks:\n    pre_get_sources_script:\n      - echo hi\n");'
split_case "p58: publish_docs with hooks in flow style" $ci "publish_docs has hooks; a hook runs shell commands" '
  y = y.replace("  script:\n    - sh tools/ci/nightly-publish.sh\n", "  hooks: { pre_get_sources_script: [ \"echo hi\" ] }\n  script:\n    - sh tools/ci/nightly-publish.sh\n");'
yaml_pass_case "p58b: hooks on lint, which publish_docs does not inherit from, pass" '
  y = y.replace("lint:\n  stage: lint\n", "lint:\n  stage: lint\n  hooks:\n    pre_get_sources_script:\n      - echo hi\n");'
# cache:
split_case "p59: publish_docs with a cache" $ci "publish_docs has a cache; a cache holds files" '
  y = y.replace("  script:\n    - sh tools/ci/nightly-publish.sh\n", "  cache:\n    paths:\n      - node_modules/\n  script:\n    - sh tools/ci/nightly-publish.sh\n");'
split_case "p60: publish_docs extending a parent with a cache" $ci "publish_docs extends .parent, which has a cache" '
  y = y.replace("publish_docs:\n  stage: publish\n", "publish_docs:\n  extends: .parent\n  stage: publish\n");
  y = y + "\n.parent:\n  cache:\n    paths:\n      - node_modules/\n";'
split_case "p61: publish_docs extending a grandparent with a cache" $ci "publish_docs extends .grand, which has a cache" '
  y = y.replace("publish_docs:\n  stage: publish\n", "publish_docs:\n  extends: .parent\n  stage: publish\n");
  y = y + "\n.parent:\n  extends: .grand\n\n.grand:\n  cache:\n    paths:\n      - node_modules/\n";'
split_case "p62: default with a cache" $ci "default has a cache, which publish_docs takes" '
  y = y.replace("default:\n  tags: [light]\n", "default:\n  tags: [light]\n  cache:\n    paths:\n      - node_modules/\n");'
split_case "p63: publish_docs with a cache in flow style" $ci "publish_docs has a cache; a cache holds files" '
  y = y.replace("  script:\n    - sh tools/ci/nightly-publish.sh\n", "  cache: { paths: [ node_modules/ ] }\n  script:\n    - sh tools/ci/nightly-publish.sh\n");'
yaml_pass_case "p63b: a cache on lint, which publish_docs does not inherit from, passes" '
  y = y.replace("lint:\n  stage: lint\n", "lint:\n  stage: lint\n  cache:\n    paths:\n      - tools/node_modules/\n");'
# A second NODE_IMAGE, or any variable the image reads.
split_case "p64: NODE_IMAGE twice in the global variables" $ci "NODE_IMAGE is defined 2 times in the global variables" '
  y = y.replace("  PLAYWRIGHT_VERSION: \"1.64.0\"\n", "  PLAYWRIGHT_VERSION: \"1.64.0\"\n  NODE_IMAGE: evil/node:1\n");'
split_case "p65: a second global variables block holding NODE_IMAGE" $ci "NODE_IMAGE is defined 2 times in the global variables" '
  y = y + "\nvariables:\n  NODE_IMAGE: evil/node:1\n";'
split_case "p66: NODE_IMAGE in the variables of a workflow rule" $ci "in workflow > rules > [0-9]+ > variables: sets NODE_IMAGE" '
  y = y.replace("        CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX: docker.io\n", "        CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX: docker.io\n        NODE_IMAGE: evil/node:1\n");'
split_case "p67: NODE_IMAGE in the variables of publish_docs" $ci "in publish_docs > variables: sets NODE_IMAGE" '
  y = y.replace("    GIT_STRATEGY: clone\n", "    GIT_STRATEGY: clone\n    NODE_IMAGE: evil/node:1\n");'
split_case "p68: NODE_IMAGE in the variables of a parent of publish_docs" $ci "in .parent > variables: sets NODE_IMAGE" '
  y = y.replace("publish_docs:\n  stage: publish\n", "publish_docs:\n  extends: .parent\n  stage: publish\n");
  y = y + "\n.parent:\n  variables:\n    NODE_IMAGE: evil/node:1\n";'
split_case "p69: NODE_IMAGE in the variables under default" $ci "in default > variables: sets NODE_IMAGE" '
  y = y.replace("default:\n  tags: [light]\n", "default:\n  tags: [light]\n  variables:\n    NODE_IMAGE: evil/node:1\n");'
split_case "p70: NODE_IMAGE in a workflow rule added as a new rule" $ci "in workflow > rules > [0-9]+ > variables: sets NODE_IMAGE" '
  y = y.replace("    - if: $CI_COMMIT_BRANCH\n\n.not_scheduled", "    - if: $CI_COMMIT_BRANCH\n      variables:\n        NODE_IMAGE: evil/node:1\n\n.not_scheduled");'
yaml_pass_case "p71: an unrelated variable in publish_docs passes" '
  y = y.replace("    GIT_STRATEGY: clone\n", "    GIT_STRATEGY: clone\n    HARMLESS: one\n");'
# Cases p72-p84 judge item 1 of the split check (issue #60 round 3): .gitlab-ci.yml
# may hold only tab, line feed and printable ASCII (0x20-0x7E). Any other
# character, in a comment too, is refused with its line number (lines count line
# feeds only) before any YAML is read. The characters are JS escapes below so
# this file stays plain ASCII. U+2028, U+2029, U+0085 and a carriage return end
# a line for GitLab's reader (Ruby Psych), so a comment holding one is followed
# on the same physical line by YAML that reader takes as real content.
# Each pattern wants the line number and the word ASCII on the refusal line.
ci_lines=$(wc -l < $ci)
lint_line=$(grep -n -m1 -F '    - sh tools/ci/lint.sh' $ci | cut -d: -f1)
pub_line=$(grep -n -m1 -F '    - sh tools/ci/nightly-publish.sh' $ci | cut -d: -f1)
split_case "p72: U+2028 in a comment followed by a job on the same line" $ci "line $((ci_lines + 1))[^0-9].*ASCII" '
  y = y + "\n# c\u2028evil: { stage: lint, environment: docs-import, script: [ x ] }\n";'
split_case "p73: U+2029 inside publish_docs" $ci "line $((pub_line + 1))[^0-9].*ASCII" '
  y = y.replace("    - sh tools/ci/nightly-publish.sh\n", "    - sh tools/ci/nightly-publish.sh\n  # c\u2029  script: [ \"npm i evil\" ]\n");'
split_case "p74: U+0085 in a comment followed by a job on the same line" $ci "line $((ci_lines + 1))[^0-9].*ASCII" '
  y = y + "\n# c\u0085evil: { stage: lint, environment: docs-import, script: [ x ] }\n";'
split_case "p75: a carriage return in a comment followed by a job on the same line" $ci "line $((ci_lines + 1))[^0-9].*ASCII" '
  y = y + "\n# c\revil: { stage: lint, environment: docs-import, script: [ x ] }\n";'
split_case "p76: a NUL in a comment" $ci "line $((ci_lines + 1))[^0-9].*ASCII" '
  y = y + "\n# c\u0000evil: { stage: lint, environment: docs-import, script: [ x ] }\n";'
split_case "p77: an escape control character in a comment" $ci "line $((ci_lines + 1))[^0-9].*ASCII" '
  y = y + "\n# c\u001b[0m note\n";'
split_case "p78: a vertical tab in a comment" $ci "line $((ci_lines + 1))[^0-9].*ASCII" '
  y = y + "\n# c\u000b note\n";'
split_case "p79: a DEL character in a comment" $ci "line $((ci_lines + 1))[^0-9].*ASCII" '
  y = y + "\n# c\u007f note\n";'
split_case "p80: a byte order mark at the start" $ci "line 1[^0-9].*ASCII" '
  y = "\ufeff" + y;'
split_case "p81: a harmless non-ASCII letter in a comment" $ci "line $((ci_lines + 1))[^0-9].*ASCII" '
  y = y + "\n# caf\u00e9 is a drink\n";'
split_case "p82: a non-ASCII letter in a script string" $ci "line $((lint_line + 1))[^0-9].*ASCII" '
  y = y.replace("    - sh tools/ci/lint.sh\n", "    - sh tools/ci/lint.sh\n    - echo \"caf\u00e9\"\n");'
split_case "p83: a no-break space in a comment" $ci "line $((ci_lines + 1))[^0-9].*ASCII" '
  y = y + "\n# a\u00a0b\n";'
yaml_pass_case "p84: a tab inside a comment passes" '
  y = y.replace("    - sh tools/ci/lint.sh\n", "    - sh tools/ci/lint.sh # a\tb\n");'
# Cases p85-p94 judge item 2: the deprecated global keywords at the top level are
# refused (GitLab still applies each to every job; default: is judged, so use
# that). The payloads are harmless on purpose, so only the new rule can refuse
# them. The pattern wants the keyword with top-level, global or deprecated.
split_case "p85: a top-level before_script" $ci "(top-level|top level|global|deprecated).*before_script|before_script.*(top-level|top level|global|deprecated)" '
  y = y + "\nbefore_script:\n  - echo hi\n";'
split_case "p86: a top-level after_script" $ci "(top-level|top level|global|deprecated).*after_script|after_script.*(top-level|top level|global|deprecated)" '
  y = y + "\nafter_script:\n  - echo hi\n";'
split_case "p87: a top-level cache" $ci "(top-level|top level|global|deprecated).*cache|cache.*(top-level|top level|global|deprecated)" '
  y = y + "\ncache:\n  paths:\n    - tools/node_modules/\n";'
split_case "p88: a top-level services" $ci "(top-level|top level|global|deprecated).*services|services.*(top-level|top level|global|deprecated)" '
  y = y + "\nservices:\n  - name: postgres:16\n";'
split_case "p89: a top-level image" $ci "(top-level|top level|global|deprecated).*image|image.*(top-level|top level|global|deprecated)" '
  y = y + "\nimage: some/other:1\n";'
split_case "p90: a top-level hooks" $ci "(top-level|top level|global|deprecated).*hooks|hooks.*(top-level|top level|global|deprecated)" '
  y = y + "\nhooks:\n  pre_get_sources_script:\n    - echo hi\n";'
split_case "p91: a top-level before_script written with a quoted key" $ci "(top-level|top level|global|deprecated).*before_script|before_script.*(top-level|top level|global|deprecated)" '
  y = y + "\n\"before_script\":\n  - echo hi\n";'
split_case "p92: a top-level cache in flow style" $ci "(top-level|top level|global|deprecated).*cache|cache.*(top-level|top level|global|deprecated)" '
  y = y + "\ncache: { paths: [ tools/node_modules/ ] }\n";'
yaml_pass_case "p93: a harmless before_script and after_script under default pass" '
  y = y.replace("default:\n  tags: [light]\n", "default:\n  tags: [light]\n  before_script:\n    - echo hi\n  after_script:\n    - echo bye\n");'
yaml_pass_case "p94: a before_script and services on lint, which publish_docs does not inherit from, pass" '
  y = y.replace("lint:\n  stage: lint\n", "lint:\n  stage: lint\n  before_script:\n    - echo hi\n  services:\n    - name: postgres:16\n");'
# Cases p95-p101 judge item 3: dependencies: on publish_docs, its own or taken
# through extends, is refused whatever its value.
split_case "p95: publish_docs with an empty dependencies list" $ci "(publish_docs.*dependencies|dependencies.*publish_docs)" '
  y = y.replace("  script:\n    - sh tools/ci/nightly-publish.sh\n", "  dependencies: []\n  script:\n    - sh tools/ci/nightly-publish.sh\n");'
split_case "p96: publish_docs depending on lint" $ci "(publish_docs.*dependencies|dependencies.*publish_docs)" '
  y = y.replace("  script:\n    - sh tools/ci/nightly-publish.sh\n", "  dependencies:\n    - lint\n  script:\n    - sh tools/ci/nightly-publish.sh\n");'
split_case "p97: publish_docs with dependencies in flow style" $ci "(publish_docs.*dependencies|dependencies.*publish_docs)" '
  y = y.replace("  script:\n    - sh tools/ci/nightly-publish.sh\n", "  dependencies: [ import_docs ]\n  script:\n    - sh tools/ci/nightly-publish.sh\n");'
split_case "p98: publish_docs extending a parent with dependencies" $ci "(publish_docs.*dependencies|dependencies.*publish_docs)" '
  y = y.replace("publish_docs:\n  stage: publish\n", "publish_docs:\n  extends: .parent\n  stage: publish\n");
  y = y + "\n.parent:\n  dependencies: []\n";'
split_case "p99: publish_docs extending a grandparent with dependencies" $ci "(publish_docs.*dependencies|dependencies.*publish_docs)" '
  y = y.replace("publish_docs:\n  stage: publish\n", "publish_docs:\n  extends: .parent\n  stage: publish\n");
  y = y + "\n.parent:\n  extends: .grand\n\n.grand:\n  dependencies: [ lint ]\n";'
split_case "p100: publish_docs extending a list of parents, one with dependencies" $ci "(publish_docs.*dependencies|dependencies.*publish_docs)" '
  y = y.replace("publish_docs:\n  stage: publish\n", "publish_docs:\n  extends: [ .plain, .parent ]\n  stage: publish\n");
  y = y + "\n.plain:\n  interruptible: false\n\n.parent:\n  dependencies: []\n";'
yaml_pass_case "p101: dependencies on lint, which publish_docs does not inherit from, pass" '
  y = y.replace("lint:\n  stage: lint\n", "lint:\n  stage: lint\n  dependencies: []\n");'
# Cases (d1)-(d3) judge the section "the imported docs have the shape the import
# writes" (issue #18): the pad draws the index's colour and ids into innerHTML.
# shape_case <label> <file> <js>: <js> edits the parsed JSON j of the file.
shape_case() {
  F="assets/docs/$2" JS="$3" node -e '
    const fs = require("fs"); const j = JSON.parse(fs.readFileSync(process.env.F, "utf8"));
    new Function("j", process.env.JS)(j); fs.writeFileSync(process.env.F, JSON.stringify(j));
  ' || { echo "FAIL $1 (the test edit did not apply)"; failed=1; return; }
  commit_all "$1"
  lint_to_out
  if [ "$rc" -eq 1 ] && grep -i '^==' "$out" | grep -iq 'shape the import writes' && grep -q "$2" "$out"; then
    echo "ok   $1 fails"
  else
    echo "FAIL $1 fails (exit $rc, want 1 naming $2)"
    sed 's/^/     /' "$out"
    failed=1
  fi
  git reset -q --hard HEAD~1
}
shape_case "an index colour carrying markup" index.json 'j.sources[0].c = "#fff\"><img src=x onerror=alert(1)>";'
shape_case "an index slug carrying a quote" index.json 'j.sources[1].slug = "a\"b";'
shape_case "a page section id with a space" readme.json 'j.sections[0].id = "a b";'
git rm -q assets/docs/security.json
commit_all "a page missing"
lint_to_out
if [ "$rc" -eq 1 ] && grep -q "security.json" "$out"; then
  echo "ok   a page missing from assets/docs fails"
else
  echo "FAIL a page missing from assets/docs fails (exit $rc)"
  failed=1
fi
git reset -q --hard HEAD~1

# Case (s): the committed tree as it is -> the section runs and passes.
lint_to_out
if [ "$rc" -eq 0 ] && grep -i '^==' "$out" | grep -iq 'docs import is split'; then
  echo "ok   the committed pipeline passes the split-import section"
else
  echo "FAIL the committed pipeline passes the split-import section (exit $rc, want 0 with a == heading naming the split import)"
  sed 's/^/     /' "$out"
  failed=1
fi

# Cases (m1)-(m7) judge the section for the service worker's picture cache name.
# media_name prints the name sw.js must carry in this scratch tree: orbit-media-
# and the first 12 hex characters of the SHA-256 of one line "<path> <blob sha>"
# per tracked file whose name ends in a picture or font extension (the regex
# isMedia in sw.js), outside assets/docs/, sorted by path in byte order.
media_name() {
  node -e '
    const { execFileSync } = require("child_process");
    const rows = execFileSync("git", ["ls-files", "-s", "-z"]).toString("utf8").split("\0").filter(Boolean)
      .map((r) => { const m = /^\d+ ([0-9a-f]+) \d\t([\s\S]*)$/.exec(r); return { sha: m[1], path: m[2] }; })
      .filter((r) => /\.(webp|png|jpe?g|gif|svg|exr|woff2?)$/i.test(r.path) && !r.path.startsWith("assets/docs/"))
      .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
    const body = rows.map((r) => r.path + " " + r.sha + "\n").join("");
    console.log("orbit-media-" + require("crypto").createHash("sha256").update(body).digest("hex").slice(0, 12));
  '
}
# set MEDIA in sw.js to the given name (or to the correct one) and commit
set_media() {
  sed -E "s/(const MEDIA = )\"[^\"]*\"/\\1\"$1\"/" sw.js > sw.js.new && mv sw.js.new sw.js
  commit_all "MEDIA $1"
}
# expect_media_fail <label>: lint exits 1, names sw.js and prints the expected name
expect_media_fail() {
  want=$(media_name)
  lint_to_out
  if [ "$rc" -eq 1 ] && grep -q "sw.js" "$out" && grep -qF "$want" "$out"; then
    echo "ok   $1 fails"
  else
    echo "FAIL $1 fails (exit $rc, want 1 naming sw.js and $want)"
    sed 's/^/     /' "$out"
    failed=1
  fi
}
# expect_media_pass <label>: lint passes as a whole (the tree is otherwise clean)
expect_media_pass() {
  lint_to_out
  if [ "$rc" -eq 0 ]; then
    echo "ok   $1 passes"
  else
    echo "FAIL $1 passes (exit $rc, want 0; expected name $(media_name))"
    sed 's/^/     /' "$out"
    failed=1
  fi
}
pic=$(git ls-files | grep -E '\.png$' | grep -v '^assets/docs/' | head -1)

# Case (m1): the name the tree committed with is not the digest of its pictures -> fails.
set_media "orbit-media-0000000000000"
expect_media_fail "a MEDIA that is not the digest of the pictures"
git reset -q --hard HEAD~1

# Case (m2)/(b): MEDIA set to the correct name for this tree -> the section passes.
set_media "$(media_name)"
expect_media_pass "MEDIA set to the correct name"

# Case (m3)/(a): a picture changed, MEDIA left alone -> fails, naming sw.js and the new expected name.
printf 'changed' >> "$pic"
commit_all "change a picture"
expect_media_fail "a changed picture with MEDIA unchanged"
git reset -q --hard HEAD~1

# Case (m4): a picture added outside assets/docs/ -> fails likewise.
cp "$pic" assets/img/added-picture.png
commit_all "add a picture"
expect_media_fail "an added picture with MEDIA unchanged"
git reset -q --hard HEAD~1

# Case (m5): a picture removed (one no page names, so no other check fails) -> fails likewise.
git rm -q assets/door/img/dawn/lights-strip-120.webp
commit_all "remove a picture"
expect_media_fail "a removed picture with MEDIA unchanged"
git reset -q --hard HEAD~1

# Case (m6)/(c): a change only under assets/docs/ (the nightly import owns it) -> passes.
node -e '
  const fs = require("fs");
  const j = JSON.parse(fs.readFileSync("assets/docs/readme.json", "utf8"));
  j.sections[0].summary = "a changed summary";
  fs.writeFileSync("assets/docs/readme.json", JSON.stringify(j));
'
commit_all "change a page under assets/docs"
expect_media_pass "a change only under assets/docs/"
git reset -q --hard HEAD~1

# Case (m6b): a picture file added under assets/docs/ is not counted in the name. The
# shape check ("not a file the import writes") rightly fails that tree, so this case
# only asks that the cache-name check says nothing: no sw.js in the output.
cp "$pic" assets/docs/imported-picture.png
commit_all "add a picture under assets/docs"
lint_to_out
if ! grep -q "sw.js" "$out"; then
  echo "ok   a picture added under assets/docs/ is not counted in the cache name"
else
  echo "FAIL a picture added under assets/docs/ is not counted in the cache name (want no mention of sw.js)"
  sed 's/^/     /' "$out"
  failed=1
fi
git reset -q --hard HEAD~1

# Case (m7): a change to a file that is not a picture -> passes.
printf '\n' >> README.md
commit_all "change a document"
expect_media_pass "a change to a non-picture file"
git reset -q --hard HEAD~1

# Case (m8): assets/img/docs/ is not assets/docs/: a picture changed there still fails.
dpic=$(git ls-files assets/img/docs | grep -iE '\.(webp|png|jpe?g|gif|svg)$' | head -1)
printf 'changed' >> "$dpic"
commit_all "change a picture under assets/img/docs"
expect_media_fail "a changed picture under assets/img/docs/"
git reset -q --hard HEAD~1

# Cases (c0)-(c8) judge the section for the pages' Content-Security-Policy (audit #12). GitHub Pages cannot send
# headers, so index.html, 404.html and install.html each carry the policy in a <meta http-equiv="Content-Security-Policy">.
# The pages in the scratch tree are rewritten here, by a small node program, to the policy the owner decided on, so
# these cases do not depend on the real pages carrying it yet (c8 alone judges the real ones). The program puts the
# meta straight after <meta charset> (a meta policy covers only what follows it), hashes every inline script of the
# page into script-src, and, for a fault, applies one change to one page (FAULT_PAGE) given by environment variables.
cspjs=$(mktemp)
cat > "$cspjs" <<'CSPJS_EOF'
const fs = require("fs");
const crypto = require("crypto");
const E = process.env;
const strip = (h) => h.replace(/[ \t]*<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>[ \t]*\n?/gi, "");
const inline = (h) => [...h.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter((m) => !/\bsrc\s*=/i.test(m[1])).map((m) => m[2]);
const hash = (t) => "'sha256-" + crypto.createHash("sha256").update(t, "utf8").digest("base64") + "'";
for (const page of ["index.html", "404.html", "install.html"]) {
  const bad = E.FAULT_PAGE === page;
  let h = strip(fs.readFileSync(page, "utf8"));
  const hs = inline(h).map(hash);
  if (bad && E.NOHASH) hs.shift();
  if (bad && E.STALE) hs.push("'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='");
  const src = ["'self'", ...hs, "https://cdn.jsdelivr.net"];
  if (bad && E.UNSAFE) src.splice(1, 0, `'${E.UNSAFE}'`);
  const parts = [
    "default-src 'self'", "script-src " + src.join(" "),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:", "connect-src 'self'", "worker-src 'self'",
    ...(bad && E.NOOBJECT ? [] : ["object-src 'none'"]), ...(bad && E.NOBASE ? [] : ["base-uri 'self'"]), "form-action 'self'",
  ];
  const meta = `  <meta http-equiv="Content-Security-Policy" content="${parts.join("; ")}" />\n`;
  if (bad && E.DROP_LINK) h = h.replace(/[ \t]*<link rel="stylesheet"[^>]*>\n/, "");
  if (bad && E.EDIT_SCRIPT) h = h.replace("catch(e){}", "catch(e){/* edited */}");
  if (bad && E.HANDLER) h = h.replace(/<a href=/, '<a onclick="void 0" href=');
  const at = bad ? E.META_AT || "start" : "start";
  if (bad && E.DROP) { fs.writeFileSync(page, h); continue; }
  if (at === "before-viewport") h = h.replace(/([ \t]*<meta name="viewport")/, meta + "$1");
  else if (at === "head-end") h = h.replace(/([ \t]*<\/head>)/, meta + "$1");
  else h = h.replace(/(<meta charset="utf-8" \/>\n)/, "$1" + meta);
  if (!h.includes("Content-Security-Policy")) throw new Error(page + ": no place to put the policy");
  fs.writeFileSync(page, h);
}
CSPJS_EOF
# csp_set <env assignments...>: rewrite the three pages, then commit
csp_set() {
  env "$@" node "$cspjs"
  commit_all "pages with a policy"
}
# csp_fail <label> <page> <env assignments...>: one fault on one page -> lint exits 1 and names the page
csp_fail() {
  label=$1; page=$2; shift 2
  csp_set FAULT_PAGE="$page" "$@"
  lint_to_out
  if [ "$rc" -eq 1 ] && grep -q "$page" "$out"; then
    echo "ok   $label fails"
  else
    echo "FAIL $label fails (exit $rc, want 1 naming $page)"
    sed 's/^/     /' "$out"
    failed=1
  fi
  git reset -q --hard HEAD~1
}

# Case (c8): the real committed pages as they are -> the policy section runs and passes.
lint_to_out
if [ "$rc" -eq 0 ] && grep '^==' "$out" | grep -iEq 'content.security|csp|policy'; then
  echo "ok   the committed pages carry a policy the lint accepts"
else
  echo "FAIL the committed pages carry a policy the lint accepts (exit $rc, want 0 with a == heading naming the content security policy)"
  sed 's/^/     /' "$out"
  failed=1
fi

# Case (c0): control, the pages set up correctly -> lint passes, with the policy section's heading in the output.
csp_set NOTHING=1
lint_to_out
if [ "$rc" -eq 0 ] && grep '^==' "$out" | grep -iEq 'content.security|csp|policy'; then
  echo "ok   correctly set-up pages pass the policy section"
else
  echo "FAIL correctly set-up pages pass the policy section (exit $rc, want 0 with a == heading naming the content security policy)"
  sed 's/^/     /' "$out"
  failed=1
fi
git reset -q --hard HEAD~1

# Case (c1): a page with no policy meta.
csp_fail "index.html with no policy meta" index.html DROP=1
csp_fail "404.html with no policy meta" 404.html DROP=1
csp_fail "install.html with no policy meta" install.html DROP=1

# Case (c2): the meta after something that loads (a script, a link, a style), so it covers only part of the head.
csp_fail "index.html with the meta after an inline script" index.html META_AT=before-viewport
csp_fail "install.html with the meta after a link" install.html META_AT=head-end
csp_fail "404.html with the meta after a style" 404.html META_AT=head-end DROP_LINK=1

# Case (c3): an inline script with no matching hash (left out; or edited after it was hashed).
csp_fail "an inline script with no hash in script-src" index.html NOHASH=1
csp_fail "an inline script edited after it was hashed" index.html EDIT_SCRIPT=1

# Case (c4): a hash that matches no inline script on the page.
csp_fail "a stale hash in script-src" index.html STALE=1

# Case (c5): script-src allowing 'unsafe-inline' or 'unsafe-eval'.
csp_fail "script-src with 'unsafe-inline'" index.html UNSAFE=unsafe-inline
csp_fail "script-src with 'unsafe-eval'" index.html UNSAFE=unsafe-eval

# Case (c6): object-src 'none' or base-uri 'self' missing.
csp_fail "a policy with no object-src 'none'" 404.html NOOBJECT=1
csp_fail "a policy with no base-uri 'self'" install.html NOBASE=1

# Case (c7): an inline event handler attribute.
csp_fail "an inline event handler attribute" install.html HANDLER=1

# Cases n1-n3: section "no real names, host logins or private addresses" (#56).
# The private address is built from parts, so this file holds no literal one
# and does not trip the guard it tests.
names_out=$(mktemp)
names_lint() {
  rc=0
  sh tools/ci/lint.sh > "$out" 2>&1 || rc=$?
  # Only what the names section printed: from its heading to the next one.
  awk '/^== /{on=0} /^== no real names/{on=1} on' "$out" > "$names_out"
}

# Case n1: a private address in a tracked file -> fails, names file:line, never prints the address.
a=10; addr="$a.0.0.7"
printf 'host %s\n' "$addr" >> README.md
ln=$(wc -l < README.md | tr -d ' ')
git add -A
git -c user.name=t -c user.email=t@t commit -q -m "add a private address"
names_lint
if [ "$rc" -ne 0 ] && grep -q "README.md:$ln" "$names_out" && ! grep -qF "$addr" "$out"; then
  echo "ok   a private address fails, naming README.md:$ln and not printing it"
else
  echo "FAIL a private address fails (exit $rc, want non-zero naming README.md:$ln and not printing the address)"
  sed 's/^/     /' "$out"
  failed=1
fi
git reset -q --hard HEAD~1

# Case n2: the kept LICENSE line (3) edited -> fails, names LICENSE:3.
sed '3s/$/ /' LICENSE > LICENSE.new && mv LICENSE.new LICENSE
git add -A
git -c user.name=t -c user.email=t@t commit -q -m "edit LICENSE line 3"
names_lint
if [ "$rc" -ne 0 ] && grep -q "LICENSE:3" "$names_out"; then
  echo "ok   an edited LICENSE line 3 fails, naming LICENSE:3"
else
  echo "FAIL an edited LICENSE line 3 fails (exit $rc, want non-zero naming LICENSE:3)"
  sed 's/^/     /' "$out"
  failed=1
fi
git reset -q --hard HEAD~1

# Case n3: a documentation address (RFC 5737) -> the names section does not report it.
echo 'host 192.0.2.7' >> README.md
git add -A
git -c user.name=t -c user.email=t@t commit -q -m "add a documentation address"
names_lint
if [ -s "$names_out" ] && ! grep -q "README.md" "$names_out"; then
  echo "ok   a documentation address is not reported"
else
  echo "FAIL a documentation address is not reported (want the names section present and not naming README.md)"
  sed 's/^/     /' "$out"
  failed=1
fi
git reset -q --hard HEAD~1

# Cases n4-n6: history carrying a banned email (#56, decision 8a). The address is invented and built from
# parts; "banned" is made by planting its sha256 (of the lower-cased address) in the extra-digest variable.
e_user="history-probe"; e_addr="$e_user@example.invalid"
e_mixed="History-Probe@Example.Invalid"
e_digest=$(printf '%s' "$e_addr" | sha256sum | cut -d' ' -f1)

# Case n4: a commit with an invented address, nothing planted -> not reported.
echo n4 >> README.md
git add -A
GIT_AUTHOR_EMAIL="$e_addr" GIT_COMMITTER_EMAIL="$e_addr" git -c user.name=t commit -q -m "invented address"
sid=$(git rev-parse --short HEAD)
names_lint
if [ -s "$names_out" ] && ! grep -qF "$sid" "$out" && ! grep -qiF "$e_addr" "$out"; then
  echo "ok   a commit with an unbanned address is not reported"
else
  echo "FAIL a commit with an unbanned address is not reported (want the names section present and not naming $sid)"
  sed 's/^/     /' "$out"
  failed=1
fi
git reset -q --hard HEAD~1

# Case n5: author email banned (committer is not) -> fails, names the short id and "author", never the address.
echo n5 >> README.md
git add -A
GIT_AUTHOR_EMAIL="$e_mixed" GIT_COMMITTER_EMAIL="t@t" git -c user.name=t commit -q -m "banned author"
sid=$(git rev-parse --short HEAD)
NO_REAL_NAMES_EXTRA_EMAIL_DIGESTS="$e_digest" names_lint
if [ "$rc" -ne 0 ] && grep -qi "$sid.*author" "$names_out" && ! grep -qi "$sid.*committer" "$names_out" \
   && ! grep -qiF "$e_addr" "$out"; then
  echo "ok   a banned author email fails, naming $sid and author, not the address"
else
  echo "FAIL a banned author email fails (exit $rc, want non-zero naming $sid and author, not the address)"
  sed 's/^/     /' "$out"
  failed=1
fi
git reset -q --hard HEAD~1

# Case n6: committer email banned (author is not) -> fails, names the short id and "committer", never the address.
echo n6 >> README.md
git add -A
GIT_AUTHOR_EMAIL="t@t" GIT_COMMITTER_EMAIL="$e_addr" git -c user.name=t commit -q -m "banned committer"
sid=$(git rev-parse --short HEAD)
NO_REAL_NAMES_EXTRA_EMAIL_DIGESTS="$e_digest" names_lint
if [ "$rc" -ne 0 ] && grep -qi "$sid.*committer" "$names_out" && ! grep -qi "$sid.*author" "$names_out" \
   && ! grep -qiF "$e_addr" "$out"; then
  echo "ok   a banned committer email fails, naming $sid and committer, not the address"
else
  echo "FAIL a banned committer email fails (exit $rc, want non-zero naming $sid and committer, not the address)"
  sed 's/^/     /' "$out"
  failed=1
fi
git reset -q --hard HEAD~1
rm -f "$names_out"

rm -f "$cspjs"

rm -f "$out"

exit "$failed"
