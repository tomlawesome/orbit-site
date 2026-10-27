# ADR-0005: Merge requests run the tests their change touches; promotion runs everything

**Status:** Proposed (design for the owner's review; nothing built)
**Date:** 2026-10-27
**Relates to:** #95 (cut the test gate's time); ADR-0001 (the door folder is one interface: a change there runs
everything); #14 (the coverage ratchet); #62 (`lint:test` in its own job); AGENTS.md "no test depends on how fast
the runner draws"; `feature/firefox-worker` (not merged: `draw-*-test.mjs`, self-hosted fonts and Mermaid,
`assets/door/page.js`).

Owner decisions, 2026-10-27, fixed: merge requests run only the tests linked to what changed (a change to
`assets/door/` runs everything; an unmapped file runs everything); the full suite runs only on promotion (`dev` to
`main`), not nightly; Firefox and Chromium run side by side in separate jobs; no test depends on runner speed.

Standard patterns used, each named where it applies:

- **Test impact analysis from a path-to-test map** (the shape of Bazel's affected-targets selection and Playwright's
  `--only-changed`), fail safe: a path the map does not know selects everything. The map is hand-written data,
  because the site's modules are loaded by pages, not imported by tests, so no import graph can find them.
- **Sharding by recorded durations** (Playwright `--shard`, CircleCI "split by timings"): each browser job runs as
  N parallel shards that take the longest tests first.
- **One browser server, many clients** (Playwright `launchServer()` and `connect()`): one browser per job, a fresh
  context per test, as the tests already do with contexts.
- **Ephemeral ports**: bind port 0 and read the number back (eight tests already do).
- **The coverage ratchet stays as it is** (#14); its floors come from CI's own full runs, lowest of three, as now.

## 1. What runs where

| Pipeline | Lint | Browser tests | Coverage ratchet |
| --- | --- | --- | --- |
| Merge request into `dev` (or a branch) | the `lint` job, whole (about 3 min) | the tests the map links to the changed paths; nothing for a docs-only change | report; gates only what was measured in full (section 6) |
| Push to `dev` after a merge | whole | the same selection, against the push's range (question 17) | as above |
| Promotion: merge request `dev` -> `main` | whole | everything, both browsers | gates, as today |
| The nightly import's merge request (`docs/import-*` -> `main`) | whole | the `docs` group (about 5 min, today 50) | report |
| Push to `main` | whole | none (question 17) | none |
| Schedules (`import_docs`, `publish_docs`, `renovate`) | unchanged | unchanged | unchanged |

"Promotion" is `$CI_MERGE_REQUEST_TARGET_BRANCH_NAME == "main"` and `$CI_MERGE_REQUEST_SOURCE_BRANCH_NAME == "dev"`.
A pipeline variable `LIVE_ALL=true` (Run pipeline on the merge request's page, with the variable) runs everything on
any merge request by hand: for a doubtful change, or to take the full runs a new floor needs (section 6).

AGENTS.md's "the journey is never optional" becomes "never optional on promotion": a docs-only merge request runs no
browser at all, by the owner's decision; nothing reaches Pages without the full suite.

## 2. The map

`tools/ci/test-map.json`, data read by `tools/ci/test-select.mjs` (no dependency; `path.matchesGlob` from Node 24,
the lint image's Node). Two tables.

**Groups: paths to a name.** A path may match several groups; the selection is the union. `all` and `none` are
special: `all` selects every test, `none` selects nothing but counts as mapped. The initial map:

| Group | Paths | Why |
| --- | --- | --- |
| `all` | `assets/door/**`, `.gitlab-ci.yml`, `tools/ci/test-map.json`, `tools/ci/test-select.mjs`, `tools/ci/live-run.mjs`, `tools/ci/live-lib.mjs`, `tools/ci/serve.mjs`, `tools/ci/coverage-hook.mjs`, `tools/package.json`, `tools/package-lock.json` | every page uses the door (ADR-0001); the test machinery itself |
| `page` | `index.html`, `install.html`, `404.html`, `assets/site.css`, `assets/js/main.js`, `assets/js/tilt.js`, `sw.js`, `assets/img/door/**`, `assets/fonts/**`, `assets/vendor/**` | the page every live test opens; `main.js` is the switch between every stage |
| `home` | `assets/js/home.js`, `sky.js`, `tour.js`, `data.js`, `law.js`, `lock.js` | the sky, the dial, the walk |
| `docs` | `assets/js/pads.js`, `assets/docs/**`, `tools/docs-sources.json` | the docs landing and its pages |
| `worlds` | `assets/js/install.js`, `world.js`, `planets3d.js`, `assets/img/install/**` | the install and information worlds, the live planets |
| `flight` | `assets/js/journeys.js`, `assets/img/docs/**` | the site's own flights and where they land |
| `harness` | `tests/*.html` | the pages the door-only live tests open |
| `import` | `tools/import-docs.mjs`, `tools/import-docs-lib.mjs`, `tools/sanitise-html.mjs`, `tools/ci/nightly-import.sh`, `tools/ci/nightly-publish.sh`, `tools/ci/docs-shape.mjs`, `tools/ci/docs-markup.mjs` | the import's own tests |
| `tooling` | `tools/ci/lint.sh`, the lint's helpers (`ci-split.mjs`, `door-types.mjs`, `no-real-names.mjs`, `door-pow-lint.mjs`, `tools/door-markup.mjs`), `tools/ci/journey-local.sh`, `tools/ci/coverage*`, `renovate.json` | `lint:test` and the other tests of the tools |
| `none` | `docs/**`, `*.md`, `assets/door/README.md`, `LICENSE`, `.gitignore`, `.nojekyll`, `.github/**`, `tools/*.py`, `tools/*.cjs`, `tests/t-*.js`, `tests/common.js`, `tests/worker.js`, `tests/index.html`, `tests/gate.html` | words, pictures' tools, the hand-run device tests |

`assets/js/*.js` is listed file by file on purpose: a new site module matches nothing and so is unmapped (below).
A test file maps to itself: a changed `tools/ci/X-test.mjs` selects X, whatever else changed. The firefox-worker
branch slots in without a map change but two paths: `assets/door/page.js` is in `all`; its `draw-*-test.mjs` are
Node tests; its csp cases for the fonts and Mermaid are covered by `assets/fonts/**` and `assets/vendor/**` in `page`.

**Tests: name to file, groups, browsers, screen, seconds.** One entry per live test, for example
`"csp": { "file": "tools/ci/csp-test.mjs", "groups": ["page", "docs"], "browsers": ["firefox", "chromium"],
"gates": ["firefox", "chromium"], "seconds": { "firefox": 67, "chromium": 60 } }`. `browsers` is where it runs;
`gates` is whose failure fails the job (section 3); `seconds` is the last measured time, for sharding only. The
initial groups, from each test's own header:

| Test | Groups | Browsers |
| --- | --- | --- |
| `journey` | page, home, docs, worlds, flight | both |
| `csp` | page, docs | both |
| `phone-door` | page, worlds | both |
| `site-browser` | page, home, docs, worlds | both (B7 flakes in Chromium, `docs/flakes.md`: `gates: ["firefox"]` until it has an issue and a fix) |
| `freeze` | page, worlds | Chromium |
| `flight-context-loss` | page, flight | both |
| `docs-planet` | page, worlds, flight | Chromium |
| `docs-sky-portrait-live` | page, flight | Chromium |
| `door-lows` | page | both |
| `upload` | harness | both (Chromium headless, Firefox headed, as now) |
| `dawn` | harness | Firefox |
| `asdawn` | harness | Firefox |
| `dropped-warning` | import | Chromium (headless, 2 s) |

(`pin` leaves the browser: section 5.) `assets/door/**` is in `all`, so no door-only test needs a door path.

**The selection rule** (`test-select.mjs`, printed at the top of every live job's log):

1. Promotion, `LIVE_ALL=true`, a push whose `CI_COMMIT_BEFORE_SHA` is all zeros, or no CI at all: everything.
2. The changed paths: on a merge request `git diff --name-only $CI_MERGE_REQUEST_DIFF_BASE_SHA HEAD` (deletions and
   renames included); on a push, `$CI_COMMIT_BEFORE_SHA..HEAD`. The live jobs take `GIT_DEPTH: 0` as `lint` does,
   so both ends are in the clone.
3. Any changed path in `all`: everything. Any changed path matching no group: everything, and the reason printed.
4. Otherwise the union of the matched groups' tests plus every test whose own file changed. `none` adds nothing.

This is exactly the comparison GitLab's `rules:changes` makes: on a merge request pipeline it compares the source
head with the merge base against the target (`CI_MERGE_REQUEST_DIFF_BASE_SHA`), so the target moving on does not
count as the merge request's change; on a branch pipeline it compares with `CI_COMMIT_BEFORE_SHA`, all zeros on a
branch's first push, when every `changes` rule is true (`compare_to:` can name a branch instead; the instance is
19.5.1, so it is available). What `rules:changes` cannot say is "a path not in this list": it only names paths that
trigger. So the decision "an unmapped file runs everything" cannot be written in YAML; it is written in the script
(rule 3) and backed by the lint, which stops an unmapped file merging at all.

**Kept honest by the lint**, a new section `test-map` in `tools/ci/lint.sh` (`tools/ci/test-map-check.mjs`), on every
pipeline:

- every path `git ls-files` prints matches at least one group ("unmapped: `assets/js/new.js`; add it to a group in
  `tools/ci/test-map.json`, `none` if no test can see it"); and every pattern matches at least one tracked file, so a
  renamed file cannot leave a hole behind it;
- every `tools/ci/*-test.mjs`, `*-test.sh`, `journey.mjs` and `freeze.mjs` is named in exactly one place: the map's
  tests (browser), `node-tests.sh` (Node) or a lint job's script in `.gitlab-ci.yml` (read with js-yaml, as
  `ci-split.mjs` reads it);
- every map test exists on disk, has a group that exists, a browser, a `gates` subset of its browsers, and seconds
  for each browser; `all` and `none` name no test.

The first check is what makes the map fail safe end to end: an unmapped file fails `lint`; mapping it changes
`test-map.json`, which is in `all`, so that merge request then runs everything.

## 3. The jobs

| Job | Stage | Runs | `needs` | Does |
| --- | --- | --- | --- | --- |
| `lint` | lint | every pipeline but schedules | - | as today minus the import and tool tests: `lint.sh`, the three small lint tests, `door-timing-lookup`, `no-real-names`, `node-tests.sh` (coverage to the artifact), `coverage-test`, `glow-banding`. About 3 min |
| `lint:test` | lint | every pipeline; runs `lint-test.sh` only when `test-select.mjs --group tooling` says so, else prints "not selected" and passes in seconds | - | as today (7.5 min when it runs) |
| `lint:import` | lint | same shape, group `import` | - | `nightly-import-test.sh`, `import-docs-test.mjs`, `raw-heading-test.mjs` (about 2.5 min) |
| `live:firefox` | live | every pipeline but schedules; `parallel: 2` | `[]` | `xvfb-run` one Xvfb, `node tools/ci/live-run.mjs firefox`: selects, takes its shard, runs |
| `live:chromium` | live | same; `parallel: 3` | `[]` | the same in Chromium, V8 coverage recorded, `coverage/` as an artifact |
| `coverage` | check (new stage) | same | `lint`, `live:chromium` | the ratchet on the union (section 6) |
| `import_docs`, `publish_docs`, `renovate` | unchanged | | | |

Why the jobs always start and select inside, rather than `rules:changes` on each: one source of truth (the map), the
fail-safe rule lives in code, and `.gitlab-ci.yml` stays static, which the ci-split lint needs (it refuses `include`
and child pipelines, so GitLab's generated-pipeline route is closed on purpose and stays closed). The cost is a shard
that starts, selects nothing and stops: about 15 s on this runner (image cached, `npm i playwright` 3 s). Question 16
offers the other route.

`needs: []` on the live jobs: they start at once, beside `lint`, instead of after it as today (the ratchet needed
`lint`'s Node coverage; that wait moves to the `coverage` job). The gate's wall time is the slowest job, not a sum.

**Shards.** `live-run.mjs` sorts the selected tests by `seconds[browser]`, longest first, deals them to
`CI_NODE_TOTAL` bins greedily (each test to the emptiest bin), and runs bin `CI_NODE_INDEX`, tests one after
another. Serial within a shard: the runner has 4 CPUs and software GL takes them; parallel tests on one runner is the
condition door-lows L3 failed under three times (AGENTS.md), so the parallelism is across jobs, which each get a
runner slot. Coverage files take the shard's index in their name
(`browser-<test>-<CI_NODE_INDEX>-<pid>.json`) so shards cannot overwrite each other in the merged artifact.

**Gating.** A test's failure fails the job when the test's `gates` names the job's browser. Today Chromium's runs are
report-only and Firefox's gate; with the browsers side by side the default is both gate (question 19), with
`site-browser` on Firefox only until its Chromium flake (B7, `docs/flakes.md`) is fixed.

**Lint guards kept.** `publish_docs` is untouched (its one script line, variables, `needs` with `artifacts: false`,
environment, no `parallel`, no rule variables); no job but it names `docs-import`, none but `renovate` names
`renovate`; `NODE_IMAGE` once in the global variables; no `include`, no `trigger`; the workflow rules keep their
order (the docs-import and bot rules before the general ones). `parallel:` is on the live jobs only, which hold no
token. The one change to the workflow rules is none: push pipelines on `dev` and `main` are still created and
decide what to run inside (question 17).

**On a merge request with `LIVE_ALL` or a door change, and on promotion**, a pipeline is 2 + 3 + 3 = 8 jobs at once.
The `light` lane's concurrency decides whether shards queue; the estimates below assume they do not. If the lane
runs fewer, promotion stretches toward 15 min and the shard counts come down.

## 4. Ports and browsers

- **No fixed ports.** `journey` (8787), `upload` (8793), `pin` (8794), `dawn` (8795) and `site-browser` (8796) bind
  the port the OS gives (`freePort()` in a new `tools/ci/live-lib.mjs`, the probe eight tests already carry, moved
  there); the other eight already do. The host's other worktrees stop colliding, and shards cannot.
- **One site server per job.** `live-run.mjs` starts `serve.mjs` once on a free port and hands the tests `SITE`;
  every test honours `SITE` (as `journey.mjs` does) and starts its own server only without it. Tests that reroute
  requests (door-lows L2, csp F1, dawn's held pictures) do it with `page.route`, per context, so a shared server
  changes nothing for them.
- **One browser per job, fresh contexts.** `live-run.mjs` launches `playwright[browser].launchServer({ headless:
  false })` under the job's one Xvfb and hands the tests `PW_WS_ENDPOINT`; `live-lib.mjs`'s `openBrowser()` connects
  to it, or launches as today when the test asks for its own flags. Each test keeps `newContext()` per case, which is
  the freshness they rely on (localStorage, the probe's week-long key, routes). Tests that must launch their own:
  `freeze` (`--ignore-gpu-blocklist --enable-gpu`, the machine the bug is on), `docs-sky-portrait-live`
  (`--use-angle=swiftshader`), `upload` (headless Chromium beside headed Firefox). The shared browser is launched
  plain, as the rest launch today, so no test's conditions change. Saving: a browser launch (3-5 s) per test, about
  a minute per job; the real win of the item is that a crash in one test's browser no longer costs the next test its
  launch time, and the pattern is what Playwright documents for several browsers.
- **One Xvfb screen per job** (1280x800x24). `upload` asked for 1280x720; viewports are set per context and
  `tests/crop.html` sizes its own canvas, so the screen size is not load-bearing. The build confirms that first.
- Locally `journey-local.sh` runs the same `live-run.mjs`, so nothing on the shared host holds a port.

## 5. Browser tests that become Node tests

Only **`pin`** (#23). It opens `tests/pin.html`, calls `journey.fly({ at })` and `journey.descend({ at })`, and
checks which hooks fired and which body classes appeared before a deadline: timeline arithmetic, judged on a clock.
`door-stub.mjs` already gives a Node test the door through `assets/door/index.js` with a stub page and a virtual
clock (`installClock`), and `flight-waits-test.mjs` W4 already flies a pinned flight on it. Rewritten from #23's
specification, on the virtual clock, it takes under a second instead of 39 s in Firefox and 44 s in Chromium, and
nothing in it depends on the runner. `tests/pin.html` goes with it.

The rest stay, each for one reason: `upload` compares what two WebGL uploads put on the GPU; `dawn` reads a real
browser's picture loads, `decode()` and resource timing; `asdawn` measures CSS layout in pixels; `csp` needs the
browser's policy enforcement; `site-browser` and `phone-door` judge rendering, focus and `:focus-visible`;
`door-lows`, `flight-context-loss`, `docs-planet`, `docs-sky-portrait-live` and `freeze` need a WebGL context and a
page's own frames; `dropped-warning` uses the browser's HTML parse as its reference (2 s; it keeps its place in the
Chromium job, group `import`).

## 6. Coverage

The mechanism stays: Node coverage from `lint` (every run, whole) and Chromium's V8 coverage from `live:chromium`
(every shard's `browser-*.json`) are merged by the `coverage` job and held to `tools/ci/coverage-floors.json`.
`coverage-run.sh browser` goes; `coverage-hook.mjs` is loaded by `live-run.mjs` on every Chromium test, so no second
Chromium pass exists any more: the 18 min coverage pass is gone, and so are the two tests it left out (`dawn`,
`asdawn`: Firefox-only, their lines are Node-covered or small).

The `coverage` job runs `test-select.mjs --json` itself (same inputs, same answer) and `coverage.mjs` with the
selection:

- **Full run** (promotion, `LIVE_ALL`, a door or unmapped change): the ratchet as today. Below floor fails, a file
  with no floor fails, a floor whose file is gone fails; what could be raised is printed.
- **Partial run**: "gone" still fails (knowable from the tree). For a changed site file, every test the map links to
  it ran, so its measurement is complete and it is held to its floor (question 18); a false failure here means the
  map missed a test that covers the file, and the fix is the map, never the floor. Every other file is reported
  "not measured in full", never failed, and nothing is raised.
- `coverage.mjs` gains `--selection FILE`; its report says which mode it was in. A floor is never lowered to pass,
  in either mode, as the file's `about` says.

**Floors from CI, not three local runs.** `tools/ci/coverage-fetch.sh JOB_ID...` downloads a `coverage` job's
artifact (`glab job artifact`, the agent's own `GLAB_CONFIG_DIR`; read-only) into `coverage/ci-<id>/`;
`node tools/ci/coverage.mjs --raise coverage/ci-A coverage/ci-B coverage/ci-C` is unchanged: lowest of the runs
given, raise only. The three runs are the last three full runs: promotion pipelines, or `LIVE_ALL=true` runs of the
merge request by hand (about 11 min each, no local time). A new file's floor is taken the same way: its merge
request's first pipeline runs everything (the file was unmapped, or the map changed), the author runs two more with
`LIVE_ALL`, fetches the three, raises, commits. Question 20 is whether one run may do for a new file.

**Where the ratchet now bites.** On every full run; on partial runs only for the changed files. A loss that slips
past a partial run (a file whose coverage came from a test outside its group) reaches `dev` and is caught at
promotion, which then fails and sends the fix back to `dev`; `main` never takes it. The risk is accepted by the
owner's decision; question 18 is how much of it the changed-file rule takes back.

## 7. Local commands

- `sh tools/ci/journey-local.sh [--browser firefox|chromium] [--changed | --all | TEST...]`: the same
  `live-run.mjs` CI runs, on the Playwright `journey-local.sh` already finds; no argument means `--changed`
  (the selection against `dev`, printed first); `--all` is the gate's full run. Firefox headed under Xvfb with
  software GL as now. `journey-local-test.sh` is rewritten to the new specification (it stubs `xvfb-run` and reads the
  exact commands, so it cannot survive the change).
- `sh tools/ci/coverage-run.sh`: a full local run (Node tests, then `live-run.mjs chromium --all` with the hook, then
  the check); `coverage-run.sh check` as now; `browser` goes. `COVERAGE_DIR` as now.
- `sh tools/ci/coverage-fetch.sh JOB...` then `node tools/ci/coverage.mjs --raise DIR DIR DIR`: floors from CI.
- `node tools/ci/test-select.mjs [--base REF] [--json]`: what a change selects and why, for a look before pushing.
- README's layout table, the coverage paragraph and AGENTS.md's coverage and journey rules change to match.

## 8. Expected times (estimates)

From pipeline 2962 (2026-10-24; `live:journey` job 39237, `lint` job 39235), one run on a shared runner; the times
move by a third between runs. Seconds per test, Firefox / Chromium: journey 48/45, upload 9/4, pin 39/44 (goes),
site-browser 85/118, phone-door 63/58, door-lows 172/275, flight-context-loss 110/177, csp 67/60, dawn 100/-,
asdawn 111/-, docs-planet -/135, docs-sky-portrait-live -/457, freeze -/205, dropped-warning -/2. Job setup about
15 s; a browser launch 3-5 s per test today.

| Pipeline | Longest job | Wall time |
| --- | --- | --- |
| Today, any merge request | `live:journey` 42-45 min after `lint` 5 min | 48-50 min |
| Promotion (everything) | `live:chromium` shards: about 1,525 s over 3, the slowest 8-9 min (docs-sky-portrait's); `live:firefox` 765 s over 2, 6.5 min; `lint:test` 7.5 min; `coverage` 1 min after Chromium | about 10-11 min |
| Docs-only, `*.md`, `docs/**` | `lint` 3 min; every other job selects nothing | about 3.5 min |
| `home.js` | journey + site-browser: Firefox 133 s, Chromium 163 s | about 4 min (`lint` is the floor) |
| `pads.js` or the nightly import (`docs`) | journey + site-browser + csp: Firefox 200 s, Chromium 223 s | about 5 min |
| `journeys.js` (`flight`) | Chromium: journey, flight-context-loss, docs-planet, docs-sky-portrait, 814 s over 3 shards, the slowest 7.6 min | about 9 min |
| `main.js`, `site.css`, `index.html` (`page`) | everything but the three harness tests: Chromium about 1,520 s over 3 | about 10 min |
| A door change | everything | as promotion, 10-11 min |
| Firefox-worker's branch (door, fonts, vendor) | everything | as promotion |

The target of about 10 minutes for an ordinary merge request is met with room for the common cases and only just
for `page`; the `page` group is where the map's granularity is a dial the owner can turn later (section 9).

## 9. Risks

- **A change breaks a page through an unmapped path.** The map is coarse on purpose (`page` runs nearly everything)
  but a rule in `site.css` that `home.js` relies on, or a picture under `assets/img/door/` the live door reads, can
  slip a merge request. Every such slip is caught at promotion, before Pages: the cost is a failed promotion and a
  fix on `dev`, not a broken site. The lint cannot judge granularity; review can, and `test-select.mjs` prints its
  reasoning in every job log so a too-small selection is visible.
- **The ratchet only on full runs** (section 6): a coverage loss can reach `dev`. The changed-file rule takes most of
  that back; the rest waits for promotion.
- **Green jobs that ran nothing.** A docs-only merge request shows five green live jobs. Each says "0 of N selected"
  in its log and the `coverage` report says "partial: no browser test ran"; question 16 can remove them.
- **Chromium now gates** (question 19): Chromium-only flakes (site-browser B7) fail merge requests; `gates` per test
  is the valve, and a test on it needs an issue, never a permanent exemption.
- **Shard balance** depends on `seconds`, which go stale; only time suffers. The build prints each shard's planned
  and real time so the field can be refreshed from a log.
- **Runner concurrency**: eight jobs at once on promotion; a lane that holds fewer queues them.
- **Merge results are not tested on CE**: a merge request's tests run on its source head, not the merged tree.
  Today's gate has the same gap; the push pipeline on `dev` (question 17) is the one that sees the merged tree.
- **The map's own change runs everything**, so a one-line map edit costs a full run: that is the fail-safe working,
  not a fault.

## 10. What cannot work exactly as decided

- `rules:changes` cannot express "a file not in the map runs everything": GitLab's rule only lists paths that
  trigger. The decision is delivered by `test-select.mjs` (rule 3) at run time and by the lint, which refuses an
  unmapped file, so the YAML never needs the negative.
- GitLab's native way to decide a job list per merge request, a generated child pipeline, is refused by the ci-split
  lint (a job in a child pipeline escapes the token check, #52); it is not used, and the lint is not loosened.
- "Browsers side by side, each in its own job" holds; a browser's job is itself split into shards, because a single
  Chromium job is 26 min (docs-sky-portrait-live alone is 7.6 min) and would miss the target on promotion.

## 11. Build, in three batches, each tests first

Line counts are rough, tests included. Each batch is one merge request into `dev`, selected by the map once it
exists (the first batch's own paths are in `all`, so it runs everything).

**Batch 1: the map, the selection, the lint (about 900 lines).** Tests first, from this ADR: `test-select-test.mjs`
(the four rules, deletions, a test's own file, `none`, promotion and `LIVE_ALL`, zeros before-SHA, a base ref) and
`lint-test.sh` cases for the `test-map` section (unmapped path, stale pattern, a test named twice or nowhere, `all`
with a test). Then `test-map.json`, `test-select.mjs`, `test-map-check.mjs`, the lint section; `pin` rewritten as a
Node test from #23 (`pin-test.mjs` in `node-tests.sh`, `tests/pin.html` removed). Nothing in CI changes yet; the
lint proves the map complete on the current tree.

**Batch 2: the jobs, the runner, the ports, the browser (about 950 lines).** Tests first: `live-run-test.mjs`
(sharding by seconds, `CI_NODE_INDEX`, `SITE` and `PW_WS_ENDPOINT` handed on, `gates`, exit codes, "0 selected"),
`live-lib-test.mjs` (free port, connect-or-launch), `journey-local-test.sh` rewritten. Then `live-lib.mjs`,
`live-run.mjs`, the five fixed-port tests and every test's `SITE` and `openBrowser()` (about ten lines each),
`journey-local.sh`, `.gitlab-ci.yml` (the two live jobs with `parallel`, `lint:test` and `lint:import` selecting,
`needs: []`, the `check` stage), the `coverage` job in report-only form so the pipeline is whole. CI is its own
test: the batch's pipeline runs everything (its paths are in `all`), and one `LIVE_ALL` run on a docs-only commit
shows the empty path.

**Batch 3: coverage (about 450 lines).** Tests first: `coverage-test.mjs` cases for `--selection` (full, partial
with a changed file below its floor, partial with an untouched file below, gone), `coverage-fetch` against a stub.
Then `coverage.mjs`, `coverage-fetch.sh`, `coverage-run.sh`, the `coverage` job gating, README and AGENTS.md. The
floors file is untouched: nothing is lowered, and the first three promotions give the artifacts to raise from.

About 2,300 new lines in all, against the 15,000 ceiling.

## Questions for the owner

*Answered 2026-10-27 (owner): 16a, 17a, 18a. 19 and 20 open.*

**16** How the live jobs decide to start.
16a (recommended) Always start and select inside the job: one map, the fail-safe in code, static YAML; a docs-only
merge request shows five green jobs of 15 s each.
16b Also generate `rules:changes` lists from the map into `.gitlab-ci.yml`, checked by the lint like the door's
markup (`--check`): no job at all for docs-only, at the price of a generator, a second place the map lives, and
about 150 more lines.

**17** Push pipelines on `dev` and `main`.
17a (recommended) `dev` selects against the push's range (the merged tree gets the merge request's own tests, the
one thing CE's merge request pipeline cannot see); `main` runs `lint` only (the promotion just ran everything on
`dev`'s head, and `main` differs by imported docs the lint checks).
17b Both select: `main` repeats the full run after every promotion, about 11 min more of runner time per release.
17c Both `lint` only: cheapest; the merged tree on `dev` goes untested until promotion.

**18** The ratchet on a partial run.
18a (recommended) Hold the changed site files to their floors (their whole group ran) and report the rest: most
losses are in the file that changed, and a false failure points at a hole in the map.
18b Report only on partial runs; the ratchet bites on full runs alone. Simpler, and a loss waits for promotion.

**19** Does Chromium gate?
19a (recommended) Both browsers gate, per test through `gates`; `site-browser` on Firefox only until B7 has an
issue and a fix. A Chrome-only break is a break for most visitors; today it is only a line in a log.
19b Chromium report-only, as today; the ratchet is all its run is for.

**20** A new file's floor.
20a (recommended) Three full CI runs as today's rule (the first pipeline plus two `LIVE_ALL` runs, about 11 min
each, no local time): a floor set on one lucky run fails the next promotion and cannot be lowered.
20b One run: fastest; `--raise` prints its warning and the author takes the risk.
