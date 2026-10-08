# Performance: where the time goes, and paths to explore

Written October 2026, after the load-time and audit work. Figures were measured in headless Chromium (software
GPU) unless stated otherwise; Firefox timings are from the owner's machine, read from the console lines the site
prints (`orbit · …`).

## Where the time goes

- **Bytes are not the bottleneck.** A full first visit is about 3.7 MB. Images are about 3.2 MB of that, and the
  text files (HTML, CSS, JS, JSON) are about 200 KB once gzipped. At 20 Mbps, everything is in by about 2.7 s.
- **Shader compilation is.** The 3D worlds are large GLSL programs. On Windows, browsers translate them to HLSL
  and compile them with Direct3D's compiler, which is slow on big shaders and unrolls loops.
  - **Firefox** has no `KHR_parallel_shader_compile` and blocks the page while it compiles.
  - **Chrome and Edge** compile in the background, but a compile still takes seconds there.
  - A private window has no shader cache, so it's the worst case.
- **Firefox, measured on the owner's machine (current state, a private window):**
  - The install world compiles by about 1.7–2.3 s after opening.
  - The page then freezes for about 3 s while the flight compiles (to about 5 s). This is now the largest single cost.
  - Every picture is downloaded during that freeze, decoded just after it, and on the GPU 12–84 ms later.
  - Install and info are ready at about 5.9–6.9 s, the flight at about 6.5–7.6 s (it was 9.0 s and 9.4 s).
  - The freeze runs behind the first-light loading ring, which keeps turning because it is animated on the compositor.

## Already done

- **Early compile:** the journeys start compiling during the first-light loading ring, install first. On a first
  visit, or in a browser that compiles on the page's own thread, the ring keeps running until install and the
  flight have compiled.
- **Smaller and fewer shaders:**
  - the painted galaxy fallback compiles only if the galaxy photograph cannot be loaded;
  - the painted moon fallback was removed;
  - the moon's motion-blur loop no longer forces 12× unrolling;
  - install and info share one world: one compile, one set of textures.
- **Background work:**
  - GPU work is scheduled as chores, and a click hurries only the chosen journey's chores;
  - the chores begin the moment the door is lit. They used to wait 3.4 s for its reveal, but the reveal is carried
    by the compositor, so they cannot stutter it, and the wait only held the pictures back (2.8 s, measured);
  - a world is drawn once, unseen, before its dive, so a driver's first-use stall doesn't land on the dive.
- **Waiting:**
  - a dive waits at most 6 s for its world; after that the page arrives over its poster;
  - a flight waits at most 8 s.
- **Bytes and idle work:**
  - the worlds use the 2k galaxy, the same picture the flight already downloads;
  - idle pages do almost no main-thread work (see the audit commits).

## Paths for compile time (most promising first)

Tried, October 2026:
- **Measuring** (path 1): in Firefox on Windows the translations are small: world render 54K, flight scene 62K,
  galaxy 11K. The size does not show what Direct3D does with them afterwards.
- **Uniform loop bounds** (path 2): every loop in the flight scene, the galaxy and the world render was counted from
  an unset uniform, so Direct3D could not unroll it. Measured against the same code without the change, in Firefox
  on Windows, the sizes and the compile times were the same. Not kept.
  - *Correction (8 October 2026):* a clean A/B on the tests page found otherwise. The probe with its two loops
    rolled compiles in 129 ms against 315 ms (2.4x), in Firefox and in Edge alike, and draws at the same speed. The
    change is now in; see "Rolled loops" below.
- **The docs galaxy compiled apart** (path 3): the galaxy and its stars no longer hold up the flight's compile.
  Chrome and Edge compile them in the background beside it; Firefox compiles them after it, as a chore.
- **What each effect costs the flight's compile** (Firefox on Windows, the scene shader with one effect left out;
  whole: 2.9 s): the streaks and nebula 1.86 s, the star 1.06 s, the Earth 0.9 s, the docs' galaxy and
  constellations 0.6 s, the moon 0.24 s. These add to more than the whole: a big shader costs more than its parts.
  The streaks and nebula alone compile in 0.8 s, everything else alone in 1.05 s.
- **The flight's scene split in two** (from that): the rush (sky, galaxy, nebula, streaks) and what lies over it
  (Earth, moon, star, constellations, the shock), blended exactly. About 1.9 s in place of 2.9 s.
- **Asking for a compile's result later** (`?defer`) does not help in Firefox: it compiles when asked, not before.
- **Where the time goes after compiling:** each picture, the first unseen draw and the measure take well under
  0.2 s each. The remaining cost is the flight's compile; paths 4 and 7 are what is left for it.

1. **Measure each program's translated size first; it's cheap.**
   - `WEBGL_debug_shaders.getTranslatedShaderSource(shader)` returns the HLSL (or other translation) the browser
     actually compiles.
   - Logging its length for every program in `world.js` and `voyage.js`, beside the existing `orbit ·` console
     lines, shows which program and which function dominate.
   - Then every change below can be judged by a number rather than by feel.

2. **Uniform loop bounds, so Direct3D can't unroll.**
   - Loops with a constant upper bound are unrolled by the D3D compiler, even when they `break` early on a uniform.
     Each unrolled copy multiplies the shader's size and compile time.
   - Candidates:
     - `world.js`: `dust()` (30 iterations), the haze march (`N=8`), `stars()` (4 layers).
     - `voyage.js`: the galaxy raymarch (52 steps), `ignite()` (64), `streaks()` (4×2×2 nested), the ciliary and
       spike loops in the star.
   - Rewriting a bound as a uniform (`for (int i = 0; i < uSteps; i++)`) keeps the loop a loop.
   - **The catch:** loops that sample textures with implicit derivatives must stay unrollable. Switch those reads
     to `textureLod`/`textureGrad`, as was done for the moon.
   - Low risk and quick to try; check the result with path 1.

3. **Split the docs galaxy out of the flight.**
   - The galaxy raymarch (`GAL`) and its 48k-star programs (`STARV`/`STARF`) are needed only by the docs flight,
     yet they compile with the rest of the flight.
   - Compile them later, behind a chore. In Firefox they would still need to finish behind a loader, or at the
     docs click with its hold.
   - The demo flight and the general flight would then be ready much sooner.

4. **A lighter first program, then the full one: the "ubershader" approach.**
   - Compile a reduced version of each world shader first, with no dust walk and a simpler haze. Show the dive's
     opening with it, and swap to the full program the moment it finishes compiling.
   - It looks identical in the first frames, where those effects barely show. Shaders are text, so there's no
     download cost, only the extra compile, which runs in the background.

5. **Replace the docs galaxy raymarch with pre-rendered layers.**
   - The raymarched spiral is the most expensive program to compile and to draw.
   - Pre-rendered textures (disc, arms, dust) drawn as a few tilted quads and blended, with the star points kept,
     could look almost the same for a fraction of the shader.
   - Larger art job; check visually against today's flight.

6. **Keep shader sources stable between releases.**
   - Chrome and Edge cache compiled programs on disk, keyed by the exact source text, so returning visitors skip
     compiles.
   - Any change to a shader's text, even a comment inside the GLSL string, invalidates that cache for everyone.
     Batch shader edits rather than shipping small ones often.

7. **Firefox: compile in a worker (`OffscreenCanvas`).**
   - Firefox supports WebGL in workers. A world rendered from a worker blocks the worker, not the page, so the door
     stays fully interactive while it compiles.
   - The rendering loop would have to move into the worker too, so this is a substantial refactor.

8. **WebGPU, much later.**
   - `createRenderPipelineAsync` makes compiling explicitly asynchronous everywhere, and Chrome's WebGPU uses DXC
     (much faster than the old FXC) on Windows.
   - This means rewriting the shaders in WGSL and the renderers against a new API.
   - Worth it only once the effects are settled and browser support is complete.

## Paths for bytes (smaller wins)

| Option | Saving | Notes |
|---|---|---|
| AVIF images (made from the original sources) | ~20–30% of images, ~0.7 MB | Needs the original high-quality sources; several (NASA Earth maps, the galaxy source) live outside the repo. Re-encoding the current WebPs would lose quality. Safari 16.4+. |
| Moon height map, lightly compressed | ~200 KB | `moon.webp`'s alpha is a height map stored losslessly (268 KB of its 403 KB). Crater lighting is sensitive to it, so it needs a side-by-side check. |
| Maintenance mode not loading the journeys' code | ~100 KB gzipped, plus parse time | `main.js` imports every journey statically; skipping them means moving those imports to dynamic `import()`. A moderate restructure. |
| Minifying JS and CSS | ~53 KB gzipped (203 → 150 KB) | Adds a build step to a site that has none. Under 2% of a full visit. |
| Brotli | ~28 KB over gzip | Not available on GitHub Pages; would need a CDN such as Cloudflare in front. |

## Hosting

- GitHub Pages already serves the site through a CDN (Fastly) and gzips text.
- A custom domain behind something like Cloudflare would add brotli, HTTP/3 and control over cache headers.
  - GitHub fixes `max-age` at 10 minutes. `sw.js` already keeps pictures for 36 hours on returning visits.
- Worth doing for the address and for control, not for a noticeable speed change.

## The live door's Earth with dawn.py's clouds (8 October 2026, `?door3d` only, and the flight's Earth)

- The Earth (voyage.js, shared by the door and the flight) now has dawn.py's cloud slab marched through the low air
  (under 15 km: a step every 6 km on rays that reach the ground, at most 40; every 4 km on rays that skim the limb,
  at most 160), the sun's light read from a table made as dawn.py makes it (sunTable, about 20–30 ms of script once),
  and finer maps about the door's view (lights, clouds, land).
- Measured in headless Chromium (SwiftShader) at 1440×900, deviceScaleFactor 2, the door's program alone
  (2880×648 drawn): about 2.5 s a frame, against 0.57 s for the same drawing before the clouds (and 0.15 s for the
  committed door, which drew 1633×367). Most of it is the low air's march with the clouds in it; SwiftShader runs
  the clouds' branch on every step whether or not a pixel needs it, so on a GPU the share is smaller. Not yet
  measured on a GPU; the door's clock asks for twenty frames a second.
- 8 October 2026, later: the sharpest lights, the 500 m Black Marble over the door's own ground (lon 0–20, lat
  40–56), in three tiers of which a page view fetches one, picked by the band's width in device pixels (width ×
  density, to 2×): under 1600 the 120 px a degree (0.62 MB), under 2600 the 180 (1.17 MB), else the 240 (1.80 MB);
  `?door3d` only, the flight drawing the same one. The door's 3-million-pixel cap is gone: it draws at the screen's
  density (to 2×), times three frames once after its first, and over 40 ms a frame comes down by the square root of
  the excess (to half), for the rest of the page view. SwiftShader (software rendering: relative only) at 1440×900,
  deviceScaleFactor 2: 2.9–3.3 s a frame at 2880×648, so it drew at 1×; at 1200×800, 1×: 0.7 s, drawn at 0.5×.

## The Earth's march cheaper, and a ladder: lean first, rich if affordable (8 October 2026)

- Measured on an RTX 3080 (Firefox, 3840×2160 at ratio 1.5): 33 ms a frame for the door's 3.3-million-pixel band,
  about 10 ms a million pixels: far too heavy for a mid-range GPU.
- The slab's march now reads one texel a step instead of three. Each clouds map (global, near) gets a field, made
  once per context by a pass right after the map is put on the GPU (voyage.js: cloudField; RGBA8 at the map's own
  size, with its levels). The field holds the cover remapped as dawn.py does, the same from the level that blurs it
  by 0.16 degrees (its soft cover), and the tops' height. The height is stored as a share of 12.6 km over the slab's
  foot, the most a top can stand: (CL1 - CL0) would clip the tallest. Across the near box's margin the march reads
  both fields and mixes them, as it did the maps. The cities' glow under the clouds is a texture of its own
  (cityGlow: the whole Earth's lights and the near box's, at an eighth of the whole Earth's map). The march reads it
  once a step, and only where there is cloud. The flight makes the fields only under `?door3d`, the only place it
  can draw the rich Earth.
- Steps: a ray that reaches the ground, one every 8 km, at most 24 (was 6 km, 40); a ray that skims the limb, one
  every 6 km, at most 64 (was 4 km, 160); jitter kept. A ray that never comes down among the cloud tops (13.6 km)
  skips the low air's march.
- The ladder is `sceneHead({ slab })`, in two weights:
  - LEAN: the clouds a flat cover on the ground, lit as the ground is, the cities dimmed under them. The door draws
    it first, and the flight always compiles it, so the default site's flight is back to flat clouds and a shorter
    compile.
  - RICH: the slab. The door measures lean (three frames, the mean of the last two). At 10 ms or less it makes rich as
    a chore and measures it, and keeps it at 40 ms or less, asking the flight for the same (voyage.js: wantRich).
    The flight draws lean until its own rich program is made. Otherwise the door stays lean, drawn coarser if over
    40 ms, as before.
  - `&rich` forces rich (still measured); `&lean` forbids it.
- SwiftShader (software rendering: relative only), 1440×900, deviceScaleFactor 2, band 2880×648: lean 1.1 s a frame
  in one load (then stepped to 1×) and 2.0 s in another; rich (forced) 3.3 s; the committed slab 3.3 s. Other runs
  shared the machine, so the noise is about 2×. SwiftShader also pays for every branch on every step, so it shows
  little of the fields' saving. Still to be measured on the RTX 3080.

- 8 October 2026, `?door3d` only: the install's and the information's door planets are drawn by their own world (install.js: `doorPlanets`), its whole pipeline twice a frame into a square five radii a side; over 8 ms a frame (the first 30 timed) it draws them at half scale, and the console says which.

## The dive's click, and the strip small first (8 October 2026)

- Measured on the RTX 3080 (4K at 1.5×): the first second after a click on the install planet drew 60 frames, the
  worst 33 ms; on the information planet 58, the worst 67 ms. At the click the world went from the door's square
  (doorPlanets) to the full screen, and `resize` made its HDR target and bloom chain again at 3.3 Mpx in that frame.
- world.js `resize` now keeps the targets for the last two sizes drawn (keyed by the drawn size; a third lets the one
  drawn longest ago go), so the square and the screen are both kept and the click only changes which is drawn into.
  The screen's are made at `prepare` and drawn once by `touch`; the door's loop has its square's made as a chore
  before its first frame (`fit`); if its square halves (over 8 ms a frame), the screen's are made again as a chore.
  The canvas's own size still changes at the click (the browser's drawing buffer), which no cache here can keep.
  Checked in SwiftShader at 1200×800: the screen's targets made at 5 s (prepare), the square's (90×90) by `fit` just
  before the door's planets went live, and none at the click.
- The information world is not deferred: it is the install's world (install.js: `shared`), compiled and baked once.
- `?door3d`: the city-lights strip loads 120 px a degree first (0.62 MB: all the flight waits for); the device's own
  tier (`theStrip`), if sharper, comes after everything as one chore ("rich") that puts it on the GPU in the door's
  context and the flight's, then fades it in over 1 s in both by the same clock (`uStripMix`, the small one freed
  when the fade ends), so they never show two sharpnesses. The console says `strip: N px a degree in, fading over 1 s`.
- The click is timed: `orbit · install: dive began: resize X ms, first frame Y ms` (likewise `info:`), X the world's
  resize to the screen and Y the shot's first draw, each the page's own time (the GPU's share is not waited for),
  printed before the existing `first second N frames, worst M ms`.

## Firefox: every compile after the reveal, back to back; measures only when the queue is quiet (8 October 2026)

- Firefox compiles shaders on the page's own thread, so each compile freezes the page (owner's machine: the
  install/information world 0.5–1 s at about 2 s after opening, during the reveal, so the loading ring stuttered on
  its second spin; the live door's lean program 0.37 s and its rich one 0.5 s; the planets'; the flight's).
- `COMPILES_ASIDE` (chores.js, from main.js): a probe context asks for `KHR_parallel_shader_compile` and is let go at
  once. Where it is missing, every compile is a chore tagged `"compile"`, and `"compile"` is first in the chores'
  ORDER. They all run back to back once the door's painted reveal is over (`openChores`), before any upload, bake or
  live loop, while only the compositor moves anything (the reveal's fades, the orbits). The compiles are:
  - the install/information world (install.js `prepare`, which makes the world in the chore; `compiled`, `baked` and
    `prepared` are chained off it);
  - the flight (engine.js `warm`, which makes its world in the chore);
  - the door's lean program, and its rich one, compiled up front whatever the ladder decides later, and drawn only if
    the ladder keeps it;
  - the flight's rich OVER program (voyage.js `compileRich`, asked for by the door's rich compile, and drawn only once
    the door has gone rich);
  - the planets' program.

  A journey's own compile carries its journey's tag too (`["compile", "install"]`, `["compile", "flight"]`), so a
  click before the reveal ends still hurries it. On a first visit the ring no longer waits for the compiles on these
  browsers, because they now come after the reveal. Where `COMPILES_ASIDE` is true nothing changes: compiles start in
  the background at once, as before. `&mainthread` forces `COMPILES_ASIDE` false, so the Firefox path can be tried
  in Chromium. Headless Chromium on SwiftShader has no `KHR_parallel_shader_compile` either, so it takes that path
  without the flag.
- `quiet()` (chores.js): resolves once nothing is queued or running and it has stayed so for two animation frames.
  The door's lean and rich measures (door3d.js) and the door planets' 30-frame measure (install.js) wait for it, and
  the loops keep drawing meanwhile. The door planets' window starts again from the next quiet if a chore ran during
  it. Firefox printed `door planets 24.4 ms a frame, so drawn at half scale` because that measure ran under the rich
  compile and the uploads; when quiet it is 0.4–1 ms. The 8 ms rule still stands, but only a quiet measure can trip
  it.
- The side rule: a door planet's world canvas (install.js, `canvas.worldplanet`) is `.near` when its anchor's `.spin`
  has the computed `z-index` 5, as planets3d.js reads it. pads.js holds a change of side until the planet is clear
  of the ring's stroke, so canvas and anchor change together. This replaces the canvas's own `k > 1`.
- Under `?door3d` planets3d.js draws only the docs' moon. The install's and the information's planets are never its
  spheres: the sphere's bright, shadowless rings visibly dimmed when the world took over. Their pictures stay until
  the world canvases are live. `html.planets3d` is still set once the moon is drawn.
- Checked in SwiftShader at 1200×800, 1×:
  - With `&mainthread`, the chores opened at 6.2 s (reveal from 3.4 s). The install/info, door lean, door rich and
    planets compile lines came at 7.9–11.5 s, before every ready or live line (from 12.7 s). Both measures ran with
    the queue empty (door lean 251 ms a frame at 40.6 s; door planets 7.1 ms at 44.5 s, not halved).
  - With the extension emulated (the Edge path), the order was unchanged: compiles at 3.8 s, before the reveal, then
    the journeys ready, then the door.

## Firefox: every compile under the ring; nothing of the GPU's during the reveal; a door-only Earth (8 October 2026)

- The previous entry's placement is reverted. Measured by the owner on Firefox, running every compile after the
  reveal cost about 3 s on the ways in, and the stalls still showed: the drifting stars hitched three times, because
  Firefox stalls even compositor animations while it compiles.
- Where `COMPILES_ASIDE` is false, the compiles now run under the loading ring, before the door is lit, where only the
  ring's runner can show a hitch:
  - `openCompiles()` (chores.js), called at the page's start (main.js), lets the `"compile"` chores run while the rest
    of the queue stays shut until `openChores()`.
  - `compileFirst()` (main.js, at first light) queues every compile at once: the install/information world
    (`prepare`), the flight (`engine.warm`), the docs' galaxy (voyage.js `makeGal`, now a `["compile", "docs"]` chore
    queued with the flight's world), the live door's lean and rich programs and the flight's rich one (door3d.js
    `compileDoor`), and the planets' (planets3d.js `compilePlanets`). door3d.js and planets3d.js are now imported at
    the page's start, not at light. Their canvases, maps and loops still wait for the reveal (`liveDoorOf`).
  - The two passes' small programs (voyage.js `passPrograms`) are compiled with them: the clouds' field with the lean
    weight and the flight's world, the cities' glow with the rich. Before this they compiled on the page's thread at
    their first upload, after the reveal.
  - The ring waits for all of these on every visit (`waitCompiled`, via `compiledAll`, which now holds the door's and
    the docs' galaxy's), capped at 8 s so a failure never holds the door. `minLaps` is unchanged.
- On every browser, the chores (uploads, bakes, first draws) and the live door (`liveDoorOf`) now start at `drawn()`,
  the end of the reveal's painted part, no longer at light. Where `COMPILES_ASIDE` is true the compiles still start in
  the background at once, as before.
- The door-only Earth: voyage.js's scene source is in named parts (`UNIFORMS` tagged by part; `PARTS`: common, sky,
  ignite, streaks, earth, nebula, moon, arrival, shock). `sceneHead({ slab, door: true })` gives common and earth only
  (earth carries its sun table lookup, its map tiers, the slab and the limb), and door3d.js compiles that. The flight's
  SCENE, OVER and rich OVER are byte-identical to before (diffed).
  - Door program (fragment, with its main): lean 28,937 → 16,919 characters; rich 28,952 → 16,934 (−42%).
  - The live band (y ≥ 560 px, 1440×900 at 1×, `&lean`, reduced motion, the pictures hidden), rendered by the new
    program and by HEAD's: mean absolute difference 0.0 per channel, maximum 0.
  - The Firefox compile time is still to be measured on the owner's machine. SwiftShader caches and is not
    representative: 11 ms → 7–9 ms.
- Every compile prints its duration as `<tag>: shaders compiled in N ms`: `install:` and `info:` (world.js
  `compileMs`: from the first compile asked for to the last link status read), `flight:` (voyage.js `made`),
  `docs galaxy:`, and `planets:`. The door's existing `door: lean|rich compiled N ms` lines are unchanged.
- Checked in SwiftShader at 1200×800, 1×, `?preview&door3d`. Every WebGL call was timed against the reveal
  (`__chores().openedAt`).
  - `&mainthread`: compiles opened at 0.6 s. Compile lines: install 2.1 s (52 ms), flight 5.4 s (936 ms), info 5.6 s,
    docs galaxy 6.6 s (95 ms), door lean 6.8 s (438 ms), door rich 7.1 s (186 ms), planets 7.4 s (155 ms). Then the
    body was lit at 8.8 s and the chores opened 2.65 s later. After that: install/info ready 13.5 s, flight ready
    20.4 s, planets live 24.5 s, door live 25.6 s.
    - No WebGL call during the painted reveal, and no compile after it.
    - Before the reveal, the worlds' render targets and ring texture are still made in their compile chores
      (16 textures, 14 framebuffers).
  - With the extension emulated (the Edge path): the journeys' compile lines at 3.9–4.1 s, the body lit at 5.0 s, and
    the chores opened 2.7 s later. Then install ready 10.5 s, flight ready 17.5 s. The door's and the planets'
    compiles came as `"door"` chores after that, as before. No WebGL call during the painted reveal.

## Fewer programs, same picture (8 October 2026)

- Why: measured on five machines (CAPABILITIES.md, "Measured with the tests"), a WebGL2 program costs about
  200–300 ms to compile on the PCs whatever its size. So the number of programs is the cost. On Firefox each compile
  stalls the page; elsewhere they run in the background but still hold up readiness. A first visit under `?door3d`
  compiled about 20 programs.
- What was merged:
  - **One post-process program** in the flight (voyage.js) and in the install/information world (world.js). The
    bloom's down and up steps and the film are now one fragment shader, `POST`, with `uniform int uMode` (0 down,
    1 up, 2 film). Each old `main` is kept as a function (`down()`, `up()`, `film()`), and the uniforms are the union
    of the three. A step points `uHdr` and `uBloom` at the map it reads, so no sampler of the program is ever the
    target it draws into.
  - **The rich Earth's passes folded into the rich program.** The clouds' field and the cities' glow had small
    programs of their own (`FIELD`, `GLOWF`, `passPrograms`), one of each in the door's context and in the flight's.
    Their code is now `PARTS.passes`, in the rich scene head only (`sceneHead({ slab: true })` also defines
    `HAS_PASSES`). The rich program draws them itself: `uPass` 1 or 2, through `PASS_SWITCH`, the first lines of the
    door's `main` and the flight's `OVER_MAIN`. `cloudField(gl, prog, …)` and `cityGlow(gl, prog, …)` take that
    program. A field is made with its map if the rich program is already there, otherwise as soon as the program is
    finished. The glow is made once every map has come. Both are made before the door's rich measure, and before the
    flight's `richOK`.
  - **The probe** (capability.js, `probe()`), the first thing main.js does. It is one throwaway context and the tests'
    probe shader, compiled (twice where compiles are in the background, the second timed) and drawn four times at
    512×512. It is kept for 7 days per browser and screen. It prints
    `probe: compile N ms (background|page thread), M ms per Mpx (fresh|stored)`.
  - **The door compiles only the weight it will draw** (door3d.js). `doorWeight()` predicts the rich Earth at the
    probe's ms per Mpx × the band's Mpx × 0.55:
    - "rich" (≤ 24 ms): the rich program alone, drawn from the first frame, measured, and drawn coarser if it must be.
      Only if it is still over 40 ms at 0.5× is the lean one compiled and drawn instead.
    - "both" (≤ 40 ms), or no probe: as before. Lean first; rich tried by the ladder.
    - "lean": the lean program alone.

    `&rich` and `&lean` still force a weight. The console says which weight was chosen and why:
    `door: weight lean (predicted 174 ms of 40 for the rich, …)`.
  - **The flight compiles only the overlay it will draw** (voyage.js). Where the door is "rich", the rich `OVER` is
    compiled in place of the lean one, with the flight's own fields and glow made before the flight is ready. Where it
    is "lean", the rich one is never made. "both" and the public path are as before.
  - **The docs' galaxy** is now a `["galaxy", "docs"]` chore where compiles are in the background. `"galaxy"` ranks
    after `"door"` and `"measure"` in chores.js ORDER, and the docs' journey still hurries it. On the page's thread it
    stays a `"compile"` chore under the ring. `compiled()` (engine.js) and main.js's wait still don't wait for it on
    the background path.
  - **Counts in the console** (`?door3d` only): each `… compiled in N ms` line gains `(N programs)`, and main.js prints
    `programs compiled before the door: N (…)` once all the ring waits for, the door's first weight and the planets
    are compiled.
- Program counts: linkProgram calls counted per module in headless Chromium at 1200×800, 1×, `?preview&door3d`.
  SwiftShader's probe is 920–1020 ms per Mpx, so it picks "lean".

  | Path | Before (HEAD) | After |
  |---|---|---|
  | Background (`KHR_parallel_shader_compile` emulated), by the time the door is live | 16: world 4, flight 5, docs galaxy 2, the field pass in each context 2, door lean 1, planets 2 | 8: world 2, flight 3, door 1, planets 2. The galaxy's 2 come after the door is live; the probe's 2 are in its own throwaway context |
  | Page thread (`&mainthread`), all under the ring | 20: world 4, flight 5 + rich overlay 1, galaxy 2, the field and glow passes in each context 4, door lean + rich 2, planets 2 | 10: world 2, flight 3, galaxy 2, door 1, planets 2, plus the probe's 1. `&rich` is also 10 (the overlay and the door rich only) |

  A machine whose weight is "both" still compiles the lean and rich door and the flight's rich overlay. That is 12
  on the page thread and 8 + 2 later in the background, against 20 before.
- Same picture, checked in SwiftShader with reduced motion. The live door's canvas was read back (with
  `preserveDrawingBuffer`) after its last ladder line and compared with HEAD's:
  - `?preview&door3d&rich`: 600×144 (drawn at 0.5×), maximum difference 0, 0 pixels differ. This covers the rich
    program and its folded field and glow passes.
  - `&lean`: likewise 0 / 0.
  - The world planets' canvases are not deterministic from one run to the next, even on HEAD against itself (their
    orbit and grain run on time). By eye, HEAD's and this build's were the same.
- Seen on the background path: the galaxy compiled after the door was live (13.3 s against 8.8 s). It still came
  before the door's own lean measure (14.5 s), because `quiet()` waits for the chore queue to be empty.

## Rolled loops (8 October 2026): tried, measured, taken out

- The probe (capability.js `PROBE`, a 16-step march with a 4-octave noise inside) compiles in 315 ms on the laptop
  (Firefox and Edge, Direct3D) and 129 ms with a uniform that is always 0 in each loop's count (the tests'
  `PROBE_ROLLED`), drawing at the same speed; a trivial program compiles in 8-13 ms. On that, every fixed-count loop
  in voyage.js and world.js was given the same `+uZ` (24 loops).
- Measured the same evening, against the unchanged probe in the same run (the laptop ran ~35% faster that run, so
  absolute times mislead): the rich door went from 2.4x the probe to 2.5x, the flight's rich head from 3.2x to 3.0x,
  the lean door from 1.4x to 1.7x; Edge the same. No gain on the real shaders: their cost is not in their loops (the
  probe's is), which is what "Uniform loop bounds (path 2)" above had found. Taken out the same evening. Kept: the
  tests' trivial and rolled-probe cases, and the real flight scene, world render and galaxy in the compile test.
- What this leaves as true: the fixed cost of a program is ~10 ms; a big shader costs more than its parts (the
  effects table above); on a slow compiler the lever is less code compiled before the door.

## Fill the reveal (8 October 2026)

- Why: after the shaders compile under the ring, the door is lit and its reveal plays for about 2.5 s. Until now no GPU
  work ran during it. chores.js opened its queue (`openChores`) only at `drawn()` in main.js, once every painted
  animation of the reveal had finished, because one 40-90 ms upload on the page's thread stutters the ring's stroke,
  which is drawn on that thread. So every upload, bake and first draw the ways in need waited until after the reveal,
  and the ways in opened 0.9 s (Edge) to 1.3 s (Firefox) after it. Measured on the laptop: on Edge, 4.9 s between the
  last compile and the first upload; on Firefox, `held 2940 ms for the reveal`.
- The design: uploads are cut into bands small enough to fit in one frame's slack, one band a frame, during the
  reveal. The mipmaps (30-170 ms for the big maps) are built after the reveal as ordinary chores. No visual change,
  and every texture is byte-identical to before.
  - **Soft chores** (chores.js). `chore(fn, rest, tag, { soft: true })` promises to take under ~5 ms. `openSoft()`
    is called by main.js at `light()`, when the door is lit and the reveal begins. From then until `openChores()`
    (still at `drawn()`), pump() runs only soft chores (and the compiles, where they may run). They run one a frame:
    the next starts on the next animation frame and `setTimeout(0)`, with no 20 ms rest. Once the queue is open they
    are ordinary chores, ranked by their tags as before. A journey chosen hurries them as it hurries the rest.
  - **Bands** (new: upload.js `uploadBanded`). The texture is made at its full size at once (`texImage2D` with no
    data) with LINEAR filtering and the caller's own wrap modes. The picture then goes in with `texSubImage2D`, a band
    of rows at a time, each band a soft chore. Each band is its own small bitmap (`createImageBitmap` of the picture's
    rows, off the page's thread), cut while the band before waits its turn: at most two in flight per picture. A band
    starts at about 1 MB (4096 wide: 64 rows; 2048: 128; 1024: 256; never under 16). The first band is timed: over
    4 ms halves the rest, under 1.5 ms doubles them.
  - **Mipmaps after**. After the last band, one ordinary chore with the same tag makes the mipmaps, sets
    LINEAR_MIPMAP_LINEAR and the caller's anisotropy. Until then the texture is complete at its first level and
    drawable. The helper's promise resolves only then.
  - **Who uses it**: the flight's maps (voyage.js `load`), the install and information worlds' map, rings, moon and
    galaxy photograph (world.js, SRGB8_ALPHA8), the live door's eight maps (door3d.js), and the planets' two maps in
    each of their two contexts (planets3d.js). A map's slab field, the cities' glow, the flight's warm draws and
    `loaded`, the worlds' `baked`, the door's first frame and the planets' first frame all still wait for the
    mipmaps. The sharper lights strip (`sharpStrip`, the last chore of all, never during the reveal) is still put on
    the GPU whole: its one chore serves every context and starts the fade on one clock.
  - **`?holdreveal`** restores the old behaviour exactly, for A/B: `openSoft` is never called, and each picture is put
    on the GPU whole in one ordinary chore, its mipmaps with it.
- What to read in the console:
  - `reveal: N soft chores ran, X ms; longest frame gap Y ms`, printed by main.js at `drawn()`. The gap is measured by
    an animation-frame loop from `light()` to `drawn()`, between consecutive frames; 16.7 ms is a whole frame at
    60 Hz. This is the smoothness proof: compare it with `&holdreveal`.
  - The `chores at … ready` line now says `held N ms for the reveal, of which N soft chores (X ms) during the reveal`.
  - With `?door3d` only, each texture's bands: `upload: lights 4096x2048 in 32 bands, longest 3.1 ms`.
- The test page has a new test, `upload-bands` (tests/t-upload-bands.js). It puts `clouds-near.webp` on the GPU whole
  and in bands, draws each into a target and compares them byte for byte: level 0, then level 2 once both have their
  mipmaps. RGBA8 and SRGB8_ALPHA8 both differ by 0 bytes (headless Chromium).
- Checked in SwiftShader (1200×800, 1×, `?preview&door3d`; correctness only, its timings are not evidence):
  - With reduced motion, the live door's canvas against HEAD's: `&rich` and `&lean` both 600×144, 0 pixels differ.
  - Without it: the `reveal:` line printed 112 soft chores (102 with `&mainthread`, 0 with `&holdreveal`), and
    `install: ready` and `flight: ready` printed. `&holdreveal` ran 12 chores by install ready and 26 by flight ready,
    as HEAD did. No `orbit:` warnings. The sign-in's flight and the install's dive drew.
- Expected: the ways in open at about the reveal's end, about 2.5 s sooner on Edge and about 1 s sooner on Firefox.
  To be confirmed on the laptop, with the `reveal:` line's frame gap no worse than `&holdreveal`'s. SwiftShader's
  timings are not evidence either way.
- Once the queue is open, or a journey is hurried, the bands no longer wait a frame each: they run back to back
  within an 8 ms share of the frame (chores.js: SHARE), then the next frame is waited for. Without that the live
  door's eight maps took 50-220 frames to go in after the reveal, and a click before the flight's maps were in
  waited a frame a band.

- Measured on the laptop in Firefox, level 0, mains, the same evening: compiles done at 5.0 s and 3.9 s (two runs),
  install ready 8.5 and 8.1 s, the flight 9.3 and 8.9 s, from 13.9 and 14.9 s at the start of the day. The reveal
  ran 92-95 bands; its longest frame gap 50 ms in the second run. In the first run one band of the lights map took
  1012 ms (Firefox warning: a texture made empty is cleared on its first partial upload, "this may be slow"); the
  second run cleared every texture in 0-1 ms. Not reproduced; the upload note now says how long the first band's
  bitmap took to come and how long its copy took, so a repeat can be read. A filled allocation (zeros up front) was
  tried and not kept: 50-100 ms a big map on the page thread, worse than the 1 ms clear in the common case.

## The ladder (8 October 2026)

- Why: the live door (`?door3d`) is beautiful on a fast GPU with a background compiler, and costs a slow machine
  dearly. On the laptop (Ryzen 4700U) in Firefox, where every compile stalls the page, its programs add about 1.1 s
  to the loading ring: the door 650 ms, the planets 260, and the flight's rich overlay in place of the lean one about
  400 more. After the reveal its uploads, its first frames and its two live loops run beside the orbits for the rest
  of the visit: the Earth 16-18 ms a frame at 20 a second, the world planets 13-17 ms, dropped to half scale. The
  owner's rule (CAPABILITIES.md): find at the page's start the highest level this machine can carry reliably, and ship
  exactly that.
- The rule (capability.js: `level()`, after the probe, once a page view):
  - 0, still: no WebGL2 or no probe; reduced motion or save-data; compiles on the page's thread (the probe's
    `background` false); or a lean frame predicted over 16 ms.
  - 2, live rich: compiles in the background and the rich predicted at 40 ms or less. The weight is then
    `doorWeight`'s, as before: the rich alone at 24 ms or less, both at 40 or less.
  - 1, live lean: otherwise. The lean weight alone; the rich is never compiled, in the door or the flight.
  - The page-thread rule is the decision, not a threshold: a Windows Firefox pays about 6 s of compiles under the
    ring for the journeys alone, on the desktop and the laptop alike. The live door's own compiles could go nowhere
    but under the ring, and its loops would then run beside a page that stalls on every later compile.
  - The console says it on every page, with the flag or without: `level 0: still (compiles stall the page; probe
    197 ms)`, `level 2: live rich (predicted 12 ms of 40, background compiles)`, `level 1: live lean (rich predicted
    51 ms of 40, lean 14)`.
- What level 0 removes, against `?door3d` before this build (laptop, Firefox):
  - From the ring: the door's and the planets' programs and the flight's rich overlay, about 1.1 s.
  - From the page after it: the door's eight maps and the planets' two maps in each of two contexts, their first
    frames, the strip's sharp tier, and both loops (the Earth's, the world planets').
  - Level 0 is exactly the door without the flag: the painted dawn, the picture planets, the flight with its lean
    Earth (no rich overlay, no sharp strip, no strip at all), the dives from the pictures. Nothing of door3d.js or
    planets3d.js is compiled or made, though under the flag the modules are still fetched.
- How it is gated (`liveDoor()`, capability.js: `?door3d` and level 1 or 2; asked only after the probe):
  - main.js: the door's and the planets' compiles (`compileFirst`, which now waits for the probe, at most its one
    compile, under a ring already running), `liveDoorOf` at the reveal's end, and the programs-count line.
  - voyage.js: the door's weight, the strip and its sharp tier, `uHasS`, and the strip's map.
  - planets3d.js (the planets the worlds draw, `OWN`) and install.js (`doorPlanets`).
  - engine.js still waits for the probe under the flag before the flight's world is made.
- Prove before show (door3d.js). The first frame is drawn into the canvas while it is still unseen (site.css: the
  canvas is at opacity 0 until `.world.live`), measured there (`quiet()` first, then three frames with a read-back),
  decided on (coarser if over 40 ms; with the rich alone, the rich ladder's rules, down to the lean fallback), and
  only then shown: the `live` class, `followDoor`, the `door: live (…)` line. So `door: rich N ms a frame, kept, drawn
  at …` now comes before `door: live (rich)`. With "both", the rich is still tried after the lean is shown.
- The door measured before the world planets. door3d.js's `doorMeasured` resolves once the first measure and its
  decision are made (or at once where the door is not live, has no WebGL2, or fails), and install.js's door-planets
  loop, with its own `door planets … ms a frame` measure, starts only after it. The owner saw the door's rich measure
  read 37 ms beside the world planets and 16 alone. A dive chosen before then is not held: until their first frame,
  the dive goes on from the door's picture planet, swelled, as it did before the live door.
- Flags: `?level=0|1|2` overrides the rule (the owner can see the live door on Firefox with `?level=2`). At level 2
  `&rich` and `&lean` still force the weight; at level 1 the weight is lean whatever they say.
- Checked in SwiftShader (1200×800, 1×; correctness only, its timings are not evidence). It has no
  `KHR_parallel_shader_compile`, so by the rule it is level 0.
  - `?preview&door3d` against HEAD's `?preview`, with reduced motion and the orbits' infinite animations paused at
    the same time: 0 pixels of the 1200×800 differ. No `wl live` or `planets3d` context, and neither
    `html.planets3d` nor `[data-worldplanets]` is set.
  - `&level=2&rich` against HEAD's `&rich`, and `&level=1` against HEAD's `&lean`, with reduced motion: the live
    canvas (600×144) differs by 0 pixels both times. The measure line comes before the live line, and `install: door
    planets live` after both.
- Added in review: with "both", the rich try is measured unseen (drawn into a target of its own, never the canvas), so
  a rich frame is never shown and then taken away; and the world planets wait for that decision too (doorMeasured
  resolves after it), so the rich measure is the door's alone as the lean one is.

## The plan from here (8 October 2026)

One change a build, each gated by a number from the laptop in Firefox (the worst case we own), with Edge and the
desktop as the check that nothing regressed; every build verified pixel-identical where the picture should not change;
CAPABILITIES.md corrected whenever a measurement overturns a belief (as the loops did today).

Targets, laptop, Firefox, first visit: the ring 4 s or under (10 s today); the ways in open at 7 s or under (15 s);
Edge, the Mac and the phone 3 s; after the reveal no frame over 33 ms anywhere.

1. **Rolled loops.** Tried and measured the same day: no gain on the real shaders (above). Taken out.
2. **Chore waiting** (in). The `chores at … ready` line (chores.js: noteChores) measured 1.6 s (Firefox) and 1.3 s
   (Edge) of waiting for an idle moment on the laptop before the flight was ready, the full 120 ms timeout each time.
   Chores now start a frame after the last. The line still prints: the queue's empty time (pictures still coming, or
   decoding) and its rests are told apart, for the next look.
3. **Uploads on Firefox** (in: "Fill the reveal", above). Each map 25-95 ms on the page thread plus its mipmaps, and the door and the flight upload
   the same maps twice. Count and total first; then upload once where both need a map, mipmaps only where a map is
   minified, the smaller tier on weak machines. Expected 1-2 s, and fewer stutters after the reveal.
4. **One context for the door and the flight.** The rich Earth compiled once, its maps uploaded once, the handoff the
   same frame in the same context (which also removes the rich-to-lean fallback caveat). Structural; after the cheap
   ones are measured. Expected ~1 s on the laptop, a cleaner handoff everywhere.
5. **The capability ladder** (in: "The ladder", above). The probe exists. The levels: a still door where the compiler or the GPU cannot carry
   the live one, the classic flight Earth there, everything proved unseen before it shows, and the door's measure taken
   before the world planets start drawing (it read 37 ms beside them, 16 alone). Thresholds from the data of 1-4.
6. **What the ring waits for.** Today every compile. On background compilers the door's own programs and the galaxy
   could come after the reveal; on Firefox they cannot, and the still door is the answer there. Decided after 5.
7. **The smoothness pass.** The frame gaps around the sharp strip's fade, the world planets' drop to half scale, the
   870 ms gap the stall test caught after uploads: measured with the first-second lines, fixed one cause at a time.
8. **The planets in one context.** Deferred: small saving, real structural risk, last.

## Three to see (8 October 2026)

On a warm visit in Edge on the laptop all the work is done by 1.2 s and the ways in open at 3.9 s: the ring finishing
its lap and the reveal, with the ways in held to its end, are the floor. Three changes to that, each behind a flag so
they can be replayed side by side at their own addresses (they combine):
- `?open=early`: where compiles are in the background, every chore and the ways in from the moment the door is lit,
  not the reveal's end (as before 8 October; the reveal's gap line says whether it stayed smooth).
- `?ring=stop`: the ring ends the moment the work is done; the drawn ring takes over from where the runner is.
- `?ring=rush`: the runner speeds up (x3) to finish its lap within about half a second.
