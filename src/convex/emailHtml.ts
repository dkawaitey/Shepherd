// Pure email rendering helpers — no Convex functions, safe to import anywhere.

/** Strip tags and decode the handful of entities the digest bodies use. Line
 *  breaks become real newlines so the plain-text and SMS versions keep the
 *  digest's line structure instead of running every line together. */
const stripHtml = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/**
 * Render one section body.
 *
 * Bodies arrive as lines joined by `<br/>`, with `•` marking a bullet. Each
 * line gets its own row with breathing room (and bullets a hanging indent),
 * because a single dense `<div>` was what made the digest read as a wall of
 * text. Lines without a bullet are lead sentences and stay flush left.
 */
const renderBody = (body: string) =>
  body
    .split(/<br\s*\/?>/i)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const bullet = line.startsWith("•");
      const text = bullet ? line.replace(/^•\s*/, "") : line;
      return bullet
        ? `<div style="padding:2px 0 2px 14px;text-indent:-14px;"><span style="color:#93a186;">•</span>&nbsp;&nbsp;${text}</div>`
        : `<div style="padding:2px 0;">${text}</div>`;
    })
    .join("");

/** One section: an uppercase label over its body, ruled off from the one above. */
const renderSection = (s: { heading: string; body: string }) => `
              <div style="border-top:1px solid #eef0e9;padding:14px 0 4px;">
                <div style="font-size:10px;font-weight:bold;letter-spacing:1.4px;text-transform:uppercase;color:#7a8a70;margin-bottom:7px;">${s.heading}</div>
                <div style="font-size:13px;line-height:1.55;color:#3c4435;">${renderBody(s.body)}</div>
              </div>`;

export function emailShell(
  title: string,
  sections: { heading: string; body: string }[],
  footer?: string,
) {
  const shown = sections.filter((s) => s.body.trim());
  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f5f1;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f1;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.55;color:#1c211a;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
        <tr>
          <td style="background:#141813;border-radius:10px 10px 0 0;padding:16px 24px;">
            <div style="color:#a8b98e;font-size:12px;letter-spacing:2px;font-weight:bold;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">SHEPHERD</div>
            <div style="color:#6b7a63;font-size:10px;letter-spacing:1px;margin-top:3px;">Gethsemane Ministry Youth · discipleship management</div>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;border-left:1px solid #e3e5dd;border-right:1px solid #e3e5dd;padding:22px 24px 6px;">
            <div style="font-size:17px;font-weight:600;line-height:1.35;color:#2c3327;">${title}</div>
            ${shown.map(renderSection).join("")}
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;border-left:1px solid #e3e5dd;border-right:1px solid #e3e5dd;padding:2px 24px 20px;">
            ${
              footer
                ? `<div style="border-top:1px dashed #e3e5dd;padding-top:12px;font-size:11px;line-height:1.5;color:#8a9483;">${footer}</div>`
                : ""
            }
          </td>
        </tr>
        <tr>
          <td style="background:#f0f1ec;border:1px solid #e3e5dd;border-top:0;border-radius:0 0 10px 10px;padding:12px 24px;font-size:10px;line-height:1.5;color:#8a9483;">
            Sent by Shepherd · Gethsemane Ministry Youth. You are receiving this because of your role on the team.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Shepherd — Gethsemane Ministry Youth\n\n${title}\n\n${shown
    .map((s) => `▸ ${s.heading.toUpperCase()}\n${stripHtml(s.body)}`)
    .join("\n\n")}${footer ? `\n\n—\n${stripHtml(footer)}` : ""}`;

  return { html, text };
}

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
        body: `Shepherd can reach you through the configured email provider. Sent ${now}.`,
      },
      {
        heading: "What happens next",
        body:
          "Follow-up workers get a daily reminder of every follow-up scheduled ahead, plus anything overdue.<br/>" +
          "Class leaders get a digest of their class: participation, punctuality, scheduled and overdue follow-ups, birthdays, new contacts and members to check on.",
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
  /** Every pending follow-up still ahead, soonest first. */
  scheduled: { contactId: string; contactName: string; typeLabel: string; date: string }[];
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
  disengaging: "late and often absent — priority outreach",
};

/** Act-first order, so the quadrant needing the most attention reads first. */
const QUADRANT_ORDER: DigestQuadrantKey[] = [
  "disengaging",
  "committed",
  "drifting",
  "faithful",
];

/** How far an arrival landed from the start of the session, in words. */
const arrivalText = (averageDelay: number) =>
  averageDelay === 0 ? "first in the room" : `${averageDelay} min after the session begins`;

/** "a, b and N more" — keeps a long list readable inside an email. */
const capped = (lines: string[], max: number, tail: (rest: number) => string) =>
  lines.slice(0, max).join("<br/>") +
  (lines.length > max ? `<br/>${tail(lines.length - max)}` : "");

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
      heading: `Effective participation — ${scope}`,
      body:
        `Present and on time for ${a.effectiveRate}% of sessions.<br/>` +
        `• Present at all — ${a.attendanceRate}%<br/>` +
        `• On time — ${a.onTimeRate}% of ${a.timed} timed arrivals<br/>` +
        `• Average arrival — ${
          a.timed === 0 ? "not measured yet" : arrivalText(a.averageDelay)
        }`,
    },
    {
      heading: "Punctuality trend",
      body: timedMonths.length
        ? capped(
            timedMonths.map(
              (p) => `${p.label} — ${p.onTimeRate}% on time, average ${arrivalText(p.averageDelay)}`,
            ),
            12,
            (rest) => `${rest} earlier months not shown.`,
          )
        : "Not measured yet. Set each activity's start time in Settings, then record the time members are marked so arrivals can be timed.",
    },
    {
      heading: "Attendance × punctuality",
      body:
        placed === 0
          ? "Nothing is timed yet, so no one can be placed on the punctuality axis."
          : QUADRANT_ORDER.map(
              (k) => `${QUADRANT_LABELS[k]} — ${counts[k]}: ${QUADRANT_GUIDANCE[k]}`,
            ).join("<br/>") +
            (unmeasured > 0
              ? `<br/>Not enough arrival times to place ${unmeasured} of ${total}.`
              : ""),
    },
    {
      heading: "Drifting — lateness rising, attendance slipping",
      body: a.drifting.length
        ? a.drifting
            .map(
              (d) =>
                `${d.memberName} — ${d.reason} · ${
                  d.level === "atRisk" ? "reach out now" : "keep an eye"
                }`,
            )
            .join("<br/>")
        : "No one is drifting. Attendance and punctuality are steady across the group.",
    },
  ];

  return sections;
}

export function buildWorkerEmail(r: WorkerRecipient) {
  const line = (i: WorkerItem) =>
    `${i.contactName} (${i.membershipId}) — ${i.typeLabel} — ${fmtShortDate(i.date)}${i.overdue ? " · OVERDUE" : ""}`;
  const scheduled = r.items.filter((i) => !i.overdue);
  const overdue = r.items.filter((i) => i.overdue);
  const title = `Your follow-up schedule — ${r.items.length} item${r.items.length === 1 ? "" : "s"}`;
  const { html, text } = emailShell(
    title,
    [
      {
        heading: `Scheduled ahead (${scheduled.length})`,
        body: scheduled.length
          ? capped(scheduled.map(line), 20, (rest) => `…and ${rest} more scheduled.`)
          : "Nothing scheduled ahead.",
      },
      {
        heading: `Overdue (${overdue.length})`,
        body: overdue.length
          ? capped(overdue.map(line), 20, (rest) => `…and ${rest} more overdue.`)
          : "Nothing overdue — all caught up.",
      },
    ],
    "Open Shepherd → Follow-ups to record outcomes and update the discipleship timeline.",
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
    `Scoped to what your ${r.roleLabel} role can see · ${r.scopeNote}<br/>Open Shepherd for the full picture.`,
  );
  return { subject: title, html, text };
}

/** Compact plain-text summary used for the SMS fallback (one message, no HTML). */
export function buildMinistrySms(r: MinistryRecipient) {
  const lines = r.sections
    .slice(0, 5)
    .map((s) => `${s.heading}: ${stripHtml(s.body).split("\n")[0]}`);
  const body = `Shepherd — ${r.roleLabel} ministry digest\n\n${lines.join("\n")}`;
  return body.length > 480 ? `${body.slice(0, 477)}…` : body;
}

export function buildClassEmail(r: ClassRecipient) {
  const followupLine = (x: { contactName: string; typeLabel: string; date: string }) =>
    `${x.contactName} — ${x.typeLabel} — ${fmtShortDate(x.date)}`;
  const title = `${r.className} Class — ministry digest`;
  const { html, text } = emailShell(
    title,
    [
      ...attendanceSections(r.attendance, `${r.className} Class members`),
      {
        heading: `Upcoming follow-ups (${r.scheduled.length})`,
        body: r.scheduled.length
          ? capped(r.scheduled.map(followupLine), 12, (rest) => `…and ${rest} more scheduled.`)
          : "Nothing scheduled ahead.",
      },
      {
        heading: `Overdue follow-ups (${r.overdue.length})`,
        body: r.overdue.length
          ? capped(r.overdue.map(followupLine), 12, (rest) => `…and ${rest} more overdue.`)
          : "None — all caught up.",
      },
      {
        heading: "Birthdays this week",
        body: r.birthdays.length
          ? r.birthdays.map((b) => `${b.contactName} — ${b.monthDay}`).join("<br/>")
          : "No birthdays in the next 7 days.",
      },
      {
        heading: `Members needing follow-up (${r.lowAttendance.length})`,
        body: r.lowAttendance.length
          ? capped(
              r.lowAttendance.map((m) => `${m.memberName} — no youth meeting in the last 4 weeks`),
              12,
              (rest) => `…and ${rest} more to check on.`,
            )
          : "All members have attended a youth meeting recently.",
      },
      {
        heading: "New contacts this week",
        body: r.newContacts.length
          ? r.newContacts
              .map((c) => `${c.contactName}${c.location ? ` — ${c.location}` : ""}`)
              .join("<br/>")
          : "No new contacts recorded this week.",
      },
    ],
    "Open Shepherd to act on these items and keep the discipleship journey moving.",
  );
  return { subject: title, html, text };
}
