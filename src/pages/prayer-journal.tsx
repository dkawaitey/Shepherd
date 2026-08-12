import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import { PRAYER_STATUS } from "@/convex/constants";
import { EmptyState, PageHeader, StatusPill, fmtDateTime } from "@/components/shared";
import { cn } from "@/lib/utils";
import { HandHeart, Search } from "lucide-react";

export default function PrayerJournal() {
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [answerFor, setAnswerFor] = useState<any | null>(null);
  const [answer, setAnswer] = useState("");

  const prayers = useQuery(api.discipleship.prayerFeed, {
    status: status === "all" ? undefined : status,
    search: search || undefined,
  });
  const updateStatus = useMutation(api.discipleship.updatePrayerStatus);
  const me = useQuery(api.users.currentUser);
  const canEdit = me && me.role !== "leader";

  const counts = {
    active: (prayers ?? []).filter((p) => p.status === PRAYER_STATUS.ACTIVE).length,
    answered: (prayers ?? []).filter((p) => p.status === PRAYER_STATUS.ANSWERED).length,
    closed: (prayers ?? []).filter((p) => p.status === PRAYER_STATUS.CLOSED).length,
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Prayer Journal"
        code="pray"
        description="Every prayer request, answer and update across all the people you shepherd."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {[
          { label: "Active", value: counts.active, color: "#b45309", bg: "bg-[#FEF3C7]" },
          { label: "Answered", value: counts.answered, color: "#4d7c0f", bg: "bg-[#ECFCCB]" },
          { label: "Closed", value: counts.closed, color: "#6b7280", bg: "bg-[#F3F4F6]" },
        ].map((c) => (
          <button
            key={c.label}
            onClick={() => setStatus(c.label.toLowerCase())}
            className={cn("rounded-lg border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md", c.bg)}
          >
            <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: c.color }}>
              {c.label}
            </div>
            <div className="mt-1 font-mono text-2xl font-bold tabular-nums" style={{ color: c.color }}>
              {c.value}
            </div>
            <div className="text-[10px] text-muted-foreground" style={{ color: c.color }}>
              {status === c.label.toLowerCase() ? "✓ filtering" : "filter →"}
            </div>
          </button>
        ))}
      </div>

      <div className="mb-5 grid gap-2 sm:grid-cols-[1fr_220px]">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by contact or prayer..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active Prayer Requests</SelectItem>
            <SelectItem value="answered">Answered Prayers</SelectItem>
            <SelectItem value="closed">Closed Requests</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {prayers === undefined ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg border bg-card" />
          ))}
        </div>
      ) : prayers.length === 0 ? (
        <EmptyState
          title="No prayer requests"
          message="Add prayer requests from a contact's Prayer Journal tab — outreach prayer needs are captured automatically."
        />
      ) : (
        <div className="space-y-3">
          {prayers.map((p) => (
            <div key={p._id} className="rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <HandHeart className="h-4 w-4 text-primary" />
                <span className="text-[13px] font-bold">{p.title}</span>
                <StatusPill status={p.status} />
                <span className="ml-auto text-[10px] text-muted-foreground">
                  updated {fmtDateTime(new Date(p.updatedAt).toISOString())}
                </span>
              </div>
              <p className="mt-2 text-[12px] leading-5 text-muted-foreground">{p.summary}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t pt-2.5">
                <Link
                  to={`/contacts/${p.contactId}`}
                  className="text-[11px] font-semibold text-primary hover:underline"
                >
                  {p.contactName} →
                </Link>
                {p.answer && (
                  <span className="rounded bg-[#ECFCCB]/60 px-2 py-0.5 text-[10px] text-[#3F6212]">
                    ✓ {p.answer}
                  </span>
                )}
                {canEdit && p.status === PRAYER_STATUS.ACTIVE && (
                  <span className="ml-auto flex gap-2">
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
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!answerFor} onOpenChange={(v) => !v && setAnswerFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark prayer answered</DialogTitle>
            <DialogDescription>{answerFor?.title} — {answerFor?.contactName}</DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="pj-answer">
              How was it answered? <span className="text-destructive">*</span>
            </Label>
            <Textarea id="pj-answer" rows={3} className="mt-1" value={answer} onChange={(e) => setAnswer(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAnswerFor(null)}>Cancel</Button>
            <Button
              disabled={!answer.trim()}
              onClick={async () => {
                if (!answerFor) return;
                await updateStatus({ id: answerFor._id, status: PRAYER_STATUS.ANSWERED, answer });
                toast.success("Marked as answered — rejoice!");
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
