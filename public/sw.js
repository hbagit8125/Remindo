/* Remindo service worker: offline cache, push notifications and their buttons. */

const CACHE = "remindo-v2";
const STATIC = "remindo-static-v2";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(["/", "/icon-192.png"]))
      .catch(() => null),
  );
});

self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);

// Never cache these: sign-in, background jobs, downloads, live AI.
const NO_CACHE = /^\/api\/(auth|cron|deliver|sweep|telegram|push|action|backup|parse|scan|command|notify|transactions\/export)/;

/** Page/RSC requests carry a random _rsc param; key them by path so offline navigation finds them. */
function cacheKey(req) {
  const url = new URL(req.url);
  if (req.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) {
    url.searchParams.delete("_rsc");
    return url.origin + url.pathname + url.search + (url.search ? "&" : "?") + "__rsc=1";
  }
  return req.url;
}

async function networkFirst(req, fallbackToHome) {
  const key = cacheKey(req);
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    // Don't keep redirects (e.g. to /login) or errors.
    if (res.ok && !res.redirected && res.type === "basic") cache.put(key, res.clone()).catch(() => null);
    return res;
  } catch (err) {
    const hit = (await cache.match(key)) || (fallbackToHome ? await cache.match("/") : undefined);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone()).catch(() => null);
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/") || /\.(png|svg|ico|woff2?)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    if (NO_CACHE.test(url.pathname)) return;
    event.respondWith(networkFirst(req, false));
    return;
  }
  if (url.pathname === "/login" || url.pathname === "/share") return;
  if (req.mode === "navigate" || req.headers.get("RSC") === "1") event.respondWith(networkFirst(req, req.mode === "navigate"));
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Remindo", body: event.data ? event.data.text() : "" };
  }
  // Ticked off somewhere else: swap the alert for a quiet "✓ Done" and clear it shortly after.
  if (data.replace) {
    event.waitUntil(
      self.registration
        .showNotification(data.title || "Remindo", {
          body: data.body || "",
          tag: data.tag,
          renotify: false,
          silent: true,
          icon: "/icon-192.png",
          badge: "/badge-96.png",
          data: { url: data.url || "/", actions: [] },
        })
        .then(() => new Promise((r) => setTimeout(r, 4000)))
        .then(() => self.registration.getNotifications({ tag: data.tag }))
        .then((list) => list.forEach((n) => n.close())),
    );
    return;
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
