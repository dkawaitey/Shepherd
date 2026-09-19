import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router";
import { Bell, BellRing, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/components/shared";

/**
 * In-app notification bell. The durable counterpart to a device push: it shows
 * alerts (like an account waiting on a member link) for anyone signed in, even
 * with no device registered, and keeps each one until it is read.
 */
export function NotificationBell() {
  const navigate = useNavigate();
  const items = useQuery(api.inbox.list, {});
  const unread = useQuery(api.inbox.unreadCount) ?? 0;
  const markRead = useMutation(api.inbox.markRead);
  const markAllRead = useMutation(api.inbox.markAllRead);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={
            unread > 0 ? `Notifications (${unread} unread)` : "Notifications"
          }
        >
          {unread > 0 ? (
            <BellRing className="h-5 w-5" />
          ) : (
            <Bell className="h-5 w-5" />
          )}
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-xs font-semibold">Notifications</span>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => void markAllRead({})}
            >
              <CheckCheck className="mr-1 h-3 w-3" /> Mark all read
            </Button>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {items === undefined ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-10 animate-pulse rounded bg-muted"
                />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="px-3 py-8 text-center text-[11px] text-muted-foreground">
              You're all caught up.
            </p>
          ) : (
            items.map((n) => (
              <DropdownMenuItem
                key={n._id}
                onClick={() => {
                  void markRead({ id: n._id });
                  navigate(n.url);
                }}
                className={cn(
                  "flex items-start gap-2 border-b px-3 py-2.5 last:border-b-0",
                  !n.read && "bg-primary/5",
                )}
              >
                <span
                  className={cn(
                    "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                    n.read ? "bg-transparent" : "bg-primary",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-semibold">
                    {n.title}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    {n.body}
                  </span>
                  <span className="mt-1 block text-[9px] uppercase tracking-wide text-muted-foreground/70">
                    {fmtDateTime(new Date(n.createdAt).toISOString())}
                  </span>
                </span>
              </DropdownMenuItem>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
