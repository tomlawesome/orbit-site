/*
 * Tests for #148 (the flight's maps in ready-made sizes, the smallest first), written from the specification alone
 * (spec-map-sizes.md, P1-P12) before the code exists. No browser, no new dependency; the stub page and virtual clock of
 * door-stub.mjs, each case in a fresh Node process (this file again, as `--child`), behaviour and order, never timings.
 *
 *   node tools/ci/map-sizes-test.mjs
 *
 * What the code is expected to be called (the spec's names): voyage.js exports SIZED_PATHS (every ready-made size's path,
 * `flight/earth-lights-2048.webp`: a list, or anything holding the paths) and FULL (each map's full size); upload.js exports
 * easeLevels(gl) (run before each frame: eases a texture's TEXTURE_MIN_LOD down; the tests call it every 16 ms of virtual
 * time, as a frame would). A map's full size is the file the host's image() places; a host whose image() leaves the sized
 * paths as they were while placing the full one (P7) is a host that does not carry the sizes.
 *
 * Where the sizes are: 15 files `<map>-<width>.webp` beside the full maps, each half the last, floor(w / 2^i) by
 * floor(h / 2^i), down to the last still 512 wide or more (map-sizes-lib.mjs works them out from the full maps' headers).
 * The largest size fetched is the smallest at least 2 x W x min(dpr, 2) wide, else the full size. A map's texture has storage
 * for that largest size (a full level chain); the sizes sit at the levels below it (the largest is level 0, the smallest the
 * highest level, L); the smallest goes in whole and is mipped alone (BASE_LEVEL = L while generateMipmap runs, then 0);
 * the map is drawable from it, held to level L by TEXTURE_MIN_LOD; each larger size goes in at its own level (in bands where
 * the crop is honoured) after the one below is whole, and MIN_LOD is eased down to it, ending at -1000 at the top.
 *
 *   P1  Seam A (files)    the 15 sized files exist with exact sizes; SIZED_PATHS lists exactly them; FULL matches the headers
 *   P2  gate              at "flight: ready" every map's smallest is on the GPU and nothing larger or full was asked for; those
 *                         are asked for only after the "flight world:" line
 *   P3  one mipmap        one generateMipmap per map, BASE_LEVEL L during it and 0 after; none once a larger size is in
 *   P4  what a screen asks  390 x 844 at dpr 3: no earth-lights.webp, 2048 the top; 1920 x 1080 at dpr 1: the full 4096; dpr over 2 counts as 2
 *   P5  levels            storage for the largest size fetched; drawable from the smallest, held by MIN_LOD; eased, not set at once; -1000 at the end
 *   P6  order             larger sizes land smallest to largest, each only after the one below is whole
 *   P7  host without sizes  image() leaves the sized paths alone: whole maps, no sized request, no mipmap off level 0, no fault
 *   P8  one size fails    the map stays at the last good size, one warning more than without it, the other maps carry on
 *   P9  stopped           destroyed after the gate, or retired unfit: no larger size fetched or uploaded, no bind of a released texture, bitmaps closed
 *   P10 live door         fetches the smallest URLs the flight does, the full file only where its top is the full size
 *   P11 worker            hello `images` has every SIZED_PATHS entry as an absolute address
 *   P12 chores            "sharp" chores run after docs/flight/info and before the untagged, and are never hurried; a map that failed
 *                         in the first pass and is retried loads its smallest, then its larger sizes
 *   #164 coverage:
 *   P6  whole sizes       under ?holdreveal the larger sizes go in whole, each in one call at its own level (no bands), every size lands, every bitmap is closed
 *   P7  whole map refused a map with no sizes (the host places the full maps only) whose download is refused is forgotten, asked for again by the next warm, and lands
 *   review findings (added after the build was read):
 *   P2  retry             a map refused in the first pass and retried (by the warm itself, or by a second warm before any verdict)
 *                         asks for no larger size until a fit verdict; none after an unfit one
 *   P2  rich from first   with ?door3d&level=2&rich the clouds fields are made once the smallest sizes are in, before the verdict
 *   P5  draws ease        the flight's own draw loop (flown, not driven by the test) eases MIN_LOD; the live door's draw is a source check
 *
 * Browser-only (not tested here): that a real GPU samples only from level L under MIN_LOD and so never shows an empty larger
 * level; that WebGL2's generateMipmap from BASE_LEVEL = L fills only the levels below L in a real driver; that the 1 s
 * ease looks smooth; the crop-not-honoured path (Firefox) where larger sizes go in whole; the real sizes on a real phone.
 * (sw.js MEDIA is checked by lint.sh, run last.)
 */
import { readFileSync } from "node:fs";
import {
  INDEX, installPage, installClock, mountLive, bootWorkerPage, hostImage, absImage, childMain, runCase, chk, finish,
} from "./door-stub.mjs";
import {
  IMG, MAPS, DOOR_KEYS, installBitmaps, FULL_DIMS, webpHeader, sizesOf, sizedPathsExpected, expectFor, dimsOfPath, keyOfPath, unplace, blobOf, stemOf,
} from "./map-sizes-lib.mjs";

const KEYS = Object.keys(MAPS);
const BASE = 0x813c, LOD = 0x813a;
const SIZED = new Set(sizedPathsExpected());
const PHONE = { W: 390, H: 844, dpr: 3 };
const dimsH = (path) => (dimsOfPath(path) || [0, 0])[1];
const chainOf = (key, W, dpr) => expectFor(key, W, dpr);
const level = (e, path) => e.chain.length - 1 - e.chain.findIndex((c) => c.path === path);   /* the level a size sits at in a texture */
const fullChain = (w, h) => Math.floor(Math.log2(Math.max(w, h))) + 1;
const paths = (x, out = []) => {                               /* every string in anything holding SIZED_PATHS' paths */
  if (typeof x === "string") out.push(x);
  else if (x instanceof Map) for (const v of x.values()) paths(v, out);
  else if (x && typeof x === "object") for (const v of (x instanceof Set || Array.isArray(x) ? x : Object.values(x))) paths(v, out);
  return out;
};

/* ---------------------------------------------------------------------------------------------------------------
   the bed: a page that answers each picture with a blob of its real size, logs every fetch (with how many console lines
   there were), records what the context was asked (page.gpu) and what the page said and warned
   --------------------------------------------------------------------------------------------------------------- */
async function bed(o = {}) {
  const { W = 1280, H = 800, dpr = 1 } = o;
  const asked = [], warns = [], errors = [], faults = [], hooks = [], deleted = new Set();
  let page, clock;
  page = installPage({
    fetch: (url) => {
      const raw = String(url), path = unplace(raw), count = asked.filter((a) => a.path === path).length + 1;
      asked.push({ path, raw, n: asked.length, lines: page.lines.length, at: clock.now() });
      if (o.refuse?.(path, count, raw)) return Promise.reject(new Error("the network dropped"));
      return Promise.resolve({ ok: true, status: 200, blob: async () => blobOf(path) });
    },
  });
  clock = installClock();
  globalThis.innerWidth = W; globalThis.innerHeight = H; globalThis.devicePixelRatio = dpr; globalThis.screen = { width: W, height: H };
  const bitmaps = installBitmaps();
  console.warn = (...a) => { warns.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(" ").slice(0, 160)); };
  for (const k of ["info", "log"]) {
    const say = console[k];
    console[k] = (...a) => { say(...a); const s = a.join(" "); for (const h of hooks) if (!h.done && h.re.test(s)) { h.done = true; h.fn(s); } };
  }
  /* a bind of a released texture is a fault (released-world's rule) */
  const g = page.glBase, del = g.deleteTexture, bind = g.bindTexture;
  g.deleteTexture = (t) => { if (t) deleted.add(t); del(t); };
  g.bindTexture = (target, t) => { if (t && deleted.has(t)) faults.push(`bindTexture of released texture #${t.id}`); bind(target, t); };
  g.NO_ERROR = 0;   /* (the stub answers 1 to a constant it does not know, which makes the capability probe fail) */
  process.on("uncaughtException", (e) => errors.push("uncaught: " + (e && e.message)));
  process.on("unhandledRejection", (e) => errors.push("unhandled rejection: " + (e && e.message)));
  const door = await import(INDEX);
  if (o.gpu) door.gpu();                                   /* the capability probe, as the live door's mount does */
  const d = door.createDoor({ typingWait: 0, image: o.image ?? hostImage, flags: { decode: "blob", ...(o.flags || {}) } });
  door.openChores();
  const journey = d.journey(page.journeyOptions());
  const b = { page, clock, door, d, journey, asked, warns, errors, faults, bitmaps, W, H, dpr, deleted, on: (re, fn) => { hooks.push({ re, fn, done: false }); } };
  b.exp = Object.fromEntries(KEYS.map((k) => [k, chainOf(k, W, dpr)]));
  return b;
}

/* what the context was asked, per map: the first texture a picture of that map was put on */
function summarise(page, exp) {
  const gpu = page.gpu, texOf = new Map(), out = {};
  for (const e of gpu) if ((e.k === "img" || e.k === "sub") && e.map && !e.probe) { const key = keyOfPath(e.path); if (key && !texOf.has(e.texture)) texOf.set(e.texture, key); }
  for (const [tex, key] of texOf) {
    const r = (out[key] ||= { key, textures: 0, store: null, order: [], completed: [], completedAt: {}, rows: {}, mips: [], base: [], lod: [], levelSeq: [], uploads: 0 });
    if (++r.textures > 1) continue;
    const lv = {};                                             /* path -> the level it went in at, once whole */
    gpu.forEach((e, i) => {
      if (e.texture !== tex) return;
      if (e.k === "store") r.store = { w: e.w, h: e.h, levels: e.levels, i };
      else if (e.k === "img" || e.k === "sub") {
        if (e.probe || !e.map) return;
        r.uploads++;
        if (!r.order.some((o) => o.path === e.path)) r.order.push({ level: e.level, path: e.path, i });
        if (r.levelSeq[r.levelSeq.length - 1] !== e.level) r.levelSeq.push(e.level);
        const rows = (r.rows[e.path] || 0) + (e.k === "sub" ? e.h : dimsH(e.path));
        r.rows[e.path] = rows;
        if (rows >= dimsH(e.path) && !r.completed.includes(e.path)) { r.completed.push(e.path); r.completedAt[e.path] = i; lv[e.path] = e.level; }
      } else if (e.k === "mip") r.mips.push({ i, base: e.base });
      else if (e.k === "param") {
        const lowest = Math.min(Infinity, ...Object.values(lv));
        if (e.pname === BASE) r.base.push({ i, v: e.value });
        if (e.pname === LOD) r.lod.push({ i, v: e.value, lowest: Number.isFinite(lowest) ? lowest : null });
      }
    });
  }
  return out;
}
const allLanded = (b) => {
  if (b.__n === b.page.gpu.length) return b.__all;
  b.__n = b.page.gpu.length;
  const s = summarise(b.page), keys = Object.keys(b.exp);
  return (b.__all = keys.every((k) => s[k] && b.exp[k].chain.every((c) => s[k].completed.includes(c.path))));
};
const isMapPath = (p) => keyOfPath(p) !== null;
const firstPaths = (b) => new Set(Object.values(b.exp).map((e) => e.first));

/* the eased levels: a frame's work, called every 16 ms of virtual time (upload.js: easeLevels(gl), the spec's name) */
async function startEase(b) {
  try {
    const up = await import("../../assets/door/upload.js");
    if (typeof up.easeLevels !== "function") return false;
    setInterval(() => { try { up.easeLevels(b.page.gl); } catch { /* the page's own */ } }, 16);
    return true;
  } catch { return false; }
}

const compact = (b) => b.asked.map((a) => ({ path: a.path, raw: a.raw, lines: a.lines }));
const common = (b) => ({ warns: b.warns.length, errors: [...new Set(b.errors)].slice(0, 3), faults: b.faults.slice(0, 3), unclosed: b.bitmaps.filter((x) => !x.closed).length, bitmaps: b.bitmaps.length });
const verdictAt = (b) => b.page.lines.findIndex((l) => /flight world: /.test(l));
async function settle(b, cap = 150000) { await b.clock.advance(cap, () => allLanded(b)); await b.clock.advance(2000); }

/* ---------------------------------------------------------------------------------------------------------------
   the cases
   --------------------------------------------------------------------------------------------------------------- */
const CASES = {
  /* P1: Seam A and the exports */
  async p1() {
    installPage();
    const out = { files: {}, listed: null, full: null, disk: null, noExport: null };
    const v = await import("../../assets/door/voyage.js");
    for (const p of sizedPathsExpected()) { const h = webpHeader(IMG + p); out.files[p] = h ? [h.type, h.w, h.h] : null; }
    if (v.SIZED_PATHS === undefined) out.noExport = "voyage.js does not export SIZED_PATHS";
    else out.listed = paths(v.SIZED_PATHS);
    if (v.FULL === undefined) out.noExport = (out.noExport ? out.noExport + "; " : "") + "voyage.js does not export FULL";
    else out.full = v.FULL instanceof Map ? Object.fromEntries(v.FULL) : JSON.parse(JSON.stringify(v.FULL));
    /* the sized files that are on disk for the flight's maps, found by their map's name (not a glob: lights-strip-120 is not a size) */
    const { readdirSync } = await import("node:fs");
    out.disk = KEYS.flatMap((k) => {
      const dir = MAPS[k].replace(/[^/]+$/, ""), stem = stemOf(MAPS[k]).slice(dir.length);
      return readdirSync(IMG + dir).filter((f) => new RegExp(`^${stem}-\\d+\\.webp$`).test(f)).map((f) => dir + f);
    });
    return out;
  },

  /* P2, P3, P4 (phone), P5, P6: a phone, the world proved, every size let land, the frames' easing driven */
  async flow() {
    const b = await bed(PHONE);
    const snaps = {};
    b.on(/flight: ready/, () => { snaps.ready = { sum: summarise(b.page), asked: compact(b), lines: b.page.lines.length }; });
    const easing = await startEase(b);
    b.journey.warm().catch(() => {});
    await settle(b);
    return { snaps, easing, asked: compact(b), verdictAt: verdictAt(b), sum: summarise(b.page), landed: allLanded(b), ...common(b) };
  },
  /* P4: a big screen at dpr 1, and the pixel ratio's cap (500 css px: dpr 3 asks for what dpr 2 would) */
  async big() { return fetchedTops({ W: 1920, H: 1080, dpr: 1 }); },
  async cap() { return fetchedTops({ W: 500, H: 800, dpr: 3 }); },

  /* P7: the host's image() places the full maps and leaves the sized paths as they were */
  async hostless() {
    const b = await bed({ image: (p) => (SIZED.has(p) ? p : hostImage(p)) });
    b.journey.warm().catch(() => {});
    await b.clock.advance(60000, () => KEYS.every((k) => summarise(b.page)[k]?.completed.includes(MAPS[k])));
    await b.clock.advance(3000);
    const s = summarise(b.page);
    return { asked: compact(b), sum: s, baseSet: b.page.gpu.filter((e) => e.k === "param" && e.pname === BASE && e.value !== 0).length, ...common(b) };
  },

  /* P8: one middle size is refused every time it is asked for (or, in the control, none) */
  async refused() { return failing("flight/earth-lights-1024.webp"); },
  async control8() { return failing(null); },

  /* P9: destroyed at the gate, or judged too slow */
  async stopped() {
    const b = await bed(PHONE);
    let destroyedAt = null;
    b.on(/flight: ready/, () => { Promise.resolve().then(() => { destroyedAt = { asked: b.asked.length, sum: summarise(b.page) }; b.journey.destroy(); }); });
    b.journey.warm().catch(() => {});
    await b.clock.advance(90000);
    return after(b, destroyedAt);
  },
  async retired() {
    const b = await bed(PHONE);
    b.page.glBase.readPixels = () => { b.page.readPixels++; b.clock.jump(40); };   /* every timed frame is long: the world is judged too slow */
    let mark = null;
    b.on(/flight world: off/, () => { mark = { asked: b.asked.length, sum: summarise(b.page) }; });
    b.journey.warm().catch(() => {});
    await b.clock.advance(90000);
    return { off: !!mark, ...after(b, mark) };
  },

  /* P10: the live door alone, on a phone */
  async door() {
    const asked = [];
    const page = installPage({ fetch: (u) => { asked.push(unplace(u)); return Promise.resolve({ ok: true, status: 200, blob: async () => blobOf(unplace(u)) }); } });
    const clock = installClock();
    globalThis.innerWidth = PHONE.W; globalThis.innerHeight = PHONE.H; globalThis.devicePixelRatio = PHONE.dpr;
    installBitmaps();
    const m = await mountLive(page, { decode: "blob" });
    m.dawn.start();
    m.dawn.light({ firstVisit: false, aside: true, onLit() {}, onOpen() {}, after() {} });
    m.dawn.live.compile();
    await clock.advance(3000);
    m.dawn.live.start();
    await clock.advance(60000);
    return { asked };
  },

  /* P11: the worker's hello */
  async hello() {
    const b = await bootWorkerPage({ draw: "worker", flags: { door3d: "1", rich: "1" }, settle: 700 });
    const v = await import("../../assets/door/voyage.js");
    b.journey.warm({ prove: false }).catch(() => {});
    await b.clock.advance(50);
    const w = b.host.first();
    if (!w) return { none: "no worker was made (drawWorker never called)" };
    return { images: JSON.parse(JSON.stringify(w.of("hello")[0]?.images ?? null)), listed: v.SIZED_PATHS === undefined ? null : paths(v.SIZED_PATHS) };
  },

    /* review: the rich Earth from the first: its cloud fields are made once the smallest sizes are in, before the verdict and before any larger size */
  async richGate() {
    const b = await bed({ ...PHONE, gpu: true, flags: { door3d: "1", level: "2", rich: "1" } });
    await Promise.race([b.journey.warm({ prove: false }).catch(() => {}), b.clock.advance(60000).then(() => {})]);
    await b.clock.advance(8000);
    const first = firstPaths(b);
    return { fields: fieldMips(b.page), rich: b.page.lines.some((l) => /door: weight rich/.test(l)), smallest: KEYS.filter((k) => summarise(b.page, b.exp)[k]?.completed.includes(b.exp[k].first)).length,
      larger: b.asked.filter((a) => isMapPath(a.path) && !first.has(a.path)).map((a) => a.path), verdict: verdictAt(b), ...common(b) };
  },
  /* the same, every size let land (the fields are there at the end, wherever they were made: a control for the reading of them) */
  async richEnd() {
    const b = await bed({ ...PHONE, gpu: true, flags: { door3d: "1", level: "2", rich: "1" } });
    await startEase(b);
    b.journey.warm().catch(() => {});
    await settle(b);
    return { fields: fieldMips(b.page), landed: allLanded(b), ...common(b) };
  },
  /* review: a map that failed in the first pass and is retried by a second warm: its larger sizes wait for a fit verdict */
  async retryEarly() {
    const first = expectFor("day", PHONE.W, PHONE.dpr).first;
    let refusing = true;
    const b = await bed({ ...PHONE, refuse: (p) => refusing && p === first });
    await Promise.race([b.journey.warm({ prove: false }).catch(() => {}), b.clock.advance(20000).then(() => {})]);
    await b.clock.advance(3000);
    const before = b.asked.filter((a) => a.path === first).length;
    refusing = false;
    b.journey.warm({ prove: false }).catch(() => {});                   /* no proof is asked for: there is no verdict to wait for */
    await b.clock.advance(60000);
    const f = new Set(firstPaths(b));
    return { first, askedBefore: before, askedAll: b.asked.filter((a) => a.path === first).length, dayIn: !!summarise(b.page, b.exp).day?.completed.includes(first), verdict: verdictAt(b),
      larger: b.asked.filter((a) => isMapPath(a.path) && !f.has(a.path)).map((a) => a.path), ...common(b) };
  },
  async retryUnfit() {
    const first = expectFor("day", PHONE.W, PHONE.dpr).first;
    let refusing = true;
    const b = await bed({ ...PHONE, refuse: (p) => refusing && p === first });
    b.page.glBase.readPixels = () => { b.page.readPixels++; b.clock.jump(40); };
    b.journey.warm().catch(() => {});
    await b.clock.advance(90000, () => b.page.lines.some((l) => /flight world: off/.test(l)));
    await b.clock.advance(3000);
    refusing = false;
    b.journey.warm().catch(() => {});
    await b.clock.advance(60000);
    const f = new Set(firstPaths(b));
    return { off: b.page.lines.some((l) => /flight world: off/.test(l)), larger: b.asked.filter((a) => isMapPath(a.path) && !f.has(a.path)).map((a) => a.path), ...common(b) };
  },
  async retryFit() {
    const e = expectFor("day", PHONE.W, PHONE.dpr);
    const b = await bed({ ...PHONE, refuse: (p, n) => p === e.first && n === 1 });   /* refused once, in the first pass */
    await startEase(b);
    b.journey.warm().catch(() => {});
    await b.clock.advance(90000, () => verdictAt(b) >= 0);
    await b.clock.advance(3000);
    const v = verdictAt(b);
    b.journey.warm().catch(() => {});                                   /* (the retry is the first warm's own, or this one) */
    await b.clock.advance(150000, () => summarise(b.page, b.exp).day?.completed.includes(e.top));
    await b.clock.advance(2000);
    return { verdict: v, fit: b.page.lines.some((l) => /flight world: on/.test(l)), done: summarise(b.page, b.exp).day?.completed ?? [], chain: e.chain.map((c) => c.path),
      early: b.asked.filter((a) => keyOfPath(a.path) === "day" && a.path !== e.first && a.lines <= v).map((a) => a.path), ...common(b) };
  },
  /* review: the ease is run by the frames' own draw (voyage.js draw, door3d.js draw), not by the test: nothing here calls easeLevels */
  async flightFrames() {
    const b = await bed(PHONE);
    b.journey.warm().catch(() => {});
    await b.clock.advance(90000, () => verdictAt(b) >= 0);
    b.journey.fly(b.door.UP, { title: "Orbit", subtitle: "to somewhere" });
    const d0 = b.page.draws;
    await b.clock.advance(150000, () => allLanded(b) && b.page.draws > d0);
    await b.clock.advance(3000);
    return { draws: b.page.draws - d0, sum: summarise(b.page, b.exp), landed: allLanded(b), ...common(b) };
  },
  /* P6: ?holdreveal, the phone's flow: every larger size is put in whole, not in bands */
  async hold() {
    const b = await bed({ ...PHONE, flags: { holdreveal: "1" } });
    await startEase(b);
    b.journey.warm().catch(() => {});
    await settle(b);
    const calls = {};
    for (const e of b.page.gpu) if ((e.k === "img" || e.k === "sub") && e.map && !e.probe) (calls[e.path] ||= []).push({ k: e.k, level: e.level, h: e.h, x: e.x ?? 0, y: e.y ?? 0 });
    return { calls, sum: summarise(b.page, b.exp), landed: allLanded(b), ...common(b) };
  },
  /* P7: no sized paths, the day map's full file refused in the first pass, then the next warm */
  async wholeRefused() {
    let refusing = true;
    const b = await bed({ image: (p) => (SIZED.has(p) ? p : hostImage(p)), refuse: (p) => refusing && p === MAPS.day });
    await Promise.race([b.journey.warm({ prove: false }).catch(() => {}), b.clock.advance(20000).then(() => {})]);
    await b.clock.advance(3000);
    const before = b.asked.filter((a) => a.path === MAPS.day).length, textures = new Set(b.page.gpu.filter((e) => e.map && e.path === MAPS.day).map((e) => e.texture)).size;
    refusing = false;
    b.journey.warm({ prove: false }).catch(() => {});
    await b.clock.advance(60000, () => summarise(b.page, b.exp).day?.completed.includes(MAPS.day));
    await b.clock.advance(3000);
    return { askedBefore: before, texturesBefore: textures, askedAll: b.asked.filter((a) => a.path === MAPS.day).length, sum: summarise(b.page, b.exp), ...common(b) };
  },
  /* P12: the queue's order, with the queue held until all are in it */
  async order() {
    installPage();
    const clock = installClock();
    const chores = await import("../../assets/door/chores.js");
    chores.openChores();
    const order = [];
    let release; const hold = new Promise((r) => { release = r; });
    chores.chore(() => hold, 0, "");
    for (const tag of ["", "sharp", "info", "flight", "docs"]) chores.chore(() => { order.push(tag || "-"); }, 0, tag);
    release();
    await clock.advance(5000);
    return { order };
  },
  /* P12: a journey hurries what it needs; "sharp" is not among it, and waits as an untagged one does, but goes before it */
  async hurried() {
    installPage();
    const clock = installClock();
    const chores = await import("../../assets/door/chores.js");
    const ran = [];
    for (const tag of ["", "sharp", "flight"]) chores.chore(() => { ran.push({ tag: tag || "-", at: clock.now() }); }, 0, tag);
    chores.hurryChores(["flight", "docs", "info", "install"]);
    await clock.advance(20000);
    return { ran };
  },
  /* P12: a map that failed in the first pass, retried by the next warm */
  async retry() {
    const failKey = "day", first = expectFor(failKey, PHONE.W, PHONE.dpr).first;
    let refusing = true;
    const b = await bed({ ...PHONE, refuse: (p) => refusing && p === first });
    await startEase(b);
    await Promise.race([b.journey.warm({ prove: false }).catch(() => {}), b.clock.advance(20000).then(() => {})]);
    await b.clock.advance(3000);
    const before = b.asked.filter((a) => a.path === first).length;
    refusing = false;
    b.journey.warm().catch(() => {});
    await settle(b);
    return { first, askedBefore: before, askedAll: b.asked.filter((a) => a.path === first).length, sum: summarise(b.page), landed: allLanded(b), ...common(b) };
  },
};

/* P4: the tops asked for, on a screen */
async function fetchedTops(screen) {
  const b = await bed(screen);
  b.journey.warm().catch(() => {});
  await b.clock.advance(150000, () => KEYS.every((k) => b.asked.some((a) => a.path === b.exp[k].top)));
  await b.clock.advance(2000);
  return { asked: compact(b) };
}
/* P8 */
async function failing(refused) {
  const b = await bed({ ...PHONE, refuse: (p) => p === refused });
  b.journey.warm().catch(() => {});
  const others = (k) => b.exp[k].chain.map((c) => c.path).filter((p) => p !== refused);
  await b.clock.advance(150000, () => { const s = summarise(b.page); return KEYS.every((k) => s[k] && (k === "lights" && refused ? s[k].completed.includes(b.exp[k].first) : others(k).every((p) => s[k].completed.includes(p)))); });
  await b.clock.advance(30000);
  return { refused, asked: compact(b), sum: summarise(b.page), ...common(b) };
}
/* P9: what was asked and put on the GPU after the moment (the gate's, or the verdict's) */
function after(b, mark) {
  const first = firstPaths(b), sum = summarise(b.page), big = b.asked.filter((a) => isMapPath(a.path) && !first.has(a.path)).map((a) => a.path);
  const uploaded = [...new Set(b.page.gpu.filter((e) => (e.k === "img" || e.k === "sub") && e.map && !e.probe && !first.has(e.path)).map((e) => e.path))];
  const smallest = KEYS.filter((k) => sum[k]?.completed.includes(b.exp[k].first)).length;
  return { mark: !!mark, atMark: mark ? KEYS.filter((k) => mark.sum[k]?.completed.includes(b.exp[k].first)).length : null, smallest, big, uploaded, ...common(b) };
}

/* the cloud fields: textures that are not maps (no storage of their own) and were mipped (passInto, levels: true): [w, h] of each */
const fieldMips = (page) => {
  const stored = new Set(page.gpu.filter((e) => e.k === "store").map((e) => e.texture));
  return page.gpu.filter((e) => e.k === "mip" && !stored.has(e.texture)).map((e) => { const im = page.gpu.find((x) => x.texture === e.texture && x.k === "img" && x.level === 0); return [im?.w, im?.h]; });
};

if (process.argv[2] === "--child") await childMain(CASES);

/* ---------------------------------------------------------------------------------------------------------------
   the checks
   --------------------------------------------------------------------------------------------------------------- */
const T = 150000;
const listOf = (a) => (a.length ? a.slice(0, 6).join(", ") + (a.length > 6 ? ` (+${a.length - 6})` : "") : "none");
const mapAsks = (r) => (r.asked || []).filter((a) => isMapPath(a.path));

/* P1 */
{
  const r = runCase(import.meta.url, "p1", T);
  const want = sizedPathsExpected();
  chk("P1 each of the 15 ready-made sizes exists as a webp (RIFF; VP8, VP8L or VP8X) of exactly floor(w / 2^i) by floor(h / 2^i) of its full map", r, (r) => {
    const bad = want.filter((p) => { const f = r.files[p], d = dimsOfPath(p); return !f || !["VP8 ", "VP8L", "VP8X"].includes(f[0]) || f[1] !== d[0] || f[2] !== d[1]; });
    return [want.length === 15 && bad.length === 0, `${want.length - bad.length} of ${want.length} right; wrong or missing: ${listOf(bad)}`];
  });
  chk("P1 SIZED_PATHS lists exactly those 15 paths", r, (r) => {
    if (r.listed === null) return [false, r.noExport];
    const got = new Set(r.listed), miss = want.filter((p) => !got.has(p)), extra = r.listed.filter((p) => !want.includes(p));
    return [miss.length === 0 && extra.length === 0 && got.size === 15, `missing ${listOf(miss)}; extra ${listOf(extra)}; ${got.size} listed`];
  });
  chk("P1 no sized file on disk lacks an entry in SIZED_PATHS (found by each map's name: lights-strip-120.webp is not a size)", r, (r) => {
    if (r.listed === null) return [false, r.noExport];
    const lacks = r.disk.filter((p) => !r.listed.includes(p));
    return [r.disk.length === 15 && lacks.length === 0, `${r.disk.length} on disk; without an entry: ${listOf(lacks)}`];
  });
  chk("P1 FULL has each full map's size as its header says", r, (r) => {
    if (r.full === null) return [false, r.noExport];
    const dims = (v) => (Array.isArray(v) ? v.slice(0, 2) : v && typeof v === "object" ? [v.w ?? v.width, v.h ?? v.height] : null);
    const entries = Object.entries(r.full);
    const bad = KEYS.filter((k) => {
      const names = [k, MAPS[k], stemOf(MAPS[k]), MAPS[k].replace(/^.*\//, ""), stemOf(MAPS[k]).replace(/^.*\//, "")];
      const hit = entries.find(([n]) => names.includes(n));
      const d = hit && dims(hit[1]);
      return !d || d[0] !== FULL_DIMS[k][0] || d[1] !== FULL_DIMS[k][1];
    });
    return [bad.length === 0, `maps whose entry is missing or differs: ${listOf(bad)}; FULL's keys ${listOf(entries.map(([n]) => n))}`];
  });
}

/* P2 .. P6, from the phone's flow */
{
  const r = runCase(import.meta.url, "flow", T), exp = Object.fromEntries(KEYS.map((k) => [k, chainOf(k, PHONE.W, PHONE.dpr)]));
  const S = (r) => r.sum;
  chk("control: the flow ran to the end (every map's sizes up to its top landed; a verdict was said)", r, (r) => [r.landed === true && r.verdictAt >= 0, `landed ${r.landed}; verdict line at ${r.verdictAt}; ${r.errors.length ? "errors " + r.errors.join(" | ") : "no errors"}`]);
  /* P2 */
  chk("P2 the gate (\"flight: ready\") opens with every map's smallest size whole on the GPU and nothing else of any map", r, (r) => {
    if (!r.snaps.ready) return [false, "\"flight: ready\" was not said"];
    const s = r.snaps.ready.sum, bad = KEYS.filter((k) => !s[k] || s[k].completed.length !== 1 || s[k].completed[0] !== exp[k].first || s[k].order.length !== 1);
    return [bad.length === 0, `maps not at exactly their smallest: ${listOf(bad.map((k) => `${k} (${(s[k]?.completed || []).map((p) => p.replace(/^.*\//, "")).join("+") || "nothing"})`))}`];
  });
  chk("P2 ... and by then only the smallest sizes had been asked for (no larger size, no full file)", r, (r) => {
    if (!r.snaps.ready) return [false, "\"flight: ready\" was not said"];
    const first = new Set(Object.values(exp).map((e) => e.first)), early = r.snaps.ready.asked.map((a) => a.path).filter((p) => isMapPath(p) && !first.has(p));
    return [early.length === 0, `asked before the gate and not a smallest: ${listOf(early)}`];
  });
  chk("P2 the larger sizes and the full files are asked for only after the \"flight world:\" line", r, (r) => {
    const first = new Set(Object.values(exp).map((e) => e.first)), v = r.verdictAt;
    const early = mapAsks(r).filter((a) => !first.has(a.path) && (v < 0 || a.lines <= v)).map((a) => a.path);
    const nonEmpty = mapAsks(r).some((a) => !first.has(a.path));
    return [v >= 0 && nonEmpty && early.length === 0, `verdict line ${v}; larger asked at all ${nonEmpty}; asked before it: ${listOf(early)}`];
  });
  /* P3 */
  chk("P3 each map's texture has exactly one generateMipmap, with BASE_LEVEL at its smallest level (L) during it", r, (r) => {
    const bad = KEYS.filter((k) => { const m = S(r)[k]?.mips; return !m || m.length !== 1 || m[0].base !== exp[k].chain.length - 1; });
    return [bad.length === 0, `maps without exactly one mipmap at level L: ${listOf(bad.map((k) => `${k} (${JSON.stringify((S(r)[k]?.mips || []).map((m) => m.base))}, L ${exp[k].chain.length - 1})`))}`];
  });
  chk("P3 ... BASE_LEVEL is set to L before it and back to 0 after it, and is 0 at the end", r, (r) => {
    const bad = KEYS.filter((k) => {
      const s = S(r)[k]; if (!s || s.mips.length !== 1) return true;
      const m = s.mips[0], L = exp[k].chain.length - 1, b = s.base, last = b[b.length - 1];
      return !b.some((x) => x.i < m.i && x.v === L) || !b.some((x) => x.i > m.i && x.v === 0) || !last || last.v !== 0;
    });
    return [bad.length === 0, `maps whose BASE_LEVEL is not set to L then 0 around the mipmap: ${listOf(bad)}`];
  });
  chk("P3 ... and generateMipmap is never called once a larger size is in", r, (r) => {
    const bad = KEYS.filter((k) => { const s = S(r)[k]; if (!s || !s.mips.length) return true; const larger = s.order.filter((o) => o.path !== exp[k].first); return larger.length === 0 || s.mips.some((m) => m.i > larger[0].i); });
    return [bad.length === 0, `maps mipped after a larger size went in, or with no larger size to be mipped before: ${listOf(bad)}`];
  });
  /* P4 on the phone */
  chk("P4 on 390 x 844 at dpr 3, earth-lights.webp (the full 4096) is never asked for and 2048 is the top of the lights", r, (r) => {
    const ls = mapAsks(r).map((a) => a.path).filter((p) => keyOfPath(p) === "lights");
    return [!ls.includes(MAPS.lights) && ls.includes("flight/earth-lights-2048.webp"), `lights files asked for: ${listOf([...new Set(ls)])}`];
  });
  chk("P4 ... every map's top is the smallest size at least 2 x 390 x 2 = 1560 wide, else the full: each is asked for and nothing larger", r, (r) => {
    const bad = KEYS.filter((k) => {
      const got = new Set(mapAsks(r).map((a) => a.path).filter((p) => keyOfPath(p) === k)), chain = new Set(exp[k].chain.map((c) => c.path));
      return !got.has(exp[k].top) || [...got].some((p) => !chain.has(p));
    });
    return [bad.length === 0, `maps whose files asked for differ from the smallest up to their top: ${listOf(bad)}`];
  });
  /* P5 */
  chk("P5 each map's texture is made with storage for the largest size fetched (its width and height, a full level chain)", r, (r) => {
    const bad = KEYS.filter((k) => {
      const st = S(r)[k]?.store, d = dimsOfPath(exp[k].top);
      return !st || st.w !== d[0] || st.h !== d[1] || st.levels !== fullChain(d[0], d[1]);
    });
    return [bad.length === 0, `maps whose storage is not the top's size with all levels: ${listOf(bad.map((k) => `${k} ${JSON.stringify(S(r)[k]?.store && { w: S(r)[k].store.w, h: S(r)[k].store.h, levels: S(r)[k].store.levels })} want ${dimsOfPath(exp[k].top)}`))}`];
  });
  chk("P5 ... each size goes in at its own level (the top at 0, the smallest at L), the smallest first", r, (r) => {
    const bad = KEYS.filter((k) => { const o = S(r)[k]?.order, e = exp[k]; return !o || o.length !== e.chain.length || o.some((x, j) => x.path !== e.chain[j].path || x.level !== level(e, x.path)); });
    return [bad.length === 0, `maps whose sizes are not at their levels: ${listOf(bad.map((k) => `${k} ${JSON.stringify((S(r)[k]?.order || []).map((x) => [x.path.replace(/^.*\//, ""), x.level]))}`))}`];
  });
  chk("P5 ... drawable from the smallest: MIN_LOD is L from the start, before any larger size goes in", r, (r) => {
    const bad = KEYS.filter((k) => { const s = S(r)[k], L = exp[k].chain.length - 1, larger = s?.order.filter((o) => o.path !== exp[k].first) || []; return !s || !s.lod.length || s.lod[0].v !== L || (larger.length > 0 && s.lod[0].i > larger[0].i); });
    return [bad.length === 0, `maps not held at L from the smallest: ${listOf(bad.map((k) => `${k} first MIN_LOD ${S(r)[k]?.lod[0]?.v}, L ${exp[k].chain.length - 1}`))}`];
  });
  chk("P5 ... MIN_LOD is never lower than the lowest level that is whole (a level not yet in is never sampled), and never rises", r, (r) => {
    const bad = KEYS.filter((k) => { const s = S(r)[k]; return !s || !s.lod.length || s.lod.some((x, j) => !(x.lowest === null ? x.v >= 0 : x.lowest === 0 || x.v >= x.lowest) || (j > 0 && x.v > s.lod[j - 1].v)); });
    return [bad.length === 0, `maps whose MIN_LOD went below a level not yet whole, or rose: ${listOf(bad)}`];
  });
  chk("P5 ... eased, not set at once: values between the levels are set (easeLevels(gl) called every 16 ms)", r, (r) => {
    if (!r.easing) return [false, "upload.js does not export easeLevels"];
    const bad = KEYS.filter((k) => !S(r)[k]?.lod.some((x) => Number.isFinite(x.v) && x.v > -1000 && x.v !== Math.round(x.v)));
    return [bad.length === 0, `maps whose MIN_LOD never took a value between two levels: ${listOf(bad)}`];
  });
  chk("P5 ... and ends with no limit (-1000) at the top size", r, (r) => {
    if (!r.easing) return [false, "upload.js does not export easeLevels"];
    const bad = KEYS.filter((k) => { const l = S(r)[k]?.lod; return !l || !l.length || l[l.length - 1].v !== -1000; });
    return [bad.length === 0, `maps whose last MIN_LOD is not -1000: ${listOf(bad.map((k) => `${k} ${S(r)[k]?.lod.slice(-1)[0]?.v}`))}`];
  });
  /* P6 */
  chk("P6 each map's larger sizes land smallest to largest, each only after the one below it is whole", r, (r) => {
    const bad = KEYS.filter((k) => {
      const s = S(r)[k], e = exp[k]; if (!s || s.order.length !== e.chain.length) return true;
      if (JSON.stringify(s.completed) !== JSON.stringify(e.chain.map((c) => c.path))) return true;
      return e.chain.some((c, j) => j > 0 && s.order[j].i < s.completedAt[e.chain[j - 1].path]);
    });
    return [bad.length === 0, `maps out of order, or a size begun before the one below was whole: ${listOf(bad.map((k) => `${k} ${JSON.stringify((S(r)[k]?.completed || []).map((p) => p.replace(/^.*\//, "")))}`))}`];
  });
  chk("P6 ... never two sizes of one map going in turn about (the levels go L, L-1, ... 0, each in one run)", r, (r) => {
    const bad = KEYS.filter((k) => { const s = S(r)[k], L = exp[k].chain.length - 1; return !s || JSON.stringify(s.levelSeq) !== JSON.stringify(Array.from({ length: L + 1 }, (_, j) => L - j)); });
    return [bad.length === 0, `maps whose levels did not go in one run each: ${listOf(bad.map((k) => `${k} ${JSON.stringify(S(r)[k]?.levelSeq)}`))}`];
  });
}

/* P4: a big screen, and the cap on the pixel ratio */
{
  const big = runCase(import.meta.url, "big", T);
  chk("P4 on 1920 x 1080 at dpr 1 (3840 wanted), the lights' sizes are asked for up to the full 4096 (512, 1024, 2048, then the full file)", big, (r) => {
    const ls = new Set(mapAsks(r).map((a) => a.path).filter((p) => keyOfPath(p) === "lights")), want = chainOf("lights", 1920, 1).chain.map((c) => c.path);
    return [want.length === 4 && want[3] === MAPS.lights && want.every((p) => ls.has(p)), `lights files asked for: ${listOf([...ls])}; wanted ${listOf(want)}`];
  });
  const cap = runCase(import.meta.url, "cap", T);
  chk("P4 a dpr above 2 counts as 2: 500 px at dpr 3 asks for what 2000 device px do (the lights' top is 2048, not the full)", cap, (r) => {
    const ls = new Set(mapAsks(r).map((a) => a.path).filter((p) => keyOfPath(p) === "lights"));
    return [!ls.has(MAPS.lights) && ls.has("flight/earth-lights-2048.webp"), `lights files asked for: ${listOf([...ls])}`];
  });
}

/* P7 */
{
  const r = runCase(import.meta.url, "hostless", T), full = new Set(Object.values(MAPS));
  chk("P7 a host that does not place the sized paths: none of them is asked for, and each full map is", r, (r) => {
    const sized = (r.asked || []).filter((a) => SIZED.has(a.raw)).map((a) => a.raw), notAsked = KEYS.filter((k) => !r.asked.some((a) => a.path === MAPS[k]));
    return [sized.length === 0 && notAsked.length === 0, `sized paths asked for: ${listOf(sized)}; full maps never asked for: ${listOf(notAsked)}`];
  });
  chk("P7 ... the maps are loaded whole: each map's texture holds its full picture and no other size", r, (r) => {
    const bad = KEYS.filter((k) => { const s = r.sum[k]; return !s || s.completed.length !== 1 || s.completed[0] !== MAPS[k] || s.order.length !== 1; });
    return [bad.length === 0, `maps not whole: ${listOf(bad)}`];
  });
  chk("P7 ... no generateMipmap off level 0 (BASE_LEVEL never set above 0), one mipmap a map, no fault, nothing thrown", r, (r) => {
    const bad = KEYS.filter((k) => r.sum[k]?.mips.length !== 1 || r.sum[k].mips[0].base !== 0);
    return [bad.length === 0 && r.baseSet === 0 && r.faults.length === 0 && r.errors.length === 0, `maps with other than one mipmap at level 0: ${listOf(bad)}; BASE_LEVEL set above 0 ${r.baseSet} times; faults ${JSON.stringify(r.faults)}; errors ${JSON.stringify(r.errors)}`];
  });
}

/* P8 */
{
  const c = runCase(import.meta.url, "control8", T), r = runCase(import.meta.url, "refused", T);
  const exp = Object.fromEntries(KEYS.map((k) => [k, chainOf(k, PHONE.W, PHONE.dpr)]));
  chk("control (P8): with nothing refused every map's sizes land", c, (r) => [KEYS.every((k) => r.sum[k] && JSON.stringify(r.sum[k].completed) === JSON.stringify(exp[k].chain.map((x) => x.path))), `completed ${JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, r.sum[k]?.completed.length])))}`]);
  chk("P8 one size refused (earth-lights-1024): the lights stay at the last good size (512) and nothing larger goes in", r, (r) => {
    const s = r.sum.lights;
    return [!!s && JSON.stringify(s.completed) === JSON.stringify(["flight/earth-lights-512.webp"]) && s.order.length === 1, `lights landed ${JSON.stringify(s?.completed)}`];
  });
  chk("P8 ... held at the last good size: the lights' MIN_LOD never goes below its level (2)", r, (r) => {
    const s = r.sum.lights;
    return [!!s && s.lod.length > 0 && s.lod.every((x) => x.v >= 2), `MIN_LOD values ${JSON.stringify(s?.lod.map((x) => x.v))}`];
  });
  chk("P8 ... the other maps go on to the top of their sizes", r, (r) => {
    const bad = KEYS.filter((k) => k !== "lights" && JSON.stringify(r.sum[k]?.completed) !== JSON.stringify(exp[k].chain.map((x) => x.path)));
    return [bad.length === 0, `maps that did not finish: ${listOf(bad)}`];
  });
  chk("P8 ... and the failure is warned of once (one warning more than without it)", c.error || r.error ? r : r, (x) => [!c.error && x.warns - c.warns === 1, `warnings with the refusal ${x.warns}, without ${c.warns}`]);
}

/* P9 */
{
  const d = runCase(import.meta.url, "stopped", T);
  chk("P9 (precondition) destroyed at the gate, with every map's smallest on the GPU", d, (r) => [r.mark && r.atMark === 8, `destroyed ${r.mark}; maps with their smallest in then ${r.atMark} of 8`]);
  chk("P9 destroyed after the smallest landed: no larger size is asked for, none uploaded", d, (r) => [r.big.length === 0 && r.uploaded.length === 0, `larger sizes asked for: ${listOf(r.big)}; uploaded: ${listOf(r.uploaded)}`]);
  chk("P9 ... no bind of a released texture, nothing thrown, every bitmap closed", d, (r) => [r.faults.length === 0 && r.errors.length === 0 && r.unclosed === 0, `faults ${JSON.stringify(r.faults)}; errors ${JSON.stringify(r.errors)}; bitmaps left open ${r.unclosed} of ${r.bitmaps}`]);
  const t = runCase(import.meta.url, "retired", T);
  chk("P9 (precondition) the world is judged too slow (\"flight world: off\") after the smallest landed", t, (r) => [r.off && r.atMark === 8, `off said ${r.off}; maps with their smallest in then ${r.atMark} of 8`]);
  chk("P9 retired unfit: no larger size is asked for or uploaded", t, (r) => [r.big.length === 0 && r.uploaded.length === 0, `larger sizes asked for: ${listOf(r.big)}; uploaded: ${listOf(r.uploaded)}`]);
  chk("P9 ... no bind of a released texture, nothing thrown, every bitmap closed", t, (r) => [r.faults.length === 0 && r.errors.length === 0 && r.unclosed === 0, `faults ${JSON.stringify(r.faults)}; errors ${JSON.stringify(r.errors)}; bitmaps left open ${r.unclosed} of ${r.bitmaps}`]);
}

/* P10 */
{
  const r = runCase(import.meta.url, "door", T), exp = Object.fromEntries(DOOR_KEYS.map((k) => [k, chainOf(k, PHONE.W, PHONE.dpr)]));
  chk("P10 the live door asks for each map's smallest URL, as the flight does", r, (r) => {
    const miss = DOOR_KEYS.filter((k) => !r.asked.includes(exp[k].first));
    return [miss.length === 0, `smallest not asked for: ${listOf(miss.map((k) => exp[k].first))}`];
  });
  chk("P10 ... and no file larger than a map's top: the full-size file only where the top is the full size (not earth-lights.webp on a phone)", r, (r) => {
    const over = r.asked.filter((p) => isMapPath(p) && DOOR_KEYS.includes(keyOfPath(p)) && !exp[keyOfPath(p)].chain.some((c) => c.path === p));
    return [over.length === 0, `asked beyond the top: ${listOf(over)}`];
  });
}

/* P11 */
{
  const r = runCase(import.meta.url, "hello", T);
  chk("P11 the worker's hello `images` has every SIZED_PATHS entry as an absolute address (the host's image(), resolved against the page)", r, (r) => {
    if (r.listed === null) return [false, "voyage.js does not export SIZED_PATHS"];
    const bad = r.listed.filter((p) => r.images?.[p] !== absImage(p));
    return [r.listed.length === 15 && bad.length === 0, `${r.listed.length} paths listed; without the right address: ${listOf(bad)}`];
  });
}

/* review: the retry of a map that failed in the first pass (voyage.js warm: load(k).then(() => sharpen(k))) */
{
  const e = chainOf("day", PHONE.W, PHONE.dpr), r = runCase(import.meta.url, "retryEarly", T);
  chk("control (retry): the refused smallest of the day map is asked for again by the second warm and lands", r, (r) => [r.askedBefore >= 1 && r.askedAll > r.askedBefore && r.dayIn === true, `${r.first} asked ${r.askedBefore}x in the first pass, ${r.askedAll}x in all; on the GPU ${r.dayIn}`]);
  chk("P2 a map retried by a second warm before any verdict (none is said): no larger size of any map is asked for", r, (r) => [r.verdict < 0 && r.larger.length === 0, `verdict line ${r.verdict}; larger sizes asked for: ${listOf(r.larger)}`]);
  const u = runCase(import.meta.url, "retryUnfit", T);
  chk("P9 a map retried by a second warm after an unfit verdict: no larger size of any map is asked for", u, (r) => [r.off === true && r.larger.length === 0, `judged too slow ${r.off}; larger sizes asked for: ${listOf(r.larger)}`]);
  const f = runCase(import.meta.url, "retryFit", T);
  chk("control (retry): the retried map (refused once in the first pass, a fit verdict said) goes on to its larger sizes, smallest to top", f, (r) => [r.fit && r.verdict >= 0 && JSON.stringify(r.done) === JSON.stringify(r.chain), `fit ${r.fit}; verdict line ${r.verdict}; landed ${JSON.stringify((r.done || []).map((p) => p.replace(/^.*\//, "")))}`]);
  chk("P2 a map refused once in the first pass and retried: none of its larger sizes is asked for before the verdict (the retry's own sharpen waits for it)", f, (r) => [r.early.length === 0, `asked before the verdict (line ${r.verdict}): ${listOf(r.early)}`]);
}

/* #164: ?holdreveal puts the larger sizes in whole (upload.js uploadSized: the unbanded path) */
{
  const r = runCase(import.meta.url, "hold", T);
  chk("control (hold): with ?holdreveal every map's sizes landed, smallest to top, and nothing threw", r, (r) => [r.landed === true && r.errors.length === 0 && r.faults.length === 0, `landed ${r.landed}; errors ${JSON.stringify(r.errors)}; faults ${JSON.stringify(r.faults)}`]);
  chk("P6 with ?holdreveal each larger size is put in whole: one texSubImage2D call at its own level, all its rows at once (no bands)", r, (r) => {
    const bad = [];
    for (const k of KEYS) {
      const chain = chainOf(k, PHONE.W, PHONE.dpr).chain;
      chain.slice(0, -1).forEach((c) => {
        const calls = r.calls[c.path] || [], lv = level(chainOf(k, PHONE.W, PHONE.dpr), c.path);
        if (!(calls.length === 1 && calls[0].k === "sub" && calls[0].level === lv && calls[0].h === dimsH(c.path) && calls[0].y === 0)) bad.push(c.path);
      });
    }
    return [bad.length === 0, `larger sizes not put in whole, in one call: ${listOf(bad)}`];
  });
  chk("P6 ... and every bitmap made was closed", r, (r) => [r.bitmaps > 0 && r.unclosed === 0, `${r.unclosed} of ${r.bitmaps} bitmap(s) left open`]);
}

/* #164: a map with no sizes whose download is refused is let go and asked for again (voyage.js loadWhole's catch) */
{
  const r = runCase(import.meta.url, "wholeRefused", T);
  chk("P7 a full map (no sizes) refused in the first pass is asked for again by the next warm", r, (r) => [r.askedBefore >= 1 && r.askedAll > r.askedBefore, `${MAPS.day} asked for ${r.askedBefore} time(s) in the first pass, ${r.askedAll} in all`]);
  chk("P7 ... nothing of it was put on the GPU by the failed pass, and it lands whole on the retry, with no fault and nothing thrown", r, (r) => [r.texturesBefore === 0 && r.sum.day?.completed.length === 1 && r.sum.day.completed[0] === MAPS.day && r.faults.length === 0 && r.errors.length === 0, `textures before the retry ${r.texturesBefore}; landed ${JSON.stringify(r.sum.day?.completed)}; faults ${JSON.stringify(r.faults)}; errors ${JSON.stringify(r.errors)}`]);
}

/* review: the rich Earth from the first (?door3d&level=2&rich, the capability probe answering): its clouds fields are made with the maps */
{
  const r = runCase(import.meta.url, "richGate", T), c = runCase(import.meta.url, "richEnd", T);
  const sizeSet = (k) => new Set(chainOf(k, PHONE.W, PHONE.dpr).chain.map((x) => dimsOfPath(x.path).join("x")).concat(sizesOf(k).map((x) => `${x.w}x${x.h}`), FULL_DIMS[k].join("x")));
  const has = (fields, k) => fields.some(([w, h]) => sizeSet(k).has(`${w}x${h}`));
  chk("control (rich): the flight is rich from the first (the probe answered, \"door: weight rich\"), the smallest sizes are in, no verdict and no larger size yet", r, (r) => [r.rich && r.smallest === 8 && r.verdict < 0 && r.larger.length === 0, `weight rich ${r.rich}; maps with their smallest in ${r.smallest} of 8; verdict line ${r.verdict}; larger asked ${listOf(r.larger)}`]);
  chk("control (rich): with every size landed, the clouds and near clouds fields have been made (the reading of a field: a mipped texture with no storage of its own, the size of one of that map's sizes)", c, (r) => [has(r.fields, "clouds") && has(r.fields, "cloudsN"), `fields (w x h): ${JSON.stringify(r.fields)}`]);
  chk("P2 rich from the first: the clouds fields exist once the smallest sizes have landed, before the verdict and before any larger size (draw binds them, not the blank one)", r, (r) => [has(r.fields, "clouds") && has(r.fields, "cloudsN"), `fields (w x h) at the gate: ${JSON.stringify(r.fields)}; wanted one of the size of clouds (${[...sizeSet("clouds")].join(", ")}) and one of cloudsN (${[...sizeSet("cloudsN")].join(", ")})`]);
}

/* review: the ease is run by the draws (nothing in these two cases calls easeLevels: the flight is flown, the live door is mounted) */
{
  const r = runCase(import.meta.url, "flightFrames", T);
  chk("P5 the flight's own draw loop eases each map's MIN_LOD down (values between the levels set, ending -1000) with nothing else calling easeLevels", r, (r) => {
    const bad = KEYS.filter((k) => { const l = r.sum[k]?.lod || []; return !l.some((x) => x.v > -1000 && x.v !== Math.round(x.v)) || l[l.length - 1]?.v !== -1000; });
    return [r.draws > 0 && r.landed === true && bad.length === 0, `${r.draws} draw call(s); sizes landed ${r.landed}; maps not eased by the draws: ${listOf(bad)}`];
  });
  /* a source check, not a behaviour: the live door's loop (door3d.js tick) draws too seldom on the stub page for its ease to be seen,
     and the last value of an ease is put in by a chore whether or not anything was drawn (upload.js) */
  chk("P5 (a source check) the live door's draw() runs easeLevels(gl) before it draws, as the flight's does", {}, () => {
    const src = readFileSync(new URL("../../assets/door/door3d.js", import.meta.url), "utf8"), i = src.indexOf("function draw(into = null) {");
    const body = i < 0 ? "" : src.slice(i, i + 700), call = body.indexOf("easeLevels(gl);");
    return [call > 0 && /^\s*if \(!prog \|\| dead\) return;\s*(\/\*[^]*?\*\/\s*)?$/.test(body.slice(body.indexOf("{") + 1, call)) && !/^\s*\/\//.test(body.slice(body.lastIndexOf("\n", call) + 1, call)), call > 0 ? "the call is there, but not as a live statement at the top of draw()" : "draw() has no easeLevels(gl) call near its top"];
  });
}

/* P12 */
{
  const r = runCase(import.meta.url, "order", T);
  chk("P12 queued together, the chores run docs, flight, info, sharp, then the untagged", r, (r) => [JSON.stringify(r.order) === JSON.stringify(["docs", "flight", "info", "sharp", "-"]), `ran in the order ${JSON.stringify(r.order)}`]);
  const h = runCase(import.meta.url, "hurried", T);
  chk("P12 a journey's hurry runs what it needs at once and never a \"sharp\" chore: that waits out the opening with the untagged, and goes before it", h, (r) => {
    const at = (t) => r.ran.find((x) => x.tag === t)?.at;
    return [r.ran.length === 3 && at("flight") < 1000 && at("sharp") >= 6000 && at("-") >= 6000 && r.ran.findIndex((x) => x.tag === "sharp") < r.ran.findIndex((x) => x.tag === "-"), `ran ${JSON.stringify(r.ran)}`];
  });
  const t = runCase(import.meta.url, "retry", T), e = chainOf("day", PHONE.W, PHONE.dpr);
  chk("P12 a map that failed in the first pass is asked for again by the next warm (its smallest)", t, (r) => [r.askedBefore >= 1 && r.askedAll > r.askedBefore, `${r.first} asked for ${r.askedBefore} time(s) in the first pass, ${r.askedAll} in all`]);
  chk("P12 ... and loads its smallest, then its larger sizes, in order, mipped once on the smallest", t, (r) => {
    const s = r.sum.day;
    return [!!s && JSON.stringify(s.completed) === JSON.stringify(e.chain.map((c) => c.path)) && s.mips.length === 1 && s.mips[0].base === e.chain.length - 1, `completed ${JSON.stringify(s?.completed)}; mips ${JSON.stringify(s?.mips.map((m) => m.base))}`];
  });
}
finish();
