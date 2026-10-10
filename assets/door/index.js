/*
 * The shared door: the Earth door and the flight, their engine and timeline, and the imagery they draw. This folder
 * is the one copy, kept on the site and pulled into Orbit unchanged (ADR-0001). Nothing in it imports from outside
 * it, and this file is the only one a host imports: what the host and the door say to each other goes through here
 * (README.md in this folder: the interface).
 */
import { configure, settings } from "./settings.js";
import { choresNow, watchTyping } from "./chores.js";

export { settings };
export { chore, fetchOnce, linked, counted, note, noteChores, quiet, openChores, openCompiles, openSoft, softRan, hurryChores, programs, compilesAside, holdReveal } from "./chores.js";
export { uploadBanded } from "./upload.js";
export { probe, level, liveDoor, lateDoor } from "./capability.js";
export { seededRng, el, measureTile, mountFlightSky, DAWN_FAR, DAWN_NEAR, DUSK_FAR, DUSK_NEAR } from "./stars.js";
export { createFlight, UP, DOWN, PROPS_UP, UPDUR, DOWNDUR, REV, SWEEP, DEEP_SKIP } from "./engine.js";
export { ascentBeats, ascentBeatsReduced, descentBeats, descentBeatsReduced, runTimeline, T, D } from "./timeline.js";

/** the live door's module (?door3d), fetched only when asked for: nothing of it is loaded otherwise */
export const loadLiveDoor = () => import("./door3d.js");

/**
 * The door, made once for the page with the host's settings (settings.js says what each is). Called before anything
 * else of the door is asked for.
 */
export function createDoor(given = {}) {
  configure(given);
  if (settings.typingWait > 0) watchTyping();
  /* for the live door's test (?door3d): the chores as they are now */
  if (settings.flags?.door3d) { try { window.__chores = choresNow; } catch { /* not a page */ } }
  return { settings };
}
