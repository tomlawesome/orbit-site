/*
 * Test for sw.js, the site's service worker (#14): it runs the real file against fakes of what a service worker is
 * given (self, caches, fetch, events), and checks what the file's header promises:
 *
 *   install      skips waiting
 *   activate     deletes every cache but the current media and code ones
 *   pictures     served from the media cache while under 36 hours old; fetched and kept when absent or older;
 *                an old copy is served if the fetch fails
 *   code         the page, scripts, styles: always fetched fresh first (no-cache); the last copy kept and served
 *                when the network fails
 *   the rest     other origins, non-GET and range requests are left to the browser (no respondWith)
 *
 *   node tools/ci/sw-test.mjs
 *
 * No dependencies. The file is loaded under its own file:// name, so V8's coverage (NODE_V8_COVERAGE) counts it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const swPath = fileURLToPath(new URL("../../sw.js", import.meta.url));
const source = readFileSync(swPath, "utf8");

let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
};

const ORIGIN = "https://orbit.test";
const HOUR = 3600 * 1000;
const settle = () => new Promise((ok) => setTimeout(ok, 5));

/* A fresh worker: sw.js run against new fakes. `net` is the network: (url, init) => Response, or throws. */
function boot() {
  const listeners = {};
  const stores = new Map(); /* cache name -> Map(url -> Response) */
  const w = { now: 1_700_000_000_000, tag: "net", calls: [], online: true, claimed: false, skipped: false, status: 200, type: "basic" };

  const cacheOf = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    const keyOf = (r, opts) => { const u = new URL(typeof r === "string" ? r : r.url); if (opts?.ignoreSearch) u.search = ""; return u.href; };
    return {
      match: async (r, opts) => {
        const k = keyOf(r, opts);
        for (const [url, res] of m) if (keyOf(url, opts) === k) return res.clone();
        return undefined;
      },
      put: async (r, res) => { m.set(keyOf(r), res); },
      keys: async () => [...m.keys()],
      delete: async (r) => m.delete(keyOf(r)),
    };
  };

  const caches = {
    keys: async () => [...stores.keys()],
    open: async (name) => cacheOf(name),
    delete: async (name) => stores.delete(name),
  };

  const fetch = async (r, init) => {
    const url = typeof r === "string" ? r : r.url;
    w.calls.push({ url, init });
    if (!w.online) throw new TypeError("network down");
    const res = new Response(`${w.tag}:${url}`, { status: w.status });
    Object.defineProperty(res, "type", { value: w.type }); /* Node's own Response is never "basic" */
    return res;
  };

  const FakeDate = class extends Date { static now() { return w.now; } };
  const self = {
    location: { origin: ORIGIN },
    clients: { claim: async () => { w.claimed = true; } },
    skipWaiting: () => { w.skipped = true; },
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  const ctx = vm.createContext({ self, caches, fetch, Request, Response, Headers, URL, Date: FakeDate, Number, String, Promise });
  vm.runInContext(source, ctx, { filename: pathToFileURL(swPath).href });

  w.listeners = listeners;
  w.stores = stores;
  w.caches = caches;
  w.fire = async (type) => {
    let waited;
    listeners[type]({ waitUntil: (p) => { waited = p; } });
    await waited;
  };
  w.request = (path, { method = "GET", mode = "no-cors", headers = {}, origin = ORIGIN } = {}) => ({
    url: origin + path, method, mode, headers: new Headers(headers),
  });
  /* Sends a request through the worker: { handled, response } (response undefined if left to the browser). */
  w.ask = async (req) => {
    let answer;
    let handled = false;
    listeners.fetch({ request: req, respondWith: (p) => { handled = true; answer = p; } });
    let response, error;
    if (handled) { try { response = await answer; } catch (e) { error = e; } }
    await settle(); /* the cache writes are not waited for */
    return { handled, response, error };
  };
  w.names = () => [...stores.keys()];
  return w;
}

const body = async (r) => (r ? await r.clone().text() : undefined);

/* ---- install, activate ---- */
{
  const w = boot();
  await w.fire("install");
  check("install skips waiting", w.skipped === true, `skipWaiting ${w.skipped ? "called" : "not called"}`);
}
{
  /* the current names are learned by serving one picture and one page, which opens each cache */
  const probe = boot();
  await probe.ask(probe.request("/a.png"));
  await probe.ask(probe.request("/"));
  const [media, code] = probe.names(); /* in the order opened: the picture's, then the page's */

  const w = boot();
  await w.caches.open(media);
  await w.caches.open(code);
  await w.caches.open("orbit-media-old");
  await w.caches.open("orbit-code-0");
  await w.caches.open("something-else");
  await w.fire("activate");
  const left = w.names().sort();
  check("activate deletes every other cache", JSON.stringify(left) === JSON.stringify([media, code].sort()),
    `left ${JSON.stringify(left)} (want only ${JSON.stringify([media, code].sort())})`);
  check("activate takes over the open pages", w.claimed === true, `clients.claim ${w.claimed ? "called" : "not called"}`);
}

/* ---- pictures ---- */
for (const path of ["/assets/earth.webp", "/img/a.png", "/img/b.jpg", "/img/b.jpeg", "/img/c.gif", "/img/d.svg", "/img/e.exr", "/f/x.woff2", "/f/x.woff"]) {
  const w = boot();
  const first = await w.ask(w.request(path));
  check(`${path} is a picture: handled and fetched`, first.handled && (await body(first.response)) === `net:${ORIGIN}${path}` && w.calls.length === 1,
    `${first.handled ? "handled" : "left to the browser"}, ${w.calls.length} fetches`);
}
{
  const w = boot();
  const p = "/assets/earth.webp";
  const a = await w.ask(w.request(p));
  check("a picture not kept is fetched", w.calls.length === 1 && (await body(a.response)) === `net:${ORIGIN}${p}`, `${w.calls.length} fetches`);
  check("... and kept", w.names().length === 1 && [...w.stores.values()][0].size === 1, `${w.names().length} cache, ${[...w.stores.values()][0]?.size} entries`);

  w.now += 35 * HOUR;
  const b = await w.ask(w.request(p));
  check("a picture under 36 hours old is served without asking again", w.calls.length === 1 && (await body(b.response)) === `net:${ORIGIN}${p}`,
    `${w.calls.length} fetches (want 1)`);

  w.now += 2 * HOUR; /* 37 hours after it was kept */
  const c = await w.ask(w.request(p));
  check("a picture over 36 hours old is fetched again", w.calls.length === 2, `${w.calls.length} fetches (want 2)`);
  check("... and the fresh copy is served", (await body(c.response)) === `net:${ORIGIN}${p}`, "served");

  w.now += 1 * HOUR; /* 1 hour after the refresh: fresh again, so no fetch */
  await w.ask(w.request(p));
  check("... and its age starts over", w.calls.length === 2, `${w.calls.length} fetches (want 2)`);
}
{
  const w = boot();
  const p = "/assets/moon.webp";
  await w.ask(w.request(p));
  w.now += 50 * HOUR;
  w.online = false;
  const r = await w.ask(w.request(p));
  check("an old picture is served when the fetch fails", !r.error && (await body(r.response)) === `net:${ORIGIN}${p}`,
    r.error ? `rejected: ${r.error.message}` : "the old copy");
  const none = await w.ask(w.request("/assets/never.webp"));
  check("a picture never kept, with no network, fails", none.handled && !!none.error, none.error ? "rejected" : "answered");
}
{
  const w = boot();
  w.status = 404;
  const r = await w.ask(w.request("/assets/gone.webp"));
  check("a missing picture is passed on, not kept", r.response?.status === 404 && w.calls.length === 1 && [...w.stores.values()].every((m) => m.size === 0),
    `status ${r.response?.status}, kept ${[...w.stores.values()].reduce((n, m) => n + m.size, 0)}`);
  const w2 = boot();
  w2.type = "opaque";
  await w2.ask(w2.request("/assets/odd.webp"));
  check("a picture that is not the site's own answer is not kept", [...w2.stores.values()].every((m) => m.size === 0), "nothing kept");
}

/* ---- code: pages, scripts, styles ---- */
for (const [path, mode] of [["/", "navigate"], ["/assets/js/main.js", "no-cors"], ["/assets/css/site.css", "no-cors"], ["/docs/", "navigate"]]) {
  const w = boot();
  const r = await w.ask(w.request(path, { mode }));
  const call = w.calls[0];
  check(`${path} is fetched fresh`, r.handled && call?.init?.cache === "no-cache" && (await body(r.response)) === `net:${ORIGIN}${path}`,
    `${r.handled ? "handled" : "left to the browser"}, cache ${call?.init?.cache}`);
  if (mode === "navigate") check(`${path} (a page) is asked for with the visitor's own cookies only`, call?.init?.credentials === "same-origin", `credentials ${call?.init?.credentials}`);
}
{
  const w = boot();
  const p = "/assets/js/main.js";
  await w.ask(w.request(p));
  await w.ask(w.request(p));
  check("code is fetched every time, not served from its copy", w.calls.length === 2 && w.calls.every((c) => c.init.cache === "no-cache"), `${w.calls.length} fetches (want 2)`);

  w.online = false;
  const off = await w.ask(w.request(p));
  check("with no network, the last copy is served", !off.error && (await body(off.response)) === `net:${ORIGIN}${p}`, off.error ? `rejected: ${off.error.message}` : "the copy");
  const none = await w.ask(w.request("/assets/js/other.js"));
  check("with no network and no copy, it fails", none.handled && !!none.error, none.error ? "rejected" : "answered");
}
{
  /* a successful fetch updates the copy: what the network last said is what offline then shows */
  const w = boot();
  const p = "/assets/js/home.js";
  await w.ask(w.request(p));
  w.tag = "v2";
  const second = await w.ask(w.request(p));
  w.online = false;
  const off = await w.ask(w.request(p));
  check("a successful fetch updates the copy", (await body(second.response)) === `v2:${ORIGIN}${p}` && (await body(off.response)) === `v2:${ORIGIN}${p}`,
    `offline served ${JSON.stringify(await body(off.response))} (want the v2 one)`);
  const nav = boot();
  await nav.ask(nav.request("/docs/", { mode: "navigate" }));
  nav.online = false;
  const page = await nav.ask(nav.request("/docs/", { mode: "navigate" }));
  check("a page is served from its copy when the network is gone", !page.error && (await body(page.response)) === `net:${ORIGIN}/docs/`, page.error ? `rejected: ${page.error.message}` : "the copy");
}
{
  const w = boot();
  w.status = 500;
  const r = await w.ask(w.request("/assets/js/main.js"));
  check("a failed answer (500) is passed on, not kept", r.response?.status === 500 && [...w.stores.values()].every((m) => m.size === 0),
    `status ${r.response?.status}, kept ${[...w.stores.values()].reduce((n, m) => n + m.size, 0)}`);
}

/* ---- what it leaves to the browser ---- */
{
  const w = boot();
  const cases = [
    ["another origin", w.request("/a.png", { origin: "https://elsewhere.test" })],
    ["another origin's script", w.request("/x.js", { origin: "https://elsewhere.test" })],
    ["a POST", w.request("/api", { method: "POST" })],
    ["a PUT of a picture", w.request("/a.png", { method: "PUT" })],
    ["a range request", w.request("/assets/video.png", { headers: { range: "bytes=0-99" } })],
  ];
  for (const [name, req] of cases) {
    const r = await w.ask(req);
    check(`${name} is left to the browser`, !r.handled && w.calls.length === 0, `${r.handled ? "respondWith called" : "no respondWith"}, ${w.calls.length} fetches`);
  }
}

/* ---- a query string does not make a kept picture a different one (ignoreSearch) ---- */
{
  const w = boot();
  const p = "/assets/earth.webp";
  await w.ask(w.request(p));
  const q = await w.ask(w.request(p + "?v=2"));
  check("a picture asked for with a query string is answered from the kept copy, with no new fetch", q.handled && !q.error && w.calls.length === 1 && (await body(q.response)) === `net:${ORIGIN}${p}`,
    `${w.calls.length} fetches (want 1), served ${JSON.stringify(await body(q.response))}`);
  w.online = false;
  w.now += 50 * HOUR;
  const old = await w.ask(w.request(p + "?v=3"));
  check("... and an old kept copy answers a query-string request when the network is gone", !old.error && (await body(old.response)) === `net:${ORIGIN}${p}`,
    old.error ? `rejected: ${old.error.message}` : `served ${JSON.stringify(await body(old.response))}`);
}
{
  const w = boot();
  const p = "/assets/moon.webp";
  await w.ask(w.request(p + "?v=1"));
  const q = await w.ask(w.request(p + "?v=2"));
  check("a picture kept under one query string answers another query string, with no new fetch", q.handled && !q.error && w.calls.length === 1,
    `${w.calls.length} fetches (want 1)`);
}

process.exit(failed ? 1 : 0);
