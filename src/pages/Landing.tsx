import { motion } from "framer-motion";
import {
  ArrowRight,
  CalendarCheck2,
  Check,
  GitBranch,
  HandHeart,
  Heart,
  KeyRound,
  LineChart,
  MapPin,
  MessageCircle,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";

const PIPELINE = [
  { step: "01", label: "Outreach" },
  { step: "02", label: "Follow-up" },
  { step: "03", label: "Discipleship" },
  { step: "04", label: "Integration" },
  { step: "05", label: "Service" },
];

const FEATURES = [
  {
    icon: Users,
    title: "People / Contacts",
    desc: "Complete discipleship profiles with auto-generated membership IDs, outreach records, and a living spiritual journey timeline.",
  },
  {
    icon: CalendarCheck2,
    title: "Follow-up Module",
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
    desc: "Administrator, Evangelism Coordinator, Follow-up Worker and Read-only Leader. Full audit trail.",
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
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary font-bold text-primary-foreground">
              S
            </div>
            <span className="text-sm font-bold tracking-[0.16em]">SHEPHERD</span>
            <span className="hidden text-[10px] uppercase tracking-widest text-muted-foreground sm:inline">
              gethsemane youth ministry
            </span>
          </Link>
          <div className="flex items-center gap-2">
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
      <section className="term-grid relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mx-auto max-w-3xl text-center"
          >
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-accent px-3 py-1 text-[11px] font-medium text-accent-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#86b26f]" />
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
              <span className="text-foreground">Outreach → Follow-up → Discipleship → Church Integration → Service</span>{" "}
              — with reports, reminders and accountability for your leaders and volunteers.
            </p>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" className="w-full gap-2 sm:w-auto" onClick={() => navigate("/auth")}>
                <KeyRound className="h-4 w-4" /> Enter the system
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="w-full gap-2 sm:w-auto"
                onClick={() => navigate("/auth")}
              >
                $ run shepherd --demo
              </Button>
            </div>
          </motion.div>

          {/* Terminal mock */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="mx-auto mt-14 max-w-3xl"
          >
            <div className="term-window shadow-lg">
              <div className="term-titlebar">
                <span className="term-dot bg-[#f87171]" />
                <span className="term-dot bg-[#fbbf24]" />
                <span className="term-dot bg-[#86b26f]" />
                <span className="ml-2 text-[11px] text-muted-foreground">
                  shepherd — discipleship pipeline
                </span>
              </div>
              <div className="space-y-1.5 bg-card p-4 text-[12px] leading-6 sm:p-5">
                <p className="text-muted-foreground">
                  <span className="text-primary">$</span> shepherd init --ministry "gethsemane-ym"
                </p>
                <p className="text-[#86efac]">✔ ministry configured · classes: millison, reuben, jacob, romina</p>
                <p className="text-muted-foreground">
                  <span className="text-primary">$</span> shepherd outreach add "John Mensah" --area adjikpo
                </p>
                <p className="text-[#86efac]">✔ membership ID generated: AD-0408-2026-001</p>
                <p className="text-muted-foreground">
                  <span className="text-primary">$</span> shepherd followup schedule --type home-visit --date +3d
                </p>
                <p className="text-[#fbbf24]">◐ follow-up pending · assigned to Bro. Daniel</p>
                <p className="text-muted-foreground">
                  <span className="text-primary">$</span> shepherd followup complete --outcome "accepted bible study"
                </p>
                <p className="text-[#86efac]">✔ timeline updated: first follow-up completed</p>
                <p className="text-muted-foreground">
                  <span className="text-primary">$</span> shepherd report --conversion-funnel
                </p>
                <div className="pt-1 text-[11px]">
                  <p className="text-muted-foreground">reached ............... 128</p>
                  <p className="text-muted-foreground">interested ............. 96</p>
                  <p className="text-muted-foreground">accepted christ ........ 54</p>
                  <p className="text-muted-foreground">baptized ............... 23</p>
                  <p className="text-muted-foreground">joined church .......... 18</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Pipeline strip */}
      <section className="border-y bg-card">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px sm:grid-cols-5">
          {PIPELINE.map((p, i) => (
            <div key={p.step} className="flex items-center gap-3 px-4 py-5">
              <span className="text-[10px] font-bold text-primary">{p.step}</span>
              <div>
              <div className="text-[13px] font-semibold">{p.label}</div>
              <div className="text-[10px] text-muted-foreground">
                {i < 4 ? "→" : "→"}
              </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
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
              className="group rounded-lg border bg-card p-5 transition-colors hover:border-primary/40"
            >
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md border border-primary/20 bg-accent text-primary">
                <f.icon className="h-4 w-4" />
              </div>
              <h3 className="text-sm font-bold">{f.title}</h3>
              <p className="mt-1.5 text-[12px] leading-5 text-muted-foreground">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* WhatsApp / SMS / Maps strip */}
      <section className="border-y bg-card">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:grid-cols-3 sm:px-6">
          {[
            { icon: MessageCircle, t: "WhatsApp & SMS", d: "Open chats, send follow-up reminders, invitations and birthday greetings straight from a profile." },
            { icon: MapPin, t: "Google Maps", d: "Save GPS locations, get directions to a person's home, and view evangelism coverage areas." },
            { icon: Heart, t: "Reminder Engine", d: "Overdue visits, missed follow-ups, birthdays and low attendance — surfaced on the dashboard." },
          ].map((x) => (
            <div key={x.t} className="flex gap-3">
              <x.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <div className="text-[13px] font-semibold">{x.t}</div>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{x.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="term-window border-primary/30 bg-accent/40">
          <div className="term-titlebar border-primary/20">
            <span className="term-dot bg-[#86b26f]" />
            <span className="ml-2 text-[11px] text-muted-foreground">ready when you are</span>
          </div>
          <div className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                gethsemane ministry youth
              </p>
              <h3 className="mt-1 text-xl font-bold">
                Start shepherding your people today
              </h3>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Sign in with your ministry email — the first account becomes the Administrator.
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="lg" onClick={() => navigate("/auth")}>
                Get Started <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t py-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 text-[11px] text-muted-foreground sm:flex-row sm:px-6">
          <span>
            <span className="text-primary">$</span> shepherd --ministry gethsemane-ym
          </span>
          <span className="flex items-center gap-1">
            <Check className="h-3 w-3 text-[#86efac]" /> Built for Gethsemane Ministry Youth · {new Date().getFullYear()}
          </span>
        </div>
      </footer>
    </div>
  );
}
