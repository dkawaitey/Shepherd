import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared";
import { cn } from "@/lib/utils";
import {
  Award,
  Baby,
  Church,
  Clock,
  Flame,
  Gauge,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";

export default function Analytics() {
  const today = new Date();
  const [from, setFrom] = useState(
    new Date(today.getFullYear(), today.getMonth() - 5, 1).toISOString().slice(0, 10),
  );
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const report = useQuery(api.reports.overview, { from, to });

  if (!report) {
    return (
      <div className="mx-auto max-w-6xl">
        <PageHeader title="Analytics" code="anl" description="Deep-dive metrics on the discipleship pipeline." />
        <div className="h-64 animate-pulse rounded-lg border bg-card" />
      </div>
    );
  }

  const maxWorker = Math.max(1, ...report.workers.map((w) => w.assigned));
  const funnel = report.funnel;

  const metrics = [
    {
      icon: Gauge,
      label: "Response rate",
      value: `${report.rates.responseRate}%`,
      note: "Completed vs missed follow-ups — how reliable follow-up is.",
      tone: report.rates.responseRate >= 75 ? "text-[#86efac]" : report.rates.responseRate >= 50 ? "text-[#fbbf24]" : "text-[#f87171]",
    },
    {
      icon: TrendingUp,
      label: "Conversion rate",
      value: `${report.rates.conversionRate}%`,
      note: "Share of all contacts who have accepted Christ.",
      tone: "text-[#9db392]",
    },
    {
      icon: Users,
      label: "Retention rate",
      value: `${report.rates.retention}%`,
      note: "Follow-up completion relative to people reached.",
      tone: "text-[#9db392]",
    },
    {
      icon: TrendingDown,
      label: "Drop-off rate",
      value: `${report.rates.dropOff}%`,
      note: "Where people fall out of the journey — your biggest growth lever.",
      tone: report.rates.dropOff > 50 ? "text-[#f87171]" : "text-[#fbbf24]",
    },
    {
      icon: Clock,
      label: "Avg time to baptism",
      value: `${report.rates.avgTimeToBaptismDays} days`,
      note: "From first encounter to baptism service.",
      tone: "text-[#a8c49d]",
    },
    {
      icon: Church,
      label: "Church integration",
      value: `${report.counts.baptized}`,
      note: `Baptized members; ${report.funnel.find((f) => f.stage === "joinedChurch")?.count ?? 0} joined the church.`,
      tone: "text-[#bcd2b0]",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Analytics"
        code="anl"
        description="Average follow-up time, response and retention rates, productive teams, drop-offs, and volunteer performance."
      />

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
        <div>
          <Label>From</Label>
          <Input type="date" className="mt-1" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" className="mt-1" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2">
              <m.icon className="h-4 w-4 text-muted-foreground" />
              <span className="term-label">{m.label}</span>
            </div>
            <div className={cn("mt-2 font-mono text-3xl font-bold tabular-nums", m.tone)}>{m.value}</div>
            <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">{m.note}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Funnel drop-off */}
        <div className="rounded-lg border bg-card p-4">
          <p className="term-label mb-4">// funnel drop-off</p>
          <div className="space-y-3">
            {funnel.map((f, i) => {
              const prev = i > 0 ? funnel[i - 1]!.count : f.count;
              const drop = i === 0 ? 0 : Math.round(((prev - f.count) / Math.max(1, prev)) * 100);
              return (
                <div key={f.stage}>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">{f.label}</span>
                    <span className="font-mono tabular-nums">
                      {f.count}
                      {i > 0 && (
                        <span className={cn("ml-2", drop > 40 ? "text-[#f87171]" : "text-[#fbbf24]")}>
                          −{drop}%
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-4 overflow-hidden rounded-sm bg-muted">
                    <div
                      className="h-full rounded-sm bg-gradient-to-r from-[#a8b98e] to-[#9db392]"
                      style={{ width: `${Math.max(2, (f.count / Math.max(1, funnel[0]!.count)) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[10px] text-muted-foreground">
            Biggest drops point to where follow-up and discipleship effort should focus.
          </p>
        </div>

        {/* Volunteer performance */}
        <div className="rounded-lg border bg-card p-4">
          <p className="term-label mb-4">// volunteer performance</p>
          {report.workers.length === 0 ? (
            <p className="py-8 text-center text-[11px] text-muted-foreground">
              No follow-up activity yet in this window.
            </p>
          ) : (
            <div className="space-y-3">
              {report.workers.map((w) => {
                const completionRate = w.assigned ? Math.round((w.completed / w.assigned) * 100) : 0;
                return (
                  <div key={w.name}>
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="font-semibold">{w.name}</span>
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {w.completed}/{w.assigned} done · <b className={completionRate >= 75 ? "text-[#86efac]" : completionRate >= 40 ? "text-[#fbbf24]" : "text-[#f87171]"}>{completionRate}%</b>
                      </span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-sm bg-muted">
                      <div
                        className={cn("h-full rounded-sm", completionRate >= 75 ? "bg-[#86b26f]" : completionRate >= 40 ? "bg-[#d9a441]" : "bg-[#f87171]")}
                        style={{ width: `${(w.assigned / maxWorker) * 100}%` }}
                      />
                    </div>
                    {w.missed > 0 && (
                      <p className="mt-0.5 text-[9px] text-muted-foreground">
                        <Flame className="mr-0.5 inline h-2.5 w-2.5" /> {w.missed} missed
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Monthly conversion */}
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-4 flex items-center justify-between">
          <p className="term-label">// monthly reach & conversion</p>
          <Award className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="grid grid-cols-6 gap-2">
          {report.monthly.map((m) => {
            const max = Math.max(1, ...report.monthly.map((x) => x.reached));
            const conversion = m.reached ? Math.round((m.converts / m.reached) * 100) : 0;
            return (
              <div key={m.month} className="flex flex-col items-center gap-1">
                <div className="flex h-28 w-full items-end justify-center gap-1">
                  <div className="w-3 rounded-t bg-[#8faf8a]" style={{ height: `${(m.reached / max) * 100}%` }} />
                  <div className="w-3 rounded-t bg-[#86b26f]" style={{ height: `${(m.converts / max) * 100}%` }} />
                </div>
                <span className="text-[10px] font-semibold">{m.month}</span>
                <span className="text-[9px] text-muted-foreground">
                  <Baby className="mr-0.5 inline h-2 w-2" />{conversion}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
