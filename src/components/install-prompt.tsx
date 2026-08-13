import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/** Chrome/Edge/Android fires this before installability; not typed in lib.dom. */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "shepherd.installDismissed";
const IOS_HINT_KEY = "shepherd.iosHintDismissed";

const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari
    (navigator as unknown as { standalone?: boolean }).standalone === true);

const isIOS = () =>
  typeof navigator !== "undefined" &&
  /iphone|ipad|ipod/i.test(navigator.userAgent) &&
  !(window as unknown as { MSStream?: unknown }).MSStream;

export function InstallPrompt() {
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (localStorage.getItem(DISMISS_KEY)) return;

    const onBip = (e: Event) => {
      e.preventDefault();
      deferred.current = e as BeforeInstallPromptEvent;
      setShow(true);
    };
    const onInstalled = () => {
      localStorage.setItem(DISMISS_KEY, "1");
      setShow(false);
      toast.success("Shepherd installed — it's on your home screen");
    };
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);

    // iOS Safari never fires beforeinstallprompt — show a how-to hint instead.
    if (isIOS() && !localStorage.getItem(IOS_HINT_KEY)) {
      const t = setTimeout(() => setIosHint(true), 4000);
      return () => {
        clearTimeout(t);
        window.removeEventListener("beforeinstallprompt", onBip);
        window.removeEventListener("appinstalled", onInstalled);
      };
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!show && !iosHint) return null;

  const dismiss = () => {
    localStorage.setItem(show ? DISMISS_KEY : IOS_HINT_KEY, "1");
    setShow(false);
    setIosHint(false);
  };

  const install = async () => {
    const e = deferred.current;
    if (!e) return;
    try {
      await e.prompt();
      const { outcome } = await e.userChoice;
      localStorage.setItem(DISMISS_KEY, "1");
      setShow(false);
      deferred.current = null;
      if (outcome === "accepted") {
        toast.success("Shepherd installed — it's on your home screen");
      }
    } catch {
      dismiss();
    }
  };

  return (
    <AnimatePresence>
      {(show || iosHint) && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="fixed bottom-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2"
        >
          <div className="rounded-lg border bg-card/95 p-4 shadow-lg backdrop-blur">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="term-label font-mono text-[10px]">
                  {iosHint ? "$ shepherd install --ios" : "$ shepherd install --offline-ready"}
                </p>
                <p className="mt-1 text-sm font-semibold">
                  {iosHint ? "Install Shepherd on this device" : "Install Shepherd"}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  {iosHint
                    ? "Tap the Share button in Safari, then choose “Add to Home Screen” to open it like an app."
                    : "Works offline, opens like an app, and stays ready for field visits."}
                </p>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={dismiss} aria-label="Dismiss">
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex gap-2">
              {iosHint ? (
                <Button size="sm" onClick={dismiss}>
                  Got it
                </Button>
              ) : (
                <Button size="sm" onClick={install}>
                  <Download className="mr-1.5 h-3.5 w-3.5" /> Install
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={dismiss}>
                Later
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
