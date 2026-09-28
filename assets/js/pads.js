/*
 * THE SECTIONS — each one a landing: the ring the mark wears, with its bodies
 * on it, lit in turn, a scene in the chart pen behind, and a caption beneath.
 * The install's bodies are the stages of the install; the docs' are the
 * documents; the information's are what Orbit is, in the README's words.
 */
import { reduced } from "./sky.js";

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

/* One ring. Its bodies orbit at their own cadences — some the other way, some
   faster — and yet the right one arrives at the bottom of the ring exactly as
   its line appears, locks there while the line is read, and is let go just
   before the next comes round. Each body's path is planned backwards from the
   moment it is due: however far it has to go, it gets there on time. */
const PERIOD = 5200, HOLD = 3400, LEAD = 1600, PICK = 1200;
const TURNS = [1, 2, 1, 3, 2, 1, 2];
const DIR = [1, -1, 1, 1, -1, 1, -1];
const BOTTOM = 90;
const glide = (u) => 1 - Math.pow(1 - u, 2.4);   /* let go briskly, arrive gently, and lock */

export function createRing(pad, section) {
  const svg = $(".ring", pad), host = $(".stages", svg);
  const stage = $(".stage", pad), n = $(".n", stage), total = $(".total", stage), label = $(".label", stage), line = $(".line", stage), go = $(".go", stage);
  const items = section.items, N = items.length;
  total.textContent = String(N).padStart(2, "0");
  const bodies = items.map((it, i) => {
    const g = document.createElementNS(SVG, "g");
    g.setAttribute("class", "stage-body"); g.setAttribute("tabindex", "0"); g.setAttribute("role", "button");
    g.setAttribute("aria-label", `${it.label}: ${it.line}`);
    g.style.setProperty("--i", i);
    for (const [cls, r] of [["halo", "11"], ["hit", "14"], ["dot", "5.2"]]) {
      const c = document.createElementNS(SVG, "circle"); c.setAttribute("class", cls); c.setAttribute("cx", "172"); c.setAttribute("cy", "100"); c.setAttribute("r", r); g.appendChild(c);
    }
    host.appendChild(g);
    g.addEventListener("click", () => pick(i));
    g.addEventListener("focus", () => pick(i));
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(i); } });
    return g;
  });
  /* each body: where it is, where it is going, and when it is due */
  const S = items.map((_, i) => ({ a: (i * 360) / N + 37 * (i % 3), from: 0, to: 0, t0: 0, t1: 0, locked: false }));
  let raf = 0, current = -1, running = false;
  function angleAt(b, now) {
    if (now <= b.t0) return b.from;
    if (now >= b.t1) return b.to;
    return b.from + (b.to - b.from) * glide((now - b.t0) / (b.t1 - b.t0));
  }
  /* plan body i's path so it reaches the bottom at `due`, turning its own way at its own pace */
  function plan(i, now, due) {
    const b = S[i], from = angleAt(b, now), window = Math.max(1, due - now);
    /* at least one full turn whenever there is time for it: a body never loiters at the bottom waiting to be due */
    const turns = Math.max(window > 2600 ? 1 : 0, Math.round(TURNS[i % TURNS.length] * window / (N * PERIOD)));
    const dir = DIR[i % DIR.length];
    const ahead = dir > 0 ? (((BOTTOM - from) % 360) + 360) % 360 : -((((from - BOTTOM) % 360) + 360) % 360);
    b.from = from; b.to = from + ahead + dir * 360 * turns; b.t0 = now; b.t1 = due; b.locked = false;
  }
  function lock(i) {
    current = i;
    bodies.forEach((g, j) => g.classList.toggle("on", j === i));
    stage.classList.remove("in"); void stage.offsetWidth;
    n.textContent = String(i + 1).padStart(2, "0"); label.textContent = items[i].label; line.textContent = items[i].line;
    if (items[i].href) { go.href = items[i].href; go.hidden = false; } else go.hidden = true;
    stage.classList.add("in");
  }
  function release(i) {
    bodies[i].classList.remove("on");
    if (current === i) stage.classList.remove("in");
  }
  function frame(now) {
    if (!running) return;
    S.forEach((b, i) => {
      const held = now >= b.t1 && now < b.t1 + HOLD;
      if (held && !b.locked) { b.locked = true; lock(i); }
      if (!held && b.locked) { release(i); plan(i, now, b.t1 + N * PERIOD); }
      b.a = angleAt(b, now);
      bodies[i].setAttribute("transform", `rotate(${b.a.toFixed(2)} 100 100)`);
    });
    raf = requestAnimationFrame(frame);
  }
  /* a body asked for: it comes to the bottom next, and the turn goes on from there */
  function pick(i) {
    const now = performance.now();
    S.forEach((b, j) => { if (b.locked) release(j); plan(j, now, now + PICK + (((j - i) % N) + N) % N * PERIOD); });
  }
  return {
    start() {
      running = true;
      const now = performance.now();
      S.forEach((b, i) => { b.from = b.to = b.a; b.t0 = b.t1 = now; plan(i, now, now + (reduced ? 200 : LEAD) + i * PERIOD); });
      cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false; cancelAnimationFrame(raf); raf = 0; current = -1;
      S.forEach((b) => { b.locked = false; });
      bodies.forEach((g) => g.classList.remove("on")); stage.classList.remove("in");
    },
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
