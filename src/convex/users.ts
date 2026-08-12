import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query, QueryCtx } from "./_generated/server";
import { logAudit, requireAdmin, requireRole } from "./helpers";
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

    if (user === null) {
      return null;
    }

    return user;
  },
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
        phone: u.phone,
        createdAt: (u as { createdAt?: number }).createdAt ?? 0,
      }));
  },
});

/** Assign or change a user's role. Admin only. */
export const setRole = mutation({
  args: { userId: v.id("users"), role: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const valid: Role[] = [
      ROLES.ADMIN,
      ROLES.COORDINATOR,
      ROLES.WORKER,
      ROLES.LEADER,
    ];
    if (!valid.includes(args.role as Role)) {
      throw new Error("Invalid role");
    }
    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("User not found");
    await ctx.db.patch(args.userId, {
      role: args.role as Role,
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
    const user = await requireRole(ctx, [ROLES.COORDINATOR, ROLES.WORKER, ROLES.LEADER]);
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
    const hasAdmin = admins.some((u) => u.role === ROLES.ADMIN);
    if (!hasAdmin) {
      await ctx.db.patch(user._id, { role: ROLES.ADMIN });
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
