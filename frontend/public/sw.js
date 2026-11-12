/**
 * RNF-07 — Service worker: guarda la aplicación (HTML, JS, CSS, fuentes) para que se pueda abrir sin
 * conexión. Los datos (/api) NO se guardan aquí: el cliente HTTP conserva la última consulta de
 * disponibilidad e inventario y avisa que pueden estar desactualizados.
 */

const CACHE = 'bodega-app-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/index.html'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    // Archivos con hash en el nombre: primero caché
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {
      const copia = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copia));
      return res;
    })));
    return;
  }
  if (e.request.mode === 'navigate') {
    // HTML: primero red, si no hay, la copia
    e.respondWith(fetch(e.request).then((res) => {
      const copia = res.clone();
      caches.open(CACHE).then((c) => c.put('/index.html', copia));
      return res;
    }).catch(() => caches.match('/index.html')));
  }
});
