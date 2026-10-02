/*
 * The site's background work, done a piece at a time.
 *
 * Readying the journeys is heavy for the page: pictures put on the GPU, shaders made, frames drawn to measure the
 * machine. Done all at once it stutters whatever is moving. So each piece is a chore, queued here and done one at
 * a time, each in a pause between frames, with a few frames' rest between one and the next, and none at all until
 * the door has finished coming up (open). The network is not a chore: pictures are fetched (and decoded) as soon
 * as they are asked for, off the page's own thread; only what touches the page or the GPU waits its turn.
 *
 * When a journey is chosen, what is left is done straight away (hurry), a frame between each piece, hidden in the
 * journey's opening.
 */
const queue = [];
let open = false, hurrying = false, running = false;
const idle = (fn) => (typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 60));

function pump() {
  if (running || !queue.length || (!open && !hurrying)) return;
  running = true;
  const run = () => {
    const job = queue.shift();
    let out;
    try { out = job.fn(); } catch (e) { out = Promise.reject(e); }
    Promise.resolve(out).then(job.resolve, job.reject).finally(() => {
      running = false;
      /* a rest between chores: a couple of frames, so whatever is moving keeps moving; hurried, still a frame */
      if (hurrying) requestAnimationFrame(() => setTimeout(pump, 0)); else requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(pump, job.rest)));
    });
  };
  if (hurrying) setTimeout(run, 0); else idle(run);
}

/** queue a piece of work; resolves with what it returns (or what its promise resolves to) */
export function chore(fn, rest = 60) {
  return new Promise((resolve, reject) => { queue.push({ fn, resolve, reject, rest }); pump(); });
}
/** the door is up: the chores may begin */
export function openChores() { open = true; pump(); }
/** a journey is chosen: what is left is done now */
export function hurryChores() { hurrying = true; pump(); }
