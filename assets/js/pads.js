/*
 * THE SECTIONS — each one a landing: the ring the mark wears, with its bodies
 * on it, lit in turn, a scene in the chart pen behind, and a caption beneath.
 * The install's bodies are the stages of the install; the docs' are the
 * documents; the information's are what Orbit is, in the README's words.
 */
import { reduced, seededRng } from "./sky.js";
import { chore } from "../door/index.js";

const SVG = "http://www.w3.org/2000/svg";
const $ = (s, r = document) => r.querySelector(s);

export const SECTIONS = {
  install: { title: "Orbit", subtitle: "the install" },
  docs: { title: "Orbit", subtitle: "the docs" },
  info: { title: "Orbit", subtitle: "about" },
};

/* THE DOCS: the repositories' own markdown, imported by tools/import-docs.mjs
   (nightly, by the workflow) into assets/docs/ and read here — each source a
   page set in the site's type, each of its sections a star on the chart.
   The chart: each source is a constellation in its own colour, its stars the
   sections, placed once by a seeded walk so the same sky greets every visit.
   They draw themselves star by star on arrival. Hover a star for its title;
   click it to read; type and the stars that answer light while the rest dim.
   A constellation's name filters the list. */
const R = "https://github.com/tomlawesome/orbit";
const DOCS_DIR = "assets/docs/";
/* the docs' diagrams: mermaid from jsDelivr, the file the npm package carries (cdnjs lags majors behind), pinned and
   checked against its hash, so a changed file is refused, not run (#3). Renovate bumps the version (renovate.json);
   the hash it cannot, so a bump fails the journey's diagram step until the hash is set to the new file's:
   curl -s <src> | openssl dgst -sha384 -binary | base64 */
const MERMAID = { src: "https://cdn.jsdelivr.net/npm/mermaid@12.1.0/dist/mermaid.min.js", integrity: "sha384-EbBpjO7rlR6eqZEcG7GaPpyk9H9WrMyPWX4d3KvPYltgt8Z8l0z6R56B1qP40pR4" };
/* start here: the sections worth a first click, when the import has them */
const KEYS = ["#docs/readme/quick-start", "#docs/readme/run-with-docker", "#docs/readme/configuration", "#docs/sign-in", "#docs/security/report-a-vulnerability-privately"];
const SEED = 20260929;
/* a constellation: a gentle walk of N stars inside its box — each step turns
   a little, turns back at the box's edge, and never lands on a star already
   placed, so the shape reads as a figure and not a row */
function walk(n, [cx, cy, w, h], rnd) {
  const pts = []; let x = cx - w / 2 + rnd() * w * 0.25, y = cy + (rnd() - 0.5) * h * 0.5, ang = (rnd() - 0.5) * 0.9;
  const step = Math.max(22, Math.min(w, h * 1.6) / Math.max(1, n - 1) * 1.35), minD = step * 0.55;
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
/* the boxes the constellations are scattered into. On a wide screen the
   chart is the whole top of the page, and the figures are nestled down its
   two sides, clear of the heading, the search and the list between them;
   otherwise a loose grid across the chart, each cell nudged so no two sit in
   a row */
const WIDE_SLOTS = [[205, 150, 250, 120], [1395, 175, 250, 120], [245, 360, 260, 125], [1360, 385, 260, 125], [190, 575, 250, 120], [1415, 600, 250, 120], [250, 790, 260, 110], [1350, 805, 260, 110], [800, 860, 240, 60]];
function boxes(n, W, H, mode, rnd) {
  if (mode === "wide" && n <= WIDE_SLOTS.length) return WIDE_SLOTS.slice(0, n).map(([cx, cy, w, h]) => [cx + (rnd() - 0.5) * 40, cy + (rnd() - 0.5) * 30, w, h]);
  const cols = mode === "narrow" ? 2 : Math.min(4, Math.ceil(n / 2)), rows = Math.ceil(n / cols);
  const cw = W / cols, ch = H / rows, out = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    const cx = cw * (c + 0.5) + (rnd() - 0.5) * cw * 0.18, cy = ch * (r + 0.5) + (rnd() - 0.5) * ch * 0.22 - 8;
    out.push([cx, cy, cw * 0.62, ch * 0.5]);
  }
  return out;
}
/* the chart behind the constellations: a field of faint stars and the arcs
   of a graticule, the way a printed sky chart is ruled — as data, so the
   page and the flight's canvas draw the same sky */
function fieldData(W, H, rnd) {
  const dots = [];
  for (let i = 0, n = Math.round((W * H) / 4200); i < n; i++) {
    const r = +(0.45 + rnd() * rnd() * 1.4).toFixed(2), o = +(0.12 + rnd() * 0.5).toFixed(2);
    dots.push({ x: Math.round(rnd() * W), y: Math.round(rnd() * H), r, o, d: +(rnd() * 6).toFixed(1), t: starTint(rnd()) });
  }
  const arcs = [];
  /* parallels: shallow arcs bowing upward; meridians: leaning lines */
  for (let k = 0; k < 4; k++) { const y = H * (0.18 + k * 0.22), b = H * 0.07; arcs.push(`M-20 ${y.toFixed(0)} Q ${W / 2} ${(y - b).toFixed(0)} ${W + 20} ${y.toFixed(0)}`); }
  for (let k = 0; k < (W > 1200 ? 9 : 6); k++) { const x = W * (W > 1200 ? 0.06 + k * 0.11 : 0.08 + k * 0.17), lean = (x - W / 2) * 0.12; arcs.push(`M${(x - lean).toFixed(0)} -20 Q ${(x + lean * 0.3).toFixed(0)} ${H / 2} ${(x + lean).toFixed(0)} ${H + 20}`); }
  return { dots, arcs };
}
/* a star's colour by its temperature: most near white, some blue, some gold, a few deep amber */
const TINTS = ["#cfdcff", "#e4ebff", "#f6f4ee", "#fff4e0", "#ffe2b8", "#ffc996"];
function starTint(u) { return TINTS[u < 0.12 ? 0 : u < 0.3 ? 1 : u < 0.62 ? 2 : u < 0.82 ? 3 : u < 0.95 ? 4 : 5]; }
/* the chart's light: a glow for every star of a figure, and the fine cross of the brightest */
const chartDefs = () => `<defs><radialGradient id="aura"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".25" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <linearGradient id="spkh"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <linearGradient id="spkv" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <filter id="lblshade" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur in="SourceAlpha" stdDeviation="3.2" result="b"/><feFlood flood-color="#020306" flood-opacity=".85"/><feComposite in2="b" operator="in" result="s"/><feMerge><feMergeNode in="s"/><feMergeNode in="s"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
const fieldMarkup = ({ dots, arcs }) => `<g class="field">${dots.map((d) => `<circle cx="${d.x}" cy="${d.y}" r="${d.r}" fill="${d.t}" style="--o:${d.o};--d:${d.d}s"/>`).join("")}</g><g class="grat"><path d="${arcs.join(" ")}"/></g>`;
/* a figure's own faint cloud of light, in its colour, about its stars */
const nebula = (gi, c, pts) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const rx = (Math.max(...xs) - Math.min(...xs)) / 2 + 60, ry = (Math.max(...ys) - Math.min(...ys)) / 2 + 50;
  return `<radialGradient id="neb${gi}"><stop offset="0" stop-color="${c}" stop-opacity=".13"/><stop offset=".55" stop-color="${c}" stop-opacity=".05"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>
    <ellipse class="neb" cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" rx="${rx.toFixed(0)}" ry="${ry.toFixed(0)}" fill="url(#neb${gi})"/>
    <ellipse class="neb" cx="${(cx + rx * 0.3).toFixed(0)}" cy="${(cy - ry * 0.2).toFixed(0)}" rx="${(rx * 0.55).toFixed(0)}" ry="${(ry * 0.6).toFixed(0)}" fill="url(#neb${gi})"/>`;
};
/* a line of a figure stops short of the stars at its ends, the way a printed chart draws it */
export const GAP = 7;
const trim = (q, p, a = GAP, b = GAP) => { const dx = p[0] - q[0], dy = p[1] - q[1], l = Math.hypot(dx, dy) || 1; return [q[0] + (dx / l) * a, q[1] + (dy / l) * a, p[0] - (dx / l) * b, p[1] - (dy / l) * b, Math.max(0, l - a - b)]; };
const hrefOf = (slug, id) => (id === "top" ? `#docs/${slug}` : `#docs/${slug}/${id}`);
const when = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }); } catch { return ""; } };

export function createDocs(pad) {
  const input = $(".search input", pad), keys = $(".keys", pad), results = $(".results", pad), chart = $(".skymap .chart", pad), stamp = $(".stamp", pad);
  const index = $(".index", pad), reader = $(".reader", pad), scroll = $(".scroll", pad);
  const norm = (x) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const esc = (x) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const mark = (text, q) => {
    if (!q) return esc(text);
    const words = q.split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return esc(text).replace(new RegExp(`(${words.join("|")})`, "gi"), "<mark>$1</mark>");
  };
  const matches = (e, words) => { const hay = norm(`${e.t} ${e.s} ${e.k}`); return words.every((w) => hay.includes(w)); };
  const score = (e, words) => { const t = norm(e.t), s = norm(e.s); return words.reduce((n, w) => n + (t.includes(w) ? 4 : s.includes(w) ? 2 : 1), 0); };
  /* what the import wrote: the sources, and every section as an entry */
  let DOCS = [], ENTRIES = [], GROUPS = {}, generated = "", loading = null;
  let group = null, cursor = -1, mode = "", starOf = new Map(), geometry = null;
  const modeNow = () => (innerWidth < 700 ? "narrow" : innerWidth < 1100 ? "mid" : "wide");
  let recent = []; try { recent = JSON.parse(localStorage.getItem("orbit-site-read") || "[]"); } catch { /* fine */ }
  const remember = (href) => {
    recent = [href, ...recent.filter((h) => h !== href)].slice(0, 24); try { localStorage.setItem("orbit-site-read", JSON.stringify(recent)); } catch { /* fine */ }
    chart.querySelector(`.star[data-star="${starOf.get(href)}"]`)?.classList.add("read");
    results.querySelector(`.entry[data-href="${CSS.escape(href)}"]`)?.classList.add("read");
  };
  function load() {
    if (loading) return loading;
    /* fetched at once; read into the chart and the list as a chore (chores.js), not all at once with the rest */
    loading = fetch(DOCS_DIR + "index.json").then((r) => { if (!r.ok) throw new Error(`index.json: ${r.status}`); return r.json(); }).then((data) => chore(() => {
      DOCS = data.sources; generated = data.generated; GROUPS = {}; ENTRIES = [];
      for (const d of DOCS) {
        GROUPS[d.name] = { c: d.c, slug: d.slug };
        for (const s of d.sections) ENTRIES.push({ g: d.name, slug: d.slug, id: s.id, t: s.title, s: s.summary, k: `${s.text} ${s.subs.map((x) => x.title).join(" ")}`, href: hrefOf(d.slug, s.id), key: KEYS.includes(hrefOf(d.slug, s.id)) });
      }
      keys.innerHTML = KEYS.map((h) => ENTRIES.find((e) => e.href === h)).filter(Boolean).map((e) => `<a class="key" href="${e.href}" style="--c:${GROUPS[e.g].c}">${esc(e.t)}</a>`).join("");
      if (stamp) stamp.textContent = generated ? `charted from the repositories · ${when(generated)}` : "";
      drawChart(); render();
    }, 60, "docs")).catch(() => {
      /* a failed fetch is not remembered: the next look tries again */
      loading = null;
      results.innerHTML = `<section class="none"><h4>nothing here yet</h4><p>The docs have not been imported. They are on <a href="${R}" target="_blank" rel="noopener">the repository</a>.</p></section>`; });
    return loading;
  }

  /* ── the chart ── */
  function drawChart() {
    mode = modeNow();
    const narrow = mode === "narrow", wide = mode === "wide" && DOCS.length <= WIDE_SLOTS.length;
    const W = wide ? 1600 : narrow ? 600 : 1000, H = wide ? 900 : narrow ? Math.max(640, 170 * Math.ceil(DOCS.length / 2)) : Math.max(420, 200 * Math.ceil(DOCS.length / 4));
    chart.setAttribute("viewBox", `0 0 ${W} ${H}`);
    chart.classList.toggle("wide", wide);
    const rnd = seededRng(SEED);
    starOf = new Map();
    const fd = fieldData(W, H, seededRng(SEED + 7));
    geometry = { W, H, field: fd, cons: [] };
    let html = chartDefs() + fieldMarkup(fd), gi = 0;
    const cells = boxes(DOCS.length, W, H, wide ? "wide" : mode, seededRng(SEED + 3));
    for (const d of DOCS) {
      const name = d.name, g = GROUPS[name], mine = ENTRIES.filter((e) => e.g === name), pts = walk(mine.length, cells[gi], rnd);
      geometry.cons.push({ name, c: g.c, pts });
      const segs = pts.slice(1).map((p, i) => { const [x1, y1, x2, y2, len] = trim(pts[i], p); return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" style="--l:${len.toFixed(0)};--i:${i}" stroke-dasharray="${len.toFixed(0)}" stroke-dashoffset="${len.toFixed(0)}"/>`; }).join("");
      const stars = pts.map(([x, y], i) => {
        const e = mine[i], X = x.toFixed(1), Y = y.toFixed(1), tint = starTint(rnd()), sp = e.key ? 15 : 0;
        starOf.set(e.href, `${gi}-${i}`);
        return `<g class="star${e.key ? " key" : ""}${recent.includes(e.href) ? " read" : ""}" data-star="${gi}-${i}" data-href="${e.href}" style="--i:${i};--sc:${tint};--tw:${(2.6 + rnd() * 3).toFixed(1)}s;--td:${(rnd() * 4).toFixed(1)}s" tabindex="0" role="link" aria-label="${esc(e.t)}"><circle class="hit" cx="${X}" cy="${Y}" r="14"/><circle class="aura" cx="${X}" cy="${Y}" r="${e.key ? 16 : 11}" fill="url(#aura)"/>${sp ? `<rect class="spk" x="${(x - sp).toFixed(1)}" y="${(y - 0.45).toFixed(1)}" width="${sp * 2}" height=".9" fill="url(#spkh)"/><rect class="spk" x="${(x - 0.45).toFixed(1)}" y="${(y - sp).toFixed(1)}" width=".9" height="${sp * 2}" fill="url(#spkv)"/>` : ""}<circle class="glow" cx="${X}" cy="${Y}" r="${e.key ? 8 : 6.5}"/><circle class="ring" cx="${X}" cy="${Y}" r="${e.key ? 7 : 6}"/><circle class="dot" cx="${X}" cy="${Y}" r="${e.key ? 3.6 : 2.6}"/></g>`;
      }).join("");
      /* the name sits just under the constellation's lowest star */
      const low = pts.reduce((a, p) => (p[1] > a[1] ? p : a), pts[0]), nx = Math.max(70, Math.min(W - 70, low[0]));
      html += `<g class="con" data-group="${esc(name)}" style="--c:${g.c};--g:${gi}">${nebula(gi, g.c, pts)}<g class="lines">${segs}</g><g class="stars">${stars}</g>
        <g class="name" role="button" tabindex="0" aria-pressed="false" aria-label="Only ${esc(name)}"><line x1="${low[0].toFixed(1)}" y1="${(low[1] + 8).toFixed(1)}" x2="${nx.toFixed(1)}" y2="${(low[1] + 24).toFixed(1)}"/><text x="${nx.toFixed(1)}" y="${(low[1] + 38).toFixed(1)}" text-anchor="middle">${esc(name)}<tspan class="n"> · ${mine.length}</tspan></text></g></g>`;
      gi++;
    }
    html += `<line class="meteor" aria-hidden="true"/><g class="tip" aria-hidden="true"><line/><text/></g>`;
    chart.innerHTML = html;
    /* a star: its title beside it; a click reads it; a name: only that constellation */
    const tip = chart.querySelector(".tip"), tipLine = tip.querySelector("line"), tipText = tip.querySelector("text");
    const showTip = (s) => {
      const c = s.querySelector(".dot"), x = +c.getAttribute("cx"), y = +c.getAttribute("cy"), e = ENTRIES.find((e) => e.href === s.dataset.href);
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
        go(s.dataset.href);
      });
      s.addEventListener("keydown", (e) => { if (e.key === "Enter") go(s.dataset.href); });
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
      const g = con.dataset.group, mine = ENTRIES.filter((e) => e.g === g);
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
  const entry = (e, q, i) => `<a class="entry${recent.includes(e.href) ? " read" : ""}" href="${e.href}" style="--i:${i};--c:${GROUPS[e.g]?.c ?? "#8791b3"}" data-href="${e.href}">
      <i class="star"></i><b>${mark(e.t, q)}</b><small>${mark(e.s, q)}</small><span class="where">${esc(e.g)}</span></a>`;
  function render() {
    if (!DOCS.length) return;
    const raw = input.value.trim(), q = norm(raw), words = q.split(/\s+/).filter(Boolean);
    lightChart();
    cursor = -1;
    let list = ENTRIES.filter((e) => !group || e.g === group);
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
      let i = 0;
      results.innerHTML = DOCS.map((d) => `<section><h4 style="--c:${d.c}"><i></i>${esc(d.name)}</h4>${ENTRIES.filter((e) => e.g === d.name).map((e) => entry(e, "", i++)).join("")}</section>`).join("");
    }
    results.querySelectorAll(".entry").forEach((a) => {
      a.addEventListener("click", (e) => { e.preventDefault(); go(a.dataset.href); });
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
  keys.addEventListener("click", (e) => { const a = e.target.closest("a.key"); if (a) { e.preventDefault(); go(a.getAttribute("href")); } });
  input.addEventListener("input", render);
  input.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); move(1); } if (e.key === "Escape") { input.value = ""; group = null; render(); } });
  document.addEventListener("keydown", (e) => {
    if (pad.hidden) return;
    if (e.key === "/" && !e.target.matches("input,textarea")) { e.preventDefault(); if (!reader.hidden) close(); input.focus(); return; }
    if (e.key === "Escape" && !reader.hidden && !e.target.matches("input")) { close(); return; }
    if (!reader.hidden) return;
    if (e.target === input && e.key !== "ArrowDown") return;
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter" && cursor >= 0 && !e.target.matches("input,button,a,[role=link]")) { entries()[cursor]?.click(); }
  });
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (DOCS.length && modeNow() !== mode) { drawChart(); render(); } }, 150); });
  /* now and then a meteor crosses the chart — never when motion is reduced */
  let mt = 0;
  const meteor = () => {
    const vb = chart.viewBox.baseVal, m = chart.querySelector(".meteor");
    if (!m || pad.hidden || document.hidden || !reader.hidden) { mt = setTimeout(meteor, 4000); return; }
    const x = vb.width * (0.15 + Math.random() * 0.7), y = vb.height * (0.05 + Math.random() * 0.5), len = 90 + Math.random() * 120, a = (0.35 + Math.random() * 0.5) * (Math.random() < 0.5 ? 1 : -1) + Math.PI / 2;
    m.setAttribute("x1", x.toFixed(0)); m.setAttribute("y1", y.toFixed(0)); m.setAttribute("x2", (x + Math.cos(a - Math.PI / 2) * len).toFixed(0)); m.setAttribute("y2", (y + Math.sin(a - Math.PI / 2) * len).toFixed(0));
    m.style.setProperty("--l", len.toFixed(0) + "px"); m.classList.remove("go"); void m.getBoundingClientRect(); m.classList.add("go");
    mt = setTimeout(meteor, 9000 + Math.random() * 11000);
  };

  /* ── the reader: a source, set as a page ── */
  const pages = new Map();
  let indexScroll = 0, tocWatch = null;
  const fetchPage = (slug) => pages.get(slug) || fetch(`${DOCS_DIR}${slug}.json`).then((r) => { if (!r.ok) throw new Error(slug); return r.json(); }).then((d) => { pages.set(slug, d); return d; });
  async function open(slug, anchor, push = true) {
    let doc; try { doc = await fetchPage(slug); } catch { close(push); return; }
    const d = DOCS.find((x) => x.slug === slug) || doc, at = DOCS.findIndex((x) => x.slug === slug);
    const prev = at > 0 ? DOCS[at - 1] : null, next = at > -1 && at < DOCS.length - 1 ? DOCS[at + 1] : null;
    reader.style.setProperty("--c", d.c);
    $(".readhead .from .src", reader).textContent = d.name;
    $(".readhead h1", reader).textContent = doc.title;
    $(".readhead .source", reader).innerHTML = `set from <a href="https://github.com/${esc(doc.repo)}/blob/main/${esc(doc.path)}" target="_blank" rel="noopener">${esc(doc.repo)} · ${esc(doc.path)}</a>${generated ? ` · imported ${esc(when(generated))}` : ""}`;
    $(".onpage", reader).hidden = doc.sections.filter((s) => s.id !== "top").length < 2;
    $(".body", reader).innerHTML = doc.sections.map((s) => `<section class="sec" data-id="${esc(s.id)}">${s.html}</section>`).join("");
    $(".readnav", reader).innerHTML = `${prev ? `<a class="prev" href="#docs/${prev.slug}" style="--c:${prev.c}"><b>before</b>${esc(prev.title)}</a>` : "<span></span>"}${next ? `<a class="next" href="#docs/${next.slug}" style="--c:${next.c}"><b>next</b>${esc(next.title)}</a>` : "<span></span>"}`;
    if (indexScroll === 0 && reader.hidden) indexScroll = scroll.scrollTop;
    reader.hidden = false; index.hidden = true; pad.classList.add("reading");
    reader.classList.remove("in"); void reader.offsetWidth; reader.classList.add("in");
    pageChart(slug, doc); otherCharts(slug);   /* once shown, so the margin's names can be measured */
    remember(hrefOf(slug, doc.sections.some((s) => s.id === anchor) ? anchor : "top"));
    if (push) { try { history.pushState({ docs: slug, anchor }, "", hrefOf(slug, anchor || "top")); } catch { /* fine */ } }
    const target = anchor && reader.querySelector(`#${CSS.escape(anchor)}`);
    scroll.scrollTop = 0;
    if (target) requestAnimationFrame(() => { const y = target.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - 96; scroll.scrollTop = Math.max(0, y); });
    watchToc(); drawDiagrams();
  }
  function close(push = true) {
    if (reader.hidden) return;
    reader.hidden = true; index.hidden = false; pad.classList.remove("reading");
    tocWatch?.disconnect(); tocWatch = null;
    scroll.scrollTop = indexScroll; indexScroll = 0;
    if (push) { try { history.pushState(null, "", "#docs"); } catch { /* fine */ } }
  }
  /* the page's own constellation: its sections as a line of stars down the
     margin, in reading order, the one being read lit */
  function pageChart(slug, doc) {
    const svg = $(".pagechart", reader), secs = doc.sections.filter((s) => s.id !== "top"), rnd = seededRng(SEED + slug.length * 31 + secs.length);
    const STEP = 42, W = 240, H = 16 + STEP * secs.length;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.style.height = `${H}px`;
    const pts = secs.map((s, i) => [18 + rnd() * 22, 20 + i * STEP + (rnd() - 0.5) * 10]);
    const lines = pts.slice(1).map((p, i) => { const q = pts[i], len = Math.hypot(p[0] - q[0], p[1] - q[1]); return `<line x1="${q[0].toFixed(1)}" y1="${q[1].toFixed(1)}" x2="${p[0].toFixed(1)}" y2="${p[1].toFixed(1)}" stroke-dasharray="${len.toFixed(0)}" stroke-dashoffset="${len.toFixed(0)}" style="--i:${i}"/>`; }).join("");
    const stars = secs.map((s, i) => { const [x, y] = pts[i], href = hrefOf(slug, s.id); return `<g class="pstar${recent.includes(href) ? " read" : ""}" data-id="${esc(s.id)}" data-href="${href}" style="--i:${i}" tabindex="0" role="link" aria-label="${esc(s.title)}"><rect class="hit" x="0" y="${(y - STEP / 2).toFixed(1)}" width="${W}" height="${STEP}"/><circle class="glow" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7"/><circle class="ring" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6"/><circle class="dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.8"/><text x="${(x + 16).toFixed(1)}" y="${y.toFixed(1)}" dominant-baseline="middle">${esc(s.title)}</text></g>`; }).join("");
    svg.innerHTML = `<g class="lines">${lines}</g>${stars}`;
    svg.querySelectorAll(".pstar").forEach((g) => {
      g.addEventListener("click", () => go(g.dataset.href));
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(g.dataset.href); } });
    });
    /* a title too long for the margin is trimmed to fit */
    svg.querySelectorAll(".pstar text").forEach((t) => { let s = t.textContent; while (t.getComputedTextLength() > W - +t.getAttribute("x") - 4 && s.length > 4) { s = s.slice(0, -2); t.textContent = s + "…"; } });
    svg.classList.remove("drawn"); void svg.getBoundingClientRect(); svg.classList.add("drawn");
  }
  /* the other sources, each its own small constellation in the far margin */
  function otherCharts(slug) {
    const host = $(".others .minis", reader);
    host.innerHTML = DOCS.filter((d) => d.slug !== slug).map((d, k) => {
      const n = Math.min(9, Math.max(3, d.sections.length)), rnd = seededRng(SEED + d.slug.length * 17 + n), pts = walk(n, [90, 30, 140, 40], rnd);
      const lines = pts.slice(1).map((p, i) => { const q = pts[i]; return `<line x1="${q[0].toFixed(1)}" y1="${q[1].toFixed(1)}" x2="${p[0].toFixed(1)}" y2="${p[1].toFixed(1)}"/>`; }).join("");
      const stars = pts.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2"/>`).join("");
      return `<a class="mini" href="#docs/${d.slug}" style="--c:${d.c};--i:${k}"><svg viewBox="0 0 180 60" aria-hidden="true"><g class="lines">${lines}</g><g class="stars">${stars}</g></svg><span>${esc(d.name)}</span></a>`;
    }).join("");
  }
  /* the page's constellation follows the reading */
  function watchToc() {
    tocWatch?.disconnect();
    const links = [...reader.querySelectorAll(".pagechart .pstar")]; if (!links.length) return;
    const seen = new Map();
    tocWatch = new IntersectionObserver((es) => {
      for (const e of es) seen.set(e.target.dataset.id, e.isIntersecting);
      const first = [...reader.querySelectorAll(".sec")].find((s) => seen.get(s.dataset.id));
      links.forEach((a) => a.classList.toggle("on", !!first && a.dataset.id === first.dataset.id));
    }, { root: scroll, rootMargin: "-80px 0px -60% 0px", threshold: 0 });
    reader.querySelectorAll(".sec").forEach((s) => tocWatch.observe(s));
  }
  /* diagrams in the source: drawn by mermaid, fetched only when a page has one */
  let mermaid = null;
  function drawDiagrams() {
    const figs = [...reader.querySelectorAll("figure[data-mermaid]")]; if (!figs.length) return;
    const draw = async () => {
      for (const f of figs) {
        const src = f.querySelector("pre")?.textContent; if (!src || f.dataset.drawn) continue;
        try { const { svg } = await window.mermaid.render(`mm${Math.random().toString(36).slice(2, 8)}`, src); f.insertAdjacentHTML("afterbegin", svg); f.querySelector("figcaption").remove(); }
        catch { f.innerHTML = `<pre class="code" data-lang="mermaid"><code>${esc(src)}</code></pre>`; }
        f.dataset.drawn = "1";
      }
    };
    if (window.mermaid) { draw(); return; }
    if (!mermaid) {
      mermaid = new Promise((resolve, reject) => {
        const s = document.createElement("script"); s.src = MERMAID.src; s.integrity = MERMAID.integrity; s.crossOrigin = "anonymous"; s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
      }).then(() => {
        const dark = document.documentElement.dataset.theme !== "day";
        window.mermaid.initialize({ startOnLoad: false, theme: "base", themeVariables: { darkMode: dark, background: "transparent", primaryColor: dark ? "#131c3a" : "#eef2fb", primaryTextColor: dark ? "#e9edf8" : "#0b1020", primaryBorderColor: dark ? "#3a4a7a" : "#9aa8c8", lineColor: dark ? "#8791b3" : "#5a6684", fontFamily: "Inter, system-ui, sans-serif", fontSize: "13px" } });
      });
    }
    mermaid.then(draw).catch(() => figs.forEach((f) => { const src = f.querySelector("pre")?.textContent || ""; f.innerHTML = `<pre class="code" data-lang="mermaid"><code>${esc(src)}</code></pre>`; }));
  }
  /* any #docs link, wherever it is written on this landing, is read here */
  function go(hash, push = true) {
    const m = /^#docs(?:\/([^/#]+))?(?:\/([^#]+))?$/.exec(hash || "");
    if (!m) return false;
    if (m[1]) load().then(() => open(m[1], m[2] ? decodeURIComponent(m[2]) : null, push)); else close(push);
    return true;
  }
  reader.addEventListener("click", (e) => {
    const a = e.target.closest("a"); if (!a) return;
    const h = a.getAttribute("href") || "";
    if (h.startsWith("#docs")) { e.preventDefault(); go(h); }
  });
  $(".readhead .todocs", reader).addEventListener("click", () => close());
  /* back and forward within the docs; leaving them (no #docs) is main.js's */
  addEventListener("popstate", () => { if (!pad.hidden && location.hash.startsWith("#docs")) go(location.hash, false); });
  /* where the chart will sit on screen, measured with the landing still unseen */
  function chartRect() {
    const was = pad.hidden;
    if (was) { pad.style.visibility = "hidden"; pad.hidden = false; }
    if (modeNow() !== mode && DOCS.length) drawChart();
    const r = chart.getBoundingClientRect();
    if (was) { pad.hidden = true; pad.style.visibility = ""; }
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  return {
    ready: load,
    /* the flight to the docs carries the chart: its constellations pass on the
       way, and the streaks settle into the chart itself on arrival */
    flight() { return DOCS.length && geometry ? { rect: chartRect(), geometry } : null; },
    /* arriving by flight the chart is already on the canvas, so the page's own
       chart appears whole under it rather than drawing itself in again */
    settle() { chart.classList.add("drawn", "settled"); },
    start() { load().then(() => { render(); if (!chart.classList.contains("settled")) { chart.classList.remove("drawn"); void chart.getBoundingClientRect(); chart.classList.add("drawn"); } if (location.hash.startsWith("#docs/")) go(location.hash, false); }); clearTimeout(mt); if (!reduced) mt = setTimeout(meteor, 5000 + Math.random() * 4000); },
    stop() { close(false); input.value = ""; group = null; if (DOCS.length) render(); input.blur(); chart.classList.remove("drawn", "settled"); clearTimeout(mt); },
    go,
  };
}

/* the information: a page to read, each chapter arriving as it is reached */
export function createInfo(pad, world = null) {
  const scroll = $(".scroll", pad), scenes = [...pad.querySelectorAll(".scene")];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent?.appendChild(e); return e; };
  const seen = new Set();
  const io = new IntersectionObserver((es) => {
    for (const x of es) { if (x.isIntersecting) { x.target.classList.add("in"); seen.add(x.target.dataset.scene); } else seen.delete(x.target.dataset.scene); }
    /* the relay plays the moment it is scrolled to, not on a clock of its own */
    if (live && seen.has("relay") && !relaying) relayLoop();
  }, { root: scroll, threshold: 0.2 });

  /* the orbit: the household's year, a month a second. Each item draws in as it comes due, is done at the dashed ring,
     and swings back out to its next date */
  const svg = pad.querySelector(".yearring svg"), rings = svg.querySelector(".rings"), bodiesG = svg.querySelector(".bodies"), today = svg.querySelector(".date");
  const R = (days) => 46 + Math.min(1, days / 365) * 128;
  for (const [d, label] of [[30, "a month"], [91, "three months"], [182, "six months"], [365, "a year"]]) {
    el("circle", { cx: 200, cy: 200, r: R(d), class: d === 365 ? "month" : "" }, rings);
    el("text", { x: 200 + R(d) * Math.cos(-0.95) + 4, y: 200 + R(d) * Math.sin(-0.95) - 3 }, rings).textContent = label;
  }
  const ITEMS = [["Boiler service", 365, 40, "#f0b429", 30], ["Car MOT", 365, 128, "#8fb8ff", 112], ["Home insurance", 365, 205, "#a78bfa", 196],
    ["Broadband", 540, 300, "#4ade80", 282], ["Smoke alarms", 182, 16, "#f87171", 330], ["Chimney sweep", 365, 262, "#f0b429", 158], ["Laptop warranty", 730, 340, "#8fb8ff", 244]]
    .map(([name, period, days, c, deg]) => {
      const g = el("g", {}, bodiesG);
      const halo = el("circle", { r: 11, fill: c, opacity: 0.18 }, g), dot = el("circle", { r: 4.6, fill: c }, g);
      const text = el("text", {}, g); text.textContent = name;
      return { name, period, days, c, a: (deg * Math.PI) / 180, rr: R(days), g, halo, dot, text, flash: 0 };
    });
  let day0 = new Date(2026, 9, 2).getTime(), elapsed = 0, last = 0, raf = 0;
  function orbit(now) {
    raf = requestAnimationFrame(orbit);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0; last = now;
    if (!seen.has("orbit") || dt === 0) return;
    const step = dt * 30; elapsed += step;
    today.textContent = new Date(day0 + elapsed * 864e5).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    for (const b of ITEMS) {
      b.days -= step; b.a += dt * 0.07;
      if (b.days <= 0) { b.days += b.period; b.flash = 1; }
      b.flash = Math.max(0, b.flash - dt * 0.9);
      b.rr += (R(b.days) - b.rr) * Math.min(1, dt * 3.2);
      const x = 200 + Math.cos(b.a) * b.rr, y = 200 + Math.sin(b.a) * b.rr, out = x > 200 ? 1 : -1;
      b.g.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      const near = 1 - Math.min(1, b.days / 60), col = b.flash > 0 ? "#4ade80" : b.c;
      b.dot.setAttribute("fill", col); b.halo.setAttribute("fill", col);
      b.halo.setAttribute("r", (9 + near * 6 + b.flash * 14).toFixed(1)); b.halo.setAttribute("opacity", (0.14 + near * 0.2 + b.flash * 0.3).toFixed(2));
      b.text.setAttribute("x", out * 12); b.text.setAttribute("y", 3.5); b.text.setAttribute("text-anchor", out > 0 ? "start" : "end");
      b.text.textContent = b.flash > 0.25 ? `✓ ${b.name}` : b.name;
    }
  }

  /* the item: completed, and its next date worked out; then again */
  const card = pad.querySelector(".card.unit");
  /* the relay: forwarded, read, asked */
  const steps = [...pad.querySelectorAll(".relay .step")];
  let timers = [];
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));
  function itemLoop() {
    if (seen.has("item")) {
      card.classList.add("press"); later(260, () => card.classList.remove("press"));
      later(320, () => card.classList.add("done"));
      later(3600, () => card.classList.remove("done"));
    }
    later(5200, itemLoop);
  }
  /* played while it is in view, from the moment it comes into view: forwarded, read, asked, half a second apart;
     held to be read; let go a moment; again */
  let relaying = false, live = false;
  function relayLoop() {
    if (!seen.has("relay")) { relaying = false; return; }
    relaying = true;
    steps.forEach((x, i) => later(120 + i * 520, () => x.classList.add("on")));
    later(5200, () => steps.forEach((x) => x.classList.remove("on")));
    later(5800, relayLoop);
  }
  /* the world under the title gives way as the scenes are read: dimmed by the first screen of scrolling, and, once
     all but gone, not drawn at all until it is scrolled back to */
  let worldOn = true;
  const onScroll = () => {
    const a = 1 - 0.85 * Math.min(1, Math.max(0, scroll.scrollTop / (scroll.clientHeight * 0.75)));
    pad.style.setProperty("--worldA", a.toFixed(3));
    if (!world) return;
    if (a < 0.2 && worldOn) { worldOn = false; world.stop(); }
    else if (a >= 0.2 && !worldOn) { worldOn = true; world.start(); }
  };
  return {
    start() {
      scroll.scrollTop = 0; seen.clear();
      pad.style.setProperty("--worldA", "1"); worldOn = true; scroll.addEventListener("scroll", onScroll, { passive: true });
      scenes.forEach((c) => { c.classList.remove("in"); io.observe(c); });
      if (reduced) { card.classList.add("done"); steps.forEach((x) => x.classList.add("on")); return; }
      last = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(orbit);
      timers.forEach(clearTimeout); timers = []; live = true; relaying = false; itemLoop(); relayLoop();
    },
    stop() { live = false; relaying = false; scenes.forEach((c) => io.unobserve(c)); scroll.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); timers.forEach(clearTimeout); timers = []; },
  };
}

/* One ring. Its bodies all orbit the same way, slowly, each at a pace of its
   own — and the right one arrives at the bottom of the ring exactly as its
   line appears, rests there while the line is read, and drifts on before the
   next comes round. Each body's path is planned back from the moment it is
   due: it covers what its pace allows in the time it has, and no more. */
/* a line is held for as long as it takes to read: a floor, and time per word */

/* the planets on the sunrise's ring: each one a door, named on the ring itself */
export function wirePlanets(door, onGo) {
  /* the name sits 21 units past the body, 15 on a phone, where the outermost orbit runs close to the edge;
     in the rich look, with no leader to carry it, it sits just past the world's own glow */
  const rich = document.documentElement.classList.contains("rich"), past = rich ? (innerWidth < 560 ? 12 : 15) : innerWidth < 560 ? 15 : 21;
  const planets = [...door.querySelectorAll(".planet")].map((p) => ({ p, spin: p.querySelector(".spin"), body: p.querySelector(".body"), tag: p.querySelector(".tag"), rb: +p.dataset.r / 200, r: (+p.dataset.r + past) / 200 }));
  const gold = door.querySelector(".trdot"), goldBody = gold?.querySelector("i");
  const GOLD_AT = Math.atan2(63, 36.5), GOLD_R = Math.hypot(63, 36.5) / 200;   /* where the gold world sits on its turning frame */
  planets.forEach(({ p }) => {
    p.addEventListener("click", (e) => { e.preventDefault(); onGo(p.dataset.section); });
    p.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onGo(p.dataset.section); } });
  });
  /* the door's measure: the ring's size and centre, and each name's width (the names ride their planets, build3d) */
  let size = 0, cx = 0, cy = 0, widths = [];
  const measure = () => {
    const box = door.querySelector(".planets"), r = box.getBoundingClientRect();
    size = box.clientWidth || 0; cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    widths = planets.map(({ tag }) => tag.offsetWidth);
  };
  measure(); addEventListener("resize", measure);
  const clamp = (x) => Math.max(-1, Math.min(1, x));
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  /* in the rich look each world's lit side faces the sun, just under the horizon below: the picture is held upright
     against its orbit by the stylesheet, and turned here by the sun's angle from it */
  const lightAt = (x, y) => {
    const s = Math.max(innerWidth / 1600, innerHeight / 1000), sx = innerWidth / 2, sy = innerHeight - 70 * s;
    return Math.atan2(-(sx - x), sy - y);
  };
  /* in the rich look the orbits are three dimensional: each planet's orbit an ellipse in a plane of its own, tilted
     back from the face of the ring and turned a little about the line of sight, seen in perspective. The planets
     go behind the ring and the name on the far side and in front of them on the near, a little larger and
     brighter as they come towards you. Drawn here each frame: the orbits' paths once, into the ring's own
     picture; each planet's place, size, depth and light; and its name beside it */
  /* each orbit as a planet's is: an ellipse (a, its size in the ring's units; e, how far from round; w, where its
     nearest point lies), in a plane of its own (tilt back from the face, turned by node about the line of sight),
     gone round at Kepler's pace (the period growing as a^1.5, so the outer planets are slower) and faster near its
     nearest point (the equal areas): their spacing changes, as real planets' does, and they meet only now and then */
  const ORBITS = {
    docs: { a: 86, e: 0.15, w: 35, tilt: 61, node: -15, M0: 0.1 },
    install: { a: 102, e: 0.1, w: 160, tilt: 67, node: 10, M0: 0.45 },
    info: { a: 116, e: 0.18, w: 285, tilt: 64, node: -4, M0: 0.78 },
  }, DEPTH = 430, P0 = 46000;
  const rad = (d) => (d * Math.PI) / 180;
  /* the place on the ellipse at an eccentric anomaly E, in the orbit's plane */
  const onEllipse = (o, E) => {
    const xo = o.a * (Math.cos(E) - o.e), yo = o.a * Math.sqrt(1 - o.e * o.e) * Math.sin(E), w = rad(o.w);
    return [xo * Math.cos(w) - yo * Math.sin(w), xo * Math.sin(w) + yo * Math.cos(w)];
  };
  /* Kepler's equation, M = E − e sin E, solved for E */
  const anomaly = (o, M) => { let E = M; for (let i = 0; i < 6; i++) E -= (E - o.e * Math.sin(E) - M) / (1 - o.e * Math.cos(E)); return E; };
  const project = ([x, y], T, N) => {
    const yp = y * Math.cos(T), z = y * Math.sin(T);
    const X = x * Math.cos(N) - yp * Math.sin(N), Y = x * Math.sin(N) + yp * Math.cos(N), k = DEPTH / (DEPTH - z);
    return [X * k, Y * k, z, k];
  };
  let orbits3d = null;
  function setup3d() {
    const svg = door.querySelector("#login-glyph svg"), ring = svg?.querySelector(".ring:not(.lux)");
    orbits3d = planets.map(({ p, spin }) => {
      const o = ORBITS[p.dataset.section] || { a: +p.dataset.r, e: 0, w: 0, tilt: 65, node: 0, M0: 0 };
      const bs = parseFloat(getComputedStyle(p.querySelector(".body")).getPropertyValue("--bs")) || 15;
      const dur = P0 * Math.pow(o.a / ORBITS.docs.a, 1.5);
      const rec = { o, T: rad(o.tilt), N: rad(o.node), dur, t0: o.M0 * dur, spin, bs, anims: [], hover: false };
      /* the system stops while a planet is under the pointer (all of it, so they keep their spacing), and a planet
         stays stopped while the camera goes to it */
      const sync = () => { const stop = orbits3d.some((r) => r.hover) || p.classList.contains("chosen") || reduced; rec.anims.forEach((x) => (stop ? x.pause() : x.play())); };
      const hold = (v) => () => { rec.hover = v; orbits3d.forEach((r) => r.sync()); };
      p.addEventListener("pointerenter", hold(true)); p.addEventListener("pointerleave", hold(false));
      /* focus holds the system as a pointer does, but only focus that shows (the keyboard's): the focus a journey back
         gives the planet it came from would otherwise hold everything until the next click */
      p.addEventListener("focus", () => { if (p.matches(":focus-visible")) hold(true)(); }); p.addEventListener("blur", hold(false));
      new MutationObserver(sync).observe(p, { attributes: true, attributeFilter: ["class"] });
      rec.sync = sync;
      return rec;
    });
    /* the paths: the far half under the ring, the near half over it */
    if (svg && ring) {
      const NS = "http://www.w3.org/2000/svg", far = document.createElementNS(NS, "g"), near = document.createElementNS(NS, "g");
      far.setAttribute("class", "o3 far lux"); near.setAttribute("class", "o3 near lux");
      planets.forEach(({ rb }, i) => {
        const { o, T, N } = orbits3d[i], runs = { far: [], near: [] };
        let cur = null, side = null;
        for (let k = 0; k <= 180; k++) {
          const [X, Y, z] = project(onEllipse(o, (k / 180) * Math.PI * 2), T, N), sd = z < 0 ? "far" : "near";
          if (sd !== side) { if (cur) cur.push([X, Y]); cur = []; runs[sd].push(cur); side = sd; }
          cur.push([X, Y]);
        }
        for (const sd of ["far", "near"]) for (const run of runs[sd]) {
          if (run.length < 2) continue;
          const path = document.createElementNS(NS, "path");
          path.setAttribute("d", run.map(([x, y], j) => `${j ? "L" : "M"}${(100 + x).toFixed(2)} ${(100 + y).toFixed(2)}`).join(""));
          (sd === "far" ? far : near).appendChild(path);
        }
      });
      ring.parentNode.insertBefore(far, svg.querySelector(".ring"));
      ring.after(near);
    }
  }
  /* the motion is given to the compositor, so it carries on whatever the page is busy with (the journeys load
     in the background a moment after the dawn comes up): each planet's whole orbit is worked out once, here,
     into keyframes (its place, size and depth; the turn of its picture towards the sun; its name's place), and
     played on a loop at its own pace. Only the change of side, behind the ring or in front, is left to the
     page, and that falls at the two ends of the orbit, out past the ring, where nothing is crossed */
  const STEPS = 144;
  function build3d() {
    if (!orbits3d) setup3d();
    measure();
    if (!size) return;
    const u = size / 200;
    planets.forEach(({ body, tag, rb }, i) => {
      const o = orbits3d[i], at = o.anims[0] ? o.anims[0].currentTime : o.t0;
      o.anims.forEach((x) => x.cancel());
      const spinK = [], bodyK = [], tagK = [], zK = [], sides = [];
      let prev = null, side = null;
      for (let j = 0; j <= STEPS; j++) {
        const offset = j / STEPS, [X, Y, z, k] = project(onEllipse(o.o, anomaly(o.o, offset * Math.PI * 2)), o.T, o.N), zr = z / (o.o.a * (1 + o.o.e) * Math.sin(o.T));
        const x = X * u, y = Y * u;
        spinK.push({ offset, transform: `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${k.toFixed(4)})`, opacity: +(0.66 + (0.34 * (zr + 1)) / 2).toFixed(3) });
        /* the light: the sun's angle, unwound so the picture never spins the long way round between steps */
        let th = lightAt(cx + x, cy + y);
        if (prev !== null) th = prev + (((th - prev + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        prev = th; bodyK.push({ offset, rotate: `${th.toFixed(4)}rad` });
        /* the name: out from the centre, just past the world, upright; beside it when the world is low */
        const d = Math.hypot(x, y) || 1, ux = x / d, uy = y / d, off = (o.bs / 2) * k * u + 7 * u;
        const below = smooth(0.6, 0.9, uy), sx = ux >= 0 ? 1 : -1;
        let tx = x + ux * off, ty = y + uy * off, ax = -50 + 50 * clamp(ux / 0.5), ay = -50 + 50 * clamp(uy / 0.6);
        tx += (x + sx * off - tx) * below; ty += (y - ty) * below;
        ax += ((sx > 0 ? 0 : -100) - ax) * below; ay += (-50 - ay) * below;
        const w = widths[i] || 0, left = cx + tx + (ax / 100) * w, right = left + w;
        if (left < 8) tx += 8 - left; else if (right > innerWidth - 8) tx -= right - (innerWidth - 8);
        tagK.push({ offset, transform: `translate(calc(${tx.toFixed(1)}px + ${ax.toFixed(1)}%), calc(${ty.toFixed(1)}px + ${ay.toFixed(1)}%))` });
        /* which side of the ring it is drawn on: behind the ring's plane, under it; before, over it. The change is
           held while the world overlaps the ring's stroke, so it never jumps from under to over in one frame (it
           changes just before it reaches the stroke, or just after it has left it) */
        sides.push({ offset, want: z < 0 ? 1 : 5, clear: Math.abs(Math.hypot(x, y) / u - 72) > (o.bs / 2) * k + 7 });
      }
      /* run twice over, so the side at the lap's end is the side at its start (the held changes settle on the first lap) */
      for (let pass = 0; pass < 2; pass++) for (const st of sides) {
        if (side === null) side = st.want;
        else if (st.want !== side && st.clear) side = st.want;
        if (pass === 1 && (zK.length === 0 || zK[zK.length - 1].zIndex !== side)) zK.push({ offset: st.offset, zIndex: side });
      }
      /* the side held flat between its changes */
      const zSteps = [];
      zK.forEach((kf, n) => { zSteps.push(kf); const next = zK[n + 1]; zSteps.push({ offset: next ? next.offset : 1, zIndex: kf.zIndex }); });
      const timing = { duration: o.dur, iterations: Infinity, easing: "linear" };
      /* the picture's turn to the sun is on its ::before; where a browser cannot animate that, the planets still orbit */
      let light = null;
      try { light = body.animate(bodyK, { ...timing, pseudoElement: "::before" }); } catch { /* lit as drawn */ }
      o.anims = [o.spin.animate(spinK, timing), light, tag.animate(tagK, timing), o.spin.animate(zSteps.map((k, n) => ({ ...k, offset: Math.min(1, k.offset + (n % 2 ? -1e-6 : 0)) })), timing)].filter(Boolean);
      o.anims.forEach((x) => { x.currentTime = at; });
      o.sync();
    });
    buildGold();
  }
  /* the gold world rides the ring (the stylesheet turns it), its lit side to the sun: that turn worked out once for
     a lap, as the planets' are, and kept in step with the ring's */
  let goldLight = null;
  function buildGold() {
    goldLight?.cancel(); goldLight = null;
    const ride = gold?.getAnimations()[0];
    if (!goldBody || !ride || !size) return;
    const N = 96, k = [];
    let prev = null;
    for (let j = 0; j <= N; j++) {
      const g = (j / N) * Math.PI * 2 + GOLD_AT;
      let th = lightAt(cx + Math.sin(g) * GOLD_R * size, cy - Math.cos(g) * GOLD_R * size);
      if (prev !== null) th = prev + (((th - prev + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      prev = th; k.push({ offset: j / N, rotate: `${th.toFixed(4)}rad` });
    }
    const t = ride.effect.getTiming();
    try { goldLight = goldBody.animate(k, { duration: t.duration, iterations: Infinity, easing: "linear", pseudoElement: "::before" }); } catch { return; }
    syncGold();
  }
  /* the ring's turn starts again whenever the door is shown (a CSS animation does): the light starts with it */
  function syncGold() {
    const ride = gold?.getAnimations()[0];
    if (goldLight && ride) goldLight.currentTime = (ride.currentTime || 0) - (ride.effect.getTiming().delay || 0);
  }
  let built = false, stale = false, placing = false;
  /* a resize while the door is away is caught up with when it comes back */
  addEventListener("resize", () => { if (rich && built) { if (door.hidden) stale = true; else build3d(); } });
  /* the door's own loop runs only while the door is there: started when it is shown, ended when it is hidden */
  const wake = () => { if (!placing && !door.hidden) { placing = true; requestAnimationFrame(place); } };
  new MutationObserver(() => {
    if (door.hidden) return;
    if (stale && built) { stale = false; build3d(); } else if (built) requestAnimationFrame(syncGold);
    wake();
  }).observe(door, { attributes: true, attributeFilter: ["hidden"] });
  function place() {
    if (door.hidden) { placing = false; return; }
    if (!size) measure();
    /* once laid out, everything on the door turns on the compositor: nothing is left for this loop to do */
    if (!built && size) { built = true; build3d(); }
    if (built) { placing = false; return; }
    requestAnimationFrame(place);
  }
  wake();
  return {
    hide() {},
    /* the orbits laid out at once (a shot about to aim at a planet, on a door just shown) */
    layout() { if (rich && !built && !door.hidden) { measure(); if (size) { built = true; build3d(); } } else if (stale && !door.hidden) { stale = false; build3d(); } },
  };
}
