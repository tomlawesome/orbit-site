# orbit-site

The website for [Orbit](https://github.com/tomlawesome/orbit), served by
GitHub Pages. Plain HTML and CSS, no build step.

## Layout

| Path | What |
| --- | --- |
| `index.html` | Landing page |
| `install.html` | Installation guide |
| `launcher.html` | The launcher |
| `security.html` | Security and privacy |
| `404.html` | Not-found page (Pages serves it automatically) |
| `assets/site.css` | The five theme packs (carried from orbit `web/src/lib/packs.css`) and every rule that spends them |
| `assets/sky.js` | The seeded sky, the grain, the live year dial, the sky switcher, the transport and the reader |
| `assets/img/` | Screens as WebP, icons, the social-preview image |
| `.nojekyll` | Tells Pages to serve the files as they are |

Links between pages are relative, so the site works at
`https://tomlawesome.github.io/orbit-site/` and at a custom domain
without changes. The only absolute URLs are the `og:image` tags in each
page's `<head>`; update those when the domain changes.

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
