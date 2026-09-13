import { useAuth } from "@/hooks/use-auth";
import { useAuthActions } from "@convex-dev/auth/react";
import { Loader2 } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, user } = useAuth();
  const { signOut } = useAuthActions();
  const location = useLocation();

  // A session can outlive its user record — e.g. an administrator removed the
  // account while it was still signed in. Clear the token instead of leaving
  // the browser looping on protected screens with no profile behind it.
  const isOrphanedSession = !isLoading && isAuthenticated && !user;

  useEffect(() => {
    if (isOrphanedSession) void signOut();
  }, [isOrphanedSession, signOut]);

  if (isLoading || isOrphanedSession) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!isAuthenticated) {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to={`/auth?returnTo=${encodeURIComponent(returnTo)}`}
        replace
      />
    );
  }

  return children;
}
