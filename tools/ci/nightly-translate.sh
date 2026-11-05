#!/bin/sh
# The job translate_docs (#125 stage 2): translate the committed English of the
# branch this runs on with tools/ci/translate.mjs, first as a dry run, whose
# estimate (items, tokens, rough dollars) is logged before anything is spent,
# then for real. Each exit code is passed through: 0 done, 2 bad input, 3 the
# estimate is over the cap (TRANSLATE_MAX_TOKENS, 2,000,000 when unset), 4 the
# API failed (translate.mjs has the detail); on any of them nothing is written,
# so the job hands on no artifact and publish_translations does not run.
#
# This job holds ANTHROPIC_API_KEY (Masked + Protected, environment scope
# `translate`). translate.mjs reads it from its environment and sends it only as
# the x-api-key header: it is never an argument, never printed. Nothing here
# runs third-party code: no npm, only the image's node and the checkout's own
# scripts.
set -eu
cd "$(dirname "$0")/../.."

# Variables that change what node loads or trusts are never set here. The
# names come from awk's ENVIRON, not `env` read line by line, where a value
# holding a newline would read as more names (#52).
# shellcheck disable=SC2013 # awk prints one valid variable name per line (its pattern allows nothing else), so splitting on words is exact
for name in $(awk 'BEGIN { for (k in ENVIRON) if (k ~ /^[A-Za-z_][A-Za-z0-9_]*$/) print k }'); do
  case $name in
    # the image's version stamps and the pipeline's own image reference
    NODE_VERSION|NODE_IMAGE) ;;
    LD_*|DYLD_*|NODE_*|OPENSSL_*|SSL_CERT_*|UV_*|BASH_ENV|ENV|IFS)
      echo "refusing to run: $name is set in the environment"; exit 1 ;;
  esac
done

echo "== the estimate (a dry run: nothing is sent)"
rc=0
node tools/ci/translate.mjs --dry-run || rc=$?
[ "$rc" -eq 0 ] || exit "$rc"

echo "== the translation"
rc=0
node tools/ci/translate.mjs || rc=$?
exit "$rc"
