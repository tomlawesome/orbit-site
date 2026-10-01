# orbit-site

The website for [Orbit](https://github.com/tomlawesome/orbit), served by
GitHub Pages. Plain HTML, CSS and ES modules; no build step.

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
| `assets/js/install.js` | The install: into orbit. The camera goes from the purple planet on the door to the world it is, and settles in orbit over it; the one line waits in the dark above |
| `assets/js/world.js` | The world, drawn in WebGL2: a ray-traced gas giant, flattened by its spin, under a thin haze, with rings that shade it and are shaded by it, a gold moon, and the galaxy (baked on the GPU); drawn in light, bloomed and tone-mapped |
| `assets/img/install/planet*.webp` | The gas giant's cloud deck: Cassini's map of Jupiter (PIA07782, NASA/JPL/Space Science Institute), regraded to violet by `tools/gas-giant.py --base` (`pip install numpy scipy pillow`) |
| `assets/img/install/orbit*.webp` | The world, still: shown while it loads, and in its place where WebGL2 is not |
| `tools/gas-giant.py` | Writes the cloud deck: regrades a real planet's map (`--base`), or simulates one of its own — jets along irregular bands, storms, eddies |
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
