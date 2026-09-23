import { useMemo, useState } from "react";
import {
  Activity,
  Clock,
  Flame,
  Minus,
  TrendingDown,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ATTENDANCE_TYPE_LABELS } from "@/convex/constants";
import { progressColor } from "@/components/shared";
import {
  attendanceByType,
  attendanceStreak,
  attendanceTrend,
  attendanceTrendAll,
  trendSummary,
  type PunctualitySummary,
  type TrendGranularity,
  type TrendPoint,
  type TrendRow,
  type TrendSummary,
} from "@/lib/attendance-trend";

/** The windows the panel can show. "all" walks the member's whole history. */
type TrendRange = 6 | 12 | "all";

const GRANULARITY_LABEL: Record<TrendGranularity, string> = {
  month: "monthly",
  quarter: "quarterly",
  year: "yearly",
};

/** Icon, wording and colours for a trend direction — shared by the panel and
 *  the per-member trends list so the same verdict always looks the same. */
export function trendDirectionMeta(direction: TrendSummary["direction"]) {
  return {
    up: {
      icon: TrendingUp,
      label: "Improving",
      cls: "border-status-green/40 bg-status-green/10 text-status-green",
    },
    down: {
      icon: TrendingDown,
      label: "Declining",
      cls: "border-status-red/40 bg-status-red/10 text-status-red",
    },
    steady: {
      icon: Minus,
      label: "Steady",
      cls: "border-border bg-muted/40 text-muted-foreground",
    },
    // Never present at all — deliberately not "steady", which would describe a
    // member who never attends as stable.
    none: {
      icon: TrendingDown,
      label: "Not attending",
      cls: "border-status-red/40 bg-status-red/10 text-status-red",
    },
  }[direction];
}

/** How a punctuality verdict reads, and how it is coloured. */
export const PUNCTUALITY_META: Record<
  PunctualitySummary["verdict"],
  { label: string; cls: string }
> = {
  punctual: { label: "Punctual", cls: "border-status-green/40 bg-status-green/10 text-status-green" },
  mostlyPunctual: { label: "Usually punctual", cls: "border-status-green/40 bg-status-green/10 text-status-green" },
  sometimesLate: { label: "Sometimes late", cls: "border-status-amber/40 bg-status-amber/10 text-status-amber" },
  oftenLate: { label: "Often late", cls: "border-status-red/40 bg-status-red/10 text-status-red" },
  unknown: { label: "Not enough times", cls: "border-border bg-muted/40 text-muted-foreground" },
};

/** The punctuality bands, weakest last, with the colour each is drawn in. */
const PUNCTUALITY_BANDS = [
  { key: "onTime", label: "On time", color: "#86efac" },
  { key: "slightlyLate", label: "A little late", color: "#fbbf24" },
  { key: "late", label: "Late", color: "#fb923c" },
  { key: "veryLate", label: "Very late", color: "#f87171" },
] as const;

/** Plain-language description of a mean arrival offset in minutes. */
function describeDelay(minutes: number) {
  if (minutes <= 1) return "the first to arrive";
  if (minutes <= 10) return `about ${minutes} min after the session began`;
  if (minutes < 60) return `${minutes} min after the session began`;
  return `${Math.round(minutes / 60)}h ${minutes % 60}m after the session began`;
}

/**
 * A member's attendance over time, as a verdict plus a month-by-month chart.
 *
 * The point of the panel is to answer "is this member's attendance improving or
 * slipping, and when did it change?" — which the raw history table and the
 * single overall percentage on the profile tab cannot. Records with no time
 * trend (a brand-new member, or one with nothing recorded) get an honest empty
 * state rather than a flat line at zero.
 */
export function AttendanceTrendPanel({
  rows,
  punctuality,
}: {
  rows: TrendRow[];
  punctuality?: PunctualitySummary | null;
}) {
  // Default to the member's full recorded history, so a trend appears for
  // attendance that was already on file long before this panel existed.
  const [range, setRange] = useState<TrendRange>("all");

  const { points, granularity } = useMemo(() => {
    if (range === "all") return attendanceTrendAll(rows, 24);
    return {
      points: attendanceTrend(rows, range),
      granularity: "month" as TrendGranularity,
    };
  }, [rows, range]);
  const summary = useMemo(() => trendSummary(points), [points]);
  const streak = useMemo(() => attendanceStreak(rows), [rows]);
  const byType = useMemo(() => attendanceByType(rows), [rows]);
  const withRecords = points.filter((p) => p.total > 0);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <p className="term-label">attendance trend</p>
        </div>
        <p className="py-6 text-center text-[11px] text-muted-foreground">
          No attendance recorded yet — a trend appears once this member has a few records.
        </p>
      </div>
    );
  }

  const verdict = trendDirectionMeta(summary.direction);
  const verdictDetail =
    summary.direction === "none"
      ? "never marked present in the recorded sessions"
      : summary.direction === "steady"
        ? withRecords.length >= 2
          ? "holding around the same rate"
          : "not enough history yet"
        : `${summary.direction === "up" ? "+" : ""}${summary.delta} pts vs earlier months`;
  const VerdictIcon = verdict.icon;
  const presentCount = rows.filter((r) => r.status === "present").length;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <p className="term-label">attendance trend</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
              verdict.cls,
            )}
          >
            <VerdictIcon className="h-3 w-3" />
            {verdict.label}
          </span>
          <div className="flex overflow-hidden rounded-md border">
            {([6, 12, "all"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={cn(
                  "px-2 py-0.5 text-[10px] font-medium transition-colors",
                  range === r
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {r === "all" ? "All" : `${r}M`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="mb-4 text-[10px] text-muted-foreground">
        {verdictDetail}
        {range === "all" && ` · ${GRANULARITY_LABEL[granularity]} view of the full record`}
      </p>

      {/* Monthly bars — height is the attendance rate, the bar's base width
          grows with how many records that month actually has. */}
      <div className="flex items-end gap-2 overflow-x-auto pb-1">
        {points.map((p) => {
          const color = p.total === 0 ? undefined : progressColor(p.percentage);
          return (
            <div
              key={p.key}
              className="flex min-w-0 flex-1 flex-col items-center gap-1"
              title={`${p.label}: ${p.percentage}% (${p.present}/${p.total} present)`}
            >
              <span className="font-mono text-[9px] tabular-nums text-muted-foreground">
                {p.total === 0 ? "—" : `${p.percentage}%`}
              </span>
              <div className="flex h-24 w-full items-end justify-center rounded bg-muted/40">
                {p.total > 0 ? (
                  <div
                    className="w-3/5 rounded-t-sm transition-all"
                    style={{
                      height: `${Math.max(4, p.percentage)}%`,
                      backgroundColor: color,
                    }}
                  />
                ) : (
                  <div className="h-px w-3/5 bg-border" />
                )}
              </div>
              <span
                className={cn(
                  "text-[9px]",
                  p.total === 0 ? "text-muted-foreground/50" : "text-muted-foreground",
                )}
              >
                {p.label}
              </span>
              <span className="font-mono text-[8px] tabular-nums text-muted-foreground/60">
                {p.present}/{p.total}
              </span>
            </div>
          );
        })}
      </div>

      {/* Summary stats */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <TrendStat label="Average" value={`${summary.average}%`} />
        <TrendStat
          label="Current streak"
          value={`${streak}`}
          hint={streak === 1 ? "present in a row" : "presents in a row"}
          icon={streak >= 3 ? Flame : undefined}
        />
        <TrendStat
          label="Best month"
          value={summary.best ? `${summary.best.percentage}%` : "—"}
          hint={summary.best?.label}
          icon={summary.best ? Trophy : undefined}
        />
        <TrendStat
          label="Weakest month"
          value={summary.worst ? `${summary.worst.percentage}%` : "—"}
          hint={summary.worst?.label}
        />
      </div>

      {/* Per-activity breakdown, so a dip can be traced to a particular service. */}
      {byType.length > 0 && (
        <div className="mt-4 border-t pt-3">
          <p className="term-label mb-2">by activity</p>
          <div className="space-y-1.5">
            {byType.map((t) => (
              <div key={t.type} className="flex items-center gap-2">
                <span className="w-28 shrink-0 truncate text-[10px] text-muted-foreground">
                  {ATTENDANCE_TYPE_LABELS[t.type] ?? t.type}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-sm bg-muted">
                  <div
                    className="h-full rounded-sm"
                    style={{
                      width: `${Math.max(2, t.percentage)}%`,
                      backgroundColor: progressColor(t.percentage),
                    }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right font-mono text-[9px] tabular-nums text-muted-foreground">
                  {t.present}/{t.total} · {t.percentage}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Punctuality — the time dimension, read from when each arrival was marked. */}
      {punctuality && (
        <div className="mt-4 border-t pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <p className="term-label">punctuality</p>
            </div>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                PUNCTUALITY_META[punctuality.verdict].cls,
              )}
            >
              {PUNCTUALITY_META[punctuality.verdict].label}
            </span>
          </div>
          {punctuality.timed === 0 ? (
            <p className="text-[10px] leading-4 text-muted-foreground">
              No arrival times to compare yet — recording the time each person is marked
              builds this.
            </p>
          ) : (
            <>
              <div className="flex h-3 overflow-hidden rounded-sm bg-muted">
                {PUNCTUALITY_BANDS.map((b) => {
                  const count = punctuality[b.key];
                  if (count === 0) return null;
                  return (
                    <div
                      key={b.key}
                      title={`${b.label}: ${count}`}
                      style={{
                        width: `${(count / punctuality.timed) * 100}%`,
                        backgroundColor: b.color,
                      }}
                    />
                  );
                })}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                {PUNCTUALITY_BANDS.map((b) => (
                  <span key={b.key} className="inline-flex items-center gap-1">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: b.color }}
                    />
                    {b.label}{" "}
                    <b className="font-mono tabular-nums text-foreground/80">
                      {punctuality[b.key]}
                    </b>
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                Typically {describeDelay(punctuality.averageDelay)} · {punctuality.timed} of{" "}
                {presentCount} arrivals timed
                {punctuality.worstDelay > 0
                  ? ` · latest was ${punctuality.worstDelay} min after the session began`
                  : ""}
                .
              </p>
            </>
          )}
        </div>
      )}

      <p className="mt-3 text-[9px] text-muted-foreground/70">
        Based on {rows.length} recorded attendance {rows.length === 1 ? "record" : "records"}
        {withRecords.length === 0
          ? "."
          : ` spanning ${withRecords[0]!.label} – ${withRecords[withRecords.length - 1]!.label}.`}{" "}
        Taller bars mean a higher share of sessions attended that {granularity}.
      </p>
    </div>
  );
}

function TrendStat({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: typeof Flame;
}) {
  return (
    <div className="rounded-md border bg-muted/30 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon className="h-2.5 w-2.5" />}
        {label}
      </div>
      <div className="mt-0.5 font-mono text-lg font-bold tabular-nums">{value}</div>
      {hint && <div className="text-[9px] text-muted-foreground/70">{hint}</div>}
    </div>
  );
}

/**
 * A tiny attendance sparkline for a member card — six months, no axis, no
 * labels. It only needs to say "this member is trending up / down" at a glance;
 * the member profile carries the full analysis.
 */
export function AttendanceSparkline({
  points,
  className,
}: {
  points: TrendPoint[];
  className?: string;
}) {
  const hasData = points.some((p) => p.total > 0);
  if (!hasData) return null;
  return (
    <span
      className={cn("inline-flex items-end gap-0.5", className)}
      title={points
        .filter((p) => p.total > 0)
        .map((p) => `${p.label} ${p.percentage}%`)
        .join(" · ")}
      aria-label="Attendance trend over the last six months"
    >
      {points.map((p) => (
        <span
          key={p.key}
          className="w-1 rounded-sm"
          style={{
            height: `${Math.max(2, (p.total === 0 ? 0 : p.percentage) / 100) * 14}px`,
            backgroundColor: p.total === 0 ? "var(--border)" : progressColor(p.percentage),
          }}
        />
      ))}
    </span>
  );
}
