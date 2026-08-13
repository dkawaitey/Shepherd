import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

/**
 * Inbound REST contract shared with the Steward app:
 *   GET  /api/sync/members  → { members: [...], updatedAt }
 *   POST /api/sync/members  → body { members: [...], updatedAt }
 *                            → { received, created, updated, skipped, matched, updatedAt }
 * The heavy lifting (key check, list/upsert) runs in the Node runtime inside
 * steward.handleInbound, where the STEWARD_SYNC_KEY env var is available.
 */
const handleMembersSync = httpAction(async (ctx, request) => {
  const key =
    request.headers.get("x-sync-key") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const body =
    request.method === "POST" ? await request.text().catch(() => "") : undefined;

  const result = await ctx.runAction(internal.steward.handleInbound, {
    method: request.method,
    key: key ?? "",
    body: body ?? "",
  });

  return new Response(JSON.stringify(result.payload ?? { error: result.error }), {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
});

http.route({ path: "/api/sync/members", method: "GET", handler: handleMembersSync });
http.route({ path: "/api/sync/members", method: "POST", handler: handleMembersSync });

export default http;
