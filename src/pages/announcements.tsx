import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  EmptyState,
  PageHeader,
  fmtDateTime,
} from "@/components/shared";

import {
  FileIcon,
  Image as ImageIcon,
  MessageSquare,
  Paperclip,
  Pin,
  Plus,
  Search,
  Send,
  Trash2,
  Video,
  X,
  UserRound,
} from "lucide-react";

export default function Announcements() {
  const [search, setSearch] = useState("");
  const [author, setAuthor] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

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

  const posts = useQuery(api.posts.list, {
    search: search || undefined,
    author: author || undefined,
  });
  const me = useQuery(api.users.currentUser);
  const isAdmin = me?.role === "admin";
  const removePost = useMutation(api.posts.remove);

  const authors = [...new Set((posts ?? []).map((p) => p.author).filter(Boolean))];

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
          {posts.map((p) => {
            const isOpen = expanded === p._id;
            const canDelete = isAdmin || p.authorId === me?._id;
            return (
              <article key={p._id} id={`post-${p._id}`} className="scroll-mt-20 overflow-hidden rounded-lg border bg-card">
                <div className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full border border-primary/30 bg-accent">
                        <UserRound className="h-3.5 w-3.5 text-primary" />
                      </span>
                      <div>
                        <div className="text-[13px] font-bold">{p.title}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {p.author} · {fmtDateTime(new Date(p.createdAt).toISOString())}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {p.isPinned && (
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
                          onClick={async () => {
                            await removePost({ id: p._id });
                            toast.success("Post removed");
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>

                  <p className="mt-3 whitespace-pre-wrap text-[13px] leading-6 text-foreground/90">
                    {p.body}
                  </p>

                  {p.media && p.media.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {p.media.map((m, i) => (
                        <PostMediaItem key={i} media={m} />
                      ))}
                    </div>
                  )}

                  {p.tags && p.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {p.tags.map((t) => (
                        <span key={t} className="rounded border border-border bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={() => setExpanded(isOpen ? null : p._id)}
                    className="mt-4 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-primary"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    {p.commentCount} {p.commentCount === 1 ? "comment" : "comments"}
                    <span className="text-muted-foreground/50">{isOpen ? "−" : "+"}</span>
                  </button>
                </div>

                {isOpen && (
                  <CommentThread postId={p._id} />
                )}
              </article>
            );
          })}
        </div>
      )}

      <CreatePostDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function PostMediaItem({ media }: { media: { storageId: string; type: string; name: string } }) {
  const url = useQuery(api.posts.getMediaUrl, { storageId: media.storageId });

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

/** One comment or reply, with its own reply input and nested replies below it. */
function CommentNode({
  comment,
  depth,
  childrenOf,
  postId,
  me,
  isAdmin,
  addComment,
  removeComment,
}: {
  comment: ThreadComment;
  depth: number;
  childrenOf: Map<string | undefined, ThreadComment[]>;
  postId: string;
  me: { _id?: string } | null | undefined;
  isAdmin: boolean;
  addComment: (args: { postId: any; parentId?: any; body: string }) => Promise<unknown>;
  removeComment: (args: { id: any }) => Promise<unknown>;
}) {
  const [replying, setReplying] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [busy, setBusy] = useState(false);
  const canDelete = isAdmin || comment.authorId === me?._id;
  const replies = childrenOf.get(comment._id) ?? [];

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
  const isAdmin = me?.role === "admin";
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const comments: ThreadComment[] = (post?.comments ?? []) as ThreadComment[];
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

  const reset = () => {
    setTitle("");
    setBody("");
    setTags("");
    setPendingFiles([]);
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
            setBusy(true);
            setError(null);
            try {
              // Upload media files
              const uploadedMedia: { storageId: string; type: string; name: string }[] = [];
              for (const pf of pendingFiles) {
                const url = await generateUploadUrl();
                const res = await fetch(url, {
                  method: "POST",
                  headers: { "Content-Type": pf.file.type },
                  body: pf.file,
                });
                const { storageId } = await res.json();
                uploadedMedia.push({
                  storageId,
                  type: detectType(pf.file),
                  name: pf.file.name,
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
              });
              toast.success("Post published");
              reset();
              onOpenChange(false);
            } catch (err: any) {
              setError(err?.message ?? "Failed to post");
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
                accept="image/*,video/*,.pdf,.doc,.docx,.txt"
                className="hidden"
                onChange={handleFileChange}
              />
              <span className="text-[10px] text-muted-foreground">
                Images, videos, or documents
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

