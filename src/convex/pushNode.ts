"use node";

import webpush from "web-push";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

const MAX_BATCH = 100;

/**
 * Deliver a scheduled notification job via Web Push.
 * Logs every delivery attempt to pushDeliveryLogs for debugging.
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
    // Subject is required by web-push but is just a contact string.
    // Provide a sensible default so delivery works even if the env var is missing.
    const subject = process.env.VAPID_SUBJECT || "mailto:admin@gethsemane.org";

    if (!publicKey || !privateKey) {
      await ctx.runMutation(internal.push.logDelivery, {
        jobId,
        endpoint: "config",
        success: false,
        error: `Missing VAPID keys: publicKey=${!!publicKey}, privateKey=${!!privateKey}`,
      });
      console.warn("[push] VAPID keys not configured — skipping delivery");
      return;
    }

    try {
      webpush.setVapidDetails(subject, publicKey, privateKey);
    } catch (error: any) {
      // A malformed key or subject throws here, before any device is touched.
      // Without this catch the action fails, nothing is logged anywhere and the
      // job is left looking "scheduled" forever — which reads as "reminders
      // silently don't fire".
      await ctx.runMutation(internal.push.logDelivery, {
        jobId,
        endpoint: "config",
        success: false,
        error: `Invalid VAPID configuration: ${error?.message ?? String(error)}`,
      });
      console.warn("[push] VAPID configuration rejected by web-push");
      return;
    }

    // No registered device: the push cannot be sent, but say so explicitly.
    // Silently marking the job delivered is what made a missing device look
    // identical to a working reminder.
    if (job.subscriptions.length === 0) {
      await ctx.runMutation(internal.push.logDelivery, {
        jobId,
        endpoint: "no-devices",
        success: false,
        error: `No push device registered for ${job.recipientCount} recipient(s)`,
      });
    }

    const dead: string[] = [];
    let sentCount = 0;
    let failCount = 0;

    for (let i = 0; i < job.subscriptions.length; i += MAX_BATCH) {
      const batch = job.subscriptions.slice(i, i + MAX_BATCH);
      const results = await Promise.allSettled(
        batch.map(async (sub) => {
          try {
            const payload = {
              title: job.payload.title,
              body: job.payload.body,
              url: job.payload.url,
              // Android wake-screen fields
              tag: job.payload.url || "shepherd",
              renotify: true,
              vibrate: [200, 100, 200],
              badge: "/sidebarr-logo.png",
              icon: "/sidebarr-logo.png",
              requireInteraction: true,
              silent: false,
              timestamp: Date.now(),
            };
            await webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth },
              },
              JSON.stringify(payload),
              { TTL: 60 * 60 * 24, urgency: "high" as const }, // 24 hours, high priority for Android wake-screen
            );
            await ctx.runMutation(internal.push.logDelivery, {
              jobId,
              endpoint: sub.endpoint.slice(0, 80),
              success: true,
            });
            sentCount++;
          } catch (error: any) {
            const statusCode = error?.statusCode ?? 0;
            const errorMsg = error?.message ?? String(error);
            if (statusCode === 404 || statusCode === 410) {
              dead.push(sub.endpoint);
            }
            await ctx.runMutation(internal.push.logDelivery, {
              jobId,
              endpoint: sub.endpoint.slice(0, 80),
              success: false,
              error: errorMsg,
              statusCode,
            });
            failCount++;
          }
        }),
      );
      void results;
    }

    if (dead.length) {
      await ctx.runMutation(internal.push.cleanupDeadSubscriptions, {
        endpoints: dead,
      });
    }

    await ctx.runMutation(internal.notifications.markDelivered, { jobId });

    console.log(
      `[push] Job ${jobId}: sent=${sentCount} failed=${failCount} dead=${dead.length}`,
    );
  },
});
