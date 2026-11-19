/*
 * THE HASH OF THE ENGLISH A TRANSLATION WAS MADE FROM (#125 stage 2): the first 16 hex digits of SHA-256 over the
 * UTF-8 of a string. One module for both sides: the translation job (tools/ci/translate.mjs) records it beside each
 * translated docs section and catalogue key, and the docs pad (pads.js) computes it again from the English page to
 * tell whether the translation is stale. Both read crypto.subtle, which the browser and Node 20+ both have.
 *
 * What is hashed: a docs section's JSON.stringify([title, html, subs]) (sectionText), a catalogue key's English value.
 */
export async function hash16(s) {
  const d = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)));
  return Array.from(new Uint8Array(d).subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

/* the canonical text of a docs section */
export const sectionText = (s) => JSON.stringify([s.title, s.html, s.subs]);
