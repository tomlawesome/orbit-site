/**
 * THE SEQUENCES — the wall clock of the ratified flight (#410, §15).
 *
 * Every number here is design/v19/first-run.html's own, as committed at
 * 159ec9f. The mockup wrote them as a wall of `after(ms, fn)` calls; they are
 * data here so the same list can be run live (setTimeout) or PINNED (every
 * beat up to a given millisecond applied at once), which is what makes a
 * moving thing screenshottable and unit-testable. The beats and their order
 * are not adapted — only the way they are dispatched.
 *
 *   ASCENT · wall clock from the call
 *      0     arming; the mark's centre goes white
 *      200   the canvas takes over and the flight starts
 *      260   the mark leaves the lockup and rides to centre screen (1.08s)
 *      430   the login is released
 *     1340   the mark puts itself out
 *     1560   the household's name is written on the void
 *     2600   and taken away again
 *     4800   handoff INSIDE the light — the canvas dissolves over 1.7s while
 *            the bodies condense out of it over 1.3s
 *     6400   the bare sky is readable: planets, sun, the household's name
 *     8400   two seconds later the instrument arrives (1.8s, arrive style) —
 *            v5's draw-in, slower again and on a softer curve; see T below
 *
 *   DESCENT · the ascent mirrored, in the DOM as well as on the canvas
 *      0     the instrument withdraws (arrive, reversed)
 *      620   the bodies disperse
 *      700   the canvas takes over and the reversed flight begins
 *     1000   the home surface is released
 *     2580   the household's name on the void, "signing out" beneath it
 *     3467   and taken away again
 *     3600   the dusk surface comes up under the cooling dawn
 *     3655   the mark reappears at centre and rides down to the lockup
 *     4150   the flight is over and the canvas is released
 *     5100   the mark hands back to the lockup's own glyph
 *     5350   the farewell speaks
 *
 * THE PACE (#151, ADR-0007). Those are the mockup's figures and they stay
 * here as written, in FLIGHT TIME: the choreography's own. The flight is seen
 * on a bent clock (engine.js: clockAt, paced), so a beat at or after the
 * flight's warp moves to where its moment falls on that clock:
 * `warp + clockAt(beat - warp)`, on the descent `D.warp + clockAt(beat -
 * D.warp, true)`. A beat before the warp does not move, and neither does a
 * length that is not a beat (dwell, instrument, tourGap, the settle). So the
 * landing is about 5308 (was 4800), the bare sky 6900, and the descent's dusk
 * about 3336, its canvas released about 4240, the mark home about 5527 and the
 * farewell about 5777 (was 5350). The reduced-motion beats do not change.
 */

/*
 * THE OWNER'S 2026-08-16 AMENDMENT (ledger 7f7d813) trimmed the dwell 3s → 2s
 * and slowed the draw-in 1300 → 1700, curve untouched, and said as much: "if
 * v5 chose different figures, v5 wins and this table follows it."
 *
 * v5 has landed (design/v19/first-run.html at 9476480) and chose different
 * figures: the draw-in stretches again, 1700 → 1800, and this time the CURVE
 * moves too — cubic-bezier(.2,.7,.2,1) → (.2,.26,.35,1) — tuned frame by
 * frame, because a gentler curve at the same length made the wait read worse,
 * not better (a slow start is an invisible start at scale .16). The opacity
 * stop that rides along with it (60% → 55%) lives in the CSS, not here.
 * `dwell` is untouched at 2000; only `instrument` changes in this table.
 */
const ASCENT_BASE = {
  warp: 200, mark: 260, release: 430, markOut: 1340,
  nameOn: 1560, nameOff: 2600,
  land: 4800, condensed: 6400, dwell: 600, instrument: 1800,
  tourGap: 450,
};
/* THE SITE'S OWN AMENDMENT (owner, 2026-10): on the site the bare sky's dwell read as a wait, not a breath. The
   instrument now arrives as the dial finishes settling (its condense runs 1.3s from the landing), not two seconds
   after the settle: the land and the draw-in are untouched, the dead air between them is gone. The settle is the
   host's setting (settings.js: settle, 1100 ms unless the host says otherwise), a length after the paced landing, so
   instrumentAt is about 6408 here (5900 before the pace) */
import { settings } from "./settings.js";
import { clockAt } from "./engine.js";

/* a beat written in flight time, on the clock: one at or after the flight's warp moves with the pace (above) */
/** @param {number} warp @param {boolean} rev @param {number} beat */
const onClock = (warp, rev, beat) => (beat < warp ? beat : warp + clockAt(beat - warp, rev));
/** @template {Record<string, number>} B @param {B} beats @param {number} warp @param {boolean} rev @returns {B} */
const paceAll = (beats, warp, rev) => /** @type {B} */ (Object.fromEntries(Object.entries(beats).map(([k, b]) => [k, onClock(warp, rev, b)])));
/* the climb's beats; the rest of ASCENT_BASE are lengths */
const { dwell, instrument, tourGap, ...ASCENT_BEATS } = ASCENT_BASE;
const ASCENT_PACED = paceAll(ASCENT_BEATS, ASCENT_BASE.warp, false);

export const T = {
  ...ASCENT_BASE,
  ...ASCENT_PACED,
  /* the settle is a length after the (paced) landing */
  get instrumentAt() { return ASCENT_PACED.land + settings.settle; },
  /** @returns {number} */
  get tourAt() { return this.instrumentAt + ASCENT_BASE.instrument + ASCENT_BASE.tourGap; },
};

/* the descent's own offsets, kept as the mockup wrote them (in flight time, paced as above): the flight starts
   700ms in, and the mirrored windows are quoted against that. */
const DESCENT_BASE = {
  withdraw: 0, disperse: 620, warp: 700, release: 1000,
  nameOn: 700 + 1880, nameOff: 700 + 2767, markIn: 700 + 2955,
  dusk: 3600, warpOut: 4150, markHome: 5100, farewell: 5350,
};
export const D = paceAll(DESCENT_BASE, DESCENT_BASE.warp, true);
/* the mark rides 260 → 1340 out of the lockup on the climb, so on the way
   down it rides the mirrored window: 923ms of the descent's flight time, from
   2955. Both are the lengths those windows take on the paced clock. */
export const MARK_RIDE_UP = T.markOut - T.mark;
export const MARK_RIDE_DOWN = clockAt(2955 + 923, true) - clockAt(2955, true);
/*
 * WHERE THE MARK ARRIVES at the centre of the screen: 166.4px, the ratified
 * 2.6 × the 64px badge the sheet used to draw in the lockup. It is stated as
 * a SIZE and no longer as a multiplier, because the lockup it leaves is the
 * 08-14 hero (§15, owner 2026-08-17) and the ring there is 420px — so the
 * ride is now a contraction rather than a growth. Same beat, same window,
 * same landing size, and the sun still blooms two seconds later out of
 * exactly that point.
 */
export const MARK_ARRIVE = 166.4;

/**
 * @typedef {{ at: number, act: string }} Beat
 */

/** @param {Beat} a @param {Beat} b */
const byTime = (a, b) => a.at - b.at;

/** The launch, as beats. */
export function ascentBeats() {
  return [
    { at: 0, act: "arming" },
    { at: T.warp, act: "warp" },
    { at: T.mark, act: "mark" },
    { at: T.release, act: "release" },
    { at: T.markOut, act: "markOut" },
    { at: T.nameOn, act: "nameOn" },
    { at: T.nameOff, act: "nameOff" },
    { at: T.land, act: "land" },
    { at: T.instrumentAt, act: "instrument" },
  ].sort(byTime);
}


/** The descent, as beats. */
export function descentBeats() {
  return [
    { at: D.withdraw, act: "withdraw" },
    { at: D.disperse, act: "disperse" },
    { at: D.warp, act: "warp" },
    { at: D.release, act: "release" },
    { at: D.nameOn, act: "nameOn" },
    { at: D.nameOff, act: "nameOff" },
    { at: D.dusk, act: "dusk" },
    { at: D.markIn, act: "markIn" },
    { at: D.warpOut, act: "warpOut" },
    { at: D.markHome, act: "markHome" },
    { at: D.farewell, act: "farewell" },
  ].sort(byTime);
}

/**
 * Reduced motion (the mockup's own rule, and law here): the launch is the one
 * thing on this sheet that cannot be slowed down, so it is NOT played. The
 * flight becomes a plain crossfade over ~0.7s — and the STAGING SURVIVES
 * INTACT, because the staging is class-driven and not motion-driven: the bare
 * sky still lands bare, the dwell still passes, the instrument still arrives
 * after it.
 */
export function ascentBeatsReduced() {
  /* the release lets the surface it left go (the door, under the landing), as the full flight's does */
  return [
    { at: 0, act: "release" },
    { at: 0, act: "land" },
    { at: 700 + T.dwell, act: "instrument" },
  ];
}

export function descentBeatsReduced() {
  /* `disperse` is doing what the mockup's `remove("showhome")` does: taking
     the landing off the screen. Without it the dusk arrives ON TOP of a home
     that is still sitting there, which is not a quieter version of the
     descent — it is a broken one. The stylesheet drops its transition under
     reduced motion, so the surface simply changes. */
  return [
    { at: 0, act: "withdraw" },
    { at: 0, act: "disperse" },
    { at: 0, act: "release" },
    { at: 0, act: "dusk" },
    { at: 0, act: "farewell" },
  ];
}

/**
 * Run a beat list.
 *
 * Live, each beat is a timer and the returned function cancels what is still
 * pending. Pinned (`at` a number), every beat at or before that millisecond is
 * applied immediately, in order, and nothing is scheduled — the surface then
 * stands still at exactly that moment of the flight.
 * @param {Beat[]} beats
 * @param {(act: string, beat: Beat) => void} apply
 * @param {{
 *   at?: number,
 *   schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>,
 *   cancel?: (id: ReturnType<typeof setTimeout>) => void,
 * }} [options]
 */
export function runTimeline(beats, apply, { at, schedule, cancel } = {}) {
  if (typeof at === "number") {
    for (const beat of beats) if (beat.at <= at) apply(beat.act, beat);
    return () => {};
  }
  /* no clock of the host's own: a plain timer would fire every beat a stall had made overdue on the one frame after it,
     so the descent's goodbye could be skipped (#163, decision 10a). The beats run on frames, a stall counted as at most
     64 ms, the climb's cap (journey.js, stalls()); every beat due by then fires on that frame, in order */
  let setTimer = schedule, clearTimer = cancel;
  if (!setTimer) {
    let t = 0, last = performance.now(), raf = 0, ids = 0;
    /** @type {Map<number, { at: number, fn: () => void }>} */
    const pending = new Map();
    const poll = () => {
      raf = 0; const p = performance.now(); t += Math.min(64, Math.max(0, p - last)); last = p;
      for (const [id, b] of pending) if (b.at <= t) { pending.delete(id); b.fn(); }
      if (pending.size) raf = requestAnimationFrame(poll);
    };
    setTimer = (fn, ms) => {
      if (!raf) { const p = performance.now(); t += Math.min(64, Math.max(0, p - last)); last = p; }
      const id = ++ids; pending.set(id, { at: t + ms, fn });
      if (!raf) raf = requestAnimationFrame(poll);
      return /** @type {any} */ (id);
    };
    clearTimer = (id) => { pending.delete(/** @type {any} */ (id)); };
  } else clearTimer = cancel ?? ((id) => clearTimeout(id));
  const timers = beats.map((beat) => setTimer(() => apply(beat.act, beat), beat.at));
  return () => timers.forEach(/** @type {any} */ (clearTimer));
}
