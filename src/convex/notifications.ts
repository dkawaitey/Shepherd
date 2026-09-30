import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { notifyUsers } from "./inbox";

const payload = v.object({
  title: v.string(),
  body: v.string(),
  url: v.string(),
});

const jobArgs = {
  kind: v.union(
    v.literal("follow_up_reminder"),
    v.literal("birthday_alert"),
    v.literal("missed_follow_up"),
    v.literal("low_attendance"),
    v.literal("bible_study_reminder"),
    v.literal("post"),
    v.literal("comment"),
    v.literal("reply"),
    v.literal("poll_result"),
    v.literal("account_unlinked"),
  ),
  dedupeKey: v.string(),
  deliverAt: v.number(),
  payload,
  recipientUserIds: v.array(v.id("users")),
  /**
   * Also write a durable row to the in-app bell.
   *
   * A device push only reaches someone who has registered a device AND allowed
   * notifications on it, so anything the user must not miss (a follow-up
   * reminder, above all) is mirrored to the bell. Without this a reminder that
   * finds no registered device disappears silently — the job is created, zero
   * devices are sent to, and nothing anywhere records that it happened.
   */
  inApp: v.optional(v.boolean()),
};

/**
 * Schedule a notification job. Idempotent — a repeated call with the
 * same dedupeKey replaces the existing scheduled job.
 */
export const scheduleNotification = internalMutation({
  args: jobArgs,
  handler: async (ctx, args) => {
    // Check for an existing job with the same deduplication key.
    const old = await ctx.db
      .query("notificationJobs")
      .withIndex("by_dedupe_key", (q) => q.eq("dedupeKey", args.dedupeKey))
      .first();

    // Already delivered — skip (idempotent retry). The in-app row was written
    // when the job was first created, so it is not duplicated here either.
    if (old?.status === "delivered") return old._id;

    // Cancel the old scheduled function if it exists.
    if (old?.scheduledFunctionId) {
      try {
        await ctx.scheduler.cancel(old.scheduledFunctionId);
      } catch {
        // Function may have already run — safe to ignore.
      }
    }

    // Delete the old job row.
    if (old) await ctx.db.delete(old._id);

    const now = Date.now();
    // Written field by field rather than spread: `args.inApp` is a control
    // flag, not part of the stored job.
    const jobId = await ctx.db.insert("notificationJobs", {
      kind: args.kind,
      dedupeKey: args.dedupeKey,
      deliverAt: args.deliverAt,
      payload: args.payload,
      recipientUserIds: args.recipientUserIds,
      status: "scheduled",
      createdAt: now,
    });

    // The durable half of the notification, written in the same transaction as
    // the job so the two can never disagree.
    if (args.inApp) {
      await notifyUsers(ctx, {
        userIds: args.recipientUserIds,
        kind: args.kind,
        title: args.payload.title,
        body: args.payload.body,
        url: args.payload.url,
      });
    }

    // Schedule the delivery action.
    const scheduledFunctionId = await ctx.scheduler.runAfter(
      Math.max(0, args.deliverAt - now),
      internal.pushNode.deliverJob,
      { jobId },
    );

    await ctx.db.patch(jobId, { scheduledFunctionId });
    return jobId;
  },
});

/** Mark a job as delivered after successful push delivery. */
export const markDelivered = internalMutation({
  args: { jobId: v.id("notificationJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (job?.status === "scheduled") {
      await ctx.db.patch(jobId, { status: "delivered" });
    }
  },
});
