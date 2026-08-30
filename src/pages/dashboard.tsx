import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FOLLOWUP_TYPE_LABELS,
  FOLLOWUP_STATUS,
  FOLLOWUP_STATUS_COLORS,
  FollowupStatus,
} from "@/convex/constants";
import { StatusPill, fmtDate, fmtDateTime } from "@/components/shared";
import { cn } from "@/lib/utils";
import {
  TriangleAlert,
  Baby,
  Bell,
  CalendarCheck,
  Church,
  ClipboardCheck,
  Award,
  Flame,
  HeartHandshake,
  MapPin,
  MessageCircle,
  Target,
  TrendingUp,
  ContactRound,
} from "lucide-react";
import { Link } from "react-router";

const CARDS = [
  { key: "totalReached", label: "Total People Reached", to: "/contacts", icon: ContactRound, accent: "#9db392" },
  { key: "activeFollowups", label: "Active Follow-ups", to: "/followups?status=pending", icon: CalendarCheck, accent: "#fbbf24" },
  { key: "newConverts", label: "New Converts", to: "/contacts?status=newConvert", icon: Target, accent: "#86b26f" },
  { key: "baptized", label: "Baptized Members", to: "/contacts?status=baptized", icon: Baby, accent: "#a8c49d" },
  { key: "joinedChurch", label: "Joined Church", to: "/contacts?status=joinedChurch", icon: Church, accent: "#bcd2b0" },
  { key: "completedDiscipleship", label: "Completed Discipleship", to: "/contacts?status=completedDiscipleship", icon: Award, accent: "#c2d4a8" },
  { key: "missedFollowups", label: "Missed Follow-ups", to: "/followups?status=missed", icon: TriangleAlert, accent: "#f87171" },
  { key: "upcomingVisitsThisWeek", label: "Upcoming Visits This Week", to: "/followups?status=pending", icon: Flame, accent: "#fbbf24" },
];

// ---------- Month calendar ----------
function buildMonthGrid(year: number, month: number) {
  const first = new Date(year, month, 1);
  const startDay = first.getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function FollowupCalendar({ events }: { events: any[] }) {
  const navigate = useNavigate();
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [selected, setSelected] = useState<any[] | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");

  const cells = useMemo(() => buildMonthGrid(cursor.y, cursor.m), [cursor]);
  const byDate = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const ev of events) {
      const key = ev.date.slice(0, 10);
      (map[key] ??= []).push(ev);
    }
    return map;
  }, [events]);

  const monthLabel = new Date(cursor.y, cursor.m).toLocaleString("en", {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-bold">{monthLabel}</span>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }))
            }
          >
            ←
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setCursor({ y: today.getFullYear(), m: today.getMonth() });
            }}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }))
            }
          >
            →
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, i) => {
          if (!date) return <div key={i} className="min-h-16 rounded-md border border-dashed border-border/60" />;
          const key = date.toISOString().slice(0, 10);
          const dayEvents = byDate[key] ?? [];
          const isToday = date.toDateString() === today.toDateString();
          return (
            <button
              key={i}
              onClick={() => {
                if (dayEvents.length) {
                  setSelected(dayEvents);
                  setSelectedDate(key);
                }
              }}
              className={cn(
                "flex min-h-16 flex-col items-stretch gap-0.5 rounded-md border p-1 text-left transition-colors",
                isToday ? "border-primary/50 bg-accent/60" : "border-border bg-card",
                dayEvents.length ? "cursor-pointer hover:border-primary/60" : "cursor-default",
              )}
            >
              <span className={cn("text-[10px]", isToday && "font-bold text-primary")}>{date.getDate()}</span>
              {dayEvents.slice(0, 3).map((ev) => (
                <span
                  key={ev._id}
                  className="truncate rounded px-1 py-px text-[9px] leading-4"
                  style={{ background: `${FOLLOWUP_STATUS_COLORS[ev.status as FollowupStatus]}22`, color: FOLLOWUP_STATUS_COLORS[ev.status as FollowupStatus] }}
                >
                  {ev.contactName}
                </span>
              ))}
              {dayEvents.length > 3 && (
                <span className="px-1 text-[9px] text-muted-foreground">+{dayEvents.length - 3} more</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#fbbf24]" /> Pending</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#86efac]" /> Completed</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#f87171]" /> Missed</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#9ca3af]" /> Cancelled</span>
      </div>

      <Dialog open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Follow-ups — {fmtDate(selectedDate)}</DialogTitle>
            <DialogDescription>Click a person to open their profile and follow-up history.</DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {(selected ?? []).map((ev) => (
              <div
                key={ev._id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:border-primary/50"
                onClick={() => navigate(`/contacts/${ev.contactId}`)}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: FOLLOWUP_STATUS_COLORS[ev.status as FollowupStatus] }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{ev.contactName}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {FOLLOWUP_TYPE_LABELS[ev.type]} · {ev.assignedWorker || "Unassigned"}
                  </div>
                </div>
                <StatusPill status={ev.status} />
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Page ----------
export default function Dashboard() {
  const navigate = useNavigate();
  const me = useQuery(api.users.currentUser);
  const stats = useQuery(api.dashboard.stats);
  const posts = useQuery(api.posts.list, {});

  const rawName = (me?.name || me?.email || "").split(/[\s@.]/).filter(Boolean)[0];
  const firstName = rawName
    ? rawName[0]!.toUpperCase() + rawName.slice(1)
    : "friend";

  if (!stats) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg border bg-card" />
          ))}
        </div>
      </div>
    );
  }

  const maxFunnel = Math.max(1, stats.funnel[0]?.count ?? 1);
  const maxGender = Math.max(1, ...stats.gender.map((g) => g.count));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-primary">❯</span>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Serve Your Creator Now, {firstName}
          </h1>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {CARDS.map((c) => {
          const Icon = c.icon;
          return (
            <button
              key={c.key}
              onClick={() => navigate(c.to)}
              className="group rounded-lg border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <span className="term-label">{c.label}</span>
                <Icon className="h-4 w-4 text-muted-foreground group-hover:text-primary" style={{ color: c.accent }} />
              </div>
              <div className="mt-2 font-mono text-3xl font-bold tabular-nums" style={{ color: c.accent }}>
                {stats.cards[c.key as keyof typeof stats.cards]}
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground group-hover:text-primary">
                open →
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Funnel */}
        <div className="rounded-lg border bg-card p-4 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <p className="term-label">conversion funnel</p>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            {stats.funnel.map((f) => (
              <div key={f.stage}>
                <div className="mb-1 flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">{f.label}</span>
                  <span className="font-mono font-semibold tabular-nums">{f.count}</span>
                </div>
                <div className="h-3 overflow-hidden rounded-sm bg-muted">
                  <div
                    className="h-full rounded-sm bg-[#8faf8a] transition-all"
                    style={{ width: `${Math.max(2, (f.count / maxFunnel) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] text-muted-foreground">
            Each stage counts everyone at-or-beyond that milestone — people move toward serving and leadership.
          </p>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Gender */}
          <div className="rounded-lg border bg-card p-4">
            <p className="term-label mb-3">gender distribution</p>
            <div className="space-y-3">
              {stats.gender.map((g) => (
                <div key={g.label}>
                  <div className="mb-1 flex justify-between text-[11px]">
                    <span className="text-muted-foreground">{g.label}</span>
                    <span className="font-mono font-semibold tabular-nums">{g.count}</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-sm bg-muted">
                    <div
                      className={cn("h-full rounded-sm", g.label === "Male" ? "bg-[#9db392]" : "bg-[#a8b98e]")}
                      style={{ width: `${(g.count / maxGender) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Prayer summary */}
          <div className="rounded-lg border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="term-label">prayer journal summary</p>
              <HeartHandshake className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-md border border-[#f59e0b]/40 bg-[#2e2408] py-2">
                <div className="font-mono text-lg font-bold text-status-amber">{stats.prayers.activeCount}</div>
                <div className="text-[9px] uppercase tracking-wide text-status-amber">active requests</div>
              </div>
              <div className="rounded-md border border-[#86efac]/40 bg-[#15291c] py-2">
                <div className="font-mono text-lg font-bold text-status-green">{stats.prayers.answeredCount}</div>
                <div className="text-[9px] uppercase tracking-wide text-status-green">answered</div>
              </div>
            </div>
            <div className="space-y-2">
              {stats.prayers.recent.slice(0, 3).map((p) => (
                <Link
                  key={p._id}
                  to={`/contacts/${p.contactId}`}
                  className="flex items-start gap-2 rounded-md border border-transparent p-1.5 transition-colors hover:border-primary/40 hover:bg-muted/40"
                >
                  <span className={cn(
                    "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                    p.status === "active" ? "bg-[#fbbf24]" : p.status === "answered" ? "bg-[#86efac]" : "bg-[#9ca3af]",
                  )} />
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] font-semibold">{p.contactName}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{p.summary}</span>
                    <span className="block text-[9px] text-muted-foreground/70">{fmtDateTime(new Date(p.updatedAt).toISOString())}</span>
                  </span>
                </Link>
              ))}
              {stats.prayers.recent.length === 0 && (
                <p className="py-2 text-center text-[11px] text-muted-foreground">No prayer requests yet</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Follow-up calendar */}
        <div className="rounded-lg border bg-card p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <p className="term-label">follow-up schedule</p>
            <span className="text-[10px] text-muted-foreground">
              {stats.upcomingFollowups.length} upcoming
            </span>
          </div>
          <FollowupCalendar events={stats.upcomingFollowups} />
        </div>

        {/* Reminders */}
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="term-label">reminders</p>
            <Bell className="h-4 w-4 text-muted-foreground" />
          </div>
          {stats.reminders.length === 0 ? (
            <p className="py-6 text-center text-[11px] text-muted-foreground">
              All clear — no pending reminders.
            </p>
          ) : (
            <div className="max-h-[420px] space-y-2 overflow-y-auto">
              {stats.reminders.slice(0, 8).map((r, i) => (
                <Link
                  key={i}
                  to={r.link}
                  className="block rounded-md border border-[#f59e0b]/40 bg-[#2e2408]/80 p-2.5 transition-colors hover:border-[#f59e0b]/70"
                >
                  <div className="text-[11px] font-bold text-status-amber">{r.title}</div>
                  <div className="mt-0.5 text-[10px] leading-4 text-status-amber/80">{r.message}</div>
                </Link>
              ))}
            </div>
          )}
          <div className="mt-3 space-y-1.5 border-t pt-3">
            {[
              { icon: MessageCircle, text: "WhatsApp reminders", href: "#" },
              { icon: MapPin, text: "Get directions to visits", href: "https://maps.google.com" },
            ].map((x) => (
              <a
                key={x.text}
                href={x.href}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-[11px] text-muted-foreground hover:text-primary"
              >
                <x.icon className="h-3.5 w-3.5" /> {x.text}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Latest team updates */}
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="term-label">latest updates</p>
          <Link to="/announcements" className="text-[10px] text-primary hover:underline">
            all posts →
          </Link>
        </div>
        {(posts ?? []).length === 0 ? (
          <p className="py-3 text-center text-[11px] text-muted-foreground">
            No team posts yet — share the first update in Announcements.
          </p>
        ) : (
          <div className="space-y-2">
            {(posts ?? []).slice(0, 4).map((p) => (
              <Link
                key={p._id}
                to="/announcements"
                className="flex items-start gap-2.5 rounded-md border border-transparent p-2 transition-colors hover:border-primary/40 hover:bg-muted/40"
              >
                <span className="mt-0.5 text-[10px] font-bold text-primary">❯</span>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-semibold">{p.title}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {p.author} · {fmtDate(new Date(p.createdAt).toISOString())}
                  </span>
                </span>
                {p.commentCount > 0 && (
                  <span className="ml-auto shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                    {p.commentCount} 💬
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Upcoming this week */}
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="term-label">upcoming follow-ups</p>
          <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
        </div>
        {stats.upcomingFollowups.length === 0 ? (
          <p className="py-4 text-center text-[11px] text-muted-foreground">
            No follow-ups scheduled. Head to the Follow-ups tab to schedule one.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {stats.upcomingFollowups.slice(0, 9).map((f) => (
              <Link
                key={f._id}
                to={`/contacts/${f.contactId}`}
                className="flex items-center gap-3 rounded-md border p-2.5 transition-colors hover:border-primary/50 hover:bg-muted/40"
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-[#fbbf24]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-semibold">{f.contactName}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {FOLLOWUP_TYPE_LABELS[f.type]} · {fmtDate(f.date)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
