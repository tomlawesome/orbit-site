/*
 * The front door is one surface with stages (owner, sealed): the dawn, the
 * launch, the sky, and the dusk to leave by. This is the switch.
 */
import { initTheme, bindSwatches, mountTiledSky, mountFlightSky, mountGrain, DAWN_FAR, DAWN_NEAR, DUSK_FAR, DUSK_NEAR } from "./sky.js";
import * as home from "./home.js";
import { createPlayer } from "./tour.js";
import { recall, households } from "./data.js";
import * as law from "./law.js";
import { mountRasters, createJourney, UP, UP_RING, RIGHT, LEFT, docsFlight, demoFlight } from "./flight.js";
import { SECTIONS, createDocs, createInfo, wirePlanets } from "./pads.js";
import { createInstall } from "./install.js";
import { openChores, hurryChores } from "./chores.js";

const $ = (s) => document.querySelector(s);
initTheme();
bindSwatches();

const skyCams = mountTiledSky($("#sky"), "home");
mountGrain($(".grain"));
mountFlightSky($("#door .dsky"), DAWN_FAR, DAWN_NEAR, "lg");
mountFlightSky($("#dusk .dsky"), DUSK_FAR, DUSK_NEAR, "dk");
/* each surface's glows are drawn the first time it is shown, after its first
   frame is on screen, so the picture is up before the work behind it starts */
/* the glows are pictures now (tools/glows.cjs): mountRasters only keeps the rays turning about the sunrise point */
const dawnRasters = mountRasters($("#door .world"), {}, "dawn");
/* the Earth under the dawn: two pictures, asked for once the dawn is being drawn, each shown when it has come */
function loadEarth() {
  const world = $("#door .world");
  for (const im of world.querySelectorAll(".earth image[data-href]")) {
    im.addEventListener("load", () => { im.classList.add("in"); if (im.classList.contains("pre")) world.classList.add("earthy"); }, { once: true });
    im.setAttribute("href", im.dataset.href); im.removeAttribute("data-href");
  }
}
const startDawn = () => { loadEarth(); dawnRasters.start(); };

/* ── every journey ready before it is asked for ─────────────────────────────
   Once the door's first picture is in, each journey is fetched and made ready
   in the background, in the order people take them: the demo (the flight up,
   whose world every other flight shares), then the install's world, then the
   docs, then the information's pictures, each begun when the browser is idle
   so the door never drops a frame for it. On a connection that asks to save data, nothing is
   fetched until it is wanted. The pictures are kept by the site's cache (sw.js). */
const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200));
let warmingAll = null;
function warmJourneys() {
  if (warmingAll) return warmingAll;
  if (navigator.connection?.saveData) return (warmingAll = Promise.resolve());
  /* all asked for at once, so their pictures all start down the wire now; the work each needs on the page and the GPU
     is queued as chores (chores.js) in this order, and done a piece at a time once the door has come up */
  const all = [
    journey.warm(),                    /* 1. the demo (and the docs' flight, which is the same flight's world) */
    PADS.install.ring.prepare?.(),     /* 2. the install */
    PADS.docs.ring.ready?.(),          /* 3. the docs */
    PADS.info.world?.prepare?.(),      /* 4. the information's world */
  ];
  warmingAll = Promise.all(all.map((p) => Promise.resolve(p).catch(() => {})));
  return warmingAll;
}
/* a journey waits for what it needs, but never long: past the cap it goes with what it has */
const within = (p, ms) => Promise.race([Promise.resolve(p).catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
const duskRasters = mountRasters($("#dusk .world"), {}, "dusk");
let dawnDrawn = false, duskDrawn = false;
const afterFirstFrame = (fn) => requestAnimationFrame(() => setTimeout(fn, 0));
recall();
home.mountHome(skyCams);
const player = createPlayer();

let arrived = false;
try { arrived = sessionStorage.getItem("orbit-site-arrived") === "1"; } catch { /* this visit only */ }
const wantsDrawer = location.hash === "#key" ? "keydrawer" : location.hash === "#inbox" ? "inboxdrawer" : null;
const wantsPad = ({ "#install": "install", "#docs": "docs", "#info": "info" })[location.hash.split("/")[0]] ?? null;
/* the landings: each a pad, a ring, and a way to fly there */
const PADS = {
  install: { el: $("#installpad"), profile: UP_RING },
  docs: { el: $("#docspad"), profile: RIGHT },
  info: { el: $("#infopad"), profile: LEFT },
};
/* the information's world: the install's own, its planet coral (the map turned, no rings, a warm haze), lit from
   above so it rests as a great crescent under the title, the camera coming round to it from the other side */
const INFO_WORLD = {
  /* no rings to line up with its picture on the door: it comes in on its own line */
  sprite: null,
  world: { hue: 100, sat: 1.12, ringsOn: false, haze: [1.0, 0.8, 0.72],
    /* the coral of its door: the map's light and shade graded deep rust → coral → pale peach, a little of its own colour kept */
    grade: [[0.09, 0.018, 0.012], [0.62, 0.17, 0.11], [0.98, 0.72, 0.58], 0.85] },
  tune: {
    sun: [0.12, 0.82, 0.42], tiltZ: -0.22, tiltX: 0.1,
    sky: { core: [0.32, -0.3], along: [-0.55, 0.15] },
    look: { galK: 0.03 },
    /* it dives straight at the planet, and only late lets it settle beneath, a crescent under the title */
    aim: [0.42, 0.58],
    /* it comes in from above, on the sun's side, so the planet it dives at is lit, and drops to rest beneath the crescent */
    rest: { az: 0.55, el: -0.08, roll: -0.06, d: 3.0 }, from: { az: 0.3, el: 0.72, roll: -0.18 },
    fly: { k: 0.89, side: [1.2, -0.7], r: 0.2 },
    land: { R: 1.0, cx: 0.0, cy: -1.14, moon: [0.34, 0.28], moonR: 8.0 },
    port: { R: 0.72, cx: 0.0, cy: -0.98, moon: [0.3, 0.2], moonR: 8.0 },
  },
};
for (const [id, pad] of Object.entries(PADS)) {
  mountTiledSky(pad.el.querySelector(".sky"), `pad-${id}`);
  if (id === "info") pad.world = createInstall(pad.el, INFO_WORLD);
  pad.ring = id === "install" ? createInstall(pad.el) : id === "docs" ? createDocs(pad.el) : createInfo(pad.el, pad.world);
}
/* the worlds dived into (the install's, the information's): the shot is the world's */
const shotOf = (pad) => pad.world || pad.ring;
let current = null;   /* "door" | "home" | a pad id */
const visibleGlyph = () => (current === "home" ? $("#dial") : current && PADS[current] ? PADS[current].el.querySelector(".ring") : $("#login-glyph svg"));

const journey = createJourney({
  canvas: $("#warp"), mark: $("#flightmark"), name: $("#launchname"),
  dawnGlyph: () => $("#login-glyph svg"), duskGlyph: () => $("#dusk-glyph svg"),
  on: {
    /* the descent from the sky: it disperses, and the dusk comes up under the cooling dawn */
    dusk() { const d = $("#dusk"); d.hidden = false; },
    farewell() { const h = $("#home"); h.classList.remove("shown"); h.hidden = true; },
  },
});

function hideAll() {
  $("#home").classList.remove("shown"); $("#home").hidden = true; player.hide();
  $("#dusk").hidden = true;
  for (const pad of Object.values(PADS)) { pad.ring.stop(); pad.world?.stop(); pad.el.hidden = true; }
  document.body.classList.remove("arrived");
}
/* a first visit: nothing of the site's kept in this browser yet (sw.js keeps the pictures for 36 hours) */
const firstVisit = (() => { try { const seen = localStorage.getItem("orbit-site-seen"); localStorage.setItem("orbit-site-seen", String(Date.now())); return !seen || Date.now() - +seen > 36 * 3600e3; } catch { return true; } })();
let doorLitOnce = false;
function showDoor() {
  journey.reset(); hideAll(); current = "door";
  const door = $("#door");
  if (!dawnDrawn) { dawnDrawn = true; afterFirstFrame(startDawn); }
  door.hidden = false; door.classList.add("shown");
  document.body.classList.add("at-door"); document.body.classList.remove("lit");
  /* first light. The ring is a light running its circle (body.loading) while the dawn's first pieces come (the type,
     the Earth's first picture), a lap at a time, each lap ending in a breath; when they have come it finishes the lap
     it is on and goes straight into its own drawing, and the rest comes up after it. On a first visit it always runs
     at least a lap, and keeps on (three at most) until the first journey is ready too: the journeys start coming the
     moment the dawn's pieces are in, so the laps, and then the reveal, and then the time spent taking the door in,
     are when they come. On a later visit, with everything kept (sw.js), it comes straight up. */
  const world = $("#door .world"), pre = world.querySelector(".earth image.pre");
  const earthHere = world.classList.contains("earthy") || !pre ? Promise.resolve()
    : new Promise((r) => { pre.addEventListener("load", r, { once: true }); pre.addEventListener("error", r, { once: true }); });
  const critical = Promise.all([document.fonts?.ready, earthHere]);
  const firstLight = !doorLitOnce; doorLitOnce = true;
  const minLaps = firstLight && firstVisit ? 1 : 0;
  let here = false;
  critical.then(() => { here = true; warmJourneys(); });
  let lit = false;
  /* the reveal takes about three seconds; the chores (the GPU's share of readying the journeys) wait for it to end */
  const light = () => { if (lit) return; lit = true; requestAnimationFrame(() => { document.body.classList.remove("loading"); document.body.classList.add("lit"); warmJourneys(); setTimeout(openChores, 3400); }); };
  within(critical, 250).then(() => {
    if (here && !minLaps) { light(); return; }
    document.body.classList.add("loading");
    const ring = $("#door .lockup .ring:not(.lux)");
    let laps = 0;
    const lap = () => {
      laps++;
      const enough = here && laps >= minLaps;
      if (enough || laps >= 6) { ring?.removeEventListener("animationiteration", lap); light(); }
    };
    ring?.addEventListener("animationiteration", lap);
    /* without the animation (reduced motion), just the pieces */
    if (!ring || getComputedStyle(ring).animationName === "none") within(critical, 8000).then(light);
    setTimeout(light, 11000);
  });
  /* the docs' chart is read early, so the flight there can carry it; the world is baked while the door is quiet */
}
/* leaving whatever is on screen: the door is let go by the flight, a landing is left behind it */
function leaveCurrent() {
  if (current === "door") { $("#door").classList.remove("shown"); setTimeout(() => { $("#door").hidden = true; }, 800); }
  else if (current && PADS[current]) { const pad = PADS[current]; pad.ring.stop(); pad.world?.stop(); setTimeout(() => { pad.el.hidden = true; }, 800); document.body.classList.remove("arrived"); }
  else if (current === "home") { const h = $("#home"); h.classList.remove("shown"); player.hide(); setTimeout(() => { h.hidden = true; }, 800); }
}
/* a section: the flight there, and the landing */
/* the install is a shot rather than a flight: the camera goes to the planet that was clicked */
let sceneTimer = 0;
const planetOf = (id) => { const planet = $(`#door .planet[data-section="${id}"]`); return { planet, body: planet.querySelector(".body") }; };
function goToWorld(id = "install") {
  const pad = PADS[id], door = $("#door"), shot = shotOf(pad);
  planets.hide(); player.stop(true); home.closeDrawers();
  clearTimeout(sceneTimer);
  /* from anywhere but the door, the dawn comes up under what is leaving */
  if (current !== "door") {
    leaveCurrent();
    if (!dawnDrawn) { dawnDrawn = true; afterFirstFrame(startDawn); }
    door.hidden = false; door.classList.add("shown"); document.body.classList.add("at-door", "lit");
  }
  const scene = planetOf(id);
  scene.planet.classList.add("chosen");
  /* the camera finds the planet: the door racks out of focus behind it, and it swells and glows */
  document.body.classList.add("departing", "racking");
  /* once the world's own sky has filled the frame, the door behind it is let go, so it is not drawn (blurred) for nothing */
  scene.near = (u) => { if (u > 0.32) document.body.classList.add("covered"); };
  pad.el.classList.add("forming"); pad.el.classList.remove("formed"); pad.el.hidden = false; current = id;
  try { history.replaceState(null, "", `#${id}`); } catch { /* fine */ }
  shot.form(scene).then(() => {
    if (current !== id) return;
    pad.el.classList.remove("forming"); pad.el.classList.add("formed");
    document.body.classList.add("instrument", "arrived");
    if (pad.world) pad.ring.start();   /* the information's scenes, over its world */
    /* the door goes once the sky is all the world's */
    sceneTimer = setTimeout(() => {
      if (current !== id) return;
      door.classList.remove("shown"); door.hidden = true;
      document.body.classList.remove("departing", "racking", "covered", "at-door"); scene.planet.classList.remove("chosen");
    }, 600);
  });
}
/* back to the dawn: the same shot out, the planet set down on its orbit wherever it has got to */
function leaveWorld() {
  const id = current, pad = PADS[id], door = $("#door"), shot = shotOf(pad);
  clearTimeout(sceneTimer);
  if (!dawnDrawn) { dawnDrawn = true; afterFirstFrame(startDawn); }
  if (pad.world) { pad.ring.stop(); pad.el.querySelector(".scroll").scrollTop = 0; pad.el.style.setProperty("--worldA", 1); shot.start(); }
  const scene = planetOf(id);
  scene.planet.classList.add("chosen");
  /* the door comes back soft, and comes into focus as the camera reaches it; the dot takes the planet back */
  scene.near = (u) => {
    if (u < 0.32) document.body.classList.remove("covered");
    if (u < 0.3) document.body.classList.remove("racking");
    if (u < 0.15) document.body.classList.remove("departing");
  };
  document.body.classList.add("departing", "racking", "covered", "at-door", "lit");
  document.body.classList.remove("instrument", "arrived");
  door.hidden = false; door.classList.add("shown");
  pad.el.classList.add("forming"); pad.el.classList.remove("formed");
  shot.unform(scene).then(() => {
    shot.stop(); pad.el.hidden = true; pad.el.classList.remove("forming"); current = "door";
    document.body.classList.remove("departing", "racking", "covered"); scene.planet.classList.remove("chosen");
    try { history.replaceState(null, "", " "); } catch { /* fine */ }
  });
}
function flyToPad(id) {
  /* a journey starts the moment it is chosen. The dives hold on the planet swelling as the camera finds it until their
     world is ready (install.js: form); the flights hold on the mark lifting to the centre (flight.js: fly) */
  hurryChores(id === "docs" ? ["flight", "docs"] : id === "install" || id === "info" ? id : "flight");
  if (id === "install" || id === "info") { shotOf(PADS[id]).prepare?.(); goToWorld(id); return; }
  flyNow(id, Promise.all([journey.warm(), id === "docs" ? PADS.docs.ring.ready?.() : null]));
}
function flyNow(id, ready = null) {
  const pad = PADS[id], sec = SECTIONS[id];
  planets.hide(); player.stop(true); home.closeDrawers();
  /* the docs' flight carries the chart, asked for when it is first wanted (the flight may start before the chart
     has been read; it is wanted only at the end) */
  let carried = null;
  const carry = () => carried || (carried = pad.ring.flight?.() || null);
  pad.flown = id === "docs" ? docsFlight({ get rect() { return carry()?.rect; }, get geometry() { return carry()?.geometry; } }) : pad.profile;
  journey.fly(pad.flown, {
    title: sec.title, subtitle: sec.subtitle, glyph: visibleGlyph, ready,
    on: {
      release: leaveCurrent,
      /* the docs are ready to read as the sky lands; the others wait for their instrument */
      land() { pad.el.hidden = false; current = id; if (carry()) pad.ring.settle(); if (id === "docs") pad.ring.start(); try { if (!location.hash.startsWith(`#${id}/`)) history.replaceState(null, "", `#${id}`); } catch { /* fine */ } },
      settled() { document.body.classList.remove("at-door"); document.body.classList.add("arrived"); if (id !== "docs") pad.ring.start(); },
    },
  });
}
function arrivePad(id) {
  const pad = PADS[id];
  /* arriving straight at a landing: what it needs is wanted now */
  hurryChores(id, 1500);
  $("#door").hidden = true; document.body.classList.remove("at-door");
  pad.el.hidden = false; current = id;
  document.body.classList.add("instrument", "arrived"); if (id === "install" || pad.world) pad.el.classList.add("formed"); pad.world?.start(); pad.ring.start();
}
/* back to the dawn: the descent, setting down on the door */
function backToDawn() {
  const pad = PADS[current]; if (!pad) { showDoor(); return; }
  if (current === "install" || current === "info") { leaveWorld(); return; }
  hurryChores(["flight", "docs"]);
  /* the docs go back out through their galaxy, even if they were come to straight (a link), not flown to */
  if (current === "docs" && !pad.flown) {
    let carried = null; const carry = () => carried || (carried = pad.ring.flight?.() || null);
    pad.flown = docsFlight({ get rect() { return carry()?.rect; }, get geometry() { return carry()?.geometry; } });
  }
  /* the landing is left as it is (its chart still on it) until the flight has covered it, and set straight after */
  journey.descend({ title: SECTIONS[current].title, subtitle: "back to the dawn", onto: "dawn", from: pad.flown || pad.profile, on: {
    surface() { const door = $("#door"); if (!dawnDrawn) { dawnDrawn = true; afterFirstFrame(startDawn); } door.hidden = false; document.body.classList.add("at-door", "lit"); },
    farewell() { const door = $("#door"); door.classList.add("shown"); pad.ring.stop(); pad.el.hidden = true; current = "door"; document.body.classList.remove("arrived", "showdawn", "dispersing", "farewell"); try { history.replaceState(null, "", " "); } catch { /* fine */ } },
  } });
}

/* the gate: the flight, whole — 4.8 seconds of climb, the bare sky, the
   instrument two seconds after it (the app's own beats, to the millisecond) */
function launch() {
  if (current === "door") $("#gate").classList.add("flash");
  hurryChores("flight");
  launchNow(journey.warm());
}
function launchNow(ready = null) {
  try { sessionStorage.setItem("orbit-site-arrived", "1"); } catch { /* this visit only */ }
  planets.hide();
  const h = home.household();
  /* the other households pass on the way, each as its own dial would draw it */
  const SEC = { sage: "#8fbf9f", blue: "#8fb8ff", sand: "#d8b45a", plum: "#b79ae0" };
  const others = Object.values(households).filter((o) => o.id !== h.id).map((o) => ({
    name: o.name,
    bodies: o.items.filter((it) => it.status === "active").map((it) => { const p = law.dialPlacement(law.daysBetween(new Date(new Date().setHours(0, 0, 0, 0)), it.dueDate)); const r = 22 + Math.min(1, Math.max(0, (p.radius - 40) / 140)) * 58; return [Math.cos(p.angle) * r, Math.sin(p.angle) * r, SEC[o.sections.find((sc) => sc.id === it.section)?.accent] || "#8fb8ff", 3.2]; }),
  }));
  journey.fly(demoFlight(others), { title: h.name, subtitle: "welcome back", glyph: visibleGlyph, ready, on: {
    release: leaveCurrent,
    land() { const el = $("#home"); el.hidden = false; el.classList.add("shown"); home.renderGalaxy(); current = "home"; try { history.replaceState(null, "", " "); } catch { /* fine */ } },
    settled() { document.body.classList.remove("at-door"); if (wantsDrawer) home.openDrawer(wantsDrawer, true); player.show(); },
  } });
}

/* arriving already signed in: no flight, the sky is simply there */
function arrive() {
  const homeEl = $("#home");
  $("#door").hidden = true; document.body.classList.remove("at-door"); current = "home";
  homeEl.hidden = false; home.renderGalaxy();
  requestAnimationFrame(() => homeEl.classList.add("shown"));
  if (wantsDrawer) setTimeout(() => home.openDrawer(wantsDrawer, true), 900);
  player.show();
}

function signOut() {
  if (!duskDrawn) { duskDrawn = true; afterFirstFrame(duskRasters.start); }
  player.stop(false);
  home.closeDrawers();
  try { sessionStorage.removeItem("orbit-site-arrived"); } catch { /* this visit only */ }
  const h = home.household();
  journey.descend({ title: h.name, on: { farewell() { current = "dusk"; player.hide(); } } });
}

/* from the sky back to the dawn: the climb run backwards, landing on the door as the landings' "— the dawn" does */
function homeToDawn() {
  if (current !== "home") return;
  player.stop(false); home.closeDrawers();
  try { sessionStorage.removeItem("orbit-site-arrived"); } catch { /* this visit only */ }
  journey.descend({ title: home.household().name, subtitle: "back to the dawn", onto: "dawn", on: {
    surface() { const door = $("#door"); if (!dawnDrawn) { dawnDrawn = true; afterFirstFrame(startDawn); } door.hidden = false; document.body.classList.add("at-door", "lit"); },
    farewell() {
      const h = $("#home"); h.classList.remove("shown"); h.hidden = true; player.hide();
      $("#door").classList.add("shown"); $("#gate").classList.remove("flash"); current = "door";
      document.body.classList.remove("arrived", "showdawn", "dispersing", "farewell");
      try { history.replaceState(null, "", " "); } catch { /* fine */ }
      warmJourneys();
    },
  } });
}
home.onBackHome(homeToDawn);
$("#gate").addEventListener("click", launch);
$("#signout").addEventListener("click", signOut);
$("#gate-back").addEventListener("click", showDoor);
const planets = wirePlanets($("#door"), flyToPad);
for (const pad of Object.values(PADS)) {
  pad.el.querySelector(".back.dawn").addEventListener("click", backToDawn);
}
/* the one line, copied wherever it is written */
document.querySelectorAll("[data-copy]").forEach((el) => {
  const was = el.textContent;
  el.addEventListener("click", () => {
    navigator.clipboard?.writeText(el.dataset.copy).then(() => {
      el.dataset.done = "1"; if (el.tagName !== "CODE") el.textContent = "copied";
      setTimeout(() => { delete el.dataset.done; if (el.tagName !== "CODE") el.textContent = was; }, 1600);
    });
  });
});

if (wantsPad) arrivePad(wantsPad); else if (arrived || wantsDrawer) arrive(); else showDoor();
/* arriving anywhere but the door, the journeys are readied all the same, a little later */
if (current !== "door") setTimeout(() => { warmJourneys(); openChores(); }, 4000);
/* the site's own cache (sw.js): pictures kept a day, the code always fresh */
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => { /* fine without it */ }); });
}
