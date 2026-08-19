import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { getCurrentUser, logAudit, requireRole } from "./helpers";
import { ROLES } from "./constants";

/** Browse/search all team posts (any signed-in user can read). */
export const list = query({
  args: {
    search: v.optional(v.string()),
    author: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    let posts = await ctx.db.query("posts").collect();
    posts = posts.filter((p) => !p.isDeleted);

    if (args.search) {
      const q = args.search.toLowerCase();
      posts = posts.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.body.toLowerCase().includes(q) ||
          (p.tags ?? []).some((t) => t.toLowerCase().includes(q)),
      );
    }
    if (args.author) posts = posts.filter((p) => p.author === args.author);

    posts.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return b.createdAt - a.createdAt;
    });

    const comments = await ctx.db.query("comments").collect();
    const commentCount = new Map<string, number>();
    for (const c of comments) {
      if (c.isDeleted) continue;
      commentCount.set(c.postId, (commentCount.get(c.postId) ?? 0) + 1);
    }

    return posts.map((p) => ({
      ...p,
      commentCount: commentCount.get(p._id) ?? 0,
    }));
  },
});

/** Single post with its comment thread. */
export const get = query({
  args: { id: v.id("posts") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const post = await ctx.db.get(args.id);
    if (!post || post.isDeleted) return null;
    const comments = await ctx.db
      .query("comments")
      .withIndex("postId", (q) => q.eq("postId", args.id))
      .collect();
    return {
      ...post,
      comments: comments
        .filter((c) => !c.isDeleted)
        .sort((a, b) => a.createdAt - b.createdAt),
    };
  },
});

/** Post an update / announcement. Any signed-in team member can post. */
export const create = mutation({
  args: {
    title: v.string(),
    body: v.string(),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [
      ROLES.COORDINATOR,
      ROLES.WORKER,
      ROLES.LEADER,
    ]);
    if (!args.title.trim()) throw new Error("Title is required");
    if (!args.body.trim()) throw new Error("Content is required");
    const now = Date.now();
    const id = await ctx.db.insert("posts", {
      author: user.name ?? user.email,
      authorId: user._id,
      title: args.title.trim(),
      body: args.body.trim(),
      tags: args.tags,
      isPinned: false,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
    });
    await logAudit(ctx, {
      action: "post.create",
      entityType: "posts",
      entityId: id,
      details: args.title.trim(),
    });

    // Schedule push notification for all active members except the author.
    try {
      const users = await ctx.db.query("users").collect();
      const recipientIds = users
        .filter((u) => !u.isAnonymous && u._id !== user._id)
        .map((u) => u._id);
      if (recipientIds.length > 0) {
        const now = Date.now();
        await ctx.scheduler.runAfter(0, internal.notifications.scheduleNotification, {
          kind: "post",
          dedupeKey: `post:${id}`,
          deliverAt: now,
          payload: {
            title: "New announcement",
            body: args.title.trim(),
            url: "/announcements",
          },
          recipientUserIds: recipientIds,
        });
      }
    } catch {
      // Non-critical — don't block the post if scheduling fails.
    }

    return id;
  },
});

/**
 * Comment on a post, or reply to a comment. Any signed-in user — including
 * ordinary members — can join the conversation. Everyone is notified (in-app
 * bar + device push) so the whole ministry can engage; the author of the
 * comment/reply is excluded.
 */
export const addComment = mutation({
  args: {
    postId: v.id("posts"),
    body: v.string(),
    parentId: v.optional(v.id("comments")),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user || user.isAnonymous) throw new Error("Sign in to comment");
    const post = await ctx.db.get(args.postId);
    if (!post || post.isDeleted) throw new Error("Post not found");
    if (!args.body.trim()) throw new Error("Comment is required");
    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.isDeleted || parent.postId !== args.postId) {
        throw new Error("The comment you are replying to no longer exists");
      }
    }
    const id = await ctx.db.insert("comments", {
      postId: args.postId,
      parentId: args.parentId,
      author: user.name ?? user.email ?? "Member",
      authorId: user._id,
      body: args.body.trim(),
      isDeleted: false,
      createdAt: Date.now(),
    });

    // Schedule push notification: post author + thread participants, excluding the commenter.
    try {
      const post = await ctx.db.get(args.postId);
      const allComments = await ctx.db
        .query("comments")
        .withIndex("postId", (q) => q.eq("postId", args.postId))
        .collect();

      // Collect unique user IDs from the thread.
      const participantIds = new Set<string>();
      if (post?.authorId) participantIds.add(post.authorId);
      for (const c of allComments) {
        if (c.authorId) participantIds.add(c.authorId);
      }
      // Also notify all active users to keep the ministry engaged.
      const allUsers = await ctx.db.query("users").collect();
      for (const u of allUsers) {
        if (!u.isAnonymous) participantIds.add(u._id);
      }
      // Exclude the commenter.
      participantIds.delete(user._id);

      const recipientIds = [...participantIds];
      if (recipientIds.length > 0) {
        const isReply = !!args.parentId;
        const kind = isReply ? "reply" : "comment";
        const label = isReply ? "New reply" : "New comment";
        const now = Date.now();
        await ctx.scheduler.runAfter(0, internal.notifications.scheduleNotification, {
          kind,
          dedupeKey: `${kind}:${id}`,
          deliverAt: now,
          payload: {
            title: label,
            body: `${user.name ?? user.email ?? "Someone"}: ${args.body.trim().slice(0, 120)}`,
            url: `/announcements`,
          },
          recipientUserIds: recipientIds as any,
        });
      }
    } catch {
      // Non-critical — don't block the comment if scheduling fails.
    }

    return id;
  },
});

/** Remove own post, or any post as admin. */
export const remove = mutation({
  args: { id: v.id("posts") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [
      ROLES.COORDINATOR,
      ROLES.WORKER,
      ROLES.LEADER,
    ]);
    const post = await ctx.db.get(args.id);
    if (!post) throw new Error("Post not found");
    if (user.role !== ROLES.ADMIN && post.authorId !== user._id) {
      throw new Error("You can only remove your own posts");
    }
    await ctx.db.patch(args.id, { isDeleted: true });
    await logAudit(ctx, {
      action: "post.delete",
      entityType: "posts",
      entityId: args.id,
      details: post.title,
    });
  },
});

/** Remove own comment, or any comment as admin. */
export const removeComment = mutation({
  args: { id: v.id("comments") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [
      ROLES.COORDINATOR,
      ROLES.WORKER,
      ROLES.LEADER,
    ]);
    const comment = await ctx.db.get(args.id);
    if (!comment) throw new Error("Comment not found");
    if (user.role !== ROLES.ADMIN && comment.authorId !== user._id) {
      throw new Error("You can only remove your own comments");
    }
    await ctx.db.patch(args.id, { isDeleted: true });
  },
});

/** Pin / unpin a post. Admin only. */
export const setPinned = mutation({
  args: { id: v.id("posts"), pinned: v.boolean() },
  handler: async (ctx, args) => {
    await requireRole(ctx, []);
    const post = await ctx.db.get(args.id);
    if (!post) throw new Error("Post not found");
    await ctx.db.patch(args.id, { isPinned: args.pinned });
  },
});
