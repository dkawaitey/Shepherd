import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";

/** Convert a base64url VAPID public key to the Uint8Array PushManager expects. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const cleaned = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(cleaned);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function bufferToBase64(buffer: ArrayBuffer | null): string {
  if (!buffer) return "";
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

export type PushState = {
  /** Whether this browser supports web push (secure context + PushManager). */
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  /** Whether this device currently has a push subscription registered. */
  subscribed: boolean;
  enable: () => Promise<{ ok: boolean; reason?: string }>;
  disable: () => Promise<void>;
};

/**
 * Keeps the browser's push subscription in sync with the backend and exposes
 * enable/disable controls. When `active` and permission is already granted,
 * the subscription is (re-)registered silently on load and whenever the
 * service worker reports a `pushsubscriptionchange`.
 */
export function usePushNotifications(active = true): PushState {
  const subscribe = useMutation(api.settings.subscribe);
  const unsubscribe = useMutation(api.settings.unsubscribe);
  const publicKey = useQuery(api.settings.getVapidPublicKey);

  const supported =
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >("unsupported");
  const [subscribed, setSubscribed] = useState(false);

  /**
   * Core subscription sync — throws on failure so callers can surface errors.
   */
  const sync = useCallback(async (): Promise<{ ok: boolean; reason?: string }> => {
    if (!active || !supported) return { ok: false, reason: "Push not supported on this browser" };
    if (publicKey == null) return { ok: false, reason: "VAPID public key not loaded yet" };

    if (Notification.permission !== "granted") {
      setPermission(Notification.permission);
      setSubscribed(false);
      return { ok: false, reason: "Notification permission not granted" };
    }
    setPermission("granted");

    try {
      const reg = await navigator.serviceWorker.ready;

      // Check if there's already an active subscription
      let sub = await reg.pushManager.getSubscription();

      if (!sub) {
        // No subscription yet — create one
        try {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
          });
        } catch (subErr) {
          const msg = subErr instanceof Error ? subErr.message : String(subErr);
          console.error("[push] pushManager.subscribe failed:", subErr);
          // Common causes: VAPID key mismatch, service worker not active, browser restrictions
          if (msg.includes("InvalidAccessError")) {
            return { ok: false, reason: "VAPID key may be invalid — regenerate keys in Settings → Notifications" };
          }
          if (msg.includes("NotSupportedError")) {
            return { ok: false, reason: "Push notifications are not supported in this context — try installing the app to your Home Screen" };
          }
          return { ok: false, reason: `Browser subscription failed: ${msg}` };
        }
      }

      // Save (or refresh) the subscription on the server
      try {
        await subscribe({
          endpoint: sub.endpoint,
          p256dh: bufferToBase64(sub.getKey("p256dh")),
          auth: bufferToBase64(sub.getKey("auth")),
          userAgent: navigator.userAgent,
        });
      } catch (subErr) {
        const msg = subErr instanceof Error ? subErr.message : String(subErr);
        console.error("[push] server subscribe failed:", subErr);
        return { ok: false, reason: `Server rejected subscription: ${msg}` };
      }

      setSubscribed(true);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[push] sync failed:", err);
      setSubscribed(false);
      return { ok: false, reason: msg };
    }
  }, [active, supported, publicKey, subscribe]);

  // Always call the latest sync from listeners (ref avoids stale closures).
  const syncRef = useRef(sync);
  syncRef.current = sync;

  const enable = useCallback(async () => {
    if (!active || !supported) {
      return {
        ok: false,
        reason: "This browser does not support push notifications — use Chrome, Edge or Firefox, or install the app on iOS 16.4+",
      };
    }
    if (publicKey == null) {
      return {
        ok: false,
        reason:
          "Push is not set up yet — ask an administrator to generate the keys in Settings → Notifications",
      };
    }
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        return { ok: false, reason: "Permission denied in the browser" };
      }
      // sync() now throws on failure
      const result = await sync();
      return result;
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : "Could not enable notifications",
      };
    }
  }, [active, supported, publicKey, sync]);

  const disable = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribe({ endpoint: sub.endpoint }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch (err) {
      console.warn("[push] disable failed:", err);
    }
  }, [unsubscribe]);

  useEffect(() => {
    if (!active || !supported) return;
    setPermission(Notification.permission);

    // Silent re-registration — don't throw on failure here, just log
    sync().catch(() => {});

    // Re-register when the service worker reports a rotated subscription.
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "push-subscription-changed") {
        syncRef.current().catch(() => {});
      }
    };
    // Also refresh whenever the tab becomes visible again.
    const onVisible = () => {
      if (document.visibilityState === "visible") syncRef.current().catch(() => {});
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, supported, sync]);

  return { supported, permission, subscribed, enable, disable };
}
