/*
 * The live journey: the site served as Pages serves it, visited in a real
 * browser (Firefox by default), each landing reached, and nothing thrown.
 * This is the gate's live check; it is never optional (new-project skill).
 *
 *   node tools/ci/journey.mjs                 Firefox, site on a free port
 *   BROWSER=chromium node tools/ci/journey.mjs
 *   HEADED=1 (headed, for Xvfb + software GL), WEBGL=required (no WebGL2 fails)
 *   SITE=http://127.0.0.1:8787/ node tools/ci/journey.mjs
 *
 * Needs playwright (the Playwright image in CI; locally PLAYWRIGHT_ROOT
 * naming the package directory, e.g. ../orbit/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright). Reduced motion is asked for so a landing is
 * reached without the film, and WebGL2 is not assumed: without it the
 * site draws its stills, which is also what it must do for visitors.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { freePort, openBrowser } from "./live-lib.mjs";

/* playwright: from the image's global install in CI, or from the checkout
   PLAYWRIGHT_ROOT names (a sibling project's node_modules) locally */
const playwright = createRequire(import.meta.url)(process.env.PLAYWRIGHT_ROOT || "playwright");

const SITE = process.env.SITE || `http://127.0.0.1:${await freePort()}/`;
const BROWSER = process.env.BROWSER || "firefox";
const here = dirname(fileURLToPath(import.meta.url));

/* the server and the browser are closed whatever happens between: an exception
   would otherwise leave the child serving and the browser open, and the job hung.
   (The body of the try is not indented, to keep the diff of this step small.) */
const problems = [];
let server = null, browser = null;
try {
if (!process.env.SITE) {
  server = spawn(process.execPath, [join(here, "serve.mjs"), new URL(SITE).port], { stdio: ["ignore", "inherit", "inherit"] });
  await new Promise((ok, no) => {
    const t0 = Date.now();
    (async function poll() {
      try { await fetch(SITE); ok(); } catch { Date.now() - t0 > 10000 ? no(new Error("server did not start")) : setTimeout(poll, 100); }
    })();
  });
}

/* HEADED=1 runs the browser headed (the gate does so under Xvfb with software
   GL, so Firefox has a WebGL2 to draw the worlds with) */
browser = await openBrowser(playwright, BROWSER);
/* Each step opens its own tab, as a visitor arriving from a link does: a
   hash change inside one tab is a different path (the site flies between
   landings on a click, not on the address alone). */
const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 800 } });
let page = null;
/* set only while the deliberate no-such-page visit runs: Chromium logs its
   404 as a console error, which is expected there and nowhere else */
let expectNotFound = false;
const fresh = async () => {
  await page?.close();
  page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  /* No Gaia picture: the page must not request any galaxy*.webp, and must not
     print the old "is drawn, not Gaia's" credit note. */
  page.on("request", (r) => {
    let name = "";
    try { name = new URL(r.url()).pathname.split("/").pop(); } catch { name = r.url(); }
    if (/^galaxy.*\.webp$/.test(name)) problems.push(`requested a galaxy picture: ${r.url()}`);
  });
  page.on("console", (m) => { if (m.text().includes("is drawn, not Gaia's")) problems.push(`console message mentions Gaia: ${m.text()}`); });
  page.on("console", (m) => { if (m.type() === "error" && !expectNotFound) problems.push(`console.error: ${m.text()}`); });
  page.on("requestfailed", (r) => { if (r.url().startsWith(SITE)) problems.push(`request failed: ${r.url()} ${r.failure()?.errorText}`); });
  page.on("response", (r) => { if (r.url().startsWith(SITE) && r.status() >= 400 && !r.url().endsWith("/no-such-page")) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  return page;
};

const step = async (name, fn) => {
  try { await fresh(); await fn(); console.log(`ok   ${name}`); }
  catch (e) { problems.push(`${name}: ${e.message.split("\n")[0]}`); console.log(`FAIL ${name}`); }
};

/* A step that needs its own browser context (a time zone, motion left on, a
   clock), with the harness's pageerror listener on its page. */
const inOwnContext = async (options, fn) => {
  const octx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...options });
  try {
    const opage = await octx.newPage();
    opage.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    await fn(opage, octx);
  } finally { await octx.close(); }
};

let maintenance = false;
await step("the door lights", async () => {
  await page.goto(SITE, { waitUntil: "load" });
  await page.locator("#door").waitFor({ state: "visible", timeout: 30000 });
  await page.locator("#door .planet[data-section=install]").waitFor({ state: "attached" });
  maintenance = (await page.locator("html[data-maintenance]").count()) > 0;
});

/* Reduced motion stops every endless animation (the door, the dusk film, the
   dial's warning glow); a name other than "none" means one still runs. */
await step("reduced motion stops the endless animations", async () => {
  await page.goto(SITE, { waitUntil: "load" });
  await page.locator("#door").waitFor({ state: "visible", timeout: 30000 });
  const names = await page.evaluate(() => {
    const name = (sel) => { const el = document.querySelector(sel); return [sel, el ? getComputedStyle(el).animationName : "missing"]; };
    const out = [
      name("#door .planets .trdot"),
      name("#dusk .shimmer"),
      name("#dusk .lockup .glyph .tr"),
    ];
    const dial = document.querySelector(".dial");
    dial?.classList.add("warn");
    out.push(name(".dial .danger"));
    dial?.classList.remove("warn");
    return out;
  });
  const running = names.filter(([, n]) => n !== "none");
  if (running.length) throw new Error(`still animating under reduced motion: ${running.map(([s, n]) => `${s} (${n})`).join(", ")}`);
});

if (maintenance) {
  /* index.html carries data-maintenance: the door stands alone with its
     message, and a deep link lands on the door with nothing readied.
     That is what the site ships, so that is what is checked. */
  console.log("     (maintenance mode: the door alone, no landings)");
  await step("the notice is shown", async () => {
    await page.goto(SITE, { waitUntil: "load" });
    const words = (await page.getAttribute("html", "data-maintenance"))?.trim() || "Back shortly";
    await page.locator("#door .notice .t", { hasText: words }).waitFor({ state: "visible", timeout: 10000 });
  });
  await step("a deep link lands on the door", async () => {
    await page.goto(SITE + "#install", { waitUntil: "load" });
    await page.locator("#door").waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(3000);
    for (const pad of ["#installpad", "#docspad", "#infopad"]) if (await page.locator(pad).isVisible()) throw new Error(`${pad} opened`);
  });
}

/* The landings: each one reached, and a docs page opened. `prefix` is
   "" when the site is open, and "?preview" past the maintenance door
   (the query removes maintenance mode for that page load). */
const landings = async (prefix) => {
  for (const [hash, pad] of [["#install", "#installpad"], ["#docs", "#docspad"], ["#info", "#infopad"]]) {
    await step(`${prefix}${hash} arrives`, async () => {
      await page.goto(SITE + prefix + hash, { waitUntil: "load" });
      await page.locator(pad).waitFor({ state: "visible", timeout: 60000 });
    });
  }
  /* Saved dates keep their local calendar day: just after local midnight in
     Tokyo it is still the 25th in UTC, and "due" must not start on the 25th. */
  await step(`the due date starts tomorrow in Tokyo${prefix ? " (preview)" : ""}`, async () => {
    await inOwnContext({ timezoneId: "Asia/Tokyo", reducedMotion: "reduce" }, async (p) => {
      await p.clock.setFixedTime(Date.UTC(2026, 9, 25, 20, 0));
      await p.goto(SITE + prefix + "#home", { waitUntil: "load" });
      await p.locator("#f-date").waitFor({ state: "attached", timeout: 30000 });
      try { await p.waitForFunction(() => document.querySelector("#f-date").min === "2026-10-26", null, { timeout: 5000 }); }
      catch { throw new Error(`#f-date min is ${await p.locator("#f-date").getAttribute("min")}, want 2026-10-26`); }
    });
  });
  /* One click on the install line copies once, and the line keeps its text;
     only the button says "copied". */
  const clipboard = (copies) => ({ content: `Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: ${copies} } });` });
  await step(`one copy click makes one copy${prefix ? " (preview)" : ""}`, async () => {
    await page.addInitScript(clipboard("(t) => { (window.__copied ||= []).push(t); return Promise.resolve(); }"));
    await page.goto(SITE + prefix + "#install", { waitUntil: "load" });
    await page.locator("#installpad").waitFor({ state: "visible", timeout: 60000 });
    const code = page.locator("#installpad code[data-copy]");
    const button = page.locator("#installpad button.copy");
    await code.click();
    /* poll for the value the event should produce, not a fixed time: a
       freezing page (headless Chromium, 2-4 s) makes fixed waits unreliable */
    const until = async (where, read, ok, ms = 6000) => {
      const t0 = Date.now();
      let v = await read();
      while (!ok(v) && Date.now() - t0 < ms) { await where.waitForTimeout(100); v = await read(); }
      return v;
    };
    const copies = () => page.evaluate(() => (window.__copied || []).length);
    /* exactly one write for the one click, and it stays one */
    const n = await until(page, copies, (v) => v >= 1);
    if (n !== 1) throw new Error(`${n} copies after clicking the command line, want 1`);
    /* the line keeps its command while the button says "copied" ... */
    const during = await code.textContent();
    if (!during.includes("curl -fsSL")) throw new Error(`the command line reads ${JSON.stringify(during)} just after the click, want the command`);
    /* ... and after the restore window, which ends when the button reads "copy" again */
    const restored = await until(page, () => button.textContent(), (t) => t === "copy");
    if (restored !== "copy") throw new Error(`the button reads ${JSON.stringify(restored)} after the restore window, want "copy"`);
    const n2 = await copies();
    if (n2 !== 1) throw new Error(`${n2} copies after the restore window, want 1`);
    const text = await code.textContent();
    if (!text.includes("curl -fsSL")) throw new Error(`the command line reads ${JSON.stringify(text)} after the restore window, want the command`);
    await button.click();
    const copied = await until(page, () => button.textContent(), (t) => t === "copied");
    if (copied !== "copied") throw new Error(`the button reads ${JSON.stringify(copied)} after the click, want "copied"`);
    const back = await until(page, () => button.textContent(), (t) => t === "copy");
    if (back !== "copy") throw new Error(`the button reads ${JSON.stringify(back)} later, want "copy"`);
    const refused = await ctx.newPage();
    try {
      refused.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
      await refused.addInitScript(clipboard("() => Promise.reject(new Error('refused'))"));
      await refused.goto(SITE + prefix + "#install", { waitUntil: "load" });
      await refused.locator("#installpad").waitFor({ state: "visible", timeout: 60000 });
      const rb = refused.locator("#installpad button.copy");
      await rb.click();
      const nc = await until(refused, () => rb.textContent(), (t) => t === "not copied");
      if (nc !== "not copied") throw new Error(`a refused copy reads ${JSON.stringify(nc)}, want "not copied"`);
      const rc = await until(refused, () => rb.textContent(), (t) => t === "copy");
      if (rc !== "copy") throw new Error(`a refused copy reads ${JSON.stringify(rc)} later, want "copy"`);
    } finally { await refused.close(); }
  });
  /* A failed docs index is retried: the panel's way back to the door, then a
     second visit, must find the docs. */
  await step(`a failed docs index is retried${prefix ? " (preview)" : ""}`, async () => {
    await inOwnContext({ reducedMotion: "reduce" }, async (p) => {
      let failedOnce = false;
      await p.route("**/assets/docs/index.json", (route) => {
        if (failedOnce) return route.continue();
        failedOnce = true;
        return route.abort();
      });
      await p.goto(SITE + prefix + "#docs", { waitUntil: "load" });
      await p.locator("#docspad .none", { hasText: "The docs have not been imported" }).waitFor({ state: "visible", timeout: 30000 });
      await p.locator("#docspad .back.dawn").click();
      await p.locator("#door").waitFor({ state: "visible", timeout: 30000 });
      const planet = p.locator("#door .planet[data-section=docs].ready");
      await planet.waitFor({ state: "attached", timeout: 30000 });
      /* the planets keep turning, so a pointer click never finds one stable */
      await planet.evaluate((el) => el.click());
      try {
        await p.waitForFunction(() => document.querySelector("#docspad .entry, #docspad .chart .star") && !document.querySelector("#docspad .none"), null, { timeout: 30000 });
      } catch { throw new Error("the docs index failed once and the docs never loaded on the second visit within 30s"); }
    });
  });
  /* The world itself, forced onto the software GPU (?gpu=force): its own context without reducedMotion (which shows
     stills instead of the world). Where WebGL2 is missing this is skipped,
     unless WEBGL=required, when it is a problem. */
  await step("the install world draws", async () => {
    const wctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    try {
      const wpage = await wctx.newPage();
      const messages = [];
      let ready = () => {};
      const readyP = new Promise((ok) => { ready = ok; });
      wpage.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
      wpage.on("console", (m) => {
        const text = m.text();
        messages.push(text);
        if (m.type() === "error") problems.push(`console.error: ${text}`);
        if (text.includes("install: ready")) ready();
      });
      wpage.on("requestfailed", (r) => { if (r.url().startsWith(SITE)) problems.push(`request failed: ${r.url()} ${r.failure()?.errorText}`); });
      if (!(await wpage.evaluate(() => !!document.createElement("canvas").getContext("webgl2")))) {
        if (process.env.WEBGL === "required") throw new Error(`no WebGL2 in ${BROWSER}: the worlds are never drawn`);
        console.log("     (no WebGL2 here: the world is not drawn)");
        return;
      }
      /* ?gpu=force (ADR-0002, behaviour 13): the door's GPU gate refuses this software renderer, as it must, so a
         world is only drawn here when the debug flag takes the context anyway; every other step runs with the
         GPU refused */
      await wpage.goto(SITE + (prefix ? prefix + "&gpu=force" : "?gpu=force") + "#install", { waitUntil: "load" });
      let timer;
      const timedOut = new Promise((_, no) => { timer = setTimeout(() => no(new Error("the install world never logged 'install: ready' within 90s")), 90000); });
      try { await Promise.race([readyP, timedOut]); } finally { clearTimeout(timer); }
      await wpage.waitForTimeout(5000);
      const fell = messages.filter((t) => t.includes("is drawn, not photographed") || t.includes("orbit: no map"));
      if (fell.length) throw new Error(`a world fell back to drawn textures: ${fell[0]}`);
    } finally { await wctx.close(); }
  });
  /* #116 (ADR-0002 section 6, cases L1-L6): the ways in open only when the flight's proper version is loaded and the
     verdict on the world is in; the verdict is remembered on the device for a week. Each step has its own context
     (so its storage is its own) and no motion reduced, as the world step above; where WebGL2 is missing it is skipped,
     unless WEBGL=required. Behaviour only: order and state, no step reads a time. The page's console lines are
     recorded in the page with the gate's state at the moment of each, and every change of the gate's `disabled` is
     recorded with the lines said so far, so "before" and "after" are read from the page and not from a race. */
  const WATCH = () => {
    const lines = (window.__lines = []), gate = (window.__gate = []);
    for (const k of ["log", "info", "debug"]) {
      const o = console[k].bind(console);
      console[k] = (...a) => { try { lines.push({ text: a.map(String).join(" "), disabled: document.getElementById("gate")?.disabled ?? null }); } catch { /* the page's own line goes on */ } o(...a); };
    }
    new MutationObserver(() => {
      const g = document.getElementById("gate");
      if (g) gate.push({ disabled: g.disabled, lines: lines.map((l) => l.text) });
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["disabled"] });
  };
  const SKIPPED = /flight world: on \(fitness skipped\)/, FLIGHT_READY = /flight: ready/;
  const VERDICT = /flight world: (?:on \(frame \d+|off: frame \d+)/;
  const gl2 = (p) => p.evaluate(() => !!document.createElement("canvas").getContext("webgl2"));
  const withGL = async (fn) => {
    await inOwnContext({}, async (p, octx) => {
      if (!(await gl2(p))) {
        if (process.env.WEBGL === "required") throw new Error(`no WebGL2 in ${BROWSER}: the ways in are never tested`);
        console.log("     (no WebGL2 here: the ways in are not tested)");
        return;
      }
      p.on("console", (m) => { if (m.type() === "error") problems.push(`console.error: ${m.text()}`); });
      await p.addInitScript(WATCH);
      await fn(p, octx);
    });
  };
  const flags = (extra) => SITE + (prefix ? prefix + "&gpu=force" : "?gpu=force") + extra;
  const linesOf = (p) => p.evaluate(() => window.__lines.map((l) => l.text));
  const waitLine = (p, re, ms = 120000) => p.waitForFunction((src) => window.__lines.some((l) => new RegExp(src).test(l.text)), re.source, { timeout: ms });
  const waitGate = (p, ms = 120000) => p.waitForFunction(() => { const g = document.getElementById("gate"); return g && !g.disabled; }, null, { timeout: ms });
  /* the first time the gate was enabled: the lines that had been said by then, and the gate's state at each line */
  const firstEnabled = (p) => p.evaluate(() => (window.__gate.find((g) => !g.disabled) || null));
  const stateAt = (p, re) => p.evaluate((src) => { const l = window.__lines.find((x) => new RegExp(src).test(x.text)); return l ? l.disabled : undefined; }, re.source);

  await step(`L1, L2 #116: the gate waits for the world and the flight, then flies; nothing is stored under fit=skip${prefix ? " (preview)" : ""}`, async () => {
    await withGL(async (p) => {
      await p.goto(flags("&fit=skip"), { waitUntil: "load" });
      await waitGate(p);
      const g = await firstEnabled(p);
      if (!g) throw new Error("the gate was enabled but no change of it was seen");
      if (!g.lines.some((t) => SKIPPED.test(t))) throw new Error(`the gate was enabled before 'flight world: on (fitness skipped)' was on the console: ${JSON.stringify(g.lines.filter((t) => /flight/.test(t)))}`);
      if (!g.lines.some((t) => FLIGHT_READY.test(t))) throw new Error(`the gate was enabled before 'flight: ready' was on the console: ${JSON.stringify(g.lines.filter((t) => /flight/.test(t)))}`);
      await p.locator("#gate").click();
      try { await p.locator("#warpgl").waitFor({ state: "attached", timeout: 30000 }); }
      catch { throw new Error("the gate was enabled and clicked, but the flight never drew #warpgl"); }
      const keys = await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("orbit-fit")));
      if (keys.length) throw new Error(`fit=skip stored a verdict: ${JSON.stringify(keys)}`);
    });
  });

  /* L4: the software renderer is unfit, so a load without fit=skip leaves { fit: false } under its key; the next load
     in the same context says it remembered the off and tested again, and the gate still waits for the new verdict */
  await step(`L4 #116: an unfit verdict is remembered and tested again; the gate waits for the new verdict${prefix ? " (preview)" : ""}`, async () => {
    await withGL(async (p) => {
      await p.goto(flags(""), { waitUntil: "load" });
      await waitLine(p, /flight world: off: frame \d+ ms/);
      await waitGate(p);
      const first = await linesOf(p);
      if (first.some((t) => /remembered/.test(t))) throw new Error(`the first load (nothing kept) said something was remembered: ${JSON.stringify(first.filter((t) => /remembered/.test(t)))}`);
      const kept = await p.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith("orbit-fit"))));
      const keys = Object.keys(kept);
      if (keys.length !== 1 || !/llvmpipe|softpipe|swiftshader/i.test(keys[0])) throw new Error(`want one orbit-fit key, under the software renderer's name; kept ${JSON.stringify(keys)}`);
      let v; try { v = JSON.parse(kept[keys[0]]); } catch { v = null; }
      if (!v || v.fit !== false) throw new Error(`want { fit: false } under ${keys[0]}; kept ${JSON.stringify(kept[keys[0]])}`);
      /* the second load, the same context */
      await p.goto(flags(""), { waitUntil: "load" });
      await waitLine(p, /flight world: off: frame \d+ ms/);
      await waitGate(p);
      const second = await linesOf(p);
      if (!second.some((t) => /flight world: remembered off \(frame \d+ ms\), tested again/.test(t))) throw new Error(`the second load did not say 'remembered off (frame N ms), tested again': ${JSON.stringify(second.filter((t) => /flight/.test(t)))}`);
      const g = await firstEnabled(p);
      if (!g || !g.lines.some((t) => /flight world: off: frame \d+ ms/.test(t))) throw new Error(`the gate was enabled on the second load before 'flight world: off: frame N ms': ${JSON.stringify(g && g.lines.filter((t) => /flight/.test(t)))}`);
    });
  });

  /* L5: a pass remembered under the key of 6.4 (the renderer read first): the proof is left to leisure and the gate opens
     before the verdict line; with nothing remembered the proof is at once and the gate opens only after the line */
  for (const remembered of [true, false]) {
    await step(`L5 #116: ${remembered ? "a remembered pass opens the gate before the verdict line" : "control, nothing remembered: the gate opens only after the verdict line"}${prefix ? " (preview)" : ""}`, async () => {
      await withGL(async (p, octx) => {
        if (remembered) {
          const key = await p.evaluate(() => {
            const gl = document.createElement("canvas").getContext("webgl2");
            const e = gl.getExtension("WEBGL_debug_renderer_info");
            const renderer = String(e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
            return `orbit-fit ${renderer} ${screen.width}x${screen.height}@${devicePixelRatio}`;
          });
          await octx.addInitScript(([k]) => { try { localStorage.setItem(k, JSON.stringify({ t: Date.now() - 2 * 864e5, fit: true, ms: 12 })); } catch { /* about:blank has none */ } }, [key]);
        }
        await p.goto(flags(""), { waitUntil: "load" });
        await waitLine(p, VERDICT);
        await waitGate(p);
        const lines = await linesOf(p);
        const prove = lines.filter((t) => /prove: /.test(t));
        const want = remembered ? /prove: at leisure \(remembered on, \d+ d ago\)/ : /prove: at once \(nothing remembered\)/;
        if (!prove.some((t) => want.test(t))) throw new Error(`want ${want}; the console said ${JSON.stringify(prove)}`);
        const atLine = await stateAt(p, VERDICT);
        if (remembered && atLine !== false) throw new Error(`the gate was still disabled when the verdict line was said (${atLine}): a remembered pass should have opened it already`);
        if (!remembered && atLine !== true) throw new Error(`the gate was already enabled when the verdict line was said (${atLine}): with nothing remembered it should wait for it`);
      });
    });
  }

  /* L6 (6.8): arriving at a pad by its address before the flight is ready, its Back is closed (aria-disabled,
     tabindex -1); pressed then it does nothing, and the attributes go when the flight is ready; pressed after, the descent runs */
  const JOURNEY_CLASSES = ["showwarp", "withdrawing", "showdawn", "dispersing", "farewell", "holding"];
  await step(`L6 #116: a pad's Back is closed until the flight is ready, then opens${prefix ? " (preview)" : ""}`, async () => {
    await withGL(async (p) => {
      await p.goto(flags("&fit=skip#install"), { waitUntil: "load" });
      const back = "#installpad .back.dawn";
      await p.locator(back).waitFor({ state: "attached", timeout: 30000 });
      /* pressed while closed: the attributes are read and the control clicked in one go, then watched until it opens */
      const closed = await p.evaluate(([sel, classes]) => {
        const el = document.querySelector(sel);
        const was = { ariaDisabled: el.getAttribute("aria-disabled"), tabindex: el.getAttribute("tabindex") };
        window.__seen = new Set(document.body.classList);
        new MutationObserver(() => { for (const c of document.body.classList) window.__seen.add(c); }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
        window.__opened = null;
        new MutationObserver(() => {
          if (window.__opened === null && el.getAttribute("aria-disabled") !== "true") window.__opened = { classes: classes.filter((c) => document.body.classList.contains(c)), tabindex: el.getAttribute("tabindex") };
        }).observe(el, { attributes: true, attributeFilter: ["aria-disabled", "tabindex"] });
        if (was.ariaDisabled === "true") el.click();
        return was;
      }, [back, JOURNEY_CLASSES]);
      if (closed.ariaDisabled !== "true" || closed.tabindex !== "-1") throw new Error(`on arrival, before the flight was ready, ${back} should carry aria-disabled="true" and tabindex="-1"; it carried ${JSON.stringify(closed)}`);
      await p.waitForFunction(() => window.__opened !== null, null, { timeout: 120000 });
      const opened = await p.evaluate(() => window.__opened);
      if (opened.classes.length) throw new Error(`the click made while closed started the journey: at the moment the control opened the body carried ${JSON.stringify(opened.classes)}`);
      if (opened.tabindex === "-1") throw new Error("the control opened but still carries tabindex=\"-1\"");
      /* pressed after: the descent runs */
      await p.locator(back).click();
      await p.locator("#door.shown").waitFor({ state: "attached", timeout: 60000 });
      const seen = await p.evaluate(() => [...window.__seen]);
      if (!seen.includes("showdawn")) throw new Error(`the descent never showed the dawn (body classes seen: ${JSON.stringify(seen)})`);
    });
  });
  await step(`L6 #116 control: with the flight already ready, a pad's Back is open on arrival${prefix ? " (preview)" : ""}`, async () => {
    await withGL(async (p) => {
      await p.goto(flags("&fit=skip"), { waitUntil: "load" });
      await waitGate(p);
      await p.locator("#door .planet[data-section=install].ready").waitFor({ state: "attached", timeout: 60000 });
      await p.evaluate(() => document.querySelector("#door .planet[data-section=install]").click());
      await p.locator("#installpad").waitFor({ state: "visible", timeout: 30000 });
      const at = await p.evaluate(() => { const el = document.querySelector("#installpad .back.dawn"); return { ariaDisabled: el.getAttribute("aria-disabled"), tabindex: el.getAttribute("tabindex") }; });
      if (at.ariaDisabled === "true" || at.tabindex === "-1") throw new Error(`the flight was ready, yet the pad's Back arrived closed: ${JSON.stringify(at)}`);
    });
  });
  /* #113 (ADR-0004 6e, J1): where the door's pictures are decoded is said once a page, on the console, and the pictures
     still arrive. In Firefox they are decoded by the browser's image loader (the page path, ?gpu=force as above); in
     Chromium they are not; Firefox with &decode=blob is the control, today's route. Behaviour only: no step reads a frame
     time. `install: ready` is the world's own line; the door's picture lines under ?door3d (`strip:`, `upload:`) are not required here: their text could not be confirmed on this runner. */
  const LOADER = "pictures: decoded by the image loader";
  const consoleOf = async (url, until, ms) => {
    const wctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    try {
      const wpage = await wctx.newPage();
      const messages = [];
      let met = () => {};
      const metP = new Promise((ok) => { met = ok; });
      wpage.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
      wpage.on("console", (m) => {
        const text = m.text();
        messages.push(text);
        if (m.type() === "error") problems.push(`console.error: ${text}`);
        if (until.every((u) => messages.some((t) => t.includes(u)))) met();
      });
      if (!(await wpage.evaluate(() => !!document.createElement("canvas").getContext("webgl2")))) return null;
      await wpage.goto(url, { waitUntil: "load" });
      let timer;
      const timedOut = new Promise((ok) => { timer = setTimeout(ok, ms); });
      try { await Promise.race([metP, timedOut]); } finally { clearTimeout(timer); }
      await wpage.waitForTimeout(3000);
      return messages;
    } finally { await wctx.close(); }
  };
  const join = prefix ? prefix + "&" : "?";
  const said = (messages) => messages.filter((t) => t.includes(LOADER)).length;
  await step(`the pictures are decoded by the image loader in Firefox only${prefix ? " (preview)" : ""}`, async () => {
    const world = await consoleOf(SITE + join + "gpu=force#install", ["install: ready"], 90000);
    if (!world) { if (process.env.WEBGL === "required") throw new Error(`no WebGL2 in ${BROWSER}`); console.log("     (no WebGL2 here: not judged)"); return; }
    if (!world.some((t) => t.includes("install: ready"))) throw new Error("the install world never logged 'install: ready' within 90s");
    const want = BROWSER === "firefox" ? 1 : 0;
    if (said(world) !== want) throw new Error(`the console carries '${LOADER}' ${said(world)} time(s) in ${BROWSER}, want ${want}`);
    const fell = world.filter((t) => t.includes("is drawn, not photographed") || t.includes("orbit: no map"));
    if (fell.length) throw new Error(`a world fell back to drawn textures: ${fell[0]}`);
    if (BROWSER === "firefox") {
      const live = await consoleOf(SITE + join + "door3d&gpu=force", ["upload:"], 40000);
      if (live) {
        if (said(live) !== 1) throw new Error(`under ?door3d the console carries '${LOADER}' ${said(live)} time(s), want 1`);
      }
    }
  });
  if (BROWSER === "firefox") {
    await step(`the control: &decode=blob keeps today's route and the pictures still arrive${prefix ? " (preview)" : ""}`, async () => {
      const world = await consoleOf(SITE + join + "gpu=force&decode=blob#install", ["install: ready"], 90000);
      if (!world) { if (process.env.WEBGL === "required") throw new Error(`no WebGL2 in ${BROWSER}`); console.log("     (no WebGL2 here: not judged)"); return; }
      if (!world.some((t) => t.includes("install: ready"))) throw new Error("with &decode=blob the install world never logged 'install: ready' within 90s");
      if (said(world) !== 0) throw new Error(`with &decode=blob the console carries '${LOADER}' ${said(world)} time(s), want 0`);
      const fell = world.filter((t) => t.includes("is drawn, not photographed") || t.includes("orbit: no map"));
      if (fell.length) throw new Error(`with &decode=blob a world fell back to drawn textures: ${fell[0]}`);
      const live = await consoleOf(SITE + join + "door3d&gpu=force&decode=blob", ["upload:"], 40000);
      if (live) {
        if (said(live) !== 0) throw new Error(`under ?door3d&decode=blob the console carries '${LOADER}' ${said(live)} time(s), want 0`);
      }
    });
  }
  await step(`a docs page opens${prefix ? " (preview)" : ""}`, async () => {
    await page.goto(SITE + prefix + "#docs/readme", { waitUntil: "load" });
    await page.locator("#docspad").waitFor({ state: "visible", timeout: 60000 });
    /* the README page is Orbit's landing, as Orbit wrote it (#78): the reader shows it with text, and its first
       picture is a copy under assets/docs/img/ that has loaded, so the copied pictures (#72) load under the policy */
    try { await page.locator("#docspad .reader").waitFor({ state: "visible", timeout: 30000 }); }
    catch { throw new Error("the README page never opened in the docs reader within 30s"); }
    try { await page.waitForFunction(() => document.querySelector("#docspad .reader div.body")?.textContent.trim().length > 0, null, { timeout: 30000 }); }
    catch { throw new Error("the docs reader opened on the README page but held no text within 30s"); }
    const first = page.locator("#docspad .reader div.body img").first();
    try { await first.waitFor({ state: "attached", timeout: 30000 }); }
    catch { throw new Error("the README page shows no picture: no img in the docs reader within 30s"); }
    const src = await first.getAttribute("src");
    if (!String(src).startsWith("assets/docs/img/")) throw new Error(`the README page's first picture is ${JSON.stringify(src)}, want a copy under assets/docs/img/`);
    await first.scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => {});
    try {
      await page.waitForFunction(() => { const i = document.querySelector("#docspad .reader div.body img"); return !!i && i.complete && i.naturalWidth > 0; }, null, { timeout: 30000 });
    } catch { throw new Error(`the README page's first picture (${src}) never loaded within 30s (naturalWidth 0: missing, or refused by the page's policy)`); }
  });
  /* the diagram is on a page that has one: in the current import only the architecture page holds figure[data-mermaid] */
  await step(`a docs diagram draws${prefix ? " (preview)" : ""}`, async () => {
    await page.goto(SITE + prefix + "#docs/architecture", { waitUntil: "load" });
    await page.locator("#docspad").waitFor({ state: "visible", timeout: 60000 });
    try { await page.locator("#docspad figure[data-mermaid] svg").first().waitFor({ state: "attached", timeout: 30000 }); }
    catch { throw new Error("the docs diagram (figure[data-mermaid]) never drew an svg within 30s"); }
  });
  /* Back pressed in mid-flight is honoured: the door's planet is clicked and
     Back follows on the next frame, before the flight can land. */
  await step(`Back mid-flight returns to the door${prefix ? " (preview)" : ""}`, async () => {
    await inOwnContext({}, async (p) => {
      await p.goto(SITE + prefix, { waitUntil: "load" });
      await p.locator("#door .planet[data-section=install].ready").waitFor({ state: "attached", timeout: 60000 });
      await p.evaluate(() => {
        document.querySelector("#door .planet[data-section=install]").click();
        requestAnimationFrame(() => history.back());
      });
      /* the click took effect: the pad opened (it shows at the click itself) */
      try { await p.locator("#installpad").waitFor({ state: "visible", timeout: 2000 }); }
      catch { throw new Error("the click on the install planet never opened #installpad, so Back mid-flight was not tested"); }
      /* then Back is honoured: the pad closes and the door is shown. A flight
         that ignored Back keeps the pad open (or lands on it), so this
         times out and reports what it saw. Headless Chromium without WebGL takes
         30-45 s to unwind the flight, so the wait is generous; it is only
         spent in full when Back is ignored. */
      const state = () => p.evaluate(() => {
        const shown = (sel) => { const el = document.querySelector(sel); if (!el) return false; const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
        return { pad: shown("#installpad"), door: shown("#door"), hash: location.hash };
      });
      const t0 = Date.now();
      let seen = await state();
      while (!(!seen.pad && seen.door) && Date.now() - t0 < 60000) { await p.waitForTimeout(100); seen = await state(); }
      if (seen.pad || !seen.door) throw new Error(`after Back, within 60s: #installpad visible ${seen.pad}, #door visible ${seen.door}, location.hash ${JSON.stringify(seen.hash)}`);
      if (seen.hash !== "") throw new Error(`location.hash is ${JSON.stringify(seen.hash)} after Back, want ""`);
    });
  });
};
if (maintenance) {
  console.log("     (and the landings, past the door with ?preview)");
  await landings("?preview");
} else {
  await landings("");
}

/* the page served for a missing address is 404.html's own: its title and its heading, read from the file */
await step("404 is the site's own", async () => {
  const file = readFileSync(join(here, "..", "..", "404.html"), "utf8");
  const want = { title: /<title>([^<]+)<\/title>/.exec(file)?.[1], heading: /<h1[^>]*>([^<]+)<\/h1>/.exec(file)?.[1] };
  if (!want.title || !want.heading) throw new Error("404.html has no title or heading to compare with");
  expectNotFound = true;
  try {
    const res = await page.goto(SITE + "no-such-page", { waitUntil: "load" });
    if (res.status() !== 404) throw new Error(`status ${res.status()}`);
    const got = { title: await page.title(), heading: (await page.locator("h1").first().innerText()).trim() };
    if (got.title !== want.title.trim()) throw new Error(`title ${JSON.stringify(got.title)}, 404.html's is ${JSON.stringify(want.title.trim())}`);
    if (got.heading !== want.heading.trim()) throw new Error(`heading ${JSON.stringify(got.heading)}, 404.html's is ${JSON.stringify(want.heading.trim())}`);
  } finally { await page.waitForTimeout(300); expectNotFound = false; }
});
} finally {
  await browser?.close().catch(() => {});
  server?.kill();
}
const real = problems.filter((p) => !/favicon/.test(p));
if (real.length) { console.log("\njourney: failed"); for (const p of real) console.log(" - " + p); process.exit(1); }
console.log("\njourney: ok");
