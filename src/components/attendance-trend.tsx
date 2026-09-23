import { useMemo, useState } from "react";
import {
  Activity,
  Clock,
  Eye,
  Flame,
  Minus,
  Timer,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ATTENDANCE_TYPE_LABELS } from "@/convex/constants";
import { progressColor } from "@/components/shared";
import {
  attendanceByType,
  attendanceStreak,
  attendanceTrend,
  trendSummary,
  PARTICIPATION_HIGH,
  PUNCTUALITY_HIGH,
  QUADRANT_META,
  type ActivityPunctuality,
  type DriftAssessment,
  type DriftLevel,
  type ParticipationSummary,
  type PunctualitySummary,
  type PunctualityTrendPoint,
  type QuadrantKey,
  type TrendPoint,
  type TrendRow,
  type TrendSummary,
} from "@/lib/attendance-trend";

/** The windows the panel can show — capped at a year, so a reading always
 *  describes recent form rather than a lifetime's records. */
type TrendRange = 6 | 12;

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

/** Where the punctuality baseline came from, so a reader can trust the number. */
export const PUNCTUALITY_BASELINE_NOTE: Record<
  PunctualitySummary["baseline"],
  string
> = {
  configured: "Measured against the start time set for each activity.",
  inferred:
    "No start times set yet — measured against each session's first arrival.",
  mixed:
    "Measured against set start times where they exist, and first arrivals otherwise.",
  none: "",
};

/**
 * How the punctuality baseline is labelled in the UI.
 *
 * A punctuality figure is only as good as what it was measured against, so the
 * reader is told which one it was: the ministry's configured start times, the
 * sessions' first arrivals, or a mix of both.
 */
export const PUNCTUALITY_BASELINE_META: Record<
  PunctualitySummary["baseline"],
  { icon: typeof Clock | null; label: string; title: string }
> = {
  configured: {
    icon: Timer,
    label: "set start times",
    title: "Measured against the start time set for each activity",
  },
  inferred: {
    icon: Clock,
    label: "first arrival",
    title: "No start times set — measured against each session's first arrival",
  },
  mixed: {
    icon: Timer,
    label: "mixed baseline",
    title: "Set start times where they exist, first arrivals otherwise",
  },
  none: { icon: null, label: "", title: "" },
};

/**
 * A small pill naming the punctuality baseline.
 *
 * Rendered wherever a punctuality verdict is shown so the number is never read
 * as more precise than it is — deliberately neutral, since this is provenance,
 * not a score.
 */
export function PunctualityBaselinePill({
  baseline,
  className,
}: {
  baseline: PunctualitySummary["baseline"];
  className?: string;
}) {
  const meta = PUNCTUALITY_BASELINE_META[baseline];
  if (!meta.icon) return null;
  const Icon = meta.icon;
  return (
    <span
      title={meta.title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground",
        className,
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {meta.label}
    </span>
  );
}

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

/** One-line breakdown of an activity's punctuality, for a hover title. */
function punctualityTooltip(a: ActivityPunctuality): string {
  const label = ATTENDANCE_TYPE_LABELS[a.type] ?? a.type;
  return `${label}: ${a.onTime} on time, ${a.slightlyLate} a little late, ${a.late} late, ${a.veryLate} very late — ${a.timed} timed`;
}

/**
 * The verdicts shown in the team card, strongest habit first, then unmeasured.
 */
const TEAM_VERDICT_ORDER: PunctualitySummary["verdict"][] = [
  "punctual",
  "mostlyPunctual",
  "sometimesLate",
  "oftenLate",
  "unknown",
];

/**
 * The whole team's punctuality in one card.
 *
 * The roster answers "who is late?"; this answers "how are we doing?" — the
 * share of arrivals that landed on time, the average delay, and how the members
 * themselves split across the verdicts. That distinction matters: the same
 * average delay can mean two habitually late people or a whole ministry drifting
 * in together, and only the member spread tells them apart.
 *
 * Members with nothing timed are counted, not hidden, so a figure like "12 late"
 * can never be confused for "12 of 12" when the rest simply have no arrival
 * times recorded yet.
 */
export function TeamPunctualityCard({
  summary,
  verdictCounts,
  className,
}: {
  /** The team aggregate, computed over every member's records at once. */
  summary: PunctualitySummary;
  verdictCounts: Record<PunctualitySummary["verdict"], number>;
  className?: string;
}) {
  const measured = summary.timed;
  const onTimeRate = measured === 0 ? 0 : Math.round((summary.onTime / measured) * 100);
  const flagged = verdictCounts.oftenLate + verdictCounts.sometimesLate;
  const verdict = PUNCTUALITY_META[summary.verdict];

  return (
    <div className={cn("rounded-lg border bg-card p-4", className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Users className="h-4 w-4 text-primary" />
          <p className="term-label">team punctuality</p>
          {measured > 0 && <PunctualityBaselinePill baseline={summary.baseline} />}
        </div>
        {measured > 0 && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
              verdict.cls,
            )}
            title={`${onTimeRate}% of timed arrivals were on time`}
          >
            <Clock className="h-3 w-3" />
            {verdict.label}
          </span>
        )}
      </div>

      {measured === 0 ? (
        <p className="py-4 text-center text-[11px] text-muted-foreground">
          No arrival times recorded yet — the team's punctuality appears here once
          members are marked with the time they arrive.
        </p>
      ) : (
        <>
          {/* Where the team's arrivals land, band by band. */}
          <div className="flex h-3 overflow-hidden rounded-sm bg-muted">
            {PUNCTUALITY_BANDS.map((b) => {
              const count = summary[b.key];
              if (count === 0) return null;
              return (
                <div
                  key={b.key}
                  title={`${b.label}: ${count} arrival${count === 1 ? "" : "s"}`}
                  style={{
                    width: `${(count / measured) * 100}%`,
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
                  {summary[b.key]}
                </b>
              </span>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <TrendStat label="On time" value={`${onTimeRate}%`} hint="of timed arrivals" />
            <TrendStat
              label="Average arrival"
              value={summary.averageDelay === 0 ? "first" : `+${summary.averageDelay}m`}
              hint="after the session began"
              icon={summary.averageDelay === 0 ? Flame : undefined}
            />
            <TrendStat
              label="Arrivals timed"
              value={`${measured}`}
              hint="across the team"
            />
            <TrendStat
              label="Members late"
              value={`${flagged}`}
              hint="often or sometimes"
              icon={flagged > 0 ? TrendingDown : undefined}
            />
          </div>

          {/* How the members themselves split — one or two people, or a habit
              across the whole ministry. */}
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-dashed pt-3">
            {TEAM_VERDICT_ORDER.map((k) => {
              const count = verdictCounts[k];
              if (count === 0) return null;
              return (
                <span
                  key={k}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                    PUNCTUALITY_META[k].cls,
                  )}
                >
                  {PUNCTUALITY_META[k].label}
                  <b className="font-mono tabular-nums">{count}</b>
                </span>
              );
            })}
            {verdictCounts.unknown > 0 && (
              <span className="self-center text-[9px] text-muted-foreground/70">
                {verdictCounts.unknown} member{verdictCounts.unknown === 1 ? "" : "s"} still
                unmeasured
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** One class' punctuality reading, as returned by `members.classPunctuality`. */
export type ClassPunctualityRow = {
  klass: string;
  /** Members in the class. */
  members: number;
  /** Attendance records considered for the class. */
  records: number;
  /** Share of the class' records marked present. */
  rate: number;
  /** The class' arrivals measured against each session's start. */
  summary: PunctualitySummary;
  /** How the class' own members split across the verdicts. */
  verdictCounts: Record<PunctualitySummary["verdict"], number>;
};

/**
 * Punctuality per class, weakest first.
 *
 * The roster answers "who is late?" and the team card answers "how are we
 * doing?". This is the third question a leader asks — "which class is
 * drifting?" — so a lateness habit can be traced to a group and not only to an
 * individual. Every class with members is shown, unmeasured ones included: a
 * class nobody has timed is itself worth knowing, and hiding it would make the
 * table read as if it were fine.
 */
export function ClassPunctualityCard({
  rows,
  className,
}: {
  rows: ClassPunctualityRow[];
  className?: string;
}) {
  if (rows.length === 0) return null;
  const measuredClasses = rows.filter((r) => r.summary.timed > 0).length;
  const totalTimed = rows.reduce((n, r) => n + r.summary.timed, 0);

  return (
    <div className={cn("rounded-lg border bg-card", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <p className="term-label">class punctuality</p>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {totalTimed === 0
            ? "no arrival times recorded yet"
            : `${measuredClasses} of ${rows.length} classes measured · weakest first`}
        </span>
      </div>

      <div className="divide-y">
        {rows.map((row) => {
          const { klass, members, records, rate, summary, verdictCounts } = row;
          const onTimeRate =
            summary.timed === 0
              ? 0
              : Math.round((summary.onTime / summary.timed) * 100);
          const flagged = verdictCounts.oftenLate + verdictCounts.sometimesLate;
          const verdict = PUNCTUALITY_META[summary.verdict];
          return (
            <div
              key={klass}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5"
            >
              <div className="w-28 shrink-0">
                <div className="text-[12px] font-semibold">{klass} Class</div>
                <div className="text-[9px] text-muted-foreground">
                  {members} member{members === 1 ? "" : "s"} · {records} record
                  {records === 1 ? "" : "s"} · {rate}% present
                </div>
              </div>

              {summary.timed === 0 ? (
                <span className="flex-1 text-[10px] text-muted-foreground">
                  No arrival times to compare yet — record the time members are
                  marked to build this.
                </span>
              ) : (
                <div
                  className="flex h-3 min-w-24 flex-1 overflow-hidden rounded-sm bg-muted"
                  title={`${onTimeRate}% of ${summary.timed} timed arrivals were on time`}
                >
                  {PUNCTUALITY_BANDS.map((b) => {
                    const count = summary[b.key];
                    if (count === 0) return null;
                    return (
                      <div
                        key={b.key}
                        title={`${b.label}: ${count}`}
                        style={{
                          width: `${(count / summary.timed) * 100}%`,
                          backgroundColor: b.color,
                        }}
                      />
                    );
                  })}
                </div>
              )}

              {summary.timed > 0 && (
                <>
                  <span className="w-10 shrink-0 text-right font-mono text-[11px] font-semibold tabular-nums">
                    {onTimeRate}%
                  </span>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold",
                      verdict.cls,
                    )}
                    title={`Average ${summary.averageDelay} min after the session began · ${summary.timed} arrivals timed`}
                  >
                    <Clock className="h-2.5 w-2.5" />
                    {verdict.label}
                  </span>
                  <span className="w-20 shrink-0 text-right font-mono text-[9px] tabular-nums text-muted-foreground">
                    {summary.averageDelay === 0 ? "first" : `+${summary.averageDelay}m`} ·{" "}
                    {summary.timed}
                  </span>
                  <span
                    className="w-20 shrink-0 text-right text-[9px] text-muted-foreground"
                    title="Members often or sometimes late"
                  >
                    {flagged > 0 ? `${flagged} late` : "none late"}
                  </span>
                  <PunctualityBaselinePill baseline={summary.baseline} />
                </>
              )}
            </div>
          );
        })}
      </div>

      <p className="border-t px-4 py-2 text-[9px] text-muted-foreground/70">
        Each class is measured over its own members' arrivals, against the same
        session start times as the team reading above — so a class at the top of this
        list is the one to look at first.
      </p>
    </div>
  );
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
  punctualityByActivity,
  punctualityTrendPoints,
  drift,
  participation,
}: {
  rows: TrendRow[];
  punctuality?: PunctualitySummary | null;
  /** The same punctuality reading split per activity, strongest lateness first. */
  punctualityByActivity?: ActivityPunctuality[] | null;
  /** Punctuality month by month, oldest first — the leading half of the picture. */
  punctualityTrendPoints?: PunctualityTrendPoint[] | null;
  /** The drift / at-risk assessment for this member. */
  drift?: DriftAssessment | null;
  /** Effective participation — present *and* on time over sessions offered. */
  participation?: ParticipationSummary | null;
}) {
  // Default to the last year, so a trend appears for attendance that was
  // already on file long before this panel existed.
  const [range, setRange] = useState<TrendRange>(12);

  const points = useMemo(() => attendanceTrend(rows, range), [rows, range]);
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
            {([6, 12] as const).map((r) => (
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
                {`${r}M`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="mb-4 text-[10px] text-muted-foreground">{verdictDetail}</p>

      {/* Drift banner — the one flag that turns the two charts below into an
          action: attendance falling while arrivals get later. */}
      {drift && drift.level !== "none" && (
        <div
          className={cn(
            "mb-4 flex items-start gap-2 rounded-md border p-2.5 text-[11px]",
            DRIFT_META[drift.level].cls,
          )}
        >
          {(() => {
            const Icon = DRIFT_META[drift.level].icon;
            return <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />;
          })()}
          <div>
            <p className="font-semibold">
              {drift.level === "atRisk" ? "Drifting — worth a follow-up" : "Worth watching"}
            </p>
            <p className="mt-0.5 leading-5 opacity-90">
              {drift.reasons.join(" · ")}. Lateness leads absence, so catching this
              now is easier than catching the absence later.
            </p>
          </div>
        </div>
      )}

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

      {/* Punctuality month by month — the leading signal, drawn as a line so a
          downward slide is visible while the member is still attending. */}
      {punctualityTrendPoints && punctualityTrendPoints.some((p) => p.timed > 0) && (
        <div className="mt-4 border-t pt-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <p className="term-label">punctuality over time</p>
            </div>
            <span className="text-[9px] text-muted-foreground">
              share of timed arrivals on time
            </span>
          </div>
          <PunctualityTrendLine points={punctualityTrendPoints} />
        </div>
      )}

      {/* Summary stats */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <TrendStat
          label="Effective"
          value={`${participation ? participation.rate : summary.average}%`}
          hint={
            participation
              ? `${participation.effective}/${participation.sessions} present & on time`
              : "present & on time"
          }
        />
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
            <div className="flex flex-wrap items-center gap-1.5">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <p className="term-label">punctuality</p>
              <PunctualityBaselinePill baseline={punctuality.baseline} />
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
                {punctuality.baseline === "inferred"
                  ? ` ${PUNCTUALITY_BASELINE_NOTE.inferred}`
                  : ""}
              </p>

              {/* The same reading split per activity — someone early to the youth
                  meeting and late to Sunday service has a schedule problem. */}
              {punctualityByActivity && punctualityByActivity.length > 1 && (
                <div className="mt-3 space-y-1.5 border-t border-dashed pt-3">
                  {punctualityByActivity.map((a) => (
                    <div key={a.type} className="flex items-center gap-2">
                      <span className="w-28 shrink-0 truncate text-[10px] text-muted-foreground">
                        {ATTENDANCE_TYPE_LABELS[a.type] ?? a.type}
                      </span>
                      <div
                        className="flex h-2 flex-1 overflow-hidden rounded-sm bg-muted"
                        title={punctualityTooltip(a)}
                      >
                        {PUNCTUALITY_BANDS.map((b) => {
                          const count = a[b.key];
                          if (count === 0) return null;
                          return (
                            <div
                              key={b.key}
                              style={{
                                width: `${(count / a.timed) * 100}%`,
                                backgroundColor: b.color,
                              }}
                            />
                          );
                        })}
                      </div>
                      <span
                        className={cn(
                          "inline-flex w-24 shrink-0 items-center justify-end gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold",
                          PUNCTUALITY_META[a.verdict].cls,
                        )}
                      >
                        {PUNCTUALITY_META[a.verdict].label}
                      </span>
                      <span
                        className="w-20 shrink-0 text-right font-mono text-[9px] tabular-nums text-muted-foreground"
                        title="Average minutes after the session began · arrivals timed"
                      >
                        {a.averageDelay === 0 ? "first" : `+${a.averageDelay}m`} · {a.timed}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <p className="mt-3 text-[9px] text-muted-foreground/70">
        Based on {rows.length} recorded attendance {rows.length === 1 ? "record" : "records"}
        {withRecords.length === 0
          ? "."
          : ` spanning ${withRecords[0]!.label} – ${withRecords[withRecords.length - 1]!.label}.`}{" "}
        Taller bars mean a higher share of sessions attended that month.
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
/** Colour a trend line by its verdict, so an improving 40% still reads upward. */
const WAVE_TONE: Record<TrendSummary["direction"], string> = {
  up: "var(--status-green)",
  down: "var(--status-red)",
  steady: "var(--status-grey)",
  none: "var(--status-red)",
};

/**
 * Catmull-Rom through the points, emitted as cubic beziers — a smooth line.
 *
 * A polyline would read as a jagged chart; the roster wants a *shape*, and a
 * gentle curve makes a direction legible at 88px wide.
 */
function smoothPath(pts: { x: number; y: number }[]): string {
  let d = `M ${pts[0]!.x.toFixed(1)} ${pts[0]!.y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

/**
 * A member's attendance drawn as a smooth wavy line rather than bars.
 *
 * Six bars read as six separate numbers; a line reads as a direction, which is
 * the question the roster is actually asking ("who is slipping?"). Months with
 * no records are left as real gaps — the line breaks instead of dropping to
 * zero, so an unrecorded month is never mistaken for a collapse in attendance.
 * The colour follows the trend verdict, not just the average rate.
 */
export function AttendanceWaveline({
  points,
  direction,
  className,
}: {
  points: TrendPoint[];
  direction: TrendSummary["direction"];
  className?: string;
}) {
  const known = points.filter((p) => p.total > 0);
  if (known.length === 0) return null;

  const W = 88;
  const H = 26;
  const pad = 4;
  const lastIdx = Math.max(1, points.length - 1);
  const xOf = (i: number) => pad + (i / lastIdx) * (W - pad * 2);
  const yOf = (pct: number) => H - pad - (pct / 100) * (H - pad * 2);

  // Consecutive months with records become one continuous stroke; a break in
  // the records breaks the line.
  const segments: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  points.forEach((p, i) => {
    if (p.total === 0) {
      if (run.length) segments.push(run);
      run = [];
      return;
    }
    run.push({ x: xOf(i), y: yOf(p.percentage) });
  });
  if (run.length) segments.push(run);

  const stroke = WAVE_TONE[direction];
  const tail = segments[segments.length - 1]!;
  const last = tail[tail.length - 1]!;

  return (
    <span
      className={cn("inline-flex shrink-0", className)}
      title={points
        .filter((p) => p.total > 0)
        .map((p) => `${p.label} ${p.percentage}% (${p.present}/${p.total})`)
        .join(" · ")}
      aria-label="Attendance trend over the last six months"
    >
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
        {segments.map((seg, i) =>
          seg.length >= 2 ? (
            <g key={i}>
              <path
                d={`${smoothPath(seg)} L ${seg[seg.length - 1]!.x.toFixed(1)} ${H} L ${seg[0]!.x.toFixed(1)} ${H} Z`}
                style={{ fill: stroke, opacity: 0.12 }}
              />
              <path
                d={smoothPath(seg)}
                fill="none"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ stroke }}
              />
            </g>
          ) : (
            <circle key={i} cx={seg[0]!.x} cy={seg[0]!.y} r={1.6} style={{ fill: stroke }} />
          ),
        )}
        {/* The most recent month, marked so the eye lands on where it stands. */}
        <circle cx={last.x} cy={last.y} r={2.4} style={{ fill: stroke }} />
      </svg>
    </span>
  );
}

/**
 * How a drift assessment reads, and where on the urgency scale it sits.
 * `watch` is a nudge; `atRisk` is the one that earns a follow-up.
 */
export const DRIFT_META: Record<
  DriftLevel,
  { label: string; cls: string; icon: LucideIcon; title: string }
> = {
  none: {
    label: "Steady",
    cls: "border-border bg-muted/40 text-muted-foreground",
    icon: Minus,
    title: "Attendance and punctuality are holding.",
  },
  // Deliberately *not* a trend arrow: the drift badge sits beside the attendance
  // direction badge, and a second arrow there reads as the same measurement.
  // An eye and a warning triangle say "watch this person" instead.
  watch: {
    label: "Watch",
    cls: "border-status-amber/40 bg-status-amber/10 text-status-amber",
    icon: Eye,
    title: "One signal is slipping — worth a look.",
  },
  atRisk: {
    label: "Drifting",
    cls: "border-status-red/40 bg-status-red/10 text-status-red",
    icon: TriangleAlert,
    title: "Attendance is falling and lateness rising — reach out now.",
  },
};

/** Icon + colours for a combined-quadrant verdict, weakest last. */
export const QUADRANT_TONE: Record<
  QuadrantKey,
  { cls: string; rail: string }
> = {
  faithful: { cls: "text-status-green", rail: "bg-status-green" },
  committed: { cls: "text-status-amber", rail: "bg-status-amber" },
  drifting: { cls: "text-status-amber", rail: "bg-status-amber" },
  disengaging: { cls: "text-status-red", rail: "bg-status-red" },
};

/** The order the quadrants are presented in — act-first at the top. */
export const QUADRANT_ORDER: QuadrantKey[] = [
  "disengaging",
  "committed",
  "drifting",
  "faithful",
];

/**
 * A small pill naming how a member is drifting, so the roster can flag someone
 * without a paragraph of text.
 */
export function DriftPill({
  drift,
  className,
}: {
  drift: DriftAssessment;
  className?: string;
}) {
  if (drift.level === "none") return null;
  const meta = DRIFT_META[drift.level];
  const Icon = meta.icon;
  return (
    <span
      title={drift.reasons.length ? `Drifting: ${drift.reasons.join(" · ")}` : meta.title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold",
        meta.cls,
        className,
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {meta.label}
    </span>
  );
}

/**
 * A member's punctuality month by month, drawn as a line.
 *
 * The roster's attendance waveline answers "are they coming?"; this answers the
 * leading question underneath it — "and are they coming *on time*?". Months with
 * no timed arrivals are left as gaps, so a month nobody was timed for never
 * reads as a collapse in punctuality.
 */
export function PunctualityTrendLine({
  points,
  className,
}: {
  points: PunctualityTrendPoint[];
  className?: string;
}) {
  const known = points.filter((p) => p.timed > 0);
  if (known.length < 1) return null;

  const W = 320;
  const H = 56;
  const padX = 10;
  const padY = 8;
  const lastIdx = Math.max(1, points.length - 1);
  const xOf = (i: number) => padX + (i / lastIdx) * (W - padX * 2);
  const yOf = (rate: number) => H - padY - (rate / 100) * (H - padY * 2);

  const segments: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  points.forEach((p, i) => {
    if (p.timed === 0) {
      if (run.length) segments.push(run);
      run = [];
      return;
    }
    run.push({ x: xOf(i), y: yOf(p.onTimeRate) });
  });
  if (run.length) segments.push(run);

  const latest = known[known.length - 1]!;
  const stroke =
    latest.onTimeRate >= 80
      ? "var(--status-green)"
      : latest.onTimeRate >= 60
        ? "var(--status-amber)"
        : "var(--status-red)";

  return (
    <div className={cn("w-full", className)}>
      <svg
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        aria-label="Punctuality over the recent months"
      >
        {[0, 50, 100].map((g) => (
          <line
            key={g}
            x1={padX}
            x2={W - padX}
            y1={yOf(g)}
            y2={yOf(g)}
            strokeWidth={0.5}
            className="stroke-border"
            strokeDasharray={g === 0 ? undefined : "2 3"}
          />
        ))}
        {segments.map((seg, i) =>
          seg.length >= 2 ? (
            <path
              key={i}
              d={smoothPath(seg)}
              fill="none"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ stroke }}
            />
          ) : (
            <circle key={i} cx={seg[0]!.x} cy={seg[0]!.y} r={3} style={{ fill: stroke }} />
          ),
        )}
        {segments.map((seg) => (
          <circle
            key={seg[0]!.x}
            cx={seg[seg.length - 1]!.x}
            cy={seg[seg.length - 1]!.y}
            r={3}
            style={{ fill: stroke }}
          />
        ))}
      </svg>
      <div className="mt-1 flex justify-between gap-1">
        {points.map((p) => (
          <div key={p.key} className="flex min-w-0 flex-1 flex-col items-center">
            <span
              className={cn(
                "font-mono text-[9px] tabular-nums",
                p.timed === 0 ? "text-muted-foreground/50" : "text-foreground/80",
              )}
              title={
                p.timed === 0
                  ? "No timed arrivals this month"
                  : `${p.onTime} of ${p.timed} on time · average arrival +${p.averageDelay}m`
              }
            >
              {p.timed === 0 ? "—" : `${p.onTimeRate}%`}
            </span>
            <span
              className={cn(
                "text-[9px]",
                p.timed === 0 ? "text-muted-foreground/50" : "text-muted-foreground",
              )}
            >
              {p.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The combined attendance × punctuality quadrant for a group.
 *
 * This is the one view that turns the two metrics into a decision: who to
 * disciple, who to coach on schedule, who to visit, and who to go after. Members
 * with nothing timed are stated as unmeasured rather than guessed at.
 */
export function ParticipationQuadrantCard({
  counts,
  unmeasured,
  total,
  className,
}: {
  counts: Record<QuadrantKey, number>;
  unmeasured: number;
  total: number;
  className?: string;
}) {
  if (total === 0) return null;
  return (
    <div className={cn("rounded-lg border bg-card", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <p className="term-label">attendance × punctuality</p>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {unmeasured > 0
            ? `${total - unmeasured} of ${total} placed · ${unmeasured} unmeasured`
            : `all ${total} placed`}
        </span>
      </div>
      <div className="divide-y">
        {QUADRANT_ORDER.map((key) => {
          const meta = QUADRANT_META[key];
          const tone = QUADRANT_TONE[key];
          const count = counts[key];
          return (
            <div key={key} className="flex items-start gap-3 px-4 py-2.5">
              <span className={cn("mt-1 h-6 w-2 shrink-0 rounded-full", tone.rail)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={cn("text-[12px] font-semibold", tone.cls)}>{meta.label}</span>
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {count}
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{meta.guidance}</p>
              </div>
            </div>
          );
        })}
      </div>
      <p className="border-t px-4 py-2 text-[9px] text-muted-foreground/70">
        High attendance is ≥ {PARTICIPATION_HIGH}% of sessions; punctual is ≥{" "}
        {PUNCTUALITY_HIGH}% of timed arrivals on time. Lateness leads absence, so a
        move into "present but drifting" is the earliest warning there is.
      </p>
    </div>
  );
}
