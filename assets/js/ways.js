/*
 * The ways in (ADR-0002 6.8, #119): a planet takes clicks (and the keyboard) once its journey is ready, and shows its
 * label; the gate shows once the flight is, and the backs to the dawn (id "back") fade in then.
 *
 * The planets' labels and the gate wait for the door's first reveal: a way readied while the first visit's ring still
 * ran showed its label over a door whose planets were not yet in. The backs to the dawn are on the landings, not the
 * door, so they open at once. Reads no flag and takes everything from its caller (tools/ci/ways-test.mjs).
 *
 *   open(ids, gate)  ask for the ways `ids` ("install", "docs", "info", "back"), and the gate if `gate`
 *   revealed()       the door has been shown: a frame on, wait for the planets' opacity fade to end, then release
 *                    every way asked for (the first call releases those asked before it)
 */
export function createWays({ $, body, BACKS, reduced, raf, animations }) {
  let planetsShown = () => {};
  /* (pending until the first reveal; after it, each reveal makes a new one) */
  let planetsIn = new Promise((r) => { planetsShown = r; });
  function open(ids, gate = false) {
    /* the backs to the dawn wait for nothing of the door's */
    if (ids.includes("back")) openNow(["back"], false);
    /* never before the planets themselves are in: a label that came before its planet would read as the other way round */
    planetsIn.then(() => openNow(ids, gate));
  }
  function openNow(ids, gate) {
    for (const id of ids) { const p = $(`#door .planet[data-section="${id}"]`); if (!p) continue; p.classList.add("ready"); p.removeAttribute("tabindex"); p.removeAttribute("aria-disabled"); }
    if (gate) { body.classList.add("ready-flight"); $("#gate").disabled = false; }
    if (ids.includes("back")) for (const b of BACKS()) {
      if (b.getAttribute("aria-disabled") !== "true") continue;
      b.removeAttribute("tabindex"); b.removeAttribute("aria-disabled");
      /* (faded in on filter, not opacity: the landings' and the home's own fades are on opacity, site.css) */
      if (!reduced) b.animate?.([{ filter: "opacity(0)" }, { filter: "opacity(1)" }], { duration: 600, easing: "ease" });
    }
  }
  function revealed() {
    /* the planets' pictures fade in with the reveal (site.css): the ways in wait for that fade's end, found a frame on */
    planetsIn = new Promise((r) => raf(() => {
      const a = animations().find((x) => x.transitionProperty === "opacity" && x.effect?.target?.matches?.("#door .planet .body"));
      (a ? a.finished.catch(() => {}) : Promise.resolve()).then(r);
    }));
    /* (the ways asked for before the first reveal open with it; a no-op after) */
    planetsShown(planetsIn);
  }
  return { open, revealed };
}
