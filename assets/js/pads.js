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
   chart is the whole top of the page and the figures keep to its sides and
   the band under the search, clear of the heading; otherwise a loose grid
   across the chart, each cell nudged so no two sit in a row */
const WIDE_SLOTS = [[190, 110, 260, 130], [1410, 110, 260, 130], [250, 300, 270, 130], [1350, 300, 270, 130], [180, 490, 250, 110], [1420, 490, 250, 110], [640, 340, 260, 100], [960, 340, 260, 100], [800, 500, 260, 100]];
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
  for (let i = 0; i < (W > 1200 ? 190 : W > 700 ? 110 : 80); i++) {
    const r = +(0.5 + rnd() * rnd() * 1.3).toFixed(2), o = +(0.15 + rnd() * 0.45).toFixed(2);
    dots.push({ x: Math.round(rnd() * W), y: Math.round(rnd() * H), r, o, d: +(rnd() * 6).toFixed(1) });
  }
  const arcs = [];
  /* parallels: shallow arcs bowing upward; meridians: leaning lines */
  for (let k = 0; k < 4; k++) { const y = H * (0.18 + k * 0.22), b = H * 0.07; arcs.push(`M-20 ${y.toFixed(0)} Q ${W / 2} ${(y - b).toFixed(0)} ${W + 20} ${y.toFixed(0)}`); }
  for (let k = 0; k < (W > 1200 ? 9 : 6); k++) { const x = W * (W > 1200 ? 0.06 + k * 0.11 : 0.08 + k * 0.17), lean = (x - W / 2) * 0.12; arcs.push(`M${(x - lean).toFixed(0)} -20 Q ${(x + lean * 0.3).toFixed(0)} ${H / 2} ${(x + lean).toFixed(0)} ${H + 20}`); }
  return { dots, arcs };
}
const fieldMarkup = ({ dots, arcs }) => `<g class="field">${dots.map((d) => `<circle cx="${d.x}" cy="${d.y}" r="${d.r}" style="--o:${d.o};--d:${d.d}s"/>`).join("")}</g><g class="grat"><path d="${arcs.join(" ")}"/></g>`;
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
    loading = fetch(DOCS_DIR + "index.json").then((r) => r.json()).then((data) => {
      DOCS = data.sources; generated = data.generated; GROUPS = {}; ENTRIES = [];
      for (const d of DOCS) {
        GROUPS[d.name] = { c: d.c, slug: d.slug };
        for (const s of d.sections) ENTRIES.push({ g: d.name, slug: d.slug, id: s.id, t: s.title, s: s.summary, k: `${s.text} ${s.subs.map((x) => x.title).join(" ")}`, href: hrefOf(d.slug, s.id), key: KEYS.includes(hrefOf(d.slug, s.id)) });
      }
      keys.innerHTML = KEYS.map((h) => ENTRIES.find((e) => e.href === h)).filter(Boolean).map((e) => `<a class="key" href="${e.href}" style="--c:${GROUPS[e.g].c}">${esc(e.t)}</a>`).join("");
      if (stamp) stamp.textContent = generated ? `charted from the repositories · ${when(generated)}` : "";
      drawChart(); render();
    }).catch(() => { results.innerHTML = `<section class="none"><h4>nothing here yet</h4><p>The docs have not been imported. They are on <a href="${R}" target="_blank" rel="noopener">the repository</a>.</p></section>`; });
    return loading;
  }

  /* ── the chart ── */
  function drawChart() {
    mode = modeNow();
    const narrow = mode === "narrow", wide = mode === "wide" && DOCS.length <= WIDE_SLOTS.length;
    const W = wide ? 1600 : narrow ? 600 : 1000, H = wide ? 600 : narrow ? Math.max(640, 170 * Math.ceil(DOCS.length / 2)) : Math.max(420, 200 * Math.ceil(DOCS.length / 4));
    chart.setAttribute("viewBox", `0 0 ${W} ${H}`);
    chart.classList.toggle("wide", wide);
    const rnd = seededRng(SEED);
    starOf = new Map();
    const fd = fieldData(W, H, seededRng(SEED + 7));
    geometry = { W, H, field: fd, cons: [] };
    let html = fieldMarkup(fd), gi = 0;
    const cells = boxes(DOCS.length, W, H, wide ? "wide" : mode, seededRng(SEED + 3));
    for (const d of DOCS) {
      const name = d.name, g = GROUPS[name], mine = ENTRIES.filter((e) => e.g === name), pts = walk(mine.length, cells[gi], rnd);
      geometry.cons.push({ name, c: g.c, pts });
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
        const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/mermaid/11.4.1/mermaid.min.js"; s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
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
  addEventListener("popstate", () => { if (!pad.hidden) go(location.hash.startsWith("#docs") ? location.hash : "#docs", false); });
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
  function relayLoop() {
    if (seen.has("relay")) {
      steps.forEach((x, i) => later(250 + i * 1100, () => x.classList.add("on")));
      later(5600, () => steps.forEach((x) => x.classList.remove("on")));
    }
    later(6400, relayLoop);
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
      timers.forEach(clearTimeout); timers = []; itemLoop(); relayLoop();
    },
    stop() { scenes.forEach((c) => io.unobserve(c)); scroll.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); timers.forEach(clearTimeout); timers = []; },
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
  /* the name sits 21 units past the body, 15 on a phone, where the outermost orbit runs close to the edge */
  const planets = [...door.querySelectorAll(".planet")].map((p) => ({ p, spin: p.querySelector(".spin"), body: p.querySelector(".body"), tag: p.querySelector(".tag"), rb: +p.dataset.r / 200, r: (+p.dataset.r + (innerWidth < 560 ? 15 : 21)) / 200 }));
  const gold = door.querySelector(".trdot"), goldBody = gold?.querySelector("i");
  const GOLD_AT = Math.atan2(63, 36.5), GOLD_R = Math.hypot(63, 36.5) / 200;   /* where the gold world sits on its turning frame */
  planets.forEach(({ p }) => {
    p.addEventListener("click", (e) => { e.preventDefault(); onGo(p.dataset.section); });
    p.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onGo(p.dataset.section); } });
  });
  /* the name rides just past the leader, on the side away from the body, and
     stays upright; the spin's own clock says where the body is, so nothing
     is read back from the layout, and a name moves every third frame,
     which at these speeds no eye can tell from every frame. Its anchor turns
     with the body, so it never jumps; at the bottom of the orbit, where the
     way in sits below, it moves round beside its body instead of under it */
  let last = 0, size = 0, cx = 0, cy = 0, widths = [];
  const measure = () => {
    const box = door.querySelector(".planets"), r = box.getBoundingClientRect();
    size = box.clientWidth || 0; cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    widths = planets.map(({ tag }) => tag.offsetWidth);
  };
  measure(); addEventListener("resize", measure);
  const clamp = (x) => Math.max(-1, Math.min(1, x));
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const angleOf = (el) => {
    const anim = el.getAnimations()[0]; if (!anim) return null;
    const t = anim.effect.getTiming();
    return (((anim.currentTime || 0) - (t.delay || 0)) / (t.duration || 1)) * Math.PI * 2;
  };
  /* in the rich look each world's lit side faces the sun, just under the horizon below: the picture is held upright
     against its orbit by the stylesheet, and turned here by the sun's angle from it */
  const lightAt = (x, y) => {
    const s = Math.max(innerWidth / 1600, innerHeight / 1000), sx = innerWidth / 2, sy = innerHeight - 70 * s;
    return Math.atan2(-(sx - x), sy - y);
  };
  function place(now) {
    if (!size) measure();
    if (!door.hidden && now - last > 48 && size) {
      last = now;
      const rich = document.documentElement.classList.contains("rich");
      planets.forEach(({ spin, body, tag, r, rb }, i) => {
        const a = angleOf(spin); if (a === null) return;
        const ux = Math.sin(a), uy = -Math.cos(a);           /* the body started at the top */
        const below = smooth(0.72, 0.94, uy), side = ux >= 0 ? 1 : -1;
        let ax = -50 + 50 * clamp(ux / 0.5), ay = -50 + 50 * clamp(uy / 0.6);
        let x = ux * r * size, y = uy * r * size;
        /* beside the body: just past its haze, level with it */
        const bx = ux * rb * size + side * 0.075 * size, by = uy * rb * size;
        x += (bx - x) * below; y += (by - y) * below;
        ax += ((side > 0 ? 0 : -100) - ax) * below; ay += (-50 - ay) * below;
        /* a name near the edge of a small screen slides in rather than off it */
        const w = widths[i] || 0, left = cx + x + (ax / 100) * w, right = left + w;
        if (left < 8) x += 8 - left; else if (right > innerWidth - 8) x -= right - (innerWidth - 8);
        tag.style.transform = `translate(calc(${x.toFixed(1)}px + ${ax.toFixed(1)}%), calc(${y.toFixed(1)}px + ${ay.toFixed(1)}%))`;
        if (rich) body.style.setProperty("--lr", `${lightAt(cx + ux * rb * size, cy + uy * rb * size).toFixed(3)}rad`);
      });
      if (rich && goldBody) {
        const a = angleOf(gold);
        if (a !== null) {
          const g = a + GOLD_AT;
          goldBody.style.setProperty("--lr", `${lightAt(cx + Math.sin(g) * GOLD_R * size, cy - Math.cos(g) * GOLD_R * size).toFixed(3)}rad`);
        }
      }
    }
    requestAnimationFrame(place);
  }
  requestAnimationFrame(place);
  return { hide() {} };
}
