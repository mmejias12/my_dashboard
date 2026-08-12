// sw.js · Service worker de REDTEC OS (PWA)
// Estrategia: NETWORK-FIRST. Siempre intenta la red (para que el contenido y
// los datos estén frescos y la sesión/seguridad funcionen), y solo cae al
// caché si no hay conexión. Nunca toca /api ni /.auth (datos y login siempre
// en vivo). La app se actualiza sola: al desplegar una versión nueva, el
// próximo arranque ya trae lo último.

const CACHE = 'redtecos-v1';
const SHELL = [
  '/redtec-os.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const claves = await caches.keys();
    await Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // POST (API) pasa directo
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // cross-origin: no intervenir
  if (url.pathname.startsWith('/api/') ||                 // datos: siempre en vivo
      url.pathname.startsWith('/.auth/')) return;         // login/sesión: nunca cachear

  e.respondWith((async () => {
    try {
      const net = await fetch(req);
      // refresca en caché los archivos del "shell" para el modo offline
      if (net && net.ok && SHELL.indexOf(url.pathname) !== -1) {
        const c = await caches.open(CACHE);
        c.put(req, net.clone());
      }
      return net;
    } catch (err) {
      const cached = await caches.match(req);
      return cached || caches.match('/redtec-os.html');
    }
  })());
});