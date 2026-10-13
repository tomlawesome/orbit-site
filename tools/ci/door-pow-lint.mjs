/*
 * The lint the door-* tests share for D4/R5: GLSL pow(x, y) is undefined for x < 0, so a shader source may not call it
 * with a base that can be negative (a bare subtraction, or sin/cos/dot, not inside abs/max/clamp). Pure; not a test.
 */
export const SAFE_CALLS = new Set(["abs", "max", "clamp", "exp", "exp2", "sqrt", "length", "smoothstep", "pow", "fract", "step", "min"]);
const SIGNED_CALLS = new Set(["sin", "cos", "dot"]);
/* is this expression's value possibly negative, going only by its top level? */
export function canBeNegative(expr) {
  let depth = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === "(") {
      /* the name before the paren */
      let j = i - 1; while (j >= 0 && /\s/.test(expr[j])) j--;
      let k = j; while (k >= 0 && /[A-Za-z0-9_]/.test(expr[k])) k--;
      const name = expr.slice(k + 1, j + 1);
      /* find the matching paren */
      let d = 1, e = i + 1;
      while (e < expr.length && d > 0) { if (expr[e] === "(") d++; else if (expr[e] === ")") d--; e++; }
      const inner = expr.slice(i + 1, e - 1);
      if (name && SIGNED_CALLS.has(name)) return true;
      if (!name && canBeNegative(inner)) return true;           /* plain parentheses: look inside */
      i = e - 1;                                                /* any other call (abs, max, clamp, mix, ...): not looked into */
      continue;
    }
    if (c === "-" ) {
      /* the exponent of a literal (1e-3) is not a subtraction */
      if (i > 0 && /[eE]/.test(expr[i - 1]) && /[0-9.]/.test(expr[i - 2] || "")) continue;
      return true;
    }
    depth += 0;
  }
  return false;
}
/* the first argument of every pow( in a source: [{ base, at }] */
export function powBases(source) {
  const src = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (c) => " ".repeat(c.length));      /* comments are not code */
  const out = [];
  const re = /\bpow\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    let d = 1, i = m.index + m[0].length;
    const start = i;
    while (i < src.length && d > 0) {
      const c = src[i];
      if (c === "(") d++; else if (c === ")") d--;
      else if (c === "," && d === 1) break;
      i++;
    }
    const base = src.slice(start, i).trim();
    let j = i + 1, e = 1;
    const es = j;
    while (j < src.length && e > 0) { if (src[j] === "(") e++; else if (src[j] === ")") e--; j++; }
    out.push({ base, exp: src.slice(es, j - 1).trim(), at: src.slice(Math.max(0, m.index - 20), Math.min(src.length, j + 24)).replace(/\s+/g, " ") });
  }
  return out;
}
export const riskyPows = (src) => powBases(src).filter((p) => canBeNegative(p.base));
/* the stricter rule for the live door (R5): as above, and a square is written v*v, not pow(v, 2.0), unless the base is
   wrapped in abs/max/clamp */
export const riskyPowsStrict = (src) => powBases(src).filter((p) => canBeNegative(p.base) || (/^2(\.0*)?$/.test(p.exp) && !/^(abs|max|clamp)\s*\(/.test(p.base)));
