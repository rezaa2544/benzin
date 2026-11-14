/*
 * Benzin service worker (task E9-15, PWA on iOS).
 *
 * Three rules, deliberately boring:
 *   1. Never cache `/v1/**` — sessions, OTPs and orders are per-user and must not survive offline.
 *   2. A navigation is network-first: fresh HTML when online, the cached shell (or the offline card)
 *      when the network is gone, so an installed icon never opens a browser error page.
 *   3. Static build output is stale-while-revalidate: instant load, refreshed in the background.
 *
 * Bump VERSION when PRECACHE changes; activate drops every older `benzin-web-*` cache.
 */
const VERSION = 'v1';
const CACHE = `benzin-web-${VERSION}`;
const SHELL = '/';
const OFFLINE_URL = '/offline.html';
const API_PREFIX = '/v1';
const PRECACHE = [
  SHELL,
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon-180.png',
  '/icons/favicon-32.png',
  '/icons/favicon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('benzin-web-') && key !== CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') void self.skipWaiting();
});

const isApi = (url) => url.pathname === API_PREFIX || url.pathname.startsWith(`${API_PREFIX}/`);
const isStatic = (url) => /\.(?:js|css|mjs|woff2?|png|svg|ico|webmanifest)$/.test(url.pathname);

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(SHELL, response.clone());
    return response;
  } catch {
    return (await cache.match(SHELL)) || (await cache.match(OFFLINE_URL)) || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) void cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached || Response.error());
  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Cross-origin (tiles, fonts CDNs) and the API are never touched: a stale balance is worse
  // than a slow one.
  if (url.origin !== self.location.origin || isApi(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  if (isStatic(url)) event.respondWith(staleWhileRevalidate(request));
});
