import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
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
import { getCurrentUser, hasRole, logAudit, nowIso, requireRole, classScoped } from "./helpers";

/** Validate + normalize a member's position / class-leader flag (admin-only
 *  values). Prevents contradictory combinations, e.g. Read-only Leader + Class
 *  Leader, or Ordinary Member holding class leadership. */
const normalizePosition = (
  position: string | undefined,
  requestedClassLeader: boolean,
) => {
  const pos = position?.trim() || undefined;
  if (pos && !POSITION_OPTIONS.includes(pos as (typeof POSITION_OPTIONS)[number])) {
    throw new Error("Invalid ministry position");
  }
  if (pos === POSITIONS.LEADER && requestedClassLeader) {
    throw new Error("A Read-only Leader cannot also be a Class Leader");
  }
  if (
    requestedClassLeader &&
    pos &&
    pos !== POSITIONS.CLASS_LEADER &&
    pos !== POSITIONS.ADMIN &&
    pos !== POSITIONS.COORDINATOR
  ) {
    throw new Error(
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

/** Members list, filterable by class / status / search. View-only for non-admins. */
export const list = query({
  args: {
    klass: v.optional(v.string()),
    status: v.optional(v.string()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    let members = await ctx.db.query("members").collect();
    members = members.filter((m) => !m.isDeleted);
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

    // Attendance summary per member
    const attendance = await ctx.db.query("attendance").collect();
    return members.map((m) => {
      const rows = attendance.filter((a) => a.memberId === m._id);
      return { ...m, attendanceCount: rows.length };
    });
  },
});

/** Member profile with attendance history + summary percentages. */
export const get = query({
  args: { id: v.id("members") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const member = await ctx.db.get(args.id);
    if (!member || member.isDeleted) return null;
    const [attendance, prayers, notes] = await Promise.all([
      ctx.db.query("attendance").withIndex("memberId", (q) => q.eq("memberId", args.id)).collect(),
      ctx.db.query("prayerRequests").withIndex("memberId", (q) => q.eq("memberId", args.id)).collect(),
      ctx.db.query("notes").withIndex("memberId", (q) => q.eq("memberId", args.id)).collect(),
    ]);
    return {
      member,
      attendance: attendance.sort((a, b) => b.date.localeCompare(a.date)),
      prayers: prayers.sort((a, b) => b.createdAt - a.createdAt),
      notes: notes.sort((a, b) => b.createdAt - a.createdAt),
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
    const user = await requireRole(ctx, [ROLES.CLASS_LEADER]);
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

    // One-way sync: push member to App B (Steward).
    await ctx.scheduler.runAfter(0, internal.sync.pushMemberToAppB, {
      sourceId: id,
      name: args.fullName,
      email: args.email ?? "",
      role: (position as string) || null,
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
    const user = await requireRole(ctx, []);
    const isAdminCaller = hasRole(user, ROLES.ADMIN);
    const { id, ...data } = args;
    const member = await ctx.db.get(id);
    if (!member) throw new Error("Member not found");
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

    // One-way sync: push updated member to App B (Steward).
    const updated = await ctx.db.get(id);
    if (updated) {
      await ctx.scheduler.runAfter(0, internal.sync.pushMemberToAppB, {
        sourceId: id,
        name: updated.fullName,
        email: updated.email ?? "",
        role: (updated.position as string) || null,
      });
    }
  },
});

/** Permanently delete a member and every record attached to it. Admin only. */
export const remove = mutation({
  args: { id: v.id("members") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, []);
    const member = await ctx.db.get(args.id);
    if (!member) throw new Error("Member not found");

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

    // One-way sync: tell App B (Steward) to delete its copy.
    await ctx.scheduler.runAfter(0, internal.sync.pushMemberDeleteToAppB, {
      sourceId: args.id,
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
    await requireRole(ctx, [ROLES.COORDINATOR, ROLES.CLASS_LEADER]);
    const members = (await ctx.db.query("members").collect()).filter((m) => !m.isDeleted);
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

/** Members needing follow-up due to low attendance. */
export const lowAttendance = query({
  args: {},
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
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
    if (!member || member.isDeleted) throw new Error("Member not found");
    if (!args.outcome.trim()) throw new Error("Outcome is required");
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
