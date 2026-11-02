# Flakes

A check that failed and passed again on unchanged code. One heading per flake, one line per sighting
(`date · commit · job · symptom`); the third line files the issue and quarantines the check. `tools/ci/flake-gate.sh` enforces this in CI (#106).
A fixed flake's heading comes off with the fix; its issue, if any, and git history keep the record.

## Docker image pull from the dependency proxy: not found

- 2026-10-12 · 0acc271 (and 3 other Renovate heads) · pipelines 2547-2550 lint · node:22-bookworm digest "not found" from the dependency proxy; 2547 passed on retry 2026-10-13

## site-browser B7, Chromium: the install page's second dive is still flat

- 2026-10-23 · d4662e0 · coverage-run.sh site-browser, Chromium, agent host · lit false, flat true after ~10 s (a pass takes 36-39 s); failed 3 runs in a row, then passed 3 of 3 on the same code; Firefox, which gates it, passed in journey-local.sh
- 2026-10-27 · a621f59 · site-browser-test.mjs alone, BROWSER=chromium, headless with no xvfb or software GL (sixth audit's engines pass), agent host · lit false, flat true; 'formed' after 31 frames; passed 9 of 9 on the rerun under xvfb with software GL, as journey-local.sh runs

## docs-planet D1/D2, Chromium: the docs planet misses its wall-clock budget ([#98](https://gitlab.tomlawson.io/ai/orbit-site/-/issues/98)) — quarantined on Chromium (#106, 2026-11-02): D1 and D2 run and report `QUARANTINED FAIL`, but do not fail the job

Both cases hold the docs planet to a budget (D2: tappable within 20 s of the page opening; D1: within 5 s of install and information) on a shared runner with software GL; the same commit's code passed in dev's live job 20 minutes before each. The merge request's diff cannot reach this test.

- 2026-10-28 · c7bd3ba · pipeline 3071, job 40280 · D2: docs tappable at 21.4 s, want by 20 s (dev's live job was running beside it)
- 2026-10-28 · c7bd3ba · pipeline 3071, job 40327 (retry) · D1 run 3: docs tappable 5.2 s after install and information, want 5 s
- 2026-10-28 · cc20922 · pipeline 3109, live:chromium 2/3, job 40991 (the retry) · journey passed; D2 "completion status stuck false": docs labelled and tappable at 24.3 s, want 20 s; shard took 705 s against 517 planned · the third sighting files #98
- 2026-10-29 · 273cfb5 · pipeline 3160, live:chromium 2/3, job 41467 · D1 "docs labelled and tappable within 5 s" failed on the revert of !96 (site code ccd883d's); the same shard failed the Back mid-flight flake (#107) on the two pipelines before · fourth sighting, retried

## journey, Chromium: "Back mid-flight returns to the door (preview)": the install-planet click never opens #installpad ([#107](https://gitlab.tomlawson.io/ai/orbit-site/-/issues/107)) — quarantined on Chromium (owner 22a, 2026-11-01): it runs and reports `QUARANTINED FAIL`, but does not fail the job

- 2026-10-28 · cc20922 · pipeline 3109, live:chromium 2/3, job 40862 · the click on the install planet never opened #installpad; cc20922 changes only `coverage-floors.json`, and the same shard passed 3 of 3 on 409c39b (pipeline 3106); retried as job 40991
- 2026-10-29 · cfedb56 · pipeline 3153, live:chromium 2/3, job 41374 · the same; cfedb56 is the revert of !96, so the site's code is ccd883d's, which this shard passed on pipeline 3149; the second sighting, re-run by this push
- 2026-10-29 · 2756f3b · pipeline 3158, live:chromium 2/3, job 41442 · the same, on the same tree plus one doc line; the third sighting files #107; re-run by this push
- 2026-10-31 · e6bdea2 · journey-local.sh journey, Chromium, agent host (load average 5-6) · the same, two runs in a row; the change reaches only the Firefox image-loader route, which this journey does not take in Chromium; passed 2 of 2 on the same code straight after, and once with the change reverted
- 2026-11-01 · 11cb867 · pipeline 3320, live:chromium 2/3, job 43174 · the same, on a batch that does not touch the door's planets or Back; passed on retry (job 43196); the fifth sighting, quarantined

## journey L4, Firefox: "an unfit verdict is remembered and tested again" (preview): waitForFunction times out at 120 s

- 2026-11-02 · ae6e877 · pipeline 3425 live:firefox 2/2 job 43998 · Timeout 120000ms; the shard took 675 s against 200 s planned (slow runner); the diff touches only docs and the docs-diagram checks, and the same L4 code passed in pipeline 3426

## Runner interrupted mid-job (host)

- 2026-10-23 · 9e6311b · pipeline 2935, lint (job 38943) and lint:test (job 38944) · both stopped `runner_interrupted` at the same second (12:37:33 UTC), mid-test; passed on retry
