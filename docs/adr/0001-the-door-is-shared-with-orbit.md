# ADR-0001: The door is one folder here, and Orbit pulls it in

**Status:** Accepted (owner, 2026-10-10)
**Date:** 2026-10-10
**Relates to:** Orbit's door, `web/src/lib/flight/` in `ai/orbit`; this
site's `assets/js/`; the nightly docs import (`tools/ci/nightly-import.sh`),
the same pattern in the other direction.

## Context

Orbit, orbit-launcher and orbit-site are parts of one project (owner,
2026-10-10). The door -- the Earth, the dawn and the flight that open both
the site and Orbit's sign-in -- was designed here, on the site, and Orbit
is meant to use the same door.

Today Orbit carries a hand-made port of it: `engine.js`, `timeline.js`,
`voyage.js`, `chores.js` and `sky.js` exist in both repositories, Orbit's
comments cite this site's line numbers, and the copies differ by hundreds
of lines each. Every change to the door here is ported by hand, and the
two drift between ports.

Two things shape the answer. This site has no build step and must stay
plain ES modules, so it cannot consume code from anywhere. Orbit builds
with Vite, which imports plain ES modules as they are, and Orbit adds
things the site does not have (sign-in, claim, identity) and runs its own
CI.

## Decision

Upstream/downstream vendoring with a sync job; the site is upstream.

- The shared door -- the Earth door and the flight, their engine and
  timeline, and the imagery they draw -- lives in one self-contained
  folder in this repository, with one entry point and no imports from the
  site's own modules (`main.js`, `home.js` and the rest of the page glue).
- The planets hub, where each planet is one of the site's sections, stays
  outside the folder: Orbit does not need it.
- What differs between the site and Orbit is passed in as settings, or
  plugged in at named points, never made by editing the shared files.
  The site's own timing amendments become settings; Orbit's sign-in,
  claim and identity screens are its own code calling the entry point.
- Orbit pulls the folder: its own scheduled job copies the folder from
  this site's `main`, unchanged, and opens a merge request in Orbit.
  Orbit pulls, rather than the site pushing, because Orbit adds its own
  features on top of the door and runs its own CI (owner, 2026-10-10):
  Orbit decides when to take a door change, and its pipeline proves the
  change together with its additions before it lands.
- Orbit never edits the copied files, as this site never edits its
  imported docs. A change the door needs is made here.
- The folder is licensed AGPL-3.0, Orbit's licence, as well as under
  the site's own licence (owner, 2026-10-10). The owner holds the
  copyright, so this does not limit running Orbit as a hosted service
  later.

## Alternatives rejected

- **A third repository for the door, consumed by both:** every door
  change becomes a round trip through three repositories, and the site
  would still need a copy-in job, having no build step.
- **A versioned package Orbit's Renovate updates:** adds a publishing
  step to a site that has no releases, for no gain over pulling `main`.
- **git subtree:** manual merges and noisy history, outside the merge
  request flow both repositories gate on.
- **Orbit loading the door from the site at run time:** a self-hosted
  Orbit would break whenever the site is down, and would call home.

## Consequences

- Here: the door's files are separated from the page glue into the
  folder, with settings and plug-in points for what differs, and the
  LICENSE names the folder's second licence.
- In Orbit: an import job, and its door screens rewritten to call the
  folder's entry point in place of the hand-made port.
- A change here that breaks one of Orbit's additions fails Orbit's import
  merge request, not this site's gate. The folder's entry point and
  settings are therefore an interface: change them deliberately.
- The imagery adds its weight to Orbit's image; the folder's existing
  capability tiers let Orbit choose lighter images.
