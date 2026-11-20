/*
 * Release readiness for orbit-site (#156): a preflight gate for the one promotion this site has, `dev` into `main`.
 * Every check runs, none stops the others, and one report at the end says ready or not. The steps a release
 * follows are in docs/releasing.md; this script checks the ones a machine can.
 *
 *   node tools/ci/release-readiness.mjs --target main [--source <ref>] [--remote <name>]
 *
 * Exit 0 ready, 1 not ready, 2 a usage or internal error. `--source` is the ref whose tree is judged (default HEAD),
 * `--remote` the remote holding the target branch (default origin).
 *
 * The source BRANCH name (the `branches` check) is CI_MERGE_REQUEST_SOURCE_BRANCH_NAME when that is set, because
 * the merge request job runs with `--source HEAD`, a detached checkout with no branch name; otherwise it is the
 * name of the current branch (or of the ref given to --source).
 *
 * No dependencies. The checks are exported with made-up lookups so tools/ci/release-readiness-test.mjs needs
 * neither git nor a network; the real lookups below shell out to `git` with argument arrays, never a shell string.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const CHECKS = ["branches", "contains-target", "mirror-current", "release-record"];

const GUIDE_PATH = "docs/releasing.md";
const RECORD_DIR = "docs/releases";
const RECORD_NAME = /^docs\/releases\/\d{4}-\d{2}-\d{2}(-\d+)?\.md$/u;
// The public GitHub mirror GitLab pushes `main` to; the address is the one README.md gives for the site's repository.
const MIRROR_URL = "https://github.com/tomlawesome/orbit-site.git";
const STEP_WORDS = ["done", "not needed", "after merge"];

const errorText = (error) => String(error?.stderr || error?.message || error).trim().split("\n").at(-1);

/** The step numbers of a guide's `## Step N: title` headings, in the order written. */
export function guideSteps(text) {
  return [...String(text).matchAll(/^## Step (\d+):/gmu)].map((m) => Number(m[1]));
}

/** Judges a release record's text against the guide: `{ ok, message }`. */
export function checkRecord({ text, guideBlob, steps, lastCommit }) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { ok: false, message: `the guide (${GUIDE_PATH}) has no "## Step N: title" headings, so no record can match it: fix the guide first` };
  }
  const problems = [];
  const lines = String(text).split("\n").map((l) => l.replace(/\r$/u, ""));

  const blobs = lines.map((l) => /^guide-blob:\s*(\S*)\s*$/u.exec(l)).filter(Boolean).map((m) => m[1]);
  if (blobs.length === 0 || blobs[0] === "") {
    problems.push("it has no `guide-blob: <id>` line (get the id with git rev-parse HEAD:docs/releasing.md)");
  } else if (blobs[0] !== guideBlob) {
    problems.push(`its guide-blob ${blobs[0]} is not the current ${GUIDE_PATH} (${guideBlob}): the guide changed, so re-read it, redo the steps it changed and update the line`);
  }

  const found = [];
  for (const line of lines) {
    const m = /^step\s+(\d+)\s*:(.*)$/iu.exec(line);
    if (!m) continue;
    const n = Number(m[1]);
    found.push(n);
    const rest = m[2].trim();
    const word = STEP_WORDS.find((w) => rest.startsWith(`${w}:`));
    if (!word) problems.push(`step ${n} must read "step ${n}: done: ...", "step ${n}: not needed: ..." or "step ${n}: after merge: ..."`);
    else if (rest.slice(word.length + 1).trim() === "") problems.push(`step ${n} says "${word}" with no text after it: give the evidence, the owner's decision or what is to be done`);
  }
  const missing = steps.filter((n) => !found.includes(n));
  const extra = [...new Set(found.filter((n) => !steps.includes(n)))];
  const doubled = steps.filter((n) => found.filter((f) => f === n).length > 1);
  if (missing.length > 0) problems.push(`it leaves out guide step(s) ${missing.join(", ")}: one line per step`);
  if (extra.length > 0) problems.push(`it has line(s) for step(s) ${extra.join(", ")}, which the guide does not have`);
  if (doubled.length > 0) problems.push(`it has step(s) ${doubled.join(", ")} more than once`);
  if (missing.length === 0 && extra.length === 0 && doubled.length === 0 && found.join() !== steps.join()) {
    problems.push(`its step lines are out of order: the guide's order is ${steps.join(", ")}`);
  }

  const signers = lines.map((l) => /^Signed-off-by:\s*(.*?)\s*$/u.exec(l)).filter(Boolean).map((m) => m[1]);
  if (signers.length === 0) {
    problems.push('it has no Signed-off-by line: add "Signed-off-by: <your name>" and commit it with git commit --trailer "Signed-off-by: <your name>"');
  } else if (signers.length > 1) {
    problems.push("it has more than one Signed-off-by line: keep exactly one");
  } else if (signers[0] !== lastCommit?.author) {
    problems.push(`its Signed-off-by name "${signers[0]}" is not the author of the last commit that touched it ("${lastCommit?.author ?? ""}"): sign with your own name, as the committer`);
  } else if (!(lastCommit.trailers ?? []).includes(signers[0])) {
    problems.push(`the last commit that touched it has no "Signed-off-by: ${signers[0]}" trailer: commit with git commit --trailer "Signed-off-by: ${signers[0]}"`);
  }

  return problems.length === 0
    ? { ok: true, message: "the release record names the current guide, covers every step and is signed" }
    : { ok: false, message: `the release record: ${problems.join("; ")}` };
}

const checks = (lookups) => ({
  branches: async () => {
    const [source, target] = [await lookups.source(), await lookups.target()];
    return source === "dev" && target === "main"
      ? { ok: true, message: "dev into main" }
      : { ok: false, message: `a release is dev into main, not ${source} into ${target}: run this on dev with --target main` };
  },
  "contains-target": async () =>
    (await lookups.sourceHolds(await lookups.targetTip()))
      ? { ok: true, message: "dev holds everything on main" }
      : { ok: false, message: "main has changes dev lacks (a hotfix or an import merged into main?): merge main into dev by merge request, then run this again" },
  "mirror-current": async () => {
    const [mirror, tip] = [await lookups.mirrorTip(), await lookups.targetTip()];
    return mirror === tip
      ? { ok: true, message: "the public mirror's main equals GitLab's main" }
      : { ok: false, message: `the public mirror's main (${mirror}) is not GitLab's main (${tip}): the last release did not reach it; the push mirror is the owner's to fix, ask the owner` };
  },
  "release-record": async () => {
    const records = await lookups.newRecords();
    if (records.length === 0) return { ok: false, message: `no new release record: copy ${RECORD_DIR}/TEMPLATE.md to ${RECORD_DIR}/YYYY-MM-DD.md, fill it in and commit it on the batch that carries the release` };
    if (records.length > 1) return { ok: false, message: `${records.length} new release records (${records.join(", ")}): a release carries exactly one, remove the others` };
    const path = records[0];
    if (!RECORD_NAME.test(path)) return { ok: false, message: `${path} is not named ${RECORD_DIR}/YYYY-MM-DD.md (or YYYY-MM-DD-N.md for a second on one day): rename it` };
    const [text, guide, guideBlob, lastCommit] = [await lookups.read(path), await lookups.read(GUIDE_PATH), await lookups.guideBlob(), await lookups.lastCommit(path)];
    const result = checkRecord({ text, guideBlob, steps: guideSteps(guide), lastCommit });
    return result.ok ? { ok: true, message: `${path}: ${result.message}` } : { ok: false, message: `${path}: ${result.message}` };
  },
});

/** Runs every check; a lookup that throws fails its check, the rest still run. */
export async function runReadiness(lookups) {
  const table = checks(lookups);
  const results = [];
  for (const id of CHECKS) {
    let r;
    try {
      r = await table[id]();
    } catch (error) {
      r = { ok: false, message: `could not check: ${errorText(error)}. Fix that and run again` };
    }
    results.push({ id, ok: r.ok === true, message: r.message });
  }
  return { ready: results.every((r) => r.ok), results };
}

/** One line per check in CHECKS order, then the verdict. */
export function renderReport(results) {
  const rank = (id) => (CHECKS.includes(id) ? CHECKS.indexOf(id) : CHECKS.length);
  const ordered = [...results].sort((a, b) => rank(a.id) - rank(b.id));
  const lines = ordered.map((r) => `${r.ok ? "ok" : "FAIL"} ${r.id}: ${r.message}`);
  const failed = ordered.filter((r) => !r.ok);
  lines.push(failed.length === 0 ? "Ready: every check passed." : `Not ready: ${failed.length} of ${ordered.length} checks failed (${failed.map((r) => r.id).join(", ")})`);
  return lines.join("\n");
}

/** The lookups the command line uses: git (and git ls-remote against the mirror), arguments as arrays. */
function realLookups({ target, source, remote }) {
  const git = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 });
  const targetRef = `${remote}/${target}`;
  return {
    // (a remote's branch counts by its own name: `--source gitlab/dev --remote gitlab` is dev)
    source: () => process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME || git(["rev-parse", "--abbrev-ref", source]).trim().replace(new RegExp(`^${remote.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/`, "u"), ""),
    target: () => target,
    targetTip: () => git(["rev-parse", "--verify", `${targetRef}^{commit}`]).trim(),
    // Held when the commit is in the source's history, or when merging it in would change nothing: a promotion
    // leaves its own merge commit on main, which dev never has, yet nothing in it is missing from dev.
    sourceHolds: (commit) => {
      try {
        git(["merge-base", "--is-ancestor", commit, source]);
        return true;
      } catch (error) {
        if (error.status !== 1) throw error;
      }
      let merged;
      try {
        merged = git(["merge-tree", "--write-tree", source, commit]).split("\n")[0].trim();
      } catch (error) {
        if (error.status === 1) return false;   /* (a conflict: main has changes dev lacks) */
        throw error;
      }
      return merged === git(["rev-parse", `${source}^{tree}`]).trim();
    },
    mirrorTip: () => {
      const tip = git(["ls-remote", MIRROR_URL, "refs/heads/main"]).split(/\s/u)[0];
      if (!tip) throw new Error("the mirror has no main branch");
      return tip;
    },
    newRecords: () =>
      git(["diff", "--name-only", "--diff-filter=A", `${targetRef}...${source}`, "--", `${RECORD_DIR}/`])
        .split("\n").filter((p) => p !== "" && p !== `${RECORD_DIR}/TEMPLATE.md`),
    read: (path) => git(["show", `${source}:${path}`]),
    guideBlob: () => git(["rev-parse", `${source}:${GUIDE_PATH}`]).trim(),
    lastCommit: (path) => ({
      author: git(["log", "-1", "--format=%an", source, "--", path]).trim(),
      trailers: git(["log", "-1", "--format=%(trailers:key=Signed-off-by,valueonly)", source, "--", path]).split("\n").map((l) => l.trim()).filter(Boolean),
    }),
  };
}

function parseArgs(argv) {
  const options = { source: "HEAD", remote: "origin" };
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i]?.replace(/^--/u, "");
    if (!["target", "source", "remote"].includes(name) || !argv[i + 1] || argv[i].slice(0, 2) !== "--") throw new Error("usage: node tools/ci/release-readiness.mjs --target main [--source <ref>] [--remote <name>]");
    options[name] = argv[i + 1];
  }
  if (!options.target) throw new Error("usage: node tools/ci/release-readiness.mjs --target main [--source <ref>] [--remote <name>]");
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { ready, results } = await runReadiness(realLookups(parseArgs(process.argv.slice(2))));
    process.stdout.write(`${renderReport(results)}\n`);
    process.exitCode = ready ? 0 : 1;
  } catch (error) {
    process.stderr.write(`release-readiness: ${errorText(error)}\n`);
    process.exitCode = 2;
  }
}
