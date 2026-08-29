import { internalQuery, query, QueryCtx } from "./_generated/server";
import { FOLLOWUP_TYPE_LABELS, ROLES } from "./constants";
import { getCurrentUser, userRoles } from "./helpers";
import type { WorkerRecipient, ClassRecipient } from "./emailHtml";

export interface Digest {
  enabled: boolean;
  counts: {
    workerEmails: number;
    classEmails: number;
    skippedWorkers: number;
    upcoming: number;
    overdue: number;
    birthdays: number;
    lowAttendance: number;
    newContacts: number;
  };
  workerRecipients: WorkerRecipient[];
  classRecipients: ClassRecipient[];
}

const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const addDays = (from: Date, n: number) => {
  const d = new Date(from.getTime() + n * 86400000);
  return localDate(d);
};

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
    const birthdays: ClassRecipient["birthdays"] = [];
    for (const c of classContacts) {
      if (!c.dateOfBirth) continue;
      const dob = new Date(c.dateOfBirth);
      if (isNaN(dob.getTime())) continue;
      const next = new Date(now.getFullYear(), dob.getMonth(), dob.getDate());
      if (next < now) next.setFullYear(now.getFullYear() + 1);
      const dateStr = localDate(next);
      if (dateStr >= today && dateStr <= in7) {
        birthdays.push({
          contactId: c._id,
          contactName: c.fullName,
          monthDay: `${String(dob.getMonth() + 1).padStart(2, "0")}-${String(dob.getDate()).padStart(2, "0")}`,
        });
      }
    }
    birthdays.sort((a, b) => a.monthDay.localeCompare(b.monthDay));

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
    };
  });

  return {
    enabled,
    counts: {
      workerEmails: workerRecipients.length,
      classEmails: classRecipients.length,
      skippedWorkers: skippedNames.size,
      upcoming: upcoming.length,
      overdue: overdue.length,
      birthdays: classRecipients.reduce((n, r) => n + r.birthdays.length, 0),
      lowAttendance: classRecipients.reduce((n, r) => n + r.lowAttendance.length, 0),
      newContacts: classRecipients.reduce((n, r) => n + r.newContacts.length, 0),
    },
    workerRecipients,
    classRecipients,
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
    return {
      ...data,
      workerRecipients: data.workerRecipients.filter((r) => r.userId === user._id),
      classRecipients: data.classRecipients.filter((r) => r.userId === user._id),
    };
  },
});
