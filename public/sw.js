self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { body: event.data.text() };
  }
  const title = payload.title || 'Announcement Room';
  const options = {
    body: payload.body || 'There is an update in your room.',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: payload.tag || 'announcement-room',
    data: { path: payload.path || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = event.notification.data?.path || '/';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => 'focus' in client);
    if (existing) {
      existing.navigate(path);
      return existing.focus();
    }
    return clients.openWindow(path);
  }));
});
