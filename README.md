# orbit-site

The website for [Orbit](https://github.com/tomlawesome/orbit), served by
GitHub Pages. Plain HTML, CSS and ES modules; no build step.

It is developed on the maintainer's own GitLab and mirrored to GitHub after
every merge. GitHub Pages serves `main` from the mirror, so the mirror push is
what publishes a change. Nothing is merged on GitHub by hand.

To look at it: serve the root with `node tools/ci/serve.mjs` (the site is then
at `http://localhost:8787/`), and run the quick checks with
`sh tools/ci/lint.sh`. [CONTRIBUTING.md](CONTRIBUTING.md) says how changes are
made.

## Maintenance mode

`<html … data-maintenance="Launching soon">` in `index.html` puts the site in maintenance mode: the door stands
alone, its planets turning but carrying no names and opening nothing, and in place of the way in is the attribute's
message (`Launching soon` now; `Back shortly` if it is left empty). Deep links (`#install`, `#docs`, `#info`, the
demo) land on the door, and none of the journeys are readied (no 3D compiled, none of their pictures fetched).
Remove the attribute and the whole site is back as it was. To see the whole site while the attribute is still set,
add `?preview` to the address.

## Layout

Words used in the table:

- **door**: the first screen, Earth at dawn with the planets that open the site.
- **journey** (or **flight**): the animated trip from one screen to another.
- **landings**: the three screens a journey ends on: install, docs and information.
- **chart law**: the rule that puts each item on the sky. Today is at 12 o'clock, each day of lead time is one
  degree clockwise, and distance from the centre grows with the days left.
- **film**: the guided walk through the demo, played over the real screen.
- **theme pack**: the set of colours for one of the five themes.
- **GPU**: the graphics chip. "Put on the GPU" means a picture is handed to it so it can be drawn.
- **compositor**: the part of the browser that moves things on screen without waiting for the page's own code, so
  an animation carries on while the page is busy.

| Path | What |
| --- | --- |
| `index.html` | The sunrise (the hub: three more planets on their own orbits round the ring, each a section), the sky, the dusk, the three landings, and the flight's chrome |
| `install.html` | Arrives at `./#install` |
| `404.html` | Not found |
| `assets/door/` | The shared door (ADR-0001): the Earth door, the flight, their engine, timeline, stylesheet, markup and imagery, in one self-contained folder Orbit pulls in unchanged. `assets/door/README.md` is its interface. Also licensed AGPL-3.0 (`LICENSE`, section 3) |
| `assets/site.css` | The site's own styles: the five theme packs (orbit `web/src/lib/packs.css`) and the rules that spend them, from `flight.css`, `home.css` and `design/v19/home.html` |
| `assets/fonts/` | The three typefaces, served from the site (#92): Space Grotesk, Inter and JetBrains Mono, each its foundry's latest release trimmed by `tools/fonts.mjs` to one small variable woff2 (latin, the weights the pages use); `fonts.css` holds their `@font-face` rules, each naming its source release (`index.html` and `404.html` link it), and `OFL-*.txt` each family's licence. `jetbrains-mono-latin.woff2` is also the file the door's worker writes with (ADR-0004 6a, `settings.fonts`) |
| `tools/fonts.mjs` | Writes `assets/fonts/` (`npm ci --prefix tools && node tools/fonts.mjs`; needs the network and `unzip`): downloads each family's release, checks its sha256, trims it the same way every time with HarfBuzz's subsetter (`harfbuzzjs`) and packs it with Google's woff2 encoder (`wawoff2`). Its table of releases is the fonts' one pin; Renovate watches the tags |
| `assets/vendor/` | Mermaid's release file (`mermaid-<version>.min.js`, the npm package's `dist/mermaid.min.js`, unchanged) and its licence. `assets/js/pads.js` loads it when a docs page has a diagram; its path there (`MERMAID`) is the version's one pin, with the file's sha384 beside it as the script's integrity (the browser and the lint both refuse a file that does not match), and the commands to add a new one are beside it |
| `assets/js/law.js` | The chart law (orbit `web/src/lib/data/chart.js`) |
| `assets/js/data.js` | The sample workspace; fictional; dates are lead times from today |
| `assets/js/sky.js` | The home sky's star tiles, grain, packs |
| `assets/js/home.js` | Dial, galaxy and flight, manifest, drawers, inbox |
| `assets/js/tour.js` | The film: vocabulary, chapters, player, transport |
| `assets/js/main.js` | The switch between the stages |
| `assets/door/chores.js` | The background work, a piece at a time: each journey's pictures put on the GPU, its shaders checked, its first frames drawn unseen, starting the moment the door is lit; a chosen journey's own pieces go first. Each world also prints how long it took to the console (`orbit · …`) |
| `assets/door/fitness.js` | Whether the page may use the GPU at all, decided once from one context before any other WebGL (a software renderer is refused: the door then draws without it and fetches none of the flight's world), and the fitness test that decides, each visit, whether the flight's world is drawn (`docs/adr/0002-the-door-tests-the-gpu-once-per-visit.md`) |
| `assets/door/capability.js` | What this machine can carry, for the live door only (`?door3d`, on a page whose GPU was accepted): one small timed shader test kept for a week in the browser. It picks the level: the still door, the live door lean, or the live door rich (`CAPABILITIES.md`) |
| `assets/door/upload.js` | Puts a big picture on the GPU a band of rows at a time, so the door's reveal is not held up |
| `assets/js/tilt.js` | On Android phones, the phone's tilt moves the worlds as a mouse pointer would (iOS is never asked) |
| `assets/door/door3d.js` | The live door, while it is tried (add `door3d` to the address): the door's Earth drawn as it is, from the flight's own shader, turning slowly against the stars, its clouds drifting and the sun at the edge of rising; the picture stays until its first frame is drawn |
| `assets/js/planets3d.js` | The live planets, with the live door (`door3d` in the address): the three worlds on the door's orbits drawn as lit spheres (the install's giant from its world's map, with a ring; the docs' moon, grey; the information's red bands), each where the compositor has put its anchor, lit by the sunrise and turning once a lap, on two canvases either side of the ring; the pictures stay until the first frame is drawn; the install's and the information's are handed to their own world once it is ready (install.js: `doorPlanets`), so a dive goes on from the very frame on the door |
| `assets/door/engine.js` | The flight's canvas engine (orbit `web/src/lib/flight/engine.js`), plus a sideways vanishing point and three more endings |
| `assets/door/timeline.js` | The flight's beats (orbit `web/src/lib/flight/timeline.js`) |
| `assets/js/journeys.js` | The site's own flights, made from the door's climb: sideways to the docs and the information, quietly up to the install, past the other households for the demo |
| `assets/door/glows.js`, `assets/door/journey.js` | The dawn's and the dusk's glows, drawn once; the journey between the surfaces |
| `assets/door/dawn.js` | The dawn and the dusk mounted on their markup, and first light: the ring runs while the door's pieces come, then the reveal |
| `assets/js/pads.js` | The sections — the docs' chart of the sky, its search and its reader, the information page — and the planets on the sunrise |
| `assets/js/install.js` | The dives into a world: the camera goes from a planet on the door to the world it is, and settles in orbit over it. Two worlds use it: the install's (the purple ringed planet; the one line waits in the dark above) and the information's (`main.js`, `INFO_WORLD`: a coral planet, no rings, lit from above, resting as a crescent under the title, dimmed as its scenes are read). Each world has its own tuning, look and framing |
| `assets/js/world.js` | The world, drawn in WebGL2: a ray-traced gas giant, flattened by its spin, under a thin haze, with rings that shade it and are shaded by it, a gold moon, and a Milky Way it draws itself (baked on the GPU, no picture); drawn in light, bloomed and tone-mapped |
| `assets/img/install/planet*.webp` | The gas giant's cloud deck: Cassini's map of Jupiter (PIA07782, NASA/JPL/Space Science Institute), regraded to violet by `tools/gas-giant.py --base` (`pip install numpy scipy pillow`) |
| `assets/img/install/orbit*.webp` | The world, still: shown while it loads, and in its place where WebGL2 is not |
| `assets/img/install/rings.png` | The rings: Cassini's natural-colour mosaic across Saturn's rings (PIA08389, NASA/JPL/Space Science Institute) read as a radial profile by `tools/rings.py` |
| `assets/door/img/flight/moon.webp` | The gold moon: NASA's CGI Moon Kit (LRO colour and LOLA elevation; NASA's Scientific Visualization Studio) graded to gold by `tools/moon.py` |
| `tools/gas-giant.py` | Writes the cloud deck: regrades a real planet's map (`--base`), or simulates one of its own — jets along irregular bands, storms, eddies |
| `assets/door/img/dawn/dawn*.webp` | The door's Earth: the night side from 800 km over the Atlantic, looking east over Europe as the sun comes up — the city lights from NASA's Black Marble (2016), the clouds and land from NASA's Blue Marble — before the light (`dawn-pre`) and with it (`dawn`), in the door's 1600×1000 frame, rows 640–1000 |
| `tools/dawn.py` | Renders them: the air's scattering (molecules, haze, ozone) under a sun just below the horizon, the Earth's shadow included; the clouds as a slab standing up from the map; the cities through the air and under the clouds. Its docstring has the sources and the command |
| `assets/door/img/dawn/glow-*.webp`, `assets/door/img/dusk/glow-*.webp` | The dawn's and the dusk's glows (the zodiacal light, the two fans of rays, the sun's point; the dusk's glow, belt, afterglow and rim), rendered once from their SVG filter graphs (`assets/door/glows.js`: `DAWN`, `DUSK`) by `tools/glows.cjs` (`NODE_PATH=$(npm root -g) node tools/glows.cjs`, needs Playwright and `sharp`), so the page only shows them. They are dithered, as Orbit's are (exposure brackets merged to a high-precision opacity, Floyd–Steinberg to 8 bits) and saved lossless, because lossy WebP smooths the dither back into stripes; `tools/ci/glow-banding-test.mjs` holds them to it |
| `assets/img/door/planet-*.webp` | The door's planets: the install's ringed giant, the information's coral giant, the docs' ice moon and the gold world on the ring, made from the install's own maps and backlit by the sunrise, by `tools/planets.py` (`python3 tools/planets.py`) |
| `assets/door/voyage.js` | The flight's world in WebGL2, under the flight's own canvas (`engine.js` keeps the traffic, the endings and the mark): the door's Earth as a globe that falls away (the same camera, projected on the circle the flight gives the world, so its night side, its lit limb and the crescent that opens are true), the Milky Way, the streaks as light in depth, the star at the end; on the docs' flight, a galaxy in three dimensions (a spiral marched through for its light and dust, with 48,000 stars that pass with their parallax) flown into from outside; bloom, the door's tone curve, grain. Without WebGL2 the flight draws as before |
| `assets/img/docs/milkyway-sky.webp` | The docs page's sky: the last frame of the docs' flight, inside the galaxy looking at its core, drawn once, 3:1 and set to the screen's height as the flight draws it, with no constellations on it by `tools/docsky.cjs` (`NODE_PATH=$(npm root -g) node tools/docsky.cjs`, needs Playwright) |
| `assets/img/docs/milkyway-sky-tall.webp` | The same sky for a portrait screen (width to height 10:11 or narrower), where the flight comes to rest further out, above the disc, the whole spiral filling the height: drawn by the same tool at the widest portrait shape (`node tools/docsky.cjs --tall`) and set to the screen's height like the wide one |
| `sw.js` | The site's cache, in the visitor's browser: pictures kept 36 hours and served without asking again; the page, code, styles and docs always checked fresh (a cheap "not modified" when unchanged), the last copy used offline. `main.js` also readies each journey in the background once the door is up (the demo's flight, then the install's world, then the docs, then the information's pictures), and each path waits for its own, briefly, before it starts |
| `assets/door/img/flight/*.webp` | Its Earth: NASA's Black Marble city lights (global, and Europe sharper, where the door looks), the Blue Marble's land and clouds, reduced from the same sources as `tools/dawn.py` |
| `assets/door/img/dawn/*-near.webp` | The live door's Earth, near: the patch it looks at (lon -25 to 45, lat 28 to 66) cut from NASA's full-resolution maps — the Blue Marble's clouds at 48 px a degree, the Black Marble's lights (2016, 3 km) and the Blue Marble's land at their own 37.5 and 15 — so the clouds and cities stay as sharp as the picture's; the flight's global maps stay for the rest of the globe; `lights-strip-{240,180,120}.webp` are the 500 m lights over the door's own ground (lon 0 to 20, lat 40 to 56) at three sharpnesses, of which the device's band width picks one |
| `tools/doorcrop.py` | Cuts them (`python3 tools/doorcrop.py`; `pip install pillow`): each cloud hemisphere is a 211 MB PNG, so they can be given one at a time, the strips kept with `--strips`. Its docstring has the sources, the box and the command |
| `assets/docs/` | The docs, imported: one JSON page per source and an index of every section, written by `tools/import-docs.mjs`; the pictures they show are copied into `assets/docs/img/`, each named by its content hash (`<16 hex>.png`), so the page loads none from another site |
| `tools/import-docs.mjs` | Fetches the markdown from the Orbit repositories and sets it as the site's pages (`npm ci --prefix tools --ignore-scripts && node tools/import-docs.mjs`, or `--from ../orbit` for a local checkout, `--out DIR` to write elsewhere; needs `marked`; the sources it reads are listed in `tools/docs-sources.json`) |
| `.gitlab-ci.yml` | The pipeline on GitLab: the lint, the live tests, the nightly docs import (an import job, then a publish job) and the weekly Renovate run. The live tests run in `live:firefox` (2 shards) and `live:chromium` (3 shards) side by side, from the start, each running only the tests the change touches (everything on promotion to `main`); `lint:test` and `lint:import` run their tests only when the change touches the tooling or the import; `coverage` takes the same selection and holds the lint's and Chromium's coverage to the floors (every file on a full run, only the changed files on a partial one), keeping its records 7 days so floors can be raised from CI runs |
| `tools/door-markup.mjs` | Writes the door's markup into `index.html` from `assets/door/markup.js` (`node tools/door-markup.mjs`; `--check` is what the lint runs) |
| `tools/ci/` | What the pipeline runs: `lint.sh`, `serve.mjs` (the site as Pages serves it), `journey.mjs` (the live journey), the tests the `lint` job runs (`lint-test.sh`, the lint's own test, has a job of its own, `lint:test`; the rest, about forty, in Node with a stand-in page and no browser: a few for the checks and the import, most for how the door and the site behave), the tests the live jobs run in a real Firefox and Chromium (`journey.mjs` and the `upload`, `dawn`, `asdawn`, `phone-door`, `door-lows` and `site-browser` tests, among others; the `pin` test is a Node test now), `live-run.mjs`, the live jobs' one entry point and `journey-local.sh`'s: it picks a change's tests from the map, takes its shard's share and runs them one after another against one site server and one browser (`live-lib.mjs` holds the free-port probe and the connect-or-launch the tests share), `door-timing.mjs` (by hand: how long the door takes in a real browser, before and after a change), `nightly-import.sh`, which runs the docs import every night with no token and hands the pages on as an artifact, and `nightly-publish.sh`, which fetches that artifact itself, checks every entry, the docs' shape (`docs-shape.mjs`, against `tools/docs-sources.json`) and their markup against an allow-list (`docs-markup.mjs`) and, when anything changed, opens a merge request into `main` that merges itself once the checks pass (two jobs so the code the import runs never sits beside the token). `test-map.json` says which browser tests a change runs, `test-select.mjs` prints the selection for a change (`node tools/ci/test-select.mjs --base dev`; `--json` also gives the changed paths, which the `coverage` job reads), and the lint keeps the map complete; merge requests run the tests their change touches and promotion to `main` runs everything; by hand, `journey-local.sh` runs what changed against `dev` and `journey-local.sh --all` is the full run; the map's `hand` list names the tests run by hand (`docsky-test.mjs`), so the lint knows they are not lost |
| `tools/ci/coverage-floors.json`, `coverage.mjs`, `coverage-run.sh`, `coverage-fetch.sh` | Which lines of the site's JavaScript the tests run, file by file, and the floor each file must keep. Chromium says which JavaScript ran (V8's own coverage, through Playwright, `coverage-hook.mjs`) in every browser test `live:chromium` runs, and Node says the same for its tests (`node-tests.sh`); `coverage.mjs` turns both into lines and fails the job if a file is below its floor, no dependency. Given the job's selection (`--selection`), a full run (promotion, `LIVE_ALL=true`, a door or unmapped change) holds every file to its floor; a partial run holds only the changed files, whose tests all ran, and reports the rest as not measured in full. Floors come from three full CI runs, never local ones: `sh tools/ci/coverage-fetch.sh JOB JOB JOB` downloads those `coverage` jobs' records into `coverage/ci-<id>/` (`coverage/` is ignored by git) and prints `node tools/ci/coverage.mjs --raise coverage/ci-A coverage/ci-B coverage/ci-C`, which raises each file to the lowest percent it reached in any run, only ever raises, and refuses a partial run; a floor is never lowered to pass, and a file that cannot sensibly be covered says why in `reasons`. `sh tools/ci/coverage-run.sh` is the full local run (the Node tests, every browser test in Chromium, the check) |
| `.github/workflows/codeql.yml` | CodeQL scans the JavaScript on the GitHub mirror |
| `renovate.json` | What Renovate watches for newer versions of the pipeline's images, the import tool's packages, the GitHub Actions (CodeQL) and the pinned Mermaid (a custom pattern on `assets/js/pads.js`) |
| `CONTRIBUTING.md`, `SECURITY.md` | How changes are made; how to report a security problem |
| `LICENSE` | The licence, with the parts that carry their own terms: the NASA imagery (public domain), the imported docs (AGPL-3.0), and the shared door under `assets/door/`, which is AGPL-3.0 as well as the site's own |
| `.nojekyll` | Pages serves the files as they are |
| `PERFORMANCE.md` | Where a first visit's time goes, what has been measured and tried, and the paths left to explore |
| `CAPABILITIES.md` | The capability ladder: what a browser can tell us, the live door's probe, the levels (still, live lean, live rich) and the proof each needs, where the machines measured so far land, and how to test on more |
| `tests/` | The machine tests: eight small tests, one task each, run from one page (`tests/index.html`). They are `machine` (what the browser says of the machine), `compile` (shader compile times, the real Earth shaders included), `draw` (draw speed at this screen's band), `upload` (map upload times), `upload-bands` (a picture put on in bands against the same picture put on whole, byte for byte), `stall` (whether a compile stalls the page), `worker` (whether a worker can compile without stalling the page) and `network` (the line's speed). The runner page runs them all and copies one report. Open on any device, Run all, Copy, send the text. `tests/crop.html` is used by the CI upload check, `tests/draw.html` by the check that the flight drawn in a worker is the flight drawn on the page, pixel for pixel (`draw-pixels-test.mjs`, in Chromium; its pictures of a difference are kept in `shots/`), `tests/world.html` by the same check for the install's world (`world-pixels-test.mjs`) |

Routes: `#install`, `#docs`, `#info` arrive at a landing; `#docs/<source>` and
`#docs/<source>/<heading>` open a page of the docs; `#key` and `#inbox`
open a drawer on the sky. Demo is the gate (up), install is the purple planet (up),
docs fly right, information flies left; *the dawn* descends back.

What a visit changes on the sky (adds, completions, snoozes, accepted or
dismissed suggestions, the chosen sky) is kept in that browser's local
storage and nowhere else; *reset the site* in the account card clears it.
The walk is optional, and puts the sky back as it found it when it ends.

Default pack: after dark. Links are relative; the `og:image` tags and the
404's link are the only absolute URLs.

## Approved third-party content

- NASA imagery (Black Marble, Blue Marble, Cassini, LRO): public domain,
  credited in the layout table above and in `LICENSE`.
- The typefaces in `assets/fonts/` (#92), each under the SIL Open Font License 1.1 (its `OFL-*.txt` beside it, from
  the same release): Space Grotesk 2.0.0 (the Space Grotesk Project Authors), Inter 4.1 (the Inter Project Authors)
  and JetBrains Mono 2.304 (the JetBrains Mono Project Authors), each from its project's GitHub release, trimmed by
  `tools/fonts.mjs` (a modified version, as the licence allows; none of the three reserves its name). The releases,
  their sha256 and how they are trimmed are in that script alone; `fonts.css` names each face's release.
- Mermaid 12.2.0 (MIT, Knut Sveidqvist and contributors), `assets/vendor/`, from the npm registry's tarball, checked
  against its published integrity. Its one file carries other projects' code under their own terms: mostly MIT and
  ISC (d3, cytoscape, KaTeX, lodash, dagre and others), BSD-3-Clause (parts of d3, d3-sankey), Apache-2.0
  (chevrotain), DOMPurify (Apache-2.0 or MPL-2.0), robust-predicates (Unlicense) and elkjs (Eclipse Public License
  2.0; its source: https://github.com/kieler/elkjs and the Eclipse ELK project). Pinned by its path in
  `assets/js/pads.js` alone, with its sha384 beside it; Renovate watches it (`renovate.json`), and a bump also sets the
  integrity beside the path.
- `marked` (MIT), `sharp` (Apache-2.0; the glow tool and its test only), `js-yaml`
  (MIT; the lint reads `.gitlab-ci.yml` with it), `typescript` (Apache-2.0; the lint's door
  type check only, #30), `harfbuzzjs` (MIT) and `wawoff2` (MIT; `tools/fonts.mjs` only, by hand, #92) and
  `playwright` (Apache-2.0; CI only).
  None ships to a visitor. `marked`, `sharp`, `js-yaml`, `typescript`, `harfbuzzjs` and `wawoff2` are pinned in
  `tools/package.json` and nowhere else; `playwright` by `PLAYWRIGHT_VERSION`
  and `PLAYWRIGHT_IMAGE` in `.gitlab-ci.yml`.

## Publishing

A change reaches the site through a merge request on GitLab: `dev` to `main`
for the work, and for the nightly docs import a merge request straight into `main`
(`tools/ci/nightly-publish.sh`), which merges itself once the checks pass.
When it merges, GitLab pushes `main` to the GitHub mirror, and that push is
the release. Nobody pushes `main` by hand.

On GitHub, Settings → Pages → Build and deployment is set to *Deploy from a
branch*, `main`, `/ (root)`. Published at
<https://tomlawesome.github.io/orbit-site/>. Pages builds on each push to
`main`; enabling it on a branch that already has commits does not build until
the next push.

## Custom domain

Not set up: there is no `CNAME` file. If it is ever done:

1. `CNAME` at the root with the hostname.
2. DNS: `CNAME` to `tomlawesome.github.io` (apex: `A`/`AAAA` to GitHub Pages).
3. Settings → Pages → Custom domain, then *Enforce HTTPS*.
4. Update the `og:image` tags and the 404's link.
