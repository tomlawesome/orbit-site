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
    title: "Orbit", subtitle: "quick start",
    items: [
      { label: "before anything runs", line: "A signed manifest is verified first." },
      { label: "every file", line: "Its checksum is checked against that manifest — and a second, independent signature, if cosign is installed." },
      { label: "the launcher", line: "Only once everything checks out does it hand off to the launcher: Install, Update, Repair." },
      { label: "the image", line: "Pulled and resolved to an immutable digest. A mutable reference is never deployed." },
      { label: "the stack", line: "orbit, the official PostgreSQL and the isolated scanner — done only once each is healthy." },
      { label: "claim", line: "The last line of the container's log is a one-time link. Open it to create the first administrator." },
    ],
  },
  docs: { title: "Orbit", subtitle: "the docs" },
  info: { title: "Orbit", subtitle: "about" },
};

/* THE INDEX — every place the docs answer something, in the docs' own words.
   `k` is what someone might type that the title does not say. */
const R = "https://github.com/tomlawesome/orbit", RM = R + "#", AU = R + "/blob/main/docs/authentication.md#", SEC = R + "/blob/main/SECURITY.md#", REL = R + "/blob/main/docs/releasing.md#", IG = R + "/blob/main/docs/installer-guarantees.md", L = "https://github.com/tomlawesome/orbit-launcher#";
export const INDEX = [
  { g: "README", t: "Quick start", s: "From an empty directory on a Linux host (amd64 or arm64) with Docker Compose v2 and curl: one line.", href: RM + "quick-start", k: "install curl bash launcher get-orbit", key: true },
  { g: "README", t: "Building from source instead", s: "Building is a developer workflow rather than an installation choice, so the installer does not offer it.", href: RM + "building-from-source-instead", k: "clone build compile" },
  { g: "README", t: "Your home has an orbit", s: "Boilers need servicing. Insurance renews. Cars need inspections. Devices leave warranty. Contracts roll over.", href: RM + "your-home-has-an-orbit", k: "what is orbit about" },
  { g: "README", t: "A quick visual tour", s: "Screenshots of the real application, on deterministic synthetic household, item, document and mailbox data.", href: RM + "a-quick-visual-tour", k: "screenshots pictures" },
  { g: "README", t: "Designed around your household", s: "Sections that fit your life, appearance with personality, a complete record of care, private by design.", href: RM + "designed-around-your-household", k: "features sections themes colourways pwa" },
  { g: "README", t: "One app. Standard supporting services.", s: "Orbit deliberately keeps the operational footprint small: one container, PostgreSQL, ClamAV.", href: RM + "one-app-standard-supporting-services", k: "architecture containers postgres clamav" },
  { g: "README", t: "Run with Docker", s: "Create the runtime configuration, then start Orbit.", href: RM + "run-with-docker", k: "compose env-orbit secrets configure.sh" },
  { g: "README", t: "Optional local processing stack", s: "The standard stack includes private ClamAV scanning; more can be enabled by configuration.", href: RM + "optional-local-processing-stack", k: "tika ocr scanning documents" },
  { g: "README", t: "Update and launch an existing checkout", s: "Once the host has a configured .env-orbit, update and start Orbit with one script.", href: RM + "update-and-launch-an-existing-checkout", k: "upgrade update-and-start" },
  { g: "README", t: "Production foundation", s: "What Orbit already includes for running it for real.", href: RM + "production-foundation", k: "production hardening" },
  { g: "README", t: "Local development", s: "Requirements, the development stack, quality checks.", href: RM + "local-development", k: "dev pnpm tests playwright contribute" },
  { g: "README", t: "Configuration", s: "All supported runtime variables are documented in .env-orbit.example.", href: RM + "configuration", k: "env variables settings", key: true },
  { g: "README", t: "Before the first real launch", s: "The checklist to run through before Orbit is used in earnest.", href: RM + "before-the-first-real-launch", k: "checklist go-live" },
  { g: "README", t: "Licence", s: "Orbit is free software, licensed under the GNU Affero General Public License v3.0 or later.", href: RM + "licence", k: "agpl license open source" },
  { g: "Sign-in", t: "Claiming a fresh install", s: "A fresh instance has no administrator and is unclaimed. The last line of the container's log is the one-time claim link.", href: AU + "claiming-a-fresh-install", k: "first admin administrator claim code log", key: true },
  { g: "Sign-in", t: "Local-only mode", s: "ORBIT_AUTH_OIDC=false is the default: every account signs in with an email address and a password.", href: AU + "local-only-mode", k: "password accounts no sso" },
  { g: "Sign-in", t: "Every password sign-in is approved by email", s: "Signing in with a password is two screens, not one.", href: AU + "every-password-sign-in-is-approved-by-email", k: "email approval magic link 2fa" },
  { g: "Sign-in", t: "Adding OIDC later", s: "Local-only and OIDC are not a one-time choice.", href: AU + "adding-oidc-later", k: "sso identity provider authentik keycloak" },
  { g: "Sign-in", t: "Linking and unlinking", s: "A signed-in user manages their own sign-in methods from Settings → Sign-in methods.", href: AU + "linking-and-unlinking", k: "methods password provider" },
  { g: "Sign-in", t: "Administrator: adding a local user", s: "From Administration → Users: an email, a display name, and how long the setup link stays valid.", href: AU + "administrator-adding-a-local-user", k: "invite user setup link" },
  { g: "Sign-in", t: "Recovering the primary administrator", s: "The primary administrator has nobody above them, so they get a separate recovery path.", href: AU + "recovering-the-primary-administrator", k: "lost password locked out recovery" },
  { g: "Sign-in", t: "Household membership", s: "Every household has one owner and zero or more members.", href: AU + "household-membership", k: "owner members share invite" },
  { g: "Sign-in", t: "Generic OIDC providers", s: "What a provider must support to sign people into Orbit.", href: AU + "generic-oidc-providers", k: "oidc pkce discovery" },
  { g: "Sign-in", t: "Security model", s: "Rate limits, timing-alike failures, and the rest of the sign-in's defences.", href: AU + "security-model", k: "brute force sessions csrf" },
  { g: "Sign-in", t: "Troubleshooting", s: "What the sign-in says when configuration is inconsistent: field names, never values.", href: AU + "troubleshooting", k: "error cannot sign in" },
  { g: "Security", t: "Report a vulnerability privately", s: "Use GitHub private vulnerability reporting.", href: SEC + "report-a-vulnerability-privately", k: "security bug disclosure cve", key: true },
  { g: "Security", t: "Supported versions", s: "Which releases receive fixes.", href: SEC + "supported-versions", k: "versions support" },
  { g: "Security", t: "Scope", s: "What kinds of reports are useful.", href: SEC + "scope", k: "in scope out of scope" },
  { g: "Security", t: "Responsible research", s: "What good-faith research must do.", href: SEC + "responsible-research", k: "safe harbour" },
  { g: "Releases", t: "The launcher and signed release manifest", s: "The first command installs a signed launcher, not just a signed installer.", href: REL + "the-launcher-and-signed-release-manifest-adr-0031", k: "signature manifest cosign verify" },
  { g: "Releases", t: "Check both signatures on a release", s: "A stable release is only trustworthy if both signatures verify.", href: REL + "check-both-signatures-on-a-release", k: "cosign countersign verify" },
  { g: "Releases", t: "Supported install targets", s: "The operator tooling supports installing v1.3.0 and later.", href: REL + "supported-install-targets", k: "versions v1.3.0" },
  { g: "Releases", t: "Installer guarantees", s: "Exactly what each script promises, catalogued: install, configure, backup, restore, recovery bundles.", href: IG, k: "backup restore recovery guarantees scripts" },
  { g: "The launcher", t: "Quickstart", s: "Downloads the right binary for your machine, verifies its checksum, and runs it. Run it again any time.", href: L + "quickstart", k: "tui terminal install update remove repair" },
  { g: "The launcher", t: "Status", s: "Install, Update and Remove are wired to a real installer; Repair is a deliberate stub.", href: L + "status", k: "roadmap" },
  { g: "The launcher", t: "Stack", s: "Go, with Bubble Tea for the full-screen event loop and Lip Gloss for layout. Linux only.", href: L + "stack", k: "go bubbletea lipgloss" },
];

/* the docs: a search over the index, grouped where nothing is typed */
export function createDocs(pad) {
  const input = $(".search input", pad), keys = $(".keys", pad), results = $(".results", pad);
  const norm = (x) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const esc = (x) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const mark = (text, q) => {
    if (!q) return esc(text);
    const words = q.split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return esc(text).replace(new RegExp(`(${words.join("|")})`, "gi"), "<mark>$1</mark>");
  };
  const entry = (e, q) => `<a class="entry" href="${e.href}" target="_blank" rel="noopener"><b>${mark(e.t, q)}</b><small>${mark(e.s, q)}</small><span class="where">${esc(e.g)}</span></a>`;
  function render() {
    const q = norm(input.value.trim());
    if (!q) {
      const groups = [...new Set(INDEX.map((e) => e.g))];
      results.innerHTML = groups.map((g) => `<section><h4>${esc(g)}</h4>${INDEX.filter((e) => e.g === g).map((e) => entry(e, "")).join("")}</section>`).join("");
      return;
    }
    const words = q.split(/\s+/).filter(Boolean);
    const scored = INDEX.map((e) => {
      const hay = { t: norm(e.t), s: norm(e.s), k: norm(e.k || "") };
      let score = 0;
      for (const w of words) { if (hay.t.includes(w)) score += 3; else if (hay.k.includes(w)) score += 2; else if (hay.s.includes(w)) score += 1; else return null; }
      return { e, score };
    }).filter(Boolean).sort((a, b) => b.score - a.score);
    results.innerHTML = scored.length
      ? `<section><h4>${scored.length} ${scored.length === 1 ? "answer" : "answers"}</h4>${scored.map(({ e }) => entry(e, input.value.trim())).join("")}</section>`
      : `<section class="none"><h4>nothing yet</h4><p>Nothing in the docs mentions that. Try another word, or <a href="${R}/issues" target="_blank" rel="noopener">ask on the repository</a>.</p></section>`;
  }
  keys.innerHTML = INDEX.filter((e) => e.key).map((e) => `<a class="key" href="${e.href}" target="_blank" rel="noopener">${esc(e.t)}</a>`).join("");
  input.addEventListener("input", render);
  render();
  const slash = (e) => { if (e.key === "/" && !pad.hidden && !e.target.matches("input,textarea")) { e.preventDefault(); input.focus(); } };
  document.addEventListener("keydown", slash);
  return { start() { render(); }, stop() { input.value = ""; render(); input.blur(); } };
}

/* the information: a page to read, each chapter arriving as it is reached */
export function createInfo(pad) {
  const scroll = $(".scroll", pad), chapters = [...pad.querySelectorAll(".chapter")];
  const io = new IntersectionObserver((es) => { for (const x of es) if (x.isIntersecting) x.target.classList.add("in"); }, { root: scroll, threshold: 0.18 });
  return {
    start() { scroll.scrollTop = 0; chapters.forEach((c) => { c.classList.remove("in"); io.observe(c); }); },
    stop() { chapters.forEach((c) => io.unobserve(c)); },
  };
}

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
    const left = Math.max(12, Math.min(b.left + b.width / 2 - tip.offsetWidth / 2, innerWidth - 12 - tip.offsetWidth));
    tip.style.left = `${left}px`; tip.style.top = `${b.bottom + 14}px`;
    tip.style.setProperty("--sx", `${b.left + b.width / 2 - left}px`);
  };
  const showTip = (p, tapped) => {
    tip.style.setProperty("--c", getComputedStyle(p).getPropertyValue("--c") || "#d8b45a");
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
