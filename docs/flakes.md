# Flakes

A check that failed and passed again on unchanged code. One heading per flake, one line per sighting
(`date · commit · job · symptom`); the third line files the issue.

## freeze.mjs 1-3: a long task over 50 ms in the 10 s after body.lit ([#32](https://gitlab.tomlawson.io/ai/orbit-site/-/issues/32))

- 2026-10-10 · fe7242a · journey-local.sh freeze, agent host (load average 20-30) · 1 task of 74 ms, passed on the next run
- 2026-10-10 · fe7242a · journey-local.sh freeze, agent host (load average 20-30) · 1 task of 101 ms, passed on the next run
- 2026-10-11 · f97a9bb · journey-local.sh freeze ×8, agent host (load average 5-34) · failed 1 of 8, 1 task of 50 ms; the third sighting files #32
- 2026-10-11 · 7c49676 · journey-local.sh (all six), agent host (load average 10-23) · 1 task of 50 ms; the diff touches only teardown, passed on the next run
- 2026-10-11 · 4e8dd43 · pipeline 2496 live:journey (CI runner, no GPU) · 1 task of 55 ms; the diff touches only teardown, re-run

## dawn-test, Chromium: "every Earth request had finished before ready" in the held-pictures case

- 2026-10-11 · ea9e37d · journey-local.sh dawn, BROWSER=chromium, agent host · ready +4039 ms, one request's finish event +4045 ms; "not ready while held" passed; passed on the next run
- 2026-10-11 · ea9e37d · journey-local.sh dawn, BROWSER=chromium, agent host · same case, failed again on the run after; the test compares the runner-side arrival of Playwright's requestfinished event with ready, and Chromium can deliver that event after the page has used the body (CI runs dawn on Firefox only)

## Docker image pull from the dependency proxy: not found

- 2026-10-12 · 0acc271 (and 3 other Renovate heads) · pipelines 2547-2550 lint · node:22-bookworm digest "not found" from the dependency proxy; 2547 passed on retry 2026-10-13

## flight-context-loss F1: the flight canvas still blank 6 s after the context is lost

- 2026-10-16 · a1a46b2 · pipeline 2661 live:journey (back-merge !60, beside the nightly 2660) · #warp alone best drawn 0.287 and 0.186, want 0.331; the same tree passed in 2653 and 2656; passed on retry
- 2026-10-16 · d43f440 · pipeline 2662 live:journey (import !61, beside 2661) · F1 again; the diff touches only assets/docs/; passed on retry. The check counts what the 2D fallback draws in 6 s of wall clock, so it depends on drawing speed; being fixed on fix/live-flake-and-bot-proxy
