/*
 * THE SECTIONS — each one a landing: the ring the mark wears, with its bodies
 * on it, lit in turn, a scene in the chart pen behind, and a caption beneath.
 * The install's bodies are the stages of the install; the docs' are the
 * documents; the information's are what Orbit is, in the README's words.
 */
import { reduced } from "./sky.js";
import { createScenes } from "./scenes.js";

const SVG = "http://www.w3.org/2000/svg";
const $ = (s, r = document) => r.querySelector(s);

export const SECTIONS = {
  install: {
    title: "Orbit", subtitle: "quick start", text: true,
    items: [
      { label: "before anything runs", line: "A signed manifest is verified first." },
      { label: "every file", line: "Its checksum is checked against that manifest — and a second, independent signature, if cosign is installed." },
      { label: "the launcher", line: "Only once everything checks out does it hand off to the launcher: Install, Update, Repair." },
      { label: "the image", line: "Pulled and resolved to an immutable digest. A mutable reference is never deployed." },
      { label: "the stack", line: "orbit, the official PostgreSQL and the isolated scanner — done only once each is healthy." },
      { label: "claim", line: "The last line of the container's log is a one-time link. Open it to create the first administrator." },
    ],
  },
  docs: {
    title: "Orbit", subtitle: "the docs", text: false,
    items: [
      { label: "README", line: "Where everything starts: the quick start, the configuration, the visual tour.", href: "https://github.com/tomlawesome/orbit#readme" },
      { label: "quick start", line: "From an empty directory on a Linux host with Docker Compose v2 and curl: one line.", href: "https://github.com/tomlawesome/orbit#quick-start" },
      { label: "installer guarantees", line: "Exactly what is checked before anything runs, and how the signatures are made.", href: "https://github.com/tomlawesome/orbit/blob/main/docs/installer-guarantees.md" },
      { label: "sign-in", line: "Local accounts by default, an identity provider if you add one, and how a fresh install is claimed.", href: "https://github.com/tomlawesome/orbit/blob/main/docs/authentication.md" },
      { label: "security policy", line: "Supported versions, and how to report a vulnerability privately.", href: "https://github.com/tomlawesome/orbit/blob/main/SECURITY.md" },
      { label: "the launcher", line: "The terminal application that installs, updates and repairs Orbit.", href: "https://github.com/tomlawesome/orbit-launcher#readme" },
    ],
  },
  info: {
    title: "Orbit", subtitle: "about", text: false,
    items: [
      { label: "your home has an orbit", line: "Boilers need servicing. Insurance renews. Cars need inspections. Orbit brings those scattered responsibilities into one calm, shared view." },
      { label: "see what is next", line: "A focused, urgency-aware workspace brings upcoming work, overdue items and recently completed tasks into view." },
      { label: "keep the rhythm", line: "Complete, renew, reschedule, snooze, cancel, restore — and the next recurring date is worked out for you." },
      { label: "share the load", line: "Household owners add existing Orbit users by display name, without invitations or exposed email addresses." },
      { label: "private by design", line: "Provider-neutral OIDC, opaque server-side sessions, PKCE, signed token validation and CSRF protection." },
      { label: "free software", line: "One application container, the official PostgreSQL and the isolated scanner. AGPL-3.0-or-later.", href: "https://github.com/tomlawesome/orbit" },
    ],
  },
};

/* one ring: its bodies, its light, its caption, its scenes */
export function createRing(pad, section) {
  const svg = $(".ring", pad), host = $(".stages", svg), light = $(".light", svg);
  const stage = $(".stage", pad), n = $(".n", stage), total = $(".total", stage), label = $(".label", stage), line = $(".line", stage), go = $(".go", stage);
  const scenes = createScenes($(".scenes", pad), svg, { text: section.text });
  addEventListener("resize", () => scenes.resize());
  const items = section.items, N = items.length;
  total.textContent = String(N).padStart(2, "0");
  const bodies = items.map((it, i) => {
    const a = (-90 + i * (360 / N)) * Math.PI / 180;
    const g = document.createElementNS(SVG, "g");
    g.setAttribute("class", "stage-body"); g.setAttribute("tabindex", "0"); g.setAttribute("role", "button");
    g.setAttribute("aria-label", `${it.label}: ${it.line}`);
    g.style.setProperty("--i", i);
    const cx = (100 + 72 * Math.cos(a)).toFixed(2), cy = (100 + 72 * Math.sin(a)).toFixed(2);
    g.style.transformOrigin = `${cx}px ${cy}px`;
    for (const [cls, r] of [["halo", "11"], ["hit", "14"], ["dot", "5.2"]]) {
      const c = document.createElementNS(SVG, "circle"); c.setAttribute("class", cls); c.setAttribute("cx", cx); c.setAttribute("cy", cy); c.setAttribute("r", r); g.appendChild(c);
    }
    host.appendChild(g);
    g.addEventListener("click", () => { show(i); rest(); });
    g.addEventListener("pointerenter", (e) => { if (e.pointerType !== "touch") { show(i); rest(); } });
    g.addEventListener("focus", () => { show(i); rest(); });
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(i); rest(); } });
    return g;
  });
  let at = -1, timer = 0, held = 0;
  function show(i) {
    if (i === at) return;
    const prev = at; at = i;
    bodies.forEach((b, j) => { b.classList.toggle("on", j === i); b.classList.toggle("done", j < i); });
    const from = (prev < 0 ? i : prev) * (100 / N), to = i * (100 / N);
    light.style.transition = "none"; light.style.strokeDasharray = "0.01 100"; light.style.strokeDashoffset = `${-from}`;
    void light.getBoundingClientRect();
    const len = ((to - from) + 100) % 100 || (prev < 0 ? 0 : 100);
    light.style.transition = reduced ? "none" : "stroke-dasharray 1.1s cubic-bezier(.2,.7,.2,1)";
    light.style.strokeDasharray = `${len} 100`;
    scenes.show(i);
    stage.classList.remove("in"); void stage.offsetWidth;
    n.textContent = String(i + 1).padStart(2, "0"); label.textContent = items[i].label; line.textContent = items[i].line;
    if (items[i].href) { go.href = items[i].href; go.hidden = false; } else go.hidden = true;
    stage.classList.add("in");
  }
  const next = () => show((at + 1) % N);
  function tick() { clearTimeout(timer); timer = setTimeout(() => { if (Date.now() > held) next(); tick(); }, 4600); }
  const rest = () => { held = Date.now() + 9000; };
  return {
    start() { scenes.start(); setTimeout(() => { show(0); tick(); }, reduced ? 100 : 1500); },
    stop() { clearTimeout(timer); scenes.stop(); at = -1; bodies.forEach((b) => b.classList.remove("on", "done")); light.style.transition = "none"; light.style.strokeDasharray = "0.01 100"; stage.classList.remove("in"); },
  };
}

/* the planets on the sunrise's ring: each one a door, with a word for it */
export function wirePlanets(door, tip, onGo) {
  let armed = null, timer = 0;
  const place = (p) => {
    const b = p.getBoundingClientRect();
    tip.style.left = `${Math.max(12, Math.min(b.left + b.width / 2 - tip.offsetWidth / 2, innerWidth - 12 - tip.offsetWidth))}px`;
    tip.style.top = `${b.bottom + 12}px`;
  };
  const showTip = (p, tapped) => {
    tip.querySelector("b").textContent = p.dataset.name; tip.querySelector("small").textContent = p.dataset.line;
    tip.classList.add("show"); tip.classList.toggle("tap", tapped); place(p);
    clearInterval(timer); timer = setInterval(() => place(p), 120);
    armed = tapped ? p : null;
  };
  const hide = () => { tip.classList.remove("show", "tap"); clearInterval(timer); armed = null; };
  door.querySelectorAll(".planet").forEach((p) => {
    p.addEventListener("pointerdown", (e) => { p.dataset.ptype = e.pointerType; });
    p.addEventListener("pointerenter", (e) => { if (e.pointerType !== "touch") showTip(p, false); });
    p.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") hide(); });
    p.addEventListener("focus", () => { if (p.dataset.ptype !== "touch") showTip(p, false); });
    p.addEventListener("blur", () => { if (!armed) hide(); });
    p.addEventListener("click", (e) => {
      e.preventDefault();
      if (p.dataset.ptype === "touch" && armed !== p) { showTip(p, true); return; }
      hide(); onGo(p.dataset.section);
    });
  });
  tip.addEventListener("click", () => { if (armed) { const s = armed.dataset.section; hide(); onGo(s); } });
  document.addEventListener("pointerdown", (e) => { if (armed && !e.target.closest(".planet") && !e.target.closest(".planet-tip")) hide(); });
  return { hide };
}
