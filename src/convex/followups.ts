import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  FOLLOWUP_STATUS,
  FOLLOWUP_TYPE_LABELS,
  STAGES,
  STAGE_LABELS,
  ROLES,
} from "./constants";
import {
  getCurrentUser,
  logAudit,
  nowIso,
  requireRole,
  hasRole,
  assertClassScope,
  classScoped,
  canReadMinistry,
} from "./helpers";
import { checkRateLimit } from "./rateLimit";

/** Scheduled time of day, 24h "HH:MM". */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** List follow-ups (optionally joined with contact name). Workers see their assigned contacts' follow-ups. */
export const list = query({
  args: {
    status: v.optional(v.string()),
    worker: v.optional(v.string()),
    contactId: v.optional(v.id("contacts")),
    search: v.optional(v.string()),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!canReadMinistry(user)) return [];

    let all = await ctx.db.query("followUps").collect();
    // Hard deletes: no isDeleted filter needed

    if (args.status) all = all.filter((f) => f.status === args.status);
    if (args.worker) all = all.filter((f) => f.assignedWorker === args.worker);
    if (args.contactId) all = all.filter((f) => f.contactId === args.contactId);
    if (args.from) all = all.filter((f) => f.date >= args.from!);
    if (args.to) all = all.filter((f) => f.date <= args.to!);
    if (args.search) {
      const q = args.search.toLowerCase();
      const ids = new Set(
        (
          await ctx.db.query("contacts").collect()
        )
          .filter(
            (c) =>
              c.fullName.toLowerCase().includes(q) ||
                c.membershipId.toLowerCase().includes(q),
          )
          .map((c) => c._id),
      );
      all = all.filter((f) => ids.has(f.contactId));
    }

    // A class leader only sees follow-ups for their own class.
    const contacts = await ctx.db.query("contacts").collect();
    const scope = classScoped(user);
    if (scope) {
      const inScope = new Set(
        contacts.filter((c) => c.klass === scope).map((c) => c._id),
      );
      all = all.filter((f) => inScope.has(f.contactId));
    }

    all.sort((a, b) => a.date.localeCompare(b.date));

    const contactMap = new Map(contacts.map((c) => [c._id, c]));
    return all.map((f) => ({
      ...f,
      contactName: contactMap.get(f.contactId)?.fullName ?? "Unknown",
      membershipId: contactMap.get(f.contactId)?.membershipId ?? "",
      contactStatus: contactMap.get(f.contactId)?.status,
    }));
  },
});

/** Schedule a follow-up. Status starts as Pending — no outcome is collected here. */
export const create = mutation({
  args: {
    contactId: v.id("contacts"),
    type: v.string(),
    date: v.string(),
    time: v.optional(v.string()),
    assignedWorker: v.optional(v.string()),
    notes: v.optional(v.string()),
    reminder: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await checkRateLimit(ctx, "followup.create");
    const user = await requireRole(ctx, [ROLES.COORDINATOR, ROLES.WORKER, ROLES.CLASS_LEADER]);
    const contact = await ctx.db.get(args.contactId);
    if (!contact) throw new ConvexError("Contact not found");
    assertClassScope(user, contact.klass);
    if (!FOLLOWUP_TYPE_LABELS[args.type]) throw new ConvexError("Invalid follow-up type");
    if (args.time && !TIME_RE.test(args.time)) throw new ConvexError("Invalid time");

    const id = await ctx.db.insert("followUps", {
      contactId: args.contactId,
      type: args.type as any,
      date: args.date,
      time: args.time,
      assignedWorker: args.assignedWorker,
      notes: args.notes,
      reminder: args.reminder ?? false,
      status: FOLLOWUP_STATUS.PENDING,
      locked: false,

      createdAt: Date.now(),
    });
    await logAudit(ctx, {
      action: "followup.create",
      entityType: "followUps",
      entityId: id,
      details: `${contact.fullName}: ${FOLLOWUP_TYPE_LABELS[args.type]} on ${args.date.slice(0, 10)}${args.time ? ` at ${args.time}` : ""}`,
    });

    // Fire-and-forget Customer.io event (never blocks or breaks the mutation).
    await ctx.scheduler.runAfter(0, internal.customerio.track, {
      identifier: contact.membershipId,
      event: "followup_scheduled",
      attributes: {
        fullName: contact.fullName,
        email: contact.email ?? "",
        phone: contact.phone ?? "",
        klass: contact.klass ?? "",
        status: contact.status ?? "",
      },
      data: {
        type: args.type,
        typeLabel: FOLLOWUP_TYPE_LABELS[args.type] ?? args.type,
        date: args.date.slice(0, 10),
        time: args.time ?? "",
        assignedWorker: args.assignedWorker ?? "",
      },
    });
    return id;
  },
});

/** Edit a pending follow-up (date/type/worker/notes). */
export const update = mutation({
  args: {
    id: v.id("followUps"),
    type: v.optional(v.string()),
    date: v.optional(v.string()),
    time: v.optional(v.string()),
    assignedWorker: v.optional(v.string()),
    notes: v.optional(v.string()),
    reminder: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [ROLES.COORDINATOR, ROLES.WORKER, ROLES.CLASS_LEADER]);
    const f = await ctx.db.get(args.id);
    if (!f) throw new ConvexError("Follow-up not found");
    if (f.status !== FOLLOWUP_STATUS.PENDING) {
      throw new ConvexError("Only pending follow-ups can be edited");
    }
    const fuContact = await ctx.db.get(f.contactId);
    assertClassScope(user, fuContact?.klass);
    const patch: Record<string, unknown> = {};
    if (args.type !== undefined) patch.type = args.type;
    if (args.date !== undefined) patch.date = args.date;
    if (args.time !== undefined) {
      if (args.time && !TIME_RE.test(args.time)) throw new ConvexError("Invalid time");
      patch.time = args.time;
    }
    if (args.assignedWorker !== undefined) patch.assignedWorker = args.assignedWorker;
    if (args.notes !== undefined) patch.notes = args.notes;
    if (args.reminder !== undefined) patch.reminder = args.reminder;
    await ctx.db.patch(args.id, patch);
    await logAudit(ctx, {
      action: "followup.update",
      entityType: "followUps",
      entityId: args.id,
    });
  },
});

/**
 * Change follow-up status: Pending -> Completed | Missed | Cancelled.
 * The outcome / reason field is REQUIRED (collected in a modal before submission).
 * After saving the status is locked; only admins may override.
 */
export const changeStatus = mutation({
  args: {
    id: v.id("followUps"),
    status: v.string(),
    outcome: v.optional(v.string()),
    reasonMissed: v.optional(v.string()),
    reasonCancelled: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [ROLES.COORDINATOR, ROLES.WORKER, ROLES.CLASS_LEADER]);
    const f = await ctx.db.get(args.id);
    if (!f) throw new ConvexError("Follow-up not found");
    const fuContact = await ctx.db.get(f.contactId);
    assertClassScope(user, fuContact?.klass);

    if (f.locked && !hasRole(user, ROLES.ADMIN)) {
      throw new ConvexError("This follow-up status is locked. Only an administrator can override it.");
    }

    const valid = [FOLLOWUP_STATUS.COMPLETED, FOLLOWUP_STATUS.MISSED, FOLLOWUP_STATUS.CANCELLED];
    if (!valid.includes(args.status as any)) throw new ConvexError("Invalid status transition");

    // Required-field validation — nothing is saved until this passes
    if (args.status === FOLLOWUP_STATUS.COMPLETED && !args.outcome?.trim()) {
      throw new ConvexError("The outcome of the follow-up is required");
    }
    if (args.status === FOLLOWUP_STATUS.MISSED && !args.reasonMissed?.trim()) {
      throw new ConvexError("The reason for missing is required");
    }
    if (args.status === FOLLOWUP_STATUS.CANCELLED && !args.reasonCancelled?.trim()) {
      throw new ConvexError("The reason for cancellation is required");
    }

    const contact = await ctx.db.get(f.contactId);
    const completedDate = nowIso();
    await ctx.db.patch(args.id, {
      status: args.status as any,
      outcome: args.outcome,
      reasonMissed: args.reasonMissed,
      reasonCancelled: args.reasonCancelled,
      completedDate,
      locked: true,
    });

    // Timeline automation on completion
    if (args.status === FOLLOWUP_STATUS.COMPLETED && contact) {
      const priorCompleted = await ctx.db
        .query("followUps")
        .withIndex("contactId", (q) => q.eq("contactId", f.contactId))
        .collect();
      const completedCount = priorCompleted.filter(
        (x) => x.status === FOLLOWUP_STATUS.COMPLETED && x._id !== f._id,
      ).length;

      const label =
        completedCount === 0
          ? "First Follow-up Completed"
          : `${FOLLOWUP_TYPE_LABELS[f.type]} Completed`;
      const stage =
        completedCount === 0 ? STAGES.FOLLOWUP_STARTED : contact.status;

      await ctx.db.insert("journeyEvents", {
        contactId: f.contactId,
        stage: (stage ?? STAGES.REACHED) as string,
        label,
        date: completedDate.slice(0, 10),
        note: args.outcome,
        worker: f.assignedWorker ?? user.name,
        source: "auto",
        createdAt: Date.now(),
      });

      // Advance contact stage on first completed follow-up
      if (completedCount === 0 && contact.status === STAGES.REACHED) {
        await ctx.db.patch(f.contactId, { status: STAGES.FOLLOWUP_STARTED });
      }
    }

    await logAudit(ctx, {
      action: `followup.${args.status}`,
      entityType: "followUps",
      entityId: args.id,
      details: `${contact?.fullName ?? ""}: ${FOLLOWUP_TYPE_LABELS[f.type]} -> ${args.status}`,
    });

    // Fire-and-forget Customer.io event (never blocks or breaks the mutation).
    if (contact) {
      await ctx.scheduler.runAfter(0, internal.customerio.track, {
        identifier: contact.membershipId,
        event: `followup_${args.status}`,
        attributes: {
          fullName: contact.fullName,
          email: contact.email ?? "",
          phone: contact.phone ?? "",
          klass: contact.klass ?? "",
          status: contact.status ?? "",
        },
        data: {
          type: f.type,
          typeLabel: FOLLOWUP_TYPE_LABELS[f.type] ?? f.type,
          outcome: args.outcome ?? args.reasonMissed ?? args.reasonCancelled ?? "",
          assignedWorker: f.assignedWorker ?? "",
        },
      });
    }
  },
});

/** Admin-only: override a locked follow-up status. */
export const adminOverride = mutation({
  args: { id: v.id("followUps"), status: v.string() },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, []);
    const f = await ctx.db.get(args.id);
    if (!f) throw new ConvexError("Follow-up not found");
    if (![FOLLOWUP_STATUS.PENDING, FOLLOWUP_STATUS.COMPLETED, FOLLOWUP_STATUS.MISSED, FOLLOWUP_STATUS.CANCELLED].includes(args.status as any)) {
      throw new ConvexError("Invalid status");
    }
    await ctx.db.patch(args.id, {
      status: args.status as any,
      locked: args.status === FOLLOWUP_STATUS.PENDING ? false : true,
    });
    await logAudit(ctx, {
      action: "followup.adminOverride",
      entityType: "followUps",
      entityId: args.id,
      details: `-> ${args.status}`,
    });
  },
});

/** Delete a scheduled follow-up (e.g. it was a mistake). Pending ones, or admin for any. */
export const remove = mutation({
  args: { id: v.id("followUps") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [ROLES.COORDINATOR, ROLES.WORKER, ROLES.CLASS_LEADER]);
    const f = await ctx.db.get(args.id);
    if (!f) throw new ConvexError("Follow-up not found");
    const fuContact = await ctx.db.get(f.contactId);
    assertClassScope(user, fuContact?.klass);
    if (f.status !== FOLLOWUP_STATUS.PENDING && !hasRole(user, ROLES.ADMIN)) {
      throw new ConvexError("Only pending follow-ups can be deleted");
    }
    await ctx.db.delete(args.id);
    await logAudit(ctx, {
      action: "followup.delete",
      entityType: "followUps",
      entityId: args.id,
    });
  },
});

export { STAGE_LABELS };
