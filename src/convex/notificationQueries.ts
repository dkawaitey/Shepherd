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

    const recipientUserIds = [...new Set(job.recipientUserIds)];
    for (const userId of recipientUserIds) {
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
      kind: job.kind,
      subscriptions: [...byEndpoint.values()],
      // Reported back to the delivery log so a reminder that found no device
      // is recorded as such rather than looking like a successful send.
      recipientCount: recipientUserIds.length,
    };
  },
});
