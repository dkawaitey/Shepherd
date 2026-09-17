/**
 * Error formatting + description helpers.
 *
 * Kept free of React so both UI components and plain modules (the error
 * reporter, offline sync) can use them.
 */

/**
 * Human-readable text for a thrown Convex error.
 *
 * A `ConvexError` carries a clean payload in `data` that always reaches the
 * client, while `message` is padded with the request header and can be redacted
 * on production deployments — so prefer `data` when it holds a string.
 */
export function formatError(err: unknown, fallback = "Something went wrong"): string {
  const data = (err as { data?: unknown } | null)?.data;
  if (typeof data === "string" && data.trim()) return data;
  // Some libraries (Convex Auth) throw ConvexError with a `{ message }` payload.
  if (data && typeof data === "object") {
    const inner = (data as { message?: unknown }).message;
    if (typeof inner === "string" && inner.trim()) return inner;
  }
  const message = err instanceof Error ? err.message : undefined;
  if (message && message.trim()) return message;
  return fallback;
}

/** `[CONVEX M(contacts:create)]` → { type: "mutation", name: "contacts:create" }. */
const CONVEX_HEADER = /\[CONVEX\s+([MQA])(?:\(([^)]+)\))?\]/;
/** `[Request ID: 2d715b58c34fa970]` → the id to search in the Convex dashboard. */
const REQUEST_ID = /\[Request ID:\s*([^\]]+)\]/;

const TYPE_LABELS: Record<string, string> = {
  M: "mutation",
  Q: "query",
  A: "action",
};

export type ErrorDescription = {
  /** Clean reason shown to the user. */
  message: string;
  /** Function that failed, e.g. "contacts:create". */
  functionName?: string;
  /** "mutation" | "query" | "action". */
  functionType?: string;
  /** Convex request id, if the error came from the backend. */
  requestId?: string;
  /** Full error text / stack, for the error log. */
  raw: string;
};

/** Pull the useful parts out of a thrown error. */
export function describeError(
  err: unknown,
  fallback = "Something went wrong",
): ErrorDescription {
  const raw =
    err instanceof Error
      ? (err.stack || err.message || String(err)).slice(0, 2000)
      : String(err).slice(0, 2000);
  const text = err instanceof Error ? err.message : String(err);
  const header = CONVEX_HEADER.exec(text);
  const requestId = REQUEST_ID.exec(text)?.[1]?.trim();
  return {
    message: formatError(err, fallback).slice(0, 500),
    functionName: header?.[2]?.trim(),
    functionType: header?.[1] ? TYPE_LABELS[header[1]] : undefined,
    requestId,
    raw,
  };
}
