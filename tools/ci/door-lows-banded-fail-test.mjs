/*
 * Test for uploadBanded's whole-picture path failing (#89, E), written from the specification alone. upload.js
 * uploadBanded(gl, bitmap, options) puts a picture on the GPU in bands, or whole where the holdreveal flag is set or where a cut
 * picture's crop is not honoured (assets/door/README.md). When the whole upload's texImage2D throws: the source bitmap is
 * closed (unless options.keep), the texture it made is deleted, and the promise rejects.
 *
 *   U1 hold    the `holdreveal` debug flag (flags.holdreveal), texImage2D of the whole bitmap throws -> rejects, bitmap closed, texture deleted
 *   U2 nocrop  the crop is not honoured (the probe's read-back says so), the same throw -> the same
 *   U3 keep    holdreveal with options.keep: rejects, texture deleted, the bitmap left open
 *   U0 control no throw: resolves, nothing deleted
 *
 *   node tools/ci/door-lows-banded-fail-test.mjs
 *
 * No dependencies and no browser; each case runs in a fresh Node process (this file again, as `--child`) against the
 * stub page in door-stub.mjs. The throw is injected in the fake context for the whole bitmap's texImage2D only (a bitmap
 * marked `whole`); "the crop is not honoured" is the probe's read-back answering as an unhonoured crop does.
 */
import { INDEX, installPage, trackGl, sleep, childMain, runCase, check, finish, errOf } from "./door-stub.mjs";

const CASES = {
  async "control"() { return upload({ throws: false, hold: true }); },
  async "hold"() { return upload({ throws: true, hold: true }); },
  async "nocrop"() { return upload({ throws: true, hold: false, nocrop: true }); },
  async "keep"() { return upload({ throws: true, hold: true, keep: true }); },
};

async function upload({ throws, hold, nocrop = false, keep = false }) {
  const page = installPage();
  const tr = trackGl(page);
  let injected = false, whole = null;
  const tex = page.glBase.texImage2D;
  page.glBase.texImage2D = (...a) => {
    const src = a[a.length - 1];
    if (throws && src && src === whole) { injected = true; throw new Error("the whole upload failed"); }
    return tex(...a);
  };
  if (nocrop) page.glBase.getBufferSubData = (t, o, out) => { out[0] = 0; out[1] = 0; };
  const door = await import(INDEX);
  door.createDoor({ typingWait: 0, flags: hold ? { holdreveal: "1" } : {} });
  door.openChores();
  let closed = 0;
  const bitmap = { width: 4096, height: 4096, close() { closed++; } };
  whole = bitmap;
  const options = { name: "stub" };

  if (keep) options.keep = true;
  let outcome = "returned", reason = null;
  try {
    let v = door.uploadBanded(page.gl, bitmap, options);
    if (v && typeof v.then === "function") {
      const never = Symbol("never");
      v = await Promise.race([v.then(() => "resolved", (e) => { reason = String(e); return "rejected"; }), sleep(5000).then(() => never)]);
      outcome = typeof v === "symbol" ? "never settled" : v;
    }
  } catch (e) { outcome = "threw"; reason = String(e); }
  const used = tr.objects.filter((h) => h.kind === "texture" && !h.probe);
  return { outcome, injected, closed, textures: used.length, deleted: used.filter((t) => t.released).length, reason };
}

if (process.argv[2] === "--child") await childMain(CASES);

{
  const c = runCase(import.meta.url, "control");
  check("U0 control: with no throw the upload resolves, the texture is kept", !c.error && c.outcome !== "rejected" && c.outcome !== "threw" && c.deleted === 0 && c.textures >= 1, `outcome ${c.outcome}; ${c.textures} texture(s), ${c.deleted} deleted${errOf(c)}`);
  const cases = [["hold", "with holdreveal", true], ["nocrop", "where the crop is not honoured", true], ["keep", "with holdreveal and keep", false]];
  for (const [how, what, closes] of cases) {
    const r = runCase(import.meta.url, how);
    check(`U (${what}) precondition: the whole bitmap's texImage2D was reached and threw`, !r.error && r.injected === true, `injected ${r.injected}; outcome ${r.outcome}${errOf(r)}`);
    check(`U (${what}): the promise rejects`, !r.error && r.injected && r.outcome === "rejected", `outcome ${r.outcome} (${r.reason})${errOf(r)}`);
    check(`U (${what}): the texture it made is deleted`, !r.error && r.injected && r.textures >= 1 && r.deleted === r.textures, `${r.deleted} of ${r.textures} texture(s) deleted${errOf(r)}`);
    check(`U (${what}): the source bitmap is ${closes ? "closed" : "left open (keep)"}`, !r.error && r.injected && (closes ? r.closed >= 1 : r.closed === 0), `closed ${r.closed} time(s)${errOf(r)}`);
  }
}
finish();
