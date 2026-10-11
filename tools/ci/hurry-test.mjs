/*
 * Test for hurryChores (#2, review finding): it adds to the wanted list, it does not replace it.
 *
 * The chores (assets/door/chores.js, reached through index.js as a host reaches them) are queued with
 * chore(fn, rest, tag) and done one at a time. hurryChores(tags) says which tags the flight wants now: those are done
 * before the rest, a frame apart. The site hurries ["flight", "docs"] for a flight to the docs, and the proving
 * warm() then hurries "flight" alone; the second call must not forget "docs" (the docs galaxy's test frame waited
 * about 6 s and the docs flight held at the warp).
 *
 *   node tools/ci/hurry-test.mjs
 *
 * No dependencies and no browser. One fresh Node process per case (the queue lives for the life of the page):
 * this file again as `--child`. A "flight" chore is held running while the second hurry is made, so the next pick is
 * made after both calls; the picks then show which tags were wanted. Order of completion is what is read: an unhurried
 * untagged chore comes before a "docs" one (the door's order puts the flight first and the rest after), so a "docs"
 * chore that is done before an untagged one was hurried.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const INDEX = "../../assets/door/index.js";
const IDLE_MS = 1500;

if (process.argv[2] === "--child") {
  const how = process.argv[3];
  /* a page's frame and idle callbacks: a frame is quick, a moment "idle" comes late, so work that waits for one is
     told from work done at once */
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 2);
  globalThis.requestIdleCallback = (f) => setTimeout(f, IDLE_MS);
  const { chore, hurryChores } = await import(INDEX);
  const at = {};
  let t0 = 0;
  let release;
  const held = new Promise((ok) => { release = ok; });
  const note = (name) => () => { at[name] = Math.round(performance.now() - t0); };
  const done = [
    chore(async () => { note("flight-1")(); await held; }, 0, "flight"),
    chore(note("untagged"), 0, ""),
    chore(note("docs"), 0, "docs"),
    chore(note("flight-2"), 0, "flight"),
  ];
  if (how === "twice") { hurryChores(["flight", "docs"]); hurryChores("flight"); }
  else if (how === "once") hurryChores(["flight", "docs"]);
  else if (how === "reverse") { hurryChores("flight"); hurryChores(["docs"]); }
  await new Promise((ok) => setTimeout(ok, 100));   /* the first flight chore is running; the picks come after it */
  t0 = performance.now();
  release();
  const timeout = new Promise((ok) => setTimeout(() => ok("timeout"), 12000));
  const r = await Promise.race([Promise.all(done).then(() => "done"), timeout]);
  console.log("RESULT " + JSON.stringify({ at, r }));
  process.exit(0);
}

let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};
const run = (how) => {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child", how], { encoding: "utf8", timeout: 40000 });
  const line = (r.stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) return { at: {}, r: `no result (exit ${r.status}): ${(r.stderr || "").split("\n").slice(0, 3).join(" | ")}` };
  return JSON.parse(line.slice(7));
};
/* hurried work is done within a few frames; work that waits for an idle moment comes IDLE_MS later or more */
const QUICK = IDLE_MS / 2;
const quick = (at, name) => at[name] !== undefined && at[name] < QUICK;

for (const [how, name] of [
  ["once", "control: hurryChores([flight, docs]) once: the docs and second flight chores are done at once"],
  ["twice", "hurryChores([flight, docs]) then hurryChores(flight): the docs chore is still hurried, done as soon as a flight one"],
  ["reverse", "hurryChores(flight) then hurryChores([docs]): both are wanted, both done at once"],
]) {
  const { at, r } = run(how);
  check(name, r === "done" && quick(at, "docs") && quick(at, "flight-2"), `done at (ms after the held chore ends) ${JSON.stringify(at)} (${r}); want docs and flight-2 under ${QUICK}`);
}
process.exit(failed ? 1 : 0);
