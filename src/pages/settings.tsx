import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
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
  ROLE_LABELS,
  ROLE_NOTES,
  ROLES,
  Role,
} from "@/convex/constants";
import { PageHeader, fmtDateTime, downloadCsv, formatRoles } from "@/components/shared";
import { cn } from "@/lib/utils";
import {
  Download,
  KeyRound,
  MessageCircle,
  MessageSquareText,
  Mail,
  MapPin,
  Calendar as CalendarIcon,
  QrCode,
  ShieldCheck,
  Users,
} from "lucide-react";

const TABS = [
  { id: "users", label: "User Management" },
  { id: "profile", label: "My Profile" },
  { id: "ministry", label: "Ministry Settings" },
  { id: "integrations", label: "Integrations" },
  { id: "notifications", label: "Notifications" },
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

  const tabs = isAdmin ? TABS : TABS.filter((t) => t.id === "profile" || t.id === "notifications");

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Settings"
        code="cfg"
        description="Users, roles, ministry configuration, notification channels and integrations."
      />

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
      {tab === "notifications" && <NotificationsTab />}
      {tab === "audit" && <AuditTab />}
    </div>
  );
}

function UsersTab() {
  const users = useQuery(api.users.list);
  const setRoles = useMutation(api.users.setRoles);
  const removeUser = useMutation(api.users.removeUser);
  const me = useQuery(api.users.currentUser);
  const [editing, setEditing] = useState<{
    user: NonNullable<typeof users>[number];
    roles: string[];
    classScope: string;
  } | null>(null);

  const openEditor = (u: NonNullable<typeof users>[number]) => {
    const current = u.roles?.length ? [...u.roles] : u.role ? [u.role] : [];
    setEditing({ user: u, roles: current, classScope: u.classScope ?? "" });
  };

  const saveRoles = async () => {
    if (!editing) return;
    await setRoles({
      userId: editing.user._id,
      roles: editing.roles,
      classScope: editing.classScope || undefined,
    });
    toast.success("Roles updated");
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

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <p className="term-label">create & manage ministry users</p>
        </div>
        <p className="text-[11px] leading-5 text-muted-foreground">
          Users sign up with their email from the sign-in page, then an administrator assigns roles here.
          A user may hold several roles — for example Administrator plus Class Leader. A Class Leader is
          locked to a single class and can manage contacts, workers, follow-ups, prayers and notes there.
        </p>
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

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-left text-[12px]">
          <thead className="bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Roles</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users === undefined
              ? Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-t">
                    <td colSpan={3} className="px-3 py-3">
                      <div className="h-4 animate-pulse rounded bg-muted" />
                    </td>
                  </tr>
                ))
              : users.map((u) => {
                  const roleList = u.roles?.length ? u.roles : u.role ? [u.role] : [];
                  return (
                    <tr key={u._id} className="border-t">
                      <td className="px-3 py-2.5">
                        <div className="font-semibold">{u.name || "—"}</div>
                        <div className="text-[10px] text-muted-foreground">{u.email}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1">
                          {roleList.length === 0 ? (
                            <span className="text-[11px] text-muted-foreground">Pending role</span>
                          ) : (
                            roleList.map((r) => (
                              <Badge key={r} variant="secondary" className="text-[10px]">
                                {ROLE_LABELS[r as Role] ?? r}
                              </Badge>
                            ))
                          )}
                          {u.classScope && (
                            <Badge variant="outline" className="text-[10px]">
                              {u.classScope} Class
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {u._id !== me?._id && (
                            <Button variant="ghost" size="sm" onClick={() => openEditor(u)}>
                              Edit roles
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
      <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <ShieldCheck className="h-3 w-3" /> The first account to sign in becomes the Administrator automatically.
      </p>

      {/* Role editor */}
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Roles — {editing?.user.name ?? editing?.user.email}</DialogTitle>
            <DialogDescription>
              A user may hold several roles. A Class Leader is locked to the class you assign here.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
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
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveRoles} disabled={!editing?.roles.length}>
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
          {saved && <p className="text-[11px] text-[#86efac]">✓ Saved</p>}
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
    { key: "default_worker", label: "Default follow-up worker", placeholder: "Brother Daniel" },
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
      <div className="rounded-md border border-dashed p-4 text-[11px] leading-5 text-muted-foreground">
        <b className="text-foreground">How integrations work here:</b>
        <ul className="mt-1 list-inside list-disc space-y-1">
          <li>WhatsApp, SMS and phone links work instantly from every contact profile — no key needed.</li>
          <li>Google Maps directions open from profiles using the saved address / GPS.</li>
          <li>To send real bulk SMS, email or sync Google Calendar, add the provider API key above and wire the provider in the backend.</li>
        </ul>
      </div>
    </div>
  );
}

function NotificationsTab() {
  const me = useQuery(api.users.currentUser);
  const isAdmin = me?.role === ROLES.ADMIN;
  const items = [
    { key: "remind_upcoming", label: "Upcoming visits", desc: "Alert before scheduled follow-ups", def: true },
    { key: "remind_missed", label: "Missed visits", desc: "Alert when a follow-up is missed", def: true },
    { key: "remind_birthday", label: "Birthdays", desc: "Birthday greetings this week", def: true },
    { key: "remind_inactive", label: "No contact for 10 days", desc: "Contacts that have gone quiet", def: true },
    { key: "remind_attendance", label: "Low church attendance", desc: "Members missing youth meetings", def: true },
    { key: "remind_biblestudy", label: "Bible study due", desc: "Lessons waiting to be completed", def: true },
  ];
  return (
    <div className="max-w-lg space-y-3">
      <div className="rounded-lg border bg-card p-4">
        <p className="term-label mb-3">// automatic reminders</p>
        {items.map((it) => (
          <div key={it.key} className="flex items-center justify-between border-b border-dashed py-2.5 last:border-0">
            <div>
              <div className="text-[13px] font-medium">{it.label}</div>
              <div className="text-[10px] text-muted-foreground">{it.desc}</div>
            </div>
            <Switch defaultChecked={it.def} disabled={!isAdmin} />
          </div>
        ))}
        <p className="mt-3 text-[10px] text-muted-foreground">
          Reminders appear on the dashboard and in the notification bell. Email / WhatsApp / SMS delivery
          activates once the corresponding integration key is configured.
        </p>
      </div>
    </div>
  );
}

function AuditTab() {
  const logs = useQuery(api.settings.listAuditLogs, {});
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
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
