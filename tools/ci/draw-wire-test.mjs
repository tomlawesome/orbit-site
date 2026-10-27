/*
 * Test for #85 batch 1, the seam (ADR-0004 6a.3, "The profile's wire form", test D6), written from the specification
 * alone. A profile carries three functions (`speed`, `atm`, `duskMix`) and structured clone drops functions, so
 * `engine.js` `wireProfile(P)` names them (`base: "UP" | "DOWN"`, chosen by identity) and sends every other field as
 * data; `unwireProfile(w)` puts `UP`'s or `DOWN`'s very functions back. A profile whose curves are neither `UP`'s nor
 * `DOWN`'s cannot be posted: it throws a named error rather than drawing something else.
 *
 *   node tools/ci/draw-wire-test.mjs
 *
 *   W1  for UP, DOWN, DOWN_DAWN (the door's), RIGHT, UP_RING, demoFlight(homes), docsFlight(chart) (the site's,
 *       assets/js/journeys.js; the chart's rect and geometry are getters, as the site gives them) and
 *       descentProfile({ from: RIGHT, homes }): the wire form holds no function anywhere, survives structuredClone,
 *       names the base the spec gives ("UP" for the climbs, "DOWN" for every descent), and unwired after the clone
 *       its curves are the base's very functions (and only those P has) and every other field deep-equals P's
 *   W2  a profile with its own `speed`, own `atm`, or own `duskMix` throws; its control is W1's UP, which does not
 *
 * Pure functions: one fresh Node process (the stub page installed first, in case a module reads the page on import).
 * engine.js is imported by its own path (6a.3 names it there), as fitness.js's frameCost is by other tests.
 */
import { isDeepStrictEqual } from "node:util";
import { INDEX, installPage, childMain, runCase, check, finish, errOf } from "./door-stub.mjs";

const ENGINE = "../../assets/door/engine.js";
const JOURNEYS = "../../assets/js/journeys.js";

/* invented households (README: homeProps' shape) and a chart whose parts are getters, as the site's are */
const HOMES = [
  { name: "Larkspur", bodies: [[0.31, -0.12, "#e0b860", 0.05], [0.36, -0.08, "#9fc3e0", 0.02]] },
  { name: "Quillmoor", bodies: [[-0.27, 0.18, "#c98fd0", 0.04]] },
];
const makeChart = () => {
  const rect = { x: 120, y: 80, width: 640, height: 360, left: 120, top: 80, right: 760, bottom: 440 };
  const geometry = { cx: 0.5, cy: 0.5, r: 0.42, arms: 2, stars: [[0.1, 0.2, 1], [0.3, 0.4, 2]], labels: [{ name: "Docs", x: 0.2, y: 0.3 }] };
  return { get rect() { return rect; }, get geometry() { return geometry; } };
};

/* the path to the first function inside x, or null */
function findFn(x, path = "", seen = new Set()) {
  if (typeof x === "function") return path || "(top)";
  if (!x || typeof x !== "object" || seen.has(x)) return null;
  seen.add(x);
  for (const k of Object.keys(x)) { const p = findFn(x[k], `${path}.${k}`, seen); if (p) return p; }
  return null;
}
const CURVES = ["speed", "atm", "duskMix"];

async function wire() {
  installPage();
  const door = await import(INDEX);
  door.createDoor({ typingWait: 0, flags: {} });
  const engine = await import(ENGINE);
  const out = { wireType: typeof engine.wireProfile, unwireType: typeof engine.unwireProfile, profiles: {}, refusals: {} };
  if (out.wireType !== "function" || out.unwireType !== "function") throw new Error(`engine.js exports wireProfile: ${out.wireType}, unwireProfile: ${out.unwireType}`);
  let site = {};
  try { site = await import(JOURNEYS); } catch (e) { out.siteError = String(e && e.message); }
  const bases = { UP: door.UP, DOWN: door.DOWN };
  const PROFILES = {
    UP: ["UP", () => door.UP],
    DOWN: ["DOWN", () => door.DOWN],
    DOWN_DAWN: ["DOWN", () => door.DOWN_DAWN],
    RIGHT: ["UP", () => site.RIGHT],
    UP_RING: ["UP", () => site.UP_RING],
    "demoFlight(homes)": ["UP", () => site.demoFlight(HOMES)],
    "docsFlight(chart)": ["UP", () => site.docsFlight(makeChart())],
    "descentProfile({ from: RIGHT, homes })": ["DOWN", () => door.descentProfile({ from: site.RIGHT, homes: HOMES })],
  };
  for (const [name, [want, make]] of Object.entries(PROFILES)) {
    const r = { want };
    try {
      const P = make();
      if (!P || typeof P !== "object") throw new Error(`no such profile (${typeof P})`);
      const w = engine.wireProfile(P);
      r.base = w && w.base;
      r.fnAt = findFn(w);
      const u = engine.unwireProfile(structuredClone(w));
      const B = bases[r.base];
      r.curves = CURVES.map((k) => {
        if (typeof P[k] === "function") return u[k] === P[k] && B && B[k] === P[k] ? `${k}: same` : `${k}: NOT the base's function`;
        return u[k] === undefined ? `${k}: absent as in P` : `${k}: present, P has none`;
      });
      r.curvesOk = r.curves.every((s) => /same|absent/.test(s));
      r.strayFns = Object.keys(u).filter((k) => typeof u[k] === "function" && u[k] !== P[k]);
      r.differ = Object.keys(P).filter((k) => typeof P[k] !== "function" && !isDeepStrictEqual(u[k], structuredClone(P[k])));
      r.extra = Object.keys(u).filter((k) => !(k in P) && u[k] !== undefined);
      r.fields = Object.keys(P).length;
    } catch (e) { r.error = `${e && e.name}: ${e && e.message}`; }
    out.profiles[name] = r;
  }
  const REFUSE = {
    "own speed": () => ({ ...door.UP, speed: (t) => t }),
    "own atm": () => ({ ...door.UP, atm: () => 0 }),
    "own duskMix": () => ({ ...door.DOWN, duskMix: () => 0.5 }),
  };
  for (const [name, make] of Object.entries(REFUSE)) {
    try { engine.wireProfile(make()); out.refusals[name] = { threw: false }; }
    catch (e) { out.refusals[name] = { threw: true, isError: e instanceof Error, name: e && e.name, message: e && e.message }; }
  }
  return out;
}

if (process.argv[2] === "--child") await childMain({ wire });

const r = runCase(import.meta.url, "wire");
check("W0 engine.js exports wireProfile and unwireProfile", !r.error && r.wireType === "function" && r.unwireType === "function", `wireProfile ${r.wireType}, unwireProfile ${r.unwireType}${r.siteError ? `; journeys.js: ${r.siteError}` : ""}${errOf(r)}`);
for (const [name, p] of Object.entries(r.profiles || {})) {
  const said = JSON.stringify(p);
  check(`W1 ${name}: the wire form holds no function and names base "${p.want}"`, !p.error && p.fnAt === null && p.base === p.want, said);
  check(`W1 ${name}: unwired after structuredClone, its curves are ${p.want}'s very functions and no others`, !p.error && p.curvesOk && p.strayFns.length === 0, said);
  check(`W1 ${name}: every other field deep-equals the profile's, nothing added`, !p.error && p.fields > 0 && p.differ.length === 0 && p.extra.length === 0, said);
}
if (!r.profiles) check("W1 the profiles were wired", false, `no profile was tried${errOf(r)}`);
const upOk = r.profiles && r.profiles.UP && !r.profiles.UP.error && r.profiles.UP.fnAt === null;
for (const [name, x] of Object.entries(r.refusals || {})) {
  check(`W2 a profile with its ${name} throws an error (control: UP wires without one)`, upOk && x.threw && x.isError && !!x.message, `${JSON.stringify(x)}; UP wired: ${upOk}`);
}
if (!r.refusals) check("W2 the refusals were tried", false, `none tried${errOf(r)}`);
finish();
