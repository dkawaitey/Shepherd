/**
 * Server-side rate limiter for Convex mutations.
 *
 * Uses an in-memory Map keyed by `userId:action` with a sliding window.
 * Convex mutations run in a single process, so in-memory state persists
 * across calls within the same process lifetime. The map is bounded to
 * prevent unbounded growth.
 *
 * Usage inside a mutation handler:
 *   await checkRateLimit(ctx, "post.create", { maxRequests: 5, windowMs: 60_000 });
 */
import { MutationCtx } from "./_generated/server";
import { getCurrentUser } from "./helpers";

type RateLimitEntry = {
  count: number;
  windowStart: number;
};

type RateLimitConfig = {
  /** Maximum requests allowed within the window. */
  maxRequests: number;
  /** Window duration in milliseconds. */
  windowMs: number;
};

// In-memory store — persists across calls within one Convex process.
// Bounded to prevent memory leaks.
const store = new Map<string, RateLimitEntry>();
const MAX_STORE_SIZE = 5000;

// Default limits by category
const DEFAULT_LIMITS: Record<string, RateLimitConfig> = {
  // Normal CRUD — generous
  "post.create": { maxRequests: 10, windowMs: 60_000 },
  "post.addComment": { maxRequests: 30, windowMs: 60_000 },
  "followup.create": { maxRequests: 20, windowMs: 60_000 },
  "followup.update": { maxRequests: 30, windowMs: 60_000 },
  "followup.changeStatus": { maxRequests: 30, windowMs: 60_000 },
  "contacts.create": { maxRequests: 30, windowMs: 60_000 },
  "contacts.quickAdd": { maxRequests: 30, windowMs: 60_000 },
  "members.create": { maxRequests: 15, windowMs: 60_000 },
  "members.update": { maxRequests: 30, windowMs: 60_000 },

  // Expensive operations — stricter
  "post.generateUploadUrl": { maxRequests: 20, windowMs: 60_000 },
  "contacts.merge": { maxRequests: 5, windowMs: 60_000 },

  // Notification/broadcast — very strict
  "push.sendTestNotification": { maxRequests: 3, windowMs: 60_000 },
  "emails.sendNow": { maxRequests: 2, windowMs: 300_000 },
  "steward.syncNow": { maxRequests: 3, windowMs: 300_000 },

  // Destructive operations — controlled
  "contacts.remove": { maxRequests: 5, windowMs: 60_000 },
  "members.remove": { maxRequests: 5, windowMs: 60_000 },
  "users.removeUser": { maxRequests: 3, windowMs: 300_000 },
  "users.setRoles": { maxRequests: 10, windowMs: 60_000 },
  "users.setRole": { maxRequests: 10, windowMs: 60_000 },
  "users.bootstrapAdmin": { maxRequests: 1, windowMs: 600_000 },

  // Settings — strict
  "settings.set": { maxRequests: 20, windowMs: 60_000 },

  // Profile updates — moderate
  "users.updateProfile": { maxRequests: 10, windowMs: 60_000 },

  // Attendance — moderate (batch operations)
  "discipleship.recordAttendance": { maxRequests: 60, windowMs: 60_000 },
  "discipleship.setAttendance": { maxRequests: 60, windowMs: 60_000 },
};

/**
 * Check rate limit for the current user on the given action.
 * Throws if the limit is exceeded.
 */
export async function checkRateLimit(
  ctx: MutationCtx,
  action: string,
  override?: Partial<RateLimitConfig>,
): Promise<void> {
  const user = await getCurrentUser(ctx);
  if (!user) throw new Error("Not authenticated");

  // Admins get a 2x multiplier on all limits
  const isAdmin =
    user.role === "admin" ||
    (user.roles ?? []).includes("admin");

  const config = { ...DEFAULT_LIMITS[action], ...override };
  if (!config.maxRequests || !config.windowMs) return; // No limit configured

  const effectiveMax = isAdmin ? config.maxRequests * 2 : config.maxRequests;
  const key = `${user._id}:${action}`;
  const now = Date.now();

  // Clean up expired entries and enforce max size
  if (store.size > MAX_STORE_SIZE) {
    for (const [k, v] of store) {
      if (now - v.windowStart > config.windowMs) store.delete(k);
    }
  }

  const entry = store.get(key);
  if (!entry || now - entry.windowStart > config.windowMs) {
    // New window
    store.set(key, { count: 1, windowStart: now });
    return;
  }

  // Within window
  if (entry.count >= effectiveMax) {
    const retryAfter = Math.ceil(
      (entry.windowStart + config.windowMs - now) / 1000,
    );
    throw new Error(
      `Rate limit exceeded for ${action}. Please wait ${retryAfter}s and try again.`,
    );
  }

  entry.count++;
}
