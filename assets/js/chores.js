/*
 * The site's background work, done a piece at a time.
 *
 * Readying the journeys is heavy for the page: pictures put on the GPU, shaders made, frames drawn to measure the
 * machine. Done all at once it stutters whatever is moving. So each piece is a chore, queued here and done one at
 * a time, each in a pause between frames, with a few frames' rest between one and the next, and none at all until
 * the door is lit (open). The network is not a chore: pictures are fetched (and decoded) as soon
 * as they are asked for, off the page's own thread; only what touches the page or the GPU waits its turn.
 *
 * When a journey is chosen, what that journey still needs is done straight away (hurry), a frame between each piece,
 * hidden in the journey's opening; everything else is put off until the journey is under way (the chores are
 * tagged by what they ready: "flight", "docs", "install", "info"), so nothing it does not need stalls it. The
 * measures (frames timed to fit the drawing to the machine: "measure") are never hurried.
 */
const queue = [];
let open = false, running = false, want = null, until = 0, wake = 0;
/* a pause between frames, but never waited on long: while the door moves the browser may rarely call a moment idle */
const idle = (fn) => (typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 250 }) : setTimeout(fn, 30));
/* the order the rest are done in, when no journey has been chosen: the likeliest first, the measures last */
const ORDER = ["install", "flight", "docs", "info", "", "measure"];
const rank = (tag) => { const i = ORDER.indexOf(tag); return i < 0 ? ORDER.length : i; };

function pump() {
  if (running || !queue.length) return;
  const now = performance.now();
  /* what the chosen journey needs, first */
  let i = want ? queue.findIndex((j) => want.includes(j.tag)) : -1;
  const hurried = i >= 0;
  if (!hurried) {
    if (!open) return;
    /* the rest waits until the journey has had its opening */
    if (now < until) { clearTimeout(wake); wake = setTimeout(pump, until - now + 20); return; }
    i = 0;
    for (let k = 1; k < queue.length; k++) if (rank(queue[k].tag) < rank(queue[i].tag)) i = k;
  }
  running = true;
  const run = () => {
    const [job] = queue.splice(Math.min(i, queue.length - 1), 1);
    let out;
    try { out = job.fn(); } catch (e) { out = Promise.reject(e); }
    Promise.resolve(out).then(job.resolve, job.reject).finally(() => {
      running = false;
      /* a rest between chores: a couple of frames, so whatever is moving keeps moving; hurried, still a frame */
      if (hurried) requestAnimationFrame(() => setTimeout(pump, 0)); else requestAnimationFrame(() => setTimeout(pump, job.rest));
    });
  };
  if (hurried) setTimeout(run, 0); else idle(run);
}

/** queue a piece of work for a journey (tag); resolves with what it returns (or what its promise resolves to) */
export function chore(fn, rest = 60, tag = "") {
  return new Promise((resolve, reject) => { queue.push({ fn, resolve, reject, rest, tag }); pump(); });
}
/** the door is up: the chores may begin */
/* the door is lit: the chores may begin (what moves in its reveal is carried by the compositor, away from them) */
export function openChores() { open = true; pump(); }
/** a journey is chosen: what it needs (its tags) is done now, the rest after its opening (ms) */
export function hurryChores(tags, opening = 6000) {
  want = [].concat(tags || []);
  until = Math.max(until, performance.now() + opening);
  open = true; pump();
}

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
