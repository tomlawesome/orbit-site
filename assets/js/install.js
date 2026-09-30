/*
 * THE INSTALL, three ways, for review. Each concept is one section of the
 * pad; the route says which — #install/pad, #install/terminal,
 * #install/cockpit — and the switch at the foot hops between them. Every
 * word on the page is the command, or the launcher's own log, or the
 * README's one line about the host.
 */
import { reduced } from "./sky.js";
const $ = (s, r = document) => r.querySelector(s);
const CMD = "curl -fsSL https://raw.githubusercontent.com/tomlawesome/orbit/main/scripts/get-orbit.sh | bash";
/* the launcher's console, as it is on its own screen, in order */
const LOG = [
  ["host", "starting"], ["host", "done"], ["image", "starting"], ["image", "running"], ["image", "done"],
  ["assets", "starting"], ["assets", "done"], ["configuration", "starting"], ["configuration", "running"], ["configuration", "done"],
  ["oidc", "starting"], ["oidc", "done"], ["compose", "done"], ["database", "starting"], ["database", "done"],
  ["application", "done"], ["clamav", "starting"], ["clamav", "done"], ["tika", "starting"], ["tika", "done"],
  ["ollama", "skipped"], ["database", "starting"], ["database", "healthy"], ["application", "starting"],
];
const SHOTS = [
  ["01-splash", "splash"], ["02-install-profile", "install · profile"], ["03-install-ready", "install · ready"],
  ["04-install-console", "install · running"], ["05-install-success", "install · done"], ["06-splash-alive", "splash · running"],
  ["07-update-confirm", "update · confirm"], ["08-update-console", "update · running"], ["09-repair-proposed", "repair · proposed"],
  ["10-repair-applied", "repair · applied"], ["11-remove-confirm", "remove · confirm"], ["12-remove-done", "remove · done"],
];
const wait = (ms) => new Promise((r) => setTimeout(r, reduced ? Math.min(ms, 40) : ms));

/* ── 1 · the launch pad: copy is the ignition ── */
function launchPad(sec) {
  const list = $(".telemetry", sec), ignite = $(".ignite", sec);
  list.innerHTML = LOG.map(([a, b]) => `<li><i>${b === "done" || b === "healthy" ? "✓" : "·"}</i><b>${a}</b> <span>${b}</span></li>`).join("");
  const rows = [...list.children];
  let run = 0;
  async function fire() {
    const id = ++run;
    sec.classList.add("lit"); sec.classList.remove("done");
    rows.forEach((r) => r.classList.remove("on"));
    await wait(700);
    for (let i = 0; i < rows.length && id === run; i++) { rows[i].classList.add("on"); rows[i].scrollIntoView({ block: "nearest" }); await wait(rows[i].querySelector("span").textContent === "done" ? 260 : 520); }
    if (id === run) sec.classList.add("done");
  }
  ignite.addEventListener("click", fire);
  return { start() { sec.classList.remove("lit", "done"); rows.forEach((r) => r.classList.remove("on")); }, stop() { run++; sec.classList.remove("lit", "done"); } };
}

/* ── 2 · the terminal that is the page ── */
function terminal(sec) {
  const typed = $(".typed", sec), key = $(".key", sec), scene = $(".scene", sec), imgs = [...sec.querySelectorAll(".screens img")];
  let run = 0, face = 0;
  const src = (i) => `assets/img/launcher/${SHOTS[i][0]}.webp`;
  async function play(id) {
    for (let i = 0; id === run; i = (i + 1) % SHOTS.length) {
      face = 1 - face; imgs[face].src = src(i); imgs[face].classList.add("on"); imgs[1 - face].classList.remove("on");
      scene.textContent = SHOTS[i][1];
      const n = new Image(); n.src = src((i + 1) % SHOTS.length);
      await wait(i === 0 ? 4200 : 3400);
      while (id === run && (document.hidden || sec.hidden)) await wait(500);
    }
  }
  async function go() {
    const id = ++run;
    typed.textContent = ""; key.hidden = true; scene.textContent = ""; imgs.forEach((i) => i.classList.remove("on")); sec.classList.remove("running");
    await wait(900);
    for (let i = 0; i < CMD.length && id === run; i++) { typed.textContent += CMD[i]; await wait(CMD[i] === " " ? 90 : 28 + (i % 3) * 14); }
    if (id !== run) return;
    key.hidden = false; await wait(1600);
    if (id !== run) return;
    sec.classList.add("running"); play(id);
  }
  return { start: go, stop() { run++; sec.classList.remove("running"); imgs.forEach((i) => i.classList.remove("on")); } };
}

/* ── 3 · the cockpit: the view up, then the level-out ── */
function cockpit(sec) {
  const log = $(".log", sec);
  log.innerHTML = LOG.map(([a, b]) => `<li><i>${b === "done" || b === "healthy" ? "✓" : "·"}</i>${a} <span>${b}</span></li>`).join("");
  const rows = [...log.children];
  let run = 0;
  async function go() {
    const id = ++run;
    sec.classList.remove("level", "settled"); rows.forEach((r) => r.classList.remove("on"));
    await wait(reduced ? 100 : 1400);
    for (let i = 0; i < rows.length && id === run; i++) { rows[i].classList.add("on"); log.scrollTop = log.scrollHeight; await wait(i < 6 ? 330 : 190); if (i === 7 && id === run) sec.classList.add("level"); }
    if (id === run) sec.classList.add("settled");
  }
  return { start: go, stop() { run++; sec.classList.remove("level", "settled"); } };
}

export function createInstall(pad) {
  const sections = [...pad.querySelectorAll(".concept")];
  const ctl = { pad: launchPad(sections[0]), terminal: terminal(sections[1]), cockpit: cockpit(sections[2]) };
  let current = null;
  const which = () => (location.hash.split("/")[1] || "terminal");
  function show(name) {
    if (!ctl[name]) name = "terminal";
    if (current && current !== name) ctl[current].stop();
    sections.forEach((s) => { s.hidden = s.dataset.concept !== name; });
    pad.querySelectorAll(".concepts a").forEach((a) => a.classList.toggle("on", a.getAttribute("href").endsWith(name)));
    pad.dataset.concept = name; current = name; ctl[name].start();
  }
  pad.querySelector(".concepts").addEventListener("click", (e) => {
    const a = e.target.closest("a"); if (!a) return;
    e.preventDefault(); try { history.replaceState(null, "", a.getAttribute("href")); } catch { /* fine */ }
    show(which());
  });
  return {
    start() { show(which()); },
    stop() { if (current) ctl[current].stop(); current = null; },
  };
}
