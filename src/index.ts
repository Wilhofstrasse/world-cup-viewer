/**
 * index.ts — world-cup-viewer Worker entry point.
 *
 * Serves the PWA (web/ via [assets]) and a small API:
 *   GET /api/wm/matches  — schedule + scores + scorers (R2-cached, cron-filled)
 *   GET /api/version     — deployed build string
 *   OPTIONS /api/*       — CORS preflight
 *
 * scheduled() runs the budget-aware football ingest (API-Football, key
 * server-side). Highlight clips are NOT proxied here — the PWA resolves them
 * client-side from the keyless SRF Integration Layer.
 */

import type { Env } from "./types.js";
import { runWmIngest } from "./wm/ingest.js";
import { loadWmData } from "./wm/store.js";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

async function handleMatches(env: Env): Promise<Response> {
  const data = await loadWmData(env);
  return json({ matches: data.matches, updatedAt: data.updatedAt, season: data.season });
}

/** Cron that drives the football ingest (self-gated to the tournament window). */
const WM_INGEST_CRON = "*/15 * * * *";

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    if (method === "OPTIONS" && pathname.startsWith("/api/")) {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      if (pathname === "/api/wm/matches" && method === "GET") return await handleMatches(env);
      if (pathname === "/api/version" && method === "GET") return json({ version: env.APP_VERSION ?? "dev" });
    } catch {
      return json({ error: "Internal error" }, 500);
    }

    // Unknown /api/* keeps CORS so the PWA can read the error.
    if (pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
    // Everything else is served by the [assets] layer; this is the fallthrough.
    return new Response("Not found", { status: 404 });
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (controller.cron === WM_INGEST_CRON) ctx.waitUntil(runWmIngest(env));
  },
} satisfies ExportedHandler<Env>;
