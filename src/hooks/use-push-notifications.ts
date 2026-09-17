import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatError } from "@/components/shared";

type PushState = {
  /** A live browser push subscription exists for this device. */
  deviceSubscribed: boolean;
  permission: NotificationPermission;
  subscription: PushSubscription | null;
};

type EnableResult = { ok: true } | { ok: false; reason: string };

/** Backoff between silent re-subscribe attempts after a failure. */
const HEAL_RETRY_MS = [2_000, 8_000, 30_000, 120_000];
/** How often to re-check the browser subscription while the app is open. */
const RECHECK_MS = 15 * 60 * 1000;

function pushSupported() {
  return (
    typeof window !== "undefined" &&
    typeof Notification !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

function currentPermission(): NotificationPermission {
  return typeof Notification !== "undefined" ? Notification.permission : "denied";
}

/**
 * Manages device push notifications for the current user.
 *
 * The *intent* is stored on the server (`push.setPreference`), and the browser
 * subscription is treated as a disposable cache of it. If the browser drops or
 * rotates its subscription — which is what used to silently switch the toggle
 * back off and force everyone to re-enable — the hook re-subscribes in the
 * background without asking the user for anything, as long as permission was
 * already granted.
 */
export function usePushNotifications(enabled: boolean) {
  const [state, setState] = useState<PushState>({
    deviceSubscribed: false,
    permission: currentPermission(),
    subscription: null,
  });
  const [loading, setLoading] = useState(false);
  const [healFailed, setHealFailed] = useState(false);

  const getPublicKey = useQuery(api.push.getPublicKey);
  const pref = useQuery(api.push.myPreference);
  const saveSubscription = useMutation(api.push.saveSubscription);
  const removeSubscription = useMutation(api.push.removeSubscription);
  const setPreference = useMutation(api.push.setPreference);

  // Refs keep the callbacks stable and avoid stale closures.
  const saveRef = useRef(saveSubscription);
  saveRef.current = saveSubscription;
  const removeRef = useRef(removeSubscription);
  removeRef.current = removeSubscription;
  const setPrefRef = useRef(setPreference);
  setPrefRef.current = setPreference;
  const publicKeyRef = useRef<string | null | undefined>(getPublicKey);
  publicKeyRef.current = getPublicKey;

  const healAttempts = useRef(0);
  const busyRef = useRef(false);

  /** Wait for an *active* service worker — subscribing without one is the
   *  classic "no active Service Worker" failure. */
  const getRegistration = useCallback(async (): Promise<ServiceWorkerRegistration> => {
    // `ready` never resolves when no registration succeeded (unsupported
    // context, embedded preview, failed install), so don't hang on it forever.
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Service worker is not available in this browser context")),
          8000,
        ),
      ),
    ]);
    if (reg.active) return reg;
    return await new Promise<ServiceWorkerRegistration>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Service worker did not activate in time")),
        8000,
      );
      const check = () => {
        navigator.serviceWorker.ready.then((r) => {
          if (r.active) {
            clearTimeout(timeout);
            resolve(r);
          } else {
            setTimeout(check, 200);
          }
        });
      };
      check();
    });
  }, []);

  /** Hand the VAPID key to the service worker so it can re-subscribe itself
   *  when the browser rotates the subscription with no page open. */
  const handKeyToServiceWorker = useCallback(async (key: string) => {
    try {
      const reg = await navigator.serviceWorker.ready;
      reg.active?.postMessage({ type: "shepherd:vapid", key });
    } catch {
      /* best effort */
    }
  }, []);

  /** Persist an existing browser subscription to the server. */
  const saveExisting = useCallback(async (sub: PushSubscription): Promise<EnableResult> => {
    const p256dh = sub.toJSON().keys?.p256dh;
    const auth = sub.toJSON().keys?.auth;
    if (!p256dh || !auth) {
      return { ok: false, reason: "Subscription keys missing — disabling and re-enabling fixes this" };
    }
    await saveRef.current({
      endpoint: sub.endpoint,
      p256dh,
      auth,
      userAgent: navigator.userAgent,
    });
    setState((s) => ({ ...s, deviceSubscribed: true, subscription: sub, permission: currentPermission() }));
    return { ok: true };
  }, []);

  /** Create a fresh browser subscription (permission must already be granted). */
  const subscribeNow = useCallback(async (key: string): Promise<EnableResult> => {
    const registration = await getRegistration();
    const existing = await registration.pushManager.getSubscription();
    if (existing) return await saveExisting(existing);

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
    await handKeyToServiceWorker(key);
    return await saveExisting(subscription);
  }, [getRegistration, handKeyToServiceWorker, saveExisting]);

  /**
   * Reconcile this device with the server-side intent:
   *  - subscription exists  → make sure the server has the current endpoint
   *  - subscription missing  → silently re-subscribe (permission already granted)
   */
  const reconcile = useCallback(async (intentOn: boolean): Promise<EnableResult> => {
    if (!pushSupported()) return { ok: false, reason: "Push notifications are not supported in this browser" };
    const key = publicKeyRef.current;
    if (!key) return { ok: false, reason: "VAPID public key not available on the server" };

    const registration = await getRegistration();
    const existing = await registration.pushManager.getSubscription();

    if (existing) return await saveExisting(existing);

    setState((s) => ({ ...s, deviceSubscribed: false, subscription: null, permission: currentPermission() }));

    // Nothing to restore if notifications were turned off.
    if (!intentOn) return { ok: true };
    if (currentPermission() !== "granted") {
      return { ok: false, reason: "Notification permission is not granted on this device" };
    }

    return await subscribeNow(key);
  }, [getRegistration, saveExisting, subscribeNow]);

  // Restore the device subscription whenever the app opens (or the user/session
  // changes). This is what stops the "it forgot I enabled it" reset.
  useEffect(() => {
    if (!enabled || pref === undefined) return;
    if (!pushSupported()) return;

    let cancelled = false;

    (async () => {
      const result = await reconcile(!!pref.enabled);
      if (cancelled) return;
      if (result.ok) {
        healAttempts.current = 0;
        setHealFailed(false);
      } else {
        setHealFailed(true);
        console.warn("[push] reconcile failed:", result.reason);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, pref?.enabled, pref === undefined, reconcile]);

  // The service worker can replace the subscription on its own (see
  // `pushsubscriptionchange`); register the new endpoint with the server.
  useEffect(() => {
    if (!enabled || !pushSupported()) return;

    const onMessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } }
        | undefined;
      if (data?.type !== "shepherd:push-resubscribed") return;
      const endpoint = data.subscription?.endpoint;
      const p256dh = data.subscription?.keys?.p256dh;
      const auth = data.subscription?.keys?.auth;
      if (!endpoint || !p256dh || !auth) return;
      void saveRef
        .current({ endpoint, p256dh, auth, userAgent: navigator.userAgent })
        .then(() => setState((s) => ({ ...s, deviceSubscribed: true })))
        .catch((err) => console.warn("[push] resubscribe save failed:", formatError(err, String(err))));
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [enabled]);

  // If the intent is on but this device has no subscription yet (permission
  // granted), keep retrying with backoff instead of leaving it silently off.
  useEffect(() => {
    if (!enabled || !pref?.enabled) return;
    if (!pushSupported() || currentPermission() !== "granted") return;
    if (state.deviceSubscribed || !healFailed) return;
    if (!publicKeyRef.current) return;
    if (healAttempts.current >= HEAL_RETRY_MS.length) return;

    const delay = HEAL_RETRY_MS[healAttempts.current];
    const t = setTimeout(async () => {
      healAttempts.current += 1;
      const key = publicKeyRef.current;
      if (!key) return;
      try {
        const result = await subscribeNow(key);
        if (result.ok) {
          healAttempts.current = 0;
          setHealFailed(false);
        }
      } catch (err) {
        console.warn("[push] retry failed:", formatError(err, String(err)));
      }
    }, delay);

    return () => clearTimeout(t);
  }, [enabled, pref?.enabled, state.deviceSubscribed, healFailed, subscribeNow]);

  // Browsers can drop the subscription while the app is open (OS updates,
  // storage pressure, PWA updates). Re-check on focus and periodically.
  useEffect(() => {
    if (!enabled || !pref?.enabled) return;
    if (!pushSupported()) return;

    const check = async () => {
      if (busyRef.current) return;
      const result = await reconcile(true);
      if (!result.ok) console.warn("[push] recheck failed:", result.reason);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const interval = setInterval(onVisible, RECHECK_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      clearInterval(interval);
    };
  }, [enabled, pref?.enabled, reconcile]);

  /** Explicit user opt-in from the settings toggle. */
  const enable = useCallback(async (): Promise<EnableResult> => {
    if (!pushSupported()) {
      return { ok: false, reason: "Push notifications are not supported in this browser" };
    }

    setLoading(true);
    busyRef.current = true;
    try {
      const permission = await Notification.requestPermission();
      setState((s) => ({ ...s, permission }));
      if (permission !== "granted") {
        return { ok: false, reason: "Notification permission was denied" };
      }

      const key = publicKeyRef.current;
      if (!key) {
        return { ok: false, reason: "VAPID public key not configured — ask an administrator" };
      }

      // Record the intent first so a failure to subscribe still counts as the
      // user wanting notifications, and the background heal can finish the job.
      await setPrefRef.current({ enabled: true, userAgent: navigator.userAgent });

      const result = await subscribeNow(key);
      if (result.ok) {
        healAttempts.current = 0;
        setHealFailed(false);
      }
      return result;
    } catch (err: any) {
      const reason = formatError(err, String(err));
      console.warn("[push] enable failed:", reason);
      return { ok: false, reason };
    } finally {
      setLoading(false);
      busyRef.current = false;
    }
  }, [subscribeNow]);

  /** Explicit user opt-out from the settings toggle. */
  const disable = useCallback(async (): Promise<EnableResult> => {
    setLoading(true);
    busyRef.current = true;
    try {
      const registration = await getRegistration().catch(() => null);
      const existing = registration
        ? await registration.pushManager.getSubscription().catch(() => null)
        : null;

      if (existing) {
        try {
          await existing.unsubscribe();
        } catch (err) {
          console.warn("[push] browser unsubscribe failed:", err);
        }
        try {
          await removeRef.current({ endpoint: existing.endpoint });
        } catch (err) {
          console.warn("[push] server remove failed:", err);
        }
      } else {
        // No browser subscription to key off — clear the intent server-side.
        await setPrefRef.current({ enabled: false });
      }

      healAttempts.current = 0;
      setHealFailed(false);
      setState((s) => ({ ...s, deviceSubscribed: false, subscription: null, permission: currentPermission() }));
      return { ok: true };
    } catch (err: any) {
      return { ok: false, reason: formatError(err, String(err)) };
    } finally {
      setLoading(false);
      busyRef.current = false;
    }
  }, [getRegistration]);

  const permission = currentPermission();

  // The toggle reflects the saved intent, not the transient browser state, so it
  // never appears to switch itself off while a subscription is being restored.
  const subscribed = pref === undefined
    ? state.deviceSubscribed && permission === "granted"
    : !!pref.enabled && permission === "granted";

  return {
    subscribed,
    /** True once this device actually holds a live push subscription. */
    deviceReady: state.deviceSubscribed,
    permission,
    subscription: state.subscription,
    loading,
    enable,
    disable,
    reconcile,
  };
}

/**
 * Unhook this browser's push subscription when a user signs out.
 *
 * On a shared device (a ministry tablet, for example) the endpoint belongs to
 * whoever enabled it last, and the server refuses to let a different account
 * claim it. Releasing it here keeps the next sign-in working. The saved intent
 * on the server is deliberately left alone, so the same user signing back in
 * is restored automatically instead of having to enable it again.
 */
export async function releaseDevicePush() {
  try {
    if (!pushSupported()) return;
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (existing) await existing.unsubscribe();
  } catch {
    /* best effort — never block sign-out */
  }
}

/**
 * Convert a base64url-encoded VAPID public key to a Uint8Array
 * for use with `PushManager.subscribe()`.
 */
export function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
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
