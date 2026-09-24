import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { ROLES } from "@/convex/constants";
import { REACTION_PALETTE, reactionMeta } from "@/lib/reactions";
import { canPublishPosts, userHasRole, userIsAdmin } from "@/components/shared";
import { PollComposer } from "@/components/poll-composer";
import { PollScheduleDialog } from "@/components/poll-schedule";
import { PostComposerDialog } from "@/components/post-composer";
import { PostThread } from "@/components/post-thread";
import { VoiceNotePlayer } from "@/components/voice-note";

import {
  Check,
  FileIcon,
  MessageSquare,
  Pin,
  Plus,
  Search,
  Trash2,
  X,
  UserRound,
  AlertCircle,
  Eye,
  Megaphone,
  Trophy,
  Medal,
  Award,
  CheckCircle2,
  Lock,
  Heart,
  BarChart3,
  Bell,
  CalendarClock,
  Activity,
  Users,
} from "lucide-react";

/** How many posts the feed loads at a time — "Load older posts" grows it. */
const FEED_PAGE_SIZE = 20;
const MAX_FEED_POSTS = 100;
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
  // The standalone poll composer (a poll is its own announcement).
  const [pollComposerOpen, setPollComposerOpen] = useState(false);
  const openComposer = () => setCreateOpen(true);
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
  // Publishing is leadership-only on the server (`posts.create`); members still
  // read, react, comment and vote.
  const canPublish = canPublishPosts(me);
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
          canPublish ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setPollComposerOpen(true)}>
                <BarChart3 className="mr-1.5 h-4 w-4" /> New poll
              </Button>
              <Button onClick={openComposer}>
                <Plus className="mr-1.5 h-4 w-4" /> New post
              </Button>
            </div>
          ) : null
        }
      />

      <div className="mb-5 grid gap-2 sm:grid-cols-[1fr_220px]">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search posts"
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
            canPublish ? (
              <Button onClick={openComposer}>
                <Plus className="mr-1.5 h-4 w-4" /> New post
              </Button>
            ) : null
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

      <PostComposerDialog open={createOpen} onOpenChange={setCreateOpen} />
      <PollComposer
        open={pollComposerOpen}
        onOpenChange={setPollComposerOpen}
      />
    </div>
  );
}

// ── Engagement helpers ─────────────────────────────────────────────

/** Short countdown, e.g. "in 12m", "in 5h", "in 2d". */
function timeUntil(ts: number) {
  const secs = Math.floor((ts - Date.now()) / 1000);
  if (secs <= 0) return "any moment now";
  const mins = Math.floor(secs / 60);
  if (mins < 1) return "in under a minute";
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `in ${days}d`;
  return `on ${fmtDateTime(new Date(ts).toISOString())}`;
}

/** "1 day before closing" — the lead time a closing reminder uses. */
function reminderLeadLabel(minutes: number) {
  if (minutes % (60 * 24) === 0) {
    const days = minutes / (60 * 24);
    return `${days} ${days === 1 ? "day" : "days"} before closing`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"} before closing`;
  }
  return `${minutes} minutes before closing`;
}

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

/**
 * Every reaction that has been chosen, with its live count — the pill beside
 * the react button. The reader's own reaction is included here, so the button
 * itself only has to show which one they picked.
 */
function ReactionSummary({ kinds }: { kinds: Record<string, number> }) {
  const entries = Object.entries(kinds ?? {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {entries.map(([kind, count]) => {
        const meta = reactionMeta(kind);
        const MetaIcon = meta.Icon;
        return (
          <span
            key={kind}
            title={`${count} ${meta.label}`}
            className="flex items-center gap-1 rounded-full border border-border/70 bg-muted/50 px-1.5 py-0.5 text-[10px] leading-none"
          >
            <MetaIcon className={cn("h-3 w-3", meta.className)} />
            <span className="font-semibold tabular-nums text-foreground/80">
              {count}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** One reactor's icon, resolved from the reaction they left. */
function ReactorIcon({ kind }: { kind: string }) {
  const meta = reactionMeta(kind);
  const MetaIcon = meta.Icon;
  return <MetaIcon className={cn("h-3 w-3", meta.className)} />;
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
  const CurrentIcon = current?.Icon;

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
          {/* This reader's own reaction only — no description, no count. The
              live breakdown beside the pill shows every one and its count. */}
          {CurrentIcon ? (
            <CurrentIcon
              className={cn(compact ? "h-3.5 w-3.5" : "h-4 w-4", current?.className)}
            />
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
          {REACTION_PALETTE.map((r) => (
            <button
              key={r.kind}
              type="button"
              title={mine === r.kind ? `${r.label} (tap to remove)` : r.label}
              onClick={() => choose(r.kind)}
              className={cn(
                "rounded-md px-2 py-1.5 leading-none transition-colors hover:bg-accent",
                mine === r.kind && "bg-accent",
              )}
            >
              <r.Icon className={cn("h-4 w-4", r.className)} />
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
  /** Auto-close deadline (epoch ms), if the poll has one. */
  closesAt?: number;
  /** Minutes before that deadline to send a reminder push, if one is set. */
  reminderMinutesBefore?: number;
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

type PollResultOption = {
  id: string;
  text: string;
  count: number;
  /** Who chose this option — only sent to viewers allowed to see details. */
  voters?: { name: string; at: number }[];
};

/** Rank medal for the top three options (number badge for the rest). */
function rankBadge(rank: number) {
  if (rank === 0) {
    return {
      icon: Trophy,
      className: "border-[#f59e0b]/50 bg-[#2e2408] text-[#fbbf24]",
    };
  }
  if (rank === 1) {
    return { icon: Medal, className: "border-border bg-muted text-foreground/70" };
  }
  if (rank === 2) {
    return { icon: Award, className: "border-border bg-muted text-foreground/60" };
  }
  return { icon: null, className: "border-border bg-muted text-muted-foreground" };
}

/**
 * A poll's result as a chart: a ranked bar per option, sized by share of the
 * votes, with the tally, the percentage and — for viewers allowed to see them —
 * the names of everyone who chose each option.
 *
 * Used by the poll card (anonymous counts) and by the engagement details dialog
 * (counts plus names), so the result looks the same wherever it appears.
 */
function PollResultChart({
  options,
  totalVotes,
  voterCount,
  allowMultiple,
  closed,
  highlightWinner = false,
  showVoters = false,
}: {
  options: PollResultOption[];
  totalVotes: number;
  voterCount: number;
  allowMultiple: boolean;
  closed: boolean;
  highlightWinner?: boolean;
  showVoters?: boolean;
}) {
  const ranked = [...options].sort(
    (a, b) => b.count - a.count || a.text.localeCompare(b.text),
  );

  if (ranked.length === 0 || totalVotes === 0) {
    return (
      <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed py-6 text-center">
        <Users className="h-4 w-4 text-muted-foreground" />
        <p className="text-[11px] text-muted-foreground">No votes cast yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Summary strip — one chip per fact, all icon-led. */}
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5">
          <Users className="h-3 w-3" />
          {voterCount} {voterCount === 1 ? "person" : "people"}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5">
          <BarChart3 className="h-3 w-3" />
          {totalVotes} {totalVotes === 1 ? "vote" : "votes"}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5">
          <CheckCircle2 className="h-3 w-3" />
          {allowMultiple ? "Multiple answers" : "One answer each"}
        </span>
        {closed && (
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-primary">
            <Lock className="h-3 w-3" /> Final result
          </span>
        )}
      </div>

      {ranked.map((o, i) => {
        const pct = Math.round((o.count / totalVotes) * 100);
        const badge = rankBadge(i);
        const RankIcon = badge.icon;
        const winner = i === 0 && highlightWinner && o.count > 0;
        return (
          <div
            key={o.id}
            className={cn(
              "overflow-hidden rounded-lg border bg-card",
              winner ? "border-primary/50 ring-1 ring-primary/20" : "border-border",
            )}
          >
            <div className="flex items-center gap-2 px-2.5 py-2">
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[10px] font-bold tabular-nums",
                  badge.className,
                )}
              >
                {RankIcon ? <RankIcon className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                {o.text}
              </span>
              {winner && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                  <Trophy className="h-2.5 w-2.5" />
                  {allowMultiple ? "Top choice" : "Winner"}
                </span>
              )}
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                <b className="text-foreground">{o.count}</b> · {pct}%
              </span>
            </div>
            <div className="h-1.5 w-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-r-full transition-[width] duration-500 ease-out",
                  winner ? "bg-primary" : "bg-primary/45",
                )}
                style={{ width: `${o.count > 0 ? Math.max(pct, 4) : 0}%` }}
              />
            </div>
            {showVoters && o.voters && o.voters.length > 0 && (
              <div className="flex flex-wrap gap-1 border-t border-border/60 bg-muted/20 px-2.5 py-1.5">
                {o.voters.map((v, j) => (
                  <span
                    key={`${v.name}-${j}`}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-1.5 py-0.5 text-[9px] text-muted-foreground"
                  >
                    <UserRound className="h-2.5 w-2.5" />
                    {v.name}
                    <span className="text-muted-foreground/60">{timeAgo(v.at)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

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
  // Rescheduling an open poll (deadline + closing reminder).
  const [scheduleOpen, setScheduleOpen] = useState(false);
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

  // Tally per option, biggest first — the chart needs it sorted, and it is the
  // shape the details view uses too.
  const ranked: PollResultOption[] = [...poll.options]
    .map((o) => ({ id: o.id, text: o.text, count: poll.counts[o.id] ?? 0 }))
    .sort((a, b) => b.count - a.count);
  // A closed poll with votes is a result to read, not a ballot to fill, so it
  // renders as the result chart.
  const showResult = poll.closed && poll.totalVotes > 0;

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
        <BarChart3 className="h-3 w-3" />
        Poll
        <span className="font-normal normal-case tracking-normal">
          · {poll.allowMultiple ? "choose one or more" : "choose one"}
          {poll.closed
            ? " · closed"
            : poll.closesAt
              ? ` · closes ${timeUntil(poll.closesAt)}`
              : ""}
        </span>
      </div>
      <div className="mt-1.5 text-[13px] font-semibold">{poll.question}</div>

      {showResult ? (
        <div className="mt-2">
          <PollResultChart
            options={ranked}
            totalVotes={poll.totalVotes}
            voterCount={poll.voterCount}
            allowMultiple={poll.allowMultiple}
            closed
            highlightWinner
          />
        </div>
      ) : (
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
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        {!showResult && (
          <span>
            {poll.totalVotes} {poll.totalVotes === 1 ? "vote" : "votes"} ·{" "}
            {poll.voterCount} {poll.voterCount === 1 ? "person" : "people"}
          </span>
        )}
        {!poll.closed && poll.reminderMinutesBefore !== undefined && (
          <span className="flex items-center gap-1">
            <Bell className="h-2.5 w-2.5" />
            reminder {reminderLeadLabel(poll.reminderMinutesBefore)}
          </span>
        )}
        {!poll.closed && !poll.allowMultiple && voted && (
          <span className="text-muted-foreground/70">
            Tap your answer again to clear it
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
          {canManage && !poll.closed && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[10px] text-muted-foreground"
              title="Move or clear the deadline, and set the closing reminder"
              onClick={() => setScheduleOpen(true)}
            >
              <CalendarClock className="mr-1 h-3 w-3" /> Edit timing
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

      <PollScheduleDialog
        postId={postId}
        question={poll.question}
        closesAt={poll.closesAt}
        reminderMinutesBefore={poll.reminderMinutesBefore}
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
      />
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
              <div className="text-[13px] font-bold">
                {/* A standalone poll carries no title of its own. */}
                {post.title.trim() || (post.poll ? "Poll" : "Announcement")}
              </div>
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

        {post.body.trim() && (
          <p className="mt-3 whitespace-pre-wrap text-[13px] leading-6 text-foreground/90">
            {post.body}
          </p>
        )}

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

      {isOpen && <PostThread postId={post._id} />}

      <EngagementDetailsDialog
        postId={post._id}
        title={post.title.trim() || (post.poll ? "Poll" : "Announcement")}
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
                          <span className="flex items-center gap-1">
                            <ReactorIcon kind={r.kind} />
                            {reactionMeta(r.kind).label}
                          </span>
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
                        viewed {timeAgo(v.lastViewedAt)}
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

                {/* How the poll is running: still open, when its deadline is,
                    and the reminder the creator asked for. */}
                <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
                  {details.poll.closed ? (
                    <span className="flex items-center gap-1">
                      <Lock className="h-3 w-3" />
                      {details.poll.closesAt !== undefined &&
                      details.poll.closedAt !== undefined &&
                      details.poll.closedAt >= details.poll.closesAt
                        ? `Closed automatically ${fmtDateTime(new Date(details.poll.closedAt).toISOString())}`
                        : details.poll.closedAt !== undefined
                          ? `Closed ${fmtDateTime(new Date(details.poll.closedAt).toISOString())}`
                          : "Closed"}
                    </span>
                  ) : details.poll.closesAt !== undefined ? (
                    <span className="flex items-center gap-1">
                      <CalendarClock className="h-3 w-3" />
                      Closes {timeUntil(details.poll.closesAt)} ·{" "}
                      {fmtDateTime(new Date(details.poll.closesAt).toISOString())}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <CalendarClock className="h-3 w-3" /> Open until it is closed
                    </span>
                  )}
                  {details.poll.reminderMinutesBefore !== undefined && (
                    <span className="flex items-center gap-1">
                      <Bell className="h-3 w-3" />
                      Reminder {reminderLeadLabel(details.poll.reminderMinutesBefore)}
                      {" · "}
                      {details.poll.reminderSentAt !== undefined ? "sent" : "scheduled"}
                    </span>
                  )}
                </div>

                {/* Who has not answered yet — the people to nudge before the
                    deadline. Everyone the poll went out to is counted. */}
                <div className="mb-2">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Hasn't answered yet · {details.poll.nonVoterCount}
                  </div>
                  {details.poll.nonVoters.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      Everyone has answered.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {details.poll.nonVoters.map((name) => (
                        <span
                          key={name}
                          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-[9px] text-muted-foreground"
                        >
                          <AlertCircle className="h-2.5 w-2.5" />
                          {name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* The same chart the poll card shows, with the voters' names
                    under each option — this view is the one that may see them. */}
                <PollResultChart
                  options={details.poll.options}
                  totalVotes={details.poll.totalVotes}
                  voterCount={details.poll.voterCount}
                  allowMultiple={details.poll.allowMultiple}
                  closed={details.poll.closed}
                  highlightWinner
                  showVoters
                />
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PostMediaItem({
  media,
  postId,
}: {
  media: { storageId: string; type: string; name: string; duration?: number };
  postId: string;
}) {
  // A voice note resolves its own file URL, so it is rendered here rather than
  // behind the placeholder below: its length shows in the feed straight away,
  // while the rest of the card is still loading.
  if (media.type === "audio") {
    return (
      <VoiceNotePlayer
        storageId={media.storageId}
        postId={postId}
        durationHintMs={media.duration ? media.duration * 1000 : undefined}
        name={media.name}
        className="w-full max-w-md"
      />
    );
  }

  return <PostMediaFile media={media} postId={postId} />;
}

/** An image, video or file attachment in the feed, resolved from storage. */
function PostMediaFile({
  media,
  postId,
}: {
  media: { storageId: string; type: string; name: string; duration?: number };
  postId: string;
}) {
  const url = useQuery(api.posts.getMediaUrl, { storageId: media.storageId, postId: postId as any });

  if (!url) {
    return <div className="h-20 w-28 animate-pulse rounded-lg border bg-muted/40" />;
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


