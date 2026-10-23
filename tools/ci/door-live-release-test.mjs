/*
 * Test for a destroyed live door giving back what it made on the GPU (#84, item 4), written from the specification
 * alone. The live door (door3d.js, `?door3d`) is mounted through the dawn as a host does and taken down by
 * dawn.destroy(). After that:
 *   L1 the textures, buffers, framebuffers and vertex arrays it made are all deleted (programs and shaders may stay),
 *      none is deleted twice or was never made, and the canvas that was given the class "live" has lost it.
 * Control (L0): shown and not destroyed, the live door has objects alive, so the counting can see what a fix must free.
 *
 *   node tools/ci/door-live-release-test.mjs
 *
 * No dependencies and no browser; each case runs in a fresh Node process (this file again, as `--child`) against the
 * stub page in door-stub.mjs (trackGl counts create* against delete*, the crop probe's own objects left out), on a
 * virtual clock, so nothing depends on how fast the machine runs.
 * NOT REACHED: the fake context cannot make the capability probe say ok, so the live door runs as its "lean" one (see
 * door-live-teardown-test.mjs), which makes no banded picture upload and no ImageBitmap (measured: its only uploads
 * are its own small textures, and createImageBitmap is never asked for a whole picture). So these two parts of the
 * issue are not tested: an upload (uploadBanded) finishing after destroy deletes its texture and does not store it,
 * and a strip picture becoming ready after destroy has its ImageBitmap closed.
 */
import { installPage, installClock, trackGl, mountLive, childMain, runCase, check, finish, errOf } from "./door-stub.mjs";

const CASES = {
  async "control"() { return run({ destroy: false }); },
  async "destroyed"() { return run({ destroy: true }); },
};

async function run({ destroy }) {
  const page = installPage();
  const tr = trackGl(page);
  const clock = installClock();
  const m = await mountLive(page);
  m.dawn.start();
  m.dawn.light({ firstVisit: false, aside: true, onLit() {}, onOpen() {}, after() {} });
  m.dawn.live.compile();
  await clock.advance(3000);
  m.dawn.live.start();
  await clock.advance(3000);
  if (destroy) m.dawn.destroy();
  await clock.advance(6000);
  return {
    live: tr.live(), liveTotal: tr.liveTotal(), faults: tr.faults.slice(), objects: tr.objects.filter((h) => !h.probe).length,
    everLive: tr.everLive.size, stillLive: [...tr.everLive].filter((c) => c.classList.contains("live")).length,
  };
}

if (process.argv[2] === "--child") await childMain(CASES);

{
  const c = runCase(import.meta.url, "control", 30000);
  check("L0 control: a shown live door has objects alive on the context", !c.error && c.liveTotal > 0 && c.everLive >= 1, `made ${c.objects}; alive ${JSON.stringify(c.live)}; canvas(es) ever given 'live' ${c.everLive}${errOf(c)}`);
  const d = runCase(import.meta.url, "destroyed", 30000);
  check("L1: after dawn.destroy() every texture, buffer, framebuffer and vertex array it made is deleted", !d.error && d.objects > 0 && d.liveTotal === 0, `made ${d.objects}; still alive ${JSON.stringify(d.live)}${errOf(d)}`);
  check("L1: ... with no object deleted twice or never made", !d.error && d.faults.length === 0, `${JSON.stringify(d.faults)}${errOf(d)}`);
  check("L1: the old canvas loses its 'live' class", !d.error && d.everLive >= 1 && d.stillLive === 0, `${d.everLive} canvas(es) were given 'live'; ${d.stillLive} still have it${errOf(d)}`);
}
finish();
