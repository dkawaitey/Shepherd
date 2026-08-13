import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { CLASS_OPTIONS, ROLES } from "./constants";
import { nextMembershipId } from "./contacts";
import { getCurrentUser, hasRole, logAudit, nowIso, requireRole, classScoped } from "./helpers";

/** Derive a 2-letter area code from the area name (same rule as contacts). */
const deriveShortcut = (area?: string) =>
  (area || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

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
    const attendance = await ctx.db
      .query("attendance")
      .withIndex("memberId", (q) => q.eq("memberId", args.id))
      .collect();
    return { member, attendance: attendance.sort((a, b) => b.date.localeCompare(a.date)) };
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
    isClassLeader: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [ROLES.CLASS_LEADER]);
    // Only administrators may assign the class leader on a member record.
    const classLeader = hasRole(user, ROLES.ADMIN) ? args.classLeader : undefined;
    const isClassLeader = hasRole(user, ROLES.ADMIN) ? !!args.isClassLeader : false;
    const klass = args.klass || CLASS_OPTIONS[0];
    // Same ID format as contacts (AREA-DDMM-YYYY-SEQ) so promoted contacts
    // keep a consistent, non-class-based identifier. Shares the counter with
    // contacts, so sequences never collide across the two tables.
    const dateJoined = args.dateJoined || nowIso();
    const shortcut = (args.areaShortcut || deriveShortcut(args.area) || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 2);
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
    isClassLeader: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, []);
    const { id, ...data } = args;
    const member = await ctx.db.get(id);
    if (!member) throw new Error("Member not found");
    const cleaned: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(data)) {
      if (val !== undefined) cleaned[k] = val;
    }
    // Only administrators may change the class leader on a member record.
    if (!hasRole(user, ROLES.ADMIN)) {
      delete cleaned.classLeader;
      delete cleaned.isClassLeader;
    }
    await ctx.db.patch(id, cleaned);
    await logAudit(ctx, {
      action: "member.update",
      entityType: "members",
      entityId: id,
      details: member.fullName,
    });
  },
});

/** Admin-only delete (soft). */
export const remove = mutation({
  args: { id: v.id("members") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, []);
    const member = await ctx.db.get(args.id);
    if (!member) throw new Error("Member not found");
    await ctx.db.patch(args.id, { isDeleted: true, updatedAt: Date.now() });
    await logAudit(ctx, {
      action: "member.delete",
      entityType: "members",
      entityId: args.id,
      details: member.fullName,
    });
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
      .filter((r) => r.youthMeetingCount === 0 || (r.recentCount > 0 && r.recentCount < 2))
      .sort((a, b) => a.youthMeetingCount - b.youthMeetingCount);
  },
});
