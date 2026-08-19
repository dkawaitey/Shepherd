import { api } from "@/convex/_generated/api";
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
  Calendar as CalendarIcon,
  Download,
  FileText,
  KeyRound,
  Link2,
  Mail,
  MailCheck,
  MapPin,
  MessageCircle,
  MessageSquareText,
  QrCode,
  RefreshCw,
  Send,
  Users,
} from "lucide-react";


const TABS = [
  { id: "users", label: "User Management" },
  { id: "profile", label: "My Profile" },
  { id: "ministry", label: "Ministry Settings" },
  { id: "integrations", label: "Integrations" },
  { id: "audit", label: "Audit Logs" },
];

const INTEGRATION_FIELDS = [
  { key: "wa_number", label: "WhatsApp number", icon: MessageCircle, placeholder: "233240000000", hint: "Used for wa.me links and reminders" },
  { key: "sms_provider", label: "SMS provider", icon: MessageSquareText, placeholder: "Twilio / Hubtel / AfriSMS", hint: "API key needed to send bulk SMS" },
  { key: "sms_api_key", label: "SMS API key", icon: KeyRound, placeholder: "••••••••", hint: "Store the provider API key" },
  { key: "email_provider", label: "Email provider", icon: Mail, placeholder: "Resend / SendGrid / SES", hint: "Sends reminders, reports and weekly summaries" },
  { key: "email_api_key", label: "Email API key", icon: KeyRound, placeholder: "••••••••", hint: "Provider API key" },
  { key: "maps_api_key", label: "Google Maps API key", icon: MapPin, placeholder: "AIza...", hint: "Enables map embeds and geocoding" },
  { key: "calendar_connected", label: "Google Calendar", icon: CalendarIcon, placeholder: "connected@email.com", hint: "Follow-ups sync as calendar events" },
  { key: "qr_code", label: "QR code / visitor card", icon: QrCode, placeholder: "enabled", hint: "QR codes on outreach cards" },
];

export default function Settings() {
  const me = useQuery(api.users.currentUser);
  const isAdmin = me?.role === ROLES.ADMIN;
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
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <p className="term-label">create & manage ministry users</p>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {Object.entries(ROLE_LABELS).map(([k, v]) => (
            <div key={k} className="rounded-md border bg-muted/40 p-2.5">
              <div className="text-[11px] font-bold">{v}</div>
              <div className="text-[9px] leading-4 text-muted-foreground">
                {ROLE_NOTES[k as Role]}
              </div>
            </div>
          ))}
        </div>
      </div>

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
        <p className="term-label mb-3">// my profile</p>
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
        <p className="term-label mb-3">// ministry settings</p>
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
      <p className="text-[10px] text-muted-foreground">
        Class and lesson changes apply to the <b>Contacts</b> and <b>Bible Studies</b> modules. Values are stored in the database.
      </p>
    </div>
  );
}

function IntegrationsTab() {
  const settings = useQuery(api.settings.get);
  const setSetting = useMutation(api.settings.set);
  const [values, setValues] = useState<Record<string, string>>({});

  return (
    <div className="max-w-lg space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <p className="term-label mb-3">// integration settings</p>
        <div className="space-y-3">
          {INTEGRATION_FIELDS.map((f) => (
            <div key={f.key}>
              <Label htmlFor={`i-${f.key}`} className="flex items-center gap-1.5">
                <f.icon className="h-3.5 w-3.5 text-muted-foreground" /> {f.label}
              </Label>
              <Input
                id={`i-${f.key}`}
                className="mt-1"
                placeholder={f.placeholder}
                value={values[f.key] ?? settings?.[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
              <p className="mt-0.5 text-[9px] text-muted-foreground">{f.hint}</p>
            </div>
          ))}
          <Button
            onClick={async () => {
              for (const [k, v] of Object.entries(values)) {
                await setSetting({ key: k, value: v });
              }
              toast.success("Integration settings saved");
            }}
          >
            Save integration settings
          </Button>
        </div>
      </div>
      <CustomerioSection />
      <EmailRemindersSection />
      <StewardSyncSection />
      <div className="rounded-md border border-dashed p-4 text-[11px] leading-5 text-muted-foreground">
        <b className="text-foreground">How integrations work here:</b>
        <ul className="mt-1 list-inside list-disc space-y-1">
          <li>WhatsApp, SMS and phone links work instantly from every contact profile — no key needed.</li>
          <li>Google Maps directions open from profiles using the saved address / GPS.</li>
          <li>Email reminders (follow-up schedules + class digests) go out automatically every day at 07:00 UTC once a provider key is configured.</li>
          <li>Member details push automatically to the Steward app every hour (one-way, outbound), or on demand with Sync now.</li>
          <li>For bulk SMS or Google Calendar sync, add the provider API key above and wire the provider in the backend.</li>
        </ul>
      </div>
    </div>
  );
}

function CustomerioSection() {
  const sendStatus = useAction(api.customerio.status);
  const sendTest = useAction(api.customerio.sendTest);

  const [status, setStatus] = useState<{
    configured: boolean;
    region: string;
    host: string;
  } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    sendStatus().then(setStatus).catch(() => undefined);
  }, [sendStatus]);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Send className="h-4 w-4 text-primary" />
        <p className="term-label">// customer.io messaging</p>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
          <div>
            <div className="text-xs font-semibold">Customer.io connection</div>
            <div className="text-[10px] text-muted-foreground">
              {status === null
                ? "Checking connection…"
                : status.configured
                  ? `Connected — sending events to ${status.host}`
                  : "Not connected — add CUSTOMERIO_SITE_ID + CUSTOMERIO_API_KEY in the Keys tab"}
            </div>
          </div>
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              status?.configured ? "bg-[#86efac]" : "bg-[#fbbf24]",
            )}
          />
        </div>

        <Button
          size="sm"
          disabled={!status?.configured || testing}
          onClick={async () => {
            setTesting(true);
            try {
              const res = await sendTest({});
              if (res.ok) toast.success("Test event sent to Customer.io");
              else toast.error(res.error ?? "Could not reach Customer.io");
            } finally {
              setTesting(false);
            }
          }}
        >
          <Send className={cn("mr-1.5 h-3.5 w-3.5", testing && "animate-pulse")} />
          {testing ? "Sending…" : "Send test event"}
        </Button>

        <p className="text-[10px] leading-4 text-muted-foreground">
          Ministry moments are pushed automatically as events: contacts created, journey stages
          (accepted Christ, baptized, joined church…), follow-ups scheduled and completed, and members
          added. Build journeys, transactional email, SMS or push on top of them. Add{" "}
          <b className="text-foreground">CUSTOMERIO_SITE_ID</b> (workspace Site ID) and{" "}
          <b className="text-foreground">CUSTOMERIO_API_KEY</b> (Tracking API Key) in the Keys tab;
          set <b className="text-foreground">CUSTOMERIO_REGION</b> to <b>eu</b> if your workspace is in
          the EU region.
        </p>
      </div>
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
            <div className="text-[10px] text-muted-foreground">
              Auto-sent at 07:00 UTC · follow-up schedules + class digests
            </div>
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

        <p className="text-[10px] leading-4 text-muted-foreground">
          Paste <b className="text-foreground">RESEND_API_KEY</b> into the Keys tab to enable sending (an optional{" "}
          <b className="text-foreground">EMAIL_FROM</b> overrides the sender address). Workers receive their follow-up
          schedule; class leaders receive birthdays, low-attendance alerts, new contacts and follow-up highlights
          for their class.
        </p>
      </div>
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
                  : "Not connected — add STEWARD_API_URL + STEWARD_SYNC_KEY in the Keys tab"}
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
            <div className="text-[10px] text-muted-foreground">
              Runs hourly · pushes Shepherd's members out to Steward (one-way)
            </div>
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

        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">last sync</p>
          <p className="text-[11px] leading-4 text-muted-foreground">
            {status?.lastSync ? fmtDateTime(new Date(Number(status.lastSync)).toISOString()) : "Never"} ·{" "}
            {lastResultText}
          </p>
        </div>

        <p className="text-[10px] leading-4 text-muted-foreground">
          Add <b className="text-foreground">STEWARD_API_URL</b> (the Steward app's public URL) and a shared{" "}
          <b className="text-foreground">STEWARD_SYNC_KEY</b> in the Keys tab, and set the same two variables on the
          Steward app — it must accept <b className="text-foreground">POST /api/sync/members</b>. Members are matched
          on the Steward side by membership ID, email, phone or name + class, so edits stay on the same record. Sync is
          one-way: Shepherd pushes out and never imports Steward data. Ministry positions stay managed inside Shepherd.
        </p>
      </div>
    </div>
  );
}

function NotificationsTab() {
  return null;
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
