/*
 * Test for the live jobs' runner (#95, ADR-0005 sections 3 and 3a), written from the ADR alone, before
 * tools/ci/live-run.mjs exists.
 *
 *   node tools/ci/live-run-test.mjs
 *
 * No dependencies and no browser. Each case runs in a scratch git repository holding copies of live-run.mjs,
 * live-lib.mjs and test-select.mjs, an invented map (tools/ci/test-map.json) whose tests are small Node scripts
 * written here, and a harmless tools/ci/coverage-hook.mjs that only marks that it was loaded. Each fake test writes
 * what it received (its environment, its execArgv, whether the hook ran, when it started and ended) to out/<name>.json,
 * appends its name to out/order.log, prints the record as one JSON line, and exits 1 when its name is in FAKE_FAIL.
 * The runner gets an environment built here from nothing, always with SITE=http://127.0.0.1:1/ and
 * PW_WS_ENDPOINT=ws://127.0.0.1:1/x, so it never starts a site server or a browser.
 *
 * The invented map (seconds per browser; gates):
 *   alpha   firefox 50, chromium 5    group ga   gates both
 *   bravo   firefox 40, chromium 30   group gb   gates both
 *   charlie firefox 30                group ga   gates firefox
 *   delta   firefox 30, chromium 20   group gb   gates firefox only (not gating in chromium)
 *   echo    firefox 20, chromium 40   group gc   gates both
 *   fox     chromium 10               group gc   gates chromium
 *
 *   D   sharding, with --all --dry-run: longest first, each test to the bin with the least planned time (ties by name;
 *       between bins of equal time, the lowest index), the `shard I/N: <names>, planned S s` line exact; no shard
 *       variables is one shard holding everything; a shard with nothing prints `0 of N selected` and exits 0
 *   S   selection: --all is BROWSER's tests only; --changed and the default follow test-select for the same
 *       environment (a merge request, --base), kept to BROWSER's tests; TEST names run those; an unknown name exits 2
 *       naming it; a named test that does not run in BROWSER is skipped with a line
 *   E   what each test receives: BROWSER, SITE, PW_WS_ENDPOINT, HEADED=1, WEBGL=required, LIBGL_ALWAYS_SOFTWARE=1 and
 *       the caller's environment; --import of tools/ci/coverage-hook.mjs in Chromium with COVERAGE_DIR, not otherwise
 *   R   order and exit codes: one after another in the planned order; a failure does not stop the rest; exit 1 when a
 *       failed test gates in BROWSER, 0 when it does not (`FAILED (not gating in BROWSER)`); the per-test and closing
 *       lines
 *   N   --dry-run starts nothing
 *   U   usage errors exit 2
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, copyFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const COPIED = ["live-run.mjs", "live-lib.mjs", "test-select.mjs"];
const ZEROS = "0".repeat(40);
const SITE = "http://127.0.0.1:1/";
const PW_WS_ENDPOINT = "ws://127.0.0.1:1/x";

let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};
const sorted = (a) => [...a].sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameSet = (a, b) => same(sorted(a), sorted(b));

const scratch = [];
const gitEnv = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
const git = (dir, ...args) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], { cwd: dir, encoding: "utf8", env: { ...gitEnv, HOME: dir } });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const put = (dir, path, text) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); };

/* a fake test: records what it received, takes a moment (so overlapping runs would show), exits as FAKE_FAIL says */
const fakeTest = (name) => `import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
const NAME = ${JSON.stringify(name)};
const out = new URL("../../out/", import.meta.url);
mkdirSync(out, { recursive: true });
const start = Date.now();
await new Promise((r) => setTimeout(r, 120));
const rec = { name: NAME, env: process.env, execArgv: process.execArgv, hook: globalThis.__fakeCoverageHook === true, start, end: Date.now() };
appendFileSync(new URL("order.log", out), NAME + "\\n");
writeFileSync(new URL(NAME + ".json", out), JSON.stringify(rec));
console.log(JSON.stringify(rec));
process.exit((process.env.FAKE_FAIL || "").split(",").includes(NAME) ? 1 : 0);
`;
const HOOK = "/* stands in for the coverage hook: only marks that it was loaded */\nglobalThis.__fakeCoverageHook = true;\n";

const entry = (name, groups, seconds, gates) => ({ file: `tools/ci/${name}-test.mjs`, groups, browsers: Object.keys(seconds), gates, seconds });
const MAP = {
  groups: {
    all: ["core/**", "tools/ci/test-map.json", "tools/ci/test-select.mjs", "tools/ci/live-run.mjs", "tools/ci/live-lib.mjs", "tools/ci/coverage-hook.mjs"],
    none: ["docs/**", "*.md"],
    ga: ["src/a.js"],
    gb: ["src/b.js"],
    gc: ["src/c.js"],
  },
  tests: {
    alpha: entry("alpha", ["ga"], { firefox: 50, chromium: 5 }, ["firefox", "chromium"]),
    bravo: entry("bravo", ["gb"], { firefox: 40, chromium: 30 }, ["firefox", "chromium"]),
    charlie: entry("charlie", ["ga"], { firefox: 30 }, ["firefox"]),
    delta: entry("delta", ["gb"], { firefox: 30, chromium: 20 }, ["firefox"]),
    echo: entry("echo", ["gc"], { firefox: 20, chromium: 40 }, ["firefox", "chromium"]),
    fox: entry("fox", ["gc"], { chromium: 10 }, ["chromium"]),
  },
};
const NAMES = Object.keys(MAP.tests);
const FIREFOX = NAMES.filter((n) => MAP.tests[n].browsers.includes("firefox"));
const CHROMIUM = NAMES.filter((n) => MAP.tests[n].browsers.includes("chromium"));

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "live-run-"));
  scratch.push(dir);
  git(dir, "init", "-q");
  const files = { "src/a.js": "a\n", "src/b.js": "b\n", "src/c.js": "c\n", "core/door.js": "door\n", "docs/guide.md": "guide\n", "README.md": "readme\n",
    "tools/ci/coverage-hook.mjs": HOOK, "tools/ci/test-map.json": JSON.stringify(MAP, null, 2) + "\n" };
  for (const n of NAMES) files[MAP.tests[n].file] = fakeTest(n);
  for (const [p, t] of Object.entries(files)) put(dir, p, t);
  for (const f of COPIED) if (existsSync(join(here, f))) copyFileSync(join(here, f), join(dir, "tools/ci", f));
  writeFileSync(join(dir, ".gitignore"), "out/\ncov/\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  return { dir, base: git(dir, "rev-parse", "HEAD") };
}
function branch(repo, name, from, write) {
  git(repo.dir, "checkout", "-q", "-B", name, from);
  if (write) {
    for (const [p, t] of Object.entries(write)) put(repo.dir, p, t);
    git(repo.dir, "add", "-A");
    git(repo.dir, "commit", "-q", "-m", name);
  }
}

/* run the runner from the scratch root: { status, out, lines, ran: { name: record }, order: [names] } */
function run(repo, args, env = {}) {
  rmSync(join(repo.dir, "out"), { recursive: true, force: true });
  const r = spawnSync(process.execPath, ["tools/ci/live-run.mjs", ...args], {
    cwd: repo.dir, encoding: "utf8", timeout: 60000,
    env: { ...gitEnv, HOME: repo.dir, SITE, PW_WS_ENDPOINT, CALLER_MARK: "kept", ...env },
  });
  const out = (r.stdout || "") + (r.stderr || "");
  const ran = {};
  const outDir = join(repo.dir, "out");
  if (existsSync(outDir)) for (const f of readdirSync(outDir)) if (f.endsWith(".json")) {
    try { ran[f.slice(0, -5)] = JSON.parse(readFileSync(join(outDir, f), "utf8")); } catch { ran[f.slice(0, -5)] = {}; }
  }
  const order = existsSync(join(outDir, "order.log")) ? readFileSync(join(outDir, "order.log"), "utf8").split("\n").filter(Boolean) : [];
  return { status: r.status, out, lines: out.split("\n"), ran, order };
}
const brief = (r) => `exit ${r.status}; ran ${JSON.stringify(r.order)}; ${r.lines.filter((l) => l && !l.startsWith("{")).slice(0, 8).join(" | ")}`;
const line = (r, re) => r.lines.find((l) => re.test(l));
const S = "\\d+(?:\\.\\d+)?";

/* a merge request into dev, as GitLab sets it (as test-select-test's mr()) */
const mr = (repo, extra = {}) => ({
  CI: "true", GITLAB_CI: "true", CI_PIPELINE_SOURCE: "merge_request_event", CI_MERGE_REQUEST_IID: "7",
  CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: "feature/x", CI_MERGE_REQUEST_TARGET_BRANCH_NAME: "dev",
  CI_MERGE_REQUEST_DIFF_BASE_SHA: repo.base, CI_COMMIT_BEFORE_SHA: ZEROS, CI_COMMIT_SHA: git(repo.dir, "rev-parse", "HEAD"),
  ...extra,
});
const shard = (i, n) => ({ CI_NODE_INDEX: String(i), CI_NODE_TOTAL: String(n) });

try {
  for (const f of COPIED) check(`(precondition) tools/ci/${f} exists`, existsSync(join(here, f)), join(here, f));
  const repo = makeRepo();
  const B = repo.base;

  /* ---- D: sharding, by the plan --dry-run prints ---- */
  const plan = (name, browser, env, want) => {
    const r = run(repo, [browser, "--all", "--dry-run"], env);
    const got = line(r, /^shard \d+\/\d+: /);
    check(name, r.status === 0 && got === want, `got ${JSON.stringify(got)} (want ${JSON.stringify(want)}); ${brief(r)}`);
    return r;
  };
  /* firefox, longest first: alpha 50, bravo 40, charlie 30, delta 30 (charlie first by name), echo 20.
     Two bins: alpha->1 (50), bravo->2 (40), charlie->2 (70), delta->1 (80), echo->2 (90). */
  plan("D1 two shards, shard 1: the longest test, then each to the bin with the least planned time", "firefox", shard(1, 2), "shard 1/2: alpha, delta, planned 80 s");
  plan("D2 two shards, shard 2 (charlie before delta at 30 s each: ties by name)", "firefox", shard(2, 2), "shard 2/2: bravo, charlie, echo, planned 90 s");
  /* three bins: alpha->1 (50), bravo->2 (40), charlie->3 (30), delta->3 (60), echo->2 (60) */
  plan("D3 three shards, shard 1", "firefox", shard(1, 3), "shard 1/3: alpha, planned 50 s");
  plan("D4 three shards, shard 2", "firefox", shard(2, 3), "shard 2/3: bravo, echo, planned 60 s");
  plan("D5 three shards, shard 3", "firefox", shard(3, 3), "shard 3/3: charlie, delta, planned 60 s");
  /* chromium, by its own seconds: echo 40, bravo 30, delta 20, fox 10, alpha 5.
     echo->1 (40), bravo->2 (30), delta->2 (50), fox->1 (50), alpha: 50 and 50, the lowest index -> 1 (55) */
  plan("D6 the browser's own seconds decide (chromium, shard 1; bins of equal time: the lowest index)", "chromium", shard(1, 2), "shard 1/2: echo, fox, alpha, planned 55 s");
  plan("D7 chromium, shard 2", "chromium", shard(2, 2), "shard 2/2: bravo, delta, planned 50 s");
  plan("D8 no shard variables: one shard holding everything, longest first", "firefox", {}, "shard 1/1: alpha, bravo, charlie, delta, echo, planned 170 s");
  {
    /* five firefox tests in six bins: one each, the sixth empty */
    const r = run(repo, ["firefox", "--all", "--dry-run"], shard(6, 6));
    check("D9 a shard with nothing in it prints `0 of N selected` (N the map's tests) and exits 0", r.status === 0 && !!line(r, /\b0 of 6 selected\b/), brief(r));
    const r2 = run(repo, ["firefox", "--all"], shard(6, 6));
    check("D10 ... and run for real, it runs nothing and exits 0", r2.status === 0 && r2.order.length === 0 && !!line(r2, /\b0 of 6 selected\b/), brief(r2));
  }
  {
    const r = run(repo, ["firefox", "--all"], shard(2, 2));
    check("D11 run for real, a shard runs its own tests only, in the planned order", r.status === 0 && same(r.order, ["bravo", "charlie", "echo"]), `${brief(r)} (want ["bravo","charlie","echo"])`);
  }

  /* ---- S: selection ---- */
  {
    const r = run(repo, ["firefox", "--all"]);
    check("S1 --all in firefox runs every test that runs in firefox, and no other", r.status === 0 && sameSet(Object.keys(r.ran), FIREFOX), `${brief(r)} (want ${JSON.stringify(FIREFOX)})`);
    const c = run(repo, ["chromium", "--all"]);
    check("S2 --all in chromium runs every test that runs in chromium (charlie is firefox's only)", c.status === 0 && sameSet(Object.keys(c.ran), CHROMIUM), `${brief(c)} (want ${JSON.stringify(CHROMIUM)})`);
  }
  {
    branch(repo, "feature-a", B, { "src/a.js": "a2\n" });
    const r = run(repo, ["firefox", "--changed"], mr(repo));
    check("S3 --changed on a merge request changing src/a.js (group ga): alpha and charlie in firefox", r.status === 0 && sameSet(Object.keys(r.ran), ["alpha", "charlie"]), `${brief(r)} (want ["alpha","charlie"])`);
    check("S4 ... and the selection's account names the changed path, as test-select prints it", /src\/a\.js/.test(r.out), brief(r));
    const d = run(repo, ["firefox"], mr(repo));
    check("S5 no selection flag is --changed", d.status === 0 && sameSet(Object.keys(d.ran), ["alpha", "charlie"]), `${brief(d)} (want ["alpha","charlie"])`);
    const c = run(repo, ["chromium", "--changed"], mr(repo));
    check("S6 the same change in chromium: alpha alone (charlie does not run in chromium)", c.status === 0 && sameSet(Object.keys(c.ran), ["alpha"]), `${brief(c)} (want ["alpha"])`);
    const all = run(repo, ["firefox", "--changed"], mr(repo, { LIVE_ALL: "true" }));
    check("S7 --changed with LIVE_ALL=true: test-select says everything, so all of firefox's tests", all.status === 0 && sameSet(Object.keys(all.ran), FIREFOX), brief(all));
  }
  {
    branch(repo, "feature-docs", B, { "docs/guide.md": "g2\n" });
    const r = run(repo, ["firefox", "--changed"], mr(repo));
    check("S8 --changed on a docs-only merge request: nothing runs, `0 of N selected`, exit 0", r.status === 0 && r.order.length === 0 && !!line(r, /\b0 of 6 selected\b/), brief(r));
  }
  {
    branch(repo, "dev", B);
    branch(repo, "local-b", "dev", { "src/b.js": "b2\n" });
    const r = run(repo, ["firefox", "--changed", "--base", "dev"]);
    check("S9 --base is handed on to the selection (no CI, --base dev, src/b.js changed): bravo and delta", r.status === 0 && sameSet(Object.keys(r.ran), ["bravo", "delta"]), `${brief(r)} (want ["bravo","delta"])`);
    const c = run(repo, ["chromium", "--base", "dev"]);
    check("S10 ... and with no selection flag, in chromium: bravo and delta", c.status === 0 && sameSet(Object.keys(c.ran), ["bravo", "delta"]), `${brief(c)} (want ["bravo","delta"])`);
  }
  branch(repo, "plain", B);
  {
    const r = run(repo, ["firefox", "echo", "bravo"]);
    check("S11 TEST names run those tests and no other, in the planned order (bravo 40 s before echo 20 s)", r.status === 0 && same(r.order, ["bravo", "echo"]), `${brief(r)} (want ["bravo","echo"])`);
    const u = run(repo, ["firefox", "bravo", "nosuch"]);
    check("S12 a name not in the map exits 2 naming it, and runs nothing", u.status === 2 && /nosuch/.test(u.out) && u.order.length === 0, brief(u));
    const k = run(repo, ["firefox", "fox", "bravo"]);
    const said = k.lines.filter((l) => /\bfox\b/.test(l) && !l.startsWith("{"));
    check("S13 a named test that does not run in firefox (fox) is skipped with a line saying so; the rest run", k.status === 0 && same(k.order, ["bravo"]) && said.length >= 1, `${brief(k)}; lines naming fox: ${JSON.stringify(said)}`);
  }

  /* ---- E: what each test receives ---- */
  {
    const r = run(repo, ["firefox", "bravo"]);
    const env = r.ran.bravo?.env || {};
    const want = { BROWSER: "firefox", SITE, PW_WS_ENDPOINT, HEADED: "1", WEBGL: "required", LIBGL_ALWAYS_SOFTWARE: "1", CALLER_MARK: "kept" };
    const wrong = Object.entries(want).filter(([k, v]) => env[k] !== v).map(([k, v]) => `${k}=${JSON.stringify(env[k])} (want ${v})`);
    check("E1 a firefox test gets BROWSER, SITE, PW_WS_ENDPOINT, HEADED=1, WEBGL=required, LIBGL_ALWAYS_SOFTWARE=1 and the caller's own variables", r.status === 0 && !!r.ran.bravo && wrong.length === 0, wrong.length ? wrong.join("; ") : brief(r));
    const c = run(repo, ["chromium", "bravo"]);
    check("E2 a chromium test gets BROWSER=chromium", c.ran.bravo?.env?.BROWSER === "chromium", `BROWSER=${JSON.stringify(c.ran.bravo?.env?.BROWSER)}; ${brief(c)}`);
    const hookArg = (rec) => {
      const a = rec?.execArgv || [];
      return a.some((x, i) => (x === "--import" && /(^|\/)tools\/ci\/coverage-hook\.mjs$/.test(a[i + 1] || "")) || /^--import=.*(^|\/|=)tools\/ci\/coverage-hook\.mjs$/.test(x));
    };
    const cov = run(repo, ["chromium", "bravo", "echo"], { COVERAGE_DIR: join(repo.dir, "cov") });
    const both = ["bravo", "echo"].every((n) => hookArg(cov.ran[n]) && cov.ran[n].hook);
    check("E3 in chromium with COVERAGE_DIR set, every test runs with --import tools/ci/coverage-hook.mjs (and the hook loads)", cov.status === 0 && both, `execArgv ${JSON.stringify(["bravo", "echo"].map((n) => cov.ran[n]?.execArgv))}, hook loaded ${JSON.stringify(["bravo", "echo"].map((n) => cov.ran[n]?.hook))}; ${brief(cov)}`);
    check("E4 ... and COVERAGE_DIR reaches the test", cov.ran.bravo?.env?.COVERAGE_DIR === join(repo.dir, "cov"), JSON.stringify(cov.ran.bravo?.env?.COVERAGE_DIR));
    const nocov = run(repo, ["chromium", "bravo"]);
    check("E5 in chromium without COVERAGE_DIR: no --import, the hook not loaded", nocov.status === 0 && !!nocov.ran.bravo && !(nocov.ran.bravo.execArgv || []).some((x) => x.startsWith("--import")) && !nocov.ran.bravo.hook, `execArgv ${JSON.stringify(nocov.ran.bravo?.execArgv)}; ${brief(nocov)}`);
    const ff = run(repo, ["firefox", "bravo"], { COVERAGE_DIR: join(repo.dir, "cov") });
    check("E6 in firefox, even with COVERAGE_DIR set: no --import, the hook not loaded", ff.status === 0 && !!ff.ran.bravo && !(ff.ran.bravo.execArgv || []).some((x) => x.startsWith("--import")) && !ff.ran.bravo.hook, `execArgv ${JSON.stringify(ff.ran.bravo?.execArgv)}; ${brief(ff)}`);
  }

  /* ---- R: order and exit codes ---- */
  {
    const r = run(repo, ["firefox", "--all"], { FAKE_FAIL: "bravo" });
    check("R1 every test runs, in the planned order, though one failed", same(r.order, ["alpha", "bravo", "charlie", "delta", "echo"]), `${brief(r)} (want alpha, bravo, charlie, delta, echo)`);
    const recs = r.order.map((n) => r.ran[n]).filter(Boolean);
    const overlap = recs.slice(1).filter((x, i) => !(recs[i].end <= x.start)).map((x) => x.name);
    check("R2 one after another: no test starts before the one before it ended", recs.length === 5 && overlap.length === 0, overlap.length ? `overlapping: ${overlap.join(", ")}` : `${recs.length} records`);
    check("R3 a failed test that gates in firefox makes the exit 1 (once all five have run)", r.status === 1 && r.order.length === 5, brief(r));
    check("R4 `bravo: FAILED in S s` for the failure", !!line(r, new RegExp(`^bravo: FAILED in ${S} s$`)), brief(r));
    const oks = ["alpha", "charlie", "delta", "echo"].filter((n) => !line(r, new RegExp(`^${n}: ok in ${S} s$`)));
    check("R5 `<name>: ok in S s` for each test that passed", oks.length === 0, oks.length ? `no ok line for ${oks.join(", ")}` : "all four");
    check("R6 the closing line: `shard 1/1: planned 170 s, took S s`", !!line(r, new RegExp(`^shard 1/1: planned 170 s, took ${S} s$`)), brief(r));
  }
  {
    const r = run(repo, ["chromium", "--all"], { FAKE_FAIL: "delta" });
    check("R7 in chromium, a failed test that does not gate in chromium (delta): exit 0", r.status === 0 && r.order.length === CHROMIUM.length, brief(r));
    check("R8 ... and its line says `delta: FAILED (not gating in chromium) in S s`", !!line(r, new RegExp(`^delta: FAILED \\(not gating in chromium\\) in ${S} s$`)), brief(r));
    const r2 = run(repo, ["chromium", "--all"], { FAKE_FAIL: "delta,fox" });
    check("R9 a non-gating failure beside a gating one (fox gates in chromium): exit 1", r2.status === 1 && !!line(r2, new RegExp(`^fox: FAILED in ${S} s$`)), brief(r2));
    const r3 = run(repo, ["firefox", "--all"], { FAKE_FAIL: "delta" });
    check("R10 the same test failing in firefox, where it gates: exit 1, plain FAILED", r3.status === 1 && !!line(r3, new RegExp(`^delta: FAILED in ${S} s$`)), brief(r3));
    const r4 = run(repo, ["firefox", "--all"]);
    check("R11 every test passing: exit 0", r4.status === 0 && r4.order.length === FIREFOX.length, brief(r4));
    const r5 = run(repo, ["firefox", "--all"], { ...shard(2, 3), FAKE_FAIL: "alpha" });
    check("R12 a failure of a test in another shard does not reach this one (shard 2/3 runs bravo and echo)", r5.status === 0 && same(r5.order, ["bravo", "echo"]) && !!line(r5, new RegExp(`^shard 2/3: planned 60 s, took ${S} s$`)), brief(r5));
  }

  /* ---- N: --dry-run starts nothing ---- */
  {
    const r = run(repo, ["firefox", "--all", "--dry-run"]);
    check("N1 --all --dry-run: exit 0, and no test ran (no record written)", r.status === 0 && !existsSync(join(repo.dir, "out")), brief(r));
    const r2 = run(repo, ["chromium", "--all", "--dry-run"], { FAKE_FAIL: "bravo", COVERAGE_DIR: join(repo.dir, "cov") });
    check("N2 --dry-run in chromium with COVERAGE_DIR: exit 0, nothing ran", r2.status === 0 && !existsSync(join(repo.dir, "out")), brief(r2));
    const r3 = run(repo, ["firefox", "bravo", "--dry-run"]);
    check("N3 TEST names with --dry-run: the plan, nothing ran", r3.status === 0 && !existsSync(join(repo.dir, "out")) && line(r3, /^shard \d+\/\d+: /) === "shard 1/1: bravo, planned 40 s", brief(r3));
  }

  /* ---- U: usage ---- */
  {
    const r = run(repo, []);
    check("U1 no browser: exit 2, nothing ran", r.status === 2 && r.order.length === 0, brief(r));
    const r2 = run(repo, ["safari", "--all"]);
    check("U2 a browser other than firefox or chromium: exit 2, nothing ran", r2.status === 2 && r2.order.length === 0, brief(r2));
    const r3 = run(repo, ["firefox", "--bogus"]);
    check("U3 an unknown option: exit 2, nothing ran", r3.status === 2 && r3.order.length === 0, brief(r3));
  }
} catch (e) {
  check("the test ran to the end", false, String(e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
} finally {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
