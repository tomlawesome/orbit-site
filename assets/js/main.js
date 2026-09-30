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
  /* the docs' chart is read early, so the flight there can carry it */
  setTimeout(() => PADS.docs.ring.ready?.(), 2500);
}
/* leaving whatever is on screen: the door is let go by the flight, a landing is left behind it */
function leaveCurrent() {
  if (current === "door") { $("#door").classList.remove("shown"); setTimeout(() => { $("#door").hidden = true; }, 800); }
  else if (current && PADS[current]) { const pad = PADS[current]; pad.ring.stop(); setTimeout(() => { pad.el.hidden = true; }, 800); document.body.classList.remove("arrived"); }
  else if (current === "home") { const h = $("#home"); h.classList.remove("shown"); setTimeout(() => { h.hidden = true; }, 800); }
}
/* a section: the flight there, and the landing */
/* the door as a scene the install can move: where its sun rises, the layers
   that carry the light, the ground and the stars, and the planet that was clicked */
function doorScene() {
  const door = $("#door"), w = $(".world", door), r = w.getBoundingClientRect();
  const ox = parseFloat(w.style.getPropertyValue("--ox")), oy = parseFloat(w.style.getPropertyValue("--oy"));
  const planet = $('.planet[data-section="install"]', door);
  return {
    ox: Number.isFinite(ox) ? r.left + ox : innerWidth / 2, oy: Number.isFinite(oy) ? r.top + oy : innerHeight * 0.92,
    glow: $(".sunpt", w), rays: $(".rays", w), ground: [$(".limb", w), $(".shimmerlayer", w), $(".wash", w), $(".sunpt", w), $(".rays", w)],
    stars: $(".dsky", door), dawn: $(".dawnlayer", w), rims: [...w.querySelectorAll(".rim")],
    planet, body: $(".body", planet),
  };
}
/* the install forms rather than flies: the door's own sunrise climbs, and the planet crosses it */
let sceneTimer = 0;
function formEclipse() {
  const pad = PADS.install, door = $("#door");
  planets.hide(); player.stop(true); home.closeDrawers();
  clearTimeout(sceneTimer);
  /* from anywhere but the door, the dawn comes up under what is leaving */
  if (current !== "door") {
    leaveCurrent();
    if (!dawnDrawn) { dawnDrawn = true; afterFirstFrame(dawnRasters.start); }
    door.hidden = false; door.classList.add("shown"); document.body.classList.add("at-door", "lit");
  }
  const scene = doorScene();
  scene.planet.classList.add("chosen");
  document.body.classList.add("eclipsing");
  pad.el.classList.add("forming"); pad.el.hidden = false; current = "install";
  try { history.replaceState(null, "", "#install"); } catch { /* fine */ }
  pad.ring.form(scene).then(() => {
    pad.el.classList.remove("forming"); pad.el.classList.add("formed");
    document.body.classList.add("instrument", "arrived");
    /* the door goes once the install's own sky is in over it */
    sceneTimer = setTimeout(() => {
      if (current !== "install") return;
      door.classList.remove("shown"); door.hidden = true;
      document.body.classList.remove("eclipsing", "at-door"); scene.planet.classList.remove("chosen");
      pad.ring.release(scene);
    }, 1700);
  });
}
function unformEclipse() {
  const pad = PADS.install, door = $("#door");
  clearTimeout(sceneTimer);
  if (!dawnDrawn) { dawnDrawn = true; afterFirstFrame(dawnRasters.start); }
  const scene = doorScene();
  scene.planet.classList.add("chosen");
  document.body.classList.add("eclipsing", "at-door", "lit");
  pad.el.classList.add("forming"); pad.el.classList.remove("formed");
  pad.ring.unform(scene).then(() => {
    door.hidden = false; door.classList.add("shown");
    pad.ring.stop(); pad.el.hidden = true; pad.el.classList.remove("forming"); current = "door";
    document.body.classList.remove("eclipsing", "arrived", "instrument"); scene.planet.classList.remove("chosen");
    try { history.replaceState(null, "", " "); } catch { /* fine */ }
  });
  /* the door is shown once the scene is set, so it comes up already in the eclipse's night */
  requestAnimationFrame(() => { door.hidden = false; door.classList.add("shown"); });
}
function flyToPad(id) {
  if (id === "install") { formEclipse(); return; }
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
  if (current === "install") { unformEclipse(); return; }
  pad.ring.stop();
  journey.descend({ title: SECTIONS[current].title, subtitle: "back to the dawn", onto: "dawn", from: pad.flown || pad.profile, on: {
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
  journey.descend({ title: h.name, on: { farewell() { current = "dusk"; } } });
}

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
