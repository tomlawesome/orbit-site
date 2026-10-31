/*
 * Tests for #113 (ADR-0004 6e, tests W5 and W6), the flight's page side, written from the specification alone: the
 * `hello` that carries the page's verdict on where the pictures are decoded, and the `decode` the worker asks for.
 * Through assets/door/index.js alone on the stub page (door-stub.mjs), the worker a fake class given as `drawWorker`
 * that records what it is posted (posted, transfers, late) and says what a case tells it to; the stub's page reads as
 * Firefox to the family tell (the world's cases are in world-wire-test.mjs).
 *
 *   node tools/ci/decode-wire-test.mjs
 *
 *   hello    the first message posted is `hello` with decode "page" on the Firefox page; under flags.decode = "blob"
 *            "here". Control: the Chromium tell (userAgentData) with flags.draw = "worker": "here"
 *   decode   the worker says `decode { id: 7, blob, options: OPTS }`: the page posts exactly one `decoded` with id 7
 *            and a `bitmap`, which is in the `transfers` of that very post, by its own route (on the Firefox page: an
 *            Image was made, createImageBitmap of it). The worker then says `dead` and `decode { id: 8 }` (delivered
 *            by hand, a terminated fake says nothing): no `decoded` for 8 is posted. Control: a `decode` whose blob is
 *            missing is answered with `decoded { id, error }` and no bitmap
 *
 * One fresh Node process a case, on the virtual clock (the stub's images fire on the real one, so a case also sleeps).
 */
import { bootWorkerPage, sleep, childMain, runCase, chk, finish } from "./door-stub.mjs";

const OPTS = { colorSpaceConversion: "none", premultiplyAlpha: "none" };

async function boot(extra = {}) {
  const b = await bootWorkerPage({ draw: "worker", ...extra });
  b.journey.warm({ prove: false }).catch(() => {});
  await b.clock.advance(50);
  b.w = b.host.first();
  return b;
}
const pump = async (b, n = 80) => { for (let i = 0; i < n; i++) { await b.clock.advance(0); await sleep(2); } };
/* a message the page may still hear from a worker that has been let go (the fake says nothing once terminated) */
function deliver(w, data) {
  const ev = { type: "message", data, target: w };
  if (typeof w.onmessage === "function") w.onmessage(ev);
  for (const f of [...w.on.message]) f(ev);
}
/* createImageBitmap logging what it is given, answering a tagged bitmap each time */
function watch(b) {
  const log = [];
  globalThis.createImageBitmap = async (src, ...r) => {
    const bmp = { width: 64, height: 64, close() {}, n: log.length };
    log.push({ kind: src instanceof b.page.StubImage ? "image" : "other", bmp });
    return bmp;
  };
  return log;
}

const CASES = {
  async hello() { const b = await boot(); return hello(b); },
  async helloBlob() { const b = await boot({ flags: { decode: "blob" } }); return hello(b); },
  async helloChromium() { const b = await boot({ userAgentData: true }); return hello(b); },
  async decode() {
    const b = await boot();
    const w = b.w;
    if (!w) return { none: "no worker was made (drawWorker never called)" };
    const log = watch(b);
    const imagesBefore = b.page.images.length;
    const blob = { size: 4096, type: "image/webp" };
    w.say({ type: "decode", id: 7, blob, options: OPTS });
    await pump(b);
    const got = w.of("decoded").filter((m) => m.id === 7);
    const at = got.length ? w.posted.indexOf(got[0]) : -1;
    const out = {
      answers: got.length, hasBitmap: !!got[0] && !!got[0].bitmap, errorSaid: !!got[0] && got[0].error !== undefined,
      transferred: at >= 0 && (w.transfers[at] || []).includes(got[0].bitmap), bitmapIsTheRoute: !!got[0] && log.some((l) => l.bmp === got[0].bitmap),
      images: b.page.images.length - imagesBefore, kinds: log.map((l) => l.kind), cloneErrors: w.cloneErrors,
    };
    w.say({ type: "dead", why: "the world threw outside a frame" });
    await pump(b, 20);
    deliver(w, { type: "decode", id: 8, blob, options: OPTS });
    await pump(b);
    out.after = { decoded8: w.of("decoded").filter((m) => m.id === 8).length, terminated: w.terminated };
    return out;
  },
  async decodeNoBlob() {
    const b = await boot();
    const w = b.w;
    if (!w) return { none: "no worker was made (drawWorker never called)" };
    watch(b);
    w.say({ type: "decode", id: 9, options: OPTS });
    await pump(b);
    const got = w.of("decoded").filter((m) => m.id === 9);
    return { answers: got.length, hasBitmap: !!got[0] && got[0].bitmap !== undefined && got[0].bitmap !== null, errorSaid: !!got[0] && !!got[0].error };
  },
};
function hello(b) {
  const w = b.w;
  if (!w) return { none: "no worker was made (drawWorker never called)" };
  return { first: w.posted[0] && w.posted[0].type, decode: w.posted[0] ? w.posted[0].decode : undefined, hellos: w.of("hello").length };
}

if (process.argv[2] === "--child") await childMain(CASES);

const show = (x) => JSON.stringify(x);
const call = (n) => runCase(import.meta.url, n);

{
  const r = call("hello"), c = call("helloBlob"), x = call("helloChromium");
  chk("W5 the Firefox page: the first message is `hello`, with decode \"page\"", r, (r) => [r.first === "hello" && r.decode === "page", `first ${r.first}, decode ${show(r.decode)}`]);
  chk("W5 under flags.decode = \"blob\": decode \"here\"", c, (c) => [c.first === "hello" && c.decode === "here", `first ${c.first}, decode ${show(c.decode)}`]);
  chk("W5 control: the Chromium tell with flags.draw = \"worker\": decode \"here\"", x, (x) => [x.first === "hello" && x.decode === "here", `first ${x.first}, decode ${show(x.decode)}`]);
}
{
  const r = call("decode"), c = call("decodeNoBlob");
  chk("W6 a `decode { id: 7, blob, options }` is answered by exactly one `decoded` with id 7 and a bitmap", r, (r) => [r.answers === 1 && r.hasBitmap && !r.errorSaid, `answers ${r.answers}, bitmap ${r.hasBitmap}, error ${r.errorSaid}`]);
  chk("W6 ... the bitmap is in the transfer list of that post", r, (r) => [r.transferred, `transferred ${r.transferred}`]);
  chk("W6 ... the page's own route was used (an Image made, createImageBitmap of it; the bitmap is what it returned)", r, (r) => [r.images >= 1 && r.kinds.includes("image") && r.bitmapIsTheRoute, `images ${r.images}, createImageBitmap sources ${show(r.kinds)}, the bitmap is its answer ${r.bitmapIsTheRoute}`]);
  chk("W6 ... after `dead` (the page has fallen back) a `decode { id: 8 }` is answered by no `decoded`", r, (r) => [r.after.decoded8 === 0, `decoded for 8: ${r.after.decoded8} (worker terminated ${r.after.terminated} time(s))`]);
  chk("W6 control: a `decode` whose blob is missing is answered with `decoded { id, error }` and no bitmap", c, (c) => [c.answers === 1 && c.errorSaid && !c.hasBitmap, `answers ${c.answers}, error ${c.errorSaid}, bitmap ${c.hasBitmap}`]);
}
finish();
