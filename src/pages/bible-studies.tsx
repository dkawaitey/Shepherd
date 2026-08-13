import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { BIBLE_LESSONS } from "@/convex/constants";
import { EmptyState, PageHeader, StatusPill, fmtDate } from "@/components/shared";
import { cn } from "@/lib/utils";
import { BookOpen } from "lucide-react";

export default function BibleStudies() {
  const contacts = useQuery(api.contacts.list, {});
  const [contactId, setContactId] = useState("");
  const bible = useQuery(api.discipleship.bibleStudiesForContact, contactId ? { contactId: contactId as any } : "skip");
  const [editing, setEditing] = useState<any | null>(null);

  const selectedContact = (contacts ?? []).find((c) => c._id === contactId);
  const completed = (bible ?? []).filter((b) => b.status === "completed").length;
  const pct = bible?.length ? Math.round((completed / bible.length) * 100) : 0;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Bible Studies" code="bs" />

      <div className="mb-5 max-w-md">
        <Label htmlFor="bs-contact">Select a contact</Label>
        <Select value={contactId} onValueChange={setContactId}>
          <SelectTrigger id="bs-contact" className="mt-1 w-full">
            <SelectValue placeholder="Choose a person in discipleship" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {(contacts ?? [])
              .filter((c) => c.status === "bibleStudy" || c.status === "acceptedChrist" || c.status === "followupStarted")
              .map((c) => (
                <SelectItem key={c._id} value={c._id}>
                  {c.fullName} · {c.membershipId}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <p className="mt-1 text-[10px] text-muted-foreground">
          {contactId ? "Tracking the curriculum for the selected person." : "Choose a person reached in discipleship to start tracking."}
        </p>
      </div>

      {!contactId ? (
        <EmptyState
          title="Select a contact"
          message="Pick a person from the list to see their lesson progress and record completions."
        />
      ) : bible === undefined ? (
        <div className="h-40 animate-pulse rounded-lg border bg-card" />
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Link to={`/contacts/${contactId}`} className="text-sm font-bold hover:text-primary hover:underline">
                  {selectedContact?.fullName}
                </Link>
                <span className="ml-2 text-[10px] text-muted-foreground">{selectedContact?.membershipId}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-muted-foreground">
                  {completed}/{BIBLE_LESSONS.length} lessons · <b className="font-mono">{pct}%</b>
                </span>
              </div>
            </div>
            <Progress value={pct} className="mt-3 h-2.5" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {bible.map((b) => {
              return (
                <div key={b.lesson} className="rounded-lg border bg-card p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-bold",
                          b.status === "completed"
                            ? "border-[#86efac]/40 bg-[#15291c] text-[#86efac]"
                            : b.status === "inProgress"
                              ? "border-[#f59e0b]/40 bg-[#2e2408] text-[#fbbf24]"
                              : "border-border bg-muted text-muted-foreground",
                        )}
                      >
                        {b.status === "completed" ? "✓" : b.lesson}
                      </span>
                      <div>
                        <div className="text-[13px] font-semibold">{b.name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {b.status === "completed" && b.completedDate
                            ? `Completed ${fmtDate(b.completedDate)}`
                            : b.instructor
                              ? `Instructor: ${b.instructor}`
                              : "Lesson not started"}
                        </div>
                      </div>
                    </div>
                    <StatusPill status={b.status} />
                  </div>
                  {b.instructorObservations && (
                    <p className="mt-2 rounded bg-muted/60 px-2 py-1.5 text-[11px] text-muted-foreground">
                      <b>Observations:</b> {b.instructorObservations}
                    </p>
                  )}
                  {b.scriptureUsed && (
                    <p className="mt-1 text-[10px] text-muted-foreground">📖 {b.scriptureUsed}</p>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2.5 w-full"
                    onClick={() => setEditing({ lesson: b.lesson, name: b.name, row: b })}
                  >
                    {b.status === "completed" ? "View / edit record" : "Record progress"}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <BibleStudyDialog contactId={contactId} editing={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function BibleStudyDialog({
  contactId,
  editing,
  onClose,
}: {
  contactId: string;
  editing: { lesson: number; name: string; row: any } | null;
  onClose: () => void;
}) {
  const updateBibleStudy = useMutation(api.discipleship.updateBibleStudy);
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
        contactId: contactId as any,
        lesson: editing.lesson,
        status: status as any,
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
          <DialogTitle>
            <BookOpen className="mr-1.5 inline h-4 w-4" /> Lesson {editing.lesson}: {editing.name}
          </DialogTitle>
          <DialogDescription>
            The completion record is tied to this contact's discipleship file.
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
                  Instructor observations — interest, understanding <span className="text-destructive">*</span>
                </Label>
                <Textarea id="bs-obs" rows={2} className="mt-1" value={observations} onChange={(e) => setObservations(e.target.value)} placeholder="Very engaged; asked great questions about grace..." />
              </div>
              <div>
                <Label htmlFor="bs-scripture">
                  Scripture used <span className="text-destructive">*</span>
                </Label>
                <Input id="bs-scripture" className="mt-1" value={scripture} onChange={(e) => setScripture(e.target.value)} placeholder="John 3:1-21" />
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

