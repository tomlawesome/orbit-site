/*
 * The site's own sky, drawn the way the app draws its: the seeded pair of
 * star tiles from $lib/sky.js (Park–Miller, seed 17170812 — home's exact
 * sky), Grain.svelte's filter rasterised once into a canvas, the five packs
 * as the account menu offers them, the film's transport following the page,
 * and the year dial placed by the chart law (web/src/lib/data/chart.js).
 *
 * No framework, no build. The page stands without any of this; the sky,
 * the grain, the live dial bodies and the transport arrive when it runs.
 */
(function () {
  "use strict";
  const doc = document;
  const root = doc.documentElement;
  const NS = "http://www.w3.org/2000/svg";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── the packs ─────────────────────────────────────────────────────── */
  const PACKS = ["starchart", "afterdark", "clouds", "dawn", "retrograde"];
  function applyTheme(id) {
    if (!PACKS.includes(id)) return;
    root.dataset.theme = id;
    try { localStorage.setItem("orbit-theme", id); } catch { /* private mode: this page only */ }
    doc.querySelectorAll("[data-pack]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.pack === id)));
    buildGrain();
  }
  doc.querySelectorAll("[data-pack]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.pack === root.dataset.theme));
    b.addEventListener("click", () => applyTheme(b.dataset.pack));
  });

  /* ── the sky: seededRng and fillStarTiles, verbatim ────────────────── */
  function seededRng(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => (s = (s * 48271) % 2147483647) / 2147483647;
  }
  const TILED_LAYERS = [
    { count: 95, rMin: 0.4, rSpan: 0.5, oMin: 0.12, oSpan: 0.23 },
    { count: 46, rMin: 0.8, rSpan: 0.7, oMin: 0.3, oSpan: 0.4 },
  ];
  function mountSky(host) {
    const rng = seededRng(17170812);
    const svg = doc.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 1600 1000");
    svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
    ["far", "near"].forEach((cls, index) => {
      const layer = doc.createElementNS(NS, "g");
      layer.setAttribute("class", cls);
      layer.setAttribute("fill", cls === "far" ? "var(--star-far)" : "var(--star-near)");
      const tile = doc.createElementNS(NS, "g");
      tile.id = `${cls}tile`;
      const { count, rMin, rSpan, oMin, oSpan } = TILED_LAYERS[index];
      for (let i = 0; i < count; i++) {
        const c = doc.createElementNS(NS, "circle");
        c.setAttribute("cx", (rng() * 1600).toFixed(1));
        c.setAttribute("cy", (rng() * 1000).toFixed(1));
        c.setAttribute("r", (rMin + rng() * rSpan).toFixed(2));
        c.setAttribute("opacity", (oMin + rng() * oSpan).toFixed(2));
        tile.appendChild(c);
      }
      const repeat = doc.createElementNS(NS, "use");
      repeat.setAttribute("href", `#${tile.id}`);
      repeat.setAttribute("x", "1600");
      layer.append(tile, repeat);
      svg.appendChild(layer);
    });
    host.appendChild(svg);
  }
  const skyHost = doc.querySelector(".sky");
  if (skyHost) mountSky(skyHost);

  /* ── the grain: Grain.svelte's graph, one 256px tile, repeated ─────── */
  const grainHost = doc.querySelector(".grain");
  let grainTimer;
  function buildGrain() {
    if (!grainHost) return;
    const canvas = grainHost.querySelector("canvas");
    if (!canvas) return;
    const TILE = 256;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const freq = getComputedStyle(grainHost).getPropertyValue("--grain-freq").trim() || "0.9";
    const slope = getComputedStyle(grainHost).getPropertyValue("--grain-slope").trim() || "0.08";
    const w = Math.round(TILE * dpr);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${w}" viewBox="0 0 ${TILE} ${TILE}">` +
      `<filter id="gr"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" stitchTiles="stitch"/>` +
      `<feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="${slope}"/></feComponentTransfer>` +
      `<feComposite operator="in" in2="SourceGraphic"/></filter><rect width="${TILE}" height="${TILE}" filter="url(#gr)"/></svg>`;
    const img = new Image();
    img.onload = () => {
      const tile = doc.createElement("canvas");
      tile.width = w; tile.height = w;
      tile.getContext("2d").drawImage(img, 0, 0, w, w);
      const rw = Math.max(1, Math.round(innerWidth * dpr));
      const rh = Math.max(1, Math.round(innerHeight * dpr));
      canvas.width = rw; canvas.height = rh;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = ctx.createPattern(tile, "repeat");
      ctx.fillRect(0, 0, rw, rh);
      grainHost.dataset.ready = "1";
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  }
  buildGrain();
  addEventListener("resize", () => { clearTimeout(grainTimer); grainTimer = setTimeout(buildGrain, 120); });

  /* ── the dial: the chart law, applied to a synthetic household ─────── */
  const DIAL_CENTRE = 190, RIM = 166, SUN_CLEARANCE = 24;
  function dialPlacement(days) {
    const angle = (Math.max(-90, Math.min(days, 430)) - 90) * (Math.PI / 180);
    const radius = days >= 0 ? Math.min(62 + 0.242 * days, RIM) : Math.max(SUN_CLEARANCE, 62 - 0.625 * -days);
    return { angle, radius, x: DIAL_CENTRE + Math.cos(angle) * radius, y: DIAL_CENTRE + Math.sin(angle) * radius };
  }
  function bodySize(costMinor) {
    if (!costMinor) return 4;
    const pounds = Math.max(costMinor / 100, 1);
    return Math.min(8.5, Math.max(3.5, Math.round((0.8 + 1.09 * Math.log(pounds)) * 10) / 10));
  }
  function bandOf(days) {
    if (days < 0) return "overdue";
    if (days <= 30) return "due-soon";
    if (days <= 90) return "upcoming";
    return "ok";
  }
  const PAINTS = { overdue: "ruby", "due-soon": "amber", upcoming: "sky", ok: "jade" };
  const TONE = { overdue: "--overdue", "due-soon": "--warm", upcoming: "--upcoming", ok: "--ok" };
  const f1 = (n) => (Math.round(n * 10) / 10).toString();
  const pounds = (minor, est) => (est ? "~" : "") + "£" + (minor / 100).toLocaleString("en-GB", { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 });

  /* the sample workspace: the mockup's own household, so every body here is
     one the design was drawn around. days is lead time; negative is overdue. */
  const ITEMS = [
    { id: "gutter", title: "Gutter clearing", days: -16, cost: 15000, est: true, kind: "service" },
    { id: "mot", title: "Car MOT — Volvo V60", days: 16, cost: 5485, kind: "inspection", docs: 2 },
    { id: "boiler", title: "Boiler service", days: 22, cost: 12000, est: true, kind: "service" },
    { id: "insurance", title: "Home insurance renewal", days: 51, cost: 40000, est: true, kind: "renewal", suggestion: true },
    { id: "chimney", title: "Chimney sweep", days: 61, cost: 9000, est: true, kind: "service" },
    { id: "smoke", title: "Smoke alarm batteries", days: 122, cost: 1200, est: true, kind: "service" },
    { id: "service", title: "Car full service", days: 161, cost: 30000, est: true, kind: "service", docs: 2 },
  ];
  const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const MONTH_POS = [[190, 31], [271, 53], [330, 112], [352, 194], [330, 274], [271, 333], [190, 355], [109, 333], [50, 274], [28, 194], [50, 112], [109, 53]];

  function el(name, attrs, parent) {
    const e = doc.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function buildDial(svg) {
    /* today sits at 12 o'clock: the month labels start from this month */
    const now = new Date();
    const months = el("g", { "font-size": "9", fill: "var(--chart-ink)", "text-anchor": "middle" }, svg.querySelector(".chrome"));
    MONTH_POS.forEach(([x, y], i) => {
      const t = el("text", { x, y }, months);
      t.textContent = MONTHS[(now.getMonth() + i) % 12];
      if (i === 0) t.setAttribute("class", "now-month");
    });

    const trails = el("g", { fill: "none", "stroke-linecap": "round" }, svg.querySelector(".chrome"));
    const bodies = svg.querySelector(".bodies");
    const belts = el("g", { class: "belts", "aria-hidden": "true" }, svg);
    ITEMS.forEach((item) => {
      const p = dialPlacement(item.days);
      const r = bodySize(item.cost);
      const band = bandOf(item.days);
      const paint = item.suggestion ? "accent" : PAINTS[band];
      /* a trail rides with anything within 60 days of the sun */
      if (Math.abs(item.days) <= 60 && !item.suggestion) {
        const a0 = p.angle - 7 * Math.PI / 180, a1 = p.angle - 3 * Math.PI / 180;
        el("path", {
          d: `M ${f1(DIAL_CENTRE + Math.cos(a0) * p.radius)} ${f1(DIAL_CENTRE + Math.sin(a0) * p.radius)} A ${f1(p.radius)} ${f1(p.radius)} 0 0 1 ${f1(DIAL_CENTRE + Math.cos(a1) * p.radius)} ${f1(DIAL_CENTRE + Math.sin(a1) * p.radius)}`,
          stroke: `var(${TONE[band]})`, "stroke-opacity": band === "upcoming" ? ".45" : ".5", "stroke-width": "2",
        }, trails);
      }
      const link = el("a", { class: "body-link", href: "#lands", tabindex: "0" }, bodies);
      link.dataset.title = item.title;
      link.dataset.t = (item.days < 0 ? "T+" : "T−") + Math.abs(item.days) + "d";
      link.dataset.cost = pounds(item.cost, item.est);
      link.dataset.over = String(item.days < 0);
      if (item.docs) link.dataset.docs = String(item.docs);
      const g = el("g", { class: band === "due-soon" || band === "overdue" ? "breathe" : "" }, link);
      if (item.suggestion) {
        /* a proposal: dashed accent ring, explicit accept — never a filled body */
        el("circle", { cx: f1(p.x), cy: f1(p.y), r: f1(r), fill: "none", style: "stroke:var(--accent)", "stroke-width": "1.8", "stroke-dasharray": "3 2.5" }, g);
        el("circle", { cx: f1(p.x), cy: f1(p.y), r: f1(r * 0.7), style: "fill:var(--accent)", opacity: ".12" }, g);
      } else {
        const ring = band === "ok" ? { style: "stroke:var(--ok);stroke-opacity:.25", "stroke-width": "3" }
          : band === "upcoming" ? { style: "stroke:var(--upcoming);stroke-opacity:.25", "stroke-width": "2.6" }
          : { style: "stroke:var(--bg)", "stroke-width": "2" };
        el("circle", Object.assign({ cx: f1(p.x), cy: f1(p.y), r: f1(r), fill: `url(#p-${paint})` }, ring), g);
        /* an inspection wears a crescent: it comes round again */
        if (item.kind === "inspection") el("path", { d: `M ${f1(p.x)} ${f1(p.y - r)} A ${f1(r)} ${f1(r)} 0 0 1 ${f1(p.x)} ${f1(p.y + r)} Z`, fill: "rgba(0,0,0,.42)" }, g);
        el("circle", { class: "spec", cx: f1(p.x - r * 0.2), cy: f1(p.y + r * 0.25), r: f1(r * 0.33), fill: "rgba(255,255,255,.38)" }, g);
      }
      /* the ping sits on overdue */
      if (item.days < 0) el("circle", { class: "ping", cx: f1(p.x), cy: f1(p.y), r: "8", fill: "none", style: "stroke:var(--overdue)" }, svg);
      /* a belt means documents */
      if (item.docs) el("ellipse", { cx: f1(p.x), cy: f1(p.y), rx: f1(r + 6.5), ry: f1(r * 0.66), transform: `rotate(-24 ${f1(p.x)} ${f1(p.y)})`, fill: "none", style: "stroke:var(--accent)", "stroke-width": "1.3", opacity: ".8" }, belts);
    });
    svg.appendChild(svg.querySelector(".sun-link")); /* the sun stays above the trails */
  }
  const dial = doc.querySelector("svg.dial");
  if (dial) buildDial(dial);

  /* a body's callout, the film's box, following the pointer's target */
  const free = doc.querySelector(".callout.free");
  if (dial && free) {
    const show = (link) => {
      const box = link.getBoundingClientRect();
      free.querySelector(".tt").textContent = link.dataset.title;
      const t = free.querySelector(".t");
      t.innerHTML = `<b class="${link.dataset.over === "true" ? "over" : ""}">${link.dataset.t}</b> · ${link.dataset.cost}${link.dataset.docs ? ` · ${link.dataset.docs} documents` : ""}`;
      free.classList.add("on");
      const w = free.offsetWidth, h = free.offsetHeight;
      let x = box.left + box.width / 2 - w / 2, y = box.top - 18 - h;
      x = Math.max(12, Math.min(x, innerWidth - 12 - w));
      if (y < 12) y = box.bottom + 18;
      free.style.left = `${x}px`; free.style.top = `${y}px`;
    };
    const hide = () => free.classList.remove("on");
    dial.querySelectorAll(".body-link").forEach((link) => {
      link.addEventListener("pointerenter", () => show(link));
      link.addEventListener("focus", () => show(link));
      link.addEventListener("pointerleave", hide);
      link.addEventListener("blur", hide);
    });
  }

  /* ── copy the one line ──────────────────────────────────────────────── */
  doc.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(button.dataset.copy).then(() => {
        button.dataset.done = "1";
        button.textContent = "copied";
        setTimeout(() => { delete button.dataset.done; button.textContent = "copy"; }, 1600);
      });
    });
  });

  /* ── the reader: a page opened without leaving the sky ─────────────── */
  const reader = doc.querySelector("dialog.reader");
  if (reader && typeof reader.showModal === "function") {
    const image = reader.querySelector("img"), cap = reader.querySelector("p");
    doc.querySelectorAll(".screen button").forEach((button) => {
      button.addEventListener("click", () => {
        const thumb = button.querySelector("img");
        image.src = thumb.currentSrc || thumb.src; image.alt = thumb.alt;
        cap.textContent = button.dataset.caption || "";
        reader.showModal();
      });
    });
    reader.addEventListener("click", (e) => { if (e.target === reader) reader.close(); });
  }

  /* ── the transport: chapter ticks along the page ───────────────────── */
  const transport = doc.querySelector(".transport");
  const chapters = Array.from(doc.querySelectorAll("[data-chapter]"));
  if (transport && chapters.length) {
    const bar = transport.querySelector(".bar");
    const name = transport.querySelector(".name");
    const count = transport.querySelector(".count");
    const played = transport.querySelector(".played");
    const n = chapters.length;
    const ticks = chapters.map((ch, i) => {
      const b = doc.createElement("button");
      b.className = "tick"; b.type = "button";
      b.style.left = `${(i / (n - 1)) * 100}%`;
      b.setAttribute("aria-label", `${ch.dataset.chapter}`);
      b.addEventListener("click", () => ch.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }));
      bar.appendChild(b);
      return b;
    });
    let awakeTimer;
    function setCurrent(i) {
      ticks.forEach((t, j) => t.setAttribute("aria-current", String(j === i)));
      const p = `${(i / (n - 1)) * 100}%`;
      transport.style.setProperty("--p", p);
      name.textContent = chapters[i].dataset.chapter;
      count.textContent = `${String(i + 1).padStart(2, "0")} / ${String(n).padStart(2, "0")}`;
      transport.classList.add("awake");
      clearTimeout(awakeTimer);
      awakeTimer = setTimeout(() => transport.classList.remove("awake"), 1800);
    }
    let current = -1;
    const pick = () => {
      const line = innerHeight * 0.45;
      let i = 0;
      chapters.forEach((ch, j) => { if (ch.getBoundingClientRect().top <= line) i = j; });
      if (i !== current) { current = i; setCurrent(i); }
    };
    addEventListener("scroll", pick, { passive: true });
    pick();
  }
})();
