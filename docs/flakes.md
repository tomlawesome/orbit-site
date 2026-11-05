# Flakes

A check that failed and passed again on unchanged code. One heading per flake, one line per sighting
(`date · commit · job · symptom`); the third line files the issue and quarantines the check. `tools/ci/flake-gate.sh` enforces this in CI (#106).
A fixed flake's heading comes off with the fix; its issue, if any, and git history keep the record.

## Docker image pull from the dependency proxy: not found

- 2026-10-12 · 0acc271 (and 3 other Renovate heads) · pipelines 2547-2550 lint · node:22-bookworm digest "not found" from the dependency proxy; 2547 passed on retry 2026-10-13

## site-browser B7, Chromium: the install page's second dive is still flat

- 2026-10-23 · d4662e0 · coverage-run.sh site-browser, Chromium, agent host · lit false, flat true after ~10 s (a pass takes 36-39 s); failed 3 runs in a row, then passed 3 of 3 on the same code; Firefox, which gates it, passed in journey-local.sh
- 2026-10-27 · a621f59 · site-browser-test.mjs alone, BROWSER=chromium, headless with no xvfb or software GL (sixth audit's engines pass), agent host · lit false, flat true; 'formed' after 31 frames; passed 9 of 9 on the rerun under xvfb with software GL, as journey-local.sh runs

## journey L4, Firefox: "an unfit verdict is remembered and tested again" (preview): waitForFunction times out at 120 s

- 2026-11-02 · ae6e877 · pipeline 3425 live:firefox 2/2 job 43998 · Timeout 120000ms; the shard took 675 s against 200 s planned (slow runner); the diff touches only docs and the docs-diagram checks, and the same L4 code passed in pipeline 3426

## Runner interrupted mid-job (host)

- 2026-10-23 · 9e6311b · pipeline 2935, lint (job 38943) and lint:test (job 38944) · both stopped `runner_interrupted` at the same second (12:37:33 UTC), mid-test; passed on retry
