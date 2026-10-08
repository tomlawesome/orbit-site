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
