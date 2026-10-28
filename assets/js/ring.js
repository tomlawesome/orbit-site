/*
 * The first light's ring: whether it runs on until the journeys' shaders are compiled, and for how long at most
 * (main.js, showDoor). Pure, so it can be tested (tools/ci/world-ring-test.mjs); main.js starts the page when it is
 * imported, so its own rule could not be.
 *
 * Nothing compiles on the page's own thread (offPage) where the door opens nothing (maintenance), where nothing is
 * readied (save-data), where the browser compiles in the background (aside: the door's compilesAside()), or where the
 * flight and the worlds are drawn in workers (drawnAside) and the live door, which compiles on the page, is not on.
 * Where something does, the ring waits on every visit; where nothing does, on a first visit only, so the first dive
 * finds its world compiled. Never in maintenance. The cap: 9 s where the browser compiles in the background, 8 s
 * where the compiles stall the page, and 8 s on the worker path too (ADR-0004 6b.5, owner 6b-4a).
 */

/**
 * @typedef {{ maintenance: boolean, saveData: boolean, aside: boolean, drawnAside: boolean, door3d: boolean }} Here
 */

/** whether nothing of the journeys' compiles is done on the page's own thread @param {Here} o */
export const offPage = ({ maintenance, saveData, aside, drawnAside, door3d }) => !!(maintenance || saveData || aside || (drawnAside && !door3d));

/**
 * whether the ring waits for the compiles (wait), and the longest it waits (ms, read only where it waits)
 * @param {Here & { firstVisit: boolean }} o
 * @returns {{ wait: boolean, ms: number }}
 */
export function ringWaits(o) {
  const aside = offPage(o);
  return { wait: !o.maintenance && (!!o.firstVisit || !aside), ms: aside && !o.drawnAside ? 9000 : 8000 };
}
