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
      { label: "before anything runs", name: "manifest", c: "#d8b45a", line: "A signed manifest is verified first." },
      { label: "every file", name: "checksums", c: "#8fb8ff", line: "Its checksum is checked against that manifest — and a second, independent signature, if cosign is installed." },
      { label: "the launcher", name: "launcher", c: "#a78bfa", line: "Only once everything checks out does it hand off to the launcher: Install, Update, Repair." },
      { label: "the image", name: "image", c: "#f87171", line: "Pulled and resolved to an immutable digest. A mutable reference is never deployed." },
      { label: "the stack", name: "stack", c: "#4ade80", line: "orbit, the official PostgreSQL and the isolated scanner — done only once each is healthy." },
      { label: "claim", name: "claim", c: "#f0b429", line: "The last line of the container's log is a one-time link. Open it to create the first administrator." },
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

/* THE DOCS: the index as a sky. Each source is a constellation — a few
   stars joined in the chart pen, in its own colour — and every entry a
   star in it. Type, and the constellations show where the answers are;
   choose one, and only its stars are listed. The arrow keys walk the
   list and enter opens the doc. */
const GROUPS = {
  "README":       { c: "#d8b45a", pts: [[8, 40], [30, 16], [54, 30], [80, 10], [108, 26]] },
  "Sign-in":      { c: "#8fb8ff", pts: [[10, 18], [36, 44], [60, 20], [86, 40], [110, 14]] },
  "Security":     { c: "#f87171", pts: [[14, 44], [40, 12], [68, 40], [96, 18]] },
  "Releases":     { c: "#a78bfa", pts: [[8, 26], [36, 40], [62, 12], [90, 34], [112, 46]] },
  "The launcher": { c: "#4ade80", pts: [[12, 38], [42, 18], [72, 44], [104, 16]] },
};
export function createDocs(pad) {
  const input = $(".search input", pad), keys = $(".keys", pad), results = $(".results", pad), sky = $(".constellations", pad);
  const norm = (x) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const esc = (x) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const mark = (text, q) => {
    if (!q) return esc(text);
    const words = q.split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return esc(text).replace(new RegExp(`(${words.join("|")})`, "gi"), "<mark>$1</mark>");
  };
  let group = null, cursor = -1;
  let recent = []; try { recent = JSON.parse(localStorage.getItem("orbit-site-read") || "[]"); } catch { /* fine */ }
  const remember = (href) => { recent = [href, ...recent.filter((h) => h !== href)].slice(0, 12); try { localStorage.setItem("orbit-site-read", JSON.stringify(recent)); } catch { /* fine */ } };

  /* the constellations: one per source, lit by how many of its stars answer */
  const glyph = (name, g, n, hits) => {
    const pts = g.pts, poly = pts.map((p) => p.join(",")).join(" ");
    const dots = pts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 2 ? 2 : 2.6}" class="${i < hits ? "lit" : ""}"/>`).join("");
    return `<button type="button" class="con" data-group="${esc(name)}" style="--c:${g.c}" aria-pressed="false">
      <svg viewBox="0 0 120 56" aria-hidden="true"><polyline points="${poly}"/>${dots}</svg>
      <span class="name">${esc(name)}</span><span class="n">${n}</span></button>`;
  };
  function paintSky(q) {
    const words = q ? q.split(/\s+/).filter(Boolean) : [];
    sky.innerHTML = Object.entries(GROUPS).map(([name, g]) => {
      const mine = INDEX.filter((e) => e.g === name);
      const hits = words.length ? mine.filter((e) => matches(e, words)).length : mine.length;
      return glyph(name, g, words.length ? hits : mine.length, words.length ? Math.ceil(hits / mine.length * g.pts.length) : g.pts.length);
    }).join("");
    sky.querySelectorAll(".con").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.group === group));
      b.addEventListener("click", () => { group = group === b.dataset.group ? null : b.dataset.group; render(); });
    });
  }
  const matches = (e, words) => { const hay = norm(`${e.t} ${e.s} ${e.k || ""}`); return words.every((w) => hay.includes(w)); };
  const score = (e, words) => { const t = norm(e.t), k = norm(e.k || ""); return words.reduce((s, w) => s + (t.includes(w) ? 3 : k.includes(w) ? 2 : 1), 0); };
  const entry = (e, q, i) => `<a class="entry${recent.includes(e.href) ? " read" : ""}" href="${e.href}" target="_blank" rel="noopener" style="--i:${i};--c:${GROUPS[e.g]?.c ?? "#8791b3"}" data-href="${e.href}">
      <i class="star"></i><b>${mark(e.t, q)}</b><small>${mark(e.s, q)}</small><span class="where">${esc(e.g)}</span></a>`;

  function render() {
    const raw = input.value.trim(), q = norm(raw), words = q.split(/\s+/).filter(Boolean);
    paintSky(q);
    cursor = -1;
    let list = INDEX.filter((e) => !group || e.g === group);
    if (words.length) list = list.filter((e) => matches(e, words)).sort((a, b) => score(b, words) - score(a, words));
    if (!list.length) {
      results.innerHTML = `<section class="none"><h4>nothing yet</h4><p>Nothing ${group ? `in ${esc(group)}` : "in the docs"} mentions that. Try another word${group ? `, <button type="button" class="linkish" data-clear>look everywhere</button>` : ""}, or <a href="${R}/issues" target="_blank" rel="noopener">ask on the repository</a>.</p></section>`;
      results.querySelector("[data-clear]")?.addEventListener("click", () => { group = null; render(); });
      return;
    }
    if (words.length || group) {
      const label = words.length ? `${list.length} ${list.length === 1 ? "answer" : "answers"}${group ? ` in ${esc(group)}` : ""}` : `${esc(group)} · ${list.length}`;
      results.innerHTML = `<section><h4>${label}</h4>${list.map((e, i) => entry(e, raw, i)).join("")}</section>`;
    } else {
      const groups = [...new Set(INDEX.map((e) => e.g))]; let i = 0;
      results.innerHTML = groups.map((g) => `<section><h4 style="--c:${GROUPS[g]?.c}"><i></i>${esc(g)}</h4>${INDEX.filter((e) => e.g === g).map((e) => entry(e, "", i++)).join("")}</section>`).join("");
    }
    results.querySelectorAll(".entry").forEach((a) => a.addEventListener("click", () => { remember(a.dataset.href); a.classList.add("read"); }));
  }
  const entries = () => [...results.querySelectorAll(".entry")];
  function move(d) {
    const es = entries(); if (!es.length) return;
    cursor = Math.max(0, Math.min(es.length - 1, cursor + d));
    es.forEach((a, i) => a.classList.toggle("cursor", i === cursor));
    es[cursor].scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }
  keys.innerHTML = INDEX.filter((e) => e.key).map((e) => `<a class="key" href="${e.href}" target="_blank" rel="noopener" style="--c:${GROUPS[e.g]?.c}">${esc(e.t)}</a>`).join("");
  input.addEventListener("input", render);
  input.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); move(1); } if (e.key === "Escape") { input.value = ""; group = null; render(); } });
  document.addEventListener("keydown", (e) => {
    if (pad.hidden) return;
    if (e.key === "/" && !e.target.matches("input,textarea")) { e.preventDefault(); input.focus(); return; }
    if (e.target === input && e.key !== "ArrowDown") return;
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter" && cursor >= 0 && !e.target.matches("input,button,a")) { entries()[cursor]?.click(); }
  });
  render();
  return { start() { render(); }, stop() { input.value = ""; group = null; render(); input.blur(); } };
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

/* One ring. Its bodies all orbit the same way, slowly, each at a pace of its
   own — and the right one arrives at the bottom of the ring exactly as its
   line appears, rests there while the line is read, and drifts on before the
   next comes round. Each body's path is planned back from the moment it is
   due: it covers what its pace allows in the time it has, and no more. */
const GAP = 1900, LEAD = 1600, PICK = 2200;
/* a line is held for as long as it takes to read: a floor, and time per word */
const holdFor = (text) => 3600 + 260 * text.trim().split(/\s+/).length;
const PACE = [9, 17, 6.5, 13, 21, 11, 15];   /* degrees per second: each its own, so they pass one another */
const BOTTOM = 90;
const glide = (u) => 1 - Math.pow(1 - u, 1.8);   /* moves off, then eases in and settles */

export function createRing(pad, section) {
  const svg = $(".ring", pad), host = $(".stages", svg);
  const stage = $(".stage", pad), n = $(".n", stage), total = $(".total", stage), label = $(".label", stage), line = $(".line", stage), go = $(".go", stage);
  const items = section.items, N = items.length;
  total.textContent = String(N).padStart(2, "0");
  /* each body on an orbit of its own outside the ring, as the doors are on
     the sunrise: a faint path, a hairline circle round the body, a leader
     out to its name, which stays upright wherever the body has got to */
  const RADIUS = (i) => 80 + i * 6;
  const orbits = document.createElementNS(SVG, "g"); orbits.setAttribute("class", "orbits"); svg.insertBefore(orbits, host);
  const labels = document.createElementNS(SVG, "g"); labels.setAttribute("class", "labels"); svg.appendChild(labels);
  const tags = [];
  const bodies = items.map((it, i) => {
    const R = RADIUS(i), x = 100 + R;
    const path = document.createElementNS(SVG, "circle"); path.setAttribute("cx", "100"); path.setAttribute("cy", "100"); path.setAttribute("r", R); orbits.appendChild(path);
    const g = document.createElementNS(SVG, "g");
    g.setAttribute("class", "stage-body"); g.setAttribute("tabindex", "0"); g.setAttribute("role", "button");
    g.setAttribute("aria-label", `${it.label}: ${it.line}`);
    g.style.setProperty("--i", i); g.style.setProperty("--c", it.c || "#d8b45a");
    for (const [cls, r] of [["hit", "13"], ["halo", "7.2"], ["dot", "4"]]) {
      const c = document.createElementNS(SVG, "circle"); c.setAttribute("class", cls); c.setAttribute("cx", x); c.setAttribute("cy", "100"); c.setAttribute("r", r); g.appendChild(c);
    }
    const lead = document.createElementNS(SVG, "line"); lead.setAttribute("class", "lead"); lead.setAttribute("x1", x + 7.2); lead.setAttribute("y1", "100"); lead.setAttribute("x2", x + 15); lead.setAttribute("y2", "100"); g.appendChild(lead);
    const tag = document.createElementNS(SVG, "text"); tag.setAttribute("class", "tag"); tag.textContent = it.name || it.label; tag.style.setProperty("--c", it.c || "#d8b45a"); labels.appendChild(tag); tags.push(tag);
    host.appendChild(g);
    g.addEventListener("click", () => pick(i));
    g.addEventListener("focus", () => pick(i));
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(i); } });
    return g;
  });
  /* each body: where it is, where it is going, and when it is due */
  const S = items.map((it, i) => ({ a: 0, from: 0, to: 0, t0: 0, t1: 0, locked: false, hold: holdFor(it.line) }));
  const pace = (i) => PACE[i % PACE.length];
  const CYCLE = S.reduce((sum, b) => sum + b.hold + GAP, 0);   /* one turn of the whole sequence */
  let raf = 0, current = -1, running = false;
  function angleAt(b, now) {
    if (now <= b.t0) return b.from;
    if (now >= b.t1) return b.to;
    return b.from + (b.to - b.from) * glide((now - b.t0) / (b.t1 - b.t0));
  }
  /* plan body i's path so it reaches the bottom at `due`: the way there, plus
     whatever whole turns its own pace would cover in the time it has */
  function plan(i, now, due) {
    const b = S[i], from = angleAt(b, now), window = Math.max(1, due - now);
    const ahead = (((BOTTOM - from) % 360) + 360) % 360;
    const want = pace(i) * window / 1000;
    const extra = Math.max(0, Math.round((want - ahead) / 360));
    b.from = from; b.to = from + ahead + 360 * extra; b.t0 = now; b.t1 = due; b.locked = false;
  }
  function lock(i) {
    current = i;
    bodies.forEach((g, j) => g.classList.toggle("on", j === i));
    stage.style.setProperty("--c", items[i].c || "var(--accent)");
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
      const held = now >= b.t1 && now < b.t1 + b.hold;
      if (held && !b.locked) { b.locked = true; lock(i); }
      if (!held && b.locked) { release(i); plan(i, now, b.t1 + CYCLE); }
      b.a = angleAt(b, now);
      bodies[i].setAttribute("transform", `rotate(${b.a.toFixed(2)} 100 100)`);
      /* the name, just past the leader, on the side away from the body */
      const t = (b.a * Math.PI) / 180, ux = Math.cos(t), uy = Math.sin(t), r = RADIUS(i) + 20;
      const tag = tags[i];
      tag.setAttribute("x", (100 + ux * r).toFixed(2)); tag.setAttribute("y", (100 + uy * r).toFixed(2));
      tag.setAttribute("text-anchor", ux > 0.38 ? "start" : ux < -0.38 ? "end" : "middle");
      tag.setAttribute("dominant-baseline", uy < -0.55 ? "auto" : uy > 0.55 ? "hanging" : "middle");
      tag.classList.toggle("on", b.locked);
    });
    raf = requestAnimationFrame(frame);
  }
  /* a body asked for: it comes to the bottom next, and the turn goes on from there */
  /* the dues, in sequence from body i at `first`: each follows the last by its hold and the gap */
  function schedule(first, i, now) {
    let due = first;
    for (let d = 0; d < N; d++) { const j = (i + d) % N; plan(j, now, due); due += S[j].hold + GAP; }
  }
  function pick(i) {
    const now = performance.now();
    S.forEach((b, j) => { if (b.locked) release(j); });
    schedule(now + PICK, i, now);
  }
  return {
    start() {
      running = true;
      const now = performance.now();
      /* each starts where its own pace would have it, so the first cycle is already a steady drift */
      let due = now + (reduced ? 200 : LEAD);
      S.forEach((b, i) => { b.a = b.from = b.to = BOTTOM - pace(i) * (due - now) / 1000; b.t0 = b.t1 = now; due += b.hold + GAP; });
      schedule(now + (reduced ? 200 : LEAD), 0, now);
      cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false; cancelAnimationFrame(raf); raf = 0; current = -1;
      S.forEach((b) => { b.locked = false; });
      bodies.forEach((g) => g.classList.remove("on")); stage.classList.remove("in");
    },
  };
}

/* the planets on the sunrise's ring: each one a door, named on the ring itself */
export function wirePlanets(door, onGo) {
  const planets = [...door.querySelectorAll(".planet")].map((p) => ({ p, spin: p.querySelector(".spin"), tag: p.querySelector(".tag"), r: +p.dataset.r + 21 }));
  planets.forEach(({ p }) => p.addEventListener("click", (e) => { e.preventDefault(); onGo(p.dataset.section); }));
  /* each label sits just past its leader's end, on the side away from the
     planet: above it when the planet is high, beside it when it is out to
     the side, below when it is low — so nothing ever crosses the leader */
  function place() {
    if (!door.hidden) for (const { spin, tag, r } of planets) {
      const m = new DOMMatrix(getComputedStyle(spin).transform);
      const a = Math.atan2(m.b, m.a);                       /* the spin's turn */
      const ux = Math.sin(a), uy = -Math.cos(a);           /* the planet started at the top */
      tag.setAttribute("x", (100 + ux * r).toFixed(2)); tag.setAttribute("y", (100 + uy * r).toFixed(2));
      tag.setAttribute("text-anchor", ux > 0.38 ? "start" : ux < -0.38 ? "end" : "middle");
      tag.setAttribute("dominant-baseline", uy < -0.55 ? "auto" : uy > 0.55 ? "hanging" : "middle");
    }
    requestAnimationFrame(place);
  }
  requestAnimationFrame(place);
  return { hide() {} };
}
