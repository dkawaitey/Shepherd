import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { canAddRecords, formatRoles } from "@/components/shared";
import { ROLES, ROLE_LABELS, Role } from "@/convex/constants";
import { TestAsDialog } from "@/components/test-as-dialog";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  BarChart3,
  BellRing,
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
  FlaskConical,
} from "lucide-react";
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
import { usePushNotifications } from "@/hooks/use-push-notifications";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, code: "D" },
  { to: "/contacts", label: "Contacts", icon: Users, code: "C" },
  { to: "/followups", label: "Follow-ups", icon: ClipboardList, code: "F" },
  { to: "/discipleship", label: "Discipleship", icon: Sparkles, code: "DS" },
  { to: "/bible-studies", label: "Bible Studies", icon: BookOpen, code: "B" },
  { to: "/members", label: "Members", icon: Users, code: "M" },
  { to: "/attendance", label: "Attendance", icon: CalendarCheck2, code: "A" },
  { to: "/prayer-journal", label: "Prayer Journal", icon: HandHeart, code: "P" },
  { to: "/announcements", label: "Announcements", icon: Megaphone, code: "AN" },
  { to: "/reports", label: "Reports", icon: FileBarChart, code: "R" },
  { to: "/analytics", label: "Analytics", icon: BarChart3, code: "ANL" },
  { to: "/settings", label: "Settings", icon: Settings, code: "S" },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  const { user } = useAuth();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <img
          src="/sidebar-logo.png"
          alt="Shepherd"
          className="h-8 w-8 object-contain"
        />
        <span className="text-sm font-bold tracking-tight">Shepherd</span>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {NAV.map((item) => {
          // Hide analytics for non-admins
          if (item.to === "/analytics" && user?.role !== ROLES.ADMIN) return null;
          const Icon = item.icon;
          const active =
            location.pathname === item.to ||
            location.pathname.startsWith(item.to + "/");
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={cn(
                "group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
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

    </div>
  );
}

export function AppShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const bootstrapAdmin = useMutation(api.users.bootstrapAdmin);
  const autoLink = useMutation(api.users.autoLinkAccount);
  const push = usePushNotifications(!!user);
  const [pushDismissed, setPushDismissed] = useState(false);
  const [pushEnabling, setPushEnabling] = useState(false);
  const showPushBanner = !!user && push.supported && !push.subscribed && push.permission !== "denied" && !pushDismissed;

  useEffect(() => {
    if (user && !user.memberId) {
      autoLink().catch(() => undefined);
    }
  }, [user, autoLink]);

  const endTest = () => {
    setTestAs({ role: undefined })
      .then(() => toast.success("Test ended — back to your normal role"))
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : "Failed to end test"),
      );
  };

  const [testAsOpen, setTestAsOpen] = useState(false);
  const setTestAs = useMutation(api.users.setTestAs);

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
        <SidebarContent />
      </aside>

      {/* Mobile sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <SidebarContent onNavigate={() => setMobileOpen(false)} />
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
              {current?.label ?? location.pathname}
            </div>
          </div>


          <ThemeToggle />

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

        {user?.testAs && (
          <div className="flex items-center justify-between gap-3 border-b border-[#f59e0b]/40 bg-[#2e2408] px-4 py-2 text-[11px] text-[#fbbf24] md:px-6">
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
              className="h-6 shrink-0 px-2 text-[10px]"
              onClick={endTest}
            >
              End test
            </Button>
          </div>
        )}

        {showPushBanner && (
          <div className="flex items-center justify-between gap-3 border-b border-primary/20 bg-primary/5 px-4 py-2 text-[11px] text-foreground md:px-6">
            <span className="flex min-w-0 items-center gap-2">
              <BellRing className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="truncate">
                Enable device notifications to receive follow-up reminders and announcements even when the app is closed.
              </span>
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                className="h-6 shrink-0 px-2 text-[10px]"
                disabled={pushEnabling}
                onClick={async () => {
                  setPushEnabling(true);
                  try {
                    const res = await push.enable();
                    if (res.ok) toast.success("Device notifications enabled!");
                    else toast.error(res.reason ?? "Could not enable notifications");
                  } finally {
                    setPushEnabling(false);
                  }
                }}
              >
                {pushEnabling ? "Enabling\u2026" : "Enable"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 shrink-0 px-2 text-[10px] text-muted-foreground"
                onClick={() => setPushDismissed(true)}
              >
                Dismiss
              </Button>
            </div>
          </div>
        )}

        <main className="flex-1 px-4 py-6 md:px-6">
          <Outlet />
        </main>
      </div>

      <TestAsDialog open={testAsOpen} onOpenChange={setTestAsOpen} />
    </div>
  );
}
