/*
 * The front door is one surface with stages (owner, sealed): the dawn, the
 * launch, the sky, and the dusk to leave by. This is the switch.
 */
import { initTheme, bindSwatches, mountTiledSky, mountFlightSky, mountGrain, DAWN_FAR, DAWN_NEAR, DUSK_FAR, DUSK_NEAR, reduced } from "./sky.js";
import * as home from "./home.js";
import { createPlayer } from "./tour.js";
import { recall } from "./data.js";
import { DAWN, DUSK, mountRasters, createJourney } from "./flight.js";

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
const wantsDrawer = location.hash === "#install" ? "installdrawer" : location.hash === "#key" ? "keydrawer" : location.hash === "#inbox" ? "inboxdrawer" : null;

const journey = createJourney({
  canvas: $("#warp"), mark: $("#flightmark"), name: $("#launchname"),
  dawnGlyph: () => $("#login-glyph svg"), duskGlyph: () => $("#dusk-glyph svg"),
  on: {
    /* the climb: the door is let go, the bare sky lands, the instrument arrives */
    release() { $("#door").classList.remove("shown"); setTimeout(() => { $("#door").hidden = true; }, 800); },
    land() { const h = $("#home"); h.hidden = false; h.classList.add("shown"); home.renderGalaxy(); },
    settled() { document.body.classList.remove("at-door"); if (wantsDrawer) home.openDrawer(wantsDrawer, true); player.show(); },
    /* the descent: the sky disperses, the dusk comes up under the cooling dawn */
    dusk() { const d = $("#dusk"); d.hidden = false; },
    farewell() { const h = $("#home"); h.classList.remove("shown"); h.hidden = true; },
  },
});

function showDoor() {
  journey.reset();
  const door = $("#door");
  if (!dawnDrawn) { dawnDrawn = true; afterFirstFrame(dawnRasters.start); }
  door.hidden = false; door.classList.add("shown");
  document.body.classList.add("at-door"); document.body.classList.remove("lit");
  $("#home").classList.remove("shown"); $("#home").hidden = true;
  $("#dusk").hidden = true;
  requestAnimationFrame(() => setTimeout(() => document.body.classList.add("lit"), 120));
}

/* the gate: the flight, whole — 4.8 seconds of climb, the bare sky, the
   instrument two seconds after it (the app's own beats, to the millisecond) */
function launch() {
  try { sessionStorage.setItem("orbit-site-arrived", "1"); } catch { /* this visit only */ }
  $("#gate").classList.add("flash");
  const h = home.household();
  journey.ascend({ title: h.name, subtitle: "welcome back" });
}

/* arriving already signed in: no flight, the sky is simply there */
function arrive() {
  const homeEl = $("#home");
  $("#door").hidden = true; document.body.classList.remove("at-door");
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
  journey.descend({ title: h.name });
}

$("#gate").addEventListener("click", launch, { once: false });
$("#signout").addEventListener("click", signOut);
$("#gate-back").addEventListener("click", showDoor);

if (arrived || wantsDrawer) arrive(); else showDoor();
