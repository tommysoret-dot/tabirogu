/* TABRIOGU service worker — offline cache */
const CACHE = 'tabriogu-v0.2.0';
const CORE = ['./', './index.html', './app.css', './manifest.webmanifest', './js/store.js', './js/geo.js', './js/photos.js', './js/app.js', './js/guide.js',
  './data/japan.topo.json', './data/world.topo.json', './icons/icon-192.png',
  'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js', 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', 'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.umd.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
    if (res.ok && (e.request.url.startsWith(self.location.origin) || e.request.url.includes('fonts.g'))) {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy));
    }
    return res;
  }).catch(() => caches.match('./index.html'))));
});
