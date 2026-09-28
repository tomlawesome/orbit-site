/*
 * The first-run film, played over the real screen — the vocabulary of
 * web/src/lib/tour/vocabulary.js against this page: a veil with holes cut
 * for whatever is lit, a ring grown onto the control out of a travelling
 * dot, the control itself rising and pressing, the ratified lines pinned to
 * the thing just acted on, and a compact transport with a tick per chapter.
 *
 * Reduced motion: movement goes to nothing, reading time does not.
 */
import { reduced, applyTheme, currentTheme } from "./sky.js";
import * as home from "./home.js";
import { households } from "./data.js";
import { addDays } from "./law.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const T = { cross: 350, travelBase: 500, ease: "cubic-bezier(.25,.1,.25,1)", hover: 350, press: 120, grow: 200, lift: 300, typeLead: 300, typeChar: 70, field: 600, calloutIn: 120, calloutOut: 180, holdBase: 1000, holdWord: 350, holdMin: 2400, scroll: 600 };
const holdFor = (text) => Math.max(T.holdMin, T.holdBase + T.holdWord * text.trim().split(/\s+/u).length);
const CANCEL = Symbol("cancel");

/* ── the clock ─────────────────────────────────────────────────────────── */
function makeClock() {
  let playing = true, run = 0, stopped = false;
  const waiters = new Set();
  const wait = (ms) => new Promise((resolve, reject) => {
    const token = run;
    const w = { remaining: ms, started: 0, timer: null, resolve, reject, token };
    const arm = () => { w.started = performance.now(); w.timer = setTimeout(() => { waiters.delete(w); resolve(); }, w.remaining); };
    waiters.add(w);
    if (playing) arm();
    w.arm = arm;
  });
  return {
    w: (ms) => (reduced ? Promise.resolve() : wait(ms)),
    hold: (ms) => wait(reduced ? Math.min(ms, 1200) : ms),
    wait,
    playing: () => playing,
    setPlaying(on) {
      if (playing === on) return; playing = on;
      for (const w of waiters) {
        if (on) w.arm();
        else { clearTimeout(w.timer); w.remaining -= performance.now() - w.started; }
      }
    },
    cancel() { run++; for (const w of waiters) { clearTimeout(w.timer); w.reject(CANCEL); } waiters.clear(); },
    async tween(ms, fn) {
      if (reduced) { fn(1); return; }
      const start = performance.now(); let elapsed = 0, last = start;
      while (elapsed < ms) {
        await new Promise((r) => requestAnimationFrame(r));
        if (stopped) throw CANCEL;
        const now = performance.now();
        if (playing) elapsed += now - last;
        last = now;
        fn(Math.min(1, elapsed / ms));
      }
    },
    stop() { stopped = true; this.cancel(); },
  };
}

/* ── the veil: a sheet with holes cut for the lit controls ──────────────── */
const veilEl = () => $("#veil");
let holes = [];
let veilRaf = 0;
function drawVeil() {
  const svg = veilEl().querySelector("svg");
  const mask = svg.querySelector("mask");
  Array.from(mask.children).slice(1).forEach((c) => c.remove());
  for (const h of holes) {
    const box = h.el.getBoundingClientRect();
    const NS = "http://www.w3.org/2000/svg";
    if (h.round) {
      const c = document.createElementNS(NS, "circle");
      const r = Math.max(box.width, box.height) / 2 + h.pad;
      c.setAttribute("cx", box.left + box.width / 2); c.setAttribute("cy", box.top + box.height / 2); c.setAttribute("r", r); c.setAttribute("fill", "black");
      mask.appendChild(c);
    } else {
      const rct = document.createElementNS(NS, "rect");
      rct.setAttribute("x", box.left - h.pad); rct.setAttribute("y", box.top - h.pad); rct.setAttribute("width", box.width + h.pad * 2); rct.setAttribute("height", box.height + h.pad * 2);
      rct.setAttribute("rx", h.radius); rct.setAttribute("fill", "black");
      mask.appendChild(rct);
    }
  }
}
function veilLoop() { drawVeil(); veilRaf = requestAnimationFrame(veilLoop); }

/* ── the context: everything a chapter can do ──────────────────────────── */
function createContext(clock) {
  const layer = $("#film");
  const dot = document.createElement("div"); dot.className = "tourfilm-dot"; layer.appendChild(dot);
  let at = [innerWidth / 2, innerHeight / 2];
  let live = null, lit = [], ghosts = [], worn;
  let dotAnchor = null, travelling = false, syncRaf = 0;
  const anims = new Set();
  const placeDot = (p) => { dot.getAnimations?.().forEach((a) => a.cancel()); dot.style.transform = `translate(${p[0]}px,${p[1]}px)`; };
  placeDot(at);
  const boxOf = (els, pad = 0) => {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const e of els) { const x = e.getBoundingClientRect(); l = Math.min(l, x.left); t = Math.min(t, x.top); r = Math.max(r, x.right); b = Math.max(b, x.bottom); }
    if (l === Infinity) return { x: 0, y: 0, w: 0, h: 0, cx: innerWidth / 2, cy: innerHeight / 2 };
    return { x: l - pad, y: t - pad, w: r - l + pad * 2, h: b - t + pad * 2, cx: (l + r) / 2, cy: (t + b) / 2 };
  };
  const anim = (node, frames, opts) => {
    if (reduced || typeof node.animate !== "function") return Promise.resolve();
    const a = node.animate(frames, opts); anims.add(a); if (!clock.playing()) a.pause();
    return a.finished.then(() => anims.delete(a), () => anims.delete(a));
  };
  const setPlaying = (on) => { for (const a of anims) { try { on ? a.play() : a.pause(); } catch { /* gone */ } } };

  function ctl(spec) {
    const s = typeof spec === "string" ? { sel: spec } : spec;
    const els = s.all ? $$(s.sel) : [$(s.sel)].filter(Boolean);
    return { sel: s.sel, els, round: !!s.round, pad: s.pad ?? 0, radius: s.radius ?? 14, rings: [], lifted: false, saved: [], optional: !!s.optional };
  }
  function ringStyle(c, box) {
    return `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;border-radius:${c.round ? "50%" : `${c.radius}px`}`;
  }
  function ensureRings(c) {
    if (c.rings.length) return;
    c.rings = c.els.map((e) => { const r = document.createElement("div"); r.className = "tourfilm-ring"; r.style.cssText = ringStyle(c, boxOf([e], c.pad)); layer.appendChild(r); return r; });
  }
  function syncRings(c) { c.rings.forEach((r, i) => { r.style.cssText += ";" + ringStyle(c, boxOf([c.els[i]], c.pad)); }); }
  function ringState(c, s) {
    for (const r of c.rings) {
      if (s === "off") { r.style.opacity = "0"; continue; }
      r.style.opacity = "1";
      r.style.boxShadow = s === "strong" ? "0 0 0 1.5px var(--accent),0 0 0 8px color-mix(in srgb,var(--accent) 26%,transparent),0 0 46px color-mix(in srgb,var(--accent) 50%,transparent)"
        : s === "quiet" ? "0 0 0 1.25px var(--accent)" : "";
    }
  }
  const applyHoles = () => { holes = lit.flatMap((c) => c.els.map((el) => ({ el, round: c.round, pad: c.pad, radius: c.radius }))); drawVeil(); };
  function light(...cs) { for (const c of cs) { if (!c.els.length) continue; ensureRings(c); syncRings(c); ringState(c, "on"); if (!lit.includes(c)) lit.push(c); } applyHoles(); }
  function applyLift(c) {
    if (c.lifted) return; c.lifted = true;
    for (const e of c.els) {
      const st = e.style; c.saved.push({ e, transform: st.transform, filter: st.filter, transition: st.transition });
      st.transition = reduced ? "none" : `transform ${T.lift}ms ${T.ease},filter ${T.lift}ms ease`;
      st.transform = "translateY(-2px)"; st.filter = "drop-shadow(0 0 14px color-mix(in srgb,var(--accent) 34%,transparent))";
    }
  }
  function restore(c) { for (const s of c.saved) { s.e.style.transform = s.transform; s.e.style.filter = s.filter; s.e.style.transition = s.transition; } c.saved = []; c.lifted = false; }
  function unlight(...cs) { for (const c of cs) { ringState(c, "off"); c.rings.forEach((r) => r.remove()); c.rings = []; restore(c); lit = lit.filter((o) => o !== c); } applyHoles(); }
  function quiet(c) { ringState(c, "quiet"); restore(c); }
  const offScreen = (b) => b.y + b.h < 80 || b.y > innerHeight - 80;
  async function bringIn(c, realtime = false) {
    if (!c || !c.els.length) return;
    const b = boxOf(c.els, c.pad);
    if (!offScreen(b)) return;
    c.els[0].scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    /* on resume the clock is still stopped, so the wait is real time */
    if (realtime) await new Promise((r) => setTimeout(r, reduced ? 50 : T.scroll));
    else await clock.w(T.scroll);
  }
  async function travel(to, dur) {
    dropCallout();
    if (!Array.isArray(to) && !to.els.length) return clock.w(dur ?? T.travelBase);
    if (!Array.isArray(to)) await bringIn(to);
    const box = Array.isArray(to) ? null : boxOf(to.els, to.pad);
    const target = box ? [box.cx, box.cy] : to;
    const from = [at[0], at[1]]; at = [target[0], target[1]];
    const ms = dur ?? T.travelBase;
    dotAnchor = Array.isArray(to) ? null : to;
    dot.style.opacity = "1";
    const d = Math.hypot(target[0] - from[0], target[1] - from[1]);
    if (reduced || d < 0.5) { placeDot(at); return clock.w(ms); }
    const nx = -(target[1] - from[1]) / d, ny = (target[0] - from[0]) / d;
    const c = [(from[0] + target[0]) / 2 + nx * d * 0.12, (from[1] + target[1]) / 2 + ny * d * 0.12];
    const frames = [];
    for (let i = 0; i <= 32; i++) { const t = i / 32, u = 1 - t; frames.push({ transform: `translate(${u * u * from[0] + 2 * u * t * c[0] + t * t * target[0]}px,${u * u * from[1] + 2 * u * t * c[1] + t * t * target[1]}px)` }); }
    dot.getAnimations?.().forEach((a) => a.cancel());
    travelling = true;
    void anim(dot, frames, { duration: ms, easing: T.ease, fill: "forwards" });
    return clock.w(ms).finally(() => { travelling = false; });
  }
  async function growInto(c) {
    if (!c.els.length) return clock.w(T.grow);
    ensureRings(c); syncRings(c); ringState(c, "on"); if (!lit.includes(c)) lit.push(c); applyHoles();
    if (!reduced) c.rings.forEach((r, i) => { const b = boxOf([c.els[i]], c.pad); void anim(r, [{ left: `${at[0] - 3}px`, top: `${at[1] - 3}px`, width: "6px", height: "6px", borderRadius: "50%" }, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px`, borderRadius: r.style.borderRadius }], { duration: T.grow, easing: T.ease, composite: "replace" }); });
    dot.style.opacity = "0";
    return clock.w(T.grow);
  }
  async function goto(c, o = {}) { await travel(c); await growInto(c); applyLift(c); ringState(c, "strong"); await clock.w(T.lift); if (o.willPress !== false) await clock.w(T.hover); }
  async function press(c) {
    if (!reduced) for (const e of c.els) { const base = c.lifted ? "translateY(-2px)" : "translate(0,0)"; e.style.transition = "none"; void anim(e, [{ transform: `${base} scale(1)` }, { transform: `${base} scale(.96)` }, { transform: `${base} scale(1)` }], { duration: T.press * 2, easing: "ease-in-out" }); }
    await clock.w(T.press * 2);
  }
  async function tap(c, o = {}) { await goto(c, o); await press(c); if (o.keep !== true) unlight(c); }
  function ghostOver(e) {
    const box = boxOf([e]); const cs = getComputedStyle(e);
    const g = document.createElement("div"); g.className = "tourfilm-typed";
    g.style.cssText = `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;background:${cs.backgroundColor};padding-left:${cs.paddingLeft};padding-right:${cs.paddingRight};font:${cs.font};color:${cs.color};border-radius:${cs.borderRadius};border:1px solid transparent`;
    const line = document.createElement("span"), caret = document.createElement("i"); g.append(line, caret); layer.appendChild(g); g.tourField = e; ghosts.push(g);
    return { line, caret };
  }
  function dropTyped() { ghosts.forEach((g) => g.remove()); ghosts = []; }
  async function typeInto(c, text) {
    await clock.w(T.typeLead);
    const written = c.els.map(ghostOver);
    if (reduced) written.forEach(({ line }) => { line.textContent = text; });
    for (let k = 0; k < text.length; k++) { if (!reduced) written.forEach(({ line }) => { line.textContent = text.slice(0, k + 1); }); await clock.w(T.typeChar); }
    written.forEach(({ caret }) => caret.remove());
    for (const e of c.els) if ("value" in e) { e.value = text; e.dispatchEvent(new Event("input", { bubbles: true })); }
  }
  function wear(pack) { if (worn === undefined) worn = currentTheme(); if (pack === null) { if (worn !== undefined) applyTheme(worn, false); worn = undefined; } else applyTheme(pack, false); }
  function placeCallout(box, stem, pt, side, o) {
    const wd = box.offsetWidth, ht = box.offsetHeight; let x, y;
    if (side === "left") { x = pt[0] - 18 - wd; y = pt[1] - ht / 2; } else if (side === "right") { x = pt[0] + 18; y = pt[1] - ht / 2; } else if (side === "top") { x = pt[0] - wd / 2; y = pt[1] - 18 - ht; } else { x = pt[0] - wd / 2; y = pt[1] + 18; }
    if (o.dy) y += o.dy;
    x = Math.max(16, Math.min(x, innerWidth - 16 - wd)); y = Math.max(16, Math.min(y, innerHeight - 60 - ht));
    box.style.left = `${x}px`; box.style.top = `${y}px`;
    if (side === "left" || side === "right") { stem.style.top = `${Math.max(12, Math.min(pt[1] - y, ht - 12)) - 7}px`; stem.style[side === "left" ? "right" : "left"] = "-8px"; }
    else { stem.style.left = `${Math.max(14, Math.min(pt[0] - x, wd - 14)) - 7}px`; stem.style[side === "top" ? "bottom" : "top"] = "-8px"; }
  }
  function showCallout(text, pt, side, o) {
    const box = document.createElement("div"); box.className = `tourfilm-callout${o.label ? " label" : ""}`;
    box.textContent = text;
    if (o.link) { const a = document.createElement("a"); a.href = o.link.href; a.textContent = o.link.text; if (o.link.onClick) a.addEventListener("click", o.link.onClick); box.append(document.createElement("br"), a); }
    box.style.maxWidth = `${o.w ?? 260}px`;
    const stem = document.createElement("i"); box.appendChild(stem); layer.appendChild(box);
    placeCallout(box, stem, pt, side, o);
    box.tourStem = stem;
    const slide = { left: [6, 0], right: [-6, 0], top: [0, 6], bottom: [0, -6] }[side];
    box.style.transform = reduced ? "none" : `translate(${slide[0]}px,${slide[1]}px)`;
    requestAnimationFrame(() => { box.style.opacity = "1"; box.style.transform = "translate(0,0)"; });
    return box;
  }
  const edgeOf = (b, side) => (side === "left" ? [b.x, b.cy] : side === "right" ? [b.x + b.w, b.cy] : side === "top" ? [b.cx, b.y] : [b.cx, b.y + b.h]);
  async function callout(text, anchor, side, o = {}) {
    dropCallout();
    /* a line with nothing to point at is not said: it would float */
    if (!Array.isArray(anchor) && !anchor.els.length) return;
    if (!Array.isArray(anchor)) await bringIn(anchor);
    await clock.w(T.calloutIn);
    const pt = Array.isArray(anchor) ? anchor : edgeOf(boxOf(anchor.els, anchor.pad), side);
    live = showCallout(text, pt, side, o);
    live.tourAnchor = Array.isArray(anchor) ? null : anchor; live.tourSide = side; live.tourOpts = o;
    await clock.hold(o.hold ?? holdFor(text));
  }
  function dropCallout() { if (!live) return; const b = live; live = null; b.style.transition = "opacity .18s ease"; b.style.opacity = "0"; setTimeout(() => b.remove(), T.calloutOut + 240); }
  function veil(on) { veilEl().classList.toggle("on", on); if (on) { drawVeil(); if (!veilRaf) veilLoop(); } }
  async function scrollTo(el, block = "center") {
    if (!el) return;
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block });
    await clock.w(T.scroll);
  }
  function follow() {
    for (const c of lit) if (c.rings.length) syncRings(c);
    if (live && live.tourAnchor && live.tourAnchor.els.length) {
      placeCallout(live, live.tourStem, edgeOf(boxOf(live.tourAnchor.els, live.tourAnchor.pad), live.tourSide), live.tourSide, live.tourOpts);
    }
    for (const g of ghosts) { const b = boxOf([g.tourField]); g.style.left = `${b.x}px`; g.style.top = `${b.y}px`; }
    if (dotAnchor && !travelling && dot.style.opacity === "1" && dotAnchor.els.length) {
      const b = boxOf(dotAnchor.els, dotAnchor.pad); at = [b.cx, b.cy]; placeDot(at);
    }
    syncRaf = requestAnimationFrame(follow);
  }
  syncRaf = requestAnimationFrame(follow);
  function clear() {
    $("#dial")?.classList.remove("warn");
    for (const c of lit) { c.rings.forEach((r) => r.remove()); c.rings = []; restore(c); }
    lit = []; holes = [];
    for (const a of anims) { try { a.cancel(); } catch { /* gone */ } } anims.clear();
    if (live) { live.remove(); live = null; }
    dropTyped();
    if (worn !== undefined) { applyTheme(worn, false); worn = undefined; }
    dot.style.opacity = "0"; at = [innerWidth / 2, innerHeight / 2]; placeDot(at);
    veilEl().classList.remove("on"); drawVeil();
    $$("#dial .tourfilm-body").forEach((b) => b.remove());
  }
  function destroy() { clear(); cancelAnimationFrame(veilRaf); veilRaf = 0; cancelAnimationFrame(syncRaf); layer.replaceChildren(); }
  return { clock, w: clock.w, hold: clock.hold, tween: clock.tween.bind(clock), ctl, light, unlight, quiet, goto, press, tap, typeInto, wear, travel, callout, dropCallout, veil, scrollTo, clear, destroy, setPlaying, boxOf, bringIn, anchor: () => (live && live.tourAnchor) || dotAnchor };
}

/* ── the chapters, in the ratified order ───────────────────────────────── */
const NS = "http://www.w3.org/2000/svg";
function drawFilmBody(days) {
  const dial = $("#dial"); const g = document.createElementNS(NS, "g"); g.setAttribute("class", "tourfilm-body"); g.setAttribute("aria-hidden", "true");
  const dot = document.createElementNS(NS, "circle"); dot.setAttribute("r", "5.5"); dot.setAttribute("style", "fill:var(--accent)"); g.appendChild(dot); dial.appendChild(g);
  positionFilmBody(g, days); return g;
}
async function positionFilmBody(g, days) { const { dialPlacement } = await import("./law.js"); const { x, y } = dialPlacement(days); const d = g.querySelector("circle"); d.setAttribute("cx", x); d.setAttribute("cy", y); }
const ease = (t) => 1 - Math.pow(1 - t, 3);

export const CHAPTERS = [
  { id: "arrive", name: "Arrive", async play(c) {
    home.closeDrawers(); await c.scrollTo($("#hero"), "start"); c.veil(false);
    const dial = c.ctl({ sel: ".dialwrap", round: true });
    await c.goto(dial, { willPress: false });
    await c.callout("This is your star chart.", dial, "left");
    c.unlight(dial);
    const sun = c.ctl({ sel: "#dial .sun-link", round: true, pad: 10 });
    const wide = innerWidth > 900;
    const others = c.ctl({ sel: wide ? ".minisys .msring" : "#chips button", all: true, round: wide, optional: true });
    await c.goto(sun, { willPress: false }); c.light(others);
    await c.callout("Every sun is a household you belong to.", sun, "top");
    c.unlight(others);
    await c.callout("That's your sun, at centre — your household, always here.", sun, "bottom");
    c.unlight(sun);
    const other = c.ctl({ sel: wide ? ".minisys .msring" : "#chips button", round: wide, optional: true });
    await c.goto(other, { willPress: false });
    await c.callout("Your other households sit further out. Tap one to fly there.", other, wide ? "right" : "bottom");
    c.unlight(other); c.dropCallout();
  } },
  { id: "add", name: "Add", async play(c) {
    await c.scrollTo($("#hero"), "start"); c.veil(false);
    const star = c.ctl({ sel: "#nstar", round: true }); c.veil(true);
    await c.goto(star); await c.press(star); c.unlight(star);
    home.openCreate(true); await c.w(450);
    const card = c.ctl({ sel: "#createdrawer .inner", radius: 16 });
    await c.goto(card, { willPress: false });
    await c.callout("Add anything you want to keep track of: a service, a renewal, an inspection.", card, "bottom");
    c.dropCallout(); c.unlight(card);
    const name = c.ctl({ sel: "#f-name", radius: 10 }); await c.goto(name); await c.press(name); await c.typeInto(name, "Gas safety certificate"); c.unlight(name); await c.w(T.field);
    const insp = c.ctl({ sel: '#types button[data-type="inspection"]', radius: 16 }); await c.goto(insp); await c.press(insp); insp.els[0]?.click(); c.quiet(insp); await c.w(T.field);
    const due = c.ctl({ sel: "#f-date", radius: 12 }); await c.goto(due); await c.press(due);
    const dueDate = addDays(new Date(), 381); const iso = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, "0")}-${String(dueDate.getDate()).padStart(2, "0")}`;
    if (due.els[0]) { due.els[0].value = iso; } await c.w(T.field); c.unlight(due);
    const cost = c.ctl({ sel: "#f-cost", radius: 12 }); await c.goto(cost); await c.press(cost); await c.typeInto(cost, "85"); c.unlight(cost); await c.w(T.field);
    const add = c.ctl({ sel: "#createform .btn-primary", radius: 14 }); await c.goto(add); await c.press(add); c.unlight(insp); c.unlight(add);
    add.els[0]?.click();
    await c.w(600);
  } },
  { id: "lands", name: "Lands", async play(c) {
    c.veil(false); await c.scrollTo($("#hero"), "start"); await c.w(300);
    const body = c.ctl({ sel: '#dial .body-link[aria-label^="Gas safety"]', round: true, pad: 6, optional: true });
    await c.goto(body, { willPress: false });
    await c.callout("Each item becomes a body on the chart, placed by when it's due.", body, "top");
    c.unlight(body);
    const ring = c.ctl({ sel: ".dialwrap", round: true });
    await c.goto(ring, { willPress: false });
    $("#dial").classList.add("warn");
    await c.callout("The closer a body drifts to the red ring, the sooner it's due. Inside it, it's overdue.", ring, "right");
    $("#dial").classList.remove("warn");
    c.unlight(ring); c.dropCallout();
  } },
  { id: "manifest", name: "Below the dial", async play(c) {
    c.veil(false); await c.scrollTo($("#today"), "start"); await c.w(200);
    const todayRow = c.ctl({ sel: "#today", radius: 10, pad: 6 });
    c.veil(true); await c.goto(todayRow, { willPress: false });
    await c.callout("Below the dial, the manifest lists the same items in order, soonest first.", todayRow, "bottom");
    c.unlight(todayRow);
    const rows = c.ctl({ sel: "#corridor .item", all: true, radius: 14 });
    c.light(rows);
    await c.callout("Open any row for its details, documents and actions.", todayRow, "bottom");
    c.unlight(rows); c.dropCallout();
  } },
  { id: "time", name: "Time runs", async play(c) {
    c.veil(false); await c.scrollTo($("#hero"), "start"); await c.w(300);
    const g = drawFilmBody(381); await c.w(400);
    const body = c.ctl({ sel: "#dial .tourfilm-body", round: true, pad: 6, optional: true });
    c.light(body);
    await c.tween(2600, (t) => { positionFilmBody(g, Math.round(381 + (16 - 381) * ease(t))); c.light(body); });
    await c.goto(body, { willPress: false });
    await c.callout("As the due date approaches, the body drifts in towards the sun.", body, "bottom");
    c.unlight(body);
    const dial = c.ctl({ sel: ".dialwrap", round: true });
    await c.callout("A month out it turns amber, and Orbit sends you a reminder.", dial, "top");
    c.dropCallout(); g.remove();
  } },
  { id: "post", name: "Paper by post", async play(c) {
    c.veil(false); home.closeDrawers(); await c.scrollTo($("#hero"), "start");
    const orb = c.ctl({ sel: "#inbox-orb", round: true }); c.veil(true);
    await c.goto(orb); await c.press(orb); c.unlight(orb);
    home.openDrawer("inboxdrawer", true); await c.w(450);
    const relay = c.ctl({ sel: "#inboxdrawer .relay-card", radius: 14 });
    await c.goto(relay, { willPress: false });
    await c.callout("Every household has its own relay address.", relay, "left");
    await c.callout("Forward a bill or a policy to it, and Orbit reads the attachment for you.", relay, "left");
    c.unlight(relay); c.dropCallout();
  } },
  { id: "inbox", name: "Inbox", async play(c) {
    home.openDrawer("inboxdrawer", true); await c.w(300); c.veil(true);
    for (const lane of [["filed", "Filed: documents Orbit has already read and attached to their items.", "bottom"], ["review", "For your review: what Orbit found in a document, waiting for your decision.", "bottom"], ["reading", "Still reading: mail that has just arrived.", "top"]]) {
      const l = c.ctl({ sel: `#lanes .lane.${lane[0]}`, radius: 14, optional: true });
      await c.goto(l, { willPress: false }); await c.callout(lane[1], l, "left"); c.dropCallout(); c.unlight(l);
    }
    const review = c.ctl({ sel: "#lanes .lane.review", radius: 14, optional: true }); c.light(review);
    const add = c.ctl({ sel: "#lanes .receipt.suggest .actions button.yes", radius: 10, optional: true });
    await c.goto(add); await c.press(add); add.els[0]?.click(); await c.w(400); await c.press(add); add.els[0]?.click();
    await c.callout("Nothing is added to your chart until you say so.", add.els[0] ? c.ctl({ sel: "#lanes .lane.review", radius: 14 }) : review, "left");
    c.unlight(add); c.unlight(review); c.dropCallout();
    home.openDrawer("inboxdrawer", false);
  } },
  { id: "belt", name: "The belt", async play(c) {
    c.veil(false); home.closeDrawers(); home.openRow("i-mot", false); await c.scrollTo($("#i-mot"), "start"); await c.w(300);
    const docs = c.ctl({ sel: "#i-mot-view .doc", all: true, radius: 9, optional: true }); c.veil(true);
    await c.goto(docs, { willPress: false });
    await c.callout("Documents attached to an item form a belt around its body on the chart.", docs, innerWidth > 700 ? "right" : "top");
    await c.callout("Open the item to read them.", docs, innerWidth > 700 ? "right" : "top", { w: 220 });
    c.unlight(docs); c.dropCallout();
  } },
  { id: "done", name: "Done", async play(c) {
    home.openRow("i-mot", false); await c.scrollTo($("#i-mot"), "start"); await c.w(300); c.veil(true);
    const card = c.ctl({ sel: "#i-mot-view", radius: 14, optional: true }); c.light(card);
    const done = c.ctl({ sel: '#i-mot-view .acts button[data-act="complete"]', radius: 10, optional: true });
    await c.goto(done);
    await c.callout("MOT passed? Mark it done, and it moves out to next year's date.", done, "top", { w: 240 });
    await c.press(done); c.dropCallout(); c.unlight(done); c.unlight(card);
    done.els[0]?.click();
    c.veil(false); await c.scrollTo($("#hero"), "start"); await c.w(1800);
    const body = c.ctl({ sel: '#dial .body-link[data-id="i-mot"]', round: true, pad: 6, optional: true });
    await c.goto(body, { willPress: false });
    await c.callout("Recurring items come round again. One-offs simply end.", body, "top");
    c.unlight(body); c.dropCallout();
  } },
  { id: "others", name: "Other households", async play(c) {
    c.veil(false); home.closeDrawers(); await c.scrollTo($("#hero"), "start"); await c.w(200);
    const other = c.ctl({ sel: '.minisys[data-id="grans"] .msring, #chips button', round: innerWidth > 900, pad: 6, optional: true });
    other.els = other.els.slice(0, 1);
    c.veil(true); await c.goto(other);
    await c.callout("Your other households are out in the sky.", other, innerWidth > 900 ? "left" : "bottom");
    await c.press(other); c.dropCallout(); c.unlight(other); c.veil(false);
    await new Promise((resolve) => home.flyTo("grans", resolve));
    await c.w(400);
    const sun = c.ctl({ sel: "#dial .sun-link", round: true, pad: 10 });
    await c.goto(sun, { willPress: false });
    await c.callout("Tap one, and you fly there.", sun, "bottom");
    c.unlight(sun); c.dropCallout();
    await new Promise((resolve) => home.flyTo("willow", resolve));
    await c.w(300);
  } },
  { id: "sky", name: "Your sky", async play(c) {
    c.veil(false); await c.scrollTo($("#hero"), "start");
    const orb = c.ctl({ sel: "#account-orb", round: true }); c.veil(true);
    await c.goto(orb); await c.press(orb); c.unlight(orb);
    if (!$("#account").classList.contains("open")) home.toggleAccount(); await c.w(300);
    const sw = c.ctl({ sel: "#account .swatches", radius: 12, pad: 4 });
    await c.goto(sw, { willPress: false });
    await c.callout("Five skies to choose from: star chart, after dark, clouds, dawn and retrograde.", sw, "left");
    c.dropCallout();
    const dawn = c.ctl({ sel: '#account .swatches button[data-pack="dawn"]', round: true, pad: 3 });
    await c.goto(dawn); await c.press(dawn); c.unlight(sw); c.unlight(dawn);
    c.wear("dawn"); c.veil(false); home.closeDrawers();
    await c.callout("Your sky, your relay address and this walk all live in the account card.", c.ctl({ sel: ".dialwrap", round: true }), "top");
    c.dropCallout(); c.wear(null);
  } },
  { id: "yours", name: "Yours", async play(c) {
    c.veil(false); home.closeDrawers(); await c.scrollTo($("#hero"), "start");
    const sun = c.ctl({ sel: "#dial .sun-link", round: true, pad: 10 });
    await c.goto(sun, { willPress: false });
    await c.callout("That's a year, in one turn of the ring.", sun, "top");
    await c.callout("Now it's yours.", sun, "bottom", { hold: 3200 });
    await c.hold(2000);
    c.unlight(sun);
  } },
];

/* ── the player and the transport ──────────────────────────────────────── */
export function createPlayer() {
  const transport = $("#transport");
  const bar = transport.querySelector(".bar"), name = transport.querySelector(".name"), count = transport.querySelector(".count");
  const playBtn = $("#tp-play"), stopBtn = $("#tp-stop");
  const n = CHAPTERS.length;
  let ctx = null, clock = null, current = -1, running = false, jump = null, snap = null;
  const ticks = CHAPTERS.map((ch, i) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "tick"; b.style.left = `${(i / (n - 1)) * 100}%`;
    b.setAttribute("aria-label", ch.name); b.title = ch.name;
    b.addEventListener("click", () => start(i));
    bar.appendChild(b); return b;
  });
  const setCurrent = (i) => {
    ticks.forEach((t, j) => t.setAttribute("aria-current", String(j === i)));
    transport.style.setProperty("--p", `${(Math.max(i, 0) / (n - 1)) * 100}%`);
    name.textContent = i >= 0 ? CHAPTERS[i].name : "the walk";
    count.textContent = `${String(Math.max(i, 0) + 1).padStart(2, "0")} / ${String(n).padStart(2, "0")}`;
  };
  const playIcon = (playing) => { playBtn.innerHTML = playing ? '<svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="1.5" width="3" height="9" fill="currentColor"/><rect x="7" y="1.5" width="3" height="9" fill="currentColor"/></svg>' : '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 1.5 L10.5 6 L3 10.5 Z" fill="currentColor"/></svg>'; playBtn.setAttribute("aria-label", playing ? "Pause the walk" : "Play the walk"); };
  async function start(from = 0) {
    if (running) { await stop(true); }
    running = true; jump = null;
    snap = home.snapshot();
    home.mute(true); home.restorePristine();
    transport.classList.add("on", "playing"); transport.classList.remove("ended");
    clock = makeClock(); ctx = createContext(clock); playIcon(true);
    try {
      for (let i = from; i < n; i++) {
        current = i; setCurrent(i);
        await CHAPTERS[i].play(ctx);
        ctx.clear();
      }
      current = -1; ended();
    } catch (e) {
      if (e !== CANCEL) { console.error(e); ended(); }
    }
  }
  function putBack() { if (snap) { home.closeDrawers(); home.mute(false); home.restoreState(snap); snap = null; } }
  function ended() { running = false; transport.classList.remove("playing"); transport.classList.add("ended"); playIcon(false); if (ctx) { ctx.destroy(); ctx = null; } putBack(); name.textContent = "Tour finished. Your sky is back."; }
  async function stop(silent) {
    if (!running) return;
    running = false;
    clock?.stop(); ctx?.destroy(); ctx = null;
    home.closeDrawers(); putBack();
    transport.classList.remove("playing"); if (!silent) { transport.classList.add("ended"); name.textContent = "Tour stopped. Your sky is back."; }
    playIcon(false);
  }
  let byReader = false;
  function pause(reader = false) {
    if (!running || !clock.playing()) return;
    clock.setPlaying(false); ctx.setPlaying(false); playIcon(false);
    transport.classList.remove("playing");
    byReader = reader;
    if (reader) name.textContent = "paused";
  }
  async function resume() {
    if (!running || clock.playing()) return;
    if (byReader) { name.textContent = CHAPTERS[current].name; byReader = false; await ctx.bringIn(ctx.anchor(), true); }
    clock.setPlaying(true); ctx.setPlaying(true); playIcon(true);
    transport.classList.add("playing");
  }
  function toggle() {
    if (!running) { start(0); return; }
    if (clock.playing()) pause(false); else resume();
  }
  /* the reader's own scrolling pauses the walk: wheel, touch and the keys,
     never the scroll event, which the film's own moves also fire */
  addEventListener("wheel", () => pause(true), { passive: true });
  addEventListener("touchmove", () => pause(true), { passive: true });
  addEventListener("keydown", (e) => { if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"].includes(e.key) && !e.target.matches("input,select,textarea")) pause(true); });
  playBtn.addEventListener("click", toggle);
  stopBtn.addEventListener("click", () => stop(false));
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input,select,textarea")) return;
    if (e.key === " " && running) { e.preventDefault(); toggle(); }
    if (e.key === "Escape" && running) stop(false);
  });
  playIcon(false); setCurrent(-1);
  return { start, stop, show: () => { transport.classList.add("on", "ended"); name.textContent = "take the walk"; }, running: () => running };
}
