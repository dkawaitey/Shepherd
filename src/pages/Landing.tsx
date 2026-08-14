import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";

export default function Landing() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const openApp = () => navigate(isAuthenticated ? "/dashboard" : "/auth");

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Top bar: logo + app name, theme toggle, sign in / get started */}
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
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

      {/* Hero: logo + tagline */}
      <main className="flex flex-1 items-center justify-center px-4 py-16 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center"
        >
          {/* Light mode: ministry logo image */}
          <div className="mx-auto mb-8 h-20 w-20 overflow-hidden rounded-2xl dark:hidden">
            <img
              src="/sidebar-logo.png"
              alt="Shepherd logo"
              className="h-full w-full object-contain"
            />
          </div>
          {/* Dark mode: transparent logo */}
          <div className="mx-auto mb-8 hidden h-20 w-20 overflow-hidden rounded-2xl dark:block">
            <img
              src="/sidebarr-logo.png"
              alt="Shepherd logo"
              className="h-full w-full object-contain"
            />
          </div>
          <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
            Shepherd every soul
            <br />
            <span className="text-primary">from first hello to leadership</span>
          </h1>
        </motion.div>
      </main>

      {/* Bottom: sign in */}
      <footer className="px-4 pb-10 sm:px-6">
        <div className="mx-auto flex max-w-6xl justify-center">
          <Button
            size="lg"
            className="w-full gap-2 sm:w-auto"
            onClick={openApp}
          >
            {isAuthenticated ? "Open Dashboard" : "Sign in"}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </footer>
    </div>
  );
}
