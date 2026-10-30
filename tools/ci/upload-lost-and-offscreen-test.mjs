/*
 * Tests for uploadBanded (assets/door/README.md) written from the specification alone (merge request !100):
 *
 *   R1 a map upload whose WebGL context is lost before its GPU work gets its turn makes no GPU upload calls: none of
 *      createTexture, texImage2D, texSubImage2D, generateMipmap; its promise rejects (does not hang, does not resolve
 *      with a texture); the source bitmap(s) are closed, as on any other failure.
 *        lost-whole   the context is lost right after uploadBanded is called, before its chore runs (the whole-picture path)
 *        lost-banded  the context is lost after the first band went in: no further upload call, rejects, and the
 *                     texture is deleted or (the context being lost) nothing further is called at all
 *        control      not lost: the same call makes the upload calls (so the counting is not vacuous)
 *   R2 the crop probe never draws with the screen's framebuffer bound: at every drawArrays the bound DRAW_FRAMEBUFFER
 *      is a non-null framebuffer object, and after the probe the binding is what it was before (null).
 *
 *   node tools/ci/upload-lost-and-offscreen-test.mjs
 *
 * No dependencies and no browser; each case runs in a fresh Node process (this file again, as `--child`) against the
 * stub page in door-stub.mjs. The fake context here also records bindFramebuffer and every call with whether the
 * context was lost at the time.
 */
import { INDEX, installPage, sleep, childMain, runCase, check, finish, errOf } from "./door-stub.mjs";

const FORBIDDEN = ["createTexture", "texImage2D", "texSubImage2D", "generateMipmap"];
const IGNORED = new Set(["isContextLost", "getError"]);

const CASES = {
  async "control"() { return lostWhole(false); },
  async "lost-whole"() { return lostWhole(true); },
  async "lost-banded"() { return lostBanded(); },
  async "offscreen"() { return offscreen(); },
};

/* the stub page with every context call logged ({ name, lost, probe }) and the framebuffer bindings tracked */
function setup(flags) {
  const page = installPage();
  const g = page.glBase;
  Object.assign(g, { FRAMEBUFFER: 0x8d40, READ_FRAMEBUFFER: 0x8ca8, DRAW_FRAMEBUFFER: 0x8ca9, DRAW_FRAMEBUFFER_BINDING: 0x8ca6, FRAMEBUFFER_BINDING: 0x8ca6, READ_FRAMEBUFFER_BINDING: 0x8caa });
  const fb = { draw: null, read: null, made: 0 };
  const log = [], draws = [], binds = [];
  const params = g.getParameter;
  g.getParameter = (p) => (p === 0x8ca6 ? fb.draw : p === 0x8caa ? fb.read : params(p));
  g.createFramebuffer = () => ({ framebuffer: ++fb.made });
  g.bindFramebuffer = (target, f) => {
    binds.push({ target, fb: f });
    if (target === 0x8d40 || target === 0x8ca9) fb.draw = f;
    if (target === 0x8d40 || target === 0x8ca8) fb.read = f;
  };
  for (const name of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
    g[name] = () => { draws.push({ name, bound: fb.draw }); };
  }
  for (const k of Object.keys(g)) {
    if (typeof g[k] !== "function" || IGNORED.has(k)) continue;
    const orig = g[k];
    g[k] = (...a) => { log.push({ name: k, lost: page.lost, probe: !!a[a.length - 1]?.probe }); return orig(...a); };
  }
  const made = [];                       /* every bitmap the picture's cuts make, to see them closed */
  const cib = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async (...a) => { const b = await cib(...a); if (!b.probe) { const c = b.close; b.close = () => { b.closed = true; return c.call(b); }; made.push(b); } return b; };
  return { page, log, draws, binds, fb, made, flags };
}

async function open(flags) {
  const door = await import(INDEX);
  door.createDoor({ typingWait: 0, flags });
  door.openChores();
  return door;
}

/* settles with "resolved" / "rejected" / "never settled" (and the reason, when rejected) */
async function settle(v) {
  const never = Symbol("never");
  let reason = null;
  if (!v || typeof v.then !== "function") return { outcome: "returned", reason };
  const o = await Promise.race([v.then(() => "resolved", (e) => { reason = String(e); return "rejected"; }), sleep(5000).then(() => never)]);
  return { outcome: typeof o === "symbol" ? "never settled" : o, reason };
}

async function lostWhole(loseIt) {
  const s = setup();
  const door = await open({ holdreveal: "1" });        /* holdreveal: the whole picture goes up in one call */
  /* one good upload first, so a probe the module keeps for the context is not made while the context is lost */
  await settle(door.uploadBanded(s.page.gl, { width: 4096, height: 4096, close() {} }, { name: "warm" }));
  const from = s.log.length;
  let closed = 0;
  const bitmap = { width: 4096, height: 4096, close() { closed++; } };
  let v;
  try { v = door.uploadBanded(s.page.gl, bitmap, { name: "stub" }); } catch (e) { v = Promise.reject(e); }
  if (loseIt) s.page.lost = true;                      /* before the chore gets its turn */
  const r = await settle(v);
  const calls = s.log.slice(from).map((c) => c.name);
  return { ...r, closed, forbidden: calls.filter((n) => FORBIDDEN.includes(n)), calls: calls.length };
}

async function lostBanded() {
  const s = setup();
  const g = s.page.glBase;
  let first = false, lostAt = -1;
  for (const fn of ["texSubImage2D", "texImage2D"]) {
    const orig = g[fn];
    g[fn] = (...a) => {
      const out = orig(...a);
      if (!first && !a[a.length - 1]?.probe) { first = true; s.page.lost = true; lostAt = s.log.length; }   /* the first band is in; now the context goes */
      return out;
    };
  }
  const door = await open({});
  let closed = 0;
  const bitmap = { width: 4096, height: 4096, close() { closed++; } };
  const r = await settle(door.uploadBanded(s.page.gl, bitmap, { name: "stub" }));
  const after = lostAt < 0 ? [] : s.log.slice(lostAt).map((c) => c.name);
  const used = [...s.page.mapTextures()];
  return {
    ...r, injected: first, closed, bandsMade: s.made.length, bandsClosed: s.made.filter((b) => b.closed).length,
    forbiddenAfter: after.filter((n) => FORBIDDEN.includes(n)), afterLost: after.filter((n) => n !== "deleteTexture").length,
    textureDeleted: used.length > 0 && used.every((t) => s.page.deletedTextures.includes(t)),
  };
}

async function offscreen() {
  const s = setup();
  const door = await open({});
  const bitmap = { width: 4096, height: 4096, close() {} };
  const r = await settle(door.uploadBanded(s.page.gl, bitmap, { name: "stub" }));
  return {
    ...r, draws: s.draws.length, onScreen: s.draws.filter((d) => d.bound === null || d.bound === undefined || typeof d.bound !== "object").length,
    finalBound: s.fb.draw === null ? "null" : "an object", binds: s.binds.length,
  };
}

if (process.argv[2] === "--child") await childMain(CASES);

{
  const r = runCase(import.meta.url, "control");
  check("control: an upload that is not lost makes upload calls and resolves", !r.error && r.outcome === "resolved" && r.forbidden.length > 0, `outcome ${r.outcome}, ${r.forbidden?.length} forbidden-class call(s) (want some)${errOf(r)}`);
}
{
  const r = runCase(import.meta.url, "lost-whole");
  check("R1a whole picture, context lost before the chore runs: no createTexture, texImage2D, texSubImage2D or generateMipmap", !r.error && r.forbidden.length === 0, `${r.forbidden?.length} such call(s): ${r.forbidden?.join(",")} (of ${r.calls} call(s) in all)${errOf(r)}`);
  check("R1a whole picture, context lost: the promise rejects", !r.error && r.outcome === "rejected", `outcome ${r.outcome}${r.reason ? ` (${r.reason})` : ""}${errOf(r)}`);
  check("R1a whole picture, context lost: the source bitmap is closed", !r.error && r.closed >= 1, `close() called ${r.closed} time(s)${errOf(r)}`);
}
{
  const r = runCase(import.meta.url, "lost-banded");
  check("R1b banded, lost after the first band: (precondition) the first band went in", !r.error && r.injected === true, `first band seen: ${r.injected}${errOf(r)}`);
  check("R1b banded, lost after the first band: no further createTexture, texImage2D, texSubImage2D or generateMipmap", !r.error && r.forbiddenAfter.length === 0, `${r.forbiddenAfter?.length} such call(s) after the loss, first: ${r.forbiddenAfter?.[0]}${errOf(r)}`);
  check("R1b banded, lost after the first band: the promise rejects", !r.error && r.outcome === "rejected", `outcome ${r.outcome}${r.reason ? ` (${r.reason})` : ""}${errOf(r)}`);
  check("R1b banded, lost after the first band: the texture is deleted, or nothing else is called after the loss", !r.error && (r.textureDeleted || r.afterLost === 0), `texture deleted: ${r.textureDeleted}; ${r.afterLost} call(s) other than deleteTexture after the loss${errOf(r)}`);
  check("R1b banded, lost after the first band: the source bitmap and every band cut from it is closed", !r.error && r.closed >= 1 && r.bandsClosed === r.bandsMade, `source close() ${r.closed} time(s); ${r.bandsClosed} of ${r.bandsMade} band bitmap(s) closed${errOf(r)}`);
}
{
  const r = runCase(import.meta.url, "offscreen");
  check("R2 crop probe: (precondition) the upload resolved and the probe drew", !r.error && r.outcome === "resolved" && r.draws >= 1, `outcome ${r.outcome}; ${r.draws} draw call(s)${errOf(r)}`);
  check("R2 crop probe: every draw call has a framebuffer object bound, never the screen's", !r.error && r.draws >= 1 && r.onScreen === 0, `${r.onScreen} of ${r.draws} draw call(s) with the screen's framebuffer (null) bound${errOf(r)}`);
  check("R2 crop probe: the framebuffer binding is null again afterwards", !r.error && r.finalBound === "null", `binding after the upload: ${r.finalBound} (${r.binds} bindFramebuffer call(s))${errOf(r)}`);
}
finish();
