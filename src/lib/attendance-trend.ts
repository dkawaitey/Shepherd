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
  /** Which way the member is moving. */
  direction: "up" | "down" | "steady";
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

  let best: TrendPoint | null = null;
  let worst: TrendPoint | null = null;
  for (const p of filled) {
    if (!best || p.percentage > best.percentage) best = p;
    if (!worst || p.percentage < worst.percentage) worst = p;
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
