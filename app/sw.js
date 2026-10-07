// Service Worker: приложение и диагностическое ядро кэшируются на устройстве,
// поэтому интерфейс открывается и работает без связи. API не кэшируется.
const CACHE = 'toro-assistant-v4';
const ASSETS = ['/', '/index.html', '/styles.css', '/app.js', '/ui.js', '/db.js', '/sync.js', '/manifest.webmanifest', '/icon.svg',
  '/core/engine.js', '/core/rules.js', '/core/catalog.js', '/core/demo-data.js', '/core/knowledge.js'];

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/') || e.request.method !== 'GET') return;
  // network-first для статики (быстро подхватываем обновления), при отсутствии сети — кэш
  e.respondWith(fetch(e.request).then((r) => {
    const copy = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request).then((r) => r ?? caches.match('/index.html'))));
});
