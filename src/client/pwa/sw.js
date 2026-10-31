// FairShift service worker. The build (src/client/pwa/plugin.ts) fills in the build ID and the list
// of application-shell files, so every release gets its own cache and the page can offer an update.
//
// What is cached: the application shell (HTML, the worker app's scripts and styles, icons, the
// offline page) and hashed static assets. What is never cached: anything under /api (records,
// pay, reports, sessions, passkey challenges), so no personal or employer data is stored by the
// service worker. Offline check-ins and report drafts live in the page's own outbox instead, and
// are only marked as recorded after the server confirms them.
const BUILD_ID = /* __FAIRSHIFT_BUILD_ID__ */ 'dev';
const PRECACHE = /* __FAIRSHIFT_PRECACHE__ */ ['/index.html', '/offline.html'];
const SHELL_CACHE = `fairshift-shell-${BUILD_ID}`;
const ASSET_CACHE = 'fairshift-assets-v1';
const OFFLINE_URL = '/offline.html';
const SHELL_URL = '/index.html';

self.addEventListener('install', (event) => {
  // Waits for the page to accept the update (see SKIP_WAITING) instead of taking over mid-task
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fairshift-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'GET_VERSION' && event.ports && event.ports[0]) event.ports[0].postMessage({ buildId: BUILD_ID });
});

/** Only complete, same-origin, storable responses are ever cached. */
function cacheable(response) {
  if (!response || !response.ok || response.type !== 'basic') return false;
  const cc = response.headers.get('Cache-Control') || '';
  return !/no-store|private/i.test(cc);
}

async function networkFirstPage(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match(SHELL_URL)) || (await cache.match(OFFLINE_URL)) || Response.error();
  }
}

async function cacheFirstAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheable(response)) {
    const copy = response.clone();
    caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (cacheable(response)) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached || Response.error());
  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never touch the API: records and sessions always go to the network
  if (url.pathname.startsWith('/api/') || url.pathname === '/api' || url.pathname === '/healthz') return;
  if (url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirstAsset(request));
  } else if (PRECACHE.includes(url.pathname) || url.pathname.startsWith('/icons/')) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
