import { getAuthUserId } from "@convex-dev/auth/server";
import { QueryCtx, MutationCtx } from "./_generated/server";
import { ROLES, Role } from "./constants";

export const getCurrentUser = async (ctx: QueryCtx | MutationCtx) => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  const user = await ctx.db.get(userId);
  if (!user) return null;
  return { ...user, _id: userId };
};

/** Throws unless the signed-in user has one of the allowed roles (admin always passes). */
export const requireRole = async (
  ctx: MutationCtx | QueryCtx,
  roles: Role[],
) => {
  const user = await getCurrentUser(ctx);
  if (!user) throw new Error("Not authenticated");
  if (user.role === ROLES.ADMIN) return user;
  if (user.role && (roles as string[]).includes(user.role)) return user;
  throw new Error("You do not have permission to perform this action");
};

/** Only admins pass. */
export const requireAdmin = async (ctx: MutationCtx | QueryCtx) => {
  return requireRole(ctx, []);
};

export const isAdmin = (role?: string) => role === ROLES.ADMIN;

export const logAudit = async (
  ctx: MutationCtx,
  args: {
    action: string;
    entityType: string;
    entityId?: string;
    details?: string;
  },
) => {
  const user = await getCurrentUser(ctx);
  await ctx.db.insert("auditLogs", {
    userId: user?._id,
    userName: user?.name ?? user?.email ?? "Unknown",
    action: args.action,
    entityType: args.entityType,
    entityId: args.entityId,
    details: args.details,
    createdAt: Date.now(),
  });
};

export const nowIso = () => new Date().toISOString();
