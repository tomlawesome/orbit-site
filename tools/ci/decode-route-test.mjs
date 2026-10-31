/*
 * Tests for #113 (Firefox: decode the maps with the browser's image loader), the page side, written from the
 * specification alone (ADR-0004 6e, test specification P1-P7 and P9; P8 is in lint-test.sh). `fetchBitmap(url, options)` is
 * imported from assets/door/index.js (the only file of the folder a site module may import) on the stub page
 * (door-stub.mjs) with a fake `fetch` that answers one blob for any address.
 *
 *   node tools/ci/decode-route-test.mjs
 *
 * The image-loader route: an `Image` is made whose src is a `blob:` URL from createObjectURL of the fetched blob,
 * decode() is awaited, createImageBitmap is called with THAT IMAGE as its first argument, and the URL is revoked
 * afterwards. The blob route: createImageBitmap is called with the fetched BLOB, with the options as given; no Image,
 * no `blob:` URL. OPTS = { colorSpaceConversion: "none", premultiplyAlpha: "none" }.
 *
 *   P1  Firefox tell, no `decode` flag: the image-loader route; one fetch of the url; the wrap's options carry neither
 *       colorSpaceConversion nor premultiplyAlpha; the URL is revoked by the time the promise resolves; it resolves to
 *       the bitmap createImageBitmap returned; one console line `pictures: decoded by the image loader` (said once a
 *       page: a second picture adds none). Control: userAgentData present: the blob route, OPTS, no Image, no blob:
 *       URL, no such line
 *   P2  Chromium tell with flags.decode "img": the image-loader route. Control: Firefox tell with "blob": the blob
 *       route, no line
 *   P3  Firefox tell, OPTS plus resizeWidth, resizeHeight, resizeQuality: the wrap's options are exactly those three
 *       resize keys. Control: the blob route passes all five through unchanged
 *   P4  the image's decode fails (error): resolves to a bitmap, createImageBitmap called once, with the blob and OPTS,
 *       the URL revoked. Control: load: called once, with the Image
 *   P5  the wrap throws for an Image and answers for the blob: resolves to the blob call's answer, the URL revoked.
 *       Control: a wrap that answers: no blob call
 *   P6  fetch rejecting: fetchBitmap rejects, no Image, no blob: URL, no createImageBitmap call. Control: P1
 *   P7  page.picture(url, loaded) (assets/door/page.js): after `load`, `loaded` is not called until the image's
 *       decode() resolves, then once; done() is true from `load`. Control: a decode that rejects after `load` still
 *       calls `loaded` once; an `error` never does
 *   P9  (the alpha defect, 6e.1) Firefox tell, OPTS plus resizeWidth: the first createImageBitmap call is the Image with
 *       exactly { resizeWidth } (resize keys only); a second call has the first call's bitmap as its source and exactly
 *       { premultiplyAlpha: "none" }; the first bitmap was closed; the promise resolves to the second call's bitmap.
 *       Control: the same call without premultiplyAlpha makes one createImageBitmap call (no second wrap), closes
 *       nothing, and resolves to its bitmap
 *
 * One fresh Node process a case; the pictures are not decoded by anything, so nothing here reads a clock.
 */
import { INDEX, installPage, installClock, sleep, childMain, runCase, chk, finish } from "./door-stub.mjs";

const PAGE_JS = "../../assets/door/page.js";
const URL1 = "https://site.test/app/img/flight/earth-lights.webp", URL2 = "https://site.test/app/img/flight/earth-day.webp";
const OPTS = { colorSpaceConversion: "none", premultiplyAlpha: "none" };
const SAID = "pictures: decoded by the image loader";

/*
 * A page that reads as Firefox to the family tell (the gate accepted, no background compile, no userAgentData), or as
 * Chromium with `ua`; the fake fetch answering `blob`; createImageBitmap recording its first argument.
 *   o.fetch  "reject" makes the download fail   o.hook  page.imageHook   o.wrap  (src, ...r) => bitmap | throws
 */
async function boot({ ua = false, flags = {}, fetch: fetchHow, hook, wrap } = {}) {
  const blob = { size: 4096, type: "image/webp", name: "the fetched blob" };
  const fetched = [];
  const page = installPage({
    fetch: async (u) => {
      fetched.push(String(u));
      if (fetchHow === "reject") throw new Error("no network here");
      return { ok: true, status: 200, blob: async () => blob };
    },
  });
  const clock = installClock();
  const get = page.glBase.getExtension;
  page.glBase.getExtension = (n) => (n === "KHR_parallel_shader_compile" ? null : get(n));
  if (ua) Object.defineProperty(globalThis.navigator, "userAgentData", { value: { brands: [{ brand: "Chromium", version: "130" }], mobile: false }, configurable: true, writable: true });
  if (hook) page.imageHook = hook;
  const calls = [], answers = [];
  globalThis.createImageBitmap = async (src, ...r) => {
    const kind = src === blob ? "blob" : src instanceof page.StubImage ? "image" : "other";
    calls.push({ kind, src, opts: r[0] });
    if (wrap) { const w = await wrap(src, kind, ...r); answers.push(w); return w; }
    const bmp = { width: 64, height: 64, from: kind, closed: 0, close() { this.closed++; } };
    answers.push(bmp);
    return bmp;
  };
  const door = await import(INDEX);
  door.createDoor({ typingWait: 0, image: (p) => "img/" + p, flags });
  door.openChores();
  return { page, clock, blob, fetched, calls, answers, door };
}

/* let the real timers the stub's images use run, and the virtual clock with them, until p has settled */
async function settle(p, b) {
  let out = { state: "pending" };
  p.then((value) => { out = { state: "resolved", value, revokedBy: b.page.revoked.length, made: b.page.blobURLs.length }; }, (error) => { out = { state: "rejected", error: String(error && error.message || error) }; });
  for (let i = 0; i < 400 && out.state === "pending"; i++) { await b.clock.advance(0); await sleep(2); }
  return out;
}

/* what a case reports: the route that was taken, as the page shows it */
async function run(b, url = URL1, opts = OPTS) {
  const imagesBefore = b.page.images.length, urlsBefore = b.page.blobURLs.length;
  const out = await settle(b.door.fetchBitmap(url, opts), b);
  const urls = b.page.blobURLs.slice(urlsBefore).map((u) => u.url);
  return {
    state: out.state, rejection: out.error ?? null,
    resolvedToLast: out.state === "resolved" && b.answers.length > 0 && out.value === b.answers[b.answers.length - 1],
    resolvedIsBitmap: out.state === "resolved" && !!out.value && typeof out.value.close === "function",
    fetches: b.fetched.filter((u) => u === url).length, fetchedAll: b.fetched.length,
    images: b.page.images.length - imagesBefore, blobURLs: urls.length, imageSrcs: b.page.images.slice(imagesBefore).map((i) => i.src),
    urls, revoked: urls.every((u) => b.page.revoked.includes(u)), revokedByResolve: out.state === "resolved" ? urls.every((u) => b.page.revoked.slice(0, out.revokedBy).includes(u)) : null,
    calls: b.calls.map((c) => ({ kind: c.kind, keys: Object.keys(c.opts || {}).sort(), opts: c.opts ? { ...c.opts } : null })),
    said: b.page.lines.filter((l) => l.includes(SAID)).length,
  };
}

const loaderRoute = (r) => r.images === 1 && r.blobURLs === 1 && r.imageSrcs[0] === r.urls[0] && r.calls.length >= 1 && r.calls[0].kind === "image" && !r.calls.some((c) => c.kind === "blob");
const blobRoute = (r) => r.images === 0 && r.blobURLs === 0 && r.calls.length === 1 && r.calls[0].kind === "blob";

const CASES = {
  async p1() { const b = await boot(); const r = await run(b); r.again = (await run(b, URL2)).said; return r; },
  async p1control() { return run(await boot({ ua: true })); },
  async p2() { return run(await boot({ ua: true, flags: { decode: "img" } })); },
  async p2control() { return run(await boot({ flags: { decode: "blob" } })); },
  async p3() { return run(await boot(), URL1, { ...OPTS, resizeWidth: 1024, resizeHeight: 512, resizeQuality: "high" }); },
  async p3control() { return run(await boot({ flags: { decode: "blob" } }), URL1, { ...OPTS, resizeWidth: 1024, resizeHeight: 512, resizeQuality: "high" }); },
  async p4() { return run(await boot({ hook: (img) => img.fire("error") })); },
  async p4control() { return run(await boot({ hook: (img) => img.fire("load") })); },
  async p5() {
    const b = await boot({ wrap: (src, kind) => { if (kind === "image") throw new Error("the wrap failed"); return { width: 64, height: 64, from: "blob", close() {} }; } });
    const r = await run(b);
    r.resolvedToBlobAnswer = r.state === "resolved" && b.answers.length === 1;
    return r;
  },
  async p5control() { return run(await boot()); },
  async p6() { return run(await boot({ fetch: "reject" })); },
  async p9() { return p9({ ...OPTS, resizeWidth: 1024 }); },
  async p9control() { return p9({ colorSpaceConversion: "none", resizeWidth: 1024 }); },
  async p7() { return picture("decode-after-load"); },
  async p7reject() { return picture("decode-rejects"); },
  async p7error() { return picture("error"); },
};

/* P9: the image-loader route with a resize; what the calls were, in order, and what became of the bitmaps they returned */
async function p9(opts) {
  const b = await boot();
  const r = await run(b, URL1, opts);
  const [first, second] = b.calls, [a0, a1] = b.answers;
  r.firstIsImage = !!first && first.kind === "image";
  r.firstOpts = first ? { ...first.opts } : null;
  r.secondFromFirstAnswer = !!second && !!a0 && second.src === a0;
  r.secondOpts = second ? { ...second.opts } : null;
  r.firstClosed = a0 ? a0.closed : null;
  r.secondClosed = a1 ? a1.closed : null;
  r.resolvedToSecond = r.resolvedToLast === true && b.answers.length === 2;
  r.resolvedToFirst = r.resolvedToLast === true && b.answers.length === 1;
  return r;
}

/* P7: the Earth's picture, offered to `loaded` only once its decode has settled */
async function picture(how) {
  const page = installPage();
  const mod = await import(PAGE_JS);
  const pg = mod.page ?? mod.default;
  if (!pg || typeof pg.picture !== "function") return { none: "assets/door/page.js exports no `page` with picture(url, loaded)" };
  const imgs = [], decodes = [];
  page.imageHook = (img) => { imgs.push(img); };
  page.StubImage.prototype.decode = function () { return new Promise((ok, no) => { decodes.push({ img: this, ok, no }); }); };
  const loaded = [];
  const handle = pg.picture(URL1, (...a) => { loaded.push(a); });
  await sleep(10);
  const img = imgs[0];
  if (!img) return { none: "picture(url, loaded) made no Image whose src was set" };
  const snap = () => ({ loaded: loaded.length, done: handle && typeof handle.done === "function" ? !!handle.done() : null });
  const out = { made: imgs.length, before: snap() };
  if (how === "error") {
    img.fire("error"); await sleep(10);
    for (const d of decodes.splice(0)) d.no(new Error("decode failed"));
    await sleep(10);
    out.afterError = snap();
    return out;
  }
  img.fire("load"); await sleep(10);
  out.afterLoad = snap();
  out.decodes = decodes.length;
  if (how === "decode-after-load") { for (const d of decodes.splice(0)) d.ok(); }
  else { for (const d of decodes.splice(0)) d.no(new Error("decode failed")); }
  await sleep(10);
  out.afterDecode = snap();
  out.carriesImage = loaded.length === 1 && loaded[0].some((a) => a === img || (a && (a.img === img || a.image === img)));
  await sleep(10);
  out.later = snap();
  return out;
}

if (process.argv[2] === "--child") await childMain(CASES);

const show = (x) => JSON.stringify(x);
const call = (n) => runCase(import.meta.url, n);
const noRoundTrip = (r) => r.state === "resolved";

{
  const r = call("p1"), c = call("p1control");
  chk("P1 Firefox tell, no flag: the image-loader route (an Image on a blob: URL, createImageBitmap of that Image, once)", r, (r) => [loaderRoute(r), show({ images: r.images, blobURLs: r.blobURLs, imageSrcs: r.imageSrcs, calls: r.calls })]);
  chk("P1 ... exactly one fetch of the url", r, (r) => [r.fetches === 1, `${r.fetches} fetches of the url`]);
  chk("P1 ... the wrap's options carry neither colorSpaceConversion nor premultiplyAlpha", r, (r) => [r.calls.length >= 1 && !r.calls[0].keys.includes("colorSpaceConversion") && !r.calls[0].keys.includes("premultiplyAlpha"), show(r.calls[0])]);
  chk("P1 ... the blob: URL is revoked by the time the promise resolves", r, (r) => [r.state === "resolved" && r.blobURLs === 1 && r.revokedByResolve === true, `state ${r.state}, made ${r.blobURLs}, revoked by resolve ${r.revokedByResolve}`]);
  chk("P1 ... it resolves to the bitmap createImageBitmap returned", r, (r) => [r.resolvedToLast === true, `resolved to the last answer: ${r.resolvedToLast}${r.rejection ? `; ${r.rejection}` : ""}`]);
  chk("P1 ... the console carries one line `pictures: decoded by the image loader`", r, (r) => [r.said === 1, `${r.said} line(s)`]);
  chk("P1 ... and a second picture adds none (said once a page)", r, (r) => [r.again === 1, `${r.again} line(s) after a second picture`]);
  chk("P1 control: userAgentData present: the blob route (no Image, no blob: URL), options equal OPTS", c, (c) => [blobRoute(c) && show(c.calls[0].opts) === show(OPTS), show({ images: c.images, blobURLs: c.blobURLs, calls: c.calls })]);
  chk("P1 control: ... and no such console line", c, (c) => [c.said === 0 && noRoundTrip(c), `${c.said} line(s), state ${c.state}`]);
}
{
  const r = call("p2"), c = call("p2control");
  chk("P2 Chromium tell with flags.decode = \"img\": the image-loader route", r, (r) => [loaderRoute(r), show({ images: r.images, blobURLs: r.blobURLs, calls: r.calls })]);
  chk("P2 control: Firefox tell with flags.decode = \"blob\": the blob route", c, (c) => [blobRoute(c) && show(c.calls[0].opts) === show(OPTS), show({ images: c.images, blobURLs: c.blobURLs, calls: c.calls })]);
  chk("P2 control: ... and no console line", c, (c) => [c.said === 0, `${c.said} line(s)`]);
}
{
  const r = call("p3"), c = call("p3control");
  const want = ["resizeHeight", "resizeQuality", "resizeWidth"];
  chk("P3 the wrap's options are exactly the three resize keys (and no others)", r, (r) => [loaderRoute(r) && show(r.calls[0].keys) === show(want), show(r.calls)]);
  chk("P3 ... with the values the caller gave", r, (r) => [r.calls[0] && r.calls[0].opts.resizeWidth === 1024 && r.calls[0].opts.resizeHeight === 512 && r.calls[0].opts.resizeQuality === "high", show(r.calls)]);
  chk("P3 control: the blob route passes all five keys through unchanged", c, (c) => [blobRoute(c) && show(c.calls[0].keys) === show([...want, "colorSpaceConversion", "premultiplyAlpha"].sort()), show(c.calls)]);
}
{
  const r = call("p4"), c = call("p4control");
  chk("P4 a failed decode still resolves to a bitmap", r, (r) => [r.state === "resolved" && r.resolvedIsBitmap, `state ${r.state}${r.rejection ? `; ${r.rejection}` : ""}`]);
  chk("P4 ... createImageBitmap was called once, with the blob, with OPTS", r, (r) => [r.calls.length === 1 && r.calls[0].kind === "blob" && show(r.calls[0].opts) === show(OPTS), show(r.calls)]);
  chk("P4 ... and the blob: URL is revoked", r, (r) => [r.blobURLs >= 1 && r.revoked, `made ${r.blobURLs}, all revoked ${r.revoked}`]);
  chk("P4 control: a load: createImageBitmap called once, with the Image", c, (c) => [c.state === "resolved" && c.calls.length >= 1 && c.calls[0].kind === "image" && !c.calls.some((x) => x.kind === "blob"), show(c.calls)]);
}
{
  const r = call("p5"), c = call("p5control");
  chk("P5 a failed wrap falls back: the promise resolves to the blob call's answer", r, (r) => [r.state === "resolved" && r.resolvedToBlobAnswer && r.calls.some((x) => x.kind === "blob"), `state ${r.state}; calls ${show(r.calls)}${r.rejection ? `; ${r.rejection}` : ""}`]);
  chk("P5 ... the wrap was tried first, with the Image", r, (r) => [r.calls.length >= 1 && r.calls[0].kind === "image", show(r.calls)]);
  chk("P5 ... and the blob: URL is revoked", r, (r) => [r.blobURLs >= 1 && r.revoked, `made ${r.blobURLs}, all revoked ${r.revoked}`]);
  chk("P5 control: a wrap that answers: no blob call", c, (c) => [c.state === "resolved" && c.calls.length >= 1 && c.calls[0].kind === "image" && !c.calls.some((x) => x.kind === "blob"), show(c.calls)]);
}
{
  const r = call("p6"), c = call("p1");
  chk("P6 a failed download is a failure: fetchBitmap rejects", r, (r) => [r.state === "rejected", `state ${r.state}`]);
  chk("P6 ... no Image, no blob: URL, no createImageBitmap call", r, (r) => [r.images === 0 && r.blobURLs === 0 && r.calls.length === 0, show({ images: r.images, blobURLs: r.blobURLs, calls: r.calls })]);
  chk("P6 control (P1): the same page with a fetch that answers resolves", c, (c) => [c.state === "resolved" && c.resolvedToLast, `state ${c.state}`]);
}
{
  const r = call("p9"), c = call("p9control");
  chk("P9 premultiplyAlpha \"none\" asked: the first createImageBitmap call is the Image, with exactly the resize key", r, (r) => [loaderRoute(r) && r.firstIsImage && show(r.firstOpts) === show({ resizeWidth: 1024 }), show(r.calls)]);
  chk("P9 ... a second call exists whose source is the bitmap the first call returned, with exactly { premultiplyAlpha: \"none\" }", r, (r) => [r.calls.length === 2 && r.secondFromFirstAnswer && show(r.secondOpts) === show({ premultiplyAlpha: "none" }), `${r.calls.length} call(s): ${show(r.calls)}; second's source is the first's bitmap: ${r.secondFromFirstAnswer}`]);
  chk("P9 ... the first bitmap was closed", r, (r) => [r.firstClosed >= 1, `the first bitmap's close() was called ${r.firstClosed} time(s)`]);
  chk("P9 ... the promise resolves to the second call's bitmap (which is left open)", r, (r) => [r.state === "resolved" && r.resolvedToSecond && r.secondClosed === 0, `state ${r.state}; resolved to the second call's bitmap: ${r.resolvedToSecond}; second closed ${r.secondClosed}${r.rejection ? `; ${r.rejection}` : ""}`]);
  chk("P9 control: without premultiplyAlpha one createImageBitmap call (the Image, resize key only), no second wrap", c, (c) => [loaderRoute(c) && c.calls.length === 1 && show(c.firstOpts) === show({ resizeWidth: 1024 }), show(c.calls)]);
  chk("P9 control: ... it resolves to that call's bitmap and closes nothing", c, (c) => [c.state === "resolved" && c.resolvedToFirst && c.firstClosed === 0, `state ${c.state}; resolved to the only bitmap: ${c.resolvedToFirst}; closed ${c.firstClosed}`]);
}
{
  const r = call("p7"), j = call("p7reject"), e = call("p7error");
  chk("P7 the Earth's picture: `load` has fired but the decode has not settled: `loaded` is not called", r, (r) => [r.afterLoad.loaded === 0, show(r.afterLoad)]);
  chk("P7 ... done() is true from `load`", r, (r) => [r.afterLoad.done === true, show(r.afterLoad)]);
  chk("P7 ... once the decode resolves, `loaded` is called once, with the image", r, (r) => [r.afterDecode.loaded === 1 && r.later.loaded === 1 && r.carriesImage, show({ afterDecode: r.afterDecode, later: r.later, carriesImage: r.carriesImage })]);
  chk("P7 control: a decode that rejects after `load` still calls `loaded` once (drawn as it can)", j, (j) => [j.afterLoad.loaded === 0 && j.afterDecode.loaded === 1 && j.later.loaded === 1, show({ afterLoad: j.afterLoad, afterDecode: j.afterDecode, later: j.later })]);
  chk("P7 control: an `error` never calls `loaded`", e, (e) => [e.afterError.loaded === 0, show(e.afterError)]);
}
finish();
