# Security policy

orbit-site is a static website: HTML, CSS and ES modules served by GitHub
Pages, with no server of its own, no accounts, no forms and no data taken
from a visitor. The demo's workspace is fictional and lives in the page.

## What could go wrong, and what is done about it

- **A changed page.** `main` is written only by a merge on the
  maintainer's GitLab, after the lint and a live browser journey pass, and
  by the nightly docs import; GitHub receives it through a deploy key and
  nothing else writes it. CodeQL scans the JavaScript on every push.
- **A changed doc.** The docs are fetched from the Orbit repositories'
  `main` branches over HTTPS and rendered by the import tool; a page is
  never fetched live by the visitor's browser from a third party.
- **Third-party code.** One script comes from elsewhere: Mermaid, loaded
  from jsDelivr only when a docs page has a diagram to draw, pinned to a
  version and checked against its integrity hash, so a changed file is
  refused rather than run. Fonts come from
  Google Fonts. Everything else is this repository's own, served from the
  same origin. The import and CI dependencies (`marked`, `sharp`,
  `playwright`) never reach a visitor.
- **The service worker** caches pictures for 36 hours and otherwise asks
  for everything fresh; it never serves a cross-origin response from cache.

## Reporting

Open an issue on the
[repository](https://github.com/tomlawesome/orbit-site/issues) or, if it
should not be public, use GitHub's private vulnerability reporting on the
same repository. There is no bounty; reports are read and answered.
