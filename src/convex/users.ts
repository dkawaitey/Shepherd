import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, internalQuery, query, QueryCtx } from "./_generated/server";
import { logAudit, requireAdmin, requireRole, hasRole, validClassScope } from "./helpers";
import { ROLES, ROLE_LABELS, Role } from "./constants";

/**
 * Get the current signed in user. Returns null if the user is not signed in.
 * Usage: const signedInUser = await ctx.runQuery(api.authHelpers.currentUser);
 * THIS FUNCTION IS READ-ONLY. DO NOT MODIFY.
 */
export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (user === null) return null;

    // While an admin is testing as another role, surface the *effective* role
    // everywhere (UI gating included), plus the real role + test flag so the
    // app shell can show the banner and the "Test as" menu entry.
    const roles = user.testAs
      ? [user.testAs]
      : user.roles?.length
        ? user.roles
        : user.role
          ? [user.role]
          : [];
    const classScope =
      user.testAs === ROLES.CLASS_LEADER
        ? user.testClassScope
        : user.testAs
          ? undefined
          : user.classScope;
    return {
      ...user,
      role: roles[0],
      roles,
      classScope,
      realRole: user.role,
      testAs: user.testAs,
      testClassScope: user.testClassScope,
    };
  },
});

/** Admin-only: impersonate another role to test the app as that role. Passing an
 *  empty role ends the test. The real admin role is checked directly, because
 *  while testing the admin's effective role is masked. */
export const setTestAs = mutation({
  args: {
    role: v.optional(v.string()),
    classScope: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const user = await ctx.db.get(userId);
    if (!user || user.role !== ROLES.ADMIN) {
      throw new Error("Only administrators can test the app as other roles");
    }
    const role = args.role?.trim() || undefined;
    const valid: Role[] = [
      ROLES.COORDINATOR,
      ROLES.WORKER,
      ROLES.LEADER,
      ROLES.CLASS_LEADER,
    ];
    if (role && !valid.includes(role as Role)) {
      throw new Error("Invalid test role");
    }
    let classScope: string | undefined;
    if (role === ROLES.CLASS_LEADER) {
      const scope = args.classScope?.trim();
      if (!validClassScope(scope)) {
        throw new Error("Pick one of the four classes for the class leader test");
      }
      classScope = scope;
    }
    await ctx.db.patch(userId, { testAs: role, testClassScope: classScope });
    await logAudit(ctx, {
      action: "role.testAs",
      entityType: "users",
      entityId: userId,
      details: role
        ? `testing as ${ROLE_LABELS[role as Role]}${classScope ? ` (${classScope} Class)` : ""}`
        : "ended role test",
    });
  },
});

/** Look up a user by id — used by actions to verify roles (auth propagates to runQuery). */
export const meById = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => ctx.db.get(args.userId),
});

/**
 * Use this function internally to get the current user data. Remember to handle the null user case.
 * @param ctx
 * @returns
 */
export const getCurrentUser = async (ctx: QueryCtx) => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    return null;
  }
  return await ctx.db.get(userId);
};

/** All ministry users, with roles. Admins and coordinators only. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, [ROLES.COORDINATOR]);
    const users = await ctx.db.query("users").collect();
    return users
      .filter((u) => !u.isAnonymous)
      .map((u) => ({
        _id: u._id,
        name: u.name,
        email: u.email,
        role: u.role,
        roles: u.roles,
        classScope: u.classScope,
        phone: u.phone,
        createdAt: (u as { createdAt?: number }).createdAt ?? 0,
      }));
  },
});

/** Class leader users, for selecting a class leader when creating a member. */
export const classLeaders = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const users = await ctx.db.query("users").collect();
    return users
      .filter(
        (u) =>
          !u.isAnonymous &&
          (u.roles?.includes(ROLES.CLASS_LEADER) || u.role === ROLES.CLASS_LEADER),
      )
      .map((u) => ({
        _id: u._id,
        name: u.name ?? u.email ?? "Unnamed",
        classScope: u.classScope,
      }));
  },
});

/**
 * Assign a user's roles (a user may hold several, e.g. Administrator + Class
 * Leader). A Class Leader must also be given a classScope to be locked to.
 * Admin only.
 */
export const setRoles = mutation({
  args: {
    userId: v.id("users"),
    roles: v.array(v.string()),
    classScope: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const valid: Role[] = [
      ROLES.ADMIN,
      ROLES.COORDINATOR,
      ROLES.WORKER,
      ROLES.LEADER,
      ROLES.CLASS_LEADER,
    ];
    const unique = [...new Set(args.roles)];
    if (unique.length === 0) throw new Error("At least one role is required");
    if (unique.some((r) => !valid.includes(r as Role))) {
      throw new Error("Invalid role");
    }
    const isClassLeader = unique.includes(ROLES.CLASS_LEADER);
    const scope = args.classScope?.trim() || undefined;
    if (isClassLeader && !validClassScope(scope)) {
      throw new Error("A Class Leader must be assigned to one of the four classes");
    }
    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("User not found");
    await ctx.db.patch(args.userId, {
      roles: unique,
      role: unique[0] as Role, // primary role for display / back-compat
      classScope: isClassLeader ? scope : undefined,
      name: target.name,
    });
    await logAudit(ctx, {
      action: "role.change",
      entityType: "users",
      entityId: args.userId,
      details: `${target.email} -> ${unique.map((r) => ROLE_LABELS[r as Role]).join(" + ")}${scope ? ` (${scope})` : ""}`,
    });
  },
});

/** Back-compat single-role setter, kept for callers that pass one role. */
export const setRole = mutation({
  args: { userId: v.id("users"), role: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const valid: Role[] = [
      ROLES.ADMIN,
      ROLES.COORDINATOR,
      ROLES.WORKER,
      ROLES.LEADER,
      ROLES.CLASS_LEADER,
    ];
    if (!valid.includes(args.role as Role)) {
      throw new Error("Invalid role");
    }
    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("User not found");
    await ctx.db.patch(args.userId, {
      role: args.role as Role,
      roles: [args.role as Role],
      name: target.name,
    });
    await logAudit(ctx, {
      action: "role.change",
      entityType: "users",
      entityId: args.userId,
      details: `${target.email} -> ${ROLE_LABELS[args.role as Role]}`,
    });
  },
});

/** Update a user's profile (name / phone). */
export const updateProfile = mutation({
  args: { name: v.string(), phone: v.string() },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [ROLES.COORDINATOR, ROLES.WORKER, ROLES.LEADER, ROLES.CLASS_LEADER]);
    await ctx.db.patch(user._id, { name: args.name, phone: args.phone });
  },
});

/**
 * Bootstrap: the very first signed-in user becomes the Administrator so the
 * ministry can manage roles immediately. No-op once an admin exists.
 */
export const bootstrapAdmin = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user || user.role) return;
    const admins = await ctx.db.query("users").collect();
    const hasAdmin = admins.some((u) => u.role === ROLES.ADMIN || hasRole(u, ROLES.ADMIN));
    if (!hasAdmin) {
      await ctx.db.patch(user._id, { role: ROLES.ADMIN, roles: [ROLES.ADMIN] });
      await logAudit(ctx, {
        action: "user.bootstrap",
        entityType: "users",
        entityId: user._id,
        details: `${user.email} became the first Administrator`,
      });
    }
  },
});

/** Remove a user account (admin only). */
export const removeUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    if (args.userId === admin._id) throw new Error("You cannot remove yourself");
    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("User not found");
    await ctx.db.delete(args.userId);
    await logAudit(ctx, {
      action: "user.delete",
      entityType: "users",
      entityId: args.userId,
      details: target.email ?? target.name ?? "unknown",
    });
  },
});
