import { motion } from "framer-motion";
import {
  ArrowRight,
  CalendarCheck,
  ClipboardCheck,
  FileBarChart,
  Megaphone,
  ScrollText,
  Sparkle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";

/** The six things the ministry reaches for most, in the order of the journey. */
const FEATURES = [
  {
    icon: ClipboardCheck,
    title: "Follow-ups",
    body: "Every new face has a name, a visit date and a worker who remembers them.",
  },
  {
    icon: Sparkle,
    title: "Discipleship",
    body: "Stages from first contact to leadership, with the next step always visible.",
  },
  {
    icon: CalendarCheck,
    title: "Attendance",
    body: "Class registers, trends and the members quietly drifting out of view.",
  },
  {
    icon: Megaphone,
    title: "Announcements",
    body: "Updates, polls and voice notes — filed, categorised and easy to find again.",
  },
  {
    icon: ScrollText,
    title: "Constitution",
    body: "The youth constitution, opened and read in place, with past versions kept.",
  },
  {
    icon: FileBarChart,
    title: "Reports",
    body: "The numbers a leader reports upward, ready to export as PDF or CSV.",
  },
];

export default function Landing() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const openApp = () => navigate(isAuthenticated ? "/dashboard" : "/auth");

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Top bar: mark + wordmark, theme toggle, sign in / get started */}
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="group flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl border border-border/70 bg-gradient-to-br from-primary/12 to-gold/12 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
              <img
                src="/sidebarr-logo.png"
                alt=""
                className="size-6 object-contain"
              />
            </span>
            <span className="flex flex-col leading-none">
              <span className="display-title text-[15px] tracking-[0.02em]">
                Shepherd
              </span>
              <span className="mt-1 font-mono text-[8px] uppercase tracking-[0.18em] text-muted-foreground/75">
                Youth Ministry
              </span>
            </span>
          </Link>
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            {isAuthenticated ? (
              <Button size="sm" onClick={() => navigate("/dashboard")}>
                Open Dashboard
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate("/auth")}
                >
                  Sign in
                </Button>
                <Button size="sm" onClick={() => navigate("/auth")}>
                  Get Started
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden px-4 pt-16 pb-14 sm:px-6 sm:pt-24 sm:pb-20">
          {/* Sanctuary window: concentric arcs radiating from the mark. */}
          <svg
            aria-hidden="true"
            viewBox="0 0 400 400"
            fill="none"
            className="pointer-events-none absolute top-1/2 left-1/2 h-[42rem] w-[42rem] -translate-x-1/2 -translate-y-1/2 text-primary/15"
          >
            <circle cx="200" cy="200" r="70" stroke="currentColor" strokeWidth="0.75" />
            <circle cx="200" cy="200" r="110" stroke="currentColor" strokeWidth="0.75" opacity="0.75" />
            <circle cx="200" cy="200" r="152" stroke="currentColor" strokeWidth="0.75" opacity="0.5" />
            <circle cx="200" cy="200" r="196" stroke="currentColor" strokeWidth="0.75" opacity="0.3" />
          </svg>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: [0.2, 0.7, 0.3, 1] }}
            className="relative mx-auto max-w-3xl text-center"
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-gold">
              Gethsemane · Youth Ministry
            </span>

            <h1 className="display-title mt-6 text-[34px] leading-[1.04] text-balance sm:text-[58px]">
              Shepherd every soul
              <br />
              <span className="text-primary">from first hello to leadership.</span>
            </h1>

            <p className="mx-auto mt-5 max-w-xl text-[14px] leading-7 text-muted-foreground">
              One quiet place for the visits, classes, studies and conversations
              that turn a first encounter into a life of service.
            </p>

            <div className="mt-8 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
              <Button
                size="lg"
                className="w-full shadow-[0_14px_30px_-14px_rgba(24,44,18,0.8)] sm:w-auto"
                onClick={openApp}
              >
                {isAuthenticated ? "Open Dashboard" : "Sign in to Shepherd"}
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => navigate("/auth")}
              >
                Join the ministry
              </Button>
            </div>

            <div className="mt-6 flex items-center justify-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground/70">
              <span className="h-px w-8 bg-border" />
              Private to the team
              <span className="h-px w-8 bg-border" />
            </div>
          </motion.div>
        </section>

        {/* What's inside */}
        <section className="px-4 pb-16 sm:px-6 sm:pb-24">
          <div className="mx-auto max-w-6xl">
            <div className="mb-8 flex flex-col gap-2 sm:mb-10 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="term-label">Inside the app</p>
                <h2 className="display-title mt-2 text-[24px] sm:text-[28px]">
                  The work of a ministry, in one ledger
                </h2>
              </div>
              <p className="max-w-sm text-[12.5px] leading-6 text-muted-foreground sm:text-right">
                Built for the volunteers who carry it week by week.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f, i) => {
                const Icon = f.icon;
                return (
                  <motion.div
                    key={f.title}
                    initial={{ opacity: 0, y: 12 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.3 }}
                    transition={{ duration: 0.4, delay: i * 0.04 }}
                    className="panel panel-link p-5"
                  >
                    <span className="grid size-9 place-items-center rounded-xl border border-border/70 bg-gradient-to-br from-primary/12 to-gold/10 text-primary">
                      <Icon className="h-4 w-4" />
                    </span>
                    <h3 className="mt-4 text-[14px] font-semibold tracking-[-0.015em]">
                      {f.title}
                    </h3>
                    <p className="mt-1.5 text-[12.5px] leading-6 text-muted-foreground">
                      {f.body}
                    </p>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Closing invitation */}
        <section className="px-4 pb-16 sm:px-6 sm:pb-24">
          <div className="panel panel-wash mx-auto flex max-w-6xl flex-col items-start gap-5 overflow-hidden p-6 sm:flex-row sm:items-center sm:justify-between sm:p-9">
            <div>
              <h2 className="display-title text-[22px] sm:text-[26px]">
                Pick up where the last visit ended
              </h2>
              <p className="mt-2 max-w-lg text-[12.5px] leading-6 text-muted-foreground">
                Sign in with your ministry account and the day's follow-ups,
                reminders and new faces are already waiting.
              </p>
            </div>
            <Button size="lg" className="shrink-0" onClick={openApp}>
              {isAuthenticated ? "Open Dashboard" : "Sign in"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/70 px-4 py-6 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 sm:flex-row">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/70">
            Shepherd · Discipleship management
          </p>
          <p className="text-[11px] text-muted-foreground/70">
            Gethsemane Ministry Youth Ministry
          </p>
        </div>
      </footer>
    </div>
  );
}
