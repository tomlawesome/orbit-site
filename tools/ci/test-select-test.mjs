/*
 * Test for the merge-request selection (#95, ADR-0005 section 2, "The selection rule"), written from the ADR alone,
 * before tools/ci/test-select.mjs exists.
 *
 *   node tools/ci/test-select-test.mjs
 *
 * No dependencies and no browser. Each case is a scratch git repository holding a copy of tools/ci/test-select.mjs
 * and a map (tools/ci/test-map.json), with commits made for the case; the script runs from the scratch root with
 * `--json` and an environment built here from nothing (so the CI variables of the job running this test cannot leak
 * in). What it reads back: { all: <true when everything is selected>, tests: [<the selected test names>] }.
 *
 *   S   the four rules on a small invented map: a group's tests, the union, `none` adds nothing, `all`, the map and
 *       the script themselves, an unmapped file (and the reason printed), a test's own file, deletions, both sides
 *       of a rename
 *   P   where the changed paths come from: a merge request against CI_MERGE_REQUEST_DIFF_BASE_SHA (the target moving
 *       on does not count), promotion (dev -> main), the nightly import's merge request, LIVE_ALL=true, a push's
 *       range, a push whose before-SHA is all zeros, no CI at all, --base REF
 *   R   the real map (tools/ci/test-map.json) against the ADR's tables: which tests each group selects
 *   G   --group NAME (ADR-0005 section 3a): exactly `yes` when the selection is everything or NAME is among the matched
 *       groups, else exactly `no`, exit 0 either way; an error exits non-zero and prints no `no`; on the real map,
 *       the lint's own test selects `tooling` and the import's tests select `import`
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, "test-select.mjs");
const REAL_MAP = join(here, "test-map.json");
const ZEROS = "0".repeat(40);

let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};
const sorted = (a) => [...a].sort();
const sameSet = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

const scratch = [];
const gitEnv = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
const git = (dir, ...args) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], { cwd: dir, encoding: "utf8", env: { ...gitEnv, HOME: dir } });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const put = (dir, path, text) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); };

/* a scratch repository: the files given, the map, and the script (when it exists), committed as the base */
function makeRepo(map, files) {
  const dir = mkdtempSync(join(tmpdir(), "test-select-"));
  scratch.push(dir);
  git(dir, "init", "-q");
  for (const [p, t] of Object.entries(files)) put(dir, p, t);
  put(dir, "tools/ci/test-map.json", JSON.stringify(map, null, 2) + "\n");
  if (existsSync(SCRIPT)) { mkdirSync(join(dir, "tools/ci"), { recursive: true }); copyFileSync(SCRIPT, join(dir, "tools/ci/test-select.mjs")); }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  return { dir, base: git(dir, "rev-parse", "HEAD") };
}

/* a branch from `from` with one commit per change set: { write: { path: text }, rm: [path], mv: [[from, to]] } */
function branch(repo, name, from, ...changes) {
  git(repo.dir, "checkout", "-q", "-B", name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60), from);
  for (const c of changes) {
    for (const [p, t] of Object.entries(c.write || {})) put(repo.dir, p, t);
    for (const p of c.rm || []) git(repo.dir, "rm", "-q", p);
    for (const [a, b] of c.mv || []) { mkdirSync(dirname(join(repo.dir, b)), { recursive: true }); git(repo.dir, "mv", a, b); }
    git(repo.dir, "add", "-A");
    git(repo.dir, "commit", "-q", "--allow-empty", "-m", name);
  }
  return git(repo.dir, "rev-parse", "HEAD");
}

/* run the script: { status, out, err, sel } with sel the parsed --json answer, or null */
function select(repo, env = {}, args = ["--json"]) {
  const r = spawnSync(process.execPath, ["tools/ci/test-select.mjs", ...args], { cwd: repo.dir, encoding: "utf8", timeout: 30000, env: { ...gitEnv, HOME: repo.dir, ...env } });
  let sel = null;
  try { sel = JSON.parse((r.stdout || "").trim()); } catch { /* not JSON */ }
  return { status: r.status, out: r.stdout || "", err: r.stderr || "", sel };
}
const said = (r) => (r.sel ? `all ${r.sel.all}, tests ${JSON.stringify(sorted(r.sel.tests || []))}` : `exit ${r.status}, no JSON answer; ${(r.out + r.err).split("\n").slice(0, 3).join(" | ")}`);
/* the answer is exactly these tests, not everything */
const picks = (r, want) => r.status === 0 && r.sel && r.sel.all === false && sameSet(r.sel.tests || [], want);
/* the answer is everything: every test the map names */
const everything = (r, names) => r.status === 0 && r.sel && r.sel.all === true && sameSet(r.sel.tests || [], names);

/* a merge request into dev from a feature branch, as GitLab sets it (CI_COMMIT_BEFORE_SHA is all zeros there) */
const mr = (repo, extra = {}) => ({
  CI: "true", GITLAB_CI: "true", CI_PIPELINE_SOURCE: "merge_request_event", CI_MERGE_REQUEST_IID: "7",
  CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: "feature/x", CI_MERGE_REQUEST_TARGET_BRANCH_NAME: "dev",
  CI_MERGE_REQUEST_DIFF_BASE_SHA: repo.base, CI_COMMIT_BEFORE_SHA: ZEROS, CI_COMMIT_SHA: git(repo.dir, "rev-parse", "HEAD"),
  ...extra,
});
const push = (repo, before, extra = {}) => ({
  CI: "true", GITLAB_CI: "true", CI_PIPELINE_SOURCE: "push", CI_COMMIT_BRANCH: "dev",
  CI_COMMIT_BEFORE_SHA: before, CI_COMMIT_SHA: git(repo.dir, "rev-parse", "HEAD"), ...extra,
});

try {
  check("(precondition) tools/ci/test-select.mjs exists", existsSync(SCRIPT), SCRIPT);

  /* ---- S, P: an invented map, so the rules are judged apart from the site's own groups ---- */
  const entry = (file, groups) => ({ file, groups, browsers: ["firefox", "chromium"], gates: ["firefox", "chromium"], seconds: { firefox: 10, chromium: 10 } });
  const MAP = {
    groups: {
      all: ["core/**", "tools/ci/test-map.json", "tools/ci/test-select.mjs"],
      none: ["docs/**", "*.md"],
      alpha: ["src/a.js", "img/a/**"],
      beta: ["src/b.js"],
      shared: ["src/s.js"],
    },
    tests: {
      one: entry("tools/ci/one-test.mjs", ["alpha"]),
      two: entry("tools/ci/two-test.mjs", ["beta"]),
      three: entry("tools/ci/three.mjs", ["alpha", "beta"]),
      four: entry("tools/ci/four-test.mjs", ["shared"]),
    },
  };
  const ALL = Object.keys(MAP.tests);
  const repo = makeRepo(MAP, {
    "src/a.js": "a\n", "src/b.js": "b\n", "src/s.js": "s\n", "img/a/p.png": "alpha picture\n", "core/door.js": "door\n",
    "docs/guide.md": "guide\n", "docs/notes.txt": "notes\n", "README.md": "readme\n", "misc/odd.txt": "odd\n",
    "tools/ci/one-test.mjs": "1\n", "tools/ci/two-test.mjs": "2\n", "tools/ci/three.mjs": "3\n", "tools/ci/four-test.mjs": "4\n",
  });
  const B = repo.base;
  const s = (name, want, ...changes) => {
    branch(repo, name, B, ...changes);
    const r = select(repo, mr(repo));
    check(name, want === "all" ? everything(r, ALL) : picks(r, want), `${said(r)} (want ${want === "all" ? "everything" : JSON.stringify(sorted(want))})`);
    return r;
  };

  /* rule 4: the union of the matched groups' tests */
  s("S1 a file in one group selects that group's tests", ["one", "three"], { write: { "src/a.js": "a2\n" } });
  s("S2 a file in another group selects that group's tests", ["two", "three"], { write: { "src/b.js": "b2\n" } });
  s("S3 a group with one test selects only it", ["four"], { write: { "src/s.js": "s2\n" } });
  s("S4 two groups changed: the union of their tests", ["one", "two", "three"], { write: { "src/a.js": "a2\n", "src/b.js": "b2\n" } });
  s("S5 a glob in a group (img/a/**) selects it", ["one", "three"], { write: { "img/a/new.png": "new\n" } });
  /* `none`: mapped, adds nothing */
  s("S6 only `none` paths changed (docs/**, *.md): nothing selected, not everything", [], { write: { "docs/guide.md": "g2\n", "README.md": "r2\n" } });
  s("S7 a `none` path beside a group's file: `none` adds nothing and blocks nothing", ["four"], { write: { "docs/notes.txt": "n2\n", "src/s.js": "s2\n" } });
  /* rule 3: `all`, and the map's own machinery */
  s("S8 a path in `all` (core/**): everything", "all", { write: { "core/door.js": "door2\n" } });
  s("S9 a path in `all` beside a docs change: still everything", "all", { write: { "core/new.js": "n\n", "docs/guide.md": "g2\n" } });
  s("S10 the map itself changed: everything", "all", { write: { "tools/ci/test-map.json": JSON.stringify(MAP) + "\n" } });
  /* rule 3: an unmapped path runs everything, and the reason is printed */
  s("S11 a path matching no group (src/new.js): everything", "all", { write: { "src/new.js": "new\n" } });
  const unText = select(repo, mr(repo), []);
  check("S11 ... and the reason names the unmapped path", unText.status === 0 && /src\/new\.js/.test(unText.out + unText.err),
    `exit ${unText.status}; ${(unText.out + unText.err).split("\n").slice(0, 4).join(" | ")}`);
  s("S12 a changed tracked file matching no group (misc/odd.txt, in the base): everything", "all", { write: { "src/b.js": "b2\n", "misc/odd.txt": "odder\n" } });
  /* a test file maps to itself */
  s("S13 a test's own file (tools/ci/two-test.mjs) selects that test alone, and is not unmapped", ["two"], { write: { "tools/ci/two-test.mjs": "2b\n" } });
  s("S14 a test file not named -test (tools/ci/three.mjs) selects that test", ["three"], { write: { "tools/ci/three.mjs": "3b\n" } });
  s("S15 a test's own file beside a group's file: both", ["two", "four"], { write: { "tools/ci/two-test.mjs": "2b\n", "src/s.js": "s2\n" } });
  /* deletions and renames */
  s("S16 a deleted file selects its group's tests", ["two", "three"], { rm: ["src/b.js"] });
  s("S17 a deleted file in `all`: everything", "all", { rm: ["core/door.js"] });
  s("S18 a deleted `none` file: nothing", [], { rm: ["docs/notes.txt"] });
  s("S19 a file renamed out of a group (img/a/p.png -> docs/p.png): the group it left is selected", ["one", "three"], { mv: [["img/a/p.png", "docs/p.png"]] });
  s("S20 a file renamed into a group (docs/notes.txt -> img/a/notes.txt): the group it joined is selected", ["one", "three"], { mv: [["docs/notes.txt", "img/a/notes.txt"]] });
  s("S21 a file renamed from `all` into a group: everything", "all", { mv: [["core/door.js", "img/a/door.js"]] });

  /* ---- P: where the changed paths come from ---- */
  {
    /* the target branch moved on (src/b.js) after the merge request's base; the merge request changed src/a.js */
    const T = branch(repo, "target", B, { write: { "src/b.js": "b on dev\n" } });
    branch(repo, "feature", B, { write: { "src/a.js": "a2\n" } });
    const r = select(repo, mr(repo, { CI_MERGE_REQUEST_TARGET_BRANCH_SHA: T }));
    check("P1 a merge request compares with CI_MERGE_REQUEST_DIFF_BASE_SHA: the target's own later change does not count", picks(r, ["one", "three"]), `${said(r)} (want ["one","three"])`);
    check("P2 a merge request pipeline's all-zeros CI_COMMIT_BEFORE_SHA does not make it select everything", r.sel?.all === false, said(r));
  }
  {
    branch(repo, "promo", B, { write: { "docs/guide.md": "g2\n" } });
    const r = select(repo, mr(repo, { CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: "dev", CI_MERGE_REQUEST_TARGET_BRANCH_NAME: "main" }));
    check("P3 promotion (dev -> main), even docs-only: everything", everything(r, ALL), said(r));
    const imp = select(repo, mr(repo, { CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: "docs/import-2026-10-27", CI_MERGE_REQUEST_TARGET_BRANCH_NAME: "main" }));
    check("P4 a merge request into main from another branch (the nightly import) is not promotion: docs-only selects nothing", picks(imp, []), said(imp));
    branch(repo, "import", B, { write: { "src/s.js": "s2\n" } });
    const imp2 = select(repo, mr(repo, { CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: "docs/import-2026-10-27", CI_MERGE_REQUEST_TARGET_BRANCH_NAME: "main" }));
    check("P5 ... and it selects by the map like any merge request", picks(imp2, ["four"]), said(imp2));
    const fromDev = select(repo, mr(repo, { CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: "dev", CI_MERGE_REQUEST_TARGET_BRANCH_NAME: "feature/y" }));
    check("P6 a merge request from dev into another branch is not promotion", picks(fromDev, ["four"]), said(fromDev));
  }
  {
    branch(repo, "docsonly", B, { write: { "docs/guide.md": "g2\n" } });
    const r = select(repo, mr(repo, { LIVE_ALL: "true" }));
    check("P7 LIVE_ALL=true on a docs-only merge request: everything", everything(r, ALL), said(r));
    const off = select(repo, mr(repo));
    check("P8 the same merge request without LIVE_ALL: nothing", picks(off, []), said(off));
  }
  {
    /* a push to dev: the range CI_COMMIT_BEFORE_SHA..HEAD, every commit in it, not only the last */
    branch(repo, "dev", B, { write: { "src/a.js": "a2\n" } }, { write: { "README.md": "r2\n" } });
    const r = select(repo, push(repo, B));
    check("P9 a push selects from its whole range (an earlier commit's src/a.js counts)", picks(r, ["one", "three"]), `${said(r)} (want ["one","three"])`);
    const mid = git(repo.dir, "rev-parse", "HEAD~1");
    const r2 = select(repo, push(repo, mid));
    check("P10 ... and only from its range (a push of the README alone selects nothing)", picks(r2, []), said(r2));
    const z = select(repo, push(repo, ZEROS));
    check("P11 a push whose CI_COMMIT_BEFORE_SHA is all zeros (a branch's first push): everything", everything(z, ALL), said(z));
    const la = select(repo, push(repo, mid, { LIVE_ALL: "true" }));
    check("P12 LIVE_ALL=true on a push: everything", everything(la, ALL), said(la));
  }
  {
    branch(repo, "dev", B);
    branch(repo, "local", "dev", { write: { "src/b.js": "b2\n" } });
    const none = select(repo, {});
    check("P13 no CI at all and no --base: everything", everything(none, ALL), said(none));
    const based = select(repo, {}, ["--base", "dev", "--json"]);
    check("P14 no CI, --base dev: the change since dev", picks(based, ["two", "three"]), `${said(based)} (want ["three","two"])`);
    const sha = select(repo, {}, ["--base", B, "--json"]);
    check("P15 --base takes a commit too", picks(sha, ["two", "three"]), said(sha));
  }

  /* ---- G: --group NAME, for the lint jobs that run only when their group is selected ---- */
  {
    const GMAP = {
      groups: {
        all: ["core/**", "tools/ci/test-map.json", "tools/ci/test-select.mjs"],
        none: ["docs/**", "*.md"],
        tooling: ["tools/ci/lint.sh", "tools/ci/lint-test.sh"],
        other: ["src/o.js"],
      },
      tests: { web: entry("tools/ci/web-test.mjs", ["other"]) },
    };
    const grepo = makeRepo(GMAP, {
      "core/door.js": "door\n", "tools/ci/lint.sh": "l\n", "tools/ci/lint-test.sh": "lt\n", "src/o.js": "o\n",
      "docs/guide.md": "g\n", "tools/ci/web-test.mjs": "w\n",
    });
    const exactly = (r, word) => r.status === 0 && /^(yes|no)\n?$/.test(r.out) && r.out.trim() === word;
    const told = (r) => `exit ${r.status}, stdout ${JSON.stringify(r.out)}${r.err ? `, stderr ${JSON.stringify(r.err.split("\n")[0])}` : ""}`;
    const g = (name, word, write, env, args = ["--group", "tooling"]) => {
      branch(grepo, name, grepo.base, ...(write ? [{ write }] : []));
      const r = select(grepo, env ? env(grepo) : mr(grepo), args);
      check(name, exactly(r, word), `${told(r)} (want exactly ${word}, exit 0)`);
    };
    g("G1 a change in `all`: everything, so --group tooling prints yes", "yes", { "core/door.js": "door2\n" });
    g("G2 an unmapped path: everything, so yes", "yes", { "src/new.js": "n\n" });
    g("G3 LIVE_ALL=true on a docs-only change: yes", "yes", { "docs/guide.md": "g2\n" }, (r) => mr(r, { LIVE_ALL: "true" }));
    g("G4 promotion (dev -> main), docs-only: yes", "yes", { "docs/guide.md": "g2\n" }, (r) => mr(r, { CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: "dev", CI_MERGE_REQUEST_TARGET_BRANCH_NAME: "main" }));
    g("G5 no CI and no --base: everything, so yes", "yes", { "src/o.js": "o2\n" }, () => ({}));
    g("G6 a changed path matched tooling (tools/ci/lint.sh): yes", "yes", { "tools/ci/lint.sh": "l2\n" });
    g("G7 the lint's own test matched tooling (tools/ci/lint-test.sh): yes", "yes", { "tools/ci/lint-test.sh": "lt2\n" });
    g("G8 tooling beside another group: yes", "yes", { "tools/ci/lint.sh": "l2\n", "src/o.js": "o2\n" });
    g("G9 only another group matched (src/o.js in other): no", "no", { "src/o.js": "o2\n" });
    g("G10 only `none` matched (docs-only): no", "no", { "docs/guide.md": "g2\n" });
    g("G11 only a test's own file changed: no", "no", { "tools/ci/web-test.mjs": "w2\n" });
    g("G12 --group other where other matched: yes", "yes", { "src/o.js": "o2\n" }, null, ["--group", "other"]);
    g("G13 --group other where only tooling matched: no", "no", { "tools/ci/lint.sh": "l2\n" }, null, ["--group", "other"]);
    {
      branch(grepo, "dev", grepo.base);
      branch(grepo, "local-tooling", "dev", { write: { "tools/ci/lint.sh": "l2\n" } });
      const y = select(grepo, {}, ["--base", "dev", "--group", "tooling"]);
      check("G14 with --base dev, no CI: tooling changed, yes", exactly(y, "yes"), told(y));
      const n = select(grepo, {}, ["--group", "other", "--base", "dev"]);
      check("G15 ... and the options in either order: --group other prints no", exactly(n, "no"), told(n));
    }
    {
      /* a map that cannot be read: an error, never a `no` that would skip the lint's test */
      branch(grepo, "broken-map", grepo.base, { write: { "tools/ci/lint.sh": "l2\n", "tools/ci/test-map.json": "{ not json\n" } });
      const r = select(grepo, mr(grepo), ["--group", "tooling"]);
      check("G16 an error (the map unreadable) exits non-zero and does not print no", r.status !== 0 && !/^no$/m.test(r.out), told(r));
    }
  }
  if (existsSync(REAL_MAP)) {
    /* the real map: the lint's own test and the import's tests are in their groups (section 3a) */
    const real = JSON.parse(readFileSync(REAL_MAP, "utf8"));
    const names = Object.keys(real.tests || {});
    const rr = makeRepo(real, {
      "tools/ci/lint-test.sh": "lt\n", "tools/ci/import-docs-test.mjs": "it\n", "tools/ci/raw-heading-test.mjs": "rh\n",
      "tools/ci/nightly-import-test.sh": "ni\n", "README.md": "r\n",
    });
    const told = (r) => `exit ${r.status}, stdout ${JSON.stringify(r.out.split("\n").slice(0, 2).join(" | "))}`;
    const groupSays = (r, word) => r.status === 0 && r.out.trim() === word;
    const realCase = (label, path, yesGroup, noGroup, wantTests) => {
      branch(rr, label, rr.base, { write: { [path]: "changed\n" } });
      const y = select(rr, mr(rr), ["--group", yesGroup]);
      check(`${label} ${path} alone: --group ${yesGroup} prints yes`, groupSays(y, "yes"), told(y));
      const n = select(rr, mr(rr), ["--group", noGroup]);
      check(`${label} ... --group ${noGroup} prints no`, groupSays(n, "no"), told(n));
      const j = select(rr, mr(rr));
      check(`${label} ... and selects ${wantTests.length ? JSON.stringify(wantTests) : "no browser test"}, not everything`, picks(j, wantTests), `${said(j)} (of ${names.length})`);
    };
    realCase("G17", "tools/ci/lint-test.sh", "tooling", "import", []);
    /* the import group holds the dropped-warning browser test (section 2's table), so the import's tests select it */
    realCase("G18", "tools/ci/import-docs-test.mjs", "import", "tooling", ["dropped-warning"]);
    realCase("G19", "tools/ci/raw-heading-test.mjs", "import", "tooling", ["dropped-warning"]);
    realCase("G20", "tools/ci/nightly-import-test.sh", "import", "tooling", ["dropped-warning"]);
    {
      branch(rr, "G21", rr.base, { write: { "README.md": "r2\n" } });
      const r = select(rr, mr(rr), ["--group", "tooling"]);
      check("G21 README.md alone (none): --group tooling prints no", groupSays(r, "no"), told(r));
    }
  }

  /* ---- R: the real map against the ADR's tables (section 2) ---- */
  check("(precondition) tools/ci/test-map.json exists", existsSync(REAL_MAP), REAL_MAP);
  if (existsSync(REAL_MAP)) {
    const real = JSON.parse(readFileSync(REAL_MAP, "utf8"));
    const TABLE = {
      journey: [["page", "home", "docs", "worlds", "flight"], ["firefox", "chromium"]],
      csp: [["page", "docs"], ["firefox", "chromium"]],
      "phone-door": [["page", "worlds"], ["firefox", "chromium"]],
      "site-browser": [["page", "home", "docs", "worlds"], ["firefox", "chromium"]],
      freeze: [["page", "worlds"], ["chromium"]],
      "flight-context-loss": [["page", "flight"], ["firefox", "chromium"]],
      "docs-planet": [["page", "worlds", "flight"], ["chromium"]],
      "docs-sky-portrait-live": [["page", "flight"], ["chromium"]],
      "door-lows": [["page"], ["firefox", "chromium"]],
      upload: [["harness"], ["firefox", "chromium"]],
      dawn: [["harness"], ["firefox"]],
      asdawn: [["harness"], ["firefox"]],
      "dropped-warning": [["import"], ["chromium"]],
    };
    const names = Object.keys(real.tests || {});
    check("R1 the map's tests are the ADR's thirteen browser tests (pin is not one: it left the browser)", sameSet(names, Object.keys(TABLE)), JSON.stringify(sorted(names)));
    const wrong = Object.entries(TABLE).filter(([n, [g, b]]) => !real.tests?.[n] || !sameSet(real.tests[n].groups || [], g) || !sameSet(real.tests[n].browsers || [], b)).map(([n]) => n);
    check("R2 each test's groups and browsers are as the ADR's table", wrong.length === 0, wrong.length ? `differ: ${wrong.join(", ")}` : "all as the table");
    const gates = Object.entries(real.tests || {}).filter(([n, t]) => !sameSet(t.gates || [], n === "site-browser" ? ["firefox"] : t.browsers || [])).map(([n]) => n);
    check("R3 every test gates in each browser it runs in, but site-browser in Firefox only (19a)", gates.length === 0, gates.length ? `differ: ${gates.join(", ")}` : "as decided");

    const realRepo = makeRepo(real, {
      "assets/js/home.js": "h\n", "assets/js/pads.js": "p\n", "assets/js/journeys.js": "j\n", "assets/js/main.js": "m\n",
      "assets/door/journey.js": "d\n", "index.html": "i\n", "tests/upload.html": "u\n", "tools/import-docs.mjs": "x\n",
      "tools/ci/lint.sh": "l\n", "README.md": "r\n", "docs/adr/0001.md": "a\n",
    });
    const RALL = names;
    const r = (name, want, change) => {
      branch(realRepo, name, realRepo.base, change);
      const got = select(realRepo, mr(realRepo));
      check(name, want === "all" ? everything(got, RALL) : picks(got, want), `${said(got)} (want ${want === "all" ? "everything" : JSON.stringify(sorted(want))})`);
    };
    r("R4 assets/js/home.js (home): journey and site-browser", ["journey", "site-browser"], { write: { "assets/js/home.js": "h2\n" } });
    r("R5 assets/js/pads.js (docs): journey, csp, site-browser", ["journey", "csp", "site-browser"], { write: { "assets/js/pads.js": "p2\n" } });
    r("R6 assets/js/journeys.js (flight): journey, flight-context-loss, docs-planet, docs-sky-portrait-live", ["journey", "flight-context-loss", "docs-planet", "docs-sky-portrait-live"], { write: { "assets/js/journeys.js": "j2\n" } });
    r("R7 index.html (page): every page test, not the harness or import tests", ["journey", "csp", "phone-door", "site-browser", "freeze", "flight-context-loss", "docs-planet", "docs-sky-portrait-live", "door-lows"], { write: { "index.html": "i2\n" } });
    r("R8 tests/upload.html (harness): upload, dawn, asdawn", ["upload", "dawn", "asdawn"], { write: { "tests/upload.html": "u2\n" } });
    r("R9 tools/import-docs.mjs (import): dropped-warning", ["dropped-warning"], { write: { "tools/import-docs.mjs": "x2\n" } });
    r("R10 tools/ci/lint.sh (tooling): no browser test", [], { write: { "tools/ci/lint.sh": "l2\n" } });
    r("R11 README.md and docs/** (none): no browser test", [], { write: { "README.md": "r2\n", "docs/adr/0001.md": "a2\n" } });
    r("R12 a door file (assets/door/**): everything", "all", { write: { "assets/door/journey.js": "d2\n" } });
    r("R13 a new site module (assets/js/new.js, listed file by file on purpose): everything", "all", { write: { "assets/js/new.js": "n\n" } });
    r("R14 a test's own file (tools/ci/csp-test.mjs): csp alone", ["csp"], { write: { "tools/ci/csp-test.mjs": "c\n" } });
  }
} catch (e) {
  check("the test ran to the end", false, String(e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
} finally {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
