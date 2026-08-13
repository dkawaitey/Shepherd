import { v } from "convex/values";
import { mutation, query, MutationCtx } from "./_generated/server";
import { STAGE_ORDER, STAGES, STAGE_LABELS, ROLES } from "./constants";
import { getCurrentUser, logAudit, nowIso, requireRole, hasRole, classScoped, assertClassScope } from "./helpers";

const contactFields = {
  fullName: v.string(),
  gender: v.optional(v.union(v.literal("male"), v.literal("female"))),
  dateOfBirth: v.optional(v.string()),
  phone: v.optional(v.string()),
  whatsapp: v.optional(v.string()),
  email: v.optional(v.string()),
  homeAddress: v.optional(v.string()),
  landmark: v.optional(v.string()),
  gpsLocation: v.optional(v.string()),
  region: v.optional(v.string()),
  district: v.optional(v.string()),
  community: v.optional(v.string()),
  occupation: v.optional(v.string()),
  school: v.optional(v.string()),
  maritalStatus: v.optional(v.string()),
  emergencyContact: v.optional(v.string()),
  preferredLanguage: v.optional(v.string()),
  religion: v.optional(v.string()),
  churchBackground: v.optional(v.string()),
  area: v.optional(v.string()),
  areaShortcut: v.optional(v.string()),
  dateMet: v.optional(v.string()),
  locationMet: v.optional(v.string()),
  evangelismTeam: v.optional(v.string()),
  klass: v.optional(v.string()),
  street: v.optional(v.string()),
  event: v.optional(v.string()),
  conversationSummary: v.optional(v.string()),
  questionsAsked: v.optional(v.string()),
  needsIdentified: v.optional(v.string()),
  prayerOffered: v.optional(v.boolean()),
  outreachPrayerRequests: v.optional(v.string()),
  bibleVersesShared: v.optional(v.string()),
  gospelShared: v.optional(v.boolean()),
  decision: v.optional(v.string()),
  interestLevel: v.optional(
    v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("veryHigh"),
    ),
  ),
  assignedWorker: v.optional(v.string()),
  assignedWorkerId: v.optional(v.id("users")),
  mentor: v.optional(v.string()),
  ministry: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
};

/** Generate next membership ID: AREA-DDMM-YYYY-SEQ (seq per area + day). */
export const nextMembershipId = async (
  ctx: MutationCtx,
  shortcut: string,
  dateMet: string,
) => {
  const areaCode = (shortcut || "GN").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 2) || "GN";
  const d = new Date(dateMet || Date.now());
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const counterName = `mid:${areaCode}:${dd}${mm}:${yyyy}`;
  const existing = await ctx.db.query("counters").withIndex("name", (q) => q.eq("name", counterName)).first();
  const seq = (existing?.value ?? 0) + 1;
  if (existing) {
    await ctx.db.patch(existing._id, { name: counterName, value: seq });
  } else {
    await ctx.db.insert("counters", { name: counterName, value: seq });
  }
  return `${areaCode}-${dd}${mm}-${yyyy}-${String(seq).padStart(3, "0")}`;
};

export const defaultStageForDecision = (decision?: string) => {
  if (decision === "acceptedChrist") return STAGES.ACCEPTED_CHRIST;
  if (decision === "wantsInfo") return STAGES.INTERESTED;
  if (decision === "alreadyChristian") return STAGES.REACHED;
  return STAGES.REACHED;
};

/** List contacts with filters + search. Any signed-in user can view all contacts. */
export const list = query({
  args: {
    status: v.optional(v.string()),
    search: v.optional(v.string()),
    klass: v.optional(v.string()),
    worker: v.optional(v.string()),
    decision: v.optional(v.string()),
    gender: v.optional(v.string()),
    interestLevel: v.optional(v.string()),
    includeDeleted: v.optional(v.boolean()),
    sort: v.optional(v.string()), // newest | oldest | name
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    let contacts = await ctx.db.query("contacts").collect();
    contacts = contacts.filter((c) => !c.isDeleted);

    const q = (args.search || "").toLowerCase().trim();
    if (q) {
      contacts = contacts.filter((c) =>
        [c.fullName, c.phone, c.whatsapp, c.email, c.membershipId, c.community, c.area, c.occupation]
          .filter(Boolean)
          .some((f) => f!.toLowerCase().includes(q)),
      );
    }
    if (args.status) contacts = contacts.filter((c) => c.status === args.status);
    if (args.klass) contacts = contacts.filter((c) => c.klass === args.klass);
    if (args.worker) contacts = contacts.filter((c) => c.assignedWorker === args.worker);
    if (args.decision) contacts = contacts.filter((c) => c.decision === args.decision);
    if (args.gender) contacts = contacts.filter((c) => c.gender === args.gender);
    if (args.interestLevel) contacts = contacts.filter((c) => c.interestLevel === args.interestLevel);

    contacts.sort((a, b) => {
      if (args.sort === "name") return a.fullName.localeCompare(b.fullName);
      if (args.sort === "oldest") return a.createdAt - b.createdAt;
      return b.createdAt - a.createdAt;
    });

    return contacts.map((c) => ({
      ...c,
      age: c.dateOfBirth ? calcAge(c.dateOfBirth) : undefined,
    }));
  },
});

export const calcAge = (dob: string) => {
  const d = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
};

/** Full profile: contact + timeline + follow-ups + bible studies + attendance + prayers + notes. */
export const get = query({
  args: { id: v.id("contacts") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const contact = await ctx.db.get(args.id);
    if (!contact || contact.isDeleted) return null;

    const [journeyEvents, followUps, bibleStudies, attendance, prayers, notes] =
      await Promise.all([
        ctx.db.query("journeyEvents").withIndex("contactId", (q) => q.eq("contactId", args.id)).collect(),
        ctx.db.query("followUps").withIndex("contactId", (q) => q.eq("contactId", args.id)).collect(),
        ctx.db.query("bibleStudies").withIndex("contactId", (q) => q.eq("contactId", args.id)).collect(),
        ctx.db.query("attendance").withIndex("contactId", (q) => q.eq("contactId", args.id)).collect(),
        ctx.db.query("prayerRequests").withIndex("contactId", (q) => q.eq("contactId", args.id)).collect(),
        ctx.db.query("notes").withIndex("contactId", (q) => q.eq("contactId", args.id)).collect(),
      ]);

    return {
      contact: { ...contact, age: contact.dateOfBirth ? calcAge(contact.dateOfBirth) : undefined },
      journeyEvents: journeyEvents.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt),
      followUps: followUps
        .filter((f) => !f.isDeleted)
        .sort((a, b) => b.date.localeCompare(a.date)),
      bibleStudies: bibleStudies.sort((a, b) => a.lesson - b.lesson),
      attendance: attendance.sort((a, b) => b.date.localeCompare(a.date)),
      prayers: prayers.sort((a, b) => b.createdAt - a.createdAt),
      notes: notes.sort((a, b) => b.createdAt - a.createdAt),
    };
  },
});

/** Create a contact from an outreach record. Generates the membership ID automatically. */
export const create = mutation({
  args: { ...contactFields, dateMetRequired: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [ROLES.CLASS_LEADER]);
    const { dateMetRequired: _unused, ...data } = args;
    const scope = classScoped(user);
    if (scope) data.klass = scope; // class leaders can only create within their own class
    const dateMet = data.dateMet || nowIso();
    const membershipId = await nextMembershipId(ctx, data.areaShortcut || "", dateMet);

    const status = defaultStageForDecision(data.decision);

    const id = await ctx.db.insert("contacts", {
      ...data,
      membershipId,
      dateMet,
      status,
      isDeleted: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Auto journey event: met during outreach
    await ctx.db.insert("journeyEvents", {
      contactId: id,
      stage: STAGES.REACHED,
      label: STAGE_LABELS[STAGES.REACHED],
      date: dateMet.slice(0, 10),
      note: data.locationMet ? `Met at ${data.locationMet}` : undefined,
      worker: user.name ?? undefined,
      source: "auto",
      createdAt: Date.now(),
    });

    // Auto prayer request from outreach
    if (data.outreachPrayerRequests) {
      await ctx.db.insert("prayerRequests", {
        contactId: id,
        title: "Prayer request from outreach",
        summary: data.outreachPrayerRequests,
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    await logAudit(ctx, {
      action: "contact.create",
      entityType: "contacts",
      entityId: id,
      details: `${data.fullName} (${membershipId})`,
    });
    return { _id: id, membershipId };
  },
});

/** Quick add — name + phone only, best effort for volunteers. */
export const quickAdd = mutation({
  args: {
    fullName: v.string(),
    phone: v.optional(v.string()),
    whatsapp: v.optional(v.string()),
    community: v.optional(v.string()),
    klass: v.optional(v.string()),
    decision: v.optional(v.string()),
    area: v.optional(v.string()),
    areaShortcut: v.optional(v.string()),
    dateMet: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [ROLES.CLASS_LEADER]);
    const scope = classScoped(user);
    if (scope) {
      args.klass = scope; // class leaders can only create within their own class
    }
    const dateMet = args.dateMet || nowIso();
    const membershipId = await nextMembershipId(ctx, args.areaShortcut || "", dateMet);
    const id = await ctx.db.insert("contacts", {
      fullName: args.fullName,
      phone: args.phone,
      whatsapp: args.whatsapp,
      community: args.community,
      klass: args.klass,
      decision: args.decision,
      area: args.area,
      areaShortcut: args.areaShortcut,
      dateMet,
      membershipId,
      status: defaultStageForDecision(args.decision),
      isDeleted: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("journeyEvents", {
      contactId: id,
      stage: STAGES.REACHED,
      label: STAGE_LABELS[STAGES.REACHED],
      date: dateMet.slice(0, 10),
      worker: user.name ?? undefined,
      source: "auto",
      createdAt: Date.now(),
    });
    await logAudit(ctx, {
      action: "contact.quickAdd",
      entityType: "contacts",
      entityId: id,
      details: args.fullName,
    });
    return { _id: id, membershipId };
  },
});

/** Update contact fields. Admins + coordinators; workers only their own assigned. */
export const update = mutation({
  args: { id: v.id("contacts"), ...contactFields },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [ROLES.CLASS_LEADER]);
    const { id, ...data } = args;
    const existing = await ctx.db.get(id);
    if (!existing || existing.isDeleted) throw new Error("Contact not found");
    assertClassScope(user, existing.klass);
    if (hasRole(user, ROLES.WORKER) && existing.assignedWorkerId !== user._id) {
      throw new Error("You can only edit contacts assigned to you");
    }
    const scope = classScoped(user);
    if (scope) data.klass = scope; // a class leader cannot move a contact out of their class
    await ctx.db.patch(id, { ...data, updatedAt: Date.now() });
    await logAudit(ctx, {
      action: "contact.update",
      entityType: "contacts",
      entityId: id,
      details: existing.fullName,
    });
  },
});

/** Soft delete a contact. Admin only (incl. outreach record cleanup). */
export const remove = mutation({
  args: { id: v.id("contacts") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, []);
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Contact not found");
    await ctx.db.patch(args.id, { isDeleted: true, updatedAt: Date.now() });
    await logAudit(ctx, {
      action: "contact.delete",
      entityType: "contacts",
      entityId: args.id,
      details: existing.fullName,
    });
  },
});

/** Manually advance (or set) a contact's spiritual journey stage. */
export const setStage = mutation({
  args: {
    id: v.id("contacts"),
    stage: v.string(),
    date: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [ROLES.CLASS_LEADER]);
    const contact = await ctx.db.get(args.id);
    if (!contact) throw new Error("Contact not found");
    assertClassScope(user, contact.klass);
    if (!STAGE_ORDER.includes(args.stage as any)) throw new Error("Invalid stage");
    const stage = args.stage as (typeof STAGE_ORDER)[number];
    const date = (args.date || nowIso()).slice(0, 10);
    const wasBaptized = contact.status !== STAGES.BAPTIZED && stage === STAGES.BAPTIZED;
    const wasJoined = contact.status !== STAGES.JOINED_CHURCH && stage === STAGES.JOINED_CHURCH;

    await ctx.db.patch(args.id, { status: stage, updatedAt: Date.now() });
    await ctx.db.insert("journeyEvents", {
      contactId: args.id,
      stage,
      label: STAGE_LABELS[stage],
      date,
      note: args.note,
      worker: user.name ?? undefined,
      source: "manual",
      createdAt: Date.now(),
    });

    // Baptism record -> attendance entry of type specialProgram? No: log detail in note.
    if (wasBaptized) {
      await ctx.db.insert("attendance", {
        subjectType: "contact",
        contactId: args.id,
        date,
        type: "specialProgram",
        programName: "Baptism Service",
        status: "present",
        recordedBy: user.name,
        createdAt: Date.now(),
      });
    }
    if (wasJoined) {
      await ctx.db.insert("journeyEvents", {
        contactId: args.id,
        stage: STAGES.JOINED_CHURCH,
        label: "Joined Church",
        date,
        worker: user.name ?? undefined,
        source: "auto",
        createdAt: Date.now(),
      });
    }
    await logAudit(ctx, {
      action: "contact.stage",
      entityType: "contacts",
      entityId: args.id,
      details: `${contact.fullName}: ${STAGE_LABELS[stage]}`,
    });
  },
});

/** Manual timeline event (e.g. "Second Visit" or a milestone). */
export const addJourneyEvent = mutation({
  args: {
    id: v.id("contacts"),
    stage: v.string(),
    label: v.string(),
    date: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [ROLES.CLASS_LEADER]);
    const contact = await ctx.db.get(args.id);
    if (!contact) throw new Error("Contact not found");
    assertClassScope(user, contact.klass);
    await ctx.db.insert("journeyEvents", {
      contactId: args.id,
      stage: args.stage || contact.status || STAGES.REACHED,
      label: args.label,
      date: (args.date || nowIso()).slice(0, 10),
      note: args.note,
      worker: user.name ?? undefined,
      source: "manual",
      createdAt: Date.now(),
    });
    await logAudit(ctx, {
      action: "journey.addEvent",
      entityType: "contacts",
      entityId: args.id,
      details: `${contact.fullName}: ${args.label}`,
    });
  },
});

/** Duplicate detection by name + phone. */
export const findDuplicates = query({
  args: { fullName: v.optional(v.string()), phone: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, [ROLES.COORDINATOR, ROLES.WORKER, ROLES.CLASS_LEADER]);
    const all = await ctx.db.query("contacts").collect();
    const live = all.filter((c) => !c.isDeleted);
    const name = (args.fullName || "").toLowerCase().trim();
    const phone = (args.phone || "").replace(/[^0-9]/g, "");
    if (!name && !phone) return [];
    return live.filter((c) => {
      const nMatch = name && c.fullName.toLowerCase().includes(name);
      const pMatch = phone && (c.phone || "").replace(/[^0-9]/g, "") === phone;
      return nMatch || pMatch;
    });
  },
});

/** Merge a duplicate contact into the primary one. Admin only. */
export const merge = mutation({
  args: { primaryId: v.id("contacts"), duplicateId: v.id("contacts") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, []);
    if (args.primaryId === args.duplicateId) throw new Error("Cannot merge a contact with itself");
    const primary = await ctx.db.get(args.primaryId);
    const dup = await ctx.db.get(args.duplicateId);
    if (!primary || !dup) throw new Error("Contact not found");

    // Re-point all related records to the primary contact
    for (const table of ["journeyEvents", "followUps", "bibleStudies", "attendance", "prayerRequests", "notes"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("contactId", (q) => q.eq("contactId", args.duplicateId))
        .collect();
      for (const row of rows) {
        await ctx.db.patch(row._id, { contactId: args.primaryId });
      }
    }
    await ctx.db.patch(dup._id, { isDeleted: true });
    await logAudit(ctx, {
      action: "contact.merge",
      entityType: "contacts",
      entityId: args.primaryId,
      details: `${dup.fullName} merged into ${primary.fullName}`,
    });
  },
});

/** Promote a contact to a Youth Ministry member. Creates a member record from
 *  the contact's data (same ID format as contacts) and marks the contact. */
export const promoteToMember = mutation({
  args: { id: v.id("contacts") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [ROLES.CLASS_LEADER]);
    const contact = await ctx.db.get(args.id);
    if (!contact || contact.isDeleted) throw new Error("Contact not found");
    assertClassScope(user, contact.klass);
    if (contact.promotedToMemberId) throw new Error("Contact already promoted");

    const dateJoined = nowIso();
    const derived = (contact.area || "")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("");
    const shortcut = (contact.areaShortcut || derived || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 2);
    const membershipId = await nextMembershipId(ctx, shortcut, dateJoined);
    const now = Date.now();
    const memberId = await ctx.db.insert("members", {
      fullName: contact.fullName,
      gender: contact.gender,
      phone: contact.phone,
      whatsapp: contact.whatsapp,
      email: contact.email,
      klass: contact.klass,
      area: contact.area,
      dateJoined,
      classLeader: contact.assignedWorker ?? contact.mentor,
      ministryRoles: contact.ministry,
      occupation: contact.occupation,
      status: "active",
      sourceContactId: args.id,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
      membershipId,
    });
    await ctx.db.patch(args.id, { promotedToMemberId: memberId, updatedAt: now });
    await logAudit(ctx, {
      action: "contact.promote",
      entityType: "contacts",
      entityId: args.id,
      details: `${contact.fullName} → member ${membershipId}`,
    });
    return { _id: memberId, membershipId };
  },
});

