/*
 * Test for the live tests' shared helpers (#95, ADR-0005 sections 3a and 4), written from the ADR alone, before
 * tools/ci/live-lib.mjs exists.
 *
 *   node tools/ci/live-lib-test.mjs
 *
 * No dependencies and no browser: openBrowser() is given a stand-in Playwright whose firefox and chromium record
 * what connect() and launch() were called with.
 *
 *   F   freePort(): a port number a Node net server can bind at once, and free again once that server closes
 *   P   browserPlan(env, { own }): the four combinations of PW_WS_ENDPOINT set or not and own true or false, and
 *       headless from HEADED
 *   O   openBrowser(playwright, name, { own, launch }): connect(endpoint), or launch({ headless, ...launch }); own: true
 *       launches even with an endpoint set; the browser named is the one used
 */
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const LIB = join(here, "live-lib.mjs");

let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};
/* key order does not matter; values compared exactly */
const canon = (v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : Array.isArray(v) ? v.map(canon) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const show = (v) => JSON.stringify(v);
/* a case that throws (the library missing, a function missing) fails, and the rest still run */
const tcase = async (name, fn) => {
  try { const [ok, detail] = await fn(); check(name, ok, detail); } catch (e) { check(name, false, `threw: ${e && e.message ? e.message : e}`); }
};

const listen = (port) => new Promise((resolve) => {
  const s = createServer();
  s.once("error", (e) => resolve({ ok: false, error: e.code || e.message }));
  s.listen(port, "127.0.0.1", () => resolve({ ok: true, close: () => new Promise((r) => s.close(r)) }));
});

/* a stand-in Playwright: each browser type records its calls and returns a token saying which call made it */
function fakePlaywright() {
  const calls = [];
  const type = (name) => ({
    connect: async (...args) => { calls.push({ browser: name, fn: "connect", args }); return { from: `${name}.connect` }; },
    launch: async (...args) => { calls.push({ browser: name, fn: "launch", args }); return { from: `${name}.launch` }; },
  });
  return { calls, pw: { firefox: type("firefox"), chromium: type("chromium") } };
}
/* openBrowser reads the process's environment: set these variables for one call, then put them back */
async function withEnv(vars, fn) {
  const keys = ["PW_WS_ENDPOINT", "HEADED"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, vars);
  try { return await fn(); } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

const EP = "ws://127.0.0.1:1/x";
check("(precondition) tools/ci/live-lib.mjs exists", existsSync(LIB), LIB);
let lib = {};
try { lib = await import(pathToFileURL(LIB).href); } catch (e) { check("tools/ci/live-lib.mjs loads", false, String(e && e.message ? e.message : e)); }
const { freePort, browserPlan, openBrowser } = lib;

/* ---- F: freePort ---- */
await tcase("F1 freePort() gives a port number a server can bind at once", async () => {
  const port = await freePort();
  if (!Number.isInteger(port) || port < 1 || port > 65535) return [false, `got ${show(port)}`];
  const a = await listen(port);
  if (!a.ok) return [false, `port ${port}: bind failed (${a.error}); freePort still holds it?`];
  await a.close();
  return [true, `port ${port}`];
});
await tcase("F2 ... and the port is free again after that server closes", async () => {
  const port = await freePort();
  const a = await listen(port);
  if (!a.ok) return [false, `port ${port}: first bind failed (${a.error})`];
  await a.close();
  const b = await listen(port);
  if (b.ok) await b.close();
  return [b.ok, b.ok ? `port ${port} bound twice in turn` : `second bind failed (${b.error})`];
});

/* ---- P: browserPlan ---- */
const plan = (name, env, own, want) => tcase(name, async () => {
  const got = browserPlan(env, { own });
  return [same(got, want), `got ${show(got)} (want ${show(want)})`];
});
await plan("P1 endpoint set, own false: connect to it", { PW_WS_ENDPOINT: EP }, false, { mode: "connect", endpoint: EP });
await plan("P2 endpoint set, own false, HEADED=1: still connect (headless is the server's business)", { PW_WS_ENDPOINT: EP, HEADED: "1" }, false, { mode: "connect", endpoint: EP });
await plan("P3 endpoint set, own true: launch its own, headless without HEADED", { PW_WS_ENDPOINT: EP }, true, { mode: "launch", headless: true });
await plan("P4 endpoint set, own true, HEADED=1: launch its own, headed", { PW_WS_ENDPOINT: EP, HEADED: "1" }, true, { mode: "launch", headless: false });
await plan("P5 no endpoint, own false: launch, headless without HEADED", {}, false, { mode: "launch", headless: true });
await plan("P6 no endpoint, own false, HEADED=1: launch, headed", { HEADED: "1" }, false, { mode: "launch", headless: false });
await plan("P7 no endpoint, own true, HEADED=1: launch, headed", { HEADED: "1" }, true, { mode: "launch", headless: false });
await plan("P8 no endpoint, own true: launch, headless", {}, true, { mode: "launch", headless: true });
await plan("P9 HEADED other than \"1\" (\"0\") is headless", { HEADED: "0" }, false, { mode: "launch", headless: true });

/* ---- O: openBrowser ---- */
const open = (name, vars, browser, opts, want) => tcase(name, async () => {
  const { calls, pw } = fakePlaywright();
  const got = await withEnv(vars, () => openBrowser(pw, browser, opts));
  const [c] = calls;
  let ok = calls.length === 1 && c.browser === browser && c.fn === want.fn && got?.from === `${browser}.${want.fn}`;
  if (ok && want.fn === "connect") ok = c.args[0] === want.arg;
  if (ok && want.fn === "launch") ok = same(c.args[0], want.arg);
  return [ok, `calls ${show(calls)}, returned ${show(got)} (want one ${browser}.${want.fn}(${show(want.arg)}) and its result)`];
});
await open("O1 endpoint set, own false: firefox.connect(endpoint), nothing launched", { PW_WS_ENDPOINT: EP }, "firefox", { own: false }, { fn: "connect", arg: EP });
await open("O2 ... with launch options given, still connect (they are for a launch)", { PW_WS_ENDPOINT: EP, HEADED: "1" }, "firefox", { own: false, launch: { args: ["--x"] } }, { fn: "connect", arg: EP });
await open("O3 no endpoint: firefox.launch({ headless: true, ...launch })", {}, "firefox", { own: false, launch: { args: ["--x"] } }, { fn: "launch", arg: { headless: true, args: ["--x"] } });
await open("O4 no endpoint, HEADED=1: launch({ headless: false, ...launch })", { HEADED: "1" }, "firefox", { own: false, launch: { args: ["--x"] } }, { fn: "launch", arg: { headless: false, args: ["--x"] } });
await open("O5 no endpoint, no launch options: launch({ headless })", { HEADED: "1" }, "firefox", { own: false }, { fn: "launch", arg: { headless: false } });
await open("O6 own: true launches even with the endpoint set", { PW_WS_ENDPOINT: EP, HEADED: "1" }, "firefox", { own: true, launch: { args: ["--x"] } }, { fn: "launch", arg: { headless: false, args: ["--x"] } });
await open("O7 the launch options come after headless, so a test's own headless wins (upload's headless Chromium)", { PW_WS_ENDPOINT: EP, HEADED: "1" }, "chromium", { own: true, launch: { headless: true } }, { fn: "launch", arg: { headless: true } });
await open("O8 the browser named is the one used: chromium.connect(endpoint)", { PW_WS_ENDPOINT: EP }, "chromium", { own: false }, { fn: "connect", arg: EP });
await open("O9 chromium.launch with its own flags (freeze)", { PW_WS_ENDPOINT: EP, HEADED: "1" }, "chromium", { own: true, launch: { args: ["--ignore-gpu-blocklist", "--enable-gpu"] } }, { fn: "launch", arg: { headless: false, args: ["--ignore-gpu-blocklist", "--enable-gpu"] } });

process.exit(failed ? 1 : 0);
