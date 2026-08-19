import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";

type PushState = {
  subscribed: boolean;
  permission: NotificationPermission;
  subscription: PushSubscription | null;
};

type EnableResult = { ok: true } | { ok: false; reason: string };

/**
 * Manages the browser push subscription for the current user.
 *
 * - On mount: reads the existing browser subscription and syncs with the server.
 * - `enable()`: requests permission and subscribes.
 * - `disable()`: unsubscribes from the browser and removes from the server.
 */
export function usePushNotifications(enabled: boolean) {
  const [state, setState] = useState<PushState>({
    subscribed: false,
    permission: typeof Notification !== "undefined" ? Notification.permission : "default",
    subscription: null,
  });
  const [loading, setLoading] = useState(false);

  const getPublicKey = useQuery(api.push.getPublicKey);
  const saveSubscription = useMutation(api.push.saveSubscription);
  const removeSubscription = useMutation(api.push.removeSubscription);

  // Ref to avoid stale closure issues in the sync function.
  const saveRef = useRef(saveSubscription);
  saveRef.current = saveSubscription;
  const removeRef = useRef(removeSubscription);
  removeRef.current = removeSubscription;

  /**
   * Read the current browser subscription and sync it to the server.
   */
  const sync = useCallback(async (): Promise<EnableResult> => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const publicKey = getPublicKey;

      if (!existing) {
        setState({ subscribed: false, permission: Notification.permission, subscription: null });
        return { ok: true };
      }

      if (!publicKey) {
        return { ok: false, reason: "VAPID public key not available on the server" };
      }

      const p256dh = existing.toJSON().keys?.p256dh;
      const auth = existing.toJSON().keys?.auth;
      if (!p256dh || !auth) {
        return { ok: false, reason: "Subscription keys missing — try disabling and re-enabling" };
      }

      await saveRef.current({
        endpoint: existing.endpoint,
        p256dh,
        auth,
        userAgent: navigator.userAgent,
      });

      setState({
        subscribed: true,
        permission: Notification.permission,
        subscription: existing,
      });
      return { ok: true };
    } catch (err: any) {
      const reason = err?.message || String(err);
      console.warn("[push] sync failed:", reason);
      return { ok: false, reason };
    }
  }, [getPublicKey]);

  // Sync on mount when enabled.
  useEffect(() => {
    if (!enabled) return;
    // Check if the browser supports push notifications.
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    sync();
  }, [enabled, sync]);

  /**
   * Enable notifications — request permission, subscribe, and save to server.
   */
  const enable = useCallback(async (): Promise<EnableResult> => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      return { ok: false, reason: "Push notifications are not supported in this browser" };
    }

    setLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState((s) => ({ ...s, permission }));
        return { ok: false, reason: "Notification permission was denied" };
      }

      // Ensure the service worker is fully registered AND activated before subscribing.
      // navigator.serviceWorker.ready resolves when the SW is active, but in some
      // browsers/environments the controller may not be set yet, which causes
      // "Subscription failed - no active Service Worker". We wait for it explicitly.
      let registration = await navigator.serviceWorker.ready;
      if (!registration.active) {
        // Wait up to 5 seconds for the SW to become active.
        registration = await new Promise<ServiceWorkerRegistration>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Service worker did not activate in time")), 5000);
          const check = () => {
            navigator.serviceWorker.ready.then((reg) => {
              if (reg.active) {
                clearTimeout(timeout);
                resolve(reg);
              } else {
                // Retry in 200ms.
                setTimeout(check, 200);
              }
            });
          };
          check();
        });
      }

      const publicKey = getPublicKey;
      if (!publicKey) {
        return { ok: false, reason: "VAPID public key not configured — ask an administrator" };
      }

      // Convert base64 VAPID key to Uint8Array for the browser.
      const applicationServerKey = urlBase64ToUint8Array(publicKey);
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      const p256dh = subscription.toJSON().keys?.p256dh;
      const auth = subscription.toJSON().keys?.auth;
      if (!p256dh || !auth) {
        return { ok: false, reason: "Could not extract subscription keys" };
      }

      await saveRef.current({
        endpoint: subscription.endpoint,
        p256dh,
        auth,
        userAgent: navigator.userAgent,
      });

      setState({
        subscribed: true,
        permission: "granted",
        subscription,
      });
      return { ok: true };
    } catch (err: any) {
      const reason = err?.message || String(err);
      console.warn("[push] enable failed:", reason);
      return { ok: false, reason };
    } finally {
      setLoading(false);
    }
  }, [getPublicKey]);

  /**
   * Disable notifications — unsubscribe from browser and remove from server.
   */
  const disable = useCallback(async (): Promise<EnableResult> => {
    setLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();

      // Attempt browser unsubscribe.
      if (existing) {
        try {
          await existing.unsubscribe();
        } catch (err) {
          console.warn("[push] browser unsubscribe failed:", err);
        }
      }

      // Attempt server removal.
      if (existing) {
        try {
          await removeRef.current({ endpoint: existing.endpoint });
        } catch (err) {
          console.warn("[push] server remove failed:", err);
        }
      }

      setState({
        subscribed: false,
        permission: Notification.permission,
        subscription: null,
      });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, reason: err?.message || String(err) };
    } finally {
      setLoading(false);
    }
  }, []);

  return { ...state, loading, enable, disable, sync };
}

/**
 * Convert a base64url-encoded VAPID public key to a Uint8Array
 * for use with `PushManager.subscribe()`.
 */
function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return buffer;
}
