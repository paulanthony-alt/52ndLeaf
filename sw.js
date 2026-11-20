/* Keeps 52nd Leaf working without a connection.
 * Pages and code: the network first (so updates arrive), falling back to the saved copy when the
 * network is slow or gone. Fonts: the saved copy first, refreshed in the background. */
const VERSION = 'v1';
const APP_CACHE = `leaf-app-${VERSION}`;
const FONT_CACHE = 'leaf-fonts';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'weeks.js', 'core.js', 'exif.js', 'prompts.js',
  'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'manifest.webmanifest',
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const NETWORK_WAIT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('leaf-app-') && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(request) {
  return caches.open(APP_CACHE).then(async (cache) => {
    const cached = await cache.match(request, { ignoreSearch: true });
    const fresh = fetch(request).then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    });
    if (!cached) return fresh;
    // With a saved copy, don't leave someone waiting on weak signal.
    return Promise.race([fresh, new Promise((_, reject) => setTimeout(reject, NETWORK_WAIT_MS))]).catch(() => cached);
  });
}

function staleWhileRevalidate(request) {
  return caches.open(FONT_CACHE).then(async (cache) => {
    const cached = await cache.match(request);
    const fresh = fetch(request).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
      return res;
    }).catch(() => cached);
    return cached || fresh;
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
  } else if (url.origin === self.location.origin) {
    event.respondWith(
      networkFirst(request).catch(() => (request.mode === 'navigate' ? caches.match('index.html') : Response.error()))
    );
  }
});
