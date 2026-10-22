# ADR-0004: The flight's compiles leave the page's thread only where that is measured to help

**Status:** Proposed (owner to answer questions 1 and 2 below, and to take measurement M1 before the Safari build)
**Date:** 2026-10-22
**Relates to:** #43 (with #74 folded in: the portrait star cloud); ADR-0001 (the folder Orbit copies); ADR-0002
(decision 12d, the leisure proof; decision 7, nothing remembered); #76 (memory on a phone); PERFORMANCE.md "The
worker, measured"; CAPABILITIES.md "A worker's compile"; `tests/worker.js`, `tests/t-worker.js`, `tests/t-stall.js`.

Two standard patterns are in play, and the decision is which browser gets which:

- **The render thread off the UI thread**: the drawing moved to a dedicated worker on an `OffscreenCanvas` handed
  over from the page (`transferControlToOffscreen()`), the page keeping the hooks, timeline and body classes and
  posting the beats. This is the pattern #43 proposes, and the only thing that helps where a browser compiles on the
  page's thread and shares no cache (Firefox).
- **A shader pre-warm on a helper thread**: the same programs compiled, linked and drawn once on a helper thread so the
  driver's cache answers the page's own compile in milliseconds (what game engines do when they precompile pipeline
  state on worker threads before a level). It helps only where the cache is shared across contexts, which is
  measured true on Safari and false on Firefox; Chromium already shares it and compiles in the background.

## 1. What the measurements say

| Browser | The page's own compile | A worker's compile | Does a worker's compile warm the page's? | Source |
| --- | --- | --- | --- | --- |
| Firefox (two desktop machines) | on the page's thread; the flight 1.9-3.1 s, every compile a stall | the page stays smooth; a page canvas drawing WebGL meanwhile stalls for the compile's length | **no** (the full price again) | 8 Oct, PERFORMANCE.md |
| Edge, Chrome | in the background, polled; smooth | **stalls the page and the spinner** | not needed: the cache is already shared across contexts | 8 Oct |
| Safari (the phone, 22 Oct) | not measured with the page's loop running (`stall` test never run on the phone); the `compile` test says it reports `KHR_parallel_shader_compile` and compiles in 130-170 ms each (8 Oct) | 260-340 ms each; the page's longest gap 34 ms with 2D, 74 ms with its own WebGL drawing too (idle: 37 / 41 ms); the eye: "pretty smooth" | **yes**: 4 / 12 / 14 ms afterwards | #43 note, 22 Oct |

Two corrections to #43's "Why", from the folder's own numbers: Safari does report `KHR_parallel_shader_compile`
(both measured devices, CAPABILITIES.md; and the worker today), so "Safari compiles on the page's own thread" is not
established; and nothing in the repository measures a one-second freeze on Safari. What was seen on a real device
(a painted sign-out "after a few seconds on home") is what ADR-0002 decision 12d builds: the world is proved at leisure,
4 s after the door is lit (`assets/js/main.js`, `proveLater(4000)` in `onLit`; 2 s after a descent back, `readyDoor`),
and a descent before that flies painted, on every browser, however fast the compiles were. The compile and the painted
quick sign-out are two problems; this ADR keeps them apart.

Browser support, checked 22 Oct 2026 against MDN's compatibility data (`mdn/browser-compat-data`): `OffscreenCanvas`
and `transferControlToOffscreen()` Chrome 69, Firefox 105, Safari 16.4; a `webgl2` context on an `OffscreenCanvas`
Chrome 69, Firefox 105, **Safari 17**; the mobile browsers are recorded as mirroring their desktop versions. caniuse
agrees on the desktop versions and marks Safari 16.2-16.7 partial. I could not confirm the first Firefox for Android
version independently (caniuse shows only its current version, 158), so that number is MDN's "mirror" alone.

## 2. Decisions

**Chromium (Edge, Chrome): the page path, unchanged.** A worker's compile stalls it (measured) and its page compiles
are already in the background with a shared cache. Nothing to gain, something to lose.

**Firefox: the page path for now; the full move is deferred to its own issue, not rejected.** The drawing must move for
Firefox to gain anything (measured: no shared cache, and a page canvas drawing WebGL stalls during a worker's
compile), and that is the largest rebuild of the door since ADR-0001: `voyage.js` (107 KB) and the engine's 2D canvas
both run in the worker, every page touch in them (`document`, `innerWidth`, `devicePixelRatio`, `document.hidden`,
the chores' `drawnIn`, the live door's hand-off) goes behind messages, a module worker and a `Worker` factory join
the interface Orbit copies, and every flight is verified pixel-identical against the page path. Two to three builds
(PERFORMANCE.md's estimate) against the 15,000 unaudited-line ceiling, for a gain the late lean door and the
under-the-ring compiles already contain in part (ring 8.7 s and 15.4 s on the two machines; target 4 s). Firefox for Android
has only just gained the capability, so no phone gains. Section 6 keeps the outline so the work is not designed
twice. Question 2 asks the owner whether to fund it now instead.

**Safari: the pre-warm in a worker, if and only if the page's own compile is measured to stall the page (M1).** Measured
on the device the issue came from: a worker compiles each program in ~300 ms while the page's frames stay where they
were idle, and the same source then compiles on the page in 4-14 ms. So a worker can take the cold compile off the
page and leave the page a warm one, with no drawing moved and no change to a flight's pixels. What is not measured is
whether the cold compile on the page ever stalled it: Safari reports background compiles, and the only page-loop
figure on record is a desktop's "frame gaps 20 ms around the rich compile". The `stall` test (`/tests/`, pick
"stall") answers it in a minute on the phone. If the page stands still for the compile's length, build section 4; if
the gaps stay within two frames, Safari has no freeze to fix, the pre-warm is not built (dead code in a folder Orbit
copies), and the painted quick sign-out is question 1's to answer.

**The pre-warm's rule is a capability, not a timing, with one family tell.** It runs when all of these hold: the host
gave a `warmWorker` setting (section 3); `Worker` and `OffscreenCanvas` exist; the GPU gate accepted the page and
says `parallel` (a page that compiles on its own thread gains nothing from a worker's compile: Firefox, measured);
`navigator.userAgentData` is absent; the worker answers that it has WebGL2; not under save-data. The `userAgentData`
check is the one place the folder tells a browser family apart, by a feature it ships rather than its name: a
browser with client hints (Chromium and its relatives) shares its program cache already and stalls on a worker's
compile (Edge, measured), and no measurement can tell that without causing the stall it is there to avoid. A measured
rule was tried on paper and rejected: compiling the probe in the worker and timing it on the page would cost
Chromium one stall of 100-300 ms under the ring on every visit, and its shared cache would answer "warmed" anyway.
`CAPABILITIES.md`'s "no browser is named in the rules" stands for the level ladder; this ADR records the exception
and its reason.

**The portrait star cloud is placed for the screen's shape (#74), on every path.** `voyage.js` carries a copy of the
landscape resting point (`REST`, `engine.js` `PATH[3]`); the docs' flight on a portrait screen rests at `PATH_TALL[3]`,
1.08 units away, so it passes few of the close stars. The copy goes: the engine, which already knows the screen's shape
(`tallScreen`), hands the world a function of the screen's size that returns the resting point, and the world makes
its star cloud about that point and remakes it (never mid-flight) if the shape has changed by the next flight.

**The quick sign-out is a timing policy, not a compile (question 1).** ADR-0002 12d's leisure delay exists so the
fitness verdict, which is never remembered (decision 7), is not taken on a busy page and a fit phone called unfit
for the whole visit. Shortening it where compiles are in the background is a trade the owner makes, below.

## 3. Interface changes (README, `assets/door/`)

Only if section 4 is built; nothing changes otherwise. All of it is optional for a host: a host that passes nothing
gets the door exactly as it is today, so Orbit's import merge request needs no change to keep working.

- `settings.warmWorker`: `() => Worker | null`, absent by default. A host that wants the pre-warm makes the worker
  itself, because the folder may neither read its own location nor use `import.meta.url` (the lint): the site passes
  `() => new Worker("assets/door/warm-worker.js")`; Orbit, when it takes it up, `() => new Worker(new URL("./warm-worker.js",
  import.meta.url))` from its own code, which Vite rewrites for the build. Absent, no worker is ever made.
- `flags.warm`: `"off"` (host reads `?warm=off`: no pre-warm, the page compiles as today) and `"force"` (`?warm=force`:
  the pre-warm runs wherever a worker has WebGL2, whatever the gate's `parallel` and whatever the family tell says; for
  measuring the other browsers, as `?mainthread` is for the Firefox path).
- A new file in the folder, `warm-worker.js`: a classic worker (no imports, no `type: "module"` needed), so it stays
  self-contained and Orbit's copy works as a static file.
- Console (via `note`): `flight: warmed in a worker in N ms (N programs)`, or `flight: warm off: <why>` (`no worker given`
  is not said: that is the default). The existing `flight: shaders compiled in N ms` then shows what the page paid.
- README's CSP paragraph: `worker-src 'self'` is now asked of a page whose host passes `warmWorker` (the site's pages
  already carry it).

## 4. Build notes: the pre-warm (Safari), built only after M1 says the page stalls

The shape is `tests/worker.js`, already proven on three browsers: sources by message, never an import.

1. `assets/door/warm-worker.js` (new). On the first message `{ pairs: [[vertSrc, fragSrc], ...] }`: a 4x4
   `OffscreenCanvas`, `getContext("webgl2", { antialias: false, alpha: false, depth: false, stencil: false })`; none →
   `postMessage({ error: "no WebGL2 in a worker here" })`. Else compile every pair and link, in the order given; where
   `KHR_parallel_shader_compile` is there, start them all, then poll `COMPLETION_STATUS_KHR` every 10 ms (never wait
   synchronously on a link: that held the GPU's process, Edge, 8 Oct); a program that fails to link is reported in
   `error` and the rest still done. Each linked program is drawn once (a full-screen triangle, every uniform at its
   default, into the 4x4 canvas) and one pixel read back, so the pipeline state is made too: it is the draw, not the
   link alone, that warmed the page in the test. Then `postMessage({ done: n, ms })`. Nothing else: no fetch, no
   texture, no second message. (Memory on a phone: one tiny context and five programs, a few MB at most, freed when
   the page terminates the worker, before the page's own compile; #76's budget is the maps, which never leave the page.)
2. `fitness.js` or a small `warm.js` in the folder: `warmAside()` → the rule in section 2, decided once a page, said
   once on the console when it is off and a host gave a worker. `flag("warm")` read as the other flags are.
3. `voyage.js`: export the pairs the page will compile, exactly as `createVoyage` compiles them, byte for byte and in
   order: `[VERT, SCENE]`, `[VERT, richOnly ? OVER_RICH : OVER]`, `[VERT, POST]`, `[VERT, GAL]`, `[STARV, STARF]`
   (Safari hashes a source without its comments but with every character of code, `tests/common.js`; a source that
   differs by a space is a cold compile). `richOnly` is `liveDoor() && theDoorWeight() === "rich"`, known after the
   probe, so the pairs are asked for where `engine.js` `warm()` asks them today, after `first`. The rich flight Earth
   (`compileRich`) and the live door's own programs stay as they are: `?door3d` only.
4. `engine.js` `warm()`: where `warmAside()`, before `make()`: `const w = settings.warmWorker()`; post the pairs; wait for
   `done`, `error`, the worker's `error` event, or **1500 ms** (a cap, not a measurement: the page then compiles cold as
   today, and the console says `flight: warm off: no answer in 1500 ms`); terminate the worker; then `make()` as now.
   `destroy()` while waiting terminates it and makes no world (as today's `destroyed`). The gate's context is made
   before the worker starts (the site asks `gpu()` in `showDoor`), so the one context creation still lands where
   ADR-0002 put it. The ring on a first visit waits for `compiledAll` within 9000 ms (`main.js`); the worker's ~1 s plus
   the page's warm compiles fit inside it.
5. `main.js`: `FLAGS.warm` from `?warm=off|force`; `createDoor({ ..., warmWorker: () => new Worker("assets/door/warm-worker.js") })`.
   `sw.js` needs nothing: the code cache is "always fresh".
6. `README.md` (folder): section 3. `tools/ci/lint.sh`: the self-contained check already covers `assets/door/*.js`;
   `warm-worker.js` must pass it as written (no `location`, no `import.meta.url`, no outside address).
7. `CAPABILITIES.md` "A worker's compile" and PERFORMANCE.md "The worker, measured": add the 22 Oct Safari table and
   replace "Edge, Chrome and Safari keep the page path" with this ADR's split. The session that builds also notes on #43
   that its "Why" misstates Safari's compiler (section 1), and files the Firefox move as its own issue (section 6).

### Tests the spec-only writer should write (behaviour, never timings)

Node, through `assets/door/index.js` alone, on the stub page (`tools/ci/door-stub.mjs`), one fresh process per case
as `fit-skip-test.mjs` does; the worker is a fake class passed as `warmWorker`, recording what it was posted and
answering what the case says:

- W1 no `warmWorker` setting, gate accepted and `parallel`: no worker made; the gate context's `compileShader` calls
  happen as today. Control for everything below.
- W2 setting given, gate `parallel`, no `navigator.userAgentData`: the worker is posted one message; its `pairs` equal,
  pair for pair and byte for byte, the `[vertex, fragment]` sources the page then compiles on the gate's context, in
  that order; no `compileShader` on the gate's context before the fake posts `done`; `terminate()` called after it;
  console has `flight: warmed in a worker`.
- W3 the fake posts `error` / fires its `error` event / never answers (virtual clock past 1500 ms): the page compiles
  anyway, once, and `terminate()` is called; console has `flight: warm off:`.
- W4 the fake answers `{ error: "no WebGL2 in a worker here" }`: as W3, with that reason in the line.
- W5 gate `parallel` false (a stub reporting no `KHR_parallel_shader_compile`): no worker. `flags.warm: "force"`: a
  worker despite it.
- W6 `navigator.userAgentData` defined on the stub: no worker. With `warm: "force"`: a worker.
- W7 `flags.warm: "off"`: no worker, no console line about warming.
- W8 gate refused (software renderer, no `gpu: "force"`): no worker, and no shader source leaves the page.
- W9 save-data stubbed true: no worker made at the speculative warm.
- W10 `journey.destroy()` while the fake has not answered: `terminate()` called, no `compileShader` after it, no world.
- W11 the pairs posted include `[VERT, OVER_RICH]` and not `[VERT, OVER]` when `door3d` is set with a rich weight
  (`?door3d&rich` and a probe stub that reports level 2), else `[VERT, OVER]`.

Browser (Playwright, headed Firefox under Xvfb, software GL, the shape of `tools/ci/journey.mjs`): `/?gpu=force&fit=skip&warm=force`:
the real `warm-worker.js` loads under the page's own CSP (no CSP violation in the console); the console then carries
either `flight: warmed in a worker` or `flight: warm off: no WebGL2 in a worker here` (software GL in a worker is the
runner's business, not the test's), and in both cases `flight: shaders compiled` follows and the gate's flight runs
(`body.showwarp` then `body.bare`). The point is that the page never waits on a worker it cannot have. `csp-test.mjs`:
`index.html` keeps `worker-src 'self'`.

## 5. Build notes: the portrait star cloud (#74), unconditional, first

1. `engine.js`: `createVoyage(canvas, { restFor: (W, H) => (tallScreen(W, H) ? PATH_TALL : PATH)[3] })`; nothing else
   of the engine changes. (`PATH`, `PATH_TALL`, `tallScreen` stay in `engine.js`; `voyage.js` cannot import them, the
   engine imports it.)
2. `voyage.js`: delete `REST`; `galaxyStars(n, rest)` takes the point (exported, pure, for tests); `makeStars()` calls it
   with `restFor(W, H)` and remembers the point the stars were made for; `resize()` that lands on a different point
   marks them stale; `warm()`'s star chore and `reset()` (the start of a flight, before its first frame) remake stale
   stars: give the old buffers back (`giveBack("Buffer")`, `giveBack("VertexArray")`), make anew. Never inside `draw()`.
3. `docsRest()` and the docs sky pictures (`tools/docsky.cjs`) are unchanged: they already read the shape.

Tests (Node, same harness):

- P1 `galaxyStars(n, rest)` is deterministic: two calls with the same arguments give identical arrays.
- P2 with `rest = PATH[3]`, at least 5% of the stars lie within 0.23 of it and under 1% within 0.23 of `PATH_TALL[3]`;
  with `rest = PATH_TALL[3]`, the reverse. The two outputs differ only in the stars of that cloud: every star within
  0.23 of neither point is identical in both.
- P3 through the engine: a world warmed on a 400x800 stub page uploads star positions (the `bufferData` the fake gl
  records) whose cloud is about `PATH_TALL[3]`; on 1280x800, about `PATH[3]`.
- P4 a world warmed landscape, then resized to portrait before a flight: by the flight's first frame a new
  `bufferData` carries the portrait cloud and the old buffers were deleted; the remake never happens between a
  flight's `start` and its end (a flight on the virtual clock sees one star buffer throughout).
- P5 the docs sky's portrait picture test (`docs-sky-portrait-test.mjs`) still passes: the rest point it reads did not move.

## 6. Deferred, in outline: the drawing in a worker for Firefox (its own issue)

Both canvases handed over (`#warp` 2D and `#warpgl`), the engine and the world running in a module worker as the
modules they are, behind one page adapter for what they read of the page (size, pixel ratio, hidden, animations); the
page posts `resize`, `start(profile, at)`, `stop`, `clear`, `warm({ prove })`, `visible`; the worker posts `verdict`,
`ready`, `firstSecond`; the journey's clock stays on the page and the beats with it. The live door (`?door3d`) is not
carried: level 0 under the worker path. Verified pixel-identical against the page path by pinned flights
(`tools/ci/pin-test.mjs`) in Edge first, switched on for Firefox only (`gpu().parallel === false` with the worker able),
kept behind `?draw=worker|page`. Memory: the maps move to the worker's context, so the page's budget on a phone falls,
not rises. The unaudited-line count makes this its own batch after an audit.

## 7. Rejected

- **Compile in a worker, keep drawing on the page, on Firefox:** measured no shared cache; the page would pay twice.
- **Move the drawing everywhere:** Chromium is already smooth and stalls on a worker's compile; Safari has the cheaper
  lever; only Firefox gains, and it is deferred with reasons.
- **A measured rule in place of the family tell:** costs Chromium the very stall it avoids, every visit (section 2).
- **Loading the worker from a Blob URL to avoid a file:** `worker-src 'self'` refuses `blob:`; a file in the folder
  is also what Orbit's copy can serve.
- **A remembered "warmed" verdict in localStorage:** nothing is remembered (ADR-0002 decision 7), and Safari's cache
  is the driver's, not ours to predict across visits.

## 8. What the owner measures on a real device

- **M1, before the Safari build:** `/tests/`, pick "stall", on a phone (plugged in, power saving off, twice) and
  on a desktop with Safari: the three gap lines and the eye's verdict on the spinner. A stall of the compile's length funds
  section 4; gaps within two frames close the Safari half with the numbers on #43.
- **M2, after it (if built):** the real door on the phone with Safari's Web Inspector from a Mac: the console lines
  `flight: warmed in a worker in N ms`, `flight: shaders compiled in N ms` (expected tens of ms where it was hundreds),
  `flight: first second N frames, worst N ms`; then the same with `?warm=off`. The eye on the reveal and on the gate's
  flight, both ways.
- **M3, Firefox, unchanged by this ADR:** nothing to measure until section 6 is funded.

## Questions for the owner

**1** The painted quick sign-out: shorten the leisure proof where the page's compiles are in the background?
  **1a** keep 4 s / 2 s as ADR-0002 12d set them.
  **1b** (recommended) where `gpu().parallel` is true, prove as soon as the world is made and the reveal is drawn in
  (`later` with `after` near 0, which still waits for `drawnIn()`), keeping the delay where compiles stall the page
  (Firefox: the proof's first frames finish the shaders there, and that stall is better late). Risk: a verdict taken on
  a busier page can call a fit machine unfit for the visit; `drawnIn()` and the chores' `quiet()` are the guard, and a
  wrong verdict costs one visit, nothing remembered.
  **1c** prove at once everywhere.
**2** Firefox's full move (section 6): defer to its own issue after M3 (recommended), or fund it now in M3 as its own
  batch?
