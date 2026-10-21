/*
 * Test for #76 (the dawn lets go of its decoded pictures), written from the specification alone. Since #32 the dawn
 * decodes its pictures ahead of the light and holds them (dawn.held, README "The dawn"): the glows (glow-sway1,
 * glow-sway2, glow-zod and the sun glow, glow-sunpt), the Earth's two (dawn-pre, dawn) and the sun it paints itself (a
 * blob: picture). #76 (owner: "We should be efficient with memory and not have leaks"):
 *
 *   L1  before the reveal's first draw they stay held (#32's purpose): after start() and "ready" with no light, however
 *       long, and still when onLit is called (body.lit set, nothing drawn yet). Passes already; the pair to L2.
 *   L2  once the reveal has drawn them, the dawn holds none of them: dawn.held holds no picture, and every picture the
 *       dawn decoded can be collected by the garbage collector.
 *   L3  the painted sun does not replace the sun glow (both are drawn, side by side in one layer), so before the light
 *       the sun glow is held with the rest: nothing is let go early.
 *   L4  destroy() lets go of everything (existing behaviour): dawn.held is [] and every decoded picture can be collected;
 *       and destroy() after the drawn-in point throws nothing.
 *
 * "Held" is read two ways: dawn.held (the interface: a list of { ready, held }, `held` the pictures), and whether a
 * picture can be collected at all (a WeakRef to each picture the dawn called decode() on, read after a forced
 * collection, `node --expose-gc`). Neither reads the door's code or a private hook.
 *
 * Assumed (the interface does not say when the drawn-in point is): it comes within DRAWN_WITHIN ms of virtual time
 * after onLit, on the page's frames and timers alone (the stub fires no transitionend or animationend). Virtual time:
 * nothing here depends on how fast the runner draws.
 *
 *   node tools/ci/dawn-let-go-test.mjs
 *
 * No dependencies and no browser. Each case runs in a fresh Node process (this file again, as `--child`, with
 * --expose-gc) on the stub page in door-stub.mjs, the dawn mounted on a host shaped like the markup's world (its glow
 * layers as index.html writes them) and reached through assets/door/index.js alone, as a host does.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dawnHost, INDEX, any, installPage, installClock, realSetTimeout, childMain, check, finish, errOf } from "./door-stub.mjs";

const READY_WITHIN = 30000;
const KEPT_FOR = 30000;
const DRAWN_WITHIN = 10000;
const SUN_GLOW = /glow-sunpt\.webp$/;
const PAINTED = /^(blob|data):/;
/* the pictures #32 holds until the reveal: everything decoded */
const KEPT = [/glow-sway1\.webp$/, /glow-sway2\.webp$/, /glow-zod\.webp$/, SUN_GLOW, /dawn-pre\.webp$/, /\/dawn\.webp$/, PAINTED];
const KEPT_NAMES = ["glow-sway1", "glow-sway2", "glow-zod", "glow-sunpt", "dawn-pre", "dawn", "the painted sun"];

/* a glow layer as the markup writes it: an SVG <image data-raster=name href=...>, its href readable and settable */
function layer(name, href) {
  const attrs = { "data-raster": name };
  if (href) attrs.href = href;
  const base = {
    name, dataset: { raster: name }, attrs,
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => "" },
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    getAttribute: (k) => (k === "xlink:href" ? attrs.href ?? null : k in attrs ? attrs[k] : null),
    hasAttribute: (k) => k in attrs,
    setAttribute: (k, v) => { attrs[k === "xlink:href" ? "href" : k] = String(v); },
    setAttributeNS: (ns, k, v) => { attrs[/href$/.test(k) ? "href" : k] = String(v); },
    removeAttribute: (k) => { delete attrs[k === "xlink:href" ? "href" : k]; },
    addEventListener() {}, removeEventListener() {},
  };
  return new Proxy(base, {
    get: (t, k) => (k in t ? t[k] : k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : any()),
    set: (t, k, v) => { if (k === "href") attrs.href = String(v); else t[k] = v; return true; },
  });
}

/* the page, the clock, the dawn on a markup-shaped host, and a weak record of every picture the dawn decodes */
async function setup() {
  const page = installPage();
  const clock = installClock();
  page.images = { push() {} };                       /* the stub keeps no picture alive itself */
  const decoded = [];
  const decode = page.StubImage.prototype.decode;
  page.StubImage.prototype.decode = function () {
    decoded.push({ src: String(this.src), lit: page.bodyClasses.has("lit"), ref: new WeakRef(this) });
    return decode.call(this);
  };
  const L = {
    sway1: layer("sway1", "img/dawn/glow-sway1.webp"), sway2: layer("sway2", "img/dawn/glow-sway2.webp"),
    zod: layer("zod", "img/dawn/glow-zod.webp"), sun: layer("sun", null), sunpt: layer("sunpt", "img/dawn/glow-sunpt.webp"),
  };
  const { host, world } = dawnHost((el) => { realSetTimeout(() => el.fire("load"), 0); });
  const all = world.querySelectorAll, one = world.querySelector;
  const layers = () => Object.values(L);
  world.querySelectorAll = (sel) => {
    const m = /data-raster="(\w+)"/.exec(sel);
    if (m) return L[m[1]] ? [L[m[1]]] : [];
    if (/^image\[(xlink:)?href\]$/.test(sel)) return layers().filter((l) => l.hasAttribute("href"));
    if (/^image\[data-raster\]$/.test(sel)) return layers();
    return all(sel);
  };
  world.querySelector = (sel) => {
    const m = /data-raster="(\w+)"/.exec(sel);
    if (m) return L[m[1]] || null;
    return one(sel);
  };
  const errors = [];
  process.on("unhandledRejection", (e) => errors.push(String(e && e.message || e)));
  const door = await import(INDEX);
  const d = door.createDoor({ typingWait: 0, flags: {} });
  const dawn = d.dawn(host);
  door.openChores();
  /* what dawn.held holds now: the pictures' addresses */
  const heldNow = () => (dawn.held || []).flatMap((h) => (h && h.held) || []).map((i) => String(i && i.src));
  /* which decoded pictures survive a forced collection (taken in a fresh task, so no WeakRef is pinned by this one) */
  const survivors = async () => {
    const tick = () => new Promise((r) => realSetTimeout(r, 0));
    await tick(); globalThis.gc(); await tick(); globalThis.gc(); await tick();
    return decoded.filter((x) => x.ref.deref() !== undefined).map((x) => x.src);
  };
  return { page, clock, dawn, world, L, decoded, heldNow, survivors, errors };
}

const keptMissing = (srcs) => KEPT.map((re, i) => (srcs.some((s) => re.test(s)) ? null : KEPT_NAMES[i])).filter(Boolean);
const brief = (list) => JSON.stringify(list.map((s) => (s.length > 40 ? `${s.slice(0, 40)}...` : s)));

const CASES = {
  /* L1: start(), "ready", then no light for KEPT_FOR ms */
  async kept() {
    const s = await setup();
    s.dawn.start();
    await s.clock.advance(READY_WITHIN, () => s.world.dataset.rasterised === "ready");
    const ready = s.world.dataset.rasterised;
    await s.clock.advance(KEPT_FOR);
    const held = s.heldNow();
    const alive = await s.survivors();
    return { ready, held, alive, decoded: s.decoded.map((x) => x.src), errors: s.errors };
  },
  /* L3: start() until "ready": the painted sun is on its layer; the sun glow, before any light */
  async sun() {
    const s = await setup();
    s.dawn.start();
    await s.clock.advance(READY_WITHIN, () => s.world.dataset.rasterised === "ready");
    const ready = s.world.dataset.rasterised;
    await s.clock.advance(100);
    const sunHref = s.L.sun.getAttribute("href");
    const held = s.heldNow();
    const alive = await s.survivors();
    return { ready, sunHref, held, alive, decoded: s.decoded.map((x) => x.src), lit: s.page.bodyClasses.has("lit"), errors: s.errors };
  },
  /* L1 at onLit, L2 after the drawn-in point, L4 destroy() after it: start() and light() as a host calls them */
  async drawn() {
    const s = await setup();
    let atLit = null, litAt = null, thrown = null;
    s.dawn.start();
    const t0 = s.clock.now();
    s.dawn.light({ firstVisit: false, aside: true, after: () => undefined, onLit: () => { litAt ??= s.clock.now() - t0; atLit ??= s.heldNow(); } });
    await s.clock.advance(READY_WITHIN, () => litAt !== null);
    await s.clock.advance(DRAWN_WITHIN);
    const held = s.heldNow();
    const alive = await s.survivors();
    let afterDestroy = null;
    try { s.dawn.destroy(); afterDestroy = s.heldNow().length; } catch (e) { thrown = String(e && e.message || e); }
    await s.clock.advance(1000);
    return { litAt, atLit, held, alive, afterDestroy, thrown, decoded: s.decoded.map((x) => ({ src: x.src, lit: x.lit })), errors: s.errors };
  },
  /* L4: destroy() once "ready", before any light */
  async destroy() {
    const s = await setup();
    s.dawn.start();
    await s.clock.advance(READY_WITHIN, () => s.world.dataset.rasterised === "ready");
    const ready = s.world.dataset.rasterised;
    const before = s.heldNow().length;
    s.dawn.destroy();
    await s.clock.advance(1000);
    const heldLength = (s.dawn.held || []).length;
    const alive = await s.survivors();
    return { ready, before, heldLength, alive, decoded: s.decoded.map((x) => x.src), errors: s.errors };
  },
};

if (process.argv[2] === "--child") await childMain(CASES);

/* the parent: each case in a fresh process, with the collector exposed */
const run = (how) => {
  const r = spawnSync(process.execPath, ["--expose-gc", fileURLToPath(import.meta.url), "--child", how], { encoding: "utf8", timeout: 90000 });
  const line = (r.stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) return { error: `the child printed no result (exit ${r.status}): ${(r.stderr || "").split("\n").slice(0, 3).join(" | ")}` };
  return JSON.parse(line.slice(7));
};
const errs = (r) => `${errOf(r)}${r.errors && r.errors.length ? `; uncaught: ${r.errors.join(" | ")}` : ""}`;

{
  const r = run("kept");
  const ok = !r.error && r.ready === "ready";
  check("L1 (precondition): start() reaches \"ready\" and decodes the glows, the Earth and the painted sun",
    ok && keptMissing(r.decoded).length === 0, `rasterised ${JSON.stringify(r.ready)}; decoded ${brief(r.decoded || [])}${errs(r)}`);
  check(`L1: with no light, ${KEPT_FOR} ms after "ready", dawn.held still holds each of them`,
    ok && keptMissing(r.held).length === 0, `missing ${JSON.stringify(keptMissing(r.held || []))}; held ${brief(r.held || [])}${errs(r)}`);
  check("L1: ... and none of them can be collected",
    ok && keptMissing(r.alive).length === 0, `collected ${JSON.stringify(keptMissing(r.alive || []))}; alive ${brief(r.alive || [])}${errs(r)}`);
}
{
  const r = run("sun");
  const ok = !r.error && r.ready === "ready";
  check("L3 (precondition): at \"ready\" the painted sun is on its layer, the sun glow was decoded, and the door is not lit",
    ok && PAINTED.test(r.sunHref || "") && (r.decoded || []).some((s) => SUN_GLOW.test(s)) && !r.lit,
    `sun layer href ${JSON.stringify(r.sunHref)}; sun glow decoded ${(r.decoded || []).some((s) => SUN_GLOW.test(s))}; lit ${r.lit}${errs(r)}`);
  check("L3: the painted sun, the sun glow beside it and the other pictures are all still held before the light",
    ok && keptMissing(r.held || []).length === 0, `missing ${JSON.stringify(keptMissing(r.held || []))}${errs(r)}`);
}
{
  const r = run("drawn");
  const ok = !r.error && r.litAt !== null;
  check("L1 (at onLit): when onLit is called, before the reveal draws, dawn.held still holds each of them",
    ok && keptMissing(r.atLit || []).length === 0, `onLit after ${r.litAt} ms; missing ${JSON.stringify(keptMissing(r.atLit || []))}; held ${brief(r.atLit || [])}${errs(r)}`);
  check(`L2: ${DRAWN_WITHIN} ms after onLit (the reveal has drawn them), dawn.held holds no picture`,
    ok && (r.held || []).length === 0, `held ${brief(r.held || [])}${errs(r)}`);
  check("L2: ... and every picture the dawn decoded can be collected",
    ok && (r.alive || []).length === 0, `still alive ${brief(r.alive || [])} of ${(r.decoded || []).length} decoded${errs(r)}`);
  check("L4: destroy() after the drawn-in point throws nothing and leaves dawn.held empty",
    ok && !r.thrown && r.afterDestroy === 0 && (r.errors || []).length === 0, `thrown ${JSON.stringify(r.thrown)}; held after ${r.afterDestroy}${errs(r)}`);
}
{
  const r = run("destroy");
  const ok = !r.error && r.ready === "ready";
  check("L4 (control): destroy() once \"ready\" leaves dawn.held [] (it held some before)",
    ok && r.before > 0 && r.heldLength === 0, `held before ${r.before}, dawn.held.length after ${r.heldLength}${errs(r)}`);
  check("L4 (control): ... and every picture the dawn decoded can be collected",
    ok && (r.alive || []).length === 0, `still alive ${brief(r.alive || [])} of ${(r.decoded || []).length} decoded${errs(r)}`);
}
finish();
