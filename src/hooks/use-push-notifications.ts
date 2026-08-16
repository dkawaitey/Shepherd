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

  const sync = useCallback(async () => {
    if (!active || !supported || publicKey == null) return;
    try {
      if (Notification.permission !== "granted") {
        setPermission(Notification.permission);
        setSubscribed(false);
        return;
      }
      setPermission("granted");
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }
      await subscribe({
        endpoint: sub.endpoint,
        p256dh: bufferToBase64(sub.getKey("p256dh")),
        auth: bufferToBase64(sub.getKey("auth")),
        userAgent: navigator.userAgent,
      });
      setSubscribed(true);
    } catch (err) {
      console.warn("[push] sync failed:", err);
      setSubscribed(false);
    }
  }, [active, supported, publicKey, subscribe]);

  // Always call the latest sync from listeners (ref avoids stale closures).
  const syncRef = useRef(sync);
  syncRef.current = sync;

  const enable = useCallback(async () => {
    if (!active || !supported || publicKey == null) {
      return {
        ok: false,
        reason:
          publicKey == null
            ? "Push is not set up yet — ask an administrator to generate the keys in Settings → Notifications"
            : "This browser does not support push notifications",
      };
    }
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        return { ok: false, reason: "Permission denied in the browser" };
      }
      await sync();
      return { ok: true };
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
    sync();

    // Re-register when the service worker reports a rotated subscription.
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "push-subscription-changed") {
        syncRef.current();
      }
    };
    // Also refresh whenever the tab becomes visible again.
    const onVisible = () => {
      if (document.visibilityState === "visible") syncRef.current();
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
