/*
 * The front door is one surface with stages (owner, sealed): the dawn, the
 * launch, the sky, and the dusk to leave by. This is the switch.
 */
import { initTheme, bindSwatches, mountTiledSky, mountFlightSky, mountGrain, DAWN_FAR, DAWN_NEAR, DUSK_FAR, DUSK_NEAR } from "./sky.js";
import * as home from "./home.js";
import { createPlayer } from "./tour.js";
import { recall, households } from "./data.js";
import * as law from "./law.js";
import { DAWN, DUSK, mountRasters, createJourney, UP, UP_RING, RIGHT, LEFT, docsFlight, demoFlight } from "./flight.js";
import { SECTIONS, createDocs, createInfo, wirePlanets } from "./pads.js";
import { createInstall } from "./install.js";

const $ = (s) => document.querySelector(s);
initTheme();
bindSwatches();

const skyCams = mountTiledSky($("#sky"), "home");
mountGrain($(".grain"));
mountFlightSky($("#door .dsky"), DAWN_FAR, DAWN_NEAR, "lg");
mountFlightSky($("#dusk .dsky"), DUSK_FAR, DUSK_NEAR, "dk");
/* each surface's glows are drawn the first time it is shown, after its first
   frame is on screen, so the picture is up before the work behind it starts */
const dawnRasters = mountRasters($("#door .world"), DAWN, "dawn");
/* the Earth under the dawn: two pictures, asked for once the dawn is being drawn, each shown when it has come */
function loadEarth() {
  const world = $("#door .world");
  for (const im of world.querySelectorAll(".earth image[data-href]")) {
    im.addEventListener("load", () => { im.classList.add("in"); if (im.classList.contains("pre")) { world.classList.add("earthy"); setTimeout(warmJourneys, 300); } }, { once: true });
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
  const step = (fn) => new Promise((r) => idle(() => Promise.resolve().then(fn).catch(() => {}).then(r)));
  const infoShots = () => Promise.all([...document.querySelectorAll("#infopad img[src]")].map((im) => fetch(im.src).catch(() => {})));
  warmingAll = step(() => journey.warm())                    /* 1. the demo */
    .then(() => step(() => PADS.install.ring.prepare?.()))   /* 2. the install */
    .then(() => step(() => PADS.docs.ring.ready?.()))        /* 3. the docs */
    .then(() => step(infoShots));                            /* 4. the information */
  return warmingAll;
}
/* a journey waits for what it needs, but never long: past the cap it goes with what it has */
const within = (p, ms) => Promise.race([Promise.resolve(p).catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
let starting = false;
const startWhen = (p, go) => { if (starting) return; starting = true; within(p, 1800).then(() => { starting = false; go(); }); };
const duskRasters = mountRasters($("#dusk .world"), DUSK, "dusk");
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
for (const [id, pad] of Object.entries(PADS)) { mountTiledSky(pad.el.querySelector(".sky"), `pad-${id}`); pad.ring = id === "install" ? createInstall(pad.el) : id === "docs" ? createDocs(pad.el) : createInfo(pad.el); }
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
  for (const pad of Object.values(PADS)) { pad.ring.stop(); pad.el.hidden = true; }
  document.body.classList.remove("arrived");
}
function showDoor() {
  journey.reset(); hideAll(); current = "door";
  const door = $("#door");
  if (!dawnDrawn) { dawnDrawn = true; afterFirstFrame(startDawn); }
  door.hidden = false; door.classList.add("shown");
  document.body.classList.add("at-door"); document.body.classList.remove("lit");
  requestAnimationFrame(() => setTimeout(() => document.body.classList.add("lit"), 120));
  /* the docs' chart is read early, so the flight there can carry it; the world is baked while the door is quiet */
  setTimeout(warmJourneys, 2500);
}
/* leaving whatever is on screen: the door is let go by the flight, a landing is left behind it */
function leaveCurrent() {
  if (current === "door") { $("#door").classList.remove("shown"); setTimeout(() => { $("#door").hidden = true; }, 800); }
  else if (current && PADS[current]) { const pad = PADS[current]; pad.ring.stop(); setTimeout(() => { pad.el.hidden = true; }, 800); document.body.classList.remove("arrived"); }
  else if (current === "home") { const h = $("#home"); h.classList.remove("shown"); player.hide(); setTimeout(() => { h.hidden = true; }, 800); }
}
/* a section: the flight there, and the landing */
/* the install is a shot rather than a flight: the camera goes to the planet that was clicked */
let sceneTimer = 0;
const installPlanet = () => { const planet = $('#door .planet[data-section="install"]'); return { planet, body: planet.querySelector(".body") }; };
function goToWorld() {
  const pad = PADS.install, door = $("#door");
  planets.hide(); player.stop(true); home.closeDrawers();
  clearTimeout(sceneTimer);
  /* from anywhere but the door, the dawn comes up under what is leaving */
  if (current !== "door") {
    leaveCurrent();
    if (!dawnDrawn) { dawnDrawn = true; afterFirstFrame(startDawn); }
    door.hidden = false; door.classList.add("shown"); document.body.classList.add("at-door", "lit");
  }
  const scene = installPlanet();
  scene.planet.classList.add("chosen");
  /* the camera finds the planet: the door racks out of focus behind it, and it swells and glows */
  document.body.classList.add("departing", "racking");
  /* once the world's own sky has filled the frame, the door behind it is let go, so it is not drawn (blurred) for nothing */
  scene.near = (u) => { if (u > 0.32) document.body.classList.add("covered"); };
  pad.el.classList.add("forming"); pad.el.classList.remove("formed"); pad.el.hidden = false; current = "install";
  try { history.replaceState(null, "", "#install"); } catch { /* fine */ }
  pad.ring.form(scene).then(() => {
    if (current !== "install") return;
    pad.el.classList.remove("forming"); pad.el.classList.add("formed");
    document.body.classList.add("instrument", "arrived");
    /* the door goes once the sky is all the world's */
    sceneTimer = setTimeout(() => {
      if (current !== "install") return;
      door.classList.remove("shown"); door.hidden = true;
      document.body.classList.remove("departing", "racking", "covered", "at-door"); scene.planet.classList.remove("chosen");
    }, 600);
  });
}
/* back to the dawn: the same shot out, the planet set down on its orbit wherever it has got to */
function leaveWorld() {
  const pad = PADS.install, door = $("#door");
  clearTimeout(sceneTimer);
  if (!dawnDrawn) { dawnDrawn = true; afterFirstFrame(startDawn); }
  const scene = installPlanet();
  scene.planet.classList.add("chosen");
  /* the door comes back soft, and comes into focus as the camera reaches it; the dot takes the planet back */
  scene.near = (u) => {
    if (u < 0.32) document.body.classList.remove("covered");
    if (u < 0.3) document.body.classList.remove("racking");
    if (u < 0.05) document.body.classList.remove("departing");
  };
  document.body.classList.add("departing", "racking", "covered", "at-door", "lit");
  document.body.classList.remove("instrument", "arrived");
  door.hidden = false; door.classList.add("shown");
  pad.el.classList.add("forming"); pad.el.classList.remove("formed");
  pad.ring.unform(scene).then(() => {
    pad.ring.stop(); pad.el.hidden = true; pad.el.classList.remove("forming"); current = "door";
    document.body.classList.remove("departing", "racking", "covered"); scene.planet.classList.remove("chosen");
    try { history.replaceState(null, "", " "); } catch { /* fine */ }
  });
}
function flyToPad(id) {
  if (id === "install") { startWhen(PADS.install.ring.prepare?.(), goToWorld); return; }
  startWhen(Promise.all([journey.warm(), id === "docs" ? PADS.docs.ring.ready?.() : null]), () => flyNow(id));
}
function flyNow(id) {
  const pad = PADS[id], sec = SECTIONS[id];
  planets.hide(); player.stop(true); home.closeDrawers();
  /* the docs' flight carries the chart when the chart is ready; otherwise the plain climb */
  const carried = id === "docs" ? pad.ring.flight() : null;
  pad.flown = carried ? docsFlight(carried) : pad.profile;
  journey.fly(pad.flown, {
    title: sec.title, subtitle: sec.subtitle, glyph: visibleGlyph,
    on: {
      release: leaveCurrent,
      land() { pad.el.hidden = false; current = id; if (carried) pad.ring.settle(); try { if (!location.hash.startsWith(`#${id}/`)) history.replaceState(null, "", `#${id}`); } catch { /* fine */ } },
      settled() { document.body.classList.remove("at-door"); document.body.classList.add("arrived"); pad.ring.start(); },
    },
  });
}
function arrivePad(id) {
  const pad = PADS[id];
  $("#door").hidden = true; document.body.classList.remove("at-door");
  pad.el.hidden = false; current = id;
  document.body.classList.add("instrument", "arrived"); if (id === "install") pad.el.classList.add("formed"); pad.ring.start();
}
/* back to the dawn: the descent, setting down on the door */
function backToDawn() {
  const pad = PADS[current]; if (!pad) { showDoor(); return; }
  if (current === "install") { leaveWorld(); return; }
  pad.ring.stop();
  journey.descend({ title: SECTIONS[current].title, subtitle: "back to the dawn", onto: "dawn", from: pad.flown || pad.profile, on: {
    surface() { const door = $("#door"); if (!dawnDrawn) { dawnDrawn = true; afterFirstFrame(startDawn); } door.hidden = false; document.body.classList.add("at-door", "lit"); },
    farewell() { const door = $("#door"); door.classList.add("shown"); pad.el.hidden = true; current = "door"; document.body.classList.remove("arrived", "showdawn", "dispersing", "farewell"); try { history.replaceState(null, "", " "); } catch { /* fine */ } },
  } });
}

/* the gate: the flight, whole — 4.8 seconds of climb, the bare sky, the
   instrument two seconds after it (the app's own beats, to the millisecond) */
function launch() {
  if (current === "door") $("#gate").classList.add("flash");
  startWhen(journey.warm(), launchNow);
}
function launchNow() {
  try { sessionStorage.setItem("orbit-site-arrived", "1"); } catch { /* this visit only */ }
  planets.hide();
  const h = home.household();
  /* the other households pass on the way, each as its own dial would draw it */
  const SEC = { sage: "#8fbf9f", blue: "#8fb8ff", sand: "#d8b45a", plum: "#b79ae0" };
  const others = Object.values(households).filter((o) => o.id !== h.id).map((o) => ({
    name: o.name,
    bodies: o.items.filter((it) => it.status === "active").map((it) => { const p = law.dialPlacement(law.daysBetween(new Date(new Date().setHours(0, 0, 0, 0)), it.dueDate)); const r = 22 + Math.min(1, Math.max(0, (p.radius - 40) / 140)) * 58; return [Math.cos(p.angle) * r, Math.sin(p.angle) * r, SEC[o.sections.find((sc) => sc.id === it.section)?.accent] || "#8fb8ff", 3.2]; }),
  }));
  journey.fly(demoFlight(others), { title: h.name, subtitle: "welcome back", glyph: visibleGlyph, on: {
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
setTimeout(warmJourneys, 4000);
/* the site's own cache (sw.js): pictures kept a day, the code always fresh */
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => { /* fine without it */ }); });
}
