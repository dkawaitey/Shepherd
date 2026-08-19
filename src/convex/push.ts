import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
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

/** Return the current user's subscription count and last subscription info (for debugging). */
export const mySubscriptionStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { subscribed: false, count: 0, permission: "unavailable" as const };

    const devices = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    return {
      subscribed: devices.length > 0,
      count: devices.length,
      permission: typeof Notification !== "undefined" ? Notification.permission : "unavailable",
    };
  },
});

/**
 * Send a test notification to the current user's registered devices.
 * Creates a notification job inline and schedules immediate delivery.
 */
export const sendTestNotification = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Sign in to send a test notification.");

    // Check that the user has at least one registered device.
    const devices = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    if (devices.length === 0) {
      throw new ConvexError(
        "No device registered. Enable notifications on this device first.",
      );
    }

    // Create the notification job directly (not via ctx.runMutation, which may
    // not be available inside a mutation).
    const now = Date.now();
    const dedupeKey = `test:${userId}:${now}`;

    const jobId = await ctx.db.insert("notificationJobs", {
      kind: "follow_up_reminder",
      dedupeKey,
      deliverAt: now,
      status: "scheduled",
      payload: {
        title: "Shepherd Test",
        body: "Device push notifications are working!",
        url: "/settings",
      },
      recipientUserIds: [userId],
      createdAt: now,
    });

    // Schedule the delivery action via the scheduler.
    const scheduledFunctionId = await ctx.scheduler.runAfter(
      0,
      internal.pushNode.deliverJob,
      { jobId },
    );

    await ctx.db.patch(jobId, { scheduledFunctionId });

    return { ok: true, jobId };
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
