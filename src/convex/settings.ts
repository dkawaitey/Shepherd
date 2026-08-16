import { v } from "convex/values";
import { mutation, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { getCurrentUser, requireAdmin, requireRole } from "./helpers";
import { ROLES } from "./constants";

// ================= Settings =================

export const get = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const rows = await ctx.db.query("settings").collect();
    const out: Record<string, string> = {};
    for (const row of rows) out[row.key] = row.value;
    return out;
  },
});

export const set = mutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const existing = await ctx.db
      .query("settings")
      .withIndex("key", (q) => q.eq("key", args.key))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { value: args.value, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("settings", {
        key: args.key,
        value: args.value,
        updatedAt: Date.now(),
      });
    }
    return { ok: true };
  },
});

/** Same as `set`, but callable from crons/actions (no auth check). */
export const setInternal = internalMutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("key", (q) => q.eq("key", args.key))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { value: args.value, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("settings", {
        key: args.key,
        value: args.value,
        updatedAt: Date.now(),
      });
    }
    return { ok: true };
  },
});

/** All settings rows, for crons/actions that need to read the enable toggles. */
export const getAllInternal = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("settings").collect(),
});

// ================= Audit logs =================

export const listAuditLogs = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("auditLogs").collect();
    rows.sort((a, b) => b.createdAt - a.createdAt);
    return rows.slice(0, args.limit ?? 100);
  },
});

// ================= Notifications =================

export const listNotifications = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const rows = await ctx.db
      .query("notifications")
      .withIndex("userId", (q) => q.eq("userId", user._id))
      .collect();
    rows.sort((a, b) => b.createdAt - a.createdAt);
    return rows.slice(0, 50);
  },
});

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return 0;
    const rows = await ctx.db
      .query("notifications")
      .withIndex("userId", (q) => q.eq("userId", user._id))
      .collect();
    return rows.filter((r) => !r.read).length;
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireRole(ctx, [ROLES.COORDINATOR, ROLES.WORKER, ROLES.LEADER]);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("userId", (q) => q.eq("userId", user._id))
      .collect();
    for (const row of rows) {
      if (!row.read) await ctx.db.patch(row._id, { read: true });
    }
  },
});

/** Push an in-app notification to a user (and deliver it to their devices). */
export const pushNotification = mutation({
  args: {
    userId: v.id("users"),
    title: v.string(),
    message: v.string(),
    type: v.optional(v.string()),
    link: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return;
    await ctx.db.insert("notifications", {
      userId: args.userId,
      title: args.title,
      message: args.message,
      type: args.type,
      link: args.link,
      read: false,
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.push.deliverWebPush, {
      userId: args.userId,
      title: args.title,
      message: args.message,
      type: args.type,
      link: args.link,
    });
  },
});

/** Push a notification with no signed-in caller (used by cron/actions). */
export const pushNotificationInternal = internalMutation({
  args: {
    userId: v.id("users"),
    title: v.string(),
    message: v.string(),
    type: v.optional(v.string()),
    link: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("notifications", {
      userId: args.userId,
      title: args.title,
      message: args.message,
      type: args.type,
      link: args.link,
      read: false,
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.push.deliverWebPush, {
      userId: args.userId,
      title: args.title,
      message: args.message,
      type: args.type,
      link: args.link,
    });
  },
});

// ================= Web push (device notifications) =================

/** The VAPID public key browsers need to subscribe. Env keys are synced into settings by `push.status`. */
export const getVapidPublicKey = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("key", (q) => q.eq("key", "vapid_public_key"))
      .first();
    return row?.value ?? null;
  },
});

/** Register (or refresh) this browser's push subscription for the current user. */
export const subscribe = mutation({
  args: {
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("endpoint", (q) => q.eq("endpoint", args.endpoint))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        userId: user._id,
        p256dh: args.p256dh,
        auth: args.auth,
        userAgent: args.userAgent,
        createdAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("pushSubscriptions", {
      userId: user._id,
      endpoint: args.endpoint,
      p256dh: args.p256dh,
      auth: args.auth,
      userAgent: args.userAgent,
      createdAt: Date.now(),
    });
  },
});

/** Remove this browser's push subscription. */
export const unsubscribe = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("endpoint", (q) => q.eq("endpoint", args.endpoint))
      .first();
    if (existing) await ctx.db.delete(existing._id);
  },
});

/** Counts for the push status card (admin). */
export const pushStatsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [subs, users] = await Promise.all([
      ctx.db.query("pushSubscriptions").collect(),
      ctx.db.query("users").collect(),
    ]);
    return {
      subscribers: subs.length,
      totalUsers: users.filter((u) => !u.isAnonymous).length,
    };
  },
});

/** A user's device subscriptions (used by web push delivery). */
export const pushSubscriptionsForUserInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) =>
    ctx.db
      .query("pushSubscriptions")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .collect(),
});

/** Remove a dead device subscription (push service returned 404/410). */
export const deletePushSubscriptionInternal = internalMutation({
  args: { id: v.id("pushSubscriptions") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

/** Non-anonymous users — announcement recipients. */
export const listUsersForPushInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return users.filter((u) => !u.isAnonymous).map((u) => ({ _id: u._id }));
  },
});

/** Record an outbound email (transport layer). */
export const logEmail = internalMutation({
  args: {
    to: v.string(),
    subject: v.string(),
    kind: v.string(),
    userId: v.optional(v.id("users")),
    status: v.union(v.literal("sent"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("emailLogs", {
      to: args.to,
      subject: args.subject,
      kind: args.kind,
      userId: args.userId,
      status: args.status,
      error: args.error,
      createdAt: Date.now(),
    });
  },
});

/** Recent outbound email log (admin only). */
export const listEmailLogs = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("emailLogs").collect();
    rows.sort((a, b) => b.createdAt - a.createdAt);
    return rows.slice(0, args.limit ?? 20);
  },
});
