/*
 * The phone's tilt, for what the pointer moves on a screen with a mouse.
 *
 * However the phone is held is where it rests: the reading it is held at is followed, slowly (a few seconds), so
 * only a turn of the hand moves anything, and a change of grip settles back to the middle. The turn is given as the
 * pointer would be, -1 to 1 across and down the screen, a turn of about twenty degrees for the whole way, whichever
 * way up the screen is.
 *
 * Only where the phone gives its tilt freely (Android). Where it must ask first (iOS, a prompt raised by a tap) it
 * is not asked: the worlds there stay as they are (owner, 2026-10).
 */
const coarse = matchMedia("(pointer: coarse)").matches;
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const RANGE = 20, SETTLE = 4000;
const listeners = new Set();
let rest = null, last = 0, on = false;

function read(e) {
  if (e.beta == null || e.gamma == null) return;
  /* across and down the screen as it is turned now */
  const turn = (screen.orientation?.angle ?? window.orientation ?? 0) % 360;
  let x = e.gamma, y = e.beta;
  if (turn === 90) [x, y] = [e.beta, -e.gamma];
  else if (turn === 270 || turn === -90) [x, y] = [-e.beta, e.gamma];
  else if (turn === 180) [x, y] = [-e.gamma, -e.beta];
  const now = performance.now(), dt = last ? Math.min(200, now - last) : 0; last = now;
  if (!rest) rest = { x, y };
  /* where it rests follows where it is held, slowly */
  const k = dt / SETTLE;
  rest.x += (x - rest.x) * k; rest.y += (y - rest.y) * k;
  const clampU = (v) => Math.max(-1, Math.min(1, v));
  const px = clampU((x - rest.x) / RANGE), py = clampU((y - rest.y) / RANGE);
  for (const fn of listeners) fn(px, py);
}
function listen() {
  if (on) return;
  on = true; rest = null; last = 0;
  addEventListener("deviceorientation", read);
}

/** follow the tilt (fn(x, y), each -1..1, as a pointer across the screen); returns how to stop */
export function onTilt(fn) {
  if (!coarse || still || typeof DeviceOrientationEvent === "undefined") return () => {};
  if (typeof DeviceOrientationEvent.requestPermission === "function") return () => {};
  listeners.add(fn);
  listen();
  return () => { listeners.delete(fn); };
}
