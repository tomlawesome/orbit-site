/*
 * Test for #113 (anisotropy asked once), written from the specification alone. In Firefox every gl.getParameter is a
 * blocking round trip to the GPU process that waits behind all queued GL calls, and the site asked
 * MAX_TEXTURE_MAX_ANISOTROPY_EXT for every texture it sharpened. For the install/info world (assets/js/world.js) and the
 * flight's world (reached through assets/door/index.js, as a host does):
 *
 *   R1  each context is asked getParameter(MAX_TEXTURE_MAX_ANISOTROPY_EXT) at most once over the world's whole warm-up
 *       (all its map textures put on the GPU with mipmaps), however many textures are sharpened
 *   R2  every texture that gets mipmaps still gets texParameterf(TEXTURE_2D, TEXTURE_MAX_ANISOTROPY_EXT, value): value is
 *       min(8, limit) in the install/info world and min(16, limit) in the flight's world (limit 4 and limit 16 are run, so
 *       both the cap and the limit show)
 *   control  more than one texture is sharpened in each world, so R1 is not vacuous
 *
 *   node tools/ci/aniso-once-test.mjs
 *
 * No dependencies and no browser; each case runs in a fresh Node process (this file again, as `--child`) on the stub
 * page of door-stub.mjs and its virtual clock. The stub has no anisotropy extension, so this file gives it one with
 * distinct constants, and a fake limit that is the case's own.
 */
import { INDEX, installClock, bootInstallPage, settled, infoWorld, installPage, childMain, runCase, chk, finish } from "./door-stub.mjs";

const WORLD = "../../assets/js/world.js";
const TEXTURE_MAX = 0x84fe, MAX_TEXTURE_MAX = 0x84ff;
const MOON = { map: "http://localhost/map.webp", rings: "http://localhost/rings.png", moon: "http://localhost/moon.webp", small: true };
const BLOB = { ok: true, status: 200, blob: async () => ({ size: 1, type: "image/webp" }) };

/* give the page's context the extension and a limit, and record what is asked of it (call before the world is made) */
function watch(page, limit) {
  const ext = { TEXTURE_MAX_ANISOTROPY_EXT: TEXTURE_MAX, MAX_TEXTURE_MAX_ANISOTROPY_EXT: MAX_TEXTURE_MAX };
  const w = { limitAsks: 0, sharpened: [], contexts: () => page.contexts };
  const getExtension = page.glBase.getExtension, getParameter = page.glBase.getParameter;
  page.glBase.getExtension = (n) => (/^(?:EXT|MOZ_EXT|WEBKIT_EXT)_texture_filter_anisotropic$/.test(String(n)) ? ext : getExtension(n));
  page.glBase.getParameter = (p) => { if (p === MAX_TEXTURE_MAX) { w.limitAsks++; return limit; } return getParameter(p); };
  page.glBase.texParameterf = (target, pname, value) => { if (pname === TEXTURE_MAX) w.sharpened.push({ texture: page.boundTexture, target, value }); };
  return w;
}

/* what the checks read: the asks, and, of the textures that got mipmaps, how many were sharpened and with what */
function report(page, w) {
  const mipped = [...new Set(page.mipped)];
  const sharpTextures = new Set(w.sharpened.map((s) => s.texture));
  return {
    limitAsks: w.limitAsks, contexts: page.contexts, mipped: mipped.length, sharpened: sharpTextures.size, sharpCalls: w.sharpened.length,
    unsharp: mipped.filter((t) => !sharpTextures.has(t)).length,
    values: [...new Set(w.sharpened.map((s) => s.value))], targets: [...new Set(w.sharpened.map((s) => s.target))],
  };
}

/* the install's and the information's world: createWorld on the install page, baked */
async function install(limit, look) {
  const b = await bootInstallPage({});
  const w = watch(b.page, limit);
  const canvas = new b.dom.Canvas(); canvas.className = "orbitgl";
  /* the stub hands every canvas the same context object; the world's own is a view of it that counts its own asks, so
     "each context" is read for the world's context alone (the install page's door has a context of its own) */
  const own = { asks: 0 };
  const view = new Proxy(b.page.gl, { get: (t, k) => (k === "getParameter" ? (p) => { if (p === MAX_TEXTURE_MAX) own.asks++; return t.getParameter(p); } : t[k]) });
  const getContext = canvas.getContext.bind(canvas);
  canvas.getContext = (kind, ...a) => (kind === "webgl2" ? (b.page.contexts++, view) : getContext(kind, ...a));
  const opts = look === "info" ? { ...(await infoWorld()).world, ...MOON, tag: "info" } : { ...MOON, tag: "install" };
  const world = (await import(WORLD)).createWorld(canvas, opts);
  if (!world) return { error: "createWorld gave no world on the stub page" };
  const baked = await settled(world.bake(), b.clock, 60000);
  await b.clock.advance(2000);
  return { baked: baked.state === "resolved" ? baked.value : baked.state, ...report(b.page, w), ownAsks: own.asks };
}

/* the flight's world: the journey's warm-up, with every picture arriving */
async function flight(limit) {
  const page = installPage({ fetch: () => Promise.resolve(BLOB) });
  const clock = installClock();
  const w = watch(page, limit);
  const door = await import(INDEX);
  const d = door.createDoor({ typingWait: 0, flags: {} });
  door.openChores();
  const journey = d.journey(page.journeyOptions());
  const warm = await settled(journey.warm({ prove: false }), clock, 60000);
  await clock.advance(3000);
  return { warm: warm.state, ...report(page, w) };
}

const CASES = {
  install4: () => install(4), install16: () => install(16),
  info4: () => install(4, "info"), info16: () => install(16, "info"),
  flight4: () => flight(4), flight16: () => flight(16),
};

if (process.argv[2] === "--child") await childMain(CASES);

/* ----- the checks ----- */
const show = (r) => `${r.ownAsks ?? r.limitAsks} ask(s) of the limit by the world's context (${r.limitAsks} on the page); ${r.mipped} texture(s) mipmapped, ${r.sharpened} sharpened (${r.sharpCalls} call(s)), ${r.unsharp} mipmapped but not sharpened; values ${JSON.stringify(r.values)}; ${r.contexts} context(s)`;
for (const [label, cases, cap] of [["install world", ["install4", "install16"], 8], ["info world", ["info4", "info16"], 8], ["flight world", ["flight4", "flight16"], 16]]) {
  for (const [how, limit] of [[cases[0], 4], [cases[1], 16]]) {
    const want = Math.min(cap, limit);
    const r = runCase(import.meta.url, how, 120000);
    chk(`${label}, limit ${limit}: control: more than one texture is sharpened (R1 is not vacuous)`, r, (r) => [r.sharpened > 1, show(r)]);
    chk(`${label}, limit ${limit}: R1 the limit is asked for at most once over the warm-up`, r, (r) => [(r.ownAsks ?? r.limitAsks) <= 1, show(r)]);
    chk(`${label}, limit ${limit}: R2 every mipmapped texture is sharpened, with TEXTURE_2D, ${want} (min(${cap}, ${limit}))`, r, (r) => [r.mipped > 0 && r.unsharp === 0 && r.values.length === 1 && r.values[0] === want && r.targets.every((t) => t === 0xde1), show(r)]);
  }
}
finish();
