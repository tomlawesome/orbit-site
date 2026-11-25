/*
 * Test for #165 (freeze 5 misses chores started in one frame), written from the specification alone: the test export
 * choresNow() (assets/door/chores.js, read by tools/ci/freeze.mjs once an animation frame) reports every start as it
 * happens, so a reader that looks once for a whole run of chained chores still sees each one. Today it gives only the
 * counter `started`, and freeze.mjs infers the starts from what was queued at the last frame and is gone at this one,
 * which loses every chore that was queued and started within one frame.
 *
 *   node tools/ci/chores-starts-test.mjs
 *
 * The hook: choresNow().starts, an array, in start order, one entry per chore started since the page began, each
 * { tag, soft, open }: tag the chore's tag as `queued` spells it (a list of tags joined by "+"), soft whether it was
 * queued soft, open whether the queue was open when it started. Every case reads choresNow() once, after the whole
 * run, with no frame read between.
 *
 *   S1  five hard chores (tags flight, docs, info, sharp, galaxy), the queue unpaced (pace("none"): each starts the
 *       moment the last ends) and opened, read once afterwards: `started` 5 and `starts` lists all five in order,
 *       soft false, open true
 *   S2  three soft chores and two hard ones, queued and opened on the page's queue, read once afterwards: all five
 *       listed, the soft flag of each as queued (a soft chore is reported soft, a hard one is not)
 *   S3  before the queue opens: a soft chore under openSoft (the reveal) and a "compile" chore under openCompiles
 *       start with open false; a chore queued with the queue shut never starts, and so is not listed; once opened
 *       it starts with open true
 *   S4  `starts` is the same length as `started`, and an entry's fields are exactly tag, soft, open
 */
import { INDEX, installPage, installClock, childMain, runCase, chk, finish } from "./door-stub.mjs";

async function setup({ none = false } = {}) {
  installPage();
  const clock = installClock();
  const { choresNow } = await import("../../assets/door/chores.js");
  const door = await import(INDEX);
  door.createDoor({ typingWait: 0, flags: {} });
  if (none) door.pace("none");
  return { clock, door, choresNow };
}

const noop = () => {};

const CASES = {
  async s1() {
    const { clock, door, choresNow } = await setup({ none: true });
    for (const t of ["flight", "docs", "info", "sharp", "galaxy"]) door.chore(noop, 0, t);
    door.openChores();
    await clock.advance(1000);
    const q = choresNow();
    return { started: q.started, starts: q.starts ?? null };
  },
  async s2() {
    const { clock, door, choresNow } = await setup();
    door.chore(noop, 0, "docs", { soft: true });
    door.chore(noop, 0, "flight");
    door.chore(noop, 0, "info", { soft: true });
    door.chore(noop, 0, "sharp");
    door.chore(noop, 0, "galaxy", { soft: true });
    door.openChores();
    await clock.advance(5000);
    const q = choresNow();
    return { started: q.started, starts: q.starts ?? null };
  },
  async s3() {
    const { clock, door, choresNow } = await setup();
    door.chore(noop, 0, "compile");
    door.chore(noop, 0, "docs", { soft: true });
    door.chore(noop, 0, "flight");
    door.openCompiles();
    await clock.advance(1000);
    const afterCompiles = choresNow();
    door.openSoft();
    await clock.advance(1000);
    const afterSoft = choresNow();
    const held = { started: afterSoft.started, queued: afterSoft.queued.slice() };
    door.openChores();
    await clock.advance(1000);
    const q = choresNow();
    return { afterCompiles: { started: afterCompiles.started, starts: afterCompiles.starts ?? null }, held, starts: q.starts ?? null, started: q.started };
  },
};

if (process.argv[2] === "--child") await childMain(CASES);

const spell = (s) => (s || []).map((e) => `${e.tag}/${e.soft ? "soft" : "hard"}/${e.open ? "open" : "shut"}`).join(" ");
const same = (s, want) => Array.isArray(s) && s.length === want.length && want.every(([tag, soft, open], i) => s[i] && s[i].tag === tag && s[i].soft === soft && s[i].open === open);

{
  const r = runCase(import.meta.url, "s1");
  chk("S1 control: the five chained hard chores all ran (started 5)", r, (r) => [r.started === 5, `started ${r.started}`]);
  chk("S1 choresNow().starts lists each start with its tag, soft false and open true, in order", r, (r) => [same(r.starts, [["flight", false, true], ["docs", false, true], ["info", false, true], ["sharp", false, true], ["galaxy", false, true]]), `starts: ${r.starts ? spell(r.starts) : "no `starts` property"}`]);
}
{
  const r = runCase(import.meta.url, "s2");
  chk("S2 control: all five ran", r, (r) => [r.started === 5, `started ${r.started}`]);
  chk("S2 every start is listed once, whichever order the queue chose", r, (r) => [Array.isArray(r.starts) && r.starts.length === 5 && ["docs", "flight", "info", "sharp", "galaxy"].every((t) => r.starts.filter((e) => e.tag === t).length === 1), `starts: ${r.starts ? spell(r.starts) : "no `starts` property"}`]);
  chk("S2 a soft chore is reported soft and a hard one is not", r, (r) => {
    const soft = { docs: true, flight: false, info: true, sharp: false, galaxy: true };
    return [Array.isArray(r.starts) && r.starts.length === 5 && r.starts.every((e) => e.soft === soft[e.tag] && e.open === true), `starts: ${r.starts ? spell(r.starts) : "no `starts` property"}`];
  });
}
{
  const r = runCase(import.meta.url, "s3");
  chk("S3 control: with the queue shut, the compile and the soft chore ran and the hard one waited", r, (r) => [r.afterCompiles.started >= 1 && r.held.started === 2 && r.held.queued.join() === "flight", `after compiles ${r.afterCompiles.started}; after soft ${r.held.started}, queued ${r.held.queued}`]);
  chk("S3 starts before the queue opens are listed, open false: the compile (hard) and the soft chore", r, (r) => [Array.isArray(r.starts) && same(r.starts.slice(0, 2), [["compile", false, false], ["docs", true, false]]), `starts: ${r.starts ? spell(r.starts) : "no `starts` property"}`]);
  chk("S3 the chore that waited for the opening starts open true, and the three are all listed", r, (r) => [r.started === 3 && Array.isArray(r.starts) && r.starts.length === 3 && same(r.starts.slice(2), [["flight", false, true]]), `started ${r.started}; starts: ${r.starts ? spell(r.starts) : "no `starts` property"}`]);
}
{
  const r = runCase(import.meta.url, "s1");
  chk("S4 starts is as long as started, each entry exactly tag, soft and open", r, (r) => [Array.isArray(r.starts) && r.starts.length === r.started && r.starts.every((e) => Object.keys(e).sort().join() === "open,soft,tag"), `started ${r.started}; starts: ${r.starts ? JSON.stringify(r.starts[0]) : "no `starts` property"}`]);
}
finish();
