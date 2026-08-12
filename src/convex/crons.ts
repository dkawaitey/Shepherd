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

export default crons;
