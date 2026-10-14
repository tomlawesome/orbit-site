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
# page (cases c0-c8).
#
#   sh tools/ci/lint-test.sh        run from anywhere inside the repository
#
# Works on a scratch copy of the current commit, so the checkout is untouched.
set -eu

root=$(git rev-parse --show-toplevel)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

git -C "$root" archive HEAD | tar -x -C "$tmp"
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
# naming <file> with <named>.
split_case() {
  F="$2" Y="$(cat "$2")" JS="$4" node -e '
    let y = process.env.Y; const before = y;
    y = new Function("y", process.env.JS + "; return y;")(y);
    if (y === before) { console.error("the edit changed nothing"); process.exit(3); }
    require("fs").writeFileSync(process.env.F, y + "\n");
  ' || { echo "FAIL $1 (the test edit did not apply)"; failed=1; return; }
  commit_all "$1"
  lint_to_out
  if [ "$rc" -eq 1 ] && grep -q "$2: .*$3" "$out"; then
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
  y = y.replace("    name: docs-import\n", "    name: docs-import\n  environment: renovate\n");'
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

rm -f "$cspjs"

rm -f "$out"

exit "$failed"
