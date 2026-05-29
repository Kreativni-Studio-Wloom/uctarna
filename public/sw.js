const CACHE_SHELL = 'uctarna-shell-v3';
const CACHE_STATIC = 'uctarna-static-v3';

const SHELL_URLS = ['/', '/manifest.json', '/favicon.ico', '/favicon.svg', '/apple-touch-icon.png'];

/** Hosty, které service worker nikdy nesmí interceptovat (CORS / ITP). */
const BYPASS_HOSTS = new Set([
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebase.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'www.googleapis.com',
]);

function mustBypassServiceWorker(url) {
  const { hostname, origin } = url;

  if (BYPASS_HOSTS.has(hostname)) return true;
  if (hostname.endsWith('.googleapis.com')) return true;
  if (hostname.endsWith('.firebaseapp.com')) return true;
  if (hostname.endsWith('.firebasestorage.app')) return true;

  // Veškerý cross-origin provoz necháme prohlížeči — SW nesmí sahat na Firebase ani jiné API.
  if (origin !== self.location.origin) return true;

  return false;
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_SHELL).then((cache) =>
      Promise.allSettled(SHELL_URLS.map((url) => cache.add(url)))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name !== CACHE_SHELL && name !== CACHE_STATIC)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_SHELL);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return cache.match('/') || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (mustBypassServiceWorker(url)) return;

  if (request.method !== 'GET') return;

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, CACHE_STATIC));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (url.pathname.startsWith('/_next/') || url.pathname.endsWith('.woff2')) {
    event.respondWith(cacheFirst(request, CACHE_STATIC));
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync') {
    event.waitUntil(Promise.resolve());
  }
});

self.addEventListener('push', (event) => {
  const options = {
    body: event.data ? event.data.text() : 'Nová notifikace z Účtárny',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1,
    },
    actions: [
      { action: 'explore', title: 'Otevřít', icon: '/icon-192x192.png' },
      { action: 'close', title: 'Zavřít', icon: '/icon-192x192.png' },
    ],
  };

  event.waitUntil(self.registration.showNotification('Účtárna', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'explore') {
    event.waitUntil(clients.openWindow('/'));
  }
});
