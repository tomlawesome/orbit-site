/* The journey lock: one journey at a time. begin() takes the lock and hands back a fresh token; done(token) lets go only
   if the token is still the current one, so a journey that lands after the lock was let go (the 15 s timeout in main.js)
   cannot free the lock of the journey that began since. release() lets go whatever the token (the door being reset). */
export function createLock() {
  let current = 0, next = 0;
  return {
    begin() { current = ++next; return current; },
    done(token) { if (!current || token !== current) return false; current = 0; return true; },
    held() { return current !== 0; },
    release() { current = 0; },
  };
}
