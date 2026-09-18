/* Shepherd service worker — installable PWA + offline app shell + push notifications.
 *
 * Strategy:
 *  - Navigations: network-first, falling back to the cached shell (offline).
 *  - Same-origin assets: stale-while-revalidate (fast, then fresh).
 *  - Everything else (Convex API, external fonts, etc.): untouched.
 *  - Push events: display system notifications with Android channel support.
 *  - Notification clicks: focus or open the app to the notification URL.
 */

const CACHE = "shepherd-shell-v5";
const PUSH_CACHE = "shepherd-push-v1";
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
    caches.open(CACHE).then(async (cache) => {
      // Cache each shell entry on its own. `cache.addAll` is atomic: one
      // missing or non-200 URL would abort the whole install, leaving the
      // *previous* worker in control of the browser — which after a deploy
      // looks like the new build never arrived. A partial shell still gives
      // a working offline fallback, so failures here are tolerated.
      await Promise.all(
        SHELL.map((url) =>
          cache.add(url).catch(() => {
            /* optional shell entry — ignore */
          }),
        ),
      );
      await self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE && k !== PUSH_CACHE)
            .map((k) => caches.delete(k)),
        ),
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

/*
 * Browsers silently rotate or drop push subscriptions (OS updates, storage
 * pressure, PWA updates). When that happens the app would stop receiving
 * notifications and the user had to switch them back on by hand. To prevent
 * that, the VAPID public key is cached here by the page, so the worker can
 * re-subscribe all on its own and hand the new endpoint back to open pages.
 */
const VAPID_CACHE_KEY = "/__vapid-public-key";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return buffer;
}

async function storeVapidKey(key) {
  const cache = await caches.open(PUSH_CACHE);
  await cache.put(VAPID_CACHE_KEY, new Response(key));
}

async function readVapidKey() {
  try {
    const cache = await caches.open(PUSH_CACHE);
    const res = await cache.match(VAPID_CACHE_KEY);
    return res ? await res.text() : null;
  } catch {
    return null;
  }
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (data && data.type === "shepherd:vapid" && typeof data.key === "string") {
    event.waitUntil(storeVapidKey(data.key));
  }
});

/* The browser replaced our subscription — re-subscribe and tell open pages. */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const key = await readVapidKey();
        if (!key) return;
        const subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        });
        const clients = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        for (const client of clients) {
          client.postMessage({
            type: "shepherd:push-resubscribed",
            subscription: subscription.toJSON(),
          });
        }
        const old = event.oldSubscription;
        if (old) {
          try {
            await old.unsubscribe();
          } catch {
            /* already gone */
          }
        }
      } catch {
        /* If this fails the app restores the subscription on next open. */
      }
    })(),
  );
});

self.addEventListener("push", (event) => {
  const data = event.data?.json?.() ?? { title: "Shepherd", body: "", url: "/" };
  const url =
    typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/";

  // Generate a unique tag per notification to prevent Android from collapsing them.
  const tag = `shepherd-${data.title?.toLowerCase().replace(/\s+/g, "-") || "notification"}-${Date.now()}`;

  event.waitUntil(
    self.registration.showNotification(data.title || "Shepherd", {
      body: data.body || "",
      icon: "/sidebarr-logo.png",
      badge: "/sidebarr-logo.png",
      image: "/sidebarr-logo.png",
      data: { url },
      tag,
      renotify: true,
      requireInteraction: true,
      silent: false,
      vibrate: [200, 100, 200],
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

self.addEventListener("notificationclose", (event) => {
  // Track dismissal if needed.
});
