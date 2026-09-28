/*
 * The front door is one surface with stages (owner, sealed): the dawn, the
 * launch, the sky, and the dusk to leave by. This is the switch.
 */
import { initTheme, bindSwatches, mountTiledSky, mountFlightSky, mountGrain, DAWN_FAR, DAWN_NEAR, DUSK_FAR, DUSK_NEAR } from "./sky.js";
import * as home from "./home.js";
import { createPlayer } from "./tour.js";
import { recall } from "./data.js";
import { DAWN, DUSK, mountRasters, createJourney, UP, RIGHT, LEFT } from "./flight.js";
import { SECTIONS, createRing, wirePlanets } from "./pads.js";

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
const duskRasters = mountRasters($("#dusk .world"), DUSK, "dusk");
let dawnDrawn = false, duskDrawn = false;
const afterFirstFrame = (fn) => requestAnimationFrame(() => setTimeout(fn, 0));
recall();
home.mountHome(skyCams);
const player = createPlayer();

let arrived = false;
try { arrived = sessionStorage.getItem("orbit-site-arrived") === "1"; } catch { /* this visit only */ }
const wantsDrawer = location.hash === "#key" ? "keydrawer" : location.hash === "#inbox" ? "inboxdrawer" : null;
const wantsPad = ({ "#install": "install", "#docs": "docs", "#info": "info" })[location.hash] ?? null;
/* the landings: each a pad, a ring, and a way to fly there */
const PADS = {
  install: { el: $("#installpad"), profile: UP },
  docs: { el: $("#docspad"), profile: RIGHT },
  info: { el: $("#infopad"), profile: LEFT },
};
for (const [id, pad] of Object.entries(PADS)) { mountTiledSky(pad.el.querySelector(".sky"), `pad-${id}`); pad.ring = createRing(pad.el, SECTIONS[id]); }
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
  $("#home").classList.remove("shown"); $("#home").hidden = true;
  $("#dusk").hidden = true;
  for (const pad of Object.values(PADS)) { pad.ring.stop(); pad.el.hidden = true; }
  document.body.classList.remove("arrived");
}
function showDoor() {
  journey.reset(); hideAll(); current = "door";
  const door = $("#door");
  if (!dawnDrawn) { dawnDrawn = true; afterFirstFrame(dawnRasters.start); }
  door.hidden = false; door.classList.add("shown");
  document.body.classList.add("at-door"); document.body.classList.remove("lit");
  requestAnimationFrame(() => setTimeout(() => document.body.classList.add("lit"), 120));
}
/* leaving whatever is on screen: the door is let go by the flight, a landing is left behind it */
function leaveCurrent() {
  if (current === "door") { $("#door").classList.remove("shown"); setTimeout(() => { $("#door").hidden = true; }, 800); }
  else if (current && PADS[current]) { const pad = PADS[current]; pad.ring.stop(); setTimeout(() => { pad.el.hidden = true; }, 800); document.body.classList.remove("arrived"); }
  else if (current === "home") { const h = $("#home"); h.classList.remove("shown"); setTimeout(() => { h.hidden = true; }, 800); }
}
/* a section: the flight there, and the landing */
function flyToPad(id) {
  const pad = PADS[id], sec = SECTIONS[id];
  planets.hide(); player.stop(true); home.closeDrawers();
  journey.fly(pad.profile, {
    title: sec.title, subtitle: sec.subtitle, glyph: visibleGlyph,
    on: {
      release: leaveCurrent,
      land() { pad.el.hidden = false; current = id; try { history.replaceState(null, "", `#${id}`); } catch { /* fine */ } },
      settled() { document.body.classList.remove("at-door"); document.body.classList.add("arrived"); pad.ring.start(); },
    },
  });
}
function arrivePad(id) {
  const pad = PADS[id];
  $("#door").hidden = true; document.body.classList.remove("at-door");
  pad.el.hidden = false; current = id;
  document.body.classList.add("instrument", "arrived"); pad.ring.start();
}
/* back to the dawn: the descent, setting down on the door */
function backToDawn() {
  const pad = PADS[current]; if (!pad) { showDoor(); return; }
  pad.ring.stop();
  journey.descend({ title: SECTIONS[current].title, subtitle: "back to the dawn", onto: "dawn", on: {
    surface() { const door = $("#door"); if (!dawnDrawn) { dawnDrawn = true; afterFirstFrame(dawnRasters.start); } door.hidden = false; document.body.classList.add("at-door", "lit"); },
    farewell() { const door = $("#door"); door.classList.add("shown"); pad.el.hidden = true; current = "door"; document.body.classList.remove("arrived", "showdawn", "dispersing", "farewell"); try { history.replaceState(null, "", " "); } catch { /* fine */ } },
  } });
}

/* the gate: the flight, whole — 4.8 seconds of climb, the bare sky, the
   instrument two seconds after it (the app's own beats, to the millisecond) */
function launch() {
  try { sessionStorage.setItem("orbit-site-arrived", "1"); } catch { /* this visit only */ }
  planets.hide();
  if (current === "door") $("#gate").classList.add("flash");
  const h = home.household();
  journey.fly(UP, { title: h.name, subtitle: "welcome back", glyph: visibleGlyph, on: {
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
  journey.descend({ title: h.name, on: { farewell() { current = "dusk"; } } });
}

$("#gate").addEventListener("click", launch);
$("#signout").addEventListener("click", signOut);
$("#gate-back").addEventListener("click", showDoor);
$("#launch").addEventListener("click", () => flyToPad("install"));
const planets = wirePlanets($("#door"), $("#planet-tip"), flyToPad);
for (const pad of Object.values(PADS)) {
  pad.el.querySelector(".back.dawn").addEventListener("click", backToDawn);
  pad.el.querySelector(".back.tosky").addEventListener("click", launch);
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
