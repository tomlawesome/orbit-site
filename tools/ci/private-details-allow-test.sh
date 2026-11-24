#!/bin/sh
# Test for .private-details-allow.toml, the allow file the shared private-details check reads (ai/agent-infra#32).
# The German install page may carry the one English disclosure line index.html carries (#125), and nothing
# else naming the tool: a second attribution line in de/index.html must be refused.
#
#   sh tools/ci/private-details-allow-test.sh        run from anywhere inside the repository
#
# It runs the check the way CI does: the scanner scripts/private-details/scan.sh from ai/agent-infra at the
# commit .gitlab-ci.yml pins for the include, inside the pinned gitleaks image, with the allow file from the
# checkout, over a scratch git repository holding the committed pages. It needs docker and a checkout of
# ai/agent-infra (AGENT_INFRA, default ~/projects/agent-infra, read with git show), so it is not part of
# lint-test.sh. The host's private rules file is never read: the rules file here is rules.template.toml
# from the same ai/agent-infra commit, which holds invented placeholders only.
# Exit 0 all cases hold, 1 a case failed, 2 the test could not run.
set -eu

root=$(git rev-parse --show-toplevel)
infra=${AGENT_INFRA:-$HOME/projects/agent-infra}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null

die() { echo "private-details-allow-test: $*" >&2; exit 2; }

command -v docker > /dev/null 2>&1 || die "docker is needed"
[ -d "$infra/.git" ] || [ -f "$infra/HEAD" ] || die "no ai/agent-infra checkout at $infra (set AGENT_INFRA)"

# the include's commit and the gitleaks image, as .gitlab-ci.yml pins them
# (the include lists ref before file)
ref=$(awk '/^include:/ { inc = 1; next } inc && /^[^ ]/ { inc = 0 }
  inc && $1 == "ref:" { r = $2 }
  inc && $1 == "file:" && $2 == "scripts/private-details/ci-template.yml" { print r; exit }' "$root/.gitlab-ci.yml")
[ -n "$ref" ] || die "cannot read the private-details include's ref from .gitlab-ci.yml"
case $ref in *[!0-9a-f]* | "") die "the ref is not a full commit: $ref" ;; esac
[ "${#ref}" -eq 40 ] || die "the ref is not a full commit: $ref"
image=$(awk '/^private-details:/ { p = 1; next } p && /^[^ #]/ { p = 0 } p && $1 == "name:" { print $2; exit }' "$root/.gitlab-ci.yml")
[ -n "$image" ] || die "cannot read the private-details image from .gitlab-ci.yml"
# shellcheck disable=SC2016 # the $ is literal text in the variable name
image=$(printf '%s\n' "$image" | sed 's|^\$CI_IMAGE_CACHE_GHCR/|ghcr.io/|')

# the scanner, with its report template, at the pinned commit
mkdir -p "$tmp/scan"
for f in scan.sh summary.tmpl rules.template.toml; do
  /usr/bin/git -C "$infra" show "$ref:scripts/private-details/$f" > "$tmp/scan/$f" 2> /dev/null ||
    die "cannot read scripts/private-details/$f at $ref in $infra"
done
# the rules file is the template itself (invented placeholders, no private value): the allow file names several
# rules, and gitleaks refuses an allowlist that names a rule the rules file lacks
cp "$tmp/scan/rules.template.toml" "$tmp/scan/rules.toml"
grep -q '^id = "ai-attribution"' "$tmp/scan/rules.toml" || die "the ai-attribution rule is not in rules.template.toml at $ref"

# scratch repository: the committed pages and allow file
repo=$tmp/repo
mkdir -p "$repo/de"
for f in index.html de/index.html .private-details-allow.toml; do
  git -C "$root" show "HEAD:$f" > "$repo/$f"
done
git -C "$repo" init -q
git -C "$repo" add -A
git -C "$repo" -c user.name=t -c user.email=t@t commit -q -m base

out=$tmp/out
failed=0
# scan <label>: run the check in the image; sets rc and out
scan() {
  rc=0
  docker run --rm --entrypoint sh \
    -v "$repo:/work:ro" -v "$tmp/scan:/scan:ro" \
    -e PRIVATE_DETAILS_RULES=/scan/rules.toml \
    "$image" -c 'git config --global --add safe.directory /work && cd /work && sh /scan/scan.sh history' > "$out" 2>&1 || rc=$?
}

# control: the committed pages, as they are
scan
if [ "$rc" -eq 0 ] && grep -q '^private-details: clean' "$out"; then
  echo "ok   (b1) the committed pages pass the check"
else
  echo "FAIL (b1) the committed pages pass the check (exit $rc, want 0 and clean)"
  sed 's/^/     /' "$out"
  failed=1
fi

# a second attribution line on the German page
# (the planted line is built from parts: the check reads this file too)
node -e '
  const fs = require("fs"); const f = process.argv[1] + "/de/index.html"; const s = fs.readFileSync(f, "utf8");
  const m = s.match(/^.*class="made".*$/m);
  if (!m) { console.error("the disclosure line is not in de/index.html"); process.exit(3); }
  const extra = "<p>" + ["Written", "by", "Cl" + "aude"].join(" ") + "</p>";
  fs.writeFileSync(f, s.replace(m[0], m[0] + "\n      " + extra));
' "$repo" || die "the test edit did not apply"
git -C "$repo" add -A
git -C "$repo" -c user.name=t -c user.email=t@t commit -q -m "a second attribution line"
scan
if [ "$rc" -eq 1 ] && grep -q 'ai-attribution de/index.html' "$out"; then
  echo "ok   (b2) a second attribution line in de/index.html is refused"
else
  echo "FAIL (b2) a second attribution line in de/index.html is refused (exit $rc, want 1 naming ai-attribution de/index.html)"
  sed 's/^/     /' "$out"
  failed=1
fi

exit "$failed"
