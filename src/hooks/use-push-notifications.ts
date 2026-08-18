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

export type DiagEntry = { step: string; ok: boolean; detail: string };

export type PushState = {
  /** Whether this browser supports web push (secure context + PushManager). */
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  /** Whether this device currently has a push subscription registered. */
  subscribed: boolean;
  /** Diagnostic log from the last enable/sync attempt. */
  diag: DiagEntry[];
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
  const [diag, setDiag] = useState<DiagEntry[]>([]);

  /** Log a diagnostic entry and return it for chaining. */
  const logDiag = useCallback(
    (entries: DiagEntry[]) => {
      setDiag(entries);
      for (const e of entries) {
        const fn = e.ok ? console.log : console.warn;
        fn(`[push][${e.step}] ${e.ok ? "OK" : "FAIL"}: ${e.detail}`);
      }
    },
    [],
  );

  /**
   * Core subscription sync — throws on failure so callers can surface errors.
   */
  const sync = useCallback(async (): Promise<{ ok: boolean; reason?: string }> => {
    const d: DiagEntry[] = [];
    const push = (step: string, ok: boolean, detail: string) => {
      d.push({ step, ok, detail });
    };

    // Step 1: environment check
    if (!active || !supported) {
      push("env", false, `active=${active}, supported=${supported}`);
      logDiag(d);
      return { ok: false, reason: "Push not supported on this browser" };
    }
    push("env", true, `isSecureContext=${window.isSecureContext}, protocol=${location.protocol}`);

    // Step 2: VAPID key
    if (publicKey == null) {
      push("vapid", false, "publicKey query returned null (still loading?)");
      logDiag(d);
      return { ok: false, reason: "VAPID public key not loaded yet" };
    }
    push("vapid", true, `key length=${publicKey.length}`);

    // Step 3: notification permission
    if (Notification.permission !== "granted") {
      push("permission", false, `current="${Notification.permission}"`);
      setPermission(Notification.permission);
      setSubscribed(false);
      logDiag(d);
      return { ok: false, reason: "Notification permission not granted" };
    }
    setPermission("granted");
    push("permission", true, "granted");

    // Step 4: service worker ready
    let reg: ServiceWorkerRegistration;
    try {
      reg = await navigator.serviceWorker.ready;
      push("sw-ready", true, `scope=${reg.scope}, active=${reg.active?.state ?? "null"}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      push("sw-ready", false, msg);
      logDiag(d);
      return { ok: false, reason: `Service worker not ready: ${msg}` };
    }

    // Step 5: existing subscription or create new
    let sub: PushSubscription | null = null;
    let action = "existing";
    try {
      sub = await reg.pushManager.getSubscription();
      if (sub) {
        push("get-sub", true, `endpoint=${sub.endpoint.substring(0, 60)}...`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      push("get-sub", false, msg);
      logDiag(d);
      return { ok: false, reason: `Failed to check subscription: ${msg}` };
    }

    if (!sub) {
      action = "new";
      try {
        const keyBytes = urlBase64ToUint8Array(publicKey);
        push("subscribe-prep", true, `applicationServerKey bytes=${keyBytes.length}`);
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes,
        });
        push("subscribe", true, `endpoint=${sub.endpoint.substring(0, 60)}...`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const name = err instanceof Error ? err.name : "";
        push("subscribe", false, `${name}: ${msg}`);
        logDiag(d);
        // Common causes:
        if (name === "InvalidAccessError") {
          return { ok: false, reason: "VAPID key may be invalid — regenerate keys in Settings → Notifications" };
        }
        if (name === "NotSupportedError") {
          return { ok: false, reason: "Push not supported in this context — try installing the app to your Home Screen" };
        }
        if (name === "SecurityError") {
          return { ok: false, reason: "Security error — the app must be served over HTTPS from its own domain" };
        }
        return { ok: false, reason: `Browser subscription failed: ${msg}` };
      }
    }

    // Step 6: save subscription on the server
    const p256dh = bufferToBase64(sub.getKey("p256dh"));
    const auth = bufferToBase64(sub.getKey("auth"));
    push("keys", p256dh.length > 0 && auth.length > 0, `p256dh=${p256dh.length}chars, auth=${auth.length}chars`);

    try {
      const savedId = await subscribe({
        endpoint: sub.endpoint,
        p256dh,
        auth,
        userAgent: navigator.userAgent,
      });
      push("server-save", true, `saved subscription id=${savedId} (action=${action})`);
    } catch (subErr) {
      const msg = subErr instanceof Error ? subErr.message : String(subErr);
      push("server-save", false, msg);
      logDiag(d);
      return { ok: false, reason: `Server rejected subscription: ${msg}` };
    }

    setSubscribed(true);
    logDiag(d);
    return { ok: true };
  }, [active, supported, publicKey, subscribe, logDiag]);

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

  return { supported, permission, subscribed, diag, enable, disable };
}
