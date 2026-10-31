/*
 * Test for the home screen (assets/js/home.js, #45): what a visitor sees and what each control does, on the real
 * markup of index.html's <main id="home">.
 *
 *   mountHome(skyCams) draws the dial (the month ring, a body per active item and per suggestion, trails, pings and
 *   belts), the manifest (overdue first, then today, then month by month to the horizon), the other households (one
 *   mini system and one chip each, kept on the sky) and the inbox (its count and its four lanes), and wires the
 *   controls: a body or a row opens the item; complete moves a repeat on and ends a one-off; snooze puts it a week
 *   out once; a suggestion takes two taps to add or dismiss; the create form adds an item and resets; the explore
 *   field lists and opens matches; the drawers, the account menu and Escape; a flight to another household and back;
 *   snapshot / restoreState / restorePristine; what a visit changes is saved unless muted; reset forgets the visit.
 *
 * No dependencies and no browser: a small stand-in page (elements, a selector matcher, an HTML reader for the page's
 * markup and for what home.js writes as innerHTML, events that bubble) and a virtual clock for home.js's timers.
 * Reduced motion is on, so a flight is two 50 ms steps.
 *
 * #117 (ADR-0006, H1-H5): the history calls a visit makes are recorded on a stand-in `history`; a click on another
 * household pushes one entry, a hop from there replaces it, the corner is history.back() when the entry says a sky, a
 * flight asked for mid-flight is flown when it lands, and the walk's way (flyTo, restoreState) touches no entry.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/* --motion: the same page without reduced motion, for the full-length timings (a second process: reduced is read once) */
const MOTION = process.argv[2] === "--motion";

let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};
const show = JSON.stringify;

/* ── the stand-in page ─────────────────────────────────────────────────── */
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " })[e]);
const kebab = (k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

class Text {
  constructor(data) { this.data = data; this.parentNode = null; }
  get textContent() { return this.data; }
  remove() { this.parentNode?._drop(this); }
}

class Element {
  constructor(name) {
    this.localName = name.toLowerCase();
    this.attrs = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = {};
    this.scrolled = [];
    this._rect = null;
    this._value = undefined;
    const self = this;
    this.style = {
      setProperty(k, v) { this[k] = v; },
      getPropertyValue(k) { return this[k] ?? ""; },
    };
    this.dataset = new Proxy({}, {
      get: (_, k) => (typeof k === "string" ? self.getAttribute(`data-${kebab(k)}`) ?? undefined : undefined),
      set: (_, k, v) => { self.setAttribute(`data-${kebab(k)}`, v); return true; },
    });
    this.classList = {
      list: () => (self.getAttribute("class") || "").split(/\s+/).filter(Boolean),
      contains: (c) => self.classList.list().includes(c),
      add: (...cs) => { const l = self.classList.list(); for (const c of cs) if (!l.includes(c)) l.push(c); self.setAttribute("class", l.join(" ")); },
      remove: (...cs) => self.setAttribute("class", self.classList.list().filter((c) => !cs.includes(c)).join(" ")),
      toggle: (c, force) => {
        const on = force === undefined ? !self.classList.contains(c) : !!force;
        if (on) self.classList.add(c); else self.classList.remove(c);
        return on;
      },
    };
  }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  removeAttribute(k) { this.attrs.delete(k); }
  hasAttribute(k) { return this.attrs.has(k); }
  get id() { return this.getAttribute("id") ?? ""; }
  set id(v) { this.setAttribute("id", v); }
  get className() { return this.getAttribute("class") ?? ""; }
  set className(v) { this.setAttribute("class", v); }
  get type() { return this.getAttribute("type") ?? ""; }
  set type(v) { this.setAttribute("type", v); }
  get min() { return this.getAttribute("min") ?? ""; }
  set min(v) { this.setAttribute("min", v); }
  get disabled() { return this.hasAttribute("disabled"); }
  get children() { return this.childNodes.filter((n) => n instanceof Element); }
  get firstElementChild() { return this.children[0] ?? null; }
  get lastElementChild() { const c = this.children; return c[c.length - 1] ?? null; }
  get nextElementSibling() { const s = this.parentNode?.children ?? []; return s[s.indexOf(this) + 1] ?? null; }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(""); }
  set textContent(v) { this._clear(); this.appendChild(new Text(String(v))); }
  set innerHTML(html) { this._clear(); for (const n of parseHTML(html)) this.appendChild(n); }
  get value() {
    if (this._value !== undefined) return this._value;
    if (this.localName === "select") {
      const opts = this.querySelectorAll("option");
      const o = opts.find((x) => x.hasAttribute("selected")) ?? opts[0];
      return o ? o.getAttribute("value") ?? o.textContent : "";
    }
    return this.getAttribute("value") ?? "";
  }
  set value(v) { this._value = String(v); }
  get elements() {
    const list = this.querySelectorAll("input, select, textarea, button");
    for (const e of list) if (e.id) list[e.id] = e;
    return list;
  }
  reset() { for (const e of this.elements) e._value = undefined; }
  get offsetWidth() { return this._rect?.width ?? 0; }
  get offsetHeight() { return this._rect?.height ?? 0; }
  getBoundingClientRect() {
    const r = this._rect ?? { left: 0, top: 0, width: 0, height: 0 };
    return { ...r, right: r.left + r.width, bottom: r.top + r.height };
  }
  scrollIntoView(opts) { this.scrolled.push(opts); }
  focus() { document.activeElement = this; this.dispatchEvent(new Event("focus")); }
  blur() { if (document.activeElement === this) document.activeElement = null; this.dispatchEvent(new Event("blur")); }
  click() { this.dispatchEvent(new MouseEvent("click", { bubbles: true })); }
  _clear() { for (const n of this.childNodes) n.parentNode = null; this.childNodes = []; }
  _drop(n) { this.childNodes = this.childNodes.filter((c) => c !== n); n.parentNode = null; }
  appendChild(n) { n.parentNode?._drop(n); n.parentNode = this; this.childNodes.push(n); return n; }
  replaceChildren(...ns) { this._clear(); for (const n of ns) this.appendChild(n); }
  after(n) {
    const p = this.parentNode; n.parentNode?._drop(n);
    p.childNodes.splice(p.childNodes.indexOf(this) + 1, 0, n); n.parentNode = p;
  }
  remove() { this.parentNode?._drop(this); }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  matches(sel) { return parseSelector(sel).some((chain) => matchChain(this, chain)); }
  closest(sel) { for (let x = this; x instanceof Element; x = x.parentNode) if (x.matches(sel)) return x; return null; }
  querySelectorAll(sel) {
    const chains = parseSelector(sel), out = [];
    const walk = (e) => { for (const c of e.children) { if (chains.some((ch) => matchChain(c, ch))) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn); }
  dispatchEvent(e) {
    if (!e.target) e.target = this;
    const path = [];
    for (let x = this; x; x = x.parentNode) path.push(x);
    if (e.bubbles && this.parentNode !== null && path[path.length - 1] === document.documentElement) path.push(document);
    for (const x of e.bubbles ? path : [this]) {
      e.currentTarget = x;
      for (const fn of [...(x.listeners?.[e.type] ?? [])]) fn.call(x, e);
      if (e._stopped) break;
    }
    return !e.defaultPrevented;
  }
}

class Event {
  constructor(t, init = {}) { this.type = t; this.bubbles = false; Object.assign(this, init); this.defaultPrevented = false; this._stopped = false; }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this._stopped = true; }
}
class MouseEvent extends Event {}

/* a selector list of descendant chains of compounds: tag, #id, .class, [attr], [attr="v"], :not(compound) */
function parseCompound(s) {
  const c = { tag: null, id: null, classes: [], attrs: [], nots: [] };
  let m, rest = s;
  while (rest) {
    if ((m = rest.match(/^[a-zA-Z][\w-]*/))) c.tag = m[0].toLowerCase();
    else if ((m = rest.match(/^#([\w-]+)/))) c.id = m[1];
    else if ((m = rest.match(/^\.([\w-]+)/))) c.classes.push(m[1]);
    else if ((m = rest.match(/^\[([\w-]+)(?:="([^"]*)")?\]/))) c.attrs.push([m[1], m[2]]);
    else if ((m = rest.match(/^:not\(([^)]*)\)/))) c.nots.push(parseCompound(m[1]));
    else throw new Error(`stand-in page: selector "${s}" not understood`);
    rest = rest.slice(m[0].length);
  }
  return c;
}
function parseSelector(sel) {
  return sel.split(",").map((part) => part.trim().split(/\s+/).map(parseCompound));
}
function matchCompound(e, c) {
  if (c.tag && e.localName !== c.tag) return false;
  if (c.id && e.id !== c.id) return false;
  for (const k of c.classes) if (!e.classList.contains(k)) return false;
  for (const [k, v] of c.attrs) if (!e.hasAttribute(k) || (v !== undefined && e.getAttribute(k) !== v)) return false;
  for (const n of c.nots) if (matchCompound(e, n)) return false;
  return true;
}
function matchChain(e, chain) {
  if (!matchCompound(e, chain[chain.length - 1])) return false;
  let i = chain.length - 2;
  for (let x = e.parentNode; x instanceof Element && i >= 0; x = x.parentNode) if (matchCompound(x, chain[i])) i--;
  return i < 0;
}

/* HTML as home.js and index.html write it: tags, attributes, text, comments, void and self-closed elements */
function parseHTML(html) {
  const root = new Element("#root");
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!(?:[^>]*)>|<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) top.appendChild(new Text(decode(m[5])));
    else if (m[1]) {
      const name = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].localName === name) { stack.length = i; break; }
    } else if (m[2]) {
      const e = new Element(m[2]);
      for (const a of m[3].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) e.setAttribute(a[1], decode(a[2] ?? a[3] ?? a[4] ?? ""));
      top.appendChild(e);
      if (!m[4] && !VOID.has(e.localName)) stack.push(e);
    }
  }
  const out = [...root.childNodes];
  root._clear();
  return out;
}

/* the page: index.html's <main id="home">, inside <html><body> */
const indexHtml = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const mainHtml = indexHtml.match(/<main id="home"[\s\S]*?<\/main>/)?.[0];
if (!mainHtml) { console.log("FAIL the page: index.html has no <main id=\"home\">"); process.exit(1); }
const htmlEl = new Element("html"), bodyEl = new Element("body");
htmlEl.appendChild(bodyEl);
for (const n of parseHTML(mainHtml)) bodyEl.appendChild(n);

const winListeners = {};
const storage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear(),
  };
};
const document = {
  documentElement: htmlEl, body: bodyEl, activeElement: null, listeners: {},
  querySelector: (s) => htmlEl.matches(s) ? htmlEl : htmlEl.querySelector(s),
  querySelectorAll: (s) => htmlEl.querySelectorAll(s),
  getElementById: (id) => htmlEl.querySelector(`#${id}`),
  createElement: (n) => new Element(n),
  createElementNS: (_, n) => new Element(n),
  addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); },
  removeEventListener() {},
};
const reloads = [], scrolls = [];
/* history: records every call, keeps `state` as pushState and replaceState set it (a browser keeps a copy; the calls here
   carry plain data, so the object is kept as given). back() and go() only record: nothing here plays the browser's pop. */
const hist = {
  state: null, calls: [],
  pushState(state, title, url) { hist.calls.push({ kind: "push", state, url }); hist.state = state; },
  replaceState(state, title, url) { hist.calls.push({ kind: "replace", state, url }); hist.state = state; },
  go(n) { hist.calls.push({ kind: "go", n }); },
  back() { hist.calls.push({ kind: "back" }); },
  forward() { hist.calls.push({ kind: "forward" }); },
  reset(state = null) { hist.state = state; hist.calls.length = 0; },
};
Object.assign(globalThis, {
  document, Event, MouseEvent, history: hist,
  window: globalThis,
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
  matchMedia: (q) => ({ matches: q.includes("reduced-motion") && !MOTION, addEventListener() {} }),
  localStorage: storage(), sessionStorage: storage(),
  location: { hash: "#home", reload: () => reloads.push(1) },
  scrollTo: (o) => scrolls.push(o),
  addEventListener: (t, fn) => (winListeners[t] ??= []).push(fn),
  removeEventListener() {},
});
const fireWindow = (t) => { for (const fn of winListeners[t] ?? []) fn(new Event(t)); };

/* ── the module ────────────────────────────────────────────────────────── */
const home = await import("../../assets/js/home.js");
const data = await import("../../assets/js/data.js");
const law = await import("../../assets/js/law.js");
const { households, inbox, today, account } = data;

/* the clock home.js's timers run on: advance(ms) runs what falls due, in order */
let now = 0, seq = 0;
const timers = new Map();
globalThis.setTimeout = (fn, ms = 0) => { const id = ++seq; timers.set(id, { at: now + ms, fn, id }); return id; };
globalThis.clearTimeout = (id) => timers.delete(id);
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 16);
const advance = (ms) => {
  const end = now + ms;
  for (;;) {
    const next = [...timers.values()].filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
    if (!next) break;
    timers.delete(next.id); now = next.at; next.fn();
  }
  now = end;
};
/* ids are the clock in base 36: give each a moment of its own */
let tick = Date.UTC(2026, 0, 1);
Date.now = () => (tick += 1000);

/* events a visitor makes */
const fire = (el, t, init = {}) => el.dispatchEvent(new (t.startsWith("pointer") || t === "click" || t === "mousedown" ? MouseEvent : Event)(t, { bubbles: !["focus", "blur", "pointerenter", "pointerleave"].includes(t), ...init }));
const key = (el, k) => fire(el, "keydown", { key: k });
const docKey = (k) => { for (const fn of document.listeners.keydown ?? []) fn(new Event("keydown", { key: k })); };

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const willow = households.willow;
const activeOf = (h) => h.items.filter((it) => it.status === "active");
const saved = () => JSON.parse(localStorage.getItem("orbit-site-state") ?? "null");

$("#hero")._rect = { left: 0, top: 0, width: 1280, height: 800 };
$("#dialwrap")._rect = { left: 320, top: 100, width: 640, height: 640 };
$("#body-callout")._rect = { left: 0, top: 0, width: 200, height: 60 };
const skyCams = { far: new Element("g"), near: new Element("g") };
const changes = [];
home.onChange(() => changes.push(home.state.camera));

home.mountHome(skyCams);

if (MOTION) {
  home.openRow("i-boiler", true);
  const sc = $('.item[data-id="i-boiler"]').scrolled;
  check("with motion, an opened row is scrolled to smoothly", sc.length === 1 && sc[0].behavior === "smooth", `scrolled ${show(sc)}`);
  const hero = $("#hero");
  home.flyTo("seaside");
  advance(1249);
  check("with motion, a flight has not landed at 1249 ms", home.state.camera === "willow" && hero.classList.contains("flying"), `camera ${home.state.camera}`);
  advance(1);
  check("with motion, it lands at 1250 ms", home.state.camera === "seaside" && hero.classList.contains("arriving"), `camera ${home.state.camera}, hero ${hero.className}`);
  advance(899);
  check("with motion, it is still arriving 899 ms after landing", hero.classList.contains("flying") && home.state.flying, `hero ${hero.className}`);
  advance(1);
  check("with motion, the flight ends 900 ms after landing", !hero.classList.contains("flying") && !home.state.flying, `hero ${hero.className}`);
  process.exit(failed ? 1 : 0);
}

/* ── what mountHome draws ──────────────────────────────────────────────── */
check("the camera starts on your household, the sky at its place", skyCams.far.style.transform === "translate(0px,0px)" && skyCams.near.style.transform === "translate(0px,0px)", `far ${skyCams.far.style.transform}, near ${skyCams.near.style.transform}`);
check("the account orb, name and relay are the account's", $("#account-orb").textContent === account.initials && $("#who-name").textContent === account.name && $("#relay-addr").textContent === account.relay, `${show([$("#account-orb").textContent, $("#who-name").textContent, $("#relay-addr").textContent])}`);

{
  const months = $$("#dial .months text").map((t) => t.textContent);
  const want = Array.from({ length: 12 }, (_, i) => law.MONTHS[(today.getMonth() + i) % 12]);
  check("the dial's month ring starts at this month and goes round the year", show(months) === show(want), `got ${show(months)} (want ${show(want)})`);
  check("only this month is marked now", $$("#dial .months .now-month").length === 1 && $$("#dial .months text")[0].classList.contains("now-month"), `${$$("#dial .months .now-month").length} marked`);
  check("the sun is labelled with the household", $("#dial-name").textContent === willow.name && $("#dial .sun-link").getAttribute("aria-label") === `${willow.name}, this household`, `name ${show($("#dial-name").textContent)}`);

  const links = $$("#dial .body-link");
  const sugg = links.filter((l) => l.dataset.suggestion === "1");
  const want7 = activeOf(willow).length + inbox.review.filter((r) => r.household === "willow").length;
  check("a body per active item and per suggestion", links.length === want7 && sugg.length === 1, `${links.length} bodies, ${sugg.length} suggestion(s) (want ${want7}, 1)`);
  const gutter = links.find((l) => l.dataset.id === "i-gutter");
  check("a body's link names the item and its T-minus", gutter?.getAttribute("aria-label") === "Gutter clearing, T+16d" && gutter.getAttribute("href") === "#i-gutter", `label ${show(gutter?.getAttribute("aria-label"))}`);
  check("the suggestion is drawn dashed in the accent, not painted", sugg[0]?.querySelector("circle")?.getAttribute("stroke-dasharray") === "3 2.5", `dash ${show(sugg[0]?.querySelector("circle")?.getAttribute("stroke-dasharray"))}`);
  const near = activeOf(willow).filter((it) => Math.abs(it.days) <= 60).length;
  check("a trail behind each item within 60 days", $$("#dial .trails path").length === near, `${$$("#dial .trails path").length} trails (want ${near})`);
  check("a ping for each overdue item", $$("#dial .pings .ping").length === 1, `${$$("#dial .pings .ping").length} pings (want 1: the gutters)`);
  check("a belt for each item with documents", $$("#dial .belts .belt").length === 2, `${$$("#dial .belts .belt").length} belts (want 2)`);
  check("the overdue and due-soon bodies breathe", $$("#dial .bodies g.breathe").length === 3, `${$$("#dial .bodies g.breathe").length} breathing (want 3: gutters, MOT, boiler)`);
  const mot = links.find((l) => l.dataset.id === "i-mot");
  check("an inspection's body is half in shadow", mot?.querySelectorAll("path").length === 1, `${mot?.querySelectorAll("path").length} shadow path(s) (want 1)`);
  check("the sun is drawn over the bodies (last in the dial)", $("#dial").lastElementChild === $("#dial .sun-link"), `last child ${$("#dial").lastElementChild?.className}`);
}

{
  const corridor = $("#corridor");
  const red = $$("#corridor .redzone .item").map((r) => r.dataset.id);
  check("the overdue item is in the red zone, before today", show(red) === show(["i-gutter"]) && corridor.children[0].className === "redzone" && corridor.children[1].id === "today", `red zone ${show(red)}, then ${corridor.children[1]?.id}`);
  check("today's row names today", $("#today").textContent.includes(law.todayWords(today)), `today ${show($("#today").textContent)}`);
  const order = $$("#corridor .item").map((r) => r.dataset.id);
  const ahead = [...activeOf(willow).filter((it) => it.days >= 0).map((it) => [it.id, it.days]), ["r-insurance", 51]].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  check("ahead of today the items and the suggestion run soonest first", show(order.slice(1)) === show(ahead), `got ${show(order.slice(1))} (want ${show(ahead)})`);
  const monthsWant = new Map();
  for (const days of [...activeOf(willow).filter((x) => x.days >= 0).map((x) => x.days), 51].sort((a, b) => a - b)) {
    const d = law.addDays(today, days); const k = `${d.getFullYear()}-${d.getMonth()}`; monthsWant.set(k, (monthsWant.get(k) ?? 0) + 1);
  }
  monthsWant.delete(`${today.getFullYear()}-${today.getMonth()}`);
  const heads = $$("#corridor .month").map((m) => m.querySelector("small").textContent);
  const NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const names = $$("#corridor .month").map((m) => m.querySelector("span").textContent);
  const namesWant = [...monthsWant.keys()].map((k) => NAMES[Number(k.split("-")[1])]);
  check("each month heading names its month", show(names) === show(namesWant), `got ${show(names)} (want ${show(namesWant)})`);
  check("a heading for each later month, counting what approaches in it", show(heads) === show([...monthsWant.values()].map((n) => `${n} approaching`)), `got ${show(heads)} (want ${show([...monthsWant.values()].map((n) => `${n} approaching`))})`);
  const lastDue = law.longDate(law.addDays(today, Math.max(...activeOf(willow).map((it) => it.days)))).split(" ")[1];
  check("the horizon names the last month scheduled", $("#horizon").textContent === `— beyond the horizon: nothing scheduled past ${lastDue} —`, `got ${show($("#horizon").textContent)}`);
  const boilerRow = $('.item[data-id="i-boiler"]');
  check("a row says its section, period, provider and cost", boilerRow?.querySelector(".body span")?.textContent === "Home · orbital period year · Warm & Co. · ~£120.00", `got ${show(boilerRow?.querySelector(".body span")?.textContent)}`);
  const sRow = $('.item.suggest[data-id="r-insurance"]');
  check("the suggestion's row offers to add or dismiss", sRow?.querySelector("button.yes")?.textContent === "Add to orbit" && sRow?.querySelector("button.no")?.textContent === "Dismiss", `buttons ${show(sRow?.querySelectorAll("button").map((b) => b.textContent))}`);
}

{
  const nodes = $$("#galaxy .minisys");
  const others = Object.values(households).filter((h) => h.id !== "willow");
  check("one mini system per other household", show(nodes.map((n) => n.dataset.id)) === show(others.map((h) => h.id)), `got ${show(nodes.map((n) => n.dataset.id))}`);
  const kept = nodes.every((n) => Math.abs(Number(n.dataset.dx)) <= 1280 / 2 - 110 && Math.abs(Number(n.dataset.dy)) <= 800 / 2 - 90);
  check("every mini system is kept on the sky", kept, nodes.map((n) => `${n.dataset.id} ${n.dataset.dx},${n.dataset.dy}`).join("; "));
  const labels = nodes.map((n) => n.querySelector("text.mslabel")?.textContent);
  check("each is labelled with its household", show(labels) === show(others.map((h) => h.name)), `got ${show(labels)}`);
  const chips = $$("#chips button").map((b) => b.textContent);
  check("a chip per other household", show(chips) === show(others.map((h) => h.name)), `got ${show(chips)}`);
}

{
  const orb = $("#inbox-orb");
  check("the inbox orb counts what waits for review", orb.querySelector(".count").textContent === "1" && orb.classList.contains("waiting") && orb.getAttribute("aria-label") === "Inbox — 1 waiting", `count ${orb.querySelector(".count").textContent}, waiting ${orb.classList.contains("waiting")}`);
  const lanes = $$("#lanes .lane").map((l) => [l.className.replace("lane ", ""), l.querySelectorAll(".receipt").length]);
  check("four lanes, each with its receipts", show(lanes) === show([["filed", 1], ["review", 1], ["reading", 1], ["failed", 2]]), `got ${show(lanes)}`);
  const review = $("#lanes .lane.review .receipt");
  check("a review receipt shows its readings, sure or not, and when it burns up", review?.querySelectorAll("i.sure").length === 3 && review.querySelectorAll("i.unsure").length === 1 && review.textContent.includes("in 43d"), `${review?.querySelectorAll("i.sure").length} readings, ${review?.querySelectorAll("i.unsure").length} unsure`);
}

/* ── opening an item ───────────────────────────────────────────────────── */
{
  const link = $('#dial .body-link[data-id="i-boiler"]');
  fire(link, "pointerdown", { pointerType: "mouse" });
  fire(link, "click");
  const row = $('.item[data-id="i-boiler"]');
  const view = row.nextElementSibling;
  check("a click on a body opens its row", row.classList.contains("open") && row.getAttribute("aria-expanded") === "true" && home.state.open === "i-boiler", `open ${row.classList.contains("open")}, state.open ${home.state.open}`);
  check("the open row shows the item's details after it", view?.id === "i-boiler-view" && view.textContent.includes("Warm & Co.") && view.textContent.includes("every year"), `view ${view?.id}: ${show(view?.textContent.slice(0, 80))}`);
  check("its body is lit, and only its", $$("#dial .body-link.lit").map((b) => b.dataset.id).join() === "i-boiler", `lit ${$$("#dial .body-link.lit").map((b) => b.dataset.id)}`);
  check("opened from the dial, the row is scrolled to", row.scrolled.length === 1 && row.scrolled[0].block === "center", `scrolled ${show(row.scrolled)}`);
  row.click();
  check("a click on the open row closes it", !row.classList.contains("open") && !$(".itemview") && home.state.open === null && !$("#dial .body-link.lit"), `open ${row.classList.contains("open")}, views ${$$(".itemview").length}`);
  key($('.item[data-id="i-mot"]'), "Enter");
  check("Enter on a row opens it, with its documents", $('.item[data-id="i-mot"]').classList.contains("open") && $$(".itemview .doc").length === 2, `open ${$('.item[data-id="i-mot"]').classList.contains("open")}, ${$$(".itemview .doc").length} documents`);
  home.openRow("r-insurance");
  check("a suggestion's row does not open", !$(".item.open") && home.state.open === null, `open rows ${$$(".item.open").length}`);
  home.openRow("no-such-item");
  check("an unknown id opens nothing", !$(".item.open"), `open rows ${$$(".item.open").length}`);
}

/* ── the body callout ──────────────────────────────────────────────────── */
{
  const c = $("#body-callout");
  const link = $('#dial .body-link[data-id="i-mot"]');
  link._rect = { left: 500, top: 300, width: 20, height: 20 };
  fire(link, "pointerenter", { pointerType: "mouse" });
  check("hovering a body shows its callout", c.classList.contains("show") && c.querySelector("b").textContent === "Car MOT — Volvo V60", `show ${c.classList.contains("show")}, title ${show(c.querySelector("b").textContent)}`);
  check("the callout gives T-minus, cost and documents", c.querySelector("small").textContent === `${law.tminus(16)} · ${law.money(5485, false)} · 2 documents`, `got ${show(c.querySelector("small").textContent)}`);
  check("a body on the left half has its callout to the right", c.classList.contains("side-right") && c.style.left === `${520 + 30}px`, `classes ${c.className}, left ${c.style.left}`);
  fire(link, "pointerleave", { pointerType: "mouse" });
  check("leaving the body hides it", !c.classList.contains("show"), `classes ${c.className}`);
  link._rect = { left: 900, top: 300, width: 20, height: 20 };
  fire(link, "focus");
  check("focus on a body on the right half shows it to the left", c.classList.contains("show") && c.classList.contains("side-left") && c.style.left === `${900 - 30 - 200}px`, `classes ${c.className}, left ${c.style.left}`);
  fire(link, "blur");
  check("blur hides it", !c.classList.contains("show"), `classes ${c.className}`);

  /* a phone: no room beside it, so below it, or above when there is no room below */
  globalThis.innerWidth = 260;
  link._rect = { left: 120, top: 100, width: 20, height: 20 };
  fire(link, "pointerenter", { pointerType: "mouse" });
  check("on a narrow screen the callout drops below the body", c.classList.contains("side-below") && c.style.top === "150px" && c.style.left === "30px" && c.style.getPropertyValue("--tail") === "100px", `classes ${c.className}, left ${c.style.left}, top ${c.style.top}, tail ${c.style.getPropertyValue("--tail")} (want 30px, 150px, 100px: centred under the body, the tail at its middle)`);
  link._rect = { left: 120, top: 700, width: 20, height: 20 };
  fire(link, "pointerenter", { pointerType: "mouse" });
  check("with no room below it rises above", c.classList.contains("side-above") && c.style.top === `${700 - 30 - 60}px`, `classes ${c.className}, top ${c.style.top}`);
  globalThis.innerWidth = 1280;
  docKey("Escape");
  check("Escape hides the callout", !c.classList.contains("show"), `classes ${c.className}`);

  const sugg = $('#dial .body-link[data-id="r-insurance"]');
  sugg._rect = { left: 500, top: 300, width: 20, height: 20 };
  fire(sugg, "pointerenter", { pointerType: "mouse" });
  check("a suggestion's callout says it is suggested", c.querySelector("small").textContent === "suggested · renews in 51d · ~£400.00", `got ${show(c.querySelector("small").textContent)}`);
  fire(sugg, "pointerleave", { pointerType: "mouse" });

  /* touch: the first tap shows the callout, the second opens */
  const boiler = $('#dial .body-link[data-id="i-boiler"]');
  boiler._rect = { left: 500, top: 300, width: 20, height: 20 };
  fire(boiler, "pointerenter", { pointerType: "touch" });
  check("a touch does not show the callout on enter", !c.classList.contains("show"), `classes ${c.className}`);
  fire(boiler, "pointerdown", { pointerType: "touch" });
  fire(boiler, "click");
  check("the first tap shows the callout, armed, and opens nothing", c.classList.contains("show") && c.classList.contains("tap") && !$(".item.open"), `classes ${c.className}, open ${$$(".item.open").length}`);
  fire(boiler, "blur");
  check("blur leaves an armed callout up", c.classList.contains("show"), `classes ${c.className}`);
  fire(boiler, "click");
  check("the second tap opens the item and lets the callout go", $('.item[data-id="i-boiler"]').classList.contains("open") && !c.classList.contains("show"), `open ${$('.item[data-id="i-boiler"]').classList.contains("open")}, callout ${c.className}`);
  home.closeRow();
  fire(boiler, "click");
  c.onclick?.();
  check("a tap on the armed callout opens the item", $('.item[data-id="i-boiler"]').classList.contains("open") && !c.classList.contains("show"), `open ${$('.item[data-id="i-boiler"]').classList.contains("open")}`);
  home.closeRow();
  fire(boiler, "click");
  fire($("#horizon"), "pointerdown");
  check("a tap elsewhere lets an armed callout go", !c.classList.contains("show"), `classes ${c.className}`);
  fire(boiler, "click");
  fire(c, "pointerdown");
  check("a tap on the callout itself keeps it", c.classList.contains("show"), `classes ${c.className}`);
  fireWindow("scroll");
  check("a scroll lets an armed callout go", !c.classList.contains("show"), `classes ${c.className}`);
}

/* ── complete and snooze ───────────────────────────────────────────────── */
{
  changes.length = 0;
  const gutter = willow.items.find((it) => it.id === "i-gutter");
  const bodyAt = (id) => { const b = $(`#dial .body-link[data-id="${id}"] circle`); return b ? [b.getAttribute("cx"), b.getAttribute("cy")] : null; };
  const wasAt = bodyAt("i-gutter");
  home.complete("i-gutter");
  /* due 16 days ago, every year: next due a year after that date (16 days back first, then a year on,
     so a 29 February between the two is counted as the code's calendar counts it) */
  const back = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 16);
  const want = new Date(back.getFullYear() + 1, back.getMonth(), back.getDate());
  check("completing a repeat moves it on by its period, past today", law.daysBetween(want, gutter.dueDate) === 0 && gutter.days > 0, `due ${data.ymd(gutter.dueDate)} (want ${data.ymd(want)}), days ${gutter.days}`);
  check("it is no longer overdue: the red zone is gone", !$("#corridor .redzone") && $$("#dial .pings .ping").length === 0, `red zones ${$$("#corridor .redzone").length}, pings ${$$("#dial .pings .ping").length}`);
  const view = $("#i-gutter-view");
  check("its row reopens: completed today, and complete is off", !!view && view.textContent.includes("completed today") && view.querySelector('[data-act="complete"]').disabled, `view ${show(view?.textContent.slice(0, 120))}`);
  const comet = $("#dial line.comet"), nowAt = bodyAt("i-gutter");
  const ends = comet ? ["x1", "y1", "x2", "y2"].map((k) => comet.getAttribute(k)) : null;
  check("a comet flies from where it was to where it goes", $$("#dial line.comet").length === 1 && show(ends) === show([...wasAt, ...nowAt]), `ends ${show(ends)} (want from ${show(wasAt)} to ${show(nowAt)})`);
  check("the row lists its reminders", view?.textContent.includes("reminders14d before · 3d before"), show(view?.textContent));
  advance(20);
  check("the comet takes flight on the next frame", $("#dial line.comet")?.classList.contains("fly"), `classes ${$("#dial line.comet")?.className}`);
  advance(1700);
  check("the comet is gone after its flight", $$("#dial line.comet").length === 0, `${$$("#dial line.comet").length} comet(s)`);
  check("the change is saved", saved()?.households?.willow?.find((it) => it.id === "i-gutter")?.dueDate === data.ymd(gutter.dueDate) && changes.length === 1, `saved ${saved()?.households?.willow?.find((it) => it.id === "i-gutter")?.dueDate}, ${changes.length} change(s) heard`);
  const due = gutter.dueDate;
  home.complete("i-gutter");
  check("a second complete the same day changes nothing", gutter.dueDate === due && changes.length === 1, `due ${data.ymd(gutter.dueDate)}, ${changes.length} change(s)`);
  view.querySelector('[data-act="snooze"]').click();
  check("snooze from the row: a date further than a week stays, marked snoozed", gutter.dueDate === due && gutter.snoozed === true && $("#i-gutter-view")?.textContent.includes("snoozed a week"), `due ${data.ymd(gutter.dueDate)}, snoozed ${gutter.snoozed}`);

  const mot = willow.items.find((it) => it.id === "i-mot");
  mot.dueDate = law.addDays(today, 3);
  home.snooze("i-mot");
  check("snooze puts a date sooner than a week out to a week from today", law.daysBetween(today, mot.dueDate) === 7 && mot.days === 7 && $('.item[data-id="i-mot"]').classList.contains("open"), `days ${mot.days}`);
  check("snoozed, the row says so and snooze is off", $("#i-mot-view").textContent.includes("a week, from the last reminder") && $("#i-mot-view").querySelector('[data-act="snooze"]').disabled, show($("#i-mot-view").textContent.slice(0, 120)));
  const n = changes.length;
  home.snooze("i-mot");
  check("a second snooze changes nothing", mot.days === 7 && changes.length === n, `days ${mot.days}, ${changes.length - n} change(s)`);
  home.snooze("no-such-item"); home.complete("no-such-item");
  check("an unknown id changes nothing", changes.length === n, `${changes.length - n} change(s)`);

  const once = home.addItem({ title: "Chimney liner fitting", recurrenceMonths: 0, dueDate: law.addDays(today, 10) });
  check("an added item takes the defaults: home, service, active", once.section === "home" && once.kind === "service" && once.status === "active" && once.days === 10, show({ section: once.section, kind: once.kind, days: once.days }));
  check("an added item lands on the dial", $(`#dial .body-link[data-id="${once.id}"]`)?.classList.contains("landing"), `link ${!!$(`#dial .body-link[data-id="${once.id}"]`)}`);
  home.openRow(once.id);
  check("a one-off says it does not come round", $(`#${once.id}-view`)?.textContent.includes("one-off — does not come round"), show($(`#${once.id}-view`)?.textContent.slice(-60)));
  const onceAt = bodyAt(once.id);
  home.complete(once.id);
  const onceComet = $("#dial line.comet");
  check("a finished one-off's comet flies straight up to the top", !!onceComet && onceComet.getAttribute("x2") === onceAt[0] && onceComet.getAttribute("y2") === "20" && onceComet.getAttribute("x1") === onceAt[0] && onceComet.getAttribute("y1") === onceAt[1], `ends ${show(onceComet && ["x1", "y1", "x2", "y2"].map((k) => onceComet.getAttribute(k)))} (want from ${show(onceAt)} to x ${onceAt[0]}, y 20)`);
  check("completing a one-off ends it: off the dial and the manifest", once.status === "done" && !$(`#dial .body-link[data-id="${once.id}"]`) && !$(`.item[data-id="${once.id}"]`), `status ${once.status}`);
  advance(2000);

  /* a snoozed repeat, completed, is not snoozed any more */
  home.snooze("i-boiler");
  home.complete("i-boiler");
  const boiler = willow.items.find((it) => it.id === "i-boiler");
  const bv = $("#i-boiler-view");
  check("completing a snoozed repeat takes the snooze off", boiler.snoozed === false && !bv.querySelector('[data-act="snooze"]').disabled && bv.querySelector('[data-act="snooze"]').textContent === "snooze a week" && !bv.textContent.includes("a week, from the last reminder"), `snoozed ${boiler.snoozed}, button ${show(bv.querySelector('[data-act="snooze"]').textContent)}`);
  advance(2000);

  /* a repeat more than one period behind comes round as many times as it takes to be ahead of today */
  const Y = today.getFullYear(), M = today.getMonth();
  const late = home.addItem({ title: "Septic check", recurrenceMonths: 12, dueDate: new Date(Y, M - 25, 1) });
  home.complete(late.id);
  check("a repeat two periods behind is moved past today", data.ymd(late.dueDate) === data.ymd(new Date(Y, M + 11, 1)), `due ${data.ymd(late.dueDate)} (want ${data.ymd(new Date(Y, M + 11, 1))}: the first of the month 25 months back, plus three years)`);
  advance(2000);

  /* a completion on an earlier day reads as its date; restoreState saves what it restored */
  const snap = data.serialise();
  snap.households.willow.find((it) => it.id === "i-chimney").completedOn = "2026-01-15";
  localStorage.removeItem("orbit-site-state");
  home.restoreState(snap);
  home.openRow("i-chimney");
  check("an earlier completion is shown by its date", $("#i-chimney-view")?.textContent.includes("last completed15 January 2026") && !$('#i-chimney-view [data-act="complete"]').disabled, show($("#i-chimney-view")?.textContent));
  check("restoreState saves what it restored", saved()?.households?.willow?.find((it) => it.id === "i-chimney")?.completedOn === "2026-01-15", `saved ${show(saved()?.households?.willow?.find((it) => it.id === "i-chimney"))}`);
  home.closeRow();
}

/* ── a suggestion takes two taps ───────────────────────────────────────── */
{
  home.restorePristine();
  check("restorePristine puts the sample back", willow.items.find((it) => it.id === "i-gutter").days === -16 && $$("#dial .body-link").length === 7, `gutters ${willow.items.find((it) => it.id === "i-gutter").days}d, ${$$("#dial .body-link").length} bodies`);
  const row = () => $('.item.suggest[data-id="r-insurance"]');
  row().querySelector("button.yes").click();
  check("the first tap on add arms it and adds nothing", row()?.querySelector("button.yes").textContent === "tap again to add" && row()?.querySelector("button.yes").classList.contains("armed") && inbox.review.length === 1, `yes ${show(row()?.querySelector("button.yes").textContent)}`);
  row()?.querySelector("button.no").click();
  check("a tap on dismiss moves the arming to it", row()?.querySelector("button.no").textContent === "tap again to dismiss" && row()?.querySelector("button.yes").textContent === "Add to orbit", `yes ${show(row()?.querySelector("button.yes").textContent)}, no ${show(row()?.querySelector("button.no").textContent)}`);
  advance(3900);
  check("3.9 seconds on, dismiss is still armed", row()?.querySelector("button.no").textContent === "tap again to dismiss", `no ${show(row()?.querySelector("button.no").textContent)}`);
  advance(200);
  check("after four seconds the arming lapses", row()?.querySelector("button.no").textContent === "Dismiss" && !row()?.querySelector("button.no").classList.contains("armed"), `no ${show(row()?.querySelector("button.no").textContent)}`);
  const count = willow.items.length;
  row()?.querySelector("button.yes").click(); row()?.querySelector("button.yes").click();
  const added = willow.items[willow.items.length - 1];
  check("two taps add it to the household, with its provider and document", willow.items.length === count + 1 && added.title === "Home insurance renewal" && added.provider === "Harbour Mutual" && added.documents[0]?.name === "policy-schedule.pdf" && added.days === 51, show({ n: willow.items.length - count, title: added.title, provider: added.provider, doc: added.documents[0]?.name, days: added.days }));
  const markOf = (id) => $$(`#dial .body-link[data-id="${id}"] circle`).filter((c) => c.getAttribute("fill") === "var(--panel-raised)").length;
  check("a renewal's body carries the renewal mark, a service's does not", markOf(added.id) === 1 && markOf("i-boiler") === 0, `renewal ${markOf(added.id)}, service ${markOf("i-boiler")} (want 1, 0)`);
  check("it leaves the review: no suggestion row, the orb counts none", inbox.review.length === 0 && !row() && $("#inbox-orb .count").textContent === "0" && !$("#inbox-orb").classList.contains("waiting"), `review ${inbox.review.length}, count ${$("#inbox-orb .count").textContent}`);
  check("the review lane says nothing is there", $("#lanes .lane.review")?.textContent.includes("nothing here"), show($("#lanes .lane.review")?.textContent));
  check("accepting what is not waiting gives nothing", home.acceptSuggestion("r-insurance") === null, "null");

  home.restorePristine();
  check("restorePristine brings the suggestion back and takes the added item away", inbox.review.length === 1 && willow.items.length === count && !!row(), `review ${inbox.review.length}, items ${willow.items.length}`);
  const receipt = $("#lanes .lane.review .receipt");
  receipt.querySelector("button.no").click(); receipt.querySelector("button.no").click();
  check("two taps on dismiss in the inbox drop it and add nothing", inbox.review.length === 0 && willow.items.length === count && !$('#dial .body-link[data-suggestion="1"]'), `review ${inbox.review.length}, items ${willow.items.length}`);
  home.restorePristine();
}

/* ── something that ends is never overdue; an empty household ──────────── */
{
  const ended = home.addItem({ title: "Passport", kind: "expiry", recurrenceMonths: 0, dueDate: law.addDays(today, -5) });
  const red = $$("#corridor .redzone .item").map((r) => r.dataset.id);
  const rows = $$(`#corridor .item[data-id="${ended.id}"]`);
  const kids = $("#corridor").children;
  check("an expiry past its date is not in the red zone", show(red) === show(["i-gutter"]), `red zone ${show(red)} (want only the gutters)`);
  check("it is shown once, after today", rows.length === 1 && kids.indexOf(rows[0]) > kids.indexOf($("#today")), `${rows.length} row(s), at ${kids.indexOf(rows[0])}, today at ${kids.indexOf($("#today"))}`);
  check("it gets no overdue ping", $$("#dial .pings .ping").length === 1, `${$$("#dial .pings .ping").length} pings (want 1: the gutters)`);
  home.restorePristine();

  const snap = data.serialise();
  snap.households.grans = [];
  home.restoreState({ ...snap, camera: "grans" });
  check("a household with nothing in it says so at the horizon", $("#horizon").textContent === "— nothing in orbit yet —", `got ${show($("#horizon").textContent)}`);
  home.restorePristine();
  home.restoreState({ ...data.serialise(), camera: "willow" });
}

/* ── the create form ───────────────────────────────────────────────────── */
{
  check("the form's date may not be before today", $("#f-date").min === data.ymd(today), `min ${$("#f-date").min}`);
  $("#nstar").click();
  check("the north star opens the create drawer", $("#createdrawer").classList.contains("open") && $("#nstar").getAttribute("aria-expanded") === "true" && $("#scrim").classList.contains("on"), `drawer ${$("#createdrawer").className}`);
  advance(400);
  check("the name field takes focus as it opens", document.activeElement === $("#f-name"), `focus on ${document.activeElement?.id}`);
  const count = willow.items.length;
  $("#f-name").blur();
  fire($("#createform"), "submit");
  check("a form with no name adds nothing", willow.items.length === count && document.activeElement === $("#f-name"), `${willow.items.length - count} added`);

  $('#types button[data-type="renewal"]').click();
  check("choosing a type presses it alone", $$("#types button").filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.type).join() === "renewal", $$("#types button").map((b) => `${b.dataset.type}:${b.getAttribute("aria-pressed")}`).join(" "));
  $("#f-name").value = "  Water softener contract  ";
  $("#f-section").value = "devices";
  $("#f-date").value = data.ymd(law.addDays(today, 40));
  $("#f-cost").value = "12.5";
  $("#f-recur").value = "6";
  const snap = home.snapshot();
  check("a snapshot holds the camera and the form as typed", snap.camera === "willow" && snap.form.kind === "renewal" && snap.form.fields.some(([id, v]) => id === "f-cost" && v === "12.5"), show({ camera: snap.camera, kind: snap.form?.kind }));

  fire($("#createform"), "submit");
  const it = willow.items[willow.items.length - 1];
  check("submitting adds the item as typed", willow.items.length === count + 1 && it.title === "Water softener contract" && it.kind === "renewal" && it.section === "devices" && it.recurrenceMonths === 6 && it.costMinor === 1250 && it.days === 40, show({ title: it.title, kind: it.kind, section: it.section, recur: it.recurrenceMonths, cost: it.costMinor, days: it.days }));
  check("the form is reset and the drawer closes", $("#f-name").value === "" && $("#f-cost").value === "" && $('#types button[data-type="service"]').getAttribute("aria-pressed") === "true" && !$("#createdrawer").classList.contains("open") && !$("#scrim").classList.contains("on"), `name ${show($("#f-name").value)}, drawer ${$("#createdrawer").className}`);
  advance(500);
  check("its row opens once the drawer has gone", $(`.item[data-id="${it.id}"]`)?.classList.contains("open"), `open ${$(`.item[data-id="${it.id}"]`)?.classList.contains("open")}`);

  $("#f-name").value = "Bike service"; $("#f-cost").value = "about forty"; $("#f-date").value = "20255-01-01";
  fire($("#createform"), "submit");
  const bike = willow.items[willow.items.length - 1];
  check("a cost that is not a number is no cost; a date that is not one is 30 days out", bike.title === "Bike service" && bike.costMinor === null && bike.days === 30 && bike.kind === "service", show({ title: bike.title, cost: bike.costMinor, days: bike.days, kind: bike.kind }));
  advance(500);

  /* the snapshot written back: the form as it was, its type pressed */
  home.restoreState(snap);
  check("restoreState writes the form back, its type pressed", $("#f-cost").value === "12.5" && $("#f-section").value === "devices" && $('#types button[data-type="renewal"]').getAttribute("aria-pressed") === "true", `cost ${show($("#f-cost").value)}, renewal ${$('#types button[data-type="renewal"]').getAttribute("aria-pressed")}`);
  check("restoreState puts the items back as they were", willow.items.length === count && !willow.items.some((x) => x.title === "Bike service"), `items ${willow.items.length} (want ${count})`);
  $("#createform").reset();
  home.restorePristine();
}

/* ── the explore field ─────────────────────────────────────────────────── */
{
  const input = $("#explore"), pal = $("#palette");
  input.focus();
  const listed = () => pal.querySelectorAll("button:not(.act)").map((b) => b.querySelector("b").textContent);
  check("focus opens the palette: the first five items, and a way to add", pal.classList.contains("open") && listed().length === 5 && pal.querySelector("button.act")?.textContent === "→ add an item", `listed ${show(listed())}`);
  input.value = "BOIL"; fire(input, "input");
  check("typing narrows to the items that match, whatever the case", show(listed()) === show(["Boiler service"]), `listed ${show(listed())}`);
  input.value = "zzz"; fire(input, "input");
  check("no match says so", listed().length === 0 && pal.querySelector(".none")?.textContent === "nothing in this orbit matches", `listed ${show(listed())}, ${show(pal.querySelector(".none")?.textContent)}`);
  input.value = "sweep"; fire(input, "input");
  key(input, "Enter");
  check("Enter opens the first match and leaves the field", $('.item[data-id="i-chimney"]').classList.contains("open") && document.activeElement !== input, `open ${$('.item[data-id="i-chimney"]').classList.contains("open")}`);
  advance(200);
  check("the palette closes after the field is left", !pal.classList.contains("open"), `classes ${pal.className}`);
  input.focus();
  fire(pal.querySelector("button.act"), "mousedown");
  check("\"add an item\" opens the create drawer", $("#createdrawer").classList.contains("open"), `drawer ${$("#createdrawer").className}`);
  $("#scrim").click();
  check("the scrim closes it", !$("#createdrawer").classList.contains("open"), `drawer ${$("#createdrawer").className}`);
  advance(500);
  home.closeRow();
}

/* ── drawers and the account menu ──────────────────────────────────────── */
{
  const open = (id) => $(`#${id}`).classList.contains("open");
  $("#inbox-orb").click();
  check("the inbox orb opens the inbox", open("inboxdrawer"), `inbox ${$("#inboxdrawer").className}`);
  $("#keydrawer .handle").click();
  check("a drawer's handle opens it and closes the others", open("keydrawer") && !open("inboxdrawer") && $("#keydrawer .handle").getAttribute("aria-expanded") === "true", `key ${open("keydrawer")}, inbox ${open("inboxdrawer")}`);
  $("#keydrawer .handle").click();
  check("the handle again closes it", !open("keydrawer") && $("#keydrawer .handle").getAttribute("aria-expanded") === "false", `key ${open("keydrawer")}`);
  $("#inbox-orb").click(); $("#inboxdrawer .close").click();
  check("a drawer's close button closes it", !open("inboxdrawer"), `inbox ${open("inboxdrawer")}`);
  $("#account-orb").click();
  check("the account orb opens the menu", open("account") && $("#account-orb").getAttribute("aria-expanded") === "true", `account ${$("#account").className}`);
  $('[data-open-drawer="installdrawer"]').click();
  check("a menu entry opens its drawer and closes the menu", open("installdrawer") && !open("account"), `install ${open("installdrawer")}, account ${open("account")}`);
  $("#account-orb").click();
  $("#horizon").click();
  check("a click elsewhere closes the menu", !open("account"), `account ${open("account")}`);
  $("#nstar").click(); $("#account-orb").click();
  docKey("Escape");
  check("Escape closes every drawer and the menu", !open("installdrawer") && !open("createdrawer") && !open("account") && $("#account-orb").getAttribute("aria-expanded") === "false", `install ${open("installdrawer")}, create ${open("createdrawer")}, account ${open("account")}`);
  advance(500);
  fire($("#dial .sun-link"), "click");
  check("the sun scrolls to today in the manifest", $("#today").scrolled.length === 1 && $("#today").scrolled[0].block === "start", `scrolled ${show($("#today").scrolled)}`);
}

/* ── flying to another household and back ──────────────────────────────── */
{
  const hero = $("#hero");
  const seaside = households.seaside;
  const node = $('.minisys[data-id="seaside"]');
  changes.length = 0;
  home.openRow("i-boiler");
  $$("#chips button").find((b) => b.textContent === seaside.name).click();
  check("a chip starts a flight toward its household", hero.classList.contains("flying") && node.classList.contains("target") && home.state.flying && hero.style.getPropertyValue("--flyx") === `${node.dataset.dx}px`, `hero ${hero.className}, --flyx ${hero.style.getPropertyValue("--flyx")} (want ${node.dataset.dx}px)`);
  check("the flight closes the open row and moves the sky", !$(".item.open") && skyCams.far.style.transform === `translate(${(-seaside.pos[0] * 0.18).toFixed(0)}px,${(-seaside.pos[1] * 0.18).toFixed(0)}px)`, `far ${skyCams.far.style.transform}`);
  /* (a flight asked for mid-flight is kept and flown when this one lands: H4 below, not here) */
  advance(50);
  check("it lands: the dial is the household's, the corner leads back to yours", home.state.camera === "seaside" && $("#dial-name").textContent === seaside.name && $("#back").textContent === "— your sky" && hero.classList.contains("arriving") && $("#dial").classList.contains("bloom"), `camera ${home.state.camera}, back ${show($("#back").textContent)}`);
  check("there, the other systems include yours, not its own", !$('.minisys[data-id="seaside"]') && !!$('.minisys[data-id="willow"]'), $$(".minisys").map((m) => m.dataset.id).join());
  advance(50);
  check("the flight ends and is saved", !hero.classList.contains("flying") && !home.state.flying && show(changes) === show(["seaside"]) && saved() !== null, `hero ${hero.className}, changes ${show(changes)}`);
  home.flyTo("seaside");
  check("a flight to where it is goes nowhere", !hero.classList.contains("flying"), `hero ${hero.className}`);

  let landed = 0;
  key($('.minisys[data-id="grans"] circle.hit'), "Enter");
  check("Enter on a mini system flies to it", home.state.flying && $('.minisys[data-id="grans"]').classList.contains("target"), `flying ${home.state.flying}`);
  home.cancelFlight();
  check("a cancelled flight stops where it is: nothing lands", !home.state.flying && !hero.classList.contains("flying") && home.state.camera === "seaside" && !$(".minisys.target"), `camera ${home.state.camera}`);
  advance(200);
  check("and its timers do not land it later", home.state.camera === "seaside", `camera ${home.state.camera}`);
  home.flyTo("grans", () => landed++);
  home.cancelFlight();
  check("a cancelled flight still says it is done", landed === 1, `done called ${landed} time(s)`);
  home.cancelFlight();
  check("cancelling with no flight does nothing", landed === 1, `done called ${landed} time(s)`);

  hist.reset();   /* no sky in the entry: the corner flies (with a sky in it, the corner is history.back(): H3) */
  $("#back").click();
  advance(100);
  check("the corner, away from home, flies back to yours", home.state.camera === "willow" && $("#back").textContent === "— the dawn", `camera ${home.state.camera}, back ${show($("#back").textContent)}`);
  $("#back").click();
  check("the corner at home with nothing to go back to scrolls to the top", scrolls.length === 1 && scrolls[0].top === 0, `scrolls ${show(scrolls)}`);
  let back = 0;
  home.onBackHome(() => back++);
  $("#back").click();
  check("the corner at home goes back to the dawn when there is one", back === 1 && scrolls.length === 1, `back ${back}, scrolls ${scrolls.length}`);

  /* restoreState onto another household, mid-flight: the flight stops, the camera is put there */
  const snap = { ...data.serialise(), camera: "narrow" };
  home.flyTo("mumdad");
  home.restoreState(snap);
  check("restoreState stops a flight and puts the camera where the snapshot was", !home.state.flying && home.state.camera === "narrow" && $("#dial-name").textContent === households.narrow.name && $("#back").textContent === "— your sky", `camera ${home.state.camera}, back ${show($("#back").textContent)}`);
  advance(200);
  check("the stopped flight does not land later", home.state.camera === "narrow", `camera ${home.state.camera}`);
  home.restoreState({ ...data.serialise(), camera: "willow" });
  check("restoreState back home says the corner leads to the dawn", home.state.camera === "willow" && $("#back").textContent === "— the dawn", `camera ${home.state.camera}`);
}

/* ── #117 (ADR-0006): the entries a visit makes, H1-H5 ───────────────────────────────────────────────── */
{
  const hero = $("#hero");
  const chipOf = (id) => $$("#chips button").find((b) => b.textContent === households[id].name);
  const hitOf = (id) => $(`.minisys[data-id="${id}"] circle.hit`);
  const kinds = (k) => hist.calls.filter((c) => c.kind === k);
  const flyingNow = () => hero.classList.contains("flying") && home.state.flying;
  const calls = () => show(hist.calls);
  /* each case starts with the camera put where it needs, so one that fails does not fail the next (restoreState is the walk's way: no entry) */
  const at = (id, state = null) => { home.cancelFlight(); home.restoreState({ ...data.serialise(), camera: id }); advance(200); hist.reset(state); };
  at("willow");

  /* H1: a click on another household from the visitor's own sky is one entry, with that sky in its state */
  hist.reset({ orbit: 1 });
  fire(hitOf("seaside"), "click");
  check("H1 a click on another household's mini system pushes one entry with that sky, the address argument undefined", kinds("push").length === 1 && hist.calls.length === 1 && kinds("push")[0].state?.sky === "seaside" && kinds("push")[0].url === undefined, `calls ${calls()}`);
  advance(200);
  check("H1 and the flight went on to it", home.state.camera === "seaside", `camera ${home.state.camera}`);
  at("seaside", { orbit: 1, sky: "seaside" });
  home.flyTo("willow");
  advance(200);
  check("H1 control: flyTo called by script (the walk's way) pushes nothing, and flies", home.state.camera === "willow" && hist.calls.length === 0, `camera ${home.state.camera}, calls ${calls()}`);
  at("willow", { orbit: 1 });
  chipOf("grans").click();
  check("H1 a chip pushes one entry with that sky, the address argument undefined", kinds("push").length === 1 && hist.calls.length === 1 && kinds("push")[0].state?.sky === "grans" && kinds("push")[0].url === undefined, `calls ${calls()}`);
  advance(200);

  /* H2: from another's sky, a click on a third replaces the entry: no push, sky the third, orbit kept */
  at("grans", { orbit: 1, sky: "grans" });
  chipOf("seaside").click();
  check("H2 a click on a third household replaces the entry: no push, the sky the third's, orbit kept", kinds("push").length === 0 && kinds("replace").length === 1 && hist.calls.length === 1 && kinds("replace")[0].state?.sky === "seaside" && kinds("replace")[0].state?.orbit === 1, `calls ${calls()}`);
  advance(200);
  at("seaside", { orbit: 1, sky: "seaside" });
  fire(hitOf("grans"), "click");
  check("H2 the same from a mini system on another's sky", kinds("push").length === 0 && kinds("replace").length === 1 && kinds("replace")[0].state?.sky === "grans" && kinds("replace")[0].state?.orbit === 1, `calls ${calls()}`);
  advance(200);

  /* H3: the corner, on another's sky, is history.back() when the entry says a sky, else a flight to willow */
  at("grans", { orbit: 1, sky: "grans" });
  check("H3 setup: the camera is on another household's sky, the corner leads to yours", home.state.camera === "grans" && $("#back").textContent === "— your sky", `camera ${home.state.camera}, back ${show($("#back").textContent)}`);
  $("#back").click();
  check("H3 with a sky in the entry's state, the corner calls history.back() and does not fly", show(hist.calls) === show([{ kind: "back" }]) && !flyingNow() && home.state.camera === "grans", `calls ${calls()}, flying ${flyingNow()}, camera ${home.state.camera}`);
  advance(200);
  check("H3 and nothing flies later", home.state.camera === "grans" && !home.state.flying, `camera ${home.state.camera}`);
  at("grans", { orbit: 1 });
  $("#back").click();
  check("H3 with no sky in the state, the corner flies to willow and calls nothing on history", flyingNow() && hist.calls.length === 0, `calls ${calls()}, flying ${flyingNow()}`);
  advance(200);
  check("H3 and lands on willow", home.state.camera === "willow" && $("#back").textContent === "— the dawn", `camera ${home.state.camera}, back ${show($("#back").textContent)}`);
  let backs = 0;
  home.onBackHome(() => backs++);
  at("willow", { orbit: 1 });
  $("#back").click();
  check("H3 control: on the visitor's own sky the corner calls backHome, and nothing on history", backs === 1 && hist.calls.length === 0 && home.state.camera === "willow", `backHome ${backs}, calls ${calls()}`);

  /* H4: a flight asked for mid-flight is kept and flown when the flight lands (the last one asked) */
  {
    const landed = { b: 0 };
    const cameras = [];
    let always = true;
    at("willow");
    home.flyTo("seaside");
    home.flyTo("grans", () => landed.b++);
    for (let i = 0; i < 100 && !(home.state.camera === "grans" && !home.state.flying); i++) {
      if (home.flying?.() !== true) always = false;
      if (cameras[cameras.length - 1] !== home.state.camera) cameras.push(home.state.camera);
      if (home.state.camera !== "grans" && landed.b !== 0) always = false;
      advance(10);
    }
    check("H4 a flyTo(b) during a flight to a lands on a and then flies to b", show(cameras) === show(["willow", "seaside", "grans"]) && home.state.camera === "grans", `cameras seen ${show(cameras)}, camera ${home.state.camera}`);
    check("H4 flying() is true throughout, b's done was not called before b landed", always, typeof home.flying !== "function" ? "flying() is not exported" : always ? "never false, b's done not early" : "flying() was false at some moment, or b's done was early");
    advance(200);
    check("H4 b's done is called once, and flying() is false after", landed.b === 1 && home.flying?.() === false && !flyingNow(), `done ${landed.b} time(s), flying() ${show(home.flying?.())}`);
  }
  at("willow");
  home.flyTo("seaside");
  advance(200);
  check("H4 control: a flyTo(b) after a has landed flies at once", home.state.camera === "seaside" && home.flying?.() === false, `camera ${home.state.camera}`);
  home.flyTo("willow");
  check("H4 control: and flying() is true while it goes", flyingNow() && home.flying?.() === true, `flying ${flyingNow()}, flying() ${show(home.flying?.())}`);
  at("willow");
  home.flyTo("seaside");
  home.flyTo("grans");
  home.cancelFlight();
  advance(500);
  check("H4 control: cancelFlight during a leaves b unflown", home.state.camera === "willow" && !home.state.flying && !hero.classList.contains("flying") && !$(".minisys.target"), `camera ${home.state.camera}`);

  /* H5: the walk's restoreState pushes and replaces nothing (control: H1's click does) */
  at("willow", { orbit: 1 });
  home.flyTo("mumdad");
  home.restoreState({ ...data.serialise(), camera: "narrow" });
  advance(200);
  const onNarrow = home.state.camera === "narrow";
  home.restoreState({ ...data.serialise(), camera: "willow" });
  check("H5 restoreState puts the camera on another sky and back, and touches no entry", onNarrow && home.state.camera === "willow" && hist.calls.length === 0, `camera ${home.state.camera}, calls ${calls()}`);
  hist.reset();
}

/* ── the sky redrawn on resize, after the burst ────────────────────────── */
{
  $("#dialwrap")._rect = { left: 0, top: 0, width: 320, height: 320 };
  const before = $('.minisys[data-id="grans"]').dataset.dx;
  fireWindow("resize"); fireWindow("resize");
  advance(100);
  check("a resize burst does not redraw at once", $('.minisys[data-id="grans"]').dataset.dx === before, `dx ${$('.minisys[data-id="grans"]').dataset.dx}`);
  advance(100);
  const want = (households.grans.pos[0] * 320 / 640).toFixed(0);
  check("after the burst the galaxy is redrawn to the new size", $('.minisys[data-id="grans"]').dataset.dx === want, `dx ${$('.minisys[data-id="grans"]').dataset.dx} (want ${want})`);
}

/* ── what is saved, muted, and forgotten ───────────────────────────────── */
{
  localStorage.removeItem("orbit-site-state");
  home.mute(true);
  home.snooze("i-chimney");
  check("muted, a change is not saved", localStorage.getItem("orbit-site-state") === null, `saved ${localStorage.getItem("orbit-site-state") ? "something" : "nothing"}`);
  home.mute(false);
  home.snooze("i-smoke");
  check("unmuted, it is saved again", saved()?.households?.willow?.find((it) => it.id === "i-smoke")?.snoozed === true, "smoke alarm saved snoozed");
  check("household() and itemById() give the camera's household and an item's", home.household() === willow && home.itemById("i-smoke")?.household === willow && home.itemById("nope") === null, "as wanted");
  check("suggestionsFor gives only that household's", home.suggestionsFor(willow).length === 1 && home.suggestionsFor(households.grans).length === 0, `${home.suggestionsFor(willow).length}, ${home.suggestionsFor(households.grans).length}`);
  localStorage.setItem("orbit-pack", "dawn"); localStorage.setItem("unrelated", "kept");
  $("#reset").click();
  check("reset forgets the visit and reloads the page from the top", localStorage.getItem("orbit-site-state") === null && localStorage.getItem("orbit-pack") === null && localStorage.getItem("unrelated") === "kept" && location.hash === "" && reloads.length === 1, `state ${localStorage.getItem("orbit-site-state") ? "kept" : "gone"}, hash ${show(location.hash)}, reloads ${reloads.length}`);
}

/* the full-length timings, in a page without reduced motion */
{
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--motion"], { encoding: "utf8", timeout: 60000 });
  process.stdout.write(r.stdout || "");
  if (r.status !== 0) check("the page without reduced motion", false, `exit ${r.status}: ${(r.stderr || "").trim().split("\n").slice(-3).join(" | ")}`);
}

process.exit(failed ? 1 : 0);
