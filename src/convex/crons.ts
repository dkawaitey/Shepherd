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

// Hourly background sync with the Steward app: pulls Steward's members into
// Shepherd and pushes Shepherd's members to Steward (respects the enable
// toggle in Settings → Integrations).
crons.hourly(
  "steward-member-sync",
  { minuteUTC: 17 },
  internal.steward.syncAll,
);

export default crons;
