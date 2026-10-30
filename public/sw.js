// Minimal service worker: makes the app installable and keeps the shell available
// offline. Member data (anything under /api/) is never cached.
const CACHE = 'nsf-shell-v2';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/brand/crest-160.webp'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/')));
    return;
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/brand/')) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    })));
  }
});

// Phone notifications.
self.addEventListener('push', (e) => {
  let data = { title: 'NMSU Sports Forum', body: 'Something new on the forum.', link: '/' };
  try { data = { ...data, ...e.data.json() }; } catch { /* plain payload */ }
  e.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: '/icon-192.png', badge: '/favicon-64.png', data: { link: data.link } }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate(link); return c.focus(); } }
    return self.clients.openWindow(link);
  }));
});
