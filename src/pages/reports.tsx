import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { BIBLE_LESSONS } from "@/convex/constants";
import { PageHeader, downloadCsv } from "@/components/shared";
import { cn } from "@/lib/utils";
import {
  Award,
  Baby,
  Download,
  Flame,
  HandHeart,
  Printer,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";

export default function Reports() {
  const today = new Date();
  const sixMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 5, 1);
  const [from, setFrom] = useState(sixMonthsAgo.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const report = useQuery(api.reports.overview, { from, to });

  const exportPeople = () => {
    if (!report) return;
    downloadCsv("shepherd-people-reached.csv", [
      { metric: "People reached", count: report.counts.reached },
      { metric: "Accepted Christ", count: report.counts.accepted },
      { metric: "Baptized", count: report.counts.baptized },
      { metric: "Follow-ups completed", count: report.counts.completed },
      { metric: "Follow-ups missed", count: report.counts.missed },
      { metric: "Follow-ups cancelled", count: report.counts.cancelled },
      { metric: "Active follow-ups", count: report.counts.pending },
      { metric: "Active prayer requests", count: report.counts.prayers },
      { metric: "Answered prayers", count: report.counts.answeredPrayers },
    ]);
  };

  const exportWorkers = () => {
    if (!report) return;
    downloadCsv(
      "shepherd-worker-activity.csv",
      report.workers.map((w) => ({
        worker: w.name,
        assigned: w.assigned,
        completed: w.completed,
        missed: w.missed,
        pending: w.pending,
      })),
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Reports"
        code="rpt"
        description="People reached, new converts, follow-up reports, bible study progress, attendance, volunteer activity and church integration."
        actions={
          <>
            <Button variant="outline" onClick={exportPeople} disabled={!report}>
              <Download className="mr-1.5 h-4 w-4" /> Export CSV
            </Button>
            <Button variant="outline" onClick={exportWorkers} disabled={!report}>
              <Download className="mr-1.5 h-4 w-4" /> Workers CSV
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-1.5 h-4 w-4" /> Print (PDF)
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
        <div>
          <Label htmlFor="r-from">From</Label>
          <Input id="r-from" type="date" className="mt-1" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="r-to">To</Label>
          <Input id="r-to" type="date" className="mt-1" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <span className="pb-2 text-[11px] text-muted-foreground">
          Report window: {from} → {to}
        </span>
      </div>

      {!report ? (
        <div className="h-64 animate-pulse rounded-lg border bg-card" />
      ) : (
        <>
          {/* Counts */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Users, label: "People Reached", value: report.counts.reached, color: "#9db392" },
              { icon: Target, label: "New Converts", value: report.counts.accepted, color: "#86b26f" },
              { icon: Baby, label: "Baptisms", value: report.counts.baptized, color: "#a8c49d" },
              { icon: HandHeart, label: "Answered Prayers", value: report.counts.answeredPrayers, color: "#c2d4a8" },
              { icon: Award, label: "Follow-ups Completed", value: report.counts.completed, color: "#86b26f" },
              { icon: XCircle, label: "Missed", value: report.counts.missed, color: "#f87171" },
              { icon: Flame, label: "Cancelled", value: report.counts.cancelled, color: "#fbbf24" },
              { icon: TrendingUp, label: "Active Follow-ups", value: report.counts.pending, color: "#fbbf24" },
            ].map((c) => (
              <div key={c.label} className="rounded-lg border bg-card p-4">
                <div className="flex items-center justify-between">
                  <span className="term-label">{c.label}</span>
                  <c.icon className="h-4 w-4" style={{ color: c.color }} />
                </div>
                <div className="mt-2 font-mono text-2xl font-bold tabular-nums" style={{ color: c.color }}>
                  {c.value}
                </div>
              </div>
            ))}
          </div>

          {/* Rates */}
          <div className="rounded-lg border bg-card p-4">
            <p className="term-label mb-4">// key rates</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { label: "Conversion rate", value: report.rates.conversionRate, icon: TrendingUp, note: "accepted Christ / all contacts" },
                { label: "Retention rate", value: report.rates.retention, icon: Users, note: "follow-ups completed / reached" },
                { label: "Response rate", value: report.rates.responseRate, icon: Award, note: "completed / (completed + missed)" },
                { label: "Drop-off rate", value: report.rates.dropOff, icon: TrendingDown, note: "100 − retention" },
                { label: "Avg time to baptism", value: report.rates.avgTimeToBaptismDays, icon: Baby, note: "days from first encounter", suffix: " days" },
                { label: "Attendance rate", value: report.rates.attendanceRate, icon: Users, note: "present / recorded" },
              ].map((r) => (
                <div key={r.label}>
                  <div className="mb-1 flex justify-between text-[11px]">
                    <span className="text-muted-foreground">{r.label}</span>
                    <span className="font-mono font-bold">
                      {r.value}
                      {r.suffix ?? "%"}
                    </span>
                  </div>
                  <Progress value={Math.min(100, r.value)} className="h-2" />
                  <p className="mt-1 text-[9px] text-muted-foreground">{r.note}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Monthly trend */}
          <div className="rounded-lg border bg-card p-4">
            <p className="term-label mb-4">// monthly trend (last 6 months)</p>
            <div className="grid grid-cols-6 gap-2">
              {report.monthly.map((m) => {
                const max = Math.max(1, ...report.monthly.map((x) => x.reached));
                return (
                  <div key={m.month} className="flex flex-col items-center gap-1">
                    <div className="flex h-32 w-full items-end justify-center gap-1">
                      <div className="w-2.5 rounded-t bg-[#8faf8a]" style={{ height: `${(m.reached / max) * 100}%` }} title={`reached: ${m.reached}`} />
                      <div className="w-2.5 rounded-t bg-[#86b26f]" style={{ height: `${(m.converts / max) * 100}%` }} title={`converts: ${m.converts}`} />
                      <div className="w-2.5 rounded-t bg-[#d9a441]" style={{ height: `${(m.baptisms / max) * 100}%` }} title={`baptisms: ${m.baptisms}`} />
                    </div>
                    <span className="text-[10px] font-semibold">{m.month}</span>
                    <div className="flex gap-1.5 text-[8px] text-muted-foreground">
                      <span>R:{m.reached}</span>
                      <span>C:{m.converts}</span>
                      <span>B:{m.baptisms}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex gap-4 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#8faf8a]" /> reached</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#86b26f]" /> converts</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#d9a441]" /> baptisms</span>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Worker productivity */}
            <div className="rounded-lg border bg-card p-4">
              <p className="term-label mb-3">// volunteer activity</p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="text-[9px] uppercase tracking-wide text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-1.5 pr-2">Worker</th>
                      <th className="py-1.5 pr-2">Assigned</th>
                      <th className="py-1.5 pr-2 text-[#86efac]">Done</th>
                      <th className="py-1.5 pr-2 text-[#f87171]">Missed</th>
                      <th className="py-1.5 text-[#fbbf24]">Pending</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.workers.map((w) => (
                      <tr key={w.name} className="border-b border-dashed">
                        <td className="py-1.5 pr-2 font-semibold">{w.name}</td>
                        <td className="py-1.5 pr-2 tabular-nums">{w.assigned}</td>
                        <td className="py-1.5 pr-2 tabular-nums text-[#86efac]">{w.completed}</td>
                        <td className="py-1.5 pr-2 tabular-nums text-[#f87171]">{w.missed}</td>
                        <td className="py-1.5 tabular-nums text-[#fbbf24]">{w.pending}</td>
                      </tr>
                    ))}
                    {report.workers.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-4 text-center text-muted-foreground">
                          No follow-ups assigned yet
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Bible study progress */}
            <div className="rounded-lg border bg-card p-4">
              <p className="term-label mb-3">// bible study progress</p>
              <div className="space-y-2">
                {report.bsByLesson.map((b) => (
                  <div key={b.lesson} className="flex items-center gap-2 text-[11px]">
                    <span className="w-5 text-right font-mono text-muted-foreground">{b.lesson}.</span>
                    <span className="w-36 truncate">{BIBLE_LESSONS[b.lesson - 1]}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-sm bg-muted">
                      <div
                        className="h-full bg-[#8faf8a]"
                        style={{ width: `${report.counts.reached ? (b.completed / Math.max(1, report.counts.reached)) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="w-20 text-right font-mono text-muted-foreground">
                      {b.completed} done
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 border-t pt-2">
                <p className="term-label mb-2">// class distribution</p>
                <div className="flex gap-3">
                  {report.classDist.map((c) => (
                    <span key={c.klass} className="rounded border bg-muted/50 px-2 py-1 text-[10px]">
                      {c.klass}: <b>{c.count}</b>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Funnel */}
          <div className="rounded-lg border bg-card p-4">
            <p className="term-label mb-3">// conversion funnel (all time)</p>
            <div className="space-y-2">
              {report.funnel.map((f, i) => (
                <div key={f.stage} className="flex items-center gap-3">
                  <span className="w-44 shrink-0 text-[11px] text-muted-foreground">
                    {i > 0 && <span className="mr-1 text-primary">↓</span>}
                    {f.label}
                  </span>
                  <div className="h-4 flex-1 overflow-hidden rounded-sm bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-sm",
                        i >= 4 ? "bg-[#86b26f]" : i >= 2 ? "bg-[#8faf8a]" : "bg-[#a8b98e]",
                      )}
                      style={{ width: `${Math.max(2, (f.count / Math.max(1, report.funnel[0]!.count)) * 100)}%` }}
                    />
                  </div>
                  <span className="w-12 text-right font-mono text-[11px] tabular-nums">{f.count}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
