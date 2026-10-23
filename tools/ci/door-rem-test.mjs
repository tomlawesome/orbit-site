/*
 * Test for the door's text following the reader's text-size setting (#79), written from the specification alone.
 * Orbit scales its root font size, so door.css sizes its fixed text in rem, at the same pixel size at the default 16px
 * root (px / 16), and the gate in the dusk-as-dawn layout is placed with the same rem text-line term. Font sizes that
 * are clamp()/min()/max()/calc() of the layout radius (--R) are out of scope and stay as they are.
 *
 *   node tools/ci/door-rem-test.mjs
 *
 * No dependencies and no browser: door.css is read as text.
 *   R1 each of the seven fixed font sizes is in rem and equals the old px / 16
 *   R2 no font: shorthand or font-size: gives a bare px size outside clamp()/min()/max()/calc()
 *   R3 the calc() placing `#dusk.asdawn .gate` uses .8125rem for the text-line term and no 13px
 *   R4 at a 16px root nothing changes: each converted value x 16 is the old px value
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};

const css = readFileSync(join(root, "assets", "door", "door.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/* the innermost rules: the text before a `{` (after the last `{` or `}`), and the declarations up to the `}` */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")),
  body: m[2],
}));
const FONT = /(?<![-\w])font\s*:\s*(?:\d{3}\s+)?([\d.]+(?:px|rem))/;
const FONT_SIZE = /(?<![-\w])font-size\s*:\s*([\d.]+(?:px|rem))/;
/* the size a rule gives its own text (font shorthand or font-size), as {value, unit}, or null */
const sizeOf = (selector) => {
  for (const r of rules) {
    if (!r.selectors.includes(selector)) continue;
    const m = r.body.match(FONT) || r.body.match(FONT_SIZE);
    if (m) return { text: m[1], value: parseFloat(m[1]), unit: m[1].replace(/^[\d.]+/, "") };
  }
  return null;
};

/* the seven fixed font sizes: selector, old px, the rem it becomes (px / 16, written out from the specification) */
const SEVEN = [
  ["the gate", ".gate", 12, ".75rem"],
  ["the farewell's said", "#dusk .farewell .said", 15, ".9375rem"],
  ["the farewell's sub", "#dusk .farewell .sub", 11, ".6875rem"],
  ["the launch name", "#launchname", 13, ".8125rem"],
  ["the launch name's italic line", "#launchname i", 10, ".625rem"],
  ["the dusk-as-dawn text", "#dusk.asdawn .farewell .sub", 13, ".8125rem"],
  ["the dusk release line", "#dusk:not(.asdawn) .lockup .release", 11, ".6875rem"],
];

/* R1 and R4, one pair per selector */
for (const [what, selector, px, rem] of SEVEN) {
  const got = sizeOf(selector);
  check(`control: ${rem} is ${px}px / 16 (${what})`, parseFloat(rem) * 16 === px, `${parseFloat(rem) * 16}px`);
  check(`R1: ${what} (${selector}) is sized in rem, ${rem}`, !!got && got.text === rem, got ? `found ${got.text}` : "no font size found");
  check(`R4: ${what} is ${px}px at a 16px root`, !!got && got.unit === "rem" && got.value * 16 === px, got ? `${got.text} is ${got.unit === "rem" ? got.value * 16 + "px" : "not rem"} at 16px` : "no font size found");
}

/* R2: take every font: / font-size: value, drop the clamp()/min()/max()/calc() calls (var() first), then no px size may be left */
const stripCalls = (v) => {
  let s = v.replace(/var\([^()]*\)/g, "V");
  for (let prev = null; prev !== s; ) {
    prev = s;
    s = s.replace(/\b(?:clamp|min|max|calc)\([^()]*\)/g, "F");
  }
  return s;
};
const values = [...css.matchAll(/(?<![-\w])font(?:-size)?\s*:\s*([^;}]*)/g)].map((m) => m[1].trim());
const bare = values.filter((v) => /\d(?:\.\d+)?px\b/.test(stripCalls(v)));
check("control: the stylesheet has font declarations to check, some of them clamp()/min() of --R", values.length >= 10 && values.some((v) => /^(?:\d{3}\s+)?(?:clamp|min)\(/.test(v)), `${values.length} found`);
check("R2: no font: or font-size: gives a bare px size outside clamp()/min()/max()/calc()", bare.length === 0, bare.length ? `${bare.length} bare: ${bare.map((v) => v.split(/\s+var\(/)[0]).join(" | ")}` : "none");

/* R3: the gate's place under the two-line text */
const gate = rules.find((r) => r.selectors.includes("#dusk.asdawn .gate") && r.selectors.length === 1 && /(?<![-\w])top\s*:/.test(r.body));
const top = gate ? gate.body.match(/(?<![-\w])top\s*:\s*([^;}]*)/)[1] : "";
check("control: `#dusk.asdawn .gate` is placed with a calc() top", /^calc\(/.test(top), top || "no rule found");
check("R3: the placing calc() uses .8125rem for the text-line term (2 lines at 1.7)", /2\s*\*\s*\.8125rem\s*\*\s*1\.7/.test(top), top || "no rule found");
check("R3: the placing calc() has no 13px", !/\b13px\b/.test(top), /\b13px\b/.test(top) ? "13px still in it" : "none");

process.exit(failed ? 1 : 0);
