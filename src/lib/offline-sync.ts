import { api } from "@/convex/_generated/api";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { formatError } from "@/components/shared";

/**
 * Offline-first data entry for volunteers.
 *
 * When a contact (or follow-up) can't reach the Convex backend, the action is
 * queued in localStorage instead of failing. The queue replays automatically
 * when the connection returns (window "online" event, a scheduled retry after
 * each enqueue, or a manual "Sync now" from the banner).
 *
 * The queue holds personal data (names, phone numbers, addresses), so:
 *  - every entry is stamped with the account that created it, and a signed-in
 *    user can only ever see or replay their own entries (shared ministry
 *    tablets are common)
 *  - signing out clears the queue, so nothing is left behind on the device
 */

export type OfflineKind = "quickAddContact" | "createContact" | "createFollowup";

export interface OfflineEntry {
  id: string;
  kind: OfflineKind;
  payload: Record<string, unknown>;
  queuedAt: number;
  /** Account that queued this entry. Absent only for entries created before
   *  owner stamping existed — those are treated as foreign and discarded. */
  ownerId?: string;
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

/** Entries belonging to one account. */
export function loadOwnQueue(ownerId: string | undefined): OfflineEntry[] {
  if (!ownerId) return [];
  return loadQueue().filter((e) => e.ownerId === ownerId);
}

/**
 * The signed-in account that owns newly queued entries. The app shell keeps
 * this in step with the session, so every record is stamped with the account
 * that created it and can never be replayed by a different one.
 */
let queueOwner: string | undefined;

export function setQueueOwner(ownerId?: string) {
  queueOwner = ownerId;
}

/** Drop entries that aren't owned by this account (shared device), including
 *  any left over from before entries were owner-stamped. */
export function discardEntriesNotOwnedBy(ownerId: string) {
  const queue = loadQueue();
  const kept = queue.filter((e) => e.ownerId === ownerId);
  if (kept.length !== queue.length) saveQueue(kept);
  return queue.length - kept.length;
}

export function removeOffline(id: string) {
  saveQueue(loadQueue().filter((e) => e.id !== id));
}

export function clearOfflineQueue() {
  saveQueue([]);
}

/** Queue an action and tell the sync hook to retry shortly. */
export function queueEntry(
  kind: OfflineKind,
  payload: Record<string, unknown>,
  ownerId: string | undefined = queueOwner,
) {
  const entry: OfflineEntry = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    kind,
    payload,
    queuedAt: Date.now(),
    ownerId,
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

/** Replays the signed-in user's queued entries and reports what's pending. */
export function useOfflineSync(ownerId?: string) {
  const quickAdd = useMutation(api.contacts.quickAdd);
  const createContact = useMutation(api.contacts.create);
  const createFollowup = useMutation(api.followups.create);

  const [pending, setPending] = useState<OfflineEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [lastError, setLastError] = useState<string | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncingRef = useRef(false);
  const ownerRef = useRef(ownerId);
  ownerRef.current = ownerId;

  const refresh = useCallback(() => {
    const owner = ownerRef.current;
    // A different account's leftovers (or pre-stamping entries of unknown
    // provenance) are dropped rather than replayed under this identity.
    if (owner) discardEntriesNotOwnedBy(owner);
    setPending(loadOwnQueue(owner));
  }, []);

  // Keep the enqueue-time owner in step with the session, then show what's
  // pending for this account.
  useEffect(() => {
    setQueueOwner(ownerId);
    refresh();
  }, [ownerId, refresh]);

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
    const owner = ownerRef.current;
    if (!owner) return;
    syncingRef.current = true;
    setSyncing(true);
    setLastError(null);
    let synced = 0;
    try {
      for (const entry of loadOwnQueue(owner)) {
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
          setLastError(formatError(err, "Sync failed for a queued record"));
          break;
        }
      }
      if (synced > 0) {
        refresh();
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

  const discard = useCallback(() => {
    if (!ownerRef.current) return;
    for (const entry of loadOwnQueue(ownerRef.current)) removeOffline(entry.id);
    setLastError(null);
    refresh();
  }, [refresh]);

  // Replay on reconnect and recover any leftovers on mount.
  useEffect(() => {
    if (online && pending.length > 0 && !syncingRef.current && ownerId) {
      const t = setTimeout(() => flush(), 600);
      return () => clearTimeout(t);
    }
  }, [online, pending.length, flush, ownerId]);

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

  return { pending, syncing, online, syncNow: flush, discard, lastError };
}
