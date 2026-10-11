/*
 * Test for the shimmer element being removed on the goodbye dressed as the dawn (#41), written from the
 * specification alone (batch fix/m2-door, D14). duskMarkup({ asDawn: true }) writes no `.shimmer` element at all;
 * duskMarkup() without asDawn keeps its `.shimmer` exactly as now. Nothing else in either output changes.
 *
 *   node tools/ci/door-shimmer-test.mjs
 *
 * No dependencies and no browser: duskMarkup is a pure string function; the site's index.html is checked with
 * `node tools/door-markup.mjs --check` (the markup writer's own read-only mode).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { duskMarkup } from "../../assets/door/markup.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};
const count = (s, re) => (s.match(re) || []).length;
const SHIMMER = /class="shimmer"/g;
const NAME = /class="name">orbit</g;

const plain = duskMarkup();
const asDawn = duskMarkup({ asDawn: true });

/* controls: the default duskMarkup has one shimmer; asDawn is the case being tested */
check("control: the default duskMarkup has exactly one shimmer", count(plain, SHIMMER) === 1, `${count(plain, SHIMMER)} found`);
check("control: the default duskMarkup contains the .name wordmark", count(plain, NAME) === 1, `${count(plain, NAME)} found`);

/* D14 */
check("D14: duskMarkup({ asDawn: true }) contains no shimmer element", count(asDawn, SHIMMER) === 0, `${count(asDawn, SHIMMER)} found`);
check("D14: duskMarkup({ asDawn: true }) still contains the .name wordmark", count(asDawn, NAME) === 1, `${count(asDawn, NAME)} found`);

/* the page's own markup */
const r = spawnSync(process.execPath, [join(root, "tools", "door-markup.mjs"), "--check"], { encoding: "utf8", cwd: root });
check("D14: index.html is unchanged by the writer (--check exits 0)", r.status === 0, `exit ${r.status}: ${(r.stdout + r.stderr).trim().split("\n")[0]}`);

process.exit(failed ? 1 : 0);
