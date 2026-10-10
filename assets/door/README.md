# The shared door

The Earth door and the flight that open both the site and Orbit's sign-in:
the dawn, the launch, the bare sky, and the dusk to leave by, with their
engine, their timeline, the live Earth and the pictures they draw. This
folder is the one copy (ADR-0001, `docs/adr/0001-the-door-is-shared-with-orbit.md`):
it lives on the site, and Orbit's own job copies it from the site's `main`
unchanged and opens a merge request there. A change the door needs is made
here; Orbit never edits its copy.

It is self-contained: nothing in it imports from outside the folder, reads
the page's address, or makes a URL from its own location. The site's lint
holds it to that (`tools/ci/lint.sh`, "the shared door is self-contained").

## Licence

This folder is licensed under the GNU Affero General Public License v3.0 or
later (Orbit's licence) as well as under the site's own licence
(`LICENSE` at the repository root, section 3). Take it under either. The
imagery under `img/` is NASA's, in the public domain, credited in the root
`README.md`.

## The interface

`index.js` is the only file a host imports. Its entry point and its settings
are an interface between two repositories: change them deliberately, because
a break shows in Orbit's import merge request, not in the site's gate.

```js
import { createDoor } from "./assets/door/index.js";
const door = createDoor({
  image: (path) => `assets/door/img/${path}`,   // where a picture is; see Settings
  flags: {},                                     // the debug switches, read by the host
});
// createDoor may run on a server too (it touches no document). Call it again freely: each setting given replaces
// the earlier value (one left out, or undefined, keeps it) and the keyboard is watched once. Each dawn(), dusk()
// and journey() adds its own resize listeners; its destroy() removes them (not the live door's, which the
// door3d debug flag starts and nothing stops).
const dawn = door.dawn(document.querySelector("#door"));
const dusk = door.dusk(document.querySelector("#dusk"));
const journey = door.journey({ canvas, name, dawnGlyph, duskGlyph, on: { dusk, farewell } });
```

### Settings (`settings.js`)

| Setting | What | Site | Orbit |
| --- | --- | --- | --- |
| `image(path)` | Where a picture is: `"dawn/dawn.webp"` → a URL the page can load. Never built from `import.meta.url`: in a Vite build that leaks file paths into server-rendered pages and does not resolve in the browser | a relative base | its own map, `import.meta.glob(..., { query: "?url" })` |
| `flags` | The debug switches: `door3d`, `rich`, `lean`, `level` (`"0"`–`"2"`), `holdreveal`, `mainthread`, `ring` (`"stop"`/`"rush"`), `open` (`"late"`). The folder never reads the address; the host does | from `location.search` | none |
| `storagePrefix` | The first word of every localStorage key the folder writes (`orbit-probe …`) | `orbit` | `orbit` |
| `settle` | `timeline.js`: ms after the landing at which the instrument arrives (the site's own amendment, 2026-10) | 1100 | 1100 |
| `typingWait` | `chores.js`: an unhurried chore waits while someone is typing, this long after the last key; 0 never waits (Orbit's addition) | 600 | 600 |

### The dawn: `door.dawn(host)` → `{ start, light, live, destroy, world, host }`

`host` is the `#door` element rendered from `dawnMarkup`. Mounting draws the
star fields and sets the glows' origin.

- `start()`: the Earth's pictures asked for and the glows drawn, once, after
  the next frame is on screen. Call it whenever the door is shown.
  `world.dataset.rasterised` reads `"pending"` from the moment `start()`
  returns (set at once, not after the frame), and `"ready"` once
  the door is drawn: the glows are drawn AND the Earth's pictures `start()`
  asked for (`dawn/dawn-pre.webp`, `dawn/dawn.webp`) have each loaded. A
  picture that fails to load counts as settled, as the first light already
  treats it (`critical()`): the door is then "ready" drawn without it, never
  held "pending". (Interface change, 2026-10: "ready" used to mean the glows
  alone. The dusk's world is unchanged: its glows alone.)
- `light({ firstVisit, wait, after, onLit, onOpen, aside })`: first light,
  once per showing. The ring runs while the door's pieces (the fonts, the
  Earth's first picture) come; `firstVisit` makes it run at least a lap;
  `wait` makes it run on until the promise `after()` returns has settled
  (the host caps that promise). `after()` is called once the ring is up and
  running: the host readies what it has to. `onLit()`: `body.lit` is set and
  the reveal begins. `onOpen()`: the chores are open (`openChores` has been
  called); the host may start what waits for them. `aside`: whether shader
  compiles here are in the background (`compilesAside()` unless the host
  says). The flags `ring` and `open` apply here.
- `live`: the live door (`door3d.js`), only where `flags.door3d` is set,
  else `null`: `compile()`, `start()` → the live door, `measured` (a promise:
  it has been measured and shown), `firstCompiled()`. The live door is an
  experiment behind its flag and has no teardown yet.
- `destroy()`: the surface taken down (a host that remounts its door): its
  resize listeners removed, a glow build under way stopped, and a first light
  under way stopped: after it, no `body.lit`, no `onLit`, no `onOpen` (from
  the 13 s backstop or any other timer or promise of that light), no error;
  the ring's `body.loading` is taken off if the light put it on; a later
  `light()` on the destroyed dawn does nothing, and neither does `start()`
  (one asked for but not yet run when `destroy()` comes is dropped, so the
  dead world is never drawn and no resize listener is added after it).

### The dusk: `door.dusk(host)` → `{ start, destroy, held, world, host }`

`start()`: the dusk's pictures decoded ahead of the beat that shows them
(`decode-ahead.js`), its glows' origin set. Call it when the sign-out begins.
A dusk made with `asDawn` (Markup, below) also asks for the dawn's two Earth
pictures then and shows them as the dawn does, and `world.dataset.rasterised`
reads `"pending"` from the moment `start()` returns and `"ready"` once its glows are drawn and
those pictures have loaded or failed (a plain dusk: its glows alone). `held`: what `decodeAhead` returned (`{ ready, held }`), `null` before
`start()`; the decoded pictures are kept until `destroy()`, which also
removes the resize listeners.

### The journey: `door.journey({ canvas, name, dawnGlyph, duskGlyph, on })`

`canvas` is `#warp`, `name` is `#launchname`, the glyphs are functions
returning the two lockups' SVGs. Returns `{ fly, ascend, descend, reset,
reduced, warm, warmDocs, compiled }`.

- `fly(profile, { title, subtitle, ready, on, at })`: the climb, `profile` a
  flight profile (`UP`, or one made from it: the site's `assets/js/journeys.js`);
  `ready`, a promise the clock holds for just before the canvas comes up, at
  most eight seconds. Hooks, each optional, in order: `release` (the surface
  flown from may go), `land` (the bare sky is readable), `settled` (the
  instrument has arrived).
- `descend({ title, subtitle, onto, from, homes, on, at })`: the descent, `onto`
  `"dusk"` or `"dawn"`, `from` the profile flown up (mirrored on the way
  down). `homes`: the other households met again on the way down,
  `mirrored(homeProps(homes))` added to the end of the props, whatever the
  base; with `from`, only if the climb did not carry them (both would pass
  them twice). Left out, the descent is exactly as before. Hooks:
  `released`, `surface` (the dusk or the dawn comes up), `farewell`.
- `on` given to `journey()` holds the defaults: `release`, `land`,
  `settled`, `released`, `dusk` (the descent's surface), `farewell`.
- `warm()`: the flight's world made ready; `warmDocs()`: and the galaxy;
  `compiled()`: its shaders compiled. `reset()`: everything off.
- `destroy()`: the journey taken down: `reset()`, its clock's pending beats
  dropped, its resize listener removed. A single-page host calls it when
  the component unmounts; a page that keeps one journey never needs it.

`at` (both): pin the journey at a moment, in milliseconds into the journey
as it plays (its own time, after a profile's `rate` has quickened it and the
chart descent has moved its beats). The beats at or before `at` are applied at
once, in order, with their hooks, and the flight is drawn as it stands then;
nothing after them is scheduled, so a pinned journey stands still (for a
screenshot or a test). Left out, the journey plays live. A pinned `fly()` does
not wait for `ready`.

A `fly()` whose `ready` never settles holds the clock at most eight
seconds; a `descend()`, `reset()` or later `fly()` lets the hold go at once.

The journey sets body classes the stylesheet answers: `arming`, `showdawn`,
`showwarp`, `launching`, `bare`, `instrument`, `withdrawing`, `dispersing`,
`showdusk`, `farewell`, `holding`. The host's surfaces style themselves on
them.

### Markup (`markup.js`)

`dawnMarkup({ image, lockup, gate, foot, indent })` and
`duskMarkup({ image, gate, foot, farewell, asDawn, indent })` are pure string
functions: the door's markup with the host's parts in the slots (`lockup`,
between the glyph and the name; `gate`, inside `.gate-wrap`; `foot`, at the
surface's foot). The site writes them into `index.html` with
`node tools/door-markup.mjs` (the lint fails if the page differs); Orbit
renders them in its components. `image` is the same resolver as the setting; what it answers is escaped where it
goes into an attribute, so it cannot add an attribute or an element.

**Text and raw HTML.** `farewell.said` and `farewell.sub` are text: they are
escaped, so a person's name in them is never markup. `lockup`, `gate` and `foot`
are raw HTML, put in as given (the host's own markup: never put a person's words
in them). `indent` is whitespace.

`asDawn` dresses the goodbye as the sign-in (Orbit's; the site keeps its own
and leaves it off, and without it the markup is byte for byte unchanged): the
dawn's glyph (the lit ring and discs, their gradients' ids prefixed `d-`) with
the gold planet on its trail, shown after the farewell beat; the dawn's Earth
photo under the ember rim; the farewell hung under the way back in (inside the
ring on a phone), as the last child of `.gate-wrap`, not beside the lockup. All
of it hangs off `#dusk.asdawn` in `door.css`, so a dusk without the option
matches none of it. Needs `img/dawn/planet-gold.webp`, `dawn-pre.webp` and
`dawn.webp`. It takes the sign-in's measures, and its lit look follows
`html.rich` as the dawn's does.

### Stylesheet (`door.css`)

Loaded before the host's own sheet. Its header lists what it asks of the
host (`--star-far`, `--star-near`, `--display`, `--mono`, `html.rich`) and
the keyframes it defines that a host may use (`driftf`, `driftn`,
`spinback`). Every `url()` in it stays inside the folder.

### Also exported from `index.js`

For a host's own worlds and skies, so their work takes its turn with the
door's: the chores (`chore`, `fetchOnce`, `openChores`, `hurryChores`,
`note`, `quiet`, `compilesAside`, …), `uploadBanded`, the capability probe
(`probe`, `level`, `liveDoor`, `lateDoor`), `seededRng`, `el`,
`measureTile`, the engine (`createFlight`, `UP`, `PROPS_UP`, `UPDUR`,
`homeProps(homes)`) and `decodeAhead`, and the glows' graphs (`DAWN`, `DUSK`).
`homeProps(homes)` is the other households passing on a flight: one `"home"`
prop each from `[{ name, bodies: [[x, y, colour, r]] }]`, a home's prop
depending only on its place in the list (the site's `demoFlight` uses it).
`descentProfile({ onto, from, homes })` is the profile `descend` flies (pure,
for tests: `DOWN` itself, `DOWN_DAWN` itself, or the climb `from` run
backwards, with the `homes` on the end); `DOWN`, `DOWN_DAWN`, `DOWNDUR` and
`mirrored(props)` come with it.

## Files

| File | What |
| --- | --- |
| `index.js` | The entry point: `createDoor`, and the exports above |
| `settings.js` | The settings store the modules read |
| `dawn.js` | The dawn and the dusk mounted on their markup; first light |
| `journey.js` | The journey's clock and `createJourney` |
| `engine.js`, `timeline.js`, `voyage.js` | The flight's canvas engine, its beats, its WebGL world |
| `door3d.js` | The live door: the Earth drawn as it is, where the level allows |
| `capability.js` | The probe at the page's start, and the level it gives |
| `chores.js`, `upload.js` | The background work a piece at a time; pictures put on the GPU in bands |
| `stars.js`, `glows.js` | The star fields; the glows' graphs and the sun painted per size |
| `decode-ahead.js` | Pictures decoded before they are shown |
| `markup.js`, `door.css` | The markup and the stylesheet |
| `img/dawn/` | The door's Earth (`dawn-pre`, `dawn`), its glows, the gold planet (`planet-gold`, the goodbye's under `asDawn`), and the near maps and light strips the live door draws |
| `img/dusk/` | The dusk's glows |
| `img/flight/` | The flight's Earth maps and the gold moon |
