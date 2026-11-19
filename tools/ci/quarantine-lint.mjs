// The lint's quarantine check (SEC-12, #138). tools/ci/flake-gate.sh finds the quarantines by a line test alone:
// a line that starts, after any indent, `await quarantined(` and the issue as a string, "#<issue>". So every such
// text in tools/ci/*.mjs, the name, the bracket and a string starting #, must be that: in the code (not a comment, a string, a template literal or a regular expression), with nothing on
// its line before it but the indent and `await `. Anything else is refused, naming the file and line, so no text can
// read to the gate as a quarantine that takes nothing out of the gate.
//
// The code is told from the rest by a small JavaScript scanner: comments, the three kinds of string, `${}` inside a
// template, and a regular expression where a `/` cannot be a division (after an operator, an opening bracket, a
// keyword such as `return`, or at the start). TypeScript 7, the one dev dependency with a parser, has no JavaScript
// API, so there is none to borrow. A file the scanner misreads fails this check, never passes it unseen: the gate
// would then miss a quarantine, which it reports as not-quarantined.
import { readdirSync, readFileSync } from "node:fs";

const WORD = /[A-Za-z0-9_$]/;
const KEYWORDS = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
const NEEDLE = "quarantined" + '("#'; // in two parts, so this file does not hold the text it looks for

// the offsets in s of every NEEDLE that is in the code
export function inCode(s) {
  const out = [], stack = []; // stack: one entry per open `${`, the brace depth inside it
  let i = 0, prev = "";
  const regexHere = () => prev === "" || KEYWORDS.has(prev) || (!WORD.test(prev.slice(-1)) && !")]}".includes(prev));
  const template = () => { // i just past a backtick or a closing `}` of ${}: to the end of the template or the next ${
    while (i < s.length) {
      if (s[i] === "\\") i += 2;
      else if (s[i] === "`") { i++; prev = "`"; return; }
      else if (s[i] === "$" && s[i + 1] === "{") { i += 2; stack.push(0); prev = "{"; return; }
      else i++;
    }
  };
  while (i < s.length) {
    const c = s[i], d = s[i + 1];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "/" && d === "/") { const e = s.indexOf("\n", i); i = e < 0 ? s.length : e; continue; }
    if (c === "/" && d === "*") { const e = s.indexOf("*/", i + 2); i = e < 0 ? s.length : e + 2; continue; }
    if (c === '"' || c === "'") {
      i++;
      while (i < s.length && s[i] !== c && s[i] !== "\n") i += s[i] === "\\" ? 2 : 1;
      i++; prev = c; continue;
    }
    if (c === "`") { i++; template(); continue; }
    if (c === "/" && regexHere()) {
      i++;
      let cls = false;
      while (i < s.length && s[i] !== "\n" && (cls || s[i] !== "/")) {
        if (s[i] === "\\") i++;
        else if (s[i] === "[") cls = true;
        else if (s[i] === "]") cls = false;
        i++;
      }
      i++;
      while (i < s.length && WORD.test(s[i])) i++;
      prev = "/x/"; continue; // a regular expression is a value: a / after it divides
    }
    if (WORD.test(c)) {
      const at = i;
      while (i < s.length && WORD.test(s[i])) i++;
      prev = s.slice(at, i);
      if (s.startsWith(NEEDLE, at)) out.push(at);
      continue;
    }
    if (c === "{" && stack.length) stack[stack.length - 1]++;
    if (c === "}" && stack.length) {
      if (stack[stack.length - 1] === 0) { stack.pop(); i++; template(); continue; }
      stack[stack.length - 1]--;
    }
    prev = c; i++;
  }
  return out;
}

// each refused NEEDLE in s, as a line number
export function refused(s) {
  const code = new Set(inCode(s)), out = [];
  for (let at = s.indexOf(NEEDLE); at >= 0; at = s.indexOf(NEEDLE, at + 1)) {
    const line = s.slice(s.lastIndexOf("\n", at - 1) + 1, at);
    if (!code.has(at) || !/^[ \t]*await $/.test(line)) out.push(s.slice(0, at).split("\n").length);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const n of readdirSync("tools/ci").filter((n) => n.endsWith(".mjs")).sort()) {
    const f = `tools/ci/${n}`;
    for (const ln of refused(readFileSync(f, "utf8"))) {
      console.log(`   ${f}:${ln}: ${NEEDLE} that is not an \`await ${NEEDLE}<issue>", ...)\` call starting its line (it is in a comment, a string, a template or after other code); tools/ci/flake-gate.sh reads only that form, so write the call that way or reword the text`);
      process.exitCode = 1;
    }
  }
}
