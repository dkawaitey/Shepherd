import { cn } from "@/lib/utils";
import { parseWhatsappTargets, whatsappHref, type ChatTarget } from "@/lib/whatsapp";
import {
  ROLE_LABELS,
  ROLES,
  STAGE_LABELS,
  Role,
  Stage,
} from "@/convex/constants";
import { ReactNode } from "react";
import {
  Check,
  ChevronDown,
  Circle,
  Inbox,
  MessageCircle,
  MessageSquareText,
  Pencil,
  Phone,
  X,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * A compact inline status mark, drawn as an icon so that no symbol in the app
 * depends on a system glyph font: a tick (done), a cross (missed), a hollow
 * circle (not yet) or a pen (recorded by hand rather than by the journey).
 *
 * The size is overridable through `className` — the colour follows the status
 * tokens unless a caller has a reason to override it.
 */
export function Mark({
  glyph,
  className,
}: {
  glyph: "done" | "miss" | "todo" | "manual";
  className?: string;
}) {
  const Icon =
    glyph === "done"
      ? Check
      : glyph === "miss"
        ? X
        : glyph === "manual"
          ? Pencil
          : Circle;
  return (
    <Icon
      aria-hidden
      className={cn(
        "inline h-3 w-3 shrink-0 align-[-2px]",
        glyph === "done" && "text-status-green",
        glyph === "miss" && "text-status-red",
        glyph === "todo" && "text-muted-foreground/60",
        glyph === "manual" && "text-[#fbbf24]",
        className,
      )}
    />
  );
}

/**
 * The account fields every client-side role check needs. Accounts may hold
 * several roles at once, an administrator may be "testing as" a role, and a
 * guest (anonymous) account never holds any role at all.
 */
export type RoleBearingUser =
  | {
      role?: string;
      roles?: string[];
      testAs?: string;
      isAnonymous?: boolean;
    }
  | null
  | undefined;

/**
 * Roles in effect for the signed-in account — the client mirror of
 * `effectiveRoles()` in convex/helpers.ts. Server and client must agree, or the
 * UI offers actions the backend will refuse (or hides ones it would allow):
 *   - guest (anonymous) accounts hold no role, whatever the document says
 *   - while "testing as" a role, only that role applies
 *   - otherwise every assigned role counts
 */
export function effectiveUserRoles(user: RoleBearingUser): string[] {
  if (!user || user.isAnonymous) return [];
  if (user.testAs) return [user.testAs];
  return user.roles?.length ? user.roles : user.role ? [user.role] : [];
}

/** True when any of the account's roles matches. */
export function userHasRole(user: RoleBearingUser, role: string): boolean {
  return effectiveUserRoles(user).includes(role);
}

/** True for administrators (any role set that includes admin). */
export function userIsAdmin(user: RoleBearingUser): boolean {
  return userHasRole(user, ROLES.ADMIN);
}

/**
 * True when the account may change ministry records: it holds at least one role
 * and is not purely a Read-only Leader. Mirrors the server, where the
 * read-only role can read but every write goes through `requireRole`.
 */
export function userCanWrite(user: RoleBearingUser): boolean {
  const roles = effectiveUserRoles(user);
  return roles.length > 0 && roles.some((r) => r !== ROLES.LEADER);
}

/** Human-readable labels for every role a user holds (e.g. "Administrator + Class Leader"). */
export function formatRoles(user?: {
  role?: string;
  roles?: string[];
  classScope?: string;
} | null) {
  const roles = user?.roles?.length ? user.roles : user?.role ? [user.role] : [];
  const labels = roles.map((r) => ROLE_LABELS[r as Role] ?? r);
  const base = labels.length ? labels.join(" + ") : "Pending role";
  if (user?.classScope && roles.includes("classLeader")) {
    return `${base} · ${user.classScope}`;
  }
  return base;
}

/**
 * True when the user may add / edit contacts and members: administrators,
 * evangelism coordinators and class leaders. Mirrors the server's
 * `requireRole([coordinator, classLeader])` on the contact record mutations.
 */
export function canAddRecords(user?: {
  role?: string;
  roles?: string[];
  testAs?: string;
  isAnonymous?: boolean;
} | null) {
  return (
    userIsAdmin(user) ||
    userHasRole(user, ROLES.COORDINATOR) ||
    userHasRole(user, ROLES.CLASS_LEADER)
  );
}

/**
 * True when the account may add a contact: every signed-in position, mirroring
 * the server's `requireAccount` on `contacts.create` / `contacts.quickAdd`.
 * Editing is still limited to administrators, coordinators and class leaders
 * (`canAddRecords`). Guest (anonymous) accounts are excluded.
 */
export function canAddContacts(user?: {
  isAnonymous?: boolean;
} | null) {
  return !!user && !user.isAnonymous;
}

/**
 * Accounts that may publish an announcement or poll. Mirrors the server's
 * `requireRole([coordinator, worker, leader, classLeader])` in `posts.create` —
 * a plain member (linked profile, no ministry position) can react, comment and
 * vote, but not publish.
 */
export function canPublishPosts(user?: RoleBearingUser) {
  return (
    userIsAdmin(user) ||
    userHasRole(user, ROLES.COORDINATOR) ||
    userHasRole(user, ROLES.WORKER) ||
    userHasRole(user, ROLES.LEADER) ||
    userHasRole(user, ROLES.CLASS_LEADER)
  );
}

export function StatusPill({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const colors: Record<string, string> = {
    pending: "bg-status-amber/10 text-status-amber border-status-amber/30",
    completed: "bg-status-green/10 text-status-green border-status-green/30",
    missed: "bg-status-red/10 text-status-red border-status-red/30",
    cancelled: "bg-status-grey/10 text-status-grey border-status-grey/30",
    active: "bg-status-amber/10 text-status-amber border-status-amber/30",
    answered: "bg-status-green/10 text-status-green border-status-green/30",
    closed: "bg-status-grey/10 text-status-grey border-status-grey/30",
    present: "bg-status-green/10 text-status-green border-status-green/30",
    absent: "bg-status-red/10 text-status-red border-status-red/30",
    excused: "bg-status-amber/10 text-status-amber border-status-amber/30",
    male: "bg-primary/10 text-primary border-primary/25",
    female: "bg-gold/12 text-gold border-gold/30",
    inProgress: "bg-status-amber/10 text-status-amber border-status-amber/30",
    notStarted: "bg-status-grey/10 text-status-grey border-status-grey/30",
    activeMember: "bg-status-green/10 text-status-green border-status-green/30",
    inactive: "bg-status-grey/10 text-status-grey border-status-grey/30",
  };
  const statusLabels: Record<string, string> = {
    pending: "Pending",
    completed: "Completed",
    missed: "Missed",
    cancelled: "Cancelled",
    active: "Active Prayer Request",
    answered: "Answered Prayer",
    closed: "Closed Prayer Request",
    present: "Present",
    absent: "Absent",
    excused: "Excused",
    activeMember: "Active",
  };
  const label =
    statusLabels[status] ??
    status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.06em]",
        colors[status] ?? "bg-muted text-muted-foreground border-border",
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {label}
    </span>
  );
}

export function StagePill({ stage, className }: { stage?: string; className?: string }) {
  if (!stage) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-primary/20 bg-primary/[0.07] px-2 py-0.5 text-[10px] font-medium tracking-[0.01em] text-primary",
        className,
      )}
    >
      {STAGE_LABELS[stage as Stage] ?? stage}
    </span>
  );
}

export function PageHeader({
  title,
  code,
  description,
  actions,
}: {
  title: string;
  code?: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-7 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          {code && (
            <span className="rounded-md border border-gold/30 bg-gold/10 px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-gold">
              {code}
            </span>
          )}
          <h1 className="display-title text-[26px] leading-[1.1] text-foreground sm:text-[31px]">
            {title}
          </h1>
        </div>
        {description && (
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-2xl border border-border/80 bg-gradient-to-br from-primary/12 to-gold/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
        <Inbox className="h-5 w-5 text-primary" />
      </div>
      <p className="display-title text-[17px] text-foreground">{title}</p>
      {message && (
        <p className="mt-1.5 max-w-sm text-[12.5px] leading-6 text-muted-foreground">
          {message}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function fmtDate(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en", { day: "2-digit", month: "short", year: "numeric" });
}

/** Format a stored 24h "HH:MM" time as a friendly 12h time, e.g. 14:30 -> "2:30 PM". */
export function fmtTime(time?: string) {
  if (!time) return "—";
  const [h, m] = time.split(":").map((n) => parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return time;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });
}

export function fmtDateTime(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export { formatError } from "@/lib/errors";

export type PhoneNumber = { label: string; digits: string };

/**
 * Pull every phone number out of a stored value.
 *
 * Volunteers often save two numbers in one box — "024 000 0000 / 055 000 0000"
 * — so callers get each number separately instead of one unusable digit blob.
 */
export function parsePhoneNumbers(value?: string | null): PhoneNumber[] {
  if (!value) return [];
  const matches = value.match(/\+?\d[\d\s\-().]{4,}\d/g) ?? [];
  const seen = new Set<string>();
  const numbers: PhoneNumber[] = [];
  for (const raw of matches) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 6 || digits.length > 20) continue;
    if (seen.has(digits)) continue;
    seen.add(digits);
    numbers.push({
      digits,
      label: raw.replace(/[()]/g, " ").replace(/\s+/g, " ").trim(),
    });
  }
  return numbers;
}

/**
 * A WhatsApp chat link for a stored value — a username opens a chat with the
 * handle, a number is dialled as digits.
 */
export function waLink(value?: string, text?: string) {
  const target = parseWhatsappTargets(value)[0];
  if (!target) return "#";
  return whatsappHref(target.value, text);
}

export function smsLink(number?: string, text?: string) {
  const digits = parsePhoneNumbers(number)[0]?.digits;
  if (!digits) return "#";
  return `sms:${digits}${text ? `?body=${encodeURIComponent(text)}` : ""}`;
}

export function telLink(number?: string) {
  const digits = parsePhoneNumbers(number)[0]?.digits;
  if (!digits) return "#";
  return `tel:${digits}`;
}

type Channel = "call" | "whatsapp" | "sms";

const CHANNEL_META: Record<
  Channel,
  { icon: typeof Phone; label: string; pickerVerb: string; external: boolean }
> = {
  call: { icon: Phone, label: "Call", pickerVerb: "Call", external: false },
  whatsapp: {
    icon: MessageCircle,
    label: "WhatsApp",
    pickerVerb: "Message on WhatsApp",
    external: true,
  },
  sms: { icon: MessageSquareText, label: "SMS", pickerVerb: "Text", external: false },
};

const channelHref = (channel: Channel, value: string, text?: string) => {
  if (channel === "call") return `tel:${value}`;
  if (channel === "whatsapp") return whatsappHref(value, text);
  return `sms:${value}${text ? `?body=${encodeURIComponent(text)}` : ""}`;
};

/**
 * Call / WhatsApp / SMS buttons for a contact or member.
 *
 * One number on file → the button acts directly. Two or more (the ministry
 * stores a primary and a backup number, sometimes both in one field) → the
 * button asks which number to use before dialling.
 */
export function ContactChannelActions({
  phone,
  whatsapp,
  whatsappText,
  smsText,
  compact = false,
  className,
}: {
  phone?: string | null;
  whatsapp?: string | null;
  whatsappText?: string;
  smsText?: string;
  /** Icon-only square buttons (for cards) instead of labelled buttons. */
  compact?: boolean;
  className?: string;
}) {
  const callNumbers = parsePhoneNumbers(phone);
  // A stored WhatsApp username is preferred; older records with only a number
  // still offer a chat, dialled from the number on file.
  const storedWhatsapp = parseWhatsappTargets(whatsapp);
  const waTargets: ChatTarget[] = storedWhatsapp.length
    ? storedWhatsapp
    : callNumbers.map((n) => ({ value: n.digits, label: n.label }));
  const callTargets: ChatTarget[] = callNumbers.map((n) => ({
    value: n.digits,
    label: n.label,
  }));

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <ChannelAction channel="call" targets={callTargets} compact={compact} />
      <ChannelAction
        channel="whatsapp"
        targets={waTargets}
        compact={compact}
        text={whatsappText}
      />
      <ChannelAction
        channel="sms"
        targets={callTargets}
        compact={compact}
        text={smsText}
      />
    </div>
  );
}

function ChannelAction({
  channel,
  targets,
  text,
  compact = false,
}: {
  channel: Channel;
  targets: ChatTarget[];
  text?: string;
  compact?: boolean;
}) {
  const meta = CHANNEL_META[channel];
  const Icon = meta.icon;
  if (targets.length === 0) return null;

  const hover =
    channel === "whatsapp"
      ? "hover:border-status-green/50 hover:text-status-green"
      : "hover:border-primary/50 hover:text-primary";

  const triggerClass = compact
    ? cn(
        "flex h-7 items-center justify-center gap-0.5 rounded-md border text-muted-foreground transition-colors",
        targets.length > 1 ? "px-1.5" : "w-7",
        hover,
      )
    : cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5", hover);

  const iconEl = <Icon className="h-3.5 w-3.5" />;

  // Single target: act immediately.
  if (targets.length === 1) {
    const t = targets[0]!;
    return (
      <a
        href={channelHref(channel, t.value, text)}
        target={meta.external ? "_blank" : undefined}
        rel={meta.external ? "noreferrer" : undefined}
        title={`${meta.label} ${t.label}`}
        onClick={(e) => e.stopPropagation()}
        className={triggerClass}
      >
        {iconEl}
        {!compact && meta.label}
      </a>
    );
  }

  // Several targets: ask which one to use.
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={`${targets.length} contacts on file — choose one`}
          onClick={(e) => e.stopPropagation()}
          className={triggerClass}
        >
          {iconEl}
          {!compact && meta.label}
          <ChevronDown className="h-3 w-3 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-56"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">
          {targets.length} contacts on file
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {targets.map((t, i) => (
          <DropdownMenuItem key={t.value} asChild>
            <a
              href={channelHref(channel, t.value, text)}
              target={meta.external ? "_blank" : undefined}
              rel={meta.external ? "noreferrer" : undefined}
              className="flex cursor-pointer items-center gap-2"
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex flex-col">
                <span className="text-[12px] font-semibold">{t.label}</span>
                <span className="text-[10px] text-muted-foreground">
                  {meta.pickerVerb}
                  {i === 0 ? " · primary" : " · backup"}
                </span>
              </span>
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function mapsLink(location?: string) {
  if (!location) return "https://maps.google.com/?q=Ghana";
  const q = encodeURIComponent(location);
  return `https://maps.google.com/?q=${q}`;
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]!);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Generate a styled PDF file from one or more tables.
 * Each section gets its own heading and table; long text wraps and pages break automatically.
 */
export function downloadPdf(
  filename: string,
  sections: { heading: string; rows: Record<string, unknown>[] }[],
) {
  const sectionsWithRows = sections.filter((s) => s.rows.length > 0);
  if (!sectionsWithRows.length) return;

  // Lazy-import so the heavy jsPDF bundle only loads when actually exporting.
  void import("jspdf").then(async ({ default: jsPDF }) => {
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

    // Header band
    doc.setFillColor(143, 175, 138); // sage green
    doc.rect(0, 0, doc.internal.pageSize.getWidth(), 44, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Shepherd — Discipleship Management", 28, 20);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(
      `Generated ${new Date().toLocaleString()} · Gethsemane Ministry Youth Ministry`,
      28,
      33,
    );

    let startY = 60;
    sectionsWithRows.forEach((section, i) => {
      const headers = Object.keys(section.rows[0]!);
      const body = section.rows.map((r) => headers.map((h) => (r[h] == null ? "" : String(r[h]))));
      doc.setTextColor(60, 72, 60);
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text(section.heading, 28, startY + 4);
      startY += 10;
      autoTable(doc, {
        head: [headers.map((h) => h.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()))],
        body,
        startY,
        margin: { left: 28, right: 28 },
        styles: { fontSize: 8, cellPadding: 3, textColor: [40, 50, 40] },
        headStyles: { fillColor: [143, 175, 138], textColor: [255, 255, 255], fontStyle: "bold" },
        alternateRowStyles: { fillColor: [247, 246, 242] },
        columnStyles: { 0: { cellWidth: "auto" } },
        didDrawPage: () => {
          // Footer page numbers
          const page = doc.getCurrentPageInfo().pageNumber;
          doc.setFontSize(8);
          doc.setTextColor(120, 130, 120);
          doc.text(`Page ${page}`, doc.internal.pageSize.getWidth() - 28, doc.internal.pageSize.getHeight() - 18, {
            align: "right",
          });
        },
      });
      startY = (doc as any).lastAutoTable.finalY + 24;
      if (i < sectionsWithRows.length - 1 && startY > doc.internal.pageSize.getHeight() - 60) {
        doc.addPage();
        startY = 60;
      }
    });

    doc.save(filename);
  });
}

export function progressColor(pct: number) {
  if (pct >= 75) return "#86efac";
  if (pct >= 40) return "#fbbf24";
  return "#f87171";
}
