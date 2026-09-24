import { api } from "@/convex/_generated/api";
import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatError } from "@/components/shared";
import { cn } from "@/lib/utils";
import {
  formatBytes,
  uploadPickedFile,
  uploadVoiceNote,
  type UploadedMedia,
} from "@/lib/post-media";
import {
  VoiceDraftPlayer,
  VoiceRecorder,
  createVoiceDraft,
  releaseVoiceDrafts,
  type VoiceDraft,
} from "@/components/voice-note";
import {
  BarChart3,
  FileIcon,
  Paperclip,
  Plus,
  X,
} from "lucide-react";

/** Mirrors the server's poll rules (convex/posts.ts) so the composer fails early. */
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 8;
const MAX_QUESTION = 200;
const MAX_OPTION = 120;
const MAX_ATTACHMENTS = 5;

type PendingFile = {
  key: string;
  file: File;
  preview?: string;
};

let fileSeq = 0;

/**
 * Write an announcement.
 *
 * A post is a title, a message, attachments, a voice note — any of which can
 * stand alone — plus an optional poll. Everything else (titles of sections,
 * helper paragraphs) is deliberately absent.
 */
export function PostComposerDialog({
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
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [voice, setVoice] = useState<VoiceDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pollOpen, setPollOpen] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [pollMultiple, setPollMultiple] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<PendingFile[]>([]);
  const voiceRef = useRef<VoiceDraft[]>([]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);
  // Never leak preview URLs, whatever closes the dialog.
  useEffect(
    () => () => {
      for (const f of filesRef.current) {
        if (f.preview) URL.revokeObjectURL(f.preview);
      }
      releaseVoiceDrafts(voiceRef.current);
    },
    [],
  );

  const attachments = files.length + voice.length;
  const hasContent =
    title.trim().length > 0 || body.trim().length > 0 || attachments > 0;

  const reset = () => {
    for (const f of files) if (f.preview) URL.revokeObjectURL(f.preview);
    releaseVoiceDrafts(voice);
    setTitle("");
    setBody("");
    setTags("");
    setFiles([]);
    setVoice([]);
    setPollOpen(false);
    setPollQuestion("");
    setPollOptions(["", ""]);
    setPollMultiple(false);
    setError(null);
  };

  const addFiles = (list: FileList | null) => {
    const room = MAX_ATTACHMENTS - voice.length - files.length;
    const picked = Array.from(list ?? []).slice(0, Math.max(0, room));
    if (picked.length === 0) return;
    setFiles((prev) => [
      ...prev,
      ...picked.map((file) => {
        fileSeq += 1;
        return {
          key: `file-${Date.now()}-${fileSeq}`,
          file,
          preview: file.type.startsWith("image/")
            ? URL.createObjectURL(file)
            : undefined,
        };
      }),
    ]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (key: string) => {
    setFiles((prev) => {
      const target = prev.find((f) => f.key === key);
      if (target?.preview) URL.revokeObjectURL(target.preview);
      return prev.filter((f) => f.key !== key);
    });
  };

  const removeVoice = (key: string) => {
    setVoice((prev) => {
      const target = prev.find((v) => v.key === key);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((v) => v.key !== key);
    });
  };

  const publish = async () => {
    if (busy) return;
    setError(null);

    const pollChoices = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (pollOpen) {
      if (!pollQuestion.trim()) {
        setError("The poll needs a question");
        return;
      }
      if (pollChoices.length < MIN_OPTIONS) {
        setError("A poll needs at least two options");
        return;
      }
      if (pollChoices.some((t) => t.length > MAX_OPTION)) {
        setError(`Each option must be ${MAX_OPTION} characters or fewer`);
        return;
      }
      if (new Set(pollChoices.map((t) => t.toLowerCase())).size !== pollChoices.length) {
        setError("Poll options must all be different");
        return;
      }
    }
    if (!pollOpen && !hasContent) {
      setError("Write something, or record a voice note");
      return;
    }

    setBusy(true);
    try {
      const media: UploadedMedia[] = [];
      for (const pf of files) {
        media.push(await uploadPickedFile({ file: pf.file, generateUploadUrl }));
      }
      for (const draft of voice) {
        media.push(
          await uploadVoiceNote({
            blob: draft.blob,
            mimeType: draft.mimeType,
            durationMs: draft.durationMs,
            generateUploadUrl,
          }),
        );
      }

      await create({
        title: title.trim() || undefined,
        body: body.trim() || undefined,
        tags:
          tags
            .split(/[,\s]+/)
            .map((t) => t.trim().replace(/^#/, ""))
            .filter(Boolean)
            .slice(0, 5) || undefined,
        media: media.length > 0 ? media : undefined,
        poll: pollOpen
          ? {
              question: pollQuestion.trim(),
              allowMultiple: pollMultiple,
              options: pollChoices,
            }
          : undefined,
      });

      toast.success(pollOpen ? "Poll published" : "Post published");
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(formatError(err, "Could not publish"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">New post</DialogTitle>
        </DialogHeader>

        <div className="space-y-2.5">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            autoFocus
            className="border-0 border-b border-border/60 bg-transparent px-0 text-[15px] font-semibold shadow-none focus-visible:ring-0"
          />

          <Textarea
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your message…"
            className="resize-none border-0 bg-transparent px-0 text-[13px] leading-6 shadow-none focus-visible:ring-0"
          />

          {/* Attachments: picked files and recordings, side by side. */}
          {(files.length > 0 || voice.length > 0) && (
            <div className="space-y-2">
              {voice.length > 0 && (
                <div className="space-y-1.5">
                  {voice.map((draft) => (
                    <VoiceDraftPlayer
                      key={draft.key}
                      draft={draft}
                      onRemove={() => removeVoice(draft.key)}
                    />
                  ))}
                </div>
              )}
              {files.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {files.map((pf) => (
                    <div key={pf.key} className="group relative">
                      {pf.preview ? (
                        <img
                          src={pf.preview}
                          alt={pf.file.name}
                          className="h-16 w-16 rounded-lg border object-cover"
                        />
                      ) : (
                        <div className="flex h-16 w-24 flex-col items-center justify-center rounded-lg border bg-muted/40 px-1.5">
                          <FileIcon className="h-4 w-4 text-muted-foreground" />
                          <span className="mt-0.5 max-w-full truncate text-[8px] text-muted-foreground">
                            {pf.file.name}
                          </span>
                          <span className="text-[8px] text-muted-foreground/70">
                            {formatBytes(pf.file.size)}
                          </span>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => removeFile(pf.key)}
                        title="Remove attachment"
                        className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-destructive"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* The composer toolbar. */}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-dashed pt-2.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={attachments >= MAX_ATTACHMENTS}
              title="Attach photos, videos or documents"
              className="flex h-8 items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Paperclip className="h-3.5 w-3.5" />
              Attach
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*,.pdf,.doc,.docx,.txt"
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />

            <VoiceRecorder
              disabled={busy || attachments >= MAX_ATTACHMENTS}
              onRecorded={(note) => setVoice((prev) => [...prev, createVoiceDraft(note)])}
            />

            <button
              type="button"
              onClick={() => setPollOpen((v) => !v)}
              title="Add a poll"
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors",
                pollOpen
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:text-primary",
              )}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              Poll
            </button>

            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="tags"
              className="h-8 w-28 border-0 bg-transparent px-2 text-[11px] shadow-none focus-visible:ring-0"
            />
          </div>

          {pollOpen && (
            <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/20 p-2.5">
              <Input
                value={pollQuestion}
                onChange={(e) => setPollQuestion(e.target.value)}
                maxLength={MAX_QUESTION}
                placeholder="Question"
                className="h-8 text-[12px]"
              />
              <div className="space-y-1.5">
                {pollOptions.map((option, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={option}
                      onChange={(e) =>
                        setPollOptions((prev) =>
                          prev.map((o, j) => (j === i ? e.target.value : o)),
                        )
                      }
                      maxLength={MAX_OPTION}
                      placeholder={`Option ${i + 1}`}
                      className="h-8 text-[12px]"
                    />
                    {pollOptions.length > MIN_OPTIONS && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="Remove option"
                        className="h-8 w-8 shrink-0"
                        onClick={() =>
                          setPollOptions((prev) => prev.filter((_, j) => j !== i))
                        }
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              {pollOptions.length < MAX_OPTIONS && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => setPollOptions((prev) => [...prev, ""])}
                >
                  <Plus className="mr-1 h-3 w-3" /> Option
                </Button>
              )}
              <div className="flex items-center gap-2 pt-0.5">
                <Switch
                  id="composer-poll-multi"
                  checked={pollMultiple}
                  onCheckedChange={(v: boolean) => setPollMultiple(v)}
                />
                <Label htmlFor="composer-poll-multi" className="text-[11px]">
                  Multiple answers
                </Label>
              </div>
            </div>
          )}

          {error && <p className="text-[11px] text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button type="button" disabled={busy || (!pollOpen && !hasContent)} onClick={publish}>
            {busy ? "Publishing…" : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
