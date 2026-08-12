import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { BIBLE_LESSONS, ROLES } from "./constants";
import { getCurrentUser, logAudit, nowIso, requireRole } from "./helpers";

// ================= Bible Studies =================

/** Get (or lazily default) bible studies for a contact — one row per lesson 1-8. */
export const bibleStudiesForContact = query({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("bibleStudies")
      .withIndex("contactId", (q) => q.eq("contactId", args.contactId))
      .collect();
    return BIBLE_LESSONS.map((lesson, i) => {
      const row = rows.find((r) => r.lesson === i + 1);
      return {
        lesson: i + 1,
        name: lesson,
        status: row?.status ?? "notStarted",
        instructor: row?.instructor,
        notes: row?.notes,
        instructorObservations: row?.instructorObservations,
        scriptureUsed: row?.scriptureUsed,
        questionsAskedByContact: row?.questionsAskedByContact,
        completedDate: row?.completedDate,
        _id: row?._id,
      };
    });
  },
});

/**
 * Record bible study progress. When a lesson is marked completed, the
 * completion form fields (observations, scripture, questions) are required
 * and tied to that contact.
 */
export const updateBibleStudy = mutation({
  args: {
    contactId: v.id("contacts"),
    lesson: v.number(),
    status: v.union(
      v.literal("notStarted"),
      v.literal("inProgress"),
      v.literal("completed"),
    ),
    instructor: v.optional(v.string()),
    notes: v.optional(v.string()),
    instructorObservations: v.optional(v.string()),
    scriptureUsed: v.optional(v.string()),
    questionsAskedByContact: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [ROLES.COORDINATOR, ROLES.WORKER]);
    if (args.lesson < 1 || args.lesson > BIBLE_LESSONS.length) {
      throw new Error("Invalid lesson number");
    }
    const contact = await ctx.db.get(args.contactId);
    if (!contact) throw new Error("Contact not found");

    if (args.status === "completed") {
      if (!args.instructorObservations?.trim()) {
        throw new Error("Instructor observations are required to complete a lesson");
      }
      if (!args.scriptureUsed?.trim()) {
        throw new Error("Scripture used is required to complete a lesson");
      }
    }

    const existing = await ctx.db
      .query("bibleStudies")
      .withIndex("contactId", (q) => q.eq("contactId", args.contactId))
      .filter((q) => q.eq(q.field("lesson"), args.lesson))
      .first();

    const data = {
      contactId: args.contactId,
      lesson: args.lesson,
      status: args.status,
      instructor: args.instructor,
      notes: args.notes,
      instructorObservations: args.instructorObservations,
      scriptureUsed: args.scriptureUsed,
      questionsAskedByContact: args.questionsAskedByContact,
      completedDate: args.status === "completed" ? nowIso().slice(0, 10) : undefined,
      createdAt: existing?.createdAt ?? Date.now(),
    };

    if (existing) {
      await ctx.db.replace(existing._id, data as any);
    } else {
      await ctx.db.insert("bibleStudies", data as any);
    }

    // Timeline automation: when a lesson is completed and the contact has not
    // yet reached Bible Study stage, advance them.
    if (args.status === "completed") {
      const done = await ctx.db
        .query("bibleStudies")
        .withIndex("contactId", (q) => q.eq("contactId", args.contactId))
        .collect();
      const completedLessons = done.filter((r) => r.status === "completed").length;
      await ctx.db.insert("journeyEvents", {
        contactId: args.contactId,
        stage: "bibleStudy",
        label: `Bible Study Completed — ${BIBLE_LESSONS[args.lesson - 1]}`,
        date: nowIso().slice(0, 10),
        note: `Lesson ${args.lesson} of ${BIBLE_LESSONS.length} (${completedLessons}/${BIBLE_LESSONS.length})`,
        worker: args.instructor ?? user.name,
        source: "auto",
        createdAt: Date.now(),
      });
      if (contact.status === "followupStarted" || contact.status === "interested") {
        await ctx.db.patch(args.contactId, { status: "bibleStudy" });
      }
    }

    await logAudit(ctx, {
      action: "bibleStudy.update",
      entityType: "bibleStudies",
      entityId: existing?._id ?? "",
      details: `${contact.fullName}: Lesson ${args.lesson} (${BIBLE_LESSONS[args.lesson - 1]}) -> ${args.status}`,
    });
  },
});

// ================= Attendance =================

export const recordAttendance = mutation({
  args: {
    subjectType: v.union(v.literal("contact"), v.literal("member")),
    contactId: v.optional(v.id("contacts")),
    memberId: v.optional(v.id("members")),
    date: v.string(),
    type: v.string(),
    programName: v.optional(v.string()),
    status: v.union(v.literal("present"), v.literal("absent"), v.literal("excused")),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [ROLES.COORDINATOR, ROLES.WORKER]);
    const id = await ctx.db.insert("attendance", {
      subjectType: args.subjectType,
      contactId: args.contactId,
      memberId: args.memberId,
      date: args.date,
      type: args.type as any,
      programName: args.programName,
      status: args.status,
      recordedBy: user.name,
      createdAt: Date.now(),
    });
    await logAudit(ctx, {
      action: "attendance.record",
      entityType: "attendance",
      entityId: id,
      details: `${args.subjectType} ${args.date} ${args.type} -> ${args.status}`,
    });
    return id;
  },
});

/** Upsert-style: replaces an existing attendance record for the same subject+date+type. */
export const setAttendance = mutation({
  args: {
    subjectType: v.union(v.literal("contact"), v.literal("member")),
    contactId: v.optional(v.id("contacts")),
    memberId: v.optional(v.id("members")),
    date: v.string(),
    type: v.string(),
    programName: v.optional(v.string()),
    status: v.union(v.literal("present"), v.literal("absent"), v.literal("excused")),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [ROLES.COORDINATOR, ROLES.WORKER]);
    const existing = await ctx.db
      .query("attendance")
      .filter((q) =>
        q.and(
          args.contactId ? q.eq(q.field("contactId"), args.contactId!) : q.eq(q.field("contactId"), undefined),
          args.memberId ? q.eq(q.field("memberId"), args.memberId!) : q.eq(q.field("memberId"), undefined),
          q.eq(q.field("date"), args.date),
          q.eq(q.field("type"), args.type),
        ),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        programName: args.programName,
        recordedBy: user.name,
      });
      return existing._id;
    }
    return await ctx.db.insert("attendance", {
      subjectType: args.subjectType,
      contactId: args.contactId,
      memberId: args.memberId,
      date: args.date,
      type: args.type as any,
      programName: args.programName,
      status: args.status,
      recordedBy: user.name,
      createdAt: Date.now(),
    });
  },
});

export const listAttendance = query({
  args: {
    contactId: v.optional(v.id("contacts")),
    memberId: v.optional(v.id("members")),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    type: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let rows = await ctx.db.query("attendance").collect();
    if (args.contactId) rows = rows.filter((r) => r.contactId === args.contactId);
    if (args.memberId) rows = rows.filter((r) => r.memberId === args.memberId);
    if (args.from) rows = rows.filter((r) => r.date >= args.from!);
    if (args.to) rows = rows.filter((r) => r.date <= args.to!);
    if (args.type) rows = rows.filter((r) => r.type === args.type);
    if (args.status) rows = rows.filter((r) => r.status === args.status);
    rows.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    return rows;
  },
});

// ================= Prayer Journal =================

export const addPrayer = mutation({
  args: {
    contactId: v.id("contacts"),
    title: v.string(),
    summary: v.string(),
    confidential: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [ROLES.COORDINATOR, ROLES.WORKER]);
    const contact = await ctx.db.get(args.contactId);
    if (!contact) throw new Error("Contact not found");
    const now = Date.now();
    const id = await ctx.db.insert("prayerRequests", {
      contactId: args.contactId,
      title: args.title,
      summary: args.summary,
      status: "active",
      confidential: args.confidential ?? false,
      createdAt: now,
      updatedAt: now,
    });
    await logAudit(ctx, {
      action: "prayer.add",
      entityType: "prayerRequests",
      entityId: id,
      details: contact.fullName,
    });
    return id;
  },
});

/** Mark answered / closed with an optional answer note. */
export const updatePrayerStatus = mutation({
  args: {
    id: v.id("prayerRequests"),
    status: v.union(v.literal("active"), v.literal("answered"), v.literal("closed")),
    answer: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [ROLES.COORDINATOR, ROLES.WORKER]);
    const p = await ctx.db.get(args.id);
    if (!p) throw new Error("Prayer request not found");
    if (args.status === "answered" && !args.answer?.trim()) {
      throw new Error("Describe how the prayer was answered");
    }
    await ctx.db.patch(args.id, {
      status: args.status,
      answer: args.answer,
      updatedAt: Date.now(),
    });
    await logAudit(ctx, {
      action: "prayer.update",
      entityType: "prayerRequests",
      entityId: args.id,
      details: `-> ${args.status}`,
    });
  },
});

/** Global prayer journal feed. */
export const prayerFeed = query({
  args: { status: v.optional(v.string()), search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    let prayers = await ctx.db.query("prayerRequests").collect();
    if (args.status) prayers = prayers.filter((p) => p.status === args.status);
    if (args.search) {
      const q = args.search.toLowerCase();
      const contacts = await ctx.db.query("contacts").collect();
      const ids = new Set(
        contacts
          .filter((c) => !c.isDeleted && (c.fullName.toLowerCase().includes(q) || c.phone?.includes(q)))
          .map((c) => c._id),
      );
      prayers = prayers.filter((p) => ids.has(p.contactId));
    }
    prayers.sort((a, b) => b.updatedAt - a.updatedAt);
    const contacts = await ctx.db.query("contacts").collect();
    const map = new Map(contacts.map((c) => [c._id, c]));
    return prayers.map((p) => ({
      ...p,
      contactName: map.get(p.contactId)?.fullName ?? "Unknown",
    }));
  },
});

// ================= Ministry Notes =================

export const addNote = mutation({
  args: {
    contactId: v.id("contacts"),
    type: v.union(v.literal("ministry"), v.literal("counselling"), v.literal("private")),
    content: v.string(),
    isPrivate: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [ROLES.COORDINATOR, ROLES.WORKER]);
    const contact = await ctx.db.get(args.contactId);
    if (!contact) throw new Error("Contact not found");
    const id = await ctx.db.insert("notes", {
      contactId: args.contactId,
      author: user.name,
      authorId: user._id,
      type: args.type,
      content: args.content,
      isPrivate: args.isPrivate ?? args.type === "private",
      createdAt: Date.now(),
    });
    await logAudit(ctx, {
      action: "note.add",
      entityType: "notes",
      entityId: id,
      details: contact.fullName,
    });
    return id;
  },
});
