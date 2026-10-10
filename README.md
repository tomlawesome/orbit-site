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
| `assets/site.css` | The five theme packs (orbit `web/src/lib/packs.css`) and the rules that spend them, from `flight.css`, `home.css` and `design/v19/home.html` |
| `assets/js/law.js` | The chart law (orbit `web/src/lib/data/chart.js`) |
| `assets/js/data.js` | The sample workspace; fictional; dates are lead times from today |
| `assets/js/sky.js` | Star tiles, dawn and dusk fields, grain, packs |
| `assets/js/home.js` | Dial, galaxy and flight, manifest, drawers, inbox |
| `assets/js/tour.js` | The film: vocabulary, chapters, player, transport |
| `assets/js/main.js` | The switch between the stages |
| `assets/door/chores.js` | The background work, a piece at a time: each journey's pictures put on the GPU, its shaders checked, its first frames drawn unseen, starting the moment the door is lit; a chosen journey's own pieces go first. Each world also prints how long it took to the console (`orbit · …`) |
| `assets/door/capability.js` | What this machine can carry, found by one small timed shader test at the page's start and kept for a week in the browser. It picks the level: the still door, the live door lean, or the live door rich (`CAPABILITIES.md`) |
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
| `assets/door/img/dawn/glow-*.webp`, `assets/door/img/dusk/glow-*.webp` | The dawn's and the dusk's glows (the zodiacal light, the two fans of rays, the sun's point; the dusk's glow, belt, afterglow and rim), rendered once from their SVG filter graphs (`assets/door/glows.js`: `DAWN`, `DUSK`) by `tools/glows.cjs` (`NODE_PATH=$(npm root -g) node tools/glows.cjs`, needs Playwright), so the page only shows them |
| `assets/img/door/planet-*.webp` | The door's planets: the install's ringed giant, the information's coral giant, the docs' ice moon and the gold world on the ring, made from the install's own maps and backlit by the sunrise, by `tools/planets.py` (`python3 tools/planets.py`) |
| `assets/door/voyage.js` | The flight's world in WebGL2, under the flight's own canvas (`engine.js` keeps the traffic, the endings and the mark): the door's Earth as a globe that falls away (the same camera, projected on the circle the flight gives the world, so its night side, its lit limb and the crescent that opens are true), the Milky Way, the streaks as light in depth, the star at the end; on the docs' flight, a galaxy in three dimensions (a spiral marched through for its light and dust, with 48,000 stars that pass with their parallax) flown into from outside; bloom, the door's tone curve, grain. Without WebGL2 the flight draws as before |
| `assets/img/docs/milkyway-sky.webp` | The docs page's sky: the last frame of the docs' flight, inside the galaxy looking at its core, drawn once, 3:1 and set to the screen's height as the flight draws it, with no constellations on it by `tools/docsky.cjs` (`NODE_PATH=$(npm root -g) node tools/docsky.cjs`, needs Playwright) |
| `sw.js` | The site's cache, in the visitor's browser: pictures kept 36 hours and served without asking again; the page, code, styles and docs always checked fresh (a cheap "not modified" when unchanged), the last copy used offline. `main.js` also readies each journey in the background once the door is up (the demo's flight, then the install's world, then the docs, then the information's pictures), and each path waits for its own, briefly, before it starts |
| `assets/door/img/flight/*.webp` | Its Earth: NASA's Black Marble city lights (global, and Europe sharper, where the door looks), the Blue Marble's land and clouds, reduced from the same sources as `tools/dawn.py` |
| `assets/door/img/dawn/*-near.webp` | The live door's Earth, near: the patch it looks at (lon -25 to 45, lat 28 to 66) cut from NASA's full-resolution maps — the Blue Marble's clouds at 48 px a degree, the Black Marble's lights (2016, 3 km) and the Blue Marble's land at their own 37.5 and 15 — so the clouds and cities stay as sharp as the picture's; the flight's global maps stay for the rest of the globe; `lights-strip-{240,180,120}.webp` are the 500 m lights over the door's own ground (lon 0 to 20, lat 40 to 56) at three sharpnesses, of which the device's band width picks one |
| `tools/doorcrop.py` | Cuts them (`python3 tools/doorcrop.py`; `pip install pillow`): each cloud hemisphere is a 211 MB PNG, so they can be given one at a time, the strips kept with `--strips`. Its docstring has the sources, the box and the command |
| `assets/img/launcher/` | The launcher's own screens, sized for the web; the importer refreshes them from the launcher's repository |
| `assets/docs/` | The docs, imported: one JSON page per source and an index of every section, written by `tools/import-docs.mjs` |
| `tools/import-docs.mjs` | Fetches the markdown from the Orbit repositories and sets it as the site's pages (`node tools/import-docs.mjs`, or `--from ../orbit` for a local checkout; needs `marked`) |
| `.gitlab-ci.yml` | The pipeline on GitLab: the lint, the live journey in Firefox, the nightly docs import and the weekly Renovate run |
| `tools/ci/` | What the pipeline runs: `lint.sh`, `serve.mjs` (the site as Pages serves it), `journey.mjs` (the live journey), `upload-test.mjs`, the small tests of the checks themselves, and `nightly-import.sh`, which runs the docs import every night and, when anything changed, opens a merge request into `main` that merges itself once the checks pass |
| `.github/workflows/codeql.yml` | CodeQL scans the JavaScript on the GitHub mirror |
| `renovate.json` | What Renovate watches for newer versions of the pipeline's images and the import tool's packages |
| `CONTRIBUTING.md`, `SECURITY.md` | How changes are made; how to report a security problem |
| `LICENSE` | The licence, with the parts that carry their own terms |
| `.nojekyll` | Pages serves the files as they are |
| `PERFORMANCE.md` | Where a first visit's time goes, what has been measured and tried, and the paths left to explore |
| `CAPABILITIES.md` | The capability ladder: what a browser can tell us, the probe at 0 s, the levels (still, live lean, live rich) and the proof each needs, where the machines measured so far land, and how to test on more |
| `tests/` | The machine tests: eight small tests, one task each, run from one page (`tests/index.html`). They are `machine` (what the browser says of the machine), `compile` (shader compile times, the real Earth shaders included), `draw` (draw speed at this screen's band), `upload` (map upload times), `upload-bands` (a picture put on in bands against the same picture put on whole, byte for byte), `stall` (whether a compile stalls the page), `worker` (whether a worker can compile without stalling the page) and `network` (the line's speed). The runner page runs them all and copies one report. Open on any device, Run all, Copy, send the text. `tests/crop.html` is used by the CI upload check |

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

## Publishing

A change reaches the site through a `dev` to `main` merge request on GitLab.
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
