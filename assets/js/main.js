/*
 * The front door is one surface with stages (owner, sealed): the dawn, the
 * launch, the sky, and the dusk to leave by. This is the switch.
 */
import { initTheme, bindSwatches, mountTiledSky, mountFlightSky, mountGrain, DAWN_FAR, DAWN_NEAR, DUSK_FAR, DUSK_NEAR, reduced } from "./sky.js";
import * as home from "./home.js";
import { createPlayer } from "./tour.js";
import { recall } from "./data.js";
import { DAWN, DUSK, mountRasters } from "./flight.js";

const $ = (s) => document.querySelector(s);
initTheme();
bindSwatches();

const skyCams = mountTiledSky($("#sky"), "home");
mountGrain($(".grain"));
mountFlightSky($("#door .dsky"), DAWN_FAR, DAWN_NEAR, "lg");
mountFlightSky($("#dusk .dsky"), DUSK_FAR, DUSK_NEAR, "dk");
mountRasters($("#door .world"), DAWN, "dawn");
mountRasters($("#dusk .world"), DUSK, "dusk");
recall();
home.mountHome(skyCams);
const player = createPlayer();

let arrived = false;
try { arrived = sessionStorage.getItem("orbit-site-arrived") === "1"; } catch { /* this visit only */ }
const wantsDrawer = location.hash === "#install" ? "installdrawer" : location.hash === "#key" ? "keydrawer" : location.hash === "#inbox" ? "inboxdrawer" : null;

function showDoor() {
  const door = $("#door");
  door.hidden = false; door.classList.remove("leaving");
  document.body.classList.add("at-door"); document.body.classList.remove("lit", "farewell");
  $("#home").classList.remove("shown"); $("#home").hidden = true;
  $("#dusk").hidden = true; $("#dusk").classList.remove("shown");
  requestAnimationFrame(() => setTimeout(() => document.body.classList.add("lit"), 120));
}

function launch(fromDoor = true) {
  const door = $("#door"), homeEl = $("#home");
  homeEl.hidden = false;
  home.renderGalaxy();
  requestAnimationFrame(() => homeEl.classList.add("shown"));
  if (fromDoor) {
    $("#gate").classList.add("flash");
    door.classList.add("leaving");
  }
  document.body.classList.remove("at-door");
  const dial = $("#dial");
  dial.classList.remove("arrive"); void dial.offsetWidth; dial.classList.add("arrive");
  setTimeout(() => { door.hidden = true; $("#gate").classList.remove("flash"); }, fromDoor && !reduced ? 1600 : 50);
  try { sessionStorage.setItem("orbit-site-arrived", "1"); } catch { /* this visit only */ }
  if (wantsDrawer) { setTimeout(() => home.openDrawer(wantsDrawer, true), 900); player.show(); return; }
  player.show();
}

function signOut() {
  player.stop(false);
  home.closeDrawers();
  const dusk = $("#dusk");
  dusk.hidden = false;
  requestAnimationFrame(() => { dusk.classList.add("shown"); setTimeout(() => document.body.classList.add("farewell"), 400); });
  try { sessionStorage.removeItem("orbit-site-arrived"); } catch { /* this visit only */ }
}

$("#gate").addEventListener("click", () => launch(true));
$("#signout").addEventListener("click", signOut);
$("#gate-back").addEventListener("click", () => { showDoor(); });

if (arrived || wantsDrawer) {
  $("#door").hidden = true;
  document.body.classList.remove("at-door");
  launch(false);
} else {
  showDoor();
}
