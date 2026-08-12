import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { ROLE_LABELS } from "@/convex/constants";
import { useMutation, useQuery } from "convex/react";
import {
  BarChart3,
  Bell,
  BookOpen,
  CalendarCheck2,
  ClipboardList,
  DoorOpen,
  FileBarChart,
  HandHeart,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  ScrollText,
  Settings,
  Sparkles,
  Users,
  X,
  UserPlus,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { QuickAddContact } from "@/pages/contacts";
import { useOfflineSync } from "@/lib/offline-sync";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, code: "dash" },
  { to: "/contacts", label: "Contacts", icon: Users, code: "ppl" },
  { to: "/followups", label: "Follow-ups", icon: CalendarCheck2, code: "fup" },
  { to: "/discipleship", label: "Discipleship", icon: Sparkles, code: "disc" },
  { to: "/bible-studies", label: "Bible Studies", icon: BookOpen, code: "bs" },
  { to: "/members", label: "Members", icon: ScrollText, code: "mem" },
  { to: "/attendance", label: "Attendance", icon: ClipboardList, code: "att" },
  { to: "/prayer-journal", label: "Prayer Journal", icon: HandHeart, code: "pray" },
  { to: "/announcements", label: "Announcements", icon: Megaphone, code: "ann" },
  { to: "/reports", label: "Reports", icon: FileBarChart, code: "rpt" },
  { to: "/analytics", label: "Analytics", icon: BarChart3, code: "anl" },
  { to: "/settings", label: "Settings", icon: Settings, code: "cfg" },
] as const;

function SidebarContent({
  onNavigate,
  online,
  queued,
}: {
  onNavigate?: () => void;
  online: boolean;
  queued: number;
}) {
  const location = useLocation();
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary font-bold text-primary-foreground">
          S
        </div>
        <div className="leading-tight">
          <div className="text-sm font-bold tracking-[0.14em]">SHEPHERD</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            discipleship · v1.0
          </div>
        </div>
      </div>

      <div
        className={cn(
          "mx-5 mb-3 flex items-center gap-2 rounded-md border px-3 py-1.5 text-[11px]",
          online
            ? "border-border bg-muted/50 text-muted-foreground"
            : "border-[#f59e0b]/40 bg-[#2e2408] text-[#fbbf24]",
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            online ? "bg-[#86b26f] animate-pulse" : "bg-[#fbbf24]",
          )}
        />
        <span>
          gethsemane-ym{" "}
          <span className="opacity-60">
            {online ? "// connected" : "// offline"}
            {queued > 0 ? ` · ${queued} queued` : ""}
          </span>
        </span>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {NAV.map((item) => {
          const active =
            location.pathname === item.to ||
            location.pathname.startsWith(item.to);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={cn(
                "group flex items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-colors",
                active
                  ? "bg-accent font-semibold text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
              <span className="flex-1">{item.label}</span>
              <span className={cn("text-[10px] text-muted-foreground/60", !active && "opacity-0 group-hover:opacity-100")}>
                [{item.code}]
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t px-4 py-3">
        <div className="rounded-md border border-dashed px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
          Outreach → Follow-up → Discipleship →
          <br /> Integration → Service
        </div>
      </div>
    </div>
  );
}

export function AppShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const bootstrapAdmin = useMutation(api.users.bootstrapAdmin);
  const unread = useQuery(api.settings.unreadCount);
  const notifications = useQuery(api.settings.listNotifications);
  const markAllRead = useMutation(api.settings.markAllRead);
  const [mobileOpen, setMobileOpen] = useState(false);
  const offline = useOfflineSync();

  useEffect(() => {
    if (user && !user.role) {
      bootstrapAdmin().catch(() => undefined);
    }
  }, [user, bootstrapAdmin]);

  const current = NAV.find(
    (n) =>
      location.pathname === n.to || location.pathname.startsWith(n.to),
  );

  const handleSignOut = async () => {
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
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r bg-sidebar md:block">
        <SidebarContent online={offline.online} queued={offline.pending.length} />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <SidebarContent
            onNavigate={() => setMobileOpen(false)}
            online={offline.online}
            queued={offline.pending.length}
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col md:pl-60">
        {/* Topbar */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur md:px-6">
          <Button variant="ghost" size="icon" className="-ml-1 md:hidden" onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">
              <span className="mr-2 text-primary">~/shepherd</span>
              {current?.label ?? location.pathname}
            </div>
          </div>

          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => setQuickAddOpen(true)}
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Quick Add Contact</span>
            <span className="sm:hidden">Add</span>
          </Button>

          {/* Notifications */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="h-4.5 w-4.5" />
                {!!unread && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel className="flex items-center justify-between">
                Notifications
                {!!unread && (
                  <button
                    className="text-[11px] text-primary hover:underline"
                    onClick={() => markAllRead()}
                  >
                    mark all read
                  </button>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {!notifications || notifications.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No notifications yet
                </div>
              ) : (
                notifications.slice(0, 8).map((n) => (
                  <DropdownMenuItem
                    key={n._id}
                    className="cursor-pointer items-start gap-2 whitespace-normal py-2"
                    onClick={() => {
                      if (n.link) navigate(n.link);
                      markAllRead();
                    }}
                  >
                    <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", n.read ? "bg-border" : "bg-[#fbbf24]")} />
                    <span>
                      <span className="block text-xs font-semibold">{n.title}</span>
                      <span className="block text-[11px] text-muted-foreground">{n.message}</span>
                    </span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 px-1.5">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="bg-accent text-xs font-bold text-accent-foreground">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden max-w-32 truncate text-xs font-medium lg:block">
                  {user?.name || user?.email}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="truncate text-sm font-semibold">
                  {user?.name || "Ministry worker"}
                </div>
                <div className="truncate text-[11px] font-normal text-muted-foreground">
                  {user?.email}
                </div>
                <Badge variant="secondary" className="mt-1.5 text-[10px]">
                  {user?.role ? ROLE_LABELS[user.role] : "Pending role"}
                </Badge>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
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

        <main className="flex-1 px-4 py-6 md:px-6">
          <Outlet />
        </main>
      </div>

      <QuickAddContact open={quickAddOpen} onOpenChange={setQuickAddOpen} />
    </div>
  );
}
