"use node";

import { action, internalAction, ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { userRoles } from "./helpers";
import { ROLES } from "./constants";

/**
 * Steward member sync — outbound push only (Node runtime, can read env vars).
 *
 * Shepherd pushes its member directory out to the Steward app on a schedule.
 * Nothing is ever pulled in: Steward never writes into Shepherd's database.
 *
 * Env vars (set on Shepherd and Steward):
 *   STEWARD_API_URL   — the Steward app's public URL, e.g. https://steward.vly.sh
 *   STEWARD_SYNC_KEY  — shared secret both apps use to authenticate calls
 *
 * Shepherd POSTs the member payload to {STEWARD_API_URL}/api/sync/members,
 * authenticated via x-sync-key / Bearer. The Steward app matches records by
 * membership ID, email, phone or name + class, and returns the Steward IDs it
 * assigned so Shepherd can remember which members were already synced.
 */

const endpoint = (baseUrl: string) => `${baseUrl.replace(/\/+$/, "")}/api/sync/members`;

function authHeaders(key: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-sync-key": key,
    Authorization: `Bearer ${key}`,
  };
}

type ActionUser = {
  _id: string;
  email?: string;
  name?: string;
  roles?: string[];
  role?: string;
};

/** Only admins pass — for actions (auth identity + role lookup via runQuery). */
export async function requireAdminAction(ctx: ActionCtx): Promise<ActionUser> {
  const me = (await ctx.runQuery(
    internal.users.meByAuth,
    {},
  )) as unknown as ActionUser | null;
  if (!me || !userRoles(me).includes(ROLES.ADMIN)) {
    throw new Error("Administrator access required");
  }
  return me;
}

type PushResult = {
  ok: boolean;
  reason?: string;
  sent?: number;
  matched?: number;
  errors?: string[];
};

/** Push Shepherd members to Steward and record the Steward IDs it returns. */
async function doPush(ctx: ActionCtx): Promise<PushResult> {
  const baseUrl = process.env.APP_B_SYNC_URL;
  const key = process.env.SYNC_SHARED_SECRET;
  if (!baseUrl || !key) {
    return { ok: false, reason: "APP_B_SYNC_URL / SYNC_SHARED_SECRET are not configured" };
  }
  const members = await ctx.runQuery(internal.sync.listMembersForSync, {});
  const at = Date.now();
  let sent = 0;
  let matched = 0;
  const errors: string[] = [];
  // Push each member individually via the /syncMember endpoint.
  for (const m of members) {
    const syncUrl = baseUrl.replace(/\/syncMember\/?$/, "/syncMember");
    try {
      const res = await fetch(syncUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          sourceId: m._id,
          name: m.fullName,
          email: m.email || `${m.membershipId.toLowerCase()}@shepherd.local`,
          role: (m.position as string) || null,
        }),
      });
      const resBody = await res.text().catch(() => "");
      if (res.ok) {
        sent++;
        matched++;
      } else {
        const msg = `Sync failed for ${m.membershipId}: HTTP ${res.status} - ${resBody}`;
        console.error(msg);
        errors.push(msg);
      }
    } catch (err: any) {
      const msg = `Sync error for ${m.membershipId}: ${err?.message ?? String(err)}`;
      console.error(msg);
      errors.push(msg);
    }
  }
  await ctx.runMutation(internal.sync.markPushed, {
    matched: members.map((m) => ({ membershipId: m.membershipId, stewardId: m._id })),
    at,
  });
  await ctx.runMutation(internal.settings.setInternal, { key: "steward.lastSync", value: String(at) });
  await ctx.runMutation(internal.settings.setInternal, {
    key: "steward.lastResult",
    value: JSON.stringify({ direction: "push", sent, matched, at, errors: errors.slice(0, 5) }),
  });
  return { ok: sent > 0, sent, matched, errors: errors.slice(0, 5) };
}

/** Automatic background push — runs hourly via cron, honours the enable toggle. */
export const pushMembers = internalAction({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.runQuery(internal.settings.getAllInternal, {});
    const enabled = rows.find((r) => r.key === "steward.enabled")?.value !== "false";
    if (!enabled) return { ok: true, reason: "Automatic sync is paused in Settings", push: null };
    const push = await doPush(ctx);
    return { ok: push.ok, push, at: Date.now() };
  },
});

/** Push all members to Steward immediately (admin only). */
export const syncNow = action({
  args: {},
  handler: async (ctx) => {
    try {
      await requireAdminAction(ctx);
      const push = await doPush(ctx);
      return { ok: push.ok, push, at: Date.now() };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err), at: Date.now() };
    }
  },
});

type StatusResult = {
  configured: boolean;
  baseUrl?: string;
  enabled: boolean;
  lastSync?: string;
  lastResult?: string;
  total: number;
  synced: number;
  unsynced: number;
};

/** Connection + last-run status for the Settings card (admin only). */
async function doStatus(ctx: ActionCtx): Promise<StatusResult> {
  const stats = await ctx.runQuery(internal.sync.membersSyncStats, {});
  const rows = await ctx.runQuery(internal.settings.getAllInternal, {});
  const get = (key: string) => rows.find((r) => r.key === key)?.value;
  return {
    configured: !!(process.env.APP_B_SYNC_URL && process.env.SYNC_SHARED_SECRET),
    baseUrl: process.env.APP_B_SYNC_URL,
    enabled: get("steward.enabled") !== "false",
    lastSync: get("steward.lastSync"),
    lastResult: get("steward.lastResult"),
    total: stats.total,
    synced: stats.synced,
    unsynced: stats.unsynced,
  };
}

/** Connection + last-run status for the Settings card (admin only). */
export const status = action({
  args: {},
  handler: async (ctx) => {
    await requireAdminAction(ctx);
    return doStatus(ctx);
  },
});
