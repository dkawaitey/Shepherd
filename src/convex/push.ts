"use node";

import { v } from "convex/values";
import { action, internalAction, ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { userRoles } from "./helpers";
import { ROLES } from "./constants";
import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign as ecSign,
} from "node:crypto";

const VAPID_SUBJECT_DEFAULT = "mailto:shepherd@gethsemaneministry.org";
const TTL_SECONDS = 60 * 60 * 24 * 28; // 28 days

// ================= VAPID helpers =================

type VapidKeys = { publicKey: string; privateKey: string; subject?: string };

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function toBuffer(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

/** Raw uncompressed EC point (65 bytes, base64url) from a public key object. */
function publicKeyRaw(key: ReturnType<typeof createPublicKey>): string {
  const jwk = key.export({ format: "jwk" }) as { x: string; y: string };
  return Buffer.concat([
    Buffer.from([0x04]),
    toBuffer(jwk.x),
    toBuffer(jwk.y),
  ]).toString("base64url");
}

/** Generate a fresh VAPID keypair. Public: raw point base64url; private: PKCS8 DER base64url. */
function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  return {
    publicKey: publicKeyRaw(publicKey),
    privateKey: privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("base64url"),
  };
}

function publicKeyFromPrivate(privateKeyB64: string): string {
  const priv = createPrivateKey({
    key: toBuffer(privateKeyB64),
    format: "der",
    type: "pkcs8",
  });
  return publicKeyRaw(createPublicKey(priv));
}

/** Build a VAPID ES256 JWT for the push service origin. */
function signVapid(
  privateKeyB64: string,
  audience: string,
  subject?: string,
): { jwt: string; publicKey: string } {
  const priv = createPrivateKey({
    key: toBuffer(privateKeyB64),
    format: "der",
    type: "pkcs8",
  });
  const header = { typ: "JWT", alg: "ES256" };
  const claims = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject || VAPID_SUBJECT_DEFAULT,
  };
  const h = b64url(Buffer.from(JSON.stringify(header)));
  const c = b64url(Buffer.from(JSON.stringify(claims)));
  const sig = ecSign("sha256", Buffer.from(`${h}.${c}`), {
    key: priv,
    dsaEncoding: "ieee-p1363",
  });
  return {
    jwt: `${h}.${c}.${b64url(sig)}`,
    publicKey: publicKeyRaw(createPublicKey(priv)),
  };
}

/**
 * Encrypt a payload with RFC 8291 (aes128gcm) using the subscription keys.
 * @types/node 24 returns ArrayBuffer from hkdfSync, so results are wrapped in Buffer.
 */
function encryptPayload(
  payload: string,
  clientPublicB64: string,
  authB64: string,
): Buffer {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const serverPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(toBuffer(clientPublicB64));
  const auth = toBuffer(authB64);
  const salt = randomBytes(16);
  const prk = Buffer.from(
    hkdfSync(
      "sha256",
      shared,
      auth,
      Buffer.from("Content-Encoding: auth\0"),
      32,
    ),
  );
  const cek = Buffer.from(
    hkdfSync(
      "sha256",
      prk,
      salt,
      Buffer.from("Content-Encoding: aes128gcm\0"),
      16,
    ),
  );
  const nonce = Buffer.from(
    hkdfSync(
      "sha256",
      prk,
      salt,
      Buffer.from("Content-Encoding: nonce\0"),
      12,
    ),
  );
  const header = Buffer.concat([
    salt,
    Buffer.from([0x00, 0x00, 0x10, 0x00]), // rs = 4096 (big-endian)
    Buffer.from([serverPublic.length]),
    serverPublic,
  ]);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  cipher.setAAD(header);
  // Single final record: payload + two-byte padding length (0).
  const plaintext = Buffer.concat([
    Buffer.from(payload, "utf8"),
    Buffer.from([0x00, 0x00]),
  ]);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([header, encrypted, tag]);
}

type SendResult = "ok" | "gone" | "error";

async function sendOne(
  keys: VapidKeys,
  endpoint: string,
  p256dh: string,
  auth: string,
  payload: { title: string; message: string; type?: string; link?: string },
): Promise<SendResult> {
  try {
    const body = encryptPayload(JSON.stringify(payload), p256dh, auth);
    const url = new URL(endpoint);
    const { jwt, publicKey } = signVapid(keys.privateKey, url.origin, keys.subject);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(TTL_SECONDS),
        Urgency: "normal",
        Authorization: `vapid t=${jwt}, k=${publicKey}`,
      },
      body: new Uint8Array(body),
    });
    if (res.status === 200 || res.status === 201 || res.status === 202) return "ok";
    if (res.status === 404 || res.status === 410) return "gone";
    console.warn(
      "[push] push service rejected",
      res.status,
      await res.text().catch(() => ""),
    );
    return "error";
  } catch (err) {
    console.warn("[push] delivery error:", err);
    return "error";
  }
}

/** Effective VAPID keys: env vars take precedence, settings stored keys fall back. */
async function getVapidKeys(ctx: ActionCtx): Promise<VapidKeys | null> {
  const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPriv = process.env.VAPID_PRIVATE_KEY?.trim();
  const rows = await ctx.runQuery(internal.settings.getAllInternal, {});
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  const publicKey = envPub || map.vapid_public_key;
  const privateKey = envPriv || map.vapid_private_key;
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: process.env.VAPID_SUBJECT || map.vapid_subject,
  };
}

// ================= Admin helper =================

type ActionUser = {
  _id: string;
  roles?: string[];
  role?: string;
};

async function requireAdminAction(ctx: ActionCtx): Promise<ActionUser> {
  const me = (await ctx.runQuery(
    internal.users.meByAuth,
    {},
  )) as unknown as ActionUser | null;
  if (!me) {
    throw new Error(
      "Your session has expired or is not linked to a ministry account — sign out and sign in again.",
    );
  }
  if (!userRoles(me).includes(ROLES.ADMIN)) {
    throw new Error(
      "Administrator access required — sign in with the administrator account to set up ministry-wide push.",
    );
  }
  return me;
}

// ================= Admin actions =================

/** Connection status: VAPID configured? how many devices subscribed? (admin only) */
export const status = action({
  args: {},
  handler: async (ctx): Promise<{
    configured: boolean;
    publicKey: string | null;
    subject: string;
    envConfigured: boolean;
    subscribers: number;
    totalUsers: number;
  }> => {
    await requireAdminAction(ctx);
    const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
    const envPriv = process.env.VAPID_PRIVATE_KEY?.trim();
    const rows = await ctx.runQuery(internal.settings.getAllInternal, {});
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;

    // Self-heal: keys provided via env are stored in settings so the public
    // key query can serve browsers (queries can't read process.env).
    if ((!map.vapid_public_key || !map.vapid_private_key) && envPub && envPriv) {
      await ctx.runMutation(internal.settings.setInternal, {
        key: "vapid_public_key",
        value: envPub,
      });
      await ctx.runMutation(internal.settings.setInternal, {
        key: "vapid_private_key",
        value: envPriv,
      });
    }

    const publicKey = envPub || map.vapid_public_key;
    const privateKey = envPriv || map.vapid_private_key;
    const stats = await ctx.runQuery(internal.settings.pushStatsInternal, {});
    return {
      configured: !!(publicKey && privateKey),
      publicKey: publicKey ?? null,
      subject:
        process.env.VAPID_SUBJECT || map.vapid_subject || VAPID_SUBJECT_DEFAULT,
      envConfigured: !!(envPub && envPriv),
      subscribers: stats.subscribers,
      totalUsers: stats.totalUsers,
    };
  },
});

/**
 * Set up VAPID keys (admin only). With no args, generates a fresh keypair.
 * With public/private keys, validates the pair before saving. The private key
 * stays server-side; only the public key is ever exposed to browsers.
 */
export const configure = action({
  args: {
    publicKey: v.optional(v.string()),
    privateKey: v.optional(v.string()),
    subject: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; publicKey: string }> => {
    await requireAdminAction(ctx);
    let pub = args.publicKey?.trim() ?? "";
    let priv = args.privateKey?.trim() ?? "";
    if (!pub || !priv) {
      const generated = generateVapidKeys();
      pub = generated.publicKey;
      priv = generated.privateKey;
    } else {
      try {
        if (publicKeyFromPrivate(priv) !== pub) {
          throw new Error("The public and private keys do not match");
        }
      } catch (err) {
        if (
          err instanceof Error &&
          err.message === "The public and private keys do not match"
        ) {
          throw err;
        }
        throw new Error("The private key is not a valid P-256 VAPID key");
      }
    }
    await ctx.runMutation(internal.settings.setInternal, {
      key: "vapid_public_key",
      value: pub,
    });
    await ctx.runMutation(internal.settings.setInternal, {
      key: "vapid_private_key",
      value: priv,
    });
    if (args.subject?.trim()) {
      await ctx.runMutation(internal.settings.setInternal, {
        key: "vapid_subject",
        value: args.subject.trim(),
      });
    }
    return { ok: true, publicKey: pub };
  },
});

/** Send a test notification to the current user (in-app + device). */
export const sendTest = action({
  args: {},
  handler: async (ctx): Promise<{
    delivered: number;
    removed: number;
    reason?: string;
  }> => {
    const me = (await ctx.runQuery(
      internal.users.meByAuth,
      {},
    )) as unknown as { _id: string } | null;
    if (!me) throw new Error("Not authenticated — sign in and try again");
    const title = "Shepherd — test notification";
    const message =
      "Push notifications are working. Follow-up reminders and announcements will land here even when the app is closed.";
    await ctx.runMutation(internal.settings.pushNotificationInternal, {
      userId: me._id as never,
      title,
      message,
      type: "test",
      link: "/dashboard",
    });
    return await ctx.runAction(internal.push.deliverWebPush, {
      userId: me._id as never,
      title,
      message,
      type: "test",
      link: "/dashboard",
    });
  },
});

// ================= Internal delivery =================

/** Send a web push to one user's subscribed devices, pruning dead endpoints. */
export const deliverWebPush = internalAction({
  args: {
    userId: v.id("users"),
    title: v.string(),
    message: v.string(),
    type: v.optional(v.string()),
    link: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    delivered: number;
    removed: number;
    reason?: string;
  }> => {
    const keys = await getVapidKeys(ctx);
    if (!keys) return { delivered: 0, removed: 0, reason: "VAPID keys not configured" };
    const subs = await ctx.runQuery(
      internal.settings.pushSubscriptionsForUserInternal,
      { userId: args.userId },
    );
    if (subs.length === 0) return { delivered: 0, removed: 0 };
    let delivered = 0;
    let removed = 0;
    for (const s of subs) {
      const res = await sendOne(keys, s.endpoint, s.p256dh, s.auth, {
        title: args.title,
        message: args.message,
        type: args.type,
        link: args.link,
      });
      if (res === "ok") delivered++;
      else if (res === "gone") {
        await ctx.runMutation(internal.settings.deletePushSubscriptionInternal, {
          id: s._id,
        });
        removed++;
      }
    }
    return { delivered, removed };
  },
});

/**
 * Notify every signed-in user (in-app + device). Used for announcements and
 * comment/reply broadcasts. `excludeUserIds` lets the actor opt themselves out.
 */
export const broadcast = internalAction({
  args: {
    title: v.string(),
    message: v.string(),
    type: v.optional(v.string()),
    link: v.optional(v.string()),
    excludeUserIds: v.optional(v.array(v.id("users"))),
  },
  handler: async (ctx, args): Promise<{ total: number; notified: number }> => {
    const people = await ctx.runQuery(internal.settings.listUsersForPushInternal, {});
    const exclude = new Set(args.excludeUserIds ?? []);
    const targets = people.filter((u) => !exclude.has(u._id));
    let notified = 0;
    for (const u of targets) {
      await ctx.runMutation(internal.settings.pushNotificationInternal, {
        userId: u._id,
        title: args.title,
        message: args.message,
        type: args.type,
        link: args.link,
      });
      const res = await ctx.runAction(internal.push.deliverWebPush, {
        userId: u._id,
        title: args.title,
        message: args.message,
        type: args.type,
        link: args.link,
      });
      if (res.delivered > 0) notified++;
    }
    return { total: targets.length, notified };
  },
});
