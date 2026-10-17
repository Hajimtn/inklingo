// Service worker: cache-first for the curated vocabulary photos (fast flashcards, works offline
// after first view). Everything else goes to the network so code updates are never stale.
// The app also asks it to fetch the current topic's photos in advance ({type: 'precache', urls}).

const CACHE = 'sw-img-v3'; // v3: WebP photos

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('sw-img-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.includes('/img/')) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }),
  );
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'precache' && Array.isArray(e.data.urls)) e.waitUntil(precache(e.data.urls));
});

/** One at a time, skipping what is cached already; stops at the first network error (offline). */
async function precache(urls) {
  const cache = await caches.open(CACHE);
  for (const u of urls.slice(0, 120)) {
    const url = new URL(u, location.href);
    if (url.origin !== location.origin || !url.pathname.includes('/img/')) continue;
    if (await cache.match(url.href)) continue;
    try {
      const res = await fetch(url.href);
      if (res.ok) await cache.put(url.href, res);
    } catch {
      return;
    }
  }
}
