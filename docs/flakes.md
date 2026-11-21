# Flakes

A check that failed and passed again on unchanged code. One heading per flake, one line per sighting
(`date · commit · job · symptom`); the third line files the issue and quarantines the check. `tools/ci/flake-gate.sh` enforces this in CI (#106).
A fixed flake's heading comes off with the fix; its issue, if any, and git history keep the record.

## Docker image pull from the dependency proxy: not found

- 2026-10-12 · 0acc271 (and 3 other Renovate heads) · pipelines 2547-2550 lint · node:22-bookworm digest "not found" from the dependency proxy; 2547 passed on retry 2026-10-13

## site-browser B7, Chromium: the install page's second dive is still flat

- 2026-10-23 · d4662e0 · coverage-run.sh site-browser, Chromium, agent host · lit false, flat true after ~10 s (a pass takes 36-39 s); failed 3 runs in a row, then passed 3 of 3 on the same code; Firefox, which gates it, passed in journey-local.sh
- 2026-10-27 · a621f59 · site-browser-test.mjs alone, BROWSER=chromium, headless with no xvfb or software GL (sixth audit's engines pass), agent host · lit false, flat true; 'formed' after 31 frames; passed 9 of 9 on the rerun under xvfb with software GL, as journey-local.sh runs

## journey L1, L2 #116, Chromium: "the gate waits for the world and the flight, then flies; nothing is stored under fit=skip" (preview): the gate's click times out

- 2026-11-05 · 0ad4298 · journey.mjs, Chromium, agent host (load average about 70), 5th of 5 runs · locator.click: Timeout 30000ms exceeded; passed in runs 1-4 on the same code, and in 5 of 5 at 4x CPU throttling straight after

## journey L6 #116, Chromium: "the docs' Back is closed until the flight is ready, then opens" (preview): the descent never shows the dawn

- 2026-11-05 · 0ad4298 · journey.mjs, Chromium, agent host (load average about 70), 5th of 5 runs, the same run as L1, L2 · body classes seen: instrument, arrived, ready-flight, holding, withdrawing, dispersing, showwarp, at-door, lit; passed in runs 1-4 on the same code, and in 5 of 5 at 4x CPU throttling straight after

## freeze 5 [#165](https://gitlab.tomlawson.io/ai/orbit-site/-/work_items/165), Chromium: "?gpu=force: a webgl2 context without the caveat, #warpgl, and one non-soft chore a frame" fails

- 2026-11-05 · df30deb · pipeline 3670 live:chromium 3/3 job 46885 · case 5 failed (F1's WebGL flight drew 0.384); the change does not reach the door or WebGL; passed on retry (job 46962)
- 2026-11-19 · 39f9c54 · !148 pipeline 4696 live:chromium 3/3 job 56545 · the readying count saw 7 non-soft chores after the queue opened, wants 8 (tools/ci/freeze.mjs HARD_SEEN); 1.3 s long tasks in the run; the same code passed on pipeline 4673; retried (job 56717)
- 2026-11-21 · d4f224fe · !160 pipeline 5121 live:chromium 3/3 job 61245 · "the count sees the readying: at least 8 non-soft chores" saw 7; passed when re-run on the same code

## draw-live P2a, Firefox: "the real worker loads with no CSP violation, the flight is drawn in it and lands"

- 2026-11-05 · 5fb7428 · !120 pipeline 3690 live:firefox job 47094 (retry of 47071) · the flight never landed within 150 s (body classes stopped at holding/arming/showwarp); passed on the next retry (job 47105)

## Runner interrupted mid-job (host)

- 2026-10-23 · 9e6311b · pipeline 2935, lint (job 38943) and lint:test (job 38944) · both stopped `runner_interrupted` at the same second (12:37:33 UTC), mid-test; passed on retry
- 2026-11-21 · d4f224fe · !160 pipeline 5121, lint:test job 61231 · "execution took longer than 1h0m0s" (job_execution_timeout); retried as job 61476, which passed

## draw-pixels P1a, Chromium: "fly(UP) at 2600: the worker's picture is the page's, pixel for pixel"

- 2026-11-08 · 00fa35be · pipeline 3802 live:chromium 3/3 job 48251 · 997,225 of 1,024,000 pixels differ between draw=page and draw=worker; P1b in the same run 0 differ; passed 3 of 3 on the same code with journey-local.sh, Chromium, agent host

## journey, Firefox: console.error NS_BINDING_ABORTED from the driver's own worker script

- 2026-11-21 · 407cdcab · pipeline 5074 live:firefox 1/2 job 60756 · every step passed; the run failed on `console.error: [JavaScript Error: "NS_BINDING_ABORTED: " {file: "chrome://juggler/content/content/WorkerMain.js" line: 6}]`, logged by Playwright's Firefox driver rather than at a site address, with no failed site request; the same journey passed in Firefox on pipelines 5048 and 5062. Console errors now carry the step's name, so the next sighting names the step

## draw-pixels P1b, Chromium: "demoFlight with two named households at 1500: pixel for pixel"

- 2026-11-21 · d4f224fe · !160 pipeline 5121 live:chromium 3/3 job 61245 · failed in the same job as freeze 5's sighting of that date; passed when re-run on the same code

## site-browser B1, Firefox: "a burst of 20 resizes draws the galaxy once"

- 2026-11-21 · d4f224fe · !160 pipeline 5121 live:firefox 1/2 job 61241 · failed; passed when re-run on the same code
