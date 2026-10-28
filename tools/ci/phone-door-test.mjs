/*
 * Live test for two phone bugs on the door and the landings (#48, #50), written from the specification alone and
 * judged only through what a visitor or the browser can see: computed styles, bounding boxes, focus and DOM
 * attributes.
 *
 *   P1  a landing's heading (install, docs, information) that the site focuses on arrival shows no outline, even
 *       when the browser treats that focus as focus-visible (iOS Safari does so always; Chromium and Firefox do
 *       when the last input was the keyboard, which is how this reaches each landing: a key is pressed, the door's
 *       planet is focused and Enter is pressed). One case per landing: P1a install, P1b docs, P1c information.
 *       Controls: the heading is the focused element and does match :focus-visible (so the browser is showing
 *       what iOS shows), and the heading has tabindex="-1".
 *   P2  any other programmatic focus target (an element with tabindex="-1" focused by script after a key press)
 *       shows no outline either. Control: it matches :focus-visible.
 *   P3  the paired control: on each landing, Tab on from the heading through up to 12 stops; every link or button
 *       reached shows a visible focus indicator (the fix must not remove the focus look). An indicator is an
 *       outline, or a computed border colour or box-shadow that differs from the same element unfocused (the
 *       information cards keep their own look, a gold border and glow, by the owner's decision in #54). Focused
 *       state is read 400 ms after the Tab and unfocused state 400 ms after blurring, so transitions have settled.
 *       Controls: Tab did reach a link or button, each matches :focus-visible, and a plain link injected with
 *       `outline:none` and nothing else, focused after a key press, is judged to have no indicator (so the judge
 *       can say no).
 *   P4  at 360, 390 and 430 wide (844 high, a touch phone), on the 3D door (?preview&door3d) and on the default
 *       door (?preview), every visible planet label (`#door .planet .tag`) lies wholly inside the viewport (left
 *       >= 0, right <= innerWidth, top >= 0, bottom <= innerHeight). Sampled two ways: in real time every 250 ms
 *       for 12 s, and as a sweep over each planet's whole orbit (the door's CSS animations are paused and set to
 *       40 evenly spaced phases of their own lap, so every position round the ring is seen, not just the first
 *       12 s of a 46 to 72 s lap). Controls: three labels with text were found, and some were visible in the
 *       samples (the count of visible observations is shown).
 *
 *   PLAYWRIGHT_ROOT=<playwright package dir> node tools/ci/phone-door-test.mjs
 *
 * Chromium, headless, by default: neither bug needs a WebGL world. BROWSER=firefox (HEADED=1 under xvfb-run with
 * LIBGL_ALWAYS_SOFTWARE=1 if a world is wanted) for another engine. Fixes must show in both engines. A case that
 * cannot be judged says so and fails, rather than passing for nothing. The whole run has a deadline of 8 minutes.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { freePort, openBrowser } from "./live-lib.mjs";

const playwright = createRequire(import.meta.url)(process.env.PLAYWRIGHT_ROOT || "playwright");
const BROWSER = process.env.BROWSER || "chromium";
/* the gate's one server when SITE is given (tools/ci/live-run.mjs), else our own on a free port */
const SITE = process.env.SITE || `http://127.0.0.1:${await freePort()}/`;
const here = dirname(fileURLToPath(import.meta.url));
const DEADLINE_MS = 8 * 60 * 1000;

const server = process.env.SITE ? null : spawn(process.execPath, [join(here, "serve.mjs"), new URL(SITE).port], { stdio: ["ignore", "ignore", "inherit"] });
/* the server is stopped on every way out, the deadline's process.exit and an uncaught error included */
process.on("exit", () => server?.kill());
const results = [];
let browser = null;

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const until = async (read, ok, ms, every = 50) => {
  const t0 = Date.now();
  let v = await read();
  while (!ok(v) && Date.now() - t0 < ms) { await sleep(every); v = await read(); }
  return v;
};

/* a case: `fn(want)` calls want(ok, what-it-should-be-and-what-was-seen) for each thing it judges; an exception
   from fn is a failure of the case, named */
const runCase = async (id, name, fn) => {
  const t0 = Date.now();
  const problems = [];
  const notes = [];
  const want = (ok, msg) => { if (!ok) problems.push(msg); };
  want.note = (msg) => notes.push(msg);
  try { await fn(want); } catch (e) { problems.push(`could not be judged: ${e.message.split("\n")[0]}`); }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`${problems.length ? "FAIL" : "ok  "} ${id} ${name} (${secs}s)`);
  for (const n of notes) console.log(`       ${id}: (${n})`);
  for (const p of problems) console.log(`       ${id}: ${p}`);
  results.push({ id, problems });
};

const phone = (width) => ({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

/* what a visitor would see round an element's focus: the outline the browser draws */
const outlineOf = (sel) => (page) => page.evaluate((s) => {
  const el = document.querySelector(s);
  const cs = getComputedStyle(el);
  return { found: !!el, focusVisible: el.matches(":focus-visible"), style: cs.outlineStyle, width: cs.outlineWidth, colour: cs.outlineColor };
}, sel);
const drawsOutline = (o) => o.style !== "none" && parseFloat(o.width) > 0;
/* a link or button shows focus if it draws an outline, or its border colour or box-shadow differs from unfocused */
const indicator = (focused, unfocused) => drawsOutline(focused) || focused.border !== unfocused.border || focused.shadow !== unfocused.shadow;
/* runs in the page: the look of the element marked data-pd-tab="<n>" */
const snapshot = (n) => {
  const el = document.querySelector(`[data-pd-tab="${n}"]`);
  const cs = getComputedStyle(el);
  return {
    focusVisible: el.matches(":focus-visible"), style: cs.outlineStyle, width: cs.outlineWidth, colour: cs.outlineColor,
    border: [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor].join(" "), shadow: cs.boxShadow,
  };
};
const describe = (o) => `${o.width} ${o.style} ${o.colour}`;

/* ── P1, P3: each landing, reached by the keyboard ─────────────────────────────────────────────────────── */
const LANDINGS = [
  ["a", "install", "#installpad"],
  ["b", "docs", "#docspad"],
  ["c", "information", "#infopad", "info"],
];
const landingCase = async ([letter, label, pad, section = label]) => {
  const ctx = await browser.newContext({ ...phone(390), reducedMotion: "no-preference" });
  const page = await ctx.newPage();
  let reached = null;
  const reach = async () => {
    if (reached) return reached;
    reached = (async () => {
      await page.goto(`${SITE}?preview`, { waitUntil: "load" });
      await page.locator("#door").waitFor({ state: "visible", timeout: 60000 });
      const planet = page.locator(`#door .planet[data-section=${section}]`);
      await planet.waitFor({ state: "attached", timeout: 60000 });
      /* the keyboard is the last input; then the planet is focused and opened with Enter, as a keyboard visitor does */
      await page.keyboard.press("Tab");
      await planet.evaluate((el) => el.focus());
      await page.keyboard.press("Enter");
      await page.locator(pad).waitFor({ state: "visible", timeout: 60000 });
      /* the focused heading is marked so that it can be addressed (a landing may hold more than one h1) */
      const landed = await until(() => page.evaluate((padSel) => {
        const el = document.activeElement;
        if (el?.tagName !== "H1" || !el.closest(padSel)) return false;
        el.setAttribute("data-pd-focus", "");
        return true;
      }, pad), (v) => v, 60000, 100);
      if (!landed) throw new Error(`focus never landed on an h1 in ${pad} within 60 s (it is on ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80))})`);
      await sleep(500);
      return `${pad} h1[data-pd-focus]`;
    })();
    return reached;
  };

  await runCase(`P1${letter}`, `the ${label} landing's focused heading shows no outline`, async (want) => {
    const h1 = await reach();
    const tabindex = await page.locator(h1).getAttribute("tabindex");
    want(tabindex === "-1", `control: ${h1} has tabindex ${JSON.stringify(tabindex)}, want "-1", so it is not the programmatic focus target the case is about`);
    const o = await outlineOf(h1)(page);
    want(o.focusVisible, `control: ${h1} is focused but does not match :focus-visible, so this browser is not showing what iOS Safari shows and the case cannot see the bug`);
    want(!drawsOutline(o), `${h1} is focused and matches :focus-visible (${o.focusVisible}) and draws an outline of ${describe(o)}, want none`);
  });

  await runCase(`P3${letter}`, `on the ${label} landing every link and button reached by Tab shows a focus indicator`, async (want) => {
    const h1 = await reach();
    /* the focused element, marked (data-pd-tab) so that it can be read again unfocused */
    const reachedControls = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      const seen = await page.evaluate(({ padSel, n }) => {
        const el = document.activeElement;
        if (!/^(A|BUTTON)$/.test(el.tagName)) return { tag: el.tagName };
        if (el.hasAttribute("data-pd-tab")) return { tag: el.tagName, again: true };
        el.setAttribute("data-pd-tab", String(n));
        return { tag: el.tagName, n, text: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30) };
      }, { padSel: pad, n: i });
      if (seen.again) break; /* Tab has come round */
      if (seen.n === undefined) continue;
      await sleep(400); /* the focused look settles */
      reachedControls.push({ ...seen, focused: await page.evaluate(snapshot, seen.n) });
    }
    /* the same elements unfocused, settled */
    await page.evaluate(() => document.activeElement?.blur());
    await sleep(400);
    for (const c of reachedControls) c.unfocused = await page.evaluate(snapshot, c.n);
    want(reachedControls.length > 0, `control: 12 Tabs on from ${h1} reached no link or button`);
    want(reachedControls.every((c) => c.focused.focusVisible), `control: a link or button reached by Tab does not match :focus-visible`);
    const lacking = reachedControls.filter((c) => !indicator(c.focused, c.unfocused));
    const byBorderOrShadow = reachedControls.filter((c) => !drawsOutline(c.focused) && indicator(c.focused, c.unfocused)).map((c) => c.text);
    want.note(`${reachedControls.length} links and buttons reached; no outline but a border or shadow change: ${JSON.stringify(byBorderOrShadow)}`);
    want(lacking.length === 0, `${lacking.length} of ${reachedControls.length} links and buttons reached by Tab show no focus indicator (no outline, and the same border colour and box-shadow as unfocused): ${JSON.stringify(lacking.map((c) => c.text))}`);

    /* control: a plain link with its outline removed and nothing else must be judged to have no indicator */
    await page.keyboard.press("Tab");
    await page.evaluate(() => {
      const a = document.createElement("a");
      a.id = "pd-plain"; a.href = "#pd-plain"; a.textContent = "plain"; a.setAttribute("data-pd-tab", "plain");
      a.style.cssText = "position:fixed;left:10px;top:10px;z-index:99999;outline:none";
      document.body.appendChild(a);
      a.focus();
    });
    await sleep(400);
    const plainOn = await page.evaluate(snapshot, "plain");
    await page.evaluate(() => document.activeElement?.blur());
    await sleep(400);
    const plainOff = await page.evaluate(snapshot, "plain");
    want(plainOn.focusVisible, "control: the injected plain link does not match :focus-visible when focused, so it cannot show the judge saying no");
    want(!indicator(plainOn, plainOff), "control: the judge finds a focus indicator on a plain link whose outline was removed and nothing else changed, so it cannot say no");
  });

  await ctx.close();
};

/* ── P2: any tabindex="-1" target, focused by script after a key press ─────────────────────────────────── */
const anyTargetCase = async () => {
  const ctx = await browser.newContext({ ...phone(390), reducedMotion: "no-preference" });
  const page = await ctx.newPage();
  try {
    await runCase("P2", "any element with tabindex -1 focused by script shows no outline", async (want) => {
      await page.goto(`${SITE}?preview`, { waitUntil: "load" });
      await page.locator("#door").waitFor({ state: "visible", timeout: 60000 });
      await page.keyboard.press("Tab");
      await page.evaluate(() => {
        const d = document.createElement("div");
        d.id = "phonedoor-target";
        d.setAttribute("tabindex", "-1");
        d.textContent = "target";
        d.style.cssText = "position:fixed;left:20px;top:20px;width:80px;height:30px;z-index:99999;background:#222;color:#fff";
        document.body.appendChild(d);
        d.focus();
      });
      const o = await outlineOf("#phonedoor-target")(page);
      want(o.focusVisible, "control: the script-focused element does not match :focus-visible, so the case cannot see the bug");
      want(!drawsOutline(o), `a [tabindex="-1"] element focused by script matches :focus-visible and draws an outline of ${describe(o)}, want none`);
    });
  } finally { await ctx.close(); }
};

/* ── P4: the door's labels stay on the screen ──────────────────────────────────────────────────────────── */
const WIDTHS = [360, 390, 430];
const REAL_TIME_MS = 12000;
const EVERY_MS = 250;
const SWEEP_STEPS = 40;

/* runs in the page: one observation of every label; hidden ones are noted but not judged */
const observe = () => {
  const out = [];
  for (const t of document.querySelectorAll("#door .planet .tag")) {
    const cs = getComputedStyle(t);
    const r = t.getBoundingClientRect();
    const visible = cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity) > 0.02 && r.width > 0 && r.height > 0;
    out.push({
      text: t.textContent.trim(), visible, left: r.left, right: r.right, top: r.top, bottom: r.bottom,
      iw: window.innerWidth, ih: window.innerHeight,
    });
  }
  return out;
};

const labelsCase = async (doorName, query, width) => {
  const ctx = await browser.newContext({ ...phone(width), reducedMotion: "no-preference" });
  const page = await ctx.newPage();
  const samples = []; /* each sample is the list of labels seen at one moment */
  try {
    await page.goto(`${SITE}${query}`, { waitUntil: "load" });
    await page.locator("#door").waitFor({ state: "visible", timeout: 60000 });
    await page.locator("#door .planet[data-section=info] .tag").waitFor({ state: "attached", timeout: 60000 });
    /* sampled once the labels' font is in and two frames have been drawn (owner, 2026-10-13, answer 3a): a read in
       the instant the font arrives, before the door re-places the wider label, saw a state never painted */
    await page.evaluate(() => document.fonts.ready.then(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)))));
    await sleep(1500);
    /* real time */
    const t0 = Date.now();
    while (Date.now() - t0 < REAL_TIME_MS) {
      samples.push({ how: "real time", at: ((Date.now() - t0) / 1000).toFixed(1) + "s", labels: await page.evaluate(observe) });
      await sleep(EVERY_MS);
    }
    /* the whole orbit: pause the planets' animations and walk each through its own lap */
    const laps = await page.evaluate(() => {
      const anims = document.getAnimations().filter((a) => a.effect?.target?.closest?.("#door .planet"));
      window.__phoneDoorAnims = anims.map((a) => { const d = a.effect.getComputedTiming().duration; return { a, d: typeof d === "number" ? d : 0 }; });
      for (const { a } of window.__phoneDoorAnims) a.pause();
      return window.__phoneDoorAnims.length;
    });
    for (let i = 0; i < SWEEP_STEPS; i++) {
      await page.evaluate((frac) => {
        for (const { a, d } of window.__phoneDoorAnims) if (d > 0 && isFinite(d)) a.currentTime = d * frac;
      }, i / SWEEP_STEPS);
      /* a frame or two for anything that places labels from the layout */
      await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
      samples.push({ how: "orbit sweep", at: `${i}/${SWEEP_STEPS} of a lap`, labels: await page.evaluate(observe) });
    }
    return { samples, laps };
  } finally { await ctx.close(); }
};

const labelDoorCase = async (id, doorName, query) => {
  await runCase(id, `${doorName}: every visible planet label stays inside the screen at ${WIDTHS.join(", ")} wide`, async (want) => {
    const runs = await Promise.all(WIDTHS.map((w) => labelsCase(doorName, query, w).then((r) => ({ w, ...r }))));
    for (const { w, samples, laps } of runs) {
      const all = samples.flatMap((s) => s.labels.map((l) => ({ ...l, how: s.how, at: s.at })));
      const names = new Set(all.map((l) => l.text));
      const seenVisible = new Set(all.filter((l) => l.visible).map((l) => l.text));
      const visibleObs = all.filter((l) => l.visible).length;
      want(samples.length > 0, `control: no samples were taken at ${w} wide`);
      want(names.size >= 3 && [...names].every((n) => n.length > 0), `control: at ${w} wide found labels ${JSON.stringify([...names])}, want three with text`);
      want(visibleObs > 0, `control: at ${w} wide no label was visible in any of ${samples.length} samples`);
      want.note(`${w} wide: ${samples.length} samples (${samples.filter((s) => s.how === "real time").length} real time over ${REAL_TIME_MS / 1000} s, ${SWEEP_STEPS} orbit sweep), ${laps} animations swept, ${visibleObs} visible label observations, seen visible: ${[...seenVisible].join(", ")}`);
      /* judge: the worst overshoot per label and side */
      const worst = new Map();
      let bad = 0;
      for (const l of all) {
        if (!l.visible) continue;
        const over = { left: -l.left, right: l.right - l.iw, top: -l.top, bottom: l.bottom - l.ih };
        const out = Object.entries(over).filter(([, v]) => v > 0.5);
        if (!out.length) continue;
        bad++;
        for (const [side, v] of out) {
          const key = `${l.text}/${side}`;
          if (!worst.has(key) || worst.get(key).v < v) worst.set(key, { v, l, side });
        }
      }
      for (const { v, l, side } of worst.values()) {
        const edge = { left: "left", right: "right", top: "top", bottom: "bottom" }[side];
        want(false, `at ${w}x844 the "${l.text}" label runs ${v.toFixed(1)} px past the ${edge} edge (left ${l.left.toFixed(1)}, right ${l.right.toFixed(1)}, innerWidth ${l.iw}; ${l.how} ${l.at}); ${bad} of ${visibleObs} visible label observations were outside the screen`);
      }
    }
  });
};

/* ── run ───────────────────────────────────────────────────────────────────────────────────────────────── */
const deadline = setTimeout(() => {
  console.log(`FAIL phone-door-test: not finished within ${DEADLINE_MS / 60000} minutes`);
  server?.kill();
  process.exit(2);
}, DEADLINE_MS);

try {
  await new Promise((ok, no) => {
    const t0 = Date.now();
    (async function poll() {
      try { await fetch(SITE); ok(); } catch { Date.now() - t0 > 10000 ? no(new Error("server did not start")) : setTimeout(poll, 100); }
    })();
  });
  browser = await openBrowser(playwright, BROWSER);
  /* the three landings run side by side (each in its own context), then the label cases */
  await Promise.all(LANDINGS.map((l) => landingCase(l)));
  await anyTargetCase();
  await labelDoorCase("P4a", "the 3D door (?preview&door3d)", "?preview&door3d");
  await labelDoorCase("P4b", "the default door (?preview)", "?preview");
} catch (e) {
  console.log(`FAIL phone door test: ${e.message.split("\n")[0]}`);
  results.push({ id: "setup", problems: [e.message] });
} finally {
  clearTimeout(deadline);
  await browser?.close().catch(() => {});
  server?.kill();
}

const bad = results.filter((r) => r.problems.length);
console.log(bad.length ? `\nphone-door-test: failed (${bad.map((r) => r.id).join(", ")})` : "\nphone-door-test: ok");
process.exit(bad.length ? 1 : 0);
