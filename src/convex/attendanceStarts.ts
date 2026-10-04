import { QueryCtx } from "./_generated/server";
import { parseStartTimes } from "../lib/attendance-trend";

/**
 * The effective start-time table every attendance reading uses.
 *
 * It is the ministry's configured per-activity start times (Ministry Settings)
 * overridden by any custom per-session start time, keyed
 * `YYYY-MM-DD|type|program`. Merging both into the one map the analysis already
 * reads means the roster, the profile, the reports and the digests all judge an
 * arrival against the same baseline.
 *
 * Custom session starts live in their own table, so reading them here never
 * touches — and can never rewrite — the recorded attendance rows.
 */
export async function effectiveStartTimes(
  ctx: QueryCtx,
): Promise<Record<string, string>> {
  const [row, sessions] = await Promise.all([
    ctx.db
      .query("settings")
      .withIndex("key", (q) => q.eq("key", "attendance_start_times"))
      .first(),
    ctx.db.query("attendanceSessionStarts").collect(),
  ]);
  const merged = parseStartTimes(row?.value);
  for (const s of sessions) merged[s.sessionKey] = s.start;
  return merged;
}
