/*
 * The site's own flights, made from the door's climb (assets/door: UP, the flight's traffic and timing): the three
 * sideways flights to the landings, the install's quiet climb, the demo's climb past the other households, and the
 * flight into the docs' galaxy carrying the chart.
 */
import { UP, PROPS_UP, UPDUR } from "../door/index.js";

/* The sideways flights: the climb's own speed, atmosphere and traffic, with
   the vanishing point moved to one edge and every bearing turned with it. */
const turned = (deg) => PROPS_UP.map((g) => ({ ...g, ang: g.ang + deg }));
/* the docs' and the information's flights: the climb's own beats, played a second shorter */
const QUICK = UPDUR / (UPDUR - 1000);
export const RIGHT = { ...UP, rate: QUICK, vpX: 0.94, vpY: 0.5, a0: UP.a0 + 90, a1: UP.a1 + 90, props: turned(90), ending: "sweep", tint: "#8fb8ff" };
export const LEFT = { ...UP, rate: QUICK, vpX: 0.06, vpY: 0.5, a0: UP.a0 - 90, a1: UP.a1 - 90, props: turned(-90), ending: "halo", tint: "#f87171" };
/* the install's climb: the quietest of the four — the sphere and the streaks
   only, nothing passing — ending on the ring rather than the sun */
export const UP_RING = { ...UP, props: [], ending: "ring", tint: "#a78bfa" };
/* the demo's climb: the rest of the galaxy passes — the other households in
   the sample, each with its items as bodies where its dial has them — and
   the flight lands on your own. `homes` is [{ name, bodies:[[x,y,colour,r]] }] */
export function demoFlight(homes) {
  const BEAR = [44, 136, 74, 106, 58, 122], ZED = [0.5, 0.42, 0.62, 0.46, 0.56, 0.4];
  const props = homes.map((h, i) => ({ kind: "home", name: h.name, bodies: h.bodies, t0: 760 + i * 380, dur: 2000 + (i % 3) * 350, ang: BEAR[i % BEAR.length], z: ZED[i % ZED.length], spin: 0 }));
  return { ...UP, props };
}
/* the flight to the docs, carrying the chart: out of the dawn into the galaxy, from outside it down into an arm, to
   rest among its stars with the band across the sky (voyage.js, engine.js: milkyWay), where the chart's
   constellations light; nothing else passes on the way */
export function docsFlight(chart) {
  return { ...RIGHT, vpX: 0.5, vpY: 0.44, props: [], ending: "chart", chart };
}
export { UP };
