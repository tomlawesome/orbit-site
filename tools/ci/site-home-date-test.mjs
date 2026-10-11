/*
 * Test for the create form's date (#12, item S1), written from the specification alone.
 *
 * assets/js/home.js exports createDate(value, now) -> a valid Date: the typed date when its year has one to four digits
 * and it parses, otherwise now plus 30 days (the form's default). A year of more than four digits (typed 20255) must not
 * give an item an invalid date. The form's date input (#f-date in index.html) has max="9999-12-31".
 *
 *   node tools/ci/site-home-date-test.mjs
 *
 * No dependencies and no browser. home.js loads in Node once matchMedia exists.
 */
import { readFileSync } from "node:fs";

globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });

let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};
const parts = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate()].join("-");
const utcParts = (d) => [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()].join("-");
const day = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? `${parts(d)} (local) / ${utcParts(d)} (UTC)` : String(d));

const { createDate } = await import("../../assets/js/home.js");
check("createDate is exported from home.js", typeof createDate === "function", `typeof createDate is ${typeof createDate} (want function)`);

if (typeof createDate === "function") {
  const now = new Date(2026, 9, 11, 12, 0, 0);
  const nowBefore = now.getTime();
  const plus30 = new Date(2026, 9, 11 + 30, 12, 0, 0);
  const isDefault = (d) => d instanceof Date && !Number.isNaN(d.getTime()) && parts(d) === parts(plus30);

  const typed = createDate("2027-03-01", now);
  check("a typed date is kept", typed instanceof Date && (parts(typed) === "2027-3-1" || utcParts(typed) === "2027-3-1"), `got ${day(typed)} (want 2027-3-1)`);
  const small = createDate("0999-12-31", now);
  check("a year of three digits (0999) is a valid typed date and kept", small instanceof Date && !Number.isNaN(small.getTime()) && (small.getFullYear() === 999 || small.getUTCFullYear() === 999), `got ${day(small)} (want year 999)`);

  for (const [label, value] of [["a five-digit year (20255-03-01)", "20255-03-01"], ["an empty value", ""], ["garbage", "garbage"]]) {
    const d = createDate(value, now);
    check(`${label} gives now + 30 days`, isDefault(d), `got ${day(d)} (want ${parts(plus30)})`);
  }
  check("now is not changed", now.getTime() === nowBefore, now.getTime() === nowBefore ? "unchanged" : "now was moved");
}

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const tag = html.match(/<input\b[^>]*\bid="f-date"[^>]*>/)?.[0] ?? "";
check("the #f-date input has max=\"9999-12-31\"", /\bmax="9999-12-31"/.test(tag), tag ? `tag is ${tag.trim()}` : "no #f-date input found");

process.exit(failed ? 1 : 0);
