/* Shepherd service worker — installable PWA + offline app shell.
 *
 * Strategy:
 *  - Navigations: network-first, falling back to the cached shell (offline).
 *  - Same-origin assets: stale-while-revalidate (fast, then fresh).
 *  - Everything else (Convex API, external fonts, etc.): untouched.
 */
const CACHE = "shepherd-shell-v1";
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

/* ===== Web push notifications (WhatsApp-style delivery) ===== */

// Show a system notification when a push message arrives. The payload is
// encrypted by the server (VAPID / aes128gcm) and decrypted by the browser.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Non-JSON payload — fall back to a generic notification.
  }
  const title = data.title || "Shepherd";
  const options = {
    body: data.message || "You have a new update in Shepherd.",
    icon: "/sidebarr-logo.png",
    badge: "/sidebarr-logo.png",
    data: { url: data.link || "/dashboard" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping the notification opens (or focuses) the app at the right page.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/dashboard";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          if ("focus" in client && "navigate" in client) {
            if (client.url !== url) client.navigate(url).catch(() => undefined);
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});

// The browser rotated the subscription (e.g. after expiry). Ask any open tab
// to re-register it, since only the page holds the Convex auth session.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) =>
        clients.forEach((c) => c.postMessage({ type: "push-subscription-changed" })),
      ),
  );
});
