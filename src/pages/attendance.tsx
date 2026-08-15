import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
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
import { AlertTriangle, ClipboardList, Download, FileText } from "lucide-react";

export default function Attendance() {
  const [klass, setKlass] = useState("all");

  const members = useQuery(api.members.list, {
    klass: klass === "all" ? undefined : klass,
  });
  const history = useQuery(api.discipleship.listAttendance, {});
  const lowAttendance = useQuery(api.members.lowAttendance, {});

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
          <AlertTriangle className="h-4 w-4 text-status-amber" />
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
              <Link
                key={r.member._id}
                to={`/members/${r.member._id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-[#f59e0b]/40 bg-[#2e2408]/80 px-4 py-3 transition-colors hover:border-[#f59e0b]/70"
              >
                <div className="flex items-center gap-3">
                  <ClipboardList className="h-4 w-4 shrink-0 text-status-amber" />
                  <div>
                    <div className="text-[13px] font-semibold text-status-amber">{r.member.fullName}</div>
                    <div className="text-[10px] text-status-amber/80">
                      Has not attended a youth meeting in 4 weeks. Consider follow-up.
                    </div>
                  </div>
                </div>
                <StatusPill status="excused" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
