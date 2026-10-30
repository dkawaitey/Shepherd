import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  BIBLE_LESSONS,
  STAGE_ORDER,
  STAGE_LABELS,
} from "@/convex/constants";
import { Mark, PageHeader, fmtDate } from "@/components/shared";
import { cn } from "@/lib/utils";
import { ArrowRight, BookMarked, Sparkle } from "lucide-react";

export default function Discipleship() {
  const contacts = useQuery(api.contacts.list, {});
  const reports = useQuery(api.reports.overview, {});
  const events = useQuery(api.dashboard.journeyEventsAll);

  const byStage = STAGE_ORDER.map((s) => ({
    stage: s,
    label: STAGE_LABELS[s],
    count: (contacts ?? []).filter((c) => c.status === s).length,
  }));

  const bsCompletedByLesson = (reports?.bsByLesson ?? []).map((b) => ({
    ...b,
    pct: contacts?.length ? Math.round((b.completed / Math.max(1, contacts.length)) * 100) : 0,
  }));

  const recentEvents = (events ?? []).slice(-12).reverse();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Discipleship" code="disc" />

      {/* Stage distribution */}
      <div>
        <p className="term-label mb-3">// current stage distribution</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {byStage.map((s) => (
            <Link
              key={s.stage}
              to={`/contacts?status=${s.stage}`}
              className="group panel min-w-0 p-3 transition-colors hover:border-primary/50 hover:shadow-md"
            >
              <div className="truncate text-[9.5px] font-medium uppercase tracking-wide text-muted-foreground">
                {s.label}
              </div>
              <div className="mt-1 stat-figure text-[22px] text-primary">
                {s.count}
              </div>
              <div className="mt-1 inline-flex items-center gap-1 text-[9.5px] text-muted-foreground group-hover:text-primary">
                view people
                <ArrowRight className="h-2.5 w-2.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Bible study progress */}
        <div className="panel min-w-0 p-4">
          <div className="mb-4 flex items-center justify-between">
            <p className="term-label">// bible study curriculum</p>
            <BookMarked className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="space-y-2.5">
            {bsCompletedByLesson.map((b) => (
              <div key={b.lesson}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
                  <span className="min-w-0 truncate text-muted-foreground">
                    {b.lesson}. {BIBLE_LESSONS[b.lesson - 1]}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums">
                    {b.completed} done{b.inProgress ? ` · ${b.inProgress} in progress` : ""}
                  </span>
                </div>
                <Progress value={b.pct} className="h-2" />
              </div>
            ))}
          </div>
        </div>

        {/* Recent journey activity */}
        <div className="panel min-w-0 p-4">
          <div className="mb-4 flex items-center justify-between">
            <p className="term-label">// recent journey activity</p>
            <Sparkle className="h-4 w-4 text-muted-foreground" />
          </div>
          {recentEvents.length === 0 ? (
            <p className="py-8 text-center text-[11px] text-muted-foreground">
              Timeline events appear here as follow-ups complete and milestones are recorded.
            </p>
          ) : (
            <div className="space-y-2.5 sm:max-h-[420px] sm:overflow-y-auto sm:pr-1">
              {recentEvents.map((ev) => (
                <Link
                  key={ev._id}
                  to={`/contacts/${ev.contactId}`}
                  className="flex items-start gap-2.5 rounded-md border border-transparent p-2 transition-colors hover:border-primary/40 hover:bg-muted/40"
                >
                  <span
                    className={cn(
                      "mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[9px]",
                      ev.source === "auto"
                        ? "border-[#86efac]/40 bg-[#15291c] text-[#86efac]"
                        : "border-[#f59e0b]/40 bg-[#2e2408] text-[#fbbf24]",
                    )}
                  >
                    {ev.source === "auto" ? (
                      <Mark glyph="done" className="h-3 w-3" />
                    ) : (
                      <Mark glyph="manual" className="h-3 w-3" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-semibold">
                      {ev.label} <span className="font-normal text-muted-foreground">· {fmtDate(ev.date)}</span>
                    </span>
                    {ev.note && (
                      <span className="block truncate text-[10px] text-muted-foreground">{ev.note}</span>
                    )}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
