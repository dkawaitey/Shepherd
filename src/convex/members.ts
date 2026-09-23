import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query, QueryCtx } from "./_generated/server";
import {
  CLASS_OPTIONS,
  POSITION_OPTIONS,
  POSITIONS,
  ROLES,
  Role,
  deriveMemberClassScope,
  deriveMemberRoles,
  effectivePosition,
} from "./constants";
import { nextMembershipId } from "./contacts";
import {
  getCurrentUser,
  hasRole,
  logAudit,
  nowIso,
  requireRole,
  classScoped,
  canReadMinistry,
  canSeePrivateNote,
  canSeeConfidentialPrayer,
  withinClassScope,
} from "./helpers";
import { Doc } from "./_generated/dataModel";
import { checkRateLimit } from "./rateLimit";
import { validateName, validateEmail, validatePhone } from "./validate";
import {
  parseStartTimes,
  punctualityByType,
  punctualitySummary,
  punctualityVerdictCounts,
  sessionStarts,
} from "../lib/attendance-trend";

/** Validate + normalize a member's position / class-leader flag (admin-only
 *  values). Prevents contradictory combinations, e.g. Read-only Leader + Class
 *  Leader, or Ordinary Member holding class leadership. */
const normalizePosition = (
  position: string | undefined,
  requestedClassLeader: boolean,
) => {
  const pos = position?.trim() || undefined;
  if (pos && !POSITION_OPTIONS.includes(pos as (typeof POSITION_OPTIONS)[number])) {
    throw new ConvexError("Invalid ministry position");
  }
  if (pos === POSITIONS.LEADER && requestedClassLeader) {
    throw new ConvexError("A Read-only Leader cannot also be a Class Leader");
  }
  if (
    requestedClassLeader &&
    pos &&
    pos !== POSITIONS.CLASS_LEADER &&
    pos !== POSITIONS.ADMIN &&
    pos !== POSITIONS.COORDINATOR
  ) {
    throw new ConvexError(
      "Only a Class Leader, Administrator or Evangelism Coordinator position can include class leadership",
    );
  }
  let isClassLeader = requestedClassLeader;
  if (pos === POSITIONS.CLASS_LEADER) isClassLeader = true;
  else if (pos && pos !== POSITIONS.ADMIN && pos !== POSITIONS.COORDINATOR) {
    isClassLeader = false;
  }
  return { position: pos, isClassLeader };
};

/** Derive the 2-letter area code from the area name — the first two letters of
 *  the area (e.g. Adjikpo → AD, Odumasi → OD). Same rule as contacts. */
const deriveShortcut = (area?: string) =>
  (area || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();

/** How recently a member's account used the app (see `memberActivity`). */
type Activity = {
  /** True once the member has a log-in (linked account) at all. */
  hasAccount: boolean;
  /** Epoch ms of the last sign-in or app open; null when there is no account. */
  lastSeenAt: number | null;
  /** Whole days since `lastSeenAt`; null when there is no account. */
  daysSinceSeen: number | null;
};

const NO_ACTIVITY: Activity = { hasAccount: false, lastSeenAt: null, daysSinceSeen: null };

/**
 * When each member's account last signed in or opened the app.
 *
 * A member counts as having a log-in when an account is linked to them either
 * explicitly (`users.memberId`, set by linkMember / autoLinkAccount) or by
 * sharing the member's email address — the app links accounts by email when they
 * open it, so the email match covers a profile whose log-in details were just
 * added. A member with no linked account gets NO_ACTIVITY: with no way to sign
 * in, silence about them would be noise, not a signal. As soon as an account is
 * linked, the indicator starts applying to them.
 *
 * Recency is the latest of three things, because no single one is accurate:
 *   - `users.lastActiveAt` — the app-open heartbeat (client-side)
 *   - the newest auth session, which Convex Auth only creates at sign-in
 *   - the account's own creation time, which is when it first signed in
 * A session is refreshed silently while the app stays open, so sessions alone
 * would report an active member as absent.
 */
async function memberActivity(
  ctx: QueryCtx,
  members: Doc<"members">[],
): Promise<Map<string, Activity>> {
  const [accounts, sessions] = await Promise.all([
    ctx.db.query("users").collect(),
    ctx.db.query("authSessions").take(2000),
  ]);

  const lastSignInByUser = new Map<string, number>();
  for (const session of sessions) {
    const prev = lastSignInByUser.get(session.userId) ?? 0;
    if (session._creationTime > prev) {
      lastSignInByUser.set(session.userId, session._creationTime);
    }
  }

  // Explicit links win; the email match is the fallback for a profile whose
  // log-in details are newer than the last auto-link pass.
  const byMemberId = new Map<string, Doc<"users">>();
  const byEmail = new Map<string, Doc<"users">>();
  for (const account of accounts) {
    if (account.memberId) byMemberId.set(account.memberId, account);
    const email = account.email?.trim().toLowerCase();
    // Guests (anonymous) have no email and are never a member's log-in.
    if (email && !account.isAnonymous && !byEmail.has(email)) {
      byEmail.set(email, account);
    }
  }

  const now = Date.now();
  const result = new Map<string, Activity>();
  for (const member of members) {
    const email = member.email?.trim().toLowerCase();
    const account =
      byMemberId.get(member._id) ?? (email ? byEmail.get(email) : undefined);
    if (!account) {
      result.set(member._id, NO_ACTIVITY);
      continue;
    }
    const lastSeenAt =
      Math.max(
        account.lastActiveAt ?? 0,
        lastSignInByUser.get(account._id) ?? 0,
        account._creationTime,
      ) || null;
    result.set(member._id, {
      hasAccount: true,
      lastSeenAt,
      daysSinceSeen:
        lastSeenAt === null
          ? null
          : Math.floor((now - lastSeenAt) / 86400000),
    });
  }
  return result;
}

/** Members list, filterable by class / status / search. View-only for non-admins. */
export const list = query({
  args: {
    klass: v.optional(v.string()),
    status: v.optional(v.string()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    // Guests and plain members hold no ministry role, so they read nothing.
    if (!canReadMinistry(user)) return [];
    let members = await ctx.db.query("members").collect();
    members = members.filter((m) => !m.isDeleted);
    // A class leader only ever sees their own class.
    const scope = classScoped(user);
    if (scope) members = members.filter((m) => m.klass === scope);
    if (args.klass && args.klass !== "all") members = members.filter((m) => m.klass === args.klass);
    if (args.status && args.status !== "all") members = members.filter((m) => m.status === args.status);
    if (args.search) {
      const q = args.search.toLowerCase();
      members = members.filter((m) =>
        [m.fullName, m.phone, m.whatsapp, m.membershipId, m.ministryRoles]
          .filter(Boolean)
          .some((f) => f!.toLowerCase().includes(q)),
      );
    }
    members.sort((a, b) => a.fullName.localeCompare(b.fullName));

    // Attendance summary per member, plus how recently their account used the
    // app (the member card flags long absences with a small dot).
    const [attendance, activity] = await Promise.all([
      ctx.db.query("attendance").collect(),
      memberActivity(ctx, members),
    ]);

    return members.map((m) => ({
      ...m,
      ...(activity.get(m._id) ?? NO_ACTIVITY),
      attendanceCount: attendance.filter((a) => a.memberId === m._id).length,
    }));
  },
});

/** Member profile with attendance history + summary percentages. */
export const get = query({
  args: { id: v.id("members") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!canReadMinistry(user)) return null;
    const member = await ctx.db.get(args.id);
    if (!member || member.isDeleted) return null;
    if (!withinClassScope(user, member.klass)) return null;
    const [attendance, prayers, notes, activity, allAttendance, startTimeRow] = await Promise.all([
      ctx.db.query("attendance").withIndex("memberId", (q) => q.eq("memberId", args.id)).collect(),
      ctx.db.query("prayerRequests").withIndex("memberId", (q) => q.eq("memberId", args.id)).collect(),
      ctx.db.query("notes").withIndex("memberId", (q) => q.eq("memberId", args.id)).collect(),
      memberActivity(ctx, [member]),
      // Every attendance record, so this member's arrivals can be judged against
      // when each session actually began (its configured start, or its first arrival).
      ctx.db.query("attendance").collect(),
      // The ministry's official start time per activity, set in Ministry Settings.
      ctx.db
        .query("settings")
        .withIndex("key", (q) => q.eq("key", "attendance_start_times"))
        .first(),
    ]);
    const startTimes = parseStartTimes(startTimeRow?.value);
    return {
      // The profile header carries the same last-seen dot as the member card.
      member: { ...member, ...(activity.get(member._id) ?? NO_ACTIVITY) },
      attendance: attendance.sort((a, b) => b.date.localeCompare(a.date)),
      // Punctuality: each arrival measured against its session's official start
      // time when one is configured, and against the first arrival otherwise.
      punctuality: punctualitySummary(
        attendance,
        sessionStarts(allAttendance, startTimes),
        startTimes,
      ),
      // The same reading per activity — early to the youth meeting, late to
      // Sunday service is a schedule problem, not a discipline one.
      punctualityByActivity: punctualityByType(
        attendance,
        sessionStarts(allAttendance, startTimes),
        startTimes,
      ),
      // Confidential prayers and private notes are filtered per viewer.
      prayers: prayers
        .filter((p) => canSeeConfidentialPrayer(user, p))
        .sort((a, b) => b.createdAt - a.createdAt),
      notes: notes
        .filter((n) => canSeePrivateNote(user, n))
        .sort((a, b) => b.createdAt - a.createdAt),
    };
  },
});

/**
 * The member record belonging to the signed-in account, if any.
 *
 * Every account kept out of ministry records — an Ordinary Member position
 * derives no system role, so `canReadMinistry` is false for it — still has the
 * right to see its own details. This stays deliberately narrow: it resolves the
 * member from the account's own link (explicit `memberId`, or an email match to
 * cover a profile whose log-in details are newer than the last auto-link pass)
 * and never accepts an id from the caller, so it cannot be used to read someone
 * else's record.
 */
export const getMine = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user || user.isAnonymous) return null;

    let member = user.memberId
      ? await ctx.db.get(user.memberId as unknown as Doc<"members">["_id"])
      : null;
    if (!member || member.isDeleted) {
      const email = user.email?.trim().toLowerCase();
      if (!email) return null;
      const all = await ctx.db.query("members").collect();
      member =
        all.find((m) => !m.isDeleted && m.email?.trim().toLowerCase() === email) ??
        null;
    }
    if (!member) return null;

    const attendance = await ctx.db
      .query("attendance")
      .withIndex("memberId", (q) => q.eq("memberId", member!._id))
      .collect();

    return {
      member,
      attendance: attendance.sort((a, b) => b.date.localeCompare(a.date)),
    };
  },
});

export const create = mutation({
  args: {
    fullName: v.string(),
    gender: v.optional(v.union(v.literal("male"), v.literal("female"))),
    phone: v.optional(v.string()),
    whatsapp: v.optional(v.string()),
    email: v.optional(v.string()),
    klass: v.optional(v.string()),
    dateJoined: v.optional(v.string()),
    area: v.optional(v.string()),
    areaShortcut: v.optional(v.string()),
    classLeader: v.optional(v.string()),
    ministryRoles: v.optional(v.string()),
    occupation: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("inactive"))),
    position: v.optional(v.string()),
    isClassLeader: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await checkRateLimit(ctx, "members.create");
    const user = await requireRole(ctx, [ROLES.CLASS_LEADER]);
    args.fullName = validateName(args.fullName);
    if (args.email) args.email = validateEmail(args.email);
    if (args.phone) args.phone = validatePhone(args.phone);
    const isAdminCaller = hasRole(user, ROLES.ADMIN);
    // Only administrators may appoint ministry positions / class leadership.
    const classLeader = isAdminCaller ? args.classLeader : undefined;
    const { position, isClassLeader } = isAdminCaller
      ? normalizePosition(args.position, !!args.isClassLeader)
      : { position: undefined, isClassLeader: false };
    const klass = args.klass || CLASS_OPTIONS[0];
    // Same ID format as contacts (AREA-DDMM-YYYY-SEQ) so promoted contacts
    // keep a consistent, non-class-based identifier. Shares the counter with
    // contacts, so sequences never collide across the two tables.
    const dateJoined = args.dateJoined || nowIso();
    const shortcut = deriveShortcut(args.area);
    const membershipId = await nextMembershipId(ctx, shortcut, dateJoined);
    const now = Date.now();
    const id = await ctx.db.insert("members", {
      fullName: args.fullName,
      gender: args.gender,
      phone: args.phone,
      whatsapp: args.whatsapp,
      email: args.email,
      klass,
      area: args.area,
      dateJoined: args.dateJoined,
      classLeader,
      ministryRoles: args.ministryRoles,
      occupation: args.occupation,
      status: args.status ?? "active",
      position: position as any,
      isClassLeader,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
      membershipId,
    });
    await logAudit(ctx, {
      action: "member.create",
      entityType: "members",
      entityId: id,
      details: `${args.fullName} (${membershipId})`,
    });

    // Fire-and-forget Customer.io event (never blocks or breaks the mutation).
    await ctx.scheduler.runAfter(0, internal.customerio.track, {
      identifier: membershipId,
      event: "member_added",
      attributes: {
        fullName: args.fullName,
        email: args.email ?? "",
        phone: args.phone ?? "",
        klass,
        area: args.area ?? "",
        status: args.status ?? "active",
      },
      data: {
        klass,
        area: args.area ?? "",
        gender: args.gender ?? "",
      },
    });

    return { _id: id, membershipId };
  },
});

/** Admin-only edit. */
export const update = mutation({
  args: {
    id: v.id("members"),
    fullName: v.optional(v.string()),
    gender: v.optional(v.union(v.literal("male"), v.literal("female"))),
    phone: v.optional(v.string()),
    whatsapp: v.optional(v.string()),
    email: v.optional(v.string()),
    klass: v.optional(v.string()),
    dateJoined: v.optional(v.string()),
    area: v.optional(v.string()),
    classLeader: v.optional(v.string()),
    ministryRoles: v.optional(v.string()),
    occupation: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("inactive"))),
    position: v.optional(v.string()),
    isClassLeader: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await checkRateLimit(ctx, "members.update");
    const user = await requireRole(ctx, []);
    if (args.fullName) args.fullName = validateName(args.fullName);
    if (args.email) args.email = validateEmail(args.email);
    if (args.phone) args.phone = validatePhone(args.phone);
    const isAdminCaller = hasRole(user, ROLES.ADMIN);
    const { id, ...data } = args;
    const member = await ctx.db.get(id);
    if (!member) throw new ConvexError("Member not found");
    const cleaned: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(data)) {
      if (val !== undefined) cleaned[k] = val;
    }
    // Only administrators may change positions / class leadership on a member.
    if (!isAdminCaller) {
      delete cleaned.classLeader;
      delete cleaned.isClassLeader;
      delete cleaned.position;
    } else if (cleaned.position !== undefined || cleaned.isClassLeader !== undefined) {
      const pos = (cleaned.position as string | undefined) ?? member.position;
      const requestedCL =
        cleaned.isClassLeader !== undefined
          ? !!cleaned.isClassLeader
          : !!member.isClassLeader;
      const normalized = normalizePosition(pos, requestedCL);
      cleaned.position = normalized.position;
      cleaned.isClassLeader = normalized.isClassLeader;
    }
    await ctx.db.patch(id, cleaned);

    // The member's ministry position is the source of truth for system roles:
    // keep the linked user account's roles + access scope in sync whenever the
    // position, class-leader flag or class changes. Respects manual overrides.
    if (cleaned.position !== undefined || cleaned.isClassLeader !== undefined || cleaned.klass !== undefined) {
      const linkedUser = (await ctx.db.query("users").collect()).find(
        (u) => u.memberId === id,
      );
      if (linkedUser && !linkedUser.rolesOverridden) {
        const updated = await ctx.db.get(id);
        if (updated) {
          const roles = deriveMemberRoles(updated.position, updated.isClassLeader);
          const classScope = deriveMemberClassScope(
            updated.position,
            updated.isClassLeader,
            updated.klass,
          );
          await ctx.db.patch(linkedUser._id, {
            roles: roles.length ? roles : undefined,
            role: roles[0] as Role,
            classScope,
          });
        }
      }
    }

    await logAudit(ctx, {
      action: "member.update",
      entityType: "members",
      entityId: id,
      details: member.fullName,
    });


  },
});

/** Permanently delete a member and every record attached to it. Admin only. */
export const remove = mutation({
  args: { id: v.id("members") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, []);
    const member = await ctx.db.get(args.id);
    if (!member) throw new ConvexError("Member not found");

    // Clear every record attached to this member: attendance, prayer requests
    // and notes.
    for (const table of ["attendance", "prayerRequests", "notes"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("memberId", (q) => q.eq("memberId", args.id))
        .collect();
      for (const row of rows) {
        await ctx.db.delete(row._id);
      }
    }
    // If this member was promoted from a contact, keep the contact record but
    // break the link so it no longer points at a deleted member.
    if (member.sourceContactId) {
      await ctx.db.patch(member.sourceContactId, { promotedToMemberId: undefined });
    }
    // Unlink any user account linked to this member. The account's roles were
    // derived from the member's ministry position, so clear them too unless an
    // administrator explicitly overrode them.
    const linked = (await ctx.db.query("users").collect()).find(
      (u) => u.memberId === args.id,
    );
    if (linked) {
      const patch: Record<string, unknown> = { memberId: undefined };
      if (!linked.rolesOverridden) {
        patch.roles = undefined;
        patch.role = undefined;
        patch.classScope = undefined;
      }
      await ctx.db.patch(linked._id, patch);
    }
    await ctx.db.delete(args.id);
    await logAudit(ctx, {
      action: "member.delete",
      entityType: "members",
      entityId: args.id,
      details: `${member.fullName} (${member.membershipId}) — permanently deleted with all records`,
    });

  },
});

/** Class leaders from the Member Directory — the ministry-position source of
 *  truth. Includes members who don't have a login account yet (they appear with
 *  hasAccount: false and inherit permissions the moment an account is linked).
 */
export const classLeaders = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!canReadMinistry(user)) return [];
    let members = (await ctx.db.query("members").collect()).filter((m) => !m.isDeleted);
    const scope = classScoped(user);
    if (scope) members = members.filter((m) => m.klass === scope);
    const users = await ctx.db.query("users").collect();
    const userByMember = new Map(
      users.filter((u) => u.memberId).map((u) => [u.memberId, u]),
    );
    return members
      .filter((m) => {
        const pos = effectivePosition(m.position, m.isClassLeader);
        return (
          pos === POSITIONS.CLASS_LEADER ||
          ((pos === POSITIONS.ADMIN || pos === POSITIONS.COORDINATOR) && !!m.isClassLeader)
        );
      })
      .map((m) => {
        const account = userByMember.get(m._id);
        return {
          _id: m._id,
          name: m.fullName,
          klass: m.klass,
          membershipId: m.membershipId,
          hasAccount: !!account,
          linkedUserId: account?._id,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Per-class attendance dashboard stats. */
export const classStats = query({
  args: { klass: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!canReadMinistry(user)) return [];
    const scope = classScoped(user);
    const klassNames = scope ? [scope] : CLASS_OPTIONS;
    const members = (await ctx.db.query("members").collect()).filter((m) => !m.isDeleted);
    const attendance = await ctx.db.query("attendance").collect();
    const memberRows = attendance.filter((a) => a.subjectType === "member");

    return klassNames.map((klassName) => {
      if (args.klass && args.klass !== klassName) return null;
      const classMembers = members.filter((m) => m.klass === klassName);
      const ids = new Set(classMembers.map((m) => m._id));
      const rows = memberRows.filter((r) => r.memberId && ids.has(r.memberId));
      const present = rows.filter((r) => r.status === "present").length;
      const total = rows.length;
      const percentage = total === 0 ? 0 : Math.round((present / total) * 100);

      // monthly trend (last 3 months)
      const now = new Date();
      const months: { month: string; percentage: number }[] = [];
      for (let i = 2; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = d.toISOString().slice(0, 7);
        const monthRows = rows.filter((r) => r.date.startsWith(key));
        const monthPresent = monthRows.filter((r) => r.status === "present").length;
        months.push({
          month: d.toLocaleString("en", { month: "short" }),
          percentage:
            monthRows.length === 0 ? 0 : Math.round((monthPresent / monthRows.length) * 100),
        });
      }
      return {
        klass: klassName,
        totalMembers: classMembers.length,
        activeMembers: classMembers.filter((m) => m.status !== "inactive").length,
        presentToday: rows.filter(
          (r) => r.date === new Date().toISOString().slice(0, 10) && r.status === "present",
        ).length,
        absentToday: rows.filter(
          (r) => r.date === new Date().toISOString().slice(0, 10) && r.status === "absent",
        ).length,
        percentage,
        trend: months,
      };
    }).filter(Boolean);
  },
});

/**
 * Punctuality per class — the roster answers "who is late?", the team card
 * answers "how are we doing?", and this answers "which class is drifting?".
 *
 * Each class is measured over its own members' arrivals, judged against the same
 * session start times the member and team readings use (the configured activity
 * time, or that session's first arrival), so the three can never disagree.
 * Classes with nothing timed are returned too: an unmeasured class is a fact a
 * leader needs, not something to hide.
 */
export const classPunctuality = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!canReadMinistry(user)) return [];
    const scope = classScoped(user);
    const klassNames = scope ? [scope] : CLASS_OPTIONS;
    const members = (await ctx.db.query("members").collect()).filter((m) => !m.isDeleted);
    const attendance = await ctx.db.query("attendance").collect();
    const memberRows = attendance.filter((a) => a.subjectType === "member");
    const startTimeRow = await ctx.db
      .query("settings")
      .withIndex("key", (q) => q.eq("key", "attendance_start_times"))
      .first();
    const startTimes = parseStartTimes(startTimeRow?.value);
    // Session begins come from the whole ministry's arrivals (contacts and
    // members alike), so a class is judged against when the session really began.
    const starts = sessionStarts(attendance, startTimes);

    return klassNames
      .map((klassName) => {
        const classMembers = members.filter((m) => m.klass === klassName);
        const ids = new Set(classMembers.map((m) => m._id));
        const rows = memberRows.filter((r) => r.memberId && ids.has(r.memberId));
        const present = rows.filter((r) => r.status === "present").length;
        return {
          klass: klassName,
          members: classMembers.length,
          records: rows.length,
          rate: rows.length === 0 ? 0 : Math.round((present / rows.length) * 100),
          summary: punctualitySummary(rows, starts, startTimes),
          verdictCounts: punctualityVerdictCounts(
            classMembers.map((m) =>
              punctualitySummary(
                rows.filter((r) => r.memberId === m._id),
                starts,
                startTimes,
              ),
            ),
          ),
        };
      })
      .filter((r) => r.members > 0)
      .sort((a, b) => {
        // Measured classes first, weakest punctuality on top. A class with no
        // arrival times can't be ranked, so it sits at the bottom.
        const aTimed = a.summary.timed > 0;
        const bTimed = b.summary.timed > 0;
        if (aTimed !== bTimed) return aTimed ? -1 : 1;
        const aRate = aTimed ? a.summary.onTime / a.summary.timed : 0;
        const bRate = bTimed ? b.summary.onTime / b.summary.timed : 0;
        return aRate - bRate || a.klass.localeCompare(b.klass);
      });
  },
});

/** Members needing follow-up due to low attendance. */
export const lowAttendance = query({
  args: {},
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!canReadMinistry(user)) return [];
    const scope = classScoped(user);
    const members = (await ctx.db.query("members").collect()).filter(
      (m) => !m.isDeleted && (!scope || m.klass === scope),
    );
    const attendance = await ctx.db.query("attendance").collect();
    const now = new Date();
    const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    return members
      .map((m) => {
        const rows = attendance.filter(
          (a) => a.memberId === m._id && a.date >= fourWeeksAgo,
        );
        const youthRows = rows.filter((a) => a.type === "youthMeeting");
        return { member: m, youthMeetingCount: youthRows.length, recentCount: rows.length };
      })
      .filter((r) => {
        // A follow-up recorded within the last 4 weeks clears the alert; it
        // reappears only if the member still doesn't attend for another 4 weeks.
        const fu = r.member.attendanceFollowup;
        if (fu && fu.date >= fourWeeksAgo) return false;
        return r.youthMeetingCount === 0 || (r.recentCount > 0 && r.recentCount < 2);
      })
      .sort((a, b) => a.youthMeetingCount - b.youthMeetingCount);
  },
});

/** Record the outcome of a low-attendance follow-up and clear the alert. */
export const markAttendanceFollowup = mutation({
  args: {
    memberId: v.id("members"),
    outcome: v.string(),
    by: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [
      ROLES.COORDINATOR,
      ROLES.WORKER,
      ROLES.CLASS_LEADER,
    ]);
    const member = await ctx.db.get(args.memberId);
    if (!member || member.isDeleted) throw new ConvexError("Member not found");
    if (!args.outcome.trim()) throw new ConvexError("Outcome is required");
    const now = nowIso();
    await ctx.db.patch(args.memberId, {
      attendanceFollowup: {
        date: now.slice(0, 10),
        outcome: args.outcome.trim(),
        by: args.by?.trim() || user.name || user.email || "",
      },
    });
    await logAudit(ctx, {
      action: "member.attendanceFollowup",
      entityType: "members",
      entityId: args.memberId,
      details: `${member.fullName}: ${args.outcome.trim()}`,
    });
  },
});
