import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { mutation, query, MutationCtx } from "./_generated/server";

/**
 * The in-app notification bell.
 *
 * A device push only reaches someone who has registered a device and allowed
 * notifications, so anything that must not be missed (an account waiting on a
 * member link, for example) is also written here as a durable row. It shows up
 * on the bell regardless of push state and stays until it is read.
 */

/**
 * Insert one notification row per recipient. A plain helper rather than a
 * registered function, so the mutation that triggers the alert can write the
 * rows in the same transaction and there is no chance of the alert and the
 * thing it describes disagreeing. Recipients are de-duplicated.
 */
export async function notifyUsers(
  ctx: MutationCtx,
  args: {
    userIds: Id<"users">[];
    kind: string;
    title: string;
    body: string;
    url: string;
  },
) {
  const now = Date.now();
  for (const userId of new Set(args.userIds)) {
    await ctx.db.insert("notifications", {
      userId,
      kind: args.kind,
      title: args.title,
      body: args.body,
      url: args.url,
      read: false,
      createdAt: now,
    });
  }
}

/** The signed-in user's notifications, newest first. */
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const limit = Math.min(Math.max(args.limit ?? 25, 1), 50);
    return await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);
  },
});

/** How many notifications the signed-in user has not read yet. */
export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return 0;
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) =>
        q.eq("userId", userId).eq("read", false),
      )
      .take(100);
    return unread.length;
  },
});

/** Mark one notification read — only if it is the caller's own. */
export const markRead = mutation({
  args: { id: v.id("notifications") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return;
    const row = await ctx.db.get(args.id);
    if (row && row.userId === userId && !row.read) {
      await ctx.db.patch(args.id, { read: true });
    }
  },
});

/** Mark every one of the caller's notifications read. */
export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { updated: 0 };
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) =>
        q.eq("userId", userId).eq("read", false),
      )
      .collect();
    for (const row of unread) await ctx.db.patch(row._id, { read: true });
    return { updated: unread.length };
  },
});
