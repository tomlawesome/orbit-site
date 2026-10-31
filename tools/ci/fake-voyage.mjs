/* The fake flight world: everything of the real voyage.js, with createVoyage replaced by a world the test steers.
   Every world made is recorded, in order, on globalThis.__fakeWorlds.

   What a case steers (ADR-0002 section 6, #116). Set globalThis.__fakeVoyage = { holdPlain, holdDocs } before the world is
   made to hold its plain asks, and release them by hand:
     warm({ prove: false })      settles at once, or (holdPlain) when w.releasePlain() is called
     warmDocs({ prove: false })  likewise (holdDocs, w.releaseDocs())
     warm()                      the proof: pending until the case settles it. Pending entries are w.pendingProves,
                                 each a function that settles the world with the verdict given (default fit, 12 ms)
     warmDocs()                  the docs' proof: pending the same way (w.pendingDocProves)
   Settling a proof is the world's one judgement (as voyage.js `judged`):
     w.settle({ fit, ms, skipped })  the verdict is in. A fit world is `ready`; an unfit one is retired as retire()
                                     does (`dead`, not ready). Every pending proof resolves with the verdict, and a
                                     proof asked later resolves with it at once. `w.verdict` and `w.judged` (a promise
                                     of it) say the same.
     w.die()                         the world is lost: `dead`, not ready; every pending proof resolves with nothing
   Recorded: stopCalls, proveCalls, docProveCalls, plainWarms, resets (reset() is called as a flight starts WITH this
   world: a flight started painted never calls it), draws. A world is made only where the GPU gate lets the page have
   one (voyage.js returns null otherwise), and never when the page has save-data. */
import { gpu } from "../../assets/door/fitness.js";
export * from "../../assets/door/voyage.js?real";

export function createVoyage() {
  if (!gpu()) return null;
  const cfg = globalThis.__fakeVoyage || {};
  const w = {
    made: Promise.resolve(true), galaxy: Promise.resolve(), ready: false, dead: false, stopped: false,
    stopCalls: 0, proveCalls: 0, docProveCalls: 0, plainWarms: 0, plainDocs: 0, resets: 0, draws: 0,
    pendingProves: [], pendingDocProves: [], pendingPlain: [], pendingDocPlain: [], waiting: [],
    verdict: null, judged: null,
    holdPlain: !!cfg.holdPlain, holdDocs: !!cfg.holdDocs,
    settle(v = { fit: true, ms: 12 }) {
      if (w.verdict) return;
      w.verdict = v;
      if (!w.dead) { if (v.fit) w.ready = true; else { w.ready = false; w.dead = true; } }
      for (const r of w.waiting.splice(0)) r(v);
      judgedIs(v);
    },
    die() {
      w.dead = true; w.ready = false;
      for (const r of w.waiting.splice(0)) r(undefined);
    },
    releasePlain() { w.holdPlain = false; for (const r of w.pendingPlain.splice(0)) r(); },
    releaseDocs() { w.holdDocs = false; for (const r of w.pendingDocPlain.splice(0)) r(); },
    warm(opts = {}) {
      if (opts && opts.prove === false) {
        w.plainWarms++;
        return w.holdPlain ? new Promise((r) => { w.pendingPlain.push(r); }) : Promise.resolve();
      }
      w.proveCalls++;
      if (w.verdict) return Promise.resolve(w.verdict);
      return new Promise((resolve) => {
        w.waiting.push(resolve);
        w.pendingProves.push((v) => w.settle(v));
      });
    },
    warmDocs(opts = {}) {
      if (opts && opts.prove === false) {
        w.plainDocs++;
        return w.holdDocs ? new Promise((r) => { w.pendingDocPlain.push(r); }) : Promise.resolve();
      }
      w.docProveCalls++;
      if (w.verdict) return Promise.resolve(w.verdict);
      return new Promise((resolve) => {
        w.waiting.push(resolve);
        w.pendingDocProves.push((v) => w.settle(v));
      });
    },
    resize() {}, clear() {}, reset() { w.resets++; }, draw() { w.draws++; }, advance() {},
    stop() { w.stopCalls++; w.stopped = true; },
  };
  let judgedIs = () => {};
  w.judged = new Promise((r) => { judgedIs = r; });
  (globalThis.__fakeWorlds ||= []).push(w);
  return w;
}
