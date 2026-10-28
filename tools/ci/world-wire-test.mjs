/*
 * Test for #93 batch 1, the seam (ADR-0004 6b.7 test W6), written from the specification alone: the view's wire form.
 * install.js's draw builds one object for the world's one drawing call (`w.draw({ cam, fwd, ... })`); the worker path
 * posts it to a worker, so it must be plain data. For the install's options and the information's (main.js INFO_WORLD,
 * read from main.js), at k 0, 0.5 and 1, with and without a `dot0` (the door's planet the shot goes on from), at rest and
 * in motion:
 *
 *   clone      the view survives structuredClone and is deep-equal to the original (`look.HUE` still a Float32Array; no
 *              function in it)
 *   look       the view carries the pure `lookOf(opts.world)` world.js exports (install.js calls it on the page and the
 *              view carries the result; 6b.2)
 *   uniforms   the real createWorld's draw, on the stub gl, sets the same uniforms from the cloned view as from the original
 *   control    drawing the original twice sets the same uniforms (else the check above proves nothing)
 *
 *   node tools/ci/world-wire-test.mjs
 *
 * install.js runs on the stub page (door-stub.mjs) with the real world.js, which a module hook (world-spy.mjs) lets
 * record each view install.js hands it. The views are the page path's: the seam changes nothing there. One fresh Node
 * process a case, on the virtual clock.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { bootInstallPage, settled, namedUniforms, infoWorld, childMain, check, finish } from "./door-stub.mjs";

const INSTALL = "../../assets/js/install.js", WORLD = "../../assets/js/world.js";
const KS = [0, 0.5, 1];
/* the door's planet as install.js's dotOf reads it: where it is, how big, how it swelled, the light it is lit by, its turn */
const DOT = { x: 380, y: 250, r: 28, g: 1.3, light: [-0.3, 0.9, -0.2], rot: 0.4, k: 1 };

async function scenario(infoOpts) {
  const b = await bootInstallPage({ draw: "page" });
  const uniforms = namedUniforms(b.page);
  const { createInstall } = await import(INSTALL);
  const mod = await import(WORLD);
  const pad = b.pad(infoOpts ? "infopad" : "installpad");
  const ring = createInstall(pad, infoOpts || undefined);
  const out = { views: 0, clone: [], look: [], uniforms: [], control: [], notes: [] };
  /* the first still makes and bakes the world */
  const wantLook = typeof mod.lookOf === "function" ? mod.lookOf(infoOpts ? infoOpts.world : {}) : null;
  if (!wantLook) out.notes.push("assets/js/world.js exports no lookOf yet");
  for (const k of KS) for (const dot of [null, DOT]) for (const moving of dot ? [false, true] : [false]) {
    const name = `k=${k} ${dot ? "with a dot" : "no dot"}${moving ? " moving" : ""}`;
    const before = globalThis.__worldSpy?.views.length ?? 0;
    const s = await settled(ring.still(k, 7, dot ? { ...DOT } : null, moving), b.clock);
    if (s.state !== "resolved" || s.value === false) { out.notes.push(`${name}: still() ${s.state === "resolved" ? "gave false" : s.state}`); continue; }
    const spy = globalThis.__worldSpy;
    if (!spy || spy.views.length <= before) { out.notes.push(`${name}: no view reached the world's draw`); continue; }
    const v = spy.views.at(-1);
    out.views++;
    let clone;
    try { clone = structuredClone(v); } catch (e) { out.clone.push(`${name}: structuredClone threw ${e && e.name}: ${e && e.message}`); continue; }
    try { assert.deepStrictEqual(clone, v); } catch (e) { out.clone.push(`${name}: the clone differs: ${String(e.message).split("\n").slice(0, 3).join(" ")}`); }
    if (!(v.look?.HUE instanceof Float32Array)) out.clone.push(`${name}: look.HUE is ${Object.prototype.toString.call(v.look?.HUE)}, not a Float32Array`);
    else if (!(clone.look?.HUE instanceof Float32Array)) out.clone.push(`${name}: look.HUE is no longer a Float32Array after the clone`);
    if (wantLook) { try { assert.deepStrictEqual(v.look, wantLook); } catch { out.look.push(`${name}: look is not lookOf(opts.world)`); } }
    const drawn = (view) => { uniforms.length = 0; spy.real.draw(view); return uniforms.map((u) => JSON.stringify(u)); };
    const a = drawn(v), a2 = drawn(v), c = drawn(clone);
    if (!a.length) out.control.push(`${name}: drawing the view set no uniforms at all`);
    else if (a.join("|") !== a2.join("|")) out.control.push(`${name}: drawing the same view twice set different uniforms`);
    if (a.join("|") !== c.join("|")) {
      const i = a.findIndex((x, j) => x !== c[j]);
      out.uniforms.push(`${name}: call ${i} differs: ${a[i]} against ${c[i]}`);
    }
  }
  return out;
}

const CASES = { install: () => scenario(null), info: async () => scenario(await infoWorld()) };

if (process.argv[2] === "--child") await childMain(CASES);

function run(how) {
  const args = ["--import", fileURLToPath(new URL("./world-spy-register.mjs", import.meta.url)), fileURLToPath(import.meta.url), "--child", how];
  const r = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 120000 });
  const line = (r.stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) return { error: `the child printed no result (exit ${r.status}): ${(r.stderr || "").split("\n").slice(0, 3).join(" | ")}` };
  return JSON.parse(line.slice(7));
}

const WANT = KS.length * (1 + 2);                     /* 3 k x (no dot, a dot at rest, a dot moving) */
for (const how of ["install", "info"]) {
  const r = run(how);
  const bad = (r, list) => (r.error ? [false, r.error] : !r.views ? [false, "no view was drawn, so nothing was checked"] : [list.length === 0, list.length ? list.slice(0, 3).join("; ") + (list.length > 3 ? `; and ${list.length - 3} more` : "") : `${r.views} views`]);
  const have = (r) => r.error ? [false, r.error] : [r.views === WANT, `${r.views} of ${WANT} views reached the world's draw${r.notes.length ? ` (${r.notes.join("; ")})` : ""}`];
  check(`W6 ${how}: the stub page drew all ${WANT} views (else the checks below prove nothing)`, ...have(r));
  check(`W6 ${how}: every view survives structuredClone, deep-equal, look.HUE a Float32Array`, ...bad(r, r.error ? [] : r.clone));
  check(`W6 ${how}: every view carries lookOf(opts.world) from world.js's export`, ...(r.error ? [false, r.error] : r.notes.some((n) => /exports no lookOf/.test(n)) ? [false, "assets/js/world.js exports no lookOf yet (the seam adds it)"] : bad(r, r.look)));
  check(`W6 ${how}: control: drawing a view twice sets the same, non-empty, uniforms`, ...bad(r, r.error ? [] : r.control));
  check(`W6 ${how}: the world's draw sets the same uniforms from the cloned view as from the original`, ...bad(r, r.error ? [] : r.uniforms));
}
finish();
