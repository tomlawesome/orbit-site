# ADR-0002: The door tests the GPU once per visit, before any WebGL

**Status:** Accepted (owner, 2026-10-10: decisions 5a, 6a, 7)
**Amended:** 2026-10-31, section 6 (#116): owner decisions 18a and 19a replace decision 7 (nothing remembered) and the
"a flight never waits for a verdict" half of 12d. A way in opens only once its proper version is loaded and the
verdict is in; the verdict is remembered on the device for a week and re-taken quietly each visit. For the owner's
review before any code.
**Date:** 2026-10-10
**Relates to:** #2 (door freezes on software-GL machines); #116 (no way in plays a cheaper version for want of
readiness); #115 (the gate opens 9-12 s on the phone); Orbit #1253 and #1310; ADR-0001; ADR-0004 6a.5 (the leisure
proof kept on the worker path).

Pattern throughout: **capability detection before feature use, from one resource that is then reused** (Orbit #1253, commits ab8e356f, b3e99cd4). The door folder takes Orbit's `fitness.js` almost verbatim, minus its remembered verdict (Orbit #1310, 00a8923a; owner decision 7, below), so Orbit can delete its own `fitness.js` and most of `warm.js` after the import.

Owner decisions, 2026-10-10: **5a** a slow machine (median frame over 30 ms) gets the painted flight, as Orbit does; **6a** a cheaper model builds from these notes; **7** no remembered verdict: the machine is tested on every visit, "it gives the smoothest experience for the pc conditions at the time". **12d** the speed test runs in the leisure warm-up after the door is lit, so no flight waits for it (below).

## 1. Decisions

**One GPU gate, in the door folder, before any GL.** `fitness.js` gains `gpu()`: one WebGL2 context asked with `failIfMajorPerformanceCaveat: true`, refused when the unmasked renderer matches `/llvmpipe|softpipe|swiftshader|microsoft basic render/i`. Accepted, the context is kept and the flight's world (`voyage.js`) is built on it; `compilesAside()` reads `gpu().parallel` instead of making a throwaway context. Refused, nothing on the page touches WebGL and no world pictures are fetched. This is an engineering call, and it is Orbit's proven shape.

**A lost context is restored on the same canvas, not tested again (owner decision 2a, 2026-10-11).** The gate cancels `webglcontextlost` so the browser may restore the context (Khronos, HandlingContextLost); meanwhile the page draws without WebGL, and once `webglcontextrestored` fires the next world is built on the same canvas and `gl` with no second test and no second context. A context never restored leaves the page on its 2D canvas.

**When the gate runs.** On first ask, synchronously. The site asks it in `showDoor()` just before `dawn.light()`, so the one remaining context creation (250–500 ms on llvmpipe) lands after the door's stills are painted and before the ring starts, never during the reveal. Arriving anywhere but the door, the first ask is the leisure warm-up's. Under save-data no speculative ask is made; the first ask is the flight's own, on the click.

**The probe (`capability.js`) runs only for the live door.** Today it runs at page start on every visit, making a context, compiling twice and drawing four 512² frames, and without `?door3d` its result only feeds a console line. It now runs only when `flags.door3d` is set and the gate accepted, on the gate's context (which it must not lose), when the host first asks `probe()`. Without it `level()` is 0, as now.

**A software refusal overrides the `?level=` ladder.** `?level=` chooses among live-door weights once the GPU is accepted; it never grants the GPU. A separate debug flag `gpu=force` (host reads `?gpu=force`) takes the context without the caveat check and skips the name check. Reason: one switch per question, and the site's own live check needs the force (below).

**Fitness: adopt Orbit's refusal, keep the site's scaling (both).** After the warm-up frames, `frameCost()` draws 2 untimed frames then up to 5 timed, judging the median against 30 ms; unfit → the flight draws on its own 2D canvas ("too slow here, drawn without it"). `calibrate()` still scales resolution afterwards for fit machines. Owner decision 5a: refuse, as Orbit does, rather than fly a 31–45 ms machine coarse.

**No test frames on the door; the verdict is ready before anyone flies (owner decision 12d).** *(Superseded in part,
2026-10-31, section 6: no flight or descent goes painted for want of a verdict; the ways in wait instead. The rest
stands.)* Before `body.lit`, `warm({ prove: false })` makes shaders and uploads pictures and stops. The leisure warm-up (`journey.later`, a few seconds after the door is lit) proves the world, on an accepted GPU only: the touch frames, the fitness and calibrate, a few milliseconds on real graphics. A flight never waits for a verdict. Up or down, it uses the world if the verdict is in and fit, and otherwise flies the painted flight with no pause. A flight up asked before the warm-up has run still proves the world itself, as it always did, behind the `ready` hold. Only a descent made before the warm-up (a visitor leaving within about 4 s of arriving) is painted. Owner, 2026-10-10, on a descent that waited up to 8 s: "we should have already known this from when the door loaded".

**Drop the leisure warm-up when a flight begins.** The door owns the timer: `journey.later(fn, { after })` runs `fn` after `after` ms once painted animations have finished (Orbit's `drawnIn`); `descend()` and `fly()` drop every pending one. Orbit's `stopLeisure` becomes this.

**No remembered verdict (owner decision 7).** *(Superseded, 2026-10-31, owner 19a: section 6.4. The test still
runs every visit; its verdict is now kept a week.)* The fitness test runs on every visit, on the flight's first `prove: true` ask, so a GPU upgrade, a driver fix or a busy moment are judged as they are now. There is no `build` setting and no stored fitness key. Orbit's existing `orbit-flight-fitness` key is left for Orbit to remove after its import.

**Other worlds share the verdict only.** `world.js`, `install.js`, `door3d.js` need `alpha: true` contexts; they ask `gpu()` first and take the no-WebGL2 path when it is null, making their own context only when accepted.

## 2. Interface changes (README)

- `index.js` exports add: `gpu()` → `{ canvas, gl, parallel, renderer } | null`; `isSoftware(name)`; `FIT_MS`. Tests import `fitness.js` directly (lint allows).
- `settings`: `flags.gpu`: `"force"` accepts a software renderer.
- `compilesAside()`: asked of `gpu()`; `true` when the GPU is refused or absent (nothing will compile); `false` under `mainthread`.
- `probe()`: only with `flags.door3d` and an accepted GPU, else resolves `{ ok: false }`.
- `journey.warm({ prove = true })`, `journey.warmDocs({ prove = true })`; `journey.later(fn, { after = 4000 })` → `stop()`; `descend()`/`fly()` drop pending `later`s.
- Console (via `note`): `flight world: on (frame N ms)` / `off: software renderer (…)` / `off: no WebGL2 here, or the browser calls it a major performance caveat` / `off: frame N ms`.

## 3. Testable specification

Context counting: a Playwright init script wrapping `HTMLCanvasElement.prototype.getContext` records each call's type and attributes. Long tasks: `PerformanceObserver` `longtask`, Chromium only.

1. Software GL, Chromium headed under Xvfb (`--ignore-gpu-blocklist --enable-gpu`), motion on, `/`: exactly one `webgl2` getContext call on the page, with `failIfMajorPerformanceCaveat: true`; it happens after `#door.shown` and before `body.lit`.
2. Same run: after `body.lit`, for 10 s, zero long tasks over 50 ms. Before `lit`, at most one, under 1000 ms.
3. Same run: console contains one line matching `orbit · flight world: off: software renderer (` and no `console.error`; no request for `assets/door/img/flight/*`; no `#warpgl` canvas; `localStorage` has no `orbit-flight-fitness` and no `orbit-probe …` key.
4. Same run, click the gate: the flight runs on the 2D canvas (`body.showwarp` then `body.bare` within 20 s), still no further `webgl2` context.
5. `?gpu=force`, same machine: a `webgl2` context without the caveat attribute; `#warpgl` exists; the install world logs `install: ready`.
6. `?door3d` without force on software GL: no probe runs (no `orbit · probe:` line), `level 0` line present.
7. Save-data (`navigator.connection.saveData` stubbed true), `/`: no `webgl2` context until the gate is clicked; then one.
8. Real-GPU control (owner's machine, by hand, and a unit test with a fake `gl` whose renderer is `"NVIDIA GeForce …"`): `gpu()` non-null; the first flight logs `flight world: on (frame N ms)`; nothing is written to `localStorage` for fitness, and a second visit runs the timed frames again.
9. Unit, `frameCost` with fake `now`: medians `[5,5,5,40,40]` → fit; `[40,40,40,5,5]` → unfit, stopped after 3 frames; a throwing `draw` → `{ fit: false, ms: Infinity }`.
11. Unit, `journey.later`: `fn` not called before `after`; `descend()` before then → never called; `fly()` likewise.
12. Speculative warm (`warm({ prove: false })`, fake gl): no `readPixels` call; `warm()` afterwards → the touches, then fitness.
13. Firefox live check (`tools/ci/journey.mjs`, software GL): it can see console lines, contexts (via the init script), classes and localStorage; it cannot see long tasks. Its install-world step visits `?gpu=force#install` and keeps its assertions; the door steps pass with the GPU refused.

## 4. Build notes

Door folder (shared): 1 `fitness.js` new, from Orbit's minus `$app` and minus `rememberedFit`/`rememberFit`, verdicts via `note`, `flags.gpu`. 2 `chores.js` `compilesAside` → `gpu()`. 3 `capability.js` `measure(gl)` on the gate's context, no `loseContext`, `probe()` gated. 4 `voyage.js` `createVoyage()` takes `gpu()`, `webglcontextlost` listener, `warm({prove})`, fitness then calibrate, `ready` getter. 5 `engine.js` `warm({prove})`, `fetchVoyage` only when accepted, unfit treated as dead. 6 `journey.js` `warm/warmDocs(how)`, `later`, drops in `descend`/`fly`. 7 `index.js` exports; README.

Site pages: 8 `main.js`: remove `probe().then(level)`; `?gpu=force` flag; `asideHere` skips under save-data; `warmJourneys` uses `prove: false`, `flyNow`/`launchNow` default; leisure timer → `journey.later`. 9 `install.js`, `world.js`: `gpu()` null → no-WebGL2 path, no map fetch. 11 `tools/ci/journey.mjs` force flag on the world step; new `tools/ci/freeze.mjs` (Chromium, specs 1–4) and its CI job. 12 `tests/` units (9, 11, 12).

Orbit after import (its session): delete `fitness.js`; `warm.js` keeps only its page-flow glue, calling `gpu()`, `journey.warm({prove:false})`, `journey.later`; `compileStopsPage` = `gpu()?.parallel === false`; `Leave` relies on `descend()` dropping leisure; drops its remembered verdict (#1310) and may clear the old `orbit-flight-fitness` key; dial's sun asks `gpu()`.

## 5. Out of scope (file separately)

- The site warms the flight under reduced motion though it shows stills; Orbit does not.
- `calibrate`'s target (11 ms) versus the live door's budget (40 ms) are unrelated numbers; one budget table.
- The probe's week-long cache keyed on UA+screen: by decision 7's reasoning it may go too, once the live door leaves its flag. *(Moot since 2026-10-31: section 6.4 adopts its shape for the fitness verdict; the two share `WEEK`.)*

## 6. Amendment, 2026-10-31 (#116): a way in opens only on its proper version; the verdict kept a week

Owner decisions, 2026-10-31 (#116, verbatim there): **18a** "not ready yet" is no longer a reason to play a cheaper
version of a way in; each opens only once its proper version is loaded and has passed the speed test, and the painted
flight and the other cheaper versions remain only for a device the test refuses (5a) or a real failure (a lost
context, no WebGL2, a world that could not be made). **19a** the verdict is remembered on the device for a week, as
`capability.js` keeps the `?door3d` probe, and re-taken quietly each visit; only a first visit (or the first after a
week or a cleared store) waits for it. Priority: smooth loading first (#115: on the phone the gate opens at 9.2-21.5 s,
the planets at 2.1-4.9 s).

Pattern: **a cached capability verdict with a time to live, revalidated in the background** (what HTTP calls
stale-while-revalidate, and what the probe's week-long store already is): the stored answer serves the first question
of a visit, the fresh one replaces it the moment it is in, and nothing is served stale past the week.

What today's figures say about the cost (#115's table, four phone loads): the verdict (`flight: world proved`) came
at 5.2, 12.8, 5.3 and 5.4 s, the gate (`flight: ready`) at 21.5, 11.7, 9.3 and 9.2 s. The docs' proof takes the test
on the galaxy alone, before the maps (ADR-0004 6d.1), so on the phone the verdict is in before the load is: 18a costs
the phone's gate nothing, and 19a's memory does not move it either. What moves it is #115 (6.5 below, last paragraph).
The memory earns its keep where the load finishes first (a desktop's first visit) and in letting the proof stay at
leisure.

### Decisions (6.1-6.14)

**6.1 One rule for every way in.** A way in opens when its proper version is loaded **and** the verdict on it is in.
"In" is any of: a remembered pass (6.4); this visit's test (fit or unfit: unfit is 5a's refusal, and the painted
flight is then the proper version for this device); the gate's refusal (`gpu()` null: no world, the painted flight is
all there is); the world's failure (not made, lost, or not ready within the backstop, 6.7). "Not yet" is never an
answer. The ways in and what each waits for:

| Way in | Proper version loaded | Today | Change |
| --- | --- | --- | --- |
| The gate (`#gate`) | `journey.warm({ prove: false })`: the Earth's picture, the world made, its maps on the GPU | opens on that alone (`main.js` `openWays([], true)`) | and `journey.verdict()` (6.3) |
| The docs' planet | its ring ready and `journey.warmDocs({ prove: false })` (ADR-0004 6d.1) | opens on those | and `journey.verdict()` |
| The install's and the information's planets | their world baked (`PADS.*.ring.baked`, `world?.baked`) | open on that; the dive holds on `shot.form` until the world is formed (`install.js`); their only cheaper version is where `gpu()` refused | none: they already meet 18a |
| The docs' back control (`#docspad .back.dawn`), the home's "back to the dawn" and the goodbye (the descent; the install's and the information's backs are no flight, `leaveWorld`, so they stay open) | the flight's world, as the gate's | always open; a descent before the proof is painted (`journey.js` `descend`: "never waits") | closed until the gate's own condition holds (6.8); a descent asked anyway (history Back) holds |
| The live door (`?door3d`) | its first frame drawn unseen and measured (`door3d.js`), on the probe's level | shown only then; the probe is stored a week already | none |

**6.2 The memory changes when a way in opens, never what a flight draws.** `ready` on the world keeps its meaning,
"proved this visit": every flight that draws the world still waits, behind its hold, for the two touch frames (the
driver finishing its shaders, the clean first frame) and the test. A remembered pass lets the gate open before that
proof and lets the proof stay at leisure; a click before it hurries the chores and holds a few frames, as a first
flight does today. One place decides what is drawn (`voyage.js` `judge`), and the stored verdict never reaches it.

**6.3 `journey.verdict()`.** New, beside `compiled()`: a promise of `{ fit, ms, how }` that resolves at the first of:
a remembered pass read (`how: "remembered"`, at the first `warm`); this visit's judgement (`"tested"`, or `"skipped"`
under `fit: "skip"`); the gate refused (`fit: false, how: "refused"`, at once); the world not made or lost before any
judgement (`"failed"`). It never resolves on a remembered unfit (6.4). The gate opens on
`Promise.all([journey.warm({ prove: false }), journey.verdict()])`, the docs' planet on its two today plus
`journey.verdict()`; `openWays` and its "take no click" idiom are unchanged.

**6.4 The memory.** Key `${storagePrefix}-fit ${gpu().renderer} ${screen.width}x${screen.height}@${devicePixelRatio}`
(the renderer names the GPU and driver, and the test's cost scales with the screen: `fitness()` draws at `part` 0.4 of
it; the UA is left out, since a browser's version turns over inside the week and the week already bounds drift); value
`{ t, fit, ms }`; valid when `t <= Date.now() && Date.now() - t < WEEK` (the probe's rule, clock skew included), `WEEK`
exported by `fitness.js` and imported by `capability.js` so there is one week. Read once a page, on the page (never in
a worker: 6.12), at the first `warm`; written at every judgement whose verdict was measured, both verdicts, with the
fresh figures. Not read or written under `fit: "skip"`: its pass is not a measurement and must not poison the owner's
own browser. `gpu: "force"` changes nothing here: a forced gate still measures a real verdict under the real renderer's
key (on software GL, an unfit), which is what lets the live tests exercise the memory at all.
**Only a pass is trusted ahead of the re-test.** A remembered unfit is kept and said (`flight world: remembered off
(frame N ms), tested again`) but opens nothing: the painted flight on a device that turns out fit today is the very
thing 18a forbids, and the wait on a truly slow device is the load (needed for the re-test anyway) plus seven frames,
so such a device waits as a first visit does. A device is never painted for a week on an old verdict. `calibrate()`'s
scale is not stored: nothing waits on the measure, and it is taken fresh after each proof as today.

**6.5 When the proof runs.** With a remembered pass: at leisure, as today (`proveLater`: 4 s after lit, 2 s after a
descent back; ADR-0004 6a.5's "kept" row stands), the quiet re-test. Without one (a first visit, a week on, a cleared
store, a remembered unfit): at once behind the load, `journey.warmDocs()` then `journey.warm()` asked in
`warmJourneys` right after the speculative asks, so the docs' galaxy proof gives the verdict before the maps land
(as the phone's figures above show it does). The proof's frames are chores and still wait for the reveal
(`chores.js` `open`, `drawnIn`), so 12d's "no test frames on the door" holds; what goes, for a first visit only, is
the 4 s of leisure between lit and the test, which on a fast desktop was the whole of the gate's wait under this rule.
Once a visit (`judged ??=`); a later `warm()` resolves at once. **#115 pointer:** the gate's wait is then the load,
`settle` in `engine.js` (the Earth's picture through `earthWait`, the maps' uploads as 60 ms chores: 447-487 chores,
3.0-3.7 s of work before `flight: ready` on the phone); nothing here changes that, and #115 is its own issue.

**6.6 A fresh verdict rules from the moment it is in, both ways.** Fit after a remembered unfit: the world is `ready`,
the next flight draws it. Unfit after a remembered pass: `retire()` as today, the flight painted for the visit (5a),
the console saying so, the gate (already open on the memory) left open: it leads to the painted flight of a refused
device, not of an unready one. Either way the fresh verdict is stored for the next visit.

**6.7 No let-go into the painted flight; the backstop is a failure.** `WORLD_WAIT` (8 s, `journey.js`) goes as a
let-go. In its place `WORLD_FAILED`, 30 s: past the longest bounded wait inside a proof (`PICTURE_WAIT` 20 s and
`COMPILE_WAIT` 5 s, `chores.js`, plus chores), so it fires only when something has hung. When it fires the hold lets
go, the journey goes on painted, the engine is told (`abandon()`: the world retired as `retire()` does, `flight world:
off: not ready in 30 s`), and the next `warm()` remakes the world from the start, as it does after a lost context, with
its own backstop. A flight held for a world that then fails (`dead` while holding) is let go at once, as today.

**6.8 The descent holds, and its ways in close.** `descend({ ready })` gains `ready` as `fly` has it: the clock holds
at the descent's first beat (before `withdraw`, so the landing stays as it is: nothing has dispersed to leave a blank
wait), `body.holding` set and cleared as `fly` does, not under reduced motion (no world drawn) nor when pinned (`at`).
Every host call passes `ready: journey.warm()` (`main.js` `backToDawn`, the goodbye and `homeToDawn`). The docs'
`.back.dawn` control and the home's two are closed until the gate's own condition holds (6.3), with the planets'
idiom (`aria-disabled`, `tabindex -1`, the click swallowed) and not shown: each fades in the moment it opens (owner
3a, 2026-10-31: "just fade the button in as soon as it's ready"), opened by `openWays` with a fourth id, `back`; a history
Back before then holds at the landing. The readying 4 s after arriving straight at a landing (`main.js`
`journey.later(readyDoor, { after: 4000 })`) stands: the landing's own world comes first.

**6.9 Save-data: no world.** Today a click under save-data asks the GPU, loads the maps and holds 8 s. With 6.7 that
hold would be 30 s against the visitor's own ask for less data. So under save-data the flight is painted outright:
`gpu()` is not asked, nothing of the world is fetched, the memory is neither read nor written, the ways in open at
once as today. Classed with 5a's refusals: the visitor's own. Every journey with a cheaper version takes it: the
flights up and down and the docs' flight painted, the install's and the information's dives on their refused-GPU
version (owner 1a, 2026-10-31: "play the cheap flights everywhere there is one").

**6.10 Reduced motion.** The reduced flights draw no world (`timeline.js` `ascentBeatsReduced`, no `warp`), so there
is nothing to prove and no hold; the ways in open on load, as today. The proof still runs by 6.5 and refreshes the
memory (the visit with motion on reads it); ADR-0002 section 5's first bullet stands as filed.

**6.11 The flags.** `fit: "skip"`: the verdict is `skipped`, in at the proof, never stored, the memory not read; the
gate then opens at load plus the proof's chores, so a live test that clicks the gate waits for `#gate:not([disabled])`
as it should already. `gpu: "force"`: the test runs (unfit on software GL, painted by 5a), memory read and written as
unforced (6.4). `draw`, `decode`, `level`, `door3d`: untouched; the probe keeps its own store and key.

**6.12 The worker path (ADR-0004 6a).** The memory is the page's: `remote-flight.js` reads it through the same
`fitness.js` calls the page engine uses, and the worker posts a new folder-internal message, `verdict { fit, ms,
skipped }`, from its `judge`, which the page stores and resolves `verdict()` on. `hello` is unchanged (the worker needs
nothing remembered: 6.2). A fallback to the page (`WORKER_WAIT` 5 s and the rest of 6a.4) hands `verdict()` to the page
engine as it hands `compiled()`; the quality is the same either side, so no way in is affected by which draws.

**6.13 A hidden tab.** Unchanged: the test waits for the tab to be shown (`fitWhenShown`). A first visit's gate in a
background tab opens once the tab is shown and tested; with a remembered pass it opens on load.

**6.14 What this supersedes.** Decision 7 whole; section 3's case 7 (save-data: one `webgl2` context on the click)
becomes none at all (6.9) and its cases 3 and 8 gain the `-fit` key (none on a refused machine, written on a real GPU);
in 12d, "a flight never waits for a verdict … otherwise flies the
painted flight with no pause" and "only a descent made before the warm-up … is painted"; the README's lines saying so
(`descend` "never waits", `warm` "each visit, nothing remembered"); `fitness.js`'s and `voyage.js`'s header comments
("never kept", "asked on every visit"). Everything else in sections 1-4 stands, 12d's test-frames-off-the-door rule
included.

### Interface changes (README, `assets/door/`), deliberate, additive

- `journey`: `verdict()` (6.3); `descend({ …, ready })` (6.8); `later` unchanged.
- `index.js` exports add `rememberedFit()` → `{ fit, ms, t } | null` (the host decides leisure or at once by it, 6.5),
  `WEEK`. `capability.js` imports `WEEK`.
- `journey.js`: `WORLD_WAIT` → `WORLD_FAILED` (30000), a failure (6.7); the engine surface gains `abandon()` and
  `verdict()` (`engine.js`, `remote-flight.js`, `draw-worker.js`).
- localStorage: one key, `${storagePrefix}-fit <renderer> <w>x<h>@<dpr>`, value `{ t, fit, ms }`, a week (6.4).
- Console (via `note`/`verdict`): `flight world: remembered on (frame N ms, D d ago)` / `remembered off (frame N ms),
  tested again`; `off: not ready in 30 s`; `off: save-data`; the site's own `prove: at once (nothing remembered)` /
  `prove: at leisure (remembered on, N d ago)` (`main.js`); the verdict lines of section 2 unchanged.
- Worker message `verdict { fit, ms, skipped }` (6.12). Entry point, slots, markup, stylesheet untouched; no
  `door-markup.mjs` run. Said in the commit.

### Testable specification: behaviour, never timings; the paths forced by flags

Node, through `assets/door/index.js` alone on the stub page (`tools/ci/door-stub.mjs`), one fresh process per case as
`fit-skip-test.mjs` does; the world a fake where its verdict must be chosen (`fake-voyage.mjs`, whose `warm()` the case
settles with a verdict, a death, or never); the clock virtual wherever a wait would be real (`installClock`); the stub's
`localStorage` a recording map the case seeds. "The gate opens" is the promise of 6.3 settling, read as the site reads
it. No case reads a clock, and no case passes on a timing.

Memory (`fitness.js`, unit):

- M1 store empty, `renderer: "NVIDIA GeForce …"`: `rememberedFit()` null. Control for M2-M5.
- M2 store holds a pass 3 days old under the key of 6.4: `rememberedFit()` returns it; the console says
  `remembered on (frame N ms, 3 d ago)` once, not twice on a second call.
- M3 the same pass 8 days old; the same with `t` an hour in the future: null, nothing said. Control: 6 days old, returned.
- M4 the same pass under another renderer, another screen size, another `devicePixelRatio`: null each.
- M5 a stored unfit 1 day old: `rememberedFit()` returns `{ fit: false }`, the line says `remembered off …, tested
  again`; `verdict()` (R-cases) does not resolve on it.
- M6 `rememberFit({ fit, ms, skipped: false })` writes `{ t, fit, ms }` under the key, pass and unfit alike; with
  `skipped: true` nothing is written; under `fit: "skip"` nothing is written and `rememberedFit()` is null though the
  store holds a pass. Control: `gpu: "force"` alone: written, and read as unforced.
- M7 `localStorage` that throws on get or set: `rememberedFit()` null, `rememberFit` no throw, the proof unaffected.

Readiness of the ways in (`journey` on the stub, the fake world):

- R1 no memory; the fake's `warm({ prove: false })` settled first, its proof settled fit after: the gate's promise is
  pending between the two and settled after the second, `verdict()` `{ fit: true, how: "tested" }`. Control for R2.
- R2 a remembered pass seeded: the gate's promise settles as soon as `warm({ prove: false })` does, before any proof;
  `verdict()` `how: "remembered"`; the fake's proof is still asked (6.5) and when it settles fit the store holds the
  fresh `ms`.
- R3 a remembered unfit seeded: as R1 (the gate waits for the proof); after a fit proof the store holds a pass.
- R4 no memory, the proof settles unfit: the gate's promise settles (an unfit is an answer), `verdict()`
  `{ fit: false, how: "tested" }`, the world retired (`fly(UP)` at its warp starts the engine painted: the fake's
  `start` sees no world), the store holds the unfit.
- R5 a remembered pass seeded, the fresh proof unfit: the gate opened on the memory (R2); `fly(UP)` after the proof
  starts painted; the store now holds the unfit. Control: fresh proof fit, the flight starts with the world.
- R6 `gpu()` null (the stub's software renderer, no force): the gate's promise settles with `warm({ prove: false })`
  (the Earth alone), `verdict()` `how: "refused"`, nothing in the store. Control: `gpu: "force"` and `fit: "skip"`:
  `how: "skipped"`, nothing in the store.
- R7 the fake world dies before any proof (`dead` once `warm({ prove: false })` has settled): `verdict()` `how: "failed"`, the gate opens, the next
  `warm()` asks a new world (today's remake) and `verdict()` is a new promise for it.
- R8 the docs' way in: the condition of 6.3 with `warmDocs({ prove: false })`; settles before `warm({ prove: false })`
  when the fake's galaxy is ready first and the proof is in. Control: proof pending, not settled.
- R9 the host's choice (6.5) is live, L5 below: the site says which it took.
- R10 save-data stubbed true: no `webgl2` context asked, no map fetched, no key read or written, the ways in open at
  once, `fly(UP)` starts painted with no hold. Control: save-data false, the gate waits as R1.
- R11 (6.5, owner 2a's condition) a first visit, the proof asked at once behind the load with the door's reveal not yet
  over (`chores.js` not `open`): none of the proof's chores (its touch frames, fitness, calibrate) runs until the queue
  opens; once it opens they run. Control: the same with `open` already true, they run at once. Behaviour only: which
  chores ran before `open`, never how long anything took.
- R12 (6.3) the flight's world dies before any verdict (its shaders not compiled in time) and `warm()` is asked again:
  the first `verdict()` promise (A) settles `how: "failed"`, `fit: false`, so the gate, the docs and the backs open
  (the site holds A, `main.js` `warmJourneys`); a `verdict()` taken after the re-warm is a new promise for the new
  round. Control: R7's case, death with no re-warm, still settles failed.

Holds (`journey`, virtual clock):

- H1 `fly(UP, { ready })` with `ready` never settling and the fake's proof never settling: `body.holding` from the
  start; at the warp beat the clock stands; at 29 s still standing; at 30 s the journey goes on, the engine started
  painted, `holding` cleared, `abandon()` called (the fake retired, `flight world: off: not ready in 30 s` said), the
  pending `warm()` left to settle. Control: `ready` settles at 25 s with a fit proof: the world is drawn, no line, no
  `abandon`.
- H2 the next `warm()` after H1 makes a new world (the fake's constructor called again), with its own `verdict()`.
- H3 `descend({ ready })` with `ready` pending: the clock holds at 0 (no `withdraw` class applied), `body.holding`
  set; `ready` settles: the descent runs, `holding` cleared, the world drawn when fit. Control: no `ready`: no hold,
  the descent as today. Under reduced motion with `ready` pending: no hold. With `at` set: no hold.
- H4 `descend` held and the fake dies meanwhile: the hold lets go at once, the descent painted.
- H5 the site's back controls are live, L6 below.

The worker path (`draw-worker.js` in a fake `Worker`, as ADR-0004 6a.7 D-cases):

- W1 the fake worker answers a `warm` with `verdict { fit: true, ms: 12, skipped: false }` then `warmed`: the page
  stores the pass under the page's renderer key and `verdict()` resolves `how: "tested"`; with `skipped: true` nothing
  is stored. Control: no `verdict` message, only `warmed`: `verdict()` pending, store empty.
- W2 a remembered pass on the page and the worker path: the gate opens on `warm({ prove: false })`'s `warmed`;
  `hello` carries no verdict field.
- W3 the worker falls back (no `up` within `WORKER_WAIT`, virtual clock): `verdict()` resolves from the page engine's
  judgement afterwards; no second read of the store.

Live (`tools/ci/journey.mjs`, Firefox, software GL, `?gpu=force&fit=skip` as its flight steps already run): L1 the
gate is `disabled` until `flight world: on (fitness skipped)` is on the console and `flight: ready` is, then enabled,
then the flight flies with `#warpgl`; L2 `localStorage` holds no `orbit-fit` key after it (skipped, not stored); L3
`freeze.mjs` check 3 adds the `orbit-fit` key to "nothing kept" on the refused machine; L4 a load with `?gpu=force`
and no `fit=skip` (unfit on software GL) leaves `{ fit: false }` under the llvmpipe renderer's key, and a second load
in the same context says `remembered off …, tested again` and still enables the gate only after
`flight world: off: frame N ms`. Control: the first load's verdict line did not say `flight world: remembered` (the site's own `prove: at once (nothing remembered)` says the word too, and is not that line). Real-GPU control, by hand: the owner's desktop,
first load after clearing the key: the gate after the verdict line; second load: the gate before it, the verdict line
later, the key's `t` renewed. L5 (6.5): the store seeded by an init script with a pass under the key of 6.4 (the
renderer read first, as `freeze.mjs` reads it): the console says `prove: at leisure (remembered on, N d ago)` and
`flight world: remembered on (frame N ms, N d ago)`, the second before any verdict line, and it is already on the console
when the gate is first enabled (the order against this visit's own verdict line is not checked: that is the leisure
re-test, which on a fast or software renderer can land first, pipeline 3271); control, the store empty: `prove: at once
(nothing remembered)`, no `flight world: remembered` line, and the gate enabled only after the verdict line. L6 (6.8): arriving at `?gpu=force&fit=skip#docs`, `#docspad .back.dawn` carries
`aria-disabled` and `tabindex="-1"`; clicked then, the body carries none of the journey's classes at the moment the
control opens (the attributes gone); clicked after, the descent runs (`showdawn`, then `#door.shown`). Control: a
plain load, `?gpu=force&fit=skip` and no hash, read as soon as the gate is enabled (the gate and the backs open in the
same call, `main.js` `openWays`, so no flight is flown to read them): the docs' back carries neither attribute. L6b: arriving at `#install`, its
back is open at once (no flight; corrected at review, 2026-10-31: the install's and the information's way back is
`leaveWorld`, so closing it made the visitor wait for nothing).

### Build notes, in order

Door folder (shared, ADR-0001; said in the commit): 1 `fitness.js`: `WEEK`, `fitKey()`, `rememberedFit()` (memo,
the console line, null under `fit: "skip"` and save-data), `rememberFit(v)`; `capability.js` imports
`WEEK`. 2 `page.js` and the worker's adapter in `draw-worker.js`: `verdict(line)` stays; add `judged(v)` (page:
`rememberFit`; worker: `post({ type: "verdict", … })`). 3 `voyage.js` `judge`: call `page.judged({ fit, ms, skipped })`
after `sayVerdict`; export `retire` as `abandon(why)`; header comment. 4 `engine.js`: `verdict()` (a deferred:
resolved by `rememberedFit()` pass at the first `warm`, by `judge` through a callback the voyage takes, by `settle`
when `!world3d` or `dead`, by `gpu()` null; renewed with `round`); `abandon()`. 5 `remote-flight.js`: handle
`verdict`, `verdict()` and `abandon()` on the surface, hand over on fallback. 6 `journey.js`: `WORLD_FAILED`, the
clock's hold given an `onFailed` (`need().abandon()`); `descend({ ready })` with the hold at 0; `verdict: () =>
need().verdict()`. 7 `index.js` exports; README (the interface changes above); `tools/door-markup.mjs` not needed.

Site: 8 `main.js`: the gate and docs conditions (6.3); `openWays` with `"back"` and the controls closed at start
(6.8); `proveLater` → `prove(after)` by `rememberedFit()` (6.5); `ready: journey.warm()` on the three `descend` calls;
the `prove:` line; 9 save-data (6.9) in the folder, not the site: `engine.js` `warm` under
`navigator.connection?.saveData` (the folder reads it already, `capability.js`, `fitness.js`) makes no world and
fetches no map (`fetchVoyage`/`createVoyage` skipped, so `gpu()` is never asked by them), `settle` resolves `verdict()`
`how: "refused"` and the line `off: save-data`; `rememberedFit()` null under it. `sw.js` untouched (no new asset). 10 Tests: `tools/ci/fit-memory-test.mjs` (M, R,
H, W), `journey.mjs` L1-L2, `freeze.mjs` L3; coverage floors as the ratchet says.

Risks: (a) a deferred `verdict()` that is never resolved on some path (a world that dies between `made` and `judge`,
a worker that falls back mid-proof) leaves a way in shut for good, worse than today's painted flight: R7, W3 and H4
exist for this, and `settle`'s `!world3d` branch is the catch-all; (b) the hold at the descent's beat 0 must not
apply `withdraw` first, or the landing blanks (H3 checks the class); (c) the gate under `fit=skip` now opens later in
the live tests: any step that clicks it on a timer rather than on `:not([disabled])` becomes a flake; grep `#gate`
in `tools/ci/*.mjs` first; (d) `rememberedFit()` must be read after `gpu()` has run (the key needs the renderer): at
the first `warm`, never at module load; (e) the two stores (`-probe`, `-fit`) are cleared together by a visitor clearing
site data, which is the intended "first visit" path.

### Questions for the owner (#116): all answered

**1** Save-data (6.9): answered **1a** (owner, 2026-10-31): "if they're using low data mode, respect it and play
the cheap flights everywhere there is one."

**2** A first visit's proof (6.5): answered **2a** (owner, 2026-10-31): "2a but if it causes the door's opening
stutter then we're back to having an issue. From the users perspective it MUST be smooth." The proof's frames are
ordinary chores, so they wait for `open` (only soft upload bands and compiles run before it, `chores.js` `may`); R11
holds that. The owner judges smoothness on real devices before the merge.

**3** The landings' back controls closed until ready (6.8): answered **3a** (owner, 2026-10-31): "just fade the
button in as soon as it's ready."
