import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import {
  MutationCtx,
  QueryCtx,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import {
  CurrentUser,
  getCurrentUser,
  hasRole,
  logAudit,
  requireRole,
} from "./helpers";
import { REACTION_KINDS, ROLES } from "./constants";
import { checkRateLimit } from "./rateLimit";
import { notifyUsers } from "./inbox";
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

/**
 * How often a reader's "last viewed" time may be refreshed once their view has
 * already been counted (one write per reader per half hour at most).
 */
const VIEW_REFRESH_MS = 30 * 60 * 1000;

type Ctx = QueryCtx | MutationCtx;

type Engagement = {
  commentCount: number;
  reactionCount: number;
  reactionKinds: Record<string, number>;
  viewCount: number;
  viewerCount: number;
};

/**
 * Engagement totals for one post, read from the source rows.
 *
 * Only used for posts created before the denormalized counters existed (and to
 * self-heal them), so the hot feed path never touches the reactions, views or
 * comments tables.
 */
async function computeEngagement(ctx: Ctx, postId: Id<"posts">): Promise<Engagement> {
  const [comments, reactions, views] = await Promise.all([
    ctx.db
      .query("comments")
      .withIndex("postId", (q) => q.eq("postId", postId))
      .collect(),
    ctx.db
      .query("postReactions")
      .withIndex("by_post", (q) => q.eq("postId", postId))
      .collect(),
    ctx.db
      .query("postViews")
      .withIndex("by_post", (q) => q.eq("postId", postId))
      .collect(),
  ]);

  const reactionKinds: Record<string, number> = {};
  let reactionCount = 0;
  for (const r of reactions) {
    if (r.targetType !== "post") continue;
    reactionCount += 1;
    reactionKinds[r.kind] = (reactionKinds[r.kind] ?? 0) + 1;
  }

  return {
    commentCount: comments.length,
    reactionCount,
    reactionKinds,
    // One row per account that opened the post, so the number of rows *is* the
    // number of views — summing per-row counters would let a single reader
    // count more than once (the old rule the rows were written under).
    viewCount: views.length,
    viewerCount: views.length,
  };
}

/** The post's engagement counters, computing (and later persisting) them for
 *  legacy posts that predate the denormalized fields. */
async function engagementFor(ctx: Ctx, post: Doc<"posts">): Promise<Engagement> {
  if (
    post.commentCount !== undefined &&
    post.reactionCount !== undefined &&
    post.reactionKinds !== undefined &&
    post.viewCount !== undefined &&
    post.viewerCount !== undefined
  ) {
    return {
      commentCount: post.commentCount,
      reactionCount: post.reactionCount,
      reactionKinds: post.reactionKinds,
      // Views are one per account, so the two counters must agree. A stored
      // viewCount above viewerCount means the post was counted under the old
      // multi-view rule; reporting the distinct viewers is the truthful number,
      // and whichever mutation reads this next persists the correction.
      viewCount: Math.min(post.viewCount, post.viewerCount),
      viewerCount: post.viewerCount,
    };
  }
  return await computeEngagement(ctx, post._id);
}

/**
 * Who may see and manage one post's engagement details and its poll:
 * administrators, evangelism coordinators, and the person who wrote it.
 *
 * Every role check here goes through `hasRole`, which honours the whole role
 * set an account holds (and "test as" impersonation) — never the single
 * legacy `user.role` field, which misses a dual-role account such as
 * Administrator + Class Leader.
 */
function canManagePost(
  user: CurrentUser | null | undefined,
  post: Doc<"posts">,
) {
  if (!user) return false;
  return (
    hasRole(user, ROLES.ADMIN) ||
    hasRole(user, ROLES.COORDINATOR) ||
    (!!post.authorId && post.authorId === user._id)
  );
}

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

// ── Poll limits (validated server-side, mirrored by the composer) ────
const MIN_POLL_OPTIONS = 2;
const MAX_POLL_OPTIONS = 8;
const MAX_POLL_QUESTION = 200;
const MAX_POLL_OPTION = 120;

/** One poll option as id + label, both generated from the submitted texts. */
type PollOptions = { id: string; text: string }[];

/**
 * Is this poll shut? Either someone closed it by hand, or its auto-close
 * deadline has passed. The deadline is honoured immediately on read, so a poll
 * stops taking answers on time even between auto-close cron runs.
 */
function pollIsClosed(poll: Doc<"polls">, now = Date.now()) {
  if (poll.closedAt !== undefined) return true;
  return poll.closesAt !== undefined && now >= poll.closesAt;
}

/**
 * A poll plus the viewer's own answer, shaped for the announcement feed.
 * Costs one document read and one bounded index lookup, and only for the
 * handful of posts that actually carry a poll.
 */
async function pollFor(ctx: Ctx, post: Doc<"posts">, userId: Id<"users">) {
  if (!post.pollId) return null;
  const poll = await ctx.db.get(post.pollId);
  if (!poll) return null;
  const mine = await ctx.db
    .query("pollVotes")
    .withIndex("by_poll_user", (q) =>
      q.eq("pollId", poll._id).eq("userId", userId),
    )
    .collect();
  return {
    _id: poll._id,
    question: poll.question,
    allowMultiple: poll.allowMultiple,
    options: poll.options,
    counts: poll.counts,
    totalVotes: poll.totalVotes,
    voterCount: poll.voterCount,
    closed: pollIsClosed(poll),
    closedAt: poll.closedAt,
    closesAt: poll.closesAt,
    myOptionIds: mine.map((v) => v.optionId),
  };
}

/**
 * A poll with the names behind every option, for the administrator's
 * engagement view. One bounded index lookup, never touched by the feed.
 */
async function pollDetail(ctx: Ctx, poll: Doc<"polls">) {
  const votes = await ctx.db
    .query("pollVotes")
    .withIndex("by_poll", (q) => q.eq("pollId", poll._id))
    .collect();

  const byOption = new Map<string, { name: string; at: number }[]>();
  for (const v of votes) {
    const list = byOption.get(v.optionId) ?? [];
    list.push({ name: v.userName ?? "Member", at: v.createdAt });
    byOption.set(v.optionId, list);
  }

  return {
    _id: poll._id,
    question: poll.question,
    allowMultiple: poll.allowMultiple,
    closed: pollIsClosed(poll),
    closedAt: poll.closedAt,
    closesAt: poll.closesAt,
    totalVotes: poll.totalVotes,
    voterCount: poll.voterCount,
    options: poll.options.map((o) => ({
      id: o.id,
      text: o.text,
      count: poll.counts[o.id] ?? 0,
      voters: (byOption.get(o.id) ?? []).sort((a, b) => b.at - a.at),
    })),
  };
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
    // Guests get no media URLs, even for posts they could guess the id of.
    if (!user || user.isAnonymous) return null;
    const post = await ctx.db.get(args.postId);
    if (!post) return null;
    // Verify the storageId actually belongs to this post's media
    const owns = post.media?.some((m) => m.storageId === args.storageId);
    if (!owns) return null;
    return await ctx.storage.getUrl(args.storageId as any);
  },
});

/**
 * Browse/search team posts (any signed-in user can read).
 *
 * The feed is paginated and reads engagement from the denormalized counters on
 * each post, so a busy feed never scans the comments/reactions/views tables —
 * those grow with usage while this stays proportional to the page size.
 */
export const list = query({
  args: {
    search: v.optional(v.string()),
    author: v.optional(v.string()),
    /** How many posts to load (default 20, max 100). The feed grows this
     *  window when the reader asks for more instead of loading everything. */
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    // Announcements are for signed-in team members (including ordinary
    // members), but never for anonymous guest accounts.
    if (!user || user.isAnonymous) return [];

    const limit = Math.min(Math.max(Math.trunc(args.limit ?? 20), 1), 100);

    // Sorting: pinned first, then newest.
    const byPinnedThenRecent = (a: Doc<"posts">, b: Doc<"posts">) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return b.createdAt - a.createdAt;
    };

    let page: Doc<"posts">[];
    if (args.search || args.author) {
      // Filtered browsing inspects the posts table, which holds one row per
      // announcement. Engagement is still only loaded for the returned page.
      let posts = await ctx.db.query("posts").collect();
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
      posts.sort(byPinnedThenRecent);
      page = posts.slice(0, limit);
    } else {
      const recent = await ctx.db
        .query("posts")
        .withIndex("createdAt")
        .order("desc")
        .take(limit);
      // Pinned announcements stay at the top of the first page, however old.
      const pinned = await ctx.db
        .query("posts")
        .withIndex("by_pinned", (q) => q.eq("isPinned", true))
        .order("desc")
        .take(5);
      const seen = new Set(recent.map((p) => p._id));
      page = [...pinned.filter((p) => !seen.has(p._id)), ...recent];
    }

    // This user's own reactions: one lookup, bounded by their own activity.
    const myReactions = await ctx.db
      .query("postReactions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const mine = new Map<string, string>();
    for (const r of myReactions) {
      if (r.targetType === "post") mine.set(r.targetId, r.kind);
    }

    return await Promise.all(
      page.map(async (p) => ({
        ...p,
        ...(await engagementFor(ctx, p)),
        myReaction: mine.get(p._id) ?? null,
        poll: await pollFor(ctx, p, user._id),
      })),
    );
  },
});

/**
 * Distinct post authors, for the feed's author filter. Bounded to the most
 * recent announcements and never touches the engagement tables, so it stays a
 * cheap read even as reactions and views pile up.
 */
export const authors = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user || user.isAnonymous) return [];
    const posts = await ctx.db
      .query("posts")
      .withIndex("createdAt")
      .order("desc")
      .take(200);
    const names = new Set<string>();
    for (const p of posts) if (p.author) names.add(p.author);
    return [...names].sort((a, b) => a.localeCompare(b));
  },
});

/** Single post with its comment thread. */
export const get = query({
  args: { id: v.id("posts") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user || user.isAnonymous) return null;
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
      poll: await pollFor(ctx, post, user._id),
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

    // Read the post's counters before touching the reaction row, so the deltas
    // applied below are relative to the pre-change totals.
    const eng = args.targetType === "post" ? await engagementFor(ctx, post) : null;

    const removing = !!existing && existing.kind === args.kind;
    const userName = user.name ?? user.email ?? "Member";

    if (removing) {
      await ctx.db.delete(existing!._id);
    } else if (existing) {
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

    // Keep the post's denormalized counters in step (one extra write, no scans).
    if (eng) {
      const summary = { ...eng.reactionKinds };
      const bump = (k: string, delta: number) => {
        const next = (summary[k] ?? 0) + delta;
        if (next > 0) summary[k] = next;
        else delete summary[k];
      };
      if (removing) bump(args.kind, -1);
      else {
        if (existing) bump(existing.kind, -1);
        bump(args.kind, 1);
      }
      await ctx.db.patch(args.postId, {
        ...eng,
        reactionCount: Object.values(summary).reduce((a, b) => a + b, 0),
        reactionKinds: summary,
      });
    }

    return { kind: removing ? null : args.kind };
  },
});

/**
 * Count a view of a post — at most once per account, ever.
 *
 * A view belongs to the account that opened the post: one person scrolls back
 * to the same announcement as often as they like and still counts once, while
 * each new person adds one. Re-opening a post you have already viewed only
 * refreshes the "last viewed" time (at most once per VIEW_REFRESH_MS) so the
 * engagement list stays ordered by recency.
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

    // Already counted for this account — never count them again.
    if (existing) {
      if (now - existing.lastViewedAt >= VIEW_REFRESH_MS) {
        await ctx.db.patch(existing._id, { lastViewedAt: now, userName });
      }
      return { recorded: false };
    }

    await ctx.db.insert("postViews", {
      postId: args.postId,
      userId: user._id,
      userName,
      views: 1,
      firstViewedAt: now,
      lastViewedAt: now,
    });
    // Read the counters before the row was added, so the increment is exact even
    // for posts that predate the denormalized fields.
    const eng = await engagementFor(ctx, post);
    await ctx.db.patch(args.postId, {
      ...eng,
      viewCount: eng.viewCount + 1,
      viewerCount: eng.viewerCount + 1,
    });
    return { recorded: true };
  },
});

/**
 * Full engagement detail for one post: who reacted, who viewed it, the
 * comment/reply activity, and — when the post carries one — which people chose
 * which poll option.
 *
 * Identities are revealed to administrators, evangelism coordinators, and the
 * author of that specific post/poll. Everyone else gets the counts they
 * already see in the feed; nothing here is returned to them at all.
 */
export const engagementDetails = query({
  args: { postId: v.id("posts") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user || user.isAnonymous) return null;
    const post = await ctx.db.get(args.postId);
    if (!post) return null;
    if (!canManagePost(user, post)) return null;

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

    const breakdown: Record<string, number> = {};
    const reactors: { name: string; kind: string; at: number }[] = [];
    for (const r of reactions) {
      breakdown[r.kind] = (breakdown[r.kind] ?? 0) + 1;
      if (r.targetType === "post") {
        reactors.push({ name: r.userName ?? "Member", kind: r.kind, at: r.createdAt });
      }
    }
    reactors.sort((a, b) => b.at - a.at);

    const poll = post.pollId ? await ctx.db.get(post.pollId) : null;
    const roots = comments.filter((c) => !c.parentId);
    const commenters = new Set<string>();
    for (const c of comments) {
      if (c.authorId) commenters.add(c.authorId);
    }

    return {
      postId: args.postId,
      title: post.title,
      createdAt: post.createdAt,
      // views — one per account, so the row count is the view count
      viewCount: views.length,
      viewerCount: views.length,
      viewers: views
        .sort((a, b) => b.lastViewedAt - a.lastViewedAt)
        .map((v) => ({
          // Views are one per account now, so all a viewer entry carries is who
          // they are and when they last opened the post.
          name: v.userName ?? "Member",
          lastViewedAt: v.lastViewedAt,
        })),
      // reactions
      reactionCount: reactions.length,
      reactionBreakdown: (Object.entries(breakdown) as [string, number][])
        .map(([kind, count]) => ({ kind, count }))
        .sort((a, b) => b.count - a.count),
      reactors,
      // poll — which people answered which option, by name
      poll: poll ? await pollDetail(ctx, poll) : null,
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

/**
 * Post an update / announcement. Any signed-in team member can post.
 *
 * A post needs a title and content — unless it is a standalone poll, which can
 * be published on its own with neither.
 */
export const create = mutation({
  args: {
    title: v.optional(v.string()),
    body: v.optional(v.string()),
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
    /** Optional poll attached to this announcement. */
    poll: v.optional(
      v.object({
        question: v.string(),
        allowMultiple: v.boolean(),
        options: v.array(v.string()),
        /** Deadline in epoch ms; the poll stops taking answers then. */
        closesAt: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [
      ROLES.COORDINATOR,
      ROLES.WORKER,
      ROLES.LEADER,
    ]);
    await checkRateLimit(ctx, "post.create");
    // A standalone poll carries no title/content of its own.
    const standalonePoll = args.poll !== undefined;
    const title = standalonePoll
      ? (args.title ?? "").trim()
      : validatePostTitle(args.title ?? "");
    const body = standalonePoll
      ? (args.body ?? "").trim()
      : validatePostBody(args.body ?? "");
    if (title.length > 500) {
      throw new ConvexError("Title must be 500 characters or fewer");
    }
    if (body.length > 10000) {
      throw new ConvexError("Content must be 10000 characters or fewer");
    }

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

    // Validate the poll up front, so a bad option list fails before any writes.
    let pollInput:
      | {
          question: string;
          allowMultiple: boolean;
          options: PollOptions;
          closesAt?: number;
        }
      | undefined;
    if (args.poll) {
      const question = args.poll.question.trim();
      if (!question) throw new ConvexError("Poll question is required");
      if (question.length > MAX_POLL_QUESTION) {
        throw new ConvexError(
          `Poll question must be ${MAX_POLL_QUESTION} characters or fewer`,
        );
      }
      const texts = args.poll.options.map((o) => o.trim()).filter(Boolean);
      if (texts.length < MIN_POLL_OPTIONS) {
        throw new ConvexError(
          `A poll needs at least ${MIN_POLL_OPTIONS} options`,
        );
      }
      if (texts.length > MAX_POLL_OPTIONS) {
        throw new ConvexError(
          `A poll can have at most ${MAX_POLL_OPTIONS} options`,
        );
      }
      if (texts.some((t) => t.length > MAX_POLL_OPTION)) {
        throw new ConvexError(
          `Each option must be ${MAX_POLL_OPTION} characters or fewer`,
        );
      }
      if (new Set(texts.map((t) => t.toLowerCase())).size !== texts.length) {
        throw new ConvexError("Poll options must all be different");
      }
      // Optional auto-close deadline, validated against the server clock.
      let closesAt: number | undefined;
      if (args.poll.closesAt !== undefined) {
        const t = args.poll.closesAt;
        if (!Number.isFinite(t)) {
          throw new ConvexError("That close time is not a valid date");
        }
        if (t <= now + 60_000) {
          throw new ConvexError(
            "The close time must be at least a minute in the future",
          );
        }
        if (t > now + 365 * 24 * 60 * 60 * 1000) {
          throw new ConvexError("The close time must be within a year");
        }
        closesAt = t;
      }
      pollInput = {
        question,
        allowMultiple: args.poll.allowMultiple,
        options: texts.map((text, i) => ({ id: `opt${i + 1}`, text })),
        closesAt,
      };
    }

    const id = await ctx.db.insert("posts", {
      author: user.name ?? user.email,
      authorId: user._id,
      title,
      body,
      tags: args.tags,
      media: args.media,
      isPinned: false,
      // Denormalized engagement counters start at zero.
      commentCount: 0,
      reactionCount: 0,
      reactionKinds: {},
      viewCount: 0,
      viewerCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    // Attach the poll (one per announcement) and point the post at it.
    if (pollInput) {
      const pollId = await ctx.db.insert("polls", {
        postId: id,
        question: pollInput.question,
        allowMultiple: pollInput.allowMultiple,
        options: pollInput.options,
        counts: {},
        totalVotes: 0,
        voterCount: 0,
        closesAt: pollInput.closesAt,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(id, { pollId });
    }

    await logAudit(ctx, {
      action: "post.create",
      entityType: "posts",
      entityId: id,
      details: pollInput ? `Poll: ${pollInput.question}` : title,
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
            title: pollInput ? "New poll" : "New announcement",
            body: `${user.name ?? user.email ?? "Someone"}: ${
              pollInput
                ? pollInput.question
                : title || body || "posted an update"
            }`,
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
 * Answer a poll, change an answer, or clear it.
 *
 * A single-answer poll takes exactly one option; a multiple-answer poll takes
 * any non-empty subset. Voting replaces the caller's previous rows, and the
 * denormalized totals on the poll are recomputed from the rows being removed
 * and added, so they can never drift.
 */
export const vote = mutation({
  args: {
    postId: v.id("posts"),
    /** Empty clears the caller's vote (single-answer polls use this to unset). */
    optionIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user || user.isAnonymous) {
      throw new ConvexError("Sign in to answer this poll");
    }
    await checkRateLimit(ctx, "poll.vote");

    const poll = await ctx.db
      .query("polls")
      .withIndex("by_post", (q) => q.eq("postId", args.postId))
      .first();
    if (!poll) throw new ConvexError("This announcement has no poll");
    if (pollIsClosed(poll)) throw new ConvexError("This poll is closed");

    const chosen = [...new Set(args.optionIds)];
    const known = new Set(poll.options.map((o) => o.id));
    if (chosen.some((id) => !known.has(id))) {
      throw new ConvexError("That option is not part of this poll");
    }
    if (!poll.allowMultiple && chosen.length > 1) {
      throw new ConvexError("This poll accepts one answer only");
    }

    const existing = await ctx.db
      .query("pollVotes")
      .withIndex("by_poll_user", (q) =>
        q.eq("pollId", poll._id).eq("userId", user._id),
      )
      .collect();

    const counts: Record<string, number> = { ...poll.counts };
    for (const row of existing) {
      await ctx.db.delete(row._id);
      counts[row.optionId] = Math.max((counts[row.optionId] ?? 1) - 1, 0);
    }

    const now = Date.now();
    for (const optionId of chosen) {
      await ctx.db.insert("pollVotes", {
        pollId: poll._id,
        postId: args.postId,
        optionId,
        userId: user._id,
        userName: user.name ?? user.email,
        createdAt: now,
      });
      counts[optionId] = (counts[optionId] ?? 0) + 1;
    }

    const wasVoter = existing.length > 0;
    const isVoter = chosen.length > 0;
    const voterCount = Math.max(
      poll.voterCount + (isVoter && !wasVoter ? 1 : !isVoter && wasVoter ? -1 : 0),
      0,
    );
    const totalVotes = Object.values(counts).reduce((sum, n) => sum + n, 0);

    await ctx.db.patch(poll._id, {
      counts,
      totalVotes,
      voterCount,
      updatedAt: now,
    });

    return { counts, totalVotes, voterCount, myOptionIds: chosen };
  },
});

/**
 * Close a poll so no further answers are accepted, or reopen it. The author or
 * an administrator can do this; closing is reversible, so no result is lost.
 */
export const setPollClosed = mutation({
  args: { postId: v.id("posts"), closed: v.boolean() },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [
      ROLES.COORDINATOR,
      ROLES.WORKER,
      ROLES.LEADER,
    ]);
    const post = await ctx.db.get(args.postId);
    if (!post) throw new ConvexError("Post not found");
    if (!canManagePost(user, post)) {
      throw new ConvexError("You can only close your own poll");
    }

    const poll = await ctx.db
      .query("polls")
      .withIndex("by_post", (q) => q.eq("postId", args.postId))
      .first();
    if (!poll) throw new ConvexError("This announcement has no poll");

    const now = Date.now();
    // Reopening a poll whose deadline has already passed clears that deadline —
    // otherwise it would be closed again the moment it is read.
    const closesAt =
      !args.closed && poll.closesAt !== undefined && poll.closesAt <= now
        ? undefined
        : poll.closesAt;
    await ctx.db.patch(poll._id, {
      closedAt: args.closed ? now : undefined,
      closesAt,
      updatedAt: now,
    });
    await logAudit(ctx, {
      action: args.closed ? "poll.close" : "poll.reopen",
      entityType: "polls",
      entityId: poll._id,
      details: poll.question,
    });
  },
});

/**
 * Close every poll whose auto-close deadline has passed (run by a cron every
 * few minutes). Answers stop being accepted the moment the deadline passes —
 * this only stamps the poll closed and tells the people who can announce the
 * result, so the feed stops showing it as open for voting.
 */
export const closeDuePolls = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // Convex orders `undefined` before every real value, so a bare upper bound
    // would also match polls that have no deadline at all. The lower bound
    // keeps the range to polls that really did set one.
    const due = await ctx.db
      .query("polls")
      .withIndex("by_closesAt", (q) =>
        q.gte("closesAt", 0).lte("closesAt", now),
      )
      .collect();

    let closedCount = 0;
    for (const poll of due) {
      // Belt and braces: never touch a poll without a deadline.
      if (poll.closesAt === undefined) continue;
      if (poll.closedAt !== undefined) continue;
      await ctx.db.patch(poll._id, {
        closedAt: poll.closesAt ?? now,
        updatedAt: now,
      });
      closedCount += 1;

      // The author and the people who may announce a result.
      const post = await ctx.db.get(poll.postId);
      const recipients: Id<"users">[] = [];
      if (post?.authorId) recipients.push(post.authorId);
      const staff = await ctx.db.query("users").collect();
      for (const u of staff) {
        if (u.isAnonymous) continue;
        if (hasRole(u, ROLES.ADMIN) || hasRole(u, ROLES.COORDINATOR)) {
          recipients.push(u._id);
        }
      }
      if (recipients.length > 0) {
        await notifyUsers(ctx, {
          userIds: recipients,
          kind: "poll_closed",
          title: "Poll closed",
          body: `${poll.question.slice(0, 90)} — ${poll.totalVotes} ${
            poll.totalVotes === 1 ? "vote" : "votes"
          }. Announce the result to share it.`,
          url: `/announcements?post=${poll.postId}`,
        });
      }

      await logAudit(ctx, {
        action: "poll.auto_close",
        entityType: "polls",
        entityId: poll._id,
        details: poll.question,
      });
    }
    return closedCount;
  },
});

/** Headline for a poll's outcome, e.g. "Saturday outreach won with 5 of 9 votes (56%)". */
function pollOutcome(poll: Doc<"polls">) {
  const ranked = poll.options
    .map((o) => ({ text: o.text, count: poll.counts[o.id] ?? 0 }))
    .sort((a, b) => b.count - a.count);
  const top = ranked[0];
  const pct = poll.totalVotes > 0 ? Math.round((top.count / poll.totalVotes) * 100) : 0;
  return {
    ranked,
    headline: `${top.text} ${poll.allowMultiple ? "led" : "won"} with ${top.count} of ${poll.totalVotes} votes (${pct}%)`,
  };
}

/**
 * Announce a poll's result to the whole ministry: a results comment on the
 * announcement (so the outcome sits in the thread right under the poll) plus a
 * device push notification for every signed-in member.
 *
 * Allowed for the post's author, a coordinator, or an administrator — the same
 * people who may see who voted and close the poll.
 */
export const announcePollResult = mutation({
  args: { postId: v.id("posts") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user || user.isAnonymous) {
      throw new ConvexError("Sign in to announce results");
    }
    const post = await ctx.db.get(args.postId);
    if (!post) throw new ConvexError("Post not found");
    if (!canManagePost(user, post)) {
      throw new ConvexError("You can only announce results for your own poll");
    }
    await checkRateLimit(ctx, "poll.announce");

    const poll = await ctx.db
      .query("polls")
      .withIndex("by_post", (q) => q.eq("postId", args.postId))
      .first();
    if (!poll) throw new ConvexError("This announcement has no poll");
    if (poll.totalVotes === 0) {
      throw new ConvexError("Nobody has voted yet — there is no result to announce");
    }

    const { ranked, headline } = pollOutcome(poll);
    const body = [
      `Poll result — ${poll.question}`,
      "",
      headline,
      ...ranked.map((r) => `${r.text} — ${r.count} ${r.count === 1 ? "vote" : "votes"}`),
      "",
      `${poll.totalVotes} ${poll.totalVotes === 1 ? "vote" : "votes"} from ${poll.voterCount} ${poll.voterCount === 1 ? "person" : "people"}`,
      `Announced by ${user.name ?? user.email ?? "a leader"}`,
    ].join("\n");

    // In-app: a comment on the announcement, so the result is visible to
    // everyone who opens the feed — not only to those who can see details.
    const eng = await engagementFor(ctx, post);
    const commentId = await ctx.db.insert("comments", {
      postId: args.postId,
      author: user.name ?? user.email ?? "Member",
      authorId: user._id,
      body,
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.postId, {
      ...eng,
      commentCount: eng.commentCount + 1,
    });

    // Device push to every signed-in member (mirrors the post/comment flow).
    try {
      const allUsers = await ctx.db.query("users").collect();
      const recipientIds = allUsers
        .filter((u) => !u.isAnonymous)
        .map((u) => u._id);
      if (recipientIds.length > 0) {
        const ts = Date.now();
        const jobId = await ctx.db.insert("notificationJobs", {
          kind: "poll_result",
          dedupeKey: `poll-result:${poll._id}:${poll.totalVotes}`,
          deliverAt: ts,
          status: "scheduled",
          payload: {
            title: "Poll result",
            body: `${poll.question.slice(0, 70)} — ${headline}`,
            url: `/announcements?post=${args.postId}`,
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
      console.error("[posts] Poll result push scheduling failed:", err);
      try {
        await ctx.db.insert("pushDeliveryLogs", {
          jobId: undefined,
          endpoint: `poll:${poll._id}`,
          success: false,
          error: `Poll result notification scheduling failed: ${String(err)}`,
          createdAt: Date.now(),
        });
      } catch { /* best effort */ }
    }

    await logAudit(ctx, {
      action: "poll.announce",
      entityType: "polls",
      entityId: poll._id,
      details: `${poll.question} — ${headline}`,
    });

    return { commentId, headline };
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
    // Read the post counters before inserting the comment so the increment is
    // exact even for posts that predate the denormalized fields.
    const eng = await engagementFor(ctx, post);

    const id = await ctx.db.insert("comments", {
      postId: args.postId,
      parentId: args.parentId,
      author: user.name ?? user.email ?? "Member",
      authorId: user._id,
      body,
      createdAt: Date.now(),
    });

    await ctx.db.patch(args.postId, {
      ...eng,
      commentCount: eng.commentCount + 1,
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
    // `hasRole` (not the legacy single `user.role`) so a dual-role administrator
    // is recognised, and an admin "testing as" another role is not.
    if (!hasRole(user, ROLES.ADMIN) && post.authorId !== user._id) {
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

    // Hard-delete the poll and every vote cast on it
    const pollId = post.pollId;
    if (pollId) {
      const pollVotes = await ctx.db
        .query("pollVotes")
        .withIndex("by_poll", (q) => q.eq("pollId", pollId))
        .collect();
      for (const vote of pollVotes) {
        await ctx.db.delete(vote._id);
      }
      await ctx.db.delete(pollId);
    }

    // Hard-delete the post itself
    await ctx.db.delete(args.id);
    await logAudit(ctx, {
      action: "post.delete",
      entityType: "posts",
      entityId: args.id,
      details: post.title.trim() || (post.pollId ? "Poll" : "Announcement"),
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
    if (!hasRole(user, ROLES.ADMIN) && comment.authorId !== user._id) {
      throw new ConvexError("You can only remove your own comments");
    }
    // Read the post counters before deleting anything so the decrement is
    // exact, then hard-delete the replies and the comment itself. Only this
    // post's comments are fetched, via the postId index.
    const post = await ctx.db.get(comment.postId);
    const eng = post ? await engagementFor(ctx, post) : null;

    const replies = await ctx.db
      .query("comments")
      .withIndex("postId", (q) => q.eq("postId", comment.postId))
      .collect();
    const removedIds = new Set<string>([args.id]);
    for (const r of replies) {
      if (r.parentId === args.id) {
        removedIds.add(r._id);
        await ctx.db.delete(r._id);
      }
    }
    await ctx.db.delete(args.id);

    if (post && eng) {
      await ctx.db.patch(post._id, {
        ...eng,
        commentCount: Math.max(0, eng.commentCount - removedIds.size),
      });
    }

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

/**
 * One-off repair for posts counted under the old multi-view rule: every post's
 * view counter is set to its number of distinct viewer rows, and any legacy row
 * that counted a reader more than once is clamped to a single view.
 *
 * Safe to re-run (it only writes what is already wrong) and batched so a large
 * feed cannot time out. New posts never need it: views.recordView counts one per
 * account from the start.
 */
export const repairViewCounts = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const posts = await ctx.db.query("posts").collect();
    const rows = await ctx.db.query("postViews").collect();

    const rowsByPost = new Map<string, Doc<"postViews">[]>();
    for (const row of rows) {
      const list = rowsByPost.get(row.postId) ?? [];
      list.push(row);
      rowsByPost.set(row.postId, list);
    }

    let repairedPosts = 0;
    let repairedRows = 0;
    const limit = args.limit ?? 50;
    for (const post of posts) {
      if (repairedPosts >= limit) break;
      const postRows = rowsByPost.get(post._id) ?? [];
      const distinctViewers = new Set(postRows.map((r) => r.userId)).size;
      const stale =
        post.viewCount !== distinctViewers ||
        post.viewerCount !== distinctViewers ||
        postRows.some((r) => r.views !== 1);
      if (!stale) continue;
      for (const row of postRows) {
        if (row.views !== 1) {
          await ctx.db.patch(row._id, { views: 1 });
          repairedRows += 1;
        }
      }
      await ctx.db.patch(post._id, {
        viewCount: distinctViewers,
        viewerCount: distinctViewers,
      });
      repairedPosts += 1;
    }

    return { repairedPosts, repairedRows };
  },
});

/**
 * Repair posts created before the denormalized engagement counters existed.
 * Safe to re-run: it only touches documents that are missing counters, and
 * every value is recomputed from the source rows.
 */
export const backfillEngagement = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const posts = await ctx.db.query("posts").collect();
    const stale = posts.filter(
      (p) =>
        p.commentCount === undefined ||
        p.reactionCount === undefined ||
        p.reactionKinds === undefined ||
        p.viewCount === undefined ||
        p.viewerCount === undefined,
    );
    const batch = stale.slice(0, args.limit ?? 50);
    for (const p of batch) {
      await ctx.db.patch(p._id, await computeEngagement(ctx, p._id));
    }
    return { repaired: batch.length, remaining: stale.length - batch.length };
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
