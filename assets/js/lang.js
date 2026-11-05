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

/* the same page in a language: the root for English, its folder otherwise, with this address's query and hash */
export const hrefIn = (lang, rest = "") => `${ROOT}${lang === "en" ? "" : `${lang}/`}${rest}`;

/* the switch and the notice's English link (any a[data-lang]): the choice stored, then the same page in that language;
   the notice's hide button hides every notice for the rest of the session (never for good: owner, 2026-11-05) */
const HIDDEN = "orbit-ai-notice";
export function wireLanguages(root = document) {
  const notices = () => root.querySelectorAll(".ai-notice");
  let hidden = false; try { hidden = sessionStorage.getItem(HIDDEN) === "hidden"; } catch { /* shown */ }
  if (hidden) notices().forEach((n) => { n.hidden = true; });
  root.addEventListener("click", (e) => {
    const el = /** @type {Element} */ (e.target);
    const hide = el.closest?.(".ai-notice .hide");
    if (hide) {
      try { sessionStorage.setItem(HIDDEN, "hidden"); } catch { /* this page only */ }
      notices().forEach((n) => { n.hidden = true; });
      return;
    }
    const a = /** @type {HTMLAnchorElement | null} */ (el.closest?.("a[data-lang]"));
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    try { localStorage.setItem("orbit-lang", a.dataset.lang); } catch { /* the address still changes */ }
    location.assign(hrefIn(a.dataset.lang, location.search + location.hash));
  });
}
