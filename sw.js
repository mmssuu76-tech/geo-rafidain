const GEO_RAFIDAIN_CACHE = 'geo-rafidain-static-v6';
const NETWORK_FIRST_EXTENSIONS = new Set(['.html', '.css', '.js', '.json', '.webmanifest']);

const APP_SHELL = [
  './',
  './index.html',
  './dashboard.html',
  './privacy.html',
  './terms.html',
  './security.html',
  './styles.css',
  './dashboard.css',
  './legal.css',
  './script.js',
  './dashboard.js',
  './security.js',
  './study-map.js',
  './backend.js',
  './backend-config.js',
  './manifest.webmanifest',
  './assets/geo-rafidain.ico',
  './assets/geo-rafidain-icon.png',
  './assets/geo-rafidain-pwa-192.png',
  './assets/geo-rafidain-pwa-512.png',
  './assets/iraq-mark.svg',
  './assets/iraq-main.svg',
  './assets/iraq-governorates.geojson',
  './vendor/supabase-2.108.2.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(GEO_RAFIDAIN_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key !== GEO_RAFIDAIN_CACHE)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(GEO_RAFIDAIN_CACHE).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then(response => response || caches.match('./index.html')))
    );
    return;
  }

  const extension = requestUrl.pathname.includes('.')
    ? `.${requestUrl.pathname.split('.').pop().toLowerCase()}`
    : '';

  if (NETWORK_FIRST_EXTENSIONS.has(extension)) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (!response || response.status !== 200) return response;
          const copy = response.clone();
          caches.open(GEO_RAFIDAIN_CACHE).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request)
      .then(cached => cached || fetch(request).then(response => {
        if (!response || response.status !== 200) return response;
        const copy = response.clone();
        caches.open(GEO_RAFIDAIN_CACHE).then(cache => cache.put(request, copy));
        return response;
      }))
  );
});
