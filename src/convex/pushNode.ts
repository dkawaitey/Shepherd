"use node";

import webpush from "web-push";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

const MAX_BATCH = 100;

/**
 * Deliver a scheduled notification job via Web Push.
 * Cleans up dead subscriptions (404/410) and marks the job delivered.
 */
export const deliverJob = internalAction({
  args: { jobId: v.id("notificationJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.runQuery(
      internal.notificationQueries.getDeliverableJob,
      { jobId },
    );
    if (!job) return;

    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;
    if (!publicKey || !privateKey || !subject) {
      console.warn("[push] VAPID keys not configured — skipping delivery");
      return;
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);

    const dead: string[] = [];

    for (let i = 0; i < job.subscriptions.length; i += MAX_BATCH) {
      const batch = job.subscriptions.slice(i, i + MAX_BATCH);
      const results = await Promise.allSettled(
        batch.map(async (sub) => {
          try {
            await webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth },
              },
              JSON.stringify(job.payload),
              { TTL: 60 * 60 * 24 }, // 24 hours
            );
          } catch (error: any) {
            // Subscription expired or removed — mark for cleanup.
            if (error?.statusCode === 404 || error?.statusCode === 410) {
              dead.push(sub.endpoint);
            } else {
              throw error;
            }
          }
        }),
      );
      // Intentionally keep processing when individual deliveries fail.
      void results;
    }

    // Clean up dead subscriptions.
    if (dead.length) {
      await ctx.runMutation(internal.push.cleanupDeadSubscriptions, {
        endpoints: dead,
      });
    }

    // Mark the job as delivered.
    await ctx.runMutation(internal.notifications.markDelivered, { jobId });
  },
});
