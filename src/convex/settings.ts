import { v } from "convex/values";
import { mutation, internalMutation, internalQuery, query } from "./_generated/server";
import { getCurrentUser, requireAdmin } from "./helpers";

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
