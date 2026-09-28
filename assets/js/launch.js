/*
 * THE LAUNCH — the install page. The same door, the same flight the app
 * makes out of it, and a landing of its own: the ring the mark wears, with
 * the six stages of the install as bodies on it, each lit in turn with the
 * README's own sentence beneath. The one line is on both surfaces.
 */
import { initTheme, mountFlightSky, mountTiledSky, mountGrain, DAWN_FAR, DAWN_NEAR, reduced } from "./sky.js";
import { DAWN, mountRasters, createJourney } from "./flight.js";
import { createScenes } from "./scenes.js";

const $ = (s) => document.querySelector(s);
initTheme();
mountFlightSky($("#door .dsky"), DAWN_FAR, DAWN_NEAR, "lg");
mountTiledSky($("#launchpad .sky"), "pad");
mountGrain($(".grain"));
const rasters = mountRasters($("#door .world"), DAWN, "dawn");
const afterFirstFrame = (fn) => requestAnimationFrame(() => setTimeout(fn, 0));
let dawnDrawn = false;

/* the stages, in the order the installer takes them (README, "Quick start") */
const STAGES = [
  { label: "before anything runs", line: "A signed manifest is verified first." },
  { label: "every file", line: "Its checksum is checked against that manifest — and a second, independent signature, if cosign is installed." },
  { label: "the launcher", line: "Only once everything checks out does it hand off to the launcher: Install, Update, Repair." },
  { label: "the image", line: "Pulled and resolved to an immutable digest. A mutable reference is never deployed." },
  { label: "the stack", line: "orbit, the official PostgreSQL and the isolated scanner — done only once each is healthy." },
  { label: "claim", line: "The last line of the container's log is a one-time link. Open it to create the first administrator." },
];
const SVG = "http://www.w3.org/2000/svg";
const host = $("#ring .stages"), light = $("#ring .light");
const scenes = createScenes($("#launchpad .scenes"), $("#ring"));
addEventListener("resize", () => scenes.resize());
const bodies = STAGES.map((st, i) => {
  const a = (-90 + i * 60) * Math.PI / 180;
  const g = document.createElementNS(SVG, "g");
  g.setAttribute("class", "stage-body"); g.setAttribute("tabindex", "0"); g.setAttribute("role", "button");
  g.setAttribute("aria-label", `${st.label}: ${st.line}`);
  g.style.setProperty("--i", i);
  const cx = (100 + 72 * Math.cos(a)).toFixed(2), cy = (100 + 72 * Math.sin(a)).toFixed(2);
  g.style.transformOrigin = `${cx}px ${cy}px`;
  for (const [cls, r] of [["halo", "11"], ["hit", "14"], ["dot", "5.2"]]) {
    const c = document.createElementNS(SVG, "circle"); c.setAttribute("class", cls); c.setAttribute("cx", cx); c.setAttribute("cy", cy); c.setAttribute("r", r); g.appendChild(c);
  }
  host.appendChild(g);
  g.addEventListener("click", () => { go(i); rest(); });
  g.addEventListener("pointerenter", (e) => { if (e.pointerType !== "touch") { go(i); rest(); } });
  g.addEventListener("focus", () => { go(i); rest(); });
  g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(i); rest(); } });
  return g;
});

/* the light runs the arc from the last body to this one; the caption crossfades */
const stage = $(".stage"), n = stage.querySelector(".n"), label = stage.querySelector(".label"), line = stage.querySelector(".line");
let at = -1, timer = 0, held = 0;
function go(i) {
  if (i === at) return;
  const prev = at; at = i;
  bodies.forEach((b, j) => { b.classList.toggle("on", j === i); b.classList.toggle("done", j < i); });
  const from = prev < 0 ? i * (100 / 6) : prev * (100 / 6), to = i * (100 / 6);
  light.style.transition = "none"; light.style.strokeDasharray = "0.01 100"; light.style.strokeDashoffset = `${-from}`;
  void light.getBoundingClientRect();
  const len = ((to - from) + 100) % 100 || (prev < 0 ? 0 : 100);
  light.style.transition = reduced ? "none" : "stroke-dasharray 1.1s cubic-bezier(.2,.7,.2,1)";
  light.style.strokeDasharray = `${len} 100`;
  scenes.show(i);
  stage.classList.remove("in"); void stage.offsetWidth;
  n.textContent = String(i + 1).padStart(2, "0"); label.textContent = STAGES[i].label; line.textContent = STAGES[i].line;
  stage.classList.add("in");
}
function next() { go((at + 1) % STAGES.length); }
function tick() { clearTimeout(timer); timer = setTimeout(() => { if (Date.now() > held) next(); tick(); }, 4200); }
function rest() { held = Date.now() + 9000; }
function still() { clearTimeout(timer); scenes.stop(); at = -1; bodies.forEach((b) => b.classList.remove("on", "done")); light.style.transition = "none"; light.style.strokeDasharray = "0.01 100"; stage.classList.remove("in"); document.body.classList.remove("arrived"); }

/* the flight: the door leaves, the ring lands, the turn begins */
const journey = createJourney({
  canvas: $("#warp"), mark: $("#flightmark"), name: $("#launchname"),
  dawnGlyph: () => $("#login-glyph svg"), duskGlyph: () => null,
  on: {
    release() { $("#door").classList.remove("shown"); setTimeout(() => { $("#door").hidden = true; }, 800); },
    land() { $("#launchpad").hidden = false; },
    settled() { document.body.classList.remove("at-door"); document.body.classList.add("arrived"); scenes.start(); setTimeout(() => { go(0); tick(); }, reduced ? 100 : 1500); },
  },
});
function showDawn() {
  journey.reset(); still();
  $("#launchpad").hidden = true;
  const door = $("#door");
  if (!dawnDrawn) { dawnDrawn = true; afterFirstFrame(rasters.start); }
  door.hidden = false; door.classList.add("shown");
  document.body.classList.add("at-door"); document.body.classList.remove("lit");
  requestAnimationFrame(() => setTimeout(() => document.body.classList.add("lit"), 120));
}
$("#gate").addEventListener("click", () => { $("#gate").classList.add("flash"); journey.ascend({ title: "Orbit", subtitle: "quick start" }); });
$("#again").addEventListener("click", showDawn);
showDawn();

/* copy the one line */
document.querySelectorAll("[data-copy]").forEach((button) => {
  const was = button.textContent;
  button.addEventListener("click", () => {
    navigator.clipboard?.writeText(button.dataset.copy).then(() => {
      button.dataset.done = "1"; button.textContent = "copied";
      setTimeout(() => { delete button.dataset.done; button.textContent = was; }, 1600);
    });
  });
});
