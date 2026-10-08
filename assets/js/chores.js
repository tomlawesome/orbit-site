/*
 * The site's background work, done a piece at a time.
 *
 * Readying the journeys is heavy for the page: pictures put on the GPU, shaders made, frames drawn to measure the
 * machine. Done all at once it stutters whatever is moving. So each piece is a chore, queued here and done one at
 * a time, each in a pause between frames, with a few frames' rest between one and the next, and none at all until
 * the painted part of the door's reveal is done (open). The network is not a chore: pictures are fetched (and decoded) as soon
 * as they are asked for, off the page's own thread; only what touches the page or the GPU waits its turn.
 *
 * When a journey is chosen, what that journey still needs is done straight away (hurry), a frame between each piece,
 * hidden in the journey's opening; everything else is put off until the journey is under way (the chores are
 * tagged by what they ready: "flight", "docs", "install", "info"), so nothing it does not need stalls it. The
 * measures (frames timed to fit the drawing to the machine: "measure") are never hurried, and the live door's wait
 * for the queue to be at rest (quiet) before they time anything. Where the browser compiles shaders on the page's
 * own thread (COMPILES_ASIDE false), every compile is a chore tagged "compile", and those alone may run from the
 * page's start (openCompiles), under the first light's ring, before the door is lit; the rest still wait for open.
 */
const queue = [];
let open = false, compiling = false, running = false, want = null, until = 0, wake = 0, started = 0, openedAt = 0;

/* whether this browser compiles shaders in the background (KHR_parallel_shader_compile). Where it does not (Firefox),
   every compile freezes the page for as long as it takes (measured: even the compositor's animations stall), so each
   is a chore tagged "compile", all of them done while the first light's ring runs, before the door is lit
   (openCompiles; main.js waits for them), where only the ring's runner can show the hitch. Asked of a context
   made for the purpose and let go at once (Safari keeps only a few). &mainthread: as if it did not (to try the Firefox
   path in another browser) */
export const COMPILES_ASIDE = (() => {
  try {
    if (/[?&]mainthread\b/.test(location.search)) return false;
    const gl = document.createElement("canvas").getContext("webgl2"); if (!gl) return true;
    const ok = !!gl.getExtension("KHR_parallel_shader_compile"); gl.getExtension("WEBGL_lose_context")?.loseContext(); return ok;
  } catch { return true; }
})();
/* a pause between frames, but never waited on long: while the door moves the browser may rarely call a moment idle */
const idle = (fn) => (typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 120 }) : setTimeout(fn, 30));
/* the order the rest are done in, when no journey has been chosen: the compiles before anything (only where they
   freeze the page: COMPILES_ASIDE; elsewhere nothing is tagged so; and before open, nothing else), then the journeys
   (a visitor can do nothing until one is ready), then the live door (door3d.js: its picture is already on screen),
   the measures, the docs' galaxy where it compiles in the background (voyage.js: after the door is live; the docs'
   journey still hurries it), and last of all the rich clouds, which nothing waits for */
const ORDER = ["compile", "install", "flight", "docs", "info", "", "door", "measure", "galaxy", "rich"];
/* a chore's tag may be a list: ranked by its first ("compile"), hurried by any (the journey the compile is for) */
const tags = (tag) => [].concat(tag);
const rank = (tag) => { const i = ORDER.indexOf(tags(tag)[0]); return i < 0 ? ORDER.length : i; };

function pump() {
  if (running || !queue.length) return;
  const now = performance.now();
  /* what the chosen journey needs, first */
  let i = want ? queue.findIndex((j) => tags(j.tag).some((t) => want.includes(t))) : -1;
  const hurried = i >= 0;
  if (!hurried) {
    if (!open && !compiling) return;
    /* the rest waits until the journey has had its opening */
    if (now < until) { clearTimeout(wake); wake = setTimeout(pump, until - now + 20); return; }
    i = 0;
    for (let k = 1; k < queue.length; k++) if (rank(queue[k].tag) < rank(queue[i].tag)) i = k;
    /* before open, a compile or nothing ("compile" ranks first, so if there is one, this is it) */
    if (!open && tags(queue[i].tag)[0] !== "compile") return;
  }
  running = true;
  const run = () => {
    const [job] = queue.splice(Math.min(i, queue.length - 1), 1);
    started++;
    let out;
    try { out = job.fn(); } catch (e) { out = Promise.reject(e); }
    Promise.resolve(out).then(job.resolve, job.reject).finally(() => {
      running = false;
      /* a rest between chores: a frame or so, so whatever is moving keeps moving (the measures keep their longer rest,
         so nothing heavy sits right beside them); hurried, still a frame */
      if (hurried) requestAnimationFrame(() => setTimeout(pump, 0)); else requestAnimationFrame(() => setTimeout(pump, job.tag === "measure" ? job.rest : Math.min(job.rest, 20)));
    });
  };
  if (hurried) setTimeout(run, 0); else idle(run);
}

/** queue a piece of work for a journey (tag); resolves with what it returns (or what its promise resolves to) */
export function chore(fn, rest = 60, tag = "") {
  return new Promise((resolve, reject) => { queue.push({ fn, resolve, reject, rest, tag }); pump(); });
}
/* the door is lit and the painted part of its reveal done: the chores may begin (the rest is carried by the compositor) */
export function openChores() { if (!open) openedAt = performance.now(); open = true; pump(); }
/* the page has started, where compiles freeze it (main.js, COMPILES_ASIDE false): the "compile" chores may run now,
   while the first light's ring runs, and nothing else until openChores */
export function openCompiles() { compiling = true; pump(); }
/** a journey is chosen: what it needs (its tags) is done now, the rest after its opening (ms) */
export function hurryChores(tags, opening = 6000) {
  want = [].concat(tags || []);
  until = Math.max(until, performance.now() + opening);
  if (!open) openedAt = performance.now();
  open = true; pump();
}

/** the queue at rest: resolves once nothing is queued or running, and has stayed so for two animation frames, with
    calm(): whether it still is, and no chore has run since (a measure spread over frames asks at its end, and starts
    again if not) */
/* (the measures time the drawing alone: a chore beside them, an upload or a compile, is time that is not the
   drawing's, and a false measure lowers the drawing for the rest of the page view) */
export function quiet() {
  return new Promise((resolve) => {
    let at = -1, frames = 0;
    const look = () => {
      if (running || queue.length) { at = -1; frames = 0; }
      else if (at !== started) { at = started; frames = 0; }
      else if (++frames >= 2) { const was = started; resolve(() => !running && !queue.length && started === was); return; }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
}
/* for the test only (?door3d): the queue as it is now */
try { if (/[?&]door3d\b/.test(location.search)) window.__chores = () => ({ queued: queue.map((j) => tags(j.tag).join("+")), running, started, open, compiling, openedAt }); } catch { /* not a page */ }

/* the pictures, fetched once for whatever wants them, and asked for as early as is wanted: the network is never a chore */
const fetched = new Map();
export function fetchOnce(url) {
  if (!fetched.has(url)) fetched.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.blob(); }));
  return fetched.get(url);
}

/* how long the readying took, in the console (the first visit's GPU work differs greatly between machines and
   browsers: this says where the time went) */
export function note(what, since = 0) {
  try { console.info(`orbit · ${what}: ${Math.round(performance.now() - since)} ms${since ? "" : " after opening"}`); } catch { /* fine */ }
}
/* how many programs each part has linked (?door3d only: said in its notes, " (3 programs)", and summed by main.js) */
const COUNTING = (() => { try { return /[?&]door3d\b/.test(location.search); } catch { return false; } })();
const links = {};
export function linked(label) { links[label] = (links[label] || 0) + 1; }
export const counted = (label) => (COUNTING ? ` (${links[label] || 0} program${links[label] === 1 ? "" : "s"})` : "");
/* all of them so far, and by part ("flight 3, world 2, …") */
export const programs = () => ({ n: Object.values(links).reduce((a, b) => a + b, 0), by: Object.entries(links).map(([k, v]) => `${k} ${v}`).join(", ") });
