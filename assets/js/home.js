/*
 * Home: the dial, the other systems, the manifest, and the drawers — the
 * product's own screen, drawn from the sample workspace by the chart law.
 */
import { households, account, inbox, today, persist, serialise, hydrate, forget, pristine } from "./data.js";
import * as law from "./law.js";
import { el, reduced } from "./sky.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const f1 = (n) => (Math.round(n * 10) / 10).toString();
const C = law.DIAL_CENTRE;

export const state = { camera: "willow", open: null, skyCams: null, flying: false };
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); }
let muted = false;
export function mute(on) { muted = on; }
function changed() { if (!muted) persist(); for (const fn of listeners) fn(); }
export function snapshot() { return serialise(); }
export function restoreState(snap) { hydrate(snap); closeRow(); renderDial(); renderManifest(); renderGalaxy(); renderInbox(); persist(); }
/* the walk plays on the sample as shipped, whatever a visit has changed since */
export function restorePristine() { pristine(); closeRow(); renderDial(); renderManifest(); renderGalaxy(); renderInbox(); }
export function resetSite() { forget(); location.hash = ""; location.reload(); }

export function household() { return households[state.camera]; }
let backHome = null;
export function onBackHome(fn) { backHome = fn; }
export function itemById(id) {
  for (const h of Object.values(households)) for (const it of h.items) if (it.id === id) return { item: it, household: h };
  return null;
}
function refreshDays(h) {
  for (const it of h.items) it.days = law.daysBetween(today, it.dueDate);
}
export function suggestionsFor(h) {
  return inbox.review.filter((r) => r.household === h.id);
}

/* ── the dial ──────────────────────────────────────────────────────────── */
const MONTH_POS = [[190, 31], [271, 53], [330, 112], [352, 194], [330, 274], [271, 333], [190, 355], [109, 333], [50, 274], [28, 194], [50, 112], [109, 53]];

export function renderDial() {
  const h = household();
  refreshDays(h);
  const svg = $("#dial");
  $("#dial .months").replaceChildren();
  $("#dial .trails").replaceChildren();
  $("#dial .bodies").replaceChildren();
  $("#dial .belts").replaceChildren();
  $("#dial .pings").replaceChildren();
  MONTH_POS.forEach(([x, y], i) => {
    const t = el("text", { x, y }, $("#dial .months"));
    t.textContent = law.MONTHS[(today.getMonth() + i) % 12];
    if (i === 0) t.setAttribute("class", "now-month");
  });
  $("#dial-name").textContent = h.name;
  $("#dial .sun-link").setAttribute("aria-label", `${h.name}, this household`);
  const bodies = [...h.items.filter((it) => it.status === "active").map((it) => ({ it, suggestion: false })),
    ...suggestionsFor(h).map((s) => ({ it: { id: s.id, title: s.title, days: s.renewsInDays, costMinor: s.costMinor, costIsEstimate: true, kind: "suggestion", documents: [] }, suggestion: true }))];
  for (const { it, suggestion } of bodies) {
    const p = law.dialPlacement(it.days);
    const r = law.bodySize(it.costMinor);
    const band = law.bandOfKind(it.kind, it.days);
    const paint = suggestion ? "accent" : law.PAINTS[band];
    if (Math.abs(it.days) <= 60 && !suggestion) {
      const a0 = p.angle - 7 * Math.PI / 180, a1 = p.angle - 3 * Math.PI / 180;
      el("path", {
        d: `M ${f1(C + Math.cos(a0) * p.radius)} ${f1(C + Math.sin(a0) * p.radius)} A ${f1(p.radius)} ${f1(p.radius)} 0 0 1 ${f1(C + Math.cos(a1) * p.radius)} ${f1(C + Math.sin(a1) * p.radius)}`,
        stroke: `var(${law.TONES[band]})`, "stroke-opacity": band === "upcoming" ? ".45" : ".5", "stroke-width": "2",
      }, $("#dial .trails"));
    }
    const link = el("a", { class: "body-link", href: `#${it.id}`, "data-id": it.id, tabindex: "0", "aria-label": `${it.title}, ${law.tminus(it.days)}` }, $("#dial .bodies"));
    if (suggestion) link.dataset.suggestion = "1";
    const g = el("g", { class: band === "due-soon" || band === "overdue" ? "breathe" : "" }, link);
    if (suggestion) {
      el("circle", { cx: f1(p.x), cy: f1(p.y), r: f1(r), fill: "none", style: "stroke:var(--accent)", "stroke-width": "1.8", "stroke-dasharray": "3 2.5" }, g);
      el("circle", { cx: f1(p.x), cy: f1(p.y), r: f1(r * 0.7), style: "fill:var(--accent)", opacity: ".12" }, g);
    } else {
      const ring = band === "ok" ? { style: "stroke:var(--ok);stroke-opacity:.25", "stroke-width": "3" }
        : band === "upcoming" ? { style: "stroke:var(--upcoming);stroke-opacity:.25", "stroke-width": "2.6" }
        : { style: "stroke:var(--bg)", "stroke-width": "2" };
      el("circle", Object.assign({ cx: f1(p.x), cy: f1(p.y), r: f1(r), fill: `url(#p-${paint})` }, ring), g);
      if (it.kind === "inspection") el("path", { d: `M ${f1(p.x)} ${f1(p.y - r)} A ${f1(r)} ${f1(r)} 0 0 1 ${f1(p.x)} ${f1(p.y + r)} Z`, fill: "rgba(0,0,0,.42)" }, g);
      if (it.kind === "renewal") el("circle", { cx: f1(p.x), cy: f1(p.y), r: f1(r * 0.34), fill: "var(--panel-raised)", opacity: ".9" }, g);
      el("circle", { class: "spec", cx: f1(p.x - r * 0.2), cy: f1(p.y + r * 0.25), r: f1(r * 0.33), fill: "rgba(255,255,255,.38)" }, g);
    }
    if (it.days < 0 && it.kind !== "expiry" && !suggestion) el("circle", { class: "ping", cx: f1(p.x), cy: f1(p.y), r: "8", fill: "none", style: "stroke:var(--overdue)" }, $("#dial .pings"));
    if (it.documents?.length) el("ellipse", { class: "belt", cx: f1(p.x), cy: f1(p.y), rx: f1(r + 6.5), ry: f1(r * 0.66), transform: `rotate(-24 ${f1(p.x)} ${f1(p.y)})`, fill: "none", style: "stroke:var(--accent)", "stroke-width": "1.3", opacity: ".8" }, $("#dial .belts"));
    /* CON-5: on touch the first tap buys the callout and the second opens;
       with a pointer, hover shows it and a click opens. */
    link.addEventListener("pointerdown", (e) => { link.dataset.ptype = e.pointerType; });
    link.addEventListener("click", (e) => {
      e.preventDefault();
      if (link.dataset.ptype === "touch" && armedBody !== it.id) { showBodyCallout(link, it, suggestion, true); return; }
      hideBodyCallout(); openRow(it.id, true);
    });
    link.addEventListener("pointerenter", (e) => { if (e.pointerType !== "touch") showBodyCallout(link, it, suggestion); });
    link.addEventListener("focus", () => { if (link.dataset.ptype !== "touch") showBodyCallout(link, it, suggestion); });
    link.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") hideBodyCallout(); });
    link.addEventListener("blur", () => { if (!armedBody) hideBodyCallout(); });
  }
  svg.appendChild($("#dial .sun-link"));
}

const bodyCallout = () => $("#body-callout");
let armedBody = null;
function showBodyCallout(link, it, suggestion, tapped = false) {
  const c = bodyCallout();
  armedBody = tapped ? it.id : null;
  c.classList.toggle("tap", tapped);
  c.onclick = tapped ? () => { hideBodyCallout(); openRow(it.id, true); } : null;
  const box = link.getBoundingClientRect();
  c.querySelector("b").textContent = it.title;
  c.querySelector("small").textContent = suggestion
    ? `suggested · renews in ${it.days}d · ${law.money(it.costMinor, true)}`
    : `${law.tminus(it.days)} · ${law.money(it.costMinor, it.costIsEstimate)}${it.documents?.length ? ` · ${it.documents.length} documents` : ""}`;
  c.classList.add("show");
  const w = c.offsetWidth, h = c.offsetHeight;
  const right = box.left + box.width / 2 < innerWidth / 2;
  let x = right ? box.right + 30 : box.left - 30 - w;
  let y = box.top + box.height / 2 - h / 2;
  x = Math.max(8, Math.min(x, innerWidth - 8 - w));
  /* no room beside it (a phone): drop below the body, or rise above, never over it */
  let side = right ? "side-right" : "side-left";
  if (x < box.right + 6 && x + w > box.left - 6) {
    x = Math.max(8, Math.min(box.left + box.width / 2 - w / 2, innerWidth - 8 - w));
    const below = box.bottom + 30 + h <= innerHeight - 8;
    y = below ? box.bottom + 30 : box.top - 30 - h;
    side = below ? "side-below" : "side-above";
    c.style.setProperty("--tail", `${box.left + box.width / 2 - x}px`);
  }
  y = Math.max(8, Math.min(y, innerHeight - 8 - h));
  for (const k of ["side-right", "side-left", "side-below", "side-above"]) c.classList.toggle(k, k === side);
  c.style.left = `${x}px`; c.style.top = `${y}px`;
}
function hideBodyCallout() { bodyCallout().classList.remove("show", "tap"); armedBody = null; }

/* ── the other systems, out in the fixed sky ──────────────────────────── */
export function renderGalaxy() {
  const host = $("#galaxy");
  host.replaceChildren();
  const cam = household();
  const k = $("#dialwrap").getBoundingClientRect().width / 640;
  const hero = $("#hero").getBoundingClientRect();
  for (const h of Object.values(households)) {
    if (h.id === cam.id) continue;
    let dx = (h.pos[0] - cam.pos[0]) * k, dy = (h.pos[1] - cam.pos[1]) * k;
    /* keep every system on the sky: relax toward the centre, never past the edge */
    const maxX = hero.width / 2 - 110, maxY = hero.height / 2 - 90;
    const s = Math.min(1, maxX / Math.abs(dx || 1), maxY / Math.abs(dy || 1));
    dx *= s; dy *= s;
    const node = document.createElement("div");
    node.className = "minisys"; node.dataset.id = h.id;
    node.style.transform = `translate(${dx.toFixed(0)}px,${dy.toFixed(0)}px)`;
    node.dataset.dx = dx.toFixed(0); node.dataset.dy = dy.toFixed(0);
    const svg = el("svg", { viewBox: "-90 -90 180 180" }, node);
    const labelRight = dx < 0;
    const t = el("text", { class: "mslabel", x: labelRight ? 8 : -8, y: -52, "text-anchor": labelRight ? "start" : "end" }, svg);
    t.textContent = h.name;
    el("path", { class: "lead", d: labelRight ? "M 8 -47 H 70 M 8 -47 L 2 -38" : "M -8 -47 H -70 M -8 -47 L -2 -38" }, svg);
    refreshDays(h);
    el("circle", { class: "msring", cx: 0, cy: 0, r: 34 }, svg);
    for (const [px, py, pr, tone] of law.constellationPlanetsOf(h.items)) el("circle", { cx: px, cy: py, r: pr, fill: `var(${tone})` }, svg);
    const hit = el("circle", { class: "hit", cx: 0, cy: 0, r: 44, fill: "transparent", role: "button", tabindex: "0", "aria-label": `Fly to ${h.name}` }, svg);
    hit.addEventListener("click", () => flyTo(h.id));
    hit.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flyTo(h.id); } });
    host.appendChild(node);
  }
  const chips = $("#chips");
  chips.replaceChildren();
  for (const h of Object.values(households)) {
    if (h.id === cam.id) continue;
    const b = document.createElement("button");
    b.type = "button"; b.textContent = h.name; b.addEventListener("click", () => flyTo(h.id));
    chips.appendChild(b);
  }
}

/* The camera: each household has its own absolute starfield offset, so a
   flight animates between two truths and never snaps back. Parallax by
   depth: the far tile moves less than the near one. */
export function setCamera(id) {
  if (!state.skyCams) return;
  const [x, y] = households[id].pos;
  state.skyCams.far.style.transform = `translate(${(-x * 0.18).toFixed(0)}px,${(-y * 0.18).toFixed(0)}px)`;
  state.skyCams.near.style.transform = `translate(${(-x * 0.4).toFixed(0)}px,${(-y * 0.4).toFixed(0)}px)`;
}

/* The camera flight (v18, one motion): the old chart leaves with the camera,
   the destination rides home to the exact centre, and the new chart grows out
   of the shared centre. */
export function flyTo(id, done) {
  if (state.flying || id === state.camera) return;
  const hero = $("#hero");
  const target = $(`.minisys[data-id="${id}"]`);
  const dx = Number(target?.dataset.dx || 0), dy = Number(target?.dataset.dy || 0);
  state.flying = true;
  closeRow();
  hero.style.setProperty("--flyx", `${dx}px`); hero.style.setProperty("--flyy", `${dy}px`);
  hero.style.setProperty("--tox", `${dx}px`); hero.style.setProperty("--toy", `${dy}px`);
  target?.classList.add("target");
  hero.classList.add("flying");
  setCamera(id);
  const land = () => {
    state.camera = id;
    renderDial(); renderManifest(); renderGalaxy();
    hero.classList.add("arriving");
    const dial = $("#dial");
    dial.classList.remove("arrive", "bloom"); void dial.offsetWidth; dial.classList.add("bloom");
    /* the corner says where it goes: from your own sky, down to the dawn; from another's, back to yours */
    $("#back").textContent = id === "willow" ? "— the dawn" : "— your sky";
    setTimeout(() => { hero.classList.remove("flying", "arriving"); state.flying = false; changed(); if (done) done(); }, reduced ? 50 : 900);
  };
  setTimeout(land, reduced ? 50 : 1250);
}

/* ── the manifest: the corridor ───────────────────────────────────────── */
export function renderManifest() {
  const h = household();
  refreshDays(h);
  const corridor = $("#corridor");
  corridor.replaceChildren();
  const rows = h.items.filter((it) => it.status === "active").slice().sort((a, b) => a.days - b.days);
  const sugg = suggestionsFor(h).map((s) => ({ suggestion: s, days: s.renewsInDays }));
  const overdue = rows.filter((r) => r.days < 0 && r.kind !== "expiry");
  const ahead = rows.filter((r) => !(r.days < 0 && r.kind !== "expiry"));
  if (overdue.length) {
    const zone = document.createElement("div"); zone.className = "redzone";
    for (const it of overdue) zone.appendChild(rowFor(it));
    corridor.appendChild(zone);
  }
  const todayRow = document.createElement("div"); todayRow.className = "today"; todayRow.id = "today";
  todayRow.innerHTML = `<span class="sunmark" aria-hidden="true"><i></i><b></b></span><span>${law.todayWords(today)}</span><div class="rule"></div>`;
  corridor.appendChild(todayRow);
  const entries = [...ahead.map((it) => ({ it, days: it.days })), ...sugg.map((s) => ({ it: null, s: s.suggestion, days: s.days }))].sort((a, b) => a.days - b.days);
  const currentKey = `${today.getFullYear()}-${today.getMonth()}`;
  let lastKey = currentKey;
  let lastMonthEl = null, count = 0;
  for (const e of entries) {
    const due = law.addDays(today, e.days);
    const key = `${due.getFullYear()}-${due.getMonth()}`;
    if (key !== lastKey) {
      if (lastMonthEl) lastMonthEl.querySelector("small").textContent = `${count} approaching`;
      lastKey = key; count = 0;
      lastMonthEl = document.createElement("div"); lastMonthEl.className = "month";
      lastMonthEl.innerHTML = `<span>${law.MONTHS[due.getMonth()]}</span><div class="rule"></div><small></small>`;
      corridor.appendChild(lastMonthEl);
    }
    count++;
    corridor.appendChild(e.it ? rowFor(e.it) : suggestionRowFor(e.s));
  }
  if (lastMonthEl) lastMonthEl.querySelector("small").textContent = `${count} approaching`;
  const last = entries[entries.length - 1];
  $("#horizon").textContent = last
    ? `— beyond the horizon: nothing scheduled past ${law.longDate(law.addDays(today, last.days)).split(" ")[1]} —`
    : "— nothing in orbit yet —";
}

function rowFor(it) {
  const band = law.bandOfKind(it.kind, it.days);
  const section = household().sections.find((s) => s.id === it.section)?.name ?? "";
  const row = document.createElement("div");
  row.className = "item"; row.id = it.id; row.dataset.id = it.id; row.tabIndex = 0; row.setAttribute("role", "button"); row.setAttribute("aria-expanded", "false");
  const shape = it.kind === "inspection" ? "ter" : it.kind === "renewal" ? "con" : "";
  const tone = band === "overdue" ? "over" : band === "due-soon" ? "soon" : band === "upcoming" ? "up" : "ok";
  row.innerHTML = `<span class="planet ${shape}" style="color:var(${law.TONES[band]})"><i></i></span>
    <div class="body"><b></b><span></span></div>
    <div class="t ${tone}">${law.tminus(it.days)}<small>${law.shortDate(it.dueDate)}</small></div>`;
  row.querySelector("b").textContent = it.title;
  row.querySelector(".body span").textContent = `${section} · orbital period ${law.every(it.recurrenceMonths).replace("every ", "")}${it.provider ? ` · ${it.provider}` : ""} · ${law.money(it.costMinor, it.costIsEstimate)}`;
  row.addEventListener("click", () => (row.classList.contains("open") ? closeRow() : openRow(it.id)));
  row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); row.click(); } });
  return row;
}

function suggestionRowFor(s) {
  const row = document.createElement("div");
  row.className = "item suggest"; row.id = s.id; row.dataset.id = s.id;
  row.innerHTML = `<span class="planet sug"><i></i></span>
    <div class="body"><b></b><span></span></div>
    <div class="actions"><button class="yes" type="button">Add to orbit</button><button type="button" class="no">Dismiss</button></div>`;
  row.querySelector("b").textContent = s.title;
  row.querySelector(".body span").textContent = `Found in 1 forwarded document · renews ${law.shortDate(law.addDays(today, s.renewsInDays))} · ${law.money(s.costMinor, true)}`;
  wireDecide(row, s);
  return row;
}

/* Approval is the boundary between untrusted mail and the household, so it
   takes two deliberate taps: the first arms, the second fires. */
function wireDecide(root, s) {
  const yes = root.querySelector("button.yes"), no = root.querySelector("button.no");
  let armed = null, timer;
  const disarm = () => { armed = null; yes.classList.remove("armed"); no.classList.remove("armed"); yes.textContent = "Add to orbit"; no.textContent = "Dismiss"; };
  const arm = (which, b) => {
    if (armed === which) { disarm(); return true; }
    disarm(); armed = which; b.classList.add("armed"); b.textContent = which === "yes" ? "tap again to add" : "tap again to dismiss";
    clearTimeout(timer); timer = setTimeout(disarm, 4000); return false;
  };
  yes.addEventListener("click", (e) => { e.stopPropagation(); if (arm("yes", yes)) acceptSuggestion(s.id); });
  no.addEventListener("click", (e) => { e.stopPropagation(); if (arm("no", no)) dismissSuggestion(s.id); });
}

export function openRow(id, scroll = false) {
  closeRow();
  const row = $(`.item[data-id="${id}"]`);
  if (!row || row.classList.contains("suggest")) return;
  const found = itemById(id);
  if (!found) return;
  const { item: it } = found;
  row.classList.add("open"); row.setAttribute("aria-expanded", "true");
  const view = document.createElement("div");
  view.className = "itemview"; view.id = `${id}-view`;
  const section = household().sections.find((s) => s.id === it.section)?.name ?? "";
  const kv = (k, v, cls = "") => `<div class="kv"><span>${k}</span><b class="${cls}">${v}</b></div>`;
  const doneToday = !!it.completedOn && law.daysBetween(today, it.completedOn) === 0;
  let html = kv("due", `${law.tminus(it.days)} · ${law.longDate(it.dueDate)}`, it.days < 0 ? "over" : "");
  if (it.completedOn) html += kv("last completed", doneToday ? "today" : law.longDate(it.completedOn));
  if (it.snoozed) html += kv("snoozed", "a week, from the last reminder");
  html += kv("section", section) + kv("type", it.kind) + kv("orbital period", law.every(it.recurrenceMonths)) + kv("cost", law.money(it.costMinor, it.costIsEstimate));
  if (it.provider) html += kv("provider", it.provider);
  if (it.reminderDays?.length) html += kv("reminders", it.reminderDays.map((d) => `${d}d before`).join(" · "));
  if (it.documents?.length) html += `<h4>documents</h4>` + it.documents.map((d) => `<div class="doc">◆<span>${d.name}<small>${d.meta}</small></span></div>`).join("");
  /* a completion is once a day, as the app records it; a snooze is a week from today, and a second snooze changes nothing */
  html += `<div class="acts" aria-label="Item actions"><button type="button" class="done" data-act="complete"${doneToday ? " disabled" : ""}>${doneToday ? "completed today" : "complete"}</button><button type="button" data-act="snooze"${it.snoozed ? " disabled" : ""}>${it.snoozed ? "snoozed a week" : "snooze a week"}</button></div>`;
  html += `<div class="ivfoot"><span class="ivnote">${it.recurrenceMonths ? "a repeat is never finished; it comes round" : "one-off — does not come round"}</span></div>`;
  view.innerHTML = html;
  view.querySelector('[data-act="complete"]').addEventListener("click", (e) => { e.stopPropagation(); complete(id); });
  view.querySelector('[data-act="snooze"]').addEventListener("click", (e) => { e.stopPropagation(); snooze(id); });
  row.after(view);
  state.open = id;
  $$("#dial .body-link").forEach((b) => b.classList.toggle("lit", b.dataset.id === id));
  if (scroll) row.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
}
export function closeRow() {
  $$(".item.open").forEach((r) => { r.classList.remove("open"); r.setAttribute("aria-expanded", "false"); });
  $$(".itemview").forEach((v) => v.remove());
  $$("#dial .body-link.lit").forEach((b) => b.classList.remove("lit"));
  state.open = null;
}

/* ── time runs: complete, snooze, add, accept ─────────────────────────── */
function addMonths(date, months) {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}
export function complete(id) {
  const found = itemById(id);
  if (!found) return;
  const { item: it } = found;
  if (it.completedOn && law.daysBetween(today, it.completedOn) === 0) return;   /* done today already */
  const from = law.dialPlacement(it.days);
  it.completedOn = new Date(today.getTime());
  if (it.recurrenceMonths) {
    let next = addMonths(it.dueDate, it.recurrenceMonths);
    while (law.daysBetween(today, next) < 1) next = addMonths(next, it.recurrenceMonths);
    it.dueDate = next; it.snoozed = false;
  } else {
    it.status = "done";
  }
  refreshDays(household());
  /* POL-7: restored orbit — the comet flies from where it was to where it goes */
  const to = it.status === "active" ? law.dialPlacement(it.days) : { x: from.x, y: 20 };
  renderDial(); renderManifest();
  const comet = el("line", { class: "comet", x1: f1(from.x), y1: f1(from.y), x2: f1(to.x), y2: f1(to.y), "stroke-dasharray": "110", "stroke-dashoffset": "110" }, $("#dial"));
  requestAnimationFrame(() => comet.classList.add("fly"));
  setTimeout(() => comet.remove(), 1700);
  if (it.status === "active") openRow(id);
  changed();
}
export function snooze(id) {
  const found = itemById(id);
  if (!found) return;
  if (found.item.snoozed) return;
  const week = law.addDays(today, 7);
  if (found.item.dueDate < week) found.item.dueDate = week;
  found.item.snoozed = true;
  refreshDays(household());
  renderDial(); renderManifest(); openRow(id); changed();
}
export function addItem(fields) {
  const h = household();
  const id = `i-${Date.now().toString(36)}`;
  const it = {
    id, status: "active", title: fields.title, section: fields.section ?? "home", kind: fields.kind ?? "service",
    recurrenceMonths: fields.recurrenceMonths ?? 12, costMinor: fields.costMinor ?? null, costIsEstimate: true,
    reminderDays: [14], documents: [], provider: null, dueDate: fields.dueDate,
  };
  it.days = law.daysBetween(today, it.dueDate);
  h.items.push(it);
  renderDial(); renderManifest();
  const link = $(`#dial .body-link[data-id="${id}"]`);
  link?.classList.add("landing");
  changed();
  return it;
}
export function acceptSuggestion(id) {
  const i = inbox.review.findIndex((r) => r.id === id);
  if (i < 0) return null;
  const s = inbox.review.splice(i, 1)[0];
  const it = addItem({ title: s.title, section: s.section, kind: s.kind, recurrenceMonths: 12, costMinor: s.costMinor, dueDate: law.addDays(today, s.renewsInDays) });
  it.provider = s.provider; it.documents = [{ name: s.source.split(" · ")[0], meta: "attached on acceptance" }];
  renderDial(); renderManifest(); renderInbox(); changed();
  return it;
}
export function dismissSuggestion(id) {
  const i = inbox.review.findIndex((r) => r.id === id);
  if (i >= 0) inbox.review.splice(i, 1);
  renderDial(); renderManifest(); renderInbox(); changed();
}

/* ── the drawers ──────────────────────────────────────────────────────── */
export function openCreate(open = true) {
  $("#createdrawer").classList.toggle("open", open);
  $("#nstar").setAttribute("aria-expanded", String(open));
  $("#scrim").classList.toggle("on", open);
  if (open) setTimeout(() => $("#f-name").focus(), 380);
}
export function openDrawer(id, open = true) {
  $$(".drawer.open").forEach((d) => { if (d.id !== id) d.classList.remove("open"); });
  const d = $(`#${id}`);
  d.classList.toggle("open", open);
  d.querySelector(".handle")?.setAttribute("aria-expanded", String(open));
}
export function closeDrawers() {
  $$(".drawer.open").forEach((d) => d.classList.remove("open"));
  $$(".drawer .handle").forEach((h) => h.setAttribute("aria-expanded", "false"));
  openCreate(false);
  $("#account").classList.remove("open");
  $("#account-orb").setAttribute("aria-expanded", "false");
}
export function toggleAccount() {
  const open = !$("#account").classList.contains("open");
  $("#account").classList.toggle("open", open);
  $("#account-orb").setAttribute("aria-expanded", String(open));
}

export function renderInbox() {
  const orb = $("#inbox-orb");
  orb.classList.toggle("waiting", inbox.review.length > 0);
  orb.querySelector(".count").textContent = String(inbox.review.length);
  orb.setAttribute("aria-label", `Inbox — ${inbox.review.length} waiting`);
  const host = $("#lanes");
  host.replaceChildren();
  const lane = (cls, title, items, render) => {
    const l = document.createElement("div"); l.className = `lane ${cls}`;
    l.innerHTML = `<h4>${title}</h4>`;
    if (!items.length) { const p = document.createElement("div"); p.className = "receipt"; p.innerHTML = `<small>nothing here</small>`; l.appendChild(p); }
    for (const r of items) l.appendChild(render(r));
    host.appendChild(l);
  };
  lane("filed", "Filed", inbox.filed, (r) => { const d = document.createElement("div"); d.className = "receipt"; d.innerHTML = `<b></b><small></small>`; d.querySelector("b").textContent = r.title; d.querySelector("small").textContent = `${r.when} · ${r.note}`; return d; });
  lane("review", "For your review", inbox.review, (r) => {
    const d = document.createElement("div"); d.className = "receipt suggest";
    d.innerHTML = `<b></b><small></small>` + r.readings.map(([k, v, sure]) => `<div class="kv"><span>${k}</span><b>${v}<i class="sure ${sure ? "" : "unsure"}">${sure ? "sure" : "unsure"}</i></b></div>`).join("") +
      `<div class="kv"><span>burns up</span><b>in ${r.burnsInDays}d</b></div>` +
      `<div class="actions" role="group" aria-label="Decide"><button class="yes" type="button">Add to orbit</button><button class="no" type="button">Dismiss</button></div>`;
    d.querySelector("b").textContent = r.title; d.querySelector("small").textContent = r.source;
    wireDecide(d, r);
    return d;
  });
  lane("reading", "Still reading", inbox.reading, (r) => { const d = document.createElement("div"); d.className = "receipt"; d.innerHTML = `<b></b><small></small>`; d.querySelector("b").textContent = r.title; d.querySelector("small").textContent = r.note; return d; });
  lane("failed", "Failed to process", inbox.failed, (r) => { const d = document.createElement("div"); d.className = "receipt failed"; d.innerHTML = `<b></b><small></small>`; d.querySelector("b").textContent = r.title; d.querySelector("small").textContent = r.note; return d; });
}

/* ── the explore field: the command palette (POL-9) ───────────────────── */
function wireExplore() {
  const input = $("#explore"), pal = $("#palette");
  const render = () => {
    const q = input.value.trim().toLowerCase();
    pal.replaceChildren();
    const rows = household().items.filter((it) => it.status === "active" && (!q || it.title.toLowerCase().includes(q))).slice(0, 5);
    if (!rows.length) { const n = document.createElement("div"); n.className = "none"; n.textContent = "nothing in this orbit matches"; pal.appendChild(n); }
    for (const it of rows) {
      const b = document.createElement("button"); b.type = "button";
      b.innerHTML = `<b></b> <small>· ${law.tminus(it.days)}</small>`; b.querySelector("b").textContent = it.title;
      b.addEventListener("mousedown", (e) => { e.preventDefault(); openRow(it.id, true); input.blur(); });
      pal.appendChild(b);
    }
    const add = document.createElement("button"); add.type = "button"; add.className = "act"; add.textContent = "→ add an item";
    add.addEventListener("mousedown", (e) => { e.preventDefault(); openCreate(true); input.blur(); });
    pal.appendChild(add);
  };
  input.addEventListener("focus", () => { render(); pal.classList.add("open"); });
  input.addEventListener("input", render);
  input.addEventListener("blur", () => setTimeout(() => pal.classList.remove("open"), 150));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { const first = pal.querySelector("button:not(.act)"); if (first) first.dispatchEvent(new MouseEvent("mousedown")); } });
}

/* ── the create form ──────────────────────────────────────────────────── */
function wireCreate() {
  const form = $("#createform");
  const types = $$("#types button");
  let kind = "service";
  types.forEach((b) => b.addEventListener("click", () => { kind = b.dataset.type; types.forEach((o) => o.setAttribute("aria-pressed", String(o === b))); }));
  const due = $("#f-date");
  due.min = today.toISOString().slice(0, 10);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = $("#f-name").value.trim();
    if (!title) { $("#f-name").focus(); return; }
    const dateText = due.value;
    const dueDate = dateText ? new Date(`${dateText}T00:00:00`) : law.addDays(today, 30);
    const cost = parseFloat($("#f-cost").value);
    const it = addItem({ title, kind, section: $("#f-section").value, recurrenceMonths: Number($("#f-recur").value), costMinor: Number.isFinite(cost) ? Math.round(cost * 100) : null, dueDate });
    form.reset(); kind = "service"; types.forEach((o) => o.setAttribute("aria-pressed", String(o.dataset.type === "service")));
    openCreate(false);
    setTimeout(() => openRow(it.id, true), 450);
  });
}

export function mountHome(skyCams) {
  state.skyCams = skyCams;
  setCamera(state.camera);
  $("#account-orb").textContent = account.initials;
  $("#who-name").textContent = account.name;
  $("#relay-addr").textContent = account.relay;
  renderDial(); renderManifest(); renderGalaxy(); renderInbox();
  wireExplore(); wireCreate();
  $("#nstar").addEventListener("click", () => openCreate(!$("#createdrawer").classList.contains("open")));
  $("#scrim").addEventListener("click", () => openCreate(false));
  $("#account-orb").addEventListener("click", toggleAccount);
  $("#reset").addEventListener("click", resetSite);
  $("#inbox-orb").addEventListener("click", (e) => { e.preventDefault(); openDrawer("inboxdrawer", !$("#inboxdrawer").classList.contains("open")); });
  $$(".drawer .handle").forEach((h) => h.addEventListener("click", () => { const d = h.closest(".drawer"); openDrawer(d.id, !d.classList.contains("open")); }));
  $$(".drawer .close").forEach((c) => c.addEventListener("click", () => openDrawer(c.closest(".drawer").id, false)));
  $$("[data-open-drawer]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); $("#account").classList.remove("open"); openDrawer(b.dataset.openDrawer, true); }));
  $("#dial .sun-link").addEventListener("click", (e) => { e.preventDefault(); $("#today").scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }); });
  addEventListener("resize", () => { if (!state.flying) renderGalaxy(); });
  /* from another household, back to yours; from yours, back to the dawn (main.js says how) */
  $("#back").addEventListener("click", (e) => { e.preventDefault(); if (state.camera !== "willow") flyTo("willow"); else if (backHome) backHome(); else scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" }); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeDrawers(); hideBodyCallout(); } });
  /* a tap anywhere else, or a scroll, lets the callout go */
  document.addEventListener("pointerdown", (e) => { if (armedBody && !e.target.closest(".body-link") && !e.target.closest("#body-callout")) hideBodyCallout(); });
  addEventListener("scroll", () => { if (armedBody) hideBodyCallout(); }, { passive: true });
  document.addEventListener("click", (e) => { if (!e.target.closest("#account") && !e.target.closest("#account-orb")) $("#account").classList.remove("open"); });
  $$("[data-copy]").forEach((b) => b.addEventListener("click", () => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(b.dataset.copy).then(() => { b.dataset.done = "1"; b.textContent = "copied"; setTimeout(() => { delete b.dataset.done; b.textContent = "copy"; }, 1600); }).catch(() => {});
  }));
}
