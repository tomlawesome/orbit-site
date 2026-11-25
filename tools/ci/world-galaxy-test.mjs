/*
 * Test for #119 (the install world's galaxy shipped as a picture), written from the specification alone (statements
 * G1-G17; decisions D1-D7 accepted). The world's galaxy is a picture, galaxy.webp (4096 x 4096; galaxy-2k.webp, 2048 x
 * 2048, when small): colour above, star density below, each half KW wide and KH = KW / 2 high. A tiny program puts the
 * halves into the galaxy texture in one job, its mipmaps follow in a second (a frame each), the picture's texture and
 * that program are let go, and the painting shader (SKY) is never built. Where there is no picture to be had the galaxy
 * is painted as ever.
 *
 *   node tools/ci/world-galaxy-test.mjs
 *
 * One fresh Node process a case (this file again, as `--child`) on the stub page of door-stub.mjs and its virtual clock,
 * as aniso-once-test.mjs; the worker cases on a worker's scope as world-worker-test.mjs. No browser, no dependencies.
 * Cases write each G number in their names; a statement with several parts has a line for each part.
 *
 *   G1   picturesOf(opts).GALAXY: the absolute url of img/install/galaxy.webp, galaxy-2k.webp when small; opts.galaxy wins
 *   G2   createRemoteWorld's hello carries world.galaxy, absolute, 2k when small (the key list is world-hello-test's)
 *   G3   world-worker passes hello's world.galaxy to createWorld (the picture is fetched from it); none given: the default
 *   G4   fetchWorld asks for map, rings, moon and galaxy once each; opts.sky set: no galaxy; the gate refusing: nothing
 *   G5   createWorld with no opts.sky on a card whose textures are wide enough: the picture fetched once, SKY never compiled
 *   G6   once baked: one KW x KH SRGB8_ALPHA8 texture, mipmapped (in a frame after the picture went in); the picture's
 *        texture and the tiny program deleted
 *   G6b  (review) the world cannot be made, the context alive: the picture's texture and the tiny program are deleted too
 *   G7   bake() waits for a picture still coming (a held fetch), then resolves true, with no painting pass
 *   G8   fetch or decode rejects: one warn, SKY compiled, four strips and the mipmaps, true
 *   G9   a picture of the wrong size: as G8, its bitmap closed, the warning names both sizes
 *   G10  MAX_TEXTURE_SIZE below KW: no picture asked for, painted
 *   G11  opts.sky = 1024: KW 1024, no picture asked for, painted
 *   G12  the flags sky=paint, sky=late, stalls and probe change nothing: a picture, no readPixels, no galaxy note lines
 *   G13  the context lost while the picture is pending: bake() gives false and no GL call is made after the loss
 *   G14  decode "page": the worker's galaxy comes by the same decode message as the map, no new message type
 *   G15  the image files: both exist, WebP, 4096 x 4096 and 2048 x 2048, under 500 KB and 200 KB
 *   G16  tools/galaxy-bake.cjs exists; the README names it and both images; no Gaia, NASA/ESA or CC BY-NC credit returns
 *   G17  nothing under assets/door/ names a galaxy picture or the bake tool, or imports the world's modules
 *
 * NOT COVERED HERE (a browser, or the bake tool's real run, is needed):
 *   - that the baked texture's pixels are the picture's: colour in rgb and density in alpha, the halves put the right
 *     way up, sRGB decoded as the shader's output was (a node stub reads no pixel): the browser pixel check
 *   - that the picture's own pixels are the galaxy (the density floor 125 reads 0.205 = the shader's 0.2) and that
 *     tools/galaxy-bake.cjs, run in Playwright, makes both files from SKY (same-origin only), the rough files compared
 *   - the 22 ms against 0.25 s four times on a real device, and the draw being unchanged (the world's pixel tests)
 *   - that sw.js's MEDIA hash was regenerated last (the lint prints it) and that the README row says "the site's own drawing"
 *     in words: only the names and the bake tool are looked for here (G16)
 *
 * The stub's getParameter answers a string, so MAX_TEXTURE_SIZE is set here as aniso-once-test.mjs sets what it needs;
 * the stub's constants are all 1, so SRGB8_ALPHA8 and MAX_TEXTURE_SIZE are given distinct values.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  bootInstallPage, isProbeSrc, settled, fakeWorldWorkers, installWorldWorker, installPage, installClock, installWorkerSelf, BASE, childMain, runCase, chk, finish,
} from "./door-stub.mjs";

const WORLD = "../../assets/js/world.js", REMOTE = "../../assets/js/remote-world.js", WORKER = "../../assets/js/world-worker.js";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const at = (p) => new URL(`../../assets/${p}`, import.meta.url).href;
const GALAXY = at("img/install/galaxy.webp"), GALAXY_2K = at("img/install/galaxy-2k.webp");
const PICS = { map: "http://localhost/map.webp", rings: "http://localhost/rings.png", moon: "http://localhost/moon.webp" };
const MAX_TEXTURE_SIZE = 0x0d33, SRGB8_ALPHA8 = 0x8c43;
const SAID = "orbit: the galaxy is painted, not loaded";
/* a galaxy picture, by the file name alone (the checkout's own path may say galaxy too) */
const isGalaxy = (url) => /\/[^/?#]*galaxy[^/?#]*\.webp(?:[?#]|$)/.test(String(url));
const isSky = (src) => /uSize/.test(String(src)) && /dirOf/.test(String(src));   /* SKY's marker (THE GALAXY is only a comment) */

const plainError = (message) => Object.assign(new Error(message), { plain: true });
const guarded = (cases) => Object.fromEntries(Object.entries(cases).map(([k, f]) => [k, async () => { try { return await f(); } catch (e) { if (e && e.plain) return { none: e.message }; throw e; } }]));
const missing = (e, what) => (e && e.code === "ERR_MODULE_NOT_FOUND" && String(e.message).includes(what) ? plainError(`${what} does not exist yet`) : e);

/*
 * rig(b, o): the stub page's context made to tell what a galaxy needs. Records, on R: the size and internal format of every
 * texture (texImage2D, texStorage2D), the programs made and let go, the scissors (a painted strip each), the times of
 * every draw and of every mipmap (virtual time: one frame apart is two times apart), every galaxy fetch; the fetch answers
 * a blob that knows its url, and createImageBitmap answers the galaxy's blob with a bitmap of o.size (closes counted).
 * o.galaxy: "ok" | "reject" (fetch fails) | "decode" (decode fails) | "hold" (the fetch waits for R.release()).
 */
function rig(b, o = {}) {
  const { page } = b, gl = page.glBase;
  const R = { sizes: new Map(), programs: [], deleted: new Set(), scissors: 0, draws: [], mips: [], galaxyFetches: [], bitmaps: [], mode: o.galaxy ?? "ok", release: () => {} };
  gl.MAX_TEXTURE_SIZE = MAX_TEXTURE_SIZE; gl.SRGB8_ALPHA8 = SRGB8_ALPHA8;
  const getParameter = gl.getParameter;
  /* o.linkFails: a program that cannot be linked (the world's own are made false by it, the context is alive) */
  if (o.linkFails) { const gp = gl.getProgramParameter; gl.LINK_STATUS = 0x8b82; gl.getProgramParameter = (p, n) => (n === 0x8b82 ? false : gp(p, n)); }
  gl.getParameter = (p) => (p === MAX_TEXTURE_SIZE ? o.maxTex ?? 16384 : getParameter(p));
  const note = (w, h, internal, level = 0) => { if (level === 0 && page.boundTexture && Number.isFinite(w)) R.sizes.set(page.boundTexture, { w, h, internal }); };
  const texImage2D = gl.texImage2D, texStorage2D = gl.texStorage2D;
  gl.texImage2D = (...a) => {
    const src = a.length <= 6 ? a[5] : null;
    if (!src?.probe) { if (a.length <= 6) note(src?.width, src?.height, a[2], a[1]); else note(a[3], a[4], a[2], a[1]); }
    return texImage2D(...a);
  };
  gl.texStorage2D = (...a) => { note(a[3], a[4], a[2]); return texStorage2D(...a); };
  const generateMipmap = gl.generateMipmap;
  gl.generateMipmap = (...a) => { R.mips.push({ tex: page.boundTexture, at: performance.now() }); return generateMipmap(...a); };
  const createProgram = gl.createProgram;
  gl.createProgram = () => { const p = createProgram(); R.programs.push(p); return p; };
  gl.deleteProgram = (p) => { R.deleted.add(p); };
  gl.scissor = () => { R.scissors++; };
  gl.drawArrays = () => { R.draws.push(performance.now()); };
  const bitmaps = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async (src, ...r) => {
    if (src && src.url && isGalaxy(src.url)) {
      if (R.mode === "decode") throw new Error("the picture cannot be decoded");
      const bm = { width: o.size[0], height: o.size[1], closes: 0, close() { bm.closes++; } };
      R.bitmaps.push(bm);
      return bm;
    }
    return bitmaps(src, ...r);
  };
  let gate = new Promise((go) => { R.release = go; });
  globalThis.fetch = async (url) => {
    const u = String(url);
    b.fetched.push(u);
    if (isGalaxy(u)) {
      R.galaxyFetches.push(u);
      if (R.mode === "reject") throw new Error("no network here");
      if (R.mode === "hold") await gate;
    }
    return { ok: true, status: 200, blob: async () => ({ size: 1, type: "image/webp", url: u }) };
  };
  return R;
}

/* the install page, rigged, with a world on it (createWorld as aniso-once-test makes it; the pictures but the galaxy given) */
async function scene(o = {}) {
  const small = !!o.small;
  const b = await bootInstallPage({ flags: { decode: "blob", ...(o.flags || {}) } });
  const R = rig(b, { size: o.size ?? (small ? [2048, 2048] : [4096, 4096]), ...o });
  const canvas = new b.dom.Canvas(); canvas.className = "orbitgl";
  const warns = [];
  const warn = (...a) => warns.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(" "));
  const world = (await import(WORLD)).createWorld(canvas, { ...PICS, small, tag: "install", warn, ...(o.opts || {}) });
  if (!world) throw plainError("createWorld gave no world on the stub page");
  return { b, R, world, warns, KW: o.opts?.sky ?? (small ? 2048 : 4096) };
}

/* what the checks read of a scene once it has been baked (or not) */
function look(s) {
  const { b, R, KW } = s, page = b.page;
  const tex = [...R.sizes].map(([t, v]) => ({ ...v, mipped: page.mipped.includes(t), deleted: page.deletedTextures.includes(t), t }));
  const galaxies = tex.filter((t) => t.w === KW && t.h === KW / 2 && t.internal === SRGB8_ALPHA8);
  const pictures = tex.filter((t) => t.w === KW && t.h === KW);
  const srcOf = (p) => (p?.shaders ?? []).map((x) => x.src).join("\n");
  /* (the door's own crop probe is a program too, made and let go: it is not the world's) */
  const own = R.programs.filter((p) => !isProbeSrc(srcOf(p)));
  const alive = own.filter((p) => !R.deleted.has(p));
  return {
    KW, galaxyFetches: R.galaxyFetches.length, galaxyUrls: R.galaxyFetches, skyCompiled: b.page.shaders.filter((x) => isSky(x.src)).length,
    skyPrograms: R.programs.filter((p) => isSky(srcOf(p))).length, draws: R.draws.length, scissors: R.scissors, readPixels: page.readPixels,
    galaxies: galaxies.length, galaxyMipped: galaxies.length === 1 && galaxies[0].mipped, galaxyDeleted: galaxies.some((t) => t.deleted),
    pictures: pictures.length, picturesDeleted: pictures.filter((t) => t.deleted).length,
    programs: own.length, deletedPrograms: own.filter((p) => R.deleted.has(p)).length, alive: alive.length,
    /* (the mipmaps are a job of their own: a draw before their frame, none in it) */
    mipAfterDraw: galaxies.length === 1 && R.mips.some((m) => m.tex === galaxies[0].t && R.draws.some((d) => d < m.at) && !R.draws.includes(m.at)),
    bitmaps: R.bitmaps.map((x) => x.closes), warns: s.warns, galaxyLines: page.lines.filter((l) => /galaxy/i.test(l)),
    sizes: tex.map((t) => `${t.w}x${t.h}`),
  };
}

async function bakeOf(s, ms = 60000) {
  const r = await settled(s.world.bake(), s.b.clock, ms);
  await s.b.clock.advance(500);
  return { baked: r.state === "resolved" ? r.value : r.state, ...look(s) };
}

/* ---------- G1, G2: where the picture is ---------- */
async function g1() {
  const b = await bootInstallPage({});
  const { picturesOf } = await import(WORLD);
  if (typeof picturesOf !== "function") throw plainError("world.js exports no picturesOf");
  const over = "http://localhost/mine.webp";
  return { large: picturesOf({ small: false }).GALAXY, small: picturesOf({ small: true }).GALAXY, over: picturesOf({ small: true, galaxy: over }).GALAXY, overWant: over };
}
async function remote(small) {
  const b = await bootInstallPage({ draw: "worker" });
  b.ww = installWorldWorker(b, fakeWorldWorkers({}));
  let mod;
  try { mod = await import(REMOTE); } catch (e) { throw missing(e, "remote-world.js"); }
  mod.createRemoteWorld(b.pad().canvas, { tag: "install", small }, { worker: () => b.ww.make() });
  await b.clock.advance(100);
  const w = b.ww.first();
  if (!w) return { none: "createRemoteWorld made no worker" };
  return { world: JSON.parse(JSON.stringify(w.posted[0]?.world ?? null)) };
}

/* ---------- G3, G14: the worker ---------- */
const WURLS = { map: new URL("assets/img/install/planet-2k.webp", BASE).href, rings: new URL("assets/img/install/rings.png", BASE).href, moon: new URL("assets/door/img/flight/moon.webp", BASE).href };
async function wboot() {
  const page = installPage(), clock = installClock(), w = installWorkerSelf(page);
  w.page = page; w.clock = clock;
  const frame = (f) => { w.rafs++; return globalThis.setTimeout(() => f(performance.now()), 16); };
  globalThis.requestAnimationFrame = frame; w.self.requestAnimationFrame = frame;
  try { await import(WORKER); } catch (e) { throw missing(e, "world-worker"); }
  w.R = rig({ page, fetched: w.fetched }, { size: [2048, 2048] });
  w.run = (ms, until) => clock.advance(ms, until);
  w.bring = async (world, extra = {}) => {
    w.send({ type: "hello", flags: {}, baseURI: BASE, world: { small: true, ...WURLS, ...world }, tag: "install", ...extra });
    w.send({ type: "canvas", canvas: w.warp });
    await w.run(0);
  };
  return w;
}
const galaxyFetched = (w) => w.fetched.filter(isGalaxy);
async function g3(given) {
  const w = await wboot();
  await w.bring(given ? { galaxy: given } : {});
  w.send({ type: "bake", id: 1 });
  await w.run(30000, () => w.of("baked").some((m) => m.id === 1));
  await w.run(500);
  return { fetched: galaxyFetched(w), given, baked: w.of("baked").map((m) => m.ok), deads: w.of("dead").map((m) => m.why), sky: page_skyCount(w.page) };
}
const page_skyCount = (page) => page.shaders.filter((x) => isSky(x.src)).length;
async function g14(control) {
  const w = await wboot();
  const bitmapOf = (url) => (isGalaxy(url) ? { width: 2048, height: 2048, closes: 0, close() { this.closes++; } } : { width: 64, height: 64, closes: 0, close() { this.closes++; } });
  await w.bring({}, { decode: "page", ...(control ? { sky: 1024 } : {}) });
  w.send({ type: "bake", id: 1 });
  const answered = new Set(), urls = [];
  for (let i = 0; i < 400 && !w.of("baked").some((m) => m.id === 1); i++) {
    await w.run(100);
    for (const m of w.of("decode")) {
      if (answered.has(m.id)) continue;
      answered.add(m.id); urls.push(String(m.blob && m.blob.url));
      w.send({ type: "decoded", id: m.id, bitmap: bitmapOf(m.blob && m.blob.url) });
    }
  }
  await w.run(500);
  return {
    urls, galaxyAsks: urls.filter(isGalaxy).length, baked: w.of("baked").map((m) => m.ok), deads: w.of("dead").map((m) => m.why),
    types: [...new Set(w.posted.map((m) => m && m.type))], sky: page_skyCount(w.page), cloneErrors: w.cloneErrors,
  };
}

/* ---------- G4: fetchWorld ---------- */
async function g4(how) {
  const b = await bootInstallPage({ flags: { decode: "blob" }, ...(how === "refused" ? { renderer: "llvmpipe" } : {}) });
  rig(b, { size: [4096, 4096] });
  const { fetchWorld } = await import(WORLD);
  if (typeof fetchWorld !== "function") throw plainError("world.js exports no fetchWorld");
  fetchWorld(how === "sky" ? { sky: 1024 } : {});
  await b.clock.advance(50);
  const n = (u) => b.fetched.filter((x) => x === u).length;
  return {
    total: b.fetched.length, map: n(at("img/install/planet.webp")), rings: n(at("img/install/rings.png")), moon: n(at("door/img/flight/moon.webp")),
    galaxy: n(GALAXY), anyGalaxy: b.fetched.filter(isGalaxy).length, fetched: b.fetched,
  };
}

/* ---------- the world's own cases (G5-G13) ---------- */
const CASES = guarded({
  g1, g2large: () => remote(false), g2small: () => remote(true),
  g3given: () => g3("https://site.test/app/elsewhere/hello-galaxy.webp"), g3none: () => g3(null), g14: () => g14(false), g14control: () => g14(true),
  g4all: () => g4("all"), g4sky: () => g4("sky"), g4refused: () => g4("refused"),
  async g5() {
    const s = await scene();
    return await bakeOf(s);
  },
  async g7() {
    const s = await scene({ galaxy: "hold" });
    const p = s.world.bake();
    const early = await settled(p, s.b.clock, 5000);
    const during = look(s);
    s.R.release();
    const late = await settled(p, s.b.clock, 60000);
    await s.b.clock.advance(500);
    return { early: early.state, askedEarly: during.galaxyFetches, late: late.state === "resolved" ? late.value : late.state, ...look(s) };
  },
  async g8fetch() { return await bakeOf(await scene({ galaxy: "reject" })); },
  async g8decode() { return await bakeOf(await scene({ galaxy: "decode" })); },
  async g9() { return await bakeOf(await scene({ size: [100, 100] })); },
  async g10() { return await bakeOf(await scene({ maxTex: 2048 })); },
  async g10small() { return await bakeOf(await scene({ small: true, maxTex: 1024 })); },
  async g11() { return await bakeOf(await scene({ opts: { sky: 1024 } })); },
  g12paint: async () => await bakeOf(await scene({ flags: { sky: "paint" } })),
  g12late: async () => await bakeOf(await scene({ flags: { sky: "late" } })),
  g12stalls: async () => await bakeOf(await scene({ flags: { stalls: "1" } })),
  g12probe: async () => await bakeOf(await scene({ flags: { probe: "1" } })),
  /* the world could not be made (a program that will not link) while the context is alive: the picture still comes */
  async g6b() {
    const s = await scene({ linkFails: true });
    const r = await settled(s.world.bake(), s.b.clock, 60000);
    await s.b.clock.advance(5000);
    return { baked: r.state === "resolved" ? r.value : r.state, ...look(s) };
  },
  async g13() {
    const s = await scene({ galaxy: "hold" });
    const out = { state: "pending" };
    s.world.bake().then((v) => { out.state = "resolved"; out.value = v; });
    await s.b.clock.advance(300);
    const asked = s.R.galaxyFetches.length;
    s.b.page.loseContext();
    await s.b.clock.advance(300);
    s.R.release();
    await s.b.clock.advance(3000);
    return { asked, state: out.state, value: out.value, whileLost: s.b.page.glWhileLost };
  },
});

if (process.argv[2] === "--child") await childMain(CASES);

/* ----- the checks ----- */
const show = (x) => JSON.stringify(x);
const run = (n) => runCase(import.meta.url, n, 120000);
const painted = (r, KW) => [r.baked === true && r.skyCompiled >= 1 && r.scissors === 4 && r.galaxies === 1 && r.galaxyMipped, `baked ${show(r.baked)}, SKY compiled ${r.skyCompiled}, strips ${r.scissors}, ${r.galaxies} texture(s) ${KW} wide and ${KW / 2} high, mipmapped ${r.galaxyMipped}`];

{
  const r = run("g1");
  chk("G1 picturesOf(opts).GALAXY is the absolute url of img/install/galaxy.webp", r, (r) => [r.large === GALAXY, `got ${show(r.large)}; want ${GALAXY}`]);
  chk("G1 ... galaxy-2k.webp when small", r, (r) => [r.small === GALAXY_2K, `got ${show(r.small)}; want ${GALAXY_2K}`]);
  chk("G1 ... and opts.galaxy overrides", r, (r) => [r.over === r.overWant, `got ${show(r.over)}; want ${r.overWant}`]);
}
{
  const l = run("g2large"), s = run("g2small");
  chk("G2 hello carries world.galaxy, the absolute url of galaxy.webp (large screen)", l, (r) => [r.world && r.world.galaxy === GALAXY && r.world.small === false, `world ${show(r.world)}; want galaxy ${GALAXY}`]);
  chk("G2 ... galaxy-2k.webp when small", s, (r) => [r.world && r.world.galaxy === GALAXY_2K && r.world.small === true, `world ${show(r.world)}; want galaxy ${GALAXY_2K}`]);
}
{
  const g = run("g3given"), n = run("g3none");
  chk("G3 hello's world.galaxy is the picture the worker's world fetches (once, and no other galaxy)", g, (r) => [r.fetched.length === 1 && r.fetched[0] === r.given && r.baked.length === 1 && r.deads.length === 0, `fetched ${show(r.fetched)}; given ${r.given}; baked ${show(r.baked)}`]);
  chk("G3 ... with none given the default url is used (galaxy-2k.webp beside the map, small)", n, (r) => [r.fetched.length === 1 && r.fetched[0] === GALAXY_2K && r.deads.length === 0, `fetched ${show(r.fetched)}; want ${GALAXY_2K}`]);
  chk("G3 ... and the worker's world paints no galaxy (no SKY compiled)", g, (r) => [r.sky === 0, `SKY compiled ${r.sky} time(s)`]);
}
{
  const a = run("g4all"), s = run("g4sky"), x = run("g4refused");
  chk("G4 fetchWorld asks for the map, the rings, the moon and the galaxy, once each", a, (r) => [r.map === 1 && r.rings === 1 && r.moon === 1 && r.galaxy === 1 && r.total === 4, `map ${r.map}, rings ${r.rings}, moon ${r.moon}, galaxy ${r.galaxy}, ${r.total} fetch(es): ${show(r.fetched)}`]);
  chk("G4 ... with opts.sky set, three, and no galaxy", s, (r) => [r.map === 1 && r.rings === 1 && r.moon === 1 && r.anyGalaxy === 0 && r.total === 3, `map ${r.map}, rings ${r.rings}, moon ${r.moon}, galaxy ${r.anyGalaxy}, ${r.total} fetch(es)`]);
  chk("G4 ... with the gate refusing (gpu()), none of them", x, (r) => [r.total === 0, `${r.total} fetch(es): ${show(r.fetched)}`]);
}
{
  const r = run("g5");
  chk("G5 the galaxy url is fetched once (no opts.sky, the card's textures wide enough)", r, (r) => [r.galaxyFetches === 1 && /\/img\/install\/galaxy\.webp$/.test(r.galaxyUrls[0]), `fetched ${show(r.galaxyUrls)}`]);
  chk("G5 ... and no shader whose source holds SKY's marker (uSize with dirOf) is compiled", r, (r) => [r.skyCompiled === 0 && r.skyPrograms === 0, `${r.skyCompiled} such shader(s), ${r.skyPrograms} such program(s)`]);
  chk("G6 after bake() resolves true: one texture KW x KH (4096 x 2048), mipmapped, not deleted", r, (r) => [r.baked === true && r.galaxies === 1 && r.galaxyMipped && !r.galaxyDeleted, `baked ${show(r.baked)}, ${r.galaxies} such texture(s), mipmapped ${r.galaxyMipped}, deleted ${r.galaxyDeleted}; sizes ${show(r.sizes)}`]);
  chk("G6 ... SRGB8_ALPHA8 is the texture's format (the KW x KH texture above is found by it)", r, (r) => [r.galaxies === 1, `${r.galaxies} texture(s) KW x KH in SRGB8_ALPHA8`]);
  chk("G6 ... the picture's texture (KW x KW) was made, and is deleted", r, (r) => [r.pictures >= 1 && r.picturesDeleted === r.pictures, `${r.pictures} picture texture(s), ${r.picturesDeleted} deleted`]);
  chk("G6 ... the tiny program is deleted, and only the world's own two (render, post) are left", r, (r) => [r.deletedPrograms >= 1 && r.alive === 2, `${r.programs} program(s) made, ${r.deletedPrograms} deleted, ${r.alive} left`]);
  chk("G6 ... the mipmaps in a frame after the halves went in (a job each, a frame each)", r, (r) => [r.mipAfterDraw && r.draws >= 1, `mipmaps after the last draw: ${r.mipAfterDraw}, ${r.draws} draw(s)`]);
}
{
  const r = run("g6b");
  chk("G6b control: the world could not be made (a program will not link), the context alive: bake() gives false, nothing painted", r, (r) => [r.baked === false && r.skyCompiled === 0, `baked ${show(r.baked)}, SKY compiled ${r.skyCompiled}`]);
  chk("G6b ... every picture texture that was made is deleted (the 4096 x 4096 one is not kept)", r, (r) => [r.picturesDeleted === r.pictures, `${r.pictures} picture texture(s), ${r.picturesDeleted} deleted`]);
  chk("G6b ... the tiny program is deleted too (only the world's own two programs are left)", r, (r) => [r.deletedPrograms >= 1 && r.alive === 2, `${r.programs} program(s) made, ${r.deletedPrograms} deleted, ${r.alive} left`]);
}
{
  const r = run("g7");
  chk("G7 bake() does not resolve while the picture is pending (the fetch held)", r, (r) => [r.askedEarly === 1 && r.early === "pending", `the picture asked for ${r.askedEarly} time(s); after 5 s of a held fetch bake() was ${r.early}`]);
  chk("G7 ... and resolves true once it comes", r, (r) => [r.late === true, `after it came: ${show(r.late)}`]);
  chk("G7 ... with no painting pass (no SKY, no strip, no readPixels)", r, (r) => [r.skyCompiled === 0 && r.scissors === 0 && r.readPixels === 0 && r.draws < 4, `SKY ${r.skyCompiled}, strips ${r.scissors}, readPixels ${r.readPixels}, draws ${r.draws}`]);
}
for (const [how, what] of [["g8fetch", "the fetch rejects"], ["g8decode", "the decode rejects"]]) {
  const r = run(how);
  chk(`G8 ${what}: one warn, "${SAID}"`, r, (r) => [r.warns.length === 1 && r.warns[0].includes(SAID), `warns ${show(r.warns)}`]);
  chk(`G8 ... SKY is compiled, four strips and the mipmaps are made, bake() gives true`, r, (r) => painted(r, r.KW));
}
{
  const r = run("g9");
  chk("G9 a picture of the wrong size (100 x 100): one warn, \"" + SAID + "\"", r, (r) => [r.warns.length === 1 && r.warns[0].includes(SAID), `warns ${show(r.warns)}`]);
  chk("G9 ... the warning names both sizes (100 and 4096)", r, (r) => [r.warns.length === 1 && /\b100\b/.test(r.warns[0]) && /\b4096\b/.test(r.warns[0]), `warns ${show(r.warns)}`]);
  chk("G9 ... the bitmap is closed", r, (r) => [r.bitmaps.length === 1 && r.bitmaps[0] >= 1, `${r.bitmaps.length} galaxy bitmap(s), closes ${show(r.bitmaps)}`]);
  chk("G9 ... SKY is compiled, four strips and the mipmaps are made, bake() gives true", r, (r) => painted(r, r.KW));
}
{
  const r = run("g10");
  chk("G10 MAX_TEXTURE_SIZE below KW (2048 < 4096): no picture is asked for (the 2k one is not used on a 4096 world)", r, (r) => [r.galaxyFetches === 0, `galaxy fetches ${show(r.galaxyUrls)}`]);
  chk("G10 ... the galaxy is painted as on batch-a (SKY, four strips, mipmaps, true)", r, (r) => painted(r, r.KW));
  const s = run("g10small");
  chk("G10 ... and a small world's 2048 with textures of 1024: no picture, painted", s, (r) => [r.galaxyFetches === 0 && r.baked === true && r.skyCompiled >= 1 && r.scissors === 4, `fetches ${r.galaxyFetches}, baked ${show(r.baked)}, SKY ${r.skyCompiled}, strips ${r.scissors}`]);
}
{
  const r = run("g11");
  chk("G11 opts.sky = 1024: no picture is asked for", r, (r) => [r.galaxyFetches === 0, `galaxy fetches ${show(r.galaxyUrls)}`]);
  chk("G11 ... KW is 1024: the galaxy is painted, 1024 x 512, as before", r, (r) => painted(r, 1024));
}
for (const [how, flags] of [["g12paint", "sky=paint"], ["g12late", "sky=late"], ["g12stalls", "stalls"], ["g12probe", "probe"]]) {
  const r = run(how);
  chk(`G12 the flag ${flags} changes nothing: still a picture (fetched once, baked, no SKY)`, r, (r) => [r.baked === true && r.galaxyFetches === 1 && r.skyCompiled === 0 && r.galaxies === 1, `baked ${show(r.baked)}, galaxy fetches ${r.galaxyFetches}, SKY ${r.skyCompiled}, galaxy textures ${r.galaxies}`]);
  chk(`G12 ... with ${flags}: no readPixels, no galaxy note lines`, r, (r) => [r.readPixels === 0 && r.galaxyLines.length === 0, `readPixels ${r.readPixels}, lines ${show(r.galaxyLines)}`]);
}
{
  const r = run("g13");
  chk("G13 control: the picture was asked for and still held when the context was lost", r, (r) => [r.asked === 1, `asked ${r.asked} time(s)`]);
  chk("G13 the context lost while the picture is pending: bake() resolves false", r, (r) => [r.state === "resolved" && r.value === false, `bake() ${r.state}${r.state === "resolved" ? " with " + show(r.value) : ""}`]);
  chk("G13 ... and no GL call is made after the loss (the picture arriving later too)", r, (r) => [r.whileLost === 0, `${r.whileLost} GL call(s) while lost`]);
}
{
  const r = run("g14");
  chk("G14 decode \"page\": the galaxy is asked for by a `decode` message, as the map is", r, (r) => [r.galaxyAsks === 1 && r.urls.length >= 2 && r.baked.length === 1 && r.baked[0] === true && r.deads.length === 0, `decode asks ${show(r.urls)}, baked ${show(r.baked)}, dead ${show(r.deads)}`]);
  /* (what the galaxy adds, not what the worker posts: the same worker with a painted galaxy, opts.sky 1024, posts every
     type that other changes give it, so a message another lane adds is in both) */
  const c = run("g14control");
  chk("G14 ... no message type of its own: the types posted are those a worker with a painted galaxy posts", r, (r) => [!c.error && !c.none && r.types.every((t) => c.types.includes(t)) && r.cloneErrors.length === 0, `types ${show(r.types)}, with a painted galaxy ${show(c.types)}${c.error ? "; " + c.error : ""}, clone errors ${show(r.cloneErrors)}`]);
  chk("G14 ... and the worker paints no galaxy (no SKY)", r, (r) => [r.sky === 0, `SKY compiled ${r.sky} time(s)`]);
}

/* ---------- G15-G17: the files ---------- */
const read = (p) => (existsSync(ROOT + p) ? readFileSync(ROOT + p) : null);
/* a WebP's size from its header: lossy (VP8 ), extended (VP8X) or lossless (VP8L) */
function webp(buf) {
  if (!buf || buf.length < 30 || buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WEBP") return null;
  const kind = buf.toString("latin1", 12, 16);
  if (kind === "VP8 ") return buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a ? { kind, w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff } : null;
  if (kind === "VP8X") return { kind, w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
  if (kind === "VP8L" && buf[20] === 0x2f) { const v = buf.readUInt32LE(21); return { kind, w: 1 + (v & 0x3fff), h: 1 + ((v >> 14) & 0x3fff) }; }
  return null;
}
for (const [file, side, max] of [["assets/img/install/galaxy.webp", 4096, 500], ["assets/img/install/galaxy-2k.webp", 2048, 200]]) {
  const buf = read(file), head = webp(buf);
  const r = { exists: !!buf, bytes: buf ? statSync(ROOT + file).size : 0, head };
  chk(`G15 ${file} exists`, r, (r) => [r.exists, "no such file"]);
  chk(`G15 ... is a WebP (RIFF/WEBP, VP8) of ${side} x ${side}`, r, (r) => [!!r.head && r.head.w === side && r.head.h === side, `header ${show(r.head)}`]);
  chk(`G15 ... and is under ${max} KB`, r, (r) => [r.bytes > 0 && r.bytes < max * 1000, `${r.bytes} bytes`]);
}
{
  const readme = read("README.md")?.toString() ?? "";
  const r = { tool: existsSync(ROOT + "tools/galaxy-bake.cjs"), readme };
  chk("G16 tools/galaxy-bake.cjs exists", r, (r) => [r.tool, "no such file"]);
  chk("G16 the README names tools/galaxy-bake.cjs", r, (r) => [/tools\/galaxy-bake\.cjs/.test(r.readme), "not named"]);
  chk("G16 ... and both images (galaxy.webp and galaxy-2k.webp, or galaxy*.webp)", r, (r) => [/galaxy\*\.webp/.test(r.readme) || (/galaxy\.webp/.test(r.readme) && /galaxy-2k\.webp/.test(r.readme)), "the images are not named"]);
  const credit = /\bGaia\b|CC[ -]BY-NC|NASA\/ESA/i;
  const files = ["README.md", "LICENSE", "index.html", "de/index.html", "install.html", "404.html", "assets/i18n/en.json", "assets/i18n/en.js", "assets/i18n/de.json", "assets/i18n/fr.json", "assets/i18n/es.json", "assets/i18n/pt.json", "assets/i18n/id.json", "assets/i18n/ja.json", "assets/i18n/zh-Hans.json", "assets/i18n/ar.json"];
  const hits = files.filter((f) => credit.test(read(f)?.toString() ?? ""));
  chk("G16 no Gaia, NASA/ESA or CC BY-NC credit returns to the README, LICENSE or the footers (pages and their texts)", { hits }, (r) => [r.hits.length === 0, `found in ${show(r.hits)}`]);
}
{
  /* ADR-0001's copy must not know the galaxy change: nothing in assets/door/ names a galaxy picture or the bake tool, or
     imports the world's modules (a diff against batch-a is not a statement that stays true as other changes touch the door) */
  const { readdirSync } = await import("node:fs");
  const walk = (d) => readdirSync(ROOT + d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  const text = /\.(?:js|mjs|cjs|css|html|json|md|svg)$/;
  const named = /galaxy[^\s"'`)]*\.webp|galaxy-bake|(?:world|remote-world|world-worker)\.js/;
  const hits = walk("assets/door").filter((f) => text.test(f) && named.test(readFileSync(ROOT + f, "utf8")));
  chk("G17 nothing under assets/door/ names a galaxy picture, the bake tool or the world's modules (ADR-0001's copy)", { hits }, (r) => [r.hits.length === 0, `named in ${show(r.hits)}`]);
}
finish();
