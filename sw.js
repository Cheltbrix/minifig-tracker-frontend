// Saves the app on your phone so it opens instantly and works offline.
// Online: you always get the live version (and the saved copy is refreshed). Offline or very slow server: the last saved copy.
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const DATA = `data-${VERSION}`;
const SHELL_URLS = [
  './', 'index.html', 'app.js', 'style.css', 'manifest.webmanifest?v=2',
  'icon-192.png?v=2', 'icon-512.png', 'apple-touch-icon.png?v=2',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
];
const SLOW_MS = 4000;      // if the server takes longer than this and we have a saved copy, show the saved copy
const MAX_DATA = 200;      // how many saved answers to keep

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) =>
    Promise.all(SHELL_URLS.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // changes (quantity, remove) always go straight to the server
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) { e.respondWith(dataFirst(e, req)); return; }
  if (url.origin === self.location.origin || url.hostname === 'cdn.jsdelivr.net') e.respondWith(shellFirst(req));
});

// pages, scripts, styles: live version when online, saved copy when not
async function shellFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(req)) || (req.mode === 'navigate' ? await cache.match('index.html') || await cache.match('./') : null);
    if (hit) return hit;
    throw err;
  }
}

// prices and lists: live when the server answers, saved copy when offline or too slow
async function dataFirst(e, req) {
  const cache = await caches.open(DATA);
  const saved = await cache.match(req.url);
  const live = fetch(req).then(async (res) => {
    if (res.ok) { await cache.put(req.url, res.clone()); trim(cache); }
    return res;
  });
  if (!saved) return live;                                  // nothing saved yet: wait for the server
  e.waitUntil(live.catch(() => {}));                        // keep refreshing the saved copy even if we answer early
  const slow = new Promise((r) => setTimeout(() => r(null), SLOW_MS));
  const res = await Promise.race([live.catch(() => null), slow]);
  if (res && (res.ok || res.status < 500)) return res;
  return flagged(saved);
}

async function flagged(saved) {
  const headers = new Headers(saved.headers);
  headers.set('x-offline-copy', '1');
  headers.set('content-language', 'offline-copy');   // a header the browser lets the page read on cross-site answers
  return new Response(await saved.clone().blob(), { status: 200, headers });
}

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_DATA) await Promise.all(keys.slice(0, keys.length - MAX_DATA).map((k) => cache.delete(k)));
}
