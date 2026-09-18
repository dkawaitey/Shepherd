import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  EmptyState,
  PageHeader,
  fmtDateTime,
  formatError,
} from "@/components/shared";
import {
  REACTIONS,
  REACTION_BY_KIND,
  REACTION_FALLBACK,
  ROLES,
} from "@/convex/constants";
import { userHasRole, userIsAdmin } from "@/components/shared";

import {
  Check,
  FileIcon,
  MessageSquare,
  Paperclip,
  Pin,
  Plus,
  Search,
  Send,
  Trash2,
  X,
  UserRound,
  Music,
  AlertCircle,
  Eye,
  Megaphone,
  Heart,
  BarChart3,
  Activity,
  Users,
} from "lucide-react";

// ── Client-side media helpers ──────────────────────────────────────
const ALLOWED_MIME = new Set([
  "image/jpeg", "image/png", "image/webp", "image/avif",
  "video/mp4", "video/webm",
  "audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg", "audio/webm",
  "application/pdf",
]);
const MAX_SIZES: Record<string, number> = { image: 8 * 1024 * 1024, video: 18 * 1024 * 1024, audio: 12 * 1024 * 1024, file: 10 * 1024 * 1024 };
const MAX_MEDIA = 5;
/** How many posts the feed loads at a time — "Load older posts" grows it. */
const FEED_PAGE_SIZE = 20;
const MAX_FEED_POSTS = 100;
const MAX_IMAGE_DIM = 1920;
const THUMB_SIZE = 320;

function classifyMime(m: string): "image" | "video" | "audio" | "file" {
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "file";
}
function formatBytes(b: number) { return b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`; }

async function optimizeImage(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); let w = img.naturalWidth, h = img.naturalHeight;
      if (w > MAX_IMAGE_DIM || h > MAX_IMAGE_DIM) { const s = MAX_IMAGE_DIM / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
      const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d")!.drawImage(img, 0, 0, w, h);
      c.toBlob((b) => b ? resolve({ blob: b, width: w, height: h }) : reject(new Error("Compress failed")), "image/jpeg", 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Load failed")); };
    img.src = url;
  });
}

async function generateThumbnail(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); let w = img.naturalWidth, h = img.naturalHeight;
      if (w > THUMB_SIZE || h > THUMB_SIZE) { const s = THUMB_SIZE / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
      const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d")!.drawImage(img, 0, 0, w, h);
      c.toBlob((b) => b ? resolve(b) : reject(new Error("Thumb failed")), "image/jpeg", 0.75);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Thumb load failed")); };
    img.src = url;
  });
}

/** Shape we send when uploading: every metadata field is set here. */
type MediaItem = { storageId: string; type: string; name: string; mimeType: string; size: number; width?: number; height?: number; thumbnailStorageId?: string; status: string; uploadedAt: number; };

/**
 * Shape we read back. Files uploaded before the media metadata existed only
 * have `storageId`, `type` and `name`, so the rest is optional here — the
 * renderer only needs those three.
 */
type StoredMediaItem = Pick<MediaItem, "storageId" | "type" | "name"> &
  Partial<Omit<MediaItem, "storageId" | "type" | "name">>;


export default function Announcements() {
  const [search, setSearch] = useState("");
  const [author, setAuthor] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [limit, setLimit] = useState(FEED_PAGE_SIZE);

  // Deep link from a notification: /announcements?post=<id>[&c=<commentId>]
  // opens that thread and scrolls to the post (or the exact comment/reply).
  const [searchParams] = useSearchParams();
  const urlPost = searchParams.get("post");
  const urlComment = searchParams.get("c");
  useEffect(() => {
    if (!urlPost) return;
    setExpanded(urlPost);
    const t = setTimeout(() => {
      const el = urlComment
        ? document.getElementById(`comment-${urlComment}`)
        : document.getElementById(`post-${urlPost}`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
    return () => clearTimeout(t);
  }, [urlPost, urlComment]);

  // Growing window instead of loading every announcement: the feed stays fast
  // as the ministry accumulates posts.
  const posts = useQuery(api.posts.list, {
    search: search || undefined,
    author: author || undefined,
    limit,
  });
  const me = useQuery(api.users.currentUser);
  // Administrators may hold several roles, so check the whole set (and honour
  // "test as", exactly like the server's hasRole).
  const isAdmin = userIsAdmin(me);
  const isCoordinator = userHasRole(me, ROLES.COORDINATOR);
  const removePost = useMutation(api.posts.remove);

  // A new search or author filter starts from the first page again.
  useEffect(() => {
    setLimit(FEED_PAGE_SIZE);
  }, [search, author]);

  // Author list comes from its own bounded query, not from the loaded page, so
  // filters keep working when older posts aren't loaded yet.
  const authors = useQuery(api.posts.authors) ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Announcements"
        code="ann"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> New post
          </Button>
        }
      />

      <div className="mb-5 grid gap-2 sm:grid-cols-[1fr_220px]">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search posts by title, content or tag..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          className="rounded-md border bg-transparent px-3 py-2 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="">All authors</option>
          {authors.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      {posts === undefined ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-lg border bg-card" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <EmptyState
          title="No posts yet"
          message="Post the first update for the team — a testimony, an announcement or an encouragement."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> New post
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {posts.map((p) => (
            <PostCard
              key={p._id}
              post={p}
              meId={me?._id}
              isAdmin={isAdmin}
              isCoordinator={isCoordinator}
              isOpen={expanded === p._id}
              onToggle={() => setExpanded(expanded === p._id ? null : p._id)}
              onRemove={async () => {
                await removePost({ id: p._id });
                toast.success("Post removed");
              }}
            />
          ))}
          {posts.length >= limit && limit < MAX_FEED_POSTS && (
            <div className="flex justify-center pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setLimit((l) => Math.min(MAX_FEED_POSTS, l + FEED_PAGE_SIZE))
                }
              >
                Load older posts
              </Button>
            </div>
          )}
        </div>
      )}

      <CreatePostDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

// ── Engagement helpers ─────────────────────────────────────────────

/** Short relative time, e.g. "4m", "3h", "2d". */
function timeAgo(ts: number) {
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDateTime(new Date(ts).toISOString());
}

function reactionMeta(kind: string) {
  return REACTION_BY_KIND[kind] ?? { ...REACTION_FALLBACK, kind };
}

/**
 * Every emoji that has been chosen, with its live count — the pill beside the
 * react button. The reader's own reaction is included here, so the button
 * itself only has to show which emoji they picked.
 */
function ReactionSummary({ kinds }: { kinds: Record<string, number> }) {
  const entries = Object.entries(kinds ?? {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {entries.map(([kind, count]) => (
        <span
          key={kind}
          title={`${count} ${reactionMeta(kind).label}`}
          className="flex items-center gap-1 rounded-full border border-border/70 bg-muted/50 px-1.5 py-0.5 text-[10px] leading-none"
        >
          <span className="text-[11px]">{reactionMeta(kind).emoji}</span>
          <span className="font-semibold tabular-nums text-foreground/80">
            {count}
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * Reaction control for a post or a comment/reply. Opens a small palette on
 * tap (works on touch screens), and tapping the active reaction clears it.
 */
function ReactionPicker({
  postId,
  targetType,
  targetId,
  mine,
  compact = false,
}: {
  postId: string;
  targetType: "post" | "comment";
  targetId: string;
  mine: string | null;
  /** Total reactions — shown beside the button by ReactionSummary, not here. */
  count: number;
  compact?: boolean;
}) {
  const react = useMutation(api.posts.react);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = mine ? reactionMeta(mine) : null;

  const choose = async (kind: string) => {
    setBusy(true);
    try {
      await react({ postId: postId as any, targetType, targetId, kind });
      setOpen(false);
    } catch (err) {
      toast.error(formatError(err, "Could not save your reaction"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={busy}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
            current
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border bg-muted/40 text-muted-foreground hover:text-primary",
            busy && "opacity-60",
          )}
        >
          {/* This reader's own emoji only — no description, no count. The
              live breakdown beside the pill shows every emoji and its count. */}
          {current ? (
            <span className={compact ? "text-[12px]" : "text-sm"}>{current.emoji}</span>
          ) : (
            <>
              <Heart className="h-3 w-3" />
              {!compact && <span>React</span>}
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-auto p-1.5">
        <div className="flex items-center gap-0.5">
          {REACTIONS.map((r) => (
            <button
              key={r.kind}
              type="button"
              title={mine === r.kind ? `${r.label} (tap to remove)` : r.label}
              onClick={() => choose(r.kind)}
              className={cn(
                "rounded-md px-2 py-1 text-base leading-none transition-colors hover:bg-accent",
                mine === r.kind && "bg-accent",
              )}
            >
              {r.emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Counts a view once the post has actually been on screen for a moment. */
function useViewTracker(postId: string, enabled: boolean) {
  const ref = useRef<HTMLElement | null>(null);
  const recorded = useRef(false);
  const recordView = useMutation(api.posts.recordView);

  useEffect(() => {
    if (!enabled || recorded.current) return;
    const el = ref.current;
    if (!el) return;

    // No IntersectionObserver (very old browser): count it and move on.
    if (typeof IntersectionObserver === "undefined") {
      recorded.current = true;
      void recordView({ postId: postId as any }).catch(() => undefined);
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.4);
        if (!visible || recorded.current) return;
        recorded.current = true;
        observer.disconnect();
        // Brief dwell so scrolling straight past doesn't count.
        timer = setTimeout(() => {
          void recordView({ postId: postId as any }).catch(() => undefined);
        }, 1200);
      },
      { threshold: [0.4] },
    );
    observer.observe(el);

    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, postId, recordView]);

  return ref;
}

/** A poll as the feed receives it, including the viewer's own answer. */
type FeedPoll = {
  _id: string;
  question: string;
  allowMultiple: boolean;
  options: { id: string; text: string }[];
  counts: Record<string, number>;
  totalVotes: number;
  voterCount: number;
  closed: boolean;
  myOptionIds: string[];
};

type FeedPost = {
  _id: string;
  author?: string;
  authorId?: string;
  title: string;
  body: string;
  tags?: string[];
  media?: StoredMediaItem[];
  isPinned?: boolean;
  createdAt: number;
  commentCount: number;
  reactionCount: number;
  reactionKinds: Record<string, number>;
  myReaction: string | null;
  viewCount: number;
  viewerCount: number;
  poll: FeedPoll | null;
};

/**
 * A poll under an announcement. Results are always visible, and the viewer's
 * own answer is highlighted: single-answer polls vote on tap (tapping your own
 * answer clears it, like a reaction), multiple-answer polls collect a selection
 * and submit it together.
 */
function PollCard({
  postId,
  poll,
  canManage = false,
}: {
  postId: string;
  poll: FeedPoll;
  /**
   * The post's author, an evangelism coordinator or an administrator may
   * close/reopen the poll and announce its result — the same people who may
   * see who voted for what.
   */
  canManage?: boolean;
}) {
  const vote = useMutation(api.posts.vote);
  const setClosed = useMutation(api.posts.setPollClosed);
  const announce = useMutation(api.posts.announcePollResult);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [announcing, setAnnouncing] = useState(false);
  // Local selection for multiple-answer polls. Deliberately not synced from the
  // query result on every render: the feed re-runs whenever anyone votes, which
  // would wipe a selection the reader is still making.
  const [picked, setPicked] = useState<string[]>(poll.myOptionIds);
  const voted = poll.myOptionIds.length > 0;

  const submit = async (optionIds: string[]) => {
    setBusy(true);
    try {
      await vote({ postId: postId as any, optionIds });
    } catch (err) {
      toast.error(formatError(err, "Could not record your vote"));
    } finally {
      setBusy(false);
    }
  };

  const onOptionClick = (id: string) => {
    if (busy || poll.closed) return;
    if (!poll.allowMultiple) {
      // Same answer twice clears the vote, the way reactions behave.
      submit(poll.myOptionIds.includes(id) ? [] : [id]);
      return;
    }
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleClosed = async () => {
    setClosing(true);
    try {
      await setClosed({ postId: postId as any, closed: !poll.closed });
      toast.success(poll.closed ? "Poll reopened" : "Poll closed");
    } catch (err) {
      toast.error(formatError(err, "Could not update the poll"));
    } finally {
      setClosing(false);
    }
  };

  // Announce the outcome: a results comment on the post, plus a device push
  // to every member (see posts.announcePollResult).
  const announceResult = async () => {
    setAnnouncing(true);
    try {
      const result = await announce({ postId: postId as any });
      toast.success(`Result announced — ${(result as any).headline}`);
    } catch (err) {
      toast.error(formatError(err, "Could not announce the result"));
    } finally {
      setAnnouncing(false);
    }
  };

  // Biggest option first, for the result line under a closed poll.
  const ranked = [...poll.options]
    .map((o) => ({ ...o, count: poll.counts[o.id] ?? 0 }))
    .sort((a, b) => b.count - a.count);
  const winner = ranked[0];

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
        <BarChart3 className="h-3 w-3" />
        Poll
        <span className="font-normal normal-case tracking-normal">
          · {poll.allowMultiple ? "choose one or more" : "choose one"}
          {poll.closed && " · closed"}
        </span>
      </div>
      <div className="mt-1.5 text-[13px] font-semibold">{poll.question}</div>

      <div className="mt-2 space-y-1.5">
        {poll.options.map((o) => {
          const count = poll.counts[o.id] ?? 0;
          const pct =
            poll.totalVotes > 0 ? Math.round((count / poll.totalVotes) * 100) : 0;
          const mine = poll.allowMultiple
            ? picked.includes(o.id)
            : poll.myOptionIds.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onOptionClick(o.id)}
              disabled={busy || poll.closed}
              aria-pressed={mine}
              className={cn(
                "relative flex w-full items-center gap-2 overflow-hidden rounded-lg border px-2.5 py-2 text-left transition-colors",
                mine
                  ? "border-primary/60 bg-primary/10"
                  : "border-border bg-card hover:border-primary/40",
                (busy || poll.closed) && "cursor-default opacity-90",
              )}
            >
              <span
                className="absolute inset-y-0 left-0 bg-primary/10"
                style={{ width: `${pct}%` }}
                aria-hidden
              />
              <span
                className={cn(
                  "relative flex h-4 w-4 shrink-0 items-center justify-center border",
                  poll.allowMultiple ? "rounded-[4px]" : "rounded-full",
                  mine
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/40",
                )}
              >
                {mine && <Check className="h-2.5 w-2.5" />}
              </span>
              <span className="relative flex-1 text-[12px] font-medium">
                {o.text}
              </span>
              <span className="relative shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {count} · {pct}%
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        <span>
          {poll.totalVotes} {poll.totalVotes === 1 ? "vote" : "votes"} ·{" "}
          {poll.voterCount} {poll.voterCount === 1 ? "person" : "people"}
        </span>
        {!poll.closed && !poll.allowMultiple && voted && (
          <span className="text-muted-foreground/70">
            Tap your answer again to clear it
          </span>
        )}
        {poll.closed && poll.totalVotes > 0 && (
          <span className="text-primary">
            Result: {winner.text} — {winner.count} of {poll.totalVotes}
          </span>
        )}
      </div>

      {((!poll.closed && poll.allowMultiple) || canManage) && (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
          {canManage && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px]"
              disabled={announcing || poll.totalVotes === 0}
              title="Post the result as a comment and send a device notification to everyone"
              onClick={announceResult}
            >
              <Megaphone className="mr-1 h-3 w-3" />
              {announcing ? "Announcing..." : "Announce result"}
            </Button>
          )}
          {canManage && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[10px] text-muted-foreground"
              disabled={closing}
              onClick={toggleClosed}
            >
              {poll.closed ? "Reopen poll" : "Close poll"}
            </Button>
          )}
          {!poll.closed && poll.allowMultiple && (
            <>
              <Button
                size="sm"
                className="h-7 text-[11px]"
                disabled={busy || picked.length === 0}
                onClick={() => submit(picked)}
              >
                {voted ? "Update my answers" : "Submit vote"}
              </Button>
              {voted && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px]"
                  disabled={busy}
                  onClick={() => {
                    setPicked([]);
                    submit([]);
                  }}
                >
                  Clear
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PostCard({
  post,
  meId,
  isAdmin,
  isCoordinator,
  isOpen,
  onToggle,
  onRemove,
}: {
  post: FeedPost;
  meId?: string;
  isAdmin: boolean;
  isCoordinator: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onRemove: () => Promise<void>;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const ref = useViewTracker(post._id, true);
  const isAuthor = !!meId && post.authorId === meId;
  const canDelete = isAdmin || isAuthor;
  // Engagement details (who viewed, reacted or voted) are open to
  // administrators, coordinators and the author of this post/poll — and the
  // server enforces the same rule (posts.engagementDetails).
  const canSeeDetails = isAdmin || isCoordinator || isAuthor;
  // Closing the poll and announcing its result follow the same permission.
  const canManagePoll = canSeeDetails;

  return (
    <article
      ref={ref}
      id={`post-${post._id}`}
      className="scroll-mt-20 overflow-hidden rounded-lg border bg-card"
    >
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-primary/30 bg-accent">
              <UserRound className="h-3.5 w-3.5 text-primary" />
            </span>
            <div>
              <div className="text-[13px] font-bold">{post.title}</div>
              <div className="text-[10px] text-muted-foreground">
                {post.author} · {fmtDateTime(new Date(post.createdAt).toISOString())}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {post.isPinned && (
              <span className="flex items-center gap-1 rounded border border-[#f59e0b]/40 bg-[#2e2408] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#fbbf24]">
                <Pin className="h-2.5 w-2.5" /> pinned
              </span>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                title="Remove post"
                onClick={onRemove}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        <p className="mt-3 whitespace-pre-wrap text-[13px] leading-6 text-foreground/90">
          {post.body}
        </p>

        {post.media && post.media.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {post.media.map((m, i) => (
              <PostMediaItem key={i} media={m} postId={post._id} />
            ))}
          </div>
        )}

        {post.tags && post.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {post.tags.map((t) => (
              <span key={t} className="rounded border border-border bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                #{t}
              </span>
            ))}
          </div>
        )}

        {post.poll && (
          <PollCard postId={post._id} poll={post.poll} canManage={canManagePoll} />
        )}

        {/* Engagement bar — reactions, comments and the live view counter. */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-dashed pt-3">
          <ReactionPicker
            postId={post._id}
            targetType="post"
            targetId={post._id}
            mine={post.myReaction}
            count={post.reactionCount}
          />
          <ReactionSummary kinds={post.reactionKinds} />

          <button
            onClick={onToggle}
            className="flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            <MessageSquare className="h-3 w-3" />
            {post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}
            <span className="text-muted-foreground/50">{isOpen ? "−" : "+"}</span>
          </button>

          {/* View count. Tapping the eye opens the engagement details, which
              administrators, coordinators and the author may see — everyone
              else just gets the number. */}
          {canSeeDetails ? (
            <button
              onClick={() => setDetailsOpen(true)}
              className="ml-auto flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:text-primary"
              title="Views and engagement — who viewed, reacted and answered"
            >
              <Eye className="h-3 w-3" />
              <span className="tabular-nums">{post.viewCount}</span>
            </button>
          ) : (
            <span
              className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground"
              title={`${post.viewCount} ${post.viewCount === 1 ? "view" : "views"}`}
            >
              <Eye className="h-3 w-3" />
              <span className="tabular-nums">{post.viewCount}</span>
            </span>
          )}
        </div>
      </div>

      {isOpen && <CommentThread postId={post._id} />}

      <EngagementDetailsDialog
        postId={post._id}
        title={post.title}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </article>
  );
}

/**
 * Engagement details for one post — administrators, evangelism coordinators,
 * and the author of this post/poll (see posts.engagementDetails, which returns
 * nothing to anyone else). Tiles act as tabs: opening one reveals the names
 * behind it.
 */
function EngagementDetailsDialog({
  postId,
  title,
  open,
  onOpenChange,
}: {
  postId: string;
  title: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const details = useQuery(
    api.posts.engagementDetails,
    open ? { postId: postId as any } : "skip",
  );
  const [tab, setTab] = useState<"views" | "reactions" | "comments" | "poll">(
    "views",
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Activity className="h-4 w-4 text-primary" /> Engagement
          </DialogTitle>
          <DialogDescription className="line-clamp-2 text-[11px]">{title}</DialogDescription>
        </DialogHeader>

        {!details ? (
          <div className="h-40 animate-pulse rounded-md border bg-muted/40" />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { key: "views" as const, label: "Views", value: details.viewCount },
                { key: "reactions" as const, label: "Reactions", value: details.reactionCount },
                { key: "comments" as const, label: "Comments", value: details.commentCount },
                ...(details.poll
                  ? [{ key: "poll" as const, label: "Poll", value: details.poll.totalVotes }]
                  : []),
              ].map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setTab(s.key)}
                  className={cn(
                    "rounded-md border px-2.5 py-2 text-left transition-colors",
                    tab === s.key
                      ? "border-primary/60 bg-primary/10"
                      : "border-border bg-muted/40 hover:border-primary/40",
                  )}
                >
                  <div className="text-[15px] font-bold tabular-nums">{s.value}</div>
                  <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
                    {s.label}
                  </div>
                </button>
              ))}
            </div>

            <div className={cn(tab !== "reactions" && "hidden")}>
              <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Heart className="h-3 w-3" /> Reactions — who reacted
              </div>
              {details.reactionCount === 0 ? (
                <p className="text-[11px] text-muted-foreground">No reactions yet.</p>
              ) : (
                <div className="space-y-2">
                  <ReactionSummary
                    kinds={Object.fromEntries(details.reactionBreakdown.map((b) => [b.kind, b.count]))}
                  />
                  <div className="max-h-32 divide-y overflow-auto rounded-md border">
                    {details.reactors.map((r, i) => (
                      <div key={i} className="flex items-center justify-between px-2.5 py-1.5">
                        <span className="truncate text-[11px]">{r.name}</span>
                        <span className="flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
                          {reactionMeta(r.kind).emoji} {reactionMeta(r.kind).label}
                          <span className="text-muted-foreground/70">{timeAgo(r.at)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className={cn(tab !== "comments" && "hidden")}>
              <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Users className="h-3 w-3" /> Conversation — who took part
              </div>
              <p className="text-[11px] text-muted-foreground">
                {details.commentCount} comments · {details.replyCount} replies ·{" "}
                {details.participantCount} {details.participantCount === 1 ? "participant" : "participants"}
              </p>
              {details.commenterNames.length > 0 && (
                <p className="mt-1 text-[10px] text-muted-foreground/80">
                  {[...new Set(details.commenterNames)].slice(0, 8).join(", ")}
                  {new Set(details.commenterNames).size > 8 ? " and others" : ""}
                </p>
              )}
            </div>

            <div className={cn(tab !== "views" && "hidden")}>
              <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Eye className="h-3 w-3" /> Views — who viewed it
              </div>
              {details.viewers.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No views recorded yet.</p>
              ) : (
                <div className="max-h-40 divide-y overflow-auto rounded-md border">
                  {details.viewers.map((v, i) => (
                    <div key={i} className="flex items-center justify-between px-2.5 py-1.5">
                      <span className="truncate text-[11px]">{v.name}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {v.views} {v.views === 1 ? "view" : "views"} · {timeAgo(v.lastViewedAt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {details.poll && (
              <div className={cn(tab !== "poll" && "hidden")}>
                <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <BarChart3 className="h-3 w-3" /> Poll — who chose what
                </div>
                <p className="mb-2 text-[11px] font-medium">{details.poll.question}</p>
                <div className="space-y-2">
                  {details.poll.options.map((o) => (
                    <div key={o.id} className="overflow-hidden rounded-md border">
                      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-2.5 py-1.5">
                        <span className="truncate text-[11px] font-medium">{o.text}</span>
                        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                          {o.count} {o.count === 1 ? "vote" : "votes"}
                        </span>
                      </div>
                      {o.voters.length === 0 ? (
                        <p className="px-2.5 py-1.5 text-[10px] text-muted-foreground">
                          Nobody chose this one.
                        </p>
                      ) : (
                        <div className="divide-y">
                          {o.voters.map((v, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between px-2.5 py-1.5"
                            >
                              <span className="truncate text-[11px]">{v.name}</span>
                              <span className="shrink-0 text-[10px] text-muted-foreground/70">
                                {timeAgo(v.at)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  {details.poll.totalVotes}{" "}
                  {details.poll.totalVotes === 1 ? "vote" : "votes"} from{" "}
                  {details.poll.voterCount}{" "}
                  {details.poll.voterCount === 1 ? "person" : "people"}
                  {details.poll.closed && " · closed"}
                </p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PostMediaItem({ media, postId }: { media: { storageId: string; type: string; name: string }; postId: string }) {
  const url = useQuery(api.posts.getMediaUrl, { storageId: media.storageId, postId: postId as any });

  if (!url) {
    return (
      <div className="flex h-16 w-16 items-center justify-center rounded-md border bg-muted">
        <span className="text-[8px] text-muted-foreground">Loading...</span>
      </div>
    );
  }

  if (media.type === "image") {
    return (
      <a href={url as string} target="_blank" rel="noreferrer">
        <img
          src={url as string}
          alt={media.name}
          className="max-h-48 rounded-md border object-cover transition-transform hover:scale-[1.02]"
        />
      </a>
    );
  }

  if (media.type === "video") {
    return (
      <video
        src={url as string}
        controls
        className="max-h-48 rounded-md border"
      />
    );
  }

  if (media.type === "audio") {
    return (
      <div className="flex items-center gap-3 rounded-md border bg-muted px-3 py-2.5">
        <audio src={url as string} controls className="h-8 max-w-xs" />
        <span className="truncate text-[10px] text-muted-foreground">{media.name}</span>
      </div>
    );
  }

  // File attachment
  return (
    <a
      href={url as string}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2 transition-colors hover:bg-muted/80"
    >
      <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate text-[11px] text-foreground/80">{media.name}</span>
    </a>
  );
}

type ThreadComment = {
  _id: string;
  parentId?: string;
  author?: string;
  authorId?: string;
  body: string;
  createdAt: number;
};

type CommentReactionTally = {
  count: number;
  byKind: Record<string, number>;
  mine: string | null;
};

type CommentReactionMap = Record<string, CommentReactionTally>;

/** One comment or reply, with its own reply input and nested replies below it. */
function CommentNode({
  comment,
  depth,
  childrenOf,
  postId,
  me,
  isAdmin,
  reactions,
  addComment,
  removeComment,
}: {
  comment: ThreadComment;
  depth: number;
  childrenOf: Map<string | undefined, ThreadComment[]>;
  postId: string;
  me: { _id?: string } | null | undefined;
  isAdmin: boolean;
  reactions: CommentReactionMap;
  addComment: (args: { postId: any; parentId?: any; body: string }) => Promise<unknown>;
  removeComment: (args: { id: any }) => Promise<unknown>;
}) {
  const [replying, setReplying] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [busy, setBusy] = useState(false);
  const canDelete = isAdmin || comment.authorId === me?._id;
  const replies = childrenOf.get(comment._id) ?? [];
  const tally = reactions?.[comment._id];

  return (
    <div id={`comment-${comment._id}`} className="scroll-mt-24">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-card">
          <UserRound className="h-3 w-3 text-muted-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] font-semibold">{comment.author ?? "Member"}</span>
            <span className="text-[9px] text-muted-foreground">
              {fmtDateTime(new Date(comment.createdAt).toISOString())}
            </span>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <button
                className="text-[9px] font-medium text-muted-foreground hover:text-primary"
                onClick={() => {
                  setReplying((v) => !v);
                  setReplyBody("");
                }}
              >
                {replying ? "cancel" : "Reply"}
              </button>
              {canDelete && (
                <button
                  className="text-[9px] text-muted-foreground hover:text-destructive"
                  onClick={async () => {
                    await removeComment({ id: comment._id });
                    toast.success("Comment removed");
                  }}
                >
                  remove
                </button>
              )}
            </div>
          </div>
          <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-5 text-foreground/85">
            {comment.body}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <ReactionPicker
              postId={postId}
              targetType="comment"
              targetId={comment._id}
              mine={tally?.mine ?? null}
              count={tally?.count ?? 0}
              compact
            />
            {tally && <ReactionSummary kinds={tally.byKind} />}
          </div>

          {replying && (
            <form
              className="mt-2 flex items-center gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!replyBody.trim()) return;
                setBusy(true);
                try {
                  await addComment({
                    postId,
                    parentId: comment._id,
                    body: replyBody.trim(),
                  });
                  setReplyBody("");
                  setReplying(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Input
                autoFocus
                placeholder={`Reply to ${comment.author ?? "this comment"}...`}
                className="flex-1"
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
              />
              <Button type="submit" size="sm" disabled={busy || !replyBody.trim()}>
                <Send className="mr-1 h-3.5 w-3.5" /> Reply
              </Button>
            </form>
          )}
        </div>
      </div>

      {replies.length > 0 && (
        <div
          className={
            depth < 3
              ? "ml-6 mt-2.5 space-y-3 border-l-2 border-border/60 pl-3"
              : "mt-2.5 space-y-3"
          }
        >
          {replies.map((r) => (
            <CommentNode
              key={r._id}
              comment={r}
              depth={depth + 1}
              childrenOf={childrenOf}
              postId={postId}
              me={me}
              isAdmin={isAdmin}
              reactions={reactions}
              addComment={addComment}
              removeComment={removeComment}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CommentThread({ postId }: { postId: string }) {
  const post = useQuery(api.posts.get, { id: postId as any });
  const addComment = useMutation(api.posts.addComment);
  const removeComment = useMutation(api.posts.removeComment);
  const me = useQuery(api.users.currentUser);
  // Administrators may hold several roles, so check the whole set.
  const isAdmin = userIsAdmin(me);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const comments: ThreadComment[] = (post?.comments ?? []) as ThreadComment[];
  const commentReactions: CommentReactionMap =
    (post?.commentReactions as CommentReactionMap | undefined) ?? {};
  const childrenOf = new Map<string | undefined, ThreadComment[]>();
  for (const c of comments) {
    const key = c.parentId ?? undefined;
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), c]);
  }
  const roots = childrenOf.get(undefined) ?? [];
  const replies = comments.length - roots.length;

  return (
    <div className="border-t bg-muted/30 px-4 py-4 sm:px-5">
      <div className="space-y-3">
        {roots.length === 0 ? (
          <p className="py-1 text-center text-[11px] text-muted-foreground">
            No comments yet — be the first to respond.
          </p>
        ) : (
          roots.map((c) => (
            <CommentNode
              key={c._id}
              comment={c}
              depth={0}
              childrenOf={childrenOf}
              postId={postId}
              me={me}
              isAdmin={isAdmin}
              reactions={commentReactions}
              addComment={addComment}
              removeComment={removeComment}
            />
          ))
        )}
      </div>

      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!body.trim()) return;
          setBusy(true);
          try {
            await addComment({ postId: postId as any, body: body.trim() });
            setBody("");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input
          placeholder="Write a comment..."
          className="flex-1"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={busy || !body.trim()}>
          <Send className="mr-1 h-3.5 w-3.5" /> Send
        </Button>
      </form>
    </div>
  );
}

type PendingFile = {
  file: File;
  preview?: string;
};

function CreatePostDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const create = useMutation(api.posts.create);
  const generateUploadUrl = useMutation(api.posts.generateUploadUrl);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Poll attached to the post being written (optional).
  const [pollOpen, setPollOpen] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [pollMultiple, setPollMultiple] = useState(false);

  const reset = () => {
    setTitle("");
    setBody("");
    setTags("");
    setPendingFiles([]);
    setPollOpen(false);
    setPollQuestion("");
    setPollOptions(["", ""]);
    setPollMultiple(false);
    setError(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const newPending: PendingFile[] = files.map((f) => ({
      file: f,
      preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
    }));
    setPendingFiles((prev) => [...prev, ...newPending].slice(0, 5));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (index: number) => {
    setPendingFiles((prev) => {
      const removed = prev[index];
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const detectType = (file: File): string => {
    if (file.type.startsWith("image/")) return "image";
    if (file.type.startsWith("video/")) return "video";
    if (file.type.startsWith("audio/")) return "audio";
    return "file";
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New post</DialogTitle>
          <DialogDescription>
            Share an update with the team. Posts appear on the dashboard and in the announcements feed.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim() || !body.trim()) {
              setError("Title and content are required");
              return;
            }
            // Mirrors the server's poll rules so the composer fails early.
            const pollChoices = pollOptions.map((o) => o.trim()).filter(Boolean);
            if (pollOpen) {
              if (!pollQuestion.trim()) {
                setError("Give the poll a question, or turn the poll off");
                return;
              }
              if (pollChoices.length < 2) {
                setError("A poll needs at least two options");
                return;
              }
            }
            setBusy(true);
            setError(null);
            try {
              // Upload media files with validation + optimization
              const uploadedMedia: MediaItem[] = [];
              for (const pf of pendingFiles) {
                let fileToUpload = pf.file;
                let width: number | undefined;
                let height: number | undefined;
                let thumbStorageId: string | undefined;
                const category = detectType(pf.file);

                // Client-side image optimization + thumbnail
                if (category === "image" && pf.file.type.startsWith("image/")) {
                  try {
                    const optimized = await optimizeImage(pf.file);
                    fileToUpload = new File([optimized.blob], pf.file.name, { type: "image/jpeg" });
                    width = optimized.width;
                    height = optimized.height;
                    const thumbBlob = await generateThumbnail(pf.file);
                    const thumbFile = new File([thumbBlob], `thumb_${pf.file.name}`, { type: "image/jpeg" });
                    const thumbUrl = await generateUploadUrl();
                    const thumbRes = await fetch(thumbUrl, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: thumbFile });
                    const thumbData = await thumbRes.json();
                    thumbStorageId = thumbData.storageId;
                  } catch { /* proceed with original file */ }
                }

                const url = await generateUploadUrl();
                const res = await fetch(url, {
                  method: "POST",
                  headers: { "Content-Type": fileToUpload.type },
                  body: fileToUpload,
                });
                const { storageId } = await res.json();
                uploadedMedia.push({
                  storageId,
                  type: category,
                  name: pf.file.name,
                  mimeType: fileToUpload.type,
                  size: fileToUpload.size,
                  width,
                  height,
                  thumbnailStorageId: thumbStorageId,
                  status: "ready",
                  uploadedAt: Date.now(),
                });
              }

              await create({
                title: title.trim(),
                body: body.trim(),
                tags: tags
                  .split(/[,\s]+/)
                  .map((t) => t.trim().replace(/^#/, ""))
                  .filter(Boolean)
                  .slice(0, 5) || undefined,
                media: uploadedMedia.length > 0 ? uploadedMedia : undefined,
                poll: pollOpen
                  ? {
                      question: pollQuestion.trim(),
                      allowMultiple: pollMultiple,
                      options: pollChoices,
                    }
                  : undefined,
              });
              toast.success("Post published");
              reset();
              onOpenChange(false);
            } catch (err: any) {
              setError(formatError(err, "Failed to post"));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div>
            <Label htmlFor="ap-title">Title *</Label>
            <Input
              id="ap-title"
              className="mt-1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Saturday outreach: 12 new contacts"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="ap-body">Content *</Label>
            <Textarea
              id="ap-body"
              rows={5}
              className="mt-1"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What would you like the team to know?"
            />
          </div>
          <div>
            <Label>Media (optional, max 5)</Label>
            <div className="mt-1 flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={pendingFiles.length >= 5}
              >
                <Paperclip className="mr-1.5 h-3.5 w-3.5" /> Add files
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt"
                className="hidden"
                onChange={handleFileChange}
              />
              <span className="text-[10px] text-muted-foreground">
                Images, videos, audio, or documents
              </span>
            </div>
            {pendingFiles.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {pendingFiles.map((pf, i) => (
                  <div key={i} className="group relative">
                    {pf.preview ? (
                      <img
                        src={pf.preview}
                        alt={pf.file.name}
                        className="h-16 w-16 rounded-md border object-cover"
                      />
                    ) : (
                      <div className="flex h-16 w-16 flex-col items-center justify-center rounded-md border bg-muted p-1">
                        <FileIcon className="h-5 w-5 text-muted-foreground" />
                        <span className="mt-0.5 max-w-full truncate text-[8px] text-muted-foreground">
                          {pf.file.name}
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-white opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-lg border border-dashed p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                <Label htmlFor="ap-poll" className="text-[12px]">
                  Add a poll
                </Label>
              </div>
              <Switch
                id="ap-poll"
                checked={pollOpen}
                onCheckedChange={(v: boolean) => setPollOpen(v)}
              />
            </div>

            {pollOpen && (
              <div className="mt-3 space-y-2">
                <Input
                  className="h-8 text-[12px]"
                  value={pollQuestion}
                  onChange={(e) => setPollQuestion(e.target.value)}
                  placeholder="Which day suits you for the outreach?"
                />
                <div className="space-y-1.5">
                  {pollOptions.map((option, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        className="h-8 text-[12px]"
                        value={option}
                        onChange={(e) =>
                          setPollOptions((prev) =>
                            prev.map((o, j) => (j === i ? e.target.value : o)),
                          )
                        }
                        placeholder={`Option ${i + 1}`}
                      />
                      {pollOptions.length > 2 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() =>
                            setPollOptions((prev) =>
                              prev.filter((_, j) => j !== i),
                            )
                          }
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                {pollOptions.length < 8 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => setPollOptions((prev) => [...prev, ""])}
                  >
                    <Plus className="mr-1 h-3 w-3" /> Add option
                  </Button>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <Switch
                    id="ap-poll-multi"
                    checked={pollMultiple}
                    onCheckedChange={(v: boolean) => setPollMultiple(v)}
                  />
                  <Label
                    htmlFor="ap-poll-multi"
                    className="text-[11px] font-normal text-muted-foreground"
                  >
                    Let people choose more than one answer
                  </Label>
                </div>
              </div>
            )}
          </div>
          <div>
            <Label htmlFor="ap-tags">Tags (comma separated)</Label>
            <Input
              id="ap-tags"
              className="mt-1"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="outreach, prayer, testimony"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => { reset(); onOpenChange(false); }}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Publishing..." : "Publish"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

