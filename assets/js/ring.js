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

/*
 * The flight's shaders asked late (#119, owner 53a and 66b): where the flight is drawn in a worker and the browser does
 * not compile in the background, the flight's three programs, built one at a time on the GPU's queue, kept the install's
 * unseen first draw waiting (1.9-3.0 s; 0.24 s when asked after, seen on a real device). So under the flag links "late"
 * the flight's worker asks for them only at the host's word (the door's statusGo), given once the install's world is
 * baked and has drawn its first frame; and the ring does not wait for the flight's compile, which is not asked until its
 * own work is done. The page's context stands for the worker's (aside): a wrong guess only keeps the ring waiting as
 * before. Elsewhere the word is given at the bake, which nothing then waits for.
 */

/** whether the flight's shaders are asked late @param {{ links: unknown, drawnAside: boolean, aside: boolean }} o */
export const flightLate = ({ links, drawnAside, aside }) => links === "late" && !!drawnAside && !aside;

/**
 * go() once: where late, after both the install's bake (baked) and its first draw (drawn) have settled, whatever they
 * settled to; elsewhere at the bake
 * @param {{ late: boolean, baked: unknown, drawn: unknown, go: () => void }} o
 */
export function giveWord({ late, baked, drawn, go }) {
  const settled = (/** @type {unknown} */ p) => Promise.resolve(p).then(() => {}, () => {});
  (late ? Promise.all([settled(baked), settled(drawn)]) : settled(baked)).then(() => go());
}
