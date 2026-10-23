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
 *   L2 (rich) the same under the rich path (flags door3d, rich, gpu force, fit skip), which makes more objects and
 *      fetches the maps and strip pictures: the balance holds there too
 *   L3 an Earth-map upload that finishes after destroy (destroy() is called at the first picture upload call and the
 *      upload carries on) deletes its texture: nothing is left alive
 *   L4 a strip picture that becomes ready after destroy (every whole-picture ImageBitmap is held until after
 *      dawn.destroy()) is closed, and the late uploads it leads to leave nothing alive
 * The lean door (no flags beyond door3d) is L0/L1; the rich one is L2-L4.
 * "The upload does not store the texture" is judged only as the balance: a draw count after destroy is no help, the
 * capability probe's own draw calls land there.
 */
import { installPage, installClock, trackGl, mountLive, childMain, runCase, check, finish, errOf } from "./door-stub.mjs";

const CASES = {
  async "control"() { return run({ destroy: false }); },
  async "destroyed"() { return run({ destroy: true }); },
  async "rich-control"() { return run({ destroy: false, rich: true }); },
  async "rich-destroyed"() { return run({ destroy: true, rich: true }); },
  async "upload"() { return run({ destroy: false, rich: true, strike: true }); },
  async "bitmap"() { return run({ destroy: true, rich: true, hold: true }); },
};

async function run({ destroy, rich = false, strike = false, hold = false }) {
  const page = installPage({ fetch: () => Promise.resolve({ ok: true, blob: async () => ({ size: 1 }) }) });
  const tr = trackGl(page);
  const clock = installClock();
  /* whole-picture bitmaps (not a crop, not the crop probe's); with `hold` they are not delivered until released */
  const bitmaps = [];
  let release; const gate = new Promise((r) => { release = r; });
  globalThis.createImageBitmap = async (src, ...r) => {
    const cut = r.length >= 4;
    const b = { width: cut ? r[2] : (src?.probe ? 1 : 64), height: cut ? r[3] : (src?.probe ? 2 : 64), probe: !!src?.probe, closed: false, late: false, close() { this.closed = true; } };
    if (!cut && !b.probe) { bitmaps.push(b); if (hold) { await gate; b.late = true; } }
    return b;
  };
  const m = await mountLive(page, rich ? { rich: "1", gpu: "force", fit: "skip" } : {});
  let struck = false, drawsAtDestroy = null;
  if (strike) {
    for (const name of ["texSubImage2D", "texImage2D"]) {
      const orig = page.glBase[name];
      page.glBase[name] = (...a) => {
        const r = orig(...a);
        if (!struck && !a[a.length - 1]?.probe) { struck = true; drawsAtDestroy = page.draws; m.dawn.destroy(); }
        return r;
      };
    }
  }
  m.dawn.start();
  m.dawn.light({ firstVisit: false, aside: true, onLit() {}, onOpen() {}, after() {} });
  m.dawn.live.compile();
  await clock.advance(3000);
  m.dawn.live.start();
  await clock.advance(3000);
  const pending = bitmaps.filter((b) => !b.late).length;
  if (destroy) { drawsAtDestroy = page.draws; m.dawn.destroy(); }
  await clock.advance(500);
  if (hold) release();
  await clock.advance(6000);
  return {
    struck, pending, bitmaps: bitmaps.length, late: bitmaps.filter((b) => b.late).length, lateOpen: bitmaps.filter((b) => b.late && !b.closed).length,
    drawsAfter: drawsAtDestroy === null ? null : page.draws - drawsAtDestroy,
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
{
  const c = runCase(import.meta.url, "rich-control", 30000);
  check("L2 control: a shown rich live door has objects alive and has fetched pictures", !c.error && c.liveTotal > 0 && c.bitmaps >= 1, `made ${c.objects}; alive ${JSON.stringify(c.live)}; ${c.bitmaps} whole-picture bitmap(s)${errOf(c)}`);
  const d = runCase(import.meta.url, "rich-destroyed", 30000);
  check("L2: rich: after dawn.destroy() everything it made is deleted", !d.error && d.objects > 0 && d.liveTotal === 0, `made ${d.objects}; still alive ${JSON.stringify(d.live)}${errOf(d)}`);
  check("L2: rich: ... with no object deleted twice or never made, and the 'live' class gone", !d.error && d.faults.length === 0 && d.stillLive === 0, `faults ${JSON.stringify(d.faults)}; ${d.stillLive} canvas(es) still 'live'${errOf(d)}`);
  const u = runCase(import.meta.url, "upload", 30000);
  check("L3 (precondition): the live door was destroyed in the middle of a picture upload", !u.error && u.struck === true, `struck ${u.struck}${errOf(u)}`);
  check("L3: an Earth-map upload that finishes after destroy deletes its texture (nothing left alive)", !u.error && u.struck === true && u.liveTotal === 0 && u.faults.length === 0, `still alive ${JSON.stringify(u.live)}; faults ${JSON.stringify(u.faults)}${errOf(u)}`);
  const b = runCase(import.meta.url, "bitmap", 30000);
  check("L4 (precondition): a picture's bitmap was held past destroy and then delivered", !b.error && b.late >= 1, `${b.bitmaps} whole-picture bitmap(s) asked for, ${b.late} delivered after destroy${errOf(b)}`);
  check("L4: a strip picture that becomes ready after destroy has its ImageBitmap closed", !b.error && b.late >= 1 && b.lateOpen === 0, `${b.lateOpen} of ${b.late} bitmap(s) delivered after destroy left open${errOf(b)}`);
  check("L4: ... and the late pictures leave nothing alive on the context", !b.error && b.late >= 1 && b.liveTotal === 0, `still alive ${JSON.stringify(b.live)}${errOf(b)}`);
}
finish();
