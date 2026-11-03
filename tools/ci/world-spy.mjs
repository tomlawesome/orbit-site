/* The real world.js, seen: every world install.js makes is the real one on the stub gl, and every view install.js
   hands its draw() is recorded, in order, on globalThis.__worldSpy = { views, real, world }. */
export * from "../../assets/js/world.js?real";
import { createWorld as makeReal } from "../../assets/js/world.js?real";

export function createWorld(canvas, opts) {
  const spy = (globalThis.__worldSpy ||= { views: [], real: null, world: null });
  const w = makeReal(canvas, opts);
  if (!w) return w;
  spy.real = w;
  spy.world = new Proxy(w, {
    get(t, k) {
      if (k === "draw") return (view, ...rest) => { spy.views.push(view); return t.draw(view, ...rest); };
      return Reflect.get(t, k, t);
    },
  });
  return spy.world;
}
