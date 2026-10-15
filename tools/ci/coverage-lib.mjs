/*
 * Line coverage from V8's own ranges, with no dependency (#14).
 *
 * V8 (Chromium's page.coverage, Node's NODE_V8_COVERAGE) reports, for each script, functions and the nested block
 * ranges inside them, each with a call count. This turns that into the lines of a file that ran:
 *
 *   coveredRanges(functions)  the character ranges that ran at least once (the innermost range names a character's count)
 *   codeMask(source)          which characters are code: not blank, not a comment
 *   lineStats(source, covered) { total, covered } over the lines that hold code; a line ran if any of its code did
 *
 * The ranges of several runs (pages, processes, browsers) are merged by union: a character ran if it ran anywhere.
 */

/* functions: V8's [{ ranges: [{ startOffset, endOffset, count }] }]; length: the script's length in UTF-16 units
   (V8's offsets). Returns the merged character ranges [[start, end), ...] that ran. */
export function coveredRanges(functions, length) {
  const all = [];
  for (const f of functions) for (const r of f.ranges) all.push(r);
  /* parents before the children they hold: later, inner ranges overwrite */
  all.sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  const ran = new Uint8Array(length);
  for (const r of all) ran.fill(r.count > 0 ? 1 : 0, r.startOffset, Math.min(r.endOffset, length));
  return rangesOf(ran);
}

export function rangesOf(mask) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= mask.length; i++) {
    const on = i < mask.length && mask[i] === 1;
    if (on && start < 0) start = i;
    else if (!on && start >= 0) { out.push([start, i]); start = -1; }
  }
  return out;
}

export function maskOf(ranges, length) {
  const mask = new Uint8Array(length);
  for (const [s, e] of ranges) mask.fill(1, s, Math.min(e, length));
  return mask;
}

/* Where a "/" begins a regular expression rather than dividing: after one of these, or a keyword that takes a value. */
const REGEX_AFTER = new Set("(,=:[!&|?{};+-*%<>~^".split(""));
const REGEX_KEYWORDS = new Set(["return", "typeof", "case", "do", "else", "in", "of", "void", "delete", "throw", "new", "yield", "await"]);

/* 1 where a character is code: everything but whitespace and comments (strings, templates and regular expressions
   are code). A small scanner, not a parser: ambiguous "/" is read as a regular expression only if it closes on the same line. */
export function codeMask(src) {
  const n = src.length;
  const code = new Uint8Array(n);
  const braces = []; /* for each open "${" in a template, the brace depth that closes it */
  let depth = 0;
  let prev = ""; /* the last significant character */
  let prevWord = "";
  const isWs = (c) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === " " || c === "﻿" || c === " " || c === " ";
  const template = (from) => { /* inside template text from `from`; returns the index to resume code at, or -1 at an open "${" */
    let i = from;
    while (i < n) {
      const c = src[i];
      if (c === "\\") { code[i] = 1; if (i + 1 < n) code[i + 1] = isWs(src[i + 1]) ? 0 : 1; i += 2; continue; }
      if (c === "`") { code[i] = 1; return i + 1; }
      if (c === "$" && src[i + 1] === "{") { code[i] = code[i + 1] = 1; braces.push(depth); depth++; return -(i + 2); }
      if (!isWs(c)) code[i] = 1;
      i++;
    }
    return n;
  };
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (isWs(c)) { i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '"' || c === "'") {
      code[i++] = 1;
      while (i < n && src[i] !== c && src[i] !== "\n") { if (src[i] === "\\") code[i++] = 1; if (i < n && src[i] !== "\n") code[i] = 1; i++; }
      if (i < n && src[i] === c) code[i++] = 1;
      prev = c; prevWord = "";
      continue;
    }
    if (c === "`") {
      code[i] = 1;
      const r = template(i + 1);
      if (r < 0) { i = -r; prev = "{"; prevWord = ""; } else { i = r; prev = "`"; prevWord = ""; }
      continue;
    }
    if (c === "/" && (prev === "" || REGEX_AFTER.has(prev) || REGEX_KEYWORDS.has(prevWord))) {
      let j = i + 1, inClass = false, closed = false;
      while (j < n && src[j] !== "\n") {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        else if (src[j] === "/" && !inClass) { closed = true; break; }
        j++;
      }
      if (closed) {
        j++;
        while (j < n && /[a-z]/i.test(src[j])) j++;
        code.fill(1, i, j);
        i = j; prevWord = "";
        prev = ")"; /* a regular expression is a value: a "/" after it divides */
        continue;
      }
    }
    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (braces.length && braces[braces.length - 1] === depth) {
        braces.pop();
        code[i] = 1;
        const r = template(i + 1);
        if (r < 0) { i = -r; prev = "{"; prevWord = ""; } else { i = r; prev = "`"; prevWord = ""; }
        continue;
      }
    }
    code[i] = 1;
    if (/[A-Za-z0-9_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) code[j++] = 1;
      prevWord = src.slice(i, j); prev = "a";
      i = j;
      continue;
    }
    prev = c; prevWord = "";
    i++;
  }
  return code;
}

/* Lines that hold code, how many of them ran, and the numbers (from 1) of those that did not. A line ran if any of its
   code characters did. */
export function lineStats(src, ran) {
  const code = codeMask(src);
  let total = 0, covered = 0, start = 0;
  const missed = [];
  let lineNo = 0;
  for (let end = 0; end <= src.length; end++) {
    if (end < src.length && src[end] !== "\n") continue;
    let has = false, hit = false;
    for (let k = start; k < end; k++) if (code[k]) { has = true; if (ran[k]) { hit = true; break; } }
    lineNo++;
    if (has) { total++; if (hit) covered++; else missed.push(lineNo); }
    start = end + 1;
  }
  return { total, covered, missed };
}

/* the largest whole percent a measurement has reached: rounded down, so a floor is never above what was seen */
export function wholePercent(covered, total) {
  return total === 0 ? 100 : Math.floor((100 * covered) / total);
}
