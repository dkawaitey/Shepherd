/**
 * Client-side error reporting.
 *
 * The Convex client is wrapped so every failed mutation/action is reported to
 * `errorLogs.record` before the error reaches the component that called it —
 * that is how the admin error log sees failures the user's UI handles quietly.
 *
 * Reporting is best-effort: it never throws, never blocks, and is deduped both
 * locally (same failure within 10s is dropped) and on the server (repeats are
 * grouped into one row with an occurrence count).
 */

import { api } from "@/convex/_generated/api";
import { describeError } from "@/lib/errors";

// Loose shape so the real ConvexReactClient (whose methods are generic) fits.
type ConvexLike = {
  mutation: (...args: any[]) => Promise<any>;
  action?: (...args: any[]) => Promise<any>;
};

export type ReportContext = {
  /** "mutation" | "action" | "render" | "uncaught" | "rejection" | "offline" */
  source: string;
  /** Where in the app it happened, e.g. "Add contact dialog". */
  context?: string;
};

let client: ConvexLike | null = null;
let reporting = false;
const recent = new Map<string, number>();
const DEDUPE_MS = 10_000;

/** Truncate the browser UA to something that fits (and avoids log noise). */
const shortUserAgent = () =>
  typeof navigator === "undefined" ? undefined : navigator.userAgent.slice(0, 300);

const currentPath = () =>
  typeof window === "undefined" ? undefined : window.location.pathname.slice(0, 200);

/** Things that are not bugs: cross-origin "Script error", aborted requests,
 *  layout-loop warnings from the browser. Logging them would bury real issues. */
const IGNORED = [
  /^script error/i,
  /resizeobserver loop/i,
  /\babort/i,
  /operations? (was|were) cancelled/i,
];

/**
 * Send one failure to the error log. Safe to call from anywhere: a catch block,
 * an error boundary, or a global handler.
 */
export function reportAppError(err: unknown, ctx: ReportContext): void {
  const { message, functionName, functionType, requestId, raw } = describeError(err);

  // Never report the reporter's own failures, and don't try while signed out —
  // "Not authenticated" is a normal state during sign-in, not a bug.
  if (functionName === "errorLogs:record") return;
  if (/not authenticated|no identity/i.test(message)) return;
  if (!message.trim() || IGNORED.some((re) => re.test(message))) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  if (!client) return;

  const fingerprint = `${ctx.source}|${functionName ?? "-"}|${message}`.slice(0, 300);
  const now = Date.now();
  const last = recent.get(fingerprint);
  if (last && now - last < DEDUPE_MS) return;
  recent.set(fingerprint, now);
  // Keep the dedupe map small.
  if (recent.size > 200) {
    for (const [key, at] of recent) {
      if (now - at > DEDUPE_MS) recent.delete(key);
    }
  }

  reporting = true;
  client
    .mutation(api.errorLogs.record, {
      message,
      fingerprint,
      source: ctx.source,
      functionName,
      functionType,
      requestId,
      context: ctx.context,
      path: currentPath(),
      raw,
      userAgent: shortUserAgent(),
    })
    .catch(() => undefined)
    .finally(() => {
      reporting = false;
    });
}

/**
 * Wrap the Convex client and register global handlers. Call once, right after
 * the client is created.
 */
export function installErrorLogging(convex: ConvexLike): void {
  client = convex;

  const originalMutation = convex.mutation.bind(convex);
  convex.mutation = async (...args: any[]) => {
    try {
      return await originalMutation(...args);
    } catch (err) {
      if (!reporting) reportAppError(err, { source: "mutation" });
      throw err;
    }
  };

  if (typeof convex.action === "function") {
    const originalAction = convex.action.bind(convex);
    convex.action = async (...args: any[]) => {
      try {
        return await originalAction(...args);
      } catch (err) {
        if (!reporting) reportAppError(err, { source: "action" });
        throw err;
      }
    };
  }

  if (typeof window !== "undefined") {
    window.addEventListener("error", (event) => {
      // Resource-load failures (images, icons) carry no error object — ignore.
      const err = event.error ?? event.message;
      if (!err) return;
      reportAppError(err, { source: "uncaught" });
    });
    window.addEventListener("unhandledrejection", (event) => {
      reportAppError(event.reason, { source: "rejection" });
    });
  }
}
