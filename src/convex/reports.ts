import { query } from "./_generated/server";
import { v } from "convex/values";
import {
  FOLLOWUP_STATUS,
  STAGES,
  STAGE_ORDER,
  STAGE_LABELS,
} from "./constants";
import { getCurrentUser } from "./helpers";

const monthKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export const overview = query({
  args: { from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const [contacts, followUps, bibleStudies, attendance, prayers] = await Promise.all([
      ctx.db.query("contacts").collect(),
      ctx.db.query("followUps").collect(),
      ctx.db.query("bibleStudies").collect(),
      ctx.db.query("attendance").collect(),
      ctx.db.query("prayerRequests").collect(),
    ]);

    const live = contacts.filter((c) => !c.isDeleted);
    const liveFollowups = followUps.filter((f) => !f.isDeleted);
    const inRange = (ts: number) => (!args.from || ts >= new Date(args.from).getTime()) && (!args.to || ts <= new Date(args.to).getTime());
    const inRangeDate = (d: string) => (!args.from || d >= args.from) && (!args.to || d <= args.to);

    const reached = live.filter((c) => inRange(c.createdAt));
    const accepted = live.filter(
      (c) =>
        STAGE_ORDER.indexOf((c.status ?? STAGES.REACHED) as any) >=
        STAGE_ORDER.indexOf(STAGES.ACCEPTED_CHRIST as any),
    );
    const baptized = live.filter((c) =>
      STAGE_ORDER.indexOf((c.status ?? STAGES.REACHED) as any) >= STAGE_ORDER.indexOf(STAGES.BAPTIZED as any),
    );

    const completed = liveFollowups.filter((f) => f.status === FOLLOWUP_STATUS.COMPLETED && inRangeDate(f.date));
    const missed = liveFollowups.filter((f) => f.status === FOLLOWUP_STATUS.MISSED && inRangeDate(f.date));
    const cancelled = liveFollowups.filter((f) => f.status === FOLLOWUP_STATUS.CANCELLED && inRangeDate(f.date));

    // Monthly trend: people reached + new converts + baptisms, last 6 months
    const now = new Date();
    const monthly: { month: string; reached: number; converts: number; baptisms: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = monthKey(d.getTime());
      monthly.push({
        month: d.toLocaleString("en", { month: "short" }),
        reached: live.filter((c) => monthKey(c.createdAt) === key).length,
        converts: live.filter(
          (c) =>
            monthKey(c.createdAt) === key &&
            c.status === STAGES.ACCEPTED_CHRIST,
        ).length,
        baptisms: attendance.filter(
          (a) => a.type === "specialProgram" && a.programName === "Baptism Service" && a.date.startsWith(key),
        ).length,
      });
    }

    // Conversion funnel (all time)
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
      count: live.filter(
        (c) =>
          STAGE_ORDER.indexOf((c.status ?? STAGES.REACHED) as any) >=
          STAGE_ORDER.indexOf(stage as any),
      ).length,
    }));

    // Worker productivity
    const workerMap = new Map<string, { name: string; assigned: number; completed: number; missed: number; pending: number }>();
    for (const f of liveFollowups) {
      const name = f.assignedWorker ?? "Unassigned";
      const entry = workerMap.get(name) ?? { name, assigned: 0, completed: 0, missed: 0, pending: 0 };
      entry.assigned++;
      if (f.status === FOLLOWUP_STATUS.COMPLETED) entry.completed++;
      if (f.status === FOLLOWUP_STATUS.MISSED) entry.missed++;
      if (f.status === FOLLOWUP_STATUS.PENDING) entry.pending++;
      workerMap.set(name, entry);
    }
    const workers = [...workerMap.values()].sort((a, b) => b.completed - a.completed);

    // Retention: contacts with follow-up activity after their creation month
    const retention = Math.round((completed.length / Math.max(1, reached.length)) * 100);
    const responseRate = Math.round((completed.length / Math.max(1, completed.length + missed.length)) * 100);
    const conversionRate = Math.round((accepted.length / Math.max(1, live.length)) * 100);
    const dropOff = Math.max(0, 100 - retention);

    // Average time to baptism (from contact creation)
    let baptismTimes: number[] = [];
    for (const c of accepted) {
      const evt = await ctx.db
        .query("journeyEvents")
        .withIndex("contactId", (q) => q.eq("contactId", c._id))
        .filter((q) => q.eq(q.field("stage"), STAGES.BAPTIZED))
        .first();
      if (evt) {
        baptismTimes.push(new Date(evt.date).getTime() - c.createdAt);
      }
    }
    const avgTimeToBaptismDays = baptismTimes.length
      ? Math.round(baptismTimes.reduce((a, b) => a + b, 0) / baptismTimes.length / 86400000)
      : 0;

    // Class distribution
    const classes = ["Millison", "Reuben", "Jacob", "Romina"];
    const classDist = classes.map((k) => ({
      klass: k,
      count: live.filter((c) => c.klass === k).length,
    }));

    // Bible study progress
    const bsByLesson = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
      lesson: n,
      completed: bibleStudies.filter((b) => b.lesson === n && b.status === "completed").length,
      inProgress: bibleStudies.filter((b) => b.lesson === n && b.status === "inProgress").length,
    }));

    // Attendance summary
    const attendanceRows = attendance.filter((a) => inRangeDate(a.date));
    const attendanceTotal = attendanceRows.length;
    const attendancePresent = attendanceRows.filter((a) => a.status === "present").length;

    return {
      counts: {
        reached: reached.length,
        accepted: accepted.length,
        baptized: baptized.length,
        completed: completed.length,
        missed: missed.length,
        cancelled: cancelled.length,
        pending: liveFollowups.filter((f) => f.status === FOLLOWUP_STATUS.PENDING).length,
        prayers: prayers.filter((p) => p.status === "active").length,
        answeredPrayers: prayers.filter((p) => p.status === "answered").length,
      },
      rates: {
        retention,
        responseRate,
        conversionRate,
        dropOff,
        avgTimeToBaptismDays,
        attendanceRate: attendanceTotal ? Math.round((attendancePresent / attendanceTotal) * 100) : 0,
      },
      monthly,
      funnel,
      workers,
      classDist,
      bsByLesson,
    };
  },
});
