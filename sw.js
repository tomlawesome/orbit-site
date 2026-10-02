/*
 * The site's own cache, kept in the visitor's browser.
 *
 * Pictures (the Earth, the planet, the moon, the galaxy, the maps) are kept
 * for a day and served from here without asking again, so a journey taken
 * twice, or a page opened again, pulls nothing. Everything else (the page,
 * its code, its styles, the docs) is always asked for fresh — a cheap "not
 * modified" when nothing has changed — so a new version of the site is
 * seen at once; what was fetched last is used if the network is gone.
 *
 * MEDIA changes name when the pictures are replaced, which clears them.
 */
const MEDIA = "orbit-media-1", CODE = "orbit-code-1", KEEP = 24 * 3600 * 1000;
const isMedia = (u) => /\.(webp|png|jpe?g|gif|svg|exr|woff2?)$/i.test(u.pathname);

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== MEDIA && k !== CODE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || req.headers.has("range")) return;
  e.respondWith(isMedia(url) ? kept(req) : fresh(req));
});

/* a picture: from the cache while it is less than a day old; otherwise fetched, and kept */
async function kept(req) {
  const cache = await caches.open(MEDIA);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit && Date.now() - Number(hit.headers.get("x-orbit-kept") || 0) < KEEP) return hit;
  try {
    const res = await fetch(req);
    if (res.ok && res.type === "basic") {
      const headers = new Headers(res.headers); headers.set("x-orbit-kept", String(Date.now()));
      cache.put(req, new Response(await res.clone().blob(), { status: res.status, statusText: res.statusText, headers })).catch(() => {});
    }
    return res;
  } catch (err) {
    if (hit) return hit;
    throw err;
  }
}

/* the page, its code, its words: asked for fresh every time, the last copy kept for when there is no network */
async function fresh(req) {
  const cache = await caches.open(CODE);
  try {
    const res = req.mode === "navigate" ? await fetch(req.url, { cache: "no-cache", credentials: "same-origin" }) : await fetch(req, { cache: "no-cache" });
    if (res.ok && res.type === "basic") cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: req.mode === "navigate" });
    if (hit) return hit;
    throw err;
  }
}
