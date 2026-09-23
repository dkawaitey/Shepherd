import { Button } from "@/components/ui/button";
import { formatError } from "@/lib/errors";
import { reportAppError } from "@/lib/error-log";
import { AlertTriangle, LayoutDashboard, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";

type PageErrorBoundaryProps = {
  children: ReactNode;
  onGoHome: () => void;
  /** Label used when reporting to the admin error log. */
  context?: string;
};

type PageErrorBoundaryState = { error: Error | null };

/**
 * Catches a render-time failure (a throwing component or a rejected Convex
 * query) and shows a readable card instead of a blank screen. The rest of the
 * app — sidebar, topbar, notifications — stays alive and usable.
 */
class PageErrorBoundary extends Component<
  PageErrorBoundaryProps,
  PageErrorBoundaryState
> {
  state: PageErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PageErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Shepherd] Page crash:", error, info.componentStack);
    reportAppError(error, {
      source: "render",
      context: this.props.context ?? "App page",
    });
  }

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-14 text-center">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-destructive/10">
          <AlertTriangle className="h-5 w-5 text-destructive" />
        </div>
        <p className="text-sm font-semibold">This page couldn't load</p>
        <p className="mt-1 max-w-md text-xs text-muted-foreground">
          Something went wrong while drawing this screen. Your records are safe
          and the rest of Shepherd still works — try again, or head back to the
          dashboard.
        </p>
        <p className="mt-3 max-w-md break-words text-[11px] text-muted-foreground/80">
          {formatError(error, "Unexpected error")}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button variant="outline" size="sm" onClick={this.retry}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Try again
          </Button>
          <Button size="sm" onClick={this.props.onGoHome}>
            <LayoutDashboard className="mr-1.5 h-3.5 w-3.5" /> Go to dashboard
          </Button>
        </div>
        {import.meta.env.DEV && error.stack && (
          <details className="mt-4 w-full max-w-lg text-left">
            <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-muted-foreground">
              Technical details
            </summary>
            <pre className="mt-2 max-h-52 overflow-auto rounded border border-border/60 p-2 text-[10px] leading-4 text-muted-foreground/80">
              {error.stack}
            </pre>
          </details>
        )}
      </div>
    );
  }
}

/**
 * Route-level guard: wraps the page rendered by the shell's `<Outlet />`, so a
 * crash inside one page never blanks the whole app. It remounts when the path
 * changes, which means navigating anywhere recovers on its own.
 */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <PageErrorBoundary
      key={location.pathname}
      context={`Page: ${location.pathname}`}
      onGoHome={() => navigate("/dashboard")}
    >
      {children}
    </PageErrorBoundary>
  );
}
