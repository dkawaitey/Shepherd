/**
 * One table of every page module in the app.
 *
 * `main.tsx` builds its lazy routes from this table and links warm the exact
 * chunk they are about to open through it, so the two can never drift apart
 * (a prefetch that quietly requests a different module warms nothing). The
 * point is the phone case: tapping a nav item used to download the page's
 * chunk *after* the tap, behind a loading screen. Now the chunk is already in
 * the browser by the time the tap lands.
 */

export const routeLoaders = {
  "/": () => import("@/pages/Landing"),
  "/auth": () => import("@/pages/Auth"),
  "/dashboard": () => import("@/pages/dashboard"),
  "/contacts": () => import("@/pages/contacts"),
  "/contacts/:id": () => import("@/pages/contact-profile"),
  "/followups": () => import("@/pages/followups"),
  "/discipleship": () => import("@/pages/discipleship"),
  "/bible-studies": () => import("@/pages/bible-studies"),
  "/members": () => import("@/pages/members"),
  "/members/:id": () =>
    import("@/pages/members").then((m) => ({ default: m.MemberProfile })),
  "/attendance": () => import("@/pages/attendance"),
  "/prayer-journal": () => import("@/pages/prayer-journal"),
  "/announcements": () => import("@/pages/announcements"),
  "/constitution": () => import("@/pages/constitution"),
  "/reports": () => import("@/pages/reports"),
  "/analytics": () => import("@/pages/analytics"),
  "/settings": () => import("@/pages/settings"),
  "/error-log": () => import("@/pages/error-log"),
  "/access": () => import("@/pages/access-review"),
  "*": () => import("@/pages/NotFound"),
} as const;

export type RoutePath = keyof typeof routeLoaders;

/** Uniform view of the table for warming; the return values are not used. */
const loaders = routeLoaders as unknown as Record<string, () => Promise<unknown>>;

/** Chunks already asked for, so hovering the same link twice is free. */
const warmed = new Set<string>();

/** `/followups?status=pending` → the table key that serves it. */
function resolvePath(rawPath: string): string | null {
  const path =
    rawPath.split("?")[0]!.split("#")[0]!.replace(/\/+$/, "") || "/";
  if (path !== "*" && path in loaders) return path;
  // A record page (/members/abc123) is served by its section's module.
  const detail = path.replace(/^(\/[^/]+)\/.*$/, "$1/:id");
  if (detail in loaders) return detail;
  const section = path.replace(/^(\/[^/]+).*$/, "$1");
  if (section in loaders) return section;
  return null;
}

/** Download the chunk for a route without navigating to it. */
export function preloadRoute(path: string | null | undefined): void {
  if (!path) return;
  const key = resolvePath(path);
  if (!key || warmed.has(key)) return;
  warmed.add(key);
  void loaders[key]!().catch(() => warmed.delete(key));
}

/**
 * Warm several routes once the current page has painted, so the downloads
 * never compete with the screen the person is actually waiting for.
 */
export function preloadWhenIdle(paths: readonly string[]): void {
  if (typeof window === "undefined" || paths.length === 0) return;

  // Never spend someone's data allowance on pages they have not asked for.
  // On a metered or 2G connection the download would also hold up the page
  // they *are* waiting for, which is the exact problem this is meant to fix.
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (
    connection?.saveData ||
    /(^|-)2g$/.test(connection?.effectiveType ?? "")
  ) {
    return;
  }

  const run = () => {
    for (const path of paths) preloadRoute(path);
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout: 2500 });
  } else {
    window.setTimeout(run, 1200);
  }
}
