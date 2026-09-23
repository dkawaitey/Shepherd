import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import { QueryCtx, MutationCtx } from "./_generated/server";
import { ROLES, Role, CLASS_OPTIONS } from "./constants";

export type CurrentUser = {
  _id: string;
  name?: string;
  email?: string;
  role?: string;
  roles?: string[];
  classScope?: string;
  memberId?: string;
  testAs?: string;
  testClassScope?: string;
  isAnonymous?: boolean;
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
 *  exactly what that role can and cannot do, server-side included.
 *
 *  Guest (anonymous) accounts never hold a role: anyone can create one, so a
 *  lingering role on such a document (from an older bootstrap) must not confer
 *  any permission. */
export const effectiveRoles = (user: CurrentUser | null | undefined): string[] => {
  if (!user || user.isAnonymous) return [];
  if (user.testAs) return [user.testAs];
  return user.roles?.length ? user.roles : user.role ? [user.role] : [];
};

/** True if the user holds the given role (admins implicitly hold every role).
 *  Anonymous guests hold no roles at all. */
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

/**
 * May this account reach ministry records at all?
 *
 * Ministry data is pastoral PII (contact details, prayer requests, notes), so
 * it is limited to signed-in accounts that hold a ministry role:
 *   - guest (anonymous) accounts get nothing — anyone could create one, so
 *     they must never reach the contact database
 *   - a linked member record is NOT enough on its own. Every member profile
 *     lives in the directory, and an Ordinary Member position derives no
 *     system role, so an account linked to such a profile reads nothing
 *     ministry-wide — only announcements and its own profile stay open to it
 *   - holding a ministry role passes, which covers the administrator's own
 *     account (bootstrapped or explicitly granted) and every appointed
 *     position (coordinator, worker, leader, class leader)
 *
 * An account that signed up with an email but was never linked to a member
 * profile is turned away too: it has no ministry identity behind it, so the app
 * shows it a "your profile has not been linked yet" screen and an administrator
 * links the member record (Settings → User Management or the member's own
 * profile) before it can do anything.
 *
 * Reads are the floor, not the ceiling: writes still require an actual role
 * (`requireRole`), private notes stay with the administrator and their author,
 * confidential prayer stays with the administrator and coordinator, and a
 * class leader is still confined to their own class.
 */
export const canReadMinistry = (
  user: CurrentUser | null | undefined,
): user is CurrentUser =>
  !!user && !user.isAnonymous && effectiveRoles(user).length > 0;

/**
 * Private / confidential notes are for the administrator and the person who
 * wrote them. Everyone else sees the note not at all.
 */
export const canSeePrivateNote = (
  user: CurrentUser | null | undefined,
  note: { isPrivate?: boolean; authorId?: string },
) => {
  if (!note.isPrivate) return true;
  if (!user) return false;
  return hasRole(user, ROLES.ADMIN) || (!!note.authorId && note.authorId === user._id);
};

/**
 * Confidential prayer requests stay with the administrator and the evangelism
 * coordinator (pastoral oversight); nobody else sees them in a feed.
 */
export const canSeeConfidentialPrayer = (
  user: CurrentUser | null | undefined,
  prayer: { confidential?: boolean },
) => {
  if (!prayer.confidential) return true;
  if (!user) return false;
  return hasRole(user, ROLES.ADMIN) || hasRole(user, ROLES.COORDINATOR);
};

/** Non-throwing class-scope test, for reads that should simply return nothing
 *  instead of erroring when a record is outside the viewer's class. */
export const withinClassScope = (
  user: CurrentUser | null | undefined,
  klass: string | undefined | null,
): boolean => {
  const scope = classScoped(user);
  return !scope || klass === scope;
};

/** Throws if the user is a class leader and the record's class is outside their scope. */
export const assertClassScope = (
  user: CurrentUser | null | undefined,
  klass: string | undefined | null,
) => {
  const scope = classScoped(user);
  if (scope && klass !== scope) {
    throw new ConvexError(`You can only work with ${scope} Class records`);
  }
};

/** Throws unless the signed-in user has one of the allowed roles (admin always passes). */
export const requireRole = async (
  ctx: MutationCtx | QueryCtx,
  roles: Role[],
) => {
  const user = await getCurrentUser(ctx);
  if (!user) throw new ConvexError("Not authenticated");
  if (hasRole(user, ROLES.ADMIN)) return user;
  if (roles.some((r) => hasRole(user, r))) return user;
  throw new ConvexError("You do not have permission to perform this action");
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
