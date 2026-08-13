import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * Steward member sync — shared outbound engine (runs in the default V8 runtime).
 *
 * Shepherd pushes its member directory to the Steward app via
 * POST /api/sync/members, authenticated with the shared STEWARD_SYNC_KEY.
 * Both apps use the member payload shape defined below. Records are matched on
 * the Steward side by membership ID, email, phone or name + class; Steward
 * returns the IDs it assigned so Shepherd can remember what has been synced.
 */

/** The 2-letter area code used in membership IDs (Adjikpo → AD). */
export const deriveShortcut = (area?: string) =>
  (area || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();

/** A synced member — the payload Shepherd sends to Steward. */
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

/** After pushing to Steward, record the Steward IDs + sync time it returned. */
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

/** All non-deleted members as exchange payloads (used by the outbound push). */
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
