import type { ConvexReactClient } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  EXPORT_PAGE_SIZE,
  EXPORT_TABLES,
  type ExportTable,
} from "@/convex/dataExport";

/** Human names for the tables, in export order. */
export const TABLE_LABELS: Record<ExportTable, string> = {
  members: "Members",
  contacts: "Contacts",
  attendance: "Attendance records",
  attendanceSessionStarts: "Session start times",
  journeyEvents: "Journey timeline",
  followUps: "Follow-ups",
  bibleStudies: "Bible study progress",
  prayerRequests: "Prayer requests",
  notes: "Ministry notes",
  users: "Accounts",
  posts: "Announcements",
  comments: "Comments",
  postReactions: "Reactions",
  postViews: "Post views",
  postReminders: "Post reminders",
  polls: "Polls",
  pollVotes: "Poll votes",
  settings: "Ministry settings",
  counters: "Membership counters",
  auditLogs: "Audit logs",
  emailLogs: "Email log",
  notifications: "In-app notifications",
  notificationJobs: "Scheduled notifications",
  pushDeliveryLogs: "Push delivery log",
  errorLogs: "Error log",
};

/**
 * Read a whole table, one page at a time, until the server says it is done.
 *
 * Paging is what makes "everything" possible: each request stays a normal-sized
 * query however many attendance marks the ministry has recorded.
 */
export async function fetchTable(
  convex: ConvexReactClient,
  table: ExportTable,
): Promise<Record<string, unknown>[]> {
  const docs: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  for (;;) {
    const result: {
      docs: Record<string, unknown>[];
      isDone: boolean;
      continueCursor: string;
    } = await convex.query(api.dataExport.page, {
      table,
      cursor,
      numItems: EXPORT_PAGE_SIZE,
    });
    docs.push(...result.docs);
    if (result.isDone) break;
    // A cursor that does not advance would loop forever; stop instead.
    if (!result.continueCursor || result.continueCursor === cursor) break;
    cursor = result.continueCursor;
  }
  return docs;
}

/** Read every exported table, reporting progress as each one finishes. */
export async function fetchEverything(
  convex: ConvexReactClient,
  onProgress?: (table: ExportTable, done: number, total: number) => void,
): Promise<Record<ExportTable, Record<string, unknown>[]>> {
  const out = {} as Record<ExportTable, Record<string, unknown>[]>;
  for (let i = 0; i < EXPORT_TABLES.length; i++) {
    const table = EXPORT_TABLES[i]!;
    onProgress?.(table, i, EXPORT_TABLES.length);
    out[table] = await fetchTable(convex, table);
  }
  return out;
}

/** A stored value as one CSV cell: nested media/tags become compact JSON. */
function cell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/**
 * Turn raw documents into CSV rows.
 *
 * Columns are the union of every document's fields, not just the first one's —
 * older records missing a newer field would otherwise silently drop a column,
 * and `downloadCsv` reads its headers from the first row.
 */
export function rowsFromDocs(docs: Record<string, unknown>[]) {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const doc of docs) {
    for (const key of Object.keys(doc)) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  const rows = docs.map((doc) => {
    const row: Record<string, string> = {};
    for (const key of keys) row[key] = cell(doc[key]);
    return row;
  });
  return { keys, rows };
}

/** Save any JSON-serialisable value as a pretty-printed .json file. */
export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** `2026-11-21` — the day stamp used in export filenames. */
export function exportDay() {
  return new Date().toISOString().slice(0, 10);
}
