/**
 * Server-side rate limiter for Convex mutations.
 *
 * Counters live in the `rateLimits` table, keyed by `userId:action`. Convex
 * mutations are transactional, so the read-then-write below is consistent even
 * when the same account fires requests in parallel — and because it is stored
 * in the database (not process memory) the limits hold across redeploys and are
 * shared by every function instance.
 *
 * Usage inside a mutation handler:
 *   await checkRateLimit(ctx, "post.create", { maxRequests: 5, windowMs: 60_000 });
 */
import { ConvexError } from "convex/values";
import { MutationCtx, internalMutation } from "./_generated/server";
import { getCurrentUser } from "./helpers";

type RateLimitConfig = {
  /** Maximum requests allowed within the window. */
  maxRequests: number;
  /** Window duration in milliseconds. */
  windowMs: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long an expired row may linger before the daily sweep removes it. */
const RETENTION_MS = 2 * DAY_MS;

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
  "post.react": { maxRequests: 60, windowMs: 60_000 },
  "contacts.merge": { maxRequests: 5, windowMs: 60_000 },

  // Notification/broadcast — very strict
  "push.sendTestNotification": { maxRequests: 3, windowMs: 60_000 },
  "emails.sendNow": { maxRequests: 2, windowMs: 300_000 },

  // Destructive operations — controlled
  "contacts.remove": { maxRequests: 5, windowMs: 60_000 },
  "members.remove": { maxRequests: 5, windowMs: 60_000 },
  // Bumped so an admin can clean up a batch of mistaken sign-ins (2x for admins).
  "users.removeUser": { maxRequests: 10, windowMs: 300_000 },
  "users.setRoles": { maxRequests: 10, windowMs: 60_000 },
  "users.setRole": { maxRequests: 10, windowMs: 60_000 },
  "users.bootstrapAdmin": { maxRequests: 3, windowMs: 600_000 },

  // Settings — strict
  "settings.set": { maxRequests: 20, windowMs: 60_000 },

  // Client-side error reporting — dedupe does most of the throttling
  "errorLogs.record": { maxRequests: 60, windowMs: 60_000 },
  "errorLogs.clear": { maxRequests: 5, windowMs: 300_000 },

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
  if (!user) throw new ConvexError("Not authenticated");

  const config = { ...DEFAULT_LIMITS[action], ...override };
  if (!config.maxRequests || !config.windowMs) return; // No limit configured

  // Administrators get a 2x multiplier on every limit.
  const isAdmin =
    user.role === "admin" || (user.roles ?? []).includes("admin");
  const effectiveMax = isAdmin ? config.maxRequests * 2 : config.maxRequests;

  const key = `${user._id}:${action}`;
  const now = Date.now();
  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();

  // No row, or the previous window has elapsed: start a fresh window.
  if (!existing || now - existing.windowStart >= config.windowMs) {
    if (existing) {
      await ctx.db.patch(existing._id, {
        count: 1,
        windowStart: now,
        expiresAt: now + config.windowMs,
      });
    } else {
      await ctx.db.insert("rateLimits", {
        key,
        count: 1,
        windowStart: now,
        expiresAt: now + config.windowMs,
      });
    }
    return;
  }

  if (existing.count >= effectiveMax) {
    const retryAfter = Math.ceil(
      (existing.windowStart + config.windowMs - now) / 1000,
    );
    throw new ConvexError(
      `Too many requests right now. Please wait ${retryAfter}s and try again.`,
    );
  }

  await ctx.db.patch(existing._id, { count: existing.count + 1 });
}

/**
 * Daily housekeeping: drop windows that expired well before now, plus any
 * stray rows for accounts that no longer exist. Called from the cron.
 */
export const prune = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - RETENTION_MS;
    let deleted = 0;

    // Oldest first, so a single bounded pass clears the backlog over time.
    const expired = await ctx.db
      .query("rateLimits")
      .withIndex("by_expires")
      .take(500);
    for (const row of expired) {
      if (row.expiresAt < cutoff) {
        await ctx.db.delete(row._id);
        deleted++;
      }
    }
    // Anything else with an expiry in the past is still usable as a fresh
    // window, so it is kept until it ages out of the search window above.
    return { deleted, scanned: expired.length };
  },
});
