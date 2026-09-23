// Pure email rendering helpers — no Convex functions, safe to import anywhere.

export function emailShell(
  title: string,
  sections: { heading: string; body: string }[],
  footer?: string,
) {
  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f5f1;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#1c211a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f1;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
        <tr>
          <td style="background:#141813;border-radius:10px 10px 0 0;padding:16px 24px;">
            <div style="color:#a8b98e;font-size:12px;letter-spacing:2px;font-weight:bold;">SHEPHERD</div>
            <div style="color:#6b7a63;font-size:10px;letter-spacing:1px;">Gethsemane Ministry Youth · discipleship management</div>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;border-left:1px solid #e3e5dd;border-right:1px solid #e3e5dd;padding:24px;">
            <div style="font-size:16px;font-weight:bold;color:#2c3327;margin-bottom:14px;">${title}</div>
            ${sections
              .filter((s) => s.body.trim())
              .map(
                (s) => `
              <div style="margin-bottom:16px;">
                <div style="font-size:11px;letter-spacing:1px;color:#7a8a70;text-transform:uppercase;margin-bottom:6px;">${s.heading}</div>
                <div style="font-size:13px;line-height:1.65;color:#3c4435;">${s.body}</div>
              </div>`,
              )
              .join("")}
            ${footer ? `<div style="border-top:1px dashed #e3e5dd;padding-top:12px;font-size:11px;color:#8a9483;">${footer}</div>` : ""}
          </td>
        </tr>
        <tr>
          <td style="background:#f0f1ec;border:1px solid #e3e5dd;border-top:0;border-radius:0 0 10px 10px;padding:12px 24px;font-size:10px;color:#8a9483;">
            Sent by Shepherd · Gethsemane Ministry Youth. You are receiving this because of your role on the team.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Shepherd — Gethsemane Ministry Youth\n\n${title}\n\n${sections
    .filter((s) => s.body.trim())
    .map((s) => `▸ ${s.heading.toUpperCase()}\n${stripHtml(s.body)}`)
    .join("\n\n")}\n\n${footer ? `—\n${stripHtml(footer)}` : ""}`;

  return { html, text };
}

const stripHtml = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();

export const fmtShortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

export function buildTestEmail(name?: string) {
  const now = new Date().toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return emailShell(
    "Test email — your reminder pipeline is live",
    [
      {
        heading: "Connection",
        body: `This email confirms Shepherd can reach you through the configured email provider. Sent ${now}.`,
      },
      {
        heading: "What happens next",
        body: "Follow-up workers will receive daily reminders for scheduled visits, and class leaders will receive a digest covering birthdays, low attendance and follow-up activity in their class.",
      },
    ],
    `Hello${name ? `, ${name}` : ""} — no action needed.`,
  );
}

export interface WorkerItem {
  contactId: string;
  contactName: string;
  membershipId: string;
  typeLabel: string;
  date: string;
  overdue: boolean;
}

export interface WorkerRecipient {
  userId?: string;
  email: string;
  phone?: string;
  name: string;
  items: WorkerItem[];
}

export interface ClassRecipient {
  userId: string;
  email: string;
  phone?: string;
  name: string;
  className: string;
  upcoming: { contactId: string; contactName: string; typeLabel: string; date: string }[];
  overdue: { contactId: string; contactName: string; typeLabel: string; date: string }[];
  birthdays: { contactId: string; contactName: string; monthDay: string }[];
  lowAttendance: { memberId: string; memberName: string }[];
  newContacts: { contactId: string; contactName: string; location: string }[];
  /** Combined attendance + punctuality reading for the class. */
  attendance: DigestAttendance;
}

/** The four quadrants of the combined attendance × punctuality view. */
export type DigestQuadrantKey = "faithful" | "drifting" | "committed" | "disengaging";

/** One month of punctuality in a digest. */
export interface DigestPunctualityPoint {
  label: string;
  onTimeRate: number;
  averageDelay: number;
  timed: number;
}

/** A member worth a check-in, flagged because their attendance is drifting. */
export interface DigestDrifter {
  memberId: string;
  memberName: string;
  level: "watch" | "atRisk";
  reason: string;
}

/**
 * The combined attendance + punctuality reading carried by both digests.
 *
 * Effective participation (present *and* on time), the monthly punctuality
 * trend, the drifting members and the quadrant split — the four derived
 * analytics, in one shape so the class and ministry digests describe the
 * ministry the same way the app does.
 */
export interface DigestAttendance {
  /** Present and on time as a share of sessions offered. */
  effectiveRate: number;
  /** Present at all as a share of sessions offered. */
  attendanceRate: number;
  /** Share of timed arrivals that were on time. */
  onTimeRate: number;
  /** Mean minutes after the session began. */
  averageDelay: number;
  /** Timed arrivals the figures are based on. */
  timed: number;
  punctualityTrend: DigestPunctualityPoint[];
  quadrant: {
    counts: Record<DigestQuadrantKey, number>;
    unmeasured: number;
    total: number;
  };
  drifting: DigestDrifter[];
}

const QUADRANT_LABELS: Record<DigestQuadrantKey, string> = {
  faithful: "Faithful & punctual",
  drifting: "Present but drifting",
  committed: "Committed, often absent",
  disengaging: "Disengaging",
};

const QUADRANT_GUIDANCE: Record<DigestQuadrantKey, string> = {
  faithful: "disciple them and give responsibility",
  drifting: "coach the schedule before it becomes absence",
  committed: "punctual when present but missing sessions — a pastoral visit",
  disengaging: "low attendance and late — priority outreach",
};

/** Act-first order, so the quadrant needing the most attention reads first. */
const QUADRANT_ORDER: DigestQuadrantKey[] = [
  "disengaging",
  "committed",
  "drifting",
  "faithful",
];

/**
 * Render the combined attendance + punctuality block.
 *
 * Shared by the class digest and the ministry digest so both describe a member
 * the same way, and so an unmeasured group is stated as such rather than
 * silently reported as all-clear.
 */
export function attendanceSections(
  a: DigestAttendance,
  scope: string,
): { heading: string; body: string }[] {
  const timedMonths = a.punctualityTrend.filter((p) => p.timed > 0);
  const { counts, unmeasured, total } = a.quadrant;
  const placed = total - unmeasured;

  const sections: { heading: string; body: string }[] = [
    {
      heading: "Effective participation",
      body:
        `• Present and on time: ${a.effectiveRate}% of sessions (${scope})<br/>` +
        `• Present at all (raw attendance): ${a.attendanceRate}%<br/>` +
        `• Arrivals on time: ${a.onTimeRate}% of ${a.timed} timed · average arrival ${
          a.timed === 0 ? "—" : a.averageDelay === 0 ? "first" : `+${a.averageDelay} min`
        }`,
    },
    {
      heading: "Punctuality trend",
      body: timedMonths.length
        ? timedMonths
            .map(
              (p) =>
                `${p.label}: ${p.onTimeRate}% on time · avg ${
                  p.averageDelay === 0 ? "first" : `+${p.averageDelay} min`
                }`,
            )
            .join("<br/>")
        : "No arrival times recorded yet — set each activity's start time in Settings and record the time members are marked to build this.",
    },
    {
      heading: "Attendance × punctuality",
      body:
        placed === 0
          ? "Nothing timed yet, so no member can be placed on the punctuality axis."
          : QUADRANT_ORDER.map(
              (k) =>
                `• ${QUADRANT_LABELS[k]}: ${counts[k]} — ${QUADRANT_GUIDANCE[k]}`,
            ).join("<br/>") +
            (unmeasured > 0
              ? `<br/>• Not enough arrival times to place: ${unmeasured} of ${total}`
              : ""),
    },
    {
      heading: "Drifting — lateness rising, attendance slipping",
      body: a.drifting.length
        ? a.drifting
            .map(
              (d) =>
                `• ${d.memberName} — ${d.reason}${d.level === "atRisk" ? " · reach out" : ""}`,
            )
            .join("<br/>")
        : "No one is drifting — attendance and punctuality are steady across the group.",
    },
  ];

  return sections;
}

export function buildWorkerEmail(r: WorkerRecipient) {
  const line = (i: WorkerItem) =>
    `• ${i.contactName} (${i.membershipId}) — ${i.typeLabel} — ${fmtShortDate(i.date)}${i.overdue ? " · OVERDUE" : ""}`;
  const upcoming = r.items.filter((i) => !i.overdue);
  const overdue = r.items.filter((i) => i.overdue);
  const title = `Your follow-up schedule — ${r.items.length} item${r.items.length === 1 ? "" : "s"}`;
  const { html, text } = emailShell(
    title,
    [
      {
        heading: "Upcoming (next 3 days)",
        body: upcoming.length ? upcoming.map(line).join("<br/>") : "Nothing due in the next 3 days.",
      },
      {
        heading: "Overdue",
        body: overdue.length ? overdue.map(line).join("<br/>") : "Nothing overdue — all caught up.",
      },
    ],
    `Open Shepherd → Follow-ups to record outcomes and update the discipleship timeline.`,
  );
  return { subject: title, html, text };
}

export interface MinistrySection {
  heading: string;
  body: string;
}

/**
 * Role-scoped ministry digest sent to administrators and evangelism
 * coordinators. The sections are composed on the server (see reminders.ts) so
 * each recipient only ever receives the information their role may read.
 */
export interface MinistryRecipient {
  userId: string;
  email: string;
  phone?: string;
  name: string;
  roleLabel: string;
  /** Short line describing what the sections cover for this role. */
  scopeNote: string;
  sections: MinistrySection[];
}

export function buildMinistryEmail(r: MinistryRecipient) {
  const title = `Ministry digest — ${r.roleLabel}`;
  const { html, text } = emailShell(
    title,
    r.sections,
    `Scoped to what your ${r.roleLabel} role can see · ${r.scopeNote} Open Shepherd for the full picture.`,
  );
  return { subject: title, html, text };
}

/** Compact plain-text summary used for the SMS fallback (one message, no HTML). */
export function buildMinistrySms(r: MinistryRecipient) {
  const lines = r.sections.slice(0, 4).map((s) => `${s.heading}: ${stripHtml(s.body)}`);
  const body = `Shepherd — ${r.roleLabel} ministry digest\n\n${lines.join("\n")}`;
  return body.length > 480 ? `${body.slice(0, 477)}…` : body;
}

export function buildClassEmail(r: ClassRecipient) {
  const followupLine = (x: { contactName: string; typeLabel: string; date: string }) =>
    `• ${x.contactName} — ${x.typeLabel} — ${fmtShortDate(x.date)}`;
  const title = `${r.className} Class — ministry digest`;
  const { html, text } = emailShell(
    title,
    [
      ...attendanceSections(
        r.attendance,
        `${r.className} Class members`,
      ),
      {
        heading: "Upcoming follow-ups",
        body: r.upcoming.length
          ? r.upcoming.map(followupLine).join("<br/>")
          : "None scheduled in the next 3 days.",
      },
      {
        heading: "Overdue follow-ups",
        body: r.overdue.length
          ? r.overdue.map(followupLine).join("<br/>")
          : "None — all caught up.",
      },
      {
        heading: "Birthdays this week",
        body: r.birthdays.length
          ? r.birthdays.map((b) => `• ${b.contactName} — ${b.monthDay}`).join("<br/>")
          : "No birthdays in the next 7 days.",
      },
      {
        heading: "Members needing follow-up",
        body: r.lowAttendance.length
          ? r.lowAttendance
              .map((m) => `• ${m.memberName} — no youth meeting attended in the last 4 weeks`)
              .join("<br/>")
          : "All members have attended a youth meeting recently.",
      },
      {
        heading: "New contacts this week",
        body: r.newContacts.length
          ? r.newContacts
              .map((c) => `• ${c.contactName}${c.location ? ` — ${c.location}` : ""}`)
              .join("<br/>")
          : "No new contacts recorded this week.",
      },
    ],
    `Open Shepherd to act on these items and keep the discipleship journey moving.`,
  );
  return { subject: title, html, text };
}
