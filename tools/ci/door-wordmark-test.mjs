/*
 * Test for the door's wordmark not having to be a heading (#40), written from the specification alone (batch
 * fix/m2-door, D13). dawnMarkup({ heading = true }): `heading: false` writes the wordmark as
 * `<div class="name">orbit</div>` (as duskMarkup does) instead of `<h1 class="name">orbit</h1>`, so a page that has
 * its own h1 (a docs page) is not given a second one. The default is unchanged, so the site's markup does not change.
 *
 *   node tools/ci/door-wordmark-test.mjs
 *
 * No dependencies and no browser: dawnMarkup is a pure string function; the site's index.html is checked with
 * `node tools/door-markup.mjs --check` (the markup writer's own read-only mode).
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { dawnMarkup, duskMarkup } from "../../assets/door/markup.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};
const count = (s, re) => (s.match(re) || []).length;
const H1 = /<h1 class="name">orbit<\/h1>/g;
const DIV = /<div class="name">orbit<\/div>/g;
const ANY_H1 = /<h1[\s>]/g;

const dflt = dawnMarkup();
const explicit = dawnMarkup({ heading: true });
const plain = dawnMarkup({ heading: false });

/* controls: the default is a heading; the dusk's wordmark is already a div */
check("control: the default wordmark is one <h1 class=\"name\">orbit</h1>", count(dflt, H1) === 1 && count(dflt, ANY_H1) === 1, `${count(dflt, H1)} such h1, ${count(dflt, ANY_H1)} h1 in all`);
check("control: the default has no <div class=\"name\">orbit</div>", count(dflt, DIV) === 0, `${count(dflt, DIV)} found`);
check("control: heading: true is the same as the default", explicit === dflt, explicit === dflt ? "identical" : "differs");
check("control: duskMarkup's wordmark is already a div (the shape to match)", count(duskMarkup(), DIV) === 1, `${count(duskMarkup(), DIV)} found`);
/* D13 */
check("D13: heading: false writes no <h1 at all", count(plain, ANY_H1) === 0 && !/<\/h1>/.test(plain), `${count(plain, ANY_H1)} <h1 found`);
check("D13: heading: false writes one <div class=\"name\">orbit</div>", count(plain, DIV) === 1, `${count(plain, DIV)} found`);
check("D13: heading: false changes nothing else (swapping the div back for the h1 gives the default)", plain !== dflt && plain.replace(DIV, '<h1 class="name">orbit</h1>') === dflt, "compared after the swap");
const withParts = { lockup: "<i>L</i>", gate: "<b>G</b>", foot: "<u>F</u>", indent: "  " };
check("D13: the host's parts and indent are unaffected by heading: false", dawnMarkup({ ...withParts, heading: false }) !== dawnMarkup(withParts) && dawnMarkup({ ...withParts, heading: false }).replace(DIV, '<h1 class="name">orbit</h1>') === dawnMarkup(withParts), "compared after the swap");
/* the page's own markup */
const r = spawnSync(process.execPath, [join(root, "tools", "door-markup.mjs"), "--check"], { encoding: "utf8", cwd: root });
check("D13: index.html is unchanged by the writer (--check exits 0)", r.status === 0, `exit ${r.status}: ${(r.stdout + r.stderr).trim().split("\n")[0]}`);
check("D13: index.html still carries the one h1 wordmark", count(readFileSync(join(root, "index.html"), "utf8"), H1) === 1, `${count(readFileSync(join(root, "index.html"), "utf8"), H1)} found`);
/* door.css styles the wordmark by its class, so a div looks like the h1 */
const css = readFileSync(join(root, "assets", "door", "door.css"), "utf8");
check("D13: door.css does not style the wordmark through an h1 selector", !/h1[^{,]*\.name|\.name[^{,]*h1/.test(css), "no selector joins h1 and .name");
check("D13: the README documents the heading option", /dawnMarkup\([^)]*heading/.test(readFileSync(join(root, "assets", "door", "README.md"), "utf8")), "dawnMarkup({ ... heading ... }) in the Markup section");
process.exit(failed ? 1 : 0);
