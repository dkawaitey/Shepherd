import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  ATTENDANCE_TYPE_LABELS,
  CLASS_OPTIONS,
} from "@/convex/constants";
import {
  EmptyState,
  PageHeader,
  StatusPill,
  fmtDate,
  downloadCsv,
  downloadPdf,
} from "@/components/shared";
import {
  TriangleAlert,
  CircleCheck,
  ClipboardCheck,
  Download,
  FileText,
  Heart,
} from "lucide-react";

export default function Attendance() {
  const [klass, setKlass] = useState("all");

  const members = useQuery(api.members.list, {
    klass: klass === "all" ? undefined : klass,
  });
  const history = useQuery(api.discipleship.listAttendance, {});
  const lowAttendance = useQuery(api.members.lowAttendance, {});
  const me = useQuery(api.users.currentUser);
  const markFollowup = useMutation(api.members.markAttendanceFollowup);

  const canFollowUp = !!me && me.role !== "leader";
  const [followupFor, setFollowupFor] = useState<any | null>(null);
  const [outcome, setOutcome] = useState("");
  const [followupBy, setFollowupBy] = useState(me?.name || me?.email || "");
  const [busy, setBusy] = useState(false);

  // Members followed up recently (outcome visible after the alert clears).
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const recentFollowups = (members ?? [])
    .filter(
      (m) =>
        m.attendanceFollowup &&
        m.attendanceFollowup.date >= thirtyDaysAgo,
    )
    .sort((a, b) =>
      (b.attendanceFollowup?.date ?? "").localeCompare(a.attendanceFollowup?.date ?? ""),
    )
    .slice(0, 5);

  const memberById = new Map((members ?? []).map((m) => [m._id, m]));

  // The Attendance page tracks Youth Ministry members, so only member records
  // appear here. Recording and editing attendance happens in each member's
  // profile, under the Attendance tab.
  const rows = (history ?? [])
    .filter(
      (r) => r.subjectType === "member" && r.memberId && memberById.has(r.memberId),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? 0) - (a.createdAt ?? 0));

  const csvRows = rows.map((r) => ({
    member: memberById.get(r.memberId!)?.fullName ?? "—",
    klass: memberById.get(r.memberId!)?.klass ?? "",
    date: r.date,
    activity: ATTENDANCE_TYPE_LABELS[r.type] ?? r.type,
    program: r.programName ?? "",
    status: r.status,
    recordedBy: r.recordedBy ?? "",
  }));

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Attendance"
        code="att"
        actions={
          rows.length ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadCsv("attendance-history.csv", csvRows)}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadPdf("attendance-history.pdf", [
                    { heading: "Attendance History — Youth Ministry", rows: csvRows },
                  ])
                }
              >
                <FileText className="mr-1.5 h-3.5 w-3.5" /> Export PDF
              </Button>
            </>
          ) : undefined
        }
      />

      {/* History filter */}
      <div className="mb-5 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="term-label mb-3">// attendance history</p>
            <Select value={klass} onValueChange={setKlass}>
              <SelectTrigger className="mt-1 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All classes</SelectItem>
                {CLASS_OPTIONS.map((c) => (
                  <SelectItem key={c} value={c}>{c} Class</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="mb-1 text-[11px] text-muted-foreground">
            Attendance is recorded from each member's profile.
          </p>
        </div>
      </div>

      {/* History */}
      {rows.length === 0 ? (
        <EmptyState
          title="No attendance records"
          message="Attendance history appears here once records are kept in member profiles."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Member</th>
                <th className="px-3 py-2">Class</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Activity</th>
                <th className="px-3 py-2">Program</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Recorded by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const m = memberById.get(r.memberId!);
                return (
                  <tr key={r._id} className="border-t">
                    <td className="px-3 py-2">
                      <Link
                        to={`/members/${r.memberId}`}
                        className="font-semibold hover:text-primary hover:underline"
                      >
                        {m?.fullName ?? "—"}
                      </Link>
                      <span className="ml-2 text-[10px] text-muted-foreground">
                        {m?.membershipId}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{m?.klass ?? "—"}</td>
                    <td className="px-3 py-2">{fmtDate(r.date)}</td>
                    <td className="px-3 py-2">{ATTENDANCE_TYPE_LABELS[r.type] ?? r.type}</td>
                    <td className="px-3 py-2">{r.programName || "—"}</td>
                    <td className="px-3 py-2"><StatusPill status={r.status} /></td>
                    <td className="px-3 py-2 text-muted-foreground">{r.recordedBy || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Low attendance alerts */}
      <div className="mt-6">
        <div className="mb-3 flex items-center gap-2">
          <TriangleAlert className="h-4 w-4 text-status-amber" />
          <p className="term-label">members needing follow-up — low attendance</p>
        </div>
        {lowAttendance === undefined ? (
          <div className="h-20 animate-pulse rounded-lg border bg-card" />
        ) : lowAttendance.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-card py-6 text-center text-[11px] text-muted-foreground">
            Everyone has attended recently. 🌿
          </p>
        ) : (
          <div className="space-y-2">
            {lowAttendance.map((r) => (
              <div
                key={r.member._id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#f59e0b]/40 bg-[#2e2408]/80 px-4 py-3 transition-colors hover:border-[#f59e0b]/70"
              >
                <Link
                  to={`/members/${r.member._id}`}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <ClipboardCheck className="h-4 w-4 shrink-0 text-status-amber" />
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-status-amber">{r.member.fullName}</div>
                    <div className="text-[10px] text-status-amber/80">
                      Has not attended a youth meeting in 4 weeks. Consider follow-up.
                    </div>
                  </div>
                </Link>
                {canFollowUp && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-[#f59e0b]/50 text-status-amber hover:bg-[#f59e0b]/10 hover:text-status-amber"
                    onClick={() => {
                      setFollowupFor(r.member);
                      setOutcome("");
                      setFollowupBy(me?.name || me?.email || "");
                    }}
                  >
                    <Heart className="mr-1.5 h-3.5 w-3.5" /> Mark followed up
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recently followed up */}
      {recentFollowups.length > 0 && (
        <div className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <CircleCheck className="h-4 w-4 text-status-green" />
            <p className="term-label">recently followed up — low attendance</p>
          </div>
          <div className="space-y-2">
            {recentFollowups.map((m) => (
              <div
                key={m._id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-lg border bg-card px-4 py-3"
              >
                <div className="min-w-0">
                  <Link
                    to={`/members/${m._id}`}
                    className="text-[13px] font-semibold hover:text-primary hover:underline"
                  >
                    {m.fullName}
                  </Link>
                  <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
                    {m.attendanceFollowup?.outcome}
                  </p>
                </div>
                <div className="shrink-0 text-right text-[10px] text-muted-foreground">
                  <div className="text-status-green">
                    ✓ {m.attendanceFollowup?.date ? fmtDate(m.attendanceFollowup.date) : ""}
                  </div>
                  {m.attendanceFollowup?.by && <div>by {m.attendanceFollowup.by}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mark followed-up dialog */}
      <Dialog
        open={!!followupFor}
        onOpenChange={(v) => !v && setFollowupFor(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark followed up</DialogTitle>
            <DialogDescription>
              Record the outcome of the follow-up with {followupFor?.fullName ?? "this member"}.
              The low-attendance alert will be cleared.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="att-fu-outcome">
                Outcome of the follow-up <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="att-fu-outcome"
                className="mt-1"
                rows={3}
                placeholder="e.g. Spoke with the family — they will return next week; praying for them"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="att-fu-by">Followed up by</Label>
              <input
                id="att-fu-by"
                className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-[12px] outline-none focus:border-primary"
                value={followupBy}
                onChange={(e) => setFollowupBy(e.target.value)}
                placeholder="Your name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFollowupFor(null)}>
              Cancel
            </Button>
            <Button
              disabled={!outcome.trim() || busy}
              onClick={async () => {
                if (!followupFor) return;
                setBusy(true);
                try {
                  await markFollowup({
                    memberId: followupFor._id,
                    outcome: outcome.trim(),
                    by: followupBy.trim() || undefined,
                  });
                  toast.success("Follow-up recorded — alert cleared");
                  setFollowupFor(null);
                } catch (err: any) {
                  toast.error(err?.message ?? "Could not record follow-up");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Heart className="mr-1.5 h-3.5 w-3.5" /> Save follow-up
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
