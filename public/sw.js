/* Remindo service worker: shows push notifications and handles their buttons. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Remindo", body: event.data ? event.data.text() : "" };
  }
  const actions = (data.actions || []).map((a) => ({ action: a.action, title: a.title }));
  event.waitUntil(
    self.registration.showNotification(data.title || "Remindo", {
      body: data.body || "",
      tag: data.tag,
      renotify: Boolean(data.tag),
      requireInteraction: Boolean(data.sticky),
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      vibrate: data.sticky ? [200, 100, 200, 100, 200] : [150, 80, 150],
      actions,
      data: { url: data.url || "/", actions: data.actions || [] },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  const n = event.notification;
  const { url, actions } = n.data || {};
  n.close();

  // A button (Done / Snooze): run it in the background without opening the app.
  const button = (actions || []).find((a) => a.action === event.action);
  if (button) {
    event.waitUntil(
      fetch("/api/push/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ t: button.token }),
      })
        .then((r) => r.json())
        .then((res) =>
          self.registration.showNotification(res.ok ? res.title : "Couldn't update", {
            body: res.message || "",
            tag: "remindo-action-result",
            icon: "/icon-192.png",
            badge: "/badge-96.png",
            silent: true,
          }),
        )
        .catch(() => null),
    );
    return;
  }

  // Tapping the notification itself opens (or focuses) the app.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) {
          w.navigate(url || "/");
          return w.focus();
        }
      }
      return self.clients.openWindow(url || "/");
    }),
  );
});
