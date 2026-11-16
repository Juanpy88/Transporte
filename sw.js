// Network-first: siempre intenta la versión nueva; sin señal usa la copia guardada.
const V = 'rutas-v1';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'css/styles.css', 'js/app.js', 'js/config.js', 'js/gps.js',
  'js/storage.js', 'js/importer.js', 'js/providers/routing.js', 'js/providers/osrm.js', 'js/providers/geocoder.js'];

self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || !(u.origin === location.origin || u.host === 'unpkg.com' || u.host === 'cdnjs.cloudflare.com')) return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request)));
});
