/*
 * THE LANGUAGES (#125): the page's words in the visitor's language, and the way between the languages.
 *
 * The root is English; each other language is a folder of its own (de/), its page written by tools/pages.mjs from
 * index.html and the language's catalogue (assets/i18n/<lang>.json), so the markup's words are already in the page.
 * What the site's scripts write is looked up here: English from assets/i18n/en.js (tools/pages.mjs writes it from
 * en.json), the page's own language from the catalogue the translated page carries (<script type="application/json"
 * id="i18n">). A key the page's catalogue lacks falls back to its English, and a key nobody has is shown as itself.
 *
 * The choice: a visitor's click on the switch, or on the AI notice's English link, is stored ("orbit-lang") and wins
 * over the browser's languages from then on. With nothing stored, the root sends a visitor once to the first of the
 * browser's languages the site is built in (index.html's inline auto-lang script: pick, below, is the same rule); a
 * language's own address never redirects, so a shared link shows what its sender saw. Nor does the root send back a
 * visitor who came from one of the site's own pages: a link followed there was a choice, even where nothing can be stored.
 * And the language links carry the choice in their address (lang=), which beats both at the root: the one signal left
 * where the browser keeps nothing and sends no referrer.
 */
import EN from "../i18n/en.js";

/* the languages the site is built in, besides English (a folder each) */
export const BUILT = ["de"];
const doc = typeof document === "undefined" ? null : document;

/* the page's language: its <html lang>, when it is one the site is built in; English otherwise */
export const LANG = (() => {
  const l = String(doc?.documentElement.lang || "en").toLowerCase().split("-")[0];
  return BUILT.includes(l) ? l : "en";
})();

/* the site's root (the modules sit two below it), and the way up to it from this page: "" at the root, "../" from a
   language's folder. A path the scripts give the browser (a picture, a worker, the docs) is put after it, so it is the
   same file from either page; under Node (the tests) nothing is put before a path */
export const ROOT = new URL("../../", import.meta.url).href;
export const UP = (() => {
  if (!doc) return "";
  const here = new URL(".", doc.baseURI).pathname, root = new URL(ROOT).pathname;
  return here.startsWith(root) ? "../".repeat(here.slice(root.length).split("/").filter(Boolean).length) : ROOT;
})();
export const site = (path) => UP + path;

/* the page's own catalogue: on a translated page, the words its scripts write; none on the root */
let PAGE = {};
try { const j = doc?.getElementById("i18n"); if (j) PAGE = JSON.parse(j.textContent || "{}"); } catch { PAGE = {}; }

/* a key's words from a catalogue, its English when the catalogue lacks it, with each {name} filled from vars */
export function t(cat, key, vars) {
  const s = cat && Object.hasOwn(cat, key) ? cat[key] : Object.hasOwn(EN, key) ? EN[key] : key;
  return vars ? String(s).replace(/\{(\w+)\}/g, (m, n) => (Object.hasOwn(vars, n) ? String(vars[n]) : m)) : String(s);
}
/* the same, from this page's catalogue */
export const tr = (key, vars) => t(PAGE, key, vars);

/* where the root sends a visitor: a stored choice first ("en" keeps them at the root, a built language sends them to
   it), then the first of the browser's languages that is English or built (by its primary subtag: de-AT is de). null
   is the root */
export function pick({ stored = null, languages = [], built = BUILT } = {}) {
  if (stored === "en") return null;
  if (stored && built.includes(stored)) return stored;
  for (const l of languages || []) {
    const p = String(l).toLowerCase().split("-")[0];
    if (p === "en") return null;
    if (built.includes(p)) return p;
  }
  return null;
}

/* the same page in a language: the root for English, its folder otherwise, with this address's query and hash. Any lang=
   in the query is dropped, and with mark the language's own put in its place (the root's auto-lang script obeys it) */
export const hrefIn = (lang, rest = "", mark = true) => {
  const cut = rest.indexOf("#"), query = cut < 0 ? rest : rest.slice(0, cut), hash = cut < 0 ? "" : rest.slice(cut);
  const keep = query.replace(/^\?/, "").split("&").filter((x) => x && !/^lang(=|$)/.test(x));
  if (mark) keep.push(`lang=${lang}`);
  return `${ROOT}${lang === "en" ? "" : `${lang}/`}${keep.length ? `?${keep.join("&")}` : ""}${hash}`;
};

/* the language menu and the notice's English link (any a[data-lang]). Each link is a real link, kept pointing at this
   same address (query, such as ?preview, and hash) in its language, so it can be opened in a new tab or copied; a plain
   click stores the choice, then goes there. The menu is a disclosure (WAI-ARIA APG): its button opens and closes the
   list; Escape, a click outside it or focus leaving it closes it. The notice's hide button hides every notice for the
   rest of the session (never for good: owner, 2026-11-05) */
const HIDDEN = "orbit-ai-notice";
export function wireLanguages(root = document) {
  const notices = () => root.querySelectorAll(".ai-notice");
  let hidden = false; try { hidden = sessionStorage.getItem(HIDDEN) === "hidden"; } catch { /* shown */ }
  if (hidden) notices().forEach((n) => { n.hidden = true; });
  const links = () => root.querySelectorAll("a[data-lang]");
  const aim = () => links().forEach((a) => { a.href = hrefIn(a.dataset.lang, location.search + location.hash); });
  aim();
  addEventListener("hashchange", aim);
  /* the site also moves its address with pushState, which fires nothing: aim again just before a link can be taken (a
     press of any button or key, a touch, focus), so a new tab, a middle click or a copied link opens where the visitor is */
  root.addEventListener("pointerdown", aim, true);
  root.addEventListener("keydown", aim, true);
  root.addEventListener("focusin", aim, true);
  const menus = [...root.querySelectorAll(".langs")];
  const toggleOf = (m) => m.querySelector("button[aria-expanded]");
  const open = (m, on) => {
    const b = toggleOf(m);
    if (!b) return;
    if (on) aim();
    b.setAttribute("aria-expanded", on ? "true" : "false");
  };
  const shut = (except) => menus.forEach((m) => { if (m !== except && toggleOf(m)?.getAttribute("aria-expanded") === "true") open(m, false); });
  menus.forEach((m) => {
    m.dataset.ready = "";
    m.addEventListener("focusout", (e) => { if (!m.contains(/** @type {Node | null} */ (e.relatedTarget))) open(m, false); });
  });
  /* outside: before any handler of the page's can stop the click */
  root.addEventListener("pointerdown", (e) => shut(/** @type {Element} */ (e.target).closest?.(".langs")), true);
  root.addEventListener("keydown", (e) => {
    if (/** @type {KeyboardEvent} */ (e).key !== "Escape") return;
    const m = menus.find((x) => toggleOf(x)?.getAttribute("aria-expanded") === "true");
    if (!m) return;
    open(m, false);
    if (m.contains(document.activeElement)) toggleOf(m)?.focus();
  });
  root.addEventListener("click", (e) => {
    const el = /** @type {Element} */ (e.target);
    const menu = el.closest?.(".langs");
    shut(menu);
    const t = el.closest?.(".langs button[aria-expanded]");
    if (t && menu) { open(menu, t.getAttribute("aria-expanded") !== "true"); return; }
    const hide = el.closest?.(".ai-notice .hide");
    if (hide) {
      try { sessionStorage.setItem(HIDDEN, "hidden"); } catch { /* this page only */ }
      notices().forEach((n) => { n.hidden = true; });
      return;
    }
    const a = /** @type {HTMLAnchorElement | null} */ (el.closest?.("a[data-lang]"));
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    /* a stored choice needs no lang= in the address; where it cannot be stored, the address carries it */
    let kept = true;
    try { localStorage.setItem("orbit-lang", a.dataset.lang); } catch { kept = false; }
    location.assign(hrefIn(a.dataset.lang, location.search + location.hash, !kept));
  });
}
