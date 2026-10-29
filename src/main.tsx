import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/app-shell";
import { InstallPrompt } from "@/components/install-prompt";
import { ThemeProvider } from "@/components/theme-provider";
import { installErrorLogging, reportAppError } from "@/lib/error-log";
import { routeLoaders } from "@/lib/route-loaders";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient, useConvexAuth } from "convex/react";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import "./index.css";

// Lazy route components. The modules live in one shared table so links can warm
// the chunk they are about to open — see lib/route-loaders.
const Landing = lazy(routeLoaders["/"]);
const AuthPage = lazy(routeLoaders["/auth"]);
const Dashboard = lazy(routeLoaders["/dashboard"]);
const Contacts = lazy(routeLoaders["/contacts"]);
const ContactProfile = lazy(routeLoaders["/contacts/:id"]);
const Followups = lazy(routeLoaders["/followups"]);
const Discipleship = lazy(routeLoaders["/discipleship"]);
const BibleStudies = lazy(routeLoaders["/bible-studies"]);
const Members = lazy(routeLoaders["/members"]);
const MemberProfile = lazy(routeLoaders["/members/:id"]);
const Attendance = lazy(routeLoaders["/attendance"]);
const PrayerJournal = lazy(routeLoaders["/prayer-journal"]);
const Announcements = lazy(routeLoaders["/announcements"]);
const Constitution = lazy(routeLoaders["/constitution"]);
const Reports = lazy(routeLoaders["/reports"]);
const Analytics = lazy(routeLoaders["/analytics"]);
const Settings = lazy(routeLoaders["/settings"]);
const ErrorLog = lazy(routeLoaders["/error-log"]);
const AccessReview = lazy(routeLoaders["/access"]);
const NotFound = lazy(routeLoaders["*"]);

/**
 * Route-transition splash. It matches the boot splash inlined in index.html, so
 * a cold open and an in-app navigation look like one continuous load instead of
 * a blank screen followed by a jump.
 */
function RouteLoading() {
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <img
          src="/sidebar-logo.png"
          alt=""
          className="size-10 animate-pulse object-contain dark:hidden"
        />
        <img
          src="/sidebarr-logo.png"
          alt=""
          className="hidden size-10 animate-pulse object-contain dark:block"
        />
        <div className="h-[3px] w-28 overflow-hidden rounded-full bg-muted">
          <div className="shepherd-progress h-full w-1/3 rounded-full bg-primary/70" />
        </div>
      </div>
    </div>
  );
}

/**
 * The landing page is only for visitors. Signed-in users opening the app (or
 * the installed PWA, whose start_url is "/") go straight into the dashboard
 * instead of seeing the marketing page again.
 *
 * Only the session is consulted here — `useAuth` also waits for the profile
 * query, which meant a first-time visitor sat on a splash for a second
 * round trip before the marketing page could paint at all.
 */
function LandingRoute() {
  const { isLoading, isAuthenticated } = useConvexAuth();

  if (isLoading) return <RouteLoading />;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return <Landing />;
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in WebContainer environment). */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[WebContainer preview] Root crash:", err);
    reportAppError(err, { source: "render", context: "App crash" });
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Shepherd hit an unexpected error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              The screen couldn't finish loading. Reloading usually clears it, and
              no ministry records were changed.
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground/80 break-words">
              {this.state.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              Reload Shepherd
            </button>
            {this.state.stack && (
              <details className="mt-4 text-left">
                <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-muted-foreground">
                  Technical details
                </summary>
                <pre className="mt-2 max-h-40 overflow-auto rounded border border-border/60 p-2 text-[10px] leading-4 text-muted-foreground/80">
                  {this.state.stack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

// Report every failed mutation/action (plus uncaught errors) to the admin
// error log — see src/lib/error-log.ts.
installErrorLogging(convex);

function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}

// Register the service worker so Shepherd works offline and is installable as a PWA.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch((err) => console.warn("[PWA] Service worker registration failed:", err));
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ThemeProvider>
        <ToolbarErrorBoundary>
          <VlyToolbar />
        </ToolbarErrorBoundary>
          <ConvexAuthProvider client={convex}>
            <BrowserRouter>
              <InstallPrompt />
              <RouteSyncer />
              <Suspense fallback={<RouteLoading />}>
                <Routes>
                  <Route path="/" element={<LandingRoute />} />
                  <Route
                    path="/auth"
                    element={<AuthPage redirectAfterAuth="/dashboard" />}
                  />
                  <Route
                    element={
                      <RequireAuth>
                        <AppShell />
                      </RequireAuth>
                    }
                  >
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/contacts" element={<Contacts />} />
                    <Route path="/contacts/:id" element={<ContactProfile />} />
                    <Route path="/followups" element={<Followups />} />
                    <Route path="/discipleship" element={<Discipleship />} />
                    <Route path="/bible-studies" element={<BibleStudies />} />
                    <Route path="/members" element={<Members />} />
                    <Route path="/members/:id" element={<MemberProfile />} />
                    <Route path="/attendance" element={<Attendance />} />
                    <Route path="/prayer-journal" element={<PrayerJournal />} />
                    <Route path="/announcements" element={<Announcements />} />
                    <Route path="/constitution" element={<Constitution />} />
                    <Route path="/reports" element={<Reports />} />
                    <Route path="/analytics" element={<Analytics />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="/error-log" element={<ErrorLog />} />
                    <Route path="/access" element={<AccessReview />} />
                  </Route>
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </BrowserRouter>
            <Toaster />
          </ConvexAuthProvider>
        </ThemeProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
