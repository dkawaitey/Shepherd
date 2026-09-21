import { api } from "@/convex/_generated/api";
import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatError } from "@/components/shared";
import { BarChart3, Bell, CalendarClock, Plus, X } from "lucide-react";

// Mirrors the server's poll rules (convex/posts.ts) so the composer fails early.
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 8;
const MAX_QUESTION = 200;
const MAX_OPTION = 120;

/** Quick auto-close presets, in hours from now. */
const CLOSE_PRESETS: { label: string; hours: number }[] = [
  { label: "24 hours", hours: 24 },
  { label: "3 days", hours: 72 },
  { label: "1 week", hours: 168 },
];

/** "Remind everyone before it closes" lead times, in minutes. */
const REMIND_PRESETS: { label: string; minutes: number }[] = [
  { label: "1 hour before", minutes: 60 },
  { label: "1 day before", minutes: 60 * 24 },
  { label: "3 days before", minutes: 60 * 24 * 3 },
];

/** Epoch ms → the value a datetime-local input expects (local time). */
function toLocalInput(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/**
 * Publish a standalone poll.
 *
 * A poll is its own announcement: it needs a question and options, and nothing
 * else — no title, no content (see posts.create, where both are optional when a
 * poll is supplied). Used by the dashboard quick action and the announcements
 * page, so publishing a poll never means leaving the page you are on.
 */
export function PollComposer({
  open,
  onOpenChange,
  onPublished,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Called after a poll is published, e.g. to close a parent panel. */
  onPublished?: () => void;
}) {
  const create = useMutation(api.posts.create);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [multiple, setMultiple] = useState(false);
  // Empty string = no deadline; otherwise a datetime-local value.
  const [closesAt, setClosesAt] = useState("");
  // Lead time for the "closes soon" push, in minutes. null = no reminder.
  const [remindMinutes, setRemindMinutes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setQuestion("");
    setOptions(["", ""]);
    setMultiple(false);
    setClosesAt("");
    setRemindMinutes(null);
    setError(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" /> New poll
          </DialogTitle>
          <DialogDescription>
            Polls are standalone — just a question and its answers. It appears in
            the announcements feed straight away, where everyone can answer it.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const texts = options.map((o) => o.trim()).filter(Boolean);
            if (!question.trim()) {
              setError("Give the poll a question");
              return;
            }
            if (texts.length < MIN_OPTIONS) {
              setError("A poll needs at least two options");
              return;
            }
            if (texts.some((t) => t.length > MAX_OPTION)) {
              setError(`Each option must be ${MAX_OPTION} characters or fewer`);
              return;
            }
            if (new Set(texts.map((t) => t.toLowerCase())).size !== texts.length) {
              setError("Poll options must all be different");
              return;
            }
            let deadline: number | undefined;
            if (closesAt) {
              const t = new Date(closesAt).getTime();
              if (!Number.isFinite(t)) {
                setError("That close time is not a valid date");
                return;
              }
              if (t <= Date.now() + 60_000) {
                setError("Pick a close time at least a minute from now");
                return;
              }
              deadline = t;
            }
            if (remindMinutes !== null) {
              if (deadline === undefined) {
                setError("Add a close time to send a reminder");
                return;
              }
              if (deadline - Date.now() <= remindMinutes * 60_000) {
                setError(
                  "The reminder must land before the poll closes — pick a shorter reminder or a later close time",
                );
                return;
              }
            }

            setBusy(true);
            setError(null);
            try {
              await create({
                poll: {
                  question: question.trim(),
                  allowMultiple: multiple,
                  options: texts,
                  closesAt: deadline,
                  reminderMinutesBefore:
                    deadline !== undefined && remindMinutes !== null
                      ? remindMinutes
                      : undefined,
                },
              });
              toast.success("Poll published");
              reset();
              onPublished?.();
              onOpenChange(false);
            } catch (err) {
              setError(formatError(err, "Could not publish the poll"));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div>
            <Label htmlFor="poll-question">Question *</Label>
            <Input
              id="poll-question"
              className="mt-1"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={MAX_QUESTION}
              placeholder="Which day suits you for the outreach?"
              autoFocus
            />
          </div>

          <div>
            <Label>Options *</Label>
            <div className="mt-1 space-y-1.5">
              {options.map((option, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    className="h-8 text-[12px]"
                    value={option}
                    onChange={(e) =>
                      setOptions((prev) =>
                        prev.map((o, j) => (j === i ? e.target.value : o)),
                      )
                    }
                    maxLength={MAX_OPTION}
                    placeholder={`Option ${i + 1}`}
                  />
                  {options.length > MIN_OPTIONS && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      title="Remove option"
                      onClick={() =>
                        setOptions((prev) => prev.filter((_, j) => j !== i))
                      }
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {options.length < MAX_OPTIONS && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-1.5 h-7 text-[11px]"
                onClick={() => setOptions((prev) => [...prev, ""])}
              >
                <Plus className="mr-1 h-3 w-3" /> Add option
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="poll-multiple"
              checked={multiple}
              onCheckedChange={(v: boolean) => setMultiple(v)}
            />
            <Label
              htmlFor="poll-multiple"
              className="text-[11px] font-normal text-muted-foreground"
            >
              Let people choose more than one answer
            </Label>
          </div>

          <div className="rounded-lg border border-dashed p-3">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
              <Label htmlFor="poll-closes" className="text-[12px]">
                Close automatically (optional)
              </Label>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {CLOSE_PRESETS.map((p) => {
                const ts = Date.now() + p.hours * 60 * 60 * 1000;
                const value = toLocalInput(ts);
                const active = closesAt === value;
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setClosesAt(active ? "" : value)}
                    className={
                      "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors " +
                      (active
                        ? "border-primary/50 bg-accent text-primary"
                        : "border-border bg-muted/40 text-muted-foreground hover:text-primary")
                    }
                  >
                    {p.label}
                  </button>
                );
              })}
              {closesAt && (
                <button
                  type="button"
                  onClick={() => setClosesAt("")}
                  className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:text-primary"
                >
                  No deadline
                </button>
              )}
            </div>
            <Input
              id="poll-closes"
              type="datetime-local"
              className="mt-2 h-8 text-[12px]"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
            />
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Answers stop being accepted at this time. Leave it empty to close
              the poll yourself whenever you are ready.
            </p>

            {/* Reminder push — only meaningful with a deadline, so the whole
                block stays hidden until one is set. */}
            {closesAt && (
              <div className="mt-3 border-t border-dashed pt-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Bell className="h-3.5 w-3.5 text-muted-foreground" />
                    <Label htmlFor="poll-remind" className="text-[12px]">
                      Remind everyone before it closes
                    </Label>
                  </div>
                  <Switch
                    id="poll-remind"
                    checked={remindMinutes !== null}
                    onCheckedChange={(v: boolean) =>
                      setRemindMinutes(v ? 60 * 24 : null)
                    }
                  />
                </div>
                {remindMinutes !== null && (
                  <>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {REMIND_PRESETS.map((r) => (
                        <button
                          key={r.minutes}
                          type="button"
                          onClick={() => setRemindMinutes(r.minutes)}
                          className={
                            "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors " +
                            (remindMinutes === r.minutes
                              ? "border-primary/50 bg-accent text-primary"
                              : "border-border bg-muted/40 text-muted-foreground hover:text-primary")
                          }
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[10px] text-muted-foreground">
                      A device notification goes out to everyone at that time,
                      so nobody misses the deadline.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

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
            <Button type="submit" disabled={busy}>
              {busy ? "Publishing..." : "Publish poll"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
