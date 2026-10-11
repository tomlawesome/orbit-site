# ADR-0003: Two host options on the shared door: the goodbye as the sign-in, and households on the way down

**Status:** Accepted (owner, 2026-10-10: #25 and #26 wanted as host options only; 16a; 11a)
**Date:** 2026-10-10
**Relates to:** #25, #26; ADR-0001; Orbit a4156b47, 768292c9 (#1253).

## Owner decisions

- Both are host options that Orbit turns on. The website keeps its own goodbye and descent: "the site can't just add these in - it will make no sense on the website."
- **11a:** `duskMarkup({ asDawn: true })` also carries the dawn's Earth photo under the dusk's ember rim, as Orbit's goodbye does today ("sign out and sign in use the same photo", 2026-10-07): the dusk loads its `data-href` Earth pictures as the dawn does. This adds to the behaviours and build notes below.
- **3c** (via ai/orbit#1371): the sign-in and the goodbye use their phone layout under 600px wide or under 480px tall, `@media (max-width:599.98px),(max-height:479.98px)` (Material 3 compact width and height), replacing the folder's `max-width:560px`; Orbit matches it.
- The goodbye takes the sign-in's gate spacing, whatever the dawn's rule is (the owner accepted the folder's sign-in door as it is).

Both are options a host turns on. Absent, nothing the site ships changes: not a byte of `duskMarkup()`, not a rule the site's dusk matches, not a number in a descent profile.

## The calls

**#25, one option: `duskMarkup({ asDawn: true })`.** The goodbye wears the sign-in's face: the dawn's glyph (lit ring, discs, the gold planet on its trail) and the farewell hung off the way back in. One decision, not two: the placement only makes sense once the lockup is the sign-in's, and the phone layout needs the farewell inside the ring. Everything the option styles hangs off one class on the root, `#dusk.asdawn`, so the stylesheet cannot touch a dusk without it. The lit look follows the host's `html.rich`, as the dawn's does: the goodbye matches whatever the sign-in looks like.

Picture: `assets/door/img/dawn/planet-gold.webp`, copied from the site's `assets/img/door/planet-gold.webp` (not in the folder today; Orbit keeps its own at `/flight/door/`). The site's CSS keeps pointing at its copy.

**#26, one option: `descend({ homes })`.** `homes` is the list `homeProps(homes)` takes. The descent's props gain `mirrored(homeProps(homes))` on the end, whatever the base profile (`DOWN`, `DOWN_DAWN`, or the one built from `from`). With `from`, the climb's own homes are already mirrored in; a host passes `homes` as well only if the climb did not carry them (both would pass them twice). A pure export, `descentProfile({ onto, from, homes })`, returns the profile `descend()` starts the engine with, so Node can check it.

## Behaviours

Markup (Node, `import { duskMarkup } from "assets/door/index.js"`):

1. Without `asDawn`, `duskMarkup(opts)` is byte-identical to today: `node tools/door-markup.mjs --check` passes against the unchanged `index.html`; the string has no `asdawn`, `planet-gold`, `d-ringlit` or `class="lux"`; `.farewell` is a sibling of `.lockup`.
2. With `asDawn: true`, the root is `<div id="dusk" class="asdawn" hidden>`.
3. The glyph (`#dusk-glyph`) carries `<defs>` with ids `d-ringlit`, `d-disclit`, `d-discwarm`, `d-trail` (the dawn's gradients renamed, so a page with both surfaces has no duplicate ids); two `.lux` discs; two `.ring.lux` circles and one plain `.ring` (`#8791b3`, 2 wide), as the dawn's; no `.runner`.
4. `<g class="tr">` holds the trail path (`M46.5 51.8 A72 72 0 0 1 163 63.5`) and `<image class="world" href="${image("dawn/planet-gold.webp")}" x="145" y="45.5" width="36" height="36"/>`: the planet centred at (163, 63.5), where the site's gold planet sits. No gold `<circle>`.
5. `.farewell` (`.said`, `.sub`, the given or default words) is the last child of `.gate-wrap`, after `gate`; no `.farewell` outside the lockup.
6. `image`, `gate`, `foot`, `farewell`, `indent` behave as before under `asDawn`.

Browser (Playwright, headed Firefox under Xvfb, shape of `tools/ci/pin-test.mjs` + `tests/pin.html`: a page with `door.css`, `dawnMarkup()` and `duskMarkup({ asDawn: true })`, `#dusk` unhidden, `html.rich` set unless said otherwise):

7. At 1280x800 with `body.showdusk.farewell`: the dusk's plain `.ring` has the dawn's ring's centre and width within 1px (`--R` = 368px, ring 265px across); the dusk's gate's top edge is where the dawn's is, within 1px (the row under the ring, the dawn's margin). Without `asDawn` the glyph is 420px wide and the gate sits inside the ring, as today.
8. `.farewell`'s top is 22px below `.gate-wrap`'s bottom, centred on the ring's axis within 1px, fully on screen. Without `asDawn`, its bottom edge is 240px below the viewport's middle (today's rule).
9. With `html.rich`, `.lux` are displayed, the plain ring's stroke is `url("#d-ringlit")` 1.6 wide, `.name` is gradient text (`color` transparent). Without it, `.lux` are `display:none`, the ring `#8791b3` 2 wide, the name `#e9edf8`.
10. Planet after the beat: under `body.showdusk` without `farewell`, `.tr`'s computed opacity is 0; once `farewell` is added it reaches 1 within 1s. With neither class (a goodbye standing alone), it is 1.
11. `.farewell` is opacity 0 under `showdusk` alone, 1 within 1.5s of `farewell`.
12. At 390x844 (`--R` = 265.2px): `.name` is `visibility:hidden`; `.said`'s centre is on the ring's centre within 2px, no wider than .6R; `.sub` sits 26px under the ring's foot within 2px, centred; the gate's top is 24px under `.sub`'s bottom within 2px; no horizontal overflow. Without `asDawn`, today's layout.
13. Reduced motion: `.tr` and `.world` have `animation-name: none`; 7-12 still hold (the planet still waits for the beat, by its transition).
14. Nothing in 7-13 needs the site's `site.css`.

Descent (Node, `import { descentProfile, DOWN, DOWN_DAWN, DOWNDUR, UPDUR, homeProps, mirrored }`):

15. `descentProfile()` and `{ onto: "dusk" }` return `DOWN` itself (`===`); `{ onto: "dawn" }` returns `DOWN_DAWN` itself; `{ from: P }` deep-equals today's `descentFrom(P)` (`DOWN_DAWN`'s fields, `P`'s vanishing point, bearings, ending, chart, tint, `P.props` mirrored).
16. `homes: []` or absent changes nothing in 15.
17. With n `homes`, `props` is the base's followed by exactly n more; the base is not mutated (`DOWN.props.length` unchanged). Prop i is `homeProps(homes)[i]` with `dur = (2000 + (i % 3) * 350) * REV * 0.75`, `t0 = max(0, (UPDUR - (760 + i*380 + 2000 + (i % 3) * 350)) * REV)`, `spin` 0, `REV = DOWNDUR / UPDUR`; `kind`, `name`, `bodies`, `ang`, `z` unchanged. `mirrored(homeProps(homes))` deep-equals those n.
18. `homes` with `from`: `descentFrom(from)`'s props, then the mirrored homes.
19. In the browser, `descend({ homes, at: 5400 })` still fires `released`, `surface`, `farewell` and sets `showdusk`/`farewell` (the pin test's shape); 30 homes do not throw.

## Build notes

- `markup.js`: `duskMarkup` gains `asDawn = false`. A `glyphDefs(prefix)` built from `DEFS_GLYPH` (the dawn passes `""`, output unchanged; the dusk `"d-"`, plus `d-trail`). Under `asDawn`: the root class, the dawn's glyph body without the runner plus the `.tr` trail and planet, and the farewell lines inside `.gate-wrap` (open tag, gate, farewell block, close tag). The default branch is untouched.
- `door.css`: widen, never re-value: every `#door` measure and lit rule (`--R`/`--lift` and the 560px block, `.loginchrome` padding, `.name` size, `.gate-wrap` row and margin, `.gate` size, glyph width, `.lux` display, the lit ring, the lit gate and hover, the name's gradient but not its blur-in) gains `#dusk.asdawn` as a second selector. New under the dusk: `#dusk.asdawn .gate-wrap{position:relative}`; `.world` upright (`transform-origin:163px 63.5px;animation:spinforth 40s linear infinite reverse`); `.tr{transition:opacity .4s ease}` and `body.showdusk:not(.farewell) #dusk.asdawn .lockup .glyph .tr{opacity:0}`; Orbit's farewell rules (flight.css: `top:100%;left:50%;margin-top:22px;width:max-content;max-width:92vw;bottom:auto;right:auto`, centring in `transform` not `translate`); Orbit's phone block (door-phone.css) at the phone breakpoint (owner 3c, below), the ring's stations written as `(.5 + m)R` and `(.14 + m)R`, m the dawn's gate margin; a reduced-motion rule for `.tr`/`.world`. Name `.asdawn` in the header's host contract.
- `img/dawn/planet-gold.webp`: copied from `assets/img/door/`.
- `journey.js`: export `mirrored` and `descentProfile({ onto = "dusk", from = null, homes = [] })` (base as today; `homes.length ? { ...base, props: [...base.props, ...mirrored(homeProps(homes))] } : base`); `descend` takes `homes = []`, keeps it on `descent`, and the `warp` beat calls `descentProfile(descent)`.
- `index.js`: also export `descentProfile`, `DOWN_DAWN`, `mirrored`, `DOWN`, `DOWNDUR`.
- `README.md`: Markup: "`asDawn` dresses the goodbye as the sign-in (Orbit): the dawn's glyph with the gold planet, shown after the farewell beat, the farewell under the way back in (inside the ring on a phone); `#dusk.asdawn` in door.css; needs `img/dawn/planet-gold.webp`. Off, the site's own goodbye." Journey: "`homes`: the other households met again on the way down, `mirrored(homeProps(homes))` added to the props; with `from`, only if the climb did not carry them." Also exported: "`descentProfile({ onto, from, homes })`, the profile `descend` flies (pure, for tests); `DOWN`, `DOWN_DAWN`, `DOWNDUR`, `mirrored(props)`."
- Tests: a Node test for 1-6 and 15-18 (shape of `home-props-test.mjs`); a live page `tests/asdawn.html` for 7-14 and 19 (shape of `pin.html`), at both viewports.
