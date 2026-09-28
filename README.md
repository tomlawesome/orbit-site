# orbit-site

The website for [Orbit](https://github.com/tomlawesome/orbit), served by
GitHub Pages. Plain HTML and CSS, no build step.

## What it is

The site is Orbit. `index.html` is one surface with stages, the way the
app's front door is:

- **the door** — the sign-in's dawn: first light breaks, the ring with
  `orbit` inside it, the gate pill;
- **the sky** — home: the year dial placed by the chart law for a sample
  household, the other households out in the fixed sky (tap one to fly
  there), the manifest whose rows open in place, the create drawer under
  the north star, the inbox with its relay and lanes, the chart key, the
  account card with the five skies, and sign out;
- **the film** — the first-run walk, played over the real elements with
  the veil, the lift, the ratified lines and the transport pill. It plays
  once on arrival; Esc stops it, space pauses it, the ticks jump;
- **the dusk** — the goodbye, and the way back in.

Everything on the sky is live and local: add an item and it lands on the
dial; complete one and it swings out to its next date; accept the relay's
suggestion and it joins the orbit. Nothing is stored beyond the visit.

`install.html`, `launcher.html` and `security.html` are plain pages for
links from elsewhere; the sky's install drawer points at them.

| Path | What |
| --- | --- |
| `index.html` | The door, the sky, the dusk and the film's chrome |
| `assets/site.css` | The five theme packs (from orbit `web/src/lib/packs.css`) and every rule that spends them, carried from `flight.css`, `home.css` and the ratified home mockup |
| `assets/js/law.js` | The chart law: placement, size, bands, dates |
| `assets/js/data.js` | The sample workspace, fictional throughout; every date is a lead time from today |
| `assets/js/sky.js` | The seeded star tiles, the dawn and dusk fields, the grain, the packs |
| `assets/js/home.js` | The dial, the galaxy and the flight, the manifest, the drawers, the inbox |
| `assets/js/tour.js` | The film's vocabulary, its twelve chapters, the player and the transport |
| `assets/js/main.js` | The switch between the stages |
| `assets/sky.js` | The lighter script the docs pages use |
| `assets/img/` | Screens for the docs pages, icons, the social-preview image |
| `.nojekyll` | Tells Pages to serve the files as they are |

Links between pages are relative, so the site works at
`https://tomlawesome.github.io/orbit-site/` and at a custom domain
without changes. The only absolute URLs are the `og:image` tags and the
404 page's home link; update those when the domain changes.

## Publishing

Repository **Settings → Pages → Build and deployment**: source
*Deploy from a branch*, branch `main`, folder `/ (root)`. Every push to
`main` republishes.

## Custom domain

1. Add a file named `CNAME` at the repository root containing just the
   hostname, e.g. `orbit.example.com` (no scheme, no trailing slash).
2. At your DNS provider, add a `CNAME` record for that hostname pointing
   at `tomlawesome.github.io`. For an apex domain (`example.com`) use
   `A`/`AAAA` records to GitHub Pages' published addresses instead.
3. In **Settings → Pages**, enter the same hostname under *Custom
   domain*, wait for the DNS check, then tick *Enforce HTTPS*.
4. Replace `https://tomlawesome.github.io/orbit-site/` in the `og:image`
   tags with the new origin.

## Updating screenshots

The Orbit screens come from `web/tests/fidelity/baselines/` on the
orbit repository's `dev` branch, converted to WebP at quality 82. The
launcher screens come from `docs/assets/screenshots/` in
orbit-launcher. The social preview (`og.png`, 1200×630) is a crop of the
home screen.

Screens should show synthetic data only.
