import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireAdmin } from "./helpers";

/**
 * Every table the ministry's own data lives in, in the order an export reads
 * them: people first, then their records, then shared content and logs.
 *
 * Deliberately absent:
 *  - the auth tables (password and session material, nothing to do with the
 *    ministry's records),
 *  - `pushSubscriptions` (device endpoints and encryption keys — secrets, not
 *    data anyone can read back out of an export),
 *  - `rateLimits` (a transient anti-abuse counter with no ministry meaning).
 */
export const EXPORT_TABLES = [
  "members",
  "contacts",
  "attendance",
  "attendanceSessionStarts",
  "journeyEvents",
  "followUps",
  "bibleStudies",
  "prayerRequests",
  "notes",
  "users",
  "posts",
  "comments",
  "postReactions",
  "postViews",
  "postReminders",
  "polls",
  "pollVotes",
  "settings",
  "counters",
  "auditLogs",
  "emailLogs",
  "notifications",
  "notificationJobs",
  "pushDeliveryLogs",
  "errorLogs",
] as const;

export type ExportTable = (typeof EXPORT_TABLES)[number];

/**
 * Rows per request. An export walks the tables page by page rather than in one
 * read, so a ministry with tens of thousands of attendance marks still exports
 * without tripping a query's document limit.
 */
export const EXPORT_PAGE_SIZE = 500;

/**
 * One page of a table, for the full export (Settings → Data Export).
 *
 * Admin-only: this is a raw dump of everything including private notes and
 * counselling records, so it is gated more tightly than any reading page.
 */
export const page = query({
  args: {
    table: v.union(...EXPORT_TABLES.map((name) => v.literal(name))),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const numItems = Math.min(Math.max(Math.trunc(args.numItems ?? EXPORT_PAGE_SIZE), 1), 1000);
    const result = await ctx.db.query(args.table).paginate({
      numItems,
      cursor: args.cursor,
    });
    return {
      // Handed back as plain records: an archive file wants the stored
      // documents as they are, not a per-table typed shape.
      docs: result.page as unknown as Record<string, unknown>[],
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
