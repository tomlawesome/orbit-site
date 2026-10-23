# Flakes

A check that failed and passed again on unchanged code. One heading per flake, one line per sighting
(`date · commit · job · symptom`); the third line files the issue.

## freeze.mjs 1-3: a long task over 50 ms in the 10 s after body.lit ([#32](https://gitlab.tomlawson.io/ai/orbit-site/-/issues/32))

- 2026-10-10 · fe7242a · journey-local.sh freeze, agent host (load average 20-30) · 1 task of 74 ms, passed on the next run
- 2026-10-10 · fe7242a · journey-local.sh freeze, agent host (load average 20-30) · 1 task of 101 ms, passed on the next run
- 2026-10-11 · f97a9bb · journey-local.sh freeze ×8, agent host (load average 5-34) · failed 1 of 8, 1 task of 50 ms; the third sighting files #32
- 2026-10-11 · 7c49676 · journey-local.sh (all six), agent host (load average 10-23) · 1 task of 50 ms; the diff touches only teardown, passed on the next run
- 2026-10-11 · 4e8dd43 · pipeline 2496 live:journey (CI runner, no GPU) · 1 task of 55 ms; the diff touches only teardown, re-run
- 2026-10-22 · c8c9b71 · pipeline 2888 live:journey job 38457 (CI runner, no GPU) · 1 task of 80 ms; the diff touches only AGENTS.md, and the same site code passed in pipeline 2884; #32 reopened
- Resolved 2026-10-22: the check timed the runner (the page's own longest task ~21-26 ms); it now counts the work after lit instead (#32)

## dawn-test, Chromium: "every Earth request had finished before ready" in the held-pictures case ([#73](https://gitlab.tomlawson.io/ai/orbit-site/-/issues/73))

- 2026-10-11 · ea9e37d · journey-local.sh dawn, BROWSER=chromium, agent host · ready +4039 ms, one request's finish event +4045 ms; "not ready while held" passed; passed on the next run
- 2026-10-11 · ea9e37d · journey-local.sh dawn, BROWSER=chromium, agent host · same case, failed again on the run after; the test compares the runner-side arrival of Playwright's requestfinished event with ready, and Chromium can deliver that event after the page has used the body (CI runs dawn on Firefox only)
- 2026-10-20 · 42fbb6e · local Chromium engines pass (fifth audit), agent host · ready +4020 ms, Earth requests finished +4022/4023 ms; the third sighting files #73
- 2026-10-22 · Fixed by the commit that closes #73: the check now reads the page's own resource timing (each Earth picture's responseEnd) against when the page set ready, so the runner's event delivery no longer matters

## Docker image pull from the dependency proxy: not found

- 2026-10-12 · 0acc271 (and 3 other Renovate heads) · pipelines 2547-2550 lint · node:22-bookworm digest "not found" from the dependency proxy; 2547 passed on retry 2026-10-13

## site-browser B7, Chromium: the install page's second dive is still flat

- 2026-10-23 · d4662e0 · coverage-run.sh site-browser, Chromium, agent host · lit false, flat true after ~10 s (a pass takes 36-39 s); failed 3 runs in a row, then passed 3 of 3 on the same code; Firefox, which gates it, passed in journey-local.sh
