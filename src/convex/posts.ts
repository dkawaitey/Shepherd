import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { getCurrentUser, logAudit, requireRole } from "./helpers";
import { ROLES } from "./constants";

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

function classifyMime(mime: string): "image" | "video" | "audio" | "file" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}

function validateMediaItem(m: { storageId: string; type: string; name: string; mimeType: string; size: number }) {
  if (!ALLOWED_MIME_TYPES.has(m.mimeType)) {
    throw new Error(`Unsupported file type: ${m.mimeType} (${m.name})`);
  }
  const category = classifyMime(m.mimeType);
  const maxSize = MAX_FILE_SIZES[category] ?? MAX_FILE_SIZES.file;
  if (m.size > maxSize) {
    const mb = (maxSize / 1024 / 1024).toFixed(0);
    throw new Error(`${m.name} exceeds the ${mb} MB limit for ${category}s`);
  }
  if (m.size <= 0) {
    throw new Error(`${m.name} is empty`);
  }
}

/** Generate a storage upload URL for post media (images, videos, files). */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Sign in to upload media");
    return await ctx.storage.generateUploadUrl();
  },
});

/** Get a signed URL for a stored file (media attachment). Verifies
 *  the requesting user can access the parent post. */
export const getMediaUrl = query({
  args: { storageId: v.string(), postId: v.optional(v.id("posts")) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    // If a postId is provided, verify the user can access the post
    if (args.postId) {
      const post = await ctx.db.get(args.postId);
      if (!post) return null;
      // Verify the storageId actually belongs to this post's media
      const owns = post.media?.some((m) => m.storageId === args.storageId);
      if (!owns) return null;
    }
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
    if (!post) return null;
    const comments = await ctx.db
      .query("comments")
      .withIndex("postId", (q) => q.eq("postId", args.id))
      .collect();
    return {
      ...post,
      comments: comments.sort((a, b) => a.createdAt - b.createdAt),
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
    if (!args.title.trim()) throw new Error("Title is required");
    if (!args.body.trim()) throw new Error("Content is required");

    // Validate media attachments server-side
    if (args.media) {
      if (args.media.length > MAX_MEDIA_PER_POST) {
        throw new Error(`Maximum ${MAX_MEDIA_PER_POST} files per post`);
      }
      for (const m of args.media) {
        validateMediaItem(m);
      }
    }

    const now = Date.now();
    const id = await ctx.db.insert("posts", {
      author: user.name ?? user.email,
      authorId: user._id,
      title: args.title.trim(),
      body: args.body.trim(),
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
      details: args.title.trim(),
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
            body: `${user.name ?? user.email ?? "Someone"}: ${args.title.trim()}`,
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
    if (!user || user.isAnonymous) throw new Error("Sign in to comment");
    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("Post not found");
    if (!args.body.trim()) throw new Error("Comment is required");
    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.postId !== args.postId) {
        throw new Error("The comment you are replying to no longer exists");
      }
    }
    const id = await ctx.db.insert("comments", {
      postId: args.postId,
      parentId: args.parentId,
      author: user.name ?? user.email ?? "Member",
      authorId: user._id,
      body: args.body.trim(),
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
            body: `${user.name ?? user.email ?? "Someone"}: ${args.body.trim().slice(0, 120)}`,
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
    if (!post) throw new Error("Post not found");
    if (user.role !== ROLES.ADMIN && post.authorId !== user._id) {
      throw new Error("You can only remove your own posts");
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
    if (!comment) throw new Error("Comment not found");
    if (user.role !== ROLES.ADMIN && comment.authorId !== user._id) {
      throw new Error("You can only remove your own comments");
    }
    // Hard-delete any replies to this comment first
    const replies = await ctx.db
      .query("comments")
      .collect();
    for (const r of replies) {
      if (r.parentId === args.id) {
        await ctx.db.delete(r._id);
      }
    }
    await ctx.db.delete(args.id);
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
