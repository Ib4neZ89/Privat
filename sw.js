// Offline-Unterstützung. Jede Version hat ihren eigenen Cache; eine neue Version wartet,
// bis der Nutzer in der App auf „Jetzt aktualisieren“ tippt (oder alle Fenster geschlossen waren).
// Bei jeder Änderung an der App VERSION hier und APP_VERSION in app.js gemeinsam erhöhen.
const VERSION = 5;
const CACHE = 'abrechnung-v' + VERSION;
const ASSETS = ['./', 'index.html', 'style.css', 'calc.js', 'xlsx.js', 'report.js', 'app.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  // cache: 'reload' umgeht den HTTP-Cache, damit wirklich die neuen Dateien geladen werden.
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })));
    // Ablösung der ersten Versionen (v1–v3) ohne Update-Button: sofort übernehmen statt zu warten.
    if ((await caches.keys()).some((k) => /^abrechnung-v[123]$/.test(k))) self.skipWaiting();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  const key = e.request.mode === 'navigate' ? './' : e.request;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(key, { ignoreSearch: true });
    return cached || fetch(e.request);
  }));
});
