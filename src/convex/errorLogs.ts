import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getCurrentUser, logAudit, requireAdmin } from "./helpers";
import { checkRateLimit } from "./rateLimit";

/**
 * Application error log.
 *
 * Failed Convex requests are caught on the client (the Convex client is wrapped
 * in src/lib/error-log.ts) and reported here, so an administrator can see what
 * is actually breaking for volunteers — the exact reason and the Convex request
 * id that maps to the server-side stack in the Convex dashboard.
 *
 * Identical failures are grouped by `fingerprint`: one row keeps a running
 * `occurrences` count instead of flooding the list.
 */

const RETENTION_DAYS = 30;
const MAX_ENTRIES = 1000;
/** Repeats of the same failure within this window are merged into one row. */
const GROUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const MAX_MESSAGE = 500;
const MAX_RAW = 2000;
const MAX_CONTEXT = 200;
const MAX_USER_AGENT = 300;

const clip = (value: string | undefined, max: number) =>
  value === undefined ? undefined : value.slice(0, max);

/**
 * Record a failed request. Called by the client — user identity is taken from
 * the session, never from the caller.
 */
export const record = mutation({
  args: {
    message: v.string(),
    fingerprint: v.string(),
    source: v.string(),
    functionName: v.optional(v.string()),
    functionType: v.optional(v.string()),
    requestId: v.optional(v.string()),
    context: v.optional(v.string()),
    path: v.optional(v.string()),
    raw: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    // Only signed-in users may report; errors before sign-in are not stored.
    if (!user) return { ok: false, grouped: false };

    try {
      await checkRateLimit(ctx, "errorLogs.record");
    } catch {
      // Never let error reporting fail loudly.
      return { ok: false, grouped: false };
    }

    const now = Date.now();
    const message = clip(args.message.trim() || "Unknown error", MAX_MESSAGE)!;
    const fingerprint = clip(args.fingerprint, 300)!;
    const existing = await ctx.db
      .query("errorLogs")
      .withIndex("by_fingerprint", (q) => q.eq("fingerprint", fingerprint))
      .order("desc")
      .first();

    const reporter = {
      userId: user._id as any,
      userName: user.name ?? undefined,
      userEmail: user.email ?? undefined,
      requestId: clip(args.requestId, 100),
      path: clip(args.path, 200),
      userAgent: clip(args.userAgent, MAX_USER_AGENT),
    };

    if (existing && now - existing.lastSeenAt < GROUP_WINDOW_MS) {
      await ctx.db.patch(existing._id, {
        message,
        occurrences: existing.occurrences + 1,
        lastSeenAt: now,
        // A repeat after an admin resolved it means the issue is back.
        resolved: false,
        ...reporter,
        raw: clip(args.raw, MAX_RAW) ?? existing.raw,
        context: clip(args.context, MAX_CONTEXT) ?? existing.context,
      });
      return { ok: true, grouped: true, id: existing._id };
    }

    const id = await ctx.db.insert("errorLogs", {
      message,
      fingerprint,
      source: clip(args.source, 60)!,
      functionName: clip(args.functionName, 120),
      functionType: clip(args.functionType, 40),
      context: clip(args.context, MAX_CONTEXT),
      raw: clip(args.raw, MAX_RAW),
      occurrences: 1,
      firstSeenAt: now,
      lastSeenAt: now,
      resolved: false,
      createdAt: now,
      ...reporter,
    });
    return { ok: true, grouped: false, id };
  },
});

/** Admin only: the error log with filters plus summary statistics. */
export const list = query({
  args: {
    search: v.optional(v.string()),
    functionName: v.optional(v.string()),
    source: v.optional(v.string()),
    hours: v.optional(v.number()),
    onlyUnresolved: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const now = Date.now();
    const all = await ctx.db
      .query("errorLogs")
      .withIndex("by_lastSeenAt")
      .order("desc")
      .take(500);

    const functions = Array.from(
      new Set(all.map((e) => e.functionName).filter(Boolean) as string[]),
    ).sort();
    const sources = Array.from(new Set(all.map((e) => e.source))).sort();

    const since = args.hours ? now - args.hours * 60 * 60 * 1000 : undefined;
    const search = (args.search ?? "").trim().toLowerCase();
    const entries = all.filter((e) => {
      if (args.onlyUnresolved && e.resolved) return false;
      if (args.functionName && e.functionName !== args.functionName) return false;
      if (args.source && e.source !== args.source) return false;
      if (since && e.lastSeenAt < since) return false;
      if (search) {
        const haystack = [
          e.message,
          e.functionName,
          e.context,
          e.path,
          e.requestId,
          e.userEmail,
          e.userName,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });

    const last24h = all.filter((e) => e.lastSeenAt > now - 24 * 60 * 60 * 1000);
    const topFunction = Object.entries(
      all.reduce<Record<string, number>>((acc, e) => {
        const key = e.functionName ?? e.source;
        acc[key] = (acc[key] ?? 0) + e.occurrences;
        return acc;
      }, {}),
    ).sort((a, b) => b[1] - a[1])[0];

    return {
      entries: entries.slice(0, 200),
      stats: {
        issues: all.length,
        occurrences: all.reduce((sum, e) => sum + e.occurrences, 0),
        last24h: last24h.length,
        unresolved: all.filter((e) => !e.resolved).length,
        topFunction: topFunction ? { name: topFunction[0], count: topFunction[1] } : null,
      },
      filters: { functions, sources },
    };
  },
});

/** Admin only: mark an issue as handled (or reopen it). */
export const setResolved = mutation({
  args: { id: v.id("errorLogs"), resolved: v.boolean() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const entry = await ctx.db.get(args.id);
    if (!entry) throw new ConvexError("Error entry not found");
    await ctx.db.patch(args.id, { resolved: args.resolved });
    await logAudit(ctx, {
      action: args.resolved ? "errorLog.resolve" : "errorLog.reopen",
      entityType: "errorLogs",
      entityId: args.id,
      details: entry.message,
    });
    return { ok: true };
  },
});

/** Admin only: delete a single entry. */
export const remove = mutation({
  args: { id: v.id("errorLogs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const entry = await ctx.db.get(args.id);
    if (!entry) throw new ConvexError("Error entry not found");
    await ctx.db.delete(args.id);
    await logAudit(ctx, {
      action: "errorLog.delete",
      entityType: "errorLogs",
      entityId: args.id,
      details: entry.message,
    });
    return { ok: true };
  },
});

/** Admin only: clear the log (optionally keep open issues). */
export const clear = mutation({
  args: { onlyResolved: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await checkRateLimit(ctx, "errorLogs.clear");
    const rows = await ctx.db.query("errorLogs").withIndex("by_createdAt").take(1000);
    let deleted = 0;
    for (const row of rows) {
      if (args.onlyResolved && !row.resolved) continue;
      await ctx.db.delete(row._id);
      deleted++;
    }
    await logAudit(ctx, {
      action: "errorLog.clear",
      entityType: "errorLogs",
      details: `${deleted} entries cleared`,
    });
    return { deleted };
  },
});

/** Daily housekeeping: drop entries past the retention window and cap the log. */
export const prune = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    // by_lastSeenAt is ascending, so this comes back oldest first.
    const rows = await ctx.db
      .query("errorLogs")
      .withIndex("by_lastSeenAt")
      .take(MAX_ENTRIES + 500);

    let deleted = 0;
    const survivors: typeof rows = [];
    for (const row of rows) {
      if (row.lastSeenAt < cutoff) {
        await ctx.db.delete(row._id);
        deleted++;
      } else {
        survivors.push(row);
      }
    }

    // Still over the cap: drop the oldest survivors.
    const excess = survivors.length - MAX_ENTRIES;
    for (let i = 0; i < excess; i++) {
      const row = survivors[i];
      if (row) {
        await ctx.db.delete(row._id);
        deleted++;
      }
    }
    return { deleted };
  },
});
