# orbit-site

The website for [Orbit](https://github.com/tomlawesome/orbit), served by
GitHub Pages. Plain HTML, CSS and ES modules; no build step.

## Layout

| Path | What |
| --- | --- |
| `index.html` | The sunrise (the hub: three more planets on the ring, each a section, and the one line with *Launch*), the sky, the dusk, the three landings, and the flight's chrome |
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
| `assets/js/pads.js` | The sections — the install's ring and its orbiting stages, the docs' chart of the sky and its search, the information page — and the planets on the sunrise |
| `.nojekyll` | Pages serves the files as they are |

Routes: `#install`, `#docs`, `#info` arrive at a landing; `#key` and `#inbox`
open a drawer on the sky. Demo is the gate (up), install is *Launch* (up),
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
