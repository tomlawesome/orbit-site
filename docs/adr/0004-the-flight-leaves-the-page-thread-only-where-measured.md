# ADR-0004: The flight's compiles leave the page's thread only where that is measured to help

**Status:** Accepted (2026-10-22). Questions 1 and 2 answered 1a and 2a; measurement M1 taken: no Safari stall, so
section 4's pre-warm is not built, and the door folder's interface is unchanged.
**Amended:** 2026-10-27, section 6a: the detailed design of section 6 (#85), for the owner's review before any code;
questions 3 to 6 answered. 2026-10-28, section 6b: the install and info worlds in a worker (#93), the detailed design
for the owner's review before any code; questions 6b-1 to 6b-4 open.
**Date:** 2026-10-22
**Relates to:** #43 (with #74 folded in: the portrait star cloud); #85 (the flight in a worker); #93 (the site's
worlds in a worker); ADR-0001 (the folder Orbit copies); ADR-0002
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
twice. Deferred to #85, after M3 (owner, 2026-10-22, question 2 answered 2a).

**Safari: the pre-warm in a worker, if and only if the page's own compile is measured to stall the page (M1).**
*Outcome (2026-10-22): M1 on a real phone, twice, showed no stall (rich compile 550 and 398 ms, frame gaps 29-34 ms
before and after, the spinner turning throughout); the pre-warm is not built. Sections 3 and 4 stand as the record of
what it would have been.* Measured
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
for the whole visit. Kept as it is (owner, 2026-10-22, question 1 answered 1a): the verdict is taken once a visit and
never remembered, so one unlucky early verdict paints every flight that visit, while a sign-out within 4 s of arriving is
rare outside a review bed. Revisit if a phone shows a painted descent after the world was made and the page had been
quiet for over a second: then prove on "quiet", with 4 s as the cap rather than the floor.

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
- P2 with `rest = PATH[3]`, at least 5% of the stars lie within 0.23 of it and less than half that share within 0.23
  of `PATH_TALL[3]`; with `rest = PATH_TALL[3]`, the reverse. (The disc is dense about the landscape point on its
  own: about 2.3% of the stars lie near `PATH[3]` even with the cloud moved away, so a fixed 1% bound was wrong.)
  A star's place is read from `galaxyStars`'s `P`, 8 floats a star (x, y, z, w for each end of its streak). The two
  outputs differ only in the stars of that cloud: every star within 0.23 of neither point is identical in both.
- P3 through the engine: a world warmed on a 400x800 stub page uploads star positions (the `bufferData` the fake gl
  records, 8 floats a star) whose cloud is about `PATH_TALL[3]` by P2's measure; on 1280x800, about `PATH[3]`.
- P4 a world warmed landscape, then resized to portrait before a flight: by the flight's first frame a new
  `bufferData` carries the portrait cloud and the old buffers were deleted; the remake never happens between a
  flight's `start` and its end (a flight on the virtual clock sees one star buffer throughout).
- P5 the docs sky's portrait picture test (`docs-sky-portrait-test.mjs`) still passes: the rest point it reads did not move.

## 6. Deferred, in outline: the drawing in a worker for Firefox (#85, after M3)

Both canvases handed over (`#warp` 2D and `#warpgl`), the engine and the world running in a module worker as the
modules they are, behind one page adapter for what they read of the page (size, pixel ratio, hidden, animations); the
page posts `resize`, `start(profile, at)`, `stop`, `clear`, `warm({ prove })`, `visible`; the worker posts `verdict`,
`ready`, `firstSecond`; the journey's clock stays on the page and the beats with it. The live door (`?door3d`) is not
carried: level 0 under the worker path. Verified pixel-identical against the page path by pinned flights
(`tools/ci/pin-test.mjs`) in Edge first, switched on for Firefox only (`gpu().parallel === false` with the worker able),
kept behind `?draw=worker|page`. Memory: the maps move to the worker's context, so the page's budget on a phone falls,
not rises. The unaudited-line count makes this its own batch after an audit.

## 6a. Detailed design: the flight drawn in a worker on Firefox (#85)

Written 2026-10-27, after gate 1 was measured on the owner's machine (desktop Firefox, private window; the numbers
are on #85): the page thread compiles the install/info world 956 ms, the flight 1839 ms, the docs' galaxy 170 ms;
drawing is fast (the flight's fitness frame 8 ms, a dive's first second 51 frames); the door is ready at 10.8-11.2 s
against 4 s, and of the chores' 10.0 s only 3.3 s ran: 2.4 s held for the reveal, 3.4 s resting, 0.9 s waiting to
start. So the lag is page-thread compiles plus the holds and rests that exist only to keep those freezes off the
opening. Section 6's outline stands; this section fills in what it left open. Nothing here changes a decision of
sections 1 to 5; where this design leans on a browser fact, the fact was read from `mdn/browser-compat-data` on
2026-10-27 and is quoted with its version. Owner decisions taken on #85 before this was written: go straight to the
full move (no cheaper fix to the rests first); Firefox only, behind `?draw=worker|page`, pixel-identical to the page
path; Chrome, Edge and Safari keep the page path.

**The standard pattern** is the one section 6 names, the render thread off the UI thread: the page keeps the
timeline, the hooks and the body classes and posts the beats; a dedicated worker owns both canvases (handed over with
`transferControlToOffscreen()`) and runs the engine and the world as the modules they are, on its own
`requestAnimationFrame` (in a dedicated worker: Chrome 69, Firefox 99, Safari 16.4). Between the two, a request and
reply protocol over `postMessage` with correlation ids and a sequence number (the usual shape for a worker RPC), so a
late reply for an ask that was superseded changes nothing. PERFORMANCE.md's sketch posted the state every frame
(time, scroll, pointer, size); this design does not: the flight takes no pointer and its clock is its own, so the
page posts only what changes (a start, a stop, a size, a visibility), and the worker draws by its own frames.

### 6a.1 What moves, what stays, and the scope

Moves into the worker: `engine.js` (the 2D canvas, `#warp`), `voyage.js` (the WebGL world, `#warpgl`), and with
them `timeline.js`'s none (the beats stay on the page), `chores.js` (a second instance, the worker's own queue),
`upload.js`, `fitness.js`'s `frameCost`, `stars.js`. Both canvases go together, as section 6 says, because the 2D
layer (the limb, the props, the bloom) and the world beneath it are drawn in one frame today and must present in one
frame still; two canvases drawn in one worker task present together, two drawn on two threads need not.

Stays on the page: `journey.js` (the clock, the beats, the hooks, the body classes, `later`), `dawn.js`, the
site's `main.js`, the chores' page queue (the install world's uploads and bakes still run there), the GPU gate's
verdict (`gpu()`: decided on the page as ADR-0002 placed it, from the page's one context), and the live door, which
is level 0 under the worker path (`door3d` is not posted to the worker).

**Two contexts on the worker path, not one.** ADR-0002 keeps the gate's context and hands it to the flight. A
canvas that already has a context cannot be handed to a worker (`transferControlToOffscreen()` throws), so on the
worker path the gate's context stays on the page, idle (so `gpu()`, `compilesAside()` and the site's own worlds read
as today), and the world's context is made in the worker on the transferred `#warpgl`, with no caveat flag and no
renderer check (the page's gate already judged). The GPU memory that matters (the maps, #76) is the worker's; the
page's gate context holds nothing. The page path is unchanged: one context, as ADR-0002 says.

**The install and info worlds (`assets/js/world.js`, `install.js`) are out of #85's scope, and are the next
issue.** Reasons: they are the site's own files, not the door's, so their move changes no interface Orbit copies
and need not sit in the batch that does; #85 is the proof of the pattern (adapter, protocol, fallback, pixel
verification), which that move reuses from `page.js` and the worker's shape with its own worker file; and the
line budget (6a.9) is 2-3 batches already. The honest consequence, said now: after #85 alone the page thread on
Firefox still compiles the install/info world (956 ms once; the two console lines are one world worn two ways) and
bakes its sky, so `compilesAside()` stays false there and the ring still waits for `compiledAll` on every visit
(shorter by the flight's and the galaxy's 2.0 s and their rests); the 4 s target needs the follow-up too. The
session that builds batch 1 files that issue, labelled as this one's successor, with the pieces that carry over
named (6a.2's adapter, 6a.3's message shape, 6a.4's rule and fallback).

### 6a.2 The page adapter (`assets/door/page.js`)

One module, imported by the modules that move, through which every touch of the page goes. On the page it reads
the real thing; in the worker, the values the page last posted. Found by reading `engine.js`, `voyage.js`,
`chores.js`, `fitness.js` and `upload.js` for `window`, `document`, `innerWidth`, `devicePixelRatio`, `Image`,
`requestAnimationFrame`, `addEventListener` and `style`:

| The adapter's surface | On the page | In the worker (fed by) |
| --- | --- | --- |
| `size()` → `{ W, H, dpr }` (CSS px; dpr capped at 2 by the callers as today) | `innerWidth`, `innerHeight`, `devicePixelRatio` | the last `size` message |
| `css(canvas, W, H)`: the canvas's CSS size | `canvas.style.width/height` | no-op: the page styles both canvases itself on every `size` |
| `hidden()`, `whenVisible()`, `onVisible(fn)` | `document.hidden`, `visibilitychange` | the last `visible` message; its arrival |
| `frame(fn)`, `cancelFrame(id)` | `requestAnimationFrame` | the worker's own `requestAnimationFrame` |
| `picture(url)` → the Earth's picture for `drawImage` (`engine.js` `askEarth`, `earthF`) | `new Image()` as today (its pixels unchanged) | `fetchOnce` + `createImageBitmap(blob)`; the fade copy on an `OffscreenCanvas` instead of `document.createElement("canvas")` |
| `canvas(w, h)`: a scratch canvas | `document.createElement("canvas")` | `new OffscreenCanvas(w, h)` |
| `gate()`: the canvas the world's context is made on, and whether to check it (`fitness.js` `gpu()`) | `document.createElement("canvas")`, caveat flag, renderer check, as today | the transferred `#warpgl`, no caveat, no check |
| `mount(canvas, under)`, `unmount(canvas)` (`voyage.js`: `#warpgl` put beneath `#warp`, removed on retire) | `insertBefore`, `remove()`, `id`, `aria-hidden` | no-ops: the page made and placed `#warpgl` before handing it over |
| `baseURI()` (`chores.js` `keyOf`) | `document.baseURI` | the page's, posted in `hello` |
| `note(line)`, `verdict(line)` (`chores.js` `note`, `fitness.js` `sayVerdict`) | `console.info` as today | posted to the page as `note`, printed there, so every console line reads as it does today and every test that reads the console holds on both paths |
| `fonts(list)`: the faces the pens write with | nothing: the page's stylesheet has them | `self.fonts.add(new FontFace(family, url(...), { weight }))` and `load()` before the first frame (`WorkerGlobalScope.fonts`: Chrome 69, Firefox 105, Safari 15) |

`page.js` is installed once per thread: the page's default needs no call; the worker calls `setPage(...)` from the
`hello` message before importing nothing else of the door (the modules read `page` lazily, at call time, so import
order does not matter). `settings.js` is configured in the worker from the same message (`image` resolving to the
absolute URLs posted, `flags`, `typingWait: 0`, `settle`); `capability.js` is not imported there (the live door is
not carried) and `localStorage` is never touched in the worker.

**Fonts: the one place the two threads would differ.** `engine.js` writes names on the 2D canvas with
`'JetBrains Mono'` (three `fillText` calls: a household passing, `penHome`; the chart's constellations and their
labels), under a transform, with `letterSpacing` (on an `OffscreenCanvas` 2D context: Chrome 99, Firefox 115,
Safari 18.4). A worker starts with no font loaded, and the page's faces are not shared with it, so without a font
the worker draws those names in the engine's fallback monospace: not pixel-identical. The site takes its mono from
Google Fonts, whose file the page cannot hand on (the page may not fetch it under `connect-src 'self'`, cross-origin
stylesheet rules are unreadable, and the folder may name no outside address). So the worker path requires the host
to give the door a font it can load (`settings.fonts`, 6a.6), and for the pixels to match, the page must use the
same file: the site self-hosts JetBrains Mono (question 3). A host that gives `drawWorker` and no `fonts` gets the
page path, with a console line saying why.

### 6a.3 The messages

Every message is a plain object with a `type`; asks that expect an answer carry an `id` (a counter), and the three
that drive the engine carry `seq` (another counter, bumped by every `start`, `stop` and `clear`). The page adapter
(`remote-flight.js`, 6a.4) keeps a map of pending ids; a reply whose id is not pending is dropped; a `frame` whose
`seq` is not the current one is dropped. Transferables are marked.

Page to worker, in the order they first occur:

| Message | Fields | When |
| --- | --- | --- |
| `hello` | `flags` (the host's, without `door3d`), `images` (`{ path: absolute URL }` for every key of `voyage.js` `pictures()` and `dawn/dawn.webp`, resolved on the page with `new URL(image(path), document.baseURI)`, because a relative URL in a module worker resolves against the worker's own file, not the page), `fonts` (`[{ family, weight, url }]`, absolute), `baseURI`, `settle`, `size`, `hidden` | first, before anything else |
| `canvases` | `warp`, `warpgl` (both transferred `OffscreenCanvas`), `size` again (a resize may have landed between) | after `hello`; the page made `#warpgl` (id, `aria-hidden`), put it beneath `#warp`, and styled both to `size` |
| `size` | `W`, `H`, `dpr` | every `resize` event (the page also restyles both canvases); the worker calls `engine.resize()`, which as today acts only mid-flight (`prime` sizes at a start) |
| `visible` | `hidden` | every `visibilitychange` |
| `warm` | `id`, `kind` (`"warm"` or `"warmDocs"`), `prove` | `journey.warm` / `warmDocs` |
| `start` | `seq`, `profile` (the wire form, below), `at` (pins only) | the warp beat; `engine.start` |
| `stop`, `clear` | `seq` | `engine.stop` / `clear` (a `reset`, a flight superseded) |
| `destroy` | none | `journey.destroy()`: the worker closes itself; the page `terminate()`s it anyway |

Worker to page:

| Message | Fields | When |
| --- | --- | --- |
| `up` | `ok`; `why` when not (`no WebGL2 in a worker here`, `no float colour buffers`, `the 2D context has no letterSpacing`); `renderer` | after `canvases`, once both contexts are made and the fonts loaded |
| `note` | `line`, `kind` (`"note"` or `"verdict"`) | every console line the moved modules would have printed (`flight: shaders compiled in N ms`, `flight world: on (frame N ms)`, `flight: first second N frames, worst N ms`, `chores at …`) |
| `compiled` | `ok` | the world's shaders done (or not): `journey.compiled()` resolves on it |
| `warmed` | `id`, `ok` | the ask with that id has settled (whatever it settled to) |
| `frame` | `seq`, `world` (drawn with the WebGL world or painted) | the first frame of that start is committed (a pinned start: after its one frame); the page sets `#warp`'s `data-drawn` to `seq`, which the tests wait on |
| `lost` | none | the world's context was lost in the worker (said for the console; the worker's world handles it as the page's does today: dead, replaced by the next `warm`) |
| `dead` | `why` | the worker cannot go on (an exception outside a frame); the page falls back (6a.4) |

**The profile's wire form** (`engine.js`: `wireProfile(P)`, `unwireProfile(w)`, pure, tested). A profile carries
three functions (`speed`, `atm`, `duskMix`) and structured clone drops functions, so the wire form names them:
`base: "UP" | "DOWN"` (`DOWN_DAWN` is `DOWN` without `palTo` and `duskMix`, and `descentFrom` spreads `DOWN_DAWN`,
so every descent is `"DOWN"`), chosen by identity (`P.speed === UP.speed`, and so on); every other field is data
and goes as it is: `dur`, `vpX`, `vpY`, `a0`, `a1`, `K`, `rev`, `rate`, `skip`, `skipTu`, `tint`, `ending`,
`pal`, `palTo`, `props` (plain: `PROPS_UP`'s shape, `homeProps`'s, `mirrored`'s) and `chart` (`rect` and
`geometry`, which the site gives as getters: they are read once, at `start`, which is after the flight's `ready`
has settled, so they are there). A profile whose curves are neither `UP`'s nor `DOWN`'s cannot be posted: `fly`
throws a named error (a host's programming error, found in its tests), rather than drawing something else. The
site's four flights (`journeys.js`) and the demo's are all `UP`'s curves with data overrides.

**Clocks.** The journey's clock stays on the page with its beats; the worker's engine runs on the worker's
`performance.now()` from its `start`, so a flight keeps real time there. On the worker path the journey's clock
keeps real time too (`clock.stalls(false)`; the remote engine reports `drawingWorld` false): the stall cap
existed so a world drawing slowly on the page's thread paused the beats rather than skipping them, and a world in
a worker cannot stall the page. The climb's 8 s hold for `ready` (`holdAt`) is unchanged: `ready` is the page's
promise, settled by `warmed`.

**Ordering and the four cases section 6 asked about.** Messages between one page and one worker arrive in order,
so `canvases` never precedes `hello`, and a `size` posted before `canvases` is carried in it. *A lost context*: in
the worker, on the transferred canvas; `voyage.js` marks the world dead as today and the next `warm` remakes it on
the restored context; the worker listens for `webglcontextlost`/`webglcontextrestored` on the `OffscreenCanvas`
(Chrome 99, Firefox 125; Safari never, and Safari is not on this path) and, as the backstop for Firefox 105-124,
reads `gl.isContextLost()` at the top of every frame and every chore. *A hidden tab*: `visible` feeds
`page.hidden()`, so the fitness test waits for the tab as today (`whenVisible`), `compiledWithin` counts only seen
time, and `calibrate` skips; the worker's own `requestAnimationFrame` is throttled with the tab as the page's is.
*A resize*: `size`, above; a resize mid-flight re-seeds the stars in the worker as the mockup's rule has it; the
world's targets are reallocated there as today. *A stale round*: inside the worker the engine's own `round` guard
(#89 F) is unchanged; across the boundary, an id not pending or a `seq` not current is dropped, and after
`destroy()` or a fallback the adapter is `gone` and drops everything.

### 6a.4 When the worker path is taken, and the fallback

`journey.js` no longer makes its engine at `createJourney` (today `createFlight` takes `#warp`'s 2D context at
once, and a canvas with a context cannot be handed over). The engine is made at the first need (`warm`, `warmDocs`,
`fly`, `descend`; the site's first is `warm` at first light, after the gate has run, which is where ADR-0002 wants
the gate's one context made), and `destroy()` before any need destroys nothing. The choice, `drawnAside()` in
`fitness.js` beside `compilesAside()`, decided once a page and said once on the console (`flight: drawn in a
worker` / `flight: drawn on the page: <why>`, the latter only when the host gave a worker):

- `flags.draw === "page"`: the page path. `"worker"`: the worker path wherever the host gave `drawWorker` and
  `fonts`, whatever the rule below says (for the pixel tests in Chromium and for measuring); without them, the page
  path and the line.
- Else, all of: the host gave `drawWorker` and `fonts`; `gpu()` accepted the page and `parallel` is false (the
  measured tell: Firefox compiles on the page's thread, section 1); `navigator.userAgentData` is absent (the family
  tell of section 2, for the same reason it is there: Chromium on a software renderer also reports no parallel
  compile, and Chromium keeps the page path by decision); the gate was not forced (`gpu: "force"` is a test bed on
  software GL: every existing live test keeps the page path untouched, and the worker is asked for by `draw=worker`
  alone); `Worker`, `OffscreenCanvas` and `HTMLCanvasElement.prototype.transferControlToOffscreen` exist; not under
  save-data. Section 6's "`gpu().parallel === false` with the worker able" is this rule with the tell and the
  force exclusion added, each for a stated reason.

`remote-flight.js` (new, page side) returns the very surface `createFlight` returns (`compiled`, `drawingWorld`,
`warm`, `warmDocs`, `start`, `stop`, `clear`, `destroy`, `resize`, `running`), so `journey.js` holds one engine
whichever it is. It makes the worker through `settings.drawWorker()` (the host makes it, because the folder may
neither read its own location nor use `import.meta.url`: section 3's `warmWorker` shape), posts `hello`, makes and
places `#warpgl`, transfers both canvases, and waits for `up`.

**Fallback** (one mechanism, used for every failure, tested once): `fallBack(why)` replaces `#warp` with a fresh
`<canvas>` carrying the same id and attributes (the transferred element can never again give the page a context),
removes `#warpgl` (the page path's `createVoyage` places its own, the gate's canvas, as today), terminates the
worker, makes `createFlight` on the new canvas, replays the pending asks (`warm`/`warmDocs` with their `prove`,
resolved from the page engine's own promises; `compiled()` becomes the page engine's), and says
`flight: drawn on the page: <why>`. A flight under way when the worker dies is picked up where it was: the page
engine is started with the same profile and `skip` set to the journey time elapsed, so it goes on painted from the
next frame rather than ending blank. Triggers: the worker's `error` event; `up` with `ok: false`; `dead`; and,
under the automatic rule only, no `up` within `WORKER_WAIT` (5000 ms, `COMPILE_WAIT`'s figure, a cap not a
measurement: past it the page compiles as today and the console says `no answer in 5000 ms`); under
`draw=worker` there is no cap, so a slow runner cannot turn a forced worker test into a page-path pass. A lost
context in the worker is not a fallback (6a.3). The README says a journey may replace the canvas element it was
given, so a host keeps no reference to it (the site reads `#warp` once, at `journey()`).

### 6a.5 Holds and rests: dropped on the worker path, kept on the page path

The page path keeps every one of these as it is. On the worker path:

| Hold or rest (where) | Why it exists | Worker path |
| --- | --- | --- |
| The flight's world made as a `"compile"` chore, and the galaxy's as another, each a frame plus 20 ms after the last (`engine.js` `warm`, `voyage.js` `galaxy`; `chores.js` `end`) | each compile freezes the page, so they are spaced and put under the ring | **dropped**: in the worker `compilesAside()` reads true (no page, nothing to freeze), so the world is made at once on `up`, its galaxy with it, back to back on the worker's thread |
| The reveal hold (`chores.js` `open`: 2.4 s measured): the flight's star buffers, warm-up draws, fitness test and, bar the soft bands, its uploads wait for `drawnIn` | they touch the page's thread and the GPU under a reveal still being painted | **dropped** for the flight's chores: the worker's queue is opened at `hello` (`openChores()` there), nothing of the flight waits for the page's reveal. The page's queue is unchanged for what stays on the page |
| The rests between chores (a frame, plus up to 20 ms; `resting` 3.4 s measured) and the one-band-a-frame pacing of the uploads (`upload.js`, `openSoft`) | whatever is moving on the page keeps moving | **dropped**: `chores.js` gains `pace("none")`, under which `end` schedules the next chore at once and `pump` ignores the opening and the typing wait, and `uploadBanded` puts a picture on whole (the `whole()` path it already has). The measures keep their 200 ms rest: they time the drawing, and a chore beside them is still not the drawing's time |
| The ring's wait for `compiledAll`, 8 s cap, at least a lap, on every visit (`main.js` `waitCompiled`, `dawn.js` `minLaps`) | the compiles stall the page, better under the ring | **kept** while the install/info world compiles on the page (6a.1); the flight's and the galaxy's share of it goes. It becomes the Chromium shape (a first visit only; Chromium's cap is 9 s, `main.js` `asideHere ? 9000 : 8000`) when nothing compiles on the page: the follow-up's |
| The journey's stall cap while the world draws (`journeyClock` `stalls`) | a slow world on the page's thread paused the beats | **dropped** (real time, 6a.3) |
| The leisure proof 4 s after lit, 2 s after a descent back (`proveLater`; ADR-0002 12d, question 1 answered 1a) | the fitness verdict is not taken on a busy page | **kept**: it is a timing policy about the verdict's fairness, not a compile freeze (section 2's last decision), and its revisit condition stands |
| The climb's 8 s hold for `ready`, the hidden-tab wait, `PICTURE_WAIT`, `COMPILE_WAIT` | the world may still be readying, hidden, or lost | **kept**, unchanged |

Expected on the owner's machine, said as an expectation and not a promise: page-thread compiles fall from 3.0 s to
about 1.0 s (the install/info world), the chores' held and resting time by the flight's share, and the ring's wait
by about 2 s plus those rests; the reveal and the first flight run with no compile anywhere near them. M3 (6a.10)
measures it.

### 6a.6 The interface change (README, `assets/door/`), deliberate, since Orbit copies the folder unchanged

All optional for a host: a host that passes nothing gets the door exactly as it is today, so Orbit's import merge
request needs no change to keep working. Slots, markup and the stylesheet are unchanged.

- `settings.drawWorker`: `() => Worker | null`, absent by default. The host makes the worker, a **module** worker:
  the site `() => new Worker("assets/door/draw-worker.js", { type: "module" })`; Orbit, when it takes it up,
  `() => new Worker(new URL("./draw-worker.js", import.meta.url), { type: "module" })` from its own code, which
  Vite rewrites for the build. Absent, no worker is ever made.
- `settings.fonts`: `[{ family, weight, url }]`, absent by default; required with `drawWorker` (6a.2): the faces
  the flight's pens write with, loadable from the page's own origin. The site: JetBrains Mono at weight 500 from
  `assets/fonts/` (question 3). Orbit passes its own file's URL through Vite as it does its pictures.
- `flags.draw`: `"worker"` or `"page"` (the site reads `?draw=worker|page`), 6a.4.
- New files: `page.js` (6a.2), `remote-flight.js` (6a.4), `draw-worker.js` (the worker's entry: `onmessage`, the
  `hello`/`canvases` handshake, `createFlight` on the `#warp` OffscreenCanvas with `page.js`'s frame and clock,
  the asks routed to it, `self.close()` on `destroy`). All three pass the self-contained lint as written (relative
  imports only, no `location`, no `import.meta.url`, no outside address) and the strict type check with the
  folder's one `tsconfig` (`lib: dom`): `draw-worker.js` types `self` through a small typedef of what it uses
  (`postMessage`, `onmessage`, `close`, `fonts`), rather than adding the `webworker` lib, which cannot share a
  config with `dom`.
- `createJourney` takes its canvas's context at the first `warm`, `warmDocs`, `fly` or `descend`, not at mount,
  and may replace the canvas element it was given (6a.4). `destroy()` before any of those destroys nothing. A
  profile given to `fly` carries `UP`'s or `DOWN`'s curves (6a.3's wire form); any other throws.
- Console (via `note`): `flight: drawn in a worker` / `flight: drawn on the page: <why>`; everything else as today.
- README's CSP paragraph: `worker-src 'self'` is asked of a page whose host passes `drawWorker` (every site page
  carries it already), and `font-src 'self'` for the font the host names. The worker runs under the page's policy
  where the browser inherits it into a dedicated worker (Firefox) and under none where it does not (Chromium: Pages
  sends no headers), so it must and does need nothing the page does not allow: same-origin pictures and font.

### 6a.7 Tests: behaviour, never timings; the paths forced by flags

Node, through `assets/door/index.js` alone on the stub page (`tools/ci/door-stub.mjs`), one fresh process per case
as `fit-skip-test.mjs` does, the worker a fake class the case passes as `drawWorker` (recording what it is posted
and answering what the case says), the clock virtual where a wait would otherwise be real (`stale-prove-test.mjs`):

- D1 no `drawWorker`: no worker made; `#warp`'s 2D context is taken at the first `warm`, not at `journey()`;
  `destroy()` before any need takes no context. Control for everything below.
- D2 `drawWorker` and `fonts` given, `draw: "worker"`: the fake is posted `hello` first (flags without `door3d`;
  `images` with an absolute URL for every key of `pictures()` and for `dawn/dawn.webp`; `fonts`; `size`; `hidden`),
  then `canvases` with two transferables (the stub's `transferControlToOffscreen` returns a token); `#warpgl` is in
  the page beneath `#warp` with `aria-hidden`; `warm({ prove: false })` posts `warm` with an id and resolves only on
  `warmed` with that id (a `warmed` with another id resolves nothing); `fly(UP)` at its warp posts `start` with a
  `profile` holding no function and `base: "UP"`; `descend()` posts `base: "DOWN"`; a `note` prints as `orbit · …`;
  `destroy()` calls `terminate()`.
- D3 the rule: `parallel` false, no `userAgentData`, `Worker` and `OffscreenCanvas` on the stub: a worker. Then
  one at a time: `parallel` true; `userAgentData` defined; `gpu: "force"`; save-data; no `fonts`; `draw: "page"`:
  no worker in each, and the console line names the reason where a worker was given.
- D4 the fallback: the fake fires `error` before `up`: `#warp` is a fresh element with the same id and class, no
  `#warpgl`, `terminate()` called, the pending `warm()` resolves after the page engine's own warm, and a later
  `fly()` draws on the new canvas's 2D context (the stub records its calls). `up { ok: false, why }`: the same,
  `why` in the line. `dead` after `up`, mid-flight on the virtual clock: the page engine starts with `skip` equal
  to the elapsed journey time (within a frame), and the `land` hook still fires at its beat. No `up` within
  5000 ms under the automatic rule: the fallback; under `draw: "worker"`: still waiting at 20 s.
- D5 the worker side: `draw-worker.js` imported in a child with a stub `self` (`postMessage`, `onmessage`, `close`,
  `fonts`) and fake `OffscreenCanvas`es whose contexts are the stub's recording gl and 2D: `hello` then `canvases`
  posts `up { ok: true }`; the world's shaders are compiled before any frame is requested and with no `"compile"`
  chore queued; `warm` is answered by `warmed` with its id; the pictures are fetched from the absolute URLs given
  and no other; `fonts` adds a `FontFace` of that family and url and no frame is drawn before its `load()`
  settles; `size` sets both canvases' bitmap sizes; `visible { hidden: true }` runs no fitness frame until
  `{ hidden: false }`; `start` with `at` steps synchronously and posts one `frame` with that `seq`; a `start`
  superseded by `stop` posts no `frame` for the old `seq`; `destroy` calls `close()`.
- D6 the wire form: `unwireProfile(wireProfile(P))` for `UP`, the site's `RIGHT`, `UP_RING`, `demoFlight(homes)`,
  `docsFlight(chart)` (chart with getters), `DOWN`, `descentProfile({ from: RIGHT, homes })`: the curves are `UP`'s or
  `DOWN`'s very functions and every other field deep-equals after `structuredClone`; a profile with its own `speed`
  throws the named error.
- D7 `pace("none")`: ten chores queued run with no frame asked between them (the stub counts `requestAnimationFrame`),
  the opening and the typing wait are ignored, and `uploadBanded` puts a picture on in one `texImage2D` of its full
  height; the measure's 200 ms rest is still honoured.

Browser (Playwright, the shape of `tools/ci/pin-test.mjs` and `csp-test.mjs`):

- P1 pixel identity, Chromium (SwiftShader, `?gpu=force&fit=skip`, 1280x800, motion on), a new `tests/draw.html`
  made from `tests/pin.html`: the same pinned flights under `?draw=page` and `?draw=worker`, each on a fresh page
  (`fly(UP, { at: 2600 })`; `demoFlight` with two named households at 1500, so the names are compared; `docsFlight`
  with a chart at 4200; `descend({ at: 1800 })`), screenshot of the canvases' box once `#warp[data-drawn]` is set,
  compared pixel for pixel: zero differing pixels. Control: `draw=page` at 2600 against 2800 differs, so the
  comparison can fail. On failure the count and a diff picture are written as artefacts. The runner's software GL
  draws the same commands the same way on either thread, so this does not depend on the runner's speed; if it ever
  proves non-deterministic between the two contexts, the test reports it and the owner decides a tolerance (never
  loosened silently). Edge first, by hand, on the owner's machine (`?draw=worker`): the same page, the eye and
  the console.
- P2 Firefox, the gate's own browser (headed under Xvfb, software GL): `/?preview&gpu=force&fit=skip&draw=worker`:
  the real `draw-worker.js` loads with no CSP violation (`csp-test`'s harness); the console carries `flight: drawn in
  a worker`, `flight: shaders compiled`, `flight world: on (fitness skipped)`; a click on the gate lands (`showwarp`
  then `bare`); `#warpgl` is there and has no 2D context on the page. The same with `draw=page`: `flight: drawn on
  the page` and the landing.
- P3 fallback, live: `draw-worker.js` served 404 (as `csp-test`'s F1 serves `main.js` 404) under `draw=worker`:
  `flight: drawn on the page: the worker failed to load`, and the gate's flight still lands.
- Every existing live test is unchanged and keeps the page path (6a.4's `gpu: "force"` exclusion), so what they
  prove is what they proved.

### 6a.8 Coverage, CSP, the service worker, the lint and the type check

- Coverage is collected in Chromium by `tools/ci/coverage-hook.mjs` through Playwright's page coverage, which
  records the page's scripts only: lines run inside a worker are never recorded. `engine.js`, `voyage.js`,
  `chores.js`, `upload.js` and `fitness.js` keep their floors from the page-path runs, which are all of the existing
  suite. The new files: `page.js` and `remote-flight.js` are covered in Chromium by P1's `draw=worker` pages (the
  page side runs there) and in Node by D1-D4; `draw-worker.js` is covered in Node alone, by D5 (`node-tests.sh`
  records V8 coverage for the lint job). A new file with no floor fails the check, so batch 2 adds the three floors
  from three full runs (`coverage.mjs --raise`); the hook's file pattern already admits any `assets/door/*.js`.
- CSP: nothing to add. All three pages carry `worker-src 'self'` and `font-src 'self'`; `csp-test` keeps checking
  that `index.html` does. `blob:` workers stay rejected (section 7).
- `sw.js`: nothing to change. The worker's file and its imports are code, fetched fresh through `fresh()`; its
  picture fetches go through the page's service worker and hit the 36-hour media cache; a self-hosted `.woff2` is
  media by `isMedia`, so adding the font changes `MEDIA`'s name, which the lint prints (as for any picture).
- The lint: the three new files pass "the shared door is self-contained" as written; `tools/door-markup.mjs` is
  untouched (no markup changes). `tools/ci/lint.sh` gains nothing.
- The type check: one `tsconfig` with `lib: dom` (6a.6).

### 6a.9 Build: three batches, after the audit section 6 asks for (question 5)

Each batch is a pipeline; each is reviewed inline at the point it is written; tests first, from this section, by
an agent that has not seen the code (the house order of work). Line counts are estimates of new and changed lines,
tests included. The audit came first (owner, question 5 below): the sixth audit (#90) read everything to a621f59 and
found no High or Medium, so the count starts again from there.

1. **The seam** (~600 lines): `page.js` and every page touch of the moved modules routed through it (no behaviour
   change on the page path: the existing suites prove it); `journey.js` makes its engine at first need;
   `wireProfile`/`unwireProfile`; `chores.js` `pace`; the self-hosted font if question 3 is answered 3a (the
   dependencies-and-data skill applies: OFL 1.1, version pinned and credited in `README.md`). Tests D1, D6, D7.
   Files the follow-up issue for the install/info worlds (6a.1).
2. **The worker** (~1,100 lines): `draw-worker.js`, `remote-flight.js`, `drawnAside()`, the fallback,
   `settings.drawWorker`, `settings.fonts`, `flags.draw`, `main.js` (`FLAGS.draw`, the factory, the font), the
   folder's README (6a.6), the three coverage floors. Tests D2-D5.
3. **The proof** (~500 lines): `tests/draw.html`, P1-P3, `.gitlab-ci.yml` (P1 in Chromium, P2-P3 in the live
   job), CAPABILITIES.md "A worker's compile" and PERFORMANCE.md "The worker, measured" brought up to date, M3's
   numbers when the owner has them.

About 2,200 lines in all: the unaudited count would reach about 5,500, under the 10,000 trigger.

### 6a.10 What the owner measures on a real desktop (M3, replacing section 8's placeholder)

After batch 2, Firefox, private window, `?preview`, then `?preview&draw=page`, the console lines of each:
`flight: drawn in a worker`; `flight: shaders compiled in N ms` and `docs galaxy: …` (now the worker's time, said
through `note`); `install: shaders compiled` (still the page's); `reveal: … longest frame gap N ms`; `flight: first
second N frames, worst N ms`; `chores at flight ready: …` (held, resting, waited: the page's queue, which should
now hold only the install world's); the time at which each way in opens. The eye on the ring, the reveal and the
gate's flight, both ways. Edge with `?draw=worker` once, for P1's by-hand half.

### Questions for the owner (#85)

*Answered 2026-10-27 (owner): 3a, with a wider rule: nothing on the site loads from a third party at all, so every
font and script is hosted on the site itself (its own issue, which also takes the other Google fonts and the diagram
library off outside hosts); 4a; 5a in effect (the owner ran the audit first, #90); 6a: two contexts, since MDN's
WebGL best practices say to lose a context only "when you're definitely done with" it, and the site's own worlds
still draw on the page's. Once they move into the worker too (4a's follow-up), the page is done with it and the
follow-up loses it.*


**3** The font the worker draws names with (6a.2): the page's `'JetBrains Mono'` is Google's and cannot be handed
  to a worker, so either the site hosts the file or the names are not pixel-identical.
  **3a** (recommended) self-host JetBrains Mono (OFL 1.1, the site's three weights, or the one variable file) under
  `assets/fonts/`, drop it from the Google Fonts link, and give the worker the same file through `settings.fonts`:
  identical by construction, one third-party request fewer on a first visit, and `font-src` can lose
  `fonts.gstatic.com` for that family. The dependencies-and-data skill's checks apply (licence, version, credit).
  **3b** keep Google's font for the page and draw the names on a third, page-side canvas above the two, fed by a
  per-frame `labels` message from the worker: identical glyphs, a frame late, and a name under a later prop's ring
  would show where the page path hides it.
  **3c** accept the engine's fallback monospace for the names in the worker: not pixel-identical, and P1 then
  compares everything but the names.
**4** The install/info worlds (6a.1): **4a** (recommended) their own issue after #85, filed by batch 1, so #85 stays
  the door's interface change and its proof; **4b** fold them into #85 as a fourth batch now (about +900 lines:
  `world.js`'s touches behind `page.js`, a second worker file under `assets/js/`, its own tests).
**5** Section 6 says "its own batch after an audit", and the unaudited count is 3,337 against the 10,000 trigger:
  **5a** audit before batch 1, as section 6 says; **5b** (recommended) build the three batches and ask for the
  audit at the global trigger, since the whole lands near 5,500.
**6** Two WebGL contexts on the worker path (6a.1: the gate's idle on the page, the world's in the worker), where
  ADR-0002 keeps one: **6a** (recommended) accept, recorded here, the page path unchanged; **6b** lose the gate's
  context (`WEBGL_lose_context`) once the worker says `up`, which frees one idle context and makes `gpu()` report a
  lost context to the site's own worlds for the rest of the visit, so they would need their own check.

## 6b. Detailed design: the install and info worlds drawn in a worker on Firefox (#93)

Written 2026-10-28, against what #85's batches 1 and 2 built on `dev` (`assets/door/page.js`, `remote-flight.js`,
`draw-worker.js`, `fitness.js` `drawnAside()`, `settings.drawWorker` and `fonts`; batch 3, the proof, was being
built as this was written). The measurement that funds it is 6a's: on the owner's desktop Firefox the page thread
compiles the install/info world in 956 ms (one world worn two ways: `install.js` `shared`) and then bakes its galaxy
and uploads its maps as page chores, so after #85 alone `compilesAside()` still reads false there, every `"compile"`
chore and the ring's wait for `compiledAll` stay on every visit, and the 4 s target is out of reach (6a.1's "honest
consequence"). Owner decisions on #93 before this was written: reuse 6a's seam (the adapter, the message pattern, the
fallback); the worker file under `assets/js/`; Firefox only, behind the same `?draw=worker|page`; Chrome, Edge and
Safari keep the page path; lose the page's WebGL context once nothing on the page draws with it (question 6
answered 6a, with 7a on #93: "lose a context eagerly once you're definitely done with it", MDN's WebGL best
practices). Browser facts are 6a's unless a version is quoted here.

**The standard pattern** is 6a's, the render thread off the UI thread, in its other common shape: the camera stays
on the UI thread and posts a view every frame, and the render thread draws the latest view it holds (the
frame-coalescing, latest-wins feed that PERFORMANCE.md's sketch describes: "the page posting the state each frame
and the worker drawing"), with 6a's worker RPC for the asks (correlation ids, a sequence number on the frames). 6a
moved the flight's clock and camera into the worker because `engine.js` reads nothing of the page mid-flight. The
install's camera (`install.js`) reads the page every frame (the pointer, the phone's tilt, the pad's size, the door
planet's rectangle and computed styles for a dive's start, `document.hidden`, the body's classes) and writes to it
(the canvas's opacity, the pad's classes), so moving it would put some twenty page touches behind an adapter for
no gain, while the view it produces is forty-odd numbers of plain data (`install.js` `draw`: `w.draw({ cam, fwd,
… })`). So the seam is `world.js`'s one drawing call, and `world.js` moves whole. One bespoke choice, said in
6b.3 with its reason: the worker measures its own frame period for the governor, because the page's period can no
longer see the drawing's cost.

### 6b.1 What moves, what stays, and whose worker

Moves into the worker: `assets/js/world.js` whole (the shaders and their compile, the textures and their banded
uploads, the galaxy's bake, `draw(view)`, the render targets, `resize`, `finish`), and with it the door modules it
leans on, running there as the modules they are: `chores.js` (`fetchOnce`, `linked`, `compiledWithin`, a second
queue, unpaced), `upload.js` (`uploadBanded`), `page.js`, `settings.js`. `fitness.js` is imported (by `chores.js`)
but `gpu()` is never asked in this worker: the page's gate has judged (6b.2).

Stays on the page: `install.js` entire (the camera, the shot's clock, the pointer and tilt, `size()`, `govern`,
`calibrate`'s arithmetic, the pad's classes and the canvas's opacity, the `shared` object), `main.js`, `pads.js`
(`createInfo` takes the same world), `planets3d.js`, and the door-planets loop (`install.js` `startDoor`, `?door3d`
only): not carried, as 6a left the live door. On the worker path `startDoor` returns null before making anything,
so the install's and the information's planets stay the door's pictures (`planets3d.js` never draws those two),
`html[data-worldplanets]` is never set, and a dive goes on from the picture as it does without the flag. The
posters' `still()` runs in Chromium, on the page path, unchanged.

**Its own worker, not #85's.** Weighed: one worker owning three canvases against two workers, one a world.

- *ADR-0001 decides it.* `draw-worker.js` is in the folder Orbit copies, and the lint keeps the folder
  self-contained: it cannot import `../js/world.js`. The only way one worker could draw the site's world is a slot,
  the host naming a module for the worker to `import()` at `hello`, which then takes extra canvases and its own
  messages. That is an interface change to the folder (a slot and a second protocol inside `draw-worker.js`) for a
  world Orbit does not have: a feature the door would carry for the site alone, which is what ADR-0001 says the
  site may not do. The site and Orbit differ by a setting or slot the door already offers, never by an edit to the
  folder made for one of them.
- *Failure isolation.* One fallback for both would fall the flight back to the page because a world could not be
  made (no float colour buffers in the worker, a thrown shader), and the other way about. Two workers fall back one
  at a time (6b.4), and one on the page beside one in a worker is a legal state.
- *Time.* On two threads the flight's 1.8 s and the world's 1.0 s compile at once rather than in turn; on one
  thread the ring's lap would be waiting on 3 s again. Firefox's measured stall is of a *drawing* context during
  another context's compile (section 1); at first light neither worker draws, so the two compiles do not stall each
  other's frames.
- *Cost.* A second thread (a few MB of heap, Firefox's per-worker overhead), the door's modules parsed twice (about
  60 KB), the moon's picture fetched by both workers (`voyage.js` `pictures()` and `world.js` `MOON` name the same
  file; the second fetch is answered by the service worker's media cache). Accepted.

So: `assets/js/world-worker.js` (the worker's entry) and `assets/js/remote-world.js` (the page side: the surface
`createWorld` returns, remotely), both the site's files, importing the door through `assets/door/index.js` alone as
the lint requires of a site module (6b.6 names the three exports that needs). `install.js` imports `createWorld` and
`createRemoteWorld` and chooses between them in `ensure()`.

### 6b.2 The page adapter, and `world.js`'s own page touches

`page.js` is reused as it is: the worker calls `setPage(...)` from `hello` with the answers `draw-worker.js` gives
(`shared: () => false`, so `compilesAside()` reads true there; `note`/`verdict` posted to the page as `note`, so
every console line still reads on the page; `baseURI` the page's; `frame` the worker's own `requestAnimationFrame`;
`canvas` an `OffscreenCanvas`), then `pace("none")` and `openChores()` as 6a.5 has them. `createDoor({ flags,
image, typingWait: 0 })` configures `settings.js` there (the entry's own function; `watchTyping` is skipped at
`typingWait: 0`). Found by reading `world.js` for `window`, `document`, `matchMedia`, `screen`,
`requestAnimationFrame`, `console`, `performance`, `createImageBitmap`, `import.meta.url` and `gpu`:

| `world.js` touches | On the page | In the worker |
| --- | --- | --- |
| `picturesOf`: `matchMedia("(pointer: coarse)")`, `screen.width`/`height`, for `small` | as today | `opts.small`, carried in `hello` (the option exists; the page decides) |
| `picturesOf`: `new URL(…, import.meta.url)` | the module's own folder | the same file from the same folder resolves the same; the `import.meta.url` rule is the door's, not the site's |
| `createWorld`: `if (!gpu()) return null` | the gate, as today | `opts.gated: true` from `hello`: the page's gate judged, and `gpu()` is never asked in this worker, so no second context is made with the gate's attributes (`alpha: false`, which is not the world's) |
| `canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, … })` | the page's canvas | the transferred `OffscreenCanvas`, the same attributes (a `webgl2` context on an `OffscreenCanvas`: Firefox 105, 6a) |
| `bake`'s `requestAnimationFrame(step)` (a galaxy strip a frame) | the page's | the worker's own (a dedicated worker's `requestAnimationFrame`: Firefox 99, 6a); still a strip a frame: the strips are GPU time, nothing in the worker waits on them, and running them back to back gains nothing |
| `console.warn(…)`, six places (the world could not be drawn, no map, the rings or the moon drawn not photographed, the galaxy did not compile in time) | as today | `opts.warn`, default `console.warn`; the worker posts it as `note { kind: "warn" }` and the page `console.warn`s it, so the lines read as today |
| `createImageBitmap(blob, …)` | as today | the same call (available in workers since Firefox 42, `mdn/browser-compat-data`) |
| `performance.now()` | as today | the worker's clock: `compileMs` is the worker's time, said by `install.js`'s `shaders compiled in N ms` line as today |
| `fetchOnce`, `uploadBanded`, `linked`, `compiledWithin`, `COMPILE_WAIT` (the door's) | the page's queue | the worker's queue, unpaced: a picture goes on whole (6a.5) |

Three small changes to `world.js` carry all of it: the two new options (`gated`, `warn`; `small` is there);
`lookOf` lifted out as a pure export (it is arithmetic on the look's options and reads nothing of the context;
`install.js` calls it on the page and the view carries the result, so the worker needs no `look` message); and
`get lost()` beside `gl` (`install.js` reads `world.gl.isContextLost()` today; the remote world has no `gl`).
`createWorld`'s returned surface otherwise stands, with `canvas` added (6b.4: a fallback replaces the element, so
`install.js`'s `shared.canvas` becomes `shared.world.canvas`) and `onDrew(fn)` (6b.3).

### 6b.3 The messages

6a.3's rules hold: plain objects with a `type`; asks that expect an answer carry an `id`; the frames carry `seq`;
a reply whose id is not pending is dropped; after `destroy()` or a fallback the adapter is `gone` and drops
everything; transferables are marked. Reused with 6a.3's meaning: `hello`, `up`, `note`, `compiled`, `lost`,
`dead`, `destroy`. New, because this worker draws a camera's frames rather than running a clock: `canvas`,
`resize`, `bake`/`baked`, `run`, `view`/`drew`, `finish`, `measure`/`measured`.

Page to worker:

| Message | Fields | When |
| --- | --- | --- |
| `hello` | `flags` (the host's, without `door3d`), `baseURI`, `world`: `{ small, map, rings, moon }` (absolute URLs, resolved on the page as 6a.3 resolves the flight's), `sky`, `tag`, and the look's options (`hue`, `sat`, `ringsOn`, `haze`, `grade`: plain data) | first |
| `canvas` | `canvas` (the transferred `OffscreenCanvas`) | after `hello`; `createWorld` runs in the worker on it at once (6b.5) |
| `resize` | `w`, `h`, `scale` | `install.js` `size()` and `govern`: the camera's size, not the window's (`world.resize(w, h, scale)` as today) |
| `bake` | `id` | `world.bake()`; answered by `baked` |
| `run` | `on` | `install.js` `start()` / `stop()`: the worker's frame loop runs while a pad is drawing (below) |
| `view` | `seq`, `view` (the object `install.js` `draw` builds: numbers, arrays, `look.HUE` a `Float32Array`; structured clone keeps all of it, and nothing in it is a function) | every page frame the camera draws |
| `finish` | none | `install.js` `touch`: the GPU made to finish what was asked (`readPixels` 1x1), so a driver's first-draw work is done before the dive, as today |
| `measure` | `id`, `sets` (an array of view arrays) | `install.js` `calibrate`: each set drawn in turn and timed as `calibrate` times it today (a draw and a finish, then three timed draws and a finish), one ms a set returned |
| `destroy` | none | the surface has it for the tests and the fallback (`install.js` never destroys the shared world: it lives the page's life) |

Worker to page:

| Message | Fields | When |
| --- | --- | --- |
| `up` | `ok`; `why` when not (`no WebGL2 in a worker here`, `the world could not be made`) | after `canvas`, once `createWorld` returned a world |
| `compiled` | `ok`, `ms` (`compileMs`) | `made` settled: `install.js`'s `shaders compiled in N ms` line, and `compiled` for the ring |
| `baked` | `id`, `ok` | the bake with that id settled |
| `drew` | `seq`, `dt`, `ms` | a view drawn: `seq` the view's, `dt` the worker's time since its previous frame callback, `ms` the time `draw` took to issue. The page sets the canvas's `data-drawn` to `seq`, which the tests wait on |
| `measured` | `id`, `ms` (one a set) | the measure done |
| `note` | `line`, `kind` (`note`, `verdict`, `warn`) | every console line the moved modules would have printed |
| `lost` | none | the context lost in the worker (`webglcontextlost` on the `OffscreenCanvas`, Firefox 125, with `isContextLost()` read before every frame and message as 6a's backstop); the page dispatches `webglcontextlost` on the placeholder canvas, so `install.js`'s listener (flat, the shot ended where it is) is unchanged |
| `dead` | `why` | an exception handling a message: the page falls back (6b.4) |

**The frame feed, latest-wins.** The worker holds at most one view. Each `view` replaces it; the worker draws the
one it holds in its next `requestAnimationFrame` callback and posts `drew`. So there is at most one draw a display
frame, with the commit landing on the compositor's next frame (the usual shape for an `OffscreenCanvas` drawn in a
worker); a camera posting faster than the worker draws loses intermediate views and never queues them; and a worker
held in the driver for a moment draws the newest view when it returns. The page never waits for `drew` before
posting the next view (no ack-gating: coalescing alone bounds the queue). The shot's clock, its easing and the
canvas's opacity stay the page's, so the picture is at most one frame behind the fade the page sets
(`canvas.style.opacity` from the shot's `t`): 16 ms under a 340 ms hold.

**The governor's measure: the one bespoke choice.** `install.js` `govern(dt)` keeps the frame rate by the page's
own frame period, which on the page path lengthens when the GPU is behind (the compositor waits, so
`requestAnimationFrame` does). In a worker the page's period never sees the drawing, so `govern` would never give
way and a slow machine would draw the world at full density for the whole visit. The standard answers do not fit: a
GPU timer query (`EXT_disjoint_timer_query_webgl2`) is Chromium's alone, which is not on this path; finishing every
frame (`readPixels`, what `calibrate` and `fitness.js` do for a few frames) would serialise every frame of a dive.
So the worker runs its own frame loop while `run` is on, measures its own period between callbacks exactly as
`install.js`'s loop measures the page's, and sends it as `drew.dt`; on the page the world reports each frame through
`onDrew(fn)` (on the page path at once, with the loop's own `dt`; from the worker on `drew`), and `govern`,
`mframes` and the `first second N frames, worst N ms` count move behind it. At rest the camera draws one frame in
four (`tick & 3`) and `govern` is called for the drawn ones with the loop's period, as today. The `dive began: …
first frame N ms` line takes the first `drew.ms`. Whether a worker's `requestAnimationFrame` in Firefox lengthens
under GPU load as the page's does is an expectation M4 looks at by eye (6b.10), not a test.

### 6b.4 When the worker path is taken, and the fallback

**One rule, the flight's.** The site's worlds take the worker exactly when the flight does: `drawnAside()`
(`fitness.js`, 6a.4: `?draw=page|worker`; else the host's worker and fonts given, the gate accepted and `parallel`
false, no `userAgentData`, the gate not forced, `Worker`, `OffscreenCanvas` and a canvas that can be handed over,
not under save-data), exported through the entry for the host (6b.6). Chrome, Edge and Safari keep the page path by
the same tells; the live tests' `gpu=force` keeps it too; `draw=worker` forces it for the pixel test. Decided at
`install.js` `ensure()`, the shared world's first making (`prepare()` at `warmJourneys`, or `start()`), after the
gate has run; and read once more by `main.js` at first light for the ring (6b.5), which prints the flight's
`drawn in a worker` line there rather than at the journey's first need (the same verdict, a moment earlier). Said
once, through `note`: `install: drawn in a worker` / `install: drawn on the page: <why>`.

`remote-world.js` `createRemoteWorld(canvas, opts, { worker })` returns `createWorld`'s surface (`made`,
`compileMs`, `bake`, `baked`, `draw`, `resize`, `finish`, `lost`, `canvas`, `onDrew`, `measure`, `destroy`, and
`aside()`, a promise of whether it came up, for 6b.6), so `install.js` holds one world whichever it is. It makes the
worker (`worker`, default `() => new Worker(new URL("./world-worker.js", import.meta.url), { type: "module" })`: a
site file may read its own address; the tests pass a fake), posts `hello`, transfers the canvas
(`transferControlToOffscreen()`), posts `canvas`, and waits for `up`. `install.js`'s changes: `ensure()` chooses;
`make` is not a `"compile"` chore on the worker path (6b.5); `calibrate` returns a promise on both paths (the
`"measure"` chore already takes one); `touch` posts two views and `finish`; `startDoor` declines a remote world.

**Fallback**, 6a.4's mechanism with 6a.4's triggers, one function, tested once: `fallBack(why)` replaces the
placeholder `.orbitgl` with a fresh `<canvas>` carrying its attributes (a transferred element can never again give
the page a context: `getContext` throws `InvalidStateError` on a placeholder, HTML Standard), terminates the worker,
makes `createWorld` on the fresh canvas on the page (which compiles there, 956 ms: the fallback's cost, as 6a.4's
compiles as today), replays the pending `bake` and `measure` asks on it, bakes it afresh if the worker's world had already answered
`baked` (else a dive under way, or the next, would never settle: found by batch 2's tests, W4), points `made` and `compiled` at the page
world's, and says `install: drawn on the page: <why>`. A dive under way needs no replay: the camera posts a fresh
view every frame, and the next one is drawn on the page. `adopt()` moves the canvas after the pad's `slot` (the
comment `install.js` keeps beside it), so a replaced element is adopted as the old one was, and `shared.canvas`
becomes `shared.world.canvas` so nothing holds the old element. Triggers: the worker's `error` event; `up` with
`ok: false`; `dead`; and under the automatic rule no `up` within `COMPILE_WAIT` (5000 ms, the entry's export, the
figure 6a.4 chose; under `draw=worker` there is no cap, as 6a.4). `lost` is not a fallback: flat, as today. The
flight's and the world's fallbacks are independent, and the ring's rule (6b.5), decided before either was up, is
not revisited: a fallback after it compiles on the page after the ring, a freeze the fallback accepts.

**The one shared canvas.** The install's and the information's worlds are one world (`install.js` `shared`), its
canvas moved between the pads by `adopt()` (`slot.after(canvas)`). A placeholder canvas is an element like any
other: it may be moved in the DOM and styled, and shows the bitmap last committed from the worker (HTML Standard,
placeholder canvas element), so `adopt()` is unchanged. Both pads post `view`s to the one worker, each with its own
`look` from `lookOf` on the page. `install.js`'s `busy`/`owner` rules, which keep the other pad from drawing into it,
are unchanged.

### 6b.5 Holds and rests on the worker path; the ring

The page path keeps every one as it is. On the worker path:

| Hold or rest (where) | Why it exists | Worker path |
| --- | --- | --- |
| The world made as a `"compile"` chore, a frame plus 20 ms after the last (`install.js` `prepare`: `chore(make, 20, ["compile", TAG])` where `compilesAside()` is false) | the compile freezes the page, so it is spaced and put under the ring | **dropped**: `make()` at once at `prepare()`, so the worker is made and the compile starts there, as on the Chromium path today |
| The reveal hold for the world's GPU work (its uploads, its bake, `touch` and `calibrate` wait for `openChores`) | they touch the page's thread and the GPU under a reveal still being painted | **dropped for what moved**: the worker's queue is open from `hello`, the maps go on whole, the galaxy bakes a strip a frame from `up`. `touch` (60) and the `"measure"` chore (200) stay on the page's queue, because they schedule GPU work beside the page's other chores and the measure's rest is still "not the drawing's time"; their work is done in the worker |
| The rests between chores and the one-band-a-frame uploads (`upload.js`) | whatever moves on the page keeps moving | **dropped** in the worker (`pace("none")`, 6a.5); the page's queue keeps them for what stays |
| The ring's wait for `compiledAll`, 8 s cap, at least a lap, on every visit where compiles stall the page (`main.js` `waitCompiled`, `asideHere`; `dawn.js` `minLaps`) | the compiles stall the page, better under the ring | **becomes the Chromium shape** when nothing compiles on the page: `asideHere = MAINTENANCE || saveData() || compilesAside() || (drawnAside() && !DOOR3D)`, so `waitCompiled` is a first visit only, and keeps the 8 s cap (not Chromium's 9 s: `main.js` gives 9000 wherever `asideHere`, so the worker path names its own 8000; owner, 6b-4a), and `openCompiles()` and `compileFirst()` are not called. `compiledAll` still carries the remote worlds' `compiled` (the message) and the flight's, so a first visit's ring runs until both workers have compiled or 8 s. Said through `note`, for the tests: `first light: compiles aside` / `first light: the ring waits for the compiles`. Under `?door3d` today's shape stands: the live door and `planets3d.js` compile on the page's context (`capability.js` `level()` gives level 1 where `background` is false; the worker path does not force level 0) |
| The leisure proof (`proveLater`), the climb's 8 s hold, `WAIT` (6 s for the bake at `form`) | timing policies, not compile freezes | **kept**, unchanged |

Expected on the owner's machine, said as an expectation and not a promise: no shader compiles on the page's thread
on a Firefox visit (the gate's context creation remains, under the ring); the worlds' share of `chores at … held,
resting, waited` near zero; on a later visit the ring runs its one lap and the door lights with no wait (`dawn.js`:
"on a later visit, with everything kept, it comes straight up"); the first dive finds the world baked if the visit
is a few seconds old, and `WAIT`s otherwise as today. M4 measures it (6b.10).

### 6b.6 The page's WebGL context let go (7a); the interface change, deliberate

**Letting go.** Once the flight's worker and the world's worker have both said `up`, nothing on the page draws
with the gate's context: the flight's world and the galaxy are in one worker, the site's world in the other. `main.js`
then loses it, `gpu().gl.getExtension("WEBGL_lose_context").loseContext()` (`WEBGL_lose_context`: Firefox 22,
`mdn/browser-compat-data`; `world.js` `lose()` already uses it), and says `gpu: the page's context let go`.
Conditions, all of: `journey.aside()` resolved true (the flight's worker up: the new call below), the world's
`aside()` resolved true, not `?door3d` (the live door and `planets3d.js` draw with it). After it, `gpu()` still
returns the verdict (truthy), so `fetchWorld`, `compilesAside()` and `drawnAside()` read as before (their fields
were stored at the gate); `fitness.js`'s `webglcontextlost` listener runs `preventDefault()` as for any loss, and
a loss by the extension is undone only by `restoreContext()`, which nothing calls. The cost, said plainly: a flight
worker that dies *after* `up` (`dead`, `error`) falls back to a page engine whose `createVoyage` finds the gate's
context lost and flies painted for the rest of the visit (`voyage.js` makes no world on a lost context, ADR-0002);
a world worker that dies after `up` is unaffected (`createWorld` makes its own context on the fresh canvas, as
today). Question 6b-2 offers the restore. Until both are up there are three contexts (the gate's, idle, and one in
each worker); after, two, both drawing.

**The interface change (README, `assets/door/`)**, additive and optional, said so because Orbit copies the folder
unchanged: a host that uses none of it has the door exactly as today, and Orbit's import merge request needs no
change.

- `index.js` exports `setPage` (`page.js`) and `pace` (`chores.js`), "for a host's own worker": a site module may
  import the entry alone (the lint), and a host's worker must answer for the page and run its queue unpaced as
  `draw-worker.js` does. And `drawnAside` (`fitness.js`), "whether the flight is drawn in a worker, for a host that
  puts its own drawing beside it".
- `journey.aside()`: `Promise<boolean>`, true once the worker said `up`, false once the flight is on the page (the
  page path at the first need; a fallback before `up`). `remote-flight.js` settles it from `up` and `fallBack`;
  `journey.js` carries it as it carries `compiled()`, settled at the first need. Without it a host cannot tell a
  worker that came up from one that fell back before `up` and compiled on the page, and would lose the very context
  that page engine's world draws with.
- README: the entry's table gains the three exports and the journey's surface `aside`. Nothing else of the folder
  changes: no setting, no slot, no markup, no stylesheet, no message of `draw-worker.js`'s; the CSP paragraph
  stands (6b.8).

### 6b.7 Tests: behaviour, never timings; the paths forced by flags

Node, one fresh process per case (as `draw-*-test.mjs`), `install.js` and `world.js` on the stub page
(`tools/ci/door-stub.mjs`, with a `.orbitgl` canvas whose `transferControlToOffscreen` returns a token and whose
contexts are the stub's recording gl and 2D), the worker a fake class passed as `worker` (recording what it is
posted and answering what the case says), the clock virtual where a wait would otherwise be real
(`stale-prove-test.mjs`):

- W1 no worker chosen (`draw: "page"`, or `drawnAside()` false on the stub): `createWorld` on the page as today, the
  `.orbitgl` keeps its context, no worker made; `lookOf(opts)` equals the old world's `lookOf(opts)` for the
  install's and the information's options (`main.js` `INFO_WORLD`). Control for everything below.
- W2 `draw: "worker"`: the fake is posted `hello` first (flags without `door3d`; `world.map`/`rings`/`moon` absolute,
  the `planet-2k` map when `small`; `sky`; `tag`; `hue`, `sat`, `ringsOn`, `haze`, `grade` as given), then `canvas`
  with one transferable; `bake()` posts `bake` with an id and resolves only on `baked` with that id (another id
  resolves nothing); `start()` posts `run { on: true }` and `stop()` `run { on: false }`; a page frame posts one
  `view` whose `view` deep-equals the object `draw` built after `structuredClone` (no function in it); `drew { seq }`
  sets `data-drawn` and calls `onDrew` with its `dt`; `calibrate` posts `measure` with two sets and sets `mq` from
  `measured`; `install: drawn in a worker` is said.
- W3 the rule follows the flight's: `drawnAside()` true on the stub (6a's D3 bed: `parallel` false, no
  `userAgentData`, `Worker` and `OffscreenCanvas` given) makes a worker; then one at a time `draw: "page"`,
  `parallel` true, `userAgentData` defined, `gpu: "force"`, no `drawWorker`: none, and the line names the reason
  where a worker was given. `startDoor` returns null with a remote world.
- W4 the fallback: `error` before `up`: `.orbitgl` is a fresh element with the same class and attributes, the
  `slot` still before it, `terminate()` called, the pending `bake()` resolves after the page world's own bake, the
  next `draw` draws on the fresh canvas's context (the stub records it), `install: drawn on the page: the worker
  failed to load`. `up { ok: false, why }`: the same, `why` in the line. `dead` mid-dive on the virtual clock: the
  page world draws the next frame and the shot's `settled` still resolves. No `up` within 5000 ms under the
  automatic rule: the fallback; under `draw: "worker"`: still waiting at 20 s. `lost` after `up`:
  `webglcontextlost` dispatched on the placeholder, the pad `flat`, no fallback.
- W5 the worker side: `world-worker.js` imported in a child with a stub `self` (`postMessage`, `onmessage`,
  `close`) and a fake `OffscreenCanvas` whose context is the stub's recording gl: `hello` then `canvas` posts
  `up { ok: true }`, the shaders compiled with no `"compile"` chore queued, and `compiled { ok, ms }`; a canvas with
  no WebGL2 posts `up { ok: false, why: "no WebGL2 in a worker here" }`; the pictures are fetched from the absolute
  URLs given and no other; `uploadBanded` puts the map on in one `texImage2D` of its full height; `bake { id }` is
  answered by `baked { id }` after the galaxy's four strips, one a frame (the stub counts `requestAnimationFrame`);
  three `view`s in one frame draw once, the last, and post one `drew` with its `seq`; `run { on: false }` stops the
  frame callbacks; `measure` with two sets posts `measured` with two numbers; `resize` sets the canvas's bitmap
  size; a `warn` from `world.js` is posted as `note { kind: "warn" }`; `destroy` calls `close()`.
- W6 the view's wire form: for the install's and the information's options, at `k` 0, 0.5 and 1, with and without
  a `dot0`, the view `draw` builds survives `structuredClone` deep-equal (`look.HUE` still a `Float32Array`), and
  `createWorld`'s `draw` on the stub gl sets the same uniforms from the cloned view as from the original.
- W7 `main.js`'s rule, lifted out as a pure function `ringWaits({ maintenance, saveData, aside, drawnAside, door3d,
  firstVisit })` for the test: `drawnAside` true, `aside` false, `door3d` false, not a first visit: no wait; a first
  visit: wait, 8 s; `door3d` true: wait on every visit, 8 s, as today on Firefox; `drawnAside` false: as today in every
  case (`asideHere ? 9000 : 8000`). The function lives in `assets/js/ring.js` and returns `{ wait, ms }`.

Browser (Playwright; the live job's Firefox under Xvfb on software GL, the Chromium shard for coverage and pixels),
joining `tools/ci/test-map.json`'s `worlds` group with the two new files:

- W8 the governor's measure, told apart from the page's (owner, answer 6b-3a: "careful here that the test is actually
  good and doesn't just default to the old stuff"): on the worker path (the fake answering `up`, the page's frames
  on the virtual clock), `install.js`'s governor fed by `drew { dt }` alone. (a) the worker slow (`drew.dt` 50 ms a
  frame) and the page fast (its own frames 16.7 ms): the density drops as it does on the page path for a 50 ms
  frame. (b) the worker fast (`drew.dt` 16.7 ms) and the page slow (its own frames 50 ms): the density does not drop.
  (c) no `drew` at all for a second: the density holds where it was, never reads the page's period instead. Each
  case also run on the page path as the control: (a)'s page frames at 50 ms drop it there. A build that still reads
  the page's own period fails (a) and (b) both.
- PW1 Firefox, the gate's own browser: `/?preview&gpu=force&fit=skip&draw=worker`, then a click on the install's
  planet: the console carries `install: drawn in a worker`, `install: shaders compiled in N ms`, `install: ready`,
  `first light: compiles aside`, `gpu: the page's context let go`; `#installpad` gains `lit` and the body
  `arrived`; the `.orbitgl`'s `getContext("2d")` throws on the page (a placeholder); back to the door and into the
  information's: `#infopad` gains `lit` and holds the same element. The same with `draw=page`: `install: drawn on
  the page: asked for (draw=page)`, `first light: the ring waits for the compiles`, and the dive lands.
- PW2 pixel identity, Chromium (SwiftShader, `?gpu=force&fit=skip`, 1280x800): a new `tests/world.html` on
  `tests/draw.html`'s shape (#85 batch 3): `still(k, idle)` at `k` 0.3 and 1 with `idle` 7, under `draw=page` and
  `draw=worker` on fresh pages, a screenshot of the canvas's box once `data-drawn` is set, compared pixel for pixel:
  zero differing pixels. Control: `k` 0.3 against 0.6 differs. The grain and the motes are `uTime`'s and `still`
  fixes the clock, so the frame is deterministic; if the two contexts ever differ the test reports the count and a
  diff picture and the owner decides a tolerance (never loosened silently). Edge by hand, `?draw=worker`, once.
- PW3 fallback, live: `world-worker.js` served 404 (as `csp-test`'s F1 serves `main.js` 404) under `draw=worker`:
  `install: drawn on the page: the worker failed to load`, the dive still lands, and `gpu: the page's context let
  go` is not said.
- Every existing live test keeps the page path (`gpu=force` without `draw=worker`), so what they prove is what they
  proved.

### 6b.8 Coverage, CSP, the service worker, the lint and the type check

- Coverage: `world.js` and `install.js` keep their floors from the page-path runs (every existing suite; lines run
  in a worker are never recorded, 6a.8). `remote-world.js` is covered in Chromium by PW2's `draw=worker` page and in
  Node by W2 to W4; `world-worker.js` in Node alone, by W5 (`node-tests.sh`'s V8 coverage; the hook keeps
  `assets/js/*.js`). Batch 2 adds the two floors from three full runs (`coverage.mjs --raise`).
- CSP: nothing to add. Every page carries `worker-src 'self'`; the worker's picture fetches are same-origin
  (`connect-src 'self'`); the worker runs under the page's policy where Firefox carries it into a dedicated worker
  (6a.6).
- `sw.js`: nothing to change. A dedicated worker's fetches go to the service worker controlling the document that
  made it (6a.8); the worker's files are code (`fresh()`), its pictures media (the 36-hour cache), the moon shared
  with the flight's worker.
- The lint: `world-worker.js` and `remote-world.js` import `../door/index.js` alone (the site's rule), hence 6b.6's
  exports; `import.meta.url` is allowed in `assets/js/`; no outside address. `tools/door-markup.mjs` is untouched
  (no markup change). `tools/ci/lint.sh` gains nothing.
- The type check: `index.js` re-exports only; the folder's one `tsconfig` stands.

### 6b.9 Build: three batches, after #85's three

Each a pipeline, reviewed inline as written; tests first, from this section, by an agent that has not seen the
code (the house order of work). Line counts are estimates of new and changed lines, tests included.

1. **The seam** (~350 lines): `world.js`'s `gated`, `warn`, `lookOf` as a pure export, `lost`, `canvas`, `onDrew`;
   `install.js`'s `govern` and the stat behind `onDrew`, `calibrate` as a promise, `shared.world.canvas`,
   `world.lost`; `main.js`'s `ringWaits` lifted out (no behaviour change yet: `drawnAside()` is false until batch 2
   gives `ensure()` a worker to choose); `index.js`'s three exports, `journey.aside()`, the README (6b.6). Tests W1,
   W6, W7. The page path is unchanged throughout: the existing suites prove it.
2. **The worker** (~550 lines): `world-worker.js`, `remote-world.js`, `ensure()`'s choice and `install: drawn …`,
   the fallback, `make` unchored on the worker path, `startDoor`'s refusal, the ring's rule and its line, the
   context let go, the two coverage floors, `test-map.json`. Tests W2 to W5, W8.
3. **The proof** (~300 lines): `tests/world.html`, PW1 to PW3, PERFORMANCE.md "The worker, measured" and
   CAPABILITIES.md brought up to date, M4's numbers when the owner has them.

About 1,200 lines in all: the unaudited count stood at about 6,500 as this was written (the commit hook's figure
since a621f59, #85's batches 1 and 2 in) and would reach about 7,700, under the 10,000 trigger.
**#93's "about 900" (6a.1, question 4b) is low by about a third**, for three reasons the outline did not see: the
per-frame view feed and the governor's measure (6b.3), which the flight did not need because its clock went with it;
the ring's rule and the context let go, which #85 left to this issue; and a browser proof of its own (the flight's
`tests/draw.html` draws no world).

### 6b.10 What the owner measures on a real desktop (M4)

After batch 2, Firefox, private window, `?preview`, then `?preview&draw=page`, the console lines of each: `flight:
drawn in a worker`, `install: drawn in a worker`, `first light: …` (which shape the ring took), `install: shaders
compiled in N ms` (now the worker's time), `gpu: the page's context let go`, `reveal: … longest frame gap N ms`,
`chores at flight ready: …` (held, resting, waited: the page's queue, which should now hold the measure and `touch`
alone), the time at which each way in opens; and on a dive, `install: dive began: resize N ms, first frame N ms`
and `install: first second N frames, worst N ms` (now the worker's count). The eye on the ring, the reveal, the
dive into the install and into the information, and the return, both ways; and whether the world gives way to a
softer picture on a slow frame as it does on the page path (6b.3's expectation). Then a second visit in the same
window (not private): the ring's laps before the door lights. Edge with `?draw=worker` once, for PW2's by-hand half.

### Questions for the owner (#93)

**Owner, 2026-10-28:** 6b-1a; 6b-2a; 6b-3a, on condition that its test tells the two measures apart (W8);
6b-4a, "let's try it", after asking what the 8 s counts from: the cap runs from the door's critical pictures
(`dawn.js`: `crit`, then `after()`), the ring lights as soon as both workers have compiled, after at least one 1.8 s
lap, and 8 s is reached only on a machine that has not compiled by then (today on Firefox: 8 s, on every visit;
on Chromium: 9 s, a first visit only. The owner was first told 9 s on every visit for today, wrongly; corrected
the same day, the answer stands).

**6b-1** The worker's identity (6b.1): **6b-1a** (recommended) the site's own `assets/js/world-worker.js`, because
  the door's worker cannot import the site's world without a slot in a folder Orbit copies, and two workers fall
  back one at a time; **6b-1b** one worker: `draw-worker.js` gains a host-module slot (`hello.modules`, `import()`ed
  there and given the extra canvases and messages), an interface change for Orbit's import to carry.
**6b-2** The page's context after it is let go (6b.6): **6b-2a** (recommended) lose it once both workers are up and
  accept that a flight worker dying after `up` flies painted for the rest of the visit, because a crash after `up`
  is a fault the console reports and the restore is more door surface for it; **6b-2b** lose it, and on a late
  fallback `remote-flight.js` restores it (`fitness.js` `regainGate()`: `restoreContext()`, on which `voyage.js`
  already builds afresh); **6b-2c** keep it, three contexts, against 7a.
**6b-3** The governor's measure on the worker path (6b.3): **6b-3a** (recommended) the worker's own frame period
  (`drew.dt`), the same measure taken on the thread that draws, checked by eye in M4; **6b-3b** the page's own
  period as today, so the governor never gives way on the worker path and a slow machine draws at full density;
  **6b-3c** finish every frame in the worker and time it, a true cost at the price of serialising the dive's
  frames.
**6b-4** A first visit's ring on the worker path (6b.5): **6b-4a** (recommended) the Chromium shape, at least a lap
  and until both workers have compiled or 8 s, because the first dive then finds its world compiled and the lap is
  the ring's anyway; **6b-4b** no wait at all, the compiles finishing behind the lit door and each way in opening as
  its world bakes.

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
  section 4; gaps within two frames close the Safari half with the numbers on #43. *Taken 2026-10-22 on a phone, twice: no
  stall (numbers on #43); no desktop Safari run, the 8 October desktop record already shows 20 ms gaps.*
- **M2, after it (if built):** the real door on the phone with Safari's Web Inspector from a Mac: the console lines
  `flight: warmed in a worker in N ms`, `flight: shaders compiled in N ms` (expected tens of ms where it was hundreds),
  `flight: first second N frames, worst N ms`; then the same with `?warm=off`. The eye on the reveal and on the gate's
  flight, both ways.
- **M3, Firefox, unchanged by this ADR:** nothing to measure until section 6 is funded.

## Questions for the owner

**1** (answered 1a, owner, 2026-10-22) The painted quick sign-out: shorten the leisure proof where the page's compiles are in the background?
  **1a** keep 4 s / 2 s as ADR-0002 12d set them.
  **1b** (recommended) where `gpu().parallel` is true, prove as soon as the world is made and the reveal is drawn in
  (`later` with `after` near 0, which still waits for `drawnIn()`), keeping the delay where compiles stall the page
  (Firefox: the proof's first frames finish the shaders there, and that stall is better late). Risk: a verdict taken on
  a busier page can call a fit machine unfit for the visit; `drawnIn()` and the chores' `quiet()` are the guard, and a
  wrong verdict costs one visit, nothing remembered.
  **1c** prove at once everywhere.
**2** (answered 2a, owner, 2026-10-22: #85) Firefox's full move (section 6): defer to its own issue after M3 (recommended), or fund it now in M3 as its own
  batch?
