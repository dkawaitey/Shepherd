import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, internalQuery, query, QueryCtx } from "./_generated/server";
import {
  logAudit,
  requireAdmin,
  requireRole,
  hasRole,
  userRoles,
  validClassScope,
  canReadMinistry,
} from "./helpers";
import { checkRateLimit } from "./rateLimit";
import { validateName, validatePhone } from "./validate";
import {
  ACTIVITY_WRITE_INTERVAL_MS,
  ROLES,
  ROLE_LABELS,
  Role,
  deriveMemberClassScope,
  deriveMemberRoles,
} from "./constants";

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
    // Guest accounts never hold a role (mirrors helpers.effectiveRoles), so the
    // UI gates exactly what the server enforces.
    const roles = user.isAnonymous
      ? []
      : user.testAs
        ? [user.testAs]
        : user.roles?.length
          ? user.roles
          : user.role
            ? [user.role]
            : [];
    const classScope = user.isAnonymous
      ? undefined
      : user.testAs === ROLES.CLASS_LEADER
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
    if (userId === null) throw new ConvexError("Not authenticated");
    const user = await ctx.db.get(userId);
    // `userRoles` reads the account's *real* roles (ignoring any active test),
    // so an administrator who holds admin alongside other roles still passes,
    // and "test as" cannot be exited by someone who was granted it. The
    // legacy single `user.role` field alone would miss a dual-role admin.
    if (!user || user.isAnonymous || !userRoles(user).includes(ROLES.ADMIN)) {
      throw new ConvexError("Only administrators can test the app as other roles");
    }
    const role = args.role?.trim() || undefined;
    const valid: Role[] = [
      ROLES.COORDINATOR,
      ROLES.WORKER,
      ROLES.LEADER,
      ROLES.CLASS_LEADER,
    ];
    if (role && !valid.includes(role as Role)) {
      throw new ConvexError("Invalid test role");
    }
    let classScope: string | undefined;
    if (role === ROLES.CLASS_LEADER) {
      const scope = args.classScope?.trim();
      if (!validClassScope(scope)) {
        throw new ConvexError("Pick one of the four classes for the class leader test");
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
 * Resolve the current user from the auth session (via getAuthUserId).
 * Actions cannot call getAuthUserId directly, but they CAN call this
 * internal query via ctx.runQuery — the auth context propagates.
 */
export const meByAuth = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    return { ...user, _id: userId };
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

/** All ministry users, with roles and their linked member record. Admins and coordinators only. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, [ROLES.COORDINATOR]);
    const users = await ctx.db.query("users").collect();
    const members = (await ctx.db.query("members").collect()).filter((m) => !m.isDeleted);
    const memberById = new Map(members.map((m) => [m._id, m]));
    return users
      .filter((u) => !u.isAnonymous)
      .map((u) => {
        const linked = u.memberId ? memberById.get(u.memberId) : undefined;
        return {
          _id: u._id,
          name: u.name,
          email: u.email,
          role: u.role,
          roles: u.roles,
          classScope: u.classScope,
          phone: u.phone,
          memberId: u.memberId,
          rolesOverridden: !!u.rolesOverridden,
          member: linked
            ? {
                _id: linked._id,
                fullName: linked.fullName,
                klass: linked.klass,
                membershipId: linked.membershipId,
                position: linked.position,
                isClassLeader: linked.isClassLeader,
              }
            : undefined,
          derivedRoles: linked
            ? deriveMemberRoles(linked.position, linked.isClassLeader)
            : undefined,
          derivedClassScope: linked
            ? deriveMemberClassScope(linked.position, linked.isClassLeader, linked.klass)
            : undefined,
          createdAt: (u as { createdAt?: number }).createdAt ?? 0,
        };
      });
  },
});

/**
 * Access review for administrators: every account that has ever signed in,
 * including guest accounts, with the data needed to clean roles up — system
 * roles (derived from the linked member's position, or manually assigned), the
 * member link, and when the account last signed in (from its auth sessions).
 */
export const accessReview = query({
  args: {},
  handler: async (ctx) => {
    // Returns null (rather than throwing) for anyone else, so a direct link to
    // the page shows an explanation instead of a crashed screen.
    const admin = await getCurrentUser(ctx);
    if (!admin || !hasRole(admin, ROLES.ADMIN)) return null;

    const [users, members, sessions] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("members").collect(),
      ctx.db.query("authSessions").take(2000),
    ]);
    const memberById = new Map(members.map((m) => [m._id, m]));

    const now = Date.now();
    const byUser = new Map<
      string,
      { last: number; sessions: number; active: number }
    >();
    for (const session of sessions) {
      const entry = byUser.get(session.userId) ?? {
        last: 0,
        sessions: 0,
        active: 0,
      };
      entry.sessions += 1;
      if (session._creationTime > entry.last) entry.last = session._creationTime;
      if (session.expirationTime > now) entry.active += 1;
      byUser.set(session.userId, entry);
    }

    return users
      .map((u) => {
        const linked = u.memberId ? memberById.get(u.memberId) : undefined;
        const assigned = u.roles?.length ? u.roles : u.role ? [u.role] : [];
        const derived = linked
          ? deriveMemberRoles(linked.position, linked.isClassLeader)
          : [];
        const overridden = !!u.rolesOverridden && !!linked;
        const effective = linked && !overridden ? derived : assigned;
        const session = byUser.get(u._id);

        return {
          _id: u._id,
          name: u.name,
          email: u.email,
          phone: u.phone,
          isAnonymous: !!u.isAnonymous,
          accountCreatedAt: (u as { _creationTime?: number })._creationTime ?? 0,
          lastSignInAt: session?.last ?? null,
          sessionCount: session?.sessions ?? 0,
          activeSessionCount: session?.active ?? 0,
          // Roles
          roles: assigned,
          classScope: u.classScope,
          rolesOverridden: overridden,
          // Member link
          memberId: u.memberId,
          member: linked
            ? {
                _id: linked._id,
                fullName: linked.fullName,
                membershipId: linked.membershipId,
                klass: linked.klass,
                position: linked.position,
                isClassLeader: linked.isClassLeader,
                isDeleted: !!linked.isDeleted,
              }
            : undefined,
          derivedRoles: linked ? derived : undefined,
          derivedClassScope: linked
            ? deriveMemberClassScope(
                linked.position,
                linked.isClassLeader,
                linked.klass,
              )
            : undefined,
          effectiveRoles: effective,
          // Mirrors `canReadMinistry` in helpers.ts: a role grants access, and so
          // does being linked to a member record (the ministry's source of truth
          // for who belongs). A plain signed-up email with no linked profile does
          // not — it is shown the "link your profile" screen instead.
          hasAccess: !u.isAnonymous && (effective.length > 0 || !!u.memberId),
        };
      })
      .sort((a, b) => (b.lastSignInAt ?? 0) - (a.lastSignInAt ?? 0));
  },
});

/**
 * Revoke every role from an account (administrator only).
 *
 * Used to clean up accounts that should not reach ministry data — an unlinked
 * account that was given a role by mistake, for example. The account is marked
 * as an explicit override so re-linking it later does not quietly re-derive
 * permissions from a member's ministry position.
 */
export const clearAccess = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await checkRateLimit(ctx, "users.setRoles");
    const admin = await requireAdmin(ctx);
    if (args.userId === admin._id) {
      throw new ConvexError(
        "You cannot revoke your own access — ask another administrator",
      );
    }
    const target = await ctx.db.get(args.userId);
    if (!target) throw new ConvexError("User not found");

    await ctx.db.patch(args.userId, {
      role: undefined,
      roles: undefined,
      classScope: undefined,
      testAs: undefined,
      testClassScope: undefined,
      rolesOverridden: true,
    });
    await logAudit(ctx, {
      action: "role.revokeAll",
      entityType: "users",
      entityId: args.userId,
      details: `${target.email ?? target.name ?? "account"} — all roles revoked (no ministry access)`,
    });
    return { ok: true };
  },
});

/** Class leader users, for selecting a class leader when creating a member. */
export const classLeaders = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!canReadMinistry(user)) return [];
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
 * Link a user account to a member record from the Members module (one-to-one).
 * Admin only.
 *
 * The account's system roles are derived from the member's ministry position
 * (Member Directory is the source of truth) — e.g. a Class Leader member gets
 * the Class Leader role scoped to their class. An explicit administrator
 * override (rolesOverridden) is respected. Pass memberId: undefined to unlink.
 */
export const linkMember = mutation({
  args: {
    userId: v.id("users"),
    memberId: v.optional(v.id("members")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const target = await ctx.db.get(args.userId);
    if (!target) throw new ConvexError("User not found");

    if (args.memberId) {
      const member = await ctx.db.get(args.memberId);
      if (!member || member.isDeleted) throw new ConvexError("Member not found");
      const alreadyLinked = (await ctx.db.query("users").collect()).find(
        (u) => u.memberId === args.memberId && u._id !== args.userId,
      );
      if (alreadyLinked) {
        throw new ConvexError(
          `${member.fullName} is already linked to ${alreadyLinked.email ?? alreadyLinked.name ?? "another account"}`,
        );
      }
      await ctx.db.patch(args.userId, { memberId: args.memberId });

      const overridden = !!target.rolesOverridden;
      if (!overridden) {
        const roles = deriveMemberRoles(member.position, member.isClassLeader);
        const classScope = deriveMemberClassScope(
          member.position,
          member.isClassLeader,
          member.klass,
        );
        await ctx.db.patch(args.userId, {
          roles: roles.length ? roles : undefined,
          role: roles[0],
          classScope,
        });
      }
      await logAudit(ctx, {
        action: "user.linkMember",
        entityType: "users",
        entityId: args.userId,
        details: overridden
          ? `${target.email ?? "user"} linked to ${member.fullName} (${member.membershipId}) — roles kept as overridden`
          : `${target.email ?? "user"} linked to ${member.fullName} (${member.membershipId}) — role ${deriveMemberRoles(member.position, member.isClassLeader).map((r) => ROLE_LABELS[r]).join(" + ") || "none"}`,
      });
      return { linked: true, overridden };
    }

    await ctx.db.patch(args.userId, { memberId: undefined });
    await logAudit(ctx, {
      action: "user.unlinkMember",
      entityType: "users",
      entityId: args.userId,
      details: `${target.email ?? "user"} unlinked from member record`,
    });
    return { linked: false };
  },
});

/**
 * Runs after a user signs in: links the account to their existing member record
 * by verified email, then inherits permissions from the member's ministry
 * position. Never creates duplicate member records. The administrator-approved
 * alternative is linkMember from Settings → User Management.
 */
export const autoLinkAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new ConvexError("Not authenticated");
    if (user.memberId) return { linked: false, reason: "alreadyLinked" };
    const email = (user.email ?? "").trim().toLowerCase();
    if (!email) return { linked: false, reason: "noEmail" };

    const members = await ctx.db.query("members").collect();
    const users = await ctx.db.query("users").collect();
    const linkedMemberIds = new Set(
      users.map((u) => u.memberId).filter((m): m is NonNullable<typeof m> => !!m),
    );
    const match = members.find(
      (m) =>
        !m.isDeleted &&
        !linkedMemberIds.has(m._id) &&
        (m.email ?? "").trim().toLowerCase() === email,
    );
    if (!match) return { linked: false, reason: "noMatch" };

    await ctx.db.patch(user._id, { memberId: match._id });
    if (!user.rolesOverridden) {
      const roles = deriveMemberRoles(match.position, match.isClassLeader);
      const classScope = deriveMemberClassScope(
        match.position,
        match.isClassLeader,
        match.klass,
      );
      await ctx.db.patch(user._id, {
        roles: roles.length ? roles : undefined,
        role: roles[0],
        classScope,
      });
    }
    await logAudit(ctx, {
      action: "user.autoLink",
      entityType: "users",
      entityId: user._id,
      details: `${user.email} auto-linked to ${match.fullName} (${match.membershipId})`,
    });
    return { linked: true, memberId: match._id };
  },
});

/** Revert a manual role override: the account's roles are re-derived from the
 *  linked member's ministry position. Admin only. */
export const revertRoleOverride = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const target = await ctx.db.get(args.userId);
    if (!target) throw new ConvexError("User not found");

    let details = "role override cleared";
    if (target.memberId) {
      const member = await ctx.db.get(target.memberId);
      if (member && !member.isDeleted) {
        const roles = deriveMemberRoles(member.position, member.isClassLeader);
        const classScope = deriveMemberClassScope(
          member.position,
          member.isClassLeader,
          member.klass,
        );
        await ctx.db.patch(args.userId, {
          roles: roles.length ? roles : undefined,
          role: roles[0],
          classScope,
          rolesOverridden: false,
        });
        details = `roles re-derived from ${member.fullName}: ${roles.map((r) => ROLE_LABELS[r]).join(" + ") || "none"}`;
      } else {
        await ctx.db.patch(args.userId, { rolesOverridden: false });
      }
    } else {
      await ctx.db.patch(args.userId, { rolesOverridden: false });
    }
    await logAudit(ctx, {
      action: "user.revertRoleOverride",
      entityType: "users",
      entityId: args.userId,
      details,
    });
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
    if (unique.length === 0) throw new ConvexError("At least one role is required");
    if (unique.some((r) => !valid.includes(r as Role))) {
      throw new ConvexError("Invalid role");
    }
    const isClassLeader = unique.includes(ROLES.CLASS_LEADER);
    const scope = args.classScope?.trim() || undefined;
    if (isClassLeader && !validClassScope(scope)) {
      throw new ConvexError("A Class Leader must be assigned to one of the four classes");
    }
    const target = await ctx.db.get(args.userId);
    if (!target) throw new ConvexError("User not found");
    await ctx.db.patch(args.userId, {
      roles: unique,
      role: unique[0] as Role, // primary role for display / back-compat
      classScope: isClassLeader ? scope : undefined,
      name: target.name,
      rolesOverridden: true, // manual assignment always marks an override
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
      throw new ConvexError("Invalid role");
    }
    const target = await ctx.db.get(args.userId);
    if (!target) throw new ConvexError("User not found");
    await ctx.db.patch(args.userId, {
      role: args.role as Role,
      roles: [args.role as Role],
      name: target.name,
      rolesOverridden: true,
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
    await checkRateLimit(ctx, "users.updateProfile");
    const user = await requireRole(ctx, [ROLES.COORDINATOR, ROLES.WORKER, ROLES.LEADER, ROLES.CLASS_LEADER]);
    const name = validateName(args.name, "Name");
    const phone = args.phone.trim();
    await ctx.db.patch(user._id, { name, phone });
  },
});

/**
 * "App opened" heartbeat. The client calls this when the signed-in user opens
 * the app or brings the tab back into view, which is what makes the Members page
 * able to show that a member has not signed in or opened the app for a long
 * time — a Convex Auth session is created once at sign-in and then refreshed
 * silently, so session timestamps alone would flag an actively-used account.
 *
 * Deliberately cheap and open to every signed-in account (no `requireRole`: a
 * plain member holds no ministry role but still uses the app). At most one
 * write per ACTIVITY_WRITE_INTERVAL_MS per account, so a client that pings on
 * every navigation or tab focus cannot hammer the database. Guests are skipped.
 */
export const touchActivity = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user || user.isAnonymous) return { recorded: false };
    const now = Date.now();
    if (
      user.lastActiveAt !== undefined &&
      now - user.lastActiveAt < ACTIVITY_WRITE_INTERVAL_MS
    ) {
      return { recorded: false };
    }
    await ctx.db.patch(user._id, { lastActiveAt: now });
    return { recorded: true };
  },
});

/**
 * Bootstrap: so the ministry can manage roles on a fresh deployment, the first
 * real (non-guest) account becomes the Administrator.
 *
 * Deliberately narrow — an empty or missing admin must never hand the ministry
 * to whoever signs in next:
 *   - only a verified, non-anonymous account with an email can qualify
 *   - only while the deployment has no administrator at all (guests excluded,
 *     since a guest account can never hold a role)
 *   - only while it is the *only* real account: once anyone else has signed in,
 *     promotion stops and an administrator has to grant access
 *   - and if BOOTSTRAP_ADMIN_EMAIL is configured, only that address qualifies
 */
export const bootstrapAdmin = mutation({
  args: {},
  handler: async (ctx) => {
    await checkRateLimit(ctx, "users.bootstrapAdmin");
    const user = await getCurrentUser(ctx);
    if (!user || user.isAnonymous || !user.email) return;
    // Anyone who already holds a role — in either field — is never re-bootstrapped.
    if (userRoles(user).length > 0) return;

    const everyone = await ctx.db.query("users").collect();
    // Guests are not real accounts and never count as administrators.
    const real = everyone.filter((u) => !u.isAnonymous);
    // Real roles only: an administrator who is currently "testing as" a worker
    // still counts as the deployment's administrator.
    if (real.some((u) => userRoles(u).includes(ROLES.ADMIN))) return;
    if (real.some((u) => u._id !== user._id)) return;

    const allowedEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
    if (allowedEmail && user.email.trim().toLowerCase() !== allowedEmail) return;

    await ctx.db.patch(user._id, { role: ROLES.ADMIN, roles: [ROLES.ADMIN] });
    await logAudit(ctx, {
      action: "user.bootstrap",
      entityType: "users",
      entityId: user._id,
      details: `${user.email} became the first Administrator`,
    });
  },
});

/**
 * Remove a user account (admin only).
 *
 * Deleting only the user document would leave the sign-in behind: Convex Auth
 * keeps the account, its sessions and refresh tokens, so the same email could
 * sign back in as a ghost account with no profile. This purges the Convex Auth
 * records too, so a mistakenly signed-in email is fully removed.
 */
export const removeUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await checkRateLimit(ctx, "users.removeUser");
    const admin = await requireAdmin(ctx);
    if (args.userId === admin._id) throw new ConvexError("You cannot remove yourself");
    const target = await ctx.db.get(args.userId);
    if (!target) throw new ConvexError("User not found");

    // Sign-in accounts (email OTP, guest, federated) plus any pending codes.
    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", args.userId))
      .collect();
    for (const account of accounts) {
      const codes = await ctx.db
        .query("authVerificationCodes")
        .withIndex("accountId", (q) => q.eq("accountId", account._id))
        .collect();
      for (const code of codes) await ctx.db.delete(code._id);
      await ctx.db.delete(account._id);
    }

    // Active sessions and their refresh tokens — signs the account out
    // everywhere as soon as the current access token expires.
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .collect();
    for (const session of sessions) {
      const tokens = await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
        .collect();
      for (const token of tokens) await ctx.db.delete(token._id);
      await ctx.db.delete(session._id);
    }

    // Device registrations and the saved notification intent go with the account.
    const subscriptions = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const sub of subscriptions) await ctx.db.delete(sub._id);

    const prefs = await ctx.db
      .query("pushPreferences")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const pref of prefs) await ctx.db.delete(pref._id);

    // Engagement left by the account: reactions and view records.
    const reactions = await ctx.db
      .query("postReactions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const r of reactions) await ctx.db.delete(r._id);

    const views = await ctx.db
      .query("postViews")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const v of views) await ctx.db.delete(v._id);

    await ctx.db.delete(args.userId);
    await logAudit(ctx, {
      action: "user.delete",
      entityType: "users",
      entityId: args.userId,
      details: target.email ?? target.name ?? "unknown",
    });
  },
});
