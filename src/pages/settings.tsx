import { api } from "@/convex/_generated/api";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
import { PageHeader, fmtDateTime, downloadCsv, downloadPdf, formatRoles } from "@/components/shared";
import { cn } from "@/lib/utils";

import {
  Bell,
  Download,
  FileText,
  Link2,
  MailCheck,
  RefreshCw,
  Send,
  Users,
} from "lucide-react";


const TABS = [
  { id: "users", label: "User Management" },
  { id: "profile", label: "My Profile" },
  { id: "ministry", label: "Ministry Settings" },
  { id: "notifications", label: "Notifications" },
  { id: "integrations", label: "Integrations" },
  { id: "audit", label: "Audit Logs" },
];



export default function Settings() {
  const me = useQuery(api.users.currentUser);
  const isAdmin = me?.role === ROLES.ADMIN || me?.roles?.includes(ROLES.ADMIN);
  const [tab, setTab] = useState(isAdmin ? "users" : "profile");

  const tabs = isAdmin ? TABS : TABS.filter((t) => t.id === "profile");

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Settings" code="cfg" />

      <div className="mb-5 flex gap-1.5 overflow-x-auto rounded-lg border bg-card p-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "users" && <UsersTab />}
      {tab === "profile" && <ProfileTab />}
      {tab === "ministry" && <MinistryTab />}
      {tab === "notifications" && <NotificationsTab />}
      {tab === "integrations" && <IntegrationsTab />}
      {tab === "audit" && <AuditTab />}
    </div>
  );
}

function UsersTab() {
  const users = useQuery(api.users.list);
  const members = useQuery(api.members.list, {});
  const setRoles = useMutation(api.users.setRoles);
  const linkMember = useMutation(api.users.linkMember);
  const revertOverride = useMutation(api.users.revertRoleOverride);
  const removeUser = useMutation(api.users.removeUser);
  const me = useQuery(api.users.currentUser);
  const [editing, setEditing] = useState<{
    user: NonNullable<typeof users>[number];
    roles: string[];
    classScope: string;
    memberId: string;
    override: boolean;
  } | null>(null);

  const openEditor = (u: NonNullable<typeof users>[number]) => {
    const current = u.roles?.length ? [...u.roles] : u.role ? [u.role] : [];
    setEditing({
      user: u,
      roles: current,
      classScope: u.classScope ?? "",
      memberId: u.memberId ?? "",
      override: !!u.rolesOverridden,
    });
  };

  const saveRoles = async () => {
    if (!editing) return;
    await setRoles({
      userId: editing.user._id,
      roles: editing.roles,
      classScope: editing.classScope || undefined,
    });
    toast.success("Roles saved");
    setEditing(null);
  };

  const toggleRole = (k: string) => {
    setEditing((e) => {
      if (!e) return e;
      const active = e.roles.includes(k);
      const roles = active ? e.roles.filter((r) => r !== k) : [...e.roles, k];
      return { ...e, roles };
    });
  };

  const rolesEditable = !editing || editing.override || !editing.user.member;

  return (
    <div className="space-y-4">

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-left text-[11px]">
          <thead className="bg-muted/50 text-[9px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Linked Member</th>
              <th className="px-3 py-2">Ministry Position</th>
              <th className="px-3 py-2">Class</th>
              <th className="px-3 py-2">System Role</th>
              <th className="px-3 py-2">Account Status</th>
              <th className="px-3 py-2">Permission Scope</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users === undefined
              ? Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-t">
                    <td colSpan={8} className="px-3 py-3">
                      <div className="h-4 animate-pulse rounded bg-muted" />
                    </td>
                  </tr>
                ))
              : users.map((u) => {
                  const roleList = u.roles?.length ? u.roles : u.role ? [u.role] : [];
                  const derived = u.member ? (u.derivedRoles ?? []) : [];
                  const overridden = !!u.rolesOverridden && !!u.member;
                  const shown = u.member ? (overridden ? roleList : derived) : roleList;
                  const pos = u.member
                    ? effectivePosition(u.member.position, u.member.isClassLeader)
                    : undefined;
                  const scope = overridden
                    ? (u.classScope ?? (roleList.includes(ROLES.ADMIN) ? "All ministry" : "—"))
                    : u.member
                      ? (u.derivedClassScope ?? (derived.includes(ROLES.ADMIN) ? "All ministry" : "—"))
                      : (u.classScope ?? (roleList.includes(ROLES.ADMIN) ? "All ministry" : "—"));
                  return (
                    <tr key={u._id} className="border-t align-top">
                      <td className="px-3 py-2.5">
                        <div className="font-semibold">{u.name || "—"}</div>
                        <div className="text-[10px] text-muted-foreground">{u.email}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        {u.member ? (
                          <Link
                            to={`/members/${u.member._id}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {u.member.fullName}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {pos ? POSITION_LABELS[pos] : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2.5">{u.member?.klass ?? "—"}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1">
                          {shown.length === 0 ? (
                            <span className="text-[10px] text-muted-foreground">
                              {u.member ? "None" : "Pending role"}
                            </span>
                          ) : (
                            shown.map((r) => (
                              <Badge
                                key={r}
                                variant={overridden ? "outline" : "secondary"}
                                className="text-[9px]"
                              >
                                {ROLE_LABELS[r as Role] ?? r}
                              </Badge>
                            ))
                          )}
                          {overridden && (
                            <Badge
                              variant="outline"
                              className="border-[#f59e0b]/50 text-[9px] text-status-amber"
                            >
                              overridden
                            </Badge>
                          )}
                          {!u.member && roleList.length > 0 && (
                            <span className="text-[9px] text-muted-foreground">manually assigned</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 text-[10px]",
                            u.memberId ? "text-status-green" : "text-muted-foreground",
                          )}
                        >
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              u.memberId ? "bg-[#86efac]" : "bg-border",
                            )}
                          />
                          {u.memberId ? "Linked" : "Not linked"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">{scope}</td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {u._id !== me?._id && (
                            <Button variant="ghost" size="sm" onClick={() => openEditor(u)}>
                              Edit
                            </Button>
                          )}
                          {u._id === me?._id && (
                            <span className="pr-2 text-[10px] text-muted-foreground">You</span>
                          )}
                          {u._id !== me?._id && roleList.length > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={async () => {
                                await removeUser({ userId: u._id });
                                toast.success("User removed");
                              }}
                            >
                              Remove
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
      {/* Role editor */}
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Roles — {editing?.user.name ?? editing?.user.email}</DialogTitle>
            <DialogDescription>
              {editing?.user.member
                ? `System role is derived from ${editing.user.member.fullName}'s ministry position (${POSITION_LABELS[effectivePosition(editing.user.member.position, editing.user.member.isClassLeader)]}).`
                : "This account has no linked member record, so roles are assigned manually."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-[11px]">Linked member record</Label>
              <Select
                value={editing?.memberId ?? "none"}
                onValueChange={async (v) => {
                  if (!editing) return;
                  const memberId = v === "none" ? undefined : (v as any);
                  try {
                    await linkMember({ userId: editing.user._id, memberId });
                    toast.success(memberId ? "Member linked — permissions inherited" : "Account unlinked from member");
                    setEditing((e) => (e ? { ...e, memberId: memberId ?? "" } : e));
                  } catch (err: any) {
                    toast.error(err?.message ?? "Could not link member");
                  }
                }}
              >
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue placeholder="No member linked" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— No member —</SelectItem>
                  {(members ?? []).map((m) => {
                    const pos = effectivePosition(m.position, m.isClassLeader);
                    return (
                      <SelectItem key={m._id} value={m._id}>
                        {m.fullName} · {m.klass} Class · {POSITION_LABELS[pos]}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            {editing?.user.member && (
              <div className="rounded-md border bg-muted/40 p-2.5 text-[11px]">
                <span className="text-muted-foreground">Derived from position: </span>
                {(editing.user.derivedRoles ?? []).length === 0 ? (
                  <b>no system role</b>
                ) : (
                  (editing.user.derivedRoles ?? []).map((r, i) => (
                    <b key={r}>
                      {i > 0 ? " + " : ""}
                      {ROLE_LABELS[r as Role] ?? r}
                    </b>
                  ))
                )}
                {editing.user.derivedClassScope && (
                  <span className="text-muted-foreground"> · {editing.user.derivedClassScope} Class</span>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2.5">
              <div className="min-w-0">
                <Label className="text-[12px] font-semibold">Override roles manually</Label>
                <p className="text-[10px] leading-4 text-muted-foreground">
                  {editing?.user.member
                    ? "Roles stop following the member's ministry position and are flagged as overridden."
                    : "Assign roles directly (no member record to derive from)."}
                </p>
              </div>
              <Switch
                checked={editing?.override ?? false}
                onCheckedChange={(v) => setEditing((e) => (e ? { ...e, override: v } : e))}
              />
            </div>

            <div
              className={cn("space-y-2", !rolesEditable && "pointer-events-none opacity-50")}
            >
              {Object.entries(ROLE_LABELS).map(([k, v]) => {
                const active = editing?.roles.includes(k) ?? false;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => toggleRole(k)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-xs transition-colors",
                      active
                        ? "border-primary/60 bg-primary/10"
                        : "hover:bg-muted",
                    )}
                  >
                    <span>
                      <span className="block font-semibold">{v}</span>
                      <span className="block text-[10px] text-muted-foreground">{ROLE_NOTES[k as Role]}</span>
                    </span>
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", active ? "bg-primary" : "bg-border")} />
                  </button>
                );
              })}
              {editing?.roles.includes(ROLES.CLASS_LEADER) && (
                <div className="pt-1">
                  <Label className="text-[11px]">Class scope</Label>
                  <Select
                    value={editing.classScope}
                    onValueChange={(v) => setEditing((e) => (e ? { ...e, classScope: v } : e))}
                  >
                    <SelectTrigger className="mt-1 w-full">
                      <SelectValue placeholder="Select class" />
                    </SelectTrigger>
                    <SelectContent>
                      {CLASS_OPTIONS.map((c) => (
                        <SelectItem key={c} value={c}>{c} Class</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="flex-wrap gap-2">
            {editing?.user.member && editing?.user.rolesOverridden && (
              <Button
                variant="ghost"
                className="text-status-amber"
                onClick={async () => {
                  await revertOverride({ userId: editing.user._id });
                  toast.success("Roles re-derived from ministry position");
                  setEditing(null);
                }}
              >
                Revert to member position
              </Button>
            )}
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveRoles} disabled={!editing?.roles.length || !rolesEditable}>
              Save roles
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProfileTab() {
  const me = useQuery(api.users.currentUser);
  const updateProfile = useMutation(api.users.updateProfile);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saved, setSaved] = useState(false);

  const isLoaded = me !== undefined;
  const displayName = isLoaded && name === "" && me?.name ? me.name : name;
  const displayPhone = isLoaded && phone === "" && me?.phone ? me.phone : phone;

  return (
    <div className="max-w-md space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <div className="space-y-3">
          <div>
            <Label htmlFor="p-name">Full name</Label>
            <Input id="p-name" className="mt-1" value={displayName} onChange={(e) => { setName(e.target.value); setSaved(false); }} />
          </div>
          <div>
            <Label htmlFor="p-phone">Phone / WhatsApp</Label>
            <Input id="p-phone" className="mt-1" value={displayPhone} onChange={(e) => { setPhone(e.target.value); setSaved(false); }} />
          </div>
          <div>
            <Label>Email (sign-in)</Label>
            <Input className="mt-1" value={me?.email ?? ""} disabled />
          </div>
          <div>
            <Label>Roles</Label>
            <Input className="mt-1" value={formatRoles(me)} disabled />
          </div>
          <Button
            onClick={async () => {
              await updateProfile({ name: displayName || "Worker", phone: displayPhone || "" });
              setSaved(true);
              toast.success("Profile updated");
            }}
          >
            Save profile
          </Button>
          {saved && <p className="text-[11px] text-status-green">✓ Saved</p>}
        </div>
      </div>
    </div>
  );
}

function MinistryTab() {
  const settings = useQuery(api.settings.get);
  const setSetting = useMutation(api.settings.set);
  const [values, setValues] = useState<Record<string, string>>({});

  const list = [
    { key: "ministry_name", label: "Ministry name", placeholder: "Gethsemane Ministry Youth" },
    { key: "church_name", label: "Church", placeholder: "Gethsemane Ministry" },
    { key: "classes", label: "Classes (comma separated)", placeholder: "Millison, Reuben, Jacob, Romina" },
    { key: "bible_lessons", label: "Bible study lessons (comma separated)", placeholder: "Salvation, Prayer, Bible Study..." },
    { key: "ministries", label: "Ministries (comma separated)", placeholder: "Choir, Ushering, Evangelism Team..." },
  ];

  return (
    <div className="max-w-lg space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <div className="space-y-3">
          {list.map((f) => (
            <div key={f.key}>
              <Label htmlFor={`m-${f.key}`}>{f.label}</Label>
              <Input
                id={`m-${f.key}`}
                className="mt-1"
                placeholder={f.placeholder}
                value={values[f.key] ?? settings?.[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            </div>
          ))}
          <Button
            onClick={async () => {
              for (const [k, v] of Object.entries(values)) {
                await setSetting({ key: k, value: v });
              }
              toast.success("Ministry settings saved");
            }}
          >
            Save settings
          </Button>
        </div>
      </div>

    </div>
  );
}

function IntegrationsTab() {
  return (
    <div className="max-w-lg space-y-4">
      <EmailRemindersSection />
      <StewardSyncSection />
    </div>
  );
}

function EmailRemindersSection() {
  const me = useQuery(api.users.currentUser);
  const settings = useQuery(api.settings.get);
  const setSetting = useMutation(api.settings.set);
  const preview = useQuery(api.reminders.preview);
  const logs = useQuery(api.settings.listEmailLogs, { limit: 8 });
  const sendTest = useAction(api.emails.sendTest);
  const sendNow = useAction(api.emails.sendNow);
  const sendStatus = useAction(api.emails.status);

  const [status, setStatus] = useState<{ configured: boolean; from: string } | null>(null);
  const [testTo, setTestTo] = useState("");
  const [sending, setSending] = useState<"test" | "now" | null>(null);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    sendStatus().then(setStatus).catch(() => undefined);
  }, [sendStatus]);

  useEffect(() => {
    if (settings && settings.reminder_email_enabled !== undefined) {
      setEnabled(settings.reminder_email_enabled !== "false");
    }
  }, [settings]);

  const c = preview?.counts;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <MailCheck className="h-4 w-4 text-primary" />
        <p className="term-label">// email notifications</p>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
          <div>
            <div className="text-xs font-semibold">Provider</div>
            <div className="text-[10px] text-muted-foreground">
              {status === null
                ? "Checking connection…"
                : status.configured
                  ? `Connected — sends from ${status.from}`
                  : "Not connected — add RESEND_API_KEY in the Keys tab"}
            </div>
          </div>
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              status?.configured ? "bg-[#86efac]" : "bg-[#fbbf24]",
            )}
          />
        </div>

        <div className="flex items-center justify-between border-b border-dashed pb-3">
          <div>
            <div className="text-[13px] font-medium">Daily reminder emails</div>

          </div>
          <Switch
            checked={enabled}
            onCheckedChange={async (v) => {
              setEnabled(v);
              await setSetting({ key: "reminder_email_enabled", value: String(v) });
              toast.success(v ? "Daily emails enabled" : "Daily emails paused");
            }}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "worker emails", value: c?.workerEmails ?? 0 },
            { label: "class digests", value: c?.classEmails ?? 0 },
            { label: "upcoming follow-ups", value: c?.upcoming ?? 0 },
            { label: "overdue", value: c?.overdue ?? 0 },
            { label: "birthdays this week", value: c?.birthdays ?? 0 },
            { label: "low attendance", value: c?.lowAttendance ?? 0 },
            { label: "new contacts", value: c?.newContacts ?? 0 },
            { label: "skipped (no email)", value: c?.skippedWorkers ?? 0 },
          ].map((it) => (
            <div key={it.label} className="rounded-md border bg-muted/40 px-2.5 py-2">
              <div className="font-mono text-sm font-bold">{it.value}</div>
              <div className="text-[9px] leading-3 text-muted-foreground">{it.label}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-40 flex-1">
            <Label className="text-[10px]">Test recipient (defaults to your email)</Label>
            <Input
              className="mt-1"
              placeholder={me?.email ?? "you@example.com"}
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={!status?.configured || sending !== null}
            onClick={async () => {
              setSending("test");
              try {
                const res = await sendTest({ to: testTo || undefined });
                if (res.ok) toast.success("Test email sent — check your inbox");
                else toast.error(res.error ?? "Test email failed");
              } finally {
                setSending(null);
              }
            }}
          >
            {sending === "test" ? "Sending…" : "Send test email"}
          </Button>
          <Button
            size="sm"
            disabled={!status?.configured || sending !== null}
            onClick={async () => {
              setSending("now");
              try {
                const res = await sendNow();
                if (res.ok) toast.success(`Sent ${res.sent} reminder email${res.sent === 1 ? "" : "s"}`);
                else toast.error(res.reason ?? "Could not send reminders");
              } finally {
                setSending(null);
              }
            }}
          >
            <Send className="mr-1.5 h-3.5 w-3.5" />
            {sending === "now" ? "Sending…" : "Send reminders now"}
          </Button>
        </div>

        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">recent sends</p>
          {logs && logs.length > 0 ? (
            <div className="divide-y divide-dashed rounded-md border">
              {logs.map((l) => (
                <div key={l._id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-[11px]">
                  <span className="truncate">
                    {l.subject}
                    <span className="text-muted-foreground"> → {l.to}</span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0",
                      l.status === "sent" ? "text-status-green" : "text-status-red",
                    )}
                    title={l.error ?? ""}
                  >
                    {l.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground">Nothing sent yet.</p>
          )}
        </div>


      </div>
    </div>
  );
}

function TestSyncButton() {
  const testSync = useAction(api.sync.testSync);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  return (
    <div>
      <Button
        size="sm"
        variant="outline"
        disabled={testing}
        onClick={async () => {
          setTesting(true);
          setResult(null);
          try {
            const res = await testSync();
            if (res.ok) {
              setResult(`✅ Success (${res.status}): ${res.body}`);
              toast.success("Test sync succeeded — check Steward!");
            } else {
              setResult(`❌ Failed (${res.status ?? "N/A"}): ${res.error ?? res.body}`);
              toast.error("Test sync failed — see details below");
            }
          } catch (e) {
            setResult(`❌ Error: ${e instanceof Error ? e.message : String(e)}`);
            toast.error("Test sync threw an error");
          } finally {
            setTesting(false);
          }
        }}
      >
        {testing ? "Testing…" : "Test Sync"}
      </Button>
      {result && (
        <p className="mt-1.5 text-[10px] text-muted-foreground break-all">{result}</p>
      )}
    </div>
  );
}

function StewardSyncSection() {
  const settings = useQuery(api.settings.get);
  const setSetting = useMutation(api.settings.set);
  const getStatus = useAction(api.steward.status);
  const runSync = useAction(api.steward.syncNow);

  const [status, setStatus] = useState<{
    configured: boolean;
    baseUrl?: string;
    enabled: boolean;
    lastSync?: string;
    lastResult?: string;
    total: number;
    synced: number;
    unsynced: number;
  } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    getStatus().then(setStatus).catch(() => undefined);
  }, [getStatus]);

  useEffect(() => {
    if (settings && settings["steward.enabled"] !== undefined) {
      setEnabled(settings["steward.enabled"] !== "false");
    }
  }, [settings]);

  let lastResultText = "Never synced yet — run a sync or wait for the hourly job.";
  if (status?.lastResult) {
    try {
      const r = JSON.parse(status.lastResult) as { sent?: number; matched?: number };
      lastResultText = `Last push sent ${r.sent ?? 0} members and linked ${r.matched ?? 0} Steward records.`;
    } catch {
      // keep the default text if the stored result is unreadable
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Link2 className="h-4 w-4 text-primary" />
        <p className="term-label">// steward member sync</p>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
          <div>
            <div className="text-xs font-semibold">Steward connection</div>
            <div className="text-[10px] text-muted-foreground">
              {status === null
                ? "Checking connection…"
                : status.configured
                  ? `Connected — pushing to ${status.baseUrl}`
                  : "Not connected — APP_B_SYNC_URL or SYNC_SHARED_SECRET missing in Convex env vars"}
            </div>
          </div>
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              status?.configured ? "bg-[#86efac]" : "bg-[#fbbf24]",
            )}
          />
        </div>

        <div className="flex items-center justify-between border-b border-dashed pb-3">
          <div>
            <div className="text-[13px] font-medium">Automatic background sync</div>

          </div>
          <Switch
            checked={enabled}
            onCheckedChange={async (v) => {
              setEnabled(v);
              await setSetting({ key: "steward.enabled", value: String(v) });
              toast.success(v ? "Automatic sync enabled" : "Automatic sync paused");
            }}
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "total members", value: status?.total ?? 0 },
            { label: "synced", value: status?.synced ?? 0 },
            { label: "not yet synced", value: status?.unsynced ?? 0 },
          ].map((it) => (
            <div key={it.label} className="rounded-md border bg-muted/40 px-2.5 py-2">
              <div className="font-mono text-sm font-bold">{it.value}</div>
              <div className="text-[9px] leading-3 text-muted-foreground">{it.label}</div>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={!status?.configured || syncing}
            onClick={async () => {
              setSyncing(true);
              try {
                const res = await runSync();
                if (res.ok) {
                  toast.success("Sync complete — members pushed to Steward");
                } else {
                  toast.error(res.push?.reason || "Sync failed");
                }
                const s = await getStatus();
                setStatus(s);
              } finally {
                setSyncing(false);
              }
            }}
          >
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", syncing && "animate-spin")} />
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
          <TestSyncButton />
        </div>

        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">last sync</p>
          <p className="text-[11px] leading-4 text-muted-foreground">
            {status?.lastSync ? fmtDateTime(new Date(Number(status.lastSync)).toISOString()) : "Never"} ·{" "}
            {lastResultText}
          </p>
        </div>


      </div>
    </div>
  );
}

function NotificationsTab() {
  const me = useQuery(api.users.currentUser);
  const { subscribed, permission, loading, enable, disable } = usePushNotifications(!!me);
  const [actionError, setActionError] = useState("");
  const [testing, setTesting] = useState(false);
  const sendTestNotif = useMutation(api.push.sendTestNotification);
  const diag = useQuery(api.push.deliveryDiagnostics);

  const supported = typeof Notification !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
  const inIframe = typeof window !== "undefined" && window.self !== window.top;

  return (
    <div className="max-w-lg space-y-4">
      {inIframe && (
        <div className="rounded-lg border border-amber-300/50 bg-amber-50 p-4 dark:border-amber-700/50 dark:bg-amber-950/30">
          <div className="mb-2 flex items-center gap-2">
            <Bell className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Push notifications require the app to be opened directly</p>
          </div>
          <p className="text-[11px] leading-5 text-amber-700 dark:text-amber-400/80">
            You are viewing Shepherd inside an embedded preview. Push notifications are blocked by the browser in this mode.
            Open the app in a new tab or install it as a PWA on your home screen to enable device notifications.
          </p>
          <a
            href={window.location.href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block rounded-md bg-amber-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-amber-700"
          >
            Open in new tab →
          </a>
        </div>
      )}
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" />
          <p className="term-label">// device push notifications</p>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
            <div>
              <div className="text-xs font-semibold">Push notifications</div>
              <div className="text-[10px] text-muted-foreground">
                {!supported
                  ? "Not supported in this browser"
                  : subscribed
                    ? "Enabled — you will receive device notifications"
                    : permission === "denied"
                      ? "Permission denied — enable in browser settings"
                      : "Receive follow-up reminders, announcements and alerts as device notifications"}
              </div>
            </div>
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                subscribed ? "bg-[#86efac]" : permission === "denied" ? "bg-[#f87171]" : "bg-[#fbbf24]",
              )}
            />
          </div>

          {supported && permission !== "denied" && (
            <div className="flex items-center justify-between border-b border-dashed pb-3">
              <div>
                <div className="text-[13px] font-medium">Enable on this device</div>
                <div className="text-[10px] text-muted-foreground">
                  {subscribed ? "Notifications are active" : "Click to enable device notifications"}
                </div>
              </div>
              <Switch
                checked={subscribed}
                disabled={loading}
                onCheckedChange={async (checked) => {
                  setActionError("");
                  const result = checked ? await enable() : await disable();
                  if (!result.ok) setActionError(result.reason);
                }}
              />
            </div>
          )}

          {actionError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
              {actionError}
            </div>
          )}

          {subscribed && (
            <div className="flex items-center gap-2 border-b border-dashed pb-3">
              <Button
                size="sm"
                variant="outline"
                disabled={testing}
                onClick={async () => {
                  setTesting(true);
                  setActionError("");
                  try {
                    await sendTestNotif();
                    toast.success("Test notification sent — check your device");
                  } catch (err: any) {
                    const msg = err?.data?.message ?? err?.message ?? "Failed";
                    setActionError(msg);
                  } finally {
                    setTesting(false);
                  }
                }}
              >
                <Bell className={cn("mr-1.5 h-3.5 w-3.5", testing && "animate-pulse")} />
                {testing ? "Sending…" : "Send test notification"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  setActionError("");
                  const result = await disable();
                  if (!result.ok) setActionError(result.reason);
                }}
              >
                Disable
              </Button>
            </div>
          )}

          {/* ── Diagnostics ── */}
          {diag && (
            <div className="rounded-md border bg-muted/40 px-3 py-2.5 text-[10px] leading-4">
              <div className="mb-1.5 text-[11px] font-semibold">Delivery Diagnostics</div>
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <span className="text-muted-foreground">VAPID keys: </span>
                  <span className={diag.vapidConfigured ? "text-status-green font-semibold" : "text-destructive font-semibold"}>
                    {diag.vapidConfigured ? "✓ Configured" : "✗ Missing"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Registered devices: </span>
                  <span className="font-semibold">{diag.totalSubscriptions}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Public key: </span>
                  <span className={diag.vapidPublicKey ? "text-status-green" : "text-destructive"}>
                    {diag.vapidPublicKey ? "Set" : "Missing"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Private key: </span>
                  <span className={diag.vapidPrivateKey ? "text-status-green" : "text-destructive"}>
                    {diag.vapidPrivateKey ? "Set" : "Missing"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Subject: </span>
                  <span className={diag.vapidSubject ? "text-status-green" : "text-destructive"}>
                    {diag.vapidSubject ? "Set" : "Missing"}
                  </span>
                </div>
              </div>

              {!diag.vapidConfigured && (
                <div className="mt-2 rounded border border-destructive/30 bg-destructive/5 p-2 text-destructive">
                  <b>VAPID keys are not configured.</b> Add these environment variables in the Convex dashboard (Settings → Environment Variables):<br />
                  <code className="text-[9px]">VAPID_PUBLIC_KEY</code>, <code className="text-[9px]">VAPID_PRIVATE_KEY</code>, <code className="text-[9px]">VAPID_SUBJECT</code> (e.g. <code className="text-[9px]">mailto:admin@gethsemane.org</code>)
                </div>
              )}

              {diag.recentLogs.length > 0 && (
                <div className="mt-2">
                  <div className="mb-1 font-semibold">Recent delivery attempts</div>
                  <div className="divide-y rounded border bg-background">
                    {diag.recentLogs.map((l, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 px-2 py-1">
                        <span className="truncate text-[9px] text-muted-foreground">
                          {l.endpoint === "config" ? "Config check" : `${l.endpoint.slice(0, 40)}…`}
                        </span>
                        <span className={cn("shrink-0 font-semibold", l.success ? "text-status-green" : "text-destructive")}>
                          {l.success ? "✓ sent" : `✗ ${l.error?.slice(0, 60) ?? "failed"}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {diag.recentJobs.length > 0 && (
                <div className="mt-2">
                  <div className="mb-1 font-semibold">Recent jobs</div>
                  <div className="divide-y rounded border bg-background">
                    {diag.recentJobs.map((j, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 px-2 py-1">
                        <span className="text-[9px] text-muted-foreground">{j.kind} → {j.recipients} recipient{j.recipients === 1 ? "" : "s"}</span>
                        <span className={cn("shrink-0 text-[9px] font-semibold", j.status === "delivered" ? "text-status-green" : j.status === "cancelled" ? "text-muted-foreground" : "text-status-amber")}>
                          {j.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {diag.postNotificationJobs && diag.postNotificationJobs.length > 0 && (
                <div className="mt-2">
                  <div className="mb-1 font-semibold">Post / Comment / Reply push jobs</div>
                  <div className="divide-y rounded border bg-background">
                    {diag.postNotificationJobs.map((j, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 px-2 py-1">
                        <span className="text-[9px] text-muted-foreground">{j.kind} → {j.recipients} recipient{j.recipients === 1 ? "" : "s"}</span>
                        <span className={cn("shrink-0 text-[9px] font-semibold", j.status === "delivered" ? "text-status-green" : j.status === "cancelled" ? "text-muted-foreground" : "text-status-amber")}>
                          {j.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {diag.postNotificationJobs && diag.postNotificationJobs.length === 0 && (
                <div className="mt-2 rounded border border-dashed p-2 text-[10px] text-muted-foreground">
                  No post/comment/reply push jobs yet. Create a post to test.
                </div>
              )}
            </div>
          )}


        </div>
      </div>
    </div>
  );
}

function AuditTab() {
  const logs = useQuery(api.settings.listAuditLogs, {});
  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            downloadCsv(
              "audit-logs.csv",
              (logs ?? []).map((l) => ({
                date: fmtDateTime(new Date(l.createdAt).toISOString()),
                user: l.userName ?? "",
                action: l.action,
                entity: l.entityType,
                details: l.details ?? "",
              })),
            )
          }
          disabled={!logs?.length}
        >
          <Download className="mr-1.5 h-3.5 w-3.5" /> Export logs
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!logs?.length}
          onClick={() =>
            downloadPdf("audit-logs.pdf", [
              {
                heading: "Audit Logs — System Activity",
                rows: (logs ?? []).map((l) => ({
                  date: fmtDateTime(new Date(l.createdAt).toISOString()),
                  user: l.userName ?? "",
                  action: l.action,
                  entity: l.entityType,
                  details: l.details ?? "",
                })),
              },
            ])
          }
        >
          <FileText className="mr-1.5 h-3.5 w-3.5" /> Export PDF
        </Button>
      </div>
      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-left text-[11px]">
          <thead className="bg-muted/50 text-[9px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {logs === undefined
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-t">
                    <td colSpan={5} className="px-3 py-2"><div className="h-3 animate-pulse rounded bg-muted" /></td>
                  </tr>
                ))
              : logs.map((l) => (
                  <tr key={l._id} className="border-t align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{fmtDateTime(new Date(l.createdAt).toISOString())}</td>
                    <td className="px-3 py-2">{l.userName ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px]">{l.action}</span>
                    </td>
                    <td className="px-3 py-2">{l.entityType}</td>
                    <td className="px-3 py-2 text-muted-foreground">{l.details ?? "—"}</td>
                  </tr>
                ))}
            {logs?.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No activity logged yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
