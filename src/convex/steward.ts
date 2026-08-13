"use node";

import { v } from "convex/values";
import { action, internalAction, ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { userRoles } from "./helpers";
import { ROLES } from "./constants";
import { pickSyncFields } from "./sync";

/**
 * Steward member sync — action + HTTP layer (Node runtime, can read env vars).
 *
 * Env vars (set on BOTH Shepherd and Steward):
 *   STEWARD_API_URL   — the other app's public URL, e.g. https://steward.vly.sh
 *   STEWARD_SYNC_KEY  — shared secret both apps use to authenticate calls
 *
 * Each app exposes GET/POST /api/sync/members. Shepherd's hourly cron pulls
 * Steward's members and pushes its own, so either app stays current even if
 * only one of them runs a cron.
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
async function requireAdminAction(ctx: ActionCtx): Promise<ActionUser> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  const me = (await ctx.runQuery(internal.users.meById, {
    userId: identity.subject as never,
  })) as unknown as ActionUser | null;
  if (!me || !userRoles(me).includes(ROLES.ADMIN)) {
    throw new Error("Administrator access required");
  }
  return me;
}

type PullResult = {
  ok: boolean;
  reason?: string;
  received?: number;
  created?: number;
  updated?: number;
  skipped?: number;
};

type PushResult = {
  ok: boolean;
  reason?: string;
  sent?: number;
  matched?: number;
};

/** Pull members from Steward into Shepherd (last-write-wins by updatedAt). */
async function doPull(ctx: ActionCtx): Promise<PullResult> {
  const baseUrl = process.env.STEWARD_API_URL;
  const key = process.env.STEWARD_SYNC_KEY;
  if (!baseUrl || !key) {
    return { ok: false, reason: "STEWARD_API_URL / STEWARD_SYNC_KEY are not configured" };
  }
  let res: Response;
  try {
    res = await fetch(endpoint(baseUrl), { headers: authHeaders(key) });
  } catch (err) {
    return { ok: false, reason: `Could not reach Steward: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, reason: `Steward ${res.status}: ${text.slice(0, 200)}` };
  }
  let data: { members?: unknown[] };
  try {
    data = (await res.json()) as { members?: unknown[] };
  } catch {
    return { ok: false, reason: "Steward returned an invalid response" };
  }
  const members = (data.members ?? [])
    .map((m) => (m && typeof m === "object" ? pickSyncFields(m as Record<string, unknown>) : null))
    .filter((m): m is NonNullable<typeof m> => !!m);
  const result = await ctx.runMutation(internal.sync.upsertFromPayload, { members });
  const now = Date.now();
  await ctx.runMutation(internal.settings.setInternal, { key: "steward.lastSync", value: String(now) });
  await ctx.runMutation(internal.settings.setInternal, {
    key: "steward.lastResult",
    value: JSON.stringify({
      direction: "pull",
      received: members.length,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      at: now,
    }),
  });
  return {
    ok: true,
    received: members.length,
    created: result.created,
    updated: result.updated,
    skipped: result.skipped,
  };
}

/** Push Shepherd members to Steward and record the Steward IDs it returns. */
async function doPush(ctx: ActionCtx): Promise<PushResult> {
  const baseUrl = process.env.STEWARD_API_URL;
  const key = process.env.STEWARD_SYNC_KEY;
  if (!baseUrl || !key) {
    return { ok: false, reason: "STEWARD_API_URL / STEWARD_SYNC_KEY are not configured" };
  }
  const members = await ctx.runQuery(internal.sync.listMembersForSync, {});
  const at = Date.now();
  let res: Response;
  try {
    res = await fetch(endpoint(baseUrl), {
      method: "POST",
      headers: authHeaders(key),
      body: JSON.stringify({ members, updatedAt: at }),
    });
  } catch (err) {
    return { ok: false, reason: `Could not reach Steward: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, reason: `Steward ${res.status}: ${text.slice(0, 200)}` };
  }
  let data: { matched?: { membershipId: string; stewardId: string }[] };
  try {
    data = (await res.json()) as { matched?: { membershipId: string; stewardId: string }[] };
  } catch {
    return { ok: false, reason: "Steward returned an invalid response" };
  }
  await ctx.runMutation(internal.sync.markPushed, { matched: data.matched ?? [], at });
  await ctx.runMutation(internal.settings.setInternal, { key: "steward.lastSync", value: String(at) });
  await ctx.runMutation(internal.settings.setInternal, {
    key: "steward.lastResult",
    value: JSON.stringify({ direction: "push", sent: members.length, matched: (data.matched ?? []).length, at }),
  });
  return { ok: true, sent: members.length, matched: (data.matched ?? []).length };
}

/** Automatic background sync — runs hourly via cron, honours the enable toggle. */
export const syncAll = internalAction({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.runQuery(internal.settings.getAllInternal, {});
    const enabled = rows.find((r) => r.key === "steward.enabled")?.value !== "false";
    if (!enabled) return { ok: true, reason: "Automatic sync is paused in Settings", pull: null, push: null };
    const pull = await doPull(ctx);
    const push = await doPush(ctx);
    return { ok: pull.ok && push.ok, pull, push, at: Date.now() };
  },
});

/** Run a full sync immediately (admin only). */
export const syncNow = action({
  args: {},
  handler: async (ctx) => {
    await requireAdminAction(ctx);
    const pull = await doPull(ctx);
    const push = await doPush(ctx);
    return {
      ok: pull.ok && push.ok,
      pull,
      push,
      at: Date.now(),
    };
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
    configured: !!(process.env.STEWARD_API_URL && process.env.STEWARD_SYNC_KEY),
    baseUrl: process.env.STEWARD_API_URL,
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

/**
 * Inbound handler for the /api/sync/members route (called from http.ts). Runs
 * in the Node runtime so it can read the STEWARD_SYNC_KEY env var:
 *   GET  → { members: [...], updatedAt }
 *   POST → { received, created, updated, skipped, matched, updatedAt }
 * Authenticated with the shared STEWARD_SYNC_KEY via x-sync-key or Bearer.
 */
type InboundArgs = { method: string; key: string; body?: string };

type InboundResult = {
  status: number;
  payload: Record<string, unknown> | null;
  error: string | null;
};

/** Shared key check + GET/POST handling for the inbound route (Node runtime). */
async function doInbound(ctx: ActionCtx, args: InboundArgs): Promise<InboundResult> {
  const expected = process.env.STEWARD_SYNC_KEY;
  if (!expected || !args.key || args.key !== expected) {
    return { status: 401, payload: null, error: "Unauthorized" };
  }

  if (args.method === "GET") {
    const members = await ctx.runQuery(internal.sync.listMembersForSync, {});
    return {
      status: 200,
      payload: { members, updatedAt: Date.now() },
      error: null,
    };
  }

  if (args.method === "POST") {
    let parsed: { members?: unknown[] };
    try {
      parsed = args.body ? (JSON.parse(args.body) as { members?: unknown[] }) : {};
    } catch {
      return { status: 400, payload: { error: "Invalid JSON body" }, error: null };
    }
    const members = (parsed.members ?? [])
      .map((m) => (m && typeof m === "object" ? pickSyncFields(m as Record<string, unknown>) : null))
      .filter((m): m is NonNullable<typeof m> => !!m);
    const result = await ctx.runMutation(internal.sync.upsertFromPayload, { members });
    return {
      status: 200,
      payload: {
        received: members.length,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        matched: result.matched,
        updatedAt: Date.now(),
      },
      error: null,
    };
  }

  return { status: 405, payload: { error: "Method not allowed" }, error: null };
}

/**
 * Inbound handler for the /api/sync/members route (called from http.ts). Runs
 * in the Node runtime so it can read the STEWARD_SYNC_KEY env var:
 *   GET  → { members: [...], updatedAt }
 *   POST → { received, created, updated, skipped, matched, updatedAt }
 * Authenticated with the shared STEWARD_SYNC_KEY via x-sync-key or Bearer.
 */
export const handleInbound = internalAction({
  args: {
    method: v.string(),
    key: v.string(),
    body: v.optional(v.string()),
  },
  handler: async (ctx, args) => doInbound(ctx, args),
});
