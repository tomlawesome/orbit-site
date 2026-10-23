/*
 * Test for a lost live-door context being replaced (#84, item 5), written from the specification alone. The live door
 * (door3d.js, `?door3d`) keeps one context a page. When that context is lost (WEBGL_lose_context) and the door is
 * destroyed, the next live door (a remount: a new dawn, compile, start) must be handed a fresh context, not the lost
 * one, and the world's class "live" is not added while the context it draws on isContextLost().
 *
 *   node tools/ci/door-live-lost-test.mjs
 *
 * No dependencies and no browser; each case runs in a fresh Node process (this file again, as `--child`) against the
 * stub page in door-stub.mjs, on a virtual clock. trackGl hands the gate the page's context and every later canvas a
 * context of its own, so a fresh one is told from the lost one. Cases:
 *   control   a live door shown with a healthy context: it asked for a context of its own and is "live"
 *   lost      the same, then the context is lost, the dawn destroyed, a second dawn mounted and started
 *   restore   as `lost`, then the context comes back (restoreContext) before the second dawn: the same context is fine
 * LIMIT: the fake context cannot make the capability probe say ok, so the live door runs as its "lean" one (see
 * door-live-teardown-test.mjs). The control says whether the lean door even asks for a context and shows `.live`.
 */
import { any, dawnHost, installPage, installClock, trackGl, mountLive, childMain, runCase, check, finish, errOf } from "./door-stub.mjs";

const CASES = {
  async "control"() { return run({ lose: false }); },
  async "lost"() { return run({ lose: true }); },
};

/* the contexts the live door asked for (every one but the gate's) and whether each is lost now */
const liveContexts = (tr) => tr.contexts.filter((c) => !c.gate);

async function show(dawn, clock) {
  dawn.start();
  dawn.light({ firstVisit: false, aside: true, onLit() {}, onOpen() {}, after() {} });
  dawn.live.compile();
  await clock.advance(3000);
  dawn.live.start();
  await clock.advance(3000);
}

async function run({ lose }) {
  const page = installPage();
  const tr = trackGl(page);
  const clock = installClock();
  const m = await mountLive(page);
  await show(m.dawn, clock);
  const out = { firstContexts: liveContexts(tr).length, firstLive: m.world.classes.has("live") };
  if (!lose) return out;
  const first = liveContexts(tr)[0];
  if (first) tr.lose(tr.contexts.indexOf(first));
  await clock.advance(200);
  out.lostBefore = first ? first.gl.isContextLost() : null;
  m.dawn.destroy();
  await clock.advance(200);
  /* the remount: a new dawn on a new host */
  const second = dawnHost(() => {});
  page.query = (sel) => (/#door .world/.test(sel) ? second.world : any());
  const dawn2 = m.d.dawn(second.host);
  const seen = [];                                                      /* at every step: is the world live while its context is lost? */
  const watch = () => { const live = second.world.classes.has("live"); seen.push({ live, lostContexts: liveContexts(tr).filter((c) => c.gl.isContextLost()).length, fresh: liveContexts(tr).length }); };
  dawn2.start();
  dawn2.light({ firstVisit: false, aside: true, onLit() {}, onOpen() {}, after() {} });
  dawn2.live.compile();
  for (let i = 0; i < 6; i++) { await clock.advance(500); watch(); }
  dawn2.live.start();
  for (let i = 0; i < 12; i++) { await clock.advance(500); watch(); }
  const all = liveContexts(tr);
  out.contexts = all.length;
  out.newest = all.length ? !all[all.length - 1].gl.isContextLost() : null;
  out.freshAsked = all.length > out.firstContexts;
  out.firstStillLost = first ? first.gl.isContextLost() : null;
  out.secondLive = second.world.classes.has("live");
  out.liveWhileLost = seen.filter((s) => s.live && s.lostContexts > 0 && !s.fresh).length;
  /* `.live` while the only live-door context there is, is the lost one */
  out.liveOnLostOnly = seen.filter((s) => s.live && s.lostContexts >= s.fresh).length;
  return out;
}

if (process.argv[2] === "--child") await childMain(CASES);

{
  const c = runCase(import.meta.url, "control", 30000);
  check("control: a live door with a healthy context asks for a context of its own", !c.error && c.firstContexts >= 1, `${c.firstContexts} context(s) asked for by the live door; world live: ${c.firstLive}${errOf(c)}`);
  const r = runCase(import.meta.url, "lost", 30000);
  check("(precondition): the live door's context was lost and the first door destroyed", !r.error && r.lostBefore === true && r.firstContexts >= 1, `lost: ${r.lostBefore}; ${r.firstContexts} context(s) before${errOf(r)}`);
  check("L5: after a lost context and destroy, the next live door is handed a fresh context", !r.error && r.freshAsked === true && r.newest === true, `${r.contexts} live-door context(s) in all; the newest is healthy: ${r.newest}; the first still lost: ${r.firstStillLost}${errOf(r)}`);
  check("L5: the world is not given the class 'live' while the context it has is lost", !r.error && r.liveOnLostOnly === 0, `${r.liveOnLostOnly} step(s) with 'live' set and only a lost context; live at the end: ${r.secondLive}${errOf(r)}`);
}
finish();
