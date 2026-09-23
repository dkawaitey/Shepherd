import { internalQuery, query, QueryCtx } from "./_generated/server";
import {
  FOLLOWUP_STATUS,
  FOLLOWUP_TYPE_LABELS,
  MEMBER_INACTIVITY_DAYS,
  ROLE_LABELS,
  ROLES,
  STAGES,
  STAGE_ORDER,
} from "./constants";
import { getCurrentUser, userRoles } from "./helpers";
import { attendanceSections, fmtShortDate } from "./emailHtml";
import type {
  WorkerRecipient,
  ClassRecipient,
  MinistryRecipient,
  DigestAttendance,
} from "./emailHtml";
import {
  effectiveParticipation,
  participationInsight,
  parseStartTimes,
  punctualitySummary,
  punctualityTrend,
  quadrantCounts,
  sessionStarts,
} from "../lib/attendance-trend";

export interface Digest {
  enabled: boolean;
  counts: {
    workerEmails: number;
    classEmails: number;
    ministryEmails: number;
    skippedWorkers: number;
    upcoming: number;
    overdue: number;
    birthdays: number;
    lowAttendance: number;
    newContacts: number;
  };
  workerRecipients: WorkerRecipient[];
  classRecipients: ClassRecipient[];
  ministryRecipients: MinistryRecipient[];
}

const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const addDays = (from: Date, n: number) => {
  const d = new Date(from.getTime() + n * 86400000);
  return localDate(d);
};

/** `n` of `total` plus a percentage — the shape used throughout the digest. */
const tally = (n: number, total: number) =>
  `${n}${total > 0 ? ` (${Math.round((n / total) * 100)}%)` : ""}`;

/** Bullet list, or a fallback line when there is nothing to report. */
const bullets = (lines: string[], empty: string) =>
  lines.length ? lines.map((l) => `• ${l}`).join("<br/>") : empty;

/**
 * Members' combined attendance + punctuality reading for a digest.
 *
 * Built from the same shared functions the app uses, so a member who is
 * "drifting" in the digest is drifting on their profile too. Everything is
 * derived from the already-collected attendance rows — no extra queries.
 */
function buildAttendanceDigest(
  members: any[],
  attendance: any[],
  starts: Map<string, number>,
  startTimes: Record<string, string>,
): DigestAttendance {
  const ids = new Set(members.map((m) => m._id));
  const byMember = new Map<string, any[]>();
  for (const a of attendance) {
    if (!a.memberId || !ids.has(a.memberId)) continue;
    const list = byMember.get(a.memberId) ?? [];
    list.push(a);
    byMember.set(a.memberId, list);
  }
  const allRows = [...byMember.values()].flat();
  const participation = effectiveParticipation(allRows, starts, startTimes);
  const punctuality = punctualitySummary(allRows, starts, startTimes);

  const insights = members.map((m) =>
    participationInsight(byMember.get(m._id) ?? [], starts, startTimes),
  );
  const quad = quadrantCounts(
    insights.map((i) => ({
      attendanceRate: i.participation.attendanceRate,
      onTimeRate:
        i.punctuality.timed === 0
          ? null
          : Math.round((i.punctuality.onTime / i.punctuality.timed) * 100),
    })),
  );

  const drifting = members
    .map((m, idx) => ({ m, insight: insights[idx]! }))
    .filter((x) => x.insight.drift.level !== "none")
    .sort((a, b) =>
      a.insight.drift.level === b.insight.drift.level
        ? 0
        : a.insight.drift.level === "atRisk"
          ? -1
          : 1,
    )
    .slice(0, 8)
    .map((x) => ({
      memberId: String(x.m._id),
      memberName: x.m.fullName as string,
      level: x.insight.drift.level as "watch" | "atRisk",
      reason: x.insight.drift.reasons[0] ?? x.insight.drift.suggestedReason,
    }));

  return {
    effectiveRate: participation.rate,
    attendanceRate: participation.attendanceRate,
    onTimeRate:
      punctuality.timed === 0
        ? 0
        : Math.round((punctuality.onTime / punctuality.timed) * 100),
    averageDelay: punctuality.averageDelay,
    timed: punctuality.timed,
    punctualityTrend: punctualityTrend(allRows, starts, startTimes, 6).map((p) => ({
      label: p.label,
      onTimeRate: p.onTimeRate,
      averageDelay: p.averageDelay,
      timed: p.timed,
    })),
    quadrant: {
      counts: quad.counts,
      unmeasured: quad.unmeasured,
      total: members.length,
    },
    drifting,
  };
}

type ContactRow = { _id: string; fullName: string; dateOfBirth?: string };

/** Contacts whose birthday falls between `today` and `in7`, sorted by date. */
function birthdaysInWindow(
  contacts: ContactRow[],
  now: Date,
  today: string,
  in7: string,
) {
  const rows: { contactId: string; contactName: string; monthDay: string }[] = [];
  for (const c of contacts) {
    if (!c.dateOfBirth) continue;
    const dob = new Date(c.dateOfBirth);
    if (isNaN(dob.getTime())) continue;
    const next = new Date(now.getFullYear(), dob.getMonth(), dob.getDate());
    if (next < now) next.setFullYear(now.getFullYear() + 1);
    const dateStr = localDate(next);
    if (dateStr >= today && dateStr <= in7) {
      rows.push({
        contactId: c._id,
        contactName: c.fullName,
        monthDay: `${String(dob.getMonth() + 1).padStart(2, "0")}-${String(dob.getDate()).padStart(2, "0")}`,
      });
    }
  }
  return rows.sort((a, b) => a.monthDay.localeCompare(b.monthDay));
}

/**
 * Compute who should be emailed today:
 *  - Follow-up workers: every pending follow-up due in the next 3 days or overdue.
 *  - Class leaders: their class's follow-ups, birthdays, low attendance and new contacts.
 */
export async function computeDigest(ctx: QueryCtx): Promise<Digest> {
  const [contacts, followUps, members, users, attendance, settings] = await Promise.all([
    ctx.db.query("contacts").collect(),
    ctx.db.query("followUps").collect(),
    ctx.db.query("members").collect(),
    ctx.db.query("users").collect(),
    ctx.db.query("attendance").collect(),
    ctx.db.query("settings").collect(),
  ]);

  const settingsMap: Record<string, string> = {};
  for (const s of settings) settingsMap[s.key] = s.value;
  const enabled = settingsMap.reminder_email_enabled !== "false";

  // Session starts and configured activity times, shared by every attendance
  // figure below so the class and ministry digests agree with the app.
  const startTimes = parseStartTimes(settingsMap.attendance_start_times);
  const starts = sessionStarts(attendance, startTimes);

  const now = new Date();
  const today = localDate(now);
  const in3 = addDays(now, 3);
  const in7 = addDays(now, 7);
  const past28 = addDays(now, -28);
  const past7 = addDays(now, -7);

  const liveContacts = contacts.filter((c) => !c.isDeleted);
  const liveFollowups = followUps.filter((f) => !f.isDeleted);
  const liveMembers = members.filter((m) => !m.isDeleted);
  const people = users.filter((u) => !u.isAnonymous);

  // Build a phone lookup: prefer user's profile phone, fall back to their linked member record.
  const memberById = new Map(liveMembers.map((m) => [m._id, m]));
  const userPhone = (u: typeof people[0]): string | undefined => {
    if (u.phone) return u.phone;
    if (u.memberId) {
      const m = memberById.get(u.memberId);
      if (m?.phone) return m.phone;
    }
    return undefined;
  };

  const userById = new Map(people.map((u) => [u._id, u]));
  const contactById = new Map(liveContacts.map((c) => [c._id, c]));

  const pending = liveFollowups.filter((f) => f.status === "pending");
  const upcoming = pending.filter((f) => f.date <= in3);
  const overdue = pending.filter((f) => f.date < today);

  // ---- Worker follow-up reminders ----
  const workerMap = new Map<string, WorkerRecipient>();
  const skippedNames = new Set<string>();
  for (const f of [...upcoming, ...overdue]) {
    const contact = contactById.get(f.contactId);
    if (!contact) continue;
    let worker = contact.assignedWorkerId ? userById.get(contact.assignedWorkerId) : undefined;
    if (!worker?.email && f.assignedWorker) {
      worker = people.find(
        (u) => !!u.email && (u.name ?? "").toLowerCase() === f.assignedWorker!.toLowerCase(),
      );
    }
    if (!worker || (!worker.email && !userPhone(worker))) {
      skippedNames.add(f.assignedWorker || "unassigned");
      continue;
    }
    const entry: WorkerRecipient = workerMap.get(worker._id) ?? {
      userId: worker._id,
      email: worker.email ?? "",
      phone: userPhone(worker),
      name: worker.name ?? "Worker",
      items: [],
    };
    entry.items.push({
      contactId: contact._id,
      contactName: contact.fullName,
      membershipId: contact.membershipId,
      typeLabel: FOLLOWUP_TYPE_LABELS[f.type] ?? f.type,
      date: f.date,
      overdue: f.date < today,
    });
    workerMap.set(worker._id, entry);
  }
  const workerRecipients = [...workerMap.values()].map((r) => ({
    ...r,
    items: r.items.sort((a, b) => a.date.localeCompare(b.date)),
  }));

  // ---- Class leader digests ----
  const classLeaders = people.filter(
    (u) =>
      (u.roles?.includes(ROLES.CLASS_LEADER) || u.role === ROLES.CLASS_LEADER) &&
      !!u.classScope &&
      (!!u.email || !!userPhone(u)),
  );

  const classRecipients: ClassRecipient[] = classLeaders.map((leader) => {
    const scope = leader.classScope!;
    const classContacts = liveContacts.filter((c) => c.klass === scope);
    const classContactIds = new Set(classContacts.map((c) => c._id));
    const classMembers = liveMembers.filter((m) => m.klass === scope);

    const classUpcoming = upcoming.filter((f) => classContactIds.has(f.contactId));
    const classOverdue = overdue.filter((f) => classContactIds.has(f.contactId));

    // Birthdays in the next 7 days (contacts carry date of birth)
    const birthdays = birthdaysInWindow(classContacts, now, today, in7);

    // Members with no youth-meeting attendance in the last 4 weeks
    const memberRows = attendance.filter(
      (a) => a.subjectType === "member" && a.date >= past28,
    );
    const lowAttendance: ClassRecipient["lowAttendance"] = classMembers
      .filter(
        (m) =>
          !memberRows.some(
            (a) => a.memberId === m._id && a.type === "youthMeeting" && a.status === "present",
          ),
      )
      .slice(0, 12)
      .map((m) => ({ memberId: m._id, memberName: m.fullName }));

    // Contacts added in the last 7 days
    const newContacts: ClassRecipient["newContacts"] = classContacts
      .filter((c) => localDate(new Date(c.createdAt)) >= past7)
      .slice(0, 10)
      .map((c) => ({
        contactId: c._id,
        contactName: c.fullName,
        location: c.area || c.community || "",
      }));

    return {
      userId: leader._id,
      email: leader.email ?? "",
      phone: userPhone(leader),
      name: leader.name ?? "Class Leader",
      className: scope,
      upcoming: classUpcoming.map((f) => ({
        contactId: f.contactId,
        contactName: contactById.get(f.contactId)?.fullName ?? "Unknown",
        typeLabel: FOLLOWUP_TYPE_LABELS[f.type] ?? f.type,
        date: f.date,
      })),
      overdue: classOverdue.map((f) => ({
        contactId: f.contactId,
        contactName: contactById.get(f.contactId)?.fullName ?? "Unknown",
        typeLabel: FOLLOWUP_TYPE_LABELS[f.type] ?? f.type,
        date: f.date,
      })),
      birthdays,
      lowAttendance,
      newContacts,
      // The four combined analytics for this class: effective participation, the
      // monthly punctuality trend, the quadrant split and the drifting members.
      attendance: buildAttendanceDigest(classMembers, attendance, starts, startTimes),
    };
  });

  // ---- Ministry digest: administrators and evangelism coordinators ----
  //
  // Both roles receive a ministry-wide picture, but only the sections their
  // role may read: an administrator gets the full picture (including account
  // and member-directory health, which is admin-only), while a coordinator gets
  // outreach, follow-up and worker oversight but nothing from the member
  // directory or account management.
  const stageAtLeast = (stage: string) =>
    liveContacts.filter(
      (c) =>
        STAGE_ORDER.indexOf((c.status ?? STAGES.REACHED) as never) >=
        STAGE_ORDER.indexOf(stage as never),
    ).length;

  const weekEnd = addDays(now, 7);
  const upcomingThisWeek = pending.filter((f) => f.date >= today && f.date <= weekEnd);
  const newContactsThisWeek = liveContacts.filter((c) => localDate(new Date(c.createdAt)) >= past7);
  const completedRecent = liveFollowups.filter(
    (f) => f.status === FOLLOWUP_STATUS.COMPLETED && (f.completedDate ?? "") >= past28,
  ).length;
  const missedRecent = liveFollowups.filter(
    (f) => f.status === FOLLOWUP_STATUS.MISSED && f.date >= past28,
  ).length;
  const responseRate =
    completedRecent + missedRecent > 0
      ? Math.round((completedRecent / (completedRecent + missedRecent)) * 100)
      : 0;
  const unassigned = liveContacts.filter((c) => !c.assignedWorkerId && !c.assignedWorker);
  const ministryBirthdays = birthdaysInWindow(liveContacts, now, today, in7);
  const workerLoad = workerRecipients
    .map((r) => ({
      name: r.name,
      open: r.items.length,
      overdue: r.items.filter((i) => i.overdue).length,
    }))
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open)
    .slice(0, 8);

  // Admin-only: accounts that signed up but no one has vouched for them yet,
  // and members whose account has gone quiet on the app.
  const unlinkedAccounts = people.filter((u) => !u.memberId && userRoles(u).length === 0);
  const activityCutoff = now.getTime() - MEMBER_INACTIVITY_DAYS * 86400000;
  const userByMemberId = new Map(
    people.filter((u) => u.memberId).map((u) => [u.memberId as string, u]),
  );
  const quietMembers = liveMembers.filter((m) => {
    const account = userByMemberId.get(m._id);
    if (!account) return false;
    return (account.lastActiveAt ?? 0) < activityCutoff;
  });
  const lowAttendanceAll = liveMembers.filter(
    (m) =>
      !attendance.some(
        (a) => a.subjectType === "member" && a.memberId === m._id && a.type === "youthMeeting" && a.status === "present" && a.date >= past28,
      ),
  );

  // Ministry-wide combined attendance + punctuality reading, built from every
  // member's records so the shared section below describes the whole ministry.
  const ministryAttendance = buildAttendanceDigest(
    liveMembers,
    attendance,
    starts,
    startTimes,
  );

  /** Sections that both administrators and coordinators may read. */
  const sharedSections = () => [
    {
      heading: "Outreach",
      body:
        `• People reached (all time): ${liveContacts.length}<br/>` +
        `• New contacts this week: ${newContactsThisWeek.length}<br/>` +
        `• Accepted Christ: ${tally(stageAtLeast(STAGES.ACCEPTED_CHRIST), liveContacts.length)} of contacts reached<br/>` +
        `• Baptized: ${stageAtLeast(STAGES.BAPTIZED)} · Joined church: ${stageAtLeast(STAGES.JOINED_CHURCH)} · Serving: ${stageAtLeast(STAGES.SERVING)}`,
    },
    {
      heading: "New this week",
      body: bullets(
        newContactsThisWeek
          .slice(0, 6)
          .map((c) => `${c.fullName}${c.klass ? ` — ${c.klass} Class` : c.area ? ` — ${c.area}` : ""}`),
        "No new contacts recorded in the last 7 days.",
      ),
    },
    {
      heading: "Follow-up status",
      body:
        `• Active (pending): ${pending.length}<br/>` +
        `• Overdue: ${overdue.length}<br/>` +
        `• Due in the next 7 days: ${upcomingThisWeek.length}<br/>` +
        `• Completed in the last 4 weeks: ${completedRecent}<br/>` +
        `• Missed in the last 4 weeks: ${missedRecent} · Response rate: ${responseRate}%`,
    },
    {
      heading: "Overdue follow-ups to act on",
      body: bullets(
        overdue
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(0, 8)
          .map(
            (f) =>
              `${contactById.get(f.contactId)?.fullName ?? "Unknown"} — ${FOLLOWUP_TYPE_LABELS[f.type] ?? f.type} — was due ${fmtShortDate(f.date)}${f.assignedWorker ? ` (${f.assignedWorker})` : " · no worker"}`,
          ),
        "Nothing overdue — every follow-up is on schedule.",
      ),
    },
    {
      heading: "Follow-up workers",
      body: bullets(
        workerLoad.map((w) => `${w.name} — ${w.open} open in the next 3 days, ${w.overdue} overdue`),
        "No worker has anything due in the next 3 days.",
      ),
    },
    {
      heading: "Contacts without a follow-up worker",
      body:
        unassigned.length === 0
          ? "Every contact has an assigned follow-up worker."
          : `${unassigned.length} of ${liveContacts.length} contacts have no worker assigned.<br/>` +
            bullets(
              unassigned.slice(0, 6).map((c) => c.fullName),
              "",
            ),
    },
    {
      heading: "Birthdays this week",
      body: bullets(
        ministryBirthdays.map((b) => `${b.contactName} — ${b.monthDay}`),
        "No birthdays in the next 7 days.",
      ),
    },
    // The four combined analytics, ministry-wide. Included for both roles: a
    // coordinator acts on attendance and punctuality as much as an admin does.
    ...attendanceSections(ministryAttendance, "ministry-wide members"),
  ];

  const ministryRecipients: MinistryRecipient[] = [];
  for (const recipient of people) {
    const roles = userRoles(recipient);
    const isMinistryAdmin = roles.includes(ROLES.ADMIN);
    const isCoordinator = roles.includes(ROLES.COORDINATOR);
    if (!isMinistryAdmin && !isCoordinator) continue;
    if (!recipient.email && !userPhone(recipient)) continue;

    const sections = sharedSections();

    if (isMinistryAdmin) {
      // Full system access: account hygiene and the member directory.
      sections.push(
        {
          heading: "Member directory",
          body:
            `• Members on record: ${liveMembers.length}<br/>` +
            `• No youth meeting in the last 4 weeks: ${lowAttendanceAll.length}<br/>` +
            `• Accounts quiet on the app for ${MEMBER_INACTIVITY_DAYS}+ days: ${quietMembers.length}`,
        },
        {
          heading: "Members needing follow-up",
          body: bullets(
            lowAttendanceAll.slice(0, 8).map((m) => `${m.fullName}${m.klass ? ` — ${m.klass} Class` : ""}`),
            "Every member has attended a youth meeting recently.",
          ),
        },
        {
          heading: "Access & account health",
          body:
            unlinkedAccounts.length === 0
              ? "Every signed-in account is linked to a member record or holds a role."
              : `${unlinkedAccounts.length} account${unlinkedAccounts.length === 1 ? "" : "s"} signed up without a linked member profile and cannot reach ministry data. Link them from Settings → Access Review.<br/>` +
                bullets(
                  unlinkedAccounts
                    .slice(0, 6)
                    .map((u) => `${u.name ?? u.email ?? "Unnamed account"} — awaiting a member link`),
                  "",
                ),
        },
      );
    }

    ministryRecipients.push({
      userId: recipient._id,
      email: recipient.email ?? "",
      phone: userPhone(recipient),
      name: recipient.name ?? (isMinistryAdmin ? "Administrator" : "Coordinator"),
      roleLabel: ROLE_LABELS[(isMinistryAdmin ? ROLES.ADMIN : ROLES.COORDINATOR) as keyof typeof ROLE_LABELS],
      scopeNote: isMinistryAdmin
        ? "ministry-wide outreach, follow-ups, workers, member directory and account health."
        : "ministry-wide outreach, follow-ups and follow-up worker oversight.",
      sections,
    });
  }

  return {
    enabled,
    counts: {
      workerEmails: workerRecipients.length,
      classEmails: classRecipients.length,
      ministryEmails: ministryRecipients.length,
      skippedWorkers: skippedNames.size,
      upcoming: upcoming.length,
      overdue: overdue.length,
      birthdays: classRecipients.reduce((n, r) => n + r.birthdays.length, 0),
      lowAttendance: classRecipients.reduce((n, r) => n + r.lowAttendance.length, 0),
      newContacts: classRecipients.reduce((n, r) => n + r.newContacts.length, 0),
    },
    workerRecipients,
    classRecipients,
    ministryRecipients,
  };
}

/** Full digest — used by the send actions. */
export const digest = internalQuery({
  args: {},
  handler: async (ctx) => computeDigest(ctx),
});

/** Preview for the Settings page. Admins see the whole digest; others only their own. */
export const preview = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const data = await computeDigest(ctx);
    if (userRoles(user).includes(ROLES.ADMIN)) return data;
    // Everyone else only sees the parts of the digest addressed to them — a
    // coordinator sees their own ministry digest, never the administrator's.
    const mine = (recipient: { userId?: string }) => recipient.userId === user._id;
    return {
      ...data,
      workerRecipients: data.workerRecipients.filter(mine),
      classRecipients: data.classRecipients.filter(mine),
      ministryRecipients: data.ministryRecipients.filter(mine),
    };
  },
});
