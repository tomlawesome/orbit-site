/*
 * THE LAUNCH — the install page. The dawn the sign-in leaves from, the ring
 * the mark wears, and the install itself as one turn of that ring: each stage
 * a body, lit in order, with the README's own sentence for it beneath.
 */
import { initTheme, mountFlightSky, mountGrain, DAWN_FAR, DAWN_NEAR, reduced } from "./sky.js";
import { DAWN, mountRasters } from "./flight.js";

const $ = (s) => document.querySelector(s);
initTheme();
mountFlightSky($("#door .dsky"), DAWN_FAR, DAWN_NEAR, "lg");
mountGrain($(".grain"));
const rasters = mountRasters($("#door .world"), DAWN, "dawn");
requestAnimationFrame(() => setTimeout(rasters.start, 0));
requestAnimationFrame(() => setTimeout(() => document.body.classList.add("lit"), 120));

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
const bodies = STAGES.map((st, i) => {
  const a = (-90 + i * 60) * Math.PI / 180;
  const g = document.createElementNS(SVG, "g");
  g.setAttribute("class", "stage-body"); g.setAttribute("tabindex", "0"); g.setAttribute("role", "button");
  g.setAttribute("aria-label", `${st.label}: ${st.line}`);
  g.style.setProperty("--i", i);
  const cx = (100 + 72 * Math.cos(a)).toFixed(2), cy = (100 + 72 * Math.sin(a)).toFixed(2);
  g.style.transformOrigin = `${cx}px ${cy}px`;
  const halo = document.createElementNS(SVG, "circle"); halo.setAttribute("class", "halo"); halo.setAttribute("cx", cx); halo.setAttribute("cy", cy); halo.setAttribute("r", "11");
  const hit = document.createElementNS(SVG, "circle"); hit.setAttribute("class", "hit"); hit.setAttribute("cx", cx); hit.setAttribute("cy", cy); hit.setAttribute("r", "14");
  const dot = document.createElementNS(SVG, "circle"); dot.setAttribute("class", "dot"); dot.setAttribute("cx", cx); dot.setAttribute("cy", cy); dot.setAttribute("r", "5.2");
  g.append(halo, hit, dot); host.appendChild(g);
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
  light.style.transition = "none"; light.style.strokeDasharray = `0.01 100`; light.style.strokeDashoffset = `${-from}`;
  void light.getBoundingClientRect();
  const len = ((to - from) + 100) % 100 || (prev < 0 ? 0 : 100);
  light.style.transition = reduced ? "none" : "stroke-dasharray 1.1s cubic-bezier(.2,.7,.2,1)";
  light.style.strokeDasharray = `${len} 100`;
  stage.classList.remove("in"); void stage.offsetWidth;
  n.textContent = String(i + 1).padStart(2, "0"); label.textContent = STAGES[i].label; line.textContent = STAGES[i].line;
  stage.classList.add("in");
}
function next() { go((at + 1) % STAGES.length); }
function tick() { clearTimeout(timer); timer = setTimeout(() => { if (Date.now() > held) next(); tick(); }, 4200); }
function rest() { held = Date.now() + 9000; }

/* first light: the ring's bodies arrive one by one, then the turn begins */
setTimeout(() => { document.body.classList.add("arrived"); setTimeout(() => { go(0); tick(); }, reduced ? 100 : 1500); }, reduced ? 200 : 900);

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
