import { v } from "convex/values";
import { internalMutation, internalQuery, MutationCtx } from "./_generated/server";
import { CLASS_OPTIONS } from "./constants";
import { nextMembershipId } from "./contacts";

/**
 * Steward member sync — shared engine (runs in the default V8 runtime).
 *
 * The contract between Shepherd and Steward is a plain REST endpoint on both
 * apps: GET/POST /api/sync/members, authenticated with the shared
 * STEWARD_SYNC_KEY. Both sides send the same member payload shape defined
 * below. Records are matched by Steward ID → membership ID → email → phone →
 * name + class, and conflicts resolve by last-write-wins on `updatedAt`.
 */

/** The 2-letter area code used in membership IDs (Adjikpo → AD). */
export const deriveShortcut = (area?: string) =>
  (area || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();

/** A synced member — the fields exchanged between Shepherd and Steward. */
export const syncMemberValidator = v.object({
  stewardId: v.optional(v.string()),
  membershipId: v.optional(v.string()),
  fullName: v.string(),
  gender: v.optional(v.union(v.literal("male"), v.literal("female"))),
  phone: v.optional(v.string()),
  whatsapp: v.optional(v.string()),
  email: v.optional(v.string()),
  klass: v.optional(v.string()),
  area: v.optional(v.string()),
  dateJoined: v.optional(v.string()),
  occupation: v.optional(v.string()),
  status: v.optional(v.union(v.literal("active"), v.literal("inactive"))),
  updatedAt: v.number(),
});

export type SyncMember = {
  stewardId?: string;
  membershipId?: string;
  fullName: string;
  gender?: "male" | "female";
  phone?: string;
  whatsapp?: string;
  email?: string;
  klass?: string;
  area?: string;
  dateJoined?: string;
  occupation?: string;
  status?: "active" | "inactive";
  updatedAt: number;
};

/** Sanitise arbitrary inbound JSON into a clean sync payload. */
export const pickSyncFields = (raw: Record<string, unknown>): SyncMember | null => {
  const fullName = typeof raw.fullName === "string" ? raw.fullName.trim() : "";
  if (!fullName) return null;
  return {
    stewardId: typeof raw.stewardId === "string" && raw.stewardId ? raw.stewardId : undefined,
    membershipId:
      typeof raw.membershipId === "string" && raw.membershipId ? raw.membershipId : undefined,
    fullName,
    gender: raw.gender === "male" || raw.gender === "female" ? raw.gender : undefined,
    phone: typeof raw.phone === "string" ? raw.phone : undefined,
    whatsapp: typeof raw.whatsapp === "string" ? raw.whatsapp : undefined,
    email: typeof raw.email === "string" ? raw.email : undefined,
    klass: typeof raw.klass === "string" ? raw.klass : undefined,
    area: typeof raw.area === "string" ? raw.area : undefined,
    dateJoined: typeof raw.dateJoined === "string" ? raw.dateJoined : undefined,
    occupation: typeof raw.occupation === "string" ? raw.occupation : undefined,
    status: raw.status === "active" || raw.status === "inactive" ? raw.status : undefined,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
  };
};

/** Map a local member row to the exchange payload. */
export const toSyncPayload = (m: {
  stewardId?: string;
  membershipId: string;
  fullName: string;
  gender?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  klass?: string;
  area?: string;
  dateJoined?: string;
  occupation?: string;
  status?: string;
  updatedAt: number;
}): SyncMember => ({
  stewardId: m.stewardId,
  membershipId: m.membershipId,
  fullName: m.fullName,
  gender: m.gender as SyncMember["gender"],
  phone: m.phone,
  whatsapp: m.whatsapp,
  email: m.email,
  klass: m.klass,
  area: m.area,
  dateJoined: m.dateJoined,
  occupation: m.occupation,
  status: m.status === "inactive" ? "inactive" : "active",
  updatedAt: m.updatedAt ?? Date.now(),
});

/** Upsert members received from the other app. Returns a run summary. */
export const upsertFromPayload = internalMutation({
  args: { members: v.array(syncMemberValidator) },
  handler: async (
    ctx: MutationCtx,
    args: { members: SyncMember[] },
  ) => {
    const all = (await ctx.db.query("members").collect()).filter((m) => !m.isDeleted);
    const now = Date.now();
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const matched: { membershipId: string; stewardId: string }[] = [];

    for (const p of args.members) {
      const email = (p.email || "").trim().toLowerCase();
      const phoneDigits = (p.phone || "").replace(/\D/g, "");
      const name = (p.fullName || "").trim().toLowerCase();
      const klass = p.klass || "";

      const existing =
        (p.stewardId && all.find((m) => m.stewardId === p.stewardId)) ||
        (p.membershipId && all.find((m) => m.membershipId === p.membershipId)) ||
        (email && all.find((m) => (m.email || "").trim().toLowerCase() === email)) ||
        (phoneDigits &&
          all.find((m) => (m.phone || "").replace(/\D/g, "") === phoneDigits)) ||
        (name &&
          all.find(
            (m) =>
              (m.fullName || "").trim().toLowerCase() === name && (m.klass || "") === klass,
          ));

      if (existing) {
        const base = existing.stewardUpdatedAt ?? existing.updatedAt ?? 0;
        if (p.updatedAt < base) {
          skipped++;
          continue;
        }
        await ctx.db.patch(existing._id, {
          fullName: p.fullName,
          gender: p.gender,
          phone: p.phone,
          whatsapp: p.whatsapp,
          email: p.email,
          klass: p.klass,
          area: p.area,
          dateJoined: p.dateJoined,
          occupation: p.occupation,
          status: p.status ?? "active",
          stewardId: p.stewardId || existing.stewardId,
          stewardUpdatedAt: p.updatedAt,
          syncedAt: now,
          updatedAt: now,
        });
        updated++;
        if (p.stewardId) matched.push({ membershipId: existing.membershipId, stewardId: p.stewardId });
      } else {
        const dateJoined = p.dateJoined || new Date(now).toISOString().slice(0, 10);
        const membershipId = await nextMembershipId(ctx, deriveShortcut(p.area), dateJoined);
        await ctx.db.insert("members", {
          fullName: p.fullName,
          gender: p.gender,
          phone: p.phone,
          whatsapp: p.whatsapp,
          email: p.email,
          klass: p.klass || CLASS_OPTIONS[0],
          area: p.area,
          dateJoined: p.dateJoined,
          occupation: p.occupation,
          status: p.status ?? "active",
          position: "member",
          isClassLeader: false,
          isDeleted: false,
          membershipId,
          stewardId: p.stewardId,
          stewardUpdatedAt: p.updatedAt,
          syncedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        created++;
        if (p.stewardId) matched.push({ membershipId, stewardId: p.stewardId });
      }
    }
    return { created, updated, skipped, matched };
  },
});

/** After pushing to the other app, record the Steward IDs + sync time it returned. */
export const markPushed = internalMutation({
  args: {
    matched: v.array(
      v.object({ membershipId: v.string(), stewardId: v.string() }),
    ),
    at: v.number(),
  },
  handler: async (ctx, args) => {
    for (const m of args.matched) {
      const member = await ctx.db
        .query("members")
        .withIndex("membershipId", (q) => q.eq("membershipId", m.membershipId))
        .first();
      if (member) {
        await ctx.db.patch(member._id, {
          stewardId: m.stewardId,
          syncedAt: args.at,
        });
      }
    }
  },
});

/** All non-deleted members as exchange payloads (used by push + inbound GET). */
export const listMembersForSync = internalQuery({
  args: {},
  handler: async (ctx) => {
    const members = (await ctx.db.query("members").collect()).filter((m) => !m.isDeleted);
    return members.map((m) => toSyncPayload(m));
  },
});

/** Counts for the settings card: total / synced / unsynced members. */
export const membersSyncStats = internalQuery({
  args: {},
  handler: async (ctx) => {
    const members = (await ctx.db.query("members").collect()).filter((m) => !m.isDeleted);
    const synced = members.filter((m) => m.stewardId || m.syncedAt).length;
    return { total: members.length, synced, unsynced: members.length - synced };
  },
});
