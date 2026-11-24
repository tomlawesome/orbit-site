/*
 * Tests for orbit-site #127 (the docs side list's small constellations draw no card on mouse hover), written from the
 * specification alone:
 *
 *   On mouse hover a `.pad.docs .others .mini` link draws no background. The colour boost stays: its colour becomes
 *   var(--c), its `.lines line` stroke-opacity goes to .85 and its `.stars circle` fill becomes var(--c). Keyboard focus
 *   (:focus-visible) keeps the background:var(--panel) card.
 *
 *   node tools/ci/docs-mini-hover-test.mjs
 *
 * A static check of assets/site.css: no browser, no dependencies. It reads every rule whose selector names the mini link,
 * judges what a hovered, non-focused link gets (base rules, then :hover rules, by specificity then source order; a
 * :focus-visible rule does not apply) and what a keyboard-focused one gets.
 *
 *   H1  hover: no background other than none / transparent.
 *   H2  hover: color is var(--c).
 *   H3  hover: `.lines line` stroke-opacity is .85.
 *   H4  hover: `.stars circle` fill is var(--c).
 *   H5  focus-visible: background is var(--panel).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};

const css = readFileSync(resolve(root, "assets/site.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/* flat list of { selector, decls, order }; at-rule wrappers are walked into, their conditions ignored */
const rules = [];
let order = 0;
function walk(text) {
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    let depth = 1, j = open + 1;
    while (j < text.length && depth) { if (text[j] === "{") depth++; else if (text[j] === "}") depth--; j++; }
    const head = text.slice(i, open).trim(), body = text.slice(open + 1, j - 1);
    if (head.startsWith("@")) { if (/^@(media|supports|layer)/.test(head)) walk(body); }
    else {
      const decls = {};
      for (const d of body.split(";")) {
        const k = d.indexOf(":");
        if (k > 0) decls[d.slice(0, k).trim().toLowerCase()] = d.slice(k + 1).replace(/!important/, "").trim();
      }
      for (const sel of head.split(",")) rules.push({ selector: sel.trim().replace(/\s+/g, " "), decls, order: order++ });
    }
    i = j;
  }
}
walk(css);

const BASE = ".pad.docs .others .mini";
/* parse `.pad.docs .others .mini[:hover|:focus-visible][ descendant]` into { state, tail }, or null */
function parse(sel) {
  if (!sel.startsWith(BASE)) return null;
  const m = /^((?::[a-z-]+)*)(.*)$/.exec(sel.slice(BASE.length));
  if (!m || (m[2] && !m[2].startsWith(" "))) return null;
  const pseudo = m[1];
  const state = pseudo === "" ? "base" : pseudo === ":hover" ? "hover" : pseudo === ":focus-visible" ? "focus" : "other";
  return { state, tail: m[2].trim(), pseudo };
}
const spec = (sel) => {
  const classes = (sel.match(/\.[\w-]+|:[\w-]+/g) || []).length;
  const els = (sel.replace(/\.[\w-]+|:[\w-]+/g, " ").match(/(^|\s)[a-z][\w-]*/gi) || []).length;
  return classes * 100 + els;
};

/* the value of `props` (first match wins by listing order of props as aliases) on the element at `tail`, in `state` */
function valueOf(state, tail, props) {
  const applies = rules.map((r) => ({ r, p: parse(r.selector) }))
    .filter(({ p }) => p && p.tail === tail && (p.state === "base" || p.state === state))
    .sort((a, b) => spec(a.r.selector) - spec(b.r.selector) || a.r.order - b.r.order);
  let val;
  for (const { r } of applies) for (const p of props) if (p in r.decls) val = r.decls[p];
  return val;
}

const norm = (v) => (v ?? "").replace(/\s+/g, "").toLowerCase();
const noBg = (v) => v === undefined || ["none", "transparent"].includes(norm(v));

const hoverBg = valueOf("hover", "", ["background", "background-color"]);
check("H1 hover draws no background", noBg(hoverBg), `hover background is ${hoverBg ?? "(unset)"}`);

const hoverColor = valueOf("hover", "", ["color"]);
check("H2 hover colour is var(--c)", norm(hoverColor) === "var(--c)", `hover color is ${hoverColor ?? "(unset)"}`);

const op = valueOf("hover", ".lines line", ["stroke-opacity"]);
check("H3 hover lines stroke-opacity is .85", op !== undefined && Math.abs(parseFloat(op) - 0.85) < 1e-9, `hover stroke-opacity is ${op ?? "(unset)"}`);

const fill = valueOf("hover", ".stars circle", ["fill"]);
check("H4 hover stars fill is var(--c)", norm(fill) === "var(--c)", `hover fill is ${fill ?? "(unset)"}`);

const focusBg = valueOf("focus", "", ["background", "background-color"]);
check("H5 focus-visible keeps background var(--panel)", norm(focusBg) === "var(--panel)", `focus-visible background is ${focusBg ?? "(unset)"}`);

process.exit(failed ? 1 : 0);
