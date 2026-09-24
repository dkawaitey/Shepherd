import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { fmtDateTime, formatError, userIsAdmin } from "@/components/shared";
import { cn } from "@/lib/utils";
import {
  REACTIONS,
  REACTION_BY_KIND,
  REACTION_FALLBACK,
} from "@/convex/constants";
import { uploadVoiceNote, type UploadedMedia } from "@/lib/post-media";
import {
  VoiceDraftPlayer,
  VoiceNotePlayer,
  VoiceRecorder,
  createVoiceDraft,
  releaseVoiceDrafts,
  type VoiceDraft,
} from "@/components/voice-note";
import { FileIcon, Heart, Send, UserRound } from "lucide-react";

/* ─────────────────────────────── types ─────────────────────────────── */

type StoredMedia = {
  storageId: string;
  type: string;
  name: string;
  duration?: number;
};

export type ThreadComment = {
  _id: string;
  parentId?: string;
  author?: string;
  authorId?: string;
  body: string;
  /** Voice notes and images attached to this comment or reply. */
  media?: StoredMedia[];
  createdAt: number;
};

type ReactionTally = {
  count: number;
  byKind: Record<string, number>;
  mine: string | null;
};

type ReactionMap = Record<string, ReactionTally>;

function reactionMeta(kind: string) {
  return REACTION_BY_KIND[kind] ?? { ...REACTION_FALLBACK, kind };
}

/* ──────────────────────────── reactions ───────────────────────────── */

/** The emoji chosen so far, with live counts. */
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
          <span className="font-semibold tabular-nums text-foreground/80">{count}</span>
        </span>
      ))}
    </div>
  );
}

/** React to a comment. Tapping the active emoji clears it. */
function CommentReactionPicker({
  postId,
  commentId,
  mine,
}: {
  postId: string;
  commentId: string;
  mine: string | null;
}) {
  const react = useMutation(api.posts.react);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = mine ? reactionMeta(mine) : null;

  const choose = async (kind: string) => {
    setBusy(true);
    try {
      await react({
        postId: postId as never,
        targetType: "comment",
        targetId: commentId,
        kind,
      });
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
          {current ? (
            <span className="text-[12px]">{current.emoji}</span>
          ) : (
            <Heart className="h-3 w-3" />
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

/* ──────────────────────────── attachments ─────────────────────────── */

/**
 * Everything a reader can attach to a comment: voice notes play inline through
 * the animated player, images open full size, other files download.
 */
function CommentMedia({ media, postId }: { media: StoredMedia[]; postId: string }) {
  return (
    <div className="mt-1.5 space-y-1.5">
      {media.map((m, i) => {
        if (m.type === "audio") {
          return (
            <VoiceNotePlayer
              key={`${m.storageId}-${i}`}
              storageId={m.storageId}
              postId={postId}
              durationHintMs={m.duration ? m.duration * 1000 : undefined}
              name={m.name}
              compact
              className="max-w-sm"
            />
          );
        }
        return (
          <CommentAttachment
            key={`${m.storageId}-${i}`}
            storageId={m.storageId}
            postId={postId}
            name={m.name}
            asImage={m.type === "image"}
          />
        );
      })}
    </div>
  );
}

function CommentAttachment({
  storageId,
  postId,
  name,
  asImage,
}: {
  storageId: string;
  postId: string;
  name: string;
  asImage: boolean;
}) {
  const url = useQuery(api.posts.getMediaUrl, { storageId, postId: postId as never });
  if (!url) {
    return <div className="h-20 w-28 animate-pulse rounded-lg border bg-muted/40" />;
  }
  if (asImage) {
    return (
      <a href={url as string} target="_blank" rel="noreferrer" className="inline-block">
        <img
          src={url as string}
          alt={name}
          className="max-h-40 rounded-lg border object-cover transition-transform hover:scale-[1.01]"
        />
      </a>
    );
  }
  return (
    <a
      href={url as string}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-lg border bg-muted/40 px-2.5 py-1.5 text-[11px] transition-colors hover:bg-muted/70"
    >
      <FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="max-w-[16rem] truncate">{name}</span>
    </a>
  );
}

/* ─────────────────────────── the composer ─────────────────────────── */

/**
 * The comment composer, used for new comments and replies alike: type, or
 * record a voice note. Enter sends, Shift+Enter starts a new line, and a
 * finished recording is played back to the sender before it is sent.
 */
function CommentComposer({
  postId,
  parentId,
  placeholder = "Write a comment…",
  autoFocus = false,
  compact = false,
  onDone,
}: {
  postId: string;
  parentId?: string;
  placeholder?: string;
  autoFocus?: boolean;
  compact?: boolean;
  onDone?: () => void;
}) {
  const addComment = useMutation(api.posts.addComment);
  const generateUploadUrl = useMutation(api.posts.generateUploadUrl);
  const [body, setBody] = useState("");
  const [voice, setVoice] = useState<VoiceDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const voiceRef = useRef<VoiceDraft[]>([]);

  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);
  useEffect(() => () => releaseVoiceDrafts(voiceRef.current), []);

  const grow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const canSend = !busy && (body.trim().length > 0 || voice.length > 0);

  const submit = async () => {
    if (!canSend) return;
    const text = body.trim();
    const drafts = voice;
    setBusy(true);
    try {
      const media: UploadedMedia[] = [];
      for (const draft of drafts) {
        media.push(
          await uploadVoiceNote({
            blob: draft.blob,
            mimeType: draft.mimeType,
            durationMs: draft.durationMs,
            generateUploadUrl,
          }),
        );
      }
      await addComment({
        postId: postId as never,
        parentId: parentId as never,
        body: text || undefined,
        media: media.length > 0 ? media : undefined,
      });
      releaseVoiceDrafts(drafts);
      setVoice([]);
      setBody("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      onDone?.();
    } catch (err) {
      toast.error(formatError(err, "Could not post your comment"));
    } finally {
      setBusy(false);
    }
  };

  const removeDraft = (key: string) => {
    setVoice((prev) => {
      const target = prev.find((v) => v.key === key);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((v) => v.key !== key);
    });
  };

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/70 bg-card/70 transition-colors focus-within:border-primary/50",
        compact ? "p-1.5" : "p-2",
      )}
    >
      <textarea
        ref={textareaRef}
        rows={1}
        autoFocus={autoFocus}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          grow();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder={placeholder}
        className={cn(
          "max-h-40 w-full resize-none bg-transparent px-1.5 py-1 leading-5 outline-none placeholder:text-muted-foreground/70",
          compact ? "text-[11px]" : "text-[12px]",
        )}
      />

      {voice.length > 0 && (
        <div className="mt-1.5 space-y-1.5">
          {voice.map((draft) => (
            <VoiceDraftPlayer
              key={draft.key}
              draft={draft}
              compact
              onRemove={() => removeDraft(draft.key)}
            />
          ))}
        </div>
      )}

      <div className="mt-1 flex items-center gap-1.5">
        <VoiceRecorder
          disabled={busy || voice.length > 0}
          onRecorded={(note) => setVoice([createVoiceDraft(note)])}
        />
        <Button
          type="button"
          size="sm"
          onClick={submit}
          disabled={!canSend}
          className="ml-auto h-7 rounded-full px-3 text-[11px]"
        >
          {busy ? (
            "Sending…"
          ) : (
            <>
              <Send className="mr-1 h-3 w-3" />
              Send
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

/* ───────────────────────────── one comment ───────────────────────── */

function CommentNode({
  comment,
  depth,
  childrenOf,
  postId,
  meId,
  isAdmin,
  reactions,
  onRemove,
}: {
  comment: ThreadComment;
  depth: number;
  childrenOf: Map<string | undefined, ThreadComment[]>;
  postId: string;
  meId?: string;
  isAdmin: boolean;
  reactions: ReactionMap;
  onRemove: (id: string) => Promise<unknown>;
}) {
  const [replying, setReplying] = useState(false);
  const canDelete = isAdmin || (!!meId && comment.authorId === meId);
  const replies = childrenOf.get(comment._id) ?? [];
  const tally = reactions[comment._id];

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
                type="button"
                className="text-[9px] font-medium text-muted-foreground hover:text-primary"
                onClick={() => setReplying((v) => !v)}
              >
                {replying ? "cancel" : "Reply"}
              </button>
              {canDelete && (
                <button
                  type="button"
                  className="text-[9px] text-muted-foreground hover:text-destructive"
                  onClick={async () => {
                    await onRemove(comment._id);
                    toast.success("Comment removed");
                  }}
                >
                  remove
                </button>
              )}
            </div>
          </div>

          {comment.body.trim() && (
            <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-5 text-foreground/85">
              {comment.body}
            </p>
          )}

          {comment.media && comment.media.length > 0 && (
            <CommentMedia media={comment.media} postId={postId} />
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <CommentReactionPicker
              postId={postId}
              commentId={comment._id}
              mine={tally?.mine ?? null}
            />
            {tally && <ReactionSummary kinds={tally.byKind} />}
          </div>

          {replying && (
            <div className="mt-2">
              <CommentComposer
                postId={postId}
                parentId={comment._id}
                autoFocus
                compact
                placeholder={`Reply to ${comment.author ?? "this comment"}…`}
                onDone={() => setReplying(false)}
              />
            </div>
          )}
        </div>
      </div>

      {replies.length > 0 && (
        <div
          className={
            depth < 3 ? "ml-6 mt-2.5 space-y-3 border-l-2 border-border/60 pl-3" : "mt-2.5 space-y-3"
          }
        >
          {replies.map((r) => (
            <CommentNode
              key={r._id}
              comment={r}
              depth={depth + 1}
              childrenOf={childrenOf}
              postId={postId}
              meId={meId}
              isAdmin={isAdmin}
              reactions={reactions}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── the thread ───────────────────────────── */

/**
 * The comment thread under an announcement. Voice notes can be recorded on a
 * comment or a reply, and every attachment is playable by everyone who can see
 * the post.
 */
export function PostThread({ postId }: { postId: string }) {
  const post = useQuery(api.posts.get, { id: postId as never });
  const removeComment = useMutation(api.posts.removeComment);
  const me = useQuery(api.users.currentUser);
  // Administrators may hold several roles, so check the whole set (and honour
  // "test as", exactly like the server's hasRole).
  const isAdmin = userIsAdmin(me);

  const comments: ThreadComment[] = (post?.comments ?? []) as ThreadComment[];
  const reactions = (post?.commentReactions as ReactionMap | undefined) ?? {};

  const childrenOf = new Map<string | undefined, ThreadComment[]>();
  for (const c of comments) {
    const key = c.parentId ?? undefined;
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), c]);
  }
  const roots = childrenOf.get(undefined) ?? [];

  return (
    <div className="border-t bg-muted/30 px-4 py-4 sm:px-5">
      <div className="space-y-3">
        {roots.length === 0 ? (
          <p className="py-1 text-center text-[11px] text-muted-foreground">
            No comments yet.
          </p>
        ) : (
          roots.map((c) => (
            <CommentNode
              key={c._id}
              comment={c}
              depth={0}
              childrenOf={childrenOf}
              postId={postId}
              meId={me?._id as string | undefined}
              isAdmin={isAdmin}
              reactions={reactions}
              onRemove={(id) => removeComment({ id: id as never })}
            />
          ))
        )}
      </div>

      <div className="mt-3">
        <CommentComposer postId={postId} />
      </div>
    </div>
  );
}
