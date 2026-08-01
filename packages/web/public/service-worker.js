/* global self */

self.addEventListener('push', (event) => {
  let payload;
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title =
    typeof payload.title === 'string' ? payload.title : '大富豪からのおしらせ';
  const body =
    typeof payload.body === 'string' ? payload.body : 'アプリで確認できます。';
  const url = typeof payload.url === 'string' ? payload.url : '/notifications';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/favicon-32.png',
      tag:
        typeof payload.notificationId === 'number'
          ? `notification-${String(payload.notificationId)}`
          : undefined,
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path =
    typeof event.notification.data?.url === 'string'
      ? event.notification.data.url
      : '/notifications';
  const destination = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (clients) => {
        const existing = clients.find(
          (client) => new URL(client.url).origin === self.location.origin,
        );
        if (existing) {
          await existing.navigate(destination);
          return existing.focus();
        }
        return self.clients.openWindow(destination);
      }),
  );
});
