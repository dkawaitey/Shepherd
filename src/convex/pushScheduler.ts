import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { normalizeDay, resolveWorkerUser } from "./helpers";

type UserRow = {
  _id: Id<"users">;
  name?: string | null;
  email?: string | null;
  memberId?: Id<"members"> | null;
};
type MemberRow = { _id: Id<"members">; fullName: string };

/**
 * Who should receive a follow-up reminder: the assigned worker when the name
 * resolves to a real account, plus whoever scheduled the follow-up. Sending to
 * both means a worker without a registered push device — or a worker name that
 * matches no account — never silently swallows the reminder.
 *
 * The assigned-worker picker stores a class member's full name, so the name is
 * resolved through the member record to its linked account (see
 * `resolveWorkerUser`) rather than requiring an exact account-name match.
 */
export function followupRecipientIds(
  contact: { assignedWorkerId?: Id<"users"> | null; assignedWorker?: string | null },
  fu: { assignedWorker?: string | null; createdBy?: string | null },
  people: UserRow[],
  members: MemberRow[],
  userById: Map<Id<"users">, UserRow>,
): Id<"users">[] {
  const ids: Id<"users">[] = [];
  let workerId = contact.assignedWorkerId ?? undefined;
  if (!workerId) {
    const worker = resolveWorkerUser(
      fu.assignedWorker ?? contact.assignedWorker,
      people,
      members,
    );
    if (worker) workerId = worker._id;
  }
  if (workerId) ids.push(workerId);
  if (fu.createdBy && fu.createdBy !== workerId) {
    const creator = userById.get(fu.createdBy as Id<"users">);
    if (creator) ids.push(creator._id);
  }
  return ids;
}

const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const addDays = (from: Date, n: number) => {
  const d = new Date(from.getTime() + n * 86400000);
  return localDate(d);
};

/**
 * Daily push notification scheduler.
 * Runs once per day via cron. Computes all events that need push
 * notifications and schedules them through the notification system.
 *
 * Notification types:
 *  1. Follow-up reminders (day-before + morning-of)
 *  2. Birthday alerts (day-before + morning-of)
 *  3. Missed follow-up alerts
 *  4. Low attendance alerts
 *  5. Bible study reminders (morning-of)
 */
export const dailyPushNotifications = internalMutation({
  args: {},
  handler: async (ctx) => {
    const [contacts, followUps, members, users, attendance, settings] =
      await Promise.all([
        ctx.db.query("contacts").collect(),
        ctx.db.query("followUps").collect(),
        ctx.db.query("members").collect(),
        ctx.db.query("users").collect(),
        ctx.db.query("attendance").collect(),
        ctx.db.query("settings").collect(),
      ]);

    const settingsMap: Record<string, string> = {};
    for (const s of settings) settingsMap[s.key] = s.value;

    const pushEnabled = settingsMap.push_notifications_enabled !== "false";
    if (!pushEnabled) return { scheduled: 0 };

    const now = new Date();
    const today = localDate(now);
    const tomorrow = addDays(now, 1);
    const in3 = addDays(now, 3);
    const past28 = addDays(now, -28);
    const past7 = addDays(now, -7);

    const liveContacts = contacts.filter((c) => !c.isDeleted);
    const liveFollowups = followUps.filter((f) => !f.isDeleted);
    const liveMembers = members.filter((m) => !m.isDeleted);
    const people = users.filter((u) => !u.isAnonymous);

    const contactById = new Map(liveContacts.map((c) => [c._id, c]));
    const userById = new Map(people.map((u) => [u._id, u]));
    let scheduled = 0;

    // ─── 1. Follow-up reminders ───────────────────────────────────
    // Pending follow-ups due tomorrow → day-before reminder
    // Pending follow-ups due today → morning-of reminder
    // The per-follow-up "Send reminder" toggle (default on) gates every
    // follow-up alert, so unchecking it stops the reminders and the overdue
    // nudge as well.
    const pending = liveFollowups.filter(
      (f) => f.status === "pending" && f.reminder !== false,
    );

    for (const fu of pending) {
      const contact = contactById.get(fu.contactId);
      if (!contact) continue;

      const recipientIds = followupRecipientIds(
        contact,
        fu,
        people,
        liveMembers,
        userById,
      );
      if (recipientIds.length === 0) continue;

      // Day-before reminder. `normalizeDay` trims the time from rows written
      // before the date was stored date-only, so the comparison still matches.
      if (normalizeDay(fu.date) === tomorrow) {
        await ctx.runMutation(internal.notifications.scheduleNotification, {
          kind: "follow_up_reminder",
          dedupeKey: `follow-up:${fu._id}:day-before`,
          deliverAt: Date.now(),
          payload: {
            title: "Follow-up Tomorrow",
            body: `Reminder: ${contact.fullName} — ${fu.type} follow-up is tomorrow`,
            url: `/followups`,
          },
          recipientUserIds: recipientIds,
          // Also lands on the in-app bell so the reminder survives a device
          // that never registered (or dropped) its push subscription.
          inApp: true,
        });
        scheduled++;
      }

      // Morning-of reminder
      if (normalizeDay(fu.date) === today) {
        await ctx.runMutation(internal.notifications.scheduleNotification, {
          kind: "follow_up_reminder",
          dedupeKey: `follow-up:${fu._id}:morning`,
          deliverAt: Date.now(),
          payload: {
            title: "Follow-up Today",
            body: `Today: ${contact.fullName} — ${fu.type} follow-up is scheduled`,
            url: `/followups`,
          },
          recipientUserIds: recipientIds,
          inApp: true,
        });
        scheduled++;
      }
    }

    // ─── 2. Missed follow-up alerts ───────────────────────────────
    // Follow-ups that were due before today and are still pending
    const missed = pending.filter((f) => normalizeDay(f.date) < today);
    for (const fu of missed.slice(0, 20)) {
      const contact = contactById.get(fu.contactId);
      if (!contact) continue;

      const recipientIds = followupRecipientIds(
        contact,
        fu,
        people,
        liveMembers,
        userById,
      );
      if (recipientIds.length === 0) continue;

      await ctx.runMutation(internal.notifications.scheduleNotification, {
        kind: "missed_follow_up",
        dedupeKey: `missed-followup:${fu._id}:${today}`,
        deliverAt: Date.now(),
        payload: {
          title: "Missed Follow-up",
          body: `Overdue: ${contact.fullName} — was due ${fu.date}`,
          url: `/followups`,
        },
        recipientUserIds: recipientIds,
      });
      scheduled++;
    }

    // ─── 3. Birthday alerts ────────────────────────────────────────
    // Contacts with birthdays in the next 7 days → sent to ALL members
    const allMemberIds = people.map((u) => u._id);
    for (const c of liveContacts) {
      if (!c.dateOfBirth) continue;
      const dob = new Date(c.dateOfBirth);
      if (isNaN(dob.getTime())) continue;

      const next = new Date(now.getFullYear(), dob.getMonth(), dob.getDate());
      if (next < now) next.setFullYear(now.getFullYear() + 1);
      const dateStr = localDate(next);

      if (dateStr === tomorrow && allMemberIds.length > 0) {
        await ctx.runMutation(internal.notifications.scheduleNotification, {
          kind: "birthday_alert",
          dedupeKey: `birthday:${c._id}:day-before`,
          deliverAt: Date.now(),
          payload: {
            title: "Birthday tomorrow",
            body: `${c.fullName}'s birthday is tomorrow!`,
            url: `/contacts/${c._id}`,
          },
          recipientUserIds: allMemberIds,
        });
        scheduled++;
      }
    }

    // ─── 4. Low attendance alerts ──────────────────────────────────
    // Members with no youth-meeting attendance in the last 4 weeks
    const memberRows = attendance.filter(
      (a) => a.subjectType === "member" && a.date >= past28,
    );

    for (const m of liveMembers) {
      const hasRecentAttendance = memberRows.some(
        (a) => a.memberId === m._id && a.type === "youthMeeting" && a.status === "present",
      );
      if (hasRecentAttendance) continue;

      // Notify class leaders about low attendance in their class
      const classLeaders = people.filter(
        (u) =>
          !u.isAnonymous &&
          (u.roles?.includes("classLeader") || u.role === "classLeader") &&
          u.classScope === m.klass,
      );
      const leaderIds = classLeaders.map((l) => l._id);
      if (leaderIds.length > 0) {
        await ctx.runMutation(internal.notifications.scheduleNotification, {
          kind: "low_attendance",
          dedupeKey: `low-attendance:${m._id}:${today}`,
          deliverAt: Date.now(),
          payload: {
            title: "Low Attendance Alert",
            body: `${m.fullName} hasn't attended in 4 weeks`,
            url: `/attendance`,
          },
          recipientUserIds: leaderIds,
        });
        scheduled++;
      }
    }

    // ─── 4. Bible study reminders ──────────────────────────────────
    // Contacts with Bible study lessons in progress for >2 weeks → remind worker
    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const bibleStudies = await ctx.db.query("bibleStudies").collect();
    for (const bs of bibleStudies) {
      if (bs.status !== "inProgress") continue;
      // Check if the lesson has been in progress for more than 2 weeks
      if (bs.createdAt > twoWeeksAgo) continue;

      const contact = contactById.get(bs.contactId);
      if (!contact) continue;

      let workerId = contact.assignedWorkerId;
      if (!workerId) {
        const worker = resolveWorkerUser(
          contact.assignedWorker,
          people,
          liveMembers,
        );
        if (worker) workerId = worker._id;
      }
      if (!workerId) continue;

      await ctx.runMutation(internal.notifications.scheduleNotification, {
        kind: "bible_study_reminder",
        dedupeKey: `bible-study:${bs._id}:${today}`,
        deliverAt: Date.now(),
        payload: {
          title: "Bible Study Reminder",
          body: `Lesson ${bs.lesson} for ${contact.fullName} is overdue — started ${new Date(bs.createdAt).toLocaleDateString()}`,
          url: `/contacts/${contact._id}`,
        },
        recipientUserIds: [workerId],
      });
      scheduled++;
    }

    return { scheduled };
  },
});

// ─── Directly-scheduled follow-up reminders ──────────────────────────────
//
// The daily cron above is a safety net: it only fires a reminder when it
// happens to run on the exact due day, at 06:30 UTC. Scheduling a follow-up
// usually happens after that (or days ahead), so in practice no reminder ever
// went out. Instead, schedule each follow-up's reminders the moment it is
// created (see `scheduleFollowupReminders`). Both paths share the same dedupe
// keys, so if they ever overlap only one notification is sent.

/** The hour (UTC) at which reminders are delivered. */
const REMINDER_HOUR_UTC = 6;
const REMINDER_MINUTE_UTC = 30;

/** Epoch ms of the reminder hour (UTC) on a `YYYY-MM-DD` day. */
function reminderTimeUtc(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  return Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    REMINDER_HOUR_UTC,
    REMINDER_MINUTE_UTC,
  );
}

/** The UTC day `n` days from now, as `YYYY-MM-DD`. */
const utcDay = (n = 0) =>
  new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/**
 * Schedule a follow-up's day-before and morning-of reminders.
 *
 * - Day-before fires at 06:30 UTC the previous day when that is still ahead.
 * - Morning-of fires at 06:30 UTC on the due day; if the follow-up is created
 *   for *today* after that hour, it fires immediately instead, so scheduling
 *   always produces a reminder.
 *
 * Called on create/update; each scheduled run re-checks the follow-up so an
 * edit, completion or deletion simply makes it a no-op.
 */
export async function scheduleFollowupReminders(
  ctx: MutationCtx,
  followupId: Id<"followUps">,
  date: string,
) {
  const day = normalizeDay(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;

  const now = Date.now();
  const plan: { when: "day-before" | "morning"; at: number }[] = [];

  // The reminder hour on the follow-up day; the day-before reminder is that
  // instant minus a day.
  const followupMs = reminderTimeUtc(day);
  if (followupMs !== null) {
    const dayBefore = followupMs - 86400000;
    if (dayBefore > now) plan.push({ when: "day-before", at: dayBefore });
    if (followupMs > now) {
      plan.push({ when: "morning", at: followupMs });
    } else if (day === utcDay(0)) {
      // The follow-up is today and the reminder hour already passed — send now.
      plan.push({ when: "morning", at: now });
    }
  }

  for (const p of plan) {
    await ctx.scheduler.runAfter(
      Math.max(0, p.at - now),
      internal.pushScheduler.remindFollowup,
      { followupId, when: p.when },
    );
  }
}

/**
 * Deliver one follow-up reminder, re-checking the follow-up first so a record
 * that was completed, cancelled, deleted, edited to another day, or had its
 * reminder switched off since scheduling sends nothing.
 */
export const remindFollowup = internalMutation({
  args: {
    followupId: v.id("followUps"),
    when: v.union(v.literal("day-before"), v.literal("morning")),
  },
  handler: async (ctx, { followupId, when }) => {
    const fu = await ctx.db.get(followupId);
    if (!fu || fu.isDeleted || fu.status !== "pending" || fu.reminder === false) {
      return;
    }
    // The follow-up must still fall on the day this reminder is for.
    const day = normalizeDay(fu.date);
    const expected = when === "morning" ? utcDay(0) : utcDay(1);
    if (day !== expected) return;

    const contact = await ctx.db.get(fu.contactId);
    if (!contact) return;

    const people = (await ctx.db.query("users").collect()).filter(
      (u) => !u.isAnonymous,
    );
    const members = (await ctx.db.query("members").collect()).filter(
      (m) => !m.isDeleted,
    );
    const userById = new Map(people.map((u) => [u._id, u]));
    const recipientIds = followupRecipientIds(
      contact,
      fu,
      people,
      members,
      userById,
    );
    if (recipientIds.length === 0) return;

    const isDayBefore = when === "day-before";
    await ctx.runMutation(internal.notifications.scheduleNotification, {
      kind: "follow_up_reminder",
      dedupeKey: `follow-up:${fu._id}:${when}`,
      deliverAt: Date.now(),
      payload: {
        title: isDayBefore ? "Follow-up Tomorrow" : "Follow-up Today",
        body: isDayBefore
          ? `Reminder: ${contact.fullName} — ${fu.type} follow-up is tomorrow`
          : `Today: ${contact.fullName} — ${fu.type} follow-up is scheduled`,
        url: "/followups",
      },
      recipientUserIds: recipientIds,
      // Durable half: the bell always gets the reminder, whether or not a
      // device is registered for it.
      inApp: true,
    });
  },
});
