/*
 * Live test for #25 (the goodbye as the sign-in) and #26 (households on the way down, the live half), written from
 * docs/adr/0003 alone: its "Behaviours" 7-14 and 19, and owner decision 11a (the Earth photo on the goodbye).
 * tests/asdawn.html is a page built through assets/door/index.js and door.css alone (no site.css): the dawn, and the
 * dusk with `asDawn: true` or without the option, `html.rich` set, #dusk unhidden, the beats set by hand on <body>.
 *
 * With the option, after the farewell beat (body.showdusk.farewell), at 1280x800: the dusk's ring is the dawn's
 * (centre and width within 1px, --R 368px, ring 265px across) and its gate is where the dawn's is; the farewell
 * hangs 22px under the way back in, on the ring's axis; the planet waits for the beat (opacity 0 under showdusk,
 * 1 within 1s of farewell, 1 with neither class); the farewell fades in within 1.5s; html.rich lights the ring, the
 * discs and the name, and without it they are plain. At 390x844 (--R 265.2px) the name is hidden, the farewell is
 * inside the ring (the said), 26px under it (the sub), the gate 24px under the sub, and nothing overflows sideways.
 * Reduced motion turns the planet's and its spin's animations off and changes none of that. The Earth photo (11a):
 * a dusk page without a dawn asks for dawn.webp and dawn-pre.webp, and shows one; without the option it asks for
 * neither; a dusk remounted on the same markup after destroy() (the photos still loading) shows one too, and its
 * world reads "pending" the moment start() returns. #26: journey.descend({ homes, at: 5400 }) still fires released, surface, farewell and sets
 * showdusk/farewell, 30 homes without a throw.
 *
 * Owner decision 3c (#25): the door's phone layout is used under 600px wide OR under 480px tall; 580x800, 844x390,
 * 599x800 and 800x479 must give it, 1280x560, 1280x800, 600x800 and 800x480 the desktop one (layoutSigns says how it
 * is told: the padding under the lockup, the hidden name, the farewell's place).
 *
 * Without the option the same page is measured too, as controls: the glyph is 420px, the gate sits inside the ring,
 * the farewell's bottom is 240px below the viewport's middle (desktop), the ring and name keep their plain colours
 * whatever html.rich says. The phone control's numbers were taken from the code before the option (8e1bd13).
 *
 *   PLAYWRIGHT_ROOT=<playwright package dir> HEADED=1 LIBGL_ALWAYS_SOFTWARE=1 \
 *     xvfb-run -a -s "-screen 0 1280x800x24" node tools/ci/asdawn-test.mjs
 *
 * (sh tools/ci/journey-local.sh asdawn does exactly that.) BROWSER=chromium for a second engine; ASDAWN_PORT to
 * pick the port (else a free one). The whole run takes a minute or so: the beats and their transitions are waited
 * for in real time.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const playwright = createRequire(import.meta.url)(process.env.PLAYWRIGHT_ROOT || "playwright");
const BROWSER = process.env.BROWSER || "firefox";
const here = dirname(fileURLToPath(import.meta.url));

const freePort = () => new Promise((ok, no) => {
  const s = createServer();
  s.once("error", no);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); });
});
const PORT = Number(process.env.ASDAWN_PORT) || await freePort();
const SITE = `http://127.0.0.1:${PORT}/`;

/* the transitions settle (the gate's takes .9s after .6s) before geometry is read */
const SETTLE = 2600;
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const EARTH = /\/assets\/door\/img\/dawn\/dawn(-pre)?\.webp(\?|$)/;

const server = spawn(process.execPath, [join(here, "serve.mjs"), String(PORT)], { stdio: ["ignore", "ignore", "inherit"] });
let failed = false;
let browser = null;

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const near = (a, b, tol) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol;
const f = (n) => (typeof n === "number" ? Math.round(n * 100) / 100 : n);

/* ---- what the page is asked, run inside it ---- */
const MEASURE = () => {
  const box = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height, cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
  };
  /* a transition or an animation on the gate would hold the old transform for the sample, so both are set aside too */
  const settled = (el) => {
    if (!el) return null;
    const was = [el.style.transform, el.style.transition, el.style.animation];
    el.style.transition = "none"; el.style.animation = "none"; el.style.transform = "none";
    const r = box(el);
    [el.style.transform, el.style.transition, el.style.animation] = was;
    return r;
  };
  const ringOf = (root) => root && (root.querySelector(".glyph .ring:not(.lux)") || root.querySelector('.glyph circle[r="72"]'));
  const dusk = document.querySelector("#dusk"), dawn = document.querySelector("#door");
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const ring = ringOf(dusk), name = dusk.querySelector(".lockup .name"), tr = dusk.querySelector(".glyph .tr");
  const world = dusk.querySelector(".glyph image.world");
  const fw = dusk.querySelector(".farewell");
  return {
    vw: innerWidth, vh: innerHeight,
    scrollW: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    /* the dawn's gate as it stands once lit: until body.lit.ready-flight it rests translateY(10px) low, and this page
       never lights the dawn, so its transform is set aside while it is measured (the row, not the entrance) */
    dawnSvg: box(dawn && dawn.querySelector(".glyph svg")), dawnRing: box(ringOf(dawn)), dawnGate: settled(dawn && dawn.querySelector(".gate")),
    duskSvg: box(dusk.querySelector(".glyph svg")), duskRing: box(ring), duskGate: box(dusk.querySelector(".gate")),
    wrap: box(dusk.querySelector(".gate-wrap")), fw: box(fw), said: box(dusk.querySelector(".farewell .said")), sub: box(dusk.querySelector(".farewell .sub")),
    name: box(name),
    nameVisibility: cs(name) && cs(name).visibility, nameColor: cs(name) && cs(name).color,
    ringStroke: cs(ring) && cs(ring).stroke, ringWidth: cs(ring) && parseFloat(cs(ring).strokeWidth),
    lux: [...dusk.querySelectorAll(".lux")].map((e) => cs(e).display),
    trOpacity: tr && parseFloat(cs(tr).opacity), fwOpacity: fw && parseFloat(cs(fw).opacity),
    trAnim: tr && cs(tr).animationName, worldAnim: world && cs(world).animationName, hasWorld: !!world,
    hasDawn: !!dawn,
    dawnPad: dawn && parseFloat(cs(dawn.querySelector(".loginchrome")).paddingBottom), duskPad: parseFloat(cs(dusk.querySelector(".loginchrome")).paddingBottom),
  };
};
/* adds the farewell beat and says, in ms, when the planet and the farewell first read opaque (null: not within `limit`) */
const FAREWELL_BEAT = (limit) => new Promise((ok) => {
  document.body.classList.add("farewell");
  const t0 = performance.now(), got = { tr: null, fw: null };
  const tick = () => {
    const at = Math.round(performance.now() - t0);
    const tr = document.querySelector("#dusk .glyph .tr"), fw = document.querySelector("#dusk .farewell");
    if (got.tr === null && tr && parseFloat(getComputedStyle(tr).opacity) >= 0.99) got.tr = at;
    if (got.fw === null && fw && parseFloat(getComputedStyle(fw).opacity) >= 0.99) got.fw = at;
    if ((got.tr !== null && got.fw !== null) || at > limit) ok(got); else setTimeout(tick, 20);
  };
  tick();
});

/* ---- a scenario collects what is wrong ---- */
function scenario(name) {
  const problems = [];
  return {
    problems,
    want(what, ok, detail = "") { if (!ok) problems.push(`want: ${what}${detail ? " -- " + detail : ""}`); },
    done() {
      console.log(`${problems.length ? "FAIL" : "ok  "} ${name}`);
      for (const p of problems) console.log(`       ${p}`);
      if (problems.length) failed = true;
    },
  };
}

async function withPage(ctx, query, s, fn) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => s.problems.push(`pageerror: ${e.message}`));
  try {
    await page.goto(`${SITE}tests/asdawn.html?${query}`, { waitUntil: "load" });
    await page.waitForFunction(() => window.asdawnReady, null, { timeout: 30000 });
    await fn(page);
  } catch (e) { s.problems.push(`${e.message.split("\n")[0]}`); } finally { await page.close().catch(() => {}); }
}

/* the colours computed styles give, as the plain look has them */
const RING_PLAIN = "rgb(135, 145, 179)";   /* #8791b3 */
const NAME_PLAIN = "rgb(233, 237, 248)";    /* #e9edf8 */
const transparent = (c) => /^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$|^transparent$/.test(c || "");

/* 9. the look that follows html.rich, with the option */
function lookAsDawn(s, m, rich, tag) {
  if (rich) {
    s.want(`${tag}rich: every .lux is displayed (the discs' group and the two lit rings, at least)`, m.lux.length >= 3 && m.lux.every((d) => d !== "none"), JSON.stringify(m.lux));
    s.want(`${tag}rich: the plain ring is stroked url(#d-ringlit), 1.6 wide`, /d-ringlit/.test(m.ringStroke || "") && near(m.ringWidth, 1.6, 0.01), `stroke ${m.ringStroke}, width ${m.ringWidth}`);
    s.want(`${tag}rich: the name is gradient text (colour transparent)`, transparent(m.nameColor), `colour ${m.nameColor}`);
  } else {
    s.want(`${tag}plain: every .lux is display:none (the discs' group and the two lit rings, at least)`, m.lux.length >= 3 && m.lux.every((d) => d === "none"), JSON.stringify(m.lux));
    s.want(`${tag}plain: the ring is #8791b3, 2 wide`, m.ringStroke === RING_PLAIN && near(m.ringWidth, 2, 0.01), `stroke ${m.ringStroke}, width ${m.ringWidth}`);
    s.want(`${tag}plain: the name is #e9edf8`, m.nameColor === NAME_PLAIN, `colour ${m.nameColor}`);
  }
}

/* 7, 8: the desktop layout, with the option */
function desktopAsDawn(s, m) {
  s.want("the dawn is on the page to compare with", m.hasDawn && !!m.dawnRing && !!m.dawnGate, "no dawn ring or gate");
  s.want("--R is 368px: the glyph is 368 wide", near(m.duskSvg?.w, 368, 0.6), `glyph ${f(m.duskSvg?.w)} wide`);
  /* a circle's box in the browser includes its stroke (about 3px at this size), so "265px across" is 265 to 269 here */
  s.want("the ring is 265px across (its box 265 to 269 with the stroke)", m.duskRing?.w >= 264.5 && m.duskRing?.w <= 269, `ring box ${f(m.duskRing?.w)} across`);
  s.want("the ring is the dawn's ring: centre within 1px", near(m.duskRing?.cx, m.dawnRing?.cx, 1) && near(m.duskRing?.cy, m.dawnRing?.cy, 1), `dusk (${f(m.duskRing?.cx)}, ${f(m.duskRing?.cy)}), dawn (${f(m.dawnRing?.cx)}, ${f(m.dawnRing?.cy)})`);
  s.want("the ring is the dawn's ring: width within 1px", near(m.duskRing?.w, m.dawnRing?.w, 1), `dusk ${f(m.duskRing?.w)}, dawn ${f(m.dawnRing?.w)}`);
  s.want("the gate's top is the dawn's gate's top, within 1px (the row under the ring)", near(m.duskGate?.t, m.dawnGate?.t, 1) && m.duskGate.t > m.duskRing.b - 1, `dusk gate top ${f(m.duskGate?.t)}, dawn ${f(m.dawnGate?.t)}, ring foot ${f(m.duskRing?.b)}`);
  s.want("the farewell's top is 22px under the way back in's box", near(m.fw?.t - m.wrap?.b, 22, 1), `farewell top ${f(m.fw?.t)}, .gate-wrap bottom ${f(m.wrap?.b)}`);
  s.want("the farewell is centred on the ring's axis, within 1px", near(m.fw?.cx, m.duskRing?.cx, 1), `farewell centre ${f(m.fw?.cx)}, ring ${f(m.duskRing?.cx)}`);
  s.want("the farewell is fully on screen", m.fw && m.fw.l >= 0 && m.fw.r <= m.vw && m.fw.t >= 0 && m.fw.b <= m.vh, m.fw ? `farewell ${f(m.fw.l)}..${f(m.fw.r)} x ${f(m.fw.t)}..${f(m.fw.b)} in ${m.vw}x${m.vh}` : "no farewell");
}
/* 7, 8 without the option: today's */
function desktopControl(s, m) {
  s.want("(control) the glyph is 420 wide", near(m.duskSvg?.w, 420, 0.6), `glyph ${f(m.duskSvg?.w)} wide`);
  s.want("(control) the gate sits inside the ring", m.duskGate && m.duskRing && m.duskGate.l >= m.duskRing.l && m.duskGate.r <= m.duskRing.r && m.duskGate.t >= m.duskRing.t && m.duskGate.b <= m.duskRing.b, `gate ${f(m.duskGate?.l)}..${f(m.duskGate?.r)} x ${f(m.duskGate?.t)}..${f(m.duskGate?.b)}, ring ${f(m.duskRing?.l)}..${f(m.duskRing?.r)} x ${f(m.duskRing?.t)}..${f(m.duskRing?.b)}`);
  s.want("(control) the farewell's bottom is 240px below the viewport's middle", near(m.fw?.b, m.vh / 2 + 240, 1), `bottom ${f(m.fw?.b)}, middle + 240 = ${m.vh / 2 + 240}`);
}
/* 12: the phone layout, with the option */
function phoneAsDawn(s, m) {
  const R = 265.2;
  s.want("--R is 265.2px: the glyph is that wide", near(m.duskSvg?.w, R, 0.6), `glyph ${f(m.duskSvg?.w)} wide`);
  s.want(".name is visibility:hidden", m.nameVisibility === "hidden", `visibility ${m.nameVisibility}`);
  s.want(".said's centre is on the ring's centre, within 2px", near(m.said?.cx, m.duskRing?.cx, 2) && near(m.said?.cy, m.duskRing?.cy, 2), `said (${f(m.said?.cx)}, ${f(m.said?.cy)}), ring (${f(m.duskRing?.cx)}, ${f(m.duskRing?.cy)})`);
  s.want(".said is no wider than .6R", m.said && m.said.w <= 0.6 * R + 1, `said ${f(m.said?.w)} wide, .6R = ${f(0.6 * R)}`);
  s.want(".sub is 26px under the ring's foot, within 2px", near(m.sub?.t - m.duskRing?.b, 26, 2), `sub top ${f(m.sub?.t)}, ring foot ${f(m.duskRing?.b)}`);
  s.want(".sub is centred on the ring's axis, within 2px", near(m.sub?.cx, m.duskRing?.cx, 2), `sub centre ${f(m.sub?.cx)}, ring ${f(m.duskRing?.cx)}`);
  s.want("the gate's top is 24px under .sub's bottom, within 2px", near(m.duskGate?.t - m.sub?.b, 24, 2), `gate top ${f(m.duskGate?.t)}, sub bottom ${f(m.sub?.b)}`);
  s.want("no horizontal overflow", m.scrollW <= m.vw, `the page scrolls ${m.scrollW} wide in ${m.vw}`);
  s.want("the farewell, the sub and the gate are inside the viewport's width", [m.fw, m.sub, m.duskGate].every((b) => b && b.l >= -0.5 && b.r <= m.vw + 0.5), `fw ${f(m.fw?.l)}..${f(m.fw?.r)}, sub ${f(m.sub?.l)}..${f(m.sub?.r)}, gate ${f(m.duskGate?.l)}..${f(m.duskGate?.r)}`);
}
/* 12 without the option: today's, numbers taken from the code before the option (8e1bd13) */
function phoneControl(s, m) {
  s.want("(control) the glyph is as wide as today's", near(m.duskSvg?.w, PHONE_TODAY.glyph, 0.6), `glyph ${f(m.duskSvg?.w)} wide (today ${PHONE_TODAY.glyph})`);
  s.want("(control) .name is visible", m.nameVisibility === "visible", `visibility ${m.nameVisibility}`);
  s.want("(control) the ring is where it is today", near(m.duskRing?.cx, PHONE_TODAY.ringCx, 1) && near(m.duskRing?.cy, PHONE_TODAY.ringCy, 1) && near(m.duskRing?.w, PHONE_TODAY.ringW, 1), `ring centre (${f(m.duskRing?.cx)}, ${f(m.duskRing?.cy)}), ${f(m.duskRing?.w)} across (today (${PHONE_TODAY.ringCx}, ${PHONE_TODAY.ringCy}), ${PHONE_TODAY.ringW})`);
  s.want("(control) the farewell's bottom is where it is today", near(m.fw?.b, PHONE_TODAY.fwBottom, 1), `bottom ${f(m.fw?.b)} (today ${PHONE_TODAY.fwBottom})`);
}

/* #25, owner 3c: the door's sign-in (#door) and goodbye (#dusk) use their phone layout when the window is under 600px
   wide OR under 480px tall ((max-width: 599.98px), (max-height: 479.98px)). The signs of each layout, whatever the
   window's size (measured at 390x844 and 1280x800, and not at the sizes below, where --R is the same in both):
     dawn and asDawn dusk, phone: the .loginchrome's bottom padding is 4% of the window's height; desktop 8%;
     asDawn dusk, phone: .name is hidden, the said stands on the ring's centre, the sub 26px under the ring, the gate
       24px under the sub; desktop: .name shows, the farewell is 22px under the way back in, on the ring's axis, and
       the gate is the dawn's.
   The plain dusk has no sign that differs between the two at these sizes (its glyph is 420 wide in both, bar the
   narrowest), so it is checked as a control: unchanged. */
function layoutSigns(s, m, phone, tag) {
  const share = phone ? 0.04 : 0.08;
  s.want(`${tag}the dawn's .loginchrome has bottom padding of ${share * 100}% of the height`, near(m.dawnPad / m.vh, share, 0.003), `padding ${f(m.dawnPad)} in ${m.vh} (${f(m.dawnPad / m.vh)})`);
  s.want(`${tag}the goodbye's .loginchrome has bottom padding of ${share * 100}% of the height`, near(m.duskPad / m.vh, share, 0.003), `padding ${f(m.duskPad)} in ${m.vh} (${f(m.duskPad / m.vh)})`);
  if (phone) {
    const R = m.duskSvg?.w;
    s.want(`${tag}the goodbye's .name is visibility:hidden`, m.nameVisibility === "hidden", `visibility ${m.nameVisibility}`);
    s.want(`${tag}.said's centre is on the ring's centre, within 2px`, near(m.said?.cx, m.duskRing?.cx, 2) && near(m.said?.cy, m.duskRing?.cy, 2), `said (${f(m.said?.cx)}, ${f(m.said?.cy)}), ring (${f(m.duskRing?.cx)}, ${f(m.duskRing?.cy)})`);
    s.want(`${tag}.said is no wider than .6R`, m.said && m.said.w <= 0.6 * R + 1, `said ${f(m.said?.w)} wide, .6R = ${f(0.6 * R)}`);
    s.want(`${tag}.sub is 26px under the ring's foot, within 2px`, near(m.sub?.t - m.duskRing?.b, 26, 2), `sub top ${f(m.sub?.t)}, ring foot ${f(m.duskRing?.b)}`);
    s.want(`${tag}the gate's top is 24px under .sub's bottom, within 2px`, near(m.duskGate?.t - m.sub?.b, 24, 2), `gate top ${f(m.duskGate?.t)}, sub bottom ${f(m.sub?.b)}`);
  } else {
    s.want(`${tag}the goodbye's .name shows`, m.nameVisibility === "visible", `visibility ${m.nameVisibility}`);
    s.want(`${tag}the farewell's top is 22px under the way back in's box`, near(m.fw?.t - m.wrap?.b, 22, 1), `farewell top ${f(m.fw?.t)}, .gate-wrap bottom ${f(m.wrap?.b)}`);
    s.want(`${tag}the farewell is centred on the ring's axis, within 1px`, near(m.fw?.cx, m.duskRing?.cx, 1), `farewell centre ${f(m.fw?.cx)}, ring ${f(m.duskRing?.cx)}`);
    s.want(`${tag}the goodbye's gate is where the dawn's is, within 1px`, near(m.duskGate?.t, m.dawnGate?.t, 1), `dusk gate top ${f(m.duskGate?.t)}, dawn ${f(m.dawnGate?.t)}`);
  }
}
const PHONE_TODAY = { glyph: 327.6, ringCx: 195, ringCy: 422, ringW: 239.17, fwBottom: 662 };

try {
  await new Promise((ok, no) => {
    const t0 = Date.now();
    (async function poll() {
      try { await fetch(SITE); ok(); } catch { Date.now() - t0 > 10000 ? no(new Error("server did not start")) : setTimeout(poll, 100); }
    })();
  });
  browser = await playwright[BROWSER].launch(process.env.HEADED === "1" ? { headless: false } : {});

  for (const reduced of [false, true]) {
    const motion = reduced ? "reduced motion" : "motion on";
    const reducedMotion = reduced ? "reduce" : "no-preference";
    const desk = await browser.newContext({ viewport: DESKTOP, reducedMotion });
    const phone = await browser.newContext({ viewport: PHONE, reducedMotion });

    /* ---- desktop, with the option: the beats, the layout, the look ---- */
    {
      const s = scenario(`1280x800, asDawn, ${motion}: the beats, the layout (7, 8), the look (9), the planet (10), the farewell (11)${reduced ? ", the animations off (13)" : ""}`);
      await withPage(desk, "asdawn=1", s, async (page) => {
        await page.evaluate(() => window.beat());
        const alone = await page.evaluate(MEASURE);
        s.want("10. with neither class the planet is opacity 1 (a goodbye standing alone)", near(alone.trOpacity, 1, 0.01), `opacity ${alone.trOpacity}`);
        await page.evaluate(() => window.beat("showdusk"));
        await sleep(1000);
        const before = await page.evaluate(MEASURE);
        s.want("10. under showdusk alone the planet is opacity 0", before.trOpacity === 0, `opacity ${before.trOpacity}`);
        s.want("11. under showdusk alone the farewell is opacity 0", before.fwOpacity === 0, `opacity ${before.fwOpacity}`);
        const got = await page.evaluate(FAREWELL_BEAT, 3000);
        s.want("10. once farewell is added the planet reaches opacity 1 within 1s", got.tr !== null && got.tr <= 1000, `after ${got.tr === null ? "more than 3000" : got.tr} ms`);
        s.want("11. once farewell is added the farewell reaches opacity 1 within 1.5s", got.fw !== null && got.fw <= 1500, `after ${got.fw === null ? "more than 3000" : got.fw} ms`);
        await sleep(SETTLE);
        const m = await page.evaluate(MEASURE);
        desktopAsDawn(s, m);
        lookAsDawn(s, m, true, "9. ");
        s.want("13/build notes: the planet and its spin are animated unless motion is reduced", reduced ? m.trAnim === "none" && m.worldAnim === "none" : m.trAnim !== "none" && m.worldAnim !== "none" && m.hasWorld, `.tr animation ${m.trAnim}, .world animation ${m.worldAnim}, .world ${m.hasWorld ? "there" : "missing"}`);
        await page.evaluate(() => document.documentElement.classList.remove("rich"));
        await sleep(800);
        lookAsDawn(s, await page.evaluate(MEASURE), false, "9. ");
        await page.evaluate(() => document.documentElement.classList.add("rich"));
        await sleep(800);
        const again = await page.evaluate(MEASURE);
        desktopAsDawn(s, again);
        lookAsDawn(s, again, true, "9. (rich back) ");
      });
      s.done();
    }

    /* ---- phone, with the option ---- */
    {
      const s = scenario(`390x844, asDawn, ${motion}: the farewell inside the ring (12)${reduced ? ", the animations off (13)" : ""}, the planet and the farewell still follow the beat (10, 11)`);
      await withPage(phone, "asdawn=1", s, async (page) => {
        await page.evaluate(() => window.beat("showdusk"));
        await sleep(1000);
        const before = await page.evaluate(MEASURE);
        s.want("10. under showdusk alone the planet is opacity 0", before.trOpacity === 0, `opacity ${before.trOpacity}`);
        s.want("11. under showdusk alone the farewell is opacity 0", before.fwOpacity === 0, `opacity ${before.fwOpacity}`);
        const got = await page.evaluate(FAREWELL_BEAT, 3000);
        s.want("10. once farewell is added the planet reaches opacity 1 within 1s", got.tr !== null && got.tr <= 1000, `after ${got.tr === null ? "more than 3000" : got.tr} ms`);
        s.want("11. once farewell is added the farewell reaches opacity 1 within 1.5s", got.fw !== null && got.fw <= 1500, `after ${got.fw === null ? "more than 3000" : got.fw} ms`);
        await sleep(SETTLE);
        const m = await page.evaluate(MEASURE);
        phoneAsDawn(s, m);
        lookAsDawn(s, m, true, "9. ");
        s.want("13/build notes: the planet and its spin are animated unless motion is reduced", reduced ? m.trAnim === "none" && m.worldAnim === "none" : m.trAnim !== "none" && m.worldAnim !== "none" && m.hasWorld, `.tr animation ${m.trAnim}, .world animation ${m.worldAnim}`);
      });
      s.done();
    }

    if (!reduced) {
      /* ---- controls: without the option, today's ---- */
      {
        const s = scenario("1280x800, no option (control): today's layout and plain look, whatever html.rich says");
        await withPage(desk, "asdawn=0", s, async (page) => {
          await page.evaluate(() => window.beat("showdusk", "farewell"));
          await sleep(SETTLE);
          const m = await page.evaluate(MEASURE);
          desktopControl(s, m);
          for (const rich of [true, false]) {
            if (!rich) { await page.evaluate(() => document.documentElement.classList.remove("rich")); await sleep(800); }
            const x = await page.evaluate(MEASURE);
            s.want(`(control) rich ${rich}: no .lux, the ring #8791b3 2 wide, the name #e9edf8`, x.lux.length === 0 && x.ringStroke === RING_PLAIN && near(x.ringWidth, 2, 0.01) && x.nameColor === NAME_PLAIN, `lux ${x.lux.length}, ring ${x.ringStroke} ${x.ringWidth}, name ${x.nameColor}`);
          }
          s.want("(control) the planet is opacity 1 and a plain circle's place (no .world picture)", near(m.trOpacity, 1, 0.01) && !m.hasWorld, `opacity ${m.trOpacity}, .world picture ${m.hasWorld ? "there" : "absent"}`);
        });
        s.done();
      }
      {
        const s = scenario("390x844, no option (control): today's layout");
        await withPage(phone, "asdawn=0", s, async (page) => {
          await page.evaluate(() => window.beat("showdusk", "farewell"));
          await sleep(SETTLE);
          const m = await page.evaluate(MEASURE);
          if (process.env.DUMP) console.log(JSON.stringify(m));
          phoneControl(s, m);
        });
        s.done();
      }
    }
    await desk.close();
    await phone.close();
  }

  /* ---- owner 3c: phone layout under 600px wide OR under 480px tall, desktop otherwise ---- */
  {
    const SIZES = [
      [580, 800, true, "narrow, tall"], [844, 390, true, "wide, short"], [599, 800, true, "just under 600 wide"], [800, 479, true, "just under 480 tall"],
      [1280, 560, false, "wide, not short"], [1280, 800, false, "desktop"], [600, 800, false, "600 wide"], [800, 480, false, "480 tall"],
    ];
    for (const [width, height, phone, why] of SIZES) {
      const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: "no-preference" });
      const s = scenario(`${width}x${height} (${why}), asDawn: the dawn and the goodbye have the ${phone ? "phone" : "desktop"} layout`);
      await withPage(ctx, "asdawn=1", s, async (page) => {
        await page.evaluate(() => window.beat("showdusk", "farewell"));
        await sleep(SETTLE);
        layoutSigns(s, await page.evaluate(MEASURE), phone, "");
      });
      s.done();
      if (["580x800", "844x390", "1280x560", "1280x800"].includes(`${width}x${height}`)) {
        /* the plain goodbye is unchanged at the four sizes the owner named (a control: it has no phone sign here) */
        const c = scenario(`${width}x${height} (${why}), no option (control): the site's goodbye is as it was`);
        await withPage(ctx, "asdawn=0", c, async (page) => {
          await page.evaluate(() => window.beat("showdusk", "farewell"));
          await sleep(SETTLE);
          const m = await page.evaluate(MEASURE);
          c.want("(control) the glyph is 420 wide", near(m.duskSvg?.w, 420, 0.6), `glyph ${f(m.duskSvg?.w)} wide`);
          c.want("(control) .name shows and there is no padding added", m.nameVisibility === "visible" && m.duskPad === 0, `visibility ${m.nameVisibility}, padding ${m.duskPad}`);
          c.want("(control) the farewell's bottom is 240px below the viewport's middle", near(m.fw?.b, m.vh / 2 + 240, 1), `bottom ${f(m.fw?.b)}, middle + 240 = ${m.vh / 2 + 240}`);
          c.want("(control) the gate sits inside the ring", m.duskGate.l >= m.duskRing.l && m.duskGate.r <= m.duskRing.r && m.duskGate.t >= m.duskRing.t && m.duskGate.b <= m.duskRing.b, "gate vs ring");
        });
        c.done();
      }
      await ctx.close();
    }
  }

  /* ---- 11a. the Earth photo: a dusk page with no dawn on it ---- */
  {
    const ctx = await browser.newContext({ viewport: DESKTOP, reducedMotion: "no-preference" });
    for (const [asDawn, label] of [[true, "asDawn asks for the Earth's pictures and shows one"], [false, "no option asks for neither (control)"]]) {
      const s = scenario(`1280x800, no dawn on the page, ${label}`);
      const seen = [];
      const page = await ctx.newPage();
      page.on("pageerror", (e) => s.problems.push(`pageerror: ${e.message}`));
      page.on("request", (req) => { if (EARTH.test(req.url())) seen.push(req.url().replace(/^.*\/assets\/door\/img\//, "")); });
      try {
        await page.goto(`${SITE}tests/asdawn.html?asdawn=${asDawn ? 1 : 0}&dawn=0`, { waitUntil: "load" });
        await page.waitForFunction(() => window.asdawnReady, null, { timeout: 30000 });
        await page.evaluate(() => { window.dusk.start(); window.beat("showdusk", "farewell"); });
        await sleep(asDawn ? 6000 : 3500);
        const names = [...new Set(seen)].sort();
        const pics = await page.evaluate(() => [...document.querySelectorAll("#dusk image")]
          .filter((i) => /dawn\/dawn(-pre)?\.webp/.test((i.getAttribute("href") || "") + (i.getAttribute("data-href") || "")))
          .map((i) => ({ src: (i.getAttribute("href") || i.getAttribute("data-href")), opacity: parseFloat(getComputedStyle(i).opacity), inWorld: !!i.closest("#dusk .world") })));
        if (asDawn) {
          s.want("dawn/dawn-pre.webp and dawn/dawn.webp are both asked for by the dusk", names.join() === "dawn/dawn-pre.webp,dawn/dawn.webp", `asked for ${JSON.stringify(names)}`);
          s.want("the dusk has both pictures as <image>s inside its .world", pics.length === 2 && pics.every((p) => p.inWorld), `${pics.length} image(s)`);
          s.want("at least one of them is shown (computed opacity of 0.5 or more) once the goodbye is up", pics.some((p) => p.opacity >= 0.5), `opacities ${JSON.stringify(pics.map((p) => p.opacity))}`);
        } else {
          s.want("(control) no Earth picture is asked for", names.length === 0, `asked for ${JSON.stringify(names)}`);
          s.want("(control) the dusk carries no Earth picture", pics.length === 0, `${pics.length} found`);
        }
      } catch (e) { s.problems.push(`${e.message.split("\n")[0]}`); } finally { await page.close().catch(() => {}); }
      s.done();
    }
    await ctx.close();
  }

  /* ---- a dusk remounted on the same markup after destroy() still shows the Earth (#25) ----
     start(), destroy() while the pictures are still on their way (delayed), mount again, start(): the second dusk must
     show an Earth picture. Control: the same after the first pictures have loaded. */
  {
    const ctx = await browser.newContext({ viewport: DESKTOP, reducedMotion: "no-preference" });
    for (const [delay, label] of [[3000, "destroy() while the pictures are still loading"], [0, "destroy() after the pictures have loaded (control)"]]) {
      const s = scenario(`1280x800, asDawn, a remounted dusk: ${label}`);
      const page = await ctx.newPage();
      page.on("pageerror", (e) => s.problems.push(`pageerror: ${e.message}`));
      if (delay) await page.route(EARTH, async (route) => { await sleep(delay); await route.continue().catch(() => {}); });
      try {
        await page.goto(`${SITE}tests/asdawn.html?asdawn=1&dawn=0`, { waitUntil: "load" });
        await page.waitForFunction(() => window.asdawnReady, null, { timeout: 30000 });
        await page.evaluate(() => window.dusk.start());
        await sleep(delay ? 600 : 6000);
        await page.evaluate(() => { window.remountDusk(); window.beat("showdusk", "farewell"); });
        const shown = () => page.evaluate(() => [...document.querySelectorAll("#dusk image")]
          .filter((i) => /dawn\/dawn(-pre)?\.webp/.test((i.getAttribute("href") || "") + (i.getAttribute("data-href") || "")))
          .map((i) => parseFloat(getComputedStyle(i).opacity)));
        let ops = [];
        for (let t = 0; t < 12000; t += 250) { ops = await shown(); if (ops.some((o) => o >= 0.5)) break; await sleep(250); }
        s.want("the second dusk's start() reaches an Earth picture at opacity 0.5 or more (within 12 s)", ops.some((o) => o >= 0.5), `Earth picture opacities ${JSON.stringify(ops)}`);
      } catch (e) { s.problems.push(`${e.message.split("\n")[0]}`); } finally { await page.close().catch(() => {}); }
      s.done();
    }
    await ctx.close();
  }

  /* ---- data-rasterised is "pending" by the time start() returns, on the sign-in-faced dusk ---- */
  {
    const ctx = await browser.newContext({ viewport: DESKTOP, reducedMotion: "no-preference" });
    const s = scenario("1280x800, asDawn: the dusk's world reads pending straight after start()");
    await withPage(ctx, "asdawn=1&dawn=0", s, async (page) => {
      const v = await page.evaluate(() => window.pendingAtOnce());
      s.want("data-rasterised reads \"pending\" the moment start() returns", v === "pending", `read ${JSON.stringify(v)}`);
      await page.waitForFunction(() => window.dusk.world.dataset.rasterised === "ready", null, { timeout: 20000 }).catch(() => s.problems.push('want: it reaches "ready" once the glows are drawn and the Earth has loaded -- it did not within 20 s'));
    });
    s.done();
    await ctx.close();
  }

  /* ---- 19. descend with homes still plays ---- */
  {
    const ctx = await browser.newContext({ viewport: DESKTOP, reducedMotion: "no-preference" });
    const cases = [
      ["30 homes, onto the dusk, from the climb", [30, 5400, "dusk", true]],
      ["30 homes, onto the dusk, no climb", [30, 5400, "dusk", false]],
      ["3 homes, onto the dusk, from the climb", [3, 5400, "dusk", true]],
      ["no homes given (control)", [null, 5400, "dusk", true]],
      ["an empty list of homes", [0, 5400, "dusk", true]],
    ];
    for (const [label, args] of cases) {
      const s = scenario(`19. descend({ homes, at: 5400 }): ${label}`);
      await withPage(ctx, "asdawn=1", s, async (page) => {
        const r = await page.evaluate(([n, at, onto, from]) => window.descendHomes(n, at, onto, from), args);
        s.want("the call does not throw", !r.error, r.error || "");
        s.want("released, surface and farewell all fire", r.hooks.released && r.hooks.surface && r.hooks.farewell, JSON.stringify(r.hooks));
        s.want("the body has showdusk and farewell", r.now.includes("showdusk") && r.now.includes("farewell"), JSON.stringify(r.now));
      });
      s.done();
    }
    await ctx.close();
  }
} catch (e) {
  console.log(`FAIL asdawn test: ${e.message.split("\n")[0]}`);
  failed = true;
} finally {
  await browser?.close().catch(() => {});
  server.kill();
}
process.exit(failed ? 1 : 0);
