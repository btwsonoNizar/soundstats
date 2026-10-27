'use strict';
/*
 * Service worker: salva i file dell'app sul telefono così SoundStats
 * si apre anche offline. Quando pubblichi una nuova versione, cambia
 * il numero in CACHE (es. v2) per forzare l'aggiornamento.
 */
const CACHE = 'soundstats-v8';
const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'css/story.css',
  'js/config.js',
  'js/spotify.js',
  'js/images.js',
  'js/cloud.js',
  'js/app.js',
  'js/charts.js',
  'js/recap.js',
  'js/explore.js',
  'js/worker.js',
  'js/unzip.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Prima la copia salvata (veloce, funziona offline), poi aggiorna in background.
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  // Le API (sincronizzazione) vanno sempre in rete, mai in cache.
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  const key = req.mode === 'navigate' ? 'index.html' : req;
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(key, { ignoreSearch: true });
      const fresh = fetch(req)
        .then(res => { if (res.ok) cache.put(key, res.clone()); return res; })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});
