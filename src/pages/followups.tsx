import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FOLLOWUP_STATUS,
  FOLLOWUP_TYPE_LABELS,
  FOLLOWUP_TYPES,
} from "@/convex/constants";
import {
  EmptyState,
  PageHeader,
  StatusPill,
  fmtDate,
  fmtTime,
  formatError,
  userCanWrite,
} from "@/components/shared";
import { isOfflineError, queueEntry } from "@/lib/offline-sync";
import { cn } from "@/lib/utils";
import {
  AlarmClock,
  AlertTriangle,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  Hash,
  Lock,
  Search,
  type LucideIcon,
  Tag,
  Trash2,
  UserRound,
  XCircle,
} from "lucide-react";

// ============ Status change modal (required fields; nothing saved until submit) ============
export function StatusChangeDialog({
  followup,
  open,
  onOpenChange,
}: {
  followup: any | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const changeStatus = useMutation(api.followups.changeStatus);
  const [status, setStatus] = useState<string>(FOLLOWUP_STATUS.COMPLETED);
  const [outcome, setOutcome] = useState("");
  const [reasonMissed, setReasonMissed] = useState("");
  const [reasonCancelled, setReasonCancelled] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStatus(FOLLOWUP_STATUS.COMPLETED);
      setOutcome("");
      setReasonMissed("");
      setReasonCancelled("");
      setError(null);
    }
  }, [open, followup]);

  if (!followup) return null;

  const required =
    status === FOLLOWUP_STATUS.COMPLETED
      ? outcome.trim()
      : status === FOLLOWUP_STATUS.MISSED
        ? reasonMissed.trim()
        : reasonCancelled.trim();

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await changeStatus({
        id: followup._id,
        status,
        outcome: status === FOLLOWUP_STATUS.COMPLETED ? outcome : undefined,
        reasonMissed: status === FOLLOWUP_STATUS.MISSED ? reasonMissed : undefined,
        reasonCancelled: status === FOLLOWUP_STATUS.CANCELLED ? reasonCancelled : undefined,
      });
      toast.success(
        status === FOLLOWUP_STATUS.COMPLETED
          ? "Follow-up completed — timeline updated"
          : status === FOLLOWUP_STATUS.MISSED
            ? "Follow-up marked as missed"
            : "Follow-up cancelled",
      );
      onOpenChange(false);
    } catch (err: any) {
      setError(formatError(err, "Failed to update status"));
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Update follow-up status</DialogTitle>
          <DialogDescription>
            {followup.contactName} · {FOLLOWUP_TYPE_LABELS[followup.type]} · {fmtDate(followup.date)}
            {followup.time ? ` · ${fmtTime(followup.time)}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>New status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FOLLOWUP_STATUS.COMPLETED}>Completed</SelectItem>
                <SelectItem value={FOLLOWUP_STATUS.MISSED}>Missed</SelectItem>
                <SelectItem value={FOLLOWUP_STATUS.CANCELLED}>Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {status === FOLLOWUP_STATUS.COMPLETED && (
            <div>
              <Label htmlFor="fu-outcome">
                Outcome of follow-up <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="fu-outcome"
                rows={3}
                className="mt-1"
                placeholder="e.g. Person accepted invitation to Bible study."
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                autoFocus
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                The spiritual timeline and dashboard statistics update automatically after saving.
              </p>
            </div>
          )}

          {status === FOLLOWUP_STATUS.MISSED && (
            <div>
              <Label htmlFor="fu-missed">
                Reason missed <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="fu-missed"
                rows={3}
                className="mt-1"
                placeholder="e.g. Person was not at home; neighbour said they travelled."
                value={reasonMissed}
                onChange={(e) => setReasonMissed(e.target.value)}
                autoFocus
              />
            </div>
          )}

          {status === FOLLOWUP_STATUS.CANCELLED && (
            <div>
              <Label htmlFor="fu-cancel">
                Reason for cancellation <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="fu-cancel"
                rows={3}
                className="mt-1"
                placeholder="e.g. Worker unavailable; rescheduling next week."
                value={reasonCancelled}
                onChange={(e) => setReasonCancelled(e.target.value)}
                autoFocus
              />
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="rounded-md border border-[#f59e0b]/40 bg-[#2e2408] px-3 py-2 text-[11px] text-[#fbbf24]">
            Closing this window keeps the follow-up as <b>Pending</b> — nothing is saved until you submit.
            Once saved, the status is locked. Only an administrator can override it.
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !required}>
            {busy ? "Saving..." : "Save & lock status"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Schedule dialog ============
export function ScheduleDialog({
  open,
  onOpenChange,
  presetContactId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  presetContactId?: string;
}) {
  const contacts = useQuery(api.contacts.list, {});
  const create = useMutation(api.followups.create);
  const [form, setForm] = useState<{
    contactId: string;
    type: string;
    date: string;
    time: string;
    assignedWorker: string;
    notes: string;
    reminder: boolean;
  }>({
    contactId: presetContactId ?? "",
    type: FOLLOWUP_TYPES.HOME_VISIT,
    date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
    time: "09:00",
    assignedWorker: "",
    notes: "",
    reminder: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm((f) => ({
        ...f,
        contactId: presetContactId ?? f.contactId,
        date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
        time: f.time || "09:00",
      }));
      setError(null);
    }
  }, [open, presetContactId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.contactId || !form.date) {
      setError("Contact and date are required");
      return;
    }
    setBusy(true);
    setError(null);
    const payload = {
      contactId: form.contactId as any,
      type: form.type,
      date: new Date(form.date).toISOString(),
      time: form.time || undefined,
      assignedWorker: form.assignedWorker || undefined,
      notes: form.notes || undefined,
      reminder: form.reminder,
    };
    if (!navigator.onLine) {
      queueEntry("createFollowup", payload);
      toast.warning(
        "Scheduled offline — it will sync automatically when you're back online.",
      );
      onOpenChange(false);
      return;
    }
    try {
      await create(payload);
      toast.success("Follow-up scheduled (status: Pending)");
      onOpenChange(false);
    } catch (err: any) {
      if (isOfflineError(err)) {
        queueEntry("createFollowup", payload);
        toast.warning(
          "Scheduled offline — it will sync automatically when you're back online.",
        );
        onOpenChange(false);
      } else {
        setError(formatError(err, "Failed to schedule"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Schedule follow-up</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label htmlFor="fu-contact">Contact *</Label>
            <Select value={form.contactId} onValueChange={(v) => setForm((f) => ({ ...f, contactId: v }))}>
              <SelectTrigger id="fu-contact" className="mt-1 w-full">
                <SelectValue placeholder="Select contact" />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {(contacts ?? []).map((c) => (
                  <SelectItem key={c._id} value={c._id}>
                    {c.fullName} · {c.membershipId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="fu-type">Type *</Label>
            <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
              <SelectTrigger id="fu-type" className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(FOLLOWUP_TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="fu-date">Date *</Label>
              <Input id="fu-date" type="date" className="mt-1" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="fu-time">Time</Label>
              <Input id="fu-time" type="time" className="mt-1" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label htmlFor="fu-worker">Assigned worker</Label>
            <Input id="fu-worker" className="mt-1" value={form.assignedWorker} onChange={(e) => setForm((f) => ({ ...f, assignedWorker: e.target.value }))} placeholder="Brother Daniel" />
          </div>
          <div>
            <Label htmlFor="fu-notes">Notes</Label>
            <Textarea id="fu-notes" rows={2} className="mt-1" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Remind about the Bible study invitation..." />
          </div>
          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={form.reminder} onCheckedChange={(v) => setForm((f) => ({ ...f, reminder: !!v }))} />
            Send reminder
          </label>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Scheduling..." : "Schedule"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============ Follow-ups page ============
export default function Followups() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [changing, setChanging] = useState<any | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null);

  const status = searchParams.get("status") ?? "";
  const search = searchParams.get("search") ?? "";

  const followups = useQuery(api.followups.list, {
    status: status || undefined,
    search: search || undefined,
  });
  const me = useQuery(api.users.currentUser);
  // Scheduling, updating and deleting follow-ups is coordinators, workers and
  // class leaders (plus admins) on the server — a read-only leader or a plain
  // member may follow along, but not act.
  const canWork = userCanWrite(me);
  const remove = useMutation(api.followups.remove);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const tabs = [
    { value: "", label: "All" },
    { value: FOLLOWUP_STATUS.PENDING, label: "Pending" },
    { value: FOLLOWUP_STATUS.COMPLETED, label: "Completed" },
    { value: FOLLOWUP_STATUS.MISSED, label: "Missed" },
    { value: FOLLOWUP_STATUS.CANCELLED, label: "Cancelled" },
  ];

  const grouped = useMemo(() => {
    const pending = (followups ?? []).filter((f) => f.status === FOLLOWUP_STATUS.PENDING);
    const done = (followups ?? []).filter((f) => f.status !== FOLLOWUP_STATUS.PENDING);
    // A scheduled visit whose day has already passed is the one thing a worker
    // must not miss, so it is counted here and told apart from "just upcoming".
    const today = todayKey();
    const overdue = pending.filter((f) => dayKey(f.date) < today).length;
    const dueToday = pending.filter((f) => dayKey(f.date) === today).length;
    return { pending, done, overdue, dueToday };
  }, [followups]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Follow-ups"
        code="fup"
        actions={
          canWork ? (
            <Button onClick={() => setScheduleOpen(true)}>
              <CalendarPlus className="mr-1.5 h-4 w-4" /> Schedule follow-up
            </Button>
          ) : null
        }
      />

      {/* Status tabs */}
      <div className="mb-4 flex flex-wrap gap-1.5 rounded-lg border bg-card p-1.5">
        {tabs.map((t) => (
          <button
            key={t.value}
            onClick={() => setParam("status", t.value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              status === t.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t.label}
            {t.value && (
              <span className="ml-1.5 opacity-70">
                {(followups ?? []).filter((f) => f.status === t.value).length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="relative mb-5 max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by contact name or ID..."
          className="pl-8"
          defaultValue={search}
          onChange={(e) => setParam("search", e.target.value)}
        />
      </div>

      {/* Legend */}
      <div className="mb-4 flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
        <span className="term-label">status legend</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-status-amber" /> Pending</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-status-green" /> Completed</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-status-red" /> Missed</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-status-grey" /> Cancelled</span>
      </div>

      {/* At-a-glance summary of the schedule. */}
      {followups !== undefined && followups.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <SummaryStat
            icon={CalendarClock}
            label="Scheduled"
            value={grouped.pending.length}
            hint={grouped.dueToday > 0 ? `${grouped.dueToday} due today` : "awaiting visit"}
          />
          <SummaryStat
            icon={AlarmClock}
            label="Overdue"
            value={grouped.overdue}
            tone={grouped.overdue > 0 ? "red" : "muted"}
            hint={grouped.overdue > 0 ? "needs attention" : "all on track"}
          />
          <SummaryStat
            icon={CheckCircle2}
            label="Completed"
            value={(followups ?? []).filter((f) => f.status === FOLLOWUP_STATUS.COMPLETED).length}
            tone="green"
            hint="journey advanced"
          />
        </div>
      )}

      {followups === undefined ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg border bg-card" />
          ))}
        </div>
      ) : followups.length === 0 ? (
        <EmptyState
          title="No follow-ups here"
          message="Schedule your first follow-up to start the discipleship journey."
          action={
            canWork ? (
              <Button onClick={() => setScheduleOpen(true)}>
                <CalendarPlus className="mr-1.5 h-4 w-4" /> Schedule follow-up
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-4">
          {grouped.overdue > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-status-red/40 bg-status-red/10 px-3 py-2 text-[11px] font-medium text-status-red">
              <AlarmClock className="h-4 w-4 shrink-0" />
              {grouped.overdue} scheduled follow-up{grouped.overdue === 1 ? "" : "s"} slipped past
              {grouped.overdue === 1 ? " its" : " their"} date — time to reach out.
            </div>
          )}

          {grouped.pending.length > 0 && (
            <div className="space-y-2.5">
              <SectionHeading>
                scheduled
                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                  {grouped.pending.length}
                </span>
              </SectionHeading>
              {grouped.pending.map((f) => (
                <FollowupRow
                  key={f._id}
                  f={f}
                  onStatus={canWork ? () => setChanging(f) : undefined}
                  onDelete={canWork ? () => setConfirmDelete(f) : undefined}
                />
              ))}
            </div>
          )}

          {grouped.done.length > 0 && (
            <div className="space-y-2.5">
              <SectionHeading>
                closed
                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                  {grouped.done.length}
                </span>
              </SectionHeading>
              {grouped.done.map((f) => (
                <FollowupRow
                  key={f._id}
                  f={f}
                  onStatus={canWork ? () => setChanging(f) : undefined}
                  onDelete={canWork ? () => setConfirmDelete(f) : undefined}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <ScheduleDialog open={scheduleOpen} onOpenChange={setScheduleOpen} />
      <StatusChangeDialog followup={changing} open={!!changing} onOpenChange={(v) => !v && setChanging(null)} />

      {/* Delete confirmation */}
      <Dialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete follow-up?</DialogTitle>
            <DialogDescription>
              {confirmDelete?.contactName} · {FOLLOWUP_TYPE_LABELS[confirmDelete?.type]} ·{" "}
              {confirmDelete && fmtDate(confirmDelete.date)}. This removes the scheduled follow-up.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!confirmDelete) return;
                await remove({ id: confirmDelete._id });
                toast.success("Follow-up deleted");
                setConfirmDelete(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Date helpers for the schedule ----------

/** Today as a local YYYY-MM-DD key (avoids the UTC day-shift of toISOString). */
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function dayKey(iso: string) {
  return (iso || "").slice(0, 10);
}

/** Whole days from `from` to `to` (positive = in the future). */
function daysBetween(from: string, to: string) {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * How a pending follow-up reads against today. An overdue visit is stated in
 * days and tinted red so a slipped appointment can't hide in a long list; the
 * upcoming days get a softer cue, and anything further out stays plain.
 */
function dueMeta(f: { status: string; date: string }) {
  if (f.status !== FOLLOWUP_STATUS.PENDING) return null;
  const diff = daysBetween(todayKey(), dayKey(f.date));
  if (diff < 0) {
    const n = Math.abs(diff);
    return {
      label: n === 1 ? "Overdue by 1 day" : `Overdue by ${n} days`,
      cls: "border-status-red/40 bg-status-red/10 text-status-red",
    };
  }
  if (diff === 0)
    return { label: "Due today", cls: "border-status-amber/40 bg-status-amber/10 text-status-amber" };
  if (diff === 1)
    return { label: "Due tomorrow", cls: "border-status-amber/30 bg-status-amber/5 text-status-amber" };
  if (diff <= 7)
    return { label: `Due in ${diff} days`, cls: "border-border bg-muted/50 text-muted-foreground" };
  return null;
}

/** A single figure in the schedule summary strip. */
function SummaryStat({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  hint: string;
  tone?: "default" | "red" | "green" | "muted";
}) {
  const toneCls =
    tone === "red"
      ? "text-status-red"
      : tone === "green"
        ? "text-status-green"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-foreground";
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-3.5 py-3">
      <Icon className={cn("h-5 w-5 shrink-0", toneCls)} />
      <div className="min-w-0">
        <div
          className={cn(
            "font-mono text-lg font-semibold leading-none tabular-nums",
            toneCls,
          )}
        >
          {value}
        </div>
        <div className="mt-1 truncate text-[10px] uppercase tracking-wide text-muted-foreground">
          {label} · {hint}
        </div>
      </div>
    </div>
  );
}

/** A quiet rule + label that separates "scheduled" from "closed". */
function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-0.5">
      <span className="term-label">{children}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function FollowupRow({
  f,
  onStatus,
  onDelete,
}: {
  f: any;
  onStatus?: () => void;
  onDelete?: () => void;
}) {
  const due = dueMeta(f);
  // A 4px status rail down the left edge, so the list scans by colour before
  // it is read: amber waiting, green done, red missed, grey cancelled.
  const rail =
    f.status === FOLLOWUP_STATUS.PENDING
      ? "border-l-status-amber/70"
      : f.status === FOLLOWUP_STATUS.COMPLETED
        ? "border-l-status-green/60"
        : f.status === FOLLOWUP_STATUS.MISSED
          ? "border-l-status-red/60"
          : "border-l-status-grey/50";
  const outcome: string | null = f.outcome ?? f.reasonMissed ?? f.reasonCancelled ?? null;
  const outcomeLabel = f.outcome
    ? "Outcome"
    : f.reasonMissed
      ? "Reason missed"
      : f.reasonCancelled
        ? "Reason cancelled"
        : "";
  const OutcomeIcon = f.outcome ? CheckCircle2 : f.reasonMissed ? AlertTriangle : XCircle;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-l-4 bg-card p-4 transition-shadow hover:shadow-sm sm:flex-row sm:items-start",
        rail,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/contacts/${f.contactId}`}
            className="text-sm font-bold hover:text-primary hover:underline"
          >
            {f.contactName}
          </Link>
          <StatusPill status={f.status} />
          {due && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                due.cls,
              )}
            >
              <AlarmClock className="h-3 w-3" /> {due.label}
            </span>
          )}
          {f.locked && (
            <span
              className="flex items-center gap-1 text-[10px] text-muted-foreground"
              title="Status locked"
            >
              <Lock className="h-3 w-3" /> locked
            </span>
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Tag className="h-3 w-3" /> {FOLLOWUP_TYPE_LABELS[f.type] ?? f.type}
          </span>
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="h-3 w-3" /> {fmtDate(f.date)}
            {f.time ? ` · ${fmtTime(f.time)}` : ""}
          </span>
          <span className="inline-flex items-center gap-1">
            <UserRound className="h-3 w-3" /> {f.assignedWorker || "Unassigned"}
          </span>
          {f.membershipId && (
            <span className="inline-flex items-center gap-1 text-muted-foreground/70">
              <Hash className="h-3 w-3" /> {f.membershipId}
            </span>
          )}
        </div>

        {f.notes && (
          <p className="mt-2 rounded-md border border-dashed bg-muted/30 px-2 py-1 text-[11px] italic text-muted-foreground">
            “{f.notes}”
          </p>
        )}

        {outcome && (
          <p
            className={cn(
              "mt-2 flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px]",
              f.outcome
                ? "bg-status-green/10 text-status-green"
                : f.reasonMissed
                  ? "bg-status-red/10 text-status-red"
                  : "bg-muted/60 text-muted-foreground",
            )}
          >
            <OutcomeIcon className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              <span className="font-semibold">{outcomeLabel}: </span>
              {outcome}
            </span>
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {f.status === FOLLOWUP_STATUS.PENDING && onStatus && (
          <Button size="sm" onClick={onStatus}>
            <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" /> Update status
          </Button>
        )}
        <Link to={`/contacts/${f.contactId}`} title="Open contact profile">
          <Button variant="outline" size="sm">
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open
          </Button>
        </Link>
        {onDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
