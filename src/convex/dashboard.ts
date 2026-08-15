import { query } from "./_generated/server";
import {
  FOLLOWUP_STATUS,
  STAGES,
  STAGE_ORDER,
  STAGE_LABELS,
} from "./constants";
import { getCurrentUser, classScoped } from "./helpers";

/** All journey timeline events (for milestone checkmarks on contact cards). */
export const journeyEventsAll = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const scope = classScoped(user);
    let events = await ctx.db.query("journeyEvents").collect();
    if (scope) {
      const contacts = await ctx.db.query("contacts").collect();
      const ids = new Set(
        contacts.filter((c) => c.klass === scope).map((c) => c._id),
      );
      events = events.filter((e) => ids.has(e.contactId));
    }
    events.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
    return events;
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const scope = classScoped(user);

    const [allContacts, allFollowups, allPrayers, allMembers, allAttendance] = await Promise.all([
      ctx.db.query("contacts").collect(),
      ctx.db.query("followUps").collect(),
      ctx.db.query("prayerRequests").collect(),
      ctx.db.query("members").collect(),
      ctx.db.query("attendance").collect(),
    ]);

    const live = allContacts.filter((c) => !c.isDeleted && (!scope || c.klass === scope));
    const liveIds = new Set(live.map((c) => c._id));
    const liveFollowups = allFollowups.filter(
      (f) => !f.isDeleted && (!scope || liveIds.has(f.contactId)),
    );
    const liveMembers = allMembers.filter((m) => !m.isDeleted && (!scope || m.klass === scope));
    const memberIds = new Set(liveMembers.map((m) => m._id));
    const prayers = scope
      ? allPrayers.filter(
          (p) => (p.contactId && liveIds.has(p.contactId)) || (p.memberId && memberIds.has(p.memberId)),
        )
      : allPrayers;
    const attendance = scope
      ? allAttendance.filter(
          (a) =>
            (a.subjectType === "contact" && a.contactId && liveIds.has(a.contactId)) ||
            (a.subjectType === "member" && a.memberId && memberIds.has(a.memberId)),
        )
      : allAttendance;

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const stageAtLeast = (stage: string) =>
      live.filter((c) => STAGE_ORDER.indexOf((c.status ?? STAGES.REACHED) as any) >= STAGE_ORDER.indexOf(stage as any)).length;

    const pending = liveFollowups.filter((f) => f.status === FOLLOWUP_STATUS.PENDING);
    const upcomingThisWeek = pending.filter((f) => f.date >= today && f.date <= weekEnd);

    // Funnel: cumulative count at-or-beyond each stage
    const funnelStages = [
      STAGES.REACHED,
      STAGES.INTERESTED,
      STAGES.FOLLOWUP_STARTED,
      STAGES.ACCEPTED_CHRIST,
      STAGES.BIBLE_STUDY,
      STAGES.BAPTIZED,
      STAGES.JOINED_CHURCH,
      STAGES.SERVING,
    ];
    const funnel = funnelStages.map((stage) => ({
      stage,
      label: STAGE_LABELS[stage],
      count: stageAtLeast(stage),
    }));

    const genderMale = live.filter((c) => c.gender === "male").length;
    const genderFemale = live.filter((c) => c.gender === "female").length;

    // Upcoming follow-ups joined with contact names
    const contactMap = new Map(live.map((c) => [c._id, c]));
    const upcomingFollowups = pending
      .filter((f) => f.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 40)
      .map((f) => ({
        ...f,
        contactName: contactMap.get(f.contactId)?.fullName ?? "Unknown",
      }));

    // Prayer journal summary
    const recentPrayers = prayers
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 6)
      .map((p) => ({
        ...p,
        contactName: contactMap.get(p.contactId as any)?.fullName ?? "Unknown",
      }));
    const activePrayers = prayers.filter((p) => p.status === "active").length;
    const answeredPrayers = prayers.filter((p) => p.status === "answered").length;

    // Reminders
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const reminders: {
      type: string;
      title: string;
      message: string;
      link: string;
      contactId?: string;
    }[] = [];

    const overdue = pending.filter((f) => f.date < today);
    for (const f of overdue.slice(0, 5)) {
      const c = contactMap.get(f.contactId);
      reminders.push({
        type: "overdue",
        title: "Overdue follow-up",
        message: `${f.type} for ${c?.fullName ?? "contact"} was due ${f.date}.`,
        link: `/followups?status=pending`,
        contactId: f.contactId,
      });
    }

    // No contact for 10 days (last activity = max of created/followup dates)
    for (const c of live.slice(0, 200)) {
      const lastActivity = Math.max(
        c.updatedAt,
        ...liveFollowups
          .filter((f) => f.contactId === c._id)
          .map((f) => new Date(f.date).getTime()),
      );
      if (lastActivity < new Date(tenDaysAgo).getTime()) {
        reminders.push({
          type: "inactive",
          title: "No contact for 10+ days",
          message: `${c.fullName} has had no interaction since ${new Date(lastActivity).toLocaleDateString()}.`,
          link: `/contacts/${c._id}`,
          contactId: c._id,
        });
        if (reminders.filter((r) => r.type === "inactive").length >= 3) break;
      }
    }

    // Birthdays this week
    for (const c of live) {
      if (!c.dateOfBirth) continue;
      const dob = new Date(c.dateOfBirth);
      const thisYear = new Date(now.getFullYear(), dob.getMonth(), dob.getDate());
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      if (thisYear >= now && thisYear <= nextWeek) {
        reminders.push({
          type: "birthday",
          title: "Birthday coming up",
          message: `${c.fullName}'s birthday is on ${thisYear.toLocaleDateString()}. Send greetings.`,
          link: `/contacts/${c._id}`,
          contactId: c._id,
        });
      }
    }

    // Members with no youth meeting attendance for 4 weeks
    const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const memberAttendance = attendance.filter((a) => a.subjectType === "member" && a.date >= fourWeeksAgo);
    for (const m of liveMembers) {
      const attended = memberAttendance.some(
        (a) => a.memberId === m._id && a.type === "youthMeeting" && a.status === "present",
      );
      if (!attended) {
        reminders.push({
          type: "attendance",
          title: "Low attendance",
          message: `${m.fullName} has not attended a youth meeting in 4 weeks. Consider follow-up.`,
          link: `/members/${m._id}`,
        });
        if (reminders.filter((r) => r.type === "attendance").length >= 3) break;
      }
    }

    return {
      cards: {
        totalReached: live.length,
        activeFollowups: pending.length,
        newConverts: live.filter((c) => c.status === STAGES.ACCEPTED_CHRIST).length,
        baptized: stageAtLeast(STAGES.BAPTIZED),
        joinedChurch: stageAtLeast(STAGES.JOINED_CHURCH),
        completedDiscipleship: stageAtLeast(STAGES.COMPLETED_DISCIPLESHIP),
        missedFollowups: liveFollowups.filter((f) => f.status === FOLLOWUP_STATUS.MISSED).length,
        upcomingVisitsThisWeek: upcomingThisWeek.length,
      },
      funnel,
      gender: [
        { label: "Male", count: genderMale },
        { label: "Female", count: genderFemale },
      ],
      upcomingFollowups,
      prayers: {
        recent: recentPrayers,
        activeCount: activePrayers,
        answeredCount: answeredPrayers,
      },
      reminders,
      workerName: user.name ?? user.email ?? "Worker",
    };
  },
});
