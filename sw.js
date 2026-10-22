// Saves the app's own files and its pictures on your phone so it opens with no signal.
// Online: always the live version (and the saved copy is refreshed). Offline: the saved copy.
const VERSION = 'v2';
const SHELL = `shell-${VERSION}`;
const IMG = 'img-v1';          // shared with offline.js; never deleted when the version changes
const SHELL_URLS = [
  './', 'index.html', 'app.js', 'offline.js', 'style.css', 'manifest.webmanifest?v=2',
  'icon-192.png?v=2', 'icon-512.png', 'apple-touch-icon.png?v=2',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) =>
    Promise.all(SHELL_URLS.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== SHELL && k !== IMG).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                         // quantity changes etc. always go straight to the server
  const url = new URL(req.url);
  if (url.origin !== self.location.origin && req.destination === 'image') { e.respondWith(imageFirst(req)); return; }
  if (url.origin === self.location.origin || url.hostname === 'cdn.jsdelivr.net') e.respondWith(shellFirst(req));
});

// the app's own files: live when online, saved copy when not
async function shellFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(req)) || (req.mode === 'navigate' ? (await cache.match('index.html')) || (await cache.match('./')) : null);
    if (hit) return hit;
    throw err;
  }
}

// pictures: saved copy first (instant, works offline); anything not saved yet is fetched and kept
async function imageFirst(req) {
  const cache = await caches.open(IMG);
  const hit = await cache.match(req.url, { ignoreVary: true });
  if (hit) return hit;
  return fetch(req);                                        // not saved yet: load it normally (offline.js saves them properly)
}
