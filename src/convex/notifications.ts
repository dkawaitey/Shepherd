import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

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
  ),
  dedupeKey: v.string(),
  deliverAt: v.number(),
  payload,
  recipientUserIds: v.array(v.id("users")),
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

    // Already delivered — skip (idempotent retry).
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
    const jobId = await ctx.db.insert("notificationJobs", {
      ...args,
      status: "scheduled",
      createdAt: now,
    });

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
