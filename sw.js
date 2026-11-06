/* TABIROGU service worker — network-first (always the latest version when online), cache fallback offline */
const VERSION = '0.6.1';
const CACHE = 'tabirogu-v' + VERSION;
const CORE = ['./', './index.html', './app.css', './manifest.webmanifest', './js/store.js', './js/geo.js', './js/photos.js', './js/app.js', './js/guide.js', './js/movie.js', './js/stats.js', './js/places.js', './js/sync.js',
  './data/japan.topo.json', './data/world.topo.json', './icons/icon-192.png'];
const CDN = ['https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js', 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', 'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.umd.js'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all([
    ...CORE.map(u => fetch(new Request(u, { cache: 'reload' })).then(r => r.ok && c.put(u, r))),
    ...CDN.map(u => c.add(u).catch(() => { }))
  ])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (/(^|\.)(openstreetmap\.org|overpass-api\.de|kumi\.systems|wikipedia\.org|wikidata\.org|wikimedia\.org)$/.test(url.hostname)) return; // live data & map tiles: never cache
  const own = url.origin === self.location.origin;
  if (own) { // network first, bypassing the 10-minute HTTP cache
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html'))));
  } else { // CDN libraries & fonts: cache first (versioned URLs)
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
  }
});
