/*
 * The live jobs' one entry point (#95, ADR-0005 sections 3 and 3a), and journey-local.sh's: picks the browser tests
 * a change needs from tools/ci/test-map.json, takes this shard's share of them and runs them one after another
 * against one site server and one browser.
 *
 *   node tools/ci/live-run.mjs firefox|chromium [--all | --changed | TEST...] [--base REF] [--dry-run]
 *
 * Selection: --all is every map test that runs in the browser; --changed (the default) is test-select.mjs's answer
 * for this environment (--base handed on), kept to the browser's tests; TEST names run those (a name not in the map
 * exits 2; one that does not run in the browser is skipped with a line).
 * Shards: CI_NODE_INDEX (1-based) of CI_NODE_TOTAL, neither set is one shard. Longest first by seconds[browser]
 * (ties by name), each test to the bin with the least planned time (the lowest index between equals): sharding by
 * recorded durations. Prints the selection's account, then `shard I/N: <names>, planned S s`; after each test
 * `<name>: ok|FAILED in S s`; at the end `shard I/N: planned S s, took S s`. --dry-run stops after the plan.
 * Unless SITE is set, tools/ci/serve.mjs is started on a free port; unless PW_WS_ENDPOINT is set, one browser server
 * (playwright[browser].launchServer, Playwright from PLAYWRIGHT_ROOT as the tests find it) whose endpoint the tests
 * connect to through live-lib.mjs's openBrowser(). Each test runs as `node <file>` with BROWSER, SITE,
 * PW_WS_ENDPOINT, HEADED=1, WEBGL=required and LIBGL_ALWAYS_SOFTWARE=1; in Chromium with COVERAGE_DIR set, through
 * `--import tools/ci/coverage-hook.mjs`. A failure does not stop the rest.
 *
 * Exit 1 when a test whose `gates` names the browser failed, 0 otherwise, 2 for a usage error.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { freePort } from "./live-lib.mjs";
import { ROOT, loadMap, selection, account } from "./test-select.mjs";

const USAGE = "usage: node tools/ci/live-run.mjs firefox|chromium [--all | --changed | TEST...] [--base REF] [--dry-run]";
const BROWSERS = ["firefox", "chromium"];
const usage = (why) => { console.error(`live-run: ${why}\n${USAGE}`); process.exit(2); };
const secs = (x) => String(Math.round(x * 10) / 10);

/* ---- the command line ---- */
const argv = process.argv.slice(2);
const browser = argv.shift();
if (!BROWSERS.includes(browser)) usage(browser ? `no browser ${browser}` : "name the browser");
let mode = null, base = null, dry = false;
const named = [];
const setMode = (m) => { if (mode && mode !== m) usage("--all, --changed and TEST names are one or the other"); mode = m; };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--all") setMode("all");
  else if (a === "--changed") setMode("changed");
  else if (a === "--dry-run") dry = true;
  else if (a === "--base" && i + 1 < argv.length) base = argv[++i];
  else if (a.startsWith("--base=")) base = a.slice(7);
  else if (a.startsWith("-")) usage(`unknown option ${a}`);
  else { setMode("named"); named.push(a); }
}
mode ||= "changed";
const total = Number(process.env.CI_NODE_TOTAL || 1), index = Number(process.env.CI_NODE_INDEX || 1);
if (!Number.isInteger(total) || !Number.isInteger(index) || total < 1 || index < 1 || index > total) {
  usage(`CI_NODE_INDEX ${process.env.CI_NODE_INDEX} of CI_NODE_TOTAL ${process.env.CI_NODE_TOTAL} is not a shard`);
}

/* ---- the selection ---- */
const map = loadMap();
const tests = map.tests || {};
const N = Object.keys(tests).length;
const runsHere = (n) => (tests[n].browsers || []).includes(browser);
let chosen;
if (mode === "named") {
  const unknown = named.filter((n) => !Object.hasOwn(tests, n));
  if (unknown.length) usage(`not in tools/ci/test-map.json: ${unknown.join(", ")}`);
  console.log(`live-run: the tests named: ${named.join(", ")}`);
  for (const n of named.filter((x) => !runsHere(x))) console.log(`${n}: does not run in ${browser} (its browsers: ${(tests[n].browsers || []).join(", ")}), skipped`);
  chosen = [...new Set(named)].filter(runsHere);
} else if (mode === "all") {
  console.log(`live-run: --all: every test that runs in ${browser}`);
  chosen = Object.keys(tests).filter(runsHere);
} else {
  const found = selection(process.env, base);
  for (const l of account(found)) console.log(l);
  chosen = found.sel.tests.filter((n) => Object.hasOwn(tests, n) && runsHere(n));
}
console.log(`in ${browser}: ${chosen.length} test${chosen.length === 1 ? "" : "s"}${chosen.length ? `: ${chosen.join(", ")}` : ""}`);

/* ---- this shard's share ---- */
const seconds = (n) => Number(tests[n].seconds?.[browser] ?? 0);
const order = [...chosen].sort((a, b) => seconds(b) - seconds(a) || (a < b ? -1 : a > b ? 1 : 0));
const bins = Array.from({ length: total }, () => ({ names: [], planned: 0 }));
for (const n of order) {
  let k = 0;
  for (let j = 1; j < total; j++) if (bins[j].planned < bins[k].planned) k = j;
  bins[k].names.push(n);
  bins[k].planned += seconds(n);
}
const mine = bins[index - 1];
const shard = `shard ${index}/${total}`;
if (!mine.names.length) {
  console.log(`${shard}: 0 of ${N} selected`);
  process.exit(0);
}
console.log(`${shard}: ${mine.names.join(", ")}, planned ${secs(mine.planned)} s`);
if (dry) process.exit(0);

/* ---- one site server and one browser for the shard ---- */
const t0 = Date.now();
let site = process.env.SITE, server = null, browserServer = null;
process.on("exit", () => server?.kill());
const stop = async () => {
  await browserServer?.close().catch(() => {});
  server?.kill();
};
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stop().finally(() => process.exit(1)); });

if (!site) {
  const port = await freePort();
  site = `http://127.0.0.1:${port}/`;
  server = spawn(process.execPath, [join(ROOT, "tools/ci/serve.mjs"), String(port)], { stdio: ["ignore", "ignore", "inherit"] });
  const start = Date.now();
  for (;;) {
    try { await fetch(site); break; } catch {
      if (Date.now() - start > 10000) { console.error("live-run: the site server did not start"); await stop(); process.exit(1); }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  console.log(`live-run: the site at ${site}`);
}
let endpoint = process.env.PW_WS_ENDPOINT;
if (!endpoint) {
  try {
    const playwright = createRequire(import.meta.url)(process.env.PLAYWRIGHT_ROOT || "playwright");
    browserServer = await playwright[browser].launchServer({ headless: false });
    endpoint = browserServer.wsEndpoint();
    console.log(`live-run: one ${browser} for the shard`);
  } catch (e) {
    console.error(`live-run: ${browser} did not start: ${String(e?.message || e).split("\n")[0]}`);
    await stop();
    process.exit(1);
  }
}

/* ---- the tests, one after another ---- */
const hook = browser === "chromium" && process.env.COVERAGE_DIR ? ["--import", join(ROOT, "tools/ci/coverage-hook.mjs")] : [];
const env = { ...process.env, BROWSER: browser, SITE: site, PW_WS_ENDPOINT: endpoint, HEADED: "1", WEBGL: "required", LIBGL_ALWAYS_SOFTWARE: "1" };
let gatingFailed = false;
for (const n of mine.names) {
  const started = Date.now();
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [...hook, join(ROOT, tests[n].file)], { cwd: ROOT, env, stdio: "inherit" });
    child.on("error", (e) => { console.error(`live-run: ${n} did not start: ${e.message}`); resolve(1); });
    child.on("exit", (c, s) => resolve(c ?? (s ? 1 : 0)));
  });
  const took = secs((Date.now() - started) / 1000);
  if (code === 0) console.log(`${n}: ok in ${took} s`);
  else if ((tests[n].gates || []).includes(browser)) { gatingFailed = true; console.log(`${n}: FAILED in ${took} s`); }
  else console.log(`${n}: FAILED (not gating in ${browser}) in ${took} s`);
}
await stop();
console.log(`${shard}: planned ${secs(mine.planned)} s, took ${secs((Date.now() - t0) / 1000)} s`);
process.exit(gatingFailed ? 1 : 0);
