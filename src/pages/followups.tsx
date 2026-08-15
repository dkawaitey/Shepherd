import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
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
} from "@/components/shared";
import { isOfflineError, queueEntry } from "@/lib/offline-sync";
import { cn } from "@/lib/utils";
import { CalendarPlus, ExternalLink, Lock, Search, Trash2 } from "lucide-react";

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
      setError(err?.message ?? "Failed to update status");
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
    assignedWorker: string;
    notes: string;
    reminder: boolean;
  }>({
    contactId: presetContactId ?? "",
    type: FOLLOWUP_TYPES.HOME_VISIT,
    date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
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
        setError(err?.message ?? "Failed to schedule");
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
          <div className="grid grid-cols-2 gap-3">
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
            <div>
              <Label htmlFor="fu-date">Date *</Label>
              <Input id="fu-date" type="date" className="mt-1" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
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
  const isAdmin = me?.role === "admin";
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
    return { pending, done };
  }, [followups]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Follow-ups"
        code="fup"
        actions={
          <Button onClick={() => setScheduleOpen(true)}>
            <CalendarPlus className="mr-1.5 h-4 w-4" /> Schedule follow-up
          </Button>
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
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#fbbf24]" /> Pending</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#86efac]" /> Completed</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#f87171]" /> Missed</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#9ca3af]" /> Cancelled</span>
      </div>

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
            <Button onClick={() => setScheduleOpen(true)}>
              <CalendarPlus className="mr-1.5 h-4 w-4" /> Schedule follow-up
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {grouped.pending.map((f) => (
            <FollowupRow
              key={f._id}
              f={f}
              onStatus={() => setChanging(f)}
              onDelete={() => setConfirmDelete(f)}
            />
          ))}
          {grouped.done.map((f) => (
            <FollowupRow
              key={f._id}
              f={f}
              onStatus={isAdmin ? () => setChanging(f) : undefined}
              onDelete={isAdmin ? () => setConfirmDelete(f) : undefined}
            />
          ))}
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

function FollowupRow({
  f,
  onStatus,
  onDelete,
}: {
  f: any;
  onStatus?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/contacts/${f.contactId}`}
            className="text-sm font-bold hover:text-primary hover:underline"
          >
            {f.contactName}
          </Link>
          <StatusPill status={f.status} />
          {f.locked && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground" title="Status locked">
              <Lock className="h-3 w-3" /> locked
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span>{FOLLOWUP_TYPE_LABELS[f.type]}</span>
          <span>📅 {fmtDate(f.date)}</span>
          <span>Worker: {f.assignedWorker || "Unassigned"}</span>
          <span className="text-muted-foreground/70">{f.membershipId}</span>
        </div>
        {f.notes && <p className="mt-1 truncate text-[11px] text-muted-foreground">“{f.notes}”</p>}
        {(f.outcome || f.reasonMissed || f.reasonCancelled) && (
          <p className="mt-1 rounded bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">
              {f.outcome ? "Outcome" : f.reasonMissed ? "Missed:" : "Cancelled:"}
            </span>{" "}
            {f.outcome ?? f.reasonMissed ?? f.reasonCancelled}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link to={`/contacts/${f.contactId}`} title="Open contact profile">
          <Button variant="outline" size="icon">
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </Link>
        {f.status === FOLLOWUP_STATUS.PENDING && onStatus && (
          <Button size="sm" onClick={onStatus}>Update status</Button>
        )}
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
