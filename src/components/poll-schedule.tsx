import { api } from "@/convex/_generated/api";
import { useMutation } from "convex/react";
import { useEffect, useState } from "react";
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
import { cn } from "@/lib/utils";
import { formatError } from "@/components/shared";
import { Bell, CalendarClock } from "lucide-react";

// Mirrors the server's rules (convex/posts.ts) so these fields fail early.
const MIN_LEAD_MS = 60_000;

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

/** What the schedule fields hold: a datetime-local string and a lead time. */
export type PollScheduleValue = {
  /** "" means no deadline. */
  closesAtLocal: string;
  /** null means no reminder. */
  remindMinutes: number | null;
};

export const EMPTY_SCHEDULE: PollScheduleValue = {
  closesAtLocal: "",
  remindMinutes: null,
};

/** Epoch ms → the value a datetime-local input expects (local time). */
export function toLocalInput(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/** An existing poll's schedule, as the fields expect it. */
export function scheduleFrom(
  closesAt?: number,
  reminderMinutesBefore?: number,
): PollScheduleValue {
  return {
    closesAtLocal: closesAt !== undefined ? toLocalInput(closesAt) : "",
    remindMinutes: reminderMinutesBefore ?? null,
  };
}

/**
 * Turn the fields into mutation arguments, or into the message to show the
 * user. Both the composer and the reschedule dialog validate through this, so
 * the two can never disagree with each other or with the server.
 */
export function parsePollSchedule(value: PollScheduleValue): {
  closesAt?: number;
  reminderMinutesBefore?: number;
  error?: string;
} {
  let closesAt: number | undefined;
  if (value.closesAtLocal) {
    const t = new Date(value.closesAtLocal).getTime();
    if (!Number.isFinite(t)) return { error: "That close time is not a valid date" };
    if (t <= Date.now() + MIN_LEAD_MS) {
      return { error: "Pick a close time at least a minute from now" };
    }
    closesAt = t;
  }

  if (value.remindMinutes !== null) {
    if (closesAt === undefined) {
      return { error: "Add a close time to send a reminder" };
    }
    if (closesAt - Date.now() <= value.remindMinutes * 60_000) {
      return {
        error:
          "The reminder must land before the poll closes — pick a shorter reminder or a later close time",
      };
    }
  }

  return {
    closesAt,
    reminderMinutesBefore: value.remindMinutes ?? undefined,
  };
}

/** The deadline + reminder controls, shared by creating and rescheduling. */
export function PollScheduleFields({
  value,
  onChange,
  idPrefix,
  closed,
}: {
  value: PollScheduleValue;
  onChange: (v: PollScheduleValue) => void;
  /** Keeps input ids unique when two of these are mounted at once. */
  idPrefix: string;
  /** A closed poll keeps its schedule on show but nothing here is editable. */
  closed?: boolean;
}) {
  // A reminder without a deadline is impossible, so removing the deadline
  // removes the reminder with it — otherwise the form would refuse to submit
  // with a rule the user can no longer see.
  const setDeadline = (closesAtLocal: string) =>
    onChange({
      closesAtLocal,
      remindMinutes: closesAtLocal ? value.remindMinutes : null,
    });

  return (
    <div className="rounded-lg border border-dashed p-3">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
        <Label htmlFor={`${idPrefix}-closes`} className="text-[12px]">
          Closes
        </Label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {CLOSE_PRESETS.map((p) => {
          const tsAt = Date.now() + p.hours * 60 * 60 * 1000;
          const presetValue = toLocalInput(tsAt);
          const active = value.closesAtLocal === presetValue;
          return (
            <button
              key={p.label}
              type="button"
              disabled={closed}
              onClick={() => setDeadline(active ? "" : presetValue)}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                active
                  ? "border-primary/50 bg-accent text-primary"
                  : "border-border bg-muted/40 text-muted-foreground hover:text-primary",
                closed && "cursor-default opacity-70",
              )}
            >
              {p.label}
            </button>
          );
        })}
        {value.closesAtLocal && (
          <button
            type="button"
            disabled={closed}
            onClick={() => setDeadline("")}
            className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            No deadline
          </button>
        )}
      </div>
      <Input
        id={`${idPrefix}-closes`}
        type="datetime-local"
        disabled={closed}
        className="mt-2 h-8 text-[12px]"
        value={value.closesAtLocal}
        onChange={(e) => setDeadline(e.target.value)}
      />

      {/* Reminder push — only meaningful with a deadline. */}
      {value.closesAtLocal && (
        <div className="mt-3 border-t border-dashed pt-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Bell className="h-3.5 w-3.5 text-muted-foreground" />
              <Label htmlFor={`${idPrefix}-remind`} className="text-[12px]">
                Closing reminder
              </Label>
            </div>
            <Switch
              id={`${idPrefix}-remind`}
              disabled={closed}
              checked={value.remindMinutes !== null}
              onCheckedChange={(v: boolean) =>
                onChange({ ...value, remindMinutes: v ? 60 * 24 : null })
              }
            />
          </div>
          {value.remindMinutes !== null && (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {REMIND_PRESETS.map((r) => (
                  <button
                    key={r.minutes}
                    type="button"
                    disabled={closed}
                    onClick={() =>
                      onChange({ ...value, remindMinutes: r.minutes })
                    }
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                      value.remindMinutes === r.minutes
                        ? "border-primary/50 bg-accent text-primary"
                        : "border-border bg-muted/40 text-muted-foreground hover:text-primary",
                      closed && "cursor-default opacity-70",
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Reschedule an open poll: move or clear its deadline and its closing reminder.
 * The server refuses this on a closed poll (reopen it first), so a reschedule
 * can't quietly undo a result that was already announced.
 */
export function PollScheduleDialog({
  postId,
  question,
  closesAt,
  reminderMinutesBefore,
  open,
  onOpenChange,
}: {
  postId: string;
  question: string;
  closesAt?: number;
  reminderMinutesBefore?: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const setSchedule = useMutation(api.posts.setPollSchedule);
  const [value, setValue] = useState<PollScheduleValue>(
    scheduleFrom(closesAt, reminderMinutesBefore),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-read the poll's schedule each time the dialog opens.
  useEffect(() => {
    if (open) {
      setValue(scheduleFrom(closesAt, reminderMinutesBefore));
      setError(null);
    }
  }, [open, closesAt, reminderMinutesBefore]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-primary" /> Poll schedule
          </DialogTitle>
          <DialogDescription className="line-clamp-2">
            {question}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const parsed = parsePollSchedule(value);
            if (parsed.error) {
              setError(parsed.error);
              return;
            }
            setBusy(true);
            setError(null);
            try {
              await setSchedule({
                postId: postId as any,
                // null clears: this dialog always describes the whole schedule.
                closesAt: parsed.closesAt ?? null,
                reminderMinutesBefore: parsed.reminderMinutesBefore ?? null,
              });
              toast.success(
                parsed.closesAt
                  ? "Poll deadline updated"
                  : "Poll deadline cleared",
              );
              onOpenChange(false);
            } catch (err) {
              setError(formatError(err, "Could not update the poll schedule"));
            } finally {
              setBusy(false);
            }
          }}
        >
          <PollScheduleFields
            idPrefix="reschedule"
            value={value}
            onChange={setValue}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving..." : "Save schedule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
