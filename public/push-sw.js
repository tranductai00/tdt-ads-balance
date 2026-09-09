"use strict";

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch {
    try { payload = { body: event.data ? event.data.text() : "" }; } catch {}
  }
  const title = payload.title || "T Balance";
  const body = payload.body || "Có dữ liệu mới.";
  const url = payload.url || "/";
  const tag = payload.tag || "tbalance-notification";
  event.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body,
      tag,
      renotify: true,
      data: { ...(payload.data || {}), url },
    });
    const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clientsList) {
      client.postMessage({ type: "TBALANCE_PUSH", title, body, url, data: payload.data || {} });
    }
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification?.data?.url || "/";
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of list) {
      try {
        const current = new URL(client.url);
        const desired = new URL(target, self.location.origin);
        if (current.origin === desired.origin) {
          await client.focus();
          if (client.navigate) await client.navigate(desired.toString());
          return;
        }
      } catch {}
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
