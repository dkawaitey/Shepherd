import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Ministry digest at 07:00 UTC every Monday and Thursday. The same run sends
// follow-up reminders to workers, a class digest to class leaders, and a
// role-scoped ministry digest (outreach, follow-ups, workers, and — for
// administrators only — member directory and account health) to administrators
// and evangelism coordinators.
for (const dayOfWeek of ["monday", "thursday"] as const) {
  crons.weekly(
    `ministry-digest-${dayOfWeek}`,
    { dayOfWeek, hourUTC: 7, minuteUTC: 0 },
    internal.emails.ministryDigest,
  );
}

// Daily push notifications at 06:30 UTC: follow-up reminders, birthday alerts,
// missed follow-ups, and low attendance alerts delivered as device notifications.
crons.daily(
  "daily-push-notifications",
  { hourUTC: 6, minuteUTC: 30 },
  internal.pushScheduler.dailyPushNotifications,
);

// Close polls whose auto-close deadline has passed, every 15 minutes. Answers
// stop counting the instant the deadline passes (posts.vote honours it), so
// this only flips the poll to closed and notifies the people who can announce
// its result.
crons.interval(
  "close-due-polls",
  { minutes: 15 },
  internal.posts.closeDuePolls,
);

// Daily error-log housekeeping at 03:15 UTC: drop entries older than 30 days and
// keep the newest 1000 so the admin error log stays readable.
crons.daily(
  "prune-error-log",
  { hourUTC: 3, minuteUTC: 15 },
  internal.errorLogs.prune,
);

// Daily rate-limit housekeeping at 03:30 UTC: drop windows that expired more
// than two days ago so the limiter table stays tiny.
crons.daily(
  "prune-rate-limits",
  { hourUTC: 3, minuteUTC: 30 },
  internal.rateLimit.prune,
);


export default crons;
