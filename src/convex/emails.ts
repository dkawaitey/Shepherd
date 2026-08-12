"use node";

import { v } from "convex/values";
import { action, internalAction, ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { userRoles } from "./helpers";
import { ROLES } from "./constants";
import { buildTestEmail, buildWorkerEmail, buildClassEmail } from "./emailHtml";

const APP_NAME = "Shepherd";

type ActionUser = {
  _id: string;
  email?: string;
  name?: string;
  roles?: string[];
  role?: string;
  classScope?: string;
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

type SendArgs = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  kind: string;
  userId?: string;
};

/**
 * Transport: send one email through Resend and log the outcome.
 * Reads RESEND_API_KEY (and optional EMAIL_FROM) from the environment.
 * Never throws — failures are logged and returned so digest batches can continue.
 */
async function sendEmail(
  ctx: ActionCtx,
  args: SendArgs,
): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return { ok: false, error: "RESEND_API_KEY is not configured" };
  }
  const from = process.env.EMAIL_FROM || "Shepherd <onboarding@resend.dev>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [args.to],
        subject: args.subject,
        html: args.html,
        text: args.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend ${res.status}: ${body.slice(0, 200)}`);
    }
    await ctx.runMutation(internal.settings.logEmail, {
      to: args.to,
      subject: args.subject,
      kind: args.kind,
      userId: args.userId as never,
      status: "sent",
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.runMutation(internal.settings.logEmail, {
      to: args.to,
      subject: args.subject,
      kind: args.kind,
      userId: args.userId as never,
      status: "failed",
      error: message,
    });
    return { ok: false, error: message };
  }
}

export const send = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    html: v.string(),
    text: v.optional(v.string()),
    kind: v.string(),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => sendEmail(ctx, args),
});

/** Send a test email to verify the provider connection (admin only). */
export const sendTest = action({
  args: { to: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const me = await requireAdminAction(ctx);
    const to = args.to?.trim() || me.email;
    if (!to) throw new Error("No recipient email — add one or set it on your profile");
    const { html, text } = buildTestEmail(me.name);
    return sendEmail(ctx, {
      to,
      subject: `${APP_NAME} — test email`,
      html,
      text,
      kind: "test",
      userId: me._id,
    });
  },
});

/**
 * Send the current digest: one email per follow-up worker (their schedule) and
 * one per class leader (their class highlights). Pushes an in-app notification
 * alongside each email. Individual failures are logged and skipped.
 */
async function dispatchDigest(
  ctx: ActionCtx,
): Promise<{ ok: boolean; reason?: string; sent: number; failed: string[] }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return { ok: false, reason: "RESEND_API_KEY is not configured", sent: 0, failed: [] };
  }
  const data = await ctx.runQuery(internal.reminders.digest, {});
  if (!data.enabled) {
    return { ok: false, reason: "Email reminders are disabled in Settings", sent: 0, failed: [] };
  }

  let sent = 0;
  const failed: string[] = [];

  for (const r of data.workerRecipients) {
    const { subject, html, text } = buildWorkerEmail(r);
    const res = await sendEmail(ctx, { to: r.email, subject, html, text, kind: "workerFollowups", userId: r.userId });
    if (res.ok) sent++;
    else failed.push(r.email);
    if (r.userId) {
      await ctx.runMutation(internal.settings.pushNotificationInternal, {
        userId: r.userId as never,
        title: "Follow-up reminders",
        message: `You have ${r.items.length} follow-up${r.items.length === 1 ? "" : "s"} due in the next 3 days.`,
        type: "reminder",
        link: "/followups?status=pending",
      });
    }
  }

  for (const r of data.classRecipients) {
    const { subject, html, text } = buildClassEmail(r);
    const res = await sendEmail(ctx, { to: r.email, subject, html, text, kind: "classDigest", userId: r.userId });
    if (res.ok) sent++;
    else failed.push(r.email);
    await ctx.runMutation(internal.settings.pushNotificationInternal, {
      userId: r.userId as never,
      title: `${r.className} Class digest`,
      message: `Follow-ups, birthdays and attendance highlights for ${r.className} Class are ready.`,
      type: "reminder",
      link: "/dashboard",
    });
  }

  return { ok: true, sent, failed };
}

/** Daily automatic digest — invoked by the cron. */
export const dailyDigest = internalAction({
  args: {},
  handler: async (ctx) => dispatchDigest(ctx),
});

/** Send the digest immediately (admin only). */
export const sendNow = action({
  args: {},
  handler: async (ctx) => {
    await requireAdminAction(ctx);
    return dispatchDigest(ctx);
  },
});

/** Whether the email provider is wired up (admin only). */
export const status = action({
  args: {},
  handler: async (ctx) => {
    await requireAdminAction(ctx);
    return {
      configured: !!process.env.RESEND_API_KEY,
      from: process.env.EMAIL_FROM || "Shepherd <onboarding@resend.dev>",
    };
  },
});
