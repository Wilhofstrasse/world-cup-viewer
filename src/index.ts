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
import { loadWmData, loadWmTopScorers, loadWmTabellen, loadWmSquads } from "./wm/store.js";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

async function handleTopScorers(env: Env): Promise<Response> {
  const data = await loadWmTopScorers(env);
  return json({ scorers: data.scorers, updatedAt: data.updatedAt, season: data.season });
}

async function handleTabellen(env: Env): Promise<Response> {
  const data = await loadWmTabellen(env);
  return json({ rows: data.rows, updatedAt: data.updatedAt, season: data.season });
}

async function handleSquads(env: Env): Promise<Response> {
  const data = await loadWmSquads(env);
  return json({ squads: data.squads, updatedAt: data.updatedAt, season: data.season });
}

interface MarkersBody {
  markers?: Array<{ tSec?: number; label?: string }>;
  updatedAt?: number;
}

/** Sanitise a clip URN before using it as an R2 key. */
function safeUrn(s: string): string {
  return s.replace(/[^a-zA-Z0-9:\-_.]/g, "").slice(0, 128);
}

/**
 * POST /api/wm/markers/<urn> — the home-Mac goal detector posts per-clip
 * markers here after whisper-transcribing the audio. Bearer-auth via
 * WM_MARKERS_TOKEN so only the detector can write.
 */
async function handleMarkersPut(request: Request, env: Env, urn: string): Promise<Response> {
  if (!env.WM_R2 || !env.WM_MARKERS_TOKEN) return json({ error: "Not configured" }, 503);
  const auth = request.headers.get("authorization") || "";
  const expected = `Bearer ${env.WM_MARKERS_TOKEN}`;
  if (auth !== expected) return json({ error: "Unauthorized" }, 401);
  let body: MarkersBody = {};
  try {
    body = (await request.json()) as MarkersBody;
  } catch {
    return json({ error: "Bad body" }, 400);
  }
  const markers = (body.markers || [])
    .map((m) => ({
      tSec: Number.isFinite(m.tSec) ? Math.max(0, Math.min(7200, Math.round(m.tSec || 0))) : 0,
      label: String(m.label || "").slice(0, 120),
    }))
    .filter((m) => m.tSec > 0 || m.label);
  const payload = {
    urn,
    markers,
    updatedAt: Number.isFinite(body.updatedAt) ? Math.round(body.updatedAt || 0) : Math.floor(Date.now() / 1000),
  };
  await env.WM_R2.put(`wm/markers/${safeUrn(urn)}.json`, JSON.stringify(payload), {
    httpMetadata: { contentType: "application/json" },
  });
  return json({ ok: true, n: markers.length });
}

/** GET /api/wm/markers/<urn> — anonymous read for the highlights player. */
async function handleMarkersGet(env: Env, urn: string): Promise<Response> {
  if (!env.WM_R2) return json({ urn, markers: [], updatedAt: 0 });
  const obj = await env.WM_R2.get(`wm/markers/${safeUrn(urn)}.json`);
  if (!obj) return json({ urn, markers: [], updatedAt: 0 });
  try {
    const data = JSON.parse(await obj.text());
    return json(data);
  } catch {
    return json({ urn, markers: [], updatedAt: 0 });
  }
}

/** Whitelist of event names so a random caller can't pollute the dataset. */
const ALLOWED_EVENTS = new Set([
  "page_load",
  "tab_switch",
  "clip_play_start",
  "clip_play_stop",
  "mehr_sub_open",
  "spielerkarte_open",
  "drawer_open",
  "spielinfo_open",
  "highlights_link_open",
]);

interface TrackBody {
  event?: string;
  sessionId?: string;
  target?: string;
  durationMs?: number;
  durationSec?: number;
  path?: string;
}

/**
 * POST /api/track — client telemetry into Analytics Engine. Anonymous: no IP,
 * no persistent ID. sessionId is a per-tab UUID the client makes up. cf.country
 * + cf.colo come from Cloudflare's request metadata. Always returns 204.
 */
async function handleTrack(request: Request, env: Env): Promise<Response> {
  if (!env.WM_EVENTS) return new Response(null, { status: 204, headers: CORS });
  let body: TrackBody = {};
  try {
    body = (await request.json()) as TrackBody;
  } catch {
    return new Response(null, { status: 204, headers: CORS });
  }
  const event = String(body.event || "").slice(0, 32);
  if (!ALLOWED_EVENTS.has(event)) return new Response(null, { status: 204, headers: CORS });
  const cf = (request as Request & { cf?: { country?: string; colo?: string } }).cf;
  const country = (cf?.country || "").slice(0, 2).toUpperCase();
  const colo = (cf?.colo || "").slice(0, 5).toUpperCase();
  const session = String(body.sessionId || "").slice(0, 36);
  const target = String(body.target || "").slice(0, 64);
  const path = String(body.path || "").slice(0, 128);
  const duration = Number.isFinite(body.durationSec)
    ? Math.max(0, Math.min(7200, body.durationSec || 0))
    : Number.isFinite(body.durationMs)
    ? Math.round(Math.max(0, Math.min(7200000, body.durationMs || 0)) / 1000)
    : 0;
  try {
    env.WM_EVENTS.writeDataPoint({
      blobs: [event, country, colo, session, target, path],
      doubles: [duration],
      indexes: [event],
    });
  } catch {
    // upstream / quota issue — swallow; telemetry never breaks the app
  }
  return new Response(null, { status: 204, headers: CORS });
}

/** Run an SQL statement on AE via the REST endpoint. Returns parsed rows. */
async function aeSql(env: Env, sql: string): Promise<unknown[]> {
  if (!env.CF_ACCOUNT_ID || !env.CF_AE_TOKEN) return [];
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CF_AE_TOKEN}`,
        "Content-Type": "text/plain",
      },
      body: sql,
    },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { data?: unknown[] };
  return Array.isArray(data.data) ? data.data : [];
}

/**
 * GET /api/stats — aggregated map data for the Mehr ▸ Einstellungen world map.
 * Anonymous aggregates only; nothing personally identifiable comes out.
 */
async function handleStats(_request: Request, env: Env): Promise<Response> {
  if (!env.CF_ACCOUNT_ID || !env.CF_AE_TOKEN) {
    return json({ byCountry: [], byEvent: [], byDay: [], totals: { events: 0, sessions: 0 } });
  }
  const since = "INTERVAL '30' DAY";
  const [byCountry, byEvent, byDay, totals] = await Promise.all([
    aeSql(
      env,
      `SELECT blob2 AS country, count() AS n
       FROM wm_events WHERE timestamp >= NOW() - ${since}
       GROUP BY blob2 ORDER BY n DESC LIMIT 100`,
    ),
    aeSql(
      env,
      `SELECT blob1 AS event, count() AS n
       FROM wm_events WHERE timestamp >= NOW() - ${since}
       GROUP BY blob1 ORDER BY n DESC LIMIT 20`,
    ),
    aeSql(
      env,
      `SELECT toDate(timestamp) AS day, count() AS n
       FROM wm_events WHERE timestamp >= NOW() - ${since}
       GROUP BY day ORDER BY day ASC LIMIT 100`,
    ),
    aeSql(
      env,
      `SELECT count() AS events, uniqExact(blob4) AS sessions
       FROM wm_events WHERE timestamp >= NOW() - ${since}`,
    ),
  ]);
  return json({ byCountry, byEvent, byDay, totals: (totals[0] || { events: 0, sessions: 0 }) });
}

/**
 * /api/config — runtime config the client reads at boot. Today: the SRF proxy
 * base URL, served ONLY when the viewer is outside CH (CH visitors fetch SRF
 * direct — faster, one less hop). country comes from Cloudflare's `cf.country`
 * header so we don't ship the proxy URL to a CH visitor unnecessarily.
 */
function handleConfig(request: Request, env: Env): Response {
  const cf = (request as Request & { cf?: { country?: string } }).cf;
  const country = cf?.country || "";
  const proxy = env.SRF_PROXY_BASE || "";
  const srfProxy = proxy && country && country !== "CH" ? proxy : "";
  return json({ srfProxy, country });
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
      if (pathname === "/api/wm/topscorers" && method === "GET") return await handleTopScorers(env);
      if (pathname === "/api/wm/tabellen" && method === "GET") return await handleTabellen(env);
      if (pathname === "/api/wm/squads" && method === "GET") return await handleSquads(env);
      {
        const m = /^\/api\/wm\/markers\/(.+)$/.exec(pathname);
        if (m) {
          const urn = decodeURIComponent(m[1] || "");
          if (method === "GET") return await handleMarkersGet(env, urn);
          if (method === "POST") return await handleMarkersPut(request, env, urn);
        }
      }
      if (pathname === "/api/config" && method === "GET") return handleConfig(request, env);
      if (pathname === "/api/track" && method === "POST") return await handleTrack(request, env);
      if (pathname === "/api/stats" && method === "GET") return await handleStats(request, env);
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
