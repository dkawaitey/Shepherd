/**
 * Time-trend analysis for a member's attendance.
 *
 * Everything here is a pure function over attendance records (the shape of a
 * `attendance` document's `date`/`status`/`type`), so the very same code runs on
 * the Convex backend that serves the members list and in the browser that draws
 * the member profile chart. Keeping one implementation means a member card and
 * their profile can never disagree about the shape of their attendance.
 *
 * A record's `date` is an ISO day (`YYYY-MM-DD`) or a full ISO timestamp, so we
 * bucket on the first seven characters (`YYYY-MM`).
 */

/** The slice of an attendance record a trend cares about. */
export type TrendRow = {
  date: string;
  status: string;
  type?: string;
  /** Time of day the person was marked, "HH:MM". */
  time?: string;
  /** When the record was entered (epoch ms) — the mark time for older rows. */
  createdAt?: number;
  /** Program / session name, which separates two sessions on the same day. */
  programName?: string;
};

/** One month of a member's attendance. */
export type TrendPoint = {
  /** `YYYY-MM`, the bucket key. */
  key: string;
  /** Short month label for the axis (e.g. "Sep"). */
  label: string;
  /** Records marked present in this month. */
  present: number;
  /** Every record in this month. */
  total: number;
  /** `present / total` as a whole percentage; 0 when the month has no records. */
  percentage: number;
};

export type TrendSummary = {
  /** Average rate across the months that actually have records. */
  average: number;
  /** Percentage-point change between the older and newer halves of the range. */
  delta: number;
  /**
   * Which way the member is moving. `none` is distinct from `steady`: it means
   * they were never present at all, which must never read as "holding steady".
   */
  direction: "up" | "down" | "steady" | "none";
  /** The strongest and weakest months with records (null when none). */
  best: TrendPoint | null;
  worst: TrendPoint | null;
};

const monthKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * The last `months` calendar months of attendance, oldest first. Months with no
 * records are kept (as empty points) so the axis stays honest about gaps rather
 * than hiding them.
 */
export function attendanceTrend(
  rows: TrendRow[],
  months = 6,
  now: Date = new Date(),
): TrendPoint[] {
  const buckets = new Map<string, { present: number; total: number }>();
  for (const row of rows) {
    const key = (row.date || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    const bucket = buckets.get(key) ?? { present: 0, total: 0 };
    bucket.total += 1;
    if (row.status === "present") bucket.present += 1;
    buckets.set(key, bucket);
  }

  const points: TrendPoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(d);
    const bucket = buckets.get(key) ?? { present: 0, total: 0 };
    points.push({
      key,
      label: d.toLocaleString("en", { month: "short" }),
      present: bucket.present,
      total: bucket.total,
      percentage:
        bucket.total === 0 ? 0 : Math.round((bucket.present / bucket.total) * 100),
    });
  }
  return points;
}

/** Granularity the "whole history" trend auto-selects for readability. */
export type TrendGranularity = "month" | "quarter" | "year";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Month index of a date — one integer that orders months across years. */
const monthIndex = (y: number, m: number) => y * 12 + m;

/** Bucket index of a month index, at the given granularity. */
const bucketIndex = (mi: number, g: TrendGranularity) =>
  g === "month" ? mi : g === "quarter" ? Math.floor(mi / 3) : Math.floor(mi / 12);

/** The first month of a bucket index, as a date. */
const bucketDate = (bi: number, g: TrendGranularity) =>
  g === "month"
    ? new Date(Math.floor(bi / 12), bi % 12, 1)
    : g === "quarter"
      ? new Date(Math.floor(bi / 4), (bi % 4) * 3, 1)
      : new Date(bi, 0, 1);

/** Key + label for the bucket a date falls into. */
function bucketOf(d: Date, g: TrendGranularity): { key: string; label: string } {
  const y = d.getFullYear();
  if (g === "year") return { key: `${y}`, label: `${y}` };
  const q = Math.floor(d.getMonth() / 3) + 1;
  if (g === "quarter") return { key: `${y}-Q${q}`, label: `Q${q} '${String(y).slice(2)}` };
  return {
    key: `${y}-${pad2(d.getMonth() + 1)}`,
    label: d.toLocaleString("en", { month: "short" }),
  };
}

/**
 * A member's whole recorded attendance history, oldest first.
 *
 * "Already recorded" is the operative word: this walks back to the member's very
 * first attendance record, so a trend is available the moment records exist —
 * even if the newest of them is months or years old. To stay readable the
 * granularity adapts: monthly while the history is short, quarterly once it
 * spans more than `maxBuckets` months, yearly beyond that, so the chart never
 * grows into an unreadable picket fence.
 */
export function attendanceTrendAll(
  rows: TrendRow[],
  maxBuckets = 24,
  now: Date = new Date(),
): { points: TrendPoint[]; granularity: TrendGranularity } {
  const keys = rows
    .map((r) => (r.date || "").slice(0, 7))
    .filter((k) => /^\d{4}-\d{2}$/.test(k))
    .sort();
  if (keys.length === 0) {
    return { points: attendanceTrend(rows, 6, now), granularity: "month" };
  }

  const [sy, sm] = keys[0]!.split("-").map(Number);
  const startMi = monthIndex(sy!, sm! - 1);
  const endMi = monthIndex(now.getFullYear(), now.getMonth());
  const span = endMi - startMi + 1;

  let granularity: TrendGranularity = "month";
  if (span > maxBuckets) {
    granularity = span / 3 <= maxBuckets ? "quarter" : "year";
  }

  const totals = new Map<string, { present: number; total: number }>();
  for (const row of rows) {
    const key = (row.date || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    const [y, m] = key.split("-").map(Number);
    const k = bucketOf(new Date(y!, m! - 1, 1), granularity).key;
    const bucket = totals.get(k) ?? { present: 0, total: 0 };
    bucket.total += 1;
    if (row.status === "present") bucket.present += 1;
    totals.set(k, bucket);
  }

  const points: TrendPoint[] = [];
  for (let bi = bucketIndex(startMi, granularity); bi <= bucketIndex(endMi, granularity); bi++) {
    const { key, label } = bucketOf(bucketDate(bi, granularity), granularity);
    const bucket = totals.get(key) ?? { present: 0, total: 0 };
    points.push({
      key,
      label,
      present: bucket.present,
      total: bucket.total,
      percentage:
        bucket.total === 0 ? 0 : Math.round((bucket.present / bucket.total) * 100),
    });
  }

  return { points: points.slice(-maxBuckets), granularity };
}

/**
 * Direction of travel across a trend.
 *
 * Comparing the newer half of the range against the older half smooths a single
 * bad week out of the verdict — one missed meeting shouldn't read as a decline.
 * Months without records are skipped so a quiet month isn't counted as 0%.
 */
export function trendSummary(points: TrendPoint[]): TrendSummary {
  const filled = points.filter((p) => p.total > 0);
  const average = filled.length
    ? Math.round(filled.reduce((sum, p) => sum + p.percentage, 0) / filled.length)
    : 0;

  let best: TrendPoint | null = null;
  let worst: TrendPoint | null = null;
  for (const p of filled) {
    if (!best || p.percentage > best.percentage) best = p;
    if (!worst || p.percentage < worst.percentage) worst = p;
  }

  // Never present in any recorded session — not a plateau, an absence. Calling
  // this "steady" would describe a member who never attends as stable.
  if (filled.length > 0 && filled.every((p) => p.percentage === 0)) {
    return { average: 0, delta: 0, direction: "none", best, worst };
  }

  let delta = 0;
  let direction: TrendSummary["direction"] = "steady";
  if (filled.length >= 2) {
    const mid = Math.ceil(filled.length / 2);
    const older = filled.slice(0, mid);
    const newer = filled.slice(mid);
    if (newer.length) {
      const avg = (xs: TrendPoint[]) =>
        xs.reduce((sum, p) => sum + p.percentage, 0) / xs.length;
      delta = Math.round(avg(newer) - avg(older));
      if (delta >= 5) direction = "up";
      else if (delta <= -5) direction = "down";
    }
  }

  return { average, delta, direction, best, worst };
}

/**
 * Consecutive present records counting back from the most recent one. Absences
 * and excused records both break the run, so the streak means "kept showing up".
 */
export function attendanceStreak(rows: TrendRow[]): number {
  const sorted = [...rows].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  let streak = 0;
  for (const row of sorted) {
    if (row.status !== "present") break;
    streak += 1;
  }
  return streak;
}

/** Attendance rate per activity type, strongest first. Drives the breakdown list. */
export function attendanceByType(
  rows: TrendRow[],
): { type: string; present: number; total: number; percentage: number }[] {
  const buckets = new Map<string, { present: number; total: number }>();
  for (const row of rows) {
    const type = row.type || "other";
    const bucket = buckets.get(type) ?? { present: 0, total: 0 };
    bucket.total += 1;
    if (row.status === "present") bucket.present += 1;
    buckets.set(type, bucket);
  }
  return [...buckets.entries()]
    .map(([type, b]) => ({
      type,
      present: b.present,
      total: b.total,
      percentage: b.total === 0 ? 0 : Math.round((b.present / b.total) * 100),
    }))
    .sort((a, b) => b.total - a.total);
}

// ================= Punctuality =================

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Minutes past midnight for an "HH:MM" string, or null when malformed. */
export function hhmmToMinutes(value: string | null | undefined): number | null {
  if (!value || !HHMM.test(value)) return null;
  const [h, m] = value.split(":").map(Number);
  return h! * 60 + m!;
}

/**
 * A ministry's official start time per activity, keyed by attendance type
 * (`youthMeeting` → `"09:00"`). Activities start at different times, so the
 * baseline each arrival is judged against has to come from the activity, not
 * from whoever happened to arrive first.
 */
export type SessionStartTimes = Record<string, string>;

/**
 * Read the stored `attendance_start_times` setting into a typed map.
 *
 * The setting is a JSON object; anything malformed or not a valid "HH:MM" is
 * dropped rather than thrown, so a bad value can never break the trend view.
 */
export function parseStartTimes(json: string | null | undefined): SessionStartTimes {
  if (!json) return {};
  try {
    const raw: unknown = JSON.parse(json);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: SessionStartTimes = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === "string" && HHMM.test(value)) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Minutes past midnight when a record was marked.
 *
 * An explicit `time` (what the recorder entered) wins. Older records predate
 * that field, so they fall back to the moment the record was *created* — which
 * is exactly when the person was marked, and so still meaningful. UTC is used
 * for that fallback so the Convex backend and the browser agree on the value.
 */
export function markedMinute(row: TrendRow): number | null {
  const explicit = hhmmToMinutes(row.time);
  if (explicit !== null) return explicit;
  if (typeof row.createdAt === "number" && row.createdAt > 0) {
    const d = new Date(row.createdAt);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
  return null;
}

/** A session is one date + activity + program name; two sessions can share a day. */
const sessionKey = (row: TrendRow) =>
  `${(row.date || "").slice(0, 10)}|${row.type ?? ""}|${(row.programName ?? "").trim()}`;

/**
 * When each session began, as minutes past midnight.
 *
 * A configured start time for the activity (Ministry Settings → session start
 * times) is the session's official beginning and wins outright — so a Sunday
 * service at 08:30 and a youth meeting at 09:00 are each measured against their
 * own start, and someone arriving early isn't mistaken for the baseline.
 *
 * With no configured time the session falls back to its first recorded arrival:
 * the earliest present mark for that date/activity/program. That keeps
 * punctuality meaningful before any times are set, and after a session is moved.
 */
export function sessionStarts(
  rows: TrendRow[],
  configured: SessionStartTimes = {},
): Map<string, number> {
  const starts = new Map<string, number>();
  for (const row of rows) {
    const key = sessionKey(row);
    const official = row.type ? hhmmToMinutes(configured[row.type]) : null;
    if (official !== null) {
      starts.set(key, official);
      continue;
    }
    if (starts.has(key)) continue;
    if (row.status !== "present") continue;
    const minute = markedMinute(row);
    if (minute === null) continue;
    starts.set(key, minute);
  }
  return starts;
}

export type PunctualityBand = "onTime" | "slightlyLate" | "late" | "veryLate";

export const PUNCTUALITY_LABELS: Record<PunctualityBand, string> = {
  onTime: "On time",
  slightlyLate: "A little late",
  late: "Late",
  veryLate: "Very late",
};

/**
 * Boundaries, in minutes after the session's start, between the bands.
 *
 * `PUNCTUAL_GRACE` is exported because the recording form warns with the same
 * threshold the analysis uses — so "it warned me" and "it counted as late"
 * can never disagree.
 */
export const PUNCTUAL_GRACE = 10;
const SLIGHTLY_LATE = 25;
const LATE = 45;

export type PunctualitySummary = {
  /** Present records with a mark time we could compare against a session. */
  timed: number;
  onTime: number;
  slightlyLate: number;
  late: number;
  veryLate: number;
  /** Mean minutes after the session began (0 = first to arrive). */
  averageDelay: number;
  /** The latest arrival observed, in minutes after that session began. */
  worstDelay: number;
  verdict: "punctual" | "mostlyPunctual" | "sometimesLate" | "oftenLate" | "unknown";
  /**
   * What the delays were measured against: the ministry's configured start
   * times, the sessions' first arrivals, both, or neither (nothing timed yet).
   */
  baseline: "configured" | "inferred" | "mixed" | "none";
};

const bandFor = (delay: number): PunctualityBand =>
  delay <= PUNCTUAL_GRACE
    ? "onTime"
    : delay <= SLIGHTLY_LATE
      ? "slightlyLate"
      : delay <= LATE
        ? "late"
        : "veryLate";

/**
 * How punctual a member is: each arrival measured against the session's first
 * arrival. Records without a usable time (and sessions with no earlier arrival
 * to compare to) are simply left out, and `timed` reports how many counted.
 */
export function punctualitySummary(
  rows: TrendRow[],
  starts: Map<string, number>,
  configured: SessionStartTimes = {},
): PunctualitySummary {
  const counts: Record<PunctualityBand, number> = {
    onTime: 0,
    slightlyLate: 0,
    late: 0,
    veryLate: 0,
  };
  let timed = 0;
  let delayTotal = 0;
  let worstDelay = 0;
  let fromConfigured = 0;
  let fromInferred = 0;

  for (const row of rows) {
    if (row.status !== "present") continue;
    const minute = markedMinute(row);
    if (minute === null) continue;
    const start = starts.get(sessionKey(row));
    if (start === undefined) continue;
    const delay = Math.max(0, minute - start);
    counts[bandFor(delay)] += 1;
    timed += 1;
    delayTotal += delay;
    if (delay > worstDelay) worstDelay = delay;
    if (row.type && hhmmToMinutes(configured[row.type]) !== null) fromConfigured += 1;
    else fromInferred += 1;
  }

  const averageDelay = timed === 0 ? 0 : Math.round(delayTotal / timed);
  let verdict: PunctualitySummary["verdict"] = "unknown";
  if (timed > 0) {
    const onTimeShare = counts.onTime / timed;
    const lateShare = (counts.late + counts.veryLate) / timed;
    verdict =
      onTimeShare >= 0.8
        ? "punctual"
        : lateShare >= 0.5
          ? "oftenLate"
          : onTimeShare >= 0.5
            ? "mostlyPunctual"
            : "sometimesLate";
  }

  const baseline: PunctualitySummary["baseline"] =
    timed === 0
      ? "none"
      : fromConfigured && fromInferred
        ? "mixed"
        : fromConfigured
          ? "configured"
          : "inferred";

  return { timed, ...counts, averageDelay, worstDelay, verdict, baseline };
}

/** One activity's punctuality, so a late habit can be traced to a service. */
export type ActivityPunctuality = PunctualitySummary & {
  /** The attendance type this row covers (`youthMeeting`, `bibleStudy`…). */
  type: string;
};

/**
 * Punctuality broken down by activity.
 *
 * Members are rarely uniformly late — someone who is early to the youth meeting
 * and late to Sunday service has a schedule problem, not a discipline one. Each
 * activity is measured against its own session starts (its configured start time,
 * or that session's first arrival), and activities where nothing was timed are
 * left out rather than reported as zero. Late-to-most first, so the activity to
 * talk about is at the top.
 */
export function punctualityByType(
  rows: TrendRow[],
  starts: Map<string, number>,
  configured: SessionStartTimes = {},
): ActivityPunctuality[] {
  const byType = new Map<string, TrendRow[]>();
  for (const row of rows) {
    const type = row.type || "other";
    const list = byType.get(type) ?? [];
    list.push(row);
    byType.set(type, list);
  }
  return [...byType.entries()]
    .map(([type, list]) => ({ type, ...punctualitySummary(list, starts, configured) }))
    .filter((t) => t.timed > 0)
    .sort((a, b) => b.averageDelay - a.averageDelay || b.timed - a.timed);
}

/**
 * How many members land in each punctuality verdict.
 *
 * Members with nothing timed are counted as `unknown` rather than dropped, so a
 * team summary can say how much of the team it is actually describing instead of
 * quietly reporting only the members who happen to have arrival times.
 */
export function punctualityVerdictCounts(
  summaries: { verdict: PunctualitySummary["verdict"] }[],
): Record<PunctualitySummary["verdict"], number> {
  const counts: Record<PunctualitySummary["verdict"], number> = {
    punctual: 0,
    mostlyPunctual: 0,
    sometimesLate: 0,
    oftenLate: 0,
    unknown: 0,
  };
  for (const s of summaries) counts[s.verdict] += 1;
  return counts;
}

/**
 * Whether a punctuality verdict should be flagged on the roster.
 *
 * Only the two late verdicts earn a highlight — "often late" louder than
 * "sometimes late". Punctual and unmeasured members stay plain, so the eye goes
 * straight to the members worth a conversation.
 */
export function lateLevel(
  verdict: PunctualitySummary["verdict"],
): "often" | "sometimes" | null {
  return verdict === "oftenLate"
    ? "often"
    : verdict === "sometimesLate"
      ? "sometimes"
      : null;
}

// ================= Combined attendance + punctuality =================

/** One month of punctuality: how many arrivals were timed, and how many were on time. */
export type PunctualityTrendPoint = {
  /** `YYYY-MM`, the bucket key. */
  key: string;
  /** Short month label for the axis (e.g. "Sep"). */
  label: string;
  /** Present arrivals we could time against a known session start. */
  timed: number;
  /** Of those, the ones that landed within the grace window. */
  onTime: number;
  /** Mean minutes after the session began across the timed arrivals. */
  averageDelay: number;
  /** `onTime / timed` as a whole percentage; 0 when nothing was timed. */
  onTimeRate: number;
};

/**
 * The last `months` calendar months of punctuality, oldest first.
 *
 * Mirrors `attendanceTrend`: the window is the last N calendar months and a
 * month with no timed arrivals is kept as a gap, so a quiet month is never drawn
 * as a collapse. Unlike the lifetime `punctualitySummary` snapshot this buckets
 * the arrivals, which is the whole point — it shows lateness *trending*, so a
 * slide can be caught while the member is still attending rather than after the
 * absences start.
 */
export function punctualityTrend(
  rows: TrendRow[],
  starts: Map<string, number>,
  configured: SessionStartTimes = {},
  months = 6,
  now: Date = new Date(),
): PunctualityTrendPoint[] {
  const byMonth = new Map<string, TrendRow[]>();
  for (const row of rows) {
    const key = (row.date || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    const list = byMonth.get(key) ?? [];
    list.push(row);
    byMonth.set(key, list);
  }

  const points: PunctualityTrendPoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(d);
    const summary = punctualitySummary(byMonth.get(key) ?? [], starts, configured);
    points.push({
      key,
      label: d.toLocaleString("en", { month: "short" }),
      timed: summary.timed,
      onTime: summary.onTime,
      averageDelay: summary.averageDelay,
      onTimeRate:
        summary.timed === 0
          ? 0
          : Math.round((summary.onTime / summary.timed) * 100),
    });
  }
  return points;
}

/**
 * Effective participation: the share of sessions a member *both* attended and
 * arrived on time for.
 *
 * Raw attendance credits someone who turns up late every week exactly as much
 * as someone who is there, ready, on time — so it can't rank a team by
 * faithfulness. Effective participation can: it is `present and on time ÷
 * sessions offered`, the single number the roster sorts and the digests report.
 *
 * Arrivals with no usable time (older records, or sessions with no start to
 * compare against) still count as sessions *offered*, but not towards the
 * numerator, and `timed` says how many arrivals could be judged — so the figure
 * never claims more precision than the records support.
 */
export type ParticipationSummary = {
  /** Sessions the member was expected at (every recorded session). */
  sessions: number;
  /** Sessions marked present. */
  present: number;
  /** Present arrivals that were timed and landed within the grace window. */
  effective: number;
  /** Present arrivals we could measure against a session start. */
  timed: number;
  /** `effective / sessions` as a whole percentage — the ranking number. */
  rate: number;
  /** `present / sessions`, the raw attendance rate, kept for comparison. */
  attendanceRate: number;
};

export function effectiveParticipation(
  rows: TrendRow[],
  starts: Map<string, number>,
  configured: SessionStartTimes = {},
): ParticipationSummary {
  const sessions = rows.length;
  let present = 0;
  let effective = 0;
  let timed = 0;
  for (const row of rows) {
    if (row.status !== "present") continue;
    present += 1;
    const minute = markedMinute(row);
    if (minute === null) continue;
    const start = starts.get(sessionKey(row));
    if (start === undefined) continue;
    timed += 1;
    if (Math.max(0, minute - start) <= PUNCTUAL_GRACE) effective += 1;
  }
  return {
    sessions,
    present,
    effective,
    timed,
    rate: sessions === 0 ? 0 : Math.round((effective / sessions) * 100),
    attendanceRate: sessions === 0 ? 0 : Math.round((present / sessions) * 100),
  };
}

/** How serious a drift flag is. `watch` is a nudge, `atRisk` wants a follow-up. */
export type DriftLevel = "none" | "watch" | "atRisk";

export type DriftAssessment = {
  level: DriftLevel;
  /** Why the flag was raised, strongest first. */
  reasons: string[];
  /** A ready-to-use follow-up reason, prefilled into the follow-up dialog. */
  suggestedReason: string;
};

/**
 * The drifting / at-risk flag.
 *
 * Lateness is a *leading* indicator: a member who is still turning up but
 * arriving later each week is roughly a month ahead of the absence that follows,
 * and far easier to reach now. So a member is flagged when their attendance is
 * falling **and** their lateness is rising (either the mean arrival is later
 * than earlier months, or their lifetime verdict is "often late"). Attendance
 * falling on its own is only a `watch` — sometimes a spell away is excused and
 * the rate alone can't tell.
 */
export function driftRisk(input: {
  /** The member's monthly attendance trend summary. */
  attendance: TrendSummary;
  /** The member's monthly punctuality, oldest first. */
  punctuality: PunctualityTrendPoint[];
  /** The member's lifetime punctuality verdict. */
  verdict: PunctualitySummary["verdict"];
}): DriftAssessment {
  const { attendance, punctuality, verdict } = input;
  const reasons: string[] = [];

  const attendanceFalling = attendance.direction === "down";
  if (attendanceFalling) {
    reasons.push(`attendance down ${Math.abs(attendance.delta)} pts vs earlier months`);
  }

  // Lateness is "rising" when the newer half of the timed months averages a
  // meaningfully later arrival than the older half. Comparing halves smooths a
  // single late morning out; only the trend counts.
  const timed = punctuality.filter((p) => p.timed > 0);
  let delayDelta = 0;
  let delayRising = false;
  if (timed.length >= 2) {
    const mid = Math.ceil(timed.length / 2);
    const avg = (xs: PunctualityTrendPoint[]) =>
      xs.reduce((n, p) => n + p.averageDelay, 0) / xs.length;
    delayDelta = Math.round(avg(timed.slice(mid)) - avg(timed.slice(0, mid)));
    if (delayDelta >= 5) delayRising = true;
  }
  const oftenLate = lateLevel(verdict) === "often";
  if (delayRising) reasons.push(`arrivals ${delayDelta} min later than earlier months`);
  else if (oftenLate) reasons.push("often late to sessions");

  let level: DriftLevel = "none";
  if (attendanceFalling && (delayRising || oftenLate)) level = "atRisk";
  else if (attendanceFalling || delayRising || oftenLate) level = "watch";

  const suggestedReason =
    level === "none"
      ? ""
      : level === "atRisk"
        ? "Attendance and punctuality are both slipping — a check-in is needed"
        : attendanceFalling
          ? "Attendance has been declining recently"
          : "Arriving later than usual — a schedule check-in";

  return { level, reasons, suggestedReason };
}

/** The four quadrants of the combined attendance × punctuality view. */
export type QuadrantKey = "faithful" | "drifting" | "committed" | "disengaging";

/** Attendance share at or above which a member counts as attending. */
export const PARTICIPATION_HIGH = 60;
/** On-time share at or above which a member counts as punctual. */
export const PUNCTUALITY_HIGH = 60;

/**
 * What each quadrant means for ministry action, in one line.
 *
 * Shared by the analytics view and the digests so the same member reads the same
 * way wherever a leader meets them.
 */
export const QUADRANT_META: Record<QuadrantKey, { label: string; guidance: string }> = {
  faithful: {
    label: "Faithful & punctual",
    guidance: "Attends and arrives on time — disciple them and give responsibility.",
  },
  drifting: {
    label: "Present but drifting",
    guidance: "Attends but increasingly late — coach the schedule before it becomes absence.",
  },
  committed: {
    label: "Committed, often absent",
    guidance: "Punctual when present but missing sessions — a pastoral visit.",
  },
  disengaging: {
    label: "Disengaging",
    guidance: "Low attendance and late — priority outreach.",
  },
};

/**
 * Place a member in the combined quadrant, or `null` when nothing is timed.
 *
 * A member with no arrival times at all cannot be placed on the punctuality axis,
 * and guessing would put them in the wrong half of the grid — so they are
 * reported as unmeasured instead.
 */
export function classifyQuadrant(
  attendanceRate: number,
  onTimeRate: number | null,
): QuadrantKey | null {
  if (onTimeRate === null) return null;
  const attending = attendanceRate >= PARTICIPATION_HIGH;
  const punctual = onTimeRate >= PUNCTUALITY_HIGH;
  if (attending) return punctual ? "faithful" : "drifting";
  return punctual ? "committed" : "disengaging";
}

/**
 * Count how a group splits across the quadrants, plus how many members could not
 * be placed because nothing was timed — so a quadrant view always states how much
 * of the group it describes.
 */
export function quadrantCounts(
  entries: { attendanceRate: number; onTimeRate: number | null }[],
): { counts: Record<QuadrantKey, number>; unmeasured: number } {
  const counts: Record<QuadrantKey, number> = {
    faithful: 0,
    drifting: 0,
    committed: 0,
    disengaging: 0,
  };
  let unmeasured = 0;
  for (const e of entries) {
    const key = classifyQuadrant(e.attendanceRate, e.onTimeRate);
    if (key === null) unmeasured += 1;
    else counts[key] += 1;
  }
  return { counts, unmeasured };
}

/**
 * Everything the roster, profile, analytics and digests need about one member's
 * attendance at once.
 *
 * One call instead of four keeps every surface — and the backend that feeds the
 * emails — reading from the same arithmetic, so a member can never look more
 * punctual in the digest than on their profile.
 */
export type ParticipationInsight = {
  participation: ParticipationSummary;
  punctuality: PunctualitySummary;
  punctualityTrend: PunctualityTrendPoint[];
  attendanceTrend: TrendPoint[];
  drift: DriftAssessment;
  /** The combined quadrant, or `null` when nothing is timed. */
  quadrant: QuadrantKey | null;
};

export function participationInsight(
  rows: TrendRow[],
  starts: Map<string, number>,
  configured: SessionStartTimes = {},
  months = 6,
  now: Date = new Date(),
): ParticipationInsight {
  const participation = effectiveParticipation(rows, starts, configured);
  const punctuality = punctualitySummary(rows, starts, configured);
  const punctualityTrendPoints = punctualityTrend(rows, starts, configured, months, now);
  const attendanceTrendPoints = attendanceTrend(rows, months, now);
  const onTimeRate =
    punctuality.timed === 0
      ? null
      : Math.round((punctuality.onTime / punctuality.timed) * 100);
  return {
    participation,
    punctuality,
    punctualityTrend: punctualityTrendPoints,
    attendanceTrend: attendanceTrendPoints,
    drift: driftRisk({
      attendance: trendSummary(attendanceTrendPoints),
      punctuality: punctualityTrendPoints,
      verdict: punctuality.verdict,
    }),
    quadrant: classifyQuadrant(participation.attendanceRate, onTimeRate),
  };
}
