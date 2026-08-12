import { v } from "convex/values";
import { mutation, internalMutation, query } from "./_generated/server";
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

/** Push an in-app notification to a user. */
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
