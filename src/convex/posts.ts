import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { getCurrentUser, hasRole, logAudit, requireRole } from "./helpers";
import { REACTION_KINDS, ROLES } from "./constants";
import { checkRateLimit } from "./rateLimit";
import { validatePostTitle, validatePostBody, validateCommentBody } from "./validate";

// ── Media validation constants ───────────────────────────────────────
const ALLOWED_MIME_TYPES = new Set([
  // images
  "image/jpeg", "image/png", "image/webp", "image/avif",
  // video
  "video/mp4", "video/webm",
  // audio
  "audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg", "audio/webm",
  // documents
  "application/pdf",
]);

// Fallback MIME mapping for browsers that send generic types
const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".avif": "image/avif",
  ".mp4": "video/mp4", ".webm": "video/webm",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav",
  ".ogg": "audio/ogg", ".pdf": "application/pdf",
};

const MAX_FILE_SIZES: Record<string, number> = {
  image: 8 * 1024 * 1024,   // 8 MB
  video: 18 * 1024 * 1024,  // 18 MB (Convex limit ~20)
  audio: 12 * 1024 * 1024,  // 12 MB
  file: 10 * 1024 * 1024,   // 10 MB
};

const MAX_MEDIA_PER_POST = 5;

/** How long a repeat visit stops counting as a new view. */
const VIEW_WINDOW_MS = 30 * 60 * 1000;

function classifyMime(mime: string): "image" | "video" | "audio" | "file" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}

function validateMediaItem(m: { storageId: string; type: string; name: string; mimeType: string; size: number }) {
  if (!ALLOWED_MIME_TYPES.has(m.mimeType)) {
    throw new ConvexError(`Unsupported file type: ${m.mimeType} (${m.name})`);
  }
  const category = classifyMime(m.mimeType);
  const maxSize = MAX_FILE_SIZES[category] ?? MAX_FILE_SIZES.file;
  if (m.size > maxSize) {
    const mb = (maxSize / 1024 / 1024).toFixed(0);
    throw new ConvexError(`${m.name} exceeds the ${mb} MB limit for ${category}s`);
  }
  if (m.size <= 0) {
    throw new ConvexError(`${m.name} is empty`);
  }
}

/** Generate a storage upload URL for post media (images, videos, files). */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new ConvexError("Sign in to upload media");
    return await ctx.storage.generateUploadUrl();
  },
});

/** Get a signed URL for a stored file (media attachment). Requires postId
 *  to verify the requesting user can access the parent post — prevents
 *  storageId enumeration by any authenticated user. */
export const getMediaUrl = query({
  args: { storageId: v.string(), postId: v.id("posts") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const post = await ctx.db.get(args.postId);
    if (!post) return null;
    // Verify the storageId actually belongs to this post's media
    const owns = post.media?.some((m) => m.storageId === args.storageId);
    if (!owns) return null;
    return await ctx.storage.getUrl(args.storageId as any);
  },
});

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
    // Hard deletes: no isDeleted filter needed

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
      commentCount.set(c.postId, (commentCount.get(c.postId) ?? 0) + 1);
    }

    // Engagement aggregates are computed here so every list gets them live —
    // a reaction or a view anywhere updates all subscribed clients instantly.
    const reactions = await ctx.db.query("postReactions").collect();
    type Tally = { total: number; byKind: Record<string, number>; mine: string | null };
    const postEngagement = new Map<string, Tally>();
    for (const r of reactions) {
      if (r.targetType !== "post") continue;
      const tally = postEngagement.get(r.targetId) ?? { total: 0, byKind: {}, mine: null };
      tally.total += 1;
      tally.byKind[r.kind] = (tally.byKind[r.kind] ?? 0) + 1;
      if (r.userId === user._id) tally.mine = r.kind;
      postEngagement.set(r.targetId, tally);
    }

    const views = await ctx.db.query("postViews").collect();
    const viewTotals = new Map<string, { views: number; viewers: number }>();
    for (const v of views) {
      const agg = viewTotals.get(v.postId) ?? { views: 0, viewers: 0 };
      agg.views += v.views;
      agg.viewers += 1;
      viewTotals.set(v.postId, agg);
    }

    return posts.map((p) => {
      const eng = postEngagement.get(p._id);
      const vw = viewTotals.get(p._id);
      return {
        ...p,
        commentCount: commentCount.get(p._id) ?? 0,
        reactionCount: eng?.total ?? 0,
        reactionKinds: eng?.byKind ?? {},
        myReaction: eng?.mine ?? null,
        viewCount: vw?.views ?? 0,
        viewerCount: vw?.viewers ?? 0,
      };
    });
  },
});

/** Single post with its comment thread. */
export const get = query({
  args: { id: v.id("posts") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const post = await ctx.db.get(args.id);
    if (!post) return null;
    const comments = await ctx.db
      .query("comments")
      .withIndex("postId", (q) => q.eq("postId", args.id))
      .collect();

    // Per-comment reactions so each comment/reply can show its own tally.
    const reactions = await ctx.db
      .query("postReactions")
      .withIndex("by_post", (q) => q.eq("postId", args.id))
      .collect();
    const commentReactions: Record<
      string,
      { count: number; byKind: Record<string, number>; mine: string | null }
    > = {};
    for (const r of reactions) {
      if (r.targetType !== "comment") continue;
      const entry =
        commentReactions[r.targetId] ?? { count: 0, byKind: {}, mine: null };
      entry.count += 1;
      entry.byKind[r.kind] = (entry.byKind[r.kind] ?? 0) + 1;
      if (r.userId === user._id) entry.mine = r.kind;
      commentReactions[r.targetId] = entry;
    }

    return {
      ...post,
      comments: comments.sort((a, b) => a.createdAt - b.createdAt),
      commentReactions,
    };
  },
});

/**
 * Leave, change or clear a reaction on a post or a comment/reply.
 * Same reaction twice clears it; a different one replaces it.
 */
export const react = mutation({
  args: {
    postId: v.id("posts"),
    targetType: v.union(v.literal("post"), v.literal("comment")),
    targetId: v.string(),
    kind: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user || user.isAnonymous) throw new ConvexError("Sign in to react");
    await checkRateLimit(ctx, "post.react");

    if (!REACTION_KINDS.includes(args.kind)) {
      throw new ConvexError("Unknown reaction");
    }

    const post = await ctx.db.get(args.postId);
    if (!post) throw new ConvexError("Post not found");

    // The target must exist and belong to the post it claims to.
    if (args.targetType === "post") {
      if (args.targetId !== args.postId) {
        throw new ConvexError("That post no longer exists");
      }
    } else {
      const comment = await ctx.db.get(args.targetId as any);
      if (!comment || (comment as any).postId !== args.postId) {
        throw new ConvexError("That comment no longer exists");
      }
    }

    const existing = await ctx.db
      .query("postReactions")
      .withIndex("by_target_user", (q) =>
        q
          .eq("targetType", args.targetType)
          .eq("targetId", args.targetId)
          .eq("userId", user._id),
      )
      .first();

    if (existing && existing.kind === args.kind) {
      await ctx.db.delete(existing._id);
      return { kind: null };
    }

    const userName = user.name ?? user.email ?? "Member";
    if (existing) {
      await ctx.db.patch(existing._id, {
        kind: args.kind,
        userName,
        createdAt: Date.now(),
      });
    } else {
      await ctx.db.insert("postReactions", {
        targetType: args.targetType,
        targetId: args.targetId,
        postId: args.postId,
        userId: user._id,
        userName,
        kind: args.kind,
        createdAt: Date.now(),
      });
    }

    return { kind: args.kind };
  },
});

/**
 * Count a view of a post. Repeat visits inside the same 30-minute window
 * don't inflate the counter, so the number stays honest while still ticking
 * up live as new people open the post.
 */
export const recordView = mutation({
  args: { postId: v.id("posts") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user || user.isAnonymous) return { recorded: false };
    const post = await ctx.db.get(args.postId);
    if (!post) return { recorded: false };

    const now = Date.now();
    const existing = await ctx.db
      .query("postViews")
      .withIndex("by_post_user", (q) =>
        q.eq("postId", args.postId).eq("userId", user._id),
      )
      .first();

    const userName = user.name ?? user.email ?? "Member";

    if (existing) {
      if (now - existing.lastViewedAt < VIEW_WINDOW_MS) return { recorded: false };
      await ctx.db.patch(existing._id, {
        views: existing.views + 1,
        lastViewedAt: now,
        userName,
      });
      return { recorded: true };
    }

    await ctx.db.insert("postViews", {
      postId: args.postId,
      userId: user._id,
      userName,
      views: 1,
      firstViewedAt: now,
      lastViewedAt: now,
    });
    return { recorded: true };
  },
});

/**
 * Full engagement detail for one post: who reacted, how it breaks down, who
 * viewed it and the comment/reply activity. Viewer identities are only
 * returned to leaders and above.
 */
export const engagementDetails = query({
  args: { postId: v.id("posts") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const post = await ctx.db.get(args.postId);
    if (!post) return null;

    const reactions = await ctx.db
      .query("postReactions")
      .withIndex("by_post", (q) => q.eq("postId", args.postId))
      .collect();
    const views = await ctx.db
      .query("postViews")
      .withIndex("by_post", (q) => q.eq("postId", args.postId))
      .collect();
    const comments = await ctx.db
      .query("comments")
      .withIndex("postId", (q) => q.eq("postId", args.postId))
      .collect();

    const canSeeViewers = [ROLES.COORDINATOR, ROLES.WORKER, ROLES.LEADER].some((r) =>
      hasRole(user, r),
    );

    const breakdown: Record<string, number> = {};
    const reactors: { name: string; kind: string; at: number }[] = [];
    for (const r of reactions) {
      breakdown[r.kind] = (breakdown[r.kind] ?? 0) + 1;
      if (r.targetType === "post") {
        reactors.push({ name: r.userName ?? "Member", kind: r.kind, at: r.createdAt });
      }
    }
    reactors.sort((a, b) => b.at - a.at);

    const roots = comments.filter((c) => !c.parentId);
    const commenters = new Set<string>();
    for (const c of comments) {
      if (c.authorId) commenters.add(c.authorId);
    }

    return {
      postId: args.postId,
      title: post.title,
      createdAt: post.createdAt,
      // views
      viewCount: views.reduce((sum, v) => sum + v.views, 0),
      viewerCount: views.length,
      canSeeViewers,
      viewers: canSeeViewers
        ? views
            .sort((a, b) => b.lastViewedAt - a.lastViewedAt)
            .map((v) => ({
              name: v.userName ?? "Member",
              views: v.views,
              lastViewedAt: v.lastViewedAt,
            }))
        : [],
      // reactions
      reactionCount: reactions.length,
      reactionBreakdown: (Object.entries(breakdown) as [string, number][])
        .map(([kind, count]) => ({ kind, count }))
        .sort((a, b) => b.count - a.count),
      reactors,
      // conversation
      commentCount: comments.length,
      replyCount: comments.length - roots.length,
      participantCount: commenters.size,
      commenterNames: [...comments]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 50)
        .map((c) => c.author ?? "Member"),
    };
  },
});

/** Post an update / announcement. Any signed-in team member can post. */
export const create = mutation({
  args: {
    title: v.string(),
    body: v.string(),
    tags: v.optional(v.array(v.string())),
    media: v.optional(v.array(v.object({
      storageId: v.string(),
      type: v.string(),
      name: v.string(),
      mimeType: v.string(),
      size: v.number(),
      width: v.optional(v.number()),
      height: v.optional(v.number()),
      duration: v.optional(v.number()),
      thumbnailStorageId: v.optional(v.string()),
      status: v.string(),
      uploadedAt: v.number(),
    }))),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [
      ROLES.COORDINATOR,
      ROLES.WORKER,
      ROLES.LEADER,
    ]);
    await checkRateLimit(ctx, "post.create");
    const title = validatePostTitle(args.title);
    const body = validatePostBody(args.body);

    // Validate media attachments server-side
    if (args.media) {
      if (args.media.length > MAX_MEDIA_PER_POST) {
        throw new ConvexError(`Maximum ${MAX_MEDIA_PER_POST} files per post`);
      }
      for (const m of args.media) {
        validateMediaItem(m);
      }
    }

    const now = Date.now();
    const id = await ctx.db.insert("posts", {
      author: user.name ?? user.email,
      authorId: user._id,
      title,
      body,
      tags: args.tags,
      media: args.media,
      isPinned: false,
      createdAt: now,
      updatedAt: now,
    });
    await logAudit(ctx, {
      action: "post.create",
      entityType: "posts",
      entityId: id,
      details: title,
    });

    // Schedule push notification for all active users including the author
    // so everyone gets a device notification about new posts.
    try {
      const allUsers = await ctx.db.query("users").collect();
      const recipientIds = allUsers
        .filter((u) => !u.isAnonymous)
        .map((u) => u._id);

      if (recipientIds.length > 0) {
        const ts = Date.now();
        const jobId = await ctx.db.insert("notificationJobs", {
          kind: "post",
          dedupeKey: `post:${id}`,
          deliverAt: ts,
          status: "scheduled",
          payload: {
            title: "New announcement",
            body: `${user.name ?? user.email ?? "Someone"}: ${title}`,
            url: "/announcements",
          },
          recipientUserIds: recipientIds as any,
          createdAt: ts,
        });
        const sfId = await ctx.scheduler.runAfter(
          0,
          internal.pushNode.deliverJob,
          { jobId },
        );
        await ctx.db.patch(jobId, { scheduledFunctionId: sfId });
      }
    } catch (err) {
      console.error("[posts] Push notification scheduling failed:", err);
      // Log the error to delivery logs so it's visible in diagnostics.
      try {
        await ctx.db.insert("pushDeliveryLogs", {
          jobId: undefined,
          endpoint: `post:${id}`,
          success: false,
          error: `Post notification scheduling failed: ${String(err)}`,
          createdAt: Date.now(),
        });
      } catch { /* best effort */ }
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
    if (!user || user.isAnonymous) throw new ConvexError("Sign in to comment");
    const post = await ctx.db.get(args.postId);
    if (!post) throw new ConvexError("Post not found");
    await checkRateLimit(ctx, "post.addComment");
    const body = validateCommentBody(args.body);
    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.postId !== args.postId) {
        throw new ConvexError("The comment you are replying to no longer exists");
      }
    }
    const id = await ctx.db.insert("comments", {
      postId: args.postId,
      parentId: args.parentId,
      author: user.name ?? user.email ?? "Member",
      authorId: user._id,
      body,
      createdAt: Date.now(),
    });

    // Schedule push notification: everyone (including the commenter) so
    // all users receive device notifications to keep the ministry engaged.
    try {
      const allComments = await ctx.db
        .query("comments")
        .withIndex("postId", (q) => q.eq("postId", args.postId))
        .collect();

      // Collect unique user IDs from the thread.
      const participantIds = new Set<string>();
      if (post.authorId) participantIds.add(post.authorId);
      for (const c of allComments) {
        if (c.authorId) participantIds.add(c.authorId);
      }
      // Also notify all active users to keep the ministry engaged.
      const allUsers = await ctx.db.query("users").collect();
      for (const u of allUsers) {
        if (!u.isAnonymous) participantIds.add(u._id);
      }

      const recipientIds = [...participantIds];
      if (recipientIds.length > 0) {
        const isReply = !!args.parentId;
        const kind = isReply ? ("reply" as const) : ("comment" as const);
        const label = isReply ? "New reply" : "New comment";
        const ts = Date.now();
        const jobId = await ctx.db.insert("notificationJobs", {
          kind,
          dedupeKey: `${kind}:${id}`,
          deliverAt: ts,
          status: "scheduled",
          payload: {
            title: label,
            body: `${user.name ?? user.email ?? "Someone"}: ${body.slice(0, 120)}`,
            url: "/announcements",
          },
          recipientUserIds: recipientIds as any,
          createdAt: ts,
        });
        const sfId = await ctx.scheduler.runAfter(
          0,
          internal.pushNode.deliverJob,
          { jobId },
        );
        await ctx.db.patch(jobId, { scheduledFunctionId: sfId });
      }
    } catch (err) {
      console.error("[posts] Comment push notification scheduling failed:", err);
      try {
        await ctx.db.insert("pushDeliveryLogs", {
          jobId: undefined,
          endpoint: `comment:${id}`,
          success: false,
          error: `Comment notification scheduling failed: ${String(err)}`,
          createdAt: Date.now(),
        });
      } catch { /* best effort */ }
    }

    return id;
  },
});

/** Remove own post, or any post as admin. Hard-deletes the post,
 *  its media blobs from Convex storage, and all comments. */
export const remove = mutation({
  args: { id: v.id("posts") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [
      ROLES.COORDINATOR,
      ROLES.WORKER,
      ROLES.LEADER,
    ]);
    const post = await ctx.db.get(args.id);
    if (!post) throw new ConvexError("Post not found");
    if (user.role !== ROLES.ADMIN && post.authorId !== user._id) {
      throw new ConvexError("You can only remove your own posts");
    }

    // Delete attached media files from Convex storage
    if (post.media && post.media.length > 0) {
      for (const m of post.media) {
        try {
          await ctx.storage.delete(m.storageId as any);
        } catch { /* best-effort: file may already be gone */ }
      }
    }

    // Hard-delete all comments on this post
    const comments = await ctx.db
      .query("comments")
      .withIndex("postId", (q) => q.eq("postId", args.id))
      .collect();
    for (const c of comments) {
      await ctx.db.delete(c._id);
    }

    // Hard-delete engagement rows (reactions + views) for the post
    const reactions = await ctx.db
      .query("postReactions")
      .withIndex("by_post", (q) => q.eq("postId", args.id))
      .collect();
    for (const r of reactions) {
      await ctx.db.delete(r._id);
    }
    const views = await ctx.db
      .query("postViews")
      .withIndex("by_post", (q) => q.eq("postId", args.id))
      .collect();
    for (const v of views) {
      await ctx.db.delete(v._id);
    }

    // Hard-delete the post itself
    await ctx.db.delete(args.id);
    await logAudit(ctx, {
      action: "post.delete",
      entityType: "posts",
      entityId: args.id,
      details: post.title,
    });
  },
});

/** Remove own comment, or any comment as admin. Hard-deletes. */
export const removeComment = mutation({
  args: { id: v.id("comments") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [
      ROLES.COORDINATOR,
      ROLES.WORKER,
      ROLES.LEADER,
    ]);
    const comment = await ctx.db.get(args.id);
    if (!comment) throw new ConvexError("Comment not found");
    if (user.role !== ROLES.ADMIN && comment.authorId !== user._id) {
      throw new ConvexError("You can only remove your own comments");
    }
    // Hard-delete any replies to this comment first
    const replies = await ctx.db
      .query("comments")
      .collect();
    const removedIds = new Set<string>([args.id]);
    for (const r of replies) {
      if (r.parentId === args.id) {
        removedIds.add(r._id);
        await ctx.db.delete(r._id);
      }
    }
    await ctx.db.delete(args.id);

    // Reactions left on the comment or its replies go with them.
    const reactions = await ctx.db
      .query("postReactions")
      .withIndex("by_post", (q) => q.eq("postId", comment.postId))
      .collect();
    for (const r of reactions) {
      if (r.targetType === "comment" && removedIds.has(r.targetId)) {
        await ctx.db.delete(r._id);
      }
    }
  },
});

/** Pin / unpin a post. Admin only. */
export const setPinned = mutation({
  args: { id: v.id("posts"), pinned: v.boolean() },
  handler: async (ctx, args) => {
    await requireRole(ctx, []);
    const post = await ctx.db.get(args.id);
    if (!post) throw new ConvexError("Post not found");
    await ctx.db.patch(args.id, { isPinned: args.pinned });
  },
});
