import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import {
  effectiveUserRoles,
  formatRoles,
  formatError,
  userIsAdmin,
} from "@/components/shared";
import { ROLES, ROLE_LABELS, Role } from "@/convex/constants";
import { TestAsDialog } from "@/components/test-as-dialog";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BellRing,
  BookMarked,
  CalendarCheck,
  ClipboardCheck,
  DoorOpen,
  FileBarChart,
  Heart,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  ScrollText,
  Settings,
  Sparkle,
  UserRound,
  ContactRound,
  FlaskConical,
  ShieldAlert,
  UserCog,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { releaseDevicePush, usePushNotifications } from "@/hooks/use-push-notifications";
import { clearOfflineQueue, useOfflineSync } from "@/lib/offline-sync";
import { CloudOff, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/components/notification-bell";
import { RouteErrorBoundary } from "@/components/error-boundary";
import { preloadRoute, preloadWhenIdle } from "@/lib/route-loaders";

/** Sidebar sections, in reading order. */
const GROUPS = ["Ministry", "Community", "Insight", "System"] as const;
type Group = (typeof GROUPS)[number];

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  code: string;
  group: Group;
  adminOnly?: boolean;
  /** Ministry records are limited to accounts that hold a ministry role. */
  ministryOnly?: boolean;
};

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, code: "D", group: "Ministry" },
  { to: "/contacts", label: "Contacts", icon: ContactRound, code: "C", group: "Ministry", ministryOnly: true },
  { to: "/followups", label: "Follow-ups", icon: ClipboardCheck, code: "F", group: "Ministry", ministryOnly: true },
  { to: "/discipleship", label: "Discipleship", icon: Sparkle, code: "DS", group: "Ministry", ministryOnly: true },
  { to: "/bible-studies", label: "Bible Studies", icon: BookMarked, code: "B", group: "Ministry", ministryOnly: true },
  { to: "/members", label: "Members", icon: UserRound, code: "M", group: "Ministry", ministryOnly: true },
  { to: "/attendance", label: "Attendance", icon: CalendarCheck, code: "A", group: "Ministry", ministryOnly: true },
  { to: "/prayer-journal", label: "Prayer Journal", icon: Heart, code: "P", group: "Ministry", ministryOnly: true },
  { to: "/announcements", label: "Announcements", icon: Megaphone, code: "AN", group: "Community" },
  { to: "/constitution", label: "Constitution", icon: ScrollText, code: "CN", group: "Community" },
  { to: "/reports", label: "Reports", icon: FileBarChart, code: "R", group: "Insight", ministryOnly: true },
  { to: "/analytics", label: "Analytics", icon: BarChart3, code: "ANL", group: "Insight", ministryOnly: true },
  { to: "/settings", label: "Settings", icon: Settings, code: "S", group: "System" },
  {
    to: "/access",
    label: "Access",
    icon: UserCog,
    code: "AC",
    group: "System",
    adminOnly: true,
    ministryOnly: true,
  },
  {
    to: "/error-log",
    label: "Error Log",
    icon: ShieldAlert,
    code: "EL",
    group: "System",
    adminOnly: true,
    ministryOnly: true,
  },
];

/**
 * Accounts that may see ministry records: signed-in, not a guest, and holding
 * a ministry role. Mirrors `canReadMinistry` in convex/helpers.ts: a linked
 * member profile on its own (an Ordinary Member holds no system role) reads
 * only announcements and its own profile. An account with no linked profile
 * never reaches the shell — RequireAuth shows it the "link your profile"
 * screen first.
 */
function hasMinistryAccess(user: {
  role?: string;
  roles?: string[];
  testAs?: string;
  memberId?: string;
  isAnonymous?: boolean;
} | null | undefined) {
  if (!user || user.isAnonymous) return false;
  return effectiveUserRoles(user).length > 0;
}

function Brand({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", collapsed && "justify-center")}>
      <div className="relative grid size-9 shrink-0 place-items-center rounded-xl border border-border/70 bg-gradient-to-br from-primary/12 to-gold/12 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
        <img
          src="/sidebar-logo.png"
          alt=""
          className="size-6 object-contain dark:hidden"
        />
        <img
          src="/sidebarr-logo.png"
          alt=""
          className="hidden size-6 object-contain dark:block"
        />
      </div>
      {!collapsed && (
        <div className="min-w-0">
          <div className="display-title truncate text-[15px] leading-none text-foreground">
            Shepherd
          </div>
          <div className="mt-1 truncate font-mono text-[8.5px] uppercase tracking-[0.16em] text-muted-foreground/80">
            Youth Ministry
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarContent({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  /** Icon-only rail on desktop; never used for the mobile sheet. */
  collapsed?: boolean;
}) {
  const location = useLocation();
  const { user } = useAuth();

  const isActive = (to: string) =>
    location.pathname === to || location.pathname.startsWith(to + "/");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn("pt-5 pb-4", collapsed ? "px-2" : "px-4")}>
        <Brand collapsed={collapsed} />
      </div>
      <div className={cn("rule-fade", collapsed ? "mx-2" : "mx-4")} />
      <nav
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain py-3",
          collapsed ? "px-2" : "px-2.5",
        )}
      >
        {GROUPS.map((group) => {
          const items = NAV.filter((item) => {
            if (item.group !== group) return false;
            // Ministry records need a real (non-guest) account; guests only get
            // announcements and their own settings.
            if (item.ministryOnly && !hasMinistryAccess(user)) return false;
            // Analytics, access review and the error log are administrator-only.
            if ((item.adminOnly || item.to === "/analytics") && !userIsAdmin(user))
              return false;
            return true;
          });
          if (items.length === 0) return null;
          return (
            <div key={group} className="mb-1.5">
              {collapsed ? (
                <div className="rule-fade mx-1.5 my-2" />
              ) : (
                <p className="term-label px-2.5 pt-2 pb-1.5 text-[9px] text-muted-foreground/65">
                  {group}
                </p>
              )}
              <div className="space-y-0.5">
                {items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.to);
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={onNavigate}
                      // Start the page's download as soon as the pointer or a
                      // finger lands on the link, not after the tap resolves.
                      onPointerEnter={() => preloadRoute(item.to)}
                      onTouchStart={() => preloadRoute(item.to)}
                      onFocus={() => preloadRoute(item.to)}
                      aria-current={active ? "page" : undefined}
                      aria-label={collapsed ? item.label : undefined}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "group relative flex items-center rounded-[10px] text-[13px] tracking-[-0.01em] transition-[background-color,color,box-shadow] duration-150",
                        collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-2.5 py-2",
                        active
                          ? "bg-primary/[0.09] font-medium text-primary ring-1 ring-primary/12"
                          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                      )}
                    >
                      {active && (
                        <span
                          className={cn(
                            "absolute top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary",
                            collapsed ? "left-0" : "-left-2.5",
                          )}
                        />
                      )}
                      <Icon
                        className={cn(
                          "h-4 w-4 shrink-0 transition-colors",
                          active
                            ? "text-primary"
                            : "text-muted-foreground/85 group-hover:text-foreground",
                        )}
                      />
                      {!collapsed && (
                        <>
                          <span className="flex-1 truncate">{item.label}</span>
                          <span
                            className={cn(
                              "font-mono text-[8.5px] uppercase tracking-[0.1em] transition-opacity",
                              active
                                ? "text-primary/60"
                                : "text-muted-foreground/40 opacity-0 group-hover:opacity-100",
                            )}
                          >
                            {item.code}
                          </span>
                        </>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
      <div className={cn("rule-fade", collapsed ? "mx-2" : "mx-4")} />
      <div className={cn("py-4", collapsed ? "px-2" : "px-4")}>
        {collapsed ? (
          <p className="text-center font-mono text-[8px] uppercase tracking-[0.14em] text-muted-foreground/50">
            GH
          </p>
        ) : (
          <>
            <p className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-muted-foreground/60">
              Gethsemane · Ghana
            </p>
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground/80">
              Discipleship management
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export function AppShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Desktop rail: 240px with labels, or a 68px icon rail. Remembered per
  // device so a narrow laptop keeps the choice between visits.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("shepherd:sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("shepherd:sidebar-collapsed", next ? "1" : "0");
      } catch {
        // Private-mode storage can refuse writes; the choice still applies now.
      }
      return next;
    });
  };
  const touchActivity = useMutation(api.users.touchActivity);
  // Queued offline records belonging to this account (see lib/offline-sync).
  const offline = useOfflineSync(user?._id);

  const [pushDismissed, setPushDismissed] = useState(false);
  const push = usePushNotifications(!!user);
  const pushSupported = typeof Notification !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
  const showPushBanner = user && pushSupported && !push.subscribed && push.permission !== "denied" && !pushDismissed;

  // Warm the chunks this worker is likely to open next, once the page they came
  // for has painted. Tapping a nav entry then swaps straight to the page
  // instead of downloading its module behind a loading splash.
  const canMinistry = hasMinistryAccess(user);
  const admin = userIsAdmin(user);
  const userId = user?._id;
  useEffect(() => {
    if (!userId) return;
    const next = NAV.filter((item) => {
      if (item.ministryOnly && !canMinistry) return false;
      if ((item.adminOnly || item.to === "/analytics") && !admin) return false;
      return item.to !== location.pathname;
    })
      .slice(0, 6)
      .map((item) => item.to);
    preloadWhenIdle(next);
    // Only the account and what it may open decide the list; the current path
    // is read so the page already on screen is not fetched twice.
  }, [userId, canMinistry, admin, location.pathname]);

  const endTest = () => {
    setTestAs({ role: undefined })
      .then(() => toast.success("Test ended — back to your normal role"))
      .catch((err) =>
        toast.error(formatError(err, "Failed to end test")),
      );
  };

  const [testAsOpen, setTestAsOpen] = useState(false);
  const setTestAs = useMutation(api.users.setTestAs);

  // "App opened" heartbeat: keeps users.lastActiveAt fresh so the Members page
  // can flag accounts that have not signed in or opened the app for a long
  // time. Pings on open and whenever the tab becomes visible again, at most
  // once an hour per account (the mutation enforces the same interval).
  useEffect(() => {
    if (!user || user.isAnonymous) return;
    const storageKey = `shepherd:activity:${user._id}`;
    const ping = () => {
      const last = Number(localStorage.getItem(storageKey) ?? 0);
      if (Number.isFinite(last) && Date.now() - last < 60 * 60 * 1000) return;
      localStorage.setItem(storageKey, String(Date.now()));
      touchActivity().catch(() => localStorage.removeItem(storageKey));
    };
    ping();
    const onVisible = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [user?._id, user?.isAnonymous, touchActivity]);

  const current = NAV.find(
    (n) =>
      location.pathname === n.to || location.pathname.startsWith(n.to),
  );

  const handleSignOut = async () => {
    // Never leave another volunteer's contact details in this device's storage.
    clearOfflineQueue();
    await releaseDevicePush();
    await signOut();
    navigate("/");
  };

  const initials = (user?.name || user?.email || "U")
    .split(/[\s@.]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar. Pinned to the viewport rather than the page, so
          scrolling the app never drags it along — only its own nav list
          scrolls, and only when the list is taller than the screen. */}
      <aside
        className={cn(
          "glass-sidebar fixed inset-y-0 left-0 z-30 hidden overflow-hidden bg-sidebar transition-[width] duration-200 ease-out md:block",
          collapsed ? "w-[4.25rem]" : "w-60",
        )}
      >
        <SidebarContent collapsed={collapsed} />
      </aside>

      {/* Mobile sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[17rem] p-0">
          <SidebarContent onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div
        className={cn(
          "relative z-10 flex min-w-0 flex-1 flex-col transition-[padding] duration-200 ease-out",
          collapsed ? "md:pl-[4.25rem]" : "md:pl-60",
        )}
      >
        {/* Topbar */}
        <header className="glass-topbar sticky top-0 z-20 flex h-14 items-center gap-3 bg-background/70 px-4 md:h-16 md:px-7">
          <Button
            variant="ghost"
            size="icon"
            className="-ml-1.5 md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="-ml-1.5 hidden md:inline-flex"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </Button>
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <div className="min-w-0">
              <div className="truncate font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/70">
                {current?.group ?? "Shepherd"}
              </div>
              <div className="truncate text-[14px] font-semibold tracking-[-0.02em]">
                {current?.label ?? location.pathname}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-0.5 rounded-full border border-border/60 bg-card/40 p-0.5">
            <ThemeToggle />
            <NotificationBell />
          </div>

          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 rounded-full px-1.5">
                <Avatar className="size-7">
                  <AvatarFallback className="bg-gradient-to-br from-primary/25 to-gold/20 text-[11px] font-bold text-primary">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden max-w-32 truncate text-xs font-medium lg:block">
                  {user?.name || user?.email}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel>
                <div className="truncate text-sm font-semibold">
                  {user?.name || "Ministry worker"}
                </div>
                <div className="truncate text-[11px] font-normal text-muted-foreground">
                  {user?.email}
                </div>
                <Badge variant="secondary" className="mt-2 text-[10px]">
                  {formatRoles(user)}
                </Badge>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {user?.realRole === "admin" && (
                <DropdownMenuItem onClick={() => setTestAsOpen(true)}>
                  <FlaskConical className="mr-2 h-4 w-4" /> Test as…
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => navigate("/settings")}>
                <Settings className="mr-2 h-4 w-4" /> Settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/reports")}>
                <DoorOpen className="mr-2 h-4 w-4" /> Reports
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleSignOut}
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {offline.pending.length > 0 && (
          <div className="flex items-center justify-between gap-3 border-b border-status-amber/25 bg-status-amber/[0.08] px-4 py-2 text-[11px] text-status-amber md:px-7">
            <span className="flex min-w-0 items-center gap-2">
              <CloudOff className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {offline.pending.length === 1
                  ? "1 record saved offline on this device"
                  : `${offline.pending.length} records saved offline on this device`}
                {offline.lastError ? ` — ${offline.lastError}` : ""}
              </span>
            </span>
            <div className="flex shrink-0 gap-1">
              <Button
                size="sm"
                className="h-6 px-2 text-[10px]"
                disabled={offline.syncing}
                onClick={() => void offline.syncNow()}
              >
                <RefreshCw className={cn("mr-1 h-3 w-3", offline.syncing && "animate-spin")} />
                {offline.syncing ? "Syncing…" : "Sync now"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px] text-status-amber hover:bg-status-amber/10 hover:text-status-amber"
                onClick={() => {
                  offline.discard();
                  toast.success("Offline records discarded");
                }}
              >
                Discard
              </Button>
            </div>
          </div>
        )}

        {user?.testAs && (
          <div className="flex items-center justify-between gap-3 border-b border-status-amber/25 bg-status-amber/[0.08] px-4 py-2 text-[11px] text-status-amber md:px-7">
            <span className="flex min-w-0 items-center gap-2">
              <FlaskConical className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                Testing as{" "}
                <b>{ROLE_LABELS[user.testAs as Role] ?? user.testAs}</b>
                {user.testAs === ROLES.CLASS_LEADER && user.classScope
                  ? ` · ${user.classScope} Class`
                  : ""}{" "}
                — you have that role's permissions only.
              </span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 shrink-0 px-2 text-[10px] text-status-amber hover:bg-status-amber/10 hover:text-status-amber"
              onClick={endTest}
            >
              End test
            </Button>
          </div>
        )}

        {showPushBanner && (
          <div className="flex items-center justify-between gap-3 border-b border-primary/20 bg-primary/[0.06] px-4 py-2 text-[11px] text-foreground md:px-7">
            <span className="flex min-w-0 items-center gap-2">
              <BellRing className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="truncate">
                Enable device notifications to receive follow-up reminders and announcements even when the app is closed.
              </span>
            </span>
            <div className="flex shrink-0 gap-1">
              <Button
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={async () => {
                  const res = await push.enable();
                  if (res.ok) toast.success("Notifications enabled");
                  else toast.error(res.reason);
                }}
              >
                Enable
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px]"
                onClick={() => setPushDismissed(true)}
              >
                Dismiss
              </Button>
            </div>
          </div>
        )}

        <main className="flex-1 px-4 py-6 md:px-7 md:py-8">
          {/* A crashed page shows a recovery card here instead of blanking the
              whole app — the sidebar, topbar and notifications stay usable. */}
          <RouteErrorBoundary>
            <Outlet />
          </RouteErrorBoundary>
        </main>
      </div>

      <TestAsDialog open={testAsOpen} onOpenChange={setTestAsOpen} />
    </div>
  );
}
