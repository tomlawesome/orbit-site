# ADR-0006: The browser's Back follows the site's own back controls

**Status:** Proposed 2026-10-31 (design; nothing built yet)
**Date:** 2026-10-31
**Relates to:** #117 (Browser Back leaves the site instead of going back to the door); #107 (the Chromium journey's
"Back mid-flight" flake: the click, not Back); beb49e4 (Back and Forward after a journey from the door); ADR-0005 (which
tests a change runs).

## Context

The owner, 2026-10-31: "pressing back on the browser tab makes the user leave the site entirely"; "to be clear, the
BROWSER back button. The 'Your sky' back button works fine"; which case: "I forgot." The bar: smooth, from the visitor's
side, on Chromium, Firefox and Safari, phone Safari first.

What the code does today (`assets/js/main.js`, `home.js`, `pads.js`), checked:

- A journey from the door (`flyToPad`, `launch`) pushes one entry, `{ orbit: 1 }` with the landing's address (`step`).
  `popstate` (`onPop`) flies home on Back and out again on Forward; a Back during a flight waits for the landing (`after`).
  The in-site "— the dawn" controls call `history.back()` when that state is there, else fly home directly (`goBack`).
- But the landing then rewrites its address with no state: `goToWorld` (`replaceState(null, "", "#install")`) and the
  flights' `land()` (`#docs`, `#info`). The state is gone, so "— the dawn" takes the direct way and sets the landing's
  entry to `/`: two door entries in a row. The next Back at the door does nothing (`onPop` with the door current), and the
  one after leaves the site. The demo's `land()` keeps its state, which is why "— the dawn" from the sky works: the
  owner's "the 'Your sky' back button works fine".
- Inside the demo, flying to another household's sky (`home.js` `flyTo`, from a mini system or a chip) adds no entry.
  The corner "— your sky" flies back; the browser's Back skips the whole demo: to the door, or off the site.
- Arriving straight at a landing (`#install`, `#docs`, `#info`, `#home`, or `/` with the session's `orbit-site-arrived`
  flag) goes through `arrivePad` or `arrive` with no entry below it. Back leaves the site. A reload of a landing flown
  to from the door keeps its entry's state (the browser keeps it), so Back after that reload already flies home.
- The docs push their own entries per page read (`pads.js` `open`, `close`, with `{ docs, anchor }` or null) and handle
  their own `popstate` while the pad is shown. The drawers (`#key`, `#inbox`) and the walk (`tour.js`, which calls
  `home.flyTo` and `restoreState`) add nothing.
- Signing out (`signOut`) touches no entry: the sky's entry stays current under the goodbye, so Back there is a dead
  press, then leaves.

The browsers' rule that shapes the design: **Chromium and WebKit skip, on the Back and Forward buttons, an entry a page
added without a user activation** (Chromium's history manipulation intervention, since 2019: the entry the page was on
is marked skippable when the page pushes without activation; WebKit's, 2022: the pushed item is flagged and skipped on
`goBack`). Both apply to the browser's buttons only; `history.back()` and `go()` still reach the entries. So an entry is
worth adding only from a click or a key, and an entry added on load is worth nothing on the owner's browsers.

## Standard patterns

- **Up versus Back** (Android's navigation model, the pattern the site already follows): the browser's Back goes to the
  previous entry; the site's corner controls are Up, to the parent place (the door, or the visitor's own sky). Up acts
  as Back when the previous entries are the site's own, so the two never disagree about where the visitor lands.
- **One history entry per place the visitor chose, its state saying what it is** (the hash-router shape: the address
  names the landing, the state carries what the address does not). The state carries `orbit`, the number of Back
  presses to the door's entry, so Up is `history.go(-orbit)`, never a guess.
- **A deep link gets no synthetic parent entry.** The "replaceState the parent, pushState the child on load" pattern is
  what the two interventions above exist to defeat; here it would not work, and where it did it would hold a visitor who
  came from a search result one press longer. A direct arrival is a visit that began at that landing: Back leaves, as on
  any site; "— the dawn" is the way to the door.
- **A navigation that arrives mid-journey is kept and run when the journey lands** (the `after` queue main.js has; the
  demo's sky flight gets the same).

## Decision

1. **The state's `orbit` counts the Back presses to the door.** The door's own entry carries no state. A journey from the
   door pushes `{ orbit: 1 }` (as today). An entry pushed above a landing carries its parent's `orbit + 1` when the
   parent's is 1 or more, else `0`: so above a direct arrival the count stays `0`, and `orbit` is never a guess about an
   entry that is not the site's. `orbit` of 0 or absent means no door entry lies below.
2. **A landing's rewrite of its address keeps the entry's state.** `goToWorld` and the flights' `land()` use
   `replaceState(history.state, "", "#id")`. The direct `replaceState(null, "", " ")` stays only where the door is reached
   with no door entry below (a direct arrival's "— the dawn").
3. **Up is `history.go(-orbit)` when `orbit` is 1 or more, else the direct descent.** This replaces `goBack`'s
   `history.back()`: from a docs page two entries above the door, Up reaches the door in one go and leaves nothing
   stale; from a direct arrival it descends and rewrites the one entry to `/`. The docs' own entries carry `orbit`
   (decision 1) so this holds there too.
4. **Another household's sky is one entry, a level under the visitor's own.** From the visitor's own sky, a tap on a
   mini system or a chip pushes `{ ...state, sky: id }` with the address unchanged (no new address: `#home` or `/` stays
   what it was). From another's sky to a third, the entry is replaced, not pushed: the demo has two levels, your sky
   and another's, as the corner says ("— your sky" always goes to yours). "— your sky" is `history.back()` when the
   entry's state has `sky`, else `flyTo("willow")`. The browser's Back from another's sky flies to the visitor's own;
   Forward flies out to the sky named in the state. The walk and `restoreState` push nothing.
5. **A sky asked for during a sky flight is flown to when the flight lands** (the last one asked). Today `flyTo` refuses
   it, so a Back mid-flight would leave the camera and the entry disagreeing. `cancelFlight` drops a pending ask.
6. **Signing out drops the sky's entries:** when the goodbye lands, `history.go(-orbit)` when `orbit` is 1 or more (the
   door's entry is current under the goodbye; the pop does nothing there), else the entry is rewritten to `/`. Back at
   the goodbye leaves the site; "Sign back in" shows the door; Forward from that door flies in, as after any Back.
7. **Back and Forward are planned by one pure function,** `plan({ current, hash, state, from })` in a new module
   `assets/js/places.js`, so Node can check every case: `from` is the state of the entry just left (the module remembers
   it across pushes, replaces and pops), which is what tells a return to the visitor's own sky (`from.sky` set, `state.sky`
   not) from a return to the door, since a returning visitor's own sky and the door can share the address `/` with no
   state. The plan is made when the pop arrives and run when the journey in flight lands (`after`), as today.
8. **Nothing is pushed or replaced on load,** and a landing does not rewrite its address while a Back or Forward is
   waiting (`after` set), so the entry a pop moved to is never relabelled by the flight it interrupted.

### What must not change

The docs' per-page entries and their own `popstate`; `step()` pushing from a click or a key only (the interventions);
the addresses the site answers (`#home`, `#install`, `#docs`, `#docs/<slug>`, `#info`, `#key`, `#inbox`): no new ones;
the drawers and the walk pushing nothing; `arrivePad`/`arrive` as the direct arrivals; the 15 s let-go and the lock;
`assets/door/`; maintenance (`popstate` returns early); the `orbit-site-arrived` flag; no test on timings (AGENTS.md).

## Considered and dropped

- **A synthetic door entry under a direct arrival** (`replaceState` the door, `pushState` the landing, on load; the
  reload guarded by the state mark). Skipped by Chromium's and WebKit's Back buttons when added without activation,
  which on load it always is; it would work on Firefox only, and the owner tests on a phone. Adding it on the first tap
  instead is the back-trap the interventions were written against, and holds a visitor from a search result one press
  longer. Dropped: a direct arrival keeps the browser's own meaning of Back.
- **An entry per sky hop** (A to B to C, Back to B). The corner control says "— your sky", not "— the last sky"; Back
  and Up would disagree. One level under the visitor's own matches the control.
- **A new address per sky** (`#home/<id>`). A deep link to another household's sky is not a thing the site offers, and
  a new address needs arrival handling, the 404 page and the docs. The state carries the sky instead.
- **Routing the sky flights through main.js's journey lock.** It would make a Back during a sky flight wait as a Back
  during a climb does, but couples home.js to the lock for a 2 s flight. Decision 5 keeps it in home.js.
- **Leaving sign-out alone.** Cheap to fix, and "sign out, press Back" is a thing the owner will try.

## Interface/behaviour

- `assets/js/places.js` (new, no dependency, loads in Node with a `history`-shaped object passed in):
  - `createPlaces(h = history)` returns `{ step, stack, hop, keep, settle, up, pop, from }`:
    `step(hash)` pushes `{ orbit: 1 }` at `hash` (from the door only);
    `stack(more, hash?)` pushes `{ ...more, orbit: h.state?.orbit ? h.state.orbit + 1 : 0 }`, the address `hash` or
    unchanged when omitted; `hop(more)` replaces the state with `{ ...h.state, ...more }`, address unchanged;
    `keep(hash)` is `replaceState(h.state, "", hash)`; `settle()` is `replaceState(null, "", " ")`;
    `up()` returns true after `h.go(-orbit)` when `orbit` is 1 or more, else false and does nothing;
    `pop()` is called in the `popstate` handler and returns `{ hash, state, from }`, `hash` the address's hash up to the
    first `/` (`""`, `"#home"`, `"#install"`, `"#docs"`, `"#info"`, other), `state` the entry's, `from` the state of the
    entry before it; every method keeps `from` current. Each history call is in a try/catch, as today.
  - `plan({ current, hash, state, from })` returns one of `{ to: "dawn" }` (descend to the door),
    `{ to: "sky", id }` (fly to that household's sky), `{ to: "launch" }` (the climb, no push),
    `{ to: "pad", id }` (fly to that landing, no push) or `null`:
    with `current` `"home"`: `state?.sky` gives `sky` to it; else `from?.sky` gives `sky` to `"willow"`; else `hash` `""`
    gives `dawn`; else `null`. With `current` one of `install`, `docs`, `info`: `hash` `""` gives `dawn`, anything else
    `null` (the docs' own pops are pads.js's). With `current` `"door"`: `"#home"` gives `launch`, `"#install"`, `"#docs"`,
    `"#info"` give `pad`, `""` and others `null`. With `current` `"dusk"`, `null` or other: `null`.
- `main.js`: `step` and `goBack` go; `flyToPad` and `launch` use `places.step`; the "— the dawn" controls and
  `home.onBackHome` use `up()` else the descent; the three landings' address rewrites use `keep` (not while `after` is
  set); `signOut`'s farewell uses `up()` else `settle()`; `popstate` runs `plan(places.pop())` now or after the landing.
- `home.js`: `visit(id)` (new, the mini systems' and chips' click): `state.camera === "willow"` ? `places.stack({ sky: id })`
  : `places.hop({ sky: id })`, then `flyTo(id)`; `flyTo` during a flight keeps the ask and flies it when the flight lands
  (`done` of the pending one called on its landing); `cancelFlight` drops it; "— your sky" is `history.back()` when
  `history.state?.sky`, else `flyTo("willow")`; a new export `flying()` for tests.
- `pads.js`: `open` and `close` push with `orbit` carried as decision 1 says (`{ docs, anchor, orbit }`, `{ orbit }`).

## Testable specification

Behaviour only, never a timing. Each case names its control. "Entries" is `history.length`; "the address" is
`location.hash`.

Node, `places.js` (shape of `site-lock-test.mjs`; `h` a stand-in with `state`, `pushState`, `replaceState`, `go` that
records calls):

- P1. `step("#install")` pushes state `{ orbit: 1 }` at `#install`. Control: no call before it.
- P2. Above `{ orbit: 1 }`, `stack({ docs: "a" })` pushes `{ docs: "a", orbit: 2 }`; above `null` it pushes
  `{ docs: "a", orbit: 0 }`; above `{ orbit: 0 }`, `orbit` 0. With `hash` omitted the address argument is `undefined`
  (unchanged). Control: `step` above `null` still gives 1.
- P3. `hop({ sky: "grans" })` above `{ orbit: 1 }` replaces with `{ orbit: 1, sky: "grans" }`, address unchanged, no push.
- P4. `keep("#docs")` replaces with the same state object; `settle()` replaces with null at `" "`.
- P5. `up()` above `{ orbit: 2 }` calls `go(-2)` and returns true; above `{ orbit: 0 }`, null and `{ sky: "x" }` alone
  it calls nothing and returns false.
- P6. `pop()` returns the entry's hash up to the first `/` (`"#docs/a/b"` gives `"#docs"`), the state, and `from` = the
  state before: after `step("#home")` then a stand-in pop to `null`, `from` is `{ orbit: 1 }`; a second pop with no
  change between gives `from` null. Control: `from` after `hop` is the hopped state.
- P7. `plan`: the table in Interface/behaviour, every row, plus: `{ current: "home", hash: "", state: null, from:
  { orbit: 1, sky: "grans" } }` gives `sky willow` (the returning visitor's `/` case), and the same with `from: null`
  gives `dawn` (the control); `{ current: "home", hash: "#home", state: { orbit: 2, sky: "bea" }, from: { orbit: 1 } }`
  gives `sky bea`; `{ current: "docs", hash: "#docs" }` gives null; `{ current: "dusk", hash: "" }` gives null.
- P8. A `h` whose methods throw: every method returns without throwing.

Node, `home.js` on the existing stand-in (`site-home-test.mjs`; `globalThis.history` a recording stand-in):

- H1. A click on another household's mini system from the visitor's own sky pushes once with `sky` that id and the
  address argument undefined; the chip does the same. Control: `flyTo(id)` called by script (the walk's way) pushes
  nothing.
- H2. From another's sky, a click on a third's replaces (no push), `sky` the third, `orbit` kept.
- H3. On another's sky with `history.state.sky` set, "— your sky" calls `history.back()` and does not fly; with no `sky`
  in the state it flies to `willow` and calls nothing. Control: on the visitor's own sky it calls `backHome`.
- H4. A `flyTo(b)` during a flight to `a` lands on `a` and then flies to `b`, `b`'s `done` called once `b` lands;
  `flying()` is true throughout and false after. Control: `flyTo(b)` after `a` lands flies at once; `cancelFlight`
  during `a` leaves `b` unflown.
- H5. The walk's `restoreState` pushes and replaces nothing.

Node, `pads.js` (`site-pads-test.mjs` shape, if `open`/`close` can be reached; else browser B5): a page opened above
`{ orbit: 1 }` pushes `{ docs, anchor, orbit: 2 }`; `close` above it pushes `{ orbit: 3 }`; above null both push `orbit` 0.

Browser, `tools/ci/journey.mjs` (both browsers where it runs; Back is `history.back()` or `page.goBack()`, which the
interventions leave alone, so the gesture rule is checked by H1 and B6, not here). Each lands by waiting for the
element, never a time:

- B1. Door, click install, "— the dawn": the door shows, address `""`; Back then leaves the page (the test's previous
  page shows); from the door again, Forward flies to install. Control: today, Back after "— the dawn" shows the door
  still (a dead press) and only the next one leaves.
- B2. Door, click docs, open a page from the index, "— the dawn": the door in one step; Forward then shows the docs
  (index), Forward again the page. Control: Back from the page shows the index, not the door.
- B3. Door, gate, click a mini system (another's sky, `#back` reads "— your sky"), Back: the visitor's own sky
  (`#back` reads "— the dawn", the dial's household name is willow's), Back again: the door. Forward, Forward: the
  other's sky again. Control: entries grow by one at the click on the mini system, and by none at a hop from there to
  a third household's chip.
- B4. A direct arrival at `#install` (and `#home`, `#docs/<slug>`): Back leaves the page; "— the dawn" first then shows
  the door with address `""` and entries unchanged, and Back then leaves. Control: B1.
- B5. Reload on a landing flown to from the door (`#install`; `#home`): after the reload, Back shows the door.
  Control: B4's direct arrival.
- B6. Load of `/`, of `#install` and of a returning visitor's `/` (the session flag set): entries unchanged by the load
  and by the walk (`tour.js`) running one step. Control: a click on a planet grows them by one.
- B7. Back mid-flight (today's check, kept): the door shows and the address is `""`; and the same from the demo: gate,
  click a mini system, Back on the next frame: the own sky, `#back` "— the dawn". Control: without the Back the other's
  sky lands.
- B8. Gate, sign out, Back: leaves the page. "Sign back in", Forward: the sky. Control: today, Back at the goodbye
  shows nothing and the address stays `#home`.
- B9. Phone Safari is the owner's run, by hand, cases B1, B3, B4 and B8 (AGENTS.md: real-device Safari is phone only).

## Build notes, in order

1. `assets/js/places.js`: `createPlaces` and `plan` as in Interface/behaviour, each history call in try/catch. Add it
   to `tools/ci/test-map.json` groups `page`, `home` and `docs` (the lint refuses an unmapped file; ADR-0005), and
   `node-tests.sh` gains `site-places`.
2. `assets/js/main.js`: `const places = createPlaces()`; delete `step` and `goBack`; `flyToPad`/`launch`:
   `places.step(hash)`; `goToWorld`, `flyNow`'s `land`, `launchNow`'s `land`: `if (!after) places.keep("#id")`
   (`launchNow` drops its `!history.state?.orbit` guard); the three `replaceState(null, "", " ")` in `leaveWorld`,
   `backToDawn`'s and `homeToDawn`'s `farewell` become `places.settle()`, unconditional: with decisions 2 and 3 the
   current entry there is always the door's (after a pop or `up()`, harmless) or a direct arrival's (needed);
   `const upOr = (fn) => () => { if (!places.up()) fn(); }` replaces `goBack` for the pads' `.back.dawn` and
   `home.onBackHome(upOr(homeToDawn))`; `signOut`'s `farewell`: `if (!places.up()) places.settle()`; `popstate`:
   `const p = plan({ current, ...places.pop() }); if (!p) return; const run = () => act(p); if (lock.held()) after = run;
   else run();` with `act` mapping `dawn` to `backToDawn`/`homeToDawn` by `current`, `sky` to `home.flyTo(id)`, `launch`
   to `launch(false)`, `pad` to `flyToPad(id, false)`. Export nothing new.
3. `assets/js/home.js`: `visit(id)` and the click wiring (line 174 and 183 call it; `flyTo` stays for the walk);
   the pending ask in `flyTo`/`cancelFlight`; `#back`'s handler; `export function flying()`.
4. `assets/js/pads.js`: the two `pushState` calls carry `orbit` (a tiny `above = (h) => h?.orbit ? h.orbit + 1 : 0`).
5. Tests: `tools/ci/site-places-test.mjs` (P1-P8); H1-H5 into `site-home-test.mjs`; the pads case where reachable;
   B1-B8 into `journey.mjs` beside "Back mid-flight" (the map already runs `journey` for `page`, `home` and `docs`).
   Record each test's first failure in the commit message (order of work).
6. `README.md`'s layout table: one line for `places.js`. Coverage: the new file has no floor until three full runs
   (`coverage-fetch.sh`), as the ratchet says.
7. Hand run on the owner's phone (B9), with the design container, before the merge request is cut.

## Questions for the owner

None that block the build. One to confirm at the phone run: a direct arrival keeps the browser's meaning of Back
(decision: leaves the site; "— the dawn" is the way to the door). The alternative, a synthetic door entry, does not
work on Chromium or Safari, so there is no second option to offer.
