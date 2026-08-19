import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

/**
 * Fetch the job and all unique endpoint subscriptions for its recipients.
 * Called by the pushNode delivery action.
 */
export const getDeliverableJob = internalQuery({
  args: { jobId: v.id("notificationJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status !== "scheduled") return null;

    // A recipient can have several devices; an endpoint must be sent only once.
    const byEndpoint = new Map<
      string,
      { endpoint: string; p256dh: string; auth: string }
    >();

    for (const userId of new Set(job.recipientUserIds)) {
      const devices = await ctx.db
        .query("pushSubscriptions")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      for (const device of devices) {
        byEndpoint.set(device.endpoint, {
          endpoint: device.endpoint,
          p256dh: device.p256dh,
          auth: device.auth,
        });
      }
    }

    return {
      payload: job.payload,
      subscriptions: [...byEndpoint.values()],
    };
  },
});
