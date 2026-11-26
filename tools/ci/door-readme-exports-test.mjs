/*
 * Test that the door README and assets/door/index.js agree on what the door exports (#172: the README said
 * `drawnAside()` was not exported while index.js exports it). No dependencies and no browser.
 *
 *   node tools/ci/door-readme-exports-test.mjs
 *
 * The README makes three kinds of claim, each checked against the names the module actually exports (index.js imported
 * on the stub page of door-stub.mjs, `Object.keys` of its namespace):
 *   - "`name` (not exported ..." : the name must NOT be exported;
 *   - "`name` (exported ..."     : the name must be exported;
 *   - the list under "### Also exported from `index.js`": every name it lists must be exported.
 * Names that paragraph mentions without listing them as exports (a browser API a function stands in for) are in
 * MENTIONED, so adding a name there is a visible decision.
 */
import { readFileSync } from "node:fs";
import { INDEX, installPage, check, finish } from "./door-stub.mjs";

const README = new URL("../../assets/door/README.md", import.meta.url);
const MENTIONED = new Set(["createImageBitmap"]);              /* named as what fetchBitmap stands in for */
const text = readFileSync(README, "utf8");
const bare = (code) => /^([A-Za-z_$][\w$]*)(\(.*\))?$/.exec(code)?.[1] ?? null;   /* `fetchBitmap(url, options)` -> fetchBitmap */

const { log, info } = console;                                 /* installPage() takes the console for the page */
installPage();
const exported = new Set(Object.keys(await import(INDEX)));
console.log = log; console.info = info;

const claims = [];                                             /* { name, exported, why } */
for (const m of text.matchAll(/`([^`\n]+)` \((not exported|exported)\b/g)) {
  const name = bare(m[1]);
  if (name) claims.push({ name, exported: m[2] === "exported", why: `"${m[0]}"` });
}
const at = text.indexOf("### Also exported from `index.js`");
/* (the list runs to the sentence about a host's own worker, which names methods of that worker as well) */
const para = at < 0 ? "" : text.slice(at).split("For a host's own worker")[0];
for (const m of para.matchAll(/`([^`\n]+)`/g)) {
  const name = bare(m[1]);
  if (name && !MENTIONED.has(name)) claims.push({ name, exported: true, why: `listed under "Also exported from index.js"` });
}

check("the README has an 'Also exported' list and explicit export claims to check", at >= 0 && claims.length >= 30 && claims.some((c) => !c.exported), `${claims.length} claim(s); list found: ${at >= 0}`);
check("index.js exports something to check against", exported.size >= 40 && exported.has("createDoor"), `${exported.size} export(s)`);
const wrong = claims.filter((c) => exported.has(c.name) !== c.exported);
check("every name the README lists as exported, or as not exported, agrees with index.js", wrong.length === 0,
  wrong.map((c) => `${c.name}: README says ${c.exported ? "exported" : "not exported"}, index.js ${exported.has(c.name) ? "exports it" : "does not"} (${c.why})`).join("; "));
finish();
