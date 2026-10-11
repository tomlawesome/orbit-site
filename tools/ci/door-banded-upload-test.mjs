/*
 * Test for upload.js uploadBanded (#39, D10 of batch fix/m2-door), written from the specification alone: if a band or
 * a mipmap step fails, the texture it created is deleted (gl.deleteTexture) before the failure is reported. Control:
 * a successful upload deletes nothing.
 *
 *   node tools/ci/door-banded-upload-test.mjs
 *
 * No dependencies and no browser; each case runs in a fresh Node process (this file again, as `--child`) against the
 * stub page in door-stub.mjs, whose fake context records the textures made, bound and deleted. The picture's texture
 * is the one bound at the first upload call that is not the crop probe's (the probe's texture is the context's own, and it deletes it itself, so the control looks at the picture's texture only).
 * The failure is injected by the fake context: a throw on the second band's upload call ("band"), or in generateMipmap
 * ("mip"). uploadBanded is called as the README gives it (gl, bitmap, options all optional) and may answer at once or
 * with a promise: both are awaited.
 */
import { INDEX, installPage, sleep, childMain, runCase, check, finish, errOf } from "./door-stub.mjs";

const CASES = {
  async "band"() { return upload("band"); },
  async "mip"() { return upload("mip"); },
  async "ok"() { return upload("ok"); },
};

async function upload(how) {
  const page = installPage();
  let uploads = 0, injected = false;
  if (how === "band") {
    const sub = page.glBase.texSubImage2D, img = page.glBase.texImage2D;
    const count = (orig, a) => {
      const src = a[a.length - 1];
      if (!src?.probe && ++uploads === 2) { injected = true; throw new Error("the second band failed"); }
      return orig(...a);
    };
    page.glBase.texSubImage2D = (...a) => count(sub, a);
    page.glBase.texImage2D = (...a) => count(img, a);
  }
  if (how === "mip") page.glBase.generateMipmap = () => { injected = true; throw new Error("the mipmap failed"); };
  const door = await import(INDEX);
  door.createDoor({ typingWait: 0, flags: {} });
  door.openChores();
  const bitmap = { width: 4096, height: 4096, close() {} };
  let outcome = "returned", deletedAtReport = null, value = null;
  const snapshot = () => {
    const used = [...page.mapTextures()];
    return used.length ? used.every((t) => page.deletedTextures.includes(t)) : null;     /* every texture it put pixels on is deleted */
  };
  try {
    value = door.uploadBanded(page.gl, bitmap, { name: "stub" });
    if (value && typeof value.then === "function") {
      const timedOut = Symbol("timeout");
      value = await Promise.race([value, sleep(5000).then(() => timedOut)]);
      if (typeof value === "symbol") { outcome = "never settled"; value = null; }
    }
    deletedAtReport = snapshot();
  } catch (e) {
    outcome = "threw";
    deletedAtReport = snapshot();
  }
  const used = page.mapTextures();
  return { outcome, injected, deletedAtReport, textures: used.size, deletes: page.deletedTextures.length, uploads: page.tex.filter((c) => !c.probe).length, returned: value ? typeof value : String(value) };
}

if (process.argv[2] === "--child") await childMain(CASES);

{
  const r = runCase(import.meta.url, "ok");
  check("control: a successful upload puts pixels on a texture and does not delete it", !r.error && r.textures >= 1 && r.outcome === "returned" && r.deletedAtReport === false, `${r.textures} texture(s) uploaded to, ${r.uploads} upload call(s), outcome ${r.outcome}, picture texture deleted: ${r.deletedAtReport} (${r.deletes} deleteTexture call(s) in all: the crop probe deletes its own)${errOf(r)}`);
}
{
  const r = runCase(import.meta.url, "band");
  check("a failing band: (precondition) the failure was injected on the second band", !r.error && r.injected === true, `injected ${r.injected}; ${r.uploads} upload call(s) seen; outcome ${r.outcome}${errOf(r)}`);
  check("a failing band: the texture is deleted before the failure is reported", !r.error && r.deletedAtReport === true, `outcome ${r.outcome}; texture(s) uploaded to ${r.textures}, deleted by then: ${r.deletedAtReport} (want true)${errOf(r)}`);
}
{
  const r = runCase(import.meta.url, "mip");
  check("a failing mipmap step: (precondition) the failure was injected", !r.error && r.injected === true, `injected ${r.injected}; outcome ${r.outcome}${errOf(r)}`);
  check("a failing mipmap step: the texture is deleted before the failure is reported", !r.error && r.deletedAtReport === true, `outcome ${r.outcome}; texture(s) uploaded to ${r.textures}, deleted by then: ${r.deletedAtReport} (want true)${errOf(r)}`);
}
finish();
