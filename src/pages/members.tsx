import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
  CLASS_OPTIONS,
  POSITION_LABELS,
  POSITION_OPTIONS,
  POSITIONS,
  ROLES,
  effectivePosition,
} from "@/convex/constants";
import {
  ATTENDANCE_TYPE_LABELS,
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_TYPES,
  NOTE_TYPES,
  NOTE_TYPE_LABELS,
  PRAYER_STATUS,
} from "@/convex/constants";
import {
  EmptyState,
  PageHeader,
  StatusPill,
  fmtDate,
  fmtDateTime,
  telLink,
  waLink,
  downloadCsv,
  downloadPdf,
  progressColor,
  canAddRecords,
} from "@/components/shared";

/** Derive a 2-letter area code from the area name (same rule as contacts). */
const deriveShortcut = (area: string) =>
  (area || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  ClipboardList,
  Crown,
  Download,
  FileText,
  Heart,
  Link2,
  Lock,
  Mail,
  MessageCircle,
  NotebookPen,
  Pencil,
  Phone,
  Plus,
  ScrollText,
  Search,
  Trash2,
  UserRoundPlus,
} from "lucide-react";

/** Dark terminal chips for each ministry position. */
const POSITION_CHIP: Record<string, string> = {
  admin: "border-[#f87171]/40 bg-[#2a1515] text-[#f87171]",
  coordinator: "border-[#60a5fa]/40 bg-[#14212c] text-[#60a5fa]",
  classLeader: "border-[#f59e0b]/40 bg-[#2e2408] text-[#fbbf24]",
  worker: "border-[#4ade80]/40 bg-[#15291c] text-[#86efac]",
  leader: "border-[#9ca3af]/40 bg-[#1c1f24] text-[#9ca3af]",
};

const positionChip = (m: any) => {
  const pos = effectivePosition(m.position, m.isClassLeader);
  if (pos === POSITIONS.MEMBER) return null;
  return { pos, cls: POSITION_CHIP[pos], label: POSITION_LABELS[pos] };
};

export default function Members() {
  const [klass, setKlass] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const me = useQuery(api.users.currentUser);
  const isAdmin = me?.role === "admin";
  const canAdd = canAddRecords(me);

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
        actions={
          canAdd ? (
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
                <div className="font-mono text-sm font-bold text-status-green">{cs.presentToday}</div>
                <div className="text-[9px] text-muted-foreground">present</div>
              </div>
              <div>
                <div className="font-mono text-sm font-bold text-status-red">{cs.absentToday}</div>
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
                  {t.month} <b className={cn("font-mono", t.percentage >= 75 ? "text-status-green" : t.percentage >= 40 ? "text-status-amber" : "text-status-red")}>{t.percentage}%</b>
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
          message={canAdd ? "Add your first Youth Ministry member to begin attendance tracking." : "Ask an administrator or class leader to add members."}
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
                {(() => {
                  const chip = positionChip(m);
                  return chip ? (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                        chip.cls,
                      )}
                    >
                      {chip.pos === POSITIONS.CLASS_LEADER && <Crown className="h-2.5 w-2.5" />}
                      {chip.label}
                    </span>
                  ) : null;
                })()}
                {m.sourceContactId && (
                  <span className="inline-flex items-center gap-1 rounded border border-[#4ade80]/40 bg-[#15291c] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#86efac]">
                    Promoted from contacts
                  </span>
                )}
                {m.stewardId && (
                  <span className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                    <Link2 className="h-2.5 w-2.5" />
                    Synced with Steward
                  </span>
                )}
                <span>{m.klass} Class</span>
                {m.area && <span>Area: {m.area}</span>}
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
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadPdf("members.pdf", [
                {
                  heading: "Members Directory — Youth Ministry",
                  rows: members.map((m) => ({
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
                },
              ])
            }
          >
            <FileText className="mr-1.5 h-3.5 w-3.5" /> Export PDF
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
  const me = useQuery(api.users.currentUser);
  const leaders = useQuery(api.members.classLeaders);
  const isAdmin = me?.role === ROLES.ADMIN;
  const [form, setForm] = useState<Record<string, string>>({});
  const [isClassLeader, setIsClassLeader] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const position = effectivePosition(form.position, isClassLeader);

  // Auto-derive the area code from the area name until it's edited manually.
  const set = (k: string, v: string) =>
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (k === "area" && !f.areaShortcut) next.areaShortcut = deriveShortcut(v);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
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
                area: form.area || undefined,
                areaShortcut:
                  form.areaShortcut || deriveShortcut(form.area || "") || undefined,
                classLeader: form.classLeader || undefined,
                ministryRoles: form.ministryRoles || undefined,
                occupation: form.occupation || undefined,
                status: "active",
                position: form.position || undefined,
                isClassLeader,
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
            <Label htmlFor="m-email">Email</Label>
            <Input id="m-email" type="email" className="mt-1" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="m-joined">Date joined Youth Ministry</Label>
            <Input id="m-joined" type="date" className="mt-1" value={form.dateJoined ?? ""} onChange={(e) => set("dateJoined", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="m-area">Area</Label>
            <Input id="m-area" className="mt-1" placeholder="e.g. Adjikpo" value={form.area ?? ""} onChange={(e) => set("area", e.target.value)} />
          </div>
          {isAdmin && (
            <div>
              <Label htmlFor="m-position">Ministry position</Label>
              <Select
                value={form.position || undefined}
                onValueChange={(v) => {
                  set("position", v);
                  if (v === POSITIONS.CLASS_LEADER) setIsClassLeader(true);
                  else if (v !== POSITIONS.ADMIN && v !== POSITIONS.COORDINATOR) {
                    setIsClassLeader(false);
                  }
                }}
              >
                <SelectTrigger id="m-position" className="mt-1 w-full">
                  <SelectValue placeholder="Ordinary Member" />
                </SelectTrigger>
                <SelectContent>
                  {POSITION_OPTIONS.map((p) => (
                    <SelectItem key={p} value={p}>{POSITION_LABELS[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {isAdmin && (
            <div>
              <Label htmlFor="m-leader">Class leader</Label>
              <Select
                value={form.classLeaderId || undefined}
                onValueChange={(v) => {
                  const leader = (leaders ?? []).find((l) => l._id === v);
                  setForm((f) => ({
                    ...f,
                    classLeaderId: v,
                    classLeader: leader?.name ?? "",
                  }));
                }}
              >
                <SelectTrigger id="m-leader" className="mt-1 w-full">
                  <SelectValue placeholder="Select class leader" />
                </SelectTrigger>
                <SelectContent>
                  {(leaders ?? []).map((l) => (
                    <SelectItem key={l._id} value={l._id}>
                      {l.name}
                      {l.klass ? ` · ${l.klass} Class` : ""}
                      {l.hasAccount ? "" : " · no account"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {isAdmin && (
            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2.5">
              <div className="min-w-0">
                <Label className="text-[12px] font-semibold">
                  This member is a class leader
                </Label>
                {(position === POSITIONS.CLASS_LEADER ||
                  position === POSITIONS.ADMIN ||
                  position === POSITIONS.COORDINATOR) && (
                  <p className="text-[10px] leading-4 text-muted-foreground">
                    {position === POSITIONS.CLASS_LEADER
                      ? `They lead the ${form.klass || CLASS_OPTIONS[0]} Class (from their position).`
                      : position === POSITIONS.ADMIN
                        ? `Administrators may also lead the ${form.klass || CLASS_OPTIONS[0]} Class.`
                        : `Evangelism Coordinators may also lead the ${form.klass || CLASS_OPTIONS[0]} Class (dual role).`}
                  </p>
                )}
              </div>
              <Switch
                checked={isClassLeader}
                onCheckedChange={(v) => {
                  if (position === POSITIONS.ADMIN || position === POSITIONS.COORDINATOR) {
                    setIsClassLeader(v);
                  }
                }}
                disabled={
                  position !== POSITIONS.ADMIN &&
                  position !== POSITIONS.CLASS_LEADER &&
                  position !== POSITIONS.COORDINATOR
                }
                aria-label="Mark as class leader"
              />
            </div>
          )}
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
  const accounts = useQuery(api.users.list);
  const linkMember = useMutation(api.users.linkMember);
  const isAdmin = me?.role === ROLES.ADMIN;
  const canSeeConfidential = !!me?.role && me.role !== ROLES.LEADER;
  const canRecord =
    isAdmin || me?.role === ROLES.COORDINATOR || me?.role === ROLES.WORKER;
  const canEditNotes =
    isAdmin ||
    me?.role === ROLES.COORDINATOR ||
    me?.role === ROLES.WORKER ||
    me?.role === ROLES.CLASS_LEADER;
  const [tab, setTab] = useState("profile");
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const removeMember = useMutation(api.members.remove);

  if (!data) {
    return <div className="h-64 animate-pulse rounded-lg border bg-card" />;
  }
  const { member, attendance, prayers, notes } = data;
  const linked = (accounts ?? []).find((a) => a.memberId === member._id);
  const chip = positionChip(member);
  const visibleNotes = notes.filter((n) => !n.isPrivate || canSeeConfidential);

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

  const tabs = [
    { id: "profile", label: "Profile", icon: ScrollText },
    { id: "attendance", label: `Attendance (${attendance.length})`, icon: ClipboardList },
    { id: "prayer", label: `Prayer Journal (${prayers.length})`, icon: Heart },
    { id: "notes", label: `Notes (${visibleNotes.length})`, icon: NotebookPen },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/members")}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Members
        </Button>
        {isAdmin && (
          <>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-1 h-3.5 w-3.5" /> Edit member
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
            </Button>
          </>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        {/* Header */}
        <div className="border-b bg-muted/40 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold">{member.fullName}</h1>
                {chip && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-semibold",
                      chip.cls,
                    )}
                  >
                    {chip.pos === POSITIONS.CLASS_LEADER && <Crown className="h-3 w-3" />}
                    {chip.label}
                  </span>
                )}
                <StatusPill status={member.status === "active" ? "activeMember" : "inactive"} />
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <span className="text-primary">{member.membershipId}</span>
                <span>{member.klass} Class</span>
                {member.area && <span>Area: {member.area}</span>}
                {member.classLeader && <span>Class leader: {member.classLeader}</span>}
                {member.dateJoined && <span>Joined {fmtDate(member.dateJoined)}</span>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {member.phone && (
                <a href={telLink(member.phone)} title={`Call ${member.phone}`}>
                  <Button variant="outline" size="sm">
                    <Phone className="mr-1 h-3.5 w-3.5" /> Call
                  </Button>
                </a>
              )}
              {(member.whatsapp || member.phone) && (
                <a
                  href={waLink(member.whatsapp || member.phone, `Shalom ${member.fullName}, this is the Gethsemane Youth Ministry.`)}
                  target="_blank"
                  rel="noreferrer"
                  title="Open WhatsApp"
                >
                  <Button variant="outline" size="sm">
                    <MessageCircle className="mr-1 h-3.5 w-3.5" /> WhatsApp
                  </Button>
                </a>
              )}
              {member.email && (
                <a href={`mailto:${member.email}`} title={`Email ${member.email}`}>
                  <Button variant="outline" size="sm">
                    <Mail className="mr-1 h-3.5 w-3.5" /> Email
                  </Button>
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 border-b px-3 pt-2">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-[12px] font-medium transition-colors",
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        {editOpen && (
          <EditMemberDialog member={member} open={editOpen} onOpenChange={setEditOpen} />
        )}

        <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete member?</DialogTitle>
              <DialogDescription>
                {member.fullName} ({member.membershipId}) and every record attached
                to them — attendance history, prayer journal and notes — will be
                permanently removed. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  try {
                    await removeMember({ id: member._id });
                    toast.success("Member deleted");
                    navigate("/members");
                  } catch (err: any) {
                    toast.error(err?.message ?? "Could not delete member");
                  }
                }}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ============ Profile tab ============ */}
        {tab === "profile" && (
          <div className="space-y-4 p-5">
            {/* Attendance stats */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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

            {/* Details */}
            <div className="grid gap-x-6 gap-y-2 rounded-lg border bg-card p-4 text-[12px] sm:grid-cols-2">
              {[
                ["Gender", member.gender ? member.gender[0].toUpperCase() + member.gender.slice(1) : "—"],
                ["Phone", member.phone || "—"],
                ["WhatsApp", member.whatsapp || "—"],
                ["Email", member.email || "—"],
                ["Class", member.klass || "—"],
                ["Area", member.area || "—"],
                ["Occupation", member.occupation || "—"],
                ["Date joined", member.dateJoined ? fmtDate(member.dateJoined) : "—"],
                ["Ministry roles", member.ministryRoles || "—"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3 border-b border-dashed pb-1.5 last:border-0">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="text-right font-medium">{v}</span>
                </div>
              ))}
            </div>

            {/* Linked user account (admin only) */}
            {isAdmin && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
                <div className="min-w-0">
                  <p className="term-label">// linked account</p>
                  <p className="text-[11px] text-muted-foreground">
                    {linked
                      ? `${linked.name || linked.email} · ${linked.email}`
                      : "No user account is linked to this member yet. Link a volunteer's account so their responsibilities (e.g. Class Leader) follow this member record."}
                  </p>
                </div>
                <Select
                  value={linked?._id ?? "none"}
                  onValueChange={async (v) => {
                    try {
                      if (v !== "none") {
                        await linkMember({ userId: v as any, memberId: member._id as any });
                        toast.success("Account linked to this member");
                      } else if (linked) {
                        await linkMember({ userId: linked._id as any, memberId: undefined });
                        toast.success("Account link removed");
                      }
                    } catch (err: any) {
                      toast.error(err?.message ?? "Could not link account");
                    }
                  }}
                >
                  <SelectTrigger className="w-64">
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— No account —</SelectItem>
                    {(accounts ?? []).map((a) => (
                      <SelectItem key={a._id} value={a._id}>
                        {a.name || a.email}
                        {a.memberId && a.memberId !== member._id ? " · linked elsewhere" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        {/* ============ Attendance tab ============ */}
        {tab === "attendance" && (
          <AttendanceTab member={member} rows={attendance} isAdmin={isAdmin} canRecord={canRecord} />
        )}

        {/* ============ Prayer journal tab ============ */}
        {tab === "prayer" && (
          <MemberPrayerTab memberId={member._id} rows={prayers} canEdit={canEditNotes} />
        )}

        {/* ============ Notes tab ============ */}
        {tab === "notes" && (
          <MemberNotesTab memberId={member._id} rows={visibleNotes} canEdit={canEditNotes} />
        )}
      </div>
    </div>
  );
}

// ---------- Member attendance tab ----------
function AttendanceTab({
  member,
  rows,
  isAdmin,
  canRecord,
}: {
  member: any;
  rows: any[];
  isAdmin: boolean;
  canRecord: boolean;
}) {
  const me = useQuery(api.users.currentUser);
  const setAttendance = useMutation(api.discipleship.setAttendance);
  const updateAttendance = useMutation(api.discipleship.updateAttendance);
  const deleteAttendance = useMutation(api.discipleship.deleteAttendance);

  const [type, setType] = useState<string>(ATTENDANCE_TYPES.YOUTH_MEETING);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState("present");
  const [program, setProgram] = useState("");
  const [remarks, setRemarks] = useState("");
  const [recordedBy, setRecordedBy] = useState(me?.name || me?.email || "");
  const [editingId, setEditingId] = useState<string | null>(null);

  const present = rows.filter((r) => r.status === "present").length;
  const rate = rows.length ? Math.round((present / rows.length) * 100) : 0;
  const needsFollowUp = rows.length >= 2 && rate < 60;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      await updateAttendance({
        id: editingId as any,
        date,
        type: type as any,
        programName: program.trim() || undefined,
        status: status as any,
        remarks: remarks.trim() || undefined,
        recordedBy: recordedBy.trim() || me?.name || me?.email || undefined,
      });
      toast.success("Attendance record updated");
      setEditingId(null);
      setRemarks("");
    } else {
      await setAttendance({
        subjectType: "member",
        memberId: member._id,
        date: new Date(date).toISOString(),
        type: type as any,
        programName: program.trim() || undefined,
        status: status as any,
        remarks: remarks.trim() || undefined,
        recordedBy: recordedBy.trim() || me?.name || me?.email || undefined,
      });
      toast.success("Attendance recorded");
      setRemarks("");
    }
  };

  const startEdit = (a: any) => {
    setEditingId(a._id);
    setType(a.type);
    setDate(a.date.slice(0, 10));
    setStatus(a.status);
    setProgram(a.programName || "");
    setRemarks(a.remarks || "");
    setRecordedBy(a.recordedBy || "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="space-y-4 p-5">
      {needsFollowUp && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[12px] text-amber-800 dark:text-amber-300">
          <Heart className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">This member may need follow-up</p>
            <p className="mt-0.5 leading-5">
              Attendance rate is {rate}% ({present} of {rows.length} records present) — below the 60%
              follow-up threshold. Reach out to encourage consistent attendance.
            </p>
          </div>
        </div>
      )}

      {member.attendanceFollowup && (
        <div className="flex items-start gap-2 rounded-lg border border-[#86efac]/40 bg-[#15291c]/80 p-3 text-[11px] text-[#86efac]">
          <Heart className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <p className="font-semibold">Last low-attendance follow-up</p>
            <p className="mt-0.5 leading-5">
              {member.attendanceFollowup.outcome}{" "}
              <span className="text-[#86efac]/70">
                · {fmtDate(member.attendanceFollowup.date)}
                {member.attendanceFollowup.by ? ` · by ${member.attendanceFollowup.by}` : ""}
              </span>
            </p>
          </div>
        </div>
      )}

      {/* Record attendance */}
      {canRecord && (
        <form className="rounded-lg border bg-card p-4" onSubmit={submit}>
          <p className="term-label mb-3">
            {editingId ? "// edit attendance record" : "// record attendance"}
          </p>
          <div className="overflow-x-auto pb-1">
            <div className="flex min-w-max items-end gap-2">
              <div>
                <Label>Activity</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger className="mt-1 w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ATTENDANCE_TYPE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Date</Label>
                <Input type="date" className="mt-1 w-36" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="mt-1 w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ATTENDANCE_STATUS_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Program / Session</Label>
                <Input className="mt-1 w-44" value={program} onChange={(e) => setProgram(e.target.value)} placeholder="e.g. Morning session" />
              </div>
              <div>
                <Label>Remarks</Label>
                <Input className="mt-1 w-48" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Late, brought a friend…" />
              </div>
              <div>
                <Label>Recorded by</Label>
                <Input className="mt-1 w-40" value={recordedBy} onChange={(e) => setRecordedBy(e.target.value)} placeholder="Your name" />
              </div>
              <div className="flex shrink-0 gap-1.5">
                {editingId && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                )}
                <Button type="submit" size="sm">
                  <Plus className="mr-1 h-3.5 w-3.5" /> {editingId ? "Save changes" : "Record"}
                </Button>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* History */}
      <div>
        <p className="term-label mb-3">// attendance history</p>
        {rows.length === 0 ? (
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
                  <th className="px-3 py-2">Remarks</th>
                  {isAdmin && <th className="px-3 py-2">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a._id} className="border-t">
                    <td className="px-3 py-2">{fmtDate(a.date)}</td>
                    <td className="px-3 py-2">{ATTENDANCE_TYPE_LABELS[a.type]}</td>
                    <td className="px-3 py-2">{a.programName || "—"}</td>
                    <td className="px-3 py-2"><StatusPill status={a.status} /></td>
                    <td className="px-3 py-2">{a.recordedBy || "—"}</td>
                    <td className="px-3 py-2">{a.remarks || "—"}</td>
                    {isAdmin && (
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => startEdit(a)}
                            title="Edit record"
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={async () => {
                              if (!window.confirm("Delete this attendance record? This cannot be undone.")) return;
                              await deleteAttendance({ id: a._id });
                              toast.success("Attendance record deleted");
                            }}
                            title="Delete record"
                            className="rounded p-1 text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Member prayer journal tab ----------
function MemberPrayerTab({
  memberId,
  rows,
  canEdit,
}: {
  memberId: string;
  rows: any[];
  canEdit: boolean;
}) {
  const addPrayer = useMutation(api.discipleship.addPrayer);
  const updateStatus = useMutation(api.discipleship.updatePrayerStatus);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [answerFor, setAnswerFor] = useState<any | null>(null);
  const [answer, setAnswer] = useState("");

  return (
    <div className="space-y-4 p-5">
      {canEdit && (
        <form
          className="space-y-3 rounded-lg border bg-card p-3.5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim() || !summary.trim()) return;
            await addPrayer({ memberId: memberId as any, title: title.trim(), summary: summary.trim() });
            toast.success("Prayer request added");
            setTitle("");
            setSummary("");
          }}
        >
          <p className="term-label">// add prayer request</p>
          <Input placeholder="Title — e.g. Employment" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Textarea rows={2} placeholder="Prayer request details..." value={summary} onChange={(e) => setSummary(e.target.value)} />
          <Button type="submit" size="sm" disabled={!title.trim() || !summary.trim()}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add request
          </Button>
        </form>
      )}

      {rows.length === 0 ? (
        <EmptyState title="No prayer requests" message="Capture prayer needs here and celebrate answers." />
      ) : (
        <div className="space-y-3">
          {rows.map((p) => (
            <div key={p._id} className="rounded-lg border bg-card p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <Heart className="h-3.5 w-3.5 text-primary" />
                <span className="text-[13px] font-semibold">{p.title}</span>
                <StatusPill status={p.status} />
                {p.confidential && (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Lock className="h-3 w-3" /> confidential
                  </span>
                )}
                <span className="ml-auto text-[10px] text-muted-foreground">{fmtDate(new Date(p.createdAt).toISOString())}</span>
              </div>
              <p className="mt-1.5 text-[12px] leading-5 text-muted-foreground">{p.summary}</p>
              {p.answer && (
                <p className="mt-2 rounded bg-[#15291c]/80 px-2 py-1.5 text-[11px] text-[#86efac]">
                  <b>Answered:</b> {p.answer}
                </p>
              )}
              {canEdit && p.status === PRAYER_STATUS.ACTIVE && (
                <div className="mt-2 flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setAnswerFor(p)}>
                    Mark answered
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await updateStatus({ id: p._id, status: PRAYER_STATUS.CLOSED });
                      toast.success("Prayer request closed");
                    }}
                  >
                    Close
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!answerFor} onOpenChange={(v) => !v && setAnswerFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark prayer answered</DialogTitle>
            <DialogDescription>{answerFor?.title}</DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="mp-answer">
              How was it answered? <span className="text-destructive">*</span>
            </Label>
            <Textarea id="mp-answer" rows={3} className="mt-1" value={answer} onChange={(e) => setAnswer(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAnswerFor(null)}>Cancel</Button>
            <Button
              disabled={!answer.trim()}
              onClick={async () => {
                if (!answerFor) return;
                await updateStatus({ id: answerFor._id, status: PRAYER_STATUS.ANSWERED, answer });
                toast.success("Marked as answered");
                setAnswerFor(null);
                setAnswer("");
              }}
            >
              Mark answered
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Member notes tab ----------
function MemberNotesTab({
  memberId,
  rows,
  canEdit,
}: {
  memberId: string;
  rows: any[];
  canEdit: boolean;
}) {
  const addNote = useMutation(api.discipleship.addNote);
  const [type, setType] = useState<string>(NOTE_TYPES.MINISTRY);
  const [content, setContent] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);

  return (
    <div className="space-y-4 p-5">
      {canEdit && (
        <form
          className="space-y-3 rounded-lg border bg-card p-3.5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!content.trim()) return;
            await addNote({
              memberId: memberId as any,
              type: type as any,
              content: content.trim(),
              isPrivate: isPrivate || type === NOTE_TYPES.PRIVATE,
            });
            toast.success("Note added");
            setContent("");
          }}
        >
          <p className="term-label">// add note</p>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(NOTE_TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Checkbox
                checked={isPrivate || type === NOTE_TYPES.PRIVATE}
                onCheckedChange={(v) => setIsPrivate(!!v)}
                disabled={type === NOTE_TYPES.PRIVATE}
              />
              Confidential
            </label>
          </div>
          <Textarea rows={2} placeholder="Family situation, employment needs, counselling notes..." value={content} onChange={(e) => setContent(e.target.value)} />
          <Button type="submit" size="sm" disabled={!content.trim()}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add note
          </Button>
        </form>
      )}

      {rows.length === 0 ? (
        <EmptyState title="No notes" message="Leaders can add ministry, counselling and confidential notes." />
      ) : (
        <div className="space-y-3">
          {rows.map((n) => (
            <div key={n._id} className="rounded-lg border bg-card p-3.5">
              <div className="flex items-center gap-2">
                <span className="rounded border border-primary/30 bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
                  {NOTE_TYPE_LABELS[n.type]}
                </span>
                {n.isPrivate && (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Lock className="h-3 w-3" /> confidential
                  </span>
                )}
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {n.author} · {fmtDateTime(new Date(n.createdAt).toISOString())}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-foreground/90">{n.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ Edit Member (admin only) ============
function EditMemberDialog({
  member,
  open,
  onOpenChange,
}: {
  member: any;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const update = useMutation(api.members.update);
  const addNote = useMutation(api.discipleship.addNote);
  const me = useQuery(api.users.currentUser);
  const isAdmin = me?.role === ROLES.ADMIN;
  const [form, setForm] = useState<Record<string, string>>({
    fullName: member.fullName ?? "",
    gender: member.gender ?? "",
    klass: member.klass ?? "",
    position: member.position ?? effectivePosition(member.position, member.isClassLeader),
    status: member.status ?? "active",
  });
  const [isClassLeader, setIsClassLeader] = useState(!!member.isClassLeader);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState("");
  const position = effectivePosition(form.position, isClassLeader);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fullName?.trim()) {
      setError("Full name is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await update({
        id: member._id,
        fullName: form.fullName.trim(),
        gender: form.gender || undefined,
        klass: form.klass || undefined,
        position: form.position || undefined,
        status: form.status === "active" ? "active" : "inactive",
        isClassLeader,
      } as any);
      if (noteContent.trim()) {
        await addNote({
          memberId: member._id as any,
          type: "ministry",
          content: noteContent.trim(),
        });
      }
      toast.success("Member updated — linked account permissions synced");
      onOpenChange(false);
    } catch (err: any) {
      setError(err?.message ?? "Failed to update member");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit member — {member.fullName}</DialogTitle>
          <DialogDescription>
            Changing the ministry position or class automatically updates the linked
            account's system permissions and access scope.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={save}>
          <div>
            <Label htmlFor="e-name">Full name *</Label>
            <Input
              id="e-name"
              className="mt-1"
              value={form.fullName ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="e-gender">Gender</Label>
              <Select
                value={form.gender || undefined}
                onValueChange={(v) => setForm((f) => ({ ...f, gender: v }))}
              >
                <SelectTrigger id="e-gender" className="mt-1 w-full">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="e-class">Class</Label>
              <Select
                value={form.klass || undefined}
                onValueChange={(v) => setForm((f) => ({ ...f, klass: v }))}
              >
                <SelectTrigger id="e-class" className="mt-1 w-full">
                  <SelectValue placeholder="Select class" />
                </SelectTrigger>
                <SelectContent>
                  {CLASS_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>{c} Class</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="e-status">Status</Label>
              <Select
                value={form.status || "active"}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}
              >
                <SelectTrigger id="e-status" className="mt-1 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {isAdmin && (
            <div>
              <Label htmlFor="e-position">Ministry position</Label>
              <Select
                value={form.position || undefined}
                onValueChange={(v) => {
                  setForm((f) => ({ ...f, position: v }));
                  if (v === POSITIONS.CLASS_LEADER) setIsClassLeader(true);
                  else if (v !== POSITIONS.ADMIN && v !== POSITIONS.COORDINATOR) {
                    setIsClassLeader(false);
                  }
                }}
              >
                <SelectTrigger id="e-position" className="mt-1 w-full">
                  <SelectValue placeholder="Ordinary Member" />
                </SelectTrigger>
                <SelectContent>
                  {POSITION_OPTIONS.map((p) => (
                    <SelectItem key={p} value={p}>{POSITION_LABELS[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {isAdmin && (
            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2.5">
              <div className="min-w-0">
                <Label className="text-[12px] font-semibold">Also leads this class</Label>
                {(position === POSITIONS.CLASS_LEADER ||
                  position === POSITIONS.ADMIN ||
                  position === POSITIONS.COORDINATOR) && (
                  <p className="text-[10px] leading-4 text-muted-foreground">
                    {position === POSITIONS.CLASS_LEADER
                      ? "Class leadership comes from the Class Leader position."
                      : position === POSITIONS.ADMIN
                        ? "Administrators may also lead their class."
                        : "Evangelism Coordinators may also lead their class (dual role)."}
                  </p>
                )}
              </div>
              <Switch
                checked={isClassLeader}
                onCheckedChange={(v) => {
                  if (position === POSITIONS.ADMIN || position === POSITIONS.COORDINATOR) {
                    setIsClassLeader(v);
                  }
                }}
                disabled={
                  position !== POSITIONS.ADMIN &&
                  position !== POSITIONS.CLASS_LEADER &&
                  position !== POSITIONS.COORDINATOR
                }
                aria-label="Class leadership"
              />
            </div>
          )}
          <div>
            <Label htmlFor="e-note">Add a note</Label>
            <Textarea
              id="e-note"
              className="mt-1"
              rows={3}
              placeholder="Quick ministry note, counselling observation..."
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving..." : "Save changes"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
