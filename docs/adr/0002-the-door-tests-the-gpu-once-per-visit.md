# ADR-0002: The door tests the GPU once per visit, before any WebGL

**Status:** Accepted (owner, 2026-10-10: decisions 5a, 6a, 7)
**Date:** 2026-10-10
**Relates to:** #2 (door freezes on software-GL machines); Orbit #1253 and #1310; ADR-0001.

Pattern throughout: **capability detection before feature use, from one resource that is then reused** (Orbit #1253, commits ab8e356f, b3e99cd4). The door folder takes Orbit's `fitness.js` almost verbatim, minus its remembered verdict (Orbit #1310, 00a8923a; owner decision 7, below), so Orbit can delete its own `fitness.js` and most of `warm.js` after the import.

Owner decisions, 2026-10-10: **5a** a slow machine (median frame over 30 ms) gets the painted flight, as Orbit does; **6a** a cheaper model builds from these notes; **7** no remembered verdict: the machine is tested on every visit, "it gives the smoothest experience for the pc conditions at the time". **12d** the speed test runs in the leisure warm-up after the door is lit, so no flight waits for it (below).

## 1. Decisions

**One GPU gate, in the door folder, before any GL.** `fitness.js` gains `gpu()`: one WebGL2 context asked with `failIfMajorPerformanceCaveat: true`, refused when the unmasked renderer matches `/llvmpipe|softpipe|swiftshader|microsoft basic render/i`. Accepted, the context is kept and the flight's world (`voyage.js`) is built on it; `compilesAside()` reads `gpu().parallel` instead of making a throwaway context. Refused, nothing on the page touches WebGL and no world pictures are fetched. This is an engineering call, and it is Orbit's proven shape.

**A lost context is restored on the same canvas, not tested again (owner decision 2a, 2026-10-11).** The gate cancels `webglcontextlost` so the browser may restore the context (Khronos, HandlingContextLost); meanwhile the page draws without WebGL, and once `webglcontextrestored` fires the next world is built on the same canvas and `gl` with no second test and no second context. A context never restored leaves the page on its 2D canvas.

**When the gate runs.** On first ask, synchronously. The site asks it in `showDoor()` just before `dawn.light()`, so the one remaining context creation (250–500 ms on llvmpipe) lands after the door's stills are painted and before the ring starts, never during the reveal. Arriving anywhere but the door, the first ask is the leisure warm-up's. Under save-data no speculative ask is made; the first ask is the flight's own, on the click.

**The probe (`capability.js`) runs only for the live door.** Today it runs at page start on every visit, making a context, compiling twice and drawing four 512² frames, and without `?door3d` its result only feeds a console line. It now runs only when `flags.door3d` is set and the gate accepted, on the gate's context (which it must not lose), when the host first asks `probe()`. Without it `level()` is 0, as now.

**A software refusal overrides the `?level=` ladder.** `?level=` chooses among live-door weights once the GPU is accepted; it never grants the GPU. A separate debug flag `gpu=force` (host reads `?gpu=force`) takes the context without the caveat check and skips the name check. Reason: one switch per question, and the site's own live check needs the force (below).

**Fitness: adopt Orbit's refusal, keep the site's scaling (both).** After the warm-up frames, `frameCost()` draws 2 untimed frames then up to 5 timed, judging the median against 30 ms; unfit → the flight draws on its own 2D canvas ("too slow here, drawn without it"). `calibrate()` still scales resolution afterwards for fit machines. Owner decision 5a: refuse, as Orbit does, rather than fly a 31–45 ms machine coarse.

**No test frames on the door; the verdict is ready before anyone flies (owner decision 12d).** Before `body.lit`, `warm({ prove: false })` makes shaders and uploads pictures and stops. The leisure warm-up (`journey.later`, a few seconds after the door is lit) proves the world, on an accepted GPU only: the touch frames, the fitness and calibrate, a few milliseconds on real graphics. A flight never waits for a verdict. Up or down, it uses the world if the verdict is in and fit, and otherwise flies the painted flight with no pause. A flight up asked before the warm-up has run still proves the world itself, as it always did, behind the `ready` hold. Only a descent made before the warm-up (a visitor leaving within about 4 s of arriving) is painted. Owner, 2026-10-10, on a descent that waited up to 8 s: "we should have already known this from when the door loaded".

**Drop the leisure warm-up when a flight begins.** The door owns the timer: `journey.later(fn, { after })` runs `fn` after `after` ms once painted animations have finished (Orbit's `drawnIn`); `descend()` and `fly()` drop every pending one. Orbit's `stopLeisure` becomes this.

**No remembered verdict (owner decision 7).** The fitness test runs on every visit, on the flight's first `prove: true` ask, so a GPU upgrade, a driver fix or a busy moment are judged as they are now. There is no `build` setting and no stored fitness key. Orbit's existing `orbit-flight-fitness` key is left for Orbit to remove after its import.

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
- The probe's week-long cache keyed on UA+screen: by decision 7's reasoning it may go too, once the live door leaves its flag.
