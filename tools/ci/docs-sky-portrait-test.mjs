/*
 * Tests for #51 (the docs' sky on a phone), option B, written from the specification alone (owner, 2026-10-14):
 *
 *   On a portrait screen (taller than wide; the site's portrait threshold is `max-aspect-ratio: 10/11`, that is
 *   width / height <= 10/11) the docs flight's camera comes to rest further from the galaxy's core than on a landscape
 *   screen, so the whole spiral fills the height. On landscape screens nothing changes. The docs page then wears a second,
 *   tall picture, assets/img/docs/milkyway-sky-tall.webp, drawn by tools/docsky.cjs and listed like every picture.
 *
 *   node tools/ci/docs-sky-portrait-test.mjs
 *
 * No browser and no dependencies. Needs from the door (the builder adds it; assets/door/index.js is the only file a host
 * imports, so it is exported there):
 *
 *   docsRest({ width, height }) -> { distance }
 *
 * where width and height are the screen's size in CSS pixels, and distance is how far the docs flight's camera comes to
 * rest from the galaxy's core (the galaxy's own units, the ones engine.js: PATH is in). Today the door exposes no way
 * to ask: the resting point is the last point of engine.js PATH, [0.56, 0.006, 0], for every screen, 0.56 from the core
 * (read from the code, 2026-10-14). The distance is a plain number, `distance`, however the builder builds the point.
 *
 *   P1  390x844 (a phone) rests further out than 1920x1080 (a laptop).
 *   P2  1920x1080 is unchanged from today: 0.56 (within 0.001).
 *   P3  1280x800 (another laptop) is unchanged too: 0.56. Landscape does not depend on the exact size.
 *   P4  the threshold is the site's: 900x1000 (0.9, portrait) rests further out than 1000x1000 (square, landscape) and
 *       than 1100x1000 (landscape), and those two are today's 0.56.
 *   P5  the tall picture is tracked by git, so the lint's MEDIA name (sw.js) follows it, and README.md lists it (a row
 *       naming milkyway-sky-tall.webp, as it lists milkyway-sky.webp).
 *
 * Review fixes (spec: the #51 review), written from that spec alone:
 *
 *   P6  (item 2) the threshold is pinned in the door: 909x1000 and 10x11 (exactly 10/11) rest further out (portrait),
 *       910x1000 rests at today's 0.56 (landscape). The page's side is the live test's S1.
 *   N5  (item 5) the live test (docs-sky-portrait-live-test.mjs) never takes a screenshot straight after a fixed sleep:
 *       no `await sleep(<number>)` is followed by a screenshot as its next statement.
 *   N6  (item 6) the shared door is Orbit-neutral and current: in assets/door/ (*.js, door.css, README.md, all of which
 *       Orbit copies), a citation of this site's issue reads "orbit-site #51", never a bare "#51"; nothing calls the
 *       portrait threshold the site's ("the site's threshold", "site's portrait threshold", "threshold is the site's");
 *       and voyage.js holds no copy of the rest point (no `const REST`) and takes it from the engine (`restFor`,
 *       ADR-0004 section 5).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};

/* today's value, read from the code (a note, not a check: the builder may rebuild PATH) */
let today = null;
try {
  const { PATH } = await import("../../assets/door/engine.js");
  today = Math.hypot(...PATH[PATH.length - 1]);
} catch { /* engine.js needs a page in some builds; the recorded 0.56 stands */ }
const TODAY = 0.56;
console.log(`note: the resting distance in the code today is ${today == null ? "(not read)" : today.toFixed(4)}; recorded: ${TODAY}`);

let docsRest = null, importError = null;
try {
  ({ docsRest } = await import("../../assets/door/index.js"));
} catch (e) { importError = String(e && e.message || e).split("\n")[0]; }

const rest = (width, height) => {
  if (typeof docsRest !== "function") return NaN;
  const r = docsRest({ width, height });
  return typeof r?.distance === "number" ? r.distance : NaN;
};
const num = (x) => (Number.isFinite(x) ? x.toFixed(4) : "no value");
const missing = typeof docsRest === "function" ? "" : ` (assets/door/index.js exports no docsRest${importError ? `: import failed: ${importError}` : ""})`;
const near = (a, b) => Number.isFinite(a) && Math.abs(a - b) <= 0.001;

const phone = rest(390, 844), laptop = rest(1920, 1080), laptop2 = rest(1280, 800);
check("P1 a phone (390x844) rests further from the core than a laptop (1920x1080)",
  Number.isFinite(phone) && Number.isFinite(laptop) && phone > laptop, `phone ${num(phone)}, laptop ${num(laptop)}${missing}`);
check("P2 1920x1080 is unchanged from today", near(laptop, TODAY), `${num(laptop)} (want ${TODAY})${missing}`);
check("P3 1280x800 is unchanged from today", near(laptop2, TODAY), `${num(laptop2)} (want ${TODAY})${missing}`);

const portrait = rest(900, 1000), square = rest(1000, 1000), wideish = rest(1100, 1000);
check("P4 the threshold is the site's (10/11): 900x1000 further out; 1000x1000 and 1100x1000 as today",
  Number.isFinite(portrait) && portrait > TODAY + 0.001 && near(square, TODAY) && near(wideish, TODAY),
  `900x1000 ${num(portrait)}, 1000x1000 ${num(square)}, 1100x1000 ${num(wideish)} (want first > ${TODAY}, others ${TODAY})${missing}`);

const just = rest(909, 1000), justWide = rest(910, 1000), exact = rest(10, 11);
check("P6 the threshold is pinned in the door: 909x1000 and 10x11 portrait (further out), 910x1000 landscape (as today)",
  Number.isFinite(just) && just > TODAY + 0.001 && Number.isFinite(exact) && exact > TODAY + 0.001 && near(justWide, TODAY),
  `909x1000 ${num(just)}, 10x11 ${num(exact)}, 910x1000 ${num(justWide)} (want the first two > ${TODAY}, the last ${TODAY})${missing}`);

const pic = "assets/img/docs/milkyway-sky-tall.webp";
let tracked = false;
try { execFileSync("git", ["ls-files", "--error-unmatch", "--", pic], { cwd: root, stdio: "ignore" }); tracked = true; } catch { /* not tracked */ }
const readme = readFileSync(resolve(root, "README.md"), "utf8");
check("P5 the tall picture is tracked by git (so sw.js's MEDIA name follows it) and README.md lists it",
  tracked && readme.includes("milkyway-sky-tall.webp"), `tracked ${tracked}, README names it ${readme.includes("milkyway-sky-tall.webp")}`);

/* N5: no fixed sleep straight before a screenshot in the live test */
const live = readFileSync(resolve(root, "tools/ci/docs-sky-portrait-live-test.mjs"), "utf8");
const sleptShots = [...live.matchAll(/await sleep\(\s*\d[\d_]*\s*\);\s*(?:(?:const|let|var)\s+[\w{}\s,]+=\s*)?await\s+[\w.]*screenshot\(/g)];
check("N5 the live test takes no screenshot straight after a fixed sleep", sleptShots.length === 0,
  sleptShots.length ? `found: ${sleptShots.map((m) => m[0].replace(/\s+/g, " ")).join(" | ")}` : "none");

/* N6: the shared door's comments */
const doorDir = resolve(root, "assets/door");
const doorFiles = readdirSync(doorDir).filter((f) => /\.(js|css)$/.test(f) || f === "README.md");
const bare = [], sites = [];
for (const f of doorFiles) {
  readFileSync(resolve(doorDir, f), "utf8").split("\n").forEach((line, i) => {
    if (/(?<!orbit-site )#51\b/.test(line)) bare.push(`${f}:${i + 1}`);
    if (/site's (portrait )?threshold|threshold is the site's/i.test(line)) sites.push(`${f}:${i + 1}`);
  });
}
check("N6 the door cites this site's issue as \"orbit-site #51\", never a bare \"#51\"", bare.length === 0, bare.length ? `bare #51 at ${bare.join(", ")}` : "none");
check("N6 the door calls the portrait threshold its own, not the site's", sites.length === 0, sites.length ? `"the site's" threshold at ${sites.join(", ")}` : "none");
const voyage = readFileSync(resolve(doorDir, "voyage.js"), "utf8").split("\n");
const hasRest = voyage.some((l) => /^\s*(export\s+)?const REST\b/.test(l));
const takesRestFor = voyage.some((l) => /\brestFor\b/.test(l));
check("N6 voyage.js holds no copy of the rest point (no `const REST`) and takes it from the engine (`restFor`)", !hasRest && takesRestFor,
  hasRest ? "a `const REST` is still in voyage.js" : takesRestFor ? "no `const REST`; restFor present" : "no `restFor` in voyage.js");

process.exit(failed ? 1 : 0);
