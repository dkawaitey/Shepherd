import { api } from "@/convex/_generated/api";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Offline-first data entry for volunteers.
 *
 * When a contact (or follow-up) can't reach the Convex backend, the action is
 * queued in localStorage instead of failing. The queue replays automatically
 * when the connection returns (window "online" event, a scheduled retry after
 * each enqueue, or a manual "Sync now" from the banner).
 */

export type OfflineKind = "quickAddContact" | "createContact" | "createFollowup";

export interface OfflineEntry {
  id: string;
  kind: OfflineKind;
  payload: Record<string, unknown>;
  queuedAt: number;
}

const QUEUE_KEY = "shepherd.offline.queue.v1";
const QUEUED_EVENT = "shepherd-offline-queued";

// ---------- persistence ----------

export function loadQueue(): OfflineEntry[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OfflineEntry[]) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: OfflineEntry[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // storage unavailable — the action simply stays local for this session
  }
}

export function removeOffline(id: string) {
  saveQueue(loadQueue().filter((e) => e.id !== id));
}

export function clearOfflineQueue() {
  saveQueue([]);
}

/** Queue an action and tell the sync hook to retry shortly. */
export function queueEntry(kind: OfflineKind, payload: Record<string, unknown>) {
  const entry: OfflineEntry = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    kind,
    payload,
    queuedAt: Date.now(),
  };
  saveQueue([...loadQueue(), entry]);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(QUEUED_EVENT));
  }
}

/** Best-effort detection of a connection problem (vs a real rejection). */
export function isOfflineError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (err instanceof TypeError) return true; // fetch failures are TypeErrors
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch|network|load failed|internet|offline|connection|socket|timed out|abort/i.test(
    msg,
  );
}

// ---------- React hook ----------

export function useOfflineSync() {
  const quickAdd = useMutation(api.contacts.quickAdd);
  const createContact = useMutation(api.contacts.create);
  const createFollowup = useMutation(api.followups.create);

  const [pending, setPending] = useState<OfflineEntry[]>(() => loadQueue());
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [lastError, setLastError] = useState<string | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncingRef = useRef(false);

  const refresh = useCallback(() => {
    setPending(loadQueue());
  }, []);

  const run = useCallback(
    async (entry: OfflineEntry) => {
      switch (entry.kind) {
        case "quickAddContact":
          await quickAdd(entry.payload as any);
          break;
        case "createContact":
          await createContact(entry.payload as any);
          break;
        case "createFollowup":
          await createFollowup(entry.payload as any);
          break;
      }
    },
    [quickAdd, createContact, createFollowup],
  );

  const flush = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setLastError(null);
    let synced = 0;
    try {
      for (const entry of loadQueue()) {
        if (typeof navigator !== "undefined" && navigator.onLine === false) break;
        try {
          await run(entry);
          removeOffline(entry.id);
          synced++;
          refresh();
        } catch (err) {
          if (isOfflineError(err)) break; // still offline — stop, retry later
          // Permanent rejection (validation/permission): keep the entry so the
          // data isn't lost, surface the reason, and stop.
          setLastError(
            err instanceof Error ? err.message : "Sync failed for a queued record",
          );
          break;
        }
      }
      if (synced > 0) {
        toast.success(
          synced === 1
            ? "1 offline record synced"
            : `${synced} offline records synced`,
        );
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [run, refresh]);

  // Replay on reconnect and recover any leftovers on mount.
  useEffect(() => {
    if (online && loadQueue().length > 0 && !syncingRef.current) {
      const t = setTimeout(() => flush(), 600);
      return () => clearTimeout(t);
    }
  }, [online, flush]);

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      flush();
    };
    const onOffline = () => setOnline(false);
    const onQueued = () => {
      refresh();
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => {
        if (navigator.onLine) flush();
      }, 2500);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener(QUEUED_EVENT, onQueued);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(QUEUED_EVENT, onQueued);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [flush, refresh]);

  return { pending, syncing, online, syncNow: flush, lastError };
}
