import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  CLASS_OPTIONS,
  CONTACT_DECISIONS,
  DECISION_LABELS,
  GENDER_LABELS,
  INTEREST_LABELS,
  INTEREST_LEVELS,
  MARITAL_STATUSES,
  MINISTRIES,
  STAGE_LABELS,
} from "@/convex/constants";
import { EmptyState, PageHeader, StatusPill, telLink, waLink, StagePill, downloadCsv, canAddRecords } from "@/components/shared";
import { isOfflineError, queueEntry } from "@/lib/offline-sync";
import { cn } from "@/lib/utils";
import {
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  Search,
  UserCheck,
  UserRound,
} from "lucide-react";

// ---- helpers ----
const deriveShortcut = (area: string) =>
  area
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

const normalizeStatus = (s: string | null) => {
  if (!s) return undefined;
  if (s === "newConvert") return "acceptedChrist";
  return s;
};

// ============ Contact Card ============
function ContactCard({
  contact,
  milestones,
}: {
  contact: any;
  milestones: Record<string, string[]>;
}) {
  const navigate = useNavigate();
  const loc = [contact.community, contact.area].filter(Boolean).join(", ");
  const events = milestones[contact._id] ?? [];

  return (
    <div
      onClick={() => navigate(`/contacts/${contact._id}`)}
      className="group cursor-pointer rounded-lg border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold group-hover:text-primary">
            {contact.fullName}
          </div>
          <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
            <span className="text-primary">{contact.membershipId}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {contact.phone && (
            <a
              href={telLink(contact.phone)}
              onClick={(e) => e.stopPropagation()}
              title={`Call ${contact.phone}`}
              className="flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              <Phone className="h-3.5 w-3.5" />
            </a>
          )}
          {contact.whatsapp && (
            <a
              href={waLink(contact.whatsapp)}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Open WhatsApp"
              className="flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:border-status-green/50 hover:text-status-green"
            >
              <MessageCircle className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {contact.phone && <span>{contact.phone}</span>}
        {loc && (
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3" /> {loc}
          </span>
        )}
      </div>

      <div className="mt-3 space-y-1">
        <StagePill stage={contact.status} />
        {contact.promotedToMemberId && (
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-status-green">
            <UserCheck className="h-3.5 w-3.5" /> Promoted to Member
          </div>
        )}
        {events.slice(0, 2).map((label) => (
          <div key={label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="text-status-green">✓</span>
            <span className="truncate">{label}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between border-t pt-2.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1 truncate">
          <UserRound className="h-3 w-3 shrink-0" />
          <span className="truncate">Assigned: {contact.assignedWorker || "Unassigned"}</span>
        </span>
        <span className="shrink-0">{contact.klass || "No class"}</span>
      </div>
    </div>
  );
}

// ============ Quick Add ============
export function QuickAddContact({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const quickAdd = useMutation(api.contacts.quickAdd);
  const navigate = useNavigate();
  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    whatsapp: "",
    community: "",
    klass: "",
    decision: "",
    area: "",
    areaShortcut: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm({ fullName: "", phone: "", whatsapp: "", community: "", klass: "", decision: "", area: "", areaShortcut: "" });
      setError(null);
    }
  }, [open]);

  const set = (k: string, v: string) => {
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (k === "area" && !f.areaShortcut) {
        next.areaShortcut = deriveShortcut(v);
      }
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fullName.trim()) {
      setError("Full name is required");
      return;
    }
    setBusy(true);
    setError(null);
    const payload = {
      fullName: form.fullName.trim(),
      phone: form.phone || undefined,
      whatsapp: form.whatsapp || undefined,
      community: form.community || undefined,
      klass: form.klass || undefined,
      decision: form.decision || undefined,
      area: form.area || undefined,
      areaShortcut: form.areaShortcut || deriveShortcut(form.area) || undefined,
      dateMet: new Date().toISOString(),
    };
    if (!navigator.onLine) {
      queueEntry("quickAddContact", payload);
      toast.warning(
        "Saved offline — it will sync automatically when you're back online.",
      );
      onOpenChange(false);
      return;
    }
    try {
      const res = await quickAdd(payload);
      toast.success(`Added ${form.fullName} · ${res.membershipId}`);
      onOpenChange(false);
      navigate(`/contacts/${res._id}`);
    } catch (err: any) {
      if (isOfflineError(err)) {
        queueEntry("quickAddContact", payload);
        toast.warning(
          "Saved offline — it will sync automatically when you're back online.",
        );
        onOpenChange(false);
      } else {
        setError(err?.message ?? "Failed to add contact");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Quick Add Contact</DialogTitle>
          <DialogDescription>
            Add a person met during outreach in under 2 minutes. Membership ID is generated automatically.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label htmlFor="qa-name">Full name *</Label>
            <Input id="qa-name" value={form.fullName} onChange={(e) => set("fullName", e.target.value)} placeholder="John Mensah" className="mt-1" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="qa-phone">Phone</Label>
              <Input id="qa-phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="024 000 0000" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="qa-wa">WhatsApp</Label>
              <Input id="qa-wa" value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} placeholder="024 000 0000" className="mt-1" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="qa-area">Area</Label>
              <Input id="qa-area" value={form.area} onChange={(e) => set("area", e.target.value)} placeholder="e.g. Adjikpo" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="qa-shortcut">Area code</Label>
              <Input id="qa-shortcut" value={form.areaShortcut} onChange={(e) => set("areaShortcut", e.target.value.toUpperCase())} placeholder="AD" className="mt-1 uppercase" maxLength={2} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="qa-class">Class</Label>
              <Select value={form.klass || undefined} onValueChange={(v) => set("klass", v)}>
                <SelectTrigger id="qa-class" className="mt-1 w-full"><SelectValue placeholder="Select class" /></SelectTrigger>
                <SelectContent>
                  {CLASS_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>{c} Class</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="qa-decision">Decision</Label>
              <Select value={form.decision || undefined} onValueChange={(v) => set("decision", v)}>
                <SelectTrigger id="qa-decision" className="mt-1 w-full"><SelectValue placeholder="Select decision" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DECISION_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter className="pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Adding..." : "Add Contact"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============ Full Create/Edit Dialog ============
export function ContactFormDialog({
  open,
  onOpenChange,
  contact,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contact?: any | null;
  onSaved?: (id: string) => void;
}) {
  const create = useMutation(api.contacts.create);
  const update = useMutation(api.contacts.update);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});

  useEffect(() => {
    if (open) {
      setForm(contact ? { ...contact } : { prayerOffered: false, gospelShared: false, tags: [] });
      setError(null);
    }
  }, [open, contact]);

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  // Live duplicate detection while typing name / phone
  const dupArgs =
    open && (form.fullName?.trim() || form.phone?.trim())
      ? {
          fullName: form.fullName?.trim() || undefined,
          phone: form.phone?.trim() || undefined,
        }
      : "skip";
  const dupResults = useQuery(api.contacts.findDuplicates, dupArgs);
  const dupes = (dupResults ?? []).filter(
    (d) => !contact || d._id !== contact._id,
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fullName?.trim()) {
      setError("Full name is required");
      return;
    }
    setBusy(true);
    setError(null);
    let payload: Record<string, any> = {};
    try {
      payload = {};
      for (const [k, v] of Object.entries(form)) {
        if (k === "_id" || k === "membershipId" || k === "createdAt" || k === "updatedAt" || k === "isDeleted" || k === "age") continue;
        payload[k] = v === "" ? undefined : v;
      }
      if (contact) {
        await update({ id: contact._id, ...(payload as any) });
        toast.success("Contact updated");
        onOpenChange(false);
        onSaved?.(contact._id);
      } else {
        const createPayload = {
          ...(payload as any),
          dateMet: payload.dateMet ?? new Date().toISOString(),
          areaShortcut:
            payload.areaShortcut ||
            (payload.area ? deriveShortcut(payload.area) : undefined),
        };
        if (!navigator.onLine) {
          queueEntry("createContact", createPayload);
          toast.warning(
            "Saved offline — it will sync automatically when you're back online.",
          );
          onOpenChange(false);
          return;
        }
        const res = await create(createPayload);
        toast.success(`Contact added · ${res.membershipId}`);
        onOpenChange(false);
        onSaved?.(res._id);
      }
    } catch (err: any) {
      if (!contact && !navigator.onLine) {
        queueEntry("createContact", {
          ...(payload as any),
          dateMet: payload.dateMet ?? new Date().toISOString(),
          areaShortcut:
            payload.areaShortcut ||
            (payload.area ? deriveShortcut(payload.area) : undefined),
        });
        toast.warning(
          "Saved offline — it will sync automatically when you're back online.",
        );
        onOpenChange(false);
      } else {
        setError(err?.message ?? "Failed to save contact");
      }
    } finally {
      setBusy(false);
    }
  };

  const field = (k: string) => form[k] ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{contact ? "Edit Contact" : "Add Contact"}</DialogTitle>
          <DialogDescription>
            {contact
              ? `Updating ${contact.fullName} · ${contact.membershipId}`
              : "A membership ID is generated automatically from the area and date of first encounter."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          {/* Personal */}
          <section className="space-y-3">
            <p className="term-label">// personal information</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="c-name">Full name *</Label>
                <Input id="c-name" value={field("fullName")} onChange={(e) => set("fullName", e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="c-gender">Gender</Label>
                <Select value={field("gender") || undefined} onValueChange={(v) => set("gender", v)}>
                  <SelectTrigger id="c-gender" className="mt-1 w-full"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(GENDER_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="c-dob">Date of birth</Label>
                <Input id="c-dob" type="date" value={field("dateOfBirth")} onChange={(e) => set("dateOfBirth", e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="c-phone">Phone</Label>
                <Input id="c-phone" value={field("phone")} onChange={(e) => set("phone", e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="c-wa">WhatsApp</Label>
                <Input id="c-wa" value={field("whatsapp")} onChange={(e) => set("whatsapp", e.target.value)} className="mt-1" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="c-email">Email</Label>
                <Input id="c-email" type="email" value={field("email")} onChange={(e) => set("email", e.target.value)} className="mt-1" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="c-addr">Home address</Label>
                <Input id="c-addr" value={field("homeAddress")} onChange={(e) => set("homeAddress", e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="c-landmark">Landmark</Label>
                <Input id="c-landmark" value={field("landmark")} onChange={(e) => set("landmark", e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="c-gps">GPS location</Label>
                <Input id="c-gps" value={field("gpsLocation")} onChange={(e) => set("gpsLocation", e.target.value)} placeholder="5.6037, -0.1870" className="mt-1" />
              </div>
              <div>
                <Label htmlFor="c-region">Region</Label>
                <Input id="c-region" value={field("region")} onChange={(e) => set("region", e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="c-district">District</Label>
                <Input id="c-district" value={field("district")} onChange={(e) => set("district", e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="c-community">Community</Label>
                <Input id="c-community" value={field("community")} onChange={(e) => set("community", e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="c-occupation">Occupation</Label>
                <Input id="c-occupation" value={field("occupation")} onChange={(e) => set("occupation", e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="c-school">School</Label>
                <Input id="c-school" value={field("school")} onChange={(e) => set("school", e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="c-marital">Marital status</Label>
                <Select value={field("maritalStatus") || undefined} onValueChange={(v) => set("maritalStatus", v)}>
                  <SelectTrigger id="c-marital" className="mt-1 w-full"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {MARITAL_STATUSES.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="c-emergency">Emergency contact</Label>
                <Input id="c-emergency" value={field("emergencyContact")} onChange={(e) => set("emergencyContact", e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="c-lang">Preferred language</Label>
                <Input id="c-lang" value={field("preferredLanguage")} onChange={(e) => set("preferredLanguage", e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="c-religion">Religion</Label>
                <Input id="c-religion" value={field("religion")} onChange={(e) => set("religion", e.target.value)} className="mt-1" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="c-bg">Church background</Label>
                <Input id="c-bg" value={field("churchBackground")} onChange={(e) => set("churchBackground", e.target.value)} className="mt-1" />
              </div>
            </div>
          </section>

          {/* Outreach record */}
          <section className="space-y-3">
            <p className="term-label">// outreach record</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="c-dateMet">Date met *</Label>
                <Input id="c-dateMet" type="date" value={field("dateMet") ? field("dateMet").slice(0, 10) : ""} onChange={(e) => set("dateMet", e.target.value ? new Date(e.target.value).toISOString() : "")} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="c-loc">Location</Label>
                <Input id="c-loc" value={field("locationMet")} onChange={(e) => set("locationMet", e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="c-area">Area</Label>
                <Input id="c-area" value={field("area")} onChange={(e) => set("area", e.target.value)} className="mt-1" placeholder="e.g. Adjikpo" />
              </div>
              <div>
                <Label htmlFor="c-shortcut">Area code (Membership ID)</Label>
                <div className="mt-1 flex items-center gap-2">
                  <Input id="c-shortcut" value={field("areaShortcut")} onChange={(e) => set("areaShortcut", e.target.value.toUpperCase())} placeholder="AD" maxLength={2} className="w-16 uppercase" />
                  <span className="text-[10px] text-muted-foreground">
                    → {form.areaShortcut || (form.area ? deriveShortcut(form.area) : "GN")}-{form.dateMet ? `${new Date(form.dateMet).getDate().toString().padStart(2, "0")}${(new Date(form.dateMet).getMonth() + 1).toString().padStart(2, "0")}` : "DDMM"}-{form.dateMet ? new Date(form.dateMet).getFullYear() : "YYYY"}-001
                  </span>
                </div>
              </div>
              <div>
                <Label htmlFor="c-team">Evangelism team</Label>
                <Input id="c-team" value={field("evangelismTeam")} onChange={(e) => set("evangelismTeam", e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="c-class">Class</Label>
                <Select value={field("klass") || undefined} onValueChange={(v) => set("klass", v)}>
                  <SelectTrigger id="c-class" className="mt-1 w-full"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {CLASS_OPTIONS.map((c) => (
                      <SelectItem key={c} value={c}>{c} Class</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="c-street">Street</Label>
                <Input id="c-street" value={field("street")} onChange={(e) => set("street", e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="c-event">Event</Label>
                <Input id="c-event" value={field("event")} onChange={(e) => set("event", e.target.value)} className="mt-1" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="c-conv">Conversation summary</Label>
                <Textarea id="c-conv" value={field("conversationSummary")} onChange={(e) => set("conversationSummary", e.target.value)} className="mt-1" rows={2} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="c-questions">Questions asked</Label>
                <Textarea id="c-questions" value={field("questionsAsked")} onChange={(e) => set("questionsAsked", e.target.value)} className="mt-1" rows={2} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="c-needs">Needs identified</Label>
                <Textarea id="c-needs" value={field("needsIdentified")} onChange={(e) => set("needsIdentified", e.target.value)} className="mt-1" rows={2} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="c-verses">Bible verses shared</Label>
                <Input id="c-verses" value={field("bibleVersesShared")} onChange={(e) => set("bibleVersesShared", e.target.value)} className="mt-1" placeholder="John 3:16, Romans 10:9" />
              </div>
              <div className="flex items-center gap-6 sm:col-span-2">
                <label className="flex items-center gap-2 text-[13px]">
                  <Checkbox checked={!!field("prayerOffered")} onCheckedChange={(v) => set("prayerOffered", !!v)} /> Prayer offered
                </label>
                <label className="flex items-center gap-2 text-[13px]">
                  <Checkbox checked={!!field("gospelShared")} onCheckedChange={(v) => set("gospelShared", !!v)} /> Gospel shared
                </label>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="c-prayers">Prayer requests</Label>
                <Textarea id="c-prayers" value={field("outreachPrayerRequests")} onChange={(e) => set("outreachPrayerRequests", e.target.value)} className="mt-1" rows={2} placeholder="Added to the Prayer Journal automatically" />
              </div>
            </div>
          </section>

          {/* Decision */}
          <section className="space-y-3">
            <p className="term-label">// decision & interest</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="c-decision">Decision</Label>
                <Select value={field("decision") || undefined} onValueChange={(v) => set("decision", v)}>
                  <SelectTrigger id="c-decision" className="mt-1 w-full"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(DECISION_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="c-interest">Interest level</Label>
                <Select value={field("interestLevel") || undefined} onValueChange={(v) => set("interestLevel", v)}>
                  <SelectTrigger id="c-interest" className="mt-1 w-full"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(INTEREST_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="c-worker">Follow-up worker</Label>
                <Input id="c-worker" value={field("assignedWorker")} onChange={(e) => set("assignedWorker", e.target.value)} className="mt-1" placeholder="Brother Daniel" />
              </div>
              <div>
                <Label htmlFor="c-mentor">Mentor</Label>
                <Input id="c-mentor" value={field("mentor")} onChange={(e) => set("mentor", e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="c-ministry">Ministry</Label>
                <Select value={field("ministry") || undefined} onValueChange={(v) => set("ministry", v)}>
                  <SelectTrigger id="c-ministry" className="mt-1 w-full"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {MINISTRIES.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          {dupes.length > 0 && (
            <div className="rounded-md border border-[#f59e0b]/40 bg-[#2e2408] px-3 py-2 text-xs text-[#fbbf24]">
              <span className="font-semibold">Possible duplicates:</span>{" "}
              {dupes.map((d) => d.fullName).join(", ")} — check before adding.
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving..." : contact ? "Save changes" : "Add contact"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============ Contacts List Page ============
export default function Contacts() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);
  const me = useQuery(api.users.currentUser);
  const canAdd = canAddRecords(me);

  const status = searchParams.get("status") ?? "";
  const klass = searchParams.get("klass") ?? "";
  const decision = searchParams.get("decision") ?? "";
  const gender = searchParams.get("gender") ?? "";
  const sort = searchParams.get("sort") ?? "newest";
  const search = searchParams.get("search") ?? "";

  const contacts = useQuery(api.contacts.list, {
    status: normalizeStatus(status),
    klass: klass || undefined,
    decision: decision || undefined,
    gender: gender || undefined,
    search: search || undefined,
    sort,
  });

  const journeyEvents = useQuery(api.dashboard.journeyEventsAll, {});
  const milestones = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const ev of journeyEvents ?? []) {
      if (ev.source !== "auto") continue;
      const arr = (map[ev.contactId] ??= []);
      if (!arr.includes(ev.label)) arr.push(ev.label);
    }
    return map;
  }, [journeyEvents]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const statusOptions = [
    { value: "reached", label: "Met During Outreach" },
    { value: "interested", label: "Interested" },
    { value: "followupStarted", label: "Follow-up Started" },
    { value: "acceptedChrist", label: "New Convert" },
    { value: "bibleStudy", label: "Bible Study" },
    { value: "baptized", label: "Baptized" },
    { value: "joinedChurch", label: "Joined Church" },
    { value: "completedDiscipleship", label: "Completed Discipleship" },
    { value: "serving", label: "Serving" },
    { value: "leading", label: "Leading Others" },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Contacts"
        code="ppl"
        actions={
          <>
            <Button
              variant="outline"
              className="hidden sm:inline-flex"
              disabled={!contacts?.length}
              onClick={() =>
                downloadCsv(
                  "shepherd-contacts.csv",
                  (contacts ?? []).map((c) => ({
                    membershipId: c.membershipId,
                    fullName: c.fullName,
                    status: (STAGE_LABELS as Record<string, string>)[c.status ?? ""] ?? c.status ?? "",
                    klass: c.klass ?? "",
                    phone: c.phone ?? "",
                    whatsapp: c.whatsapp ?? "",
                    email: c.email ?? "",
                    community: c.community ?? "",
                    area: c.area ?? "",
                    assignedWorker: c.assignedWorker ?? "",
                    decision: c.decision ? DECISION_LABELS[c.decision] : "",
                    dateMet: c.dateMet ? c.dateMet.slice(0, 10) : "",
                  })),
                )
              }
            >
              Export CSV
            </Button>
            {canAdd && (
              <Button onClick={() => setAddOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" /> Add Contact
              </Button>
            )}
          </>
        }
      />

      {/* Filters */}
      <div className="mb-5 grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative lg:col-span-2">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, phone, ID, location..."
            className="pl-8"
            defaultValue={search}
            onChange={(e) => setParam("search", e.target.value)}
          />
        </div>
        <Select value={status || "all"} onValueChange={(v) => setParam("status", v === "all" ? "" : v)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {statusOptions.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={klass || "all"} onValueChange={(v) => setParam("klass", v === "all" ? "" : v)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All classes</SelectItem>
            {CLASS_OPTIONS.map((c) => (
              <SelectItem key={c} value={c}>{c} Class</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={decision || "all"} onValueChange={(v) => setParam("decision", v === "all" ? "" : v)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All decisions</SelectItem>
            {Object.entries(DECISION_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setParam("sort", v)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="oldest">Oldest first</SelectItem>
            <SelectItem value="name">Name A–Z</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {status && (
        <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
          <span>Filtered by:</span>
          <StatusPill status={normalizeStatus(status) ?? ""} />
          <span className="text-muted-foreground/50">({(STAGE_LABELS as Record<string, string>)[normalizeStatus(status) ?? ""] ?? normalizeStatus(status)})</span>
          <button className="text-primary underline" onClick={() => setParam("status", "")}>clear</button>
        </div>
      )}

      {contacts === undefined ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-lg border bg-card" />
          ))}
        </div>
      ) : contacts.length === 0 ? (
        <EmptyState
          title="No contacts found"
          message="Add your first outreach record, or adjust the filters."
          action={<Button onClick={() => setAddOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> Add Contact</Button>}
        />
      ) : (
        <>
          <p className="mb-3 text-[11px] text-muted-foreground">
            <span className="text-primary">$</span> find contacts --count <span className="text-foreground">{contacts.length}</span>
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {contacts.map((c) => (
              <ContactCard key={c._id} contact={c} milestones={milestones} />
            ))}
          </div>
        </>
      )}

      <ContactFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSaved={(id) => navigate(`/contacts/${id}`)}
      />
    </div>
  );
}

