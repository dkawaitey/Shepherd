import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
  BIBLE_LESSONS,
  CLASS_OPTIONS,
  FOLLOWUP_TYPE_LABELS,
  STAGE_LABELS,
  STAGES,
  STAGE_ORDER,
  ATTENDANCE_TYPE_LABELS,
  ATTENDANCE_TYPES,
  ATTENDANCE_STATUS_LABELS,
  PRAYER_STATUS,
  PRAYER_STATUS_LABELS,
  NOTE_TYPE_LABELS,
  NOTE_TYPES,
} from "@/convex/constants";
import {
  EmptyState,
  StagePill,
  StatusPill,
  canAddRecords,
  fmtDate,
  fmtDateTime,
  mapsLink,
  smsLink,
  telLink,
  waLink,
  progressColor,
} from "@/components/shared";
import { StatusChangeDialog, ScheduleDialog } from "./followups";
import { ContactFormDialog } from "./contacts";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Baby,
  BookOpen,
  CalendarPlus,
  Church,
  HandHeart,
  Home,
  Lock,
  MapPin,
  MessageCircle,
  MessageSquareText,
  NotebookPen,
  Pencil,
  Phone,
  Plus,
  ScrollText,
  Sparkles,
  Trash2,
  Trophy,
  UserCheck,
  UserPlus,
  UserRound,
} from "lucide-react";

const STAGE_ICONS: Record<string, any> = {
  [STAGES.REACHED]: HandHeart,
  [STAGES.INTERESTED]: MessageSquareText,
  [STAGES.FOLLOWUP_STARTED]: Home,
  [STAGES.ACCEPTED_CHRIST]: Sparkles,
  [STAGES.BIBLE_STUDY]: BookOpen,
  [STAGES.BAPTIZED]: Baby,
  [STAGES.JOINED_CHURCH]: Church,
  [STAGES.COMPLETED_DISCIPLESHIP]: ScrollText,
  [STAGES.SERVING]: UserRound,
  [STAGES.LEADING]: Trophy,
};

export default function ContactProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const data = useQuery(api.contacts.get, { id: id as any });
  const me = useQuery(api.users.currentUser);
  const isAdmin = me?.role === "admin";
  const canEdit = me && me.role !== "leader";
  const canAdd = canAddRecords(me);
  const promote = useMutation(api.contacts.promoteToMember);
  const [promoting, setPromoting] = useState(false);

  const [tab, setTab] = useState("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [changing, setChanging] = useState<any | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const remove = useMutation(api.contacts.remove);

  if (!data) {
    return (
      <div className="mx-auto max-w-5xl">
        <div className="space-y-3">
          <div className="h-24 animate-pulse rounded-lg border bg-card" />
          <div className="h-64 animate-pulse rounded-lg border bg-card" />
        </div>
      </div>
    );
  }

  const { contact, journeyEvents, followUps, bibleStudies, attendance, prayers, notes } = data;

  const tabs = [
    { id: "overview", label: "Overview", icon: ScrollText },
    { id: "timeline", label: "Timeline", icon: Sparkles },
    { id: "followups", label: `Follow-ups (${followUps.length})`, icon: CalendarPlus },
    { id: "bible", label: "Bible Studies", icon: BookOpen },
    { id: "attendance", label: "Attendance", icon: Home },
    { id: "prayer", label: `Prayer Journal (${prayers.length})`, icon: HandHeart },
    { id: "notes", label: `Notes (${notes.length})`, icon: NotebookPen },
  ];

  const lastEvents = journeyEvents.slice(-3).reverse();
  const visibleNotes = notes.filter((n) => !n.isPrivate || isAdmin);

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/contacts")}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Contacts
        </Button>
      </div>

      <div className="mb-6 overflow-hidden rounded-lg border bg-card">
        <div className="border-b bg-muted/40 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight">{contact.fullName}</h1>
                <StagePill stage={contact.status} />
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <span className="text-primary">{contact.membershipId}</span>
                {contact.klass && <span>{contact.klass} Class</span>}
                {contact.assignedWorker && <span>Assigned: {contact.assignedWorker}</span>}
                {contact.mentor && <span>Mentor: {contact.mentor}</span>}
                {typeof contact.age === "number" && <span>{contact.age} yrs</span>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {contact.phone && (
                <a href={telLink(contact.phone)} title={`Call ${contact.phone}`}>
                  <Button variant="outline" size="sm"><Phone className="mr-1 h-3.5 w-3.5" /> Call</Button>
                </a>
              )}
              {contact.whatsapp && (
                <a href={waLink(contact.whatsapp, `Shalom ${contact.fullName}, this is the Gethsemane Youth Ministry.`)} target="_blank" rel="noreferrer" title="Open WhatsApp">
                  <Button variant="outline" size="sm"><MessageCircle className="mr-1 h-3.5 w-3.5" /> WhatsApp</Button>
                </a>
              )}
              {contact.phone && (
                <a href={smsLink(contact.phone, "Shalom, this is the Gethsemane Youth Ministry.")} title="Send SMS">
                  <Button variant="outline" size="sm"><MessageSquareText className="mr-1 h-3.5 w-3.5" /> SMS</Button>
                </a>
              )}
              <a
                href={mapsLink([contact.community, contact.homeAddress, contact.area].filter(Boolean).join(", ") || contact.gpsLocation)}
                target="_blank"
                rel="noreferrer"
                title="Open in Google Maps"
              >
                <Button variant="outline" size="sm"><MapPin className="mr-1 h-3.5 w-3.5" /> Directions</Button>
              </a>
              {canEdit && (
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                </Button>
              )}
              {contact.promotedToMemberId ? (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-[#4ade80]/40 bg-[#15291c] px-2.5 py-1 text-[11px] font-semibold text-[#86efac]">
                  <UserCheck className="h-3.5 w-3.5" /> Promoted to Member
                </span>
              ) : (
                canAdd && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={promoting}
                    onClick={async () => {
                      setPromoting(true);
                      try {
                        const res = await promote({ id: contact._id });
                        toast.success(
                          `${contact.fullName} promoted to member (${res.membershipId})`,
                        );
                      } catch (err) {
                        toast.error(
                          err instanceof Error ? err.message : "Promotion failed",
                        );
                      } finally {
                        setPromoting(false);
                      }
                    }}
                  >
                    <UserPlus className="mr-1 h-3.5 w-3.5" /> Promote to Member
                  </Button>
                )
              )}
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Recent milestones strip */}
        {lastEvents.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b px-5 py-2.5 text-[11px] text-muted-foreground">
            <span className="term-label">journey</span>
            {lastEvents.map((ev) => (
              <span key={ev._id} className="flex items-center gap-1 rounded-full border bg-accent/50 px-2 py-0.5">
                <span className="text-status-green">✓</span> {ev.label}
                <span className="text-muted-foreground/60">{fmtDate(ev.date)}</span>
              </span>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto px-3 pt-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-xs font-medium transition-colors",
                tab === t.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {tab === "overview" && <OverviewTab contact={contact} />}
          {tab === "timeline" && (
            <TimelineTab
              contact={contact}
              journeyEvents={journeyEvents}
              canEdit={!!canEdit}
            />
          )}
          {tab === "followups" && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <Button size="sm" onClick={() => setScheduleOpen(true)}>
                  <CalendarPlus className="mr-1.5 h-4 w-4" /> Schedule follow-up
                </Button>
              </div>
              {followUps.length === 0 ? (
                <EmptyState title="No follow-ups yet" message="Schedule a home visit, call or Bible study to begin the journey." />
              ) : (
                followUps.map((f) => (
                  <div key={f._id} className="rounded-lg border bg-card p-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{FOLLOWUP_TYPE_LABELS[f.type]}</span>
                      <StatusPill status={f.status} />
                      {f.locked && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Lock className="h-3 w-3" /> locked
                        </span>
                      )}
                      <span className="ml-auto text-[11px] text-muted-foreground">{fmtDate(f.date)}</span>
                    </div>
                    {f.assignedWorker && (
                      <p className="mt-1 text-[11px] text-muted-foreground">Worker: {f.assignedWorker}</p>
                    )}
                    {f.notes && <p className="mt-1 text-[12px] text-muted-foreground">{f.notes}</p>}
                    {(f.outcome || f.reasonMissed || f.reasonCancelled) && (
                      <p className="mt-2 rounded bg-muted/60 px-2 py-1.5 text-[11px] text-muted-foreground">
                        <b>{f.outcome ? "Outcome:" : f.reasonMissed ? "Reason missed:" : "Reason cancelled:"}</b>{" "}
                        {f.outcome ?? f.reasonMissed ?? f.reasonCancelled}
                      </p>
                    )}
                    {f.status === "pending" && canEdit && (
                      <div className="mt-2">
                        <Button size="sm" onClick={() => setChanging(f)}>
                          Update status
                        </Button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
          {tab === "bible" && <BibleStudiesTab contactId={contact._id} rows={bibleStudies} canEdit={!!canEdit} contactName={contact.fullName} />}
          {tab === "attendance" && <AttendanceTab contactId={contact._id} rows={attendance} canEdit={!!canEdit} />}
          {tab === "prayer" && <PrayerTab contactId={contact._id} rows={prayers} canEdit={!!canEdit} />}
          {tab === "notes" && <NotesTab contactId={contact._id} rows={visibleNotes} canEdit={!!canEdit} isAdmin={isAdmin} />}
        </div>
      </div>

      <ContactFormDialog open={editOpen} onOpenChange={setEditOpen} contact={contact} onSaved={() => setEditOpen(false)} />
      <ScheduleDialog open={scheduleOpen} onOpenChange={setScheduleOpen} presetContactId={contact._id} />
      <StatusChangeDialog followup={changing} open={!!changing} onOpenChange={(v) => !v && setChanging(null)} />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete contact?</DialogTitle>
            <DialogDescription>
              {contact.fullName} ({contact.membershipId}) and every record attached
              to them — timeline, follow-ups, Bible studies, attendance, prayers
              and notes — will be permanently removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                await remove({ id: contact._id });
                toast.success("Contact deleted");
                navigate("/contacts");
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Overview ----------
function Row({ label, value }: { label: string; value?: string | number | null }) {
  if (!value && value !== 0) return null;
  return (
    <div>
      <div className="term-label">{label}</div>
      <div className="mt-0.5 text-[13px]">{value}</div>
    </div>
  );
}

function OverviewTab({ contact }: { contact: any }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-3">
        <p className="term-label">// personal information</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Row label="Gender" value={contact.gender === "male" ? "Male" : contact.gender === "female" ? "Female" : contact.gender} />
          <Row label="Date of birth" value={contact.dateOfBirth ? fmtDate(contact.dateOfBirth) : undefined} />
          <Row label="Age (auto)" value={typeof contact.age === "number" ? `${contact.age} years` : undefined} />
          <Row label="Phone" value={contact.phone} />
          <Row label="WhatsApp" value={contact.whatsapp} />
          <Row label="Email" value={contact.email} />
          <div className="col-span-2">
            <Row label="Home address" value={[contact.homeAddress, contact.landmark, contact.gpsLocation].filter(Boolean).join(", ") || undefined} />
          </div>
          <Row label="Region" value={contact.region} />
          <Row label="District" value={contact.district} />
          <Row label="Community" value={contact.community} />
          <Row label="Occupation" value={contact.occupation} />
          <Row label="School" value={contact.school} />
          <Row label="Marital status" value={contact.maritalStatus} />
          <Row label="Emergency contact" value={contact.emergencyContact} />
          <Row label="Preferred language" value={contact.preferredLanguage} />
          <Row label="Religion" value={contact.religion} />
          <Row label="Church background" value={contact.churchBackground} />
        </div>
      </section>

      <div className="space-y-6">
        <section className="space-y-3">
          <p className="term-label">// outreach record</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Row label="Date met" value={contact.dateMet ? fmtDate(contact.dateMet) : undefined} />
            <Row label="Location" value={contact.locationMet} />
            <Row label="Area" value={contact.area} />
            <Row label="Evangelism team" value={contact.evangelismTeam} />
            <Row label="Class" value={contact.klass ? `${contact.klass} Class` : undefined} />
            <Row label="Street" value={contact.street} />
            <Row label="Event" value={contact.event} />
            <Row label="Interest" value={contact.interestLevel} />
            <div className="col-span-2">
              <Row label="Decision" value={contact.decision} />
            </div>
            <div className="col-span-2">
              <Row label="Conversation summary" value={contact.conversationSummary} />
            </div>
            <div className="col-span-2">
              <Row label="Questions asked" value={contact.questionsAsked} />
            </div>
            <div className="col-span-2">
              <Row label="Needs identified" value={contact.needsIdentified} />
            </div>
            <div className="col-span-2">
              <Row label="Bible verses shared" value={contact.bibleVersesShared} />
            </div>
            <div className="col-span-2 flex gap-4 text-[12px] text-muted-foreground">
              <span className={cn(contact.prayerOffered && "text-status-green")}>
                {contact.prayerOffered ? "✓ Prayer offered" : "○ Prayer not offered"}
              </span>
              <span className={cn(contact.gospelShared && "text-status-green")}>
                {contact.gospelShared ? "✓ Gospel shared" : "○ Gospel not shared"}
              </span>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <p className="term-label">// assignment</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Row label="Follow-up worker" value={contact.assignedWorker} />
            <Row label="Mentor" value={contact.mentor} />
            <Row label="Ministry" value={contact.ministry} />
            <Row label="Tags" value={contact.tags?.length ? contact.tags.join(", ") : undefined} />
          </div>
        </section>

      </div>
    </div>
  );
}

// ---------- Timeline ----------
function TimelineTab({
  contact,
  journeyEvents,
  canEdit,
}: {
  contact: any;
  journeyEvents: any[];
  canEdit: boolean;
}) {
  const setStage = useMutation(api.contacts.setStage);
  const addEvent = useMutation(api.contacts.addJourneyEvent);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [stage, setStageVal] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [customNote, setCustomNote] = useState("");

  const currentIdx = STAGE_ORDER.indexOf(contact.status ?? STAGES.REACHED);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <p className="term-label mb-4">// spiritual journey timeline</p>
        <div className="relative space-y-0">
          {STAGE_ORDER.map((s, i) => {
            const Icon = STAGE_ICONS[s];
            const reached = i <= currentIdx;
            const event = journeyEvents.filter((e) => e.stage === s)[journeyEvents.filter((e) => e.stage === s).length - 1];
            return (
              <div key={s} className="relative flex gap-3 pb-4">
                {i < STAGE_ORDER.length - 1 && (
                  <span className="absolute left-[13px] top-7 h-full w-px bg-border" />
                )}
                <div
                  className={cn(
                    "z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
                    reached ? "border-primary/40 bg-accent text-primary" : "border-border bg-card text-muted-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex items-center gap-2">
                    <span className={cn("text-[13px] font-semibold", !reached && "text-muted-foreground")}>
                      {reached ? "✓ " : ""}{STAGE_LABELS[s]}
                    </span>
                    {event && (
                      <span className="text-[10px] text-muted-foreground">{fmtDate(event.date)}</span>
                    )}
                  </div>
                  {event?.note && <p className="text-[11px] text-muted-foreground">{event.note}</p>}
                  {event?.worker && <p className="text-[10px] text-muted-foreground/70">by {event.worker}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-5">
        {canEdit && (
          <>
            <section className="rounded-lg border bg-card p-4">
              <p className="term-label mb-3">// update spiritual stage (manual)</p>
              <div className="space-y-3">
                <div>
                  <Label>Stage</Label>
                  <Select value={stage} onValueChange={setStageVal}>
                    <SelectTrigger className="mt-1 w-full">
                      <SelectValue placeholder="Select stage" />
                    </SelectTrigger>
                    <SelectContent>
                      {STAGE_ORDER.map((s) => (
                        <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Date</Label>
                  <Input type="date" className="mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div>
                  <Label>Note</Label>
                  <Textarea rows={2} className="mt-1" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Baptized at Sunday service" />
                </div>
                <Button
                  className="w-full"
                  disabled={!stage}
                  onClick={async () => {
                    await setStage({ id: contact._id, stage, date: new Date(date).toISOString(), note: note || undefined });
                    toast.success("Spiritual stage updated");
                    setNote("");
                  }}
                >
                  Update stage
                </Button>
              </div>
            </section>

            <section className="rounded-lg border bg-card p-4">
              <p className="term-label mb-3">// add timeline event</p>
              <div className="space-y-3">
                <div>
                  <Label>Event</Label>
                  <Input className="mt-1" value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder="Second Visit, Youth Camp..." />
                </div>
                <div>
                  <Label>Note</Label>
                  <Textarea rows={2} className="mt-1" value={customNote} onChange={(e) => setCustomNote(e.target.value)} />
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={!customLabel.trim()}
                  onClick={async () => {
                    await addEvent({
                      id: contact._id,
                      stage: contact.status ?? STAGES.REACHED,
                      label: customLabel.trim(),
                      note: customNote || undefined,
                      date: new Date(date).toISOString(),
                    });
                    toast.success("Event added to timeline");
                    setCustomLabel("");
                    setCustomNote("");
                  }}
                >
                  <Plus className="mr-1.5 h-4 w-4" /> Add event
                </Button>
              </div>
            </section>
          </>
        )}
        <p className="rounded-md border border-dashed px-3 py-2 text-[11px] text-muted-foreground">
          Timeline updates automatically when follow-ups are completed and Bible study lessons are
          marked done. Manual updates let leaders record milestones like baptisms, church membership
          and service.
        </p>
      </div>
    </div>
  );
}

// ---------- Bible Studies ----------
function BibleStudiesTab({
  contactId,
  rows,
  canEdit,
  contactName,
}: {
  contactId: string;
  rows: any[];
  canEdit: boolean;
  contactName: string;
}) {
  const updateBibleStudy = useMutation(api.discipleship.updateBibleStudy);
  const [editing, setEditing] = useState<any | null>(null);

  const completed = rows.filter((r) => r.status === "completed").length;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pct = Math.round((completed / BIBLE_LESSONS.length) * 100);

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex items-center justify-between text-[12px]">
          <span className="font-semibold">Discipleship progress — {completed}/{BIBLE_LESSONS.length} lessons</span>
          <span className="font-mono">{pct}%</span>
        </div>            <Progress value={pct} className="h-2" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {BIBLE_LESSONS.map((lesson, i) => {
          const row = rows[i];
          const status = row?.status ?? "notStarted";
          return (
            <div key={lesson} className="rounded-lg border bg-card p-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-bold",
                    status === "completed"
                      ? "border-[#86efac]/40 bg-[#15291c] text-[#86efac]"
                      : status === "inProgress"
                        ? "border-[#f59e0b]/40 bg-[#2e2408] text-[#fbbf24]"
                        : "border-border bg-muted text-muted-foreground",
                  )}>
                    {status === "completed" ? "✓" : i + 1}
                  </span>
                  <div>
                    <div className="text-[13px] font-semibold">{lesson}</div>
                    {row?.instructor && (
                      <div className="text-[10px] text-muted-foreground">Instructor: {row.instructor}</div>
                    )}
                  </div>
                </div>
                <StatusPill status={status} />
              </div>
              {row?.completedDate && (
                <p className="mt-2 text-[10px] text-muted-foreground">Completed {fmtDate(row.completedDate)}</p>
              )}
              {canEdit && (
                <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => setEditing({ lesson: i + 1, name: lesson, row })}>
                  {status === "completed" ? "View / edit record" : status === "inProgress" ? "Update progress" : "Start lesson"}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <BibleStudyDialog
        contactId={contactId}
        contactName={contactName}
        editing={editing}
        onClose={() => setEditing(null)}
        updateBibleStudy={updateBibleStudy}
      />
    </div>
  );
}

function BibleStudyDialog({
  contactId,
  contactName,
  editing,
  onClose,
  updateBibleStudy,
}: {
  contactId: string;
  contactName: string;
  editing: { lesson: number; name: string; row: any } | null;
  onClose: () => void;
  updateBibleStudy: any;
}) {
  const [status, setStatus] = useState("inProgress");
  const [instructor, setInstructor] = useState("");
  const [observations, setObservations] = useState("");
  const [scripture, setScripture] = useState("");
  const [questions, setQuestions] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editing) {
      setStatus(editing.row?.status ?? "inProgress");
      setInstructor(editing.row?.instructor ?? "");
      setObservations(editing.row?.instructorObservations ?? "");
      setScripture(editing.row?.scriptureUsed ?? "");
      setQuestions(editing.row?.questionsAskedByContact ?? "");
      setNotes(editing.row?.notes ?? "");
      setError(null);
    }
  }, [editing]);

  if (!editing) return null;

  const submit = async () => {
    if (status === "completed" && !observations.trim()) {
      setError("Instructor observations are required to complete the lesson");
      return;
    }
    if (status === "completed" && !scripture.trim()) {
      setError("Scripture used is required to complete the lesson");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateBibleStudy({
        contactId,
        lesson: editing.lesson,
        status,
        instructor: instructor || undefined,
        instructorObservations: observations || undefined,
        scriptureUsed: scripture || undefined,
        questionsAskedByContact: questions || undefined,
        notes: notes || undefined,
      });
      toast.success(status === "completed" ? `Lesson ${editing.lesson} completed` : "Bible study updated");
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Bible Study — Lesson {editing.lesson}: {editing.name}</DialogTitle>
          <DialogDescription>
            Tied to {contactName}'s discipleship record.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="mt-1 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="notStarted">Not started</SelectItem>
                <SelectItem value="inProgress">In progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="bs-instructor">Instructor</Label>
            <Input id="bs-instructor" className="mt-1" value={instructor} onChange={(e) => setInstructor(e.target.value)} placeholder="Brother Daniel" />
          </div>
          {status === "completed" && (
            <>
              <div>
                <Label htmlFor="bs-obs">
                  Instructor observations (interest, understanding) <span className="text-destructive">*</span>
                </Label>
                <Textarea id="bs-obs" rows={2} className="mt-1" value={observations} onChange={(e) => setObservations(e.target.value)} placeholder="Very interested; understood the core message..." />
              </div>
              <div>
                <Label htmlFor="bs-scripture">
                  Scripture used <span className="text-destructive">*</span>
                </Label>
                <Input id="bs-scripture" className="mt-1" value={scripture} onChange={(e) => setScripture(e.target.value)} placeholder="John 3:1-21, Ephesians 2:8-9" />
              </div>
              <div>
                <Label htmlFor="bs-questions">Questions asked by the contact</Label>
                <Textarea id="bs-questions" rows={2} className="mt-1" value={questions} onChange={(e) => setQuestions(e.target.value)} />
              </div>
            </>
          )}
          <div>
            <Label htmlFor="bs-notes">Notes</Label>
            <Textarea id="bs-notes" rows={2} className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Saving..." : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Attendance ----------
function AttendanceTab({
  contactId,
  rows,
  canEdit,
}: {
  contactId: string;
  rows: any[];
  canEdit: boolean;
}) {
  const setAttendance = useMutation(api.discipleship.setAttendance);
  const me = useQuery(api.users.currentUser);
  const [type, setType] = useState<string>(ATTENDANCE_TYPES.YOUTH_MEETING);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState("present");
  const [program, setProgram] = useState("");
  const [remarks, setRemarks] = useState("");
  const [recordedBy, setRecordedBy] = useState(me?.name || me?.email || "");

  const counts = {
    present: rows.filter((r) => r.status === "present").length,
    total: rows.length,
  };

  return (
    <div className="space-y-4">
      {canEdit && (
        <form
          className="rounded-lg border bg-card p-3.5"
          onSubmit={async (e) => {
            e.preventDefault();
            await setAttendance({
              subjectType: "contact",
              contactId: contactId as any,
              date: new Date(date).toISOString(),
              type: type as any,
              programName: program.trim() || undefined,
              status: status as any,
              remarks: remarks.trim() || undefined,
              recordedBy: recordedBy.trim() || me?.name || undefined,
            });
            toast.success("Attendance recorded");
            setRemarks("");
          }}
        >
          <p className="term-label mb-3">// record attendance</p>
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
                <Input className="mt-1 w-48" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Brought a friend…" />
              </div>
              <div>
                <Label>Recorded by</Label>
                <Input className="mt-1 w-40" value={recordedBy} onChange={(e) => setRecordedBy(e.target.value)} placeholder="Your name" />
              </div>
              <Button type="submit" size="sm" className="shrink-0">Record</Button>
            </div>
          </div>
        </form>
      )}

      <div className="flex gap-4 text-[12px] text-muted-foreground">
        <span>Attendance: <b className="text-status-green">{counts.present} present</b></span>
        <span>Total records: <b>{counts.total}</b></span>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No attendance records" message="Record attendance for services, youth meetings and programs." />
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
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id} className="border-t">
                  <td className="px-3 py-2">{fmtDate(r.date)}</td>
                  <td className="px-3 py-2">{ATTENDANCE_TYPE_LABELS[r.type]}</td>
                  <td className="px-3 py-2">{r.programName || "—"}</td>
                  <td className="px-3 py-2"><StatusPill status={r.status} /></td>
                  <td className="px-3 py-2">{r.recordedBy || "—"}</td>
                  <td className="px-3 py-2">{r.remarks || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------- Prayer ----------
function PrayerTab({
  contactId,
  rows,
  canEdit,
}: {
  contactId: string;
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
    <div className="space-y-4">
      {canEdit && (
        <form
          className="space-y-3 rounded-lg border bg-card p-3.5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim() || !summary.trim()) return;
            await addPrayer({ contactId: contactId as any, title: title.trim(), summary: summary.trim() });
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
                <HandHeart className="h-3.5 w-3.5 text-primary" />
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
              {canEdit && p.status === "active" && (
                <div className="mt-2 flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setAnswerFor(p)}>
                    Mark answered
                  </Button>
                  <Button variant="ghost" size="sm" onClick={async () => { await updateStatus({ id: p._id, status: "closed" }); toast.success("Prayer request closed"); }}>
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
            <Label htmlFor="pray-answer">
              How was it answered? <span className="text-destructive">*</span>
            </Label>
            <Textarea id="pray-answer" rows={3} className="mt-1" value={answer} onChange={(e) => setAnswer(e.target.value)} autoFocus />
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

// ---------- Notes ----------
function NotesTab({
  contactId,
  rows,
  canEdit,
  isAdmin,
}: {
  contactId: string;
  rows: any[];
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const addNote = useMutation(api.discipleship.addNote);
  const [type, setType] = useState<string>(NOTE_TYPES.MINISTRY);
  const [content, setContent] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);

  return (
    <div className="space-y-4">
      {canEdit && (
        <form
          className="space-y-3 rounded-lg border bg-card p-3.5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!content.trim()) return;
            await addNote({
              contactId: contactId as any,
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
        <EmptyState title="No notes" message="Leaders can add ministry, counselling and private notes." />
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
