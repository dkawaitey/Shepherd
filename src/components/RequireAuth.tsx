import { api } from "@/convex/_generated/api";
import { effectiveUserRoles } from "@/components/shared";
import { useAuth } from "@/hooks/use-auth";
import { useMutation } from "convex/react";
import { Button } from "@/components/ui/button";
import { Loader2, LogOut, UserX } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

/**
 * A signed-in account reaches the app only when it belongs to a member of this
 * deployment: either its member profile is linked, or it holds a ministry role
 * (which covers the administrator's own account).
 *
 * This is the app *entry* gate, and it is deliberately broader than the
 * server's `canReadMinistry`: a member whose profile is linked but who holds an
 * Ordinary Member position (no system role) still gets in — to read
 * announcements, their own profile and their own member record — while every
 * ministry-wide record stays closed to them (the dashboard explains this). The
 * server keeps that second, narrower line via `canReadMinistry`; here we only
 * decide whether the account has a place in the app at all.
 */
function accountHasAccess(
  user:
    | {
        roles?: string[];
        role?: string;
        testAs?: string;
        memberId?: string;
        isAnonymous?: boolean;
      }
    | null
    | undefined,
) {
  if (!user || user.isAnonymous) return false;
  return effectiveUserRoles(user).length > 0 || !!user.memberId;
}

/**
 * Shown to a real account that signed in but was never linked to a member
 * profile. Ministry records stay closed until an administrator links it, so we
 * explain the state, show the address they signed in with, and let them leave.
 */
function LinkProfileScreen({
  email,
  name,
  onSignOut,
}: {
  email?: string;
  name?: string;
  onSignOut: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <UserX className="h-6 w-6 text-muted-foreground" />
        </div>
        <h1 className="text-lg font-semibold">Your profile isn't linked yet</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You're signed in{name ? `, ${name}` : ""}
          {email ? (
            <>
              {" "}
              as <span className="font-medium text-foreground">{email}</span>
            </>
          ) : null}
          , but no member profile is linked to this account yet.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          An administrator needs to link your member profile in Shepherd before
          you can access the app. Once your profile is linked, sign in again and
          you'll be taken straight to your dashboard.
        </p>
        <Button variant="outline" className="mt-6 w-full" onClick={onSignOut}>
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </Button>
      </div>
    </main>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, user, signOut } = useAuth();
  const location = useLocation();

  const autoLink = useMutation(api.users.autoLinkAccount);
  const bootstrapAdmin = useMutation(api.users.bootstrapAdmin);
  const requestProfileLink = useMutation(api.users.requestProfileLink);

  // A session can outlive its user record — e.g. an administrator removed the
  // account while it was still signed in. Clear the token instead of leaving
  // the browser looping on protected screens with no profile behind it.
  const isOrphanedSession = !isLoading && isAuthenticated && !user;

  useEffect(() => {
    if (isOrphanedSession) void signOut();
  }, [isOrphanedSession, signOut]);

  const roleCount = effectiveUserRoles(user).length;
  const [linking, setLinking] = useState(false);

  // Runs before the gate so an account is never turned away by its own pending
  // setup. This is the flow the app shell used to run after mounting; it has to
  // live here now, because the shell never mounts for a gated account — which
  // is exactly what would have locked out the very first administrator.
  //
  //   - auto-link: match the account to a member record by email so a member
  //     who signed up starts with their ministry identity
  //   - bootstrap: the first real account on a fresh deployment becomes the
  //     administrator, so the ministry can manage roles (server decides)
  useEffect(() => {
    if (!user || user.isAnonymous) return;
    const tasks: Promise<unknown>[] = [];
    if (!user.memberId) tasks.push(autoLink());
    if (roleCount === 0) tasks.push(bootstrapAdmin());
    if (tasks.length === 0) {
      setLinking(false);
      return;
    }
    let cancelled = false;
    setLinking(true);
    void Promise.allSettled(tasks).then(() => {
      if (!cancelled) setLinking(false);
    });
    return () => {
      cancelled = true;
    };
    // Deps intentionally read only the fields that decide whether a call is
    // still needed; the mutations are stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?._id, user?.isAnonymous, user?.memberId, roleCount]);

  const noAccess =
    !isLoading && isAuthenticated && !!user && !accountHasAccess(user);

  // Tell the administrators that this account is waiting on a member link, so
  // it does not sit unnoticed. Runs only once the auto-link/bootstrap attempt
  // has settled (`!linking`), so a member who is about to be linked by email is
  // never reported as unlinked. The server dedupes per account, so repeated
  // visits to this screen never spam the admins.
  useEffect(() => {
    if (noAccess && !linking) requestProfileLink().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noAccess, linking]);

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

  if (!accountHasAccess(user)) {
    // While the auto-link / bootstrap call is in flight, wait rather than flash
    // the "not linked" screen at someone whose profile is about to be linked.
    if (linking) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-background">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </main>
      );
    }
    return (
      <LinkProfileScreen
        email={user?.email}
        name={user?.name}
        onSignOut={() => void signOut()}
      />
    );
  }

  return children;
}
