/*
 * Test for orbit-site #125 stage 2 (the translation job), written from the specification alone (issue #125, spec
 * section 1 "Hash" and section 6 item 1). No browser, no network.
 *
 *   T1  hash16(s) is the first 16 hex of SHA-256 over the UTF-8 of s, and assets/js/hash.js gives the same pinned
 *       value in Node and under a crypto.subtle shim (the browser's route): a changed canonical form or algorithm
 *       fails it (T1a pinned ASCII value, T1b pinned non-ASCII value, so UTF-8 is what is hashed, T1c the shim route
 *       is the one that ran, T1d a section's canonical string is JSON.stringify([title, html, subs]) of the page)
 *
 *   node tools/ci/translate-hash-test.mjs
 */
import { existsSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { REPO } from "./translate-fixture.mjs";

let failed = false;
const check = (name, ok, detail) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`); if (!ok) failed = true; };

/* pinned from `printf %s <text> | sha256sum | cut -c1-16`, never computed by the test */
const PINS = [["orbit", "4fa1a13ac468ac49"], ["héllo ✓ 日本", "ebdf4e8b1a7a835d"], ["", "e3b0c44298fc1c14"]];
const file = join(REPO, "assets/js/hash.js");
if (!existsSync(file)) {
  check("T1 assets/js/hash.js exists", false, "not built yet: assets/js/hash.js");
  process.exit(1);
}
const load = async (q) => (await import(`${pathToFileURL(file).href}?${q}`)).hash16;
try {
  const plain = await load("plain");
  check("T1 hash.js exports hash16", typeof plain === "function", `typeof ${typeof plain}`);
  for (const [s, want] of PINS) {
    const got = await plain(s);
    check(`T1a hash16(${JSON.stringify(s)}) is ${want}`, got === want, `got ${JSON.stringify(got)}`);
  }
  /* the browser's route: crypto.subtle only, here a shim around the real digest that records its input */
  const seen = [];
  const shim = { subtle: { digest: async (alg, data) => { seen.push([alg, Buffer.from(data).toString("utf8")]); return webcrypto.subtle.digest(alg, data); } } };
  const real = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { value: shim, configurable: true, writable: true });
  let viaShim = [];
  try {
    const shimmed = await load("shim");
    for (const [s] of PINS) viaShim.push(await shimmed(s));
  } finally { if (real) Object.defineProperty(globalThis, "crypto", real); }
  check("T1b under a crypto.subtle shim the values are the same pins", PINS.every(([, want], i) => viaShim[i] === want), JSON.stringify(viaShim));
  check("T1c the shim's digest ran, with SHA-256 over the UTF-8 text", seen.length >= PINS.length && seen.every(([a]) => /sha-?256/i.test(typeof a === "string" ? a : a.name)) && seen.some(([, t]) => t === "héllo ✓ 日本"), JSON.stringify(seen.slice(0, 3)));
  /* a section's canonical string: JSON.stringify([title, html, subs]); a key's: the English text itself */
  const s = { title: "Orbit", html: "<h2>x</h2>", subs: [{ id: "a", title: "b" }] };
  const a = await plain(JSON.stringify([s.title, s.html, s.subs])), b = await plain(JSON.stringify([s.title, s.html, []]));
  check("T1d a changed sub changes the hash, the same section the same", a !== b && a === (await plain(JSON.stringify([s.title, s.html, s.subs]))) && /^[0-9a-f]{16}$/.test(a), `${a} ${b}`);
} catch (e) { check("T1 hash.js loads and hashes", false, String(e && e.message || e)); }
process.exit(failed ? 1 : 0);
