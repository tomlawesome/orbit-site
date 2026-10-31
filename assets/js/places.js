/*
 * The site's history entries (#117, ADR-0006): the one place a history call is made, and the one plan for the browser's
 * Back and Forward. An entry's state counts, in `orbit`, the Back presses to the door's entry (the door's own carries no
 * state); 0 or absent means no door entry lies below, as after a direct arrival at a landing. Every call is in a
 * try/catch: a history that refuses never stops the page.
 */
/* what was last current, per history object, so every holder of the same history sees the same `from` */
const memories = new WeakMap();

export function createPlaces(h = globalThis.history) {
  let memo = { from: null };
  try { memo.from = h.state ?? null; if (!memories.has(h)) memories.set(h, memo); else memo = memories.get(h); } catch { /* no history */ }
  const stateNow = () => { try { return h.state ?? null; } catch { return null; } };
  const remember = () => { memo.from = stateNow(); };
  const orbitNow = () => { try { return h.state?.orbit || 0; } catch { return 0; } };
  const push = (state, url) => { try { h.pushState(state, "", url); } catch { /* fine */ } remember(); };
  const replace = (state, url) => { try { h.replaceState(state, "", url); } catch { /* fine */ } remember(); };
  return {
    /* a journey from the door */
    step(hash) { push({ orbit: 1 }, hash); },
    /* an entry above this one, the address as it is when none is given */
    stack(more, hash) { const orbit = orbitNow(); push({ ...more, orbit: orbit ? orbit + 1 : 0 }, hash); },
    /* the entry's state, with more, in place */
    hop(more) { let now = null; try { now = h.state; } catch { /* fine */ } replace({ ...now, ...more }, undefined); },
    /* a landing's own address, the entry's state kept */
    keep(hash) { replace(stateNow(), hash); },
    /* the door's address, no state: the entry is the door's, or a direct arrival's on its way there */
    settle() { replace(null, " "); },
    /* the way up to the door in one go, when the door's entry is below */
    up() {
      const orbit = orbitNow();
      if (orbit < 1) return false;
      try { h.go(-orbit); return true; } catch { return false; }
    },
    /* in the popstate handler: where the browser is now, and the state of the entry it left */
    pop() {
      const from = memo.from;
      let hash = "";
      try { hash = String((h.location || globalThis.location)?.hash ?? "").split("/")[0]; } catch { /* fine */ }
      memo.from = stateNow();
      return { hash, state: memo.from, from };
    },
  };
}

/* Back and Forward: what the browser's move asks of the page. `current` is where the page is (door, home, install, docs,
   info, dusk), `hash` the address's hash up to the first "/", `state` the entry's, `from` the state of the entry left. */
const PADS = { "#install": "install", "#docs": "docs", "#info": "info" };
export function plan({ current, hash, state, from }) {
  if (current === "home") {
    if (state?.sky) return { to: "sky", id: state.sky };
    if (from?.sky) return { to: "sky", id: "willow" };
    return hash === "" ? { to: "dawn" } : null;
  }
  if (current === "install" || current === "docs" || current === "info") return hash === "" ? { to: "dawn" } : null;
  if (current === "door") {
    if (hash === "#home") return { to: "launch" };
    return PADS[hash] ? { to: "pad", id: PADS[hash] } : null;
  }
  return null;
}
