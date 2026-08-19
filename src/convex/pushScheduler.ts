import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

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
    const pending = liveFollowups.filter((f) => f.status === "pending");

    for (const fu of pending) {
      const contact = contactById.get(fu.contactId);
      if (!contact) continue;

      // Find the assigned worker
      let workerId = contact.assignedWorkerId;
      if (!workerId && fu.assignedWorker) {
        const worker = people.find(
          (u) => !!u.email && (u.name ?? "").toLowerCase() === fu.assignedWorker!.toLowerCase(),
        );
        if (worker) workerId = worker._id;
      }
      if (!workerId) continue;

      // Day-before reminder
      if (fu.date === tomorrow) {
        await ctx.runMutation(internal.notifications.scheduleNotification, {
          kind: "follow_up_reminder",
          dedupeKey: `follow-up:${fu._id}:day-before`,
          deliverAt: Date.now(),
          payload: {
            title: "Follow-up Tomorrow",
            body: `Reminder: ${contact.fullName} — ${fu.type} follow-up is tomorrow`,
            url: `/followups`,
          },
          recipientUserIds: [workerId],
        });
        scheduled++;
      }

      // Morning-of reminder
      if (fu.date === today) {
        await ctx.runMutation(internal.notifications.scheduleNotification, {
          kind: "follow_up_reminder",
          dedupeKey: `follow-up:${fu._id}:morning`,
          deliverAt: Date.now(),
          payload: {
            title: "Follow-up Today",
            body: `Today: ${contact.fullName} — ${fu.type} follow-up is scheduled`,
            url: `/followups`,
          },
          recipientUserIds: [workerId],
        });
        scheduled++;
      }
    }

    // ─── 2. Missed follow-up alerts ───────────────────────────────
    // Follow-ups that were due before today and are still pending
    const missed = pending.filter((f) => f.date < today);
    for (const fu of missed.slice(0, 20)) {
      const contact = contactById.get(fu.contactId);
      if (!contact) continue;

      let workerId = contact.assignedWorkerId;
      if (!workerId && fu.assignedWorker) {
        const worker = people.find(
          (u) => !!u.email && (u.name ?? "").toLowerCase() === fu.assignedWorker!.toLowerCase(),
        );
        if (worker) workerId = worker._id;
      }
      if (!workerId) continue;

      await ctx.runMutation(internal.notifications.scheduleNotification, {
        kind: "missed_follow_up",
        dedupeKey: `missed-followup:${fu._id}:${today}`,
        deliverAt: Date.now(),
        payload: {
          title: "Missed Follow-up",
          body: `Overdue: ${contact.fullName} — was due ${fu.date}`,
          url: `/followups`,
        },
        recipientUserIds: [workerId],
      });
      scheduled++;
    }

    // ─── 3. Birthday alerts ────────────────────────────────────────
    // Contacts with birthdays in the next 7 days
    for (const c of liveContacts) {
      if (!c.dateOfBirth) continue;
      const dob = new Date(c.dateOfBirth);
      if (isNaN(dob.getTime())) continue;

      const next = new Date(now.getFullYear(), dob.getMonth(), dob.getDate());
      if (next < now) next.setFullYear(now.getFullYear() + 1);
      const dateStr = localDate(next);

      if (dateStr === tomorrow) {
        // Notify all active leaders/managers about upcoming birthday
        const leaders = people.filter(
          (u) =>
            !u.isAnonymous &&
            (u.roles?.includes("admin") ||
              u.roles?.includes("coordinator") ||
              u.role === "admin" ||
              u.role === "coordinator"),
        );
        const leaderIds = leaders.map((l) => l._id);
        if (leaderIds.length > 0) {
          await ctx.runMutation(internal.notifications.scheduleNotification, {
            kind: "birthday_alert",
            dedupeKey: `birthday:${c._id}:day-before`,
            deliverAt: Date.now(),
            payload: {
              title: "Birthday Tomorrow 🎂",
              body: `${c.fullName}'s birthday is tomorrow!`,
              url: `/contacts/${c._id}`,
            },
            recipientUserIds: leaderIds,
          });
          scheduled++;
        }
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

    return { scheduled };
  },
});
