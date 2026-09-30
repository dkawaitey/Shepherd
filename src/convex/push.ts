import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, MutationCtx } from "./_generated/server";
import { requireAdmin, getCurrentUser, normalizeDay } from "./helpers";
import { followupRecipientIds } from "./pushScheduler";
import { checkRateLimit } from "./rateLimit";

/** Return the VAPID public key so the browser can subscribe. */
export const getPublicKey = query({
  args: {},
  handler: () => process.env.VAPID_PUBLIC_KEY ?? null,
});

/**
 * The user's persisted notification intent. This is what keeps the "enable"
 * toggle on even after the browser drops or rotates its push subscription:
 * the client re-subscribes automatically while `enabled` is true.
 */
export const myPreference = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { enabled: false as boolean, exists: false };

    const pref = await ctx.db
      .query("pushPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    const devices = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    return {
      enabled: pref?.enabled ?? false,
      exists: !!pref,
      deviceCount: devices.length,
      updatedAt: pref?.updatedAt ?? null,
    };
  },
});

/** Record the user's notification intent (on/off). */
export const setPreference = mutation({
  args: { enabled: v.boolean(), userAgent: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Sign in to manage notifications.");
    const user = await ctx.db.get(userId);

    const existing = await ctx.db
      .query("pushPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    const fields = {
      userId,
      email: user?.email,
      enabled: args.enabled,
      userAgent: args.userAgent,
      updatedAt: Date.now(),
    };

    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("pushPreferences", fields);

    return { enabled: args.enabled };
  },
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

    // Registering a device is an explicit opt-in — persist that intent so the
    // client can silently re-subscribe if the browser ever drops the endpoint.
    await setPreferenceHandler(ctx, userId, true, args.userAgent, user?.email);
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

    // Only clear the saved intent once the user has no devices left. Turning
    // notifications off on one device must not switch them off (or, via the
    // client auto-heal, switch them back on) for the user's other devices.
    const remaining = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    if (remaining.length === 0) {
      await setPreferenceHandler(ctx, userId, false, undefined, undefined);
    }
  },
});

/** Shared upsert for the per-user notification intent row. */
async function setPreferenceHandler(
  ctx: MutationCtx,
  userId: Id<"users">,
  enabled: boolean,
  userAgent?: string,
  email?: string,
) {
  const existing = await ctx.db
    .query("pushPreferences")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();

  const fields = {
    userId,
    email,
    enabled,
    userAgent,
    updatedAt: Date.now(),
  };

  if (existing) await ctx.db.patch(existing._id, fields);
  else await ctx.db.insert("pushPreferences", fields);
}

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

    const pref = await ctx.db
      .query("pushPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    return {
      subscribed: devices.length > 0,
      enabled: pref?.enabled ?? false,
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
    await checkRateLimit(ctx, "push.sendTestNotification");
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

/**
 * Send a real follow-up reminder immediately, using the same recipient
 * resolution and delivery path the scheduler uses.
 *
 * This is the one check that separates "the reminder pipeline is broken" from
 * "the reminder is scheduled but this device never registered". It picks the
 * next pending follow-up that has reminders on, resolves its recipients, and
 * pushes + bells them right away. Administrator only.
 */
export const sendTestFollowupReminder = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    await checkRateLimit(ctx, "push.sendTestFollowupReminder");

    const users = await ctx.db.query("users").collect();
    const people = users.filter((u) => !u.isAnonymous);
    const members = (await ctx.db.query("members").collect()).filter(
      (m) => !m.isDeleted,
    );
    const userById = new Map(people.map((u) => [u._id, u]));

    const pending = (await ctx.db.query("followUps").collect())
      .filter(
        (f) => !f.isDeleted && f.status === "pending" && f.reminder !== false,
      )
      .sort((a, b) => normalizeDay(a.date).localeCompare(normalizeDay(b.date)));

    if (pending.length === 0) {
      throw new ConvexError(
        'No pending follow-up has reminders turned on. Schedule one with "Send reminder" checked, then try again.',
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    const fu =
      pending.find((f) => normalizeDay(f.date) >= today) ??
      pending[pending.length - 1];
    const contact = await ctx.db.get(fu.contactId);
    if (!contact) {
      throw new ConvexError("That follow-up's contact no longer exists.");
    }

    const recipientIds = followupRecipientIds(
      contact,
      fu,
      people,
      members,
      userById,
    );
    if (recipientIds.length === 0) {
      throw new ConvexError(
        "No recipient could be resolved for that follow-up. Assign a worker, or check that whoever scheduled it signed in with an account rather than a guest session.",
      );
    }

    const now = Date.now();
    await ctx.runMutation(internal.notifications.scheduleNotification, {
      kind: "follow_up_reminder",
      dedupeKey: `test-followup:${fu._id}:${now}`,
      deliverAt: now,
      payload: {
        title: "Follow-up reminder (test)",
        body: `${contact.fullName} — ${fu.type} follow-up on ${normalizeDay(fu.date)}`,
        url: "/followups",
      },
      recipientUserIds: recipientIds,
      inApp: true,
    });

    return {
      recipients: recipientIds.length,
      contact: contact.fullName,
      date: normalizeDay(fu.date),
      type: fu.type,
    };
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

/** Log a delivery attempt for debugging. */
export const logDelivery = internalMutation({
  args: {
    jobId: v.optional(v.id("notificationJobs")),
    endpoint: v.string(),
    success: v.boolean(),
    error: v.optional(v.string()),
    statusCode: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("pushDeliveryLogs", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

/** Return VAPID key configuration status and recent delivery logs. Admin only —
 *  exposes endpoint URLs, delivery errors, and VAPID key presence. */
export const deliveryDiagnostics = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const publicKey = !!process.env.VAPID_PUBLIC_KEY;
    const privateKey = !!process.env.VAPID_PRIVATE_KEY;
    const subject = !!process.env.VAPID_SUBJECT;
    // Subject has a built-in fallback, so only public + private are truly required.
    const vapidConfigured = publicKey && privateKey;

    const allSubscriptions = await ctx.db.query("pushSubscriptions").collect();
    const recentLogs = await ctx.db
      .query("pushDeliveryLogs")
      .withIndex("by_created")
      .order("desc")
      .take(10);

    const recentJobs = await ctx.db
      .query("notificationJobs")
      .withIndex("by_status_deliver_at")
      .order("desc")
      .take(5);

    // Reminders specifically — the job list above is shared with posts, polls
    // and test notifications, which could otherwise crowd them out.
    const followupJobs = await ctx.db
      .query("notificationJobs")
      .filter((q) =>
        q.or(
          q.eq(q.field("kind"), "follow_up_reminder"),
          q.eq(q.field("kind"), "missed_follow_up"),
        ),
      )
      .order("desc")
      .take(5);

    /** Distinct devices registered for a set of recipients. A job whose
     *  recipients have no devices was created but could never be delivered. */
    const devicesFor = async (userIds: Id<"users">[]) => {
      const endpoints = new Set<string>();
      for (const userId of new Set(userIds)) {
        const devices = await ctx.db
          .query("pushSubscriptions")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect();
        for (const d of devices) endpoints.add(d.endpoint);
      }
      return endpoints.size;
    };

    // Check for recent post/comment/poll-result notification jobs.
    const postJobs = await ctx.db
      .query("notificationJobs")
      .filter((q) => q.or(
        q.eq(q.field("kind"), "post"),
        q.eq(q.field("kind"), "comment"),
        q.eq(q.field("kind"), "reply"),
        q.eq(q.field("kind"), "poll_result"),
      ))
      .order("desc")
      .take(5);

    return {
      vapidConfigured,
      vapidPublicKey: publicKey,
      vapidPrivateKey: privateKey,
      vapidSubject: subject,
      totalSubscriptions: allSubscriptions.length,
      // Devices registered vs. accounts that hold at least one. A reminder can
      // only reach a device, never an account.
      subscribedAccounts: new Set(allSubscriptions.map((s) => s.userId)).size,
      recentLogs: recentLogs.map((l) => ({
        endpoint: l.endpoint,
        success: l.success,
        error: l.error,
        statusCode: l.statusCode,
        createdAt: l.createdAt,
      })),
      recentJobs: await Promise.all(
        recentJobs.map(async (j) => ({
          kind: j.kind,
          status: j.status,
          deliverAt: j.deliverAt,
          recipients: j.recipientUserIds.length,
          devices: await devicesFor(j.recipientUserIds),
          createdAt: j.createdAt,
        })),
      ),
      followupJobs: await Promise.all(
        followupJobs.map(async (j) => ({
          kind: j.kind,
          title: j.payload.title,
          status: j.status,
          deliverAt: j.deliverAt,
          recipients: j.recipientUserIds.length,
          devices: await devicesFor(j.recipientUserIds),
          createdAt: j.createdAt,
        })),
      ),
      postNotificationJobs: postJobs.map((j) => ({
        kind: j.kind,
        status: j.status,
        deliverAt: j.deliverAt,
        recipients: j.recipientUserIds.length,
        createdAt: j.createdAt,
      })),
    };
  },
});
