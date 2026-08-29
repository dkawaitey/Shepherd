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

/** Only admins pass — for actions (uses meByAuth which resolves via getAuthUserId). */
async function requireAdminAction(ctx: ActionCtx): Promise<ActionUser> {
  const me = (await ctx.runQuery(
    internal.users.meByAuth,
    {},
  )) as unknown as ActionUser | null;
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
 * Transport: send one email through Brevo (Sendinblue) SMTP API and log the outcome.
 * Reads BREVO_API_KEY (and optional EMAIL_FROM / BREVO_SENDER_NAME) from the environment.
 * Never throws — failures are logged and returned so digest batches can continue.
 */
async function sendEmail(
  ctx: ActionCtx,
  args: SendArgs,
): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.BREVO_API_KEY;
  if (!key) {
    return { ok: false, error: "BREVO_API_KEY is not configured" };
  }
  const senderEmail = process.env.EMAIL_FROM || "shepherd@gethsemane.org";
  const senderName = process.env.BREVO_SENDER_NAME || "Shepherd";
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": key,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        to: [{ email: args.to }],
        subject: args.subject,
        htmlContent: args.html,
        textContent: args.text || args.html.replace(/<[^>]+>/g, "").trim(),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Brevo ${res.status}: ${body.slice(0, 200)}`);
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
 * one per class leader (their class highlights). Emails are only sent when
 * RESEND_API_KEY is configured. Individual failures are logged and skipped.
 */
async function dispatchDigest(
  ctx: ActionCtx,
): Promise<{
  ok: boolean;
  reason?: string;
  sent: number;
  failed: string[];
}> {
  const data = await ctx.runQuery(internal.reminders.digest, {});
  if (!data.enabled) {
    return { ok: false, reason: "Reminders are disabled in Settings", sent: 0, failed: [] };
  }
  const key = process.env.RESEND_API_KEY;

  let sent = 0;
  const failed: string[] = [];

  for (const r of data.workerRecipients) {
    if (!key) continue;
    const { subject, html, text } = buildWorkerEmail(r);
    const res = await sendEmail(ctx, { to: r.email, subject, html, text, kind: "workerFollowups", userId: r.userId });
    if (res.ok) sent++;
    else failed.push(r.email);
  }

  for (const r of data.classRecipients) {
    if (!key) continue;
    const { subject, html, text } = buildClassEmail(r);
    const res = await sendEmail(ctx, { to: r.email, subject, html, text, kind: "classDigest", userId: r.userId });
    if (res.ok) sent++;
    else failed.push(r.email);
  }

  return {
    ok: true,
    reason: key ? undefined : "No RESEND_API_KEY — emails skipped",
    sent,
    failed,
  };
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
      configured: !!process.env.BREVO_API_KEY,
      from: `${process.env.BREVO_SENDER_NAME || "Shepherd"} <${process.env.EMAIL_FROM || "shepherd@gethsemane.org"}>`,
    };
  },
});
