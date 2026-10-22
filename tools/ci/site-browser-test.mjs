/*
 * Live test for seven small site behaviours that only a real browser can show (#12), written from the specification
 * alone (B1 to B7) and judged through what a visitor or a console can see: the page's markup, its classes, its text,
 * its console, its history, and what the browser reports about its own work.
 *
 *   B1  a burst of 20 window resizes within 200 ms on the home view draws the galaxy once, after the burst.
 *       Counted as batches of changes to the nodes inside #galaxy (one render is one batch). Controls: nothing
 *       changes while the page is idle, and one real resize does redraw it.
 *   B2  the install page opened after the shared WebGL world's context was lost (lost at the door, with the world
 *       prepared and nobody holding it) takes the flat path (#installpad.flat), nothing draws to the lost context,
 *       and no WebGL error is logged; the information page, which draws the same world, likewise. Controls: the
 *       world was prepared (`install: ready`), the install page was not flat before, and the loss took.
 *   B3  a docs page whose fetch finishes after the visitor has left the docs leaves the reader closed and adds no
 *       history entry. Control: the same page, not left, does open in the reader.
 *   B4  stopping the walk during "Other households" leaves the dial on the visitor's own household and no flight
 *       (#hero.flying) running when the transport says "Your sky is back". Control: the stop did land
 *       mid-flight.
 *   B5  stopping the walk during "Add" leaves the real create form's fields and type buttons as they were.
 *       Control: the walk did change them first.
 *   B6  while the walk is paused the veil's mask (#veilmask) is not rebuilt every frame: at most a few changes in
 *       one second. Control: the veil is showing, so the mask is in use.
 *   B7  the install page's second dive, after a first one that was painted flat because the planet's map failed
 *       to load, forms (#installpad.formed) and is lit and no longer flat, once the map loads. Controls: the world
 *       was prepared and the map failure was logged; the first dive was painted flat and formed; the retry fetched
 *       the map and it did not fail again.
 *   B8  the docs pad tells a network failure from a drawing fault: an index that fails to fetch shows "The docs have not
 *       been imported"; an index that fetches but whose drawing throws (the test makes the chart's and list's markup
 *       throw when it is put in the pad) does not show that, and the fault is logged with console.error, carrying the
 *       thrown error. Controls: the failed fetch does show it; the same page undisturbed draws the docs; the
 *       disturbance did fire on the fault visit.
 *   B9  a docs page with a heading titled "Mermaid" (so id="mermaid", which the browser also exposes as the page-wide
 *       name `mermaid`) before its diagram still draws the diagram as an <svg> within 30 s, and does not fall back to the
 *       diagram's source shown as code (pre.code[data-lang="mermaid"]); the heading is on the page and is the element
 *       with that id. Control: the same page without that heading draws the <svg> (the library loads from
 *       cdn.jsdelivr.net, so this case needs the network).
 *
 *   PLAYWRIGHT_ROOT=<playwright package dir> HEADED=1 LIBGL_ALWAYS_SOFTWARE=1 \
 *     xvfb-run -a -s "-screen 0 1280x800x24" node tools/ci/site-browser-test.mjs
 *
 * Firefox must be headed here for a WebGL2 world (B2 and B7 only; the rest do not need one). BROWSER=chromium for another
 * engine. A case that cannot be judged says so and fails, rather than passing for nothing.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const playwright = createRequire(import.meta.url)(process.env.PLAYWRIGHT_ROOT || "playwright");
const BROWSER = process.env.BROWSER || "firefox";
const PORT = 8796;
const SITE = `http://127.0.0.1:${PORT}/`;
const here = dirname(fileURLToPath(import.meta.url));

const server = spawn(process.execPath, [join(here, "serve.mjs"), String(PORT)], { stdio: ["ignore", "ignore", "inherit"] });
const results = [];
let browser = null;

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
/* poll `read` until `ok(value)` or `ms` run out; returns the last value read */
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

/* a console message that is the browser (or the page) reporting a WebGL fault: an error mentioning WebGL, or the
   driver's own warning ("WebGL warning: drawArrays: ..." in Firefox, "WebGL: INVALID_OPERATION: ..." in Chromium).
   The plain "WebGL context was lost." warning is not one: the door and the flight print it on purpose when they
   give a context back. */
const isWebglFault = (m) => (m.type === "error" && /webgl|\bgl\b|context/i.test(m.text)) || /WebGL warning|WebGL: [A-Z_]+|GL_INVALID|CONTEXT_LOST_WEBGL|INVALID_(OPERATION|ENUM|VALUE|FRAMEBUFFER)/.test(m.text);

/* a page with the harness's listeners; page errors are kept on the page object for the cases to judge */
const open = async (ctx) => {
  const page = await ctx.newPage();
  page.errors = [];
  page.log = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => page.log.push({ type: m.type(), text: m.text(), at: Date.now() }));
  return page;
};

/* the home view, entered through the gate; the walk's transport is on once the home is up */
const enterHome = async (page) => {
  await page.goto(`${SITE}?preview#home`, { waitUntil: "load" });
  await page.locator("#gate").waitFor({ state: "visible", timeout: 60000 });
  await page.locator("#gate").click();
  await page.locator("#transport.on").waitFor({ state: "attached", timeout: 60000 });
  /* the sky is up and settled before anything is measured */
  await page.waitForFunction(() => !document.querySelector("#home").hidden && !/launching|showwarp/.test(document.body.className), null, { timeout: 60000 });
  await sleep(1500);
};

const walkName = (page) => page.locator("#transport .name").textContent();
const playLabel = (page) => page.locator("#tp-play").getAttribute("aria-label");
/* start the walk at a chapter by its tick (the ticks are labelled with the chapter names) */
const startAt = async (page, chapter) => {
  await page.locator("#tp-play").click({ force: true });
  await until(() => playLabel(page), (l) => /pause/i.test(l), 5000);
  await page.locator(`#transport .tick[aria-label="${chapter}"]`).first().click({ force: true });
  const name = await until(() => walkName(page), (n) => n === chapter, 5000);
  if (name !== chapter) throw new Error(`the walk did not go to "${chapter}" (the transport says ${JSON.stringify(name)})`);
};
const stopWalk = (page) => page.locator("#tp-stop").click({ force: true });

/* ── B1, B5, B6: one home view ─────────────────────────────────────────────────────────────────────────── */
const homeCases = async (ctx, background) => {
  let page = null;
  try { page = await open(ctx); await enterHome(page); } catch (e) {
    for (const id of ["B1", "B5", "B6"]) { console.log(`FAIL ${id} the home view did not come up: ${e.message.split("\n")[0]}`); results.push({ id, problems: ["the home view did not come up"] }); }
    await page?.close();
    return;
  }
  await runCase("B1", "a burst of 20 resizes draws the galaxy once", async (want) => {
    await page.evaluate(() => {
      window.__galaxyDraws = 0;
      new MutationObserver(() => { window.__galaxyDraws++; }).observe(document.querySelector("#galaxy"), { subtree: true, childList: true });
    });
    const draws = () => page.evaluate(() => window.__galaxyDraws);
    /* control 1: idle, nothing changes inside the galaxy */
    await sleep(800);
    const idle = await draws();
    want(idle === 0, `control: the galaxy changed ${idle} time(s) while the page was idle, so the count says nothing`);
    /* control 2: one real resize does draw it again (so the count can move at all) */
    await page.setViewportSize({ width: 1180, height: 760 });
    const afterOne = await until(draws, (n) => n > idle, 4000);
    want(afterOne > idle, "control: a real window resize never redrew the galaxy, so the count cannot show a redraw");
    await sleep(1000);
    /* the burst: 20 resize events 10 ms apart, 200 ms in all */
    const before = await draws();
    await page.evaluate(() => new Promise((done) => {
      let n = 0;
      const tick = () => { window.dispatchEvent(new Event("resize")); if (++n < 20) setTimeout(tick, 10); else done(); };
      tick();
    }));
    await sleep(1500);
    const burst = (await draws()) - before;
    want.note(`idle ${idle}, one resize ${afterOne - idle}, burst of 20 ${burst}`);
    want(burst === 1, `20 resize events in 200 ms redrew the galaxy ${burst} time(s), want exactly 1 (after the burst)`);
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  /* the rest of the work does not need this page to be quiet: start B2 and B3 now */
  background();

  /* B5 and B6 share one "Add" chapter: pause it (B6), carry on, and stop it (B5) */
  const formState = () => page.evaluate(() => JSON.stringify({
    fields: [...document.querySelectorAll("#createform input, #createform select")].map((e) => `${e.id}=${e.value}`),
    types: [...document.querySelectorAll("#types .ctype")].map((e) => `${e.dataset.type}:${e.getAttribute("aria-pressed")}:${e.className}`),
    drawer: document.querySelector("#createdrawer").className,
  }));
  const baseline = await formState();
  let paused = null;
  let wasChanged = false;
  let after = null;
  let said = "";
  let addError = null;
  try {
    await startAt(page, "Add");
    /* B6: when the veil has cut a hole (its mask holds more than the sheet's white rectangle), pause, then count
       the changes made to the mask over one second */
    const holed = await until(() => page.evaluate(() => document.querySelector("#veilmask").children.length), (n) => n >= 2, 40000, 100);
    await page.locator("#tp-play").click({ force: true });
    const label = await until(() => playLabel(page), (l) => /^play/i.test(l), 3000);
    const veil = await page.locator("#veil").getAttribute("class");
    await page.evaluate(() => {
      window.__maskBuilds = 0;
      new MutationObserver(() => { window.__maskBuilds++; }).observe(document.querySelector("#veilmask"), { subtree: true, childList: true, attributes: true, characterData: true });
    });
    await sleep(300);
    const m0 = await page.evaluate(() => window.__maskBuilds);
    await sleep(1000);
    const m1 = await page.evaluate(() => window.__maskBuilds);
    paused = { label, veil, holes: holed, builds: m1 - m0, name: await walkName(page) };
    /* B5: carry on until the walk has written into the real form, then stop while it is still in "Add" */
    await page.locator("#tp-play").click({ force: true });
    await until(() => playLabel(page), (l) => /pause/i.test(l), 3000);
    const typed = await until(() => page.evaluate(() => document.querySelector("#f-name").value), (v) => v !== "", 40000, 100);
    wasChanged = typed !== "";
    paused.name2 = await walkName(page);
    await stopWalk(page);
    said = await until(() => walkName(page), (n) => /sky is back/i.test(n), 5000);
    after = await until(formState, (s) => s === baseline, 5000, 200);
  } catch (e) { addError = e.message.split("\n")[0]; }

  await runCase("B6", "a paused walk does not rebuild the veil mask every frame", async (want) => {
    if (!paused) throw new Error(addError || "the walk was never paused");
    want(/^play/i.test(paused.label), `control: pausing did not take (the play button says ${JSON.stringify(paused.label)})`);
    want(paused.holes >= 2, "control: the veil never cut a hole in its mask during \"Add\" within 40 s, so there was nothing to rebuild");
    want(paused.veil === "on", `control: the veil is not showing while paused (class ${JSON.stringify(paused.veil)}), so the mask is not in use`);
    want.note(`${paused.builds} mask change(s) in 1 s while paused; ${paused.holes} mask children`);
    want(paused.builds <= 3, `the veil mask was rebuilt ${paused.builds} time(s) in one second while the walk was paused, want at most 3`);
  });
  await runCase("B5", "stopping the walk during Add leaves the create form as it was", async (want) => {
    if (addError) throw new Error(addError);
    want(wasChanged, "control: the walk never wrote into the real create form, so nothing was there to put back");
    want(paused.name === "Add" && paused.name2 === "Add", `control: the walk was not in "Add" when stopped (the transport says ${JSON.stringify(paused.name)}, ${JSON.stringify(paused.name2)})`);
    want(/sky is back/i.test(said), `the transport never said "Your sky is back" after the stop (it says ${JSON.stringify(said)})`);
    if (after !== baseline) {
      const a = JSON.parse(after), b = JSON.parse(baseline);
      const diff = [
        ...a.fields.map((f, i) => (f !== b.fields[i] ? `field ${f} (was ${b.fields[i]})` : null)),
        ...a.types.map((t, i) => (t !== b.types[i] ? `type button ${t} (was ${b.types[i]})` : null)),
        a.drawer !== b.drawer ? `drawer class ${JSON.stringify(a.drawer)} (was ${JSON.stringify(b.drawer)})` : null,
      ].filter(Boolean);
      want(false, `after the stop the create form differs from before the walk: ${diff.join("; ")}`);
    }
  });
  await page.close();
};

/* ── B4: the camera after a stop during "Other households" (its own load: a stop that fails leaves the walk running) ── */
const cameraCase = async (ctx) => {
  let page = null;
  try { page = await open(ctx); await enterHome(page); } catch (e) {
    console.log(`FAIL B4 the home view did not come up: ${e.message.split("\n")[0]}`);
    results.push({ id: "B4", problems: ["the home view did not come up"] });
    await page?.close();
    return;
  }
  await runCase("B4", "stopping the walk during Other households puts the camera back, with no flight running", async (want) => {
    const sky = () => page.evaluate(() => {
      const film = document.querySelector("#film");
      const sun = document.querySelector("#dial .sun-link");
      return {
        household: document.querySelector("#dial-name").textContent,
        flying: document.querySelector("#hero").classList.contains("flying"),
        name: document.querySelector("#transport .name").textContent,
        /* what the walk draws over the screen: its ring, and its callout's words */
        rings: film.querySelectorAll("[class*=ring]").length,
        words: [...film.querySelectorAll("[class*=callout]")].map((e) => e.textContent.trim()).filter(Boolean).join(" / "),
        /* the real sun link, with whatever the walk lifted it by: its own and its parts' classes and styles */
        sun: [sun, ...sun.querySelectorAll("*")].map((e) => `${e.getAttribute("class") || ""}|${e.getAttribute("style") || ""}`).join(";"),
      };
    });
    const first = await sky();
    const own = first.household;
    await startAt(page, "Other households");
    /* the walk flies to another household: stop the moment it is in the air. Control: on the way there the walk
       does draw its ring and its callout, and lifts the sun link */
    let ringSeen = false, wordsSeen = "", sunMoved = false;
    const air = await until(async () => {
      const s = await sky();
      ringSeen ||= s.rings > 0;
      wordsSeen ||= s.words;
      sunMoved ||= s.sun !== first.sun;
      return s;
    }, (s) => s.flying, 40000, 40);
    want(air.flying, "control: the walk never started a flight to another household, so there was nothing to stop mid-flight");
    want(ringSeen, "control: the running walk never drew a ring in #film (an element with 'ring' in its class), so a ring after the stop cannot be told");
    want(!!wordsSeen, "control: the running walk never showed a callout's words in #film, so words after the stop cannot be told");
    want.note(`walk running: ring ${ringSeen}, callout ${JSON.stringify(wordsSeen)}, sun link changed ${sunMoved}`);
    await stopWalk(page);
    const back = await until(sky, (s) => /sky is back/i.test(s.name), 5000, 20);
    const shown = Date.now();
    want(/sky is back/i.test(back.name), `the transport never said "Your sky is back" after the stop (it says ${JSON.stringify(back.name)})`);
    want(!back.flying, "a flight was still running when the transport said \"Your sky is back\"");
    want(back.household === own, `the dial showed ${JSON.stringify(back.household)} when the transport said "Your sky is back", want the visitor's own household ${JSON.stringify(own)}`);
    /* and it stays so: a stopped chapter does not carry on. A flight left running would land on the other household
       a second or two later, and the walk's ring, callout and lift would come back. Watched for 3 s, the first 1.5 s
       after "Your sky is back" being the spec's */
    let strayed = null, ringAgain = null, wordsAgain = null, sunAgain = null;
    while (Date.now() - shown < 3000) {
      const s = await sky();
      if (!strayed && (s.household !== own || s.flying)) strayed = s;
      if (!ringAgain && s.rings > 0) ringAgain = Date.now() - shown;
      if (!wordsAgain && s.words) wordsAgain = { at: Date.now() - shown, words: s.words };
      if (!sunAgain && s.sun !== first.sun) sunAgain = Date.now() - shown;
      await sleep(40);
    }
    want(!strayed, strayed && `after the stop the camera went ${strayed.flying ? "flying" : "to " + JSON.stringify(strayed.household)} again, want the visitor's own household (${JSON.stringify(own)}) and no flight`);
    want(ringAgain === null, `a walk ring was in #film ${ringAgain} ms after "Your sky is back", want none`);
    want(wordsAgain === null, wordsAgain && `walk callout words ${JSON.stringify(wordsAgain.words)} were in #film ${wordsAgain.at} ms after "Your sky is back", want none`);
    want(sunAgain === null, `the real sun link differed from before the walk (lifted or glowing) ${sunAgain} ms after "Your sky is back"`);
  });
  await page.close();
};

/* ── B3: a docs page that arrives after the visitor has left the docs ───────────────────────────────────────── */
const README_TITLE = JSON.parse(readFileSync(join(here, "..", "..", "assets", "docs", "readme.json"), "utf8")).title;
const docsCase = async () => {
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  try {
    /* the docs page's fetch waits until release(); `held` resolves when the page has asked for it */
    const visit = async (leave) => {
      const page = await open(dctx);
      let release = () => {};
      let asked = () => {};
      const holdUp = new Promise((ok) => { release = ok; });
      const held = new Promise((ok) => { asked = ok; });
      await page.route("**/assets/docs/readme.json", async (route) => {
        asked();
        await holdUp;
        await route.continue().catch(() => {});
      });
      await page.goto(`${SITE}?preview#docs/readme`, { waitUntil: "load" });
      await page.locator("#docspad").waitFor({ state: "visible", timeout: 60000 });
      await Promise.race([held, sleep(30000).then(() => { throw new Error("the docs page (assets/docs/readme.json) was never requested"); })]);
      let left = null;
      if (leave) {
        await page.locator("#docspad .back.dawn").click();
        await page.locator("#door").waitFor({ state: "visible", timeout: 30000 });
        await page.waitForFunction(() => { const pad = document.querySelector("#docspad"); const cs = getComputedStyle(pad); return pad.hidden || cs.display === "none" || cs.visibility === "hidden"; }, null, { timeout: 30000 });
        await sleep(500);
        left = await page.evaluate(() => ({ entries: history.length, hash: location.hash }));
      }
      release();
      await sleep(1500);
      const now = await page.evaluate(() => {
        const pad = document.querySelector("#docspad");
        const cs = getComputedStyle(pad);
        return {
          entries: history.length,
          hash: location.hash,
          readerOpen: !pad.querySelector(".reader").hidden,
          readerText: pad.querySelector(".reader").textContent,
          readerTitle: pad.querySelector(".reader .readhead h1").textContent,
          bodyText: pad.querySelector(".reader div.body").textContent.trim(),
          padShown: !pad.hidden && cs.display !== "none" && cs.visibility !== "hidden",
        };
      });
      const errors = page.errors;
      await page.close();
      return { left, now, errors };
    };
    await runCase("B3", "a docs page that arrives after the visitor left the docs stays closed", async (want) => {
      /* control: not left, the page opens in the reader */
      const stayed = await visit(false);
      /* the README page as the committed docs hold it, whether Orbit's README is its old long page or its landing
         (#78): the reader's heading is the page's own title and its body holds the page's text */
      want(stayed.now.readerOpen && stayed.now.readerTitle === README_TITLE && stayed.now.bodyText.length > 0,
        `control: the docs page did not open in the reader when the visitor stayed (open ${stayed.now.readerOpen}, heading ${JSON.stringify(stayed.now.readerTitle)}, want ${JSON.stringify(README_TITLE)}, ${stayed.now.bodyText.length} characters of text), so the held fetch is not what opens it`);
      const gone = await visit(true);
      want(!/^#docs/.test(gone.left.hash), `control: leaving the docs left the address at ${JSON.stringify(gone.left.hash)}`);
      want(!gone.now.readerOpen, "the reader opened after the visitor had left the docs");
      want(!gone.now.padShown, "the docs pad came back after the visitor had left the docs");
      want(!/^#docs/.test(gone.now.hash), `the address went back to ${JSON.stringify(gone.now.hash)} after the visitor had left the docs`);
      const pushed = gone.now.entries - gone.left.entries;
      want(pushed === 0, `the late docs page pushed ${pushed} history entr${pushed === 1 ? "y" : "ies"} (${gone.left.entries} before, ${gone.now.entries} after), want none`);
      want(!gone.errors.length, `page error: ${gone.errors[0]}`);
    });
  } finally { await dctx.close(); }
};

/* ── B8: the docs pad, a failed fetch against a fault in drawing ───────────────────────────────────────────── */
const FAULT = "audit4 drawing fault";
/* makes any chart star or list entry put into the docs pad throw FAULT: through innerHTML, insertAdjacentHTML or a
   node with the class; counts the throws in window.__faults */
const drawingFault = () => {
  window.__faults = 0;
  const inPad = (el) => !!(el && el.closest && el.closest("#docspad"));
  const markup = /class\s*=\s*["']?[^"'>]*\b(star|entry)\b/;
  const fire = () => { window.__faults++; throw new Error("audit4 drawing fault"); };
  const inner = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  Object.defineProperty(Element.prototype, "innerHTML", { ...inner, set(v) { if (inPad(this) && markup.test(String(v))) fire(); return inner.set.call(this, v); } });
  const adj = Element.prototype.insertAdjacentHTML;
  Element.prototype.insertAdjacentHTML = function (where, v) { if (inPad(this) && markup.test(String(v))) fire(); return adj.call(this, where, v); };
  for (const name of ["appendChild", "insertBefore"]) {
    const orig = Node.prototype[name];
    Node.prototype[name] = function (node, ...rest) { if (inPad(this) && node && node.classList && (node.classList.contains("star") || node.classList.contains("entry"))) fire(); return orig.call(this, node, ...rest); };
  }
  for (const name of ["append", "prepend", "replaceChildren"]) {
    const orig = Element.prototype[name];
    Element.prototype[name] = function (...nodes) { if (inPad(this) && nodes.some((n) => n && n.classList && (n.classList.contains("star") || n.classList.contains("entry")))) fire(); return orig.apply(this, nodes); };
  }
};
const docsFaultCase = async () => {
  const fctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  try {
    const visit = async ({ abort = false, fault = false }) => {
      const page = await open(fctx);
      if (fault) await page.addInitScript(drawingFault);
      if (abort) await page.route("**/assets/docs/index.json", (route) => route.abort());
      await page.goto(`${SITE}?preview#docs`, { waitUntil: "load" });
      await page.locator("#docspad").waitFor({ state: "visible", timeout: 60000 });
      /* settled: the docs drawn, or the pad says it has none, or the disturbance fired and its outcome had time to land */
      await page.waitForFunction(() => {
        const pad = document.querySelector("#docspad");
        return pad.querySelector(".entry, .chart .star") || /have not been imported/.test(pad.innerText) || window.__faults > 0;
      }, null, { timeout: 30000 });
      await sleep(2000);
      /* (window.mermaid is not compared with the heading: once the library has loaded, the name is the library's) */
      const seen = await page.evaluate(() => {
        const pad = document.querySelector("#docspad");
        return { notImported: /have not been imported/.test(pad.innerText), drawn: !!pad.querySelector(".entry, .chart .star"), faults: window.__faults || 0 };
      });
      const logged = page.log.filter((m) => m.type === "error" && m.text.includes(FAULT)).length;
      const errors = page.errors.slice();
      await page.close();
      return { ...seen, logged, errors };
    };
    await runCase("B8", "the docs pad tells a failed fetch from a fault in drawing", async (want) => {
      const failed = await visit({ abort: true });
      want(failed.notImported && !failed.drawn, `control: a failed index fetch did not show "The docs have not been imported" (shown: ${failed.notImported}, drawn: ${failed.drawn})`);
      const healthy = await visit({});
      want(healthy.drawn && !healthy.notImported, `control: the undisturbed docs did not draw (drawn: ${healthy.drawn}, "not imported" shown: ${healthy.notImported})`);
      const fault = await visit({ fault: true });
      want(fault.faults > 0, "control: the disturbance never fired, so no drawing fault was made and the case cannot be judged");
      want(!fault.notImported, 'a drawing fault showed "The docs have not been imported", as if the fetch had failed');
      want(fault.logged > 0, `the drawing fault was not logged with console.error carrying the thrown error ("${FAULT}")${fault.errors.length ? `; page errors: ${fault.errors[0]}` : ""}`);
    });
  } finally { await fctx.close(); }
};

/* ── B9: a docs diagram beside a heading titled "Mermaid" ──────────────────────────────────────────────────── */
/* the committed architecture page, cut to its first diagram; `withHeading` puts a section whose heading is titled
   "Mermaid" (id="mermaid") before the diagram */
const mermaidPage = (withHeading) => {
  const page = JSON.parse(readFileSync(join(here, "..", "..", "assets", "docs", "architecture.json"), "utf8"));
  const diagram = page.sections.find((s) => /data-mermaid/.test(s.html));
  if (!diagram) throw new Error("assets/docs/architecture.json holds no figure[data-mermaid] to serve");
  const sections = [page.sections[0]];
  if (withHeading) sections.push({ id: "mermaid", title: "Mermaid", html: '<h2 id="mermaid">Mermaid</h2>\n<p>Diagrams on this page are drawn with the Mermaid library.</p>', summary: "", text: "Mermaid Diagrams on this page are drawn with the Mermaid library.", subs: [] });
  sections.push(diagram);
  return { ...page, sections };
};
const mermaidCase = async () => {
  const mctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  try {
    const visit = async (withHeading) => {
      const page = await open(mctx);
      const body = JSON.stringify(mermaidPage(withHeading));
      await page.route("**/assets/docs/architecture.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
      await page.goto(`${SITE}?preview#docs/architecture`, { waitUntil: "load" });
      await page.locator("#docspad").waitFor({ state: "visible", timeout: 60000 });
      await page.locator("#docspad figure[data-mermaid]").first().waitFor({ state: "attached", timeout: 30000 });
      /* settled: the figure holds an svg, or the source is shown as code, or 30 s have gone */
      const settled = () => page.evaluate(() => {
        const pad = document.querySelector("#docspad");
        return { svg: !!pad.querySelector("figure[data-mermaid] svg"), code: !!pad.querySelector('pre.code[data-lang="mermaid"]') };
      });
      await until(settled, (v) => v.svg, 30000, 250);
      await sleep(1000);
      const seen = await page.evaluate(() => {
        const pad = document.querySelector("#docspad");
        const h = document.getElementById("mermaid");
        const shown = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden"; };
        return {
          figures: pad.querySelectorAll("figure[data-mermaid]").length,
          svgs: pad.querySelectorAll("figure[data-mermaid] svg").length,
          codeShown: [...pad.querySelectorAll('pre.code[data-lang="mermaid"]')].filter(shown).length,
          headingInPad: !!h && pad.contains(h),
          headingTag: h ? h.tagName : "",
          headingText: h ? h.textContent.trim() : "",
          headingShown: shown(h),
        };
      });
      const errors = page.errors.slice();
      await page.close();
      return { ...seen, errors };
    };
    await runCase("B9", 'a docs diagram beside a heading titled "Mermaid" is still drawn as an svg', async (want) => {
      /* control: the same page without that heading draws the diagram */
      const plain = await visit(false);
      want(plain.figures > 0 && plain.svgs > 0 && plain.codeShown === 0,
        `control: the page without a "Mermaid" heading did not draw its diagram as an svg (${plain.figures} figure(s), ${plain.svgs} svg(s), ${plain.codeShown} mermaid source block(s) shown), so the case cannot be judged (does the run reach cdn.jsdelivr.net?)`);
      const clash = await visit(true);
      want(clash.headingInPad && clash.headingShown && clash.headingTag === "H2" && clash.headingText === "Mermaid",
        `control: the "Mermaid" heading was not shown as the element with id "mermaid" (in the pad ${clash.headingInPad}, shown ${clash.headingShown}, ${clash.headingTag} ${JSON.stringify(clash.headingText)})`);
      want(clash.figures > 0 && clash.svgs > 0, `the diagram was not drawn as an svg beside the "Mermaid" heading (${clash.figures} figure(s), ${clash.svgs} svg(s) within 30 s)`);
      want(clash.codeShown === 0, `the diagram's source was shown as code (pre.code[data-lang="mermaid"], ${clash.codeShown} shown) beside the "Mermaid" heading`);
      want(!clash.errors.length, `page error: ${clash.errors[0]}`);
    });
  } finally { await mctx.close(); }
};

/* ── B2: the install page after the shared WebGL world's context was lost ──────────────────────────────────── */
const lostContextCase = async () => {
  const wctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
  try {
    await wctx.addInitScript(() => {
      /* remember every WebGL context made for a canvas, so the test can lose the one the world draws to */
      const make = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        const gl = make.call(this, type, ...rest);
        if (gl && /webgl/.test(String(type))) (window.__gls ||= []).push({ canvas: this, gl });
        return gl;
      };
      /* every call that draws or builds on a context that is already lost (a lost context ignores it, with a
         warning): counted once the test switches the count on */
      window.__lostCalls = { on: false, n: 0, names: {} };
      for (const proto of [window.WebGL2RenderingContext && WebGL2RenderingContext.prototype, window.WebGLRenderingContext && WebGLRenderingContext.prototype]) {
        if (!proto) continue;
        for (const name of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced", "clear", "useProgram", "bindFramebuffer", "texImage2D", "texSubImage2D", "uniform1f", "uniform2f", "uniform3f", "uniform4f"]) {
          const orig = proto[name];
          if (typeof orig !== "function") continue;
          proto[name] = function (...args) {
            const c = window.__lostCalls;
            if (c.on && this.isContextLost()) { c.n++; c.names[name] = (c.names[name] || 0) + 1; }
            return orig.apply(this, args);
          };
        }
      }
    });
    await runCase("B2", "the install page after a lost context takes the flat path, with no WebGL error", async (want) => {
      const page = await open(wctx);
      try {
        if (!(await page.evaluate(() => !!document.createElement("canvas").getContext("webgl2")))) {
          if (process.env.WEBGL === "required" || process.env.HEADED === "1") throw new Error(`no WebGL2 in ${BROWSER}: the install world is never drawn, so its loss cannot be tested`);
          console.log("       B2: (no WebGL2 here: skipped)");
          return;
        }
        /* ?gpu=force: the door refuses the software renderer, so the world is drawn only when forced (as journey.mjs
           does). The world is prepared with the door ("install: ready"), before any page adopts it */
        await page.goto(`${SITE}?preview&gpu=force`, { waitUntil: "load" });
        const seen = (re) => page.log.some((m) => re.test(m.text));
        await until(async () => seen(/install: ready/), (v) => v, 90000, 250);
        want(seen(/install: ready/), "control: the install world never logged 'install: ready' within 90 s, so there was no world to lose");
        await page.locator("#door .planet[data-section=install].ready").waitFor({ state: "attached", timeout: 60000 });
        await sleep(1000);
        const flatBefore = await page.evaluate(() => document.querySelector("#installpad").classList.contains("flat"));
        want(!flatBefore, "control: the install page was flat before any context was lost");
        /* lose the context(s) of the world's canvas while no page holds it */
        const lost = await page.evaluate(() => {
          const out = [];
          for (const { canvas, gl } of window.__gls || []) {
            if (!canvas.classList.contains("orbitgl") || gl.isContextLost()) continue;
            const ext = gl.getExtension("WEBGL_lose_context");
            if (ext) { ext.loseContext(); out.push(gl.isContextLost()); }
          }
          return out;
        });
        want(lost.length > 0, "control: found no live WebGL context on a canvas.orbitgl to lose (the world does not draw to a canvas.orbitgl on the main thread)");
        want(lost.every(Boolean), "control: WEBGL_lose_context.loseContext() did not take (isContextLost() is still false)");
        if (!lost.length) return;
        await sleep(1000);
        /* in: the first page to adopt the world finds it lost */
        const mark = Date.now();
        await page.evaluate(() => { window.__lostCalls.on = true; });
        await page.locator("#door .planet[data-section=install]").evaluate((el) => el.click());
        await page.locator("#installpad").waitFor({ state: "visible", timeout: 60000 });
        const flat = await until(() => page.evaluate(() => document.querySelector("#installpad").classList.contains("flat")), (v) => v, 20000, 100);
        want(flat, "the install page opened after the context was lost did not take the flat path (#installpad has no class 'flat' after 20 s)");
        await sleep(1500);
        /* and out and in to the information page, which draws the same world: a later adopter finds it lost too */
        await page.locator("#installpad .back.dawn").click();
        await page.locator("#door").waitFor({ state: "visible", timeout: 60000 });
        await page.locator("#door .planet[data-section=info].ready").waitFor({ state: "attached", timeout: 60000 });
        await sleep(500);
        await page.locator("#door .planet[data-section=info]").evaluate((el) => el.click());
        await page.locator("#infopad").waitFor({ state: "visible", timeout: 60000 });
        await sleep(2500);
        const calls = await page.evaluate(() => window.__lostCalls);
        const bad = page.log.filter((m) => m.at >= mark && isWebglFault(m));
        want.note(`flat after the loss: ${flat}; calls on a lost context: ${calls.n} ${JSON.stringify(calls.names)}; WebGL errors logged: ${bad.length}`);
        want(!bad.length, `a WebGL error was logged once the pages began to adopt the lost world: ${bad[0] && bad[0].text.slice(0, 160)}`);
        want(calls.n === 0, `the pages made ${calls.n} call(s) to the lost context (${Object.entries(calls.names).map(([k, v]) => `${k} x${v}`).join(", ")}), want none`);
        want(!page.errors.length, `page error: ${page.errors[0]}`);
      } finally { await page.close(); }
    });
  } finally { await wctx.close(); }
};

/* ── B7: the install page's second dive, after a first one that was painted flat because the map failed ──────── */
/* The information page is built by the same factory, with the same `forming` rules and the same lines: it is not
   driven separately. */
const retryCase = async () => {
  const rctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
  try {
    await runCase("B7", "the install page's second dive, after a first one painted flat because the map failed, lands and is lit", async (want) => {
      const page = await open(rctx);
      try {
        if (!(await page.evaluate(() => !!document.createElement("canvas").getContext("webgl2")))) {
          if (process.env.WEBGL === "required" || process.env.HEADED === "1") throw new Error(`no WebGL2 in ${BROWSER}: the install world is never drawn, so its map cannot fail and then load`);
          console.log("       B7: (no WebGL2 here: skipped)");
          return;
        }
        /* the planet's map is the one file that fails (world.js picks planet-2k.webp or planet.webp; the rings and
           the moon are not touched), and then, once `failing` is switched off, loads */
        let failing = true, hits = 0;
        await page.route("**/assets/img/install/planet*.webp", (route) => {
          hits++;
          return failing ? route.fulfill({ status: 503 }) : route.continue();
        });
        await page.goto(`${SITE}?preview&gpu=force`, { waitUntil: "load" });
        const seen = (re) => page.log.some((m) => re.test(m.text));
        const planet = page.locator("#door .planet[data-section=install]");
        const classes = () => page.evaluate(() => { const c = document.querySelector("#installpad").classList; return { flat: c.contains("flat"), lit: c.contains("lit"), formed: c.contains("formed") }; });
        /* control 1: the world is prepared (its way opens on a false bake too) and the failure took */
        await until(async () => seen(/install: ready/), (v) => v, 90000, 250);
        want(seen(/install: ready/), "control: the install world never logged 'install: ready' within 90 s");
        await page.locator("#door .planet[data-section=install].ready").waitFor({ state: "attached", timeout: 60000 });
        want(seen(/orbit: no map/), "control: 'orbit: no map' was not logged, so the planet's map did not fail");
        want(hits >= 1, `control: the planet's map was never requested (${hits} requests)`);
        await sleep(1000);
        /* control 2: the first dive is painted over its poster, as it should be */
        await planet.evaluate((el) => el.click());
        await page.locator("#installpad").waitFor({ state: "visible", timeout: 60000 });
        const first = await until(() => page.evaluate(() => document.querySelector("#installpad").classList.contains("formed")), (v) => v, 20000, 100);
        want(first, "control: the first dive (the map failed) never added 'formed' to #installpad within 20 s");
        /* 'flat' lands after 'formed': the page forms on the false bake, the poster is kept as the bake answers, and
           that bake waits for the door's opening to finish (about 20 s when the dive starts early) */
        const painted = await until(classes, (c) => c.flat, 45000, 100);
        want(painted.flat && !painted.lit, `control: after the failed first dive #installpad should be flat and not lit, but flat is ${painted.flat} and lit is ${painted.lit}`);
        await page.locator("#installpad .back.dawn").click();
        await page.locator("#door").waitFor({ state: "visible", timeout: 60000 });
        await page.locator("#door .planet[data-section=install].ready").waitFor({ state: "attached", timeout: 60000 });
        await sleep(500);
        /* the retry: the line is good now, and the visitor presses Install again */
        failing = false;
        const hitsBefore = hits, logBefore = page.log.length;
        await planet.evaluate((el) => el.click());
        await page.locator("#installpad").waitFor({ state: "visible", timeout: 60000 });
        /* M1a: the page forms (the 6 s wait and about 5 s of shot, with margin; the 15 s let-go never adds 'formed') */
        const formed = await until(() => page.evaluate(() => document.querySelector("#installpad").classList.contains("formed")), (v) => v, 30000, 100);
        const after = await classes();
        want(formed, `the second dive never added 'formed' to #installpad within 30 s (flat ${after.flat}, lit ${after.lit}): the words, back and home stay hidden over a pad nothing draws`);
        /* M1b: the world is lit and the poster is not kept over it */
        const end = await classes();
        want(end.lit && !end.flat, `after the second dive #installpad should be lit and not flat, but lit is ${end.lit} and flat is ${end.flat}`);
        /* control 3: the retry fetched the map, and it did not fail again */
        want(hits > hitsBefore, `control: the retry did not request the planet's map again (${hits} requests, ${hitsBefore} before)`);
        want(!page.log.slice(logBefore).some((m) => /orbit: no map/.test(m.text)), "control: 'orbit: no map' was logged again after the line was good");
        want(!page.errors.length, `page error: ${page.errors[0]}`);
      } finally { await page.close(); }
    });
  } finally { await rctx.close(); }
};

try {
  await new Promise((ok, no) => {
    const t0 = Date.now();
    (async function poll() {
      try { await fetch(SITE); ok(); } catch { Date.now() - t0 > 10000 ? no(new Error("server did not start")) : setTimeout(poll, 100); }
    })();
  });
  browser = await playwright[BROWSER].launch(process.env.HEADED === "1" ? { headless: false } : {});
  /* motion left on: the walk and its flights are what is under test */
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
  /* B2 and B3 use pages of their own and are started once B1 has had the machine to itself; the walk's cases wait
     in real time for the walk, so the others fit into the waiting */
  const others = [];
  const background = () => { others.push(docsCase(), docsFaultCase(), mermaidCase(), lostContextCase().then(retryCase)); };
  await homeCases(ctx, background);
  await cameraCase(ctx);
  await Promise.all(others);
} catch (e) {
  console.log(`FAIL site browser test: ${e.message.split("\n")[0]}`);
  results.push({ id: "setup", problems: [e.message] });
} finally {
  await browser?.close().catch(() => {});
  server.kill();
}

const bad = results.filter((r) => r.problems.length);
console.log(bad.length ? `\nsite-browser-test: failed (${bad.map((r) => r.id).join(", ")})` : "\nsite-browser-test: ok");
process.exit(bad.length ? 1 : 0);
