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

## journey L1, L2 #116, Chromium: "the gate waits for the world and the flight, then flies; nothing is stored under fit=skip" (preview): the gate's click times out

- 2026-11-05 · 0ad4298 · journey.mjs, Chromium, agent host (load average about 70), 5th of 5 runs · locator.click: Timeout 30000ms exceeded; passed in runs 1-4 on the same code, and in 5 of 5 at 4x CPU throttling straight after

## journey L6 #116, Chromium: "the docs' Back is closed until the flight is ready, then opens" (preview): the descent never shows the dawn

- 2026-11-05 · 0ad4298 · journey.mjs, Chromium, agent host (load average about 70), 5th of 5 runs, the same run as L1, L2 · body classes seen: instrument, arrived, ready-flight, holding, withdrawing, dispersing, showwarp, at-door, lit; passed in runs 1-4 on the same code, and in 5 of 5 at 4x CPU throttling straight after

## site-browser B3, Firefox: "a docs page that arrives after the visitor left the docs stays closed": the docs' Back click times out

- 2026-11-05 · df30deb · pipeline 3661 live:firefox 1/2 job 46832 · control: the reader had not opened 1.5 s after the held page was released, then locator.click on `#docspad .back.dawn` timed out at 30 s; the change touched only the lint's names check and lint-test fixtures, and B3 passed on the same code in pipeline 3677

## freeze 5, Chromium: "?gpu=force: a webgl2 context without the caveat, #warpgl, and one non-soft chore a frame" fails

- 2026-11-05 · df30deb · pipeline 3670 live:chromium 3/3 job 46885 · case 5 failed (F1's WebGL flight drew 0.384); the change does not reach the door or WebGL; passed on retry (job 46962)

## Runner interrupted mid-job (host)

- 2026-10-23 · 9e6311b · pipeline 2935, lint (job 38943) and lint:test (job 38944) · both stopped `runner_interrupted` at the same second (12:37:33 UTC), mid-test; passed on retry
