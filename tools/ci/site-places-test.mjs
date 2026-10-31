/*
 * Test for the places module (#117, ADR-0006 P1-P8), written from the specification alone. assets/js/places.js exports:
 *
 *   createPlaces(h = history) -> { step, stack, hop, keep, settle, up, pop }: the one place the site's history calls are
 *     made. `orbit` in an entry's state counts the Back presses to the door's entry.
 *       step(hash)        pushes { orbit: 1 } at hash (a journey from the door)
 *       stack(more, hash) pushes { ...more, orbit } at hash (the address unchanged when hash is omitted); orbit is the
 *                         current entry's plus one when that is 1 or more, else 0
 *       hop(more)         replaces the state with { ...state, ...more }, the address unchanged
 *       keep(hash)        replaces the address with hash, the state kept (the same object)
 *       settle()          replaces the entry with no state at " " (the door's address)
 *       up()              history.go(-orbit) and true when orbit is 1 or more; else false and nothing called
 *       pop()             called in the popstate handler: { hash, state, from }, hash the address's hash up to the first
 *                         "/", state the entry's, from the state of the entry before it (remembered across every call)
 *     Each history call is in a try/catch: a history that throws never makes a method throw.
 *   plan({ current, hash, state, from }) -> { to: "dawn" } | { to: "sky", id } | { to: "launch" } | { to: "pad", id } | null
 *
 * The stand-in history records its calls and keeps `state` the way a browser does. The address it keeps is shared as
 * `h.location` and as the global `location`, whichever pop() reads. (A real browser's `location` is the global.)
 *
 *   node tools/ci/site-places-test.mjs
 *
 * No dependencies and no browser.
 */
import { isDeepStrictEqual } from "node:util";

let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};
const show = (v) => JSON.stringify(v);
/* a case: it passes when fn returns, and fails with the message of what it threw (an assertion or a missing module) */
const run = (name, fn) => {
  try { fn(); check(name, true, "as specified"); } catch (e) { check(name, false, String(e.message).split("\n")[0]); }
};
const want = (got, wanted, what) => {
  if (!isDeepStrictEqual(got, wanted)) throw new Error(`${what}: got ${show(got)} (want ${show(wanted)})`);
};
const same = (got, wanted, what) => {
  if (got !== wanted) throw new Error(`${what}: got ${show(got)}, not the very object that was there`);
};

let mod = null, loadError = "";
try { mod = await import("../../assets/js/places.js"); } catch (e) { loadError = `assets/js/places.js does not load (${e.code || String(e.message).split("\n")[0]})`; }
const need = (name) => {
  if (!mod) throw new Error(loadError);
  if (typeof mod[name] !== "function") throw new Error(`assets/js/places.js does not export ${name} (typeof ${typeof mod[name]})`);
  return mod[name];
};

/* a history-shaped object that records what is called on it, and the address it moves */
const makeHistory = (state = null, hash = "") => {
  const loc = { hash };
  const move = (kind) => (s, t, u) => {
    h.calls.push({ kind, state: s, url: u });
    h.state = s;
    if (typeof u === "string") loc.hash = u.startsWith("#") ? u : "";
  };
  const h = {
    state, location: loc, calls: [],
    pushState: move("push"),
    replaceState: move("replace"),
    go(n) { h.calls.push({ kind: "go", n }); },
    back() { h.calls.push({ kind: "back" }); },
  };
  globalThis.location = loc;
  return h;
};
/* the browser moves to another entry: its state and address change, and nothing is called on history */
const popTo = (h, state, hash) => { h.state = state; h.location.hash = hash; };
const only = (h, kind) => h.calls.filter((c) => c.kind === kind);

/* P1: step pushes { orbit: 1 } at the address */
run("P1 control: creating places calls nothing on history", () => {
  const h = makeHistory();
  need("createPlaces")(h);
  want(h.calls, [], "calls after createPlaces");
});
run("P1 step('#install') pushes { orbit: 1 } at #install", () => {
  const h = makeHistory();
  const places = need("createPlaces")(h);
  places.step("#install");
  want(h.calls.length, 1, "history calls");
  want(h.calls[0].kind, "push", "kind of the call");
  want(h.calls[0].state, { orbit: 1 }, "pushed state");
  want(h.calls[0].url, "#install", "pushed address");
});

/* P2: stack carries the parent's orbit plus one, or 0 */
run("P2 stack above { orbit: 1 } pushes { docs: 'a', orbit: 2 }, the address argument undefined", () => {
  const h = makeHistory({ orbit: 1 }, "#docs");
  const places = need("createPlaces")(h);
  places.stack({ docs: "a" });
  want(h.calls.length, 1, "history calls");
  want(h.calls[0].kind, "push", "kind of the call");
  want(h.calls[0].state, { docs: "a", orbit: 2 }, "pushed state");
  want(h.calls[0].url, undefined, "pushed address argument");
});
run("P2 stack above no state pushes { docs: 'a', orbit: 0 }", () => {
  const h = makeHistory(null, "#install");
  need("createPlaces")(h).stack({ docs: "a" });
  want(only(h, "push").map((c) => c.state), [{ docs: "a", orbit: 0 }], "pushed states");
});
run("P2 stack above { orbit: 0 } keeps orbit 0 (a direct arrival's count never grows)", () => {
  const h = makeHistory({ orbit: 0 }, "#install");
  need("createPlaces")(h).stack({ docs: "a" });
  want(only(h, "push").map((c) => c.state), [{ docs: "a", orbit: 0 }], "pushed states");
});
run("P2 stack above { orbit: 2 } pushes orbit 3 (the count keeps growing from the door)", () => {
  const h = makeHistory({ orbit: 2, docs: "a" }, "#docs/a");
  need("createPlaces")(h).stack({ docs: "b" });
  want(only(h, "push").map((c) => c.state), [{ docs: "b", orbit: 3 }], "pushed states");
});
run("P2 stack(more, hash) pushes at that address", () => {
  const h = makeHistory({ orbit: 1 }, "#docs");
  need("createPlaces")(h).stack({ docs: "a" }, "#docs/a");
  want(only(h, "push").map((c) => [c.state, c.url]), [[{ docs: "a", orbit: 2 }, "#docs/a"]], "pushes");
});
run("P2 control: step above no state still gives orbit 1", () => {
  const h = makeHistory(null, "");
  need("createPlaces")(h).step("#home");
  want(only(h, "push").map((c) => c.state), [{ orbit: 1 }], "pushed states");
});
run("P2 control: step ignores the current entry's state and still gives orbit 1", () => {
  const h = makeHistory({ orbit: 5 }, "");
  need("createPlaces")(h).step("#home");
  want(only(h, "push").map((c) => c.state), [{ orbit: 1 }], "pushed states");
});

/* P3: hop replaces the state in place */
run("P3 hop({ sky: 'grans' }) above { orbit: 1 } replaces with { orbit: 1, sky: 'grans' }, address unchanged, no push", () => {
  const h = makeHistory({ orbit: 1 }, "#home");
  need("createPlaces")(h).hop({ sky: "grans" });
  want(only(h, "push").length, 0, "pushes");
  want(h.calls.length, 1, "history calls");
  want(h.calls[0].kind, "replace", "kind of the call");
  want(h.calls[0].state, { orbit: 1, sky: "grans" }, "replaced state");
  want(h.calls[0].url, undefined, "replaced address argument");
});
run("P3 hop above no state replaces with just the hop", () => {
  const h = makeHistory(null, "");
  need("createPlaces")(h).hop({ sky: "bea" });
  want(only(h, "replace").map((c) => c.state), [{ sky: "bea" }], "replaced states");
});

/* P4: keep and settle */
run("P4 keep('#docs') replaces with the same state object, at #docs", () => {
  const kept = { orbit: 1, docs: "x" };
  const h = makeHistory(kept, "#docs/x");
  need("createPlaces")(h).keep("#docs");
  want(h.calls.length, 1, "history calls");
  want(h.calls[0].kind, "replace", "kind of the call");
  same(h.calls[0].state, kept, "replaced state");
  want(h.calls[0].url, "#docs", "replaced address");
});
run("P4 settle() replaces with no state at ' '", () => {
  const h = makeHistory({ orbit: 1 }, "#install");
  need("createPlaces")(h).settle();
  want(h.calls.length, 1, "history calls");
  want(h.calls[0].kind, "replace", "kind of the call");
  want(h.calls[0].state, null, "replaced state");
  want(h.calls[0].url, " ", "replaced address");
});

/* P5: up */
run("P5 up() above { orbit: 2 } calls go(-2) and returns true", () => {
  const h = makeHistory({ orbit: 2 }, "#docs/a");
  const r = need("createPlaces")(h).up();
  want(r, true, "return value");
  want(h.calls, [{ kind: "go", n: -2 }], "history calls");
});
run("P5 up() above { orbit: 1 } calls go(-1) and returns true", () => {
  const h = makeHistory({ orbit: 1 }, "#install");
  const r = need("createPlaces")(h).up();
  want(r, true, "return value");
  want(h.calls, [{ kind: "go", n: -1 }], "history calls");
});
for (const [name, state] of [["{ orbit: 0 }", { orbit: 0 }], ["no state", null], ["{ sky: 'x' } alone", { sky: "x" }]]) {
  run(`P5 up() above ${name} calls nothing and returns false`, () => {
    const h = makeHistory(state, "#install");
    const r = need("createPlaces")(h).up();
    want(r, false, "return value");
    want(h.calls, [], "history calls");
  });
}

/* P6: pop */
run("P6 pop() gives the hash up to the first '/', the state, and from", () => {
  const h = makeHistory({ orbit: 1 }, "#docs");
  const places = need("createPlaces")(h);
  places.step("#home");
  popTo(h, { orbit: 2, docs: "a" }, "#docs/a/b");
  const p = places.pop();
  want(p.hash, "#docs", "hash");
  want(p.state, { orbit: 2, docs: "a" }, "state");
  want(p.from, { orbit: 1 }, "from");
});
run("P6 after step('#home') and a pop to no state, from is { orbit: 1 }; a second pop with no change gives from null", () => {
  const h = makeHistory(null, "");
  const places = need("createPlaces")(h);
  places.step("#home");
  popTo(h, null, "");
  const first = places.pop();
  want(first, { hash: "", state: null, from: { orbit: 1 } }, "first pop");
  const second = places.pop();
  want(second.from, null, "from of the second pop");
});
run("P6 control: from after hop is the hopped state", () => {
  const h = makeHistory(null, "");
  const places = need("createPlaces")(h);
  places.step("#home");
  places.hop({ sky: "grans" });
  popTo(h, null, "");
  want(places.pop().from, { orbit: 1, sky: "grans" }, "from after hop");
});
run("P6 from follows a stack: popping down from a stacked entry gives the stacked state", () => {
  const h = makeHistory(null, "");
  const places = need("createPlaces")(h);
  places.step("#install");
  places.stack({ docs: "a" }, "#docs/a");
  popTo(h, { orbit: 1 }, "#install");
  want(places.pop().from, { docs: "a", orbit: 2 }, "from after stack");
});
run("P6 from follows keep and settle (the replaced state is the one just left)", () => {
  const h = makeHistory(null, "");
  const places = need("createPlaces")(h);
  places.step("#install");
  places.settle();
  popTo(h, { orbit: 1 }, "#install");
  want(places.pop().from, null, "from after settle");
});
run("P6 the hash is the part before the first '/' for other addresses too ('' and '#info')", () => {
  const h = makeHistory(null, "");
  const places = need("createPlaces")(h);
  popTo(h, null, "");
  want(places.pop().hash, "", "hash of the door");
  popTo(h, { orbit: 1 }, "#info");
  want(places.pop().hash, "#info", "hash of #info");
});

/* P7: plan */
const PLAN = [
  ["home: the entry's sky wins", { current: "home", hash: "#home", state: { orbit: 2, sky: "bea" }, from: { orbit: 1 } }, { to: "sky", id: "bea" }],
  ["home: the entry's sky wins over a from sky", { current: "home", hash: "#home", state: { orbit: 2, sky: "bea" }, from: { orbit: 2, sky: "grans" } }, { to: "sky", id: "bea" }],
  ["home: the entry's sky at the door's address still goes to that sky", { current: "home", hash: "", state: { sky: "bea" }, from: null }, { to: "sky", id: "bea" }],
  ["home: no sky in the entry, one in from, goes to willow", { current: "home", hash: "#home", state: { orbit: 1 }, from: { orbit: 2, sky: "grans" } }, { to: "sky", id: "willow" }],
  ["home: the returning visitor's '/' (no state, from had a sky) goes to willow", { current: "home", hash: "", state: null, from: { orbit: 1, sky: "grans" } }, { to: "sky", id: "willow" }],
  ["home: the same with from null is the dawn (the control)", { current: "home", hash: "", state: null, from: null }, { to: "dawn" }],
  ["home: the door's address with a from that has no sky is the dawn", { current: "home", hash: "", state: null, from: { orbit: 1 } }, { to: "dawn" }],
  ["home: #home with nothing in either is nothing to do", { current: "home", hash: "#home", state: { orbit: 1 }, from: { orbit: 1 } }, null],
  ["home: a landing's address is nothing to do", { current: "home", hash: "#install", state: null, from: null }, null],
  ["install: the door's address is the dawn", { current: "install", hash: "", state: null, from: { orbit: 1 } }, { to: "dawn" }],
  ["docs: the door's address is the dawn", { current: "docs", hash: "", state: null, from: { orbit: 2, docs: "a" } }, { to: "dawn" }],
  ["info: the door's address is the dawn", { current: "info", hash: "", state: null, from: null }, { to: "dawn" }],
  ["install: its own address is nothing to do", { current: "install", hash: "#install", state: { orbit: 1 }, from: null }, null],
  ["install: #home is nothing to do", { current: "install", hash: "#home", state: { orbit: 1 }, from: null }, null],
  ["docs: #docs is nothing to do (the docs' own pops are pads.js's)", { current: "docs", hash: "#docs", state: undefined, from: undefined }, null],
  ["docs: a page's address is nothing to do", { current: "docs", hash: "#docs", state: { docs: "a", orbit: 2 }, from: { orbit: 1 } }, null],
  ["info: #info is nothing to do", { current: "info", hash: "#info", state: { orbit: 1 }, from: null }, null],
  ["door: #home is the climb, no push", { current: "door", hash: "#home", state: { orbit: 1 }, from: null }, { to: "launch" }],
  ["door: #install flies to the install landing", { current: "door", hash: "#install", state: { orbit: 1 }, from: null }, { to: "pad", id: "install" }],
  ["door: #docs flies to the docs landing", { current: "door", hash: "#docs", state: { orbit: 1 }, from: null }, { to: "pad", id: "docs" }],
  ["door: #info flies to the information landing", { current: "door", hash: "#info", state: { orbit: 1 }, from: null }, { to: "pad", id: "info" }],
  ["door: the door's own address is nothing to do", { current: "door", hash: "", state: null, from: { orbit: 1 } }, null],
  ["door: another address is nothing to do", { current: "door", hash: "#key", state: null, from: null }, null],
  ["door: an unknown address is nothing to do", { current: "door", hash: "#nowhere", state: null, from: null }, null],
  ["dusk: nothing to do at the door's address", { current: "dusk", hash: "" }, null],
  ["dusk: nothing to do at #home", { current: "dusk", hash: "#home", state: { orbit: 1 }, from: null }, null],
  ["no current: nothing to do", { current: null, hash: "" }, null],
  ["another current: nothing to do", { current: "elsewhere", hash: "", state: null, from: { orbit: 1, sky: "x" } }, null],
];
for (const [name, input, wanted] of PLAN) {
  run(`P7 plan ${name}`, () => want(need("plan")(input), wanted, `plan(${show(input)})`));
}

/* P8: a history that throws never makes a method throw */
{
  const boom = () => { throw new Error("history refused"); };
  const methods = [
    ["step", (p) => p.step("#install")],
    ["stack", (p) => p.stack({ docs: "a" })],
    ["stack with an address", (p) => p.stack({ docs: "a" }, "#docs/a")],
    ["hop", (p) => p.hop({ sky: "grans" })],
    ["keep", (p) => p.keep("#docs")],
    ["settle", (p) => p.settle()],
    ["up", (p) => p.up()],
    ["pop", (p) => p.pop()],
  ];
  for (const [name, call] of methods) {
    run(`P8 ${name} does not throw when the history's methods do`, () => {
      globalThis.location = { hash: "#docs/a" };
      const h = { state: { orbit: 2 }, pushState: boom, replaceState: boom, go: boom, back: boom };
      const places = need("createPlaces")(h);
      call(places);
    });
  }
}

process.exit(failed ? 1 : 0);
