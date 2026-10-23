/*
 * Test for the dawn's glow pictures and their blob: URLs (#89, A), written from the specification alone.
 *
 * glows.js draws each glow, rasterises it to a blob: URL and sets that as an <image href> (the images marked
 * data-raster in the dawn's markup). Pictures are cached per size. A build superseded part-way (a resize that
 * comes before the last one has finished) must never revoke the blob URL of a picture that is still some image's
 * href; and when the newest build ends, no image points at a revoked URL and the URLs of sizes no longer current
 * are revoked.
 *
 *   G1 back  a picture is on screen at size S1; a resize starts a build at S2 (its encode held); another resize brings
 *            the window back to S1, so the S2 build is superseded having been handed the cached S1 picture; the
 *            held encodes are then let go
 *   G2 on    the same, but the second resize goes on to S3
 *   G3 chains  S1, S2, S3, S2 and S1, S2, S3, S1, S3: several builds superseded in turn
 *   G0       control: the resize to S2 alone, let run to its end: no image points at a revoked URL
 *
 *   node tools/ci/door-lows-glows-test.mjs
 *
 * No dependencies and no browser; each case runs in a fresh Node process (this file again, as `--child`) against the
 * stub page in door-stub.mjs, on a virtual clock. URL.createObjectURL and revokeObjectURL are the stub's (page.blobURLs,
 * page.revoked); a revoke is judged at the moment it happens (was the URL then some image's href?) and at the end.
 */
import { INDEX, installPage, installClock, childMain, runCase, check, finish, errOf } from "./door-stub.mjs";

const CASES = {
  async "control"() { return glowsCase(false, [[1000, 640, 2500]]); },
  async "back"() { return glowsCase(true, [[1000, 640, 2500], [1280, 800, 2500]]); },
  async "on"() { return glowsCase(true, [[1000, 640, 2500], [1600, 900, 2500]]); },
  async "chain-a"() { return glowsCase(true, SEQS["chain-a"]); },
  async "chain-b"() { return glowsCase(true, SEQS["chain-b"]); },
};
/* resize chains, each [width, height, ms to wait after]: S1 is the first size (1280x800), S2 1000x640, S3 1600x900 */
const SEQS = {
  "chain-a": [[1000, 640, 3000], [1600, 900, 700], [1000, 640, 30]],
  "chain-b": [[1000, 640, 1500], [1600, 900, 3000], [1280, 800, 200], [1600, 900, 1500]],
};

/* the dawn's host: the glow images (data-raster) record the href they are given; the Earth's two pictures load */
function host(page, rasters) {
  const mk = (name, extra = {}) => {
    const attrs = { ...extra };
    const el = new Proxy({
      name, dataset: { ...extra.dataset }, style: { setProperty() {}, removeProperty() {} },
      getAttribute: (k) => (k in attrs ? attrs[k] : null), hasAttribute: (k) => k in attrs, removeAttribute: (k) => { delete attrs[k]; },
      setAttribute(k, v) { attrs[k] = String(v); if (/href$/.test(k)) el.cur = String(v); },
      setAttributeNS(ns, k, v) { attrs[k] = String(v); if (/href$/.test(k)) el.cur = String(v); },
      addEventListener() {}, removeEventListener() {}, complete: false, naturalWidth: 0, cur: null,
    }, {
      get: (t, k) => (k in t ? t[k] : k === "href" ? t.cur : k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : anyOf()),
      set: (t, k, v) => { t[k] = v; if (k === "href" && v != null && typeof v !== "object") t.cur = String(v); return true; },
    });
    return el;
  };
  const anyOf = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : anyOf()), set: () => true, apply: () => anyOf() });
  for (const n of ["sway1", "sway2", "zod", "sun", "sunpt"]) rasters.push(mk(n, { "data-raster": n, dataset: { raster: n } }));
  const pics = ["dawn-pre", "dawn"].map((n) => mk(n, { "data-href": `img/dawn/${n}.webp`, dataset: { href: `img/dawn/${n}.webp` } }));
  const pick = (sel) => {
    const named = rasters.find((r) => sel.includes(`"${r.name}"`) || sel.includes(`'${r.name}'`));
    return /data-raster/.test(sel) ? named || rasters[0] : /image\.pre|\.pre\b/.test(sel) ? pics[0] : anyOf();
  };
  const all = (sel) => (/data-raster/.test(sel) ? (rasters.find((r) => sel.includes(`"${r.name}"`)) ? [pick(sel)] : rasters) : /\.earth image\[data-href\]/.test(sel) ? pics : []);
  const world = new Proxy({
    dataset: {}, style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, contains: () => false, toggle: () => false },
    querySelector: pick, querySelectorAll: all,
    get clientWidth() { return globalThis.innerWidth; }, get clientHeight() { return globalThis.innerHeight; },
    getBoundingClientRect: () => ({ width: globalThis.innerWidth, height: globalThis.innerHeight }),
  }, { get: (t, k) => (k in t ? t[k] : k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : anyOf()), set: (t, k, v) => { t[k] = v; return true; } });
  return new Proxy({ querySelector: (sel) => (sel === ".world" ? world : pick(sel)), querySelectorAll: all, dataset: {}, style: { setProperty() {} } },
    { get: (t, k) => (k in t ? t[k] : k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : anyOf()), set: (t, k, v) => { t[k] = v; return true; } });
}

async function glowsCase(holding, seq) {
  const page = installPage();
  const clock = installClock();
  const rasters = [];
  const hold = { on: false, calls: 0, gates: [] };
  page.blobGate = () => {
    if (!hold.on) return undefined;
    hold.calls++;
    return new Promise((r) => { hold.gates.push(r); });
  };
  const shown = () => rasters.map((r) => r.cur).filter((u) => /^blob:/.test(String(u)));
  const revoke = URL.revokeObjectURL;
  const out = { revokedWhileShown: [] };
  URL.revokeObjectURL = (u) => { if (shown().includes(u)) out.revokedWhileShown.push(u); return revoke(u); };

  const door = await import(INDEX);
  const d = door.createDoor({ typingWait: 0, flags: {} });
  door.openChores();
  const dawn = d.dawn(host(page, rasters));
  dawn.start();
  await clock.advance(4000);
  out.firstShown = shown().length; out.firstMinted = page.blobURLs.length;
  if (holding) hold.on = true;
  for (const [w, h, ms] of seq) { page.resize(w, h); await clock.advance(ms); }
  out.held = hold.calls;
  /* the encodes finish newest first: the superseded build's is the last to come in */
  hold.on = false;
  for (const release of hold.gates.reverse()) { release(); await clock.advance(1500); }
  await clock.advance(8000);
  const now = shown();
  const revoked = new Set(page.revoked);
  out.shown = now.length;
  out.minted = page.blobURLs.length;
  out.shownRevoked = now.filter((u) => revoked.has(u)).length;
  out.stale = page.blobURLs.map((b) => b.url).filter((u) => !now.includes(u) && !revoked.has(u)).length;
  return out;
}

if (process.argv[2] === "--child") await childMain(CASES);

{
  const c = runCase(import.meta.url, "control", 50000);
  check("G0 control: a resize left to finish: pictures were drawn and no image points at a revoked URL", !c.error && c.firstShown >= 1 && c.shownRevoked === 0, `${c.firstShown} blob picture(s) shown at first, ${c.shown} at the end, ${c.shownRevoked} of them revoked${errOf(c)}`);
  for (const [how, label] of [["back", "S1, S2, back to S1"], ["on", "S1, S2, on to S3"], ["chain-a", "S1, S2, S3, S2"], ["chain-b", "S1, S2, S3, S1, S3"]]) {
    const r = runCase(import.meta.url, how, 50000);
    check(`G (${label}) precondition: pictures on screen at S1, and a later build held at its encode`, !r.error && r.firstShown >= 1 && r.held >= 1, `${r.firstShown} shown at first, ${r.held} encode(s) held${errOf(r)}`);
    check(`G (${label}): no URL is revoked while some image still points at it`, !r.error && r.revokedWhileShown.length === 0, `${r.revokedWhileShown?.length} revoked while shown${errOf(r)}`);
    check(`G (${label}): when the newest build ends, no image points at a revoked URL`, !r.error && r.shown >= 1 && r.shownRevoked === 0, `${r.shown} shown, ${r.shownRevoked} revoked${errOf(r)}`);
    check(`G (${label}): ... and every URL not shown any more is revoked (none leaks)`, !r.error && r.stale === 0, `${r.stale} of ${r.minted} minted URL(s) neither shown nor revoked${errOf(r)}`);
  }
}
finish();
