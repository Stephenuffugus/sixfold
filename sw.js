/* SIXFOLD service worker — offline app shell.
 *
 * Strategy:
 *  - HTML/navigation: network-first (always get the freshest game when online),
 *    fall back to cache when offline.
 *  - everything else: cache-first, then network (and cache same-origin GETs).
 * Bump CACHE on every deploy so clients drop the old shell.
 */
const CACHE = "sixfold-v15";
const ASSETS = ["./", "./index.html", "./sixfold.html", "./manifest.webmanifest", "./icon.svg",
  "./skins/ronin.png", "./skins/kage.png", "./skins/tetsu.png", "./skins/onibi.png", "./skins/sora.png",
  "./skins/honekage.png", "./skins/raiden.png", "./skins/yurei.png", "./skins/mukade.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const accept = req.headers.get("accept") || "";
  const isHTML = req.mode === "navigate" || accept.indexOf("text/html") >= 0;

  if (isHTML) {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) =>
      hit || fetch(req).then((res) => {
        try {
          if (res && res.ok && new URL(req.url).origin === self.location.origin) {
            const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy));
          }
        } catch (_) {}
        return res;
      })
    )
  );
});
