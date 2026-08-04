/* BRIDE sales panel — service worker for Web Push */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch (_) { d = { title: 'BRIDE', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'BRIDE', {
    body: d.body || '',
    icon: 'images/app-icon-180.png',
    badge: 'images/app-icon-180.png',
    dir: 'rtl',
    lang: 'he',
    data: { url: './ax91-panel.html' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
    for (const w of ws) if ('focus' in w) return w.focus();
    return clients.openWindow((e.notification.data && e.notification.data.url) || './');
  }));
});
