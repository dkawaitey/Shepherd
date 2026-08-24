// APP A (source) — convex/sync.ts
//
// This is the only place that talks to App B. Actions (unlike mutations)
// are allowed to make outbound fetch() calls.
//
// Requires two environment variables set on App A's Convex deployment
// (Convex dashboard -> Settings -> Environment Variables):
//   APP_B_SYNC_URL       e.g. https://<app-b-deployment>.convex.site/syncMember
//   SYNC_SHARED_SECRET   any random string — must match App B's value exactly

import { action, internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

/** Return all non-deleted members for the batch sync. */
export const listMembersForSync = internalQuery({
  args: {},
  handler: async (ctx) => {
    const members = (await ctx.db.query("members").collect()).filter(
      (m) => !m.isDeleted,
    );
    return members.map((m) => ({
      membershipId: m.membershipId,
      fullName: m.fullName,
      gender: m.gender,
      phone: m.phone,
      whatsapp: m.whatsapp,
      email: m.email,
      klass: m.klass,
      area: m.area,
      dateJoined: m.dateJoined,
      classLeader: m.classLeader,
      ministryRoles: m.ministryRoles,
      status: m.status,
      occupation: m.occupation,
      position: m.position,
      isClassLeader: m.isClassLeader,
      sourceContactId: m.sourceContactId,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      stewardId: m.stewardId ?? null,
      syncedAt: m.syncedAt ?? null,
    }));
  },
});

/** Record steward IDs and last-synced timestamps after a push. */
export const markPushed = internalMutation({
  args: {
    matched: v.array(
      v.object({
        membershipId: v.string(),
        stewardId: v.string(),
      }),
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

/** Return sync counts for the Settings card. */
export const membersSyncStats = internalQuery({
  args: {},
  handler: async (ctx) => {
    const members = (await ctx.db.query("members").collect()).filter(
      (m) => !m.isDeleted,
    );
    const total = members.length;
    const synced = members.filter((m) => !!m.stewardId).length;
    return { total, synced, unsynced: total - synced };
  },
});

export const pushMemberToAppB = internalAction({
  args: {
    sourceId: v.string(),
    name: v.string(),
    email: v.string(),
    role: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const url = process.env.APP_B_SYNC_URL;
    const secret = process.env.SYNC_SHARED_SECRET;

    console.log(`[Sync] pushMemberToAppB called: sourceId=${args.sourceId}, name=${args.name}`);
    console.log(`[Sync] APP_B_SYNC_URL=${url ? "SET" : "MISSING"}, SYNC_SHARED_SECRET=${secret ? "SET" : "MISSING"}`);

    if (!url || !secret) {
      console.error(
        "Sync skipped: missing APP_B_SYNC_URL or SYNC_SHARED_SECRET env vars"
      );
      return;
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(args),
    });

    if (!res.ok) {
      // Log and move on — don't throw, so a transient App B outage
      // doesn't retry-loop forever. Add retry/alerting here if needed.
      console.error(
        `Sync to App B failed (${res.status}):`,
        await res.text()
      );
    }
  },
});

/** Public action: test sync by pushing a dummy member to Steward and reporting the result. */
export const testSync = action({
  args: {},
  handler: async () => {
    const url = process.env.APP_B_SYNC_URL;
    const secret = process.env.SYNC_SHARED_SECRET;
    if (!url || !secret) {
      return { ok: false, error: "Missing APP_B_SYNC_URL or SYNC_SHARED_SECRET env vars" };
    }
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        sourceId: `test-${Date.now()}`,
        name: "Test Sync Member",
        email: "test-sync@shepherd.app",
        role: null,
      }),
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  },
});

export const pushMemberDeleteToAppB = internalAction({
  args: {
    sourceId: v.string(),
  },
  handler: async (ctx, args) => {
    const url = process.env.APP_B_SYNC_URL; // e.g. https://<app-b>.convex.site/deleteMember
    const secret = process.env.SYNC_SHARED_SECRET;

    if (!url || !secret) {
      console.error(
        "Delete sync skipped: missing APP_B_SYNC_URL or SYNC_SHARED_SECRET env vars"
      );
      return;
    }

    // Same base URL as the add/update sync, different path.
    const deleteUrl = url.replace(/\/syncMember\/?$/, "/deleteMember");

    const res = await fetch(deleteUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(args),
    });

    if (!res.ok) {
      console.error(
        `Delete sync to App B failed (${res.status}):`,
        await res.text()
      );
    }
  },
});
