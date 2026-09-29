/*
 * THE SECTIONS — each one a landing: the ring the mark wears, with its bodies
 * on it, lit in turn, a scene in the chart pen behind, and a caption beneath.
 * The install's bodies are the stages of the install; the docs' are the
 * documents; the information's are what Orbit is, in the README's words.
 */
import { reduced, seededRng } from "./sky.js";

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

/* THE DOCS: the index as a chart of the sky. Each source is a constellation
   in its own colour, its stars the entries — placed once by a seeded walk,
   so the same sky every visit — scattered as constellations are, not
   ranked in a row. They draw themselves star by star on arrival. Hover a
   star for its title; click it to read; type and the stars that answer
   light while the rest dim. A constellation's name filters the list. */
const GROUPS = {
  "README":       { c: "#d8b45a", wide: [190, 160, 170, 115], tall: [170, 150, 130, 130] },
  "Sign-in":      { c: "#8fb8ff", wide: [520, 130, 180, 100], tall: [440, 135, 130, 120] },
  "Security":     { c: "#f87171", wide: [850, 95, 100, 70],   tall: [150, 380, 100, 70] },
  "Releases":     { c: "#a78bfa", wide: [740, 300, 120, 80],  tall: [450, 380, 110, 80] },
  "The launcher": { c: "#4ade80", wide: [370, 330, 110, 60],  tall: [300, 560, 120, 60] },
};
const SEED = 20260929;
/* a constellation: a gentle walk of N stars inside its box — each step turns
   a little, turns back at the box's edge, and never lands on a star already
   placed, so the shape reads as a figure and not a row */
function walk(n, [cx, cy, w, h], rnd) {
  const pts = []; let x = cx - w / 2 + rnd() * w * 0.25, y = cy + (rnd() - 0.5) * h * 0.5, ang = (rnd() - 0.5) * 0.9;
  const step = Math.max(24, Math.min(w, h * 1.6) / Math.max(1, n - 1) * 1.35), minD = step * 0.55;
  const inside = (px, py) => Math.abs(px - cx) <= w / 2 && Math.abs(py - cy) <= h / 2;
  for (let i = 0; i < n; i++) {
    pts.push([x, y]);
    let nx, ny, tries = 0;
    do {
      ang += (rnd() - 0.5) * 1.6 + (tries > 3 ? 1.2 : 0);
      nx = x + Math.cos(ang) * step * (0.7 + rnd() * 0.6); ny = y + Math.sin(ang) * step * (0.55 + rnd() * 0.6);
      tries++;
    } while (tries < 12 && (!inside(nx, ny) || pts.some(([a, b]) => Math.hypot(a - nx, b - ny) < minD)));
    if (!inside(nx, ny)) { nx = Math.max(cx - w / 2, Math.min(cx + w / 2, nx)); ny = Math.max(cy - h / 2, Math.min(cy + h / 2, ny)); }
    x = nx; y = ny;
  }
  return pts;
}
/* the chart behind the constellations: a field of faint stars and the arcs
   of a graticule, the way a printed sky chart is ruled */
function field(W, H, rnd) {
  let dots = "";
  for (let i = 0; i < (W > 700 ? 110 : 80); i++) {
    const r = (0.5 + rnd() * rnd() * 1.3).toFixed(2), o = (0.15 + rnd() * 0.45).toFixed(2);
    dots += `<circle cx="${(rnd() * W).toFixed(0)}" cy="${(rnd() * H).toFixed(0)}" r="${r}" style="--o:${o};--d:${(rnd() * 6).toFixed(1)}s"/>`;
  }
  const arcs = [];
  /* parallels: shallow arcs bowing upward; meridians: leaning lines */
  for (let k = 0; k < 4; k++) { const y = H * (0.18 + k * 0.22), b = H * 0.07; arcs.push(`M-20 ${y.toFixed(0)} Q ${W / 2} ${(y - b).toFixed(0)} ${W + 20} ${y.toFixed(0)}`); }
  for (let k = 0; k < 6; k++) { const x = W * (0.08 + k * 0.17), lean = (x - W / 2) * 0.12; arcs.push(`M${(x - lean).toFixed(0)} -20 Q ${(x + lean * 0.3).toFixed(0)} ${H / 2} ${(x + lean).toFixed(0)} ${H + 20}`); }
  return `<g class="field">${dots}</g><g class="grat"><path d="${arcs.join(" ")}"/></g>`;
}
export function createDocs(pad) {
  const input = $(".search input", pad), keys = $(".keys", pad), results = $(".results", pad), chart = $(".skymap .chart", pad);
  const norm = (x) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const esc = (x) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const mark = (text, q) => {
    if (!q) return esc(text);
    const words = q.split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return esc(text).replace(new RegExp(`(${words.join("|")})`, "gi"), "<mark>$1</mark>");
  };
  const matches = (e, words) => { const hay = norm(`${e.t} ${e.s} ${e.k || ""}`); return words.every((w) => hay.includes(w)); };
  const score = (e, words) => { const t = norm(e.t), k = norm(e.k || ""); return words.reduce((s, w) => s + (t.includes(w) ? 3 : k.includes(w) ? 2 : 1), 0); };
  let group = null, cursor = -1, narrow = false, starOf = new Map();
  let recent = []; try { recent = JSON.parse(localStorage.getItem("orbit-site-read") || "[]"); } catch { /* fine */ }
  const remember = (href) => {
    recent = [href, ...recent.filter((h) => h !== href)].slice(0, 12); try { localStorage.setItem("orbit-site-read", JSON.stringify(recent)); } catch { /* fine */ }
    chart.querySelector(`.star[data-star="${starOf.get(href)}"]`)?.classList.add("read");
  };

  /* ── the chart ── */
  function drawChart() {
    narrow = innerWidth < 700;
    const W = narrow ? 600 : 1000, H = narrow ? 640 : 420;
    chart.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const rnd = seededRng(SEED);
    starOf = new Map();
    let html = field(W, H, seededRng(SEED + 7)), gi = 0;
    for (const [name, g] of Object.entries(GROUPS)) {
      const mine = INDEX.filter((e) => e.g === name), pts = walk(mine.length, narrow ? g.tall : g.wide, rnd);
      const segs = pts.slice(1).map((p, i) => { const q = pts[i]; const len = Math.hypot(p[0] - q[0], p[1] - q[1]); return `<line x1="${q[0].toFixed(1)}" y1="${q[1].toFixed(1)}" x2="${p[0].toFixed(1)}" y2="${p[1].toFixed(1)}" style="--l:${len.toFixed(0)};--i:${i}" stroke-dasharray="${len.toFixed(0)}" stroke-dashoffset="${len.toFixed(0)}"/>`; }).join("");
      const stars = pts.map(([x, y], i) => { const e = mine[i]; starOf.set(e.href, `${gi}-${i}`); return `<g class="star${e.key ? " key" : ""}${recent.includes(e.href) ? " read" : ""}" data-star="${gi}-${i}" data-href="${e.href}" style="--i:${i};--tw:${(2.6 + rnd() * 3).toFixed(1)}s;--td:${(rnd() * 4).toFixed(1)}s" tabindex="0" role="link" aria-label="${esc(e.t)}"><circle class="hit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14"/><circle class="glow" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${e.key ? 8 : 6.5}"/><circle class="ring" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${e.key ? 7 : 6}"/><circle class="dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${e.key ? 3.8 : 2.8}"/></g>`; }).join("");
      /* the name sits just under the constellation's lowest star */
      const low = pts.reduce((a, p) => (p[1] > a[1] ? p : a), pts[0]), nx = Math.max(70, Math.min(W - 70, low[0]));
      html += `<g class="con" data-group="${esc(name)}" style="--c:${g.c};--g:${gi}"><g class="lines">${segs}</g><g class="stars">${stars}</g>
        <g class="name" role="button" tabindex="0" aria-pressed="false" aria-label="Only ${esc(name)}"><line x1="${low[0].toFixed(1)}" y1="${(low[1] + 8).toFixed(1)}" x2="${nx.toFixed(1)}" y2="${(low[1] + 24).toFixed(1)}"/><text x="${nx.toFixed(1)}" y="${(low[1] + 38).toFixed(1)}" text-anchor="middle">${esc(name)}<tspan class="n"> · ${mine.length}</tspan></text></g></g>`;
      gi++;
    }
    html += `<line class="meteor" aria-hidden="true"/><g class="tip" aria-hidden="true"><line/><text/></g>`;
    chart.innerHTML = html;
    /* a star: its title beside it; a click reads it; a name: only that constellation */
    const tip = chart.querySelector(".tip"), tipLine = tip.querySelector("line"), tipText = tip.querySelector("text");
    const showTip = (s) => {
      const c = s.querySelector(".dot"), x = +c.getAttribute("cx"), y = +c.getAttribute("cy"), e = INDEX.find((e) => e.href === s.dataset.href);
      const vb = chart.viewBox.baseVal, right = x < vb.width * 0.55, dx = right ? 22 : -22;
      tipLine.setAttribute("x1", x + (right ? 9 : -9)); tipLine.setAttribute("y1", y); tipLine.setAttribute("x2", x + dx); tipLine.setAttribute("y2", y - 14);
      tipText.setAttribute("x", x + dx + (right ? 4 : -4)); tipText.setAttribute("y", y - 18); tipText.setAttribute("text-anchor", right ? "start" : "end"); tipText.textContent = e.t;
      tip.style.setProperty("--c", GROUPS[e.g].c); tip.classList.add("show"); s.classList.add("hot");
      results.querySelector(`.entry[data-href="${CSS.escape(s.dataset.href)}"]`)?.classList.add("hot");
    };
    const hideTip = (s) => { tip.classList.remove("show"); s?.classList.remove("hot"); results.querySelectorAll(".entry.hot").forEach((a) => a.classList.remove("hot")); };
    chart.querySelectorAll(".star").forEach((s) => {
      s.addEventListener("pointerenter", (e) => { if (e.pointerType !== "touch") showTip(s); });
      s.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") hideTip(s); });
      s.addEventListener("focus", () => showTip(s)); s.addEventListener("blur", () => hideTip(s));
      s.addEventListener("click", (e) => {
        const entry = results.querySelector(`.entry[data-href="${CSS.escape(s.dataset.href)}"]`);
        if (e.pointerType === "touch" || (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents)) {
          /* a finger: the star picks its entry out of the list; the entry opens it */
          showTip(s); if (entry) { entry.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" }); entry.classList.add("pick"); setTimeout(() => entry.classList.remove("pick"), 1800); }
          return;
        }
        remember(s.dataset.href); entry?.classList.add("read"); window.open(s.dataset.href, "_blank", "noopener");
      });
      s.addEventListener("keydown", (e) => { if (e.key === "Enter") { remember(s.dataset.href); window.open(s.dataset.href, "_blank", "noopener"); } });
    });
    chart.querySelectorAll(".con .name").forEach((n) => {
      const pick = () => { const g = n.closest(".con").dataset.group; group = group === g ? null : g; render(); };
      n.addEventListener("click", pick); n.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    });
    lightChart();
  }
  /* what the sky says about what is typed and chosen */
  function lightChart() {
    const q = norm(input.value.trim()), words = q.split(/\s+/).filter(Boolean);
    chart.querySelectorAll(".con").forEach((con) => {
      const g = con.dataset.group, mine = INDEX.filter((e) => e.g === g);
      let hits = 0;
      con.querySelectorAll(".star").forEach((s) => {
        const e = mine.find((e) => e.href === s.dataset.href);
        const on = (!group || group === g) && (!words.length || matches(e, words));
        s.classList.toggle("lit", on && (words.length > 0 || group === g)); s.classList.toggle("dim", !on);
        if (on) hits++;
      });
      con.classList.toggle("quiet", hits === 0 && (words.length > 0 || group));
      con.classList.toggle("chosen", group === g);
      con.querySelector(".name").setAttribute("aria-pressed", String(group === g));
    });
  }

  /* ── the list ── */
  const entry = (e, q, i) => `<a class="entry${recent.includes(e.href) ? " read" : ""}" href="${e.href}" target="_blank" rel="noopener" style="--i:${i};--c:${GROUPS[e.g]?.c ?? "#8791b3"}" data-href="${e.href}">
      <i class="star"></i><b>${mark(e.t, q)}</b><small>${mark(e.s, q)}</small><span class="where">${esc(e.g)}</span></a>`;
  function render() {
    const raw = input.value.trim(), q = norm(raw), words = q.split(/\s+/).filter(Boolean);
    lightChart();
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
      results.innerHTML = `<section><h4 style="--c:${group ? GROUPS[group]?.c : ""}"><i></i>${label}${group ? ` <button type="button" class="linkish" data-clear>everywhere</button>` : ""}</h4>${list.map((e, i) => entry(e, raw, i)).join("")}</section>`;
      results.querySelector("[data-clear]")?.addEventListener("click", () => { group = null; render(); });
    } else {
      const groups = [...new Set(INDEX.map((e) => e.g))]; let i = 0;
      results.innerHTML = groups.map((g) => `<section><h4 style="--c:${GROUPS[g]?.c}"><i></i>${esc(g)}</h4>${INDEX.filter((e) => e.g === g).map((e) => entry(e, "", i++)).join("")}</section>`).join("");
    }
    results.querySelectorAll(".entry").forEach((a) => {
      a.addEventListener("click", () => { remember(a.dataset.href); a.classList.add("read"); });
      /* the list lights the sky too: hovering an entry finds its star */
      const star = () => chart.querySelector(`.star[data-star="${starOf.get(a.dataset.href)}"]`);
      a.addEventListener("pointerenter", () => star()?.classList.add("hot"));
      a.addEventListener("pointerleave", () => star()?.classList.remove("hot"));
    });
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
    else if (e.key === "Enter" && cursor >= 0 && !e.target.matches("input,button,a,[role=link]")) { entries()[cursor]?.click(); }
  });
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if ((innerWidth < 700) !== narrow) { drawChart(); render(); } }, 150); });
  /* now and then a meteor crosses the chart — never when motion is reduced */
  let mt = 0;
  const meteor = () => {
    const vb = chart.viewBox.baseVal, m = chart.querySelector(".meteor");
    if (!m || pad.hidden || document.hidden) { mt = setTimeout(meteor, 4000); return; }
    const x = vb.width * (0.15 + Math.random() * 0.7), y = vb.height * (0.05 + Math.random() * 0.5), len = 90 + Math.random() * 120, a = (0.35 + Math.random() * 0.5) * (Math.random() < 0.5 ? 1 : -1) + Math.PI / 2;
    m.setAttribute("x1", x.toFixed(0)); m.setAttribute("y1", y.toFixed(0)); m.setAttribute("x2", (x + Math.cos(a - Math.PI / 2) * len).toFixed(0)); m.setAttribute("y2", (y + Math.sin(a - Math.PI / 2) * len).toFixed(0));
    m.style.setProperty("--l", len.toFixed(0) + "px"); m.classList.remove("go"); void m.getBoundingClientRect(); m.classList.add("go");
    mt = setTimeout(meteor, 9000 + Math.random() * 11000);
  };
  drawChart(); render();
  return {
    start() { render(); chart.classList.remove("drawn"); void chart.getBoundingClientRect(); chart.classList.add("drawn"); clearTimeout(mt); if (!reduced) mt = setTimeout(meteor, 5000 + Math.random() * 4000); },
    stop() { input.value = ""; group = null; render(); input.blur(); chart.classList.remove("drawn"); clearTimeout(mt); },
  };
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
const PACE = [3.4, 5.2, 2.6, 4.4, 6, 3.8];   /* degrees per second: each its own, slow enough to watch, so they pass one another */
const BOTTOM = 90;

export function createRing(pad, section) {
  const svg = $(".ring", pad), host = $(".stages", svg), lockup = $(".lockup", pad), big = $(".face .big", pad), rail = $(".rail", pad);
  const stage = $(".stage", pad), n = $(".n", stage), total = $(".total", stage), label = $(".label", stage), line = $(".line", stage), go = $(".go", stage);
  const items = section.items, N = items.length;
  total.textContent = String(N).padStart(2, "0");
  /* each body on an orbit of its own outside the ring, as the doors are on
     the sunrise: a faint path, a hairline circle round the body, a leader
     out to its name, which stays upright wherever the body has got to */
  const RADIUS = (i) => 80 + i * 7;
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
  /* the rail beside the ring: the six in order, the one at the bottom lit */
  const rows = rail ? items.map((it, i) => {
    const li = document.createElement("li"), b = document.createElement("button");
    b.type = "button"; b.style.setProperty("--c", it.c || "#d8b45a"); b.innerHTML = `<i></i><span>${it.name || it.label}</span>`;
    b.addEventListener("click", () => pick(i)); li.appendChild(b); rail.appendChild(li); return b;
  }) : [];
  /* each body: where it is, where it is going, and when it is due */
  const S = items.map((it, i) => ({ a: 0, from: 0, to: 0, t0: 0, t1: 0, kick: 0, locked: false, hold: holdFor(it.line) }));
  const pace = (i) => PACE[i % PACE.length];
  const CYCLE = S.reduce((sum, b) => sum + b.hold + GAP, 0);   /* one turn of the whole sequence */
  let raf = 0, current = -1, running = false;
  /* the way from one angle to the next: a short push off, a steady drift
     at one speed for as long as the way is, and a slow settle onto the
     mark at the end — the docking, not a dash */
  function angleAt(b, now) {
    if (now <= b.t0) return b.from;
    if (now >= b.t1) return b.to;
    const T = b.t1 - b.t0, t = now - b.t0, A = b.to - b.from;
    const Ti = Math.min(700, T * 0.2), Te = Math.min(1500, T * 0.45);
    const v = A / (T - Ti / 2 - Te / 2);
    if (t < Ti) { const u = t / Ti; return b.from + v * Ti * u * u / 2; }
    if (t < T - Te) return b.from + v * Ti / 2 + v * (t - Ti);
    const u = (t - (T - Te)) / Te;
    return b.from + v * Ti / 2 + v * (T - Te - Ti) + v * Te / 2 * (1 - (1 - u) * (1 - u));
  }
  /* a released body clears the mark before the next arrives: a push that it
     gives back over the rest of the way, so it still docks on time */
  const KICK_T = 2400;
  function angleWithKick(b, now) {
    const a = angleAt(b, now);
    if (!b.kick || now <= b.t0 || now >= b.t1) return a;
    const t = now - b.t0, T = b.t1 - b.t0, k = Math.min(1, t / KICK_T);
    return a + b.kick * ((1 - (1 - k) * (1 - k)) - t / T);
  }
  /* plan body i's path so it reaches the bottom at `due`: the way there, plus
     whatever whole turns its own pace would cover in the time it has */
  function plan(i, now, due, kick = 0) {
    const b = S[i], from = angleWithKick(b, now), window = Math.max(1, due - now);
    const ahead = (((BOTTOM - from) % 360) + 360) % 360;
    const want = pace(i) * window / 1000;
    const extra = Math.max(0, Math.round((want - ahead) / 360));
    b.from = from; b.to = from + ahead + 360 * extra; b.t0 = now; b.t1 = due; b.kick = kick; b.locked = false;
  }
  function lock(i) {
    current = i;
    const c = items[i].c || "#d8b45a";
    bodies.forEach((g, j) => g.classList.toggle("on", j === i));
    rows.forEach((r, j) => { r.classList.toggle("on", j === i); if (j === i) r.classList.add("seen"); });
    stage.style.setProperty("--c", c);
    lockup.style.setProperty("--c", c); lockup.style.setProperty("--hold", `${S[i].hold}ms`);
    stage.classList.remove("in"); lockup.classList.remove("in"); void stage.offsetWidth;
    n.textContent = String(i + 1).padStart(2, "0"); if (big) big.textContent = n.textContent;
    label.textContent = items[i].label; line.textContent = items[i].line;
    if (items[i].href) { go.href = items[i].href; go.hidden = false; } else go.hidden = true;
    stage.classList.add("in"); lockup.classList.add("in");
  }
  function release(i) {
    bodies[i].classList.remove("on"); rows[i]?.classList.remove("on");
    if (current === i) { stage.classList.remove("in"); lockup.classList.remove("in"); }
  }
  function frame(now) {
    if (!running) return;
    S.forEach((b, i) => {
      const held = now >= b.t1 && now < b.t1 + b.hold;
      if (held && !b.locked) { b.locked = true; lock(i); }
      if (!held && b.locked) { release(i); plan(i, now, b.t1 + CYCLE, 18); }
      /* a due that went by unseen (the page was away): the body goes round again */
      else if (!held && !b.locked && now >= b.t1 + b.hold) plan(i, now, b.t1 + CYCLE);
      b.a = angleWithKick(b, now);
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
  /* the dues, in sequence from body i at `first`: each follows the last by its hold and the gap */
  function schedule(first, i, now) {
    let due = first;
    for (let d = 0; d < N; d++) { const j = (i + d) % N; plan(j, now, due); due += S[j].hold + GAP; }
  }
  /* a body asked for: it comes to the bottom next, and the turn goes on from there */
  function pick(i) {
    const now = performance.now();
    S.forEach((b, j) => { if (b.locked) release(j); });
    schedule(now + PICK, i, now);
  }
  /* back from another tab: the sequence picks up from the next one, in step */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !running) return;
    const now = performance.now();
    S.forEach((b, j) => { if (b.locked) release(j); });
    schedule(now + PICK, current >= 0 ? (current + 1) % N : 0, now);
  });
  return {
    start() {
      running = true;
      const now = performance.now();
      rows.forEach((r) => r.classList.remove("seen", "on"));
      /* each starts where its own pace would have it, so the first cycle is already a steady drift */
      let due = now + (reduced ? 200 : LEAD);
      S.forEach((b, i) => { b.a = b.from = b.to = BOTTOM - pace(i) * (due - now) / 1000; b.t0 = b.t1 = now; due += b.hold + GAP; });
      schedule(now + (reduced ? 200 : LEAD), 0, now);
      cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false; cancelAnimationFrame(raf); raf = 0; current = -1;
      S.forEach((b) => { b.locked = false; });
      bodies.forEach((g) => g.classList.remove("on")); rows.forEach((r) => r.classList.remove("on"));
      stage.classList.remove("in"); lockup.classList.remove("in");
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
