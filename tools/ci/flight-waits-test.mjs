/*
 * Tests for the flight's waits having a limit, and a flight world that died being replaced (#84, items 2 and 3), written
 * from the specification alone. The journey is reached through assets/door/index.js alone, as a host does.
 *
 *   W1 earth-control   the Earth's picture loads: warm() settles and the world is proved ("flight world: on")
 *   W2 earth-never     the Earth's picture never fires load or error: warm() settles within the limit (about 20 s) and
 *                      the world is NOT proved (no "flight world: on" line)
 *   W3 earth-retry     after W2, the picture works again: a later warm() tries again and proves the world
 *   W4 dead-control    a world proved; a pinned flight is drawn with it (draw calls on the GPU context)
 *   W5 dead-replaced   the world dies after warm() (the context is lost, then restored): a second warm() of the same
 *                      journey makes a new world (its shaders asked for again) and stops the old one (every picture
 *                      texture it made is deleted), and the next flight is drawn with the new world, not flat 2D
 *
 *   node tools/ci/flight-waits-test.mjs
 *
 * No dependencies and no browser; each case runs in a fresh Node process (this file again, as `--child`) against the
 * stub page in door-stub.mjs. Every wait runs on a virtual clock (installClock): the limit is 25000 ms of the page's
 * clock at most, and nothing depends on how fast the machine runs. A picture "never loads" through page.imageHook.
 */
import { INDEX, isProbeSrc, installPage, installClock, childMain, runCase, check, finish, errOf, sleep } from "./door-stub.mjs";

const LIMIT_MS = 25000;
const FIT = /flight world: on/;

const CASES = {
  async "earth-control"() { return earthCase({ never: false, retry: false }); },
  async "earth-never"() { return earthCase({ never: true, retry: false }); },
  async "earth-retry"() { return earthCase({ never: true, retry: true }); },
  async "dead-control"() { return deadCase({ lose: false }); },
  async "dead-replaced"() { return deadCase({ lose: true }); },
};

async function mount(page) {
  const door = await import(INDEX);
  const d = door.createDoor({ typingWait: 0, flags: {} });
  door.openChores();
  return { door, journey: d.journey(page.journeyOptions()) };
}

async function earthCase({ never, retry }) {
  const page = installPage();
  const clock = installClock();
  if (never) page.imageHook = () => {};                       /* no picture ever fires load or error */
  const { journey } = await mount(page);
  const out = {};
  let state = "pending";
  journey.warm().then(() => { state = "resolved"; }, () => { state = "rejected"; });
  await clock.advance(LIMIT_MS, () => state !== "pending");
  out.state = state; out.settledAt = clock.now();
  await clock.advance(2000);
  out.proved = page.lines.filter((l) => FIT.test(l)).length;
  out.offLines = page.lines.filter((l) => /flight world: off/.test(l));
  if (retry) {
    page.imageHook = (img) => { img.fire("load"); };           /* the picture works now */
    const before = page.lines.filter((l) => FIT.test(l)).length;
    let again = "pending";
    const asked = page.images.length;
    journey.warm().then(() => { again = "resolved"; }, () => { again = "rejected"; });
    /* the stub's pictures load on a real timer (door-stub.mjs: StubImage), so the picture asked for again is waited
       for, in real time, before the virtual clock runs on: else, with no other timer queued, the clock can jump
       straight past the picture's limit and the page sees it late again (a race in the harness, not the door) */
    for (let i = 0; i < 200 && !page.images.slice(asked).some((im) => im.complete); i++) { await clock.advance(0); await sleep(5); }
    await clock.advance(LIMIT_MS, () => again !== "pending" && page.lines.filter((l) => FIT.test(l)).length > before);
    out.again = again; out.provedAgain = page.lines.filter((l) => FIT.test(l)).length - before;
  }
  return out;
}

const made = (page) => page.shaders.filter((s) => !isProbeSrc(s.src)).length;

async function deadCase({ lose }) {
  const page = installPage();
  const clock = installClock();
  const { door, journey } = await mount(page);
  const out = {};
  let state = "pending";
  journey.warm().then(() => { state = "resolved"; }, () => { state = "rejected"; });
  await clock.advance(LIMIT_MS, () => state !== "pending");
  await clock.advance(2000);
  out.firstState = state;
  out.firstProved = page.lines.filter((l) => FIT.test(l)).length;
  out.firstMade = made(page);
  const oldMaps = [...page.mapTextures()];
  out.oldMaps = oldMaps.length;
  const frame = async () => {
    const draws = page.draws;
    journey.fly(door.UP, { title: "Orbit", subtitle: "to somewhere", at: 2000 });
    await clock.advance(500);
    const n = page.draws - draws;
    journey.reset();
    return n;
  };
  out.drawsBefore = await frame();
  if (!lose) return out;
  page.loseContext();                                         /* the world dies after warm() resolved */
  await clock.advance(200);
  out.lostLines = page.lines.filter((l) => /flight world: off: the context was lost/.test(l)).length;
  page.lost = false;                                          /* the browser restores the context */
  for (const fn of [...(page.canvasListeners.webglcontextrestored || [])]) fn({ type: "webglcontextrestored", preventDefault() {} });
  await clock.advance(200);
  const madeBefore = made(page), provedBefore = page.lines.filter((l) => FIT.test(l)).length;
  let again = "pending";
  journey.warm().then(() => { again = "resolved"; }, () => { again = "rejected"; });
  await clock.advance(LIMIT_MS, () => again !== "pending");
  await clock.advance(2000);
  out.again = again;
  out.newMade = made(page) - madeBefore;
  out.newProved = page.lines.filter((l) => FIT.test(l)).length - provedBefore;
  out.oldNotDeleted = oldMaps.filter((t) => !page.deletedTextures.includes(t)).length;
  out.drawsAfter = await frame();
  return out;
}

if (process.argv[2] === "--child") await childMain(CASES);

{
  const c = runCase(import.meta.url, "earth-control", 30000);
  check("W1 control: with the Earth's picture loading, warm() settles and the world is proved", !c.error && c.state !== "pending" && c.proved >= 1, `warm() ${c.state} at ${c.settledAt} ms; ${c.proved} 'flight world: on' line(s)${errOf(c)}`);
  const r = runCase(import.meta.url, "earth-never", 30000);
  check("W2: the Earth's picture never fires load or error: warm() settles within the limit", !r.error && r.state !== "pending", `warm() ${r.state} after ${r.settledAt} ms of the page's clock (want settled by ${LIMIT_MS} ms)${errOf(r)}`);
  check("W2: ... and the world is not marked proved", !r.error && r.proved === 0, `${r.proved} 'flight world: on' line(s) (want 0)${errOf(r)}`);
  const t = runCase(import.meta.url, "earth-retry", 30000);
  check("W3: once the picture works, a later warm() tries again and proves the world", !t.error && t.again && t.again !== "pending" && t.provedAgain >= 1, `second warm() ${t.again}; ${t.provedAgain} 'flight world: on' line(s) since (want 1 or more)${errOf(t)}`);
}
{
  const c = runCase(import.meta.url, "dead-control", 30000);
  check("W4 control: a proved world is made and a pinned flight is drawn with it", !c.error && c.firstProved >= 1 && c.firstMade >= 3 && c.drawsBefore > 0, `${c.firstMade} shader(s), ${c.firstProved} 'on' line(s), ${c.drawsBefore} draw call(s) for a pinned flight${errOf(c)}`);
  const r = runCase(import.meta.url, "dead-replaced", 30000);
  check("W5 (precondition): the world was proved, drawn, then lost with the context", !r.error && r.firstProved >= 1 && r.drawsBefore > 0 && r.lostLines >= 1, `proved ${r.firstProved}, draws ${r.drawsBefore}, 'context was lost' line(s) ${r.lostLines}${errOf(r)}`);
  check("W5: a second warm() of the same journey makes a new world", !r.error && r.again !== "pending" && r.newMade >= 3 && r.newProved >= 1, `second warm() ${r.again}; ${r.newMade} shader(s) asked for since; ${r.newProved} 'on' line(s) (want 3 and 1 or more)${errOf(r)}`);
  check("W5: ... and the old world is stopped (every picture texture it made is deleted)", !r.error && r.oldMaps >= 1 && r.oldNotDeleted === 0, `${r.oldNotDeleted} of ${r.oldMaps} texture(s) still alive${errOf(r)}`);
  check("W5: the next flight is drawn with the new world, not flat 2D", !r.error && r.drawsAfter > 0, `${r.drawsAfter} draw call(s) for a pinned flight after the new world (want over 0)${errOf(r)}`);
}
finish();
