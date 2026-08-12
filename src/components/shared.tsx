import { cn } from "@/lib/utils";
import {
  FOLLOWUP_STATUS_COLORS,
  ROLE_LABELS,
  STAGE_LABELS,
  FollowupStatus,
  Role,
  Stage,
} from "@/convex/constants";
import { ReactNode } from "react";
import { Inbox } from "lucide-react";

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

export function StatusPill({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const colors: Record<string, string> = {
    pending: "bg-[#2e2408] text-[#fbbf24] border-[#f59e0b]/40",
    completed: "bg-[#15291c] text-[#86efac] border-[#4ade80]/30",
    missed: "bg-[#331215] text-[#fca5a5] border-[#f87171]/40",
    cancelled: "bg-[#1f251d] text-[#a3adb9] border-[#9ca3af]/40",
    active: "bg-[#2e2408] text-[#fbbf24] border-[#f59e0b]/40",
    answered: "bg-[#15291c] text-[#86efac] border-[#4ade80]/30",
    closed: "bg-[#1f251d] text-[#a3adb9] border-[#9ca3af]/40",
    present: "bg-[#15291c] text-[#86efac] border-[#4ade80]/30",
    absent: "bg-[#331215] text-[#fca5a5] border-[#f87171]/40",
    excused: "bg-[#2e2408] text-[#fbbf24] border-[#f59e0b]/40",
    male: "bg-[#141c2e] text-[#93b4f8] border-[#6366f1]/40",
    female: "bg-[#2e1422] text-[#f2a6cf] border-[#ec4899]/40",
    inProgress: "bg-[#2e2408] text-[#fbbf24] border-[#f59e0b]/40",
    notStarted: "bg-[#1f251d] text-[#a3adb9] border-[#9ca3af]/40",
    activeMember: "bg-[#15291c] text-[#86efac] border-[#4ade80]/30",
    inactive: "bg-[#1f251d] text-[#a3adb9] border-[#9ca3af]/40",
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
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        colors[status] ?? "bg-muted text-muted-foreground border-border",
        className,
      )}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{
          background:
            FOLLOWUP_STATUS_COLORS[status as FollowupStatus] ??
            (status === "answered" || status === "completed" || status === "present"
              ? "#86efac"
              : status === "pending" || status === "active" || status === "excused"
                ? "#fbbf24"
                : status === "missed" || status === "absent"
                  ? "#f87171"
                  : "#9ca3af"),
        }}
      />
      {label}
    </span>
  );
}

export function StagePill({ stage, className }: { stage?: string; className?: string }) {
  if (!stage) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border border-primary/30 bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground",
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
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-primary">❯</span>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
          {code && (
            <span className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
              {code}
            </span>
          )}
        </div>
        {description && (
          <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
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
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-14 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-muted">
        <Inbox className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-semibold">{title}</p>
      {message && <p className="mt-1 max-w-sm text-xs text-muted-foreground">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function fmtDate(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en", { day: "2-digit", month: "short", year: "numeric" });
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

export function waLink(number?: string, text?: string) {
  if (!number) return "#";
  const digits = number.replace(/[^0-9]/g, "");
  const url = `https://wa.me/${digits}`;
  return text ? `${url}?text=${encodeURIComponent(text)}` : url;
}

export function smsLink(number?: string, text?: string) {
  if (!number) return "#";
  const digits = number.replace(/[^0-9]/g, "");
  return `sms:${digits}${text ? `?body=${encodeURIComponent(text)}` : ""}`;
}

export function telLink(number?: string) {
  if (!number) return "#";
  return `tel:${number.replace(/[^0-9+]/g, "")}`;
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

export function progressColor(pct: number) {
  if (pct >= 75) return "#86efac";
  if (pct >= 40) return "#fbbf24";
  return "#f87171";
}
