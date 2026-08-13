import { getAuthUserId } from "@convex-dev/auth/server";
import { QueryCtx, MutationCtx } from "./_generated/server";
import { ROLES, Role, CLASS_OPTIONS } from "./constants";

export type CurrentUser = {
  _id: string;
  name?: string;
  email?: string;
  role?: string;
  roles?: string[];
  classScope?: string;
  testAs?: string;
  testClassScope?: string;
  [key: string]: unknown;
};

export const getCurrentUser = async (ctx: QueryCtx | MutationCtx) => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  const user = await ctx.db.get(userId);
  if (!user) return null;
  return { ...user, _id: userId };
};

/** Roles that take effect for permission checks. While an admin is "testing as"
 *  another role (testAs set), only the test role applies — so the admin sees
 *  exactly what that role can and cannot do, server-side included. */
export const effectiveRoles = (user: CurrentUser | null | undefined): string[] => {
  if (!user) return [];
  if (user.testAs) return [user.testAs];
  return user.roles?.length ? user.roles : user.role ? [user.role] : [];
};

/** True if the user holds the given role (admins implicitly hold every role). */
export const hasRole = (user: CurrentUser | null | undefined, role: string) => {
  if (!user) return false;
  return effectiveRoles(user).includes(role);
};

/** Every role a user holds (admins count as admin only — not implicitly everything for display). */
export const userRoles = (user: CurrentUser | null | undefined): string[] => {
  if (!user) return [];
  if (user.roles?.length) return user.roles;
  return user.role ? [user.role] : [];
};

/** True for a plain class leader (a class leader who is not also an admin). */
export const isScopedClassLeader = (user: CurrentUser | null | undefined) =>
  !!user && !hasRole(user, ROLES.ADMIN) && hasRole(user, ROLES.CLASS_LEADER);

/** The class a user is locked to, or undefined for unscoped users. */
export const classScoped = (user: CurrentUser | null | undefined): string | undefined => {
  if (!user) return undefined;
  if (hasRole(user, ROLES.ADMIN)) return undefined;
  return hasRole(user, ROLES.CLASS_LEADER)
    ? user.testAs === ROLES.CLASS_LEADER
      ? (user.testClassScope as string | undefined)
      : user.classScope
    : undefined;
};

/** Throws if the user is a class leader and the record's class is outside their scope. */
export const assertClassScope = (
  user: CurrentUser | null | undefined,
  klass: string | undefined | null,
) => {
  const scope = classScoped(user);
  if (scope && klass !== scope) {
    throw new Error(`You can only work with ${scope} Class records`);
  }
};

/** Throws unless the signed-in user has one of the allowed roles (admin always passes). */
export const requireRole = async (
  ctx: MutationCtx | QueryCtx,
  roles: Role[],
) => {
  const user = await getCurrentUser(ctx);
  if (!user) throw new Error("Not authenticated");
  if (hasRole(user, ROLES.ADMIN)) return user;
  if (roles.some((r) => hasRole(user, r))) return user;
  throw new Error("You do not have permission to perform this action");
};

/** Only admins pass. */
export const requireAdmin = async (ctx: MutationCtx | QueryCtx) => {
  return requireRole(ctx, []);
};

export const isAdmin = (role?: string) => role === ROLES.ADMIN;

/** Validates that a class scope value is one of the four ministry classes. */
export const validClassScope = (scope?: string) =>
  !!scope && CLASS_OPTIONS.includes(scope as (typeof CLASS_OPTIONS)[number]);

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
