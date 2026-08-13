import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Daily reminder digest at 07:00 UTC: follow-up reminders for workers and a
// ministry digest (birthdays, attendance, follow-ups) for class leaders.
crons.daily(
  "daily-reminder-email",
  { hourUTC: 7, minuteUTC: 0 },
  internal.emails.dailyDigest,
);

// Hourly background push to the Steward app: pushes Shepherd's members out to
// Steward (respects the enable toggle in Settings → Integrations). Sync is
// one-way — nothing is ever pulled from Steward into Shepherd.
crons.hourly(
  "steward-member-sync",
  { minuteUTC: 17 },
  internal.steward.pushMembers,
);

export default crons;
