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
# outside the folder, and an index.html whose door differs from markup.js.
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
  git -c user.name=t -c user.email=t@t commit -q -m "$1"
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
rm -f "$out"

exit "$failed"
