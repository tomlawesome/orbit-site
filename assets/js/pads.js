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
/* the boxes the constellations are scattered into: a loose grid across the
   chart, each cell nudged so no two sit in a row */
function boxes(n, W, H, narrow, rnd) {
  const cols = narrow ? 2 : Math.min(4, Math.ceil(n / 2)), rows = Math.ceil(n / cols);
  const cw = W / cols, ch = H / rows, out = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    const cx = cw * (c + 0.5) + (rnd() - 0.5) * cw * 0.18, cy = ch * (r + 0.5) + (rnd() - 0.5) * ch * 0.22 - 8;
    out.push([cx, cy, cw * 0.62, ch * 0.5]);
  }
  return out;
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
  let group = null, cursor = -1, narrow = false, starOf = new Map();
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
    narrow = innerWidth < 700;
    const W = narrow ? 600 : 1000, H = narrow ? Math.max(640, 170 * Math.ceil(DOCS.length / 2)) : Math.max(420, 200 * Math.ceil(DOCS.length / 4));
    chart.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const rnd = seededRng(SEED);
    starOf = new Map();
    let html = field(W, H, seededRng(SEED + 7)), gi = 0;
    const cells = boxes(DOCS.length, W, H, narrow, seededRng(SEED + 3));
    for (const d of DOCS) {
      const name = d.name, g = GROUPS[name], mine = ENTRIES.filter((e) => e.g === name), pts = walk(mine.length, cells[gi], rnd);
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
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (DOCS.length && (innerWidth < 700) !== narrow) { drawChart(); render(); } }, 150); });
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
  return {
    start() { load().then(() => { render(); chart.classList.remove("drawn"); void chart.getBoundingClientRect(); chart.classList.add("drawn"); if (location.hash.startsWith("#docs/")) go(location.hash, false); }); clearTimeout(mt); if (!reduced) mt = setTimeout(meteor, 5000 + Math.random() * 4000); },
    stop() { close(false); input.value = ""; group = null; if (DOCS.length) render(); input.blur(); chart.classList.remove("drawn"); clearTimeout(mt); },
    go,
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
  const svg = $(".ring", pad), host = $(".stages", svg), lockup = $(".lockup", pad), big = $(".face .big", pad), rail = $(".rail", pad), field = $(".bodies", pad);
  const stage = $(".stage", pad), n = $(".n", stage), total = $(".total", stage), label = $(".label", stage), line = $(".line", stage), go = $(".go", stage);
  const items = section.items, N = items.length;
  total.textContent = String(N).padStart(2, "0");
  /* each body on an orbit of its own outside the ring, as the doors are on
     the sunrise: a faint path, a hairline circle round the body, a leader
     out to its name, which stays upright wherever the body has got to */
  const RADIUS = (i) => 80 + i * 7;
  const orbits = document.createElementNS(SVG, "g"); orbits.setAttribute("class", "orbits"); svg.insertBefore(orbits, host);
  const tags = [];
  const bodies = items.map((it, i) => {
    const R = RADIUS(i);
    const path = document.createElementNS(SVG, "circle"); path.setAttribute("cx", "100"); path.setAttribute("cy", "100"); path.setAttribute("r", R); orbits.appendChild(path);
    /* the body is html: a button the compositor turns about the centre, its
       halo, leader and dot hung off it at the orbit's radius */
    const g = document.createElement("button");
    g.type = "button"; g.className = "stage-body"; g.setAttribute("aria-label", `${it.label}: ${it.line}`);
    g.style.setProperty("--i", i); g.style.setProperty("--c", it.c || "#d8b45a"); g.style.setProperty("--r", R);
    g.innerHTML = '<i class="hit"></i><i class="halo"></i><i class="lead"></i><i class="dot"></i>';
    const tag = document.createElement("span"); tag.className = "tag"; tag.textContent = it.name || it.label; tag.style.setProperty("--c", it.c || "#d8b45a");
    field.appendChild(g); field.appendChild(tag); tags.push(tag);
    g.addEventListener("click", () => pick(i));
    g.addEventListener("focus", () => pick(i));
    return g;
  });
  let size = 0; const measure = () => { size = field.clientWidth || 0; }; measure(); addEventListener("resize", measure);
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
  let lastNames = 0;
  function frame(now) {
    if (!running) return;
    const names = now - lastNames > 48;
    if (!size) measure();
    S.forEach((b, i) => {
      const held = now >= b.t1 && now < b.t1 + b.hold;
      if (held && !b.locked) { b.locked = true; lock(i); }
      if (!held && b.locked) { release(i); plan(i, now, b.t1 + CYCLE, 18); }
      /* a due that went by unseen (the page was away): the body goes round again */
      else if (!held && !b.locked && now >= b.t1 + b.hold) plan(i, now, b.t1 + CYCLE);
      b.a = angleWithKick(b, now);
      bodies[i].style.transform = `rotate(${b.a.toFixed(2)}deg)`;
      /* the name, just past the leader, on the side away from the body — moved every third frame */
      if (names) {
        const t = (b.a * Math.PI) / 180, ux = Math.cos(t), uy = Math.sin(t), r = (RADIUS(i) + 20) / 200 * size;
        const ax = ux > 0.38 ? 0 : ux < -0.38 ? -100 : -50, ay = uy < -0.55 ? -100 : uy > 0.55 ? 0 : -50;
        tags[i].style.transform = `translate(calc(${(ux * r).toFixed(1)}px + ${ax}%), calc(${(uy * r).toFixed(1)}px + ${ay}%))`;
        tags[i].classList.toggle("on", b.locked);
      }
    });
    if (names) lastNames = now;
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
  const planets = [...door.querySelectorAll(".planet")].map((p) => ({ p, spin: p.querySelector(".spin"), tag: p.querySelector(".tag"), r: (+p.dataset.r + 21) / 200 }));
  planets.forEach(({ p }) => {
    p.addEventListener("click", (e) => { e.preventDefault(); onGo(p.dataset.section); });
    p.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onGo(p.dataset.section); } });
  });
  /* the name rides just past the leader, on the side away from the body, and
     stays upright; the spin's own clock says where the body is, so nothing
     is read back from the layout, and a name moves every third frame,
     which at these speeds no eye can tell from every frame */
  let last = 0, size = 0;
  const measure = () => { size = door.querySelector(".planets").clientWidth || 0; };
  measure(); addEventListener("resize", measure);
  function place(now) {
    if (!size) measure();
    if (!door.hidden && now - last > 48 && size) {
      last = now;
      for (const { spin, tag, r } of planets) {
        const anim = spin.getAnimations()[0]; if (!anim) continue;
        const t = anim.effect.getTiming(), a = (((anim.currentTime || 0) - (t.delay || 0)) / (t.duration || 1)) * Math.PI * 2;
        const ux = Math.sin(a), uy = -Math.cos(a);           /* the body started at the top */
        const ax = ux > 0.38 ? 0 : ux < -0.38 ? -100 : -50, ay = uy < -0.55 ? -100 : uy > 0.55 ? 0 : -50;
        tag.style.transform = `translate(calc(${(ux * r * size).toFixed(1)}px + ${ax}%), calc(${(uy * r * size).toFixed(1)}px + ${ay}%))`;
      }
    }
    requestAnimationFrame(place);
  }
  requestAnimationFrame(place);
  return { hide() {} };
}
