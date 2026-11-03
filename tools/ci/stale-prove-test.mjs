/*
 * Test for #89 item F, written from the specification alone: once a lost flight world is replaced, nothing left over
 * from the old world's warm-up may change the new one's state. The journey is reached through assets/door/index.js
 * alone. The flight world is swapped for a fake (fake-voyage.mjs, by Node's module hooks, in the child only).
 *
 *   S1 replaced   t=0 warm(); t=5 s world A dies and warm() again makes world B; the Earth's picture loads at 22 s;
 *                 warm() once more at 40 s. B is proved exactly once and never stopped.
 *   S2 control    the same without A dying: one world, proved exactly once.
 *
 *   node tools/ci/stale-prove-test.mjs
 *
 * Virtual clock only (door-stub.mjs installClock); each case runs in a fresh Node process.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { INDEX, installPage, installClock, childMain, check, finish, errOf } from "./door-stub.mjs";

async function mount(page) {
  const door = await import(INDEX);
  const d = door.createDoor({ typingWait: 0, flags: {} });
  door.openChores();
  return { door, journey: d.journey(page.journeyOptions()) };
}

async function scenario({ die }) {
  const page = installPage();
  const clock = installClock();
  const held = [];
  page.imageHook = (img) => { held.push(img); };               /* no picture fires load or error until the test says */
  const { journey } = await mount(page);
  const worlds = globalThis.__fakeWorlds || (globalThis.__fakeWorlds = []);
  const pump = () => { for (const w of worlds) while (w.pendingProves.length) w.pendingProves.shift()(); };
  const runTo = async (t) => {                                  /* one second at a time, proving what has been asked */
    while (clock.now() < t) { pump(); await clock.advance(Math.min(1000, t - clock.now())); }
    pump(); await clock.advance(0);
  };
  const out = {};
  journey.warm().catch(() => {});
  await runTo(5000);
  if (die) worlds[0].dead = true;
  journey.warm().catch(() => {});
  await runTo(22000);
  const earth = held.filter((i) => /dawn\/dawn\.webp|earth/i.test(String(i.src)));
  out.earthAsked = earth.length;
  for (const img of earth) img.fire("load");
  out.earthLoaded = earth.filter((i) => i.complete && !i.failed).length;
  await runTo(40000);
  journey.warm().catch(() => {});
  await runTo(60000);
  out.worlds = worlds.length;
  out.aStopped = worlds[0] ? worlds[0].stopCalls : -1;
  const last = worlds[worlds.length - 1];
  out.lastProved = last ? last.proveCalls : -1;
  out.lastStopped = last ? last.stopCalls : -1;
  out.bProved = worlds[1] ? worlds[1].proveCalls : -1;
  out.bStopped = worlds[1] ? worlds[1].stopCalls : -1;
  return out;
}

const CASES = {
  async replaced() { return scenario({ die: true }); },
  async control() { return scenario({ die: false }); },
};

if (process.argv[2] === "--child") await childMain(CASES);

function run(how) {
  const args = ["--import", fileURLToPath(new URL("./fake-voyage-register.mjs", import.meta.url)), fileURLToPath(import.meta.url), "--child", how];
  const r = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 50000 });
  const line = (r.stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) return { error: `the child printed no result (exit ${r.status}): ${(r.stderr || "").split("\n").slice(0, 3).join(" | ")}` };
  return JSON.parse(line.slice(7));
}

{
  const c = run("control");
  check("S2 control: without A dying there is one world, proved exactly once", !c.error && c.worlds === 1 && c.lastProved === 1 && c.lastStopped === 0, `${c.worlds} world(s); proved ${c.lastProved} time(s), stopped ${c.lastStopped}${errOf(c)}`);
  const r = run("replaced");
  check("S1 (precondition): two worlds were made, A stopped, the Earth's picture asked for and loaded", !r.error && r.worlds === 2 && r.aStopped >= 1 && r.earthAsked >= 1 && r.earthLoaded === r.earthAsked, `${r.worlds} world(s); A stopped ${r.aStopped}; Earth picture asked ${r.earthAsked}, loaded ${r.earthLoaded}${errOf(r)}`);
  check("S1: world B's prove (warm with prove) was called exactly once in all", !r.error && r.bProved === 1, `B proved ${r.bProved} time(s) (want 1)${errOf(r)}`);
  check("S1: world B was never stopped", !r.error && r.bStopped === 0, `B stopped ${r.bStopped} time(s) (want 0)${errOf(r)}`);
}
finish();
