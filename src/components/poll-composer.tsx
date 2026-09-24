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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatError } from "@/components/shared";
import {
  EMPTY_SCHEDULE,
  PollScheduleFields,
  PollScheduleValue,
  parsePollSchedule,
} from "@/components/poll-schedule";
import { BarChart3, Plus, X } from "lucide-react";

// Mirrors the server's poll rules (convex/posts.ts) so the composer fails early.
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 8;
const MAX_QUESTION = 200;
const MAX_OPTION = 120;

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
  // Deadline + closing reminder, shared with the reschedule dialog.
  const [schedule, setSchedule] = useState<PollScheduleValue>(EMPTY_SCHEDULE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setQuestion("");
    setOptions(["", ""]);
    setMultiple(false);
    setSchedule(EMPTY_SCHEDULE);
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
            const parsed = parsePollSchedule(schedule);
            if (parsed.error) {
              setError(parsed.error);
              return;
            }

            setBusy(true);
            setError(null);
            try {
              await create({
                poll: {
                  question: question.trim(),
                  allowMultiple: multiple,
                  options: texts,
                  closesAt: parsed.closesAt,
                  reminderMinutesBefore: parsed.reminderMinutesBefore,
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
            <Label htmlFor="poll-multiple" className="text-[11px] font-normal">
              Multiple answers
            </Label>
          </div>

          <PollScheduleFields
            idPrefix="poll"
            value={schedule}
            onChange={setSchedule}
          />

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
