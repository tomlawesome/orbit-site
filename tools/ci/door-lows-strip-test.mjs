/*
 * Test for the sharper lights strip's upload failing (#89, B), written from the specification alone.
 *
 * The sharp strip (a fetch of img/dawn/lights-strip-180.webp on a wide screen, made an ImageBitmap) is put on the GPU
 * whole with texImage2D. If that call throws, the texture made for it is deleted and the error still goes on (the strip
 * stays small, the world keeps drawing). The wide screen is set before the door is imported (the tier is chosen once a
 * page); the throw is injected in the fake context for the strip's bitmap only.
 *
 *   S1 flight  the flight world (journey.warm() with the live door's flags, as the other flight tests do): every texture the failed upload bound
 *              is deleted, none deleted twice or never made, and a pinned flight is still drawn with the world
 *   S2 live    the live door (?door3d, the rich path as in door-live-release-test.mjs): the same balance
 *   S0         control: no throw -> the strip's texture is not deleted (the injection can see a live strip)
 *
 *   node tools/ci/door-lows-strip-test.mjs
 *
 * No dependencies and no browser; each case runs in a fresh Node process (this file again, as `--child`) against the
 * stub page in door-stub.mjs (trackGl counts created against deleted objects), on a virtual clock.
 */
import { INDEX, installPage, installClock, trackGl, mountLive, childMain, runCase, check, finish, errOf } from "./door-stub.mjs";

const CASES = {
  async "flight-control"() { return stripCase({ live: false, throws: false }); },
  async "flight"() { return stripCase({ live: false, throws: true }); },
  async "live-control"() { return stripCase({ live: true, throws: false }); },
  async "live"() { return stripCase({ live: true, throws: true }); },
};

async function stripCase({ live, throws }) {
  const urls = [];
  const page = installPage({
    fetch: (u) => { urls.push(String(u)); return Promise.resolve({ ok: true, blob: async () => ({ size: 1, strip: /lights-strip/.test(String(u)) }), arrayBuffer: async () => new ArrayBuffer(1) }); },
  });
  const tr = trackGl(page);
  const clock = installClock();
  globalThis.innerWidth = 2000; globalThis.innerHeight = 1000;      /* wide enough for the sharp tier (chosen once a page) */
  globalThis.screen = { width: 2000, height: 1000 };
  globalThis.createImageBitmap = async (src, ...r) => {
    const cut = r.length >= 4;
    return { width: cut ? r[2] : (src?.probe ? 1 : 64), height: cut ? r[3] : (src?.probe ? 2 : 64), probe: !!src?.probe, strip: !!src?.strip, close() {} };
  };
  const g = page.glBase, texImage2D = g.texImage2D, thrown = [], tried = [];
  g.texImage2D = (...a) => {
    if (a[a.length - 1]?.strip) {
      tried.push(page.boundTexture);
      if (throws) { thrown.push(page.boundTexture); throw new Error("the strip upload failed"); }
    }
    return texImage2D(...a);
  };
  const out = {};
  if (live) {
    const m = await mountLive(page, { rich: "1", gpu: "force", fit: "skip" });
    m.dawn.start();
    m.dawn.light({ firstVisit: false, aside: true, onLit() {}, onOpen() {}, after() {} });
    m.dawn.live.compile();
    await clock.advance(3000);
    m.dawn.live.start();
    await clock.advance(30000);
  } else {
    /* the probe kept from an earlier visit (CAPABILITIES.md) says the door may be live, so the flight's world is the live door's */
    const kept = new Map();
    const seed = JSON.stringify({ t: Date.now() - 3600000, r: { background: true, compileMs: 60, msPerMpx: 5, ok: true } });
    for (const s of ["2000x1000", `${innerWidth}x${innerHeight}`]) kept.set(`orbit-probe ${navigator.userAgent} ${s}@${devicePixelRatio}`, seed);
    globalThis.localStorage = { getItem: (k) => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => { kept.set(k, String(v)); }, removeItem: (k) => { kept.delete(k); }, key: (i) => [...kept.keys()][i] ?? null, get length() { return kept.size; } };
    const door = await import(INDEX);
    const d = door.createDoor({ typingWait: 0, flags: { door3d: "1", level: "2", rich: "1" } });
    door.gpu();
    door.openChores();
    const journey = d.journey(page.journeyOptions());
    let state = "pending";
    journey.warm().then(() => { state = "resolved"; }, () => { state = "rejected"; });
    await clock.advance(30000, () => state !== "pending");
    await clock.advance(20000);
    const draws = page.draws;
    journey.fly(door.UP, { title: "Orbit", subtitle: "to somewhere", at: 2000 });
    await clock.advance(500);
    out.drawsAfter = page.draws - draws;
    out.proved = page.lines.filter((l) => /flight world: on/.test(l)).length;
  }
  out.fetched = urls.filter((u) => /lights-strip/.test(u)).length;
  out.tried = tried.length; out.thrown = thrown.length;
  out.kept = tried.filter((t) => t && !t.released).length;
  out.faults = tr.faults.slice();
  return out;
}

if (process.argv[2] === "--child") await childMain(CASES);

for (const [how, what] of [["flight", "flight world"], ["live", "live door"]]) {
  const c = runCase(import.meta.url, `${how}-control`, 55000);
  check(`S0 control (${what}): with no throw the sharp strip is fetched and put on the GPU, and its texture is kept`, !c.error && c.fetched >= 1 && c.tried >= 1 && c.kept >= 1, `fetched ${c.fetched}, texImage2D with the strip ${c.tried}, textures kept ${c.kept}${errOf(c)}`);
  const r = runCase(import.meta.url, how, 55000);
  check(`S (${what}) precondition: the strip's texImage2D was reached and threw`, !r.error && r.thrown >= 1, `${r.thrown} throw(s) injected${errOf(r)}`);
  check(`S (${what}): the texture made for the failed strip upload is deleted`, !r.error && r.thrown >= 1 && r.kept === 0, `${r.kept} of ${r.thrown} texture(s) left alive${errOf(r)}`);
  check(`S (${what}): ... with no object deleted twice or never made`, !r.error && r.faults.length === 0, `${JSON.stringify(r.faults)}${errOf(r)}`);
  if (how === "flight") check("S (flight world): the world keeps drawing: a pinned flight is drawn on the GPU", !r.error && r.proved >= 1 && r.drawsAfter > 0, `${r.proved} 'flight world: on' line(s), ${r.drawsAfter} draw call(s)${errOf(r)}`);
}
finish();
