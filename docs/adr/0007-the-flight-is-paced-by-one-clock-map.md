# ADR-0007: The flight is paced by one map from the clock to the flight's own time

**Status:** Accepted 2026-11-10 (owner, on a rough build on the design host: #150 (richer Earth in the flight); built in #151)
**Date:** 2026-11-10
**Relates to:** #151 (the flight's pace); #150 (the rough `?hold` and `?slow` flags this replaces); ADR-0001 (the door is
shared with Orbit); ADR-0003 (the descent is the climb run backwards: its formulas stay true as written).

## Context

The owner flew a rough build that bent the page's clock and settled the flight's pace:

- The climb lingers over the Earth and as the moon passes: one more second across the first 1.9 s of the flight.
- The cruise through the dark is quicker, giving half a second back. The climb is half a second longer overall ("The
  less rushed is good").
- "Just make sure the flight down is the same": the descent is the same flight run backwards, so it is quick through
  the dark and slow as the moon passes and the Earth comes back.
- A long flight on every sign-in would annoy people, so nothing else gets longer.

Every window of the choreography (`UPDUR`, `DOWNDUR`, `REV`, `mirror`, `UP.speed`, `UP.atm`, each prop's `t0` and `dur`,
the bloom, the galaxy, the docs camera, `P.skip`, `P.dur`, the engine's pinned `at`) is written in one time, and the
docs flight, the props and the descent's mirror all depend on those numbers.

## Decision

Two kinds of time, kept apart. **Flight time** is what the choreography is written in, and it does not change. **Clock
time** is real milliseconds since the flight began (times the profile's `rate`, as before). One pair of pure functions
turns one into the other, and nothing else knows the pace. The standard pattern: a time remap (an easing of the clock)
in front of an unchanged timeline, which is what an animation's timing function does.

```
sm(a, b, x)  = t*t*(3 - 2*t), t = clamp((x - a) / (b - a), 0, 1)
slow(f)      = sm(0, 300, f) * (1 - sm(1500, 1900, f))
fast(f)      = sm(1900, 2400, f) * (1 - sm(4400, 4800, f))
cost(f)      = 1 + (1000 / 1550) * slow(f) - (500 / 2450) * fast(f)     clock ms per flight ms
clockAt(f)   = integral of cost from 0 to f, for 0 <= f <= UPDUR
               f for f < 0;  f + (UPTIME - UPDUR) for f > UPDUR
paced(c)     = the inverse of clockAt
```

- `UPTIME = 5300`, the climb's length on the clock; `DOWNTIME = UPTIME * REV` (about 4527.08), the descent's.
- `clockAt(f, rev = false)` and `paced(c, rev = false)`, each the other's inverse, each rising all the way. With `rev`
  they are the descent's, in its own flight time `d` (0 to `DOWNDUR`): `clockAt(d, true) = DOWNTIME - REV *
  clockAt(mirror(d))` for `0 <= d <= DOWNDUR`; `d` below 0; `d + (DOWNTIME - DOWNDUR)` past the end. At clock `c` the
  descent shows the climb's moment at clock `UPTIME * (1 - c / DOWNTIME)`: the paced climb, backwards, at `REV` pace.
- Checked figures: `clockAt(300)` 396.77, `clockAt(1900)` 2900, `clockAt(2400)` 3348.98, `clockAt(4400)` 4940.82,
  `clockAt(4800)` 5300; `clockAt(2955, true)` 2726.03, `clockAt(4100, true)` 4527.08.

How it is computed (`assets/door/engine.js`, exported there and from the door's `index.js`): the two windows of `slow`
do not overlap and neither do those of `fast`, and `fast` starts where `slow` ends, so `slow = sm(0, 300) - sm(1500,
1900)` and `fast = sm(1900, 2400) - sm(4400, 4800)` exactly, and the integral of a smoothstep is closed
(`(b - a) * (u^3 - u^4 / 2)` inside its window). `clockAt` is that closed form. `paced` runs every frame: Newton's method
on the closed form, kept inside a bracket (`cost` is never below about 0.796), converging well inside 1e-7 ms in a few
steps, with no allocation. `flownAt(P, ms)` (engine.js, not on the door's interface) is the one conversion the page,
the worker's page side and the journey share: `paced(ms * rate + clockAt(P.skip, P.rev), P.rev)`.

Where it is applied:

1. The engine draws flight time `paced(clock * rate, P.rev)`, on the page, in the worker and in the painted flight (they
   share `engine.js`, so no message changes). A flight ends when its flight time reaches `P.dur` (4800 up, 4100 down);
   on the clock that is `UPTIME / rate` (or `DOWNTIME / rate`).
2. What moves a little each frame (the star streaks, the props, the nebula, the world's drift) moves by the flight time
   that passed over the frame; the cap on a long frame (48 ms) stays on the clock.
3. A flight that starts partway (`P.skip`, flight time) is started back by the clock that costs (`clockAt(skip, rev) /
   rate`); a pinned flight (`start(P, { at })`, flight time) is stepped in flight time as before. `remote-flight.js`
   picks a flight up with the same rule.
4. The beats (`timeline.js`): a beat at or after the warp moves to `warp + clockAt(beat - warp)`, on the descent `D.warp
   + clockAt(beat - D.warp, true)`; earlier beats, lengths that are not beats (`dwell`, `instrument`, `tourGap`, the
   settle) and the reduced-motion beats do not move. `MARK_RIDE_UP` and `MARK_RIDE_DOWN` are the new lengths of their
   windows.
5. A pinned journey (`journey.js`: `pinnedFlight`) converts its clock to flight time through `paced`.
6. Flights played "a second shorter" stay a second shorter than the new lengths: the sideways and docs flights at
   `UPTIME / (UPTIME - 1000)`, the descents from them at `DOWNTIME / (DOWNTIME - 1000)`, and `quicken` scales beats
   against the clock lengths (`UPTIME`, `DOWNTIME`).

## Consequences

- The landing comes at about 5307.65 ms (was 4800), the bare sky at 6900, the instrument one settle after the landing
  (about 6407.65 at the usual 1100); on the descent the dusk at about 3335.55, the canvas released at about 4240.39, the
  mark home at about 5527.08 and the farewell at about 5777.08 (was 5350).
- Every choreography number, the props, the docs camera and ADR-0003's descent formulas are untouched, and so is the
  wire profile: the worker computes the same pace from the same module.
- A test or a host that pins the journey or a flight by a clock time now gets the paced flight time for it; anything
  that worked out flight time as clock minus the warp beat (times the rate) has to go through `paced` instead.
- A later change of pace is one function: the choreography never has to be re-timed for it.
- Nothing judges speed or smoothness in a test: that is the owner's eye on real devices.

## Considered and dropped

- **Rewriting every window of the choreography in the new timing.** It would touch dozens of numbers that the docs
  flight, the props and the descent's mirror all depend on, and would have to be redone for the next change of pace.
- **The rough build's bent page clock** (#150, `?hold` and `?slow`, on the design host only): it was for the owner's
  eye; this is the same pace built in the flight's own timing, with no address flag.
- **A lookup table for `paced`.** Equally cheap, but a closed form needs no table built at load and no interpolation
  error to reason about.
