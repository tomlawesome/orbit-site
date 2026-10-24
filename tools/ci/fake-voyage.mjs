/* The fake flight world: everything of the real voyage.js, with createVoyage replaced by a world the test steers.
   Every world made is recorded, in order, on globalThis.__fakeWorlds. */
export * from "../../assets/door/voyage.js?real";

export function createVoyage() {
  const w = {
    made: Promise.resolve(true), galaxy: Promise.resolve(), ready: false, dead: false, stopped: false,
    stopCalls: 0, proveCalls: 0, plainWarms: 0, pendingProves: [],
    warm(opts = {}) {
      if (opts && opts.prove === false) { w.plainWarms++; return Promise.resolve(); }
      w.proveCalls++;
      return new Promise((resolve) => { w.pendingProves.push(() => { w.ready = true; resolve(); }); });
    },
    warmDocs() { return Promise.resolve(); },
    resize() {}, clear() {}, reset() {}, draw() {}, advance() {},
    stop() { w.stopCalls++; w.stopped = true; },
  };
  (globalThis.__fakeWorlds ||= []).push(w);
  return w;
}
