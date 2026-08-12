import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_TYPES,
  ATTENDANCE_TYPE_LABELS,
  CLASS_OPTIONS,
} from "@/convex/constants";
import { PageHeader, StatusPill, fmtDate, downloadCsv } from "@/components/shared";
import { cn } from "@/lib/utils";
import { AlertTriangle, ClipboardCheck, Download } from "lucide-react";

export default function Attendance() {
  const [klass, setKlass] = useState("all");
  const [type, setType] = useState<string>(ATTENDANCE_TYPES.YOUTH_MEETING);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [savedDate, setSavedDate] = useState<string>("");

  const members = useQuery(api.members.list, {
    klass: klass === "all" ? undefined : klass,
  });
  const lowAttendance = useQuery(api.members.lowAttendance, {});
  const setAttendance = useMutation(api.discipleship.setAttendance);
  const me = useQuery(api.users.currentUser);
  const canRecord = me && me.role !== "leader";

  const rows = (members ?? []).filter((m) => m.status !== "inactive");

  const saveAll = async () => {
    const todo = rows.filter((m) => marks[m._id]);
    if (!todo.length) {
      toast.error("Mark at least one member");
      return;
    }
    for (const m of todo) {
      await setAttendance({
        subjectType: "member",
        memberId: m._id,
        date: new Date(date).toISOString(),
        type: type as any,
        programName: type === ATTENDANCE_TYPES.SPECIAL_PROGRAM ? "Register" : undefined,
        status: marks[m._id] as any,
      });
    }
    toast.success(`Saved ${todo.length} attendance records for ${fmtDate(date)}`);
    setSavedDate(date);
  };

  const quickMark = (id: string, s: string) => {
    setMarks((prev) => {
      const next = { ...prev };
      if (next[id] === s) delete next[id];
      else next[id] = s;
      return next;
    });
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Attendance"
        code="att"
        description="Track youth meetings, church services and special programs. Attendance connects to the discipleship system for engagement alerts."
        actions={
          rows.length ? (
            <Button variant="outline" size="sm" onClick={() => downloadCsv("attendance-register.csv", rows.map((m) => ({ fullName: m.fullName, klass: m.klass ?? "", status: marks[m._id] ?? "—" })))}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export register
            </Button>
          ) : undefined
        }
      />

      {/* Register controls */}
      <div className="mb-5 rounded-lg border bg-card p-4">
        <p className="term-label mb-3">// attendance register</p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label>Class</Label>
            <Select value={klass} onValueChange={setKlass}>
              <SelectTrigger className="mt-1 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All classes</SelectItem>
                {CLASS_OPTIONS.map((c) => (
                  <SelectItem key={c} value={c}>{c} Class</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Activity</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="mt-1 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(ATTENDANCE_TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" className="mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {canRecord && (
            <Button onClick={saveAll} className="gap-1.5">
              <ClipboardCheck className="h-4 w-4" /> Save {rows.filter((m) => marks[m._id]).length} record(s)
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setMarks({})}>
            Clear marks
          </Button>
        </div>
        {savedDate === date && (
          <p className="mt-2 text-[11px] text-[#4d7c0f]">
            ✓ Register saved for {fmtDate(date)} — editing overwrites records for the same date + activity.
          </p>
        )}
      </div>

      {/* Register */}
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card py-12 text-center text-xs text-muted-foreground">
          No members in this view. Add members or change the class filter.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Member</th>
                <th className="px-3 py-2">Class</th>
                <th className="px-3 py-2">Mark</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m._id} className="border-t">
                  <td className="px-3 py-2">
                    <Link to={`/members/${m._id}`} className="font-semibold hover:text-primary hover:underline">
                      {m.fullName}
                    </Link>
                    <span className="ml-2 text-[10px] text-muted-foreground">{m.membershipId}</span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{m.klass}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      {Object.entries(ATTENDANCE_STATUS_LABELS).map(([k, v]) => (
                        <button
                          key={k}
                          onClick={() => canRecord && quickMark(m._id, k)}
                          disabled={!canRecord}
                          className={cn(
                            "rounded-md border px-2.5 py-1 text-[10px] font-medium transition-colors",
                            marks[m._id] === k
                              ? k === "present"
                                ? "border-[#4d7c0f]/50 bg-[#ECFCCB] text-[#3F6212]"
                                : k === "absent"
                                  ? "border-[#b3261e]/50 bg-[#FEE2E2] text-[#991B1B]"
                                  : "border-[#b45309]/50 bg-[#FEF3C7] text-[#92400E]"
                              : "border-border text-muted-foreground hover:bg-muted",
                            !canRecord && "cursor-not-allowed opacity-50",
                          )}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Low attendance */}
      <div className="mt-6">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-[#b45309]" />
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
                className="flex items-center justify-between gap-3 rounded-lg border border-[#b45309]/30 bg-[#FEF3C7]/60 px-4 py-3 transition-colors hover:border-[#b45309]/60"
              >
                <div>
                  <div className="text-[13px] font-semibold text-[#92400E]">{r.member.fullName}</div>
                  <div className="text-[10px] text-[#92400E]/80">
                    Has not attended a youth meeting in 4 weeks. Consider follow-up.
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
