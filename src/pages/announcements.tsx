import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
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
  MessageSquare,
  Pin,
  Plus,
  Search,
  Send,
  Trash2,
  UserRound,
} from "lucide-react";

export default function Announcements() {
  const [search, setSearch] = useState("");
  const [author, setAuthor] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

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
        description="Team updates, testimonies and ministry content. Anyone on the team can post, and every post has a comment thread."
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
              <article key={p._id} className="overflow-hidden rounded-lg border bg-card">
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

function CommentThread({ postId }: { postId: string }) {
  const post = useQuery(api.posts.get, { id: postId as any });
  const addComment = useMutation(api.posts.addComment);
  const removeComment = useMutation(api.posts.removeComment);
  const me = useQuery(api.users.currentUser);
  const isAdmin = me?.role === "admin";
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="border-t bg-muted/30 px-4 py-4 sm:px-5">
      <div className="space-y-3">
        {(post?.comments ?? []).map((c) => {
          const canDelete = isAdmin || c.authorId === me?._id;
          return (
            <div key={c._id} className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-card">
                <UserRound className="h-3 w-3 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] font-semibold">{c.author}</span>
                  <span className="text-[9px] text-muted-foreground">
                    {fmtDateTime(new Date(c.createdAt).toISOString())}
                  </span>
                  {canDelete && (
                    <button
                      className="ml-auto text-[9px] text-muted-foreground hover:text-destructive"
                      onClick={async () => {
                        await removeComment({ id: c._id });
                        toast.success("Comment removed");
                      }}
                    >
                      remove
                    </button>
                  )}
                </div>
                <p className="mt-0.5 text-[12px] leading-5 text-foreground/85">{c.body}</p>
              </div>
            </div>
          );
        })}
        {post && post.comments.length === 0 && (
          <p className="py-1 text-center text-[11px] text-muted-foreground">
            No comments yet — be the first to respond.
          </p>
        )}
      </div>

      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!body.trim()) return;
          setBusy(true);
          await addComment({ postId: postId as any, body: body.trim() });
          setBody("");
          setBusy(false);
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

function CreatePostDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const create = useMutation(api.posts.create);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              await create({
                title: title.trim(),
                body: body.trim(),
                tags: tags
                  .split(/[,\s]+/)
                  .map((t) => t.trim().replace(/^#/, ""))
                  .filter(Boolean)
                  .slice(0, 5) || undefined,
              });
              toast.success("Post published");
              setTitle("");
              setBody("");
              setTags("");
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
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
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

