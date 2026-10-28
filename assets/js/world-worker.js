/*
 * THE INSTALL'S AND THE INFORMATION'S WORLD DRAWN IN A WORKER (ADR-0004 6b): the worker's entry, made by
 * remote-world.js on the page. world.js runs here whole, on the canvas handed over, with the door's modules it leans on
 * (page.js answering for the page, the chores' queue unpaced). The handshake: `hello` (the flags, the pictures'
 * absolute addresses, the look's options), then `canvas`, on which the world is made at once and `up` said: there is
 * no page here to freeze, so no compile is spaced or held (6b.5). Every console line goes to the page as a `note`.
 *
 * The frame feed, latest wins: each `view` replaces the one held, and the next frame callback draws it and says `drew`
 * with this thread's own period between its callbacks (the governor's measure, 6b.3). While `run` is on the callbacks
 * run every frame; while it is off, one is asked only for a view that came. An exception handling a message is `dead`:
 * the page falls back.
 */
import { createDoor, setPage, pace, openChores } from "../door/index.js";
import { createWorld } from "./world.js";

const scope = /** @type {any} */ (self);
const post = (m) => scope.postMessage(m);
const text = (a) => a.map((x) => (x instanceof Error ? x.message : String(x))).join(" ");

let given = null, world = null, gone = false, lostSaid = false;
let running = false, asked = false, last = 0, held = null;

function hello(m) {
  given = m;
  setPage({
    baseURI: () => m.baseURI,
    frame: (fn) => requestAnimationFrame(fn),
    canvas: (w, h) => new OffscreenCanvas(w, h),
    /* (the page's gate has judged: no gate here, and the world is made gated) */
    gate: () => null,
    hidden: () => false,
    note(line) { post({ type: "note", line, kind: "note" }); },
    verdict(line) { post({ type: "note", line, kind: "verdict" }); },
    shared: () => false,
  });
  createDoor({ flags: m.flags || {}, image: (p) => p, typingWait: 0 });
  /* the worker's own queue: open from the start, a picture on whole, nothing in it waiting for the page */
  pace("none");
  openChores();
}

/* a lost context where the canvas says nothing of it: looked at before every frame and every message */
const backstop = () => {
  if (!world || lostSaid || !world.lost) return;
  lostSaid = true;
  post({ type: "lost" });
};

function bringUp(canvas) {
  if (!given) throw new Error("canvas before hello");
  const m = given, w = m.world || {};
  let made = null;
  try {
    made = createWorld(canvas, {
      small: w.small, map: w.map, rings: w.rings, moon: w.moon, sky: m.sky, tag: m.tag,
      hue: m.hue, sat: m.sat, ringsOn: m.ringsOn, haze: m.haze, grade: m.grade,
      gated: true, warn: (...a) => post({ type: "note", line: text(a), kind: "warn" }),
    });
  } catch (e) {
    gone = true; post({ type: "note", line: `orbit: the world could not be made: ${text([e])}`, kind: "warn" });
    post({ type: "up", ok: false, why: "the world could not be made" }); return;
  }
  if (!made) { gone = true; post({ type: "up", ok: false, why: "no WebGL2 in a worker here" }); return; }
  world = made;
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault?.(); if (!lostSaid) { lostSaid = true; post({ type: "lost" }); } });
  canvas.addEventListener("webglcontextrestored", () => { lostSaid = false; });
  post({ type: "up", ok: true });
  made.made.then((ok) => post({ type: "compiled", ok: !!ok, ms: made.compileMs }), () => post({ type: "compiled", ok: false, ms: 0 }));
}

/* the view held, drawn, and said (dt: this thread's period before this callback) */
function drawHeld(dt) {
  const v = held; held = null;
  if (!v || !world || !world.baked) return;
  const t0 = performance.now();
  world.draw(v.view);
  post({ type: "drew", seq: v.seq, dt, ms: performance.now() - t0 });
}
const ask = () => { if (!asked && !gone) { asked = true; requestAnimationFrame(tick); } };
function tick(t) {
  asked = false;
  if (gone) return;
  guard(() => {
    backstop();
    const dt = last ? t - last : 16;
    /* (a callback asked only for a view, with the loop off, starts no period) */
    last = running ? t : 0;
    drawHeld(dt);
    if (running) ask();
  });
}

function handle(m) {
  switch (m.type) {
    case "hello": hello(m); break;
    case "canvas": bringUp(m.canvas); break;
    case "destroy": gone = true; running = false; scope.close(); break;
    default: {
      if (gone || !world) break;
      switch (m.type) {
        case "resize": world.resize(m.w, m.h, m.scale); break;
        case "bake": { const { id } = m; world.bake().then((ok) => post({ type: "baked", id, ok: !!ok }), () => post({ type: "baked", id, ok: false })); break; }
        case "run": running = !!m.on; if (running) { last = 0; ask(); } break;
        case "view": held = { seq: m.seq, view: m.view }; ask(); break;
        /* what was asked is done: the view held drawn first */
        case "finish": if (held) drawHeld(16); world.finish(); break;
        case "measure": { const { id } = m; world.measure(m.sets || []).then((ms) => post({ type: "measured", id, ms })); break; }
      }
    }
  }
}

/* (an exception outside a frame: the worker cannot go on, and the page draws instead) */
function guard(fn) {
  try { fn(); } catch (e) { gone = true; running = false; post({ type: "dead", why: String(e?.message || e) }); }
}

scope.onmessage = (ev) => guard(() => {
  const m = ev.data;
  if (!m || typeof m !== "object") return;
  backstop();
  handle(m);
});
