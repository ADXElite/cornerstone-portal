// Minimal service worker: makes the portal installable and keeps the app shell available offline.
// API calls and the office portal are never cached.
const CACHE = 'ccs-portal-v3';
const SHELL = ['/', '/theme.css', '/app.js', '/icons/logo-horizontal.webp', '/icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/office')) return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('/'))));
});

// Push alerts from the front office
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'Cornerstone', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Cornerstone Christian School', {
    body: d.body || '', icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', tag: d.tag || undefined, data: { url: d.url || '/' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) { if ('focus' in w) { await w.focus(); if ('navigate' in w && w.url !== target) w.navigate(target); return; } }
    return self.clients.openWindow(target);
  })());
});
