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
- **Firefox, measured on the owner's machine (current state):**
  - The install world's compile went from about 6.8 s to about 1.3 s after its fallback shaders were made lazy.
  - The flight compiles in about 3.5 s; it is now the largest compile.
  - Both run behind the first-light loading ring, which keeps turning because it is animated on the compositor.

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
  - a world is drawn once, unseen, before its dive, so a driver's first-use stall doesn't land on the dive.
- **Waiting:**
  - a dive waits at most 6 s for its world; after that the page arrives over its poster;
  - a flight waits at most 8 s.
- **Bytes and idle work:**
  - the worlds use the 2k galaxy, the same picture the flight already downloads;
  - idle pages do almost no main-thread work (see the audit commits).

## Paths for compile time (most promising first)

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
