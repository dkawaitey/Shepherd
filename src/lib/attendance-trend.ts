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

/** Boundaries, in minutes after the first arrival, between the bands. */
const PUNCTUAL_GRACE = 10;
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
