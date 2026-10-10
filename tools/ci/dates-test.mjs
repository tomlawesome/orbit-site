/*
 * Test for the saved dates (assets/js/data.js): an item's due and completed
 * days survive serialise() then hydrate() unchanged, and the saved dueDate is
 * the item's local calendar day, in zones ahead of, level with and behind UTC.
 *
 *   node tools/ci/dates-test.mjs
 *
 * No dependencies. The test runs itself once per zone (TZ is read when the
 * process starts) and fails if any child fails.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ZONES = ["Asia/Tokyo", "Europe/London", "Pacific/Honolulu"];

if (process.argv[2] !== "child") {
  let failed = false;
  for (const tz of ZONES) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "child"], { env: { ...process.env, TZ: tz }, encoding: "utf8" });
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
    if (r.status !== 0) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

const tz = process.env.TZ;
const { households, serialise, hydrate } = await import("../../assets/js/data.js");

const items = () => Object.values(households).flatMap((h) => h.items);
const times = () => new Map(items().map((i) => [i.id, [i.dueDate?.getTime() ?? null, i.completedOn?.getTime() ?? null]]));
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${tz} ${name}: ${detail}`);
  if (!ok) failed = true;
};

const before = times();
const beforeDays = new Map(items().filter((i) => i.dueDate).map((i) => [i.id, ymd(i.dueDate)]));
const saved = serialise();
const wrong = Object.values(saved.households).flat().filter((s) => s.dueDate && s.dueDate !== beforeDays.get(s.id));
check("saved dueDate is the local day", wrong.length === 0,
  wrong.length ? `${wrong[0].id} saved ${wrong[0].dueDate}, local day ${beforeDays.get(wrong[0].id)} (${wrong.length} wrong)` : `${beforeDays.size} items`);

hydrate(saved);
const after = times();
const moved = [...before].filter(([id, t]) => after.get(id)?.[0] !== t[0] || after.get(id)?.[1] !== t[1]);
check("serialise then hydrate keeps every time", moved.length === 0 && after.size === before.size,
  moved.length ? `${moved[0][0]} moved by ${(after.get(moved[0][0])?.[0] ?? 0) - (moved[0][1][0] ?? 0)} ms (${moved.length} moved)` : `${before.size} items`);

process.exit(failed ? 1 : 0);
