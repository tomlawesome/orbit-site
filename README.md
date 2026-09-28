# orbit-site

The website for [Orbit](https://github.com/tomlawesome/orbit), served by
GitHub Pages. Plain HTML, CSS and ES modules; no build step.

## Layout

| Path | What |
| --- | --- |
| `index.html` | The door, the sky, the dusk, and the film's chrome |
| `install.html` | The one line, what it needs, what it verifies, where to read more |
| `404.html` | Not found |
| `assets/site.css` | The five theme packs (orbit `web/src/lib/packs.css`) and the rules that spend them, from `flight.css`, `home.css` and `design/v19/home.html` |
| `assets/js/law.js` | The chart law (orbit `web/src/lib/data/chart.js`) |
| `assets/js/data.js` | The sample workspace; fictional; dates are lead times from today |
| `assets/js/sky.js` | Star tiles, dawn and dusk fields, grain, packs |
| `assets/js/home.js` | Dial, galaxy and flight, manifest, drawers, inbox |
| `assets/js/tour.js` | The film: vocabulary, chapters, player, transport |
| `assets/js/main.js` | The switch between the stages |
| `assets/sky.js` | The script `install.html` uses |
| `.nojekyll` | Pages serves the files as they are |

Default pack: after dark. Links are relative; the `og:image` tags and the
404's link are the only absolute URLs.

## Publishing

Settings → Pages → Build and deployment: *Deploy from a branch*, `main`,
`/ (root)`.

## Custom domain

1. `CNAME` at the root with the hostname.
2. DNS: `CNAME` to `tomlawesome.github.io` (apex: `A`/`AAAA` to GitHub Pages).
3. Settings → Pages → Custom domain, then *Enforce HTTPS*.
4. Update the `og:image` tags and the 404's link.
