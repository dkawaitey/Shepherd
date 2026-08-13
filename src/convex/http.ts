import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

// Note: the Steward sync is one-way (Shepherd → Steward), so Shepherd does not
// expose an inbound /api/sync/members endpoint. Pushes go out from the hourly
// cron / Settings → Sync now to {STEWARD_API_URL}/api/sync/members.

export default http;
