/*
 * Test for the journey lock (#12, item S5), written from the specification alone.
 *
 * assets/js/lock.js exports createLock() -> { begin(): token, done(token), held(): boolean }. begin() takes the lock and
 * returns a fresh token; done(token) releases it only if the token is the current one; a stale done is ignored. A journey
 * landing late (after the 15 s let-go) must not free the next journey's lock.
 *
 *   node tools/ci/site-lock-test.mjs
 *
 * No dependencies and no browser.
 */
let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};

let createLock;
try { ({ createLock } = await import("../../assets/js/lock.js")); } catch (e) { check("assets/js/lock.js loads", false, e.message.split("\n")[0]); }
check("createLock is exported from lock.js", typeof createLock === "function", `typeof createLock is ${typeof createLock} (want function)`);

if (typeof createLock === "function") {
  let l = createLock();
  check("a new lock is free", l.held() === false, `held() is ${l.held()}`);

  l = createLock();
  const a = l.begin();
  check("begin takes the lock", l.held() === true, `held() is ${l.held()}`);
  l.done(a);
  check("begin a, done a: free", l.held() === false, `held() is ${l.held()}`);

  l = createLock();
  const a2 = l.begin(), b2 = l.begin();
  check("each begin gives a fresh token", a2 !== b2, `${String(a2)} and ${String(b2)}`);
  l.done(a2);
  check("begin a, begin b, done a: still held (stale done ignored)", l.held() === true, `held() is ${l.held()}`);
  l.done(a2);
  check("a second stale done is also ignored", l.held() === true, `held() is ${l.held()}`);
  l.done(b2);
  check("done b: free", l.held() === false, `held() is ${l.held()}`);

  l = createLock();
  const c = l.begin(); l.done(c);
  const d = l.begin();
  l.done(c);
  check("a done of a finished journey does not free the next one", l.held() === true, `held() is ${l.held()}`);
  l.done(d);
  check("the next one's own done frees it", l.held() === false, `held() is ${l.held()}`);
}

process.exit(failed ? 1 : 0);
