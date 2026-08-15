"use node";

import { v } from "convex/values";
import { action, internalAction, ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { userRoles } from "./helpers";
import { ROLES } from "./constants";

/**
 * Customer.io — event-driven customer messaging (email, SMS, push).
 *
 * This module pushes Shepherd's ministry moments into Customer.io as events:
 *   - contact_created        (outreach record added)
 *   - contact_stage_changed  (journey stage advanced, e.g. accepted Christ)
 *   - followup_scheduled     (a follow-up was booked)
 *   - followup_completed / followup_missed / followup_cancelled
 *   - member_added           (a contact became a Youth Ministry member)
 *
 * Once those events flow into Customer.io, the ministry can build journeys
 * (e.g. "3 days after a contact is created, remind the worker"), send
 * transactional email, SMS or push, and report on the funnel.
 *
 * Transport: Customer.io Track API v1 (REST, HTTP Basic auth).
 *   - Identify a person:  PUT /api/v1/customers/{id}
 *   - Track an event:     POST /api/v1/customers/{id}/events
 *
 * Env vars (add in the Keys tab):
 *   CUSTOMERIO_SITE_ID — the workspace Site ID (Workspace Settings → API Credentials)
 *   CUSTOMERIO_API_KEY — the Tracking API Key (secret) for the workspace
 *
 * Optional:
 *   CUSTOMERIO_REGION  — "us" (default) or "eu" to select the API host
 *
 * The internal `track` action never throws on Customer.io errors: scheduled
 * events are fire-and-forget, so a misconfigured key can't break a mutation.
 */

const API_HOSTS: Record<string, string> = {
  us: "https://track.customer.io",
  eu: "https://track-eu.customer.io",
};

type TrackArgs = {
  identifier: string;
  event: string;
  attributes?: Record<string, string | number | boolean>;
  data?: Record<string, string | number | boolean>;
};

/** Basic auth header for the Track API (siteId:apiKey). */
function basicAuth(siteId: string, apiKey: string): string {
  return `Basic ${Buffer.from(`${siteId}:${apiKey}`).toString("base64")}`;
}

async function sendTrack(ctx: ActionCtx, args: TrackArgs) {
  const siteId = process.env.CUSTOMERIO_SITE_ID;
  const apiKey = process.env.CUSTOMERIO_API_KEY;
  if (!siteId || !apiKey) {
    return { ok: false, error: "CUSTOMERIO_SITE_ID / CUSTOMERIO_API_KEY are not configured" };
  }
  const region = (process.env.CUSTOMERIO_REGION || "us").toLowerCase();
  const base = API_HOSTS[region] ?? API_HOSTS.us;
  const auth = basicAuth(siteId, apiKey);
  const id = encodeURIComponent(args.identifier);
  const headers = {
    Authorization: auth,
    "Content-Type": "application/json",
  };

  try {
    // 1) Identify / upsert the person so attributes are up to date.
    if (args.attributes) {
      const identify = await fetch(`${base}/api/v1/customers/${id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(args.attributes),
      });
      if (!identify.ok && identify.status !== 404) {
        const body = await identify.text();
        return { ok: false, error: `identify ${identify.status}: ${body.slice(0, 200)}` };
      }
    }

    // 2) Track the event.
    const res = await fetch(`${base}/api/v1/customers/${id}/events`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: args.event,
        data: args.data ?? {},
        type: "event",
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `track ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Internal, fire-and-forget event push. Called from mutations via
 * `ctx.scheduler.runAfter(0, internal.customerio.track, {...})` so mutations
 * never wait on (or fail because of) Customer.io.
 */
export const track = internalAction({
  args: {
    identifier: v.string(),
    event: v.string(),
    attributes: v.optional(
      v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
    ),
    data: v.optional(
      v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
    ),
  },
  handler: async (ctx, args) => {
    const result = await sendTrack(ctx, {
      identifier: args.identifier,
      event: args.event,
      attributes: args.attributes as TrackArgs["attributes"],
      data: args.data as TrackArgs["data"],
    });
    if (!result.ok) {
      // Logged, not thrown — scheduled events are best-effort.
      console.warn(`[customerio] ${args.event} skipped: ${result.error}`);
    }
    return result;
  },
});

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

/** Whether the Customer.io keys are present (admin only). */
export const status = action({
  args: {},
  handler: async (ctx) => {
    await requireAdminAction(ctx);
    return {
      configured: !!(process.env.CUSTOMERIO_SITE_ID && process.env.CUSTOMERIO_API_KEY),
      region: (process.env.CUSTOMERIO_REGION || "us").toLowerCase(),
      host: API_HOSTS[(process.env.CUSTOMERIO_REGION || "us").toLowerCase()] ?? API_HOSTS.us,
    };
  },
});

/** Push a test event to verify the connection (admin only). */
export const sendTest = action({
  args: { identifier: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const me = await requireAdminAction(ctx);
    const identifier = args.identifier?.trim() || me.email || me._id;
    const result = await sendTrack(ctx, {
      identifier,
      event: "shepherd_test_event",
      attributes: {
        name: me.name ?? "",
        email: me.email ?? "",
        source: "shepherd",
      },
      data: {
        by: me.name ?? me.email ?? "admin",
        ts: Date.now(),
      },
    });
    return result;
  },
});
