import { motion } from "framer-motion";
import {
  ArrowRight,
  CalendarCheck2,
  Check,
  GitBranch,
  HandHeart,
  KeyRound,
  LineChart,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";

const FEATURES = [
  {
    icon: Users,
    title: "Contacts",
    desc: "Complete discipleship profiles with auto-generated membership IDs, outreach records, and a living spiritual journey timeline.",
  },
  {
    icon: CalendarCheck2,
    title: "Follow-ups",
    desc: "Schedule home visits, calls and Bible studies. Status workflows with outcomes, reasons, and locked records.",
  },
  {
    icon: HandHeart,
    title: "Prayer Journal",
    desc: "Track prayer requests, answered prayers and confidential notes for every person you shepherd.",
  },
  {
    icon: GitBranch,
    title: "Spiritual Journey",
    desc: "Automated timeline: Met During Outreach → First Follow-up → Bible Study → Baptized → Joined Church → Serving → Leading.",
  },
  {
    icon: LineChart,
    title: "Reports & Analytics",
    desc: "Conversion funnel, retention, volunteer productivity and attendance trends — live from the database.",
  },
  {
    icon: ShieldCheck,
    title: "Roles & Permissions",
    desc: "Administrator, Evangelism Coordinator, Follow-up Worker, Class Leader and Read-only Leader. Full audit trail.",
  },
];

export default function Landing() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            {/* Light mode: ministry logo image */}
            <div className="h-7 w-7 shrink-0 overflow-hidden rounded-md dark:hidden">
              <img
                src="/sidebar-logo.png"
                alt="Shepherd logo"
                className="h-full w-full object-contain"
              />
            </div>
            {/* Dark mode: transparent logo */}
            <div className="hidden h-7 w-7 shrink-0 overflow-hidden rounded-md dark:block">
              <img
                src="/sidebarr-logo.png"
                alt="Shepherd logo"
                className="h-full w-full object-contain"
              />
            </div>
            <span className="text-sm font-bold tracking-[0.16em]">SHEPHERD</span>
            <span className="hidden text-[10px] uppercase tracking-widest text-muted-foreground sm:inline">
              gethsemane youth ministry
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {isAuthenticated ? (
              <Button size="sm" onClick={() => navigate("/dashboard")}>
                Open Dashboard <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => navigate("/auth")}>
                  Sign in
                </Button>
                <Button size="sm" onClick={() => navigate("/auth")}>
                  Get Started <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-4xl px-4 py-20 sm:px-6 sm:py-28">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center"
          >
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-[11px] text-muted-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-green" />
              discipleship management system · v1.0
            </div>
            <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
              Shepherd every soul
              <br />
              <span className="text-primary">from first hello to leadership</span>
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
              A digital shepherding tool for Gethsemane Ministry Youth Ministry.
              Manage the complete evangelism pathway —{" "}
              <span className="text-foreground">
                Outreach → Follow-up → Discipleship → Church Integration → Service
              </span>{" "}
              — with reports, reminders and accountability for your leaders and volunteers.
            </p>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" className="w-full gap-2 sm:w-auto" onClick={() => navigate("/auth")}>
                <KeyRound className="h-4 w-4" /> Enter the system
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => navigate("/auth")}
              >
                Sign in
              </Button>
            </div>

            <p className="mt-6 text-[11px] text-muted-foreground">
              <span className="text-primary">$</span> shepherd init --ministry gethsemane-ym
            </p>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="border-y bg-card">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mb-10 text-center">
            <p className="term-label">modules</p>
            <h2 className="mt-2 text-2xl font-bold sm:text-3xl">
              Everything a volunteer needs, nothing they don't
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-[13px] text-muted-foreground">
              Add a contact in under two minutes. The system guides every person
              through the full discipleship pathway with automatic timelines,
              reminders and reporting.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05, duration: 0.4 }}
                className="group rounded-lg border bg-background p-5 transition-colors hover:border-primary/40"
              >
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md border border-primary/20 bg-accent text-primary">
                  <f.icon className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-bold">{f.title}</h3>
                <p className="mt-1.5 text-[12px] leading-5 text-muted-foreground">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="rounded-lg border bg-card p-8 text-center sm:p-12">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
            gethsemane ministry youth
          </p>
          <h3 className="mt-2 text-2xl font-bold">
            Start shepherding your people today
          </h3>
          <p className="mx-auto mt-2 max-w-md text-[13px] text-muted-foreground">
            Sign in with your ministry email — the first account becomes the Administrator.
          </p>
          <Button size="lg" className="mt-6" onClick={() => navigate("/auth")}>
            Get Started <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </section>

      <footer className="border-t py-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 text-[11px] text-muted-foreground sm:flex-row sm:px-6">
          <span>
            <span className="text-primary">$</span> shepherd --ministry gethsemane-ym
          </span>
          <span className="flex items-center gap-1">
            <Check className="h-3 w-3 text-status-green" /> Built for Gethsemane Ministry Youth · {new Date().getFullYear()}
          </span>
        </div>
      </footer>
    </div>
  );
}
