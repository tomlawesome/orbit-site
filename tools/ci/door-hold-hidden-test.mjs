/*
 * Test for the journey's world-failed backstop counting only the time the page is seen (#170), written from the issue
 * alone. journey.js holds the climb at its warp until the flight's world is ready, and past WORLD_FAILED (30 s) of
 * standing at the hold gives the world up ("flight world: off: not ready in 30 s": the engine's abandon). That count
 * must not run while the tab is hidden: a visitor who switches tabs while the climb holds comes back to a healthy,
 * slow world, not one abandoned as failed.
 *
 *   node tools/ci/door-hold-hidden-test.mjs
 *
 * No dependencies and no browser; each case runs in a fresh Node process (this file again, as `--child`) against the
 * stub page in door-stub.mjs, on its virtual clock. The world is made (warm, not proved) so it is there and not ready;
 * the climb is flown with a `ready` promise the test holds. The cases:
 *   failed-visible  the tab stays visible, the world never becomes ready: past 30 s it is given up (control)
 *   slow-hidden     the tab is hidden for 40 s at the hold, the world is slow but healthy (ready on return): it is NOT
 *                   given up, before or after the visitor comes back
 */
import { INDEX, isProbeSrc, installPage, installClock, childMain, runCase, check, finish, errOf } from "./door-stub.mjs";

const GAVE_UP = /flight world: off: not ready in 30 s/;

const CASES = {
  async "failed-visible"() { return holdCase({ hide: false }); },
  async "slow-hidden"() { return holdCase({ hide: true }); },
};

async function holdCase({ hide }) {
  const page = installPage();
  const clock = installClock();
  const door = await import(INDEX);
  const d = door.createDoor({ typingWait: 0, flags: {} });
  door.openChores();
  const journey = d.journey(page.journeyOptions());
  const out = {};
  journey.warm({ prove: false }).catch(() => {});             /* the world made, not proved: there, and not ready */
  await clock.advance(3000);
  out.made = page.shaders.filter((s) => !isProbeSrc(s.src)).length;
  let release = () => {};
  const ready = new Promise((r) => { release = r; });
  journey.fly(door.UP, { title: "Orbit", subtitle: "to somewhere", ready });
  const gaveUp = () => page.lines.filter((l) => GAVE_UP.test(l)).length;
  await clock.advance(10000);                                 /* the climb reaches its hold and stands at it */
  out.holdingAtStart = page.bodyClasses.has("holding");
  if (!hide) {
    await clock.advance(35000, () => gaveUp() > 0);           /* visible: 30 s of standing at the hold */
    out.gaveUp = gaveUp();
    return out;
  }
  page.setHidden(true);
  for (let i = 0; i < 40; i++) await clock.advance(1000);     /* hidden for 40 s */
  out.gaveUpHidden = gaveUp();
  page.setHidden(false);
  release();                                                  /* the slow world comes in as the visitor returns */
  await clock.advance(1000);
  out.gaveUp = gaveUp();
  out.holdingAtEnd = page.bodyClasses.has("holding");
  return out;
}

if (process.argv[2] === "--child") await childMain(CASES);

{
  const f = runCase(import.meta.url, "failed-visible", 60000);
  check("control: the climb stands at its hold with the world made and not ready", !f.error && f.made >= 3 && f.holdingAtStart === true, `${f.made} shader(s); holding: ${f.holdingAtStart}${errOf(f)}`);
  check("#170: 30 s of visible time with a world that never becomes ready: the world is given up", !f.error && f.gaveUp === 1, `${f.gaveUp} 'not ready in 30 s' line(s) (want 1)${errOf(f)}`);
  const h = runCase(import.meta.url, "slow-hidden", 60000);
  check("#170 (precondition): the hidden case stands at its hold with the world made and not ready", !h.error && h.made >= 3 && h.holdingAtStart === true, `${h.made} shader(s); holding: ${h.holdingAtStart}${errOf(h)}`);
  check("#170: a healthy, slow world is not given up while the tab is hidden for 40 s", !h.error && h.gaveUpHidden === 0, `${h.gaveUpHidden} 'not ready in 30 s' line(s) after 40 s hidden (want 0)${errOf(h)}`);
  check("#170: ... nor once the visitor is back and the world comes in", !h.error && h.gaveUp === 0 && h.holdingAtEnd === false, `${h.gaveUp} 'not ready in 30 s' line(s); holding: ${h.holdingAtEnd}${errOf(h)}`);
}
finish();
