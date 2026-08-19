import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";

/** Return the VAPID public key so the browser can subscribe. */
export const getPublicKey = query({
  args: {},
  handler: () => process.env.VAPID_PUBLIC_KEY ?? null,
});

/** Save (or update) the current user's push subscription. */
export const saveSubscription = mutation({
  args: {
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Sign in to enable notifications.");

    const user = await ctx.db.get(userId);

    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .first();

    // Do not let a logged-in user claim a device registered to another account.
    if (existing && existing.userId !== userId) {
      throw new ConvexError("This device is already registered to another account.");
    }

    const fields = {
      userId,
      email: user?.email,
      endpoint: args.endpoint,
      p256dh: args.p256dh,
      auth: args.auth,
      userAgent: args.userAgent,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("pushSubscriptions", {
        ...fields,
        createdAt: Date.now(),
      });
    }
  },
});

/** Remove the current user's push subscription for a given endpoint. */
export const removeSubscription = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Sign in to manage notifications.");

    const row = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .first();

    // Only allow the owner to remove their own subscription.
    if (row && row.userId === userId) {
      await ctx.db.delete(row._id);
    }
  },
});

/** Remove dead subscriptions (404/410 from push service). Called internally only. */
export const cleanupDeadSubscriptions = internalMutation({
  args: { endpoints: v.array(v.string()) },
  handler: async (ctx, { endpoints }) => {
    for (const endpoint of new Set(endpoints)) {
      const row = await ctx.db
        .query("pushSubscriptions")
        .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
        .first();
      if (row) await ctx.db.delete(row._id);
    }
  },
});
