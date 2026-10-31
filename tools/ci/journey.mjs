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
      /* (the verdict line only: the site's own `prove: at once (nothing remembered)` says the word too) */
      if (first.some((t) => /flight world: remembered/.test(t))) throw new Error(`the first load (nothing kept) said the flight world was remembered: ${JSON.stringify(first.filter((t) => /flight world: remembered/.test(t)))}`);
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
     on the remembered pass, which the console says before any verdict line of this visit's own test; with nothing
     remembered the proof is at once and the gate opens only after the verdict line. Whether the gate opened before the
     verdict line is not checked for the remembered case: that test is the leisure re-test, and on a fast or a software
     renderer it can land first (pipeline 3271), while the gate also waits for the flight's load */
  for (const remembered of [true, false]) {
    await step(`L5 #116: ${remembered ? "a remembered pass is what the gate opens on, said before any verdict line" : "control, nothing remembered: the gate opens only after the verdict line"}${prefix ? " (preview)" : ""}`, async () => {
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
        const REMEMBERED = /flight world: remembered on \(frame \d+ ms, \d+ d ago\)/;
        if (remembered) {
          const said = lines.findIndex((t) => REMEMBERED.test(t)), verdict = lines.findIndex((t) => VERDICT.test(t));
          if (said < 0) throw new Error(`want ${REMEMBERED}; the console said ${JSON.stringify(lines.filter((t) => /flight world/.test(t)))}`);
          if (verdict >= 0 && said > verdict) throw new Error(`the remembered pass was said after this visit's verdict line: ${JSON.stringify(lines.filter((t) => /flight world/.test(t)))}`);
          const g = await firstEnabled(p);
          if (!g || !g.lines.some((t) => REMEMBERED.test(t))) throw new Error(`the gate was enabled before the remembered pass was said: ${JSON.stringify(g && g.lines.filter((t) => /flight world/.test(t)))}`);
          return;
        }
        if (lines.some((t) => /flight world: remembered/.test(t))) throw new Error(`nothing was kept, yet the console said the flight world was remembered: ${JSON.stringify(lines.filter((t) => /flight world: remembered/.test(t)))}`);
        const atLine = await stateAt(p, VERDICT);
        if (atLine !== true) throw new Error(`the gate was already enabled when the verdict line was said (${atLine}): with nothing remembered it should wait for it`);
      });
    });
  }

  /* L6 (6.8): arriving at the docs by their address before the flight is ready, their Back (a flight down through the
     world) is closed (aria-disabled, tabindex -1); pressed then it does nothing, and the attributes go when the flight is
     ready; pressed after, the descent runs. The install's and the information's Backs are no flight (main.js leaveWorld),
     so they are open from the first (L6b) */
  const JOURNEY_CLASSES = ["showwarp", "withdrawing", "showdawn", "dispersing", "farewell", "holding"];
  await step(`L6 #116: the docs' Back is closed until the flight is ready, then opens${prefix ? " (preview)" : ""}`, async () => {
    await withGL(async (p) => {
      await p.goto(flags("&fit=skip#docs"), { waitUntil: "load" });
      const back = "#docspad .back.dawn";
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
  await step(`L6 #116 control: with the flight already ready, the docs' Back is open${prefix ? " (preview)" : ""}`, async () => {
    await withGL(async (p) => {
      await p.goto(flags("&fit=skip"), { waitUntil: "load" });
      /* (the gate and the backs open in the same call, main.js openWays(["back"], true): no flight is needed to read them) */
      await waitGate(p);
      const at = await p.evaluate(() => { const el = document.querySelector("#docspad .back.dawn"); return { ariaDisabled: el.getAttribute("aria-disabled"), tabindex: el.getAttribute("tabindex") }; });
      if (at.ariaDisabled === "true" || at.tabindex === "-1") throw new Error(`the gate was open, yet the docs' Back stayed closed: ${JSON.stringify(at)}`);
    });
  });
  await step(`L6b #116: the install's Back, no flight, is open on arrival before the flight is ready${prefix ? " (preview)" : ""}`, async () => {
    await withGL(async (p) => {
      await p.goto(flags("&fit=skip#install"), { waitUntil: "load" });
      await p.locator("#installpad .back.dawn").waitFor({ state: "attached", timeout: 30000 });
      const at = await p.evaluate(() => { const el = document.querySelector("#installpad .back.dawn"); return { ariaDisabled: el.getAttribute("aria-disabled"), tabindex: el.getAttribute("tabindex"), ready: document.body.classList.contains("ready-flight") }; });
      if (at.ariaDisabled === "true" || at.tabindex === "-1") throw new Error(`the install's Back arrived closed: ${JSON.stringify(at)}`);
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
  /* #117 (ADR-0006, B1-B8): the browser's Back and Forward follow the site's own back controls. Back and Forward are
     pressed with history.back() and history.forward(): the browsers' rule that skips an entry a page added without a
     user activation applies to their own buttons only, so it is held by the home test (H1) and B6, not here. Every
     wait is for the element or the address, never for a time. The visitor's previous page is the site's 404.html, so
     "Back leaves the page" is an address that is no longer the site's. B9 (phone Safari) is the owner's, by hand. */
  const sfx = prefix ? " (preview)" : "";
  const FROM = SITE + "404.html";
  const seenOf = async (p) => {
    try {
      return await p.evaluate(() => {
        const shown = (sel) => { const el = document.querySelector(sel); if (!el) return false; const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
        return {
          url: location.href, hash: location.hash, length: history.length, state: JSON.stringify(history.state),
          door: shown("#door"), install: shown("#installpad"), docs: shown("#docspad"), info: shown("#infopad"), home: shown("#home"), dusk: shown("#dusk"),
          reader: shown("#docspad .reader"), arrived: document.body.classList.contains("arrived"), atDoorClass: document.body.classList.contains("at-door"),
          flying: !!document.querySelector("#hero.flying"), back: document.querySelector("#back")?.textContent ?? "", dial: document.querySelector("#dial-name")?.textContent ?? "",
        };
      });
    } catch { return null; }   /* the page is between documents */
  };
  const seeing = async (p, what, ok, ms = 60000) => {
    const t0 = Date.now();
    let seen = await seenOf(p);
    while (!(seen && ok(seen)) && Date.now() - t0 < ms) { await p.waitForTimeout(100); seen = await seenOf(p); }
    if (!(seen && ok(seen))) throw new Error(`${what}, within ${ms / 1000}s: ${JSON.stringify(seen)}`);
    return seen;
  };
  const leftSite = (s) => new URL(s.url).pathname.endsWith("/404.html");
  const atDoor = (s) => s.door && !s.install && !s.docs && !s.info && !s.home && !s.dusk && s.hash === "";
  const onPad = (id) => (s) => s[id] && s.arrived;
  const onSky = (s) => s.home && !s.atDoorClass && !s.flying;
  const ownSky = (name) => (s) => onSky(s) && s.back === "— the dawn" && s.dial === name;
  const otherSky = (name) => (s) => onSky(s) && s.back === "— your sky" && s.dial === name;
  const pressBack = (p) => p.evaluate(() => history.back()).catch(() => {});
  const pressForward = (p) => p.evaluate(() => history.forward()).catch(() => {});
  /* the visitor arrives from the previous page; `flag` is the returning visitor's session flag. Gives history.length before the arrival */
  const arriveAt = async (p, url, flag = false) => {
    await p.goto(FROM, { waitUntil: "load" });
    if (flag) await p.evaluate(() => sessionStorage.setItem("orbit-site-arrived", "1"));
    const before = await p.evaluate(() => history.length);
    await p.goto(SITE + prefix + url, { waitUntil: "load" });
    return before;
  };
  const planetReady = (p, id) => p.locator(`#door .planet[data-section=${id}].ready`).waitFor({ state: "attached", timeout: 60000 });
  /* the planets keep turning, so a pointer click never finds one stable */
  const clickPlanet = async (p, id) => { await planetReady(p, id); await p.evaluate((i) => document.querySelector(`#door .planet[data-section=${i}]`).click(), id); };
  /* through the gate to the visitor's own sky; gives the other households as [id, name] and the own household's name */
  const enterSky = async (p) => {
    await p.locator("#gate").click({ timeout: 60000 });
    const s = await seeing(p, "the gate did not bring up the visitor's sky", onSky);
    const others = await p.evaluate(() => [...document.querySelectorAll("#galaxy .minisys")].map((n) => [n.dataset.id, n.querySelector("text.mslabel")?.textContent ?? ""]));
    if (others.length < 2) throw new Error(`the sky shows ${others.length} other household(s), want 2 or more`);
    return { name: s.dial, others };
  };
  const clickMini = (p, id) => p.evaluate((i) => document.querySelector(`#galaxy .minisys[data-id="${i}"] circle.hit`).dispatchEvent(new MouseEvent("click", { bubbles: true })), id);
  const clickChip = (p, name) => p.evaluate((n) => [...document.querySelectorAll("#chips button")].find((b) => b.textContent === n).click(), name);
  /* (#116 keeps the flight's backs closed and swallows a click until the flight is ready, so wait for that first, as L6 does) */
  const clickDawn = async (p, sel) => {
    await p.waitForFunction((q) => { const el = document.querySelector(q); return !!el && el.getAttribute("aria-disabled") !== "true"; }, sel, { timeout: 120000 });
    await p.evaluate((q) => document.querySelector(q).click(), sel);
  };

  /* B1: from a landing, "— the dawn" is one step back to the door and leaves no second door entry */
  await step(`B1 "— the dawn" from a landing leaves one door entry${sfx}`, async () => {
    const p = page;
    await arriveAt(p, "");
    await clickPlanet(p, "install");
    await seeing(p, "the install landing did not settle", onPad("install"));
    await clickDawn(p, "#installpad .back.dawn");
    await seeing(p, 'after "— the dawn" the door is not shown with the address ""', atDoor);
    await pressBack(p);
    await seeing(p, "Back at the door did not leave the page (a dead press on a second door entry?)", leftSite, 15000);
    await pressForward(p);
    await seeing(p, "Forward did not bring the door back", (s) => !leftSite(s) && s.door && s.hash === "");
    await planetReady(p, "install");
    await pressForward(p);
    await seeing(p, "Forward from the door did not fly to the install landing", (s) => onPad("install")(s) && s.hash === "#install");
  });

  /* B2: from a docs page two entries above the door, "— the dawn" reaches the door in one step and Forward replays the docs */
  await step(`B2 "— the dawn" from a docs page reaches the door in one step${sfx}`, async () => {
    const p = page;
    const before = await arriveAt(p, "");
    await clickPlanet(p, "docs");
    await seeing(p, "the docs landing did not settle", (s) => onPad("docs")(s) && !s.reader);
    await seeing(p, "the docs landing's entry does not say it is one press above the door", (s) => s.state === '{"orbit":1}');
    await p.locator("#docspad .entry").first().waitFor({ state: "attached", timeout: 30000 });
    await p.evaluate(() => document.querySelector("#docspad .entry").click());
    const page1 = await seeing(p, "a page opened from the index did not show in the reader", (s) => s.reader && s.hash.startsWith("#docs/"));
    const slug = JSON.parse(page1.state)?.docs;
    if (!slug || JSON.parse(page1.state).orbit !== 2) throw new Error(`the docs page's entry is ${page1.state}, want { docs, anchor, orbit: 2 }`);
    if (page1.length !== before + 3) throw new Error(`${page1.length} entries after opening a page, want ${before + 3}`);
    await clickDawn(p, "#docspad .back.dawn");
    const door = await seeing(p, 'after "— the dawn" from the page the door is not shown with the address ""', atDoor);
    if (door.length !== before + 3) throw new Error(`${door.length} entries at the door, want ${before + 3} (nothing added or dropped)`);
    await pressForward(p);
    await seeing(p, "the first Forward from the door did not show the docs index", (s) => onPad("docs")(s) && !s.reader && s.hash === "#docs");
    await pressForward(p);
    await seeing(p, "the second Forward did not show the docs page", (s) => s.docs && s.reader && s.hash === page1.hash);
    /* control: Back from the page is the docs' own, to the index, not to the door */
    await pressBack(p);
    const index = await seeing(p, "Back from the page did not show the docs index", (s) => s.docs && !s.reader && s.hash === "#docs");
    if (index.door) throw new Error("Back from the page shows the door too, want the docs index alone");
    /* the index is closed to by the reader's own control, and the entry it pushes carries the count */
    await p.evaluate(() => document.querySelector("#docspad .entry").click());
    await seeing(p, "the page did not open again", (s) => s.reader);
    await clickDawn(p, "#docspad .readhead .todocs");
    const closed = await seeing(p, "the reader's way back to the index did not show the index", (s) => s.docs && !s.reader && s.hash === "#docs");
    if (JSON.parse(closed.state)?.orbit !== 3) throw new Error(`the index entry after closing a page is ${closed.state}, want orbit 3 (landing 1, page 2, index 3)`);
  });

  /* B3: another household's sky is one entry under the visitor's own */
  await step(`B3 Back from another household's sky flies to your own, then to the door${sfx}`, async () => {
    const p = page;
    await arriveAt(p, "");
    await planetReady(p, "install");
    const own = await enterSky(p);
    const [otherId, otherName] = own.others[0], [, thirdName] = own.others[1];
    const before = (await seenOf(p)).length;
    await clickMini(p, otherId);
    const there = await seeing(p, `the click on ${otherName} did not land on its sky`, otherSky(otherName));
    if (there.length !== before + 1) throw new Error(`${there.length} entries after the click on a mini system, want ${before + 1}`);
    await pressBack(p);
    const home = await seeing(p, "Back from another's sky did not fly to the visitor's own", ownSky(own.name));
    if (home.length !== before + 1) throw new Error(`${home.length} entries after Back, want ${before + 1} (Back moves, it adds nothing)`);
    await pressBack(p);
    await seeing(p, "the second Back did not reach the door", atDoor);
    await pressForward(p);
    await seeing(p, "Forward from the door did not fly in to the visitor's sky", ownSky(own.name));
    await pressForward(p);
    await seeing(p, `the second Forward did not fly out to ${otherName}'s sky again`, otherSky(otherName));
    /* control: a hop from there to a third household's chip adds no entry, and Back is still to the visitor's own sky */
    await clickChip(p, thirdName);
    const hopped = await seeing(p, `the chip for ${thirdName} did not land on its sky`, otherSky(thirdName));
    if (hopped.length !== before + 1) throw new Error(`${hopped.length} entries after a hop to a third household, want ${before + 1} (a replace, not a push)`);
    await pressBack(p);
    await seeing(p, "Back from the third household's sky did not fly to the visitor's own", ownSky(own.name));
  });

  /* B4: a direct arrival has no entry below it: Back leaves, and "— the dawn" shows the door with the entries unchanged */
  for (const [label, url, flag, pad, dawn] of [
    ["#install", "#install", false, "install", "#installpad .back.dawn"],
    ["#home (a returning visitor)", "#home", true, "home", "#back"],
    ["#docs/readme", "#docs/readme", false, "docs", "#docspad .back.dawn"],
  ]) {
    const landed = (s) => (pad === "home" ? s.home && !s.flying : pad === "docs" ? s.docs && s.reader : onPad(pad)(s));
    await step(`B4 a direct arrival at ${label}: Back leaves the page; the dawn first shows the door${sfx}`, async () => {
      const before = await arriveAt(page, url, flag);
      await seeing(page, `the direct arrival at ${label} did not land`, landed);
      await pressBack(page);
      await seeing(page, `Back from a direct arrival at ${label} did not leave the page`, leftSite, 15000);
      await fresh();
      await arriveAt(page, url, flag);
      await seeing(page, `the direct arrival at ${label} did not land the second time`, landed);
      await clickDawn(page, dawn);
      const door = await seeing(page, `"— the dawn" from a direct arrival at ${label} did not show the door with the address ""`, atDoor);
      if (door.length !== before + 1) throw new Error(`${door.length} entries at the door, want ${before + 1} (the one entry rewritten, none added)`);
      await pressBack(page);
      await seeing(page, `Back at the door after a direct arrival at ${label} did not leave the page (a dead press?)`, leftSite, 15000);
    });
  }
  /* the docs' entries above a direct arrival carry no count to the door: closing a page there pushes orbit 0 */
  await step(`B4 above a direct arrival the docs' entries count 0${sfx}`, async () => {
    await arriveAt(page, "#docs/readme");
    await seeing(page, "the direct arrival at #docs/readme did not show the page", (s) => s.docs && s.reader);
    await clickDawn(page, "#docspad .readhead .todocs");
    const index = await seeing(page, "the reader's way back to the index did not show the index", (s) => s.docs && !s.reader && s.hash === "#docs");
    if (JSON.parse(index.state)?.orbit !== 0) throw new Error(`the index entry above a direct arrival is ${index.state}, want orbit 0`);
  });

  /* B5: a reload on a landing flown to from the door keeps its entry, so Back after it shows the door */
  for (const [label, how] of [["#install", "planet"], ["#home", "gate"]]) {
    await step(`B5 after a reload on ${label} flown to from the door, Back shows the door${sfx}`, async () => {
      await arriveAt(page, "");
      if (how === "planet") { await clickPlanet(page, "install"); await seeing(page, "the install landing did not settle", onPad("install")); }
      else { await planetReady(page, "install"); await enterSky(page); }
      await page.reload({ waitUntil: "load" });
      await seeing(page, `after the reload ${label} did not come back`, how === "planet" ? onPad("install") : onSky);
      await pressBack(page);
      await seeing(page, `Back after a reload on ${label} did not show the door`, (s) => !leftSite(s) && atDoor(s));
    });
  }

  /* B6: nothing is pushed or replaced on load, or by the walk; a click on a planet is what grows the entries */
  await step(`B6 a load of the door adds no entry; a click on a planet adds one${sfx}`, async () => {
    const p = page;
    const before = await arriveAt(p, "");
    await planetReady(p, "install");
    const loaded = await seenOf(p);
    if (loaded.length !== before + 1) throw new Error(`${loaded.length} entries after loading the door, want ${before + 1} (the load itself)`);
    await clickPlanet(p, "install");
    const landed = await seeing(p, "the install landing did not settle", onPad("install"));
    if (landed.length !== before + 2) throw new Error(`${landed.length} entries after a click on a planet, want ${before + 2}`);
  });
  await step(`B6 a load of #install adds no entry${sfx}`, async () => {
    const before = await arriveAt(page, "#install");
    const landed = await seeing(page, "the direct arrival at #install did not land", onPad("install"));
    if (landed.length !== before + 1) throw new Error(`${landed.length} entries after loading #install, want ${before + 1} (the load itself)`);
  });
  await step(`B6 a returning visitor's load and the walk add no entry; a click on a mini system does${sfx}`, async () => {
    const p = page;
    const before = await arriveAt(p, "", true);
    const up = await seeing(p, "the returning visitor's sky did not come up", (s) => s.home && !s.flying);
    if (up.length !== before + 1) throw new Error(`${up.length} entries after a returning visitor's load, want ${before + 1} (the load itself)`);
    const name = up.dial;
    /* the walk, at the chapter that flies to another household */
    await p.evaluate(() => {
      window.__skies = new Set();
      const dial = document.querySelector("#dial-name");
      new MutationObserver(() => window.__skies.add(dial.textContent)).observe(dial, { childList: true, characterData: true, subtree: true });
    });
    await p.locator("#tp-play").click({ force: true, timeout: 60000 });
    await p.waitForFunction(() => /pause/i.test(document.querySelector("#tp-play").getAttribute("aria-label") || ""), null, { timeout: 10000 });
    await p.locator('#transport .tick[aria-label="Other households"]').first().click({ force: true, timeout: 30000 });
    try { await p.waitForFunction((own) => [...window.__skies].some((n) => n !== own), name, { timeout: 90000 }); }
    catch { throw new Error("the walk never flew to another household, so the walk's entries were not tested"); }
    await p.locator("#tp-stop").click({ force: true, timeout: 30000 });
    const stopped = await seeing(p, "stopping the walk did not bring the visitor's own sky back", (s) => s.home && !s.flying && s.dial === name);
    if (stopped.length !== before + 1) throw new Error(`${stopped.length} entries after the walk stopped, want ${before + 1}`);
    /* control: a click on a mini system is what adds one */
    const others = await p.evaluate(() => [...document.querySelectorAll("#galaxy .minisys")].map((n) => n.dataset.id));
    await clickMini(p, others[0]);
    const clicked = await seeing(p, "the click on a mini system did not land", (s) => s.home && !s.flying && s.dial !== name);
    if (clicked.length !== before + 2) throw new Error(`${clicked.length} entries after a click on a mini system, want ${before + 2}`);
  });

  /* B7: a Back during a flight in the demo is honoured when the flight lands (the door's is the step above) */
  await step(`B7 control: without Back the other household's sky lands${sfx}`, async () => {
    const p = page;
    await arriveAt(p, "");
    await planetReady(p, "install");
    const own = await enterSky(p);
    const [otherId, otherName] = own.others[0];
    await clickMini(p, otherId);
    await seeing(p, `the click on ${otherName} did not land on its sky`, otherSky(otherName));
  });
  await step(`B7 Back during a flight to another household's sky returns to your own${sfx}`, async () => {
    const p = page;
    await arriveAt(p, "");
    await planetReady(p, "install");
    const own = await enterSky(p);
    const [otherId, otherName] = own.others[0];
    const started = await p.evaluate((id) => {
      document.querySelector(`#galaxy .minisys[data-id="${id}"] circle.hit`).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const flying = !!document.querySelector("#hero.flying");
      requestAnimationFrame(() => history.back());
      return flying;
    }, otherId);
    if (!started) throw new Error(`the click on ${otherName} did not start a flight, so Back mid-flight was not tested`);
    const end = await seeing(p, "after Back mid-flight the visitor's own sky did not come back", ownSky(own.name));
    if (end.hash !== "#home") throw new Error(`location.hash is ${JSON.stringify(end.hash)} after Back, want "#home"`);
  });

  /* B8: signing out drops the sky's entries: Back at the goodbye leaves; "Sign back in" shows the door, and Forward flies in */
  const signedOut = async (p) => {
    await arriveAt(p, "");
    await planetReady(p, "install");
    await enterSky(p);
    await p.evaluate(() => document.querySelector("#signout").click());
    await seeing(p, "the goodbye did not show", (s) => s.dusk);
    await seeing(p, 'the goodbye did not clear the address (the sky\'s entries are still there)', (s) => s.dusk && s.hash === "");
  };
  await step(`B8 Back at the goodbye leaves the page${sfx}`, async () => {
    await signedOut(page);
    await pressBack(page);
    await seeing(page, "Back at the goodbye did not leave the page", leftSite, 15000);
  });
  await step(`B8 "Sign back in" shows the door; Forward flies in to the sky${sfx}`, async () => {
    const p = page;
    await signedOut(p);
    await p.locator("#gate-back").click({ timeout: 30000 });
    await seeing(p, '"Sign back in" did not show the door', (s) => s.door && !s.dusk && !s.home && s.hash === "");
    await pressForward(p);
    await seeing(p, "Forward from the door did not fly in to the sky", onSky);
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
