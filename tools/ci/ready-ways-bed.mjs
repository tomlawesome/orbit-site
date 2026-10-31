/*
 * The bed the #116 tests share (fit-memory-test.mjs, ready-ways-test.mjs, ready-ways-worker-test.mjs; ADR-0002 section
 * 6). Not a test itself. The stub page (door-stub.mjs) with what the memory of the speed test and the ways in need:
 *
 *   - a recording localStorage a case seeds (installStore): every get and set is logged, and either may be made to throw;
 *   - the renderer's name, the screen and the pixel ratio the stored key is made of (keyOf);
 *   - pictures that load on the VIRTUAL clock (the stub's own load on a real timer, which a case on the virtual clock
 *     cannot order), so the Earth's picture is in at once and a wait is a wait of virtual time;
 *   - a fetch that records what it was asked for;
 *   - the flight's world a fake the case steers (fake-voyage.mjs; the child is run with fake-voyage-register.mjs).
 *
 * No case reads a clock: every time is the virtual clock's, moved only by clock.advance().
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { installPage, installClock, INDEX, BASE } from "./door-stub.mjs";

export const GPU_NAME = "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)";
export const SOFT_NAME = "ANGLE (Mesa, llvmpipe (LLVM 15.0.7, 256 bits), OpenGL 4.5)";
export const DAY = 24 * 3600e3;

/* the key of ADR-0002 6.4 */
export const keyOf = (renderer = GPU_NAME, w = 1280, h = 800, dpr = 1, prefix = "orbit") => `${prefix}-fit ${renderer} ${w}x${h}@${dpr}`;
export const isFitKey = (k) => /^orbit-fit /.test(String(k));

/*
 * installStore({ seed, throws }) -> st: the page's localStorage as a recording map. `seed` maps a key to a value (an
 * object is stored as its JSON). st.data is the map; st.gets / st.sets are the keys asked for and the [key, value]
 * pairs written, in order; st.fitGets / st.fitSets are those of the fit key alone. `throws` ({ get, set }) makes that
 * call throw, as a browser does with storage blocked.
 */
export function installStore({ seed = {}, throws = {} } = {}) {
  const st = { data: new Map(), gets: [], sets: [], removes: [] };
  for (const [k, v] of Object.entries(seed)) st.data.set(k, typeof v === "string" ? v : JSON.stringify(v));
  globalThis.localStorage = {
    getItem(k) { st.gets.push(String(k)); if (throws.get) throw new Error("storage blocked"); return st.data.has(k) ? st.data.get(k) : null; },
    setItem(k, v) { st.sets.push([String(k), String(v)]); if (throws.set) throw new Error("storage full"); st.data.set(k, String(v)); },
    removeItem(k) { st.removes.push(String(k)); st.data.delete(k); },
    key: (i) => [...st.data.keys()][i] ?? null,
    get length() { return st.data.size; },
  };
  st.fitGets = () => st.gets.filter(isFitKey);
  st.fitSets = () => st.sets.filter(([k]) => isFitKey(k));
  st.fitKeys = () => [...st.data.keys()].filter(isFitKey);
  st.fit = (key) => { const raw = st.data.get(key); return raw === undefined ? undefined : JSON.parse(raw); };
  return st;
}

/*
 * bootWays(o) -> b: the stub page on its virtual clock, the door made and its queue opened, a journey made.
 *   o.renderer   the name the GPU gives (default an ordinary GPU's; SOFT_NAME is a software one the gate refuses)
 *   o.size       [width, height, devicePixelRatio] of the window; the screen is the same width and height (1280 x 800 @ 1)
 *   o.store      installStore's options: { seed, throws }
 *   o.flags      the door's flags (gpu, fit, ...)
 *   o.saveData   navigator.connection.saveData is true
 *   o.reduced    prefers-reduced-motion: reduce
 *   o.holdPlain / o.holdDocs   the fake world's plain asks wait for w.releasePlain() / w.releaseDocs()
 *   o.open=false the chore queue is left closed (the reveal not over)
 * b.world(i) is the i-th fake world made (undefined before it is); b.fetched the addresses fetched.
 */
export async function bootWays(o = {}) {
  const fetched = [];
  const page = installPage({ fetch: async (u) => { fetched.push(String(u)); return { ok: true, status: 200, blob: async () => ({ size: 1, type: "image/webp" }) }; } });
  const clock = installClock();
  page.glBase.getParameter = () => o.renderer ?? GPU_NAME;
  const [W, H, dpr] = o.size ?? [1280, 800, 1];
  globalThis.innerWidth = W; globalThis.innerHeight = H; globalThis.devicePixelRatio = dpr;
  globalThis.screen = { width: W, height: H };
  const store = installStore(o.store);
  /* pictures arrive on the virtual clock, in the next tick of it */
  class VImage extends page.StubImage {
    set src(v) { this._src = v; setTimeout(() => { page.imageHook(this); }, 0); }
    get src() { return this._src; }
  }
  globalThis.Image = VImage;
  if (o.saveData) Object.defineProperty(globalThis.navigator, "connection", { value: { saveData: true }, configurable: true, writable: true });
  if (o.reduced) globalThis.matchMedia = (q) => ({ matches: /reduce/.test(String(q)), addEventListener() {}, removeEventListener() {} });
  globalThis.__fakeVoyage = { holdPlain: !!o.holdPlain, holdDocs: !!o.holdDocs };
  const door = await import(INDEX);
  const d = door.createDoor({ typingWait: 0, flags: o.flags ?? {} });
  if (o.open !== false) door.openChores();
  const journey = d.journey(page.journeyOptions());
  const b = { page, clock, door, d, journey, store, fetched, BASE, world: (i = 0) => (globalThis.__fakeWorlds || [])[i], worlds: () => globalThis.__fakeWorlds || [] };
  /* the console lines about the flight's world, as the page printed them */
  b.verdictLines = () => page.lines.filter((l) => /flight world:/.test(l));
  b.said = (re) => page.lines.filter((l) => re.test(l));
  return b;
}

/* a promise's state, read as time goes on: { state: "pending" | "resolved" | "rejected", value | error } */
export function track(p) {
  const t = { state: "pending", value: undefined, error: undefined };
  Promise.resolve(p).then((value) => { t.state = "resolved"; t.value = value; }, (error) => { t.state = "rejected"; t.error = error; });
  return t;
}

/* a promise that never settles: the host's `ready` that never comes */
export const never = () => new Promise(() => {});

/* the part of a verdict() result a case compares: { fit, how } (the figures are the case's own to read) */
export const brief = (v) => (v ? { fit: v.fit, how: v.how } : v);

/* the virtual clock's Date.now() before anything has been advanced (door-stub.mjs: installClock): a seed's `t` is made from it */
export const NOW = 1.7e12;

/* a case's export, or a plain complaint that it is not there yet (a missing interface is the expected failure before the code) */
export function exported(mod, name, where) {
  if (typeof mod[name] !== "function") throw new Error(`${where} does not export ${name} yet`);
  return mod[name];
}

/* the parent's: run a case in a fresh process with the flight's world a fake (fake-voyage-register.mjs) */
export function runFaked(fileUrl, how, timeout = 90000) {
  const args = ["--import", fileURLToPath(new URL("./fake-voyage-register.mjs", import.meta.url)), fileURLToPath(fileUrl), "--child", how];
  const r = spawnSync(process.execPath, args, { encoding: "utf8", timeout });
  const line = (r.stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) return { error: `the child printed no result (exit ${r.status}): ${(r.stderr || "").split("\n").slice(0, 3).join(" | ")}` };
  return JSON.parse(line.slice(7));
}
