# orbit-site

The website for [Orbit](https://github.com/tomlawesome/orbit), served by
GitHub Pages. Plain HTML, CSS and ES modules; no build step.

## Launching soon

While the app is unfinished the site is in its launching-soon mode: `<html … data-soon>` in `index.html`. The door
stands alone: its planets turn but carry no names and open nothing, the way in reads "Launching soon", deep links
(`#install`, `#docs`, `#info`, the demo) land on the door, and none of the journeys are readied (no 3D compiled, none
of their pictures fetched). Remove the `data-soon` attribute and the whole site is back as it was.

## Layout

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
| `assets/js/engine.js` | The flight's canvas engine (orbit `web/src/lib/flight/engine.js`), plus a sideways vanishing point and three more endings |
| `assets/js/timeline.js` | The flight's beats (orbit `web/src/lib/flight/timeline.js`) |
| `assets/js/flight.js` | The dawn's and the dusk's glows, drawn once; the journey between the surfaces |
| `assets/js/pads.js` | The sections — the docs' chart of the sky, its search and its reader, the information page — and the planets on the sunrise |
| `assets/js/install.js` | The dives into a world: the camera goes from a planet on the door to the world it is, and settles in orbit over it. Two worlds use it: the install's (the purple ringed planet; the one line waits in the dark above) and the information's (`main.js`, `INFO_WORLD`: a coral planet, no rings, lit from above, resting as a crescent under the title, dimmed as its scenes are read). Each world has its own tuning, look and framing |
| `assets/js/world.js` | The world, drawn in WebGL2: a ray-traced gas giant, flattened by its spin, under a thin haze, with rings that shade it and are shaded by it, a gold moon, and the galaxy (baked on the GPU); drawn in light, bloomed and tone-mapped |
| `assets/img/install/planet*.webp` | The gas giant's cloud deck: Cassini's map of Jupiter (PIA07782, NASA/JPL/Space Science Institute), regraded to violet by `tools/gas-giant.py --base` (`pip install numpy scipy pillow`) |
| `assets/img/install/orbit*.webp` | The world, still: shown while it loads, and in its place where WebGL2 is not |
| `assets/img/install/rings.png` | The rings: Cassini's natural-colour mosaic across Saturn's rings (PIA08389, NASA/JPL/Space Science Institute) read as a radial profile by `tools/rings.py` |
| `assets/img/install/moon.webp` | The gold moon: NASA's CGI Moon Kit (LRO colour and LOLA elevation; NASA's Scientific Visualization Studio) graded to gold by `tools/moon.py` |
| `assets/img/install/galaxy*.webp` | The Milky Way: NASA's Deep Star Maps 2020 (NASA/Goddard SVS; Gaia DR2: ESA/Gaia/DPAC), brought down from HDR by `tools/galaxy.py` |
| `tools/gas-giant.py` | Writes the cloud deck: regrades a real planet's map (`--base`), or simulates one of its own — jets along irregular bands, storms, eddies |
| `assets/img/door/dawn*.webp` | The door's Earth: the night side from 800 km over the Atlantic, looking east over Europe as the sun comes up — the city lights from NASA's Black Marble (2016), the clouds and land from NASA's Blue Marble — before the light (`dawn-pre`) and with it (`dawn`), in the door's 1600×1000 frame, rows 640–1000 |
| `tools/dawn.py` | Renders them: the air's scattering (molecules, haze, ozone) under a sun just below the horizon, the Earth's shadow included; the clouds as a slab standing up from the map; the cities through the air and under the clouds. Its docstring has the sources and the command |
| `assets/img/door/glow-*.webp`, `assets/img/dusk/glow-*.webp` | The dawn's and the dusk's glows (the zodiacal light, the two fans of rays, the sun's point; the dusk's glow, belt, afterglow and rim), rendered once from their SVG filter graphs (`flight.js`: `DAWN`, `DUSK`) by `tools/glows.cjs` (`NODE_PATH=$(npm root -g) node tools/glows.cjs`, needs Playwright), so the page only shows them |
| `assets/img/door/planet-*.webp` | The door's planets: the install's ringed giant, the information's coral giant, the docs' ice moon and the gold world on the ring, made from the install's own maps and backlit by the sunrise, by `tools/planets.py` (`python3 tools/planets.py`) |
| `assets/js/voyage.js` | The flight's world in WebGL2, under the flight's own canvas (`engine.js` keeps the traffic, the endings and the mark): the door's Earth as a globe that falls away (the same camera, projected on the circle the flight gives the world, so its night side, its lit limb and the crescent that opens are true), the Milky Way, the streaks as light in depth, the star at the end; on the docs' flight, a galaxy in three dimensions (a spiral marched through for its light and dust, with 48,000 stars that pass with their parallax) flown into from outside; bloom, the door's tone curve, grain. Without WebGL2 the flight draws as before |
| `assets/img/docs/milkyway-wide.webp` | The docs page's sky: the last frame of the docs' flight, inside the galaxy looking at its core, drawn once, 3:1 and set to the screen's height as the flight draws it, with no constellations on it by `tools/docsky.cjs` (`NODE_PATH=$(npm root -g) node tools/docsky.cjs`, needs Playwright) |
| `sw.js` | The site's cache, in the visitor's browser: pictures kept 36 hours and served without asking again; the page, code, styles and docs always checked fresh (a cheap "not modified" when unchanged), the last copy used offline. `main.js` also readies each journey in the background once the door is up (the demo's flight, then the install's world, then the docs, then the information's pictures), and each path waits for its own, briefly, before it starts |
| `assets/img/flight/*.webp` | Its Earth: NASA's Black Marble city lights (global, and Europe sharper, where the door looks), the Blue Marble's land and clouds, reduced from the same sources as `tools/dawn.py` |
| `assets/img/launcher/` | The launcher's own screens, sized for the web; the importer refreshes them from the launcher's repository |
| `assets/docs/` | The docs, imported: one JSON page per source and an index of every section, written by `tools/import-docs.mjs` |
| `tools/import-docs.mjs` | Fetches the markdown from the Orbit repositories and sets it as the site's pages (`node tools/import-docs.mjs`, or `--from ../orbit` for a local checkout; needs `marked`) |
| `.github/workflows/import-docs.yml` | Runs the import every night and on request, and commits what changed |
| `.nojekyll` | Pages serves the files as they are |

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

Settings → Pages → Build and deployment: *Deploy from a branch*, `main`,
`/ (root)`. Published at <https://tomlawesome.github.io/orbit-site/>.
Pages builds on each push to `main`; enabling it on a branch that already
has commits does not build until the next push.

## Custom domain

1. `CNAME` at the root with the hostname.
2. DNS: `CNAME` to `tomlawesome.github.io` (apex: `A`/`AAAA` to GitHub Pages).
3. Settings → Pages → Custom domain, then *Enforce HTTPS*.
4. Update the `og:image` tags and the 404's link.
