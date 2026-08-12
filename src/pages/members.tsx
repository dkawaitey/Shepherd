import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
import { CLASS_OPTIONS } from "@/convex/constants";
import {
  ATTENDANCE_TYPE_LABELS,
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_TYPES,
} from "@/convex/constants";
import {
  EmptyState,
  PageHeader,
  StatusPill,
  fmtDate,
  downloadCsv,
  progressColor,
} from "@/components/shared";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Download,
  Plus,
  ScrollText,
  Search,
  UserRoundPlus,
} from "lucide-react";

export default function Members() {
  const [klass, setKlass] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const me = useQuery(api.users.currentUser);
  const isAdmin = me?.role === "admin";

  const members = useQuery(api.members.list, {
    klass: klass === "all" ? undefined : klass,
    status: status === "all" ? undefined : status,
    search: search || undefined,
  });
  const classStats = useQuery(api.members.classStats, {});

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Members"
        code="mem"
        description="Youth Ministry member directory for attendance tracking and participation monitoring — separate from evangelism contacts."
        actions={
          isAdmin ? (
            <Button onClick={() => setAddOpen(true)}>
              <UserRoundPlus className="mr-1.5 h-4 w-4" /> Add member
            </Button>
          ) : undefined
        }
      />

      {/* Class dashboards */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(classStats ?? []).map((cs: any) => (
          <div key={cs.klass} className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold">{cs.klass} Class</span>
              <button
                className="text-[10px] text-primary hover:underline"
                onClick={() => {
                  setKlass(cs.klass);
                  setStatus("all");
                }}
              >
                view →
              </button>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1 text-center">
              <div>
                <div className="font-mono text-sm font-bold">{cs.totalMembers}</div>
                <div className="text-[9px] text-muted-foreground">members</div>
              </div>
              <div>
                <div className="font-mono text-sm font-bold text-[#4d7c0f]">{cs.presentToday}</div>
                <div className="text-[9px] text-muted-foreground">present</div>
              </div>
              <div>
                <div className="font-mono text-sm font-bold text-[#b3261e]">{cs.absentToday}</div>
                <div className="text-[9px] text-muted-foreground">absent</div>
              </div>
            </div>
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
                <span>attendance</span>
                <span className="font-mono">{cs.percentage}%</span>
              </div>
              <Progress value={cs.percentage} className="h-1.5" />
            </div>
            <div className="mt-2 flex gap-2 text-[9px] text-muted-foreground">
              {cs.trend.map((t: any) => (
                <span key={t.month} title={`${t.month}: ${t.percentage}%`}>
                  {t.month} <b className={cn("font-mono", t.percentage >= 75 ? "text-[#4d7c0f]" : t.percentage >= 40 ? "text-[#b45309]" : "text-[#b3261e]")}>{t.percentage}%</b>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-4 grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-4">
        <div className="relative sm:col-span-2">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search members..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={klass} onValueChange={setKlass}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Classes</SelectItem>
            {CLASS_OPTIONS.map((c) => (
              <SelectItem key={c} value={c}>{c} Class</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Active + Inactive</SelectItem>
            <SelectItem value="active">Active Members</SelectItem>
            <SelectItem value="inactive">Inactive Members</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {members === undefined ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg border bg-card" />
          ))}
        </div>
      ) : members.length === 0 ? (
        <EmptyState
          title="No members found"
          message={isAdmin ? "Add your first Youth Ministry member to begin attendance tracking." : "Ask an administrator to add members."}
        />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((m) => (
            <Link
              key={m._id}
              to={`/members/${m._id}`}
              className="group rounded-lg border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold group-hover:text-primary">{m.fullName}</div>
                  <div className="text-[10px] text-muted-foreground">
                    <span className="text-primary">{m.membershipId}</span>
                  </div>
                </div>
                <StatusPill status={m.status === "active" ? "activeMember" : "inactive"} />
              </div>
              <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>{m.klass} Class</span>
                {m.classLeader && <span>Leader: {m.classLeader}</span>}
                {m.ministryRoles && <span>{m.ministryRoles}</span>}
              </div>
              <div className="mt-2.5 border-t pt-2 text-[10px] text-muted-foreground">
                {m.dateJoined ? `Joined ${fmtDate(m.dateJoined)}` : "No join date"} · {m.attendanceCount} attendance records
              </div>
            </Link>
          ))}
        </div>
      )}

      {members && members.length > 0 && (
        <div className="mt-4 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadCsv(
                "members.csv",
                members.map((m) => ({
                  membershipId: m.membershipId,
                  fullName: m.fullName,
                  klass: m.klass ?? "",
                  status: m.status ?? "",
                  phone: m.phone ?? "",
                  whatsapp: m.whatsapp ?? "",
                  classLeader: m.classLeader ?? "",
                  ministryRoles: m.ministryRoles ?? "",
                  dateJoined: m.dateJoined ?? "",
                })),
              )
            }
          >
            <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
          </Button>
        </div>
      )}

      <AddMemberDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

function AddMemberDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const create = useMutation(api.members.create);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
          <DialogDescription>
            Membership IDs are generated per class (e.g. MLS-2026-001). Only administrators can edit member records.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!form.fullName?.trim()) {
              setError("Full name is required");
              return;
            }
            setBusy(true);
            setError(null);
            try {
              const res = await create({
                fullName: form.fullName.trim(),
                gender: form.gender || undefined,
                phone: form.phone || undefined,
                whatsapp: form.whatsapp || undefined,
                email: form.email || undefined,
                klass: form.klass || CLASS_OPTIONS[0],
                dateJoined: form.dateJoined || undefined,
                classLeader: form.classLeader || undefined,
                ministryRoles: form.ministryRoles || undefined,
                occupation: form.occupation || undefined,
                status: "active",
              } as any);
              toast.success(`Member added · ${res.membershipId}`);
              onOpenChange(false);
            } catch (err: any) {
              setError(err?.message ?? "Failed to add member");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div>
            <Label htmlFor="m-name">Full name *</Label>
            <Input id="m-name" className="mt-1" value={form.fullName ?? ""} onChange={(e) => set("fullName", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="m-gender">Gender</Label>
              <Select value={form.gender || undefined} onValueChange={(v) => set("gender", v)}>
                <SelectTrigger id="m-gender" className="mt-1 w-full"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="m-class">Class *</Label>
              <Select value={form.klass || undefined} onValueChange={(v) => set("klass", v)}>
                <SelectTrigger id="m-class" className="mt-1 w-full"><SelectValue placeholder="Select class" /></SelectTrigger>
                <SelectContent>
                  {CLASS_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>{c} Class</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="m-phone">Phone</Label>
              <Input id="m-phone" className="mt-1" value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="m-wa">WhatsApp</Label>
              <Input id="m-wa" className="mt-1" value={form.whatsapp ?? ""} onChange={(e) => set("whatsapp", e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="m-joined">Date joined Youth Ministry</Label>
            <Input id="m-joined" type="date" className="mt-1" value={form.dateJoined ?? ""} onChange={(e) => set("dateJoined", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="m-leader">Class leader</Label>
            <Input id="m-leader" className="mt-1" value={form.classLeader ?? ""} onChange={(e) => set("classLeader", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="m-roles">Ministry roles</Label>
            <Input id="m-roles" className="mt-1" value={form.ministryRoles ?? ""} onChange={(e) => set("ministryRoles", e.target.value)} placeholder="Choir, Ushering..." />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Adding..." : "Add member"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============ Member Profile ============
export function MemberProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const data = useQuery(api.members.get, { id: id as any });
  const me = useQuery(api.users.currentUser);
  const isAdmin = me?.role === "admin";
  const setAttendance = useMutation(api.discipleship.setAttendance);

  const [type, setType] = useState<string>(ATTENDANCE_TYPES.YOUTH_MEETING);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState("present");
  const [program, setProgram] = useState("");

  if (!data) {
    return <div className="h-64 animate-pulse rounded-lg border bg-card" />;
  }
  const { member, attendance } = data;

  const youthRows = attendance.filter((a) => a.type === ATTENDANCE_TYPES.YOUTH_MEETING);
  const churchRows = attendance.filter((a) => a.type === ATTENDANCE_TYPES.SUNDAY_SERVICE || a.type === ATTENDANCE_TYPES.MIDWEEK);
  const specialRows = attendance.filter((a) => a.type === ATTENDANCE_TYPES.SPECIAL_PROGRAM || a.type === ATTENDANCE_TYPES.PRAYER_MEETING);

  const pct = (rows: any[]) => {
    const total = rows.length;
    if (!total) return 0;
    return Math.round((rows.filter((r) => r.status === "present").length / total) * 100);
  };
  const youthPct = pct(youthRows);
  const churchPct = pct(churchRows);
  const specialPct = pct(specialRows);
  const overall = pct(attendance);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/members")}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Members
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/40 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <ScrollText className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-bold">{member.fullName}</h1>
              <StatusPill status={member.status === "active" ? "activeMember" : "inactive"} />
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span className="text-primary">{member.membershipId}</span>
              <span>{member.klass} Class</span>
              {member.classLeader && <span>Class leader: {member.classLeader}</span>}
              {member.dateJoined && <span>Joined {fmtDate(member.dateJoined)}</span>}
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {member.ministryRoles && <div>Ministry: {member.ministryRoles}</div>}
            {member.occupation && <div>Occupation: {member.occupation}</div>}
          </div>
        </div>

        {/* Attendance stats */}
        <div className="grid gap-3 border-b p-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Youth Meetings", value: youthPct },
            { label: "Church Services", value: churchPct },
            { label: "Special Programs", value: specialPct },
            { label: "Overall Participation", value: overall },
          ].map((s) => (
            <div key={s.label} className="rounded-md border bg-card p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
              <div className="mt-1 font-mono text-2xl font-bold" style={{ color: progressColor(s.value) }}>
                {s.value}%
              </div>
              <Progress value={s.value} className="mt-2 h-1.5" />
            </div>
          ))}
        </div>

        {/* Record attendance */}
        {isAdmin && (
          <form
            className="flex flex-wrap items-end gap-3 border-b p-5"
            onSubmit={async (e) => {
              e.preventDefault();
              await setAttendance({
                subjectType: "member",
                memberId: member._id,
                date: new Date(date).toISOString(),
                type: type as any,
                programName: program || undefined,
                status: status as any,
              });
              toast.success("Attendance recorded");
            }}
          >
            <p className="term-label w-full">// record attendance</p>
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
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="mt-1 w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ATTENDANCE_STATUS_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Program (special)</Label>
              <Input className="mt-1 w-40" value={program} onChange={(e) => setProgram(e.target.value)} placeholder="Youth Camp" />
            </div>
            <Button type="submit" size="sm">
              <Plus className="mr-1 h-3.5 w-3.5" /> Record
            </Button>
          </form>
        )}

        {/* History */}
        <div className="p-5">
          <p className="term-label mb-3">// attendance history</p>
          {attendance.length === 0 ? (
            <EmptyState title="No attendance records" message="Attendance appears here once recorded." />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-[12px]">
                <thead className="bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Activity</th>
                    <th className="px-3 py-2">Program</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Recorded by</th>
                  </tr>
                </thead>
                <tbody>
                  {attendance.map((a) => (
                    <tr key={a._id} className="border-t">
                      <td className="px-3 py-2">{fmtDate(a.date)}</td>
                      <td className="px-3 py-2">{ATTENDANCE_TYPE_LABELS[a.type]}</td>
                      <td className="px-3 py-2">{a.programName || "—"}</td>
                      <td className="px-3 py-2"><StatusPill status={a.status} /></td>
                      <td className="px-3 py-2">{a.recordedBy || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
