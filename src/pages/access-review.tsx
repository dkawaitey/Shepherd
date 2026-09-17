import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
  ROLE_LABELS,
  ROLE_NOTES,
  ROLES,
  Role,
  effectivePosition,
} from "@/convex/constants";
import { EmptyState, PageHeader, fmtDate, formatError } from "@/components/shared";
import { cn } from "@/lib/utils";
import {
  Check,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCog,
  UserRound,
  UserX,
} from "lucide-react";

type Row = NonNullable<ReturnType<typeof useQuery<typeof api.users.accessReview>>>[number];

/** Everything an administrator needs to judge and fix one account. */
function reviewFlags(row: Row) {
  const flags: { label: string; tone: "good" | "warn" | "bad" }[] = [];
  if (row.isAnonymous) {
    flags.push({ label: "Guest account", tone: "bad" });
  } else if (!row.hasAccess) {
    flags.push({ label: "No ministry access", tone: "warn" });
  } else {
    flags.push({ label: "Active", tone: "good" });
  }
  if (!row.isAnonymous && !row.memberId && (row.roles?.length ?? 0) > 0) {
    flags.push({ label: "Roles assigned manually", tone: "warn" });
  }
  if (!row.memberId) flags.push({ label: "Not linked to a member", tone: "warn" });
  if (row.member?.isDeleted) flags.push({ label: "Linked member deleted", tone: "bad" });
  if (row.rolesOverridden) flags.push({ label: "Role override", tone: "warn" });
  if (row.activeSessionCount > 0) flags.push({ label: "Signed in now", tone: "good" });
  if (row.sessionCount === 0) flags.push({ label: "Never signed in", tone: "warn" });
  return flags;
}

const needsAttention = (row: Row) =>
  row.isAnonymous ||
  !row.hasAccess ||
  !row.memberId ||
  !!row.member?.isDeleted ||
  row.rolesOverridden;

function relative(ts: number | null) {
  if (!ts) return "—";
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 90) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(new Date(ts).toISOString());
}

const FILTERS = [
  { id: "attention", label: "Needs attention" },
  { id: "all", label: "All accounts" },
  { id: "guests", label: "Guests" },
  { id: "noaccess", label: "No access" },
  { id: "unlinked", label: "Not linked" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

export default function AccessReview() {
  const rows = useQuery(api.users.accessReview);
  const members = useQuery(api.members.list, {});
  const me = useQuery(api.users.currentUser);
  const setRoles = useMutation(api.users.setRoles);
  const clearAccess = useMutation(api.users.clearAccess);
  const linkMember = useMutation(api.users.linkMember);
  const revertOverride = useMutation(api.users.revertRoleOverride);
  const removeUser = useMutation(api.users.removeUser);

  const [filter, setFilter] = useState<FilterId>("attention");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{
    user: Row;
    roles: string[];
    classScope: string;
    memberId: string;
    /** True once the admin toggles a role — otherwise roles follow the link. */
    rolesTouched: boolean;
  } | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);

  const openEditor = (row: Row) => {
    setEditing({
      user: row,
      roles: [...(row.roles ?? [])],
      classScope: row.classScope ?? "",
      memberId: row.memberId ?? "",
      rolesTouched: false,
    });
  };

  const visible = useMemo(() => {
    const list = rows ?? [];
    const q = search.trim().toLowerCase();
    return list.filter((row) => {
      if (filter === "attention" && !needsAttention(row)) return false;
      if (filter === "guests" && !row.isAnonymous) return false;
      if (filter === "noaccess" && (row.isAnonymous || row.hasAccess)) return false;
      if (filter === "unlinked" && row.memberId) return false;
      if (q) {
        const haystack = [
          row.name,
          row.email,
          row.member?.fullName,
          row.member?.membershipId,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [rows, filter, search]);

  const stats = useMemo(() => {
    const list = rows ?? [];
    return {
      total: list.length,
      active: list.filter((r) => r.hasAccess).length,
      noAccess: list.filter((r) => !r.isAnonymous && !r.hasAccess).length,
      guests: list.filter((r) => r.isAnonymous).length,
      attention: list.filter(needsAttention).length,
    };
  }, [rows]);

  const saveEditing = async () => {
    if (!editing) return;
    const linkChanged = editing.memberId !== (editing.user.memberId ?? "");
    if (!linkChanged && !editing.rolesTouched) {
      setEditing(null);
      return;
    }
    setBusy(true);
    try {
      if (linkChanged) {
        await linkMember({
          userId: editing.user._id,
          memberId: editing.memberId ? (editing.memberId as any) : undefined,
        });
      }
      if (editing.rolesTouched) {
        // An explicit choice wins: it is stored as an override.
        if (editing.roles.length === 0) {
          await clearAccess({ userId: editing.user._id });
          toast.success("All roles revoked — this account has no ministry access");
        } else {
          await setRoles({
            userId: editing.user._id,
            roles: editing.roles,
            classScope: editing.classScope || undefined,
          });
          toast.success("Roles saved");
        }
      } else {
        // Only the member link changed, so let the ministry position decide the
        // roles (this also clears an earlier manual override).
        await revertOverride({ userId: editing.user._id });
        toast.success("Member linked — roles now follow the ministry position");
      }
      setEditing(null);
    } catch (err) {
      toast.error(formatError(err, "Could not save access"));
    } finally {
      setBusy(false);
    }
  };

  if (rows === null) {
    return (
      <div className="mx-auto max-w-6xl">
        <PageHeader title="Access Review" code="sec" />
        <EmptyState
          title="Administrator access required"
          message="Access review shows every account, its last sign-in and role overrides, so it is limited to administrators."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Access Review"
        code="sec"
        actions={
          rows && stats.attention > 0 ? (
            <span className="flex items-center gap-1.5 text-[11px] text-status-amber">
              <ShieldAlert className="h-3.5 w-3.5" />
              {stats.attention} account{stats.attention === 1 ? "" : "s"} need attention
            </span>
          ) : undefined
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Accounts", value: stats.total, icon: UserRound, tone: "#9db392" },
          { label: "With access", value: stats.active, icon: ShieldCheck, tone: "#86b26f" },
          { label: "No access", value: stats.noAccess, icon: ShieldAlert, tone: "#fbbf24" },
          { label: "Guest accounts", value: stats.guests, icon: UserX, tone: "#f87171" },
        ].map((tile) => (
          <div key={tile.label} className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="term-label">{tile.label}</span>
              <tile.icon className="h-4 w-4" style={{ color: tile.tone }} />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">{tile.value}</div>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
              filter === f.id
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-muted/40 text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
        <div className="relative ml-auto min-w-56 flex-1 sm:max-w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, email or membership ID..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {rows === undefined ? (
        <div className="h-64 animate-pulse rounded-lg border bg-card" />
      ) : visible.length === 0 ? (
        <EmptyState
          title={filter === "attention" ? "Nothing to clean up" : "No accounts match"}
          message={
            filter === "attention"
              ? "Every account is linked to a member with a valid ministry position."
              : "Try a different filter or clear the search."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-muted/50 text-[9px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Account</th>
                <th className="px-3 py-2">Last sign-in</th>
                <th className="px-3 py-2">Roles</th>
                <th className="px-3 py-2">Member link</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const assigned = row.roles ?? [];
                const shown = row.member && !row.rolesOverridden
                  ? (row.derivedRoles ?? [])
                  : assigned;
                const pos = row.member
                  ? effectivePosition(row.member.position, row.member.isClassLeader)
                  : undefined;
                const isMe = row._id === me?._id;
                return (
                  <tr key={row._id} className="border-t align-top">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 font-semibold">
                        {row.isAnonymous ? (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <UserX className="h-3 w-3" /> Guest account
                          </span>
                        ) : (
                          row.name || row.email || "Unnamed account"
                        )}
                        {isMe && (
                          <span className="rounded border border-primary/40 px-1 text-[9px] text-primary">
                            you
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {row.email ?? `id ${row._id.slice(-6)}`} · joined{" "}
                        {fmtDate(new Date(row.accountCreatedAt).toISOString())}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="tabular-nums">{relative(row.lastSignInAt)}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {row.sessionCount} session{row.sessionCount === 1 ? "" : "s"}
                        {row.activeSessionCount > 0 ? ` · ${row.activeSessionCount} active` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1">
                        {shown.length === 0 ? (
                          <span className="text-[10px] text-muted-foreground">None</span>
                        ) : (
                          shown.map((r) => (
                            <Badge
                              key={r}
                              variant={row.rolesOverridden ? "outline" : "secondary"}
                              className="text-[9px]"
                            >
                              {ROLE_LABELS[r as Role] ?? r}
                            </Badge>
                          ))
                        )}
                        {row.rolesOverridden && (
                          <span className="text-[9px] text-status-amber">override</span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[9px] text-muted-foreground">
                        {row.member && !row.rolesOverridden
                          ? "derived from ministry position"
                          : assigned.length > 0
                            ? "assigned by an administrator"
                            : "no roles"}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {row.member ? (
                        <>
                          <Link
                            to={`/members/${row.member._id}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {row.member.fullName}
                          </Link>
                          <div className="text-[10px] text-muted-foreground">
                            {row.member.membershipId} · {pos ? POSITION_LABELS[pos] : "—"}
                            {row.member.klass ? ` · ${row.member.klass}` : ""}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Not linked</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {reviewFlags(row).map((f) => (
                          <span
                            key={f.label}
                            className={cn(
                              "rounded border px-1.5 py-0.5 text-[9px]",
                              f.tone === "good" &&
                                "border-[#86efac]/40 text-status-green",
                              f.tone === "warn" &&
                                "border-[#f59e0b]/40 text-status-amber",
                              f.tone === "bad" &&
                                "border-[#f87171]/40 text-[#f87171]",
                            )}
                          >
                            {f.label}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {isMe ? (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEditor(row)}>
                            <UserCog className="mr-1 h-3.5 w-3.5" /> Manage
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setRemoving(row)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Manage access ── */}
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">
              Access — {editing?.user.name ?? editing?.user.email ?? "guest account"}
            </DialogTitle>
            <DialogDescription className="text-[11px]">
              {editing?.user.isAnonymous
                ? "This is a guest account: it can never hold a role and sees no ministry data."
                : "A linked member's ministry position decides the role automatically; assigning roles here overrides that."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label className="text-[11px]">Linked member record</Label>
              <Select
                value={editing?.memberId || "none"}
                onValueChange={(v) =>
                  setEditing((e) => (e ? { ...e, memberId: v === "none" ? "" : v } : e))
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Not linked" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not linked</SelectItem>
                  {(members ?? []).map((m) => (
                    <SelectItem key={m._id} value={m._id}>
                      {m.fullName}
                      {m.membershipId ? ` · ${m.membershipId}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Saving applies the change immediately.
              </p>
            </div>

            <div>
              <Label className="text-[11px]">System roles</Label>
              <div className="mt-1.5 space-y-1.5">
                {(
                  [
                    ROLES.ADMIN,
                    ROLES.COORDINATOR,
                    ROLES.WORKER,
                    ROLES.LEADER,
                    ROLES.CLASS_LEADER,
                  ] as Role[]
                ).map((role) => {
                  const active = !!editing?.roles.includes(role);
                  return (
                    <label
                      key={role}
                      className={cn(
                        "flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 transition-colors",
                        active ? "border-primary/40 bg-primary/5" : "border-border",
                      )}
                    >
                      <Switch
                        checked={active}
                        onCheckedChange={() =>
                          setEditing((e) => {
                            if (!e) return e;
                            const roles = e.roles.includes(role)
                              ? e.roles.filter((r) => r !== role)
                              : [...e.roles, role];
                            return { ...e, roles, rolesTouched: true };
                          })
                        }
                      />
                      <span className="min-w-0">
                        <span className="block text-[11px] font-medium">
                          {ROLE_LABELS[role]}
                        </span>
                        <span className="block text-[10px] text-muted-foreground">
                          {ROLE_NOTES[role]}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                Leave these untouched and a linked member's ministry position decides
                the roles. Turning every role off revokes all access — the account
                keeps its sign-in but sees no ministry data.
              </p>
            </div>

            {editing?.roles.includes(ROLES.CLASS_LEADER) && (
              <div>
                <Label className="text-[11px]">Class scope (required for a class leader)</Label>
                <Select
                  value={editing.classScope || "none"}
                  onValueChange={(v) =>
                    setEditing((e) => (e ? { ...e, classScope: v === "none" ? "" : v } : e))
                  }
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Pick a class" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No class</SelectItem>
                    {CLASS_OPTIONS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {k}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setEditing(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={saveEditing} disabled={busy}>
              <Check className="mr-1.5 h-3.5 w-3.5" />
              {busy ? "Saving…" : "Save access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Remove account ── */}
      <Dialog open={!!removing} onOpenChange={(v) => !v && setRemoving(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Remove this account?</DialogTitle>
            <DialogDescription className="text-[11px]">
              {removing?.isAnonymous ? "Guest account" : removing?.email ?? removing?.name} is
              deleted along with its sign-in, sessions, device notifications and
              engagement history. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!removing) return;
                try {
                  await removeUser({ userId: removing._id });
                  toast.success("Account removed");
                  setRemoving(null);
                } catch (err) {
                  toast.error(formatError(err, "Could not remove account"));
                }
              }}
            >
              Remove account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
