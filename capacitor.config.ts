import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native wrapper config — not needed for the web app or PWA.
 * When you're ready for App Store / Play Store builds:
 *
 *   1. bun run build          (produces the static site in dist/)
 *   2. bunx cap add ios       (needs a Mac with Xcode)
 *      bunx cap add android   (needs Android Studio)
 *   3. bunx cap sync
 *   4. bunx cap open ios / bunx cap open android
 */
const config: CapacitorConfig = {
  appId: "com.gethsemane.shepherd",
  appName: "Shepherd",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
