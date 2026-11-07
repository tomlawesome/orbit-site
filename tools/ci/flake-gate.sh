#!/bin/sh
# The flake rule's CI gate (#106): docs/flakes.md read by flake-check.sh, the
# copy of agent-infra's shared check. A flake at three sightings needs an
# issue and a quarantine.
#
# The quarantine list comes from the code that really takes a test out of the
# gate, never from a second list kept by hand: every `quarantined("#<issue>",`
# call in tools/ci/*.mjs (journey.mjs, docs-planet-test.mjs) adds the line
# `[#<issue>]`, and the flake's heading links that issue as `[#<issue>](...)`.
# The text is read with its comments taken out first (SEC-12, #138): a
# `quarantined("#<issue>",` in a line, block or trailing comment takes nothing
# out of the gate, so it is not a quarantine. Strings are kept (the call's
# issue is one), and a `//` or `/*` inside one, or made with an escaped slash
# in a regular expression (`/a\//`), is not a comment. The job's image has sh,
# grep, sed and awk only, so awk does it.
set -eu
cd "$(dirname "$0")/../.."
list=$(mktemp)
trap 'rm -f "$list"' EXIT
# q: the open quote (" or ' close at the line's end, ` may span lines), b: inside /* */
awk '
  FNR == 1 { q = ""; b = 0 }
  {
    s = $0; n = length(s); out = ""; i = 1
    while (i <= n) {
      c = substr(s, i, 1); d = substr(s, i + 1, 1)
      if (b) { if (c == "*" && d == "/") { b = 0; i += 2; out = out " " } else i++; continue }
      if (q != "") {
        out = out c
        if (c == "\\") { out = out d; i += 2; continue }
        if (c == q) q = ""
        i++; continue
      }
      if (c == "\\") { out = out c d; i += 2; continue }
      if (c == "/" && d == "/") break
      if (c == "/" && d == "*") { b = 1; i += 2; continue }
      if (c == "\"" || c == "\047" || c == "`") q = c
      out = out c; i++
    }
    if (q != "`") q = ""
    print out
  }
' tools/ci/*.mjs | grep -oE 'quarantined\("#[0-9]+"' \
  | sed -E 's/^quarantined\("(#[0-9]+)"$/[\1]/' | sort -u > "$list"
sh tools/ci/flake-check.sh --quarantined "$list" docs/flakes.md
