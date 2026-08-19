/* Shepherd service worker — installable PWA + offline app shell + push notifications.
 *
 * Strategy:
 *  - Navigations: network-first, falling back to the cached shell (offline).
 *  - Same-origin assets: stale-while-revalidate (fast, then fresh).
 *  - Everything else (Convex API, external fonts, etc.): untouched.
 *  - Push events: display system notifications.
 *  - Notification clicks: focus or open the app to the notification URL.
 */
const CACHE = "shepherd-shell-v2";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/logo.svg",
  "/sidebar-logo.png",
  "/sidebarr-logo.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Leave non-app origins alone (Convex backend, external resources).
  if (url.origin !== self.location.origin) return;

  // Page navigations: try the network first, serve the cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put("/index.html", copy));
          }
          return res;
        })
        .catch(() => caches.match("/index.html")),
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const refresh = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || refresh;
    }),
  );
});

/* ===================== Push Notifications ===================== */

self.addEventListener("push", (event) => {
  const data = event.data?.json?.() ?? { title: "Shepherd", body: "", url: "/" };
  const url =
    typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/";

  event.waitUntil(
    self.registration.showNotification(data.title || "Shepherd", {
      body: data.body || "",
      icon: "/sidebar-logo.png",
      badge: "/sidebar-logo.png",
      data: { url },
      tag: "shepherd-notification",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(
    event.notification.data?.url || "/",
    self.location.origin,
  ).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clients) => {
        // Focus an existing Shepherd window if one is open.
        const client = clients[0];
        if (client) {
          await client.navigate(url);
          return client.focus();
        }
        // Otherwise open a new window.
        return self.clients.openWindow(url);
      }),
  );
});
