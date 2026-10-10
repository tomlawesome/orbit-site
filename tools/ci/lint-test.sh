#!/bin/sh
# Test for tools/ci/lint.sh, section "nothing stray at the root": it judges
# what git tracks, not what is on disk (issue #5); section "the npm pins live
# in tools/package.json only": a version named in a script, a lockfile entry
# without integrity, a range in the manifest, or npm dropped from Renovate's
# managers fails and names the file; and section "the imported docs carry no
# script": a handler or script tag in a stored section fails and names it; and
# the renovate.json section: a look-around in a customManagers matchString
# fails and names renovate.json (Renovate compiles these with RE2).
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
rm -f "$out"

exit "$failed"
