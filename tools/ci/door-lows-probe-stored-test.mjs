/*
 * Test for the capability probe's stored result being believed only when it is sound (#89, C), written from the
 * specification alone. capability.js probe(): a stored probe (localStorage, key `orbit-probe <user agent> <screen>@<ratio>`,
 * as CAPABILITIES.md gives it) is used only if its time `t` is a number, not in the future, and under a week old;
 * otherwise the probe runs afresh (the console line then does not say "stored").
 *
 *   P1 future  t a day ahead          -> measured afresh
 *   P2 string  t a string             -> measured afresh
 *   P0 control t an hour ago, ok      -> the stored result is used (the line says "stored", nothing is read back)
 *   P3 old     t eight days ago       -> measured afresh (the week's limit; held already)
 *
 *   node tools/ci/door-lows-probe-stored-test.mjs
 *
 * No dependencies and no browser; each case runs in a fresh Node process (this file again, as `--child`) against the
 * stub page in door-stub.mjs, on a virtual clock (Date.now moves with it). "Measured afresh" is judged by the console
 * line and by the probe reading pixels back from the fake context.
 */
import { INDEX, installPage, installClock, childMain, runCase, check, finish, errOf } from "./door-stub.mjs";

const DAY = 86400000;
const CASES = {
  async "future"() { return probeCase((now) => now + DAY); },
  async "string"() { return probeCase((now) => String(now - 3600000)); },
  async "control"() { return probeCase((now) => now - 3600000); },
  async "old"() { return probeCase((now) => now - 8 * DAY); },
};

async function probeCase(timeOf) {
  const page = installPage();
  const clock = installClock();
  const kept = new Map();
  globalThis.localStorage = { getItem: (k) => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => { kept.set(k, String(v)); }, removeItem: (k) => { kept.delete(k); }, key: (i) => [...kept.keys()][i] ?? null, get length() { return kept.size; } };
  globalThis.screen = { width: 1920, height: 1080 };
  const seed = JSON.stringify({ t: timeOf(Date.now()), r: { background: true, compileMs: 60, msPerMpx: 5, ok: true } });
  for (const s of ["1920x1080", `${innerWidth}x${innerHeight}`]) kept.set(`orbit-probe ${navigator.userAgent} ${s}@${devicePixelRatio}`, seed);
  const door = await import(INDEX);
  door.createDoor({ typingWait: 0, flags: { door3d: "1" } });
  door.gpu();
  door.openChores();
  let result = "pending";
  door.probe().then((r) => { result = r; }, (e) => { result = { rejected: String(e) }; });
  await clock.advance(20000, () => result !== "pending");
  await clock.advance(500);
  const line = page.lines.find((l) => /probe:/.test(l)) || null;
  return { settled: result !== "pending", result, line, stored: !!line && /\(stored\)/.test(line), read: page.readPixels };
}

if (process.argv[2] === "--child") await childMain(CASES);

{
  const c = runCase(import.meta.url, "control");
  check("P0 control: a stored probe from an hour ago, ok, is used", !c.error && c.settled && c.stored && c.result?.ok === true, `line ${JSON.stringify(c.line)}; result ${JSON.stringify(c.result)}${errOf(c)}`);
  for (const [how, what] of [["future", "a time in the future (a day ahead)"], ["string", "a time that is a string"], ["old", "a time eight days ago"]]) {
    const r = runCase(import.meta.url, how);
    check(`P: ${what} is not used: the probe runs afresh`, !r.error && r.settled && !r.stored && r.read >= 1, `line ${JSON.stringify(r.line)}; ${r.read} read-back(s); result ${JSON.stringify(r.result)}${errOf(r)}`);
  }
}
finish();
