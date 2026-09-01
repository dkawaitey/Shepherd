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

// Daily push notifications at 06:30 UTC: follow-up reminders, birthday alerts,
// missed follow-ups, and low attendance alerts delivered as device notifications.
crons.daily(
  "daily-push-notifications",
  { hourUTC: 6, minuteUTC: 30 },
  internal.pushScheduler.dailyPushNotifications,
);


export default crons;
