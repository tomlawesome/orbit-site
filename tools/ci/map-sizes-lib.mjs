/*
 * What the sized-maps tests (map-sizes-test.mjs, and the released-world / door-world tests that change for #148) share:
 * the maps' real sizes read from the files' own headers, the sizes the spec derives from them, the size a screen asks for,
 * and a createImageBitmap that gives a picture the width and height its file has (the stub's 64 x 64 would hide every
 * level). Not a test itself; no dependencies, no page.
 *
 * Spec (#148): each map has ready-made smaller sizes beside it, `<map>-<width>.webp`, each half the last, floor(w / 2^i)
 * by floor(h / 2^i), down to the last one still 512 wide or more. The largest size fetched is the smallest one at least
 * 2 x W x min(dpr, 2) wide, else the full size; the smallest is always fetched first.
 */
import { openSync, readSync, closeSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const IMG = fileURLToPath(new URL("../../assets/door/img/", import.meta.url));

/* the flight world's eight maps, by the key voyage.js gives them (PICTURE_PATHS) */
export const MAPS = {
  lights: "flight/earth-lights.webp", day: "flight/earth-day.webp", clouds: "flight/earth-clouds.webp",
  euro: "flight/europe-lights.webp", moon: "flight/moon.webp",
  lightsN: "dawn/lights-near.webp", cloudsN: "dawn/clouds-near.webp", dayN: "dawn/land-near.webp",
};
/* the maps the live door draws (door3d.js: no moon; the strip is not a sized map) */
export const DOOR_KEYS = ["lights", "euro", "clouds", "day", "lightsN", "cloudsN", "dayN"];
export const LEAST = 512;

/** a webp's type and size from its header: { type: "VP8 " | "VP8L" | "VP8X", w, h }, or null if it is not one @param {string} file */
export function webpHeader(file) {
  let fd;
  try { fd = openSync(file, "r"); } catch { return null; }
  try {
    const b = Buffer.alloc(32), n = readSync(fd, b, 0, 32, 0);
    if (n < 30 || b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WEBP") return null;
    const type = b.toString("latin1", 12, 16);
    if (type === "VP8 ") return { type, w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (type === "VP8L") { const v = b.readUInt32LE(21); return { type, w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    if (type === "VP8X") return { type, w: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1, h: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1 };
    return null;
  } finally { closeSync(fd); }
}

/* each full map's size, from its own header */
export const FULL_DIMS = Object.fromEntries(Object.entries(MAPS).map(([k, p]) => { const h = webpHeader(IMG + p); return [k, h ? [h.w, h.h] : [0, 0]]; }));
export const stemOf = (p) => p.replace(/\.webp$/, "");

/** the ready-made sizes of a map, smallest first: { path, w, h, i } (i: halvings from the full size) @param {string} key */
export function sizesOf(key) {
  const [fw, fh] = FULL_DIMS[key], out = [];
  for (let i = 1; Math.floor(fw / 2 ** i) >= LEAST; i++) out.push({ path: `${stemOf(MAPS[key])}-${Math.floor(fw / 2 ** i)}.webp`, w: Math.floor(fw / 2 ** i), h: Math.floor(fh / 2 ** i), i });
  return out.reverse();
}
/* every ready-made size's path: the 15 files */
export const sizedPathsExpected = () => Object.keys(MAPS).flatMap((k) => sizesOf(k).map((s) => s.path));

/**
 * What a screen W css px wide at pixel ratio dpr should fetch of a map: { full, sizes, first (the smallest, always
 * fetched first), top (the largest fetched), chain (every file from the smallest to the top, in the order they come) }
 * @param {string} key @param {number} W @param {number} dpr
 */
export function expectFor(key, W, dpr) {
  const sizes = sizesOf(key), need = 2 * W * Math.min(dpr, 2), full = { path: MAPS[key], w: FULL_DIMS[key][0], h: FULL_DIMS[key][1], i: 0 };
  const at = sizes.findIndex((s) => s.w >= need);
  const chain = at < 0 ? [...sizes, full] : sizes.slice(0, at + 1);
  return { key, full: full.path, sizes, first: sizes[0].path, top: chain[chain.length - 1].path, chain, need };
}

/** the width and height of a map's file, by the path the door asks the host for ("flight/earth-lights-1024.webp"), else null @param {string} path */
export function dimsOfPath(path) {
  for (const k of Object.keys(MAPS)) {
    if (path === MAPS[k]) return FULL_DIMS[k];
    const s = sizesOf(k).find((x) => x.path === path);
    if (s) return [s.w, s.h];
  }
  return null;
}
/** the key of the map a path belongs to (a full map or one of its sizes), else null @param {string} path */
export const keyOfPath = (path) => Object.keys(MAPS).find((k) => path === MAPS[k] || sizesOf(k).some((s) => s.path === path)) ?? null;
/** the address as the door was given it by a host whose image() is "img/" + path, back to the path (a host that leaves it alone: as it is) @param {string} url */
export const unplace = (url) => String(url).split("?")[0].replace(/^.*?img\//, "");

/** what a fetch answers for a path: a blob that knows the picture it holds @param {string} path */
export function blobOf(path) {
  const d = dimsOfPath(path);
  return { size: 1, type: "image/webp", path: d ? path : undefined, w: d ? d[0] : 64, h: d ? d[1] : 64 };
}

/**
 * createImageBitmap for the page: a picture from a blob has its file's width and height and remembers its path; a cut
 * from it (a band) has the cut's size and the same path; the crop probe's own pictures are the stub's (1 x 2, `probe`).
 * Returns the list of every picture's bitmap made (each with .closed), which the tests read.
 */
export function installBitmaps() {
  const made = [];
  globalThis.createImageBitmap = async (src, ...r) => {
    const cut = r.length >= 4;
    if (src?.probe) return { width: cut ? r[2] : 1, height: cut ? r[3] : 2, probe: true, close() {} };
    const b = { width: cut ? r[2] : src?.w ?? 64, height: cut ? r[3] : src?.h ?? 64, path: src?.path, map: !!src?.path, probe: false, closed: false, close() { this.closed = true; } };
    made.push(b);
    return b;
  };
  return made;
}
